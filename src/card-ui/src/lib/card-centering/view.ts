/**
 * Source-preview auto-zoom and transform-style calculations.
 *
 * This module frames detected corners inside the preview, preserves a user-frozen zoom center,
 * and converts the resulting scale/translation metrics into the CSS transform used by the UI.
 */
import type { Point } from './geometry';

export type Rect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type FrozenZoom = {
	scale: number;
	centerXNorm: number;
	centerYNorm: number;
};

export type CornersState = {
	topLeft: Point;
	topRight: Point;
	bottomRight: Point;
	bottomLeft: Point;
};

/**
 * Computes an automatic transform that enlarges a small detected quad while keeping handles visible.
 *
 * Corner coordinates are mapped from natural-image space into the displayed image. The function
 * targets a comfortable viewport occupancy, then progressively reduces scale until every handle
 * fits within a safety margin. Already-large quads and disabled auto-zoom use the identity transform.
 *
 * @param params - Auto-zoom flag, display rectangle, image dimensions, and source corners.
 * @returns Scale plus x/y translation in displayed-image pixels.
 */
export function computeZoomMetrics(params: {
	autoZoomToCorners: boolean;
	displayedImageRect: Rect;
	naturalWidth: number;
	naturalHeight: number;
	corners: CornersState;
}) {
	const { autoZoomToCorners, displayedImageRect, naturalWidth, naturalHeight, corners } = params;

	if (!autoZoomToCorners || !displayedImageRect.width || !displayedImageRect.height) {
		return { scale: 1, tx: 0, ty: 0 };
	}

	const xs = [
		(corners.topLeft.x / naturalWidth) * displayedImageRect.width,
		(corners.topRight.x / naturalWidth) * displayedImageRect.width,
		(corners.bottomRight.x / naturalWidth) * displayedImageRect.width,
		(corners.bottomLeft.x / naturalWidth) * displayedImageRect.width
	];

	const ys = [
		(corners.topLeft.y / naturalHeight) * displayedImageRect.height,
		(corners.topRight.y / naturalHeight) * displayedImageRect.height,
		(corners.bottomRight.y / naturalHeight) * displayedImageRect.height,
		(corners.bottomLeft.y / naturalHeight) * displayedImageRect.height
	];

	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);

	const boxWidth = Math.max(1, maxX - minX);
	const boxHeight = Math.max(1, maxY - minY);

	const refWidth = Math.min(displayedImageRect.width, 520);
	const refHeight = Math.min(displayedImageRect.height, 760);

	const currentWidthFrac = boxWidth / refWidth;
	const currentHeightFrac = boxHeight / refHeight;

	if (currentWidthFrac > 0.72 || currentHeightFrac > 0.72) {
		return { scale: 1, tx: 0, ty: 0 };
	}

	const targetWidthFrac = 0.68;
	const targetHeightFrac = 0.7;

	const scaleX = (refWidth * targetWidthFrac) / boxWidth;
	const scaleY = (refHeight * targetHeightFrac) / boxHeight;

	let scale = Math.max(1, Math.min(scaleX, scaleY));

	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;

	const handleMargin = 34;

	for (let i = 0; i < 10; i++) {
		const txTry = displayedImageRect.width / 2 - centerX * scale;
		const tyTry = displayedImageRect.height / 2 - centerY * scale;

		const screenPts = [
			{ x: xs[0] * scale + txTry, y: ys[0] * scale + tyTry },
			{ x: xs[1] * scale + txTry, y: ys[1] * scale + tyTry },
			{ x: xs[2] * scale + txTry, y: ys[2] * scale + tyTry },
			{ x: xs[3] * scale + txTry, y: ys[3] * scale + tyTry }
		];

		const allVisible = screenPts.every(
			(p) =>
				p.x >= handleMargin &&
				p.x <= displayedImageRect.width - handleMargin &&
				p.y >= handleMargin &&
				p.y <= displayedImageRect.height - handleMargin
		);

		if (allVisible) {
			return { scale, tx: txTry, ty: tyTry };
		}

		scale *= 0.92;
		if (scale <= 1.001) break;
	}

	return {
		scale: Math.max(1, scale),
		tx: displayedImageRect.width / 2 - centerX * scale,
		ty: displayedImageRect.height / 2 - centerY * scale
	};
}

/**
 * Resolves the effective source-preview transform from frozen or automatic zoom state.
 *
 * A frozen transform has priority and reconstructs its center from normalized coordinates so it
 * remains stable when the display rectangle changes. Otherwise this delegates to auto framing.
 *
 * @param params - Frozen state, display geometry, auto-zoom setting, dimensions, and corners.
 * @returns Effective scale and x/y translation for the source image.
 */
export function getZoomMetrics(params: {
	frozenZoom: FrozenZoom | null;
	displayedImageRect: Rect;
	autoZoomToCorners: boolean;
	naturalWidth: number;
	naturalHeight: number;
	corners: CornersState;
}) {
	const {
		frozenZoom,
		displayedImageRect,
		autoZoomToCorners,
		naturalWidth,
		naturalHeight,
		corners
	} = params;

	if (frozenZoom) {
		const centerX = frozenZoom.centerXNorm * displayedImageRect.width;
		const centerY = frozenZoom.centerYNorm * displayedImageRect.height;

		return {
			scale: frozenZoom.scale,
			tx: displayedImageRect.width / 2 - centerX * frozenZoom.scale,
			ty: displayedImageRect.height / 2 - centerY * frozenZoom.scale
		};
	}

	if (!autoZoomToCorners || !displayedImageRect.width || !displayedImageRect.height) {
		return { scale: 1, tx: 0, ty: 0 };
	}

	return computeZoomMetrics({
		autoZoomToCorners,
		displayedImageRect,
		naturalWidth,
		naturalHeight,
		corners
	});
}

/**
 * Serializes the effective zoom metrics into an inline CSS transform declaration.
 *
 * @param params - Same frozen/automatic zoom inputs accepted by `getZoomMetrics`.
 * @returns CSS setting a top-left origin followed by translation and scaling.
 */
export function getZoomStyle(params: {
	frozenZoom: FrozenZoom | null;
	displayedImageRect: Rect;
	autoZoomToCorners: boolean;
	naturalWidth: number;
	naturalHeight: number;
	corners: CornersState;
}) {
	const { scale, tx, ty } = getZoomMetrics(params);
	return `transform-origin: top left; transform: translate(${tx}px, ${ty}px) scale(${scale});`;
}
