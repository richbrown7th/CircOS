const express = require('express');
const cors = require('cors');
const fs = require('fs');
const Bonjour = require('bonjour');  // FIX: proper import
const bonjour = Bonjour();           // FIX: proper initialization

const app = express();
const PORT = 8800;

const CACHE_FILE = './machine_cache.json';
let machineCache = {};

// Load machine cache
// Load or initialize machine cache
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

// Start mDNS discovery
bonjour.find({ type: 'circos' }, service => {
  const ip = service.referer?.address || 'unknown';
  console.log('[mDNS] Discovered:', ip);
  
  machineCache[ip] = {
    name: service.name || 'Unnamed',
    address: ip,
    port: service.port || 9000,
    lastSeen: new Date().toISOString()
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(machineCache, null, 2));
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
