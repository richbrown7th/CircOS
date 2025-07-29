import uvicorn
import socket
import threading
import time
import platform
import requests
import json
import os
import subprocess
import psutil
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from zeroconf import Zeroconf, ServiceInfo, ServiceBrowser, ServiceListener
from backend import circ_core, upload_handler, wol, log_writer, settings

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

zeroconf = Zeroconf()
start_time = time.time()

HELPER_PORT = 8800
helper_ips = set()

SERVICES_FILE = os.path.join(os.path.dirname(__file__), "services.json")
services = {}

recent_starts = {}  # name -> { pid: timestamp }

def load_services():
    global services
    if os.path.exists(SERVICES_FILE):
        with open(SERVICES_FILE, "r") as f:
            services = json.load(f)
    else:
        services = {
            "demo-app": {
                "url": "/Applications/vkcube.app/Contents/MacOS/vkCube",
                "singleton": True
            }
        }
        save_services()

    changed = False
    for name, conf in services.items():
        if "url" not in conf:
            services[name]["url"] = ""
            changed = True
        if "singleton" not in conf:
            services[name]["singleton"] = True
            changed = True
    if changed:
        save_services()

def save_services():
    with open(SERVICES_FILE, "w") as f:
        json.dump(services, f, indent=2)

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

class HelperListener(ServiceListener):
    def add_service(self, zeroconf, type_, name):
        info = zeroconf.get_service_info(type_, name)
        if info:
            for addr in info.addresses:
                ip = socket.inet_ntoa(addr)
                helper_ips.add(ip)
                print(f"[mDNS] Helper discovered: {ip}:{info.port}")

    def remove_service(self, zeroconf, type_, name):
        pass

    def update_service(self, zeroconf, type_, name):
        pass

def discover_helpers():
    try:
        ServiceBrowser(zeroconf, "_circos-helper._tcp.local.", HelperListener())
        print("[mDNS] Watching for helpers via _circos-helper._tcp")
    except Exception as e:
        print("[mDNS] Helper discovery failed:", e)

def notify_helpers(event: str):
    path = f"/notify-{event}"
    ip = get_local_ip()
    if ip.startswith("127.") or ip == "::1":
        print(f"[notify] Skipping notification with loopback IP: {ip}")
        return
    data = {
        "ip": ip,
        "name": socket.gethostname(),
        "port": 9000
    }
    notified = set()
    for helper_ip in helper_ips:
        try:
            url = f"http://{helper_ip}:{HELPER_PORT}{path}"
            res = requests.post(url, json=data, timeout=1)
            print(f"[notify] {event} → {helper_ip} → {res.status_code}")
            notified.add(helper_ip)
        except Exception as e:
            print(f"[notify] Failed to notify helper {helper_ip}: {e}")
    fallback_ip = ip.rsplit(".", 1)[0] + ".1"
    if fallback_ip not in notified and not fallback_ip.startswith("127."):
        try:
            url = f"http://{fallback_ip}:{HELPER_PORT}{path}"
            res = requests.post(url, json=data, timeout=1)
            print(f"[notify] Fallback → {fallback_ip} → {res.status_code}")
        except Exception as e:
            print(f"[notify] Fallback failed: {e}")

def register_mdns_service():
    try:
        result = subprocess.run(["scutil", "--get", "LocalHostName"], capture_output=True, text=True)
        local_host = result.stdout.strip() if result.returncode == 0 else socket.gethostname()
        fqdn = f"{local_host}.local."
        ip = get_local_ip()
        info = ServiceInfo(
            "_circos._tcp.local.",
            f"{local_host}._circos._tcp.local.",
            addresses=[socket.inet_aton(ip)],
            port=9000,
            properties={},
            server=fqdn
        )
        zeroconf.register_service(info)
        print(f"[mDNS] Registered _circos._tcp as {fqdn} on {ip}:9000")
    except Exception as e:
        print("[mDNS] Registration failed:", e)

def start_all_services():
    for name, conf in services.items():
        url = conf.get("url")
        singleton = conf.get("singleton", True)
        if not url:
            continue
        if singleton:
            found = False
            for p in psutil.process_iter(["cmdline"]):
                cmdline = p.info.get("cmdline") or []
                if url in " ".join(cmdline):
                    found = True
                    break
            if found:
                continue
        print(f"[startup] Launching service {name}: {url}")
        try:
            proc = subprocess.Popen(url, shell=True)
            pid = proc.pid
            ts = time.time()
            recent_starts.setdefault(name, {})[pid] = ts
        except Exception as e:
            print(f"[startup] Failed to launch {name}: {e}")

@app.on_event("startup")
async def start_monitor():
    discover_helpers()
    threading.Thread(target=register_mdns_service, daemon=True).start()
    load_services()
    start_all_services()
    circ_core.load_config()
    circ_core.start_monitoring()
    notify_helpers("startup")
    threading.Thread(target=monitor_services, daemon=True).start()

def monitor_services(interval=5):
    print(f"[monitor] Starting service monitor loop (every {interval}s)")
    while True:
        load_services()
        for name, conf in services.items():
            url = conf.get("url", "")
            singleton = conf.get("singleton", True)
            auto_restart = conf.get("auto_restart", True)
            mode = conf.get("mode", "auto")

            if not url:
                continue

            running_pids = []
            for p in psutil.process_iter(["pid", "cmdline"]):
                cmdline = p.info.get("cmdline") or []
                if url in " ".join(cmdline):
                    running_pids.append(p)

            if mode == "stopped" and running_pids:
                for p in running_pids:
                    try:
                        print(f"[monitor] Stopping service '{name}' (pid {p.pid}) due to mode=stopped")
                        p.terminate()
                    except Exception as e:
                        print(f"[monitor] Failed to stop pid {p.pid}: {e}")
                continue

            if not running_pids and mode != "stopped" and auto_restart:
                print(f"[monitor] Detected stopped service '{name}'")
                notify_helpers("startup")
                print(f"[monitor] Restarting service '{name}'")
                try:
                    proc = subprocess.Popen(url, shell=True)
                    pid = proc.pid
                    ts = time.time()
                    recent_starts.setdefault(name, {})[pid] = ts
                    time.sleep(0.5)
                    notify_helpers("startup")
                except Exception as e:
                    print(f"[monitor] Failed to restart {name}: {e}")
        time.sleep(interval)

@app.get("/services")
def get_services():
    load_services()
    result = {}
    for name, conf in services.items():
        url = conf.get("url", "")
        pids = []
        last_started = {}
        for p in psutil.process_iter(["pid", "cmdline"]):
            cmdline = p.info.get("cmdline") or []
            if url in " ".join(cmdline):
                pid = p.info["pid"]
                pids.append(pid)
                ts = recent_starts.get(name, {}).get(pid)
                if ts:
                    last_started[pid] = datetime.utcfromtimestamp(ts).isoformat() + "Z"

        result[name] = {
            "url": url,
            "singleton": conf.get("singleton", True),
            "running": len(pids) > 0,
            "pids": pids,
            "lastStarted": last_started,
            "mode": conf.get("mode", "auto")
        }
    return result

@app.get("/ping")
def ping():
    return {"status": "ok"}

@app.post("/services")
async def update_service(request: Request):
    data = await request.json()
    name = data.get("name")
    field_updates = {k: v for k, v in data.items() if k != "name"}

    if not name or name not in services:
        return {"error": "Invalid service name"}

    updated = False
    for field, value in field_updates.items():
        if services[name].get(field) != value:
            services[name][field] = value
            updated = True

    if updated:
        print(f"[update] {request.client.host} updated {name}: {field_updates}")
        save_services()

        url = services[name].get("url")
        if "mode" in field_updates and field_updates["mode"] == "stopped" and url:
            import os
            killed = False
            for p in psutil.process_iter(["pid", "cmdline", "exe"]):
                try:
                    cmdline = p.info.get("cmdline") or []
                    exe_path = p.info.get("exe") or ""
                    cmdline_str = " ".join(cmdline)

                    if url in cmdline_str or url in exe_path or os.path.basename(url) in cmdline_str:
                        print(f"[mode=stopped] Killing {name} pid {p.pid}")
                        p.terminate()
                        killed = True
                except Exception as e:
                    print(f"[mode=stopped] Failed to inspect or kill pid {p.pid}: {e}")

            if not killed:
                print(f"[mode=stopped] No matching process found for {name} with URL: {url}")

        notify_helpers("startup")

    return {"success": True}
            