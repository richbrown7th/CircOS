const express = require('express');
const cors = require('cors');
const fs = require('fs');
const ping = require('ping');
const Bonjour = require('bonjour');
const axios = require('axios');

const bonjour = Bonjour();
const app = express();
const PORT = 8800;
const CACHE_FILE = './machine_cache.json';
let machineCache = {};

// Load machine cache
if (fs.existsSync(CACHE_FILE)) {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    machineCache = raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('[CACHE] Failed to parse machine cache. Recreating...');
    machineCache = {};
    fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  }
} else {
  console.log('[CACHE] No existing cache found. Creating new cache file.');
  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
}

// mDNS discovery
bonjour.find({ type: 'circos' }, service => {
  const ip = service.referer?.address || 'unknown';
  console.log('[mDNS] Discovered:', ip);

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
    pingHistory: []
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
});

// Ping loop
async function updatePings() {
  const ips = Object.keys(machineCache);
  if (!ips.length) return;

  console.log(`[PING] Checking ${ips.length} cached machines...`);
  let updated = false;

  for (const ip of ips) {
    try {
      const res = await ping.promise.probe(ip);
      if (res.alive) {
        const now = new Date().toISOString();
        const rtt = res.time;

        if (!machineCache[ip].pingHistory) machineCache[ip].pingHistory = [];

        machineCache[ip].lastSeen = now;
        machineCache[ip].lastPing = now;
        machineCache[ip].lastRtt = rtt;
        machineCache[ip].pingHistory.push(now);
        if (machineCache[ip].pingHistory.length > 10) {
          machineCache[ip].pingHistory.shift();
        }

        // Try to fetch metadata from /ping
        try {
          const pingRes = await axios.get(`http://${ip}:9000/ping`, { timeout: 1000 });
          const info = pingRes.data;

          machineCache[ip].uptime = info.uptime ?? null;
          machineCache[ip].hostname = info.hostname ?? null;
          machineCache[ip].version = info.version ?? null;
        } catch (e) {
          console.warn(`[PING] /ping request to ${ip} failed: ${e.message}`);
        }

        console.log(`[PING] ${ip} alive. RTT ${rtt} ms. Updated.`);
        updated = true;
      } else {
        console.log(`[PING] ${ip} is not responding.`);
      }
    } catch (e) {
      console.warn(`[PING] Failed to ping ${ip}: ${e.message}`);
    }
  }

  if (updated) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  }
}

setInterval(updatePings, 60_000); // every 60s

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
    pingHistory: []
  };

  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  res.json({ success: true });
});

// ✅ NEW: Proxy service status from each backend
app.get('/services/:ip', async (req, res) => {
  const ip = req.params.ip;
  const port = machineCache[ip]?.port || 9000;

  try {
    const response = await axios.get(`http://${ip}:${port}/status`, { timeout: 1000 });
    res.json(response.data);
  } catch (err) {
    console.warn(`[SERVICES] Failed to fetch status from ${ip}:${port} — ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

app.listen(PORT, () => {
  console.log(`[helper] Listening on http://localhost:${PORT}`);
});
