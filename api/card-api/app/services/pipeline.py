from app.services.segmentation import get_segmentation_mask
from app.services.geometry import (
    mask_to_best_fit_quad,
    refine_quad_local_search,
    draw_quad,
    overlay_mask,
)
from app.services.warp import four_point_warp


def run_pipeline(img):
    mask = get_segmentation_mask(img)
    if mask is None:
        return {"ok": False, "error": "No mask returned"}

    quad = mask_to_best_fit_quad(mask)
    if quad is None:
        return {"ok": False, "error": "Could not fit quad"}

    # optional refinement step
    quad_refined, refine_score = refine_quad_local_search(
        seg_mask=mask,
        init_quad=quad,
        image_shape=img.shape,
        steps=(10, 5, 2, 1),
        tries_per_step=250,
        center_jitter_frac=0.10,
        random_seed=42,
    )

    warped = four_point_warp(img, quad_refined)

    debug_img = overlay_mask(img.copy(), mask, color=(0, 255, 0), alpha=0.25)
    debug_img = draw_quad(debug_img, quad_refined)

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