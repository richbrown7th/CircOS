import React, { useEffect, useState } from 'react';

function App() {
  const [status, setStatus] = useState({});

  useEffect(() => {
    fetch('/status')
      .then(res => res.json())
      .then(data => setStatus(data));
  }, []);

  return (
    <div style={{ padding: '1rem', fontFamily: 'sans-serif' }}>
      <img src="https://www.7thsense.one/wp-content/uploads/2020/06/7thsense-logo.svg" alt="7thSense Logo" height="40" style={{ float: 'right' }} />
      <h1>CircOS Frontend</h1>
      <h2>Service Status</h2>
      <ul>
        {Object.entries(status).map(([name, info]) => (
          <li key={name}>
            {name}: <strong style={{ color: info.running ? 'green' : 'red' }}>{info.running ? 'Running' : 'Stopped'}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;