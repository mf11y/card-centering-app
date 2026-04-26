import type { GuideKey } from './centering';
import type { Direction } from './controller';

export type Corners = {
	topLeft: { x: number; y: number };
	topRight: { x: number; y: number };
	bottomLeft: { x: number; y: number };
	bottomRight: { x: number; y: number };
};

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