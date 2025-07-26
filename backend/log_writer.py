import os
import datetime

LOG_PATH = "backend/circos.log"

def log(message: str):
    timestamp = datetime.datetime.now().isoformat()
    with open(LOG_PATH, "a") as f:
        f.write(f"[{timestamp}] {message}\n")

def read_logs():
    if os.path.exists(LOG_PATH):
        with open(LOG_PATH) as f:
            return {"logs": f.read()}
    return {"logs": ""}