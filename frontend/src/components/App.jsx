import React, { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

function App() {
  const [machines, setMachines] = useState({});
  const [log, setLog] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get("http://localhost:8800/cache");
        const hosts = {};

        for (const [ip, data] of Object.entries(res.data)) {
          const host = data.hostname || data.name || ip;
          if (!hosts[host]) hosts[host] = { ...data, ips: [ip] };
          else hosts[host].ips.push(ip);
        }

        setMachines(hosts);
      } catch (err) {
        console.error("[UI] Failed to load cache:", err.message);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleWol = async (mac, host) => {
    try {
      setLog(prev => [...prev, `Sending WOL for ${host}`]);
      await axios.post("http://localhost:9000/wol", { mac });
      setLog(prev => [...prev, `✅ WOL sent to ${host}`]);
    } catch (err) {
      setLog(prev => [...prev, `❌ WOL failed for ${host}: ${err.message}`]);
    }
  };

  const hostList = Object.values(machines);

  return (
    <div className="App dark">
      <h1>CircOS Status</h1>
      <div className="grid">
        {hostList.map((host, idx) => (
          <div className="host-card" key={idx}>
            <div className="header">
              <h2>{host.name || host.hostname || `Host ${idx + 1}`}</h2>
              {!host.connected && host.mac && (
                <button
                  className="wol-btn"
                  onClick={() => handleWol(host.mac, host.name)}
                >
                  🔌 Wake
                </button>
              )}
            </div>
            <p><strong>IPs:</strong> {host.ips.join(", ")}</p>
            <p><strong>RTT:</strong> {host.lastRtt ?? "N/A"} ms</p>
            <p><strong>Uptime:</strong> {host.uptime ?? "N/A"} s</p>
            <p><strong>Version:</strong> {host.version ?? "Unknown"}</p>
            <p><strong>Status:</strong> {host.connected ? "🟢 Connected" : "🔴 Offline"}</p>
            {host.services && (
              <>
                <h3>Services</h3>
                <ul>
                  {Object.entries(host.services).map(([svc, obj]) => (
                    <li key={svc}>{svc}: {obj.running ? "🟢 Running" : "⚪ Stopped"}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="log">
        <h3>Frontend Log</h3>
        <ul>
          {log.map((entry, i) => (
            <li key={i}>{entry}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;