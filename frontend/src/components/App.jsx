import React, { useEffect, useReducer, useState } from "react";
import axios from "axios";
import "./App.css";

// Reducer for managing machines state
const machineReducer = (state, action) => {
  switch (action.type) {
    case "SET_MACHINES":
      return action.payload;
    case "UPDATE_SERVICE_FIELD":
      const { hostKey, serviceName, field, value } = action.payload;
      return {
        ...state,
        [hostKey]: {
          ...state[hostKey],
          services: {
            ...state[hostKey].services,
            [serviceName]: {
              ...state[hostKey].services[serviceName],
              [field]: value,
            },
          },
        },
      };
    default:
      return state;
  }
};

function App() {
  const [machines, dispatch] = useReducer(machineReducer, {});
  const [log, setLog] = useState([]);

  const appendLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    const fullMsg = `[${timestamp}] ${msg}`;
    setLog((prev) => [...prev, fullMsg]);

    if (window.Notification && Notification.permission === "granted") {
      new Notification("CircOS Log", { body: msg });
    }
  };

  useEffect(() => {
    if (window.Notification && Notification.permission !== "granted") {
      Notification.requestPermission();
    }

    const fetchData = async () => {
      try {
        const res = await axios.get("http://localhost:8800/cache");
        const hosts = {};

        for (const [ip, data] of Object.entries(res.data)) {
          const host = data.hostname || data.name || ip;
          if (!hosts[host]) hosts[host] = { ...data, ips: [ip] };
          else hosts[host].ips.push(ip);
        }

        dispatch({ type: "SET_MACHINES", payload: hosts });
      } catch (err) {
        console.error("[UI] Failed to load cache:", err.message);
        appendLog(`❌ Failed to load cache: ${err.message}`);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const getTargetIP = (host) => {
    if (!host?.ips?.length) return null;
    return host.ips.find(ip => !ip.startsWith("127.")) || host.ips[0];
  };

  const handleWol = async (mac, host) => {
    const ip = getTargetIP(host);
    if (!ip) {
      appendLog(`❌ No valid IP for WOL on ${host.hostname}`);
      return;
    }
    try {
      appendLog(`💬 Sending WOL to ${host.hostname} (${ip})`);
      await axios.post(`http://${ip}:9000/wol`, { mac });
      appendLog(`✅ WOL sent to ${host.hostname}`);
    } catch (err) {
      let reason = err?.response?.data || err?.message || "Unknown error";
      appendLog(`❌ WOL failed for ${host.hostname}: ${reason}`);
    }
  };

  const handleStop = async (host, serviceName) => {
    const ip = getTargetIP(host);
    if (!ip) {
      appendLog(`❌ No valid IP to stop ${serviceName} on ${host.hostname}`);
      return;
    }
    try {
      appendLog(`💬 Stopping service ${serviceName} on ${host.hostname}`);
      await axios.post(`http://${ip}:9000/stop`, null, {
        params: { name: serviceName }
      });
      appendLog(`✅ Stopped ${serviceName} on ${host.hostname}`);
    } catch (err) {
      let reason = err?.response?.data || err?.message || "Unknown error";
      appendLog(`❌ Failed to stop ${serviceName} on ${host.hostname}: ${reason}`);
    }
  };

  const handleEdit = async (host, serviceName, field, value) => {
    const ip = getTargetIP(host);
    if (!ip) {
      appendLog(`❌ No valid IP to update config on ${host.hostname}`);
      return;
    }

    dispatch({
      type: "UPDATE_SERVICE_FIELD",
      payload: {
        hostKey: host.hostname,
        serviceName,
        field,
        value
      }
    });

    try {
      appendLog(`✏️ Updating ${field} for ${serviceName} on ${host.hostname} to "${value}"`);
      await axios.post(`http://${ip}:9000/services`, {
        name: serviceName,
        [field]: value
      });
      appendLog(`✅ Updated ${field} for ${serviceName} on ${host.hostname}`);
    } catch (err) {
      let reason = err?.response?.data || err?.message || "Unknown error";
      appendLog(`❌ Failed to update ${field} for ${serviceName} on ${host.hostname}: ${reason}`);
    }
  };

  const hostList = Object.values(machines);

  return (
    <div className="App dark">
      <h1>CircOS Status</h1>
      <div className="grid">
        {hostList.map((host, idx) => (
          <div className="host-card fade-in" key={idx}>
            <div className="header">
              <h2>{host.name || host.hostname || `Host ${idx + 1}`}</h2>
              {!host.connected && host.mac && (
                <button
                  className="wol-btn"
                  onClick={() => handleWol(host.mac, host)}
                  disabled={!host.mac}
                >
                  🔌 Wake
                </button>
              )}
            </div>
            <p><strong>IPs:</strong> {host.ips?.join(", ") || "N/A"}</p>
            <p><strong>RTT:</strong> <span>{host.lastRtt ?? "N/A"} ms</span></p>
            <p><strong>Uptime:</strong> {host.uptime ?? "N/A"} s</p>
            <p><strong>Version:</strong> {host.version ?? "Unknown"}</p>
            <p><strong>Status:</strong> {host.connected ? "🟢 Connected" : "🔴 Offline"}</p>

            <h3>Services</h3>
            <ul className="service-list" style={{ minHeight: "100px" }}>
              {host.services
                ? Object.entries(host.services).map(([svc, obj]) => (
                    <li key={svc} className="service-entry">
                      <strong>{svc}</strong>: {obj.running ? "🟢 Running" : "⚪ Stopped"}
                      {obj.running && obj.pids?.length > 1 && (
                        <p>PIDs: {obj.pids.join(", ")}</p>
                      )}

                      <p>
                        URL:{" "}
                        <input
                          type="text"
                          value={obj.url || ""}
                          onChange={e =>
                            handleEdit(host, svc, "url", e.target.value)
                          }
                        />
                      </p>

                      <label>
                        Singleton:
                        <input
                          type="checkbox"
                          checked={obj.singleton || false}
                          onChange={e =>
                            handleEdit(host, svc, "singleton", e.target.checked)
                          }
                        />
                      </label>

                      <button onClick={() => handleStop(host, svc)}>
                        ⛔ Stop
                      </button>
                    </li>
                  ))
                : <li className="service-placeholder">No service info available.</li>}
            </ul>
          </div>
        ))}
      </div>

      <div className="log">
        <h3>Frontend Log</h3>
        <ul className="log-list">
          {log.map((entry, i) => (
            <li key={i} className="log-entry fade-in">{entry}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;