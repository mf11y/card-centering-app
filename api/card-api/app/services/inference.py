import cv2
import numpy as np
from app.services.pipeline import run_pipeline


def decode_image(image_bytes: bytes):
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def run_inference_service(image_bytes: bytes):
    img = decode_image(image_bytes)
    if img is None:
        return {"ok": False, "error": "Could not decode image"}

    result = run_pipeline(img)
    return result