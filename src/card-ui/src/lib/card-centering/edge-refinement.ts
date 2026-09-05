/** Original-image side refinement corresponding to card_edge_refinement.py.
 * Pure typed-array code: no network, OpenCV download, or second ML model.
 * Huber IRLS and floating-point interpolation can differ slightly from OpenCV.
 */
import type { Point, Quad } from './geometry';
type Line = {
    point: Point;
    direction: Point;
};
export type EdgeEvidence = {
    edge: string;
    accepted: boolean;
    reason: string;
    support: number;
    angle_deg: number;
    median_offset_px: number;
    residual_px: number;
    points: Point[];
};
export type EdgeRefinement = {
    original: Quad;
    refined: Quad;
    accepted: boolean;
    reason: string;
    corner_shift_px: number[];
    search_radius_px: number;
    edges: EdgeEvidence[];
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function area(q: Quad) { return Math.abs(q.reduce((s, p, i) => s + p.x * q[(i + 1) % 4].y - p.y * q[(i + 1) % 4].x, 0)) / 2; }
function valid(q: Quad, w: number, h: number) {
    if (q.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || area(q) < Math.max(100, w * h * .005))
        return false;
    const turns = q.map((a, i) => { const b = q[(i + 1) % 4], c = q[(i + 2) % 4]; return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x); });
    return q.every((a, i) => length(a, q[(i + 1) % 4]) >= 8) && (turns.every(t => t > 1e-3) || turns.every(t => t < -1e-3));
}
function order(points: Quad): Quad {
    const byY = [...points].sort((a, b) => a.y - b.y);
    const top = byY.slice(0, 2).sort((a, b) => a.x - b.x), bottom = byY.slice(2).sort((a, b) => a.x - b.x);
    return [top[0], top[1], bottom[1], bottom[0]].map(p => ({ ...p })) as Quad;
}
function fitLine(points: Point[]): Line {
    let weights = points.map(() => 1), line: Line = { point: points[0], direction: { x: 1, y: 0 } };
    for (let iteration = 0; iteration < 40; iteration++) {
        const sum = weights.reduce((a, b) => a + b, 0);
        const center = { x: 0, y: 0 };
        points.forEach((p, i) => { center.x += p.x * weights[i] / sum; center.y += p.y * weights[i] / sum; });
        let xx = 0, xy = 0, yy = 0;
        points.forEach((p, i) => { const x = p.x - center.x, y = p.y - center.y; xx += weights[i] * x * x; xy += weights[i] * x * y; yy += weights[i] * y * y; });
        const angle = .5 * Math.atan2(2 * xy, xx - yy);
        const next = { point: center, direction: { x: Math.cos(angle), y: Math.sin(angle) } };
        const change = length(next.point, line.point) + Math.min(length(next.direction, line.direction), Math.hypot(next.direction.x + line.direction.x, next.direction.y + line.direction.y));
        line = next;
        weights = points.map(p => { const d = Math.abs((p.x - center.x) * line.direction.y - (p.y - center.y) * line.direction.x); return d <= 1.345 ? 1 : 1.345 / d; });
        if (iteration > 0 && change < 1e-5)
            break;
    }
    return line;
}
function intersection(a: Line, b: Line): Point {
    const det = a.direction.x * b.direction.y - a.direction.y * b.direction.x;
    if (Math.abs(det) < 1e-6)
        throw new Error('unstable edge intersections');
    const t = ((b.point.x - a.point.x) * b.direction.y - (b.point.y - a.point.y) * b.direction.x) / det;
    return { x: a.point.x + t * a.direction.x, y: a.point.y + t * a.direction.y };
}
function reflect(i: number, n: number): number { if (n <= 1)
    return 0; while (i < 0 || i >= n)
    i = i < 0 ? -i : 2 * n - 2 - i; return i; }
/** Gaussian 5x5 sigma .8 followed by Sobel /8, on a native-resolution side ROI. */
function gradients(image: Pick<ImageData, 'data' | 'width' | 'height'>, lo: Point, hi: Point) {
    const w = hi.x - lo.x, h = hi.y - lo.y, size = w * h * 3;
    const raw = new Float32Array(size), temp = new Float32Array(size), blur = new Float32Array(size);
    const kernel = [-2, -1, 0, 1, 2].map(x => Math.exp(-x * x / (2 * .8 * .8))), sum = kernel.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 5; i++)
        kernel[i] /= sum;
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            for (let c = 0; c < 3; c++)
                raw[(y * w + x) * 3 + c] = image.data[((y + lo.y) * image.width + x + lo.x) * 4 + c] / 255;
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            for (let c = 0; c < 3; c++) {
                let s = 0;
                for (let k = -2; k <= 2; k++)
                    s += raw[(y * w + reflect(x + k, w)) * 3 + c] * kernel[k + 2];
                temp[(y * w + x) * 3 + c] = s;
            }
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            for (let c = 0; c < 3; c++) {
                let s = 0;
                for (let k = -2; k <= 2; k++)
                    s += temp[(reflect(y + k, h) * w + x) * 3 + c] * kernel[k + 2];
                blur[(y * w + x) * 3 + c] = s;
            }
    const gx = new Float32Array(size), gy = new Float32Array(size);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            for (let c = 0; c < 3; c++) {
                let dx = 0, dy = 0;
                for (let k = -1; k <= 1; k++) {
                    const weight = k === 0 ? 2 : 1;
                    dx += weight * (blur[(reflect(y + k, h) * w + reflect(x + 1, w)) * 3 + c] - blur[(reflect(y + k, h) * w + reflect(x - 1, w)) * 3 + c]);
                    dy += weight * (blur[(reflect(y + 1, h) * w + reflect(x + k, w)) * 3 + c] - blur[(reflect(y - 1, h) * w + reflect(x + k, w)) * 3 + c]);
                }
                gx[(y * w + x) * 3 + c] = dx / 8;
                gy[(y * w + x) * 3 + c] = dy / 8;
            }
    return { gx, gy, w, h };
}
function sample(data: Float32Array, w: number, h: number, x: number, y: number, c: number) {
    // OpenCV remap INTER_LINEAR quantizes fractions to 1/32 pixel.
    x = clamp(Math.round(x * 32) / 32, 0, w - 1);
    y = clamp(Math.round(y * 32) / 32, 0, h - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), fx = x - x0, fy = y - y0;
    return (data[(y0 * w + x0) * 3 + c] * (1 - fx) + data[(y0 * w + x1) * 3 + c] * fx) * (1 - fy) + (data[(y1 * w + x0) * 3 + c] * (1 - fx) + data[(y1 * w + x1) * 3 + c] * fx) * fy;
}
export function refineCardEdges(image: Pick<ImageData, 'data' | 'width' | 'height'>, quad: Quad, searchFraction = .025, cornerExclusion = .15): EdgeRefinement {
    const w = image.width, h = image.height, original = order(quad);
    if (!valid(original, w, h))
        throw new Error('Invalid initial quad');
    if (!(searchFraction > 0 && searchFraction <= .1 && cornerExclusion >= 0 && cornerExclusion < .4))
        throw new Error('Invalid refinement parameters');
    const shortSide = Math.min(...original.map((a, i) => length(a, original[(i + 1) % 4]))), radius = Math.max(3, shortSide * searchFraction);
    const lines: Line[] = [], edges: EdgeEvidence[] = [];
    for (let edge = 0; edge < 4; edge++) {
        const a = original[edge], b = original[(edge + 1) % 4], len = length(a, b), tangent = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }, normal = { x: -tangent.y, y: tangent.x };
        const margin = Math.ceil(radius + 5), lo = { x: Math.max(0, Math.floor(Math.min(a.x, b.x)) - margin), y: Math.max(0, Math.floor(Math.min(a.y, b.y)) - margin) }, hi = { x: Math.min(w, Math.ceil(Math.max(a.x, b.x)) + margin + 1), y: Math.min(h, Math.ceil(Math.max(a.y, b.y)) + margin + 1) };
        const g = gradients(image, lo, hi), count = Math.trunc(clamp(len / 3, 40, 320)), offsetCount = 2 * Math.ceil(radius) + 1, spacing = 2 * radius / (offsetCount - 1);
        const points: Point[] = [], offsets: number[] = [], ts: number[] = [], ok: boolean[] = [];
        for (let i = 0; i < count; i++) {
            const t = cornerExclusion + i / (count - 1) * (1 - 2 * cornerExclusion), center = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
            const magnitudes: number[] = [], alignments: number[] = [], inside: boolean[] = [];
            let best = 0, bestPreference = -1;
            for (let j = 0; j < offsetCount; j++) {
                const offset = -radius + j * spacing, x = center.x + offset * normal.x, y = center.y + offset * normal.y;
                let magnitude = 0, gradient = 0;
                for (let c = 0; c < 3; c++) {
                    const dx = sample(g.gx, g.w, g.h, x - lo.x, y - lo.y, c), dy = sample(g.gy, g.w, g.h, x - lo.x, y - lo.y, c);
                    magnitude = Math.max(magnitude, Math.abs(dx * normal.x + dy * normal.y));
                    gradient = Math.max(gradient, Math.hypot(dx, dy));
                }
                const alignment = magnitude / (gradient + 1e-6), isInside = x >= 2 && x < w - 2 && y >= 2 && y < h - 2;
                const preference = isInside ? magnitude * alignment ** 2 * Math.exp(-.5 * (offset / (radius * .65)) ** 2) : 0;
                magnitudes.push(magnitude);
                alignments.push(alignment);
                inside.push(isInside);
                if (preference > bestPreference) {
                    bestPreference = preference;
                    best = j;
                }
            }
            const j = clamp(best, 1, offsetCount - 2), left = magnitudes[j - 1], mid = magnitudes[j], right = magnitudes[j + 1], denom = left - 2 * mid + right;
            const adjustment = clamp(Math.abs(denom) > 1e-8 ? .5 * (left - right) / denom : 0, -.5, .5) * spacing;
            const offset = -radius + best * spacing + adjustment;
            points.push({ x: center.x + offset * normal.x, y: center.y + offset * normal.y });
            offsets.push(offset);
            ts.push(t);
            ok.push(magnitudes[best] >= .018 && alignments[best] >= .65 && best > 0 && best < offsetCount - 1 && inside[best]);
        }
        let fitted: Line = { point: a, direction: tangent };
        const info: EdgeEvidence = { edge: ['top', 'right', 'bottom', 'left'][edge], accepted: false, reason: 'insufficient edge evidence', support: 0, angle_deg: 0, median_offset_px: 0, residual_px: 0, points: points.filter((_, i) => ok[i]) };
        if (info.points.length >= Math.max(12, .35 * count)) {
            let trial = fitLine(info.points);
            const residual = points.map(p => Math.abs((p.x - trial.point.x) * trial.direction.y - (p.y - trial.point.y) * trial.direction.x));
            const inliers = points.map((_, i) => i).filter(i => ok[i] && residual[i] <= Math.max(1.25, shortSide * .003));
            const support = inliers.length / count, coverage = inliers.length > 1 ? (ts[inliers[inliers.length - 1]] - ts[inliers[0]]) / (1 - 2 * cornerExclusion) : 0;
            if (inliers.length >= 12) {
                trial = fitLine(inliers.map(i => points[i]));
                const angle = Math.acos(clamp(Math.abs(trial.direction.x * tangent.x + trial.direction.y * tangent.y), 0, 1)) * 180 / Math.PI, offset = median(inliers.map(i => offsets[i]));
                Object.assign(info, { support, angle_deg: angle, median_offset_px: offset, residual_px: median(inliers.map(i => residual[i])), points: inliers.map(i => points[i]) });
                if (support >= .45 && coverage >= .65 && angle <= 5 && Math.abs(offset) <= radius * .85) {
                    fitted = trial;
                    info.accepted = true;
                    info.reason = 'coherent local edge';
                }
                else
                    info.reason = 'edge support, span, angle, or offset failed safeguard';
            }
        }
        lines.push(fitted);
        edges.push(info);
    }
    let accepted = edges.some(e => e.accepted), reason = 'accepted supported sides; unsupported sides kept original', refined = original;
    try {
        refined = lines.map((line, i) => intersection(lines[(i + 3) % 4], line)) as Quad;
        const ratio = area(refined) / area(original);
        if (!valid(refined, w, h) || refined.some(p => p.x < 0 || p.y < 0 || p.x > w - 1 || p.y > h - 1) || Math.max(...refined.map((p, i) => length(p, original[i]))) > radius * 2 || ratio < .85 || ratio > 1.15) {
            accepted = false;
            reason = 'global geometry or movement safeguard rejected refinement';
        }
    }
    catch {
        accepted = false;
        reason = 'unstable edge intersections';
    }
    if (!accepted) {
        refined = original.map(p => ({ ...p })) as Quad;
        if (!edges.some(e => e.accepted))
            reason = 'no sufficiently supported image edges; kept original';
    }
    return { original, refined, accepted, reason, corner_shift_px: refined.map((p, i) => length(p, original[i])), search_radius_px: radius, edges };
}
/** Decode once at source resolution. All returned coordinates remain source pixels. */
export async function refineCardImage(file: Blob, quad: Quad): Promise<EdgeRefinement> {
    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx)
            throw new Error('Cannot create refinement canvas');
        ctx.drawImage(bitmap, 0, 0);
        return refineCardEdges(ctx.getImageData(0, 0, canvas.width, canvas.height), quad);
    }
    finally {
        bitmap.close();
    }
}
