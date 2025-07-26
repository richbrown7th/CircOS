import React, { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

function App() {
  const [machines, setMachines] = useState({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get("http://localhost:8800/cache");
        const updated = {};

        Object.entries(res.data).forEach(([ip, data]) => {
          const isReachable =
            data.lastPing &&
            Date.now() - new Date(data.lastPing).getTime() < 120_000;

          updated[ip] = {
            ...data,
            connected:
              data.connected !== undefined
                ? data.connected
                : isReachable &&
                  data.uptime !== null &&
                  data.hostname !== null,
          };
        });

        setMachines(updated);
      } catch (err) {
        console.error("[UI] Failed to load cache:", err.message);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Summary status
  const machineList = Object.values(machines);
  const connectedCount = machineList.filter(m => m.connected).length;

  let statusText = "Disconnected";
  let statusClass = "status-red";

  if (connectedCount === machineList.length && connectedCount > 0) {
    statusText = "All Machines Connected";
    statusClass = "status-green";
  } else if (connectedCount > 0) {
    statusText = "Some Machines Connected";
    statusClass = "status-orange";
  }

  return (
    <div className="App">
      <h1>CircOS Machine Status</h1>
      <div className={`status-banner ${statusClass}`}>{statusText}</div>

      {machineList.length === 0 ? (
        <p>No machines found.</p>
      ) : (
        <div className="machine-grid">
          {Object.entries(machines).map(([ip, data]) => (
            <div className={`machine-box ${data.connected ? "" : "disconnected"}`} key={ip}>
              <h2>{data.name} ({ip})</h2>
              <p><strong>RTT:</strong> {data.lastRtt ? `${data.lastRtt} ms` : "N/A"}</p>
              <p><strong>Uptime:</strong> {data.uptime !== null ? `${data.uptime}s` : "N/A"}</p>
              <p><strong>Version:</strong> {data.version || "Unknown"}</p>
              <p><strong>Status:</strong> {data.connected ? "🟢 Connected" : "⚠️ Disconnected"}</p>

              {data.connected ? (
                <div>
                  <h3>Services</h3>
                  {data.services ? (
                    <ul>
                      {Object.entries(data.services).map(([name, svc]) => (
                        <li key={name}>
                          {name}: {svc.running ? "🟢 Running" : "⚪ Stopped"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No service info</p>
                  )}
                </div>
              ) : (
                <p style={{ color: "darkred" }}>Cannot reach backend.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;