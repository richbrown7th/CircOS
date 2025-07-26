import React, { useEffect, useState } from 'react';
import axios from 'axios';

function App() {
  const [cache, setCache] = useState({});
  const [services, setServices] = useState({});

  useEffect(() => {
    fetchData(); // initial fetch
    const interval = setInterval(fetchData, 10000); // every 10s
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const res = await axios.get('http://localhost:8800/cache');
      const data = res.data;
      setCache(data);

      // For each IP, get services
      for (const ip of Object.keys(data)) {
        try {
          const serviceRes = await axios.get(`http://localhost:8800/services/${ip}`);
          setServices(prev => ({ ...prev, [ip]: serviceRes.data }));
        } catch (e) {
          console.warn(`No service info from ${ip}`);
          setServices(prev => ({ ...prev, [ip]: null }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch cache:', err);
    }
  };

  const groupByHost = (data) => {
    const grouped = {};
    for (const ip in data) {
      const entry = data[ip];
      const name = entry.name || 'Unnamed';
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push({ ip, ...entry });
    }
    return grouped;
  };

  const formatUptime = (seconds) => {
    if (!seconds || seconds < 0) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  const formatLastSeen = (isoString) => {
    if (!isoString) return 'N/A';
    const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
    if (diff < 300) return null; // < 5 minutes, hide
    return new Date(isoString).toLocaleTimeString();
  };

  const grouped = groupByHost(cache);

  return (
    <div style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
      <img
        src="https://www.7thsense.one/wp-content/uploads/2020/06/7thsense-logo.svg"
        alt="7thSense Logo"
        height="40"
        style={{ float: 'right' }}
      />
      <h1>CircOS Frontend</h1>
      {Object.keys(grouped).length === 0 ? (
        <p>No machines discovered.</p>
      ) : (
        Object.entries(grouped).map(([hostname, entries]) => (
          <div key={hostname} style={{ marginBottom: '2rem' }}>
            <h2>{hostname}</h2>
            <ul>
              {entries.map(entry => (
                <li key={entry.ip}>
                  <div>
                    <strong>IP:</strong> {entry.ip} —{' '}
                    <strong>RTT:</strong> {entry.lastRtt != null ? `${entry.lastRtt} ms` : 'N/A'} —{' '}
                    <strong>Uptime:</strong> {entry.uptime ? formatUptime(entry.uptime) : 'N/A'}
                    {formatLastSeen(entry.lastSeen) && (
                      <> — <strong>Last Seen:</strong> {formatLastSeen(entry.lastSeen)}</>
                    )}
                  </div>
                  {services[entry.ip] === null ? (
                    <div style={{ color: 'gray' }}>No service info</div>
                  ) : (
                    <ul style={{ marginLeft: '1rem' }}>
                      {services[entry.ip] &&
                        Object.entries(services[entry.ip]).map(([svc, state]) => (
                          <li key={svc}>
                            {svc}:{' '}
                            <strong style={{ color: state.running ? 'green' : 'red' }}>
                              {state.running ? 'Running' : 'Stopped'}
                            </strong>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

export default App;