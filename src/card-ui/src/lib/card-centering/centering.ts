export type GuideKey = 'top' | 'bottom' | 'left' | 'right';

export type GuideInsets = {
top: number;
bottom: number;
left: number;
right: number;
};

export type Rect = {
x: number;
y: number;
width: number;
height: number;
};

export function getCenteringStats(guideInsetsPx: GuideInsets) {
const top = guideInsetsPx.top;
const bottom = guideInsetsPx.bottom;
const left = guideInsetsPx.left;
const right = guideInsetsPx.right;

const verticalTotal = top + bottom;
const horizontalTotal = left + right;

const topPct = verticalTotal > 0 ? (top / verticalTotal) * 100 : 50;
const bottomPct = verticalTotal > 0 ? (bottom / verticalTotal) * 100 : 50;
const leftPct = horizontalTotal > 0 ? (left / horizontalTotal) * 100 : 50;
const rightPct = horizontalTotal > 0 ? (right / horizontalTotal) * 100 : 50;

return {
    top,
    bottom,
    left,
    right,
    topPct,
    bottomPct,
    leftPct,
    rightPct
};
}
