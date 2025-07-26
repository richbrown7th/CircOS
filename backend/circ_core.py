import json
import os
import subprocess
from backend import settings, log_writer

services = {}

def load_config():
    with open("backend/config.json") as f:
        config = json.load(f)
    for app in config.get("applications", []):
        services[app["name"]] = {"command": app["command"], "running": False}

def start_monitoring():
    # Simplified: just mark all services as "monitored"
    for name in services:
        log_writer.log(f"Monitoring {name}")

def get_status():
    return {name: {"running": svc["running"]} for name, svc in services.items()}

def start_service(name):
    svc = services.get(name)
    if svc and not svc["running"]:
        subprocess.Popen(svc["command"], shell=True)
        svc["running"] = True
        log_writer.log(f"Started {name}")
    return {"status": "ok", "running": svc["running"]}

def stop_service(name):
    svc = services.get(name)
    if svc and svc["running"]:
        # Placeholder: stopping would require tracking process IDs
        svc["running"] = False
        log_writer.log(f"Stopped {name}")
    return {"status": "ok", "running": svc["running"]}