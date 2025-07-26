const express = require('express');
const mdns = require('multicast-dns')();
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3050;
const CACHE_FILE = path.join(__dirname, 'machine_cache.json');

let cache = {};
if (fs.existsSync(CACHE_FILE)) {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE));
}

function updateCache(host, ip) {
  cache[host] = { ip, lastSeen: new Date().toISOString() };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

mdns.on('response', function(response) {
  response.answers.forEach(a => {
    if (a.type === 'A') {
      updateCache(a.name, a.data);
    }
  });
});

app.get('/discover', (req, res) => {
  res.json(cache);
});

app.get('/cache', (req, res) => {
  res.json(cache);
});

app.listen(PORT, () => {
  console.log(`Frontend helper running at http://localhost:${PORT}`);
});