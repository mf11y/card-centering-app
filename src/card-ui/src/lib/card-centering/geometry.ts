/**
 * Core quadrilateral and projective-geometry utilities used by card detection and warping.
 *
 * The helpers normalize corner order, size the corrected card image, solve and manipulate 3×3
 * homographies, project points between coordinate spaces, and provide common point measurements.
 */
export type Point = { x: number; y: number };

export type Matrix3x3 = [
	[number, number, number],
	[number, number, number],
	[number, number, number]
];

export type Quad = [Point, Point, Point, Point];

/**
 * Computes the Euclidean distance between two points.
 *
 * @param a - First point.
 * @param b - Second point.
 * @returns Straight-line distance from `a` to `b`.
 */
export function distance(a: Point, b: Point) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Normalizes four corners to top-left, top-right, bottom-right, bottom-left order.
 *
 * @param corners - Four unordered quadrilateral points.
 * @returns A new tuple in the corner order expected by warp and UI code.
 */
export function orderCorners(corners: Quad): Quad {
    // compute center
    const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
    const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;

    // sort by angle around center
    const sorted = [...corners].sort((a, b) => {
        const angleA = Math.atan2(a.y - cy, a.x - cx);
        const angleB = Math.atan2(b.y - cy, b.x - cx);
        return angleA - angleB;
    });
    
    // fix orientation (ensure TL is actually top-left)
    const byY = [...sorted].sort((a, b) => a.y - b.y);
    const top = byY.slice(0, 2);
    const bottom = byY.slice(2, 4);

    const [topLeft, topRight] = top.sort((a, b) => a.x - b.x);
    const [bottomLeft, bottomRight] = bottom.sort((a, b) => a.x - b.x);

    return [topLeft, topRight, bottomRight, bottomLeft];
}

/**
 * Ensures a corner tuple has the expected clockwise orientation while retaining its first point.
 *
 * @param corners - Quad expected to begin at its top-left corner.
 * @returns The original tuple or a tuple with its traversal direction reversed.
 */
export function ensureClockwise(corners: Quad): Quad {
    const [tl, tr, br, bl] = corners;

    const cross = (tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x);

    // if cross < 0 → points are flipped → fix it
    if (cross < 0) {
        return [tl, bl, br, tr]; // swap orientation
    }

    return corners;
}

/**
 * Chooses corrected-image dimensions that preserve detected size while enforcing a target aspect.
 *
 * Opposing side lengths are averaged, then the shorter output dimension is expanded as needed so
 * no detected card area is cropped. Invalid measurements fall back to 360×504.
 *
 * @param tl - Top-left source corner.
 * @param tr - Top-right source corner.
 * @param br - Bottom-right source corner.
 * @param bl - Bottom-left source corner.
 * @param targetAspect - Desired width-to-height ratio; defaults to a standard card ratio.
 * @returns Positive integer output width and height.
 */
export function computeWarpOutputSize(
    tl: Point,
    tr: Point,
    br: Point,
    bl: Point,
    targetAspect = 63 / 88
): { width: number; height: number } {
    const widthTop = distance(tl, tr);
    const widthBottom = distance(bl, br);
    const heightLeft = distance(tl, bl);
    const heightRight = distance(tr, br);

    const width = (widthTop + widthBottom) / 2;
    const height = (heightLeft + heightRight) / 2;

    let outW = width;
    let outH = height;

    const currentAspect = width / height;

    if (!Number.isFinite(currentAspect) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return { width: 360, height: 504 };
    }

    if (currentAspect > targetAspect) {
        outH = outW / targetAspect;
    } else {
        outW = outH * targetAspect;
    }

    const safeWidth = Math.max(1, Math.round(outW));
    const safeHeight = Math.max(1, Math.round(outH));

    return {
        width: safeWidth,
        height: safeHeight
    };
}

/**
 * Solves an eight-variable linear system with Gauss-Jordan elimination and partial pivoting.
 *
 * @param A - 8×8 coefficient matrix.
 * @param b - Eight-value result vector.
 * @returns The eight solved variables.
 * @throws If the coefficient matrix is singular or numerically unstable.
 */
function solveLinearSystem8x8(A: number[][], b: number[]) {
    const n = 8;
    const M = A.map((row, i) => [...row, b[i]]);

    for (let col = 0; col < n; col++) {
        let pivotRow = col;
        let maxAbs = Math.abs(M[col][col]);

        for (let r = col + 1; r < n; r++) {
            const v = Math.abs(M[r][col]);
            if (v > maxAbs) {
                maxAbs = v;
                pivotRow = r;
            }
        }

        if (maxAbs < 1e-12) {
            throw new Error('Homography solve failed: singular matrix');
        }

        if (pivotRow !== col) {
            [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
        }

        const pivot = M[col][col];
        for (let c = col; c <= n; c++) {
            M[col][c] /= pivot;
        }

        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const factor = M[r][col];
            for (let c = col; c <= n; c++) {
                M[r][c] -= factor * M[col][c];
            }
        }
    }

    return M.map((row) => row[n]);
}

/**
 * Computes the projective transformation that maps one quadrilateral onto another.
 *
 * The last homography coefficient is fixed to one, leaving eight coefficients solved from the
 * four source/destination point pairs.
 *
 * @param src - Source points in matching corner order.
 * @param dst - Destination points in matching corner order.
 * @returns A 3×3 homography mapping source coordinates to destination coordinates.
 * @throws If the point configuration produces a singular system.
 */
export function computeHomography(
	src: Quad,
	dst: Quad
): Matrix3x3 {
    const A: number[][] = [];
    const b: number[] = [];

    for (let i = 0; i < 4; i++) {
        const { x, y } = src[i];
        const { x: u, y: v } = dst[i];

        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
        b.push(u);

        A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
        b.push(v);
    }

    const [h11, h12, h13, h21, h22, h23, h31, h32] = solveLinearSystem8x8(A, b);

    return [
        [h11, h12, h13],
        [h21, h22, h23],
        [h31, h32, 1]
    ];
}

/**
 * Inverts a 3×3 homography using its adjugate and determinant.
 *
 * @param H - Homography to invert.
 * @returns A matrix mapping in the opposite direction.
 * @throws If the matrix is singular.
 */
export function invertHomography(H: Matrix3x3): Matrix3x3 {
    const [[a, b, c], [d, e, f], [g, h, i]] = H;

    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const D = -(b * i - c * h);
    const E = a * i - c * g;
    const F = -(a * h - b * g);
    const G = b * f - c * e;
    const Hc = -(a * f - c * d);
    const I = a * e - b * d;

    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) {
        throw new Error('Homography invert failed: singular matrix');
    }

    return [
        [A / det, D / det, G / det],
        [B / det, E / det, Hc / det],
        [C / det, F / det, I / det]
    ];
}

/**
 * Projects a Cartesian point through a homography and performs homogeneous normalization.
 *
 * @param H - Transformation matrix to apply.
 * @param x - Input horizontal coordinate.
 * @param y - Input vertical coordinate.
 * @returns The projected Cartesian point, or the origin when normalization is degenerate.
 */
export function applyHomography(H: Matrix3x3, x: number, y: number): Point {
    const denom = H[2][0] * x + H[2][1] * y + H[2][2];
    if (Math.abs(denom) < 1e-12) {
        return { x: 0, y: 0 };
    }

    return {
        x: (H[0][0] * x + H[0][1] * y + H[0][2]) / denom,
        y: (H[1][0] * x + H[1][1] * y + H[1][2]) / denom
    };
}

/**
 * Computes the arithmetic center of four quadrilateral corners.
 *
 * @param corners - Quad whose points should be averaged.
 * @returns Mean x/y position of the four corners.
 */
export function getQuadCenter(corners: Quad) : Point {
	return {
		x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
		y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4
	};
}
