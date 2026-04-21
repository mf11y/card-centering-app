import {
	computeWarpOutputSize,
	computeHomography,
	invertHomography,
	applyHomography,
	type Point,
	type Quad
} from './geometry';

function sampleBilinear(src: Uint8ClampedArray, sw: number, sh: number, x: number, y: number) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, sw - 1);
    const y1 = Math.min(y0 + 1, sh - 1);

    const dx = x - x0;
    const dy = y - y0;

    const idx00 = (y0 * sw + x0) * 4;
    const idx10 = (y0 * sw + x1) * 4;
    const idx01 = (y1 * sw + x0) * 4;
    const idx11 = (y1 * sw + x1) * 4;

    const out = [0, 0, 0, 0];

    for (let k = 0; k < 4; k++) {
        const top = src[idx00 + k] * (1 - dx) + src[idx10 + k] * dx;
        const bottom = src[idx01 + k] * (1 - dx) + src[idx11 + k] * dx;
        out[k] = top * (1 - dy) + bottom * dy;
    }

    return out;
}

export function warpImageToDataUrl(image: HTMLImageElement, corners: Quad) {
    const [tl, tr, br, bl] = corners;

    const { width: outWidth, height: outHeight } = computeWarpOutputSize(tl, tr, br, bl);

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = image.naturalWidth;
    srcCanvas.height = image.naturalHeight;

    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    if (!srcCtx) {
        throw new Error('Could not create source canvas');
    }
    srcCtx.drawImage(image, 0, 0);

    const srcImage = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const srcData = srcImage.data;
    const sw = srcCanvas.width;
    const sh = srcCanvas.height;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outWidth;
    outCanvas.height = outHeight;

    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
        throw new Error('Could not create output canvas');
    }

    const outImage = outCtx.createImageData(outWidth, outHeight);
    const outData = outImage.data;

    const dstQuad: Quad = [
        { x: 0, y: 0 },
        { x: outWidth - 1, y: 0 },
        { x: outWidth - 1, y: outHeight - 1 },
        { x: 0, y: outHeight - 1 }
    ];

    // map source quad -> destination rect, then invert for sampling
    const H = computeHomography(corners, dstQuad);
    const Hinv = invertHomography(H);

    for (let y = 0; y < outHeight; y++) {
        for (let x = 0; x < outWidth; x++) {
            const srcPt = applyHomography(Hinv, x + 0.5, y + 0.5);

            const outIdx = (y * outWidth + x) * 4;

            if (srcPt.x < 0 || srcPt.x >= sw - 1 || srcPt.y < 0 || srcPt.y >= sh - 1) {
                outData[outIdx + 0] = 0;
                outData[outIdx + 1] = 0;
                outData[outIdx + 2] = 0;
                outData[outIdx + 3] = 0;
                continue;
            }

            const [r, g, b, a] = sampleBilinear(srcData, sw, sh, srcPt.x, srcPt.y);
            outData[outIdx + 0] = Math.round(r);
            outData[outIdx + 1] = Math.round(g);
            outData[outIdx + 2] = Math.round(b);
            outData[outIdx + 3] = Math.round(a);
        }
    }

    outCtx.putImageData(outImage, 0, 0);
    return outCanvas.toDataURL('image/png');
}