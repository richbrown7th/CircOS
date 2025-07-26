import React, { useEffect, useState } from 'react';

function App() {
  const [status, setStatus] = useState({});
  const [cache, setCache] = useState({});

  // Fetch /status and /cache periodically
  useEffect(() => {
    const fetchAll = () => {
      fetch('/status')
        .then(res => res.json())
        .then(setStatus)
        .catch(console.error);

      fetch('http://localhost:8800/cache')
        .then(res => res.json())
        .then(data => {
          // Force a new object reference for React to detect change
          setCache({ ...data });
        })
        .catch(console.error);
    };

    fetchAll(); // Initial fetch
    const interval = setInterval(fetchAll, 5000); // Refresh every 5s

    return () => clearInterval(interval); // Cleanup on unmount
  }, []);

  return (
    <div style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
      <img
        src="https://www.7thsense.one/wp-content/uploads/2020/06/7thsense-logo.svg"
        alt="7thSense Logo"
        height="40"
        style={{ float: 'right' }}
      />
      <h1>CircOS Frontend</h1>

      <h2>Service Status</h2>
      <ul>
        {Object.entries(status).map(([name, info]) => (
          <li key={name}>
            {name}:{' '}
            <strong style={{ color: info.running ? 'green' : 'red' }}>
              {info.running ? 'Running' : 'Stopped'}
            </strong>
          </li>
        ))}
      </ul>

      <h2>Machine Ping Status</h2>
      <ul>
        {Object.values(cache).map(machine => (
          <li key={machine.address}>
            {machine.name} — IP: {machine.address},{' '}
            Last Ping:{' '}
            {machine.lastPing
              ? new Date(machine.lastPing).toLocaleTimeString()
              : 'N/A'}
            , RTT: {machine.lastRtt ? `${machine.lastRtt} ms` : 'N/A'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;