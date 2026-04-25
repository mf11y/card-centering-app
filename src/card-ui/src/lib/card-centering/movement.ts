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

function moveGuideValue(
	guideInsetsPx: Record<GuideKey, number>,
	guideKey: GuideKey,
	directionDelta: number,
	stepSize: number,
	warpWidth: number,
	warpHeight: number
) {
	const limit =
		guideKey === 'left' || guideKey === 'right'
			? Math.max(warpWidth, 1)
			: Math.max(warpHeight, 1);

	const next = guideInsetsPx[guideKey] + directionDelta * stepSize;

	return {
		...guideInsetsPx,
		[guideKey]: Math.max(0, Math.min(limit, next))
	};
}

export function applyGuideDirection(
	activeGuide: GuideKey | null,
	direction: Direction,
	guideInsetsPx: Record<GuideKey, number>,
	stepSize: number,
	warpWidth: number,
	warpHeight: number
) {
	if (!activeGuide) return guideInsetsPx;

	if (activeGuide === 'top') {
		if (direction === 'up') return moveGuideValue(guideInsetsPx, 'top', -1, stepSize, warpWidth, warpHeight);
		if (direction === 'down') return moveGuideValue(guideInsetsPx, 'top', 1, stepSize, warpWidth, warpHeight);
		return guideInsetsPx;
	}

	if (activeGuide === 'bottom') {
		if (direction === 'down') return moveGuideValue(guideInsetsPx, 'bottom', -1, stepSize, warpWidth, warpHeight);
		if (direction === 'up') return moveGuideValue(guideInsetsPx, 'bottom', 1, stepSize, warpWidth, warpHeight);
		return guideInsetsPx;
	}

	if (activeGuide === 'left') {
		if (direction === 'left') return moveGuideValue(guideInsetsPx, 'left', -1, stepSize, warpWidth, warpHeight);
		if (direction === 'right') return moveGuideValue(guideInsetsPx, 'left', 1, stepSize, warpWidth, warpHeight);
		return guideInsetsPx;
	}

	if (direction === 'right') return moveGuideValue(guideInsetsPx, 'right', -1, stepSize, warpWidth, warpHeight);
	if (direction === 'left') return moveGuideValue(guideInsetsPx, 'right', 1, stepSize, warpWidth, warpHeight);

	return guideInsetsPx;
}