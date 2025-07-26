import uvicorn
import socket
import threading
import time
import platform
import requests

from fastapi import FastAPI, Request
from zeroconf import Zeroconf, ServiceInfo, ServiceBrowser, ServiceListener
from backend import circ_core, upload_handler, wol, log_writer, settings

app = FastAPI()
zeroconf = Zeroconf()
start_time = time.time()

HELPER_PORT = 8800
helper_ips = set()  # Will include discovered helper nodes


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
        # Optional: handle when helper disappears
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

    # Fallback to x.x.x.1 only if current IP is routable
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
        # Use scutil to get the current Bonjour hostname (.local)
        import subprocess
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


@app.on_event("startup")
async def start_monitor():
    discover_helpers()
    threading.Thread(target=register_mdns_service, daemon=True).start()
    circ_core.load_config()
    circ_core.start_monitoring()
    notify_helpers("startup")


@app.on_event("shutdown")
async def stop_monitor():
    notify_helpers("shutdown")
    try:
        zeroconf.unregister_all_services()
        zeroconf.close()
        print("[mDNS] Service unregistered")
    except Exception as e:
        print("[mDNS] Shutdown error:", e)


@app.get("/status")
def get_status():
    return circ_core.get_status()


@app.get("/ping")
def ping(request: Request):
    try:
        hostname = socket.gethostname()
        ip = get_local_ip()
        remote_ip = request.client.host
        if remote_ip and remote_ip not in ("127.0.0.1", "::1"):
            helper_ips.add(remote_ip)
        return {
            "status": "pong",
            "hostname": hostname,
            "ip": ip,
            "port": 9000,
            "os": f"{platform.system()} {platform.release()}",
            "uptime": int(time.time() - start_time),
            "version": "v1.3.0"
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }


@app.post("/start")
def start_service(name: str):
    return circ_core.start_service(name)


@app.post("/stop")
def stop_service(name: str):
    return circ_core.stop_service(name)


@app.get("/logs")
def get_logs():
    return log_writer.read_logs()


@app.post("/upload")
def upload_binary(file: bytes = None):
    return upload_handler.handle_upload(file)


@app.post("/wol")
def send_wol(mac: str):
    return wol.send_wol_packet(mac)


if __name__ == "__main__":
    uvicorn.run("backend.rest_api:app", host="0.0.0.0", port=9000, reload=True)