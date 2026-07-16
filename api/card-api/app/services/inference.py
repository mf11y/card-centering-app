import cv2
import numpy as np
from app.services.segmentation import get_segmentation_mask

# Legacy server-side geometry pipeline. Quadrilateral fitting and warping now
# happen in the browser from the returned segmentation mask.
# from app.services.pipeline import run_pipeline


def decode_image(image_bytes: bytes):
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


# def run_inference_service(image_bytes: bytes, make_debug: bool = False):
#     img = decode_image(image_bytes)
#     if img is None:
#         return {"ok": False, "error": "Could not decode image"}
#
#     result = run_pipeline(img, make_debug=make_debug)
#     return result


def run_segmentation_service(image_bytes: bytes):
    img = decode_image(image_bytes)
    if img is None:
        return {"ok": False, "error": "Could not decode image"}

    mask = get_segmentation_mask(img)
    if mask is None:
        return {"ok": False, "error": "No mask returned"}

    return {"ok": True, "mask": mask}
