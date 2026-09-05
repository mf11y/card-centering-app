<script lang="ts">
	import { logUploadedImage } from "../lib/upload-logging";
	import { html2canvas } from 'html2canvas-pro';
	import { onMount, onDestroy, tick } from 'svelte';
	import { orderCorners, ensureClockwise } from '../lib/card-centering/geometry';
	import type { Quad } from '../lib/card-centering/geometry';
	import { guessInnerBorders } from '../lib/card-centering/inner-border';
	import { warpImageToDataUrl } from '../lib/card-centering/warp';
	import { ALERT_THRESHOLD, cornerOverlayItems } from '../lib/card-centering/constants';
	import { formatPct } from '../lib/card-centering/format';
	import { inferCorners, preloadInferenceModel } from '../lib/card-centering/api';
	import { computeZoomMetrics } from '../lib/card-centering/view';
	import { getCenteringStats, type GuideKey } from '../lib/card-centering/centering';

	import { createInputController, type Direction } from '../lib/card-centering/controller';
	import { moveCornerValue, applyGuideDirection } from '$lib/card-centering/movement';
	import {
		drawCornerZoomPatch,
		type CornerKey,
		type CornerMap
	} from '$lib/card-centering/corner-zoom';

/**
 * Shared directional-input controller and its reactive rendering tick.
 * - inputVisualTick: forces pad-button classes to refresh when controller state changes.
 * - inputController: coordinates keyboard/pad holds and delegates each nudge to the selected target.
 */
let inputVisualTick = $state(0);

const inputController = createInputController({
	onNudge: (direction) => {
		nudgeSelected(direction);
	},
	onStop: () => {},
	onStateChange: () => {
		inputVisualTick += 1;
	}
});

/**
	 * Timing/config constants used by interaction and zoom-preview helpers.
	 * - NUDGE_WARP_DELAY: debounce delay before rerendering the warp preview after nudges.
	 * - CORNER_PATCH_RADIUS: source-image pixel radius sampled around the selected corner.
	 * - CORNER_ZOOM_SIZE: rendered canvas size for the corner zoom preview.
	 * - SOURCE_OVERLAY_PADDING: solid canvas margin reserved around the image for corner controls.
	 * - ACTION_ROW_TRANSITION_MS: duration reserved for the Try Me/upload action-row transition.
	 * - DRAG_SENSITIVITY: normal fraction of pointer travel applied to corner and guide dragging.
	 * - FINE_DRAG_SENSITIVITY: reduced drag fraction applied while Shift is held.
	 */

	const NUDGE_WARP_DELAY = 150;
	const CORNER_PATCH_RADIUS = 150;
	const CORNER_ZOOM_SIZE = 150;
	const SOURCE_OVERLAY_PADDING = 28;
	const ACTION_ROW_TRANSITION_MS = 700;
	const DRAG_SENSITIVITY = 0.3;
	const FINE_DRAG_SENSITIVITY = 0.05;

	/**
	 * Source image / segmentation state.
	 * - imageFile: currently loaded image file from upload or drag-drop.
	 * - imageUrl: blob URL for the source image preview.
	 * - imageEl: DOM reference to the rendered source <img>.
	 * - warpedImageUrl: generated preview URL for the perspective-warped image.
	 * - segmentationMaskUrl: normalized mask URL returned from segmentation and used for fit state/cleanup.
	 * - isSegmenting: whether auto-detection / corner inference is currently running.
	 */

	let imageFile = $state<File | null>(null);
	let imageUrl = $state('');
	let imageEl = $state.raw<HTMLImageElement | null>(null);
	let warpedImageUrl = $state('');
	let segmentationMaskUrl = $state('');
	let isSegmenting = $state(false);

	/**
	 * Core adjustment state for corners, guides, and current selection.
	 * - corners: current source-image corner positions in natural image pixels.
	 * - activeCorner: currently selected source corner, if any.
	 * - activeGuide: currently selected warp guide line, if any.
	 * - ControlTarget: union describing what the arrow pad / keyboard will move.
	 * - selectedTarget: the currently controlled corner or guide.
	 * - guideInsetsPct: guide line insets inside the warp preview, expressed as percentages.
	 * - stepSize: percentage step used by keyboard and directional-pad adjustments.
	 */

	let corners = $state({
		topLeft: { x: 0, y: 0 },
		topRight: { x: 0, y: 0 },
		bottomLeft: { x: 0, y: 0 },
		bottomRight: { x: 0, y: 0 }
	});
	let activeCorner = $state<keyof typeof corners | null>(null);
	let activeGuide = $state<GuideKey | null>(null);
	type ControlTarget =
		| { type: 'corner'; key: keyof typeof corners }
		| { type: 'guide'; key: GuideKey }
		| null;
	let selectedTarget = $state<ControlTarget>(null);
	let guideInsetsPct = $state({
		top: 5,
		bottom: 5,
		left: 5,
		right: 5
	});
	let initialGuidesPending = true;
	let guideGuessGeneration = 0;
	let stepSize = $state(0.1);

// ---- Layout measurements and DOM refs ----
/**
	 * Layout measurements and DOM element references used for rendering math,
	 * positioning overlays, and capture/interaction helpers.
	 * - containerEl: source panel container element.
	 * - containerSize: current measured size of the source panel container.
	 * - displayedImageRect: rendered source image box inside the source panel.
	 * - warpContainerEl: warp preview container element.
	 * - warpDisplayedImageRect: rendered warp preview bounds.
	 * - cornerZoomCanvas: canvas used for the magnified active-corner preview.
	 * - sourceFocusTrapEl: wrapper used to manage keyboard focus among source controls.
	 * - warpScreenshotEl: element captured when exporting the warp preview snapshot.
	 */

	let containerEl = $state.raw<HTMLDivElement | null>(null);
	let containerSize = $state({ width: 1, height: 1 });
	let displayedImageRect = $state({ x: 0, y: 0, width: 1, height: 1 });
	let warpContainerEl = $state.raw<HTMLDivElement | null>(null);
	let warpDisplayedImageRect = $state({ x: 0, y: 0, width: 1, height: 1 });
	let cornerZoomCanvas = $state.raw<HTMLCanvasElement | null>(null);
	let sourceFocusTrapEl = $state.raw<HTMLDivElement | null>(null);
	let warpScreenshotEl = $state.raw<HTMLDivElement | null>(null);

	/**
	 * Zoom and display presentation state.
	 * - sourceViewZoom / sourceViewPan: current scale and translation for the source image.
	 * - warpViewZoom / warpViewPan: current scale and translation for the warped preview.
	 * - isViewPanning: whether a zoomed preview is currently being pointer-panned.
	 * - viewPanStart: pointer and pan coordinates captured at the beginning of a pan.
	 * - sourceImageVisible: delays image fade-in until layout is ready.
	 */

	let sourceViewZoom = $state(1);
	let sourceViewPan = $state({ x: 0, y: 0 });

	let warpViewZoom = $state(1);
	let warpViewPan = $state({ x: 0, y: 0 });

	let isViewPanning = false;
	let viewPanStart = { pointerX: 0, pointerY: 0, panX: 0, panY: 0 };
	let sourceImageVisible = $state(false);

// ---- Drag and gesture interaction state ----
/**
	 * Drag/gesture interaction state.
	 * - draggingCorner: corner currently being dragged on the source image.
	 * - didDragCorner: whether a real drag occurred before pointer release.
	 * - suppressClearSelectionUntil: short cooldown to prevent click-up from clearing selection.
	 * - draggingGuide: guide currently being dragged in the warp preview.
	 * - cornerDragStart: pointer and natural-image corner coordinates captured when corner dragging starts.
	 * - guideDragStart: pointer coordinates and guide inset captured when guide dragging starts.
	 */

	let draggingCorner: keyof typeof corners | null = null;
	let didDragCorner = $state(false);
	let suppressClearSelectionUntil = 0;
	let draggingGuide = $state<GuideKey | null>(null);
	let cornerDragStart = {
		pointerX: 0,
		pointerY: 0,
		cornerX: 0,
		cornerY: 0
	};
	let guideDragStart = {
		pointerX: 0,
		pointerY: 0,
		insetPct: 0
	};

// ---- UI flags, timers, and lifecycle helpers ----
/**
	 * UI flags, timers, and lifecycle helpers.
	 * - hideUploadTimeout: short settling timeout maintained after image controls become ready.
	 * - isDark: current warp preview theme toggle state.
	 * - warpEnhanceMode: visual enhancement applied to the warped card image.
	 * - nudgeWarpTimeout: debounce timer for rerunning the warp preview after movement.
	 * - hasAdjustedVerticalGuides: whether top/bottom guides have been manually touched.
	 * - hasAdjustedHorizontalGuides: whether left/right guides have been manually touched.
	 * - pendingDetection: whether segmentation should run once the source image fully loads.
	 * - imageReadyForControls: whether the source image/layout is ready for interactive controls.
	 * - resizeObserver: observes source/warp containers so display rects stay in sync with layout.
	 * - actionRowBusy: keeps the action-row loading transition active before file processing begins.
	 */

	let hideUploadTimeout: ReturnType<typeof setTimeout> | null = null;
	let isDark = $state(true);
	let warpEnhanceMode = $state<'original' | 'contrast' | 'grayscale'>('original');
	let nudgeWarpTimeout: ReturnType<typeof setTimeout> | null = null;
	let hasAdjustedVerticalGuides = $state(false);
	let hasAdjustedHorizontalGuides = $state(false);
	let pendingDetection = $state(false);
	let imageReadyForControls = $state(false);
	let resizeObserver: ResizeObserver;
	let actionRowBusy = $state(false);

// ---- UI helper functions ----
/**
	 * Small UI/helper utilities used by the page.
	 * - getPadButtonClass: returns the directional pad button classes based on active input state.
	 * - imageXToPercent / imageYToPercent: convert natural-image pixel coordinates into percentage
	 *   positions for SVG overlay placement on the rendered source image.
	 * - markGuideAdjusted: records whether vertical or horizontal warp guides have been manually touched,
	 *   which is used for perfect-centering highlight logic.
	 * - getOrderedCorners: converts local corner state into the ordered array shape used by warping.
	 */

	function getPadButtonClass(direction: Direction) {
		inputVisualTick;

		return `rounded-xl border px-3 py-2 transition select-none ${
			inputController.isDirectionActive(direction)
				? 'border-cyan-400 bg-cyan-500/15 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.45)]'
				: 'border-zinc-700 bg-zinc-950 hover:bg-zinc-800 text-zinc-100'
		}`;
	}
	function imageXToPercent(x: number) {
		return `${(x / Math.max(imageEl?.naturalWidth || 1, 1)) * 100}%`;
	}
	function imageYToPercent(y: number) {
		return `${(y / Math.max(imageEl?.naturalHeight || 1, 1)) * 100}%`;
	}
	function markGuideAdjusted(guideKey: GuideKey) {
		if (guideKey === 'top' || guideKey === 'bottom') {
			hasAdjustedVerticalGuides = true;
		}

		if (guideKey === 'left' || guideKey === 'right') {
			hasAdjustedHorizontalGuides = true;
		}
	}
	function getOrderedCorners() {
		return [
			{ id: 'top-left', ...corners.topLeft },
			{ id: 'top-right', ...corners.topRight },
			{ id: 'bottom-right', ...corners.bottomRight },
			{ id: 'bottom-left', ...corners.bottomLeft }
		];
	}

	/**
	 * Selection and movement helpers for the current control target.
	 * - selectTarget / activateTarget: set or clear the active corner/guide and keep
	 *   selectedTarget, activeCorner, and activeGuide in sync.
	 * - cycleWarpEnhanceMode / getWarpEnhanceLabel / getWarpEnhanceFilter: cycle and describe the
	 *   original, high-contrast, and grayscale-contrast warped-image presentation modes.
	 * - clearActiveSelection: clears the current selection unless a recent drag just ended
	 *   and selection clearing is still temporarily suppressed.
	 * - handleGlobalKeydown: clears the active target when Escape is pressed.
	 * - getCornerDelta: converts the configured percentage step into natural-image x/y movement.
	 * - nudgeSelected: applies directional input to the currently selected corner or guide.
	 * - moveCorner: updates a source corner position within image bounds and optionally schedules
	 *   a warp preview refresh.
	 * - moveGuideByKey: applies directional movement to a specified warp guide and marks
	 *   that guide group as manually adjusted.
	 * - scheduleNudgeWarp: debounces warp preview regeneration after movement changes.
	 */

	function selectTarget(target: ControlTarget) {
		if (!target) {
			selectedTarget = null;
			activeCorner = null;
			activeGuide = null;
			return;
		}

		if (target.type === 'corner') {
			activateTarget(target);
			return;
		}

		activateTarget(target);
	}

	function cycleWarpEnhanceMode() {
		warpEnhanceMode =
			warpEnhanceMode === 'original'
				? 'contrast'
				: warpEnhanceMode === 'contrast'
					? 'grayscale'
					: 'original';
	}

	function getWarpEnhanceLabel() {
		if (warpEnhanceMode === 'contrast') return 'High contrast';
		if (warpEnhanceMode === 'grayscale') return 'Grayscale contrast';
		return 'Original colors';
	}

	function getWarpEnhanceFilter() {
		if (warpEnhanceMode === 'contrast') return 'contrast(1.8) saturate(1.8)';
		if (warpEnhanceMode === 'grayscale') return 'grayscale(1) contrast(2.2)';
		return 'none';
	}

	function activateTarget(target: Exclude<ControlTarget, null>) {
		selectedTarget = target;

		if (target.type === 'corner') {
			activeCorner = target.key;
			activeGuide = null;
			return;
		}

		activeGuide = target.key;
		activeCorner = null;
	}
	function clearActiveSelection() {
		if (Date.now() < suppressClearSelectionUntil) return;
		selectTarget(null);
	}
	function handleGlobalKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			selectTarget(null);
		}
	}
	function getCornerDelta(direction: Direction) {
		if (!imageEl) return { dx: 0, dy: 0 };

		const pxStepX = (stepSize / 100) * imageEl.naturalWidth;
		const pxStepY = (stepSize / 100) * imageEl.naturalHeight;

		if (direction === 'up') return { dx: 0, dy: -pxStepY };
		if (direction === 'down') return { dx: 0, dy: pxStepY };
		if (direction === 'left') return { dx: -pxStepX, dy: 0 };
		if (direction === 'right') return { dx: pxStepX, dy: 0 };

		return { dx: 0, dy: 0 };
	}
	function nudgeSelected(direction: 'up' | 'down' | 'left' | 'right') {
		if (!selectedTarget) return;

		if (selectedTarget.type === 'corner') {
			const key = selectedTarget.key;

			const { dx, dy } = getCornerDelta(direction);
			moveCorner(key, dx, dy);

			return;
		}

		moveGuideByKey(selectedTarget.key, direction);
	}
	function moveCorner(cornerKey: keyof typeof corners, dx: number, dy: number, updateWarp = true) {
		if (!imageEl) return;

		const naturalWidth = imageEl.naturalWidth;
		const naturalHeight = imageEl.naturalHeight;

		if (!naturalWidth || !naturalHeight) return;

		corners = moveCornerValue(corners, cornerKey, dx, dy, naturalWidth, naturalHeight);

		if (updateWarp) {
			scheduleNudgeWarp();
		}
	}
	function moveGuideByKey(guideKey: GuideKey, direction: Direction) {
		markGuideAdjusted(guideKey);

		guideInsetsPct = applyGuideDirection(guideKey, direction, guideInsetsPct, stepSize);
	}
	function scheduleNudgeWarp() {
		if (nudgeWarpTimeout) clearTimeout(nudgeWarpTimeout);

		nudgeWarpTimeout = setTimeout(() => {
			runWarpPreview();
			nudgeWarpTimeout = null;
		}, NUDGE_WARP_DELAY);
	}

	/**
	 * Pointer drag handlers for direct mouse/touch adjustment.
	 * - onPointerMove: moves the active source corner relative to its drag-start position, compensating
	 *   for preview zoom and applying normal or Shift-modified fine sensitivity.
	 * - stopDrag: ends a corner drag, removes global listeners, preserves the dragged corner as selected,
	 *   and triggers a final warp preview refresh.
	 * - onGuidePointerMove: moves the active guide relative to its drag-start inset, compensating for
	 *   preview zoom and applying normal or Shift-modified fine sensitivity.
	 * - stopGuideDrag: ends a guide drag, removes global listeners, and preserves the dragged guide
	 *   as the active selection.
	 * - startGuideDrag: begins dragging a warp guide and attaches the global move/up listeners needed
	 *   for smooth dragging outside the initial hit area.
	 * - updateSize / updateDisplayedImageRect: measure the source viewport and fit the natural image
	 *   inside it while reserving overlay padding for the corner controls.
	 * - updateWarpDisplayedImageRect: synchronizes warp overlay dimensions with its container.
	 */

	function onPointerMove(e: PointerEvent) {
		if (!draggingCorner || !imageEl) return;

		didDragCorner = true;
		const sensitivity = e.shiftKey ? FINE_DRAG_SENSITIVITY : DRAG_SENSITIVITY;

		const displayDx =
			((e.clientX - cornerDragStart.pointerX) / sourceViewZoom) * sensitivity;
		const displayDy =
			((e.clientY - cornerDragStart.pointerY) / sourceViewZoom) * sensitivity;
		const naturalDx =
			(displayDx / Math.max(displayedImageRect.width, 1)) * imageEl.naturalWidth;
		const naturalDy =
			(displayDy / Math.max(displayedImageRect.height, 1)) * imageEl.naturalHeight;
		const nextX = Math.max(
			0,
			Math.min(imageEl.naturalWidth, cornerDragStart.cornerX + naturalDx)
		);
		const nextY = Math.max(
			0,
			Math.min(imageEl.naturalHeight, cornerDragStart.cornerY + naturalDy)
		);
		const current = corners[draggingCorner];

		moveCorner(draggingCorner, nextX - current.x, nextY - current.y, false);
	}
	function stopDrag() {
		const draggedCorner = draggingCorner;
		draggingCorner = null;

		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', stopDrag);

		if (draggedCorner) {
			selectTarget({ type: 'corner', key: draggedCorner });
		}
		if (didDragCorner) {
			suppressClearSelectionUntil = Date.now() + 250;
		}

		didDragCorner = false;
		runWarpPreview();
	}

	function onGuidePointerMove(e: PointerEvent) {
		if (!draggingGuide || !warpContainerEl) return;

		markGuideAdjusted(draggingGuide);

		const horizontal = draggingGuide === 'left' || draggingGuide === 'right';
		const sensitivity = e.shiftKey ? FINE_DRAG_SENSITIVITY : DRAG_SENSITIVITY;
		const pointerDelta = horizontal
			? e.clientX - guideDragStart.pointerX
			: e.clientY - guideDragStart.pointerY;
		const dimension = horizontal
			? warpDisplayedImageRect.width
			: warpDisplayedImageRect.height;
		const inwardDirection =
			draggingGuide === 'right' || draggingGuide === 'bottom' ? -1 : 1;
		const deltaPct =
			((pointerDelta / warpViewZoom) / Math.max(dimension, 1)) *
			100 *
			inwardDirection *
			sensitivity;

		guideInsetsPct[draggingGuide] = Math.max(
			0,
			Math.min(100, guideDragStart.insetPct + deltaPct)
		);
	}
	function stopGuideDrag() {
		window.removeEventListener('pointermove', onGuidePointerMove);
		window.removeEventListener('pointerup', stopGuideDrag);

		if (draggingGuide) {
			selectTarget({ type: 'guide', key: draggingGuide });
		}

		draggingGuide = null;
	}

	function startGuideDrag(e: PointerEvent, guideKey: GuideKey) {
		e.stopPropagation();
		e.preventDefault();

		selectTarget({ type: 'guide', key: guideKey });

		draggingGuide = guideKey;
		guideDragStart = {
			pointerX: e.clientX,
			pointerY: e.clientY,
			insetPct: guideInsetsPct[guideKey]
		};

		window.addEventListener('pointermove', onGuidePointerMove);
		window.addEventListener('pointerup', stopGuideDrag);
	}

	function updateSize() {
		if (!containerEl) return;

		containerSize = {
			width: containerEl.clientWidth,
			height: containerEl.clientHeight
		};

		updateDisplayedImageRect();
	}
	function updateDisplayedImageRect() {
		if (!containerEl || !imageEl) return;

		const containerWidth = containerSize.width;
		const containerHeight = containerSize.height;

		const naturalWidth = imageEl.naturalWidth;
		const naturalHeight = imageEl.naturalHeight;

		if (!naturalWidth || !naturalHeight) return;

		const imageAspect = naturalWidth / naturalHeight;

		const maxStageWidth = Math.min(
			Math.max(1, containerWidth - SOURCE_OVERLAY_PADDING * 2),
			720
		);
		const maxStageHeight = Math.min(
			Math.max(1, containerHeight - SOURCE_OVERLAY_PADDING * 2),
			960
		);

		let width = maxStageWidth;
		let height = width / imageAspect;

		if (height > maxStageHeight) {
			height = maxStageHeight;
			width = height * imageAspect;
		}

		const x = (containerWidth - width) / 2;
		const y = (containerHeight - height) / 2;

		displayedImageRect = { x, y, width, height };
	}
	function updateWarpDisplayedImageRect() {
		if (!warpContainerEl) return;

		const width = warpContainerEl.clientWidth;
		const height = warpContainerEl.clientHeight;

		warpDisplayedImageRect = {
			x: 0,
			y: 0,
			width,
			height
		};
	}

	/**
	 * Derived overlay measurements and corner-magnifier visibility.
	 * - topPx / bottomPx / leftPx / rightPx: convert percentage guide insets into preview pixels.
	 * - showCornerZoomPatch: shows the magnifier only with an active corner at base source zoom.
	 */
	const topPx = $derived((guideInsetsPct.top / 100) * warpDisplayedImageRect.height);
	const bottomPx = $derived((guideInsetsPct.bottom / 100) * warpDisplayedImageRect.height);
	const leftPx = $derived((guideInsetsPct.left / 100) * warpDisplayedImageRect.width);
	const rightPx = $derived((guideInsetsPct.right / 100) * warpDisplayedImageRect.width);
	const showCornerZoomPatch = $derived(imageUrl && activeCorner && sourceViewZoom <= 1.001);

	/**
	 * Independent source/warp preview zoom, pan, and pinch helpers.
	 * - IMAGE_VIEW_ZOOM_MIN / MAX / STEP: shared scale limits and wheel increment.
	 * - clampViewPan: constrains translation so a zoomed image cannot be panned beyond its bounds.
	 * - clampImageViewZoom: constrains a requested scale to the supported range.
	 * - getViewZoomStyle: serializes a panel's scale and translation into an inline transform.
	 * - ctrlWheelZoom: Svelte action that enables cursor-centered wheel zoom, pointer panning when
	 *   zoomed, and two-finger pinch zoom for either picture panel, with listener cleanup on destroy.
	 */

	const IMAGE_VIEW_ZOOM_MIN = 1;
	const IMAGE_VIEW_ZOOM_MAX = 4;
	const IMAGE_VIEW_ZOOM_STEP = 0.12;

	function clampViewPan(pan: { x: number; y: number }, zoom: number, kind: 'source' | 'warp') {
		if (zoom <= 1) return { x: 0, y: 0 };

		const rect = kind === 'source' ? displayedImageRect : warpDisplayedImageRect;

		const extraX = rect.width * (zoom - 1);
		const extraY = rect.height * (zoom - 1);

		return {
			x: Math.max(-extraX, Math.min(0, pan.x)),
			y: Math.max(-extraY, Math.min(0, pan.y))
		};
	}

	function clampImageViewZoom(value: number) {
		return Math.max(IMAGE_VIEW_ZOOM_MIN, Math.min(IMAGE_VIEW_ZOOM_MAX, value));
	}

	function getViewZoomStyle(kind: 'source' | 'warp') {
		const zoom = kind === 'source' ? sourceViewZoom : warpViewZoom;
		const pan = kind === 'source' ? sourceViewPan : warpViewPan;

		return `
		transform: translate(${pan.x}px, ${pan.y}px) scale(${zoom});
		transform-origin: top left;
		will-change: transform;
	`;
	}

	function ctrlWheelZoom(node: HTMLElement, kind: 'source' | 'warp') {
		let isPinching = false;
		let pinchStartDistance = 0;
		let pinchStartZoom = 1;
		let pinchImagePoint = { x: 0, y: 0 };

		function getZoom() {
			return kind === 'source' ? sourceViewZoom : warpViewZoom;
		}

		function getPan() {
			return kind === 'source' ? sourceViewPan : warpViewPan;
		}

		function setZoom(value: number) {
			if (kind === 'source') sourceViewZoom = value;
			else warpViewZoom = value;
		}

		function setPan(value: { x: number; y: number }) {
			if (kind === 'source') sourceViewPan = value;
			else warpViewPan = value;
		}

		function getBaseRectOffset() {
			if (kind === 'source') {
				return {
					x: displayedImageRect.x,
					y: displayedImageRect.y,
					width: displayedImageRect.width,
					height: displayedImageRect.height
				};
			}

			return {
				x: 0,
				y: 0,
				width: warpDisplayedImageRect.width,
				height: warpDisplayedImageRect.height
			};
		}

		function onWheel(e: WheelEvent) {
			e.preventDefault();
			e.stopPropagation();

			const oldZoom = getZoom();
			const oldPan = getPan();

			const direction = e.deltaY < 0 ? 1 : -1;
			const newZoom = clampImageViewZoom(oldZoom + direction * IMAGE_VIEW_ZOOM_STEP);

			const viewportRect = node.getBoundingClientRect();
			const base = getBaseRectOffset();

			const mouseX = e.clientX - viewportRect.left - base.x;
			const mouseY = e.clientY - viewportRect.top - base.y;

			const imageXBeforeZoom = (mouseX - oldPan.x) / oldZoom;
			const imageYBeforeZoom = (mouseY - oldPan.y) / oldZoom;

			const nextPan = {
				x: mouseX - imageXBeforeZoom * newZoom,
				y: mouseY - imageYBeforeZoom * newZoom
			};

			setZoom(newZoom);
			setPan(clampViewPan(nextPan, newZoom, kind));
		}

		function onPointerDown(e: PointerEvent) {
			if (getZoom() <= 1) return;

			const target = e.target as HTMLElement | null;
			if (target?.closest('button')) return;
			if (kind === 'warp') clearActiveSelection();

			e.preventDefault();
			e.stopPropagation();

			const currentPan = getPan();

			isViewPanning = true;

			viewPanStart = {
				pointerX: e.clientX,
				pointerY: e.clientY,
				panX: currentPan.x,
				panY: currentPan.y
			};

			node.setPointerCapture(e.pointerId);
		}

		function onPointerMove(e: PointerEvent) {
			if (!isViewPanning || isPinching) return;

			e.preventDefault();
			e.stopPropagation();

			const dx = e.clientX - viewPanStart.pointerX;
			const dy = e.clientY - viewPanStart.pointerY;

			setPan(
				clampViewPan(
					{
						x: viewPanStart.panX + dx,
						y: viewPanStart.panY + dy
					},
					getZoom(),
					kind
				)
			);
		}

		function onPointerUp(e: PointerEvent) {
			if (isPinching) return;
			if (!isViewPanning) return;

			isViewPanning = false;

			try {
				node.releasePointerCapture(e.pointerId);
			} catch {}
		}

		function getTouchMidpoint(touches: TouchList) {
			return {
				x: (touches[0].clientX + touches[1].clientX) / 2,
				y: (touches[0].clientY + touches[1].clientY) / 2
			};
		}

		function getTouchDistance(touches: TouchList) {
			return Math.hypot(
				touches[1].clientX - touches[0].clientX,
				touches[1].clientY - touches[0].clientY
			);
		}

		function onTouchStart(e: TouchEvent) {
			if (e.touches.length !== 2) return;

			e.preventDefault();
			e.stopPropagation();

			isPinching = true;
			isViewPanning = false;
			pinchStartDistance = Math.max(getTouchDistance(e.touches), 1);
			pinchStartZoom = getZoom();

			const midpoint = getTouchMidpoint(e.touches);
			const viewportRect = node.getBoundingClientRect();
			const base = getBaseRectOffset();
			const pan = getPan();
			const localX = midpoint.x - viewportRect.left - base.x;
			const localY = midpoint.y - viewportRect.top - base.y;

			pinchImagePoint = {
				x: (localX - pan.x) / pinchStartZoom,
				y: (localY - pan.y) / pinchStartZoom
			};
		}

		function onTouchMove(e: TouchEvent) {
			if (!isPinching || e.touches.length !== 2) return;

			e.preventDefault();
			e.stopPropagation();

			const midpoint = getTouchMidpoint(e.touches);
			const viewportRect = node.getBoundingClientRect();
			const base = getBaseRectOffset();
			const localX = midpoint.x - viewportRect.left - base.x;
			const localY = midpoint.y - viewportRect.top - base.y;
			const nextZoom = clampImageViewZoom(
				pinchStartZoom * (getTouchDistance(e.touches) / pinchStartDistance)
			);
			const nextPan = {
				x: localX - pinchImagePoint.x * nextZoom,
				y: localY - pinchImagePoint.y * nextZoom
			};

			setZoom(nextZoom);
			setPan(clampViewPan(nextPan, nextZoom, kind));
		}

		function onTouchEnd(e: TouchEvent) {
			if (!isPinching || e.touches.length >= 2) return;
			isPinching = false;
		}

		node.addEventListener('wheel', onWheel, { passive: false });
		node.addEventListener('touchstart', onTouchStart, { passive: false });
		node.addEventListener('touchmove', onTouchMove, { passive: false });
		node.addEventListener('touchend', onTouchEnd);
		node.addEventListener('touchcancel', onTouchEnd);
		node.addEventListener('pointerdown', onPointerDown);
		node.addEventListener('pointermove', onPointerMove);
		node.addEventListener('pointerup', onPointerUp);
		node.addEventListener('pointercancel', onPointerUp);

		return {
			destroy() {
				node.removeEventListener('wheel', onWheel);
				node.removeEventListener('touchstart', onTouchStart);
				node.removeEventListener('touchmove', onTouchMove);
				node.removeEventListener('touchend', onTouchEnd);
				node.removeEventListener('touchcancel', onTouchEnd);
				node.removeEventListener('pointerdown', onPointerDown);
				node.removeEventListener('pointermove', onPointerMove);
				node.removeEventListener('pointerup', onPointerUp);
				node.removeEventListener('pointercancel', onPointerUp);
			}
		};
	}

	/**
	 * File loading, reset, and cleanup helpers.
	 * - revokeWorkingUrls: revokes any active blob/object URLs used by the current source image,
	 *   warped preview, or segmentation mask to avoid leaking browser resources.
	 * - resetDerivedImageState: clears generated image outputs and restores zoom/display-related state
	 *   that depends on the currently loaded image.
	 * - resetAdjustmentState: clears the current control selection, restores default corner and guide
	 *   positions, and resets manual-adjustment tracking flags.
	 * - clearUploadInput: clears the hidden file input so the same file can be selected again if needed.
	 * - resetHandler: fully resets the tool to its default state, including file data, derived outputs,
	 *   adjustment state, pending detection, and UI preferences tied to the active session.
	 * - loadFile: initializes a newly selected image file, revokes any previous working URLs, creates a
	 *   fresh source blob URL, resets image-derived state, and marks detection to run after image load.
	 * - transitionThenLoadFile: starts the action-row transition, waits for it to finish, then loads a file.
	 * - loadTryMeImage: downloads the bundled sample image and sends it through the shared transition/load path.
	 * - handleFileChange: reads the file selected through the upload input and forwards it into the
	 *   transitioned file-loading pipeline.
	 * - handleDrop: reads the image dropped into the drop zone and forwards it into the shared
	 *   transitioned file-loading pipeline.
	 * - handleDragOver: prevents default browser drag behavior so the drop zone can accept files.
	 */
	function revokeWorkingUrls() {
		if (imageUrl) URL.revokeObjectURL(imageUrl);

		if (warpedImageUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(warpedImageUrl);
		}

		if (segmentationMaskUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(segmentationMaskUrl);
		}
	}

	function resetDerivedImageState() {
		warpedImageUrl = '';
		segmentationMaskUrl = '';

		sourceViewZoom = 1;
		sourceViewPan = { x: 0, y: 0 };

		warpViewZoom = 1;
		warpViewPan = { x: 0, y: 0 };

		imageReadyForControls = false;
		sourceImageVisible = false;
	}

	function resetAdjustmentState() {
		initialGuidesPending = true;
		guideGuessGeneration++;
		selectTarget(null);

		corners = {
			topLeft: { x: 0, y: 0 },
			topRight: { x: 0, y: 0 },
			bottomLeft: { x: 0, y: 0 },
			bottomRight: { x: 0, y: 0 }
		};

		guideInsetsPct = {
			top: 5,
			bottom: 5,
			left: 5,
			right: 5
		};

		hasAdjustedVerticalGuides = false;
		hasAdjustedHorizontalGuides = false;
	}

	function clearUploadInput() {
		const input = document.getElementById('image-upload') as HTMLInputElement | null;
		if (input) input.value = '';
	}
	function resetHandler() {
		revokeWorkingUrls();

		imageFile = null;
		imageUrl = '';
		actionRowBusy = false;

		resetDerivedImageState();
		resetAdjustmentState();

		pendingDetection = false;
		stepSize = 0.1;
		isDark = true;
		warpEnhanceMode = 'original';

		clearUploadInput();
	}
	function loadFile(file: File) {
		if (!file.type.startsWith('image/')) return;

		revokeWorkingUrls();

		imageFile = file;
		imageUrl = URL.createObjectURL(file);

		resetDerivedImageState();
		pendingDetection = true;
	}
	async function transitionThenLoadFile(file: File) {
		if (!file.type.startsWith('image/') || actionRowBusy || imageUrl) return;

		actionRowBusy = true;
		logUploadedImage(file);
		await new Promise((resolve) => setTimeout(resolve, ACTION_ROW_TRANSITION_MS));
		loadFile(file);
	}
	async function loadTryMeImage() {
		if (isSegmenting || actionRowBusy || imageUrl) return;

		try {
			actionRowBusy = true;
			const response = await fetch('/tryme.webp');

			if (!response.ok) {
				throw new Error('Could not load tryme.webp');
			}

			const blob = await response.blob();

			const file = new File([blob], 'tryme.webp', {
				type: blob.type || 'image/webp'
			});

			await new Promise((resolve) => setTimeout(resolve, ACTION_ROW_TRANSITION_MS));
			loadFile(file);
		} catch (error) {
			actionRowBusy = false;
			console.error('Failed to load Try Me image:', error);
		}
	}
	function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		void transitionThenLoadFile(file);
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		const file = event.dataTransfer?.files?.[0];
		if (!file) return;
		void transitionThenLoadFile(file);
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
	}

	/**
	 * Core image-processing and preview pipeline.
	 * - applyInitialSourceZoomToCorners: calculates and applies the initial source zoom/pan that frames
	 *   a newly detected quadrilateral while keeping its controls visible.
	 * - runWarpPreview: rebuilds the current ordered corner quad from local corner state, generates
	 *   a fresh warped preview data URL, and revokes any previous blob URL when applicable.
	 * - applyReturnedCorners: maps inference corner IDs into local corner state, updates the current
	 *   source-corner positions, and immediately reruns the warp preview.
	 * - runSegmentationInBrowser: runs corner inference for the current image, validates the response,
	 *   updates the segmentation mask and corner state, applies initial source framing, and marks the
	 *   controls ready once processing finishes.
	 * - handleSourceImageLoad: finalizes source-image readiness after the image has rendered, updates
	 *   layout measurements, reveals the source image, and triggers any pending detection request.
	 */
	function applyInitialSourceZoomToCorners() {
		if (!imageEl) return;

		const naturalWidth = imageEl.naturalWidth || 1;
		const naturalHeight = imageEl.naturalHeight || 1;

		const centerX =
			(corners.topLeft.x + corners.topRight.x + corners.bottomRight.x + corners.bottomLeft.x) / 4;

		const centerY =
			(corners.topLeft.y + corners.topRight.y + corners.bottomRight.y + corners.bottomLeft.y) / 4;

		const z = computeZoomMetrics({
			autoZoomToCorners: true,
			displayedImageRect,
			naturalWidth,
			naturalHeight,
			corners
		});

		const nextZoom = clampImageViewZoom(z.scale);

		const centerDisplayX = (centerX / naturalWidth) * displayedImageRect.width;
		const centerDisplayY = (centerY / naturalHeight) * displayedImageRect.height;

		const viewportCenterX = displayedImageRect.width / 2;
		const viewportCenterY = displayedImageRect.height / 2;

		sourceViewZoom = nextZoom;
		sourceViewPan = clampViewPan(
			{
				x: viewportCenterX - centerDisplayX * nextZoom,
				y: viewportCenterY - centerDisplayY * nextZoom
			},
			nextZoom,
			'source'
		);
	}

	function runWarpPreview() {
		if (!imageEl) return;

		const orderedCorners = getOrderedCorners();
		if (!orderedCorners) return;

		const unordered: Quad = [
			{ x: orderedCorners[0].x, y: orderedCorners[0].y },
			{ x: orderedCorners[1].x, y: orderedCorners[1].y },
			{ x: orderedCorners[2].x, y: orderedCorners[2].y },
			{ x: orderedCorners[3].x, y: orderedCorners[3].y }
		];

		const corners = ensureClockwise(orderCorners(unordered));

		try {
			const nextUrl = warpImageToDataUrl(imageEl, corners);

			if (warpedImageUrl?.startsWith('blob:')) {
				URL.revokeObjectURL(warpedImageUrl);
			}

			warpedImageUrl = nextUrl;
            if (initialGuidesPending) {
                initialGuidesPending = false;
                const generation = guideGuessGeneration;
                void guessInnerBorders(nextUrl, { ...guideInsetsPct }).then((guess) => {
                    if (generation !== guideGuessGeneration || warpedImageUrl !== nextUrl) return;
                    if (!hasAdjustedVerticalGuides) {
                        guideInsetsPct.top = guess.top;
                        guideInsetsPct.bottom = guess.bottom;
                    }
                    if (!hasAdjustedHorizontalGuides) {
                        guideInsetsPct.left = guess.left;
                        guideInsetsPct.right = guess.right;
                    }
                }).catch(() => { /* Keep editable default guides if the image cannot be read. */ });
            }
		} catch (error) {
			console.error('Frontend warp failed:', error);
		}
	}
	function applyReturnedCorners(returnedCorners: Array<{ id: string; x: number; y: number }>) {
		const mapped: typeof corners = {
			topLeft: { x: corners.topLeft.x, y: corners.topLeft.y },
			topRight: { x: corners.topRight.x, y: corners.topRight.y },
			bottomRight: { x: corners.bottomRight.x, y: corners.bottomRight.y },
			bottomLeft: { x: corners.bottomLeft.x, y: corners.bottomLeft.y }
		};

		for (const corner of returnedCorners) {
			if (corner.id === 'top-left') {
				mapped.topLeft = { x: corner.x, y: corner.y };
			} else if (corner.id === 'top-right') {
				mapped.topRight = { x: corner.x, y: corner.y };
			} else if (corner.id === 'bottom-right') {
				mapped.bottomRight = { x: corner.x, y: corner.y };
			} else if (corner.id === 'bottom-left') {
				mapped.bottomLeft = { x: corner.x, y: corner.y };
			}
		}

		corners = mapped;
		runWarpPreview();
	}
	async function runSegmentationInBrowser() {
		if (!imageFile || !imageEl) return;

		isSegmenting = true;

		try {
			const result = await inferCorners(imageFile);

			if (segmentationMaskUrl?.startsWith('blob:')) {
				URL.revokeObjectURL(segmentationMaskUrl);
			}
			segmentationMaskUrl = result.mask_data_url;

			console.log('Browser inference corners', result.corners);

			if (!result.ok || !result.corners) {
				throw new Error('Browser inference did not return corners');
			}

			if (
				!Array.isArray(result.corners) ||
				result.corners.length !== 4 ||
				result.corners.some((c: any) => !Number.isFinite(c.x) || !Number.isFinite(c.y))
			) {
				throw new Error('Browser inference returned invalid corners');
			}

			applyReturnedCorners(result.corners);

			if (sourceViewZoom === 1) {
				await tick();

				requestAnimationFrame(() => {
					applyInitialSourceZoomToCorners();
				});
			}
		} catch (error) {
			console.error(error);
		} finally {
			isSegmenting = false;
			imageReadyForControls = true;
			actionRowBusy = false;
		}
	}
	async function handleSourceImageLoad() {
		updateSize();

		// let the image become visible first
		sourceImageVisible = true;

		// give the browser a couple frames to paint the fade cleanly
		await tick();
		await new Promise((resolve) => requestAnimationFrame(resolve));
		await new Promise((resolve) => requestAnimationFrame(resolve));

		imageReadyForControls = true;

		if (pendingDetection) {
			pendingDetection = false;

			// Let the Loading/Running button transition start before segmentation work begins.
			await tick();

			runSegmentationInBrowser();
		}
	}

	/**
	 * Miscellaneous interaction and export helpers.
	 * - handleSourceTrapKeydown: traps Tab navigation within the source corner controls.
	 * - handleWarpTrapKeydown: traps Tab navigation within the warped-preview guide controls.
	 * - miniMapFocusOrder / handleMiniMapTrapKeydown: define clockwise corner/side order and trap Tab
	 *   navigation within the card-controls minimap while activating the newly focused target.
	 * - captureWarpPanel: captures the warp preview area as a PNG image using html2canvas, downloads it,
	 *   and revokes the temporary blob URL after export.
	 */

	function handleSourceTrapKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !imageUrl) return;

		const panel = event.currentTarget as HTMLElement;
		const target = event.target as HTMLElement;
		if (target.closest('[data-focus-trap]') !== panel) return;

		const cornerOrder = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
		const focusable = cornerOrder
			.map((cornerKey) =>
				panel.querySelector<HTMLButtonElement>(
					`button[data-source-corner="true"][data-corner-key="${cornerKey}"]`
				)
			)
			.filter((el): el is HTMLButtonElement => !!el && !el.disabled);

		if (!focusable.length) return;

		const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);

		let nextEl: HTMLButtonElement;

		if (currentIndex === -1) {
			nextEl = focusable.find((el) => el.getAttribute('aria-pressed') === 'true') ?? focusable[0];
		} else if (event.shiftKey) {
			const prevIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
			nextEl = focusable[prevIndex];
		} else {
			const nextIndex = currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
			nextEl = focusable[nextIndex];
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		nextEl.focus();

		const cornerKey = nextEl.dataset.cornerKey as keyof typeof corners | undefined;
		if (cornerKey) {
			activateTarget({ type: 'corner', key: cornerKey });
		}
	}

	function handleWarpTrapKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !warpedImageUrl) return;

		const panel = event.currentTarget as HTMLElement;
		const target = event.target as HTMLElement;
		if (target.closest('[data-focus-trap]') !== panel) return;

		const guideOrder: GuideKey[] = ['top', 'right', 'bottom', 'left'];
		const focusable = guideOrder
			.map((guideKey) =>
				panel.querySelector<HTMLButtonElement>(
					`button[data-warp-guide="true"][data-guide-key="${guideKey}"]`
				)
			)
			.filter((el): el is HTMLButtonElement => !!el && !el.disabled);

		if (!focusable.length) return;

		const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
		let nextEl: HTMLButtonElement;

		if (currentIndex === -1) {
			nextEl =
				focusable.find((el) => el.getAttribute('aria-pressed') === 'true') ?? focusable[0];
		} else if (event.shiftKey) {
			const prevIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
			nextEl = focusable[prevIndex];
		} else {
			const nextIndex = currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
			nextEl = focusable[nextIndex];
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		nextEl.focus();

		const guideKey = nextEl.dataset.guideKey as GuideKey | undefined;
		if (guideKey) {
			activateTarget({ type: 'guide', key: guideKey });
		}
	}

	const miniMapFocusOrder = [
		{ label: 'Select top left corner', target: { type: 'corner', key: 'topLeft' } },
		{ label: 'Select top edge', target: { type: 'guide', key: 'top' } },
		{ label: 'Select top right corner', target: { type: 'corner', key: 'topRight' } },
		{ label: 'Select right edge', target: { type: 'guide', key: 'right' } },
		{ label: 'Select bottom right corner', target: { type: 'corner', key: 'bottomRight' } },
		{ label: 'Select bottom edge', target: { type: 'guide', key: 'bottom' } },
		{ label: 'Select bottom left corner', target: { type: 'corner', key: 'bottomLeft' } },
		{ label: 'Select left edge', target: { type: 'guide', key: 'left' } }
	] as const;

	function handleMiniMapTrapKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;

		const miniMap = event.currentTarget as HTMLElement;
		const focusable = miniMapFocusOrder
			.map(({ label, target }) => {
				const element = miniMap.querySelector<SVGElement>(`[aria-label="${label}"]`);
				return element ? { element, target } : null;
			})
			.filter(
				(
					item
				): item is {
					element: SVGElement;
					target: (typeof miniMapFocusOrder)[number]['target'];
				} => item !== null
			);

		if (!focusable.length) return;

		const currentIndex = focusable.findIndex(({ element }) => element === document.activeElement);
		const nextIndex =
			currentIndex === -1
				? 0
				: event.shiftKey
					? currentIndex <= 0
						? focusable.length - 1
						: currentIndex - 1
					: currentIndex === focusable.length - 1
						? 0
						: currentIndex + 1;
		const next = focusable[nextIndex];

		event.preventDefault();
		next.element.focus();
		activateTarget(next.target);
	}

	async function captureWarpPanel() {
		if (!warpScreenshotEl) {
			console.log('No warpScreenshotEl');
			return;
		}

		try {
			const canvas = await html2canvas(warpScreenshotEl, {
				backgroundColor: null,
				scale: 2,
				useCORS: true,
				logging: false,
				onclone: (clonedDocument) => {
					// Canvas export does not reliably support masks or gradient-clipped text.
					// Change only the detached export document, preserving the live animation.
					const style = clonedDocument.createElement('style');
					style.textContent = `
						.centering-rgb-glow::before, .centering-rgb-glow::after {
							content: none !important;
							display: none !important;
						}
						.centering-rgb-glow {
							animation: none !important;
							background: #101014 !important;
							border-color: #d946ef !important;
							box-shadow: 0 0 12px rgba(168, 85, 247, 0.45) !important;
						}
						.centering-rgb-value {
							animation: none !important;
							background: none !important;
							color: #e879f9 !important;
							-webkit-text-fill-color: #e879f9 !important;
							filter: none !important;
							text-shadow: 0 0 3px rgba(217, 70, 239, 0.35) !important;
						}
					`;
					clonedDocument.head.appendChild(style);
					// html2canvas materializes pseudo-elements before invoking onclone.
					clonedDocument.querySelectorAll('.centering-rgb-glow > html2canvaspseudoelement')
						.forEach((overlay) => overlay.remove());
				}
			});

			canvas.toBlob((blob) => {
				if (!blob) {
					console.error('Failed to create blob from canvas');
					return;
				}

				const blobUrl = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = blobUrl;
				a.download = 'card-centering-warp-preview.png';
				document.body.appendChild(a);
				a.click();
				a.remove();

				setTimeout(() => {
					URL.revokeObjectURL(blobUrl);
				}, 1000);
			}, 'image/png');
		} catch (error) {
			console.error('Failed to capture warp preview:', error);
		}
	}

	/**
	 * Derived centering metrics and “perfect alignment” flags used by the UI.
	 * - centeringStats: computed percentage split for top/bottom and left/right borders.
	 * - PERFECT_TOLERANCE: maximum percentage-point difference from 50 allowed for a perfect result.
	 * - verticalIsPerfect: true when vertical guide percentages are essentially 50/50
	 *   and the user has already adjusted vertical guides.
	 * - horizontalIsPerfect: true when horizontal guide percentages are essentially 50/50
	 *   and the user has already adjusted horizontal guides.
	 */

	const centeringStats = $derived(
		getCenteringStats({
			top: topPx,
			bottom: bottomPx,
			left: leftPx,
			right: rightPx
		})
	);

	const PERFECT_TOLERANCE = 0.4;

	const verticalIsPerfect = $derived(
		hasAdjustedVerticalGuides &&
			Math.abs(centeringStats.topPct - 50) <= PERFECT_TOLERANCE &&
			Math.abs(centeringStats.bottomPct - 50) <= PERFECT_TOLERANCE
	);

	const horizontalIsPerfect = $derived(
		hasAdjustedHorizontalGuides &&
			Math.abs(centeringStats.leftPct - 50) <= PERFECT_TOLERANCE &&
			Math.abs(centeringStats.rightPct - 50) <= PERFECT_TOLERANCE
	);

	/**
	 * Watches control-readiness state and clears any pending delayed-upload timeout
	 * while the image is still loading or segmentation is running.
	 *
	 * Once the UI is ready, it briefly keeps the timeout alive, then clears the
	 * timer reference after the short delay. The cleanup function ensures no stale
	 * timeout survives when the dependencies change or the component reruns.
	 */

	$effect(() => {
		const shouldShow = !imageReadyForControls || isSegmenting;

		if (shouldShow) {
			if (hideUploadTimeout) {
				clearTimeout(hideUploadTimeout);
				hideUploadTimeout = null;
			}
			return;
		}

		if (hideUploadTimeout) clearTimeout(hideUploadTimeout);

		hideUploadTimeout = setTimeout(() => {
			hideUploadTimeout = null;
		}, 220);

		return () => {
			if (hideUploadTimeout) {
				clearTimeout(hideUploadTimeout);
				hideUploadTimeout = null;
			}
		};
	});

	/**
	 * Reattaches the shared ResizeObserver to the current source and warp container
	 * elements whenever those element references change.
	 *
	 * This keeps layout measurements in sync after remounts, conditional rendering,
	 * or DOM replacement during state transitions.
	 */

	$effect(() => {
		if (!resizeObserver) return;

		resizeObserver.disconnect();

		if (containerEl) {
			resizeObserver.observe(containerEl);
		}

		if (warpContainerEl) {
			resizeObserver.observe(warpContainerEl);
		}
	});

	/**
	 * When a new warped image URL is produced, waits until the next task so the DOM
	 * can paint the updated image, then recomputes the warp preview display bounds.
	 *
	 * This keeps guide overlays aligned to the visible warped image after rerender.
	 */

	$effect(() => {
		if (!warpedImageUrl) return;

		setTimeout(() => {
			updateWarpDisplayedImageRect();
		}, 0);
	});

	/**
	 * Reacts to active-corner changes, corner coordinate updates, and source-image
	 * changes, then redraws the magnified corner preview canvas on the next task.
	 *
	 * Explicit property reads are used to make the effect rerun whenever any corner
	 * position changes, ensuring the zoom patch and connecting guide lines stay in
	 * sync with manual adjustments.
	 */

	$effect(() => {
		showCornerZoomPatch;
		activeCorner;
		corners.topLeft.x;
		corners.topLeft.y;
		corners.topRight.x;
		corners.topRight.y;
		corners.bottomRight.x;
		corners.bottomRight.y;
		corners.bottomLeft.x;
		corners.bottomLeft.y;
		imageUrl;

		if (!showCornerZoomPatch) return;

		requestAnimationFrame(() => {
			drawCornerZoomPatch({
				canvas: cornerZoomCanvas,
				image: imageEl,
				activeCorner: activeCorner as CornerKey | null,
				corners: corners as CornerMap,
				patchRadius: CORNER_PATCH_RADIUS,
				outputSize: CORNER_ZOOM_SIZE
			});
		});
	});

	/**
	 * Component lifecycle hooks.
	 * - onDestroy: performs final cleanup when the page/component is removed by revoking active blob URLs,
	 *   clearing pending warp-refresh timers, and detaching any global pointer listeners left from an active guide drag.
	 * - onMount: starts loading the browser inference model, initializes the shared ResizeObserver and global
	 *   keyboard listeners, then returns cleanup that disconnects observers, removes listeners, and destroys
	 *   the input controller.
	 */

	onMount(() => {
		void preloadInferenceModel().catch((error) => {
			console.warn('Could not preload the browser inference model; upload will retry.', error);
		});

		resizeObserver = new ResizeObserver(() => {
			updateSize();
			updateWarpDisplayedImageRect();
		});

		window.addEventListener('keydown', inputController.handleKeydown);
	window.addEventListener('keydown', handleGlobalKeydown);
	window.addEventListener('keyup', inputController.handleKeyup);
	window.addEventListener('blur', inputController.clearPressedDirections);

	return () => {
		resizeObserver?.disconnect();
		window.removeEventListener('keydown', inputController.handleKeydown);
		window.removeEventListener('keydown', handleGlobalKeydown);
			window.removeEventListener('blur', inputController.clearPressedDirections);
			inputController.destroy();
		};
	});

	onDestroy(() => {
		if (imageUrl) URL.revokeObjectURL(imageUrl);

		if (warpedImageUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(warpedImageUrl);
		}

		if (segmentationMaskUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(segmentationMaskUrl);
		}

		if (nudgeWarpTimeout) {
			clearTimeout(nudgeWarpTimeout);
		}

		// ✅ only clean up if actively dragging
		if (draggingGuide) {
			window.removeEventListener('pointermove', onGuidePointerMove);
			window.removeEventListener('pointerup', stopGuideDrag);
		}
	});
</script>

<!-- Page shell and top-level layout -->
<div class="w-full overflow-x-hidden">
	<div
		class="flex min-h-screen flex-col bg-zinc-950
		text-zinc-100 select-none"
	>
		<!-- Application header -->
		<header class="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
			<div class="max-w-8xl mx-auto flex items-center justify-end px-6 py-4">
				<div class="text-right">
					<h1 class="text-2xl font-semibold tracking-tight">Card Centering</h1>
					<p class="text-sm text-zinc-400">Upload, detect, refine, and warp</p>
				</div>
			</div>
		</header>

		<main class="mx-auto flex w-full flex-1 flex-col gap-6 px-6 py-6">
			<!-- Main tool layout: adjustment panel, source preview, warp preview -->
			<div class="grid w-full items-start gap-6 xl:grid-cols-[420px_auto_auto] xl:justify-center">
				<section
					class="flex w-full xl:w-[420px] flex-col overflow-hidden border border-zinc-800 bg-zinc-900 shadow-sm"
				>
					<div class="border-b border-zinc-800 px-5 py-4">
						<h2 class="text-sm font-semibold tracking-wide text-zinc-300 uppercase">Adjustments</h2>
						<p class="text-xs text-zinc-500">
							Use the directional pads to nudge each corner precisely
						</p>
					</div>

					<div class="p-5">
						<div class="mb-5 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
							<div class="space-y-4">
								<!-- row 1: Try Me + Upload before image, Reset after image -->
								<div>
									<div
										class="grid overflow-hidden"
										style={`grid-template-columns: ${
											actionRowBusy || imageUrl
												? 'minmax(0, 0fr) minmax(0, 1fr)'
												: 'minmax(0, 1fr) minmax(0, 3fr)'
										}; column-gap: ${actionRowBusy || imageUrl ? '0rem' : '0.75rem'}; transition: grid-template-columns 650ms cubic-bezier(0.22, 1, 0.36, 1), column-gap 650ms cubic-bezier(0.22, 1, 0.36, 1);`}
									>
											<div class="min-w-0 overflow-hidden">
												<button
													class={`w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 hover:border-cyan-400 hover:bg-zinc-800 hover:text-cyan-300 ${
														actionRowBusy || imageUrl
															? 'pointer-events-none border-0 px-0 opacity-0'
															: 'opacity-100'
													}`}
													style="transition: opacity 400ms ease, padding 500ms ease, border-width 400ms ease;"
													type="button"
													onclick={loadTryMeImage}
													disabled={!!imageUrl}
												>
													<span class="whitespace-nowrap">Try Me</span>
												</button>
											</div>

											<button
												class={`min-w-0 rounded-lg border px-3 py-2.5 text-sm ${
													actionRowBusy
														? 'border-blue-400 bg-zinc-800 text-blue-300 animate-pulse shadow-[0_0_12px_rgba(59,130,246,0.7)]'
														: 'border-cyan-400 bg-zinc-900 text-cyan-300 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.5)] hover:bg-zinc-800'
												}`}
												style="transition: box-shadow 400ms ease, background-color 400ms ease, border-color 400ms ease, color 400ms ease;"
												type="button"
												onclick={() => {
													if (actionRowBusy) return;
													if (imageUrl) {
														resetHandler();
													} else {
														document.getElementById('image-upload')?.click();
													}
												}}
												disabled={actionRowBusy}
											>
												{actionRowBusy || isSegmenting
													? 'Running...'
													: !imageUrl
														? 'Upload'
														: 'Reset'}
											</button>
									</div>
									<p id="upload-retention-note" class="mt-2 text-xs text-zinc-400">Uploaded images may be retained to help improve card detection.</p>
								</div>

								<!-- row 2: step size -->
								<div class="space-y-2">
									<label
										for="step-size"
										class="text-xs font-medium tracking-wide text-zinc-400 uppercase"
									>
										Step Size
									</label>

									<select
										id="step-size"
										bind:value={stepSize}
										onchange={(e) => {
											stepSize = Number((e.currentTarget as HTMLSelectElement).value);
											(e.currentTarget as HTMLSelectElement).blur();
										}}
										class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm transition outline-none focus:border-blue-500"
									>
										<option value={0.01}>0.01%</option>
										<option value={0.025}>0.025%</option>
										<option value={0.05}>0.05%</option>
										<option value={0.1}>.1%</option>
									</select>
								</div>
							</div>
						</div>

						<div class="hidden xl:block rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
							<div class="mb-3 flex items-center justify-between">
								<div class="text-xs font-medium tracking-[0.2em] text-zinc-500 uppercase">
									Card Controls MINI MAP
								</div>
							</div>

							<div
								class="mx-auto flex max-w-[260px] flex-col items-center gap-1 p-2"
								role="toolbar"
								aria-label="Card controls mini map"
								tabindex="-1"
								onkeydown={handleMiniMapTrapKeydown}
							>
								<!-- labels -->
								<text
									x="110"
									y="235"
									text-anchor="middle"
									class="fill-zinc-400 text-[12px] tracking-[0.2em]"
								>
									CORNERS = SOURCE
								</text>
								<text
									x="110"
									y="255"
									text-anchor="middle"
									class="fill-zinc-500 text-[12px] tracking-[0.2em]"
								>
									SIDES = WARP
								</text>
								<svg
									viewBox="0 0 220 210"
									class="w-full overflow-visible"
								>
									<!-- card body -->
									<rect
										x="60"
										y="30"
										width="100"
										height="140"
										rx="18"
										class="fill-zinc-900 stroke-zinc-700"
										stroke-width="2"
									/>

							<rect
								x="60"
								y="30"
								width="100"
								height="140"
								rx="18"
								fill="transparent"
								pointer-events="all"
								class="cursor-pointer"
								role="button"
								tabindex="0"
								aria-label="Deselect corners and edges"
								onclick={(e) => {
									e.stopPropagation();
									selectTarget(null);
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
										e.preventDefault();
										selectTarget(null);
									}
								}}
							/>
									<!-- top -->
									<line
										x1="60"
										y1="30"
										x2="160"
										y2="30"
										stroke={activeGuide === 'top' ? '#60a5fa' : '#52525b'}
										stroke-width="3"
										stroke-linecap="round"
									/>
									<line
										x1="60"
										y1="30"
										x2="160"
										y2="30"
										stroke="transparent"
										stroke-width="20"
										stroke-linecap="round"
										class="cursor-pointer focus:outline-none"
										role="button"
										tabindex="0"
										aria-label="Select top edge"
										onclick={(e) => {
											e.stopPropagation();
											selectTarget({ type: 'guide', key: 'top' });
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectTarget({ type: 'guide', key: 'top' });
											}
										}}
									/>

									<!-- right -->
									<line
										x1="160"
										y1="30"
										x2="160"
										y2="170"
										stroke={activeGuide === 'right' ? '#60a5fa' : '#52525b'}
										stroke-width="3"
										stroke-linecap="round"
									/>
									<line
										x1="160"
										y1="30"
										x2="160"
										y2="170"
										stroke="transparent"
										stroke-width="20"
										stroke-linecap="round"
										class="cursor-pointer focus:outline-none"
										role="button"
										tabindex="0"
										aria-label="Select right edge"
										onclick={(e) => {
											e.stopPropagation();
											selectTarget({ type: 'guide', key: 'right' });
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectTarget({ type: 'guide', key: 'right' });
											}
										}}
									/>

									<!-- bottom -->
									<line
										x1="60"
										y1="170"
										x2="160"
										y2="170"
										stroke={activeGuide === 'bottom' ? '#60a5fa' : '#52525b'}
										stroke-width="3"
										stroke-linecap="round"
									/>
									<line
										x1="60"
										y1="170"
										x2="160"
										y2="170"
										stroke="transparent"
										stroke-width="20"
										stroke-linecap="round"
										class="cursor-pointer focus:outline-none"
										role="button"
										tabindex="0"
										aria-label="Select bottom edge"
										onclick={(e) => {
											e.stopPropagation();
											selectTarget({ type: 'guide', key: 'bottom' });
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectTarget({ type: 'guide', key: 'bottom' });
											}
										}}
									/>

									<!-- left -->
									<line
										x1="60"
										y1="30"
										x2="60"
										y2="170"
										stroke={activeGuide === 'left' ? '#60a5fa' : '#52525b'}
										stroke-width="3"
										stroke-linecap="round"
									/>
									<line
										x1="60"
										y1="30"
										x2="60"
										y2="170"
										stroke="transparent"
										stroke-width="20"
										stroke-linecap="round"
										class="cursor-pointer focus:outline-none"
										role="button"
										tabindex="0"
										aria-label="Select left edge"
										onclick={(e) => {
											e.stopPropagation();
											selectTarget({ type: 'guide', key: 'left' });
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectTarget({ type: 'guide', key: 'left' });
											}
										}}
									/>

									<!-- corner hotspots -->
									<circle
										cx="60"
										cy="30"
										r="12"
										role="button"
										tabindex="0"
										aria-label="Select top left corner"
										class={activeCorner === 'topLeft'
											? 'fill-cyan-400 stroke-cyan-300 cursor-pointer focus:outline-none'
											: 'fill-zinc-700 stroke-zinc-500 cursor-pointer focus:outline-none'}
										stroke-width="2"
										onclick={() => selectTarget({ type: 'corner', key: 'topLeft' })}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectTarget({ type: 'corner', key: 'topLeft' });
											}
										}}
									/>

									<circle
										cx="160"
										cy="30"
										r="12"
										role="button"
										tabindex="0"
										aria-label="Select top right corner"
										class={activeCorner === 'topRight'
											? 'fill-cyan-400 stroke-cyan-300 cursor-pointer focus:outline-none'
											: 'fill-zinc-700 stroke-zinc-500 cursor-pointer focus:outline-none'}
										stroke-width="2"
										onclick={() => selectTarget({ type: 'corner', key: 'topRight' })}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectTarget({ type: 'corner', key: 'topRight' });
											}
										}}
									/>

									<circle
										cx="60"
										cy="170"
										r="12"
										role="button"
										tabindex="0"
										aria-label="Select bottom left corner"
										class={activeCorner === 'bottomLeft'
											? 'fill-cyan-400 stroke-cyan-300 cursor-pointer focus:outline-none'
											: 'fill-zinc-700 stroke-zinc-500 cursor-pointer focus:outline-none'}
										stroke-width="2"
										onclick={() => selectTarget({ type: 'corner', key: 'bottomLeft' })}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectTarget({ type: 'corner', key: 'bottomLeft' });
											}
										}}
									/>

									<circle
										cx="160"
										cy="170"
										r="12"
										role="button"
										tabindex="0"
										aria-label="Select bottom right corner"
										class={activeCorner === 'bottomRight'
											? 'fill-cyan-400 stroke-cyan-300 cursor-pointer focus:outline-none'
											: 'fill-zinc-700 stroke-zinc-500 cursor-pointer focus:outline-none'}
										stroke-width="2"
										onclick={() => selectTarget({ type: 'corner', key: 'bottomRight' })}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectTarget({ type: 'corner', key: 'bottomRight' });
											}
										}}
									/>
								</svg>
								<div class="grid grid-cols-3 gap-2">
									<div></div>
									<button
										class={getPadButtonClass('up')}
										type="button"
										onpointerdown={(e) => {
											e.preventDefault();
											e.currentTarget.setPointerCapture(e.pointerId);
											inputController.startPadHold('up');
										}}
										onpointerup={inputController.stopPadHold}
										onpointercancel={inputController.stopPadHold}
										onlostpointercapture={inputController.stopPadHold}
									>
										↑
									</button>
									<div></div>

									<button
										class={getPadButtonClass('left')}
										type="button"
										onpointerdown={(e) => {
											e.preventDefault();
											e.currentTarget.setPointerCapture(e.pointerId);
											inputController.startPadHold('left');
										}}
										onpointerup={inputController.stopPadHold}
										onpointercancel={inputController.stopPadHold}
										onlostpointercapture={inputController.stopPadHold}
									>
										←
									</button>

									<button
										class="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
										type="button"
										onclick={() => {
											selectTarget(null);
											inputController.stopPadHold();
										}}
									>
										•
									</button>

									<button
										class={getPadButtonClass('right')}
										type="button"
										onpointerdown={(e) => {
											e.preventDefault();
											e.currentTarget.setPointerCapture(e.pointerId);
											inputController.startPadHold('right');
										}}
										onpointerup={inputController.stopPadHold}
										onpointercancel={inputController.stopPadHold}
										onlostpointercapture={inputController.stopPadHold}
									>
										→
									</button>

									<div></div>
									<button
										class={getPadButtonClass('down')}
										type="button"
										onpointerdown={(e) => {
											e.preventDefault();
											e.currentTarget.setPointerCapture(e.pointerId);
											inputController.startPadHold('down');
										}}
										onpointerup={inputController.stopPadHold}
										onpointercancel={inputController.stopPadHold}
										onlostpointercapture={inputController.stopPadHold}
									>
										↓
									</button>
									<div></div>
								</div>
							</div>
						</div>

						<div class="mt-5 w-full rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5">
							<div class="space-y-3 text-sm leading-relaxed text-zinc-400">
								<div class="text-xs font-medium tracking-wide text-zinc-500 uppercase">
									About This Tool
								</div>

								<p>
									This tool helps you analyze Pokemon TCG centering by auto-detecting edges and
									measuring border spacing.
								</p>

								<div class="pt-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
									How to Use
								</div>

								<ul class="list-disc space-y-1 pl-5">
									<li>Upload a card image to begin detection.</li>
									<li>
										Use the mini card as a control map. Select a corner or side on the mini card to
										adjust that same part of the card in the preview panels.
									</li>
									<li>
										Line up the corners of the card. WASD, arrow pads, directional keys, and mouse
										can be used to adjust. Zoom in for a closer view with ctrl + mouse wheel.
									</li>
									<li>
										Use the warp preview to verify alignment. WASD, arrow pads, directional keys,
										and mouse can be used to adjust. Zoom in for a closer view with ctrl + mouse
										wheel.
									</li>
									<li>
										Check centering percentages. % Turns red when the border ratio exceeds PSA 10
										standards.
									</li>
									<li>Day/Night mode in the warp preview can be used to help find border edge.</li>
									<li>Snapshot of warp preview panel can be taken with camera icon.</li>
								</ul>

								<p class="pt-2">
									Use this before grading to quickly check centering accuracy and border balance.
								</p>
							</div>
						</div>
					</div>
				</section>

				<section
					class="w-full xl:w-[525px] justify-self-center self-start flex flex-col border border-zinc-800 bg-zinc-900 shadow-sm"
				>
					<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
						<div>
							<h2 class="text-sm font-semibold tracking-wide text-zinc-300 uppercase">Source</h2>
							<p class="text-xs text-zinc-500">Original image with corner overlay</p>
						</div>
					</div>

					<div
						class="relative aspect-[5/7] w-full border border-dashed border-zinc-700 bg-zinc-950"
					>
						<div
							role="button"
							tabindex="0"
							class={`group flex h-full w-full items-center justify-center overflow-hidden border border-zinc-700 bg-zinc-950 transition ${
								imageUrl
									? 'cursor-default opacity-80'
									: 'cursor-pointer hover:border-zinc-500 hover:bg-zinc-900'
							}`}
							ondrop={!imageUrl ? handleDrop : undefined}
							ondragover={!imageUrl ? handleDragOver : undefined}
							onclick={() => {
								if (!imageUrl) {
									document.getElementById('image-upload')?.click();
								}
							}}
							onkeydown={(e) => {
								if (e.key !== 'Enter' && e.key !== ' ') return;

								e.preventDefault();

								if (!imageUrl) {
									document.getElementById('image-upload')?.click();
								}
							}}
						>
							<input
								id="image-upload"
								aria-describedby="upload-retention-note"
								type="file"
								accept="image/*"
								class="hidden"
								onchange={(e) => {
									handleFileChange(e);
									setTimeout(() => {
										if (imageFile && imageUrl) {
											runSegmentationInBrowser();
										}
									}, 0);
								}}
								disabled={!!imageUrl}
							/>

							<div class="absolute inset-0 overflow-hidden rounded-xl" bind:this={containerEl}>
								{#if imageUrl}
									<div
										class={`absolute inset-0 touch-none transition-opacity duration-300 ${
											warpedImageUrl ? 'opacity-100' : 'pointer-events-none opacity-0'
										}`}
										role="button"
										tabindex="0"
										bind:this={sourceFocusTrapEl}
										data-focus-trap="source"
										onclick={clearActiveSelection}
										onpointerdown={(e) => {
											if ((e.target as HTMLElement).closest('button')) return;
											e.currentTarget.focus({ preventScroll: true });
										}}
										onkeydown={(e) => {
											handleSourceTrapKeydown(e);

											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												clearActiveSelection();
											}
										}}
									>
										<!-- fixed review viewport -->
										<div
											class="absolute inset-0 overflow-hidden rounded-xl"
											use:ctrlWheelZoom={'source'}
										>
											<!-- static background fill so no black bars ever appear -->
											<div class="absolute inset-0 bg-zinc-950"></div>

											<!-- fixed image plane -->
											<div
												class="absolute overflow-visible"
												style={`
														left: ${displayedImageRect.x}px;
														top: ${displayedImageRect.y}px;
														width: ${displayedImageRect.width}px;
														height: ${displayedImageRect.height}px;
													`}
											>
												<div
													class="absolute inset-0 transition-transform duration-200 ease-out"
													style={getViewZoomStyle('source')}
												>
													<img
														bind:this={imageEl}
														src={imageUrl}
														alt="Uploaded source"
														class={`block h-full w-full object-contain transition-opacity duration-500 ${
															sourceImageVisible ? 'opacity-100' : 'opacity-0'
														}`}
														draggable="false"
														ondragstart={(e) => e.preventDefault()}
														onload={() => handleSourceImageLoad()}
													/>

													<svg class="pointer-events-none absolute inset-0 h-full w-full">
														<line
															x1={imageXToPercent(corners.topLeft.x)}
															y1={imageYToPercent(corners.topLeft.y)}
															x2={imageXToPercent(corners.topRight.x)}
															y2={imageYToPercent(corners.topRight.y)}
															stroke="#22d3ee"
															stroke-width="2"
															stroke-dasharray="8 6"
															opacity="1"
														/>

														<line
															x1={imageXToPercent(corners.topRight.x)}
															y1={imageYToPercent(corners.topRight.y)}
															x2={imageXToPercent(corners.bottomRight.x)}
															y2={imageYToPercent(corners.bottomRight.y)}
															stroke="#22d3ee"
															stroke-width="2"
															stroke-dasharray="8 6"
															opacity="1"
														/>

														<line
															x1={imageXToPercent(corners.bottomRight.x)}
															y1={imageYToPercent(corners.bottomRight.y)}
															x2={imageXToPercent(corners.bottomLeft.x)}
															y2={imageYToPercent(corners.bottomLeft.y)}
															stroke="#22d3ee"
															stroke-width="2"
															stroke-dasharray="8 6"
															opacity="1"
														/>

														<line
															x1={imageXToPercent(corners.bottomLeft.x)}
															y1={imageYToPercent(corners.bottomLeft.y)}
															x2={imageXToPercent(corners.topLeft.x)}
															y2={imageYToPercent(corners.topLeft.y)}
															stroke="#22d3ee"
															stroke-width="2"
															stroke-dasharray="8 6"
															opacity="1"
														/>
													</svg>
													{#if warpedImageUrl && !isSegmenting}
														{#each cornerOverlayItems as corner}
															<button
															type="button"
															aria-label={`Toggle ${corner.key} arrow control`}
															aria-pressed={activeCorner === corner.key}
														class="absolute z-10 flex h-10 w-10 items-center justify-center focus:outline-none"
															style:left={`${(corners[corner.key].x / Math.max(imageEl?.naturalWidth || 1, 1)) * 100}%`}
															style:top={`${(corners[corner.key].y / Math.max(imageEl?.naturalHeight || 1, 1)) * 100}%`}
															style:transform={corner.key === 'topLeft'
																? 'translate(-85%, -85%)'
																: corner.key === 'topRight'
																	? 'translate(-15%, -85%)'
																	: corner.key === 'bottomLeft'
																		? 'translate(-85%, -15%)'
																		: 'translate(-15%, -15%)'}
															onpointerdown={(e) => {
																e.stopPropagation();
																e.preventDefault();

																selectTarget({ type: 'corner', key: corner.key });
																e.currentTarget.focus({ preventScroll: true });
																draggingCorner = corner.key;
																cornerDragStart = {
																	pointerX: e.clientX,
																	pointerY: e.clientY,
																	cornerX: corners[corner.key].x,
																	cornerY: corners[corner.key].y
																};
																didDragCorner = false;

																window.addEventListener('pointermove', onPointerMove);
																window.addEventListener('pointerup', stopDrag);
															}}
														onclick={(e) => {
															e.stopPropagation();
															selectTarget({ type: 'corner', key: corner.key });
														}}
														onfocus={() => {
															activateTarget({ type: 'corner', key: corner.key });
														}}
														data-source-corner="true"
															data-corner-key={corner.key}
														>
															<div
																class={`h-7 w-7 transition ${
																	activeCorner === corner.key
																		? 'arrow-breathe text-red-400'
																		: 'text-cyan-400 hover:text-green-300'
																}`}
															>
																<svg
																	viewBox="0 0 24 24"
																	fill="none"
																	stroke="currentColor"
																	stroke-width="2.25"
																	stroke-linecap="round"
																	stroke-linejoin="round"
																	class={`h-full w-full ${
																		corner.key === 'topLeft'
																			? 'rotate-180'
																			: corner.key === 'topRight'
																				? '-rotate-90'
																				: corner.key === 'bottomRight'
																					? 'rotate-0'
																					: 'rotate-90'
																	}`}
																	aria-hidden="true"
																>
																	<path d="M19 19L5 5" />
																	<path d="M5 11V5H11" />
																</svg>
																</div></button
															>
														{/each}
													{/if}
												</div>
											</div>
										</div>
									</div>

									{#if !warpedImageUrl}
										<div
											class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-zinc-950 px-6 text-center"
										>
											<div>
												<div class="mb-2 text-sm font-medium text-zinc-300">
													{isSegmenting ? 'Finding best quadrilateral…' : 'Preparing detection…'}
												</div>
												<div class="text-xs text-zinc-500">
													The source preview will appear when detection is complete.
												</div>
											</div>
										</div>
									{/if}
								{/if}
							</div>
							{#if imageUrl}
								<div
									class={`pointer-events-none absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center transition-all duration-150 ease-out ${
										showCornerZoomPatch ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
									}`}
								>
									<div
										class="corner-zoom-frame pointer-events-none relative border-2 border-dotted border-cyan-400 p-0"
										style="box-shadow: 0 4px 12px rgba(0,0,0,0.5);"
									>
										<canvas
											bind:this={cornerZoomCanvas}
											width={CORNER_ZOOM_SIZE}
											height={CORNER_ZOOM_SIZE}
											class="relative z-10 h-[200px] w-[200px]"
										></canvas>
									</div>
								</div>
							{/if}
						</div>
					</div>

					<div class="block xl:hidden p-4">
						<div class="mb-3 flex items-center justify-between">
							<div class="text-xs font-medium tracking-[0.2em] text-zinc-500 uppercase">
								Card Controls MINI MAP
							</div>
						</div>

						<div
							class="mx-auto grid w-full max-w-[420px] grid-cols-2 items-center gap- p-1"
							role="toolbar"
							aria-label="Card controls mini map"
							tabindex="-1"
							onkeydown={handleMiniMapTrapKeydown}
						>
							<svg
								viewBox="0 0 220 210"
								class="h-[210px] w-full overflow-visible"
							>
								<!-- card body -->
								<rect
									x="60"
									y="30"
									width="100"
									height="140"
									rx="18"
									class="fill-zinc-900 stroke-zinc-700"
									stroke-width="2"
								/>

								<rect
									x="60"
									y="30"
									width="100"
									height="140"
									rx="18"
									fill="transparent"
									pointer-events="all"
									class="cursor-pointer"
									role="button"
									tabindex="0"
									aria-label="Deselect corners and edges"
									onclick={(e) => {
										e.stopPropagation();
										selectTarget(null);
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
											e.preventDefault();
											selectTarget(null);
										}
									}}
								/>

								<!-- top -->
								<line
									x1="60"
									y1="30"
									x2="160"
									y2="30"
									stroke={activeGuide === 'top' ? '#60a5fa' : '#52525b'}
									stroke-width="3"
									stroke-linecap="round"
								/>
								<line
									x1="60"
									y1="30"
									x2="160"
									y2="30"
									stroke="transparent"
									stroke-width="20"
									stroke-linecap="round"
									class="cursor-pointer focus:outline-none"
									role="button"
									tabindex="0"
									aria-label="Select top edge"
									onclick={(e) => {
										e.stopPropagation();
										selectTarget({ type: 'guide', key: 'top' });
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'guide', key: 'top' });
										}
									}}
								/>

								<!-- right -->
								<line
									x1="160"
									y1="30"
									x2="160"
									y2="170"
									stroke={activeGuide === 'right' ? '#60a5fa' : '#52525b'}
									stroke-width="3"
									stroke-linecap="round"
								/>
								<line
									x1="160"
									y1="30"
									x2="160"
									y2="170"
									stroke="transparent"
									stroke-width="20"
									stroke-linecap="round"
									class="cursor-pointer focus:outline-none"
									role="button"
									tabindex="0"
									aria-label="Select right edge"
									onclick={(e) => {
										e.stopPropagation();
										selectTarget({ type: 'guide', key: 'right' });
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'guide', key: 'right' });
										}
									}}
								/>

								<!-- bottom -->
								<line
									x1="60"
									y1="170"
									x2="160"
									y2="170"
									stroke={activeGuide === 'bottom' ? '#60a5fa' : '#52525b'}
									stroke-width="3"
									stroke-linecap="round"
								/>
								<line
									x1="60"
									y1="170"
									x2="160"
									y2="170"
									stroke="transparent"
									stroke-width="20"
									stroke-linecap="round"
									class="cursor-pointer focus:outline-none"
									role="button"
									tabindex="0"
									aria-label="Select bottom edge"
									onclick={(e) => {
										e.stopPropagation();
										selectTarget({ type: 'guide', key: 'bottom' });
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'guide', key: 'bottom' });
										}
									}}
								/>

								<!-- left -->
								<line
									x1="60"
									y1="30"
									x2="60"
									y2="170"
									stroke={activeGuide === 'left' ? '#60a5fa' : '#52525b'}
									stroke-width="3"
									stroke-linecap="round"
								/>
								<line
									x1="60"
									y1="30"
									x2="60"
									y2="170"
									stroke="transparent"
									stroke-width="20"
									stroke-linecap="round"
									class="cursor-pointer focus:outline-none"
									role="button"
									tabindex="0"
									aria-label="Select left edge"
									onclick={(e) => {
										e.stopPropagation();
										selectTarget({ type: 'guide', key: 'left' });
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'guide', key: 'left' });
										}
									}}
								/>

								<!-- corner hotspots -->
								<circle
									cx="60"
									cy="30"
									r="12"
									role="button"
									tabindex="0"
									aria-label="Select top left corner"
									class={activeCorner === 'topLeft'
										? 'fill-cyan-400 stroke-cyan-300 cursor-pointer focus:outline-none'
										: 'fill-zinc-700 stroke-zinc-500 cursor-pointer focus:outline-none'}
									stroke-width="2"
									onclick={() => selectTarget({ type: 'corner', key: 'topLeft' })}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'corner', key: 'topLeft' });
										}
									}}
								/>

								<circle
									cx="160"
									cy="30"
									r="12"
									role="button"
									tabindex="0"
									aria-label="Select top right corner"
									class={activeCorner === 'topRight'
										? 'fill-cyan-400 stroke-cyan-300 cursor-pointer focus:outline-none'
										: 'fill-zinc-700 stroke-zinc-500 cursor-pointer focus:outline-none'}
									stroke-width="2"
									onclick={() => selectTarget({ type: 'corner', key: 'topRight' })}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'corner', key: 'topRight' });
										}
									}}
								/>

								<circle
									cx="60"
									cy="170"
									r="12"
									role="button"
									tabindex="0"
									aria-label="Select bottom left corner"
									class={activeCorner === 'bottomLeft'
										? 'fill-cyan-400 stroke-cyan-300 cursor-pointer focus:outline-none'
										: 'fill-zinc-700 stroke-zinc-500 cursor-pointer focus:outline-none'}
									stroke-width="2"
									onclick={() => selectTarget({ type: 'corner', key: 'bottomLeft' })}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'corner', key: 'bottomLeft' });
										}
									}}
								/>

								<circle
									cx="160"
									cy="170"
									r="12"
									role="button"
									tabindex="0"
									aria-label="Select bottom right corner"
									class={activeCorner === 'bottomRight'
										? 'fill-cyan-400 stroke-cyan-300 cursor-pointer focus:outline-none'
										: 'fill-zinc-700 stroke-zinc-500 cursor-pointer focus:outline-none'}
									stroke-width="2"
									onclick={() => selectTarget({ type: 'corner', key: 'bottomRight' })}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'corner', key: 'bottomRight' });
										}
									}}
								/>
							</svg>
							<div class="grid h-[150px] w-full grid-cols-3 gap-2 self-center">
								<div></div>
								<button
									class={getPadButtonClass('up')}
									type="button"
									onpointerdown={(e) => {
										e.preventDefault();
										e.currentTarget.setPointerCapture(e.pointerId);
										inputController.startPadHold('up');
									}}
									onpointerup={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
									onlostpointercapture={inputController.stopPadHold}
								>
									↑
								</button>
								<div></div>

								<button
									class={getPadButtonClass('left')}
									type="button"
									onpointerdown={(e) => {
										e.preventDefault();
										e.currentTarget.setPointerCapture(e.pointerId);
										inputController.startPadHold('left');
									}}
									onpointerup={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
									onlostpointercapture={inputController.stopPadHold}
								>
									←
								</button>

								<button
									class="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
									type="button"
									onclick={() => {
										selectTarget(null);
										inputController.stopPadHold();
									}}
								>
									•
								</button>

								<button
									class={getPadButtonClass('right')}
									type="button"
									onpointerdown={(e) => {
										e.preventDefault();
										e.currentTarget.setPointerCapture(e.pointerId);
										inputController.startPadHold('right');
									}}
									onpointerup={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
									onlostpointercapture={inputController.stopPadHold}
								>
									→
								</button>

								<div></div>
								<button
									class={getPadButtonClass('down')}
									type="button"
									onpointerdown={(e) => {
										e.preventDefault();
										e.currentTarget.setPointerCapture(e.pointerId);
										inputController.startPadHold('down');
									}}
									onpointerup={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
									onlostpointercapture={inputController.stopPadHold}
								>
									↓
								</button>
								<div></div>
							</div>
						</div>
					</div>
				</section>

				<section
					class="w-full xl:w-[525px] justify-self-center self-start flex flex-col border border-zinc-800 bg-zinc-900 shadow-sm"
				>
					<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
						<div>
							<h2 class="text-sm font-semibold tracking-wide text-zinc-300 uppercase">
								Warp Preview
							</h2>
							<p class="text-xs text-zinc-500">Live output from current corner positions</p>
						</div>

						<div class="ml-auto flex items-center gap-3">
							<button
								class="text-xl transition-transform hover:scale-110 active:scale-95"
								onclick={captureWarpPanel}
								type="button"
								title="Capture"
							>
								📸
							</button>

							<button
								class="text-xl transition-transform hover:scale-110 active:scale-95"
								onclick={() => (isDark = !isDark)}
								type="button"
								title="Toggle theme"
							>
								{isDark ? '☀️' : '🌙'}
							</button>

							<button
								class={`min-w-8 rounded px-1.5 py-1 text-xs font-bold transition hover:scale-105 active:scale-95 ${
									warpEnhanceMode === 'original'
										? 'text-zinc-400'
										: 'bg-cyan-400/10 text-cyan-400'
								}`}
								onclick={cycleWarpEnhanceMode}
								type="button"
								aria-label={`Warp visibility mode: ${getWarpEnhanceLabel()}`}
								title={`${getWarpEnhanceLabel()} — click for next mode`}
							>
								{warpEnhanceMode === 'original'
									? 'FX'
									: warpEnhanceMode === 'contrast'
										? 'HC'
										: 'BW'}
							</button>
						</div>
					</div>

					<div
						bind:this={warpScreenshotEl}
						class={`flex flex-col gap-4 p-5 transition-colors duration-300 ${
							isDark ? 'bg-zinc-900 text-zinc-100' : 'bg-white text-zinc-900'
						}`}
					>
						<!-- Centering Metrics -->
						<div class="grid shrink-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
							<!-- Vertical Centering -->
							<div>
								<div class="mb-2 text-xs tracking-wide text-zinc-500 uppercase">
									Vertical Centering
								</div>

								<div
									class={`rounded-lg border bg-zinc-950/60 p-4 transition ${
										verticalIsPerfect
											? 'centering-rgb-glow'
											: 'border-zinc-800'
									}`}
								>
									<div class="relative grid grid-cols-2 gap-x-4 sm:gap-x-8">
										<div class="text-left">
											<div class="text-sm text-zinc-400">Top</div>
											<div
												class={`mt-2 text-xl sm:text-2xl font-semibold transition ${
													verticalIsPerfect
														? 'centering-rgb-value'
														: centeringStats.topPct > ALERT_THRESHOLD
															? 'text-red-400'
															: 'text-zinc-100'
												}`}
											>
												{warpedImageUrl ? formatPct(centeringStats.topPct) : '--.-%'}
											</div>
										</div>

										<div class="text-right">
											<div class="text-sm text-zinc-400">Bottom</div>
											<div
												class={`mt-2 text-xl sm:text-2xl font-semibold transition ${
													verticalIsPerfect
														? 'centering-rgb-value'
														: centeringStats.bottomPct > ALERT_THRESHOLD
															? 'text-red-400'
															: 'text-zinc-100'
												}`}
											>
												{warpedImageUrl ? formatPct(centeringStats.bottomPct) : '--.-%'}
											</div>
										</div>

										<svg
											class="pointer-events-none absolute inset-0 h-full w-full"
											viewBox="0 0 100 100"
											preserveAspectRatio="none"
											aria-hidden="true"
										>
											<line
												x1="50"
												y1="16"
												x2="50"
												y2="84"
												stroke="rgb(82 82 91)"
												stroke-width="1.5"
												opacity="0.7"
												vector-effect="non-scaling-stroke"
											/>
										</svg>
									</div>
								</div>
							</div>

							<!-- Horizontal Centering -->
							<div>
								<div class="mb-2 text-xs tracking-wide text-zinc-500 uppercase">
									Horizontal Centering
								</div>

								<div
									class={`rounded-lg border bg-zinc-950/60 p-4 transition ${
										horizontalIsPerfect
											? 'centering-rgb-glow'
											: 'border-zinc-800'
									}`}
								>
									<div class="relative grid grid-cols-2 gap-x-4 sm:gap-x-8">
										<div class="text-left">
											<div class="text-sm text-zinc-400">Left</div>
											<div
												class={`mt-2 text-xl sm:text-2xl font-semibold transition ${
													horizontalIsPerfect
														? 'centering-rgb-value'
														: centeringStats.leftPct > ALERT_THRESHOLD
															? 'text-red-400'
															: 'text-zinc-100'
												}`}
											>
												{warpedImageUrl ? formatPct(centeringStats.leftPct) : '--.-%'}
											</div>
										</div>

										<div class="text-right">
											<div class="text-sm text-zinc-400">Right</div>
											<div
												class={`mt-2 text-xl sm:text-2xl font-semibold transition ${
													horizontalIsPerfect
														? 'centering-rgb-value'
														: centeringStats.rightPct > ALERT_THRESHOLD
															? 'text-red-400'
															: 'text-zinc-100'
												}`}
											>
												{warpedImageUrl ? formatPct(centeringStats.rightPct) : '--.-%'}
											</div>
										</div>

										<svg
											class="pointer-events-none absolute inset-0 h-full w-full"
											viewBox="0 0 100 100"
											preserveAspectRatio="none"
											aria-hidden="true"
										>
											<line
												x1="50"
												y1="16"
												x2="50"
												y2="84"
												stroke="rgb(82 82 91)"
												stroke-width="1.5"
												opacity="0.7"
												vector-effect="non-scaling-stroke"
											/>
										</svg>
									</div>
								</div>
							</div>
						</div>

						<!-- Warp Image -->
						<div class="flex w-full items-center justify-start xl:justify-center">
							<div
								role="button"
								tabindex="0"
								aria-label="Clear active selection"
								class="relative aspect-[5/7] w-full xl:w-[525px] touch-none overflow-hidden border border-dashed border-zinc-700 bg-zinc-950 focus:outline-none"
								bind:this={warpContainerEl}
								data-focus-trap="warp"
								use:ctrlWheelZoom={'warp'}
								onpointerdown={(e) => {
									if ((e.target as HTMLElement).closest('button')) return;
									e.currentTarget.focus({ preventScroll: true });
									clearActiveSelection();
								}}
								onkeydown={(e) => {
									handleWarpTrapKeydown(e);

									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										if (!(e.target as HTMLElement).closest('button')) {
											clearActiveSelection();
										}
									}
								}}
							>
								{#if warpedImageUrl}
									<div class="absolute inset-0 overflow-hidden">
										<div
											class="absolute inset-0 transition-transform duration-200 ease-out"
											style={getViewZoomStyle('warp')}
										>
											<img
												src={warpedImageUrl}
												alt="Warped preview"
												class="absolute inset-0 h-full w-full object-cover"
												style:filter={getWarpEnhanceFilter()}
												onload={() => updateWarpDisplayedImageRect()}
												draggable="false"
											/>

											<svg
												class="pointer-events-none absolute inset-0 h-full w-full"
												viewBox={`0 0 ${Math.max(warpDisplayedImageRect.width, 1)} ${Math.max(warpDisplayedImageRect.height, 1)}`}
												preserveAspectRatio="none"
											>
												<line
													x1="0"
													y1={topPx}
													x2={warpDisplayedImageRect.width}
													y2={topPx}
													stroke={activeGuide === 'top' ? '#f87171' : '#22d3ee'}
													stroke-width={2 / warpViewZoom}
													stroke-dasharray={`${10 / warpViewZoom} ${8 / warpViewZoom}`}
													stroke-linecap="round"
												/>

												<line
													x1="0"
													y1={warpDisplayedImageRect.height - bottomPx}
													x2={warpDisplayedImageRect.width}
													y2={warpDisplayedImageRect.height - bottomPx}
													stroke={activeGuide === 'bottom' ? '#f87171' : '#22d3ee'}
													stroke-width={2 / warpViewZoom}
													stroke-dasharray={`${10 / warpViewZoom} ${8 / warpViewZoom}`}
													stroke-linecap="round"
												/>

												<line
													x1={leftPx}
													y1="0"
													x2={leftPx}
													y2={warpDisplayedImageRect.height}
													stroke={activeGuide === 'left' ? '#f87171' : '#22d3ee'}
													stroke-width={2 / warpViewZoom}
													stroke-dasharray={`${10 / warpViewZoom} ${8 / warpViewZoom}`}
													stroke-linecap="round"
												/>

												<line
													x1={warpDisplayedImageRect.width - rightPx}
													y1="0"
													x2={warpDisplayedImageRect.width - rightPx}
													y2={warpDisplayedImageRect.height}
													stroke={activeGuide === 'right' ? '#f87171' : '#22d3ee'}
													stroke-width={2 / warpViewZoom}
													stroke-dasharray={`${10 / warpViewZoom} ${8 / warpViewZoom}`}
													stroke-linecap="round"
												/>
											</svg>

											<div class="absolute inset-0">
												<!-- top click target -->
												<!-- top -->
												<button
													type="button"
													aria-label="Adjust top guide"
													aria-pressed={activeGuide === 'top'}
													data-warp-guide="true"
													data-guide-key="top"
													class="absolute left-0 right-0 h-10 -translate-y-1/2 cursor-pointer focus:outline-none"
													style={`top: ${topPx}px;`}
													onpointerdown={(e) => {
														e.stopPropagation();
														startGuideDrag(e, 'top');
														e.currentTarget.focus({ preventScroll: true });
													}}
													onclick={(e) => {
														e.stopPropagation();
														selectTarget({ type: 'guide', key: 'top' });
													}}
													onfocus={() => {
														activateTarget({ type: 'guide', key: 'top' });
													}}
												></button>

												<!-- bottom -->
												<button
													type="button"
													aria-label="Adjust bottom guide"
													aria-pressed={activeGuide === 'bottom'}
													data-warp-guide="true"
													data-guide-key="bottom"
													class="absolute left-0 right-0 h-10 -translate-y-1/2 cursor-pointer focus:outline-none"
													style={`top: ${warpDisplayedImageRect.height - bottomPx}px;`}
													onpointerdown={(e) => {
														e.stopPropagation();
														startGuideDrag(e, 'bottom');
														e.currentTarget.focus({ preventScroll: true });
													}}
													onclick={(e) => {
														e.stopPropagation();
														selectTarget({ type: 'guide', key: 'bottom' });
													}}
													onfocus={() => {
														activateTarget({ type: 'guide', key: 'bottom' });
													}}
												></button>

												<!-- left -->
												<button
													type="button"
													aria-label="Adjust left guide"
													aria-pressed={activeGuide === 'left'}
													data-warp-guide="true"
													data-guide-key="left"
													class="absolute top-0 bottom-0 w-10 -translate-x-1/2 cursor-pointer focus:outline-none"
													style={`left: ${leftPx}px;`}
													onpointerdown={(e) => {
														e.stopPropagation();
														startGuideDrag(e, 'left');
														e.currentTarget.focus({ preventScroll: true });
													}}
													onclick={(e) => {
														e.stopPropagation();
														selectTarget({ type: 'guide', key: 'left' });
													}}
													onfocus={() => {
														activateTarget({ type: 'guide', key: 'left' });
													}}
												></button>

												<!-- right -->
												<button
													type="button"
													aria-label="Adjust right guide"
													aria-pressed={activeGuide === 'right'}
													data-warp-guide="true"
													data-guide-key="right"
													class="absolute top-0 bottom-0 w-10 -translate-x-1/2 cursor-pointer focus:outline-none"
													style={`left: ${warpDisplayedImageRect.width - rightPx}px;`}
													onpointerdown={(e) => {
														e.stopPropagation();
														startGuideDrag(e, 'right');
														e.currentTarget.focus({ preventScroll: true });
													}}
													onclick={(e) => {
														e.stopPropagation();
														selectTarget({ type: 'guide', key: 'right' });
													}}
													onfocus={() => {
														activateTarget({ type: 'guide', key: 'right' });
													}}
												></button>

												{#if activeGuide === 'top'}
													<div
														class="pointer-events-none absolute left-1/2 flex -translate-x-1/2 translate-y-[40%] items-center justify-center"
														style={`top: ${topPx}px;`}
													>
														<div class="arrow-breathe">
															<svg
																viewBox="0 0 80 80"
																class="h-16 w-16 text-red-400"
																fill="none"
																stroke="currentColor"
																stroke-width="4.5"
																stroke-linecap="round"
																stroke-linejoin="round"
															>
																<path d="M40 66V18" />
																<path d="M22 36L40 18L58 36" />
															</svg>
														</div>
													</div>
												{/if}

												{#if activeGuide === 'bottom'}
													<div
														class="pointer-events-none absolute left-1/2 flex -translate-x-1/2 -translate-y-[140%] items-center justify-center"
														style={`top: ${warpDisplayedImageRect.height - bottomPx}px;`}
													>
														<div class="arrow-breathe">
															<svg
																viewBox="0 0 80 80"
																class="h-16 w-16 rotate-180 text-red-400"
																fill="none"
																stroke="currentColor"
																stroke-width="4.5"
																stroke-linecap="round"
																stroke-linejoin="round"
															>
																<path d="M40 66V18" />
																<path d="M22 36L40 18L58 36" />
															</svg>
														</div>
													</div>
												{/if}

												{#if activeGuide === 'left'}
													<div
														class="pointer-events-none absolute top-1/2 flex translate-x-[40%] -translate-y-1/2 items-center justify-center"
														style={`left: ${leftPx}px;`}
													>
														<div class="arrow-breathe">
															<svg
																viewBox="0 0 80 80"
																class="h-16 w-16 -rotate-90 text-red-400"
																fill="none"
																stroke="currentColor"
																stroke-width="4.5"
																stroke-linecap="round"
																stroke-linejoin="round"
															>
																<path d="M40 66V18" />
																<path d="M22 36L40 18L58 36" />
															</svg>
														</div>
													</div>
												{/if}

												{#if activeGuide === 'right'}
													<div
														class="pointer-events-none absolute top-1/2 flex -translate-x-[140%] -translate-y-1/2 items-center justify-center"
														style={`left: ${warpDisplayedImageRect.width - rightPx}px;`}
													>
														<div class="arrow-breathe">
															<svg
																viewBox="0 0 80 80"
																class="h-16 w-16 rotate-90 text-red-400"
																fill="none"
																stroke="currentColor"
																stroke-width="4.5"
																stroke-linecap="round"
																stroke-linejoin="round"
															>
																<path d="M40 66V18" />
																<path d="M22 36L40 18L58 36" />
															</svg>
														</div>
													</div>
												{/if}
											</div>
										</div>
									</div>
								{:else}
									<div
										class="absolute inset-0 flex items-center justify-center rounded-xl text-sm text-zinc-500"
									>
										Warp preview will appear here
									</div>
								{/if}
							</div>
						</div>
					</div>

					<div class="block xl:hidden p-4">
						<div class="mb-3 flex items-center justify-between">
							<div class="text-xs font-medium tracking-[0.2em] text-zinc-500 uppercase">
								Card Controls MINI MAP
							</div>
						</div>

						<div
							class="mx-auto grid w-full max-w-[420px] grid-cols-2 items-center gap- p-1"
							role="toolbar"
							aria-label="Card controls mini map"
							tabindex="-1"
							onkeydown={handleMiniMapTrapKeydown}
						>
							<svg
								viewBox="0 0 220 210"
								class="h-[210px] w-full overflow-visible"
							>
								<!-- card body -->
								<rect
									x="60"
									y="30"
									width="100"
									height="140"
									rx="18"
									class="fill-zinc-900 stroke-zinc-700"
									stroke-width="2"
								/>

								<rect
									x="60"
									y="30"
									width="100"
									height="140"
									rx="18"
									fill="transparent"
									pointer-events="all"
									class="cursor-pointer"
									role="button"
									tabindex="0"
									aria-label="Deselect corners and edges"
									onclick={(e) => {
										e.stopPropagation();
										selectTarget(null);
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
											e.preventDefault();
											selectTarget(null);
										}
									}}
								/>

								<!-- top -->
								<line
									x1="60"
									y1="30"
									x2="160"
									y2="30"
									stroke={activeGuide === 'top' ? '#60a5fa' : '#52525b'}
									stroke-width="3"
									stroke-linecap="round"
								/>
								<line
									x1="60"
									y1="30"
									x2="160"
									y2="30"
									stroke="transparent"
									stroke-width="20"
									stroke-linecap="round"
									class="cursor-pointer focus:outline-none"
									role="button"
									tabindex="0"
									aria-label="Select top edge"
									onclick={(e) => {
										e.stopPropagation();
										selectTarget({ type: 'guide', key: 'top' });
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'guide', key: 'top' });
										}
									}}
								/>

								<!-- right -->
								<line
									x1="160"
									y1="30"
									x2="160"
									y2="170"
									stroke={activeGuide === 'right' ? '#60a5fa' : '#52525b'}
									stroke-width="3"
									stroke-linecap="round"
								/>
								<line
									x1="160"
									y1="30"
									x2="160"
									y2="170"
									stroke="transparent"
									stroke-width="20"
									stroke-linecap="round"
									class="cursor-pointer focus:outline-none"
									role="button"
									tabindex="0"
									aria-label="Select right edge"
									onclick={(e) => {
										e.stopPropagation();
										selectTarget({ type: 'guide', key: 'right' });
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'guide', key: 'right' });
										}
									}}
								/>

								<!-- bottom -->
								<line
									x1="60"
									y1="170"
									x2="160"
									y2="170"
									stroke={activeGuide === 'bottom' ? '#60a5fa' : '#52525b'}
									stroke-width="3"
									stroke-linecap="round"
								/>
								<line
									x1="60"
									y1="170"
									x2="160"
									y2="170"
									stroke="transparent"
									stroke-width="20"
									stroke-linecap="round"
									class="cursor-pointer focus:outline-none"
									role="button"
									tabindex="0"
									aria-label="Select bottom edge"
									onclick={(e) => {
										e.stopPropagation();
										selectTarget({ type: 'guide', key: 'bottom' });
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'guide', key: 'bottom' });
										}
									}}
								/>

								<!-- left -->
								<line
									x1="60"
									y1="30"
									x2="60"
									y2="170"
									stroke={activeGuide === 'left' ? '#60a5fa' : '#52525b'}
									stroke-width="3"
									stroke-linecap="round"
								/>
								<line
									x1="60"
									y1="30"
									x2="60"
									y2="170"
									stroke="transparent"
									stroke-width="20"
									stroke-linecap="round"
									class="cursor-pointer focus:outline-none"
									role="button"
									tabindex="0"
									aria-label="Select left edge"
									onclick={(e) => {
										e.stopPropagation();
										selectTarget({ type: 'guide', key: 'left' });
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectTarget({ type: 'guide', key: 'left' });
										}
									}}
								/>

								<!-- corner hotspots -->
								<circle
									cx="60"
									cy="30"
									r="12"
									class={'fill-zinc-700 stroke-zinc-500'}
									stroke-width="2"
								/>
								<circle
									cx="160"
									cy="30"
									r="12"
									class={'fill-zinc-700 stroke-zinc-500'}
									stroke-width="2"
								/>
								<circle
									cx="60"
									cy="170"
									r="12"
									class={'fill-zinc-700 stroke-zinc-500'}
									stroke-width="2"
								/>
								<circle
									cx="160"
									cy="170"
									r="12"
									class={'fill-zinc-700 stroke-zinc-500'}
									stroke-width="2"
								/>
							</svg>

							<div class="grid h-[150px] w-full grid-cols-3 gap-2 self-center">
								<div></div>
								<button
									class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
									onpointerdown={(e) => {
										e.preventDefault();
										e.currentTarget.setPointerCapture(e.pointerId);
										inputController.startPadHold('up');
									}}
									onpointerup={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
									onlostpointercapture={inputController.stopPadHold}>↑</button
								>
								<div></div>

								<button
									class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
									onpointerdown={(e) => {
										e.preventDefault();
										e.currentTarget.setPointerCapture(e.pointerId);
										inputController.startPadHold('left');
									}}
									onpointerup={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
									onlostpointercapture={inputController.stopPadHold}>←</button
								>
								<button
									class="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
									onclick={() => {
										selectTarget(null);
										inputController.stopPadHold();
									}}>•</button
								>
								<button
									class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
									onpointerdown={(e) => {
										e.preventDefault();
										e.currentTarget.setPointerCapture(e.pointerId);
										inputController.startPadHold('right');
									}}
									onpointerup={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
									onlostpointercapture={inputController.stopPadHold}>→</button
								>

								<div></div>
								<button
									class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
									onpointerdown={(e) => {
										e.preventDefault();
										e.currentTarget.setPointerCapture(e.pointerId);
										inputController.startPadHold('down');
									}}
									onpointerup={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
									onlostpointercapture={inputController.stopPadHold}>↓</button
								>
								<div></div>
							</div>
						</div>
					</div>
				</section>
			</div>
		</main>

		<footer class="mt-auto border-t border-zinc-800 px-6 py-6 text-left sm:px-10">
			<a
				href="mailto:MoisesFigueroaDE@gmail.com"
				class="text-sm text-zinc-400 transition-colors hover:text-cyan-400"
			>
				MoisesFigueroaDE@gmail.com
			</a>
		</footer>
	</div>
</div>

<style>
	:global(.centering-rgb-glow) {
		position: relative;
		isolation: isolate;
		border-color: transparent;
		background: #101014;
		box-shadow: -8px -3px 18px -5px rgb(255 79 163 / 85%),
			0 8px 20px -6px rgb(217 70 239 / 75%),
			8px -3px 20px -5px rgb(124 58 237 / 90%);
		animation: centering-halo-orbit 3s linear infinite;
	}

	:global(.centering-rgb-glow)::before,
	:global(.centering-rgb-glow)::after {
		content: '';
		position: absolute;
		inset: -2px;
		border-radius: inherit;
		padding: 2px;
		pointer-events: none;
		background-image: linear-gradient(90deg, #ff4fa3 0%, #ff80d5 17%, #e040fb 33%, #a855f7 50%, #7c3aed 67%, #d946ef 83%, #ff4fa3 100%);
		background-size: 240px 100%;
		background-repeat: repeat-x;
		mask: linear-gradient(#fff 0 0) content-box exclude, linear-gradient(#fff 0 0);
		animation: centering-rgb-flow 2s linear infinite;
	}

	:global(.centering-rgb-glow)::before {
		filter: blur(7px);
		opacity: 0.95;
	}

	:global(.centering-rgb-glow)::after {
		box-shadow: -7px 0 18px -8px #ff4fa3,
			0 7px 18px -8px #d946ef,
			7px 0 18px -8px #7c3aed;
	}

	:global(.centering-rgb-glow)::after {
		filter: drop-shadow(-4px 0 5px #ff4fa3) drop-shadow(4px 0 5px #7c3aed);
	}

	:global(.centering-rgb-value) {
		color: transparent;
		background-image: linear-gradient(90deg, #ff4fa3 0%, #ff80d5 17%, #e040fb 33%, #a855f7 50%, #7c3aed 67%, #d946ef 83%, #ff4fa3 100%);
		background-size: 240px 100%;
		background-repeat: repeat-x;
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		text-shadow: none;
		filter: drop-shadow(0 0 2px rgb(255 128 213 / 45%))
			drop-shadow(0 0 5px rgb(164 85 247 / 30%));
		animation: centering-rgb-flow 2s linear infinite;
	}

	@keyframes -global-centering-halo-orbit {
		0%, 100% {
			box-shadow: -8px -3px 18px -5px rgb(255 79 163 / 85%),
				0 8px 20px -6px rgb(217 70 239 / 75%),
				8px -3px 20px -5px rgb(124 58 237 / 90%);
		}
		33.333% {
			box-shadow: 0 8px 18px -5px rgb(255 79 163 / 85%),
				8px -3px 20px -6px rgb(217 70 239 / 75%),
				-8px -3px 20px -5px rgb(124 58 237 / 90%);
		}
		66.667% {
			box-shadow: 8px -3px 18px -5px rgb(255 79 163 / 85%),
				-8px -3px 20px -6px rgb(217 70 239 / 75%),
				0 8px 20px -5px rgb(124 58 237 / 90%);
		}
	}

	@keyframes -global-centering-rgb-flow {
		from { background-position: 0px 50%; }
		to { background-position: 240px 50%; }
	}

	:global(.arrow-breathe) {
		animation: arrow-breathe 1.4s ease-in-out infinite !important;
		transform-origin: center;
		will-change: transform, filter, opacity;
	}

	@keyframes -global-arrow-breathe {
		0%,
		100% {
			transform: scale(0.82);
			opacity: 0.82;
			filter: drop-shadow(0 0 4px rgba(248, 113, 113, 0.7))
				drop-shadow(0 0 8px rgba(248, 113, 113, 0.5));
		}

		50% {
			transform: scale(1.22);
			opacity: 1;
			filter: drop-shadow(0 0 8px rgba(248, 113, 113, 1))
				drop-shadow(0 0 18px rgba(248, 113, 113, 0.9));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.arrow-breathe) {
			animation: none;
			transform: scale(1);
			opacity: 1;
		}
	}
</style>
