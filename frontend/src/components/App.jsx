import React, { useEffect, useState } from "react";
import axios from "axios";
import "./App.css";

function App() {
  const [machines, setMachines] = useState({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get("http://localhost:8800/cache");
        const rawMachines = res.data;
        const updated = {};

        Object.entries(rawMachines).forEach(([ip, data]) => {
          const isReachable =
            data.lastPing &&
            Date.now() - new Date(data.lastPing).getTime() < 120_000;

          const hostname = data.hostname || ip;

          if (!updated[hostname]) {
            updated[hostname] = {
              name: data.name || hostname,
              hostname,
              ips: [],
              connected: false,
              lastRtt: null,
              uptime: null,
              version: null,
              services: null,
            };
          }

          updated[hostname].ips.push(ip);

          if (
            (data.connected !== undefined ? data.connected : isReachable) &&
            data.uptime !== null &&
            data.hostname !== null
          ) {
            updated[hostname].connected = true;
            updated[hostname].lastRtt = data.lastRtt;
            updated[hostname].uptime = data.uptime;
            updated[hostname].version = data.version;
            if (data.services) updated[hostname].services = data.services;
          }
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

  const machineList = Object.values(machines);
  const connectedCount = machineList.filter((m) => m.connected).length;

  let statusText = "Disconnected";
  let statusClass = "status-red";

  if (connectedCount === machineList.length && connectedCount > 0) {
    statusText = "All Machines Connected";
    statusClass = "status-green";
  } else if (connectedCount > 0) {
    statusText = "Some Machines Connected";
    statusClass = "status-orange";
  }

  const sendWOL = async (hostname) => {
    const entry = machines[hostname];
    const mac = entry?.mac;
    const ip = entry?.ips?.[0];
    if (!ip) return;

    try {
      await axios.post(`http://${ip}:9000/wol`, { mac });
      console.log(`[WOL] Sent WOL to ${hostname}`);
    } catch (err) {
      console.error(`[WOL] Failed to send WOL to ${hostname}:`, err.message);
    }
  };

  return (
    <div className="App">
      <h1>CircOS Machine Status</h1>
      <div className={`status-banner ${statusClass}`}>{statusText}</div>

      {machineList.length === 0 ? (
        <p>No machines found.</p>
      ) : (
        <div className="machine-grid">
          {machineList.map((hostData) => (
            <div
              className={`machine-box ${hostData.connected ? "" : "disconnected"}`}
              key={hostData.hostname}
            >
              <div className="machine-header">
                <h2>{hostData.name}</h2>
                {!hostData.connected && (
                  <button
                    className="wol-button"
                    onClick={() => sendWOL(hostData.hostname)}
                  >
                    Wake
                  </button>
                )}
              </div>

              <p>
                <strong>IPs:</strong> {hostData.ips.join(", ")}
              </p>
              <p>
                <strong>RTT:</strong>{" "}
                {hostData.lastRtt ? `${hostData.lastRtt} ms` : "N/A"}
              </p>
              <p>
                <strong>Uptime:</strong>{" "}
                {hostData.uptime !== null ? `${hostData.uptime}s` : "N/A"}
              </p>
              <p>
                <strong>Version:</strong> {hostData.version || "Unknown"}
              </p>
              <p>
                <strong>Status:</strong>{" "}
                {hostData.connected ? "🟢 Connected" : "⚠️ Disconnected"}
              </p>

              {hostData.connected ? (
                <div>
                  <h3>Services</h3>
                  {hostData.services ? (
                    <ul>
                      {Object.entries(hostData.services).map(([name, svc]) => (
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