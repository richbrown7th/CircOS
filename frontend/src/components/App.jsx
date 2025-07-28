// === App.jsx ===
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
  const [editedUrls, setEditedUrls] = useState({});

  const appendLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setLog((prev) => [...prev, `[${timestamp}] ${msg}`]);

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
          const hostKey = data.hostname || data.name || ip;

          if (!hosts[hostKey]) {
            hosts[hostKey] = { ...data, ips: [ip] };
          } else {
            hosts[hostKey].ips.push(ip);
            // Use freshest ping info
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

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const getTargetIP = (host) => {
    if (!host?.ips?.length) return null;
    return host.ips.find(ip => !ip.startsWith("127.")) || host.ips[0];
  };

  const handleEdit = async (host, serviceName, field, value) => {
    const ip = getTargetIP(host);
    if (!ip) return appendLog(`❌ No valid IP for ${host.hostname}`);

    dispatch({
      type: "UPDATE_SERVICE_FIELD",
      payload: { hostKey: host.hostname, serviceName, field, value },
    });

    try {
      appendLog(`✏️ Updating ${field} for ${serviceName} on ${host.hostname} to "${value}"`);
      await axios.post(`http://${ip}:9000/services`, { name: serviceName, [field]: value });
      appendLog(`✅ Updated ${field} for ${serviceName} on ${host.hostname}`);

      if (field === "url") {
        const key = `${host.hostname}-${serviceName}`;
        setEditedUrls(prev => {
          const newState = { ...prev };
          delete newState[key];
          return newState;
        });
      }
    } catch (err) {
      appendLog(`❌ Failed to update ${field}: ${err.message}`);
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
            </div>

            {/* DEBUG INFO */}
            <p><strong>Host:</strong> {host.hostname}</p>
            <p><strong>Connected:</strong> {String(host.connected)}</p>

            <p><strong>IPs:</strong> {host.ips?.join(", ") || "N/A"}</p>
            <p><strong>Status:</strong> {host.connected ? "🟢 Connected" : "🔴 Offline"}</p>

            {host.services && (
              <>
                <h3>Services</h3>
                <ul className="service-list">
                  {Object.entries(host.services).map(([svc, obj]) => {
                    const inputKey = `${host.hostname}-${svc}`;
                    return (
                      <li key={svc} className="service-entry">
                        <strong>{svc}</strong>: {obj.running ? "🟢 Running" : "⚪ Stopped"}
                        <p>
                          URL: <input
                            type="text"
                            value={editedUrls[inputKey] ?? obj.url ?? ""}
                            onChange={(e) => setEditedUrls(prev => ({ ...prev, [inputKey]: e.target.value }))}
                            onBlur={(e) => handleEdit(host, svc, "url", e.target.value)}
                          />
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </>
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