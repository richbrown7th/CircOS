import uvicorn
from fastapi import FastAPI
from backend import circ_core, upload_handler, wol, log_writer, settings
from zeroconf import Zeroconf, ServiceInfo
import socket
import threading

app = FastAPI()
zeroconf = Zeroconf()

def register_mdns_service():
    try:
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        info = ServiceInfo(
            "_circos._tcp.local.",
            f"{hostname}._circos._tcp.local.",
            addresses=[socket.inet_aton(ip)],
            port=9000,
            properties={},
            server=f"{hostname}.local."
        )
        zeroconf.register_service(info)
        print(f"[mDNS] Registered _circos._tcp on {ip}:9000")
    except Exception as e:
        print("[mDNS] Registration failed:", e)

@app.on_event("startup")
async def start_monitor():
    circ_core.load_config()
    circ_core.start_monitoring()
    threading.Thread(target=register_mdns_service, daemon=True).start()

@app.on_event("shutdown")
async def stop_monitor():
    zeroconf.unregister_all_services()
    zeroconf.close()
    print("[mDNS] Service unregistered")

@app.get("/status")
def get_status():
    return circ_core.get_status()

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