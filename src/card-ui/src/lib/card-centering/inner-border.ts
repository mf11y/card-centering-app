type Insets = Record<'top' | 'bottom' | 'left' | 'right', number>;
type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/** Estimate each printed inner edge independently near the initial guide (not the card outline). */
export function estimateInnerBorders(image: Pixels, defaults: Insets): Insets {
    const result = { ...defaults };
    const { width, height, data } = image;
    if (Math.min(width, height) < 80) return result;
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        const vertical = side === 'left' || side === 'right';
        const depth = vertical ? width : height;
        const along = vertical ? height : width;
        const reverse = side === 'bottom' || side === 'right';
        const start = Math.max(2, Math.ceil(depth * Math.max(1.5, defaults[side] - 3.5) / 100));
        const end = Math.min(depth - 3, Math.floor(depth * Math.min(10, defaults[side] + 4) / 100));
        const scores: { position: number; strength: number; support: number }[] = [];
        for (let position = start; position <= end; position++) {
            const changes: number[] = [];
            for (let sample = 0; sample < 80; sample++) {
                const tangent = Math.round(along * (0.15 + 0.7 * sample / 79));
                const value = (normal: number, channel: number) => {
                    const coordinate = reverse ? depth - 1 - normal : normal;
                    const x = vertical ? coordinate : tangent;
                    const y = vertical ? tangent : coordinate;
                    return data[(y * width + x) * 4 + channel];
                };
                if (value(position - 2, 3) < 250 || value(position + 2, 3) < 250) continue;
                let squared = 0;
                for (let channel = 0; channel < 3; channel++) {
                    const delta = (value(position + 1, channel) + value(position + 2, channel)
                        - value(position - 1, channel) - value(position - 2, channel)) / 2;
                    squared += delta * delta;
                }
                changes.push(Math.sqrt(squared / 3));
            }
            changes.sort((a, b) => a - b);
            // Lower-half strength suppresses text, reflections and isolated artwork edges.
            const strength = changes.length >= 64 ? changes[Math.floor(changes.length * 0.35)] : 0;
            scores.push({ position, strength, support: changes.filter(v => v >= 12).length / 80 });
        }
        scores.sort((a, b) => b.strength - a.strength);
        const best = scores[0];
        if (!best || best.strength < 14 || best.support < 0.7) continue;
        const rival = scores.find(candidate => Math.abs(candidate.position - best.position) > Math.max(3, depth * 0.008));
        // Competing parallel borders are ambiguous; leave the guide for manual placement.
        if (rival && rival.strength > best.strength * 0.8) continue;
        result[side] = Math.round(best.position / depth * 10000) / 100;
    }
    return result;
}

/** Read a small copy of the existing warp, without changing warping or inference. */
export async function guessInnerBorders(url: string, defaults: Insets): Promise<Insets> {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 700 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { ...defaults };
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return estimateInnerBorders(context.getImageData(0, 0, canvas.width, canvas.height), defaults);
}
