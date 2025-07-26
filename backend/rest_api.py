import uvicorn
from fastapi import FastAPI
from backend import circ_core, upload_handler, wol, log_writer, settings

app = FastAPI()

@app.on_event("startup")
async def start_monitor():
    circ_core.load_config()
    circ_core.start_monitoring()

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
    uvicorn.run("rest_api:app", host="0.0.0.0", port=9000, reload=True)