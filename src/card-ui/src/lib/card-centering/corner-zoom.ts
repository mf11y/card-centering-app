/**
 * Magnified corner-patch rendering for precise quadrilateral editing.
 *
 * This module draws a pixel-preserving crop around the selected source corner and overlays the
 * two adjoining quad edges, a corner marker, and a crosshair to make fine adjustments easier.
 */

export type CornerKey = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export type CornerPoint = {
    x: number;
    y: number;
};

export type CornerMap = Record<CornerKey, CornerPoint>;

type DrawCornerZoomPatchArgs = {
    canvas: HTMLCanvasElement | null;
    image: HTMLImageElement | null;
    activeCorner: CornerKey | null;
    corners: CornerMap;
    patchRadius: number;
    outputSize: number;
};

/**
 * Finds the corner immediately before a corner in clockwise quad order.
 *
 * @param cornerKey - Selected corner key.
 * @returns The adjacent corner preceding `cornerKey` around the quadrilateral.
 */
function getPrevCornerKey(cornerKey: CornerKey): CornerKey {
    if (cornerKey === 'topLeft') return 'bottomLeft';
    if (cornerKey === 'topRight') return 'topLeft';
    if (cornerKey === 'bottomRight') return 'topRight';
    return 'bottomRight';
}

/**
 * Finds the corner immediately after a corner in clockwise quad order.
 *
 * @param cornerKey - Selected corner key.
 * @returns The adjacent corner following `cornerKey` around the quadrilateral.
 */
function getNextCornerKey(cornerKey: CornerKey): CornerKey {
    if (cornerKey === 'topLeft') return 'topRight';
    if (cornerKey === 'topRight') return 'bottomRight';
    if (cornerKey === 'bottomRight') return 'bottomLeft';
    return 'topLeft';
}

/**
 * Renders a magnified source-image patch centered on the active quadrilateral corner.
 *
 * The crop is drawn without smoothing to retain pixel detail. Adjoining edges are projected into
 * patch coordinates and drawn with the active corner marker and crosshair. The function returns
 * without drawing when required DOM elements, dimensions, or selection state are unavailable.
 *
 * @param args - Canvas, source image, corner state, crop radius, and output dimensions.
 */
export function drawCornerZoomPatch({
    canvas,
    image,
    activeCorner,
    corners,
    patchRadius,
    outputSize
}: DrawCornerZoomPatchArgs) {
    if (!canvas || !image || !activeCorner) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;

    if (!naturalWidth || !naturalHeight) return;

    const cornerPt = corners[activeCorner];

    const sx = Math.round(cornerPt.x - patchRadius);
    const sy = Math.round(cornerPt.y - patchRadius);
    const sw = patchRadius * 2;
    const sh = patchRadius * 2;

    ctx.clearRect(0, 0, outputSize, outputSize);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, outputSize, outputSize);

    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, outputSize, outputSize);

    const prevKey = getPrevCornerKey(activeCorner);
    const nextKey = getNextCornerKey(activeCorner);

    const prevPt = corners[prevKey];
    const nextPt = corners[nextKey];

    const scale = outputSize / (patchRadius * 2);

	/**
	 * Converts a source-image x coordinate into the magnified patch coordinate space.
	 *
	 * @param x - Horizontal coordinate in natural-image pixels.
	 * @returns Horizontal coordinate in output-canvas pixels.
	 */
    function toPatchX(x: number) {
        return (x - sx) * scale;
    }

	/**
	 * Converts a source-image y coordinate into the magnified patch coordinate space.
	 *
	 * @param y - Vertical coordinate in natural-image pixels.
	 * @returns Vertical coordinate in output-canvas pixels.
	 */
    function toPatchY(y: number) {
        return (y - sy) * scale;
    }

    const cx = toPatchX(cornerPt.x);
    const cy = toPatchY(cornerPt.y);

    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(toPatchX(prevPt.x), toPatchY(prevPt.y));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(toPatchX(nextPt.x), toPatchY(nextPt.y));
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy);
    ctx.lineTo(cx + 16, cy);
    ctx.moveTo(cx, cy - 16);
    ctx.lineTo(cx, cy + 16);
    ctx.stroke();
}
