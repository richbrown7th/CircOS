const express = require('express');
const cors = require('cors');
const fs = require('fs');
const ping = require('ping');
const Bonjour = require('bonjour');
const axios = require('axios');
const dns = require('dns').promises;
const os = require('os');

const bonjour = Bonjour();
const app = express();
const PORT = 8800;
const CACHE_FILE = './machine_cache.json';
const STALE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
let machineCache = {};

function getLocalExternalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function isLoopback(ip) {
  return ip.startsWith('127.') || ip === '::1';
}

function isUsableIP(ip) {
  return ip && !isLoopback(ip);
}

function isStale(ip, cache) {
  const lastSeen = cache.lastSeen ? new Date(cache.lastSeen).getTime() : 0;
  return Date.now() - lastSeen > STALE_TIMEOUT_MS;
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

function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
}

function mergeDuplicateMachines(currentIP, currentHostname) {
  if (!currentHostname) return;

  const candidates = Object.entries(machineCache).filter(
    ([ip, data]) => ip !== currentIP && (data.hostname || data.name) === currentHostname
  );

  for (const [ip, data] of candidates) {
    console.log(`[DEDUPE] Merging ${currentIP} with ${ip} (hostname: ${currentHostname})`);

    const winner = new Date(machineCache[currentIP].lastSuccess || 0) > new Date(data.lastSuccess || 0)
      ? machineCache[currentIP] : data;

    const merged = {
      ...data,
      ...machineCache[currentIP],
      ...winner,
      address: currentIP,
      hostname: currentHostname,
      ips: Array.from(new Set([...(data.ips || [ip]), ...(machineCache[currentIP].ips || [currentIP])]))
    };

    machineCache[currentIP] = merged;
    delete machineCache[ip];
    saveCache();
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
    saveCache();
    return newIP;
  }

  return ip;
}

async function updatePings(source = "scheduler") {
  const ips = Object.keys(machineCache);
  if (!ips.length) return;

  console.log(`[PING] (${source}) Checking ${ips.length} machines...`);
  let updated = false;

  for (let ip of ips) {
    if (isLoopback(ip)) continue;

    const now = new Date().toISOString();
    let cache = machineCache[ip];

    if (!cache) continue;

    if (isStale(ip, cache)) {
      try {
        const res = await ping.promise.probe(ip);
        if (!res.alive) {
          console.warn(`[CLEANUP] Removing unreachable stale IP ${ip}`);
          delete machineCache[ip];
          updated = true;
          continue;
        }
      } catch {
        console.warn(`[CLEANUP] Timeout while probing stale IP ${ip}, removing`);
        delete machineCache[ip];
        updated = true;
        continue;
      }
    }

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
        cache.lastSuccess = now;
        cache.uptime = info.uptime ?? null;
        cache.hostname = info.hostname ?? null;
        cache.version = info.version ?? null;
        mergeDuplicateMachines(ip, cache.hostname);
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

  if (updated) saveCache();
}

bonjour.publish({
  name: "CircOS Helper",
  type: "circos-helper",
  port: PORT
});

bonjour.find({ type: 'circos' }, service => {
  const ip = service.referer?.address || 'unknown';
  if (isLoopback(ip)) return;

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
  mergeDuplicateMachines(ip, service.name || null);
  saveCache();
});

if (fs.existsSync(CACHE_FILE)) {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    machineCache = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    machineCache = {};
    saveCache();
  }
} else {
  saveCache();
}

setInterval(() => updatePings("interval"), 60_000);

app.use(cors());
app.use(express.json());

app.get('/cache', (req, res) => {
  res.json(machineCache);
});

app.post('/cache', (req, res) => {
  const { address, name, port } = req.body;
  if (!address || isLoopback(address)) return res.status(400).json({ error: 'Valid address required' });

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

  saveCache();
  res.json({ success: true });
});

app.post('/refresh', async (req, res) => {
  console.log("[REFRESH] Manual refresh from UI");
  await updatePings("manual-refresh");
  res.json({ success: true });
});

app.post('/notify-startup', async (req, res) => {
  let { ip, name, port } = req.body;
  if (!ip) return res.status(400).json({ error: "Missing IP" });

  if (isLoopback(ip)) {
    ip = getLocalExternalIP();
    console.log(`[STARTUP] Replaced loopback with ${ip}`);
  }

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
  saveCache();
  res.json({ success: true });
});

app.post('/notify-shutdown', (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: "Missing IP" });

  console.log(`[SHUTDOWN] Backend at ${ip} shutdown notification`);
  if (machineCache[ip]) {
    machineCache[ip].connected = false;
    machineCache[ip].services = null;
    saveCache();
    setTimeout(() => updatePings(`notify-shutdown-${ip}`), 100);
  }

  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[helper] Listening at http://0.0.0.0:${PORT}`);
  updatePings("startup");
});