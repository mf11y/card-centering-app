import cv2
import numpy as np


def order_points(pts: np.ndarray) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float32)

    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)

    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(diff)]
    bl = pts[np.argmax(diff)]

    return np.array([tl, tr, br, bl], dtype=np.float32)


def expand_quad(pts: np.ndarray, scale: float = 1.02) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float32)
    center = pts.mean(axis=0, keepdims=True)
    return (center + (pts - center) * scale).astype(np.float32)


def keep_large_components(mask: np.ndarray, min_area: int = 400, keep_n: int = 1) -> np.ndarray:
    mask = (mask > 0).astype(np.uint8) * 255

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if num_labels <= 1:
        return mask

    comps = []
    for label in range(1, num_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area >= min_area:
            comps.append((area, label))

    if not comps:
        return np.zeros_like(mask)

    comps.sort(reverse=True)
    keep_labels = {label for _, label in comps[:keep_n]}

    out = np.zeros_like(mask)
    for label in keep_labels:
        out[labels == label] = 255

    return out


def line_from_points_fitline(points: np.ndarray):
    """
    Fit an infinite line using cv2.fitLine.
    Returns point p and direction v.
    """
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    if len(pts) < 2:
        return None, None

    vx, vy, x0, y0 = cv2.fitLine(pts, cv2.DIST_L2, 0, 0.01, 0.01).reshape(-1)
    v = np.array([vx, vy], dtype=np.float32)
    p = np.array([x0, y0], dtype=np.float32)

    n = np.linalg.norm(v)
    if n < 1e-6:
        return None, None

    v = v / n
    return p, v


def intersect_lines(p1: np.ndarray, v1: np.ndarray, p2: np.ndarray, v2: np.ndarray):
    """
    Intersect 2 infinite lines:
      L1 = p1 + t*v1
      L2 = p2 + s*v2
    Returns point or None if nearly parallel.
    """
    A = np.array([
        [v1[0], -v2[0]],
        [v1[1], -v2[1]]
    ], dtype=np.float32)

    b = (p2 - p1).astype(np.float32)

    det = np.linalg.det(A)
    if abs(det) < 1e-6:
        return None

    t_s = np.linalg.solve(A, b)
    t = t_s[0]

    pt = p1 + t * v1
    return pt.astype(np.float32)


def resample_contour_by_arclength(points: np.ndarray, n_samples: int = 200) -> np.ndarray:
    """
    Resample closed contour/hull points to roughly even spacing.
    points: Nx2
    """
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 2)
    if len(pts) < 4:
        return pts

    closed = np.vstack([pts, pts[0]])
    seglens = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    total = seglens.sum()

    if total < 1e-6:
        return pts

    cumulative = np.concatenate([[0], np.cumsum(seglens)])
    sample_d = np.linspace(0, total, n_samples, endpoint=False)

    out = []
    j = 0
    for d in sample_d:
        while j < len(seglens) - 1 and cumulative[j + 1] < d:
            j += 1

        seg_len = seglens[j]
        if seg_len < 1e-6:
            out.append(closed[j].copy())
            continue

        t = (d - cumulative[j]) / seg_len
        p = closed[j] * (1 - t) + closed[j + 1] * t
        out.append(p)

    return np.asarray(out, dtype=np.float32)


def split_hull_into_four_sides(hull_pts: np.ndarray):
    """
    Split convex hull points into 4 contiguous side groups using the
    4 extreme support points in TL, TR, BR, BL directions.
    """
    pts = np.asarray(hull_pts, dtype=np.float32).reshape(-1, 2)
    if len(pts) < 8:
        return None

    s = pts[:, 0] + pts[:, 1]
    d = pts[:, 0] - pts[:, 1]

    i_tl = int(np.argmin(s))
    i_br = int(np.argmax(s))
    i_tr = int(np.argmax(d))
    i_bl = int(np.argmin(d))

    def arc_points(i0, i1):
        if i0 <= i1:
            return pts[i0:i1 + 1]
        return np.vstack([pts[i0:], pts[:i1 + 1]])

    top = arc_points(i_tl, i_tr)
    right = arc_points(i_tr, i_br)
    bottom = arc_points(i_br, i_bl)
    left = arc_points(i_bl, i_tl)

    return top, right, bottom, left


def fit_quad_from_hull_lines(hull_pts: np.ndarray):
    """
    Fit 4 lines to 4 hull side groups and intersect them.
    Returns warped quad or None.
    """
    groups = split_hull_into_four_sides(hull_pts)
    if groups is None:
        return None

    lines = []
    for grp in groups:
        if grp is None or len(grp) < 2:
            return None
        p, v = line_from_points_fitline(grp)
        if p is None:
            return None
        lines.append((p, v))

    top_p, top_v = lines[0]
    right_p, right_v = lines[1]
    bot_p, bot_v = lines[2]
    left_p, left_v = lines[3]

    tl = intersect_lines(top_p, top_v, left_p, left_v)
    tr = intersect_lines(top_p, top_v, right_p, right_v)
    br = intersect_lines(bot_p, bot_v, right_p, right_v)
    bl = intersect_lines(bot_p, bot_v, left_p, left_v)

    if any(x is None for x in [tl, tr, br, bl]):
        return None

    quad = np.array([tl, tr, br, bl], dtype=np.float32)
    return order_points(quad)


def mask_to_best_fit_quad(mask: np.ndarray, expand: float = 1.005):
    if mask is None:
        return None

    mask = mask.astype(np.uint8)
    if mask.max() <= 1:
        mask = mask * 255

    # keep dominant blob only
    mask = keep_large_components(mask, min_area=400, keep_n=1)

    # remove tiny whiskers / specks
    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_OPEN,
        np.ones((3, 3), np.uint8),
        iterations=1
    )

    # smooth slightly
    mask = cv2.GaussianBlur(mask, (5, 5), 0)
    _, mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)

    # small close helps bridge tiny gaps in the contour
    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_CLOSE,
        np.ones((3, 3), np.uint8),
        iterations=1
    )

    # keep main blob again after cleanup
    mask = keep_large_components(mask, min_area=400, keep_n=1)

    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts:
        return None

    cnt = max(cnts, key=cv2.contourArea)
    area = cv2.contourArea(cnt)
    if area < 200:
        return None

    # use convex hull so missing corner bites do not pull the fit inward
    hull = cv2.convexHull(cnt)
    hull_pts = hull.reshape(-1, 2).astype(np.float32)

    # resample for smoother / more stable side fitting
    hull_pts = resample_contour_by_arclength(hull_pts, n_samples=200)

    quad = fit_quad_from_hull_lines(hull_pts)

    # fallback: try hull approx as a true warped quad
    if quad is None:
        hull_i = hull_pts.reshape(-1, 1, 2).astype(np.float32)
        peri = cv2.arcLength(hull_i, True)
        for eps_scale in [0.005, 0.008, 0.01, 0.015, 0.02, 0.03]:
            approx = cv2.approxPolyDP(hull_i, eps_scale * peri, True)
            if len(approx) == 4:
                quad = approx.reshape(4, 2).astype(np.float32)
                quad = order_points(quad)
                break

    # final fallback: rotated rectangle
    if quad is None:
        rect = cv2.minAreaRect(cnt)
        quad = cv2.boxPoints(rect).astype(np.float32)
        quad = order_points(quad)

    quad = expand_quad(quad, scale=expand)
    return quad.astype(np.float32)


def quad_to_mask(quad: np.ndarray, image_shape) -> np.ndarray:
    h, w = image_shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    if quad is None:
        return mask

    pts = np.round(np.asarray(quad, dtype=np.float32)).astype(np.int32).reshape(-1, 1, 2)
    cv2.fillPoly(mask, [pts], 255)
    return mask


def score_candidate_quad(
    seg_mask: np.ndarray,
    quad: np.ndarray,
    image_shape,
    w_inter: float = 1.0,
    w_fp: float = 0.70,
    w_fn: float = 0.30,
) -> float:
    """
    Higher is better.
    """
    cand_mask = quad_to_mask(quad, image_shape)

    seg = seg_mask > 0
    cand = cand_mask > 0

    inter = np.logical_and(seg, cand).sum()
    cand_area = cand.sum()
    seg_area = seg.sum()

    score = ((w_inter + w_fp + w_fn) * inter) - (w_fp * cand_area) - (w_fn * seg_area)
    return float(score)


def clamp_quad(quad: np.ndarray, image_shape) -> np.ndarray:
    h, w = image_shape[:2]
    q = np.asarray(quad, dtype=np.float32).copy()
    q[:, 0] = np.clip(q[:, 0], 0, w - 1)
    q[:, 1] = np.clip(q[:, 1], 0, h - 1)
    return q


def perturb_quad(quad: np.ndarray, dxdy: np.ndarray) -> np.ndarray:
    q = np.asarray(quad, dtype=np.float32).copy()
    q += np.asarray(dxdy, dtype=np.float32)
    return order_points(q)


def refine_quad_local_search(
    seg_mask: np.ndarray,
    init_quad: np.ndarray,
    image_shape,
    steps=(10, 5, 2, 1),
    tries_per_step: int = 250,
    center_jitter_frac: float = 0.10,
    random_seed: int = 42,
):
    """
    Refine an initial quad by random local search against the segmentation mask.
    Uses a downscaled mask for speed, then scales the quad back up.
    """
    rng = np.random.default_rng(random_seed)

    h, w = seg_mask.shape[:2]

    # choose a smaller working size for refinement
    max_dim = 900
    scale = min(1.0, max_dim / max(h, w))

    if scale < 1.0:
        small_w = max(1, int(round(w * scale)))
        small_h = max(1, int(round(h * scale)))
        work_mask = cv2.resize(seg_mask, (small_w, small_h), interpolation=cv2.INTER_NEAREST)
        work_shape = (small_h, small_w)

        quad0 = np.asarray(init_quad, dtype=np.float32).copy()
        quad0[:, 0] *= scale
        quad0[:, 1] *= scale
    else:
        work_mask = seg_mask
        work_shape = image_shape
        quad0 = np.asarray(init_quad, dtype=np.float32).copy()

    best_quad = order_points(quad0)
    best_quad = clamp_quad(best_quad, work_shape)
    best_score = score_candidate_quad(work_mask, best_quad, work_shape)

    # optionally scale step sizes too so they behave similarly across resolutions
    scaled_steps = tuple(max(1, int(round(step * scale))) for step in steps) if scale < 1.0 else steps

    for step in scaled_steps:
        for _ in range(tries_per_step):
            delta = rng.integers(-step, step + 1, size=(4, 2)).astype(np.float32)
            cand = perturb_quad(best_quad, delta)

            if center_jitter_frac > 0:
                center_shift = rng.normal(
                    0,
                    step * center_jitter_frac,
                    size=(1, 2)
                ).astype(np.float32)
                cand = cand + center_shift

            cand = clamp_quad(cand, work_shape)
            cand = order_points(cand)

            area = cv2.contourArea(cand.astype(np.float32))
            if area < 200 * (scale ** 2 if scale < 1.0 else 1.0):
                continue

            score = score_candidate_quad(work_mask, cand, work_shape)

            if score > best_score:
                best_score = score
                best_quad = cand

    if scale < 1.0:
        best_quad = best_quad.copy()
        best_quad[:, 0] /= scale
        best_quad[:, 1] /= scale
        best_quad = clamp_quad(best_quad, image_shape)
        best_quad = order_points(best_quad)

    return best_quad, best_score


def overlay_mask(image: np.ndarray, mask: np.ndarray, color=(0, 255, 0), alpha: float = 0.28) -> np.ndarray:
    out = image.copy()

    if mask is None:
        return out

    # ensure uint8
    if out.dtype != np.uint8:
        out = np.clip(out, 0, 255).astype(np.uint8)

    mask_u8 = (mask > 0).astype(np.uint8) * 255

    overlay = out.copy()
    overlay[mask_u8 > 0] = color

    blended = cv2.addWeighted(overlay, alpha, out, 1.0 - alpha, 0)
    out[mask_u8 > 0] = blended[mask_u8 > 0]

    return out


def draw_quad(image: np.ndarray, quad: np.ndarray, color=(255, 0, 0), radius: int = 6) -> np.ndarray:
    out = image.copy()

    if out.dtype != np.uint8:
        out = np.clip(out, 0, 255).astype(np.uint8)

    if quad is None:
        return out

    pts = np.round(np.asarray(quad, dtype=np.float32)).astype(np.int32).reshape((-1, 1, 2))
    cv2.polylines(out, [pts], True, color, 2, cv2.LINE_AA)

    for i, (x, y) in enumerate(np.round(quad).astype(np.int32)):
        cv2.circle(out, (int(x), int(y)), radius, (0, 0, 255), -1)
        cv2.putText(
            out,
            str(i),
            (int(x) + 8, int(y) - 8),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 0, 255),
            2,
            cv2.LINE_AA
        )

    return out