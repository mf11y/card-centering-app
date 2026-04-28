import cv2
import numpy as np
from app.services.model_loader import get_model

IMGSZ = 640
CONF = 0.25

def clean_card_mask_by_contour(mask: np.ndarray) -> np.ndarray:
    """
    Keeps the largest external contour and redraws it filled.
    Good when mask has weird loose regions.
    """
    if mask is None:
        return None

    mask_u8 = (mask > 0).astype(np.uint8) * 255

    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return mask_u8

    largest = max(contours, key=cv2.contourArea)

    cleaned = np.zeros_like(mask_u8)
    cv2.drawContours(cleaned, [largest], -1, 255, thickness=cv2.FILLED)

    kernel = np.ones((3, 3), np.uint8)
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel, iterations=1)

    return cleaned

def clean_card_mask(mask: np.ndarray, min_area_frac: float = 0.01) -> np.ndarray:
    """
    Removes small disconnected mask islands and lightly smooths the main card mask.
    Input/output: uint8 mask, 0 or 255.
    """
    if mask is None:
        return None

    mask_u8 = (mask > 0).astype(np.uint8)

    # 1) Remove small disconnected components
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask_u8, connectivity=8)

    if num_labels <= 1:
        return mask

    h, w = mask.shape[:2]
    image_area = h * w
    min_area = image_area * min_area_frac

    # Ignore background label 0
    component_areas = stats[1:, cv2.CC_STAT_AREA]
    largest_idx = 1 + int(np.argmax(component_areas))

    cleaned = np.zeros_like(mask_u8)

    # Keep only largest component
    if stats[largest_idx, cv2.CC_STAT_AREA] >= min_area:
        cleaned[labels == largest_idx] = 1
    else:
        cleaned = mask_u8

    # 2) Smooth tiny rough edges
    kernel = np.ones((3, 3), np.uint8)

    # opening removes tiny protrusions/noise
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_OPEN, kernel, iterations=1)

    # closing fills tiny gaps/holes along border
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel, iterations=1)

    return cleaned.astype(np.uint8) * 255


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
        device=0,
        half=True
    )

    if not results:
        return None

    res = results[0]
    mask = get_best_segmentation_mask(res, img.shape)

    if mask is not None:
        mask = clean_card_mask(mask)
        mask = clean_card_mask_by_contour(mask)
        #cv2.imwrite("debug_best_mask_cleaned.png", mask)

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