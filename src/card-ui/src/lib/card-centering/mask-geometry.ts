/**
 * Browser-side quadrilateral fitting for segmentation masks.
 *
 * This module decodes a returned mask, extracts and simplifies its boundary, builds an initial
 * four-line fit, and refines the resulting quad against overlap and edge-distance metrics. Public
 * results are rescaled from the bounded working mask to the mask's original pixel coordinates.
 */
import { orderCorners, type Point, type Quad } from './geometry';

type BinaryMask = {
	width: number;
	height: number;
	data: Uint8Array;
	boundaryDistance: Float32Array;
	area: number;
	scaleX: number;
	scaleY: number;
};

export type FittedMaskQuad = {
	quad: Quad;
	score: number;
	metrics: {
		iou: number;
		falsePositiveRate: number;
		falseNegativeRate: number;
		meanEdgeDistance: number;
	};
};

/**
 * Computes the signed 2D cross product of the turns from `o` through `a` and `b`.
 *
 * @param o - Shared origin of the two vectors.
 * @param a - Endpoint of the first vector.
 * @param b - Endpoint of the second vector.
 * @returns Positive/negative values for opposite turn directions, or zero for collinear points.
 */
function cross(o: Point, a: Point, b: Point) {
	return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Builds the counterclockwise convex hull of a point cloud with Andrew's monotone-chain algorithm.
 *
 * @param points - Boundary points to enclose.
 * @returns Hull vertices without repeating the starting point.
 */
function convexHull(points: Point[]) {
	if (points.length <= 4) return points;

	const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
	const lower: Point[] = [];
	const upper: Point[] = [];

	for (const point of sorted) {
		while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
		lower.push(point);
	}

	for (let i = sorted.length - 1; i >= 0; i--) {
		const point = sorted[i];
		while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
		upper.push(point);
	}

	lower.pop();
	upper.pop();
	return [...lower, ...upper];
}

/**
 * Extracts an inclusive, possibly wrapping section of a circular point array.
 *
 * @param points - Circularly ordered points.
 * @param start - Index of the first included point.
 * @param end - Index of the last included point.
 * @returns Points encountered from `start` to `end`, wrapping at the array boundary when needed.
 */
function arc(points: Point[], start: number, end: number) {
	if (start <= end) return points.slice(start, end + 1);
	return [...points.slice(start), ...points.slice(0, end + 1)];
}

/**
 * Fits an infinite least-squares line to a set of points using principal-axis orientation.
 *
 * @param points - Points belonging to one estimated card edge.
 * @returns A point/direction representation of the fitted line, or `null` for fewer than two points.
 */
function fitLine(points: Point[]) {
	if (points.length < 2) return null;

	const center = points.reduce(
		(acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
		{ x: 0, y: 0 }
	);
	center.x /= points.length;
	center.y /= points.length;

	let xx = 0;
	let xy = 0;
	let yy = 0;
	for (const point of points) {
		const dx = point.x - center.x;
		const dy = point.y - center.y;
		xx += dx * dx;
		xy += dx * dy;
		yy += dy * dy;
	}

	const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
	return { point: center, direction: { x: Math.cos(angle), y: Math.sin(angle) } };
}

/**
 * Finds the intersection of two infinite fitted lines.
 *
 * @param a - First line represented by an anchor and unit direction.
 * @param b - Second line represented by an anchor and unit direction.
 * @returns Their intersection point, or `null` when the lines are effectively parallel.
 */
function intersectLines(
	a: NonNullable<ReturnType<typeof fitLine>>,
	b: NonNullable<ReturnType<typeof fitLine>>
) {
	const det = a.direction.x * b.direction.y - a.direction.y * b.direction.x;
	if (Math.abs(det) < 1e-6) return null;

	const dx = b.point.x - a.point.x;
	const dy = b.point.y - a.point.y;
	const t = (dx * b.direction.y - dy * b.direction.x) / det;
	return {
		x: a.point.x + t * a.direction.x,
		y: a.point.y + t * a.direction.y
	};
}

/**
 * Creates a starting quadrilateral by fitting four edge lines to a boundary's convex hull.
 *
 * Extreme hull points divide the perimeter into top, right, bottom, and left arcs. Each arc receives
 * a least-squares line, whose adjacent intersections form the ordered initial corners.
 *
 * @param points - Extracted segmentation-boundary points.
 * @returns An ordered initial quad, or `null` when a stable four-line fit cannot be formed.
 */
function fitInitialQuad(points: Point[]): Quad | null {
	const hull = convexHull(points);
	if (hull.length < 4) return null;

	let tl = 0;
	let tr = 0;
	let br = 0;
	let bl = 0;

	for (let i = 1; i < hull.length; i++) {
		const sum = hull[i].x + hull[i].y;
		const diff = hull[i].x - hull[i].y;
		if (sum < hull[tl].x + hull[tl].y) tl = i;
		if (sum > hull[br].x + hull[br].y) br = i;
		if (diff > hull[tr].x - hull[tr].y) tr = i;
		if (diff < hull[bl].x - hull[bl].y) bl = i;
	}

	const lines = [
		fitLine(arc(hull, tl, tr)),
		fitLine(arc(hull, tr, br)),
		fitLine(arc(hull, br, bl)),
		fitLine(arc(hull, bl, tl))
	];
	if (lines.some((line) => !line)) return null;

	const [top, right, bottom, left] = lines as Array<NonNullable<(typeof lines)[number]>>;
	const corners = [
		intersectLines(top, left),
		intersectLines(top, right),
		intersectLines(bottom, right),
		intersectLines(bottom, left)
	];
	if (corners.some((point) => !point)) return null;

	return orderCorners(corners as Quad);
}

/**
 * Tests whether a point lies inside or on the edge of a convex quadrilateral.
 *
 * @param x - Test-point x coordinate.
 * @param y - Test-point y coordinate.
 * @param quad - Convex quadrilateral to test.
 * @returns `true` when all non-collinear edge tests have the same orientation.
 */
function pointInQuad(x: number, y: number, quad: Quad) {
	let sign = 0;
	for (let i = 0; i < 4; i++) {
		const a = quad[i];
		const b = quad[(i + 1) % 4];
		const value = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
		if (Math.abs(value) < 1e-6) continue;
		const nextSign = Math.sign(value);
		if (sign && nextSign !== sign) return false;
		sign = nextSign;
	}
	return true;
}

/**
 * Computes quadrilateral area with the shoelace formula.
 *
 * @param quad - Ordered quadrilateral vertices.
 * @returns Non-negative area in square pixels.
 */
function polygonArea(quad: Quad) {
	let area = 0;
	for (let i = 0; i < 4; i++) {
		const a = quad[i];
		const b = quad[(i + 1) % 4];
		area += a.x * b.y - b.x * a.y;
	}
	return Math.abs(area) / 2;
}

/**
 * Rejects degenerate, tiny, non-convex, or non-finite quadrilateral candidates.
 *
 * @param quad - Candidate quad to validate.
 * @param width - Working-mask width, used for the minimum-area threshold.
 * @param height - Working-mask height, used for the minimum-area threshold.
 * @returns `true` when the candidate is finite, sufficiently large, convex, and has usable sides.
 */
function isValidQuad(quad: Quad, width: number, height: number) {
	if (quad.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
	if (polygonArea(quad) < Math.max(100, width * height * 0.005)) return false;

	let orientation = 0;
	for (let i = 0; i < 4; i++) {
		const a = quad[i];
		const b = quad[(i + 1) % 4];
		const c = quad[(i + 2) % 4];
		const sideLength = Math.hypot(b.x - a.x, b.y - a.y);
		if (sideLength < 8) return false;

		const turn = cross(a, b, c);
		if (Math.abs(turn) < 1e-3) return false;
		const sign = Math.sign(turn);
		if (orientation && sign !== orientation) return false;
		orientation = sign;
	}

	return true;
}

/**
 * Measures how closely sampled quadrilateral edges follow the nearest mask boundary.
 *
 * @param mask - Binary mask with a precomputed boundary-distance field.
 * @param quad - Candidate quadrilateral whose four edges should be sampled.
 * @returns Mean distance from sampled edge points to the segmentation boundary.
 */
function sampleEdgeDistance(mask: BinaryMask, quad: Quad) {
	let total = 0;
	let samples = 0;

	for (let edge = 0; edge < 4; edge++) {
		const a = quad[edge];
		const b = quad[(edge + 1) % 4];
		const length = Math.hypot(b.x - a.x, b.y - a.y);
		const count = Math.max(2, Math.ceil(length / 2));

		for (let i = 0; i <= count; i++) {
			const t = i / count;
			const x = Math.max(0, Math.min(mask.width - 1, Math.round(a.x + (b.x - a.x) * t)));
			const y = Math.max(0, Math.min(mask.height - 1, Math.round(a.y + (b.y - a.y) * t)));
			total += mask.boundaryDistance[y * mask.width + x];
			samples++;
		}
	}

	return total / Math.max(samples, 1);
}

/**
 * Scores a candidate quadrilateral against mask coverage and boundary alignment.
 *
 * The score rewards intersection-over-union and penalizes candidate spill, missed mask pixels, and
 * distance from the mask boundary. Invalid candidates are excluded before raster evaluation.
 *
 * @param mask - Working binary mask and cached metrics.
 * @param quad - Candidate quad in working-mask coordinates.
 * @returns Composite score and component metrics, or `null` for an invalid candidate.
 */
function evaluateQuad(mask: BinaryMask, quad: Quad) {
	if (!isValidQuad(quad, mask.width, mask.height)) return null;

	const minX = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.x))));
	const maxX = Math.min(mask.width - 1, Math.ceil(Math.max(...quad.map((p) => p.x))));
	const minY = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.y))));
	const maxY = Math.min(mask.height - 1, Math.ceil(Math.max(...quad.map((p) => p.y))));

	let intersection = 0;
	let candidateArea = 0;
	for (let y = minY; y <= maxY; y++) {
		for (let x = minX; x <= maxX; x++) {
			if (!pointInQuad(x + 0.5, y + 0.5, quad)) continue;
			candidateArea++;
			if (mask.data[y * mask.width + x]) intersection++;
		}
	}

	const falsePositive = candidateArea - intersection;
	const falseNegative = mask.area - intersection;
	const union = candidateArea + mask.area - intersection;
	const iou = intersection / Math.max(union, 1);
	const falsePositiveRate = falsePositive / Math.max(candidateArea, 1);
	const falseNegativeRate = falseNegative / Math.max(mask.area, 1);
	const meanEdgeDistance = sampleEdgeDistance(mask, quad);
	const normalizedEdgeDistance = meanEdgeDistance / Math.max(mask.width, mask.height);

	return {
		score:
			iou -
			0.35 * falsePositiveRate -
			0.15 * falseNegativeRate -
			2.5 * normalizedEdgeDistance,
		metrics: { iou, falsePositiveRate, falseNegativeRate, meanEdgeDistance }
	};
}

/**
 * Clamps all quad points to the mask bounds and restores canonical corner order.
 *
 * @param quad - Candidate points that may extend beyond the mask.
 * @param width - Working-mask width.
 * @param height - Working-mask height.
 * @returns Bounded quad ordered top-left through bottom-left.
 */
function clampQuad(quad: Quad, width: number, height: number): Quad {
	return orderCorners(
		quad.map((point) => ({
			x: Math.max(0, Math.min(width - 1, point.x)),
			y: Math.max(0, Math.min(height - 1, point.y))
		})) as Quad
	);
}

/**
 * Improves an initial quad through coarse-to-fine greedy local search.
 *
 * At each step size, candidates move individual corners, translate complete edges along their
 * normals, translate the whole quad, or uniformly expand/shrink it. The best strict improvement is
 * retained until convergence or the per-scale pass limit is reached.
 *
 * @param mask - Working mask used to validate and score candidates.
 * @param initial - Initial quadrilateral estimate.
 * @returns The highest-scoring refined quad with its score and metrics.
 * @throws If the initial quadrilateral is invalid.
 */
function refineQuad(mask: BinaryMask, initial: Quad) {
	let best = clampQuad(initial, mask.width, mask.height);
	let bestEvaluation = evaluateQuad(mask, best);
	if (!bestEvaluation) throw new Error('Initial quadrilateral is invalid');
	const steps = [8, 4, 2, 1];

	for (const step of steps) {
		let improved = true;
		let passes = 0;
		while (improved && passes < 20) {
			improved = false;
			passes++;
			const candidates: Quad[] = [];

			// Move individual corners.
			for (let corner = 0; corner < 4; corner++) {
				for (const [dx, dy] of [
					[-step, 0],
					[step, 0],
					[0, -step],
					[0, step]
				]) {
					const candidate = best.map((point) => ({ ...point })) as Quad;
					candidate[corner].x += dx;
					candidate[corner].y += dy;
					candidates.push(candidate);
				}
			}

			// Move complete edges along their normal, preserving straighter sides.
			for (let edge = 0; edge < 4; edge++) {
				const a = best[edge];
				const b = best[(edge + 1) % 4];
				const length = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
				const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
				for (const direction of [-1, 1]) {
					const candidate = best.map((point) => ({ ...point })) as Quad;
					for (const corner of [edge, (edge + 1) % 4]) {
						candidate[corner].x += normal.x * step * direction;
						candidate[corner].y += normal.y * step * direction;
					}
					candidates.push(candidate);
				}
			}

			// Translate or uniformly expand/shrink the whole quad.
			for (const [dx, dy] of [
				[-step, 0],
				[step, 0],
				[0, -step],
				[0, step]
			]) {
				candidates.push(best.map((point) => ({ x: point.x + dx, y: point.y + dy })) as Quad);
			}
			const center = best.reduce(
				(acc, point) => ({ x: acc.x + point.x / 4, y: acc.y + point.y / 4 }),
				{ x: 0, y: 0 }
			);
			for (const direction of [-1, 1]) {
				const scale = 1 + (direction * step) / Math.max(mask.width, mask.height);
				candidates.push(
					best.map((point) => ({
						x: center.x + (point.x - center.x) * scale,
						y: center.y + (point.y - center.y) * scale
					})) as Quad
				);
			}

			for (const candidate of candidates) {
				const ordered = clampQuad(candidate, mask.width, mask.height);
				const evaluation = evaluateQuad(mask, ordered);
				if (evaluation && evaluation.score > bestEvaluation.score + 1e-7) {
					best = ordered;
					bestEvaluation = evaluation;
					improved = true;
				}
			}
		}
	}

	return { quad: best, ...bestEvaluation };
}

/**
 * Builds an approximate Euclidean distance field from every pixel to the nearest mask boundary.
 *
 * Boundary pixels are seeded at zero, then forward and backward chamfer passes propagate axial
 * and diagonal distances across the image.
 *
 * @param data - Flat binary-mask values in row-major order.
 * @param width - Mask width in pixels.
 * @param height - Mask height in pixels.
 * @returns A row-major distance field aligned with `data`.
 */
function buildBoundaryDistance(data: Uint8Array, width: number, height: number) {
	const distance = new Float32Array(width * height);
	distance.fill(Number.POSITIVE_INFINITY);

	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const index = y * width + x;
			if (
				data[index] &&
				(!data[index - 1] ||
					!data[index + 1] ||
					!data[index - width] ||
					!data[index + width])
			) {
				distance[index] = 0;
			}
		}
	}

	const diagonal = Math.SQRT2;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const index = y * width + x;
			if (x > 0) distance[index] = Math.min(distance[index], distance[index - 1] + 1);
			if (y > 0) distance[index] = Math.min(distance[index], distance[index - width] + 1);
			if (x > 0 && y > 0)
				distance[index] = Math.min(distance[index], distance[index - width - 1] + diagonal);
			if (x + 1 < width && y > 0)
				distance[index] = Math.min(distance[index], distance[index - width + 1] + diagonal);
		}
	}

	for (let y = height - 1; y >= 0; y--) {
		for (let x = width - 1; x >= 0; x--) {
			const index = y * width + x;
			if (x + 1 < width) distance[index] = Math.min(distance[index], distance[index + 1] + 1);
			if (y + 1 < height)
				distance[index] = Math.min(distance[index], distance[index + width] + 1);
			if (x + 1 < width && y + 1 < height)
				distance[index] = Math.min(distance[index], distance[index + width + 1] + diagonal);
			if (x > 0 && y + 1 < height)
				distance[index] = Math.min(distance[index], distance[index + width - 1] + diagonal);
		}
	}

	return distance;
}

/**
 * Decodes and thresholds a mask image into a bounded binary working representation.
 *
 * Large masks are downscaled for predictable browser computation. RGB brightness is thresholded
 * into binary occupancy, area is counted, and a boundary-distance field is cached for scoring.
 *
 * @param maskUrl - Data or remote URL of the segmentation mask image.
 * @param maxDimension - Maximum working width or height before downscaling.
 * @returns Binary mask data, distance field, dimensions, area, and original-coordinate scales.
 * @throws If the image/canvas cannot be decoded or the detected foreground is too small.
 */
async function decodeMask(maskUrl: string, maxDimension = 500): Promise<BinaryMask> {
	const image = new Image();
	await new Promise<void>((resolve, reject) => {
		image.onload = () => resolve();
		image.onerror = () => reject(new Error('Could not decode segmentation mask'));
		image.src = maskUrl;
	});

	const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
	const width = Math.max(1, Math.round(image.naturalWidth * scale));
	const height = Math.max(1, Math.round(image.naturalHeight * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Could not create mask canvas');

	context.drawImage(image, 0, 0, width, height);
	const pixels = context.getImageData(0, 0, width, height).data;
	const data = new Uint8Array(width * height);
	let area = 0;
	for (let i = 0; i < data.length; i++) {
		const offset = i * 4;
		data[i] = pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 382.5 ? 1 : 0;
		area += data[i];
	}
	if (area < 100) throw new Error('Segmentation mask is too small');

	return {
		width,
		height,
		data,
		boundaryDistance: buildBoundaryDistance(data, width, height),
		area,
		scaleX: image.naturalWidth / width,
		scaleY: image.naturalHeight / height
	};
}

/**
 * Fits the best supported quadrilateral to a segmentation-mask image.
 *
 * The mask is decoded, its four-connected boundary pixels are collected, an initial hull-based
 * estimate is created, and local search refines the fit. Final corners are returned in the mask's
 * original resolution rather than its downscaled working resolution.
 *
 * @param maskUrl - Data or remote URL containing the segmentation mask.
 * @returns Ordered fitted corners, composite score, and overlap/edge-distance metrics.
 * @throws If mask decoding, initial fitting, or refinement cannot produce a valid quadrilateral.
 */
export async function fitQuadFromMask(maskUrl: string): Promise<FittedMaskQuad> {
	const mask = await decodeMask(maskUrl);
	const boundary: Point[] = [];

	for (let y = 1; y < mask.height - 1; y++) {
		for (let x = 1; x < mask.width - 1; x++) {
			const index = y * mask.width + x;
			if (!mask.data[index]) continue;
			if (
				!mask.data[index - 1] ||
				!mask.data[index + 1] ||
				!mask.data[index - mask.width] ||
				!mask.data[index + mask.width]
			) {
				boundary.push({ x, y });
			}
		}
	}

	const initial = fitInitialQuad(boundary);
	if (!initial) throw new Error('Could not fit quadrilateral to segmentation mask');

	const refined = refineQuad(mask, initial);
	return {
		score: refined.score,
		metrics: refined.metrics,
		quad: refined.quad.map((point) => ({
			x: point.x * mask.scaleX,
			y: point.y * mask.scaleY
		})) as Quad
	};
}
