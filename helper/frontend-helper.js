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

// Publish presence for mDNS discovery
bonjour.publish({
  name: "CircOS Helper",
  type: "circos-helper",
  port: PORT
});

// Load existing cache
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

// === UTILITIES ===
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

    if (isLoopback(ip)) {
      delete machineCache[ip];
      console.log(`[IP-REFRESH] Removed loopback cache entry for ${ip}`);
    }

    fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
    return newIP;
  }

  return ip;
}

// === CORE: Ping and Fetch Info ===
async function updatePings(source = "scheduler") {
  const ips = Object.keys(machineCache);
  if (!ips.length) return;

  console.log(`[PING] (${source}) Checking ${ips.length} machines...`);
  let updated = false;

  for (let ip of ips) {
    const now = new Date().toISOString();
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
      } catch (e) {
        console.warn(`[PING] /ping failed for ${ip}: ${e.message}`);
      }

      try {
        const svcRes = await axios.get(`http://${ip}:${cache.port || 9000}/services`, { timeout: 1000 });
        cache.services = svcRes.data;
        cache.connected = true;
        updated = true;
        console.log(`[PING] ${ip} is responsive. RTT: ${rtt}ms`);
      } catch (err) {
        console.warn(`[SERVICES] Fetch failed from ${ip}: ${err.message}`);
        cache.services = null;
        cache.connected = false;
      }
    } catch (e) {
      console.warn(`[PING] General failure for ${ip}: ${e.message}`);
    }
  }

  if (updated) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  }
}

setInterval(() => updatePings("interval"), 60_000);

// === API ===
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

app.post('/refresh', async (req, res) => {
  console.log("[REFRESH] Manual refresh from UI");
  await updatePings("manual-refresh");
  res.json({ success: true });
});

app.post('/notify-startup', async (req, res) => {
  const { ip, name, port } = req.body;
  if (!ip) return res.status(400).json({ error: "Missing IP" });

  console.log(`[STARTUP] Backend at ${ip} startup notification`);
  machineCache[ip] = {
    ...(machineCache[ip] || {}),
    name: name || machineCache[ip]?.name || "Manual",
    address: ip,
    port: port || 9000,
    lastSeen: new Date().toISOString(),
    connected: true,
  };

  await updatePings(`notify-startup-${ip}`);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  res.json({ success: true });
});

app.post('/notify-shutdown', (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: "Missing IP" });

  console.log(`[SHUTDOWN] Backend at ${ip} shutdown notification`);
  if (machineCache[ip]) {
    machineCache[ip].connected = false;
    machineCache[ip].services = null;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
    setTimeout(() => updatePings(`notify-shutdown-${ip}`), 100);
  }

  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[helper] Listening at http://0.0.0.0:${PORT}`);
  updatePings("startup");  // immediate startup ping
});