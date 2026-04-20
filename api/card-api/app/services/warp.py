import cv2
import numpy as np


def four_point_warp(image: np.ndarray, pts: np.ndarray, out_w: int = 360, out_h: int = 504) -> np.ndarray:
    """
    Perspective-warp an image from a 4-point quadrilateral to a fixed-size rectangle.

    Expected point order:
      [top-left, top-right, bottom-right, bottom-left]
    """
    pts = np.asarray(pts, dtype=np.float32)

    if pts.shape != (4, 2):
        raise ValueError(f"Expected pts shape (4, 2), got {pts.shape}")

    dst = np.array([
        [0, 0],
        [out_w - 1, 0],
        [out_w - 1, out_h - 1],
        [0, out_h - 1],
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(pts, dst)
    warped = cv2.warpPerspective(image, M, (out_w, out_h))
    return warped


def warp_from_corners(
    image: np.ndarray,
    corners: list[dict],
    out_w: int | None = None,
    out_h: int | None = None,
    pad_frac: float = 0.015,
) -> np.ndarray:
    """
    corners format:
      [
        {"id": "top-left", "x": ..., "y": ...},
        {"id": "top-right", "x": ..., "y": ...},
        {"id": "bottom-right", "x": ..., "y": ...},
        {"id": "bottom-left", "x": ..., "y": ...},
      ]
    """
    id_to_xy = {c["id"]: [c["x"], c["y"]] for c in corners}

    pts = np.array([
        id_to_xy["top-left"],
        id_to_xy["top-right"],
        id_to_xy["bottom-right"],
        id_to_xy["bottom-left"],
    ], dtype=np.float32)

    # expand slightly outward so borders do not get clipped
    center = pts.mean(axis=0)
    expanded = center + (pts - center) * (1.0 + 0)

    width_top = np.linalg.norm(expanded[1] - expanded[0])
    width_bottom = np.linalg.norm(expanded[2] - expanded[3])
    height_left = np.linalg.norm(expanded[3] - expanded[0])
    height_right = np.linalg.norm(expanded[2] - expanded[1])

    natural_h = int(round(max(height_left, height_right)))
    out_h = natural_h
    out_w = int(round(out_h * 5 / 7))

    return four_point_warp(image, expanded, out_w=out_w, out_h=out_h)