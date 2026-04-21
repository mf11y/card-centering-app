from app.services.segmentation import get_segmentation_mask
from app.services.geometry import (
    mask_to_best_fit_quad,
    refine_quad_local_search,
    draw_quad,
    overlay_mask,
)
from app.services.warp import four_point_warp


import time

def run_pipeline(img, make_debug: bool = False):
    t0 = time.perf_counter()

    # --- Segmentation ---
    t_start = time.perf_counter()
    mask = get_segmentation_mask(img)
    t_end = time.perf_counter()
    print(f"[TIME] get_segmentation_mask: {(t_end - t_start)*1000:.1f} ms")

    if mask is None:
        return {"ok": False, "error": "No mask returned"}

    # --- Quad fit ---
    t_start = time.perf_counter()
    quad = mask_to_best_fit_quad(mask)
    t_end = time.perf_counter()
    print(f"[TIME] mask_to_best_fit_quad: {(t_end - t_start)*1000:.1f} ms")

    if quad is None:
        return {"ok": False, "error": "Could not fit quad"}

    # --- Refinement ---
    t_start = time.perf_counter()
    quad_refined, refine_score = refine_quad_local_search(
        seg_mask=mask,
        init_quad=quad,
        image_shape=img.shape,
        steps=(10, 5, 2, 1),
        tries_per_step=250,
        center_jitter_frac=0.10,
        random_seed=42,
    )
    t_end = time.perf_counter()
    print(f"[TIME] refine_quad_local_search: {(t_end - t_start)*1000:.1f} ms")

    # --- Warp ---
    t_start = time.perf_counter()
    warped = four_point_warp(img, quad_refined)
    t_end = time.perf_counter()
    print(f"[TIME] four_point_warp: {(t_end - t_start)*1000:.1f} ms")

    # --- Debug overlay ---
    debug_img = None
    if make_debug:
        t_start = time.perf_counter()
        debug_img = overlay_mask(img, mask, color=(0, 255, 0), alpha=0.25)
        debug_img = draw_quad(debug_img, quad_refined)
        t_end = time.perf_counter()
        print(f"[TIME] debug_overlay: {(t_end - t_start)*1000:.1f} ms")

    # --- Total ---
    t_total = time.perf_counter() - t0
    print(f"[TIME] TOTAL PIPELINE: {t_total*1000:.1f} ms")

    return {
        "ok": True,
        "corners": [
            {"id": "top-left", "x": float(quad_refined[0][0]), "y": float(quad_refined[0][1])},
            {"id": "top-right", "x": float(quad_refined[1][0]), "y": float(quad_refined[1][1])},
            {"id": "bottom-right", "x": float(quad_refined[2][0]), "y": float(quad_refined[2][1])},
            {"id": "bottom-left", "x": float(quad_refined[3][0]), "y": float(quad_refined[3][1])},
        ],
        "refine_score": float(refine_score),
        "mask": mask,
        "debug_img": debug_img,
        "warped_img": warped,
    }