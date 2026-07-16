import { orderCorners, type Point, type Quad } from './geometry';

type BinaryMask = {
	width: number;
	height: number;
	data: Uint8Array;
	scaleX: number;
	scaleY: number;
};

export type FittedMaskQuad = {
	quad: Quad;
	score: number;
};

function cross(o: Point, a: Point, b: Point) {
	return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

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

function arc(points: Point[], start: number, end: number) {
	if (start <= end) return points.slice(start, end + 1);
	return [...points.slice(start), ...points.slice(0, end + 1)];
}

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

function scoreQuad(mask: BinaryMask, quad: Quad) {
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

	let maskArea = 0;
	for (const value of mask.data) maskArea += value;
	return (2 * intersection - 0.7 * candidateArea - 0.3 * maskArea) / Math.max(maskArea, 1);
}

function clampQuad(quad: Quad, width: number, height: number): Quad {
	return orderCorners(
		quad.map((point) => ({
			x: Math.max(0, Math.min(width - 1, point.x)),
			y: Math.max(0, Math.min(height - 1, point.y))
		})) as Quad
	);
}

function refineQuad(mask: BinaryMask, initial: Quad) {
	let best = clampQuad(initial, mask.width, mask.height);
	let bestScore = scoreQuad(mask, best);
	const steps = [8, 4, 2, 1];

	for (const step of steps) {
		let improved = true;
		while (improved) {
			improved = false;
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
					const ordered = clampQuad(candidate, mask.width, mask.height);
					const score = scoreQuad(mask, ordered);
					if (score > bestScore) {
						best = ordered;
						bestScore = score;
						improved = true;
					}
				}
			}
		}
	}

	return { quad: best, score: bestScore };
}

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
	for (let i = 0; i < data.length; i++) {
		const offset = i * 4;
		data[i] = pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 96 ? 1 : 0;
	}

	return {
		width,
		height,
		data,
		scaleX: image.naturalWidth / width,
		scaleY: image.naturalHeight / height
	};
}

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
		quad: refined.quad.map((point) => ({
			x: point.x * mask.scaleX,
			y: point.y * mask.scaleY
		})) as Quad
	};
}
