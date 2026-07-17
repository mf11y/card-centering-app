/**
 * Immutable movement calculations for source corners and warped-preview guides.
 *
 * These helpers apply pixel or percentage deltas, clamp values to valid image/preview bounds, and
 * encode the direction semantics that differ for guides attached to opposing edges.
 */
import type { GuideKey } from './centering';
import type { Direction } from './controller';

export type Corners = {
	topLeft: { x: number; y: number };
	topRight: { x: number; y: number };
	bottomLeft: { x: number; y: number };
	bottomRight: { x: number; y: number };
};

/**
 * Moves one source-image corner while keeping it within the natural image bounds.
 *
 * @param corners - Current corner-coordinate map.
 * @param cornerKey - Corner to update.
 * @param dx - Horizontal movement in natural-image pixels.
 * @param dy - Vertical movement in natural-image pixels.
 * @param naturalWidth - Maximum valid x coordinate.
 * @param naturalHeight - Maximum valid y coordinate.
 * @returns A new corner map with the selected point clamped to the image.
 */
export function moveCornerValue(
	corners: Corners,
	cornerKey: keyof Corners,
	dx: number,
	dy: number,
	naturalWidth: number,
	naturalHeight: number
): Corners {
	const current = corners[cornerKey];

	const nextX = Math.max(0, Math.min(naturalWidth, current.x + dx));
	const nextY = Math.max(0, Math.min(naturalHeight, current.y + dy));

	return {
		...corners,
		[cornerKey]: {
			x: nextX,
			y: nextY
		}
	};
}

/**
 * Applies a signed percentage step to one guide inset without mutating the input map.
 *
 * @param guideInsetsPct - Current guide positions as percentages.
 * @param guideKey - Guide value to update.
 * @param directionDelta - Signed step multiplier, normally `-1` or `1`.
 * @param stepPercent - Size of one movement step in percentage points.
 * @returns A new guide map with the updated value clamped to 0–100.
 */
function moveGuidePercentValue(
	guideInsetsPct: Record<GuideKey, number>,
	guideKey: GuideKey,
	directionDelta: number,
	stepPercent: number
) {
	const next = guideInsetsPct[guideKey] + directionDelta * stepPercent;

	return {
		...guideInsetsPct,
		[guideKey]: Math.max(0, Math.min(100, next))
	};
}

/**
 * Moves the active guide according to screen-direction input.
 *
 * Because each inset is measured inward from its own edge, the same screen direction has opposite
 * numeric effects on opposing guides. Directions perpendicular to a guide leave state unchanged.
 *
 * @param activeGuide - Selected guide, or `null` when no guide is active.
 * @param direction - Requested screen-space movement direction.
 * @param guideInsetsPct - Current inset percentages.
 * @param stepPercent - Movement size in percentage points.
 * @returns The original map when movement is inapplicable, otherwise an updated guide map.
 */
export function applyGuideDirection(
	activeGuide: GuideKey | null,
	direction: Direction,
	guideInsetsPct: Record<GuideKey, number>,
	stepPercent: number
) {
	if (!activeGuide) return guideInsetsPct;

	if (activeGuide === 'top') {
		if (direction === 'up') return moveGuidePercentValue(guideInsetsPct, 'top', -1, stepPercent);
		if (direction === 'down') return moveGuidePercentValue(guideInsetsPct, 'top', 1, stepPercent);
		return guideInsetsPct;
	}

	if (activeGuide === 'bottom') {
		if (direction === 'down') return moveGuidePercentValue(guideInsetsPct, 'bottom', -1, stepPercent);
		if (direction === 'up') return moveGuidePercentValue(guideInsetsPct, 'bottom', 1, stepPercent);
		return guideInsetsPct;
	}

	if (activeGuide === 'left') {
		if (direction === 'left') return moveGuidePercentValue(guideInsetsPct, 'left', -1, stepPercent);
		if (direction === 'right') return moveGuidePercentValue(guideInsetsPct, 'left', 1, stepPercent);
		return guideInsetsPct;
	}

	if (direction === 'right') return moveGuidePercentValue(guideInsetsPct, 'right', -1, stepPercent);
	if (direction === 'left') return moveGuidePercentValue(guideInsetsPct, 'right', 1, stepPercent);

	return guideInsetsPct;
}
