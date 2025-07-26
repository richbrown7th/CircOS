const express = require('express');
const cors = require('cors');
const fs = require('fs');
const bonjour = require('bonjour')();

const app = express();
const PORT = 8800;

const CACHE_FILE = './machine_cache.json';
let machineCache = {};

// Load machine cache
if (fs.existsSync(CACHE_FILE)) {
  try {
    machineCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch (err) {
    console.error('[CACHE] Failed to load machine cache:', err.message);
  }
}

// Start mDNS discovery
bonjour.find({ type: 'circos' }, service => {
  const ip = service.referer.address;
  if (!machineCache[ip]) {
    console.log('[mDNS] Discovered:', ip);
    machineCache[ip] = {
      name: service.name || 'Unnamed',
      address: ip,
      port: service.port || 9000,
      lastSeen: new Date().toISOString()
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  }
});

app.use(cors());
app.use(express.json());

// GET machine cache
app.get('/cache', (req, res) => {
  res.json(machineCache);
});

// POST to add manual machine
app.post('/cache', (req, res) => {
  const { address, name, port } = req.body;
  if (!address) return res.status(400).json({ error: 'Address required' });
  machineCache[address] = {
    name: name || 'Manual',
    address,
    port: port || 9000,
    lastSeen: new Date().toISOString()
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`[helper] Listening on http://localhost:${PORT}`);
});