const express = require('express');
const cors = require('cors');
const fs = require('fs');
const ping = require('ping');
const Bonjour = require('bonjour');
const axios = require('axios');
const dns = require('dns').promises;

const bonjour = Bonjour();
const app = express();
const PORT = 8800;
const CACHE_FILE = './machine_cache.json';
let machineCache = {};

// publish for end points to be aware of helper presence
bonjour.publish({
  name: "CircOS Helper",
  type: "circos-helper",
  port: 8800
});

// Load machine cache
if (fs.existsSync(CACHE_FILE)) {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    machineCache = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    machineCache = {};
    fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  }
} else {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
}

// mDNS discovery
bonjour.find({ type: 'circos' }, service => {
  const ip = service.referer?.address || 'unknown';
  machineCache[ip] = {
    name: service.name || 'Unnamed',
    address: ip,
    port: service.port || 9000,
    lastSeen: new Date().toISOString(),
    lastPing: null,
    lastRtt: null,
    uptime: null,
    hostname: null,
    version: null,
    pingHistory: [],
    services: null,
    connected: true,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
});

// Utilities
function isLoopback(ip) {
  return ip.startsWith('127.') || ip === '::1';
}

function isUsableIP(ip) {
  return ip && !isLoopback(ip);
}

async function resolveIPv4PreferNonLoopback(hostname) {
  try {
    const res = await dns.lookup(hostname, { all: true, family: 4 });
    const usable = res.find(r => isUsableIP(r.address));
    return usable?.address || res[0]?.address;
  } catch (e) {
    console.warn(`[IP-RESOLVE] Failed to resolve ${hostname}: ${e.message}`);
    return null;
  }
}

async function tryUpdateCachedIP(ip, cache) {
  const host = cache.hostname || cache.name;
  if (!host || !host.endsWith('.local') || cache.name === 'Manual') return ip;

  const newIP = await resolveIPv4PreferNonLoopback(host);
  if (newIP && newIP !== ip) {
    console.log(`[IP-REFRESH] IP for ${host} changed from ${ip} to ${newIP}`);

    machineCache[newIP] = { ...cache, address: newIP };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));

    if (isLoopback(ip)) {
      delete machineCache[ip];
      console.log(`[IP-REFRESH] Removed loopback cache entry for ${ip}`);
    }

    return newIP;
  }
  return ip;
}

// Ping loop with backend trust
async function updatePings(source = "scheduler") {
  const ips = Object.keys(machineCache);
  if (!ips.length) return;

  console.log(`[PING] (${source}) Checking ${ips.length} cached machines...`);
  let updated = false;

  for (let ip of ips) {
    const now = new Date().toISOString();
    let backendAlive = false;
    let cache = machineCache[ip];

    if (!cache.connected) {
      const refreshedIP = await tryUpdateCachedIP(ip, cache);
      if (refreshedIP !== ip) {
        ip = refreshedIP;
        cache = machineCache[ip];
      }
    }

    try {
      const res = await ping.promise.probe(ip);
      const rtt = res.time;

      cache.lastPing = now;
      cache.lastRtt = rtt;
      cache.pingHistory = (cache.pingHistory || []).concat(now).slice(-10);

      try {
        const pingRes = await axios.get(`http://${ip}:9000/ping`, { timeout: 1000 });
        const info = pingRes.data;

        cache.lastSeen = now;
        cache.uptime = info.uptime ?? null;
        cache.hostname = info.hostname ?? null;
        cache.version = info.version ?? null;

        backendAlive = true;
      } catch (e) {
        console.warn(`[PING] /ping request to ${ip} failed: ${e.message}`);
      }

      if (backendAlive) {
        try {
          const response = await axios.get(`http://${ip}:${cache.port || 9000}/status`, { timeout: 1000 });
          cache.services = response.data;
          cache.connected = true;
        } catch (err) {
          console.warn(`[SERVICES] Failed to fetch status from ${ip} — ${err.code || err.message}`);
          cache.services = null;
          cache.connected = false;
        }
        updated = true;
        console.log(`[PING] ${ip} backend responsive. RTT ${rtt} ms.`);
      } else {
        cache.connected = false;
        cache.services = null;
        console.log(`[PING] ${ip} marked disconnected.`);
      }
    } catch (e) {
      console.warn(`[PING] Failed to ping ${ip}: ${e.message}`);
    }
  }

  if (updated) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  }
}

setInterval(() => updatePings("interval"), 60_000);

// REST endpoints
app.use(cors());
app.use(express.json());

app.get('/cache', (req, res) => {
  res.json(machineCache);
});

app.post('/cache', (req, res) => {
  const { address, name, port } = req.body;
  if (!address) return res.status(400).json({ error: 'Address required' });

  machineCache[address] = {
    name: name || 'Manual',
    address,
    port: port || 9000,
    lastSeen: new Date().toISOString(),
    lastPing: null,
    lastRtt: null,
    uptime: null,
    hostname: null,
    version: null,
    pingHistory: [],
    services: null,
    connected: true,
  };

  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  res.json({ success: true });
});

app.get('/services/:ip', async (req, res) => {
  const ip = req.params.ip;
  const port = machineCache[ip]?.port || 9000;

  try {
    const response = await axios.get(`http://${ip}:${port}/status`, { timeout: 1000 });
    res.json(response.data);
  } catch (err) {
    console.warn(`[SERVICES] Failed to fetch status from ${ip}:${port} — ${err.code || err.message}`);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

app.post('/refresh', async (req, res) => {
  console.log("[REFRESH] Manual refresh requested via GUI");
  await updatePings("gui");
  res.json({ success: true, refreshed: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[helper] Listening on http://0.0.0.0:${PORT}`);
});

app.post('/notify-startup', async (req, res) => {
  const { ip, name, port } = req.body;
  if (!ip) return res.status(400).json({ error: "Missing IP" });

  console.log(`[STARTUP] Backend at ${ip} notifying startup`);

  machineCache[ip] = {
    ...(machineCache[ip] || {}),
    name: name || machineCache[ip]?.name || "Manual",
    address: ip,
    port: port || machineCache[ip]?.port || 9000,
    lastSeen: new Date().toISOString(),
    connected: true,
  };

  await updatePings(`startup-${ip}`);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  setTimeout(() => updatePings(`startup-refresh-${ip}`), 100);
  res.json({ success: true });
});

app.post('/notify-shutdown', (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: "Missing IP" });

  console.log(`[SHUTDOWN] Backend at ${ip} notified shutdown`);
  if (machineCache[ip]) {
    machineCache[ip].connected = false;
    machineCache[ip].services = null;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
    setTimeout(() => updatePings(`shutdown-refresh-${ip}`), 100);
  }

  res.json({ success: true });
});