/**
 * Centering-measurement helpers for the warped card preview.
 *
 * This module turns guide inset measurements into raw edge values and opposing-edge percentages
 * used by the UI to describe how evenly the card artwork is centered.
 */
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

/**
 * Calculates absolute and relative centering measurements from four guide insets.
 *
 * Each percentage compares one inset with its opposing inset. A pair with no measurable total
 * is treated as evenly centered at 50/50 to avoid division by zero.
 *
 * @param guideInsetsPx - Top, bottom, left, and right inset measurements in pixels.
 * @returns Raw inset values plus vertical and horizontal opposing-edge percentages.
 */
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
