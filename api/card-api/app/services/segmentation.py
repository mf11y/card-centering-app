import cv2
import numpy as np
from app.services.model_loader import get_model

IMGSZ = 768
CONF = 0.25


def get_best_segmentation_mask(result, image_shape):
    """
    Extract the highest-confidence segmentation mask and resize to original image.
    Returns uint8 mask (0 or 255) or None.
    """
    if result.boxes is None or len(result.boxes) == 0:
        return None

    if result.masks is None or result.masks.data is None:
        return None

    confs = result.boxes.conf.cpu().numpy()
    idx = int(np.argmax(confs))

    mask = result.masks.data[idx].cpu().numpy()

    # binarize
    mask = (mask > 0.5).astype(np.uint8) * 255

    # resize to original image
    h, w = image_shape[:2]
    mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)

    return mask


def get_segmentation_mask(img):
    model = get_model()

    results = model.predict(
        source=img,
        imgsz=IMGSZ,
        conf=CONF,
        verbose=False,
    )

    if not results:
        return None

    res = results[0]
    mask = get_best_segmentation_mask(res, img.shape)

    if mask is not None:
        cv2.imwrite("debug_best_mask.png", mask)

    return mask

def get_segmentation_result(img):
    """
    Returns raw YOLO result + best mask.
    Useful for debugging and advanced logic.
    """
    model = get_model()

    results = model.predict(
        source=img,
        imgsz=IMGSZ,
        conf=CONF,
        verbose=False,
    )

    if not results:
        return None, None

    res = results[0]
    mask = get_best_segmentation_mask(res, img.shape)

    return res, mask