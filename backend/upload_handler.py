import os

def handle_upload(file: bytes):
    with open("backend/uploaded_binary.bin", "wb") as f:
        f.write(file)
    return {"status": "uploaded"}