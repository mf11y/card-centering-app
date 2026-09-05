/** Ultralytics retina-mask processing: unpad logits, bilinear upsample, threshold, crop. */
export function nativeMask(logits: Float32Array, pw: number, ph: number, width: number, height: number, box: {
    left: number;
    top: number;
    right: number;
    bottom: number;
}): Uint8Array {
    // Python round is ties-to-even, unlike Math.round.
    const round = (x: number) => { const n = Math.floor(x); return x - n === .5 ? (n % 2 === 0 ? n : n + 1) : Math.round(x); };
    const gain = Math.min(ph / height, pw / width), padX = (pw - round(width * gain)) / 2, padY = (ph - round(height * gain)) / 2;
    const left = round(padX - .1), top = round(padY - .1), right = pw - round(padX + .1), bottom = ph - round(padY + .1);
    const cw = right - left, ch = bottom - top, mask = new Uint8Array(width * height);
    // crop_mask uses integer pixel indices >= left/top and < right/bottom.
    const bx0 = Math.max(0, Math.ceil(box.left)), by0 = Math.max(0, Math.ceil(box.top)), bx1 = Math.min(width, Math.ceil(box.right)), by1 = Math.min(height, Math.ceil(box.bottom));
    for (let y = by0; y < by1; y++) {
        const sy = Math.max(0, Math.min(ch - 1, (y + .5) * ch / height - .5)), y0 = Math.floor(sy), y1 = Math.min(y0 + 1, ch - 1), fy = sy - y0;
        for (let x = bx0; x < bx1; x++) {
            const sx = Math.max(0, Math.min(cw - 1, (x + .5) * cw / width - .5)), x0 = Math.floor(sx), x1 = Math.min(x0 + 1, cw - 1), fx = sx - x0;
            const a = logits[(top + y0) * pw + left + x0] * (1 - fx) + logits[(top + y0) * pw + left + x1] * fx;
            const b = logits[(top + y1) * pw + left + x0] * (1 - fx) + logits[(top + y1) * pw + left + x1] * fx;
            mask[y * width + x] = a * (1 - fy) + b * fy > 0 ? 1 : 0;
        }
    }
    return mask;
}
