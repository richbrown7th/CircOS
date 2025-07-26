const express = require('express');
const cors = require('cors');
const fs = require('fs');
const ping = require('ping');
const Bonjour = require('bonjour');

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

        // Init fields if not present
        if (!machineCache[ip].pingHistory) machineCache[ip].pingHistory = [];

        machineCache[ip].lastSeen = now;
        machineCache[ip].lastPing = now;
        machineCache[ip].lastRtt = res.time;

        machineCache[ip].pingHistory.push(now);
        if (machineCache[ip].pingHistory.length > 10) {
          machineCache[ip].pingHistory.shift(); // Keep last 10 entries
        }

        console.log(`[PING] ${ip} alive. RTT ${res.time} ms. Updated.`);
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
    pingHistory: []
  };

  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`[helper] Listening on http://localhost:${PORT}`);
});