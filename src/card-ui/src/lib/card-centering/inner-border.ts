import { applyTopInnerRescue, ENABLE_TOP_INNER_RESCUE, type DepthEvidence } from './top-inner-rescue.ts';

type Insets = Record<'top' | 'bottom' | 'left' | 'right', number>;
type Pixels = { width: number; height: number; data: Uint8ClampedArray };

export type InnerDiagnostic = {
 side:keyof Insets; detectorWidth:number; detectorHeight:number; fallback:boolean; reason:string;
 defaultPct:number; insetPct:number; bestPosition?:number; strength?:number; support?:number;
 rivalStrength?:number; rivalRatio?:number; searchStart?:number; searchEnd?:number;
 candidates?:{position:number;strength:number;support:number}[];
};
/** Estimate each printed inner edge independently near the initial guide (not the card outline). */
export function estimateInnerBorders(image: Pixels, defaults: Insets, diagnostics?:InnerDiagnostic[], topEvidence?: (scores: readonly DepthEvidence[]) => void): Insets {
    const result = { ...defaults };
    const { width, height, data } = image;
    if (Math.min(width, height) < 80) {
        for(const side of ['top','bottom','left','right'] as const) diagnostics?.push({side,detectorWidth:width,detectorHeight:height,fallback:true,reason:'image too small',defaultPct:defaults[side],insetPct:defaults[side]});
        return result;
    }
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        const diagnostic:InnerDiagnostic={side,detectorWidth:width,detectorHeight:height,fallback:true,reason:'weak edge',defaultPct:defaults[side],insetPct:defaults[side]};
        diagnostics?.push(diagnostic);
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
        if (side === 'top') topEvidence?.(scores);
        diagnostic.searchStart=start;diagnostic.searchEnd=end;
        const peaks:typeof scores=[];
        for(const candidate of scores) if(peaks.every(p=>Math.abs(p.position-candidate.position)>Math.max(3,depth*.008))) {peaks.push(candidate);if(peaks.length===5)break;}
        diagnostic.candidates=peaks;
        if(best){diagnostic.bestPosition=best.position;diagnostic.strength=best.strength;diagnostic.support=best.support;}

        if (!best || best.strength < 14 || best.support < 0.7) continue;
        const rival = scores.find(candidate => Math.abs(candidate.position - best.position) > Math.max(3, depth * 0.008));
        // Competing parallel borders are ambiguous; leave the guide for manual placement.
        diagnostic.rivalStrength=rival?.strength;diagnostic.rivalRatio=rival? rival.strength/best.strength:0;
        if (rival && rival.strength > best.strength * 0.8) {diagnostic.reason='competing parallel edge';continue;}
        result[side] = Math.round(best.position / depth * 10000) / 100;
        diagnostic.fallback=false;diagnostic.reason='accepted';diagnostic.insetPct=result[side];
    }
    return result;
}

/** A runs first; OFF follows the original path without collecting extra evidence. */
export function estimateInnerBordersWithRescue(image: Pixels, defaults: Insets,
    diagnostics?: InnerDiagnostic[], enabled = ENABLE_TOP_INNER_RESCUE): Insets {
    if (!enabled) return estimateInnerBorders(image, defaults, diagnostics);
    const sides: InnerDiagnostic[] = [];
    let evidence: readonly DepthEvidence[] = [];
    const original = estimateInnerBorders(image, defaults, sides, scores => { evidence = scores; });
    diagnostics?.push(...sides);
    return applyTopInnerRescue(original, sides.find(d => d.side === 'top'), evidence, true).insets;
}

/** Read a small copy of the existing warp, without changing warping or inference. */
export async function guessInnerBorders(url: string, defaults: Insets, diagnostics?:InnerDiagnostic[]): Promise<Insets> {
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
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    try {
        const { selectLearnedInnerBorders } = await import('./learned-inner-ranker.ts');
        return await selectLearnedInnerBorders(pixels, defaults, diagnostics);
    } catch {
        return estimateInnerBorders(pixels, defaults, diagnostics);
    }
}
