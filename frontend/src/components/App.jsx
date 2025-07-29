// App.jsx
import React, { useEffect, useReducer, useState } from "react";
import axios from "axios";
import "./App.css";

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
              [field]: value
            }
          }
        }
      };
    default:
      return state;
  }
};

function App() {
  const [machines, dispatch] = useReducer(machineReducer, {});
  const [log, setLog] = useState([]);
  const [editedUrls, setEditedUrls] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  const appendLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setLog((prev) => [...prev, `[${timestamp}] ${msg}`]);
  };

  const fetchData = async () => {
    try {
      const res = await axios.get("http://localhost:8800/cache");
      const hosts = {};
      for (const [ip, data] of Object.entries(res.data)) {
        const hostKey = data.hostname || data.name || ip;
        if (!hosts[hostKey]) {
          hosts[hostKey] = { ...data, ips: [ip] };
        } else {
          hosts[hostKey].ips.push(ip);
          if (new Date(data.lastSeen) > new Date(hosts[hostKey].lastSeen || 0)) {
            hosts[hostKey] = {
              ...hosts[hostKey],
              ...data,
              ips: hosts[hostKey].ips
            };
          }
        }
      }
      dispatch({ type: "SET_MACHINES", payload: hosts });
    } catch (err) {
      appendLog(`❌ Failed to load cache: ${err.message}`);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleManualRefresh = async () => {
    try {
      setRefreshing(true);
      appendLog(`🔄 Manual refresh requested`);
      await axios.post("http://localhost:8800/refresh");
      await fetchData();
      appendLog(`✅ Manual refresh complete`);
    } catch (err) {
      appendLog(`❌ Manual refresh failed: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const getTargetIP = (host) => {
    if (!host?.ips?.length) return null;
    return host.ips.find((ip) => !ip.startsWith("127.")) || host.ips[0];
  };

  const handleEdit = async (host, serviceName, field, value) => {
    const ip = getTargetIP(host);
    if (!ip) return appendLog(`❌ No valid IP for ${host.hostname}`);

    dispatch({
      type: "UPDATE_SERVICE_FIELD",
      payload: { hostKey: host.hostname, serviceName, field, value }
    });

    try {
      appendLog(`✏️ Updating ${field} for ${serviceName} on ${host.hostname} to "${value}"`);
      await axios.post(`http://${ip}:9000/services`, { name: serviceName, [field]: value });
      appendLog(`✅ Updated ${field} for ${serviceName} on ${host.hostname}`);
      const key = `${host.hostname}-${serviceName}`;
      setEditedUrls((prev) => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
    } catch (err) {
      appendLog(`❌ Failed to update ${field}: ${err.message}`);
    }
  };

  const handleStopPID = async (host, serviceName, pid) => {
    const ip = getTargetIP(host);
    if (!ip) return;
    try {
      await axios.post(`http://${ip}:9000/services/stop`, { name: serviceName, pid });
      appendLog(`🛑 Stopped PID ${pid} for ${serviceName} on ${host.hostname}`);
    } catch (err) {
      appendLog(`❌ Failed to stop PID ${pid}: ${err.message}`);
    }
  };

  return (
    <div className="App">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>CircOS Status</h1>
        <button onClick={handleManualRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing..." : "Manual Refresh 🔄"}
        </button>
      </div>

      <div className="grid">
        {Object.entries(machines).map(([key, host]) => (
          <div className="host-card" key={key}>
            <div className="header">
              <h2>{host.name || host.hostname || key}</h2>
              <div className="meta">
                <div>{host.connected ? "🟢 Connected" : "🔴 Offline"}</div>
                <div>{(host.ips || []).join(", ")}</div>
                {host.version && <div>v{host.version}</div>}
                {host.uptime && <div>Up: {host.uptime}</div>}
                {host.lastRtt && <div>RTT: {Math.round(host.lastRtt)}ms</div>}
                {host.lastSeen && <div>Seen: {new Date(host.lastSeen).toLocaleTimeString()}</div>}
              </div>
            </div>

            {host.services && (
              <ul className="service-list">
                {Object.entries(host.services).map(([svc, obj]) => {
                  const inputKey = `${host.hostname}-${svc}`;
                  const lastStartedDate = obj.lastStarted
                    ? new Date(obj.lastStarted * 1000)
                    : null;
                  const secondsAgo = lastStartedDate
                    ? Math.floor((Date.now() - lastStartedDate.getTime()) / 1000)
                    : null;
                  const displayAgo = secondsAgo !== null && secondsAgo < 60 ? `${secondsAgo}s ago` : null;

                  return (
                    <li key={svc} className="service-entry">
                      <strong>{svc}</strong>
                      <span>{obj.running ? "🟢 Running" : "⚪ Stopped"}</span>
                      {displayAgo && (
                        <span
                          className="last-started-label fade-out"
                          title={`Restarted at ${lastStartedDate.toLocaleTimeString()}`}
                        >
                          restarted {displayAgo}
                        </span>
                      )}

                      <select
                        value={obj.mode || "auto"}
                        onChange={(e) => handleEdit(host, svc, "mode", e.target.value)}
                        title="Service mode"
                      >
                        <option value="auto">Auto</option>
                        <option value="manual">Manual</option>
                        <option value="stopped">Stopped</option>
                      </select>

                      <div>
                        <input
                          type="text"
                          className="url-input"
                          value={editedUrls[inputKey] ?? obj.url ?? ""}
                          onChange={(e) =>
                            setEditedUrls((prev) => ({ ...prev, [inputKey]: e.target.value }))
                          }
                          onBlur={(e) =>
                            handleEdit(host, svc, "url", e.target.value)
                          }
                        />
                      </div>

                      {Array.isArray(obj.pids) && obj.pids.length > 0 && (
                        <div className="pid-list">
                          PIDs: {obj.pids.map((pid) => (
                            <span key={pid}>
                              {pid}
                              <button onClick={() => handleStopPID(host, svc, pid)}>✖</button>{" "}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
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