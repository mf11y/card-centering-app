import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), "card-api"))

from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from app.services.inference import run_inference_service, decode_image
from app.services.warp import warp_from_corners

import io
import cv2
import numpy as np
import json

app = FastAPI(title="Card API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.post("/api/infer-json")
async def infer_json(file: UploadFile = File(...)):
    contents = await file.read()
    result = run_inference_service(contents)

    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))

    return {
        "ok": True,
        "corners": result["corners"],
        "refine_score": result.get("refine_score"),
    }

@app.post("/api/infer-image")
async def infer_image(file: UploadFile = File(...)):
    contents = await file.read()
    result = run_inference_service(contents)

    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))

    debug_img = result["debug_img"]

    if debug_img is None:
        raise HTTPException(status_code=500, detail="debug_img is None")

    if not isinstance(debug_img, np.ndarray):
        raise HTTPException(status_code=500, detail=f"debug_img is not ndarray: {type(debug_img)}")

    if debug_img.dtype != np.uint8:
        debug_img = np.clip(debug_img, 0, 255).astype(np.uint8)

    ok, encoded = cv2.imencode(".jpg", debug_img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode debug image")

    return StreamingResponse(
        io.BytesIO(encoded.tobytes()),
        media_type="image/jpeg",
    )

@app.post("/api/warp")
async def warp(file: UploadFile = File(...)):
    contents = await file.read()
    result = run_inference_service(contents)

    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Unknown error"))

    warped = result["warped_img"]

    if warped is None:
        raise HTTPException(status_code=500, detail="warped_img is None")

    if not isinstance(warped, np.ndarray):
        raise HTTPException(status_code=500, detail=f"warped_img is not ndarray: {type(warped)}")

    if warped.dtype != np.uint8:
        warped = np.clip(warped, 0, 255).astype(np.uint8)

    ok, encoded = cv2.imencode(".jpg", warped, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode warped image")

    return StreamingResponse(
        io.BytesIO(encoded.tobytes()),
        media_type="image/jpeg",
    )

@app.post("/api/warp-from-corners")
async def warp_from_corners_endpoint(
    file: UploadFile = File(...),
    corners_json: str = Form(...),
):
    contents = await file.read()
    img = decode_image(contents)

    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image")

    try:
        corners = json.loads(corners_json)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid corners_json: {str(e)}")

    try:
        warped = warp_from_corners(img, corners)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Warp failed: {str(e)}")

    if warped is None:
        raise HTTPException(status_code=500, detail="Warp returned None")

    if not isinstance(warped, np.ndarray):
        raise HTTPException(status_code=500, detail=f"warped is not ndarray: {type(warped)}")

    if warped.dtype != np.uint8:
        warped = np.clip(warped, 0, 255).astype(np.uint8)

    ok, encoded = cv2.imencode(".jpg", warped, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode warped image")

    return StreamingResponse(
        io.BytesIO(encoded.tobytes()),
        media_type="image/jpeg",
    )