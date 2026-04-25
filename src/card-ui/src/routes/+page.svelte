<script lang="ts">
	import { html2canvas } from 'html2canvas-pro';
	import { onMount, onDestroy, tick } from 'svelte';
	import { orderCorners, ensureClockwise } from '../lib/card-centering/geometry';
	import type { Quad } from '../lib/card-centering/geometry';
	import { warpImageToDataUrl } from '../lib/card-centering/warp';
	import {
		PAGE_ZOOM_VALUES,
		ZOOM_VALUES,
		ALERT_THRESHOLD,
		cornerOverlayItems
	} from '../lib/card-centering/constants';
	import { formatPct } from '../lib/card-centering/format';
	import { inferCorners, getSegmentationMaskUrl } from '../lib/card-centering/api';
	import { computeZoomMetrics, getZoomStyle } from '../lib/card-centering/view';
	import { getCenteringStats, type GuideKey } from '../lib/card-centering/centering';

	import { fade } from 'svelte/transition';
	import { createInputController, type Direction } from '../lib/card-centering/controller';
	import {
		moveCornerValue,
		applyGuideDirection
	} from '$lib/card-centering/movement';

	const inputController = createInputController({
		onNudge: (direction) => {
			nudgeSelected(direction);
		},
		onStop: () => {
			scheduleNudgeWarp();
		}
	});

	let imageFile = $state<File | null>(null);
	let imageUrl = $state('');

	let corners = $state({
		topLeft: { x: 0, y: 0 },
		topRight: { x: 0, y: 0 },
		bottomLeft: { x: 0, y: 0 },
		bottomRight: { x: 0, y: 0 }
	});

	let stepSize = $state(1);

	let containerEl = $state.raw<HTMLDivElement | null>(null);
	let containerSize = $state({ width: 1, height: 1 });

	let activeCorner = $state<keyof typeof corners | null>(null);

	let isSegmenting = $state(false);

	let imageEl = $state.raw<HTMLImageElement | null>(null);
	let displayedImageRect = $state({ x: 0, y: 0, width: 1, height: 1 });

	let autoZoomToCorners = $state(false);

	let warpedImageUrl = $state('');

	let activeGuide = $state<GuideKey | null>(null);

	let guideInsetsPx = $state({
		top: 24,
		bottom: 24,
		left: 24,
		right: 24
	});

	let warpContainerEl = $state.raw<HTMLDivElement | null>(null);

	let warpDisplayedImageRect = $state({ x: 0, y: 0, width: 1, height: 1 });

	let frozenZoom = $state<{
		scale: number;
		centerXNorm: number;
		centerYNorm: number;
	} | null>(null);

	let warpBoxSize = $state({ width: 0, height: 0 });

	let segmentationMaskUrl = $state('');

	let hideUploadTimeout: ReturnType<typeof setTimeout> | null = null;

	let isDark = $state(true);

	let nudgeWarpTimeout: ReturnType<typeof setTimeout> | null = null;

	const NUDGE_WARP_DELAY = 150;

	let cornerZoomCanvas = $state.raw<HTMLCanvasElement | null>(null);

	const CORNER_PATCH_RADIUS = 150; // source pixels around the selected corner
	const CORNER_ZOOM_SIZE = 150; // displayed canvas size

	let sourceFocusTrapEl = $state.raw<HTMLDivElement | null>(null);

	let warpScreenshotEl = $state.raw<HTMLDivElement | null>(null);

	let animateSourceZoom = $state(false);

	let sourceImageVisible = $state(false);

	let hasAdjustedVerticalGuides = $state(false);
	let hasAdjustedHorizontalGuides = $state(false);

	type ControlTarget =
		| { type: 'corner'; key: keyof typeof corners }
		| { type: 'guide'; key: GuideKey }
		| null;

	let selectedTarget = $state<ControlTarget>(null);

	function getPadButtonClass(direction: Direction) {
		return `rounded-xl border px-3 py-2 transition select-none ${
			inputController.isDirectionActive(direction)
				? 'border-cyan-400 bg-cyan-500/15 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.45)]'
				: 'border-zinc-700 bg-zinc-950 hover:bg-zinc-800 text-zinc-100'
		}`;
	}

	function selectCorner(key: keyof typeof corners) {
		if (activeCorner === key) {
			selectedTarget = null;
			activeCorner = null;
			activeGuide = null;
			return;
		}

		selectedTarget = { type: 'corner', key };
		activeCorner = key;
		activeGuide = null;
	}

	function selectGuide(key: GuideKey) {
		if (activeGuide === key) {
			selectedTarget = null;
			activeGuide = null;
			activeCorner = null;
			return;
		}

		selectedTarget = { type: 'guide', key };
		activeGuide = key;
		activeCorner = null;
	}

	function nudgeSelected(direction: 'up' | 'down' | 'left' | 'right') {
		if (!selectedTarget) return;

		if (selectedTarget.type === 'corner') {
			const key = selectedTarget.key;

			if (direction === 'up') moveCorner(key, 0, -stepSize);
			if (direction === 'down') moveCorner(key, 0, stepSize);
			if (direction === 'left') moveCorner(key, -stepSize, 0);
			if (direction === 'right') moveCorner(key, stepSize, 0);
			return;
		}

		if (selectedTarget.type === 'guide') {
			activeGuide = selectedTarget.key;
			moveActiveGuide(direction);
		}
	}

	function scheduleNudgeWarp() {
		if (nudgeWarpTimeout) clearTimeout(nudgeWarpTimeout);

		nudgeWarpTimeout = setTimeout(() => {
			runWarpPreview();
			nudgeWarpTimeout = null;
		}, NUDGE_WARP_DELAY);
	}

	$effect(() => {
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

		setTimeout(() => {
			drawCornerZoomPatch();
		}, 0);
	});

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

	$effect(() => {
		if (!warpedImageUrl) return;

		setTimeout(() => {
			updateWarpDisplayedImageRect();
		}, 0);
	});

	function resetHandler() {
		if (imageUrl) {
			if (imageUrl) URL.revokeObjectURL(imageUrl);
			if (warpedImageUrl?.startsWith('blob:')) URL.revokeObjectURL(warpedImageUrl);
			if (segmentationMaskUrl?.startsWith('blob:')) URL.revokeObjectURL(segmentationMaskUrl);

			imageFile = null;
			imageUrl = '';
			warpedImageUrl = '';
			segmentationMaskUrl = '';
			activeCorner = null;
			activeGuide = null;
			frozenZoom = null;
			frozenStage = null;
			autoZoomToCorners = false;
			zoomLevel = 1;
			pendingDetection = false;
			imageReadyForControls = false;
			animateSourceZoom = false;
			corners = {
				topLeft: { x: 0, y: 0 },
				topRight: { x: 0, y: 0 },
				bottomLeft: { x: 0, y: 0 },
				bottomRight: { x: 0, y: 0 }
			};

			guideInsetsPx = {
				top: 24,
				bottom: 24,
				left: 24,
				right: 24
			};

			const input = document.getElementById('image-upload') as HTMLInputElement | null;
			if (input) input.value = '';
		}
		pageZoom = 1;
		stepSize = 1;
		isDark = true;
		sourceImageVisible = false;
		hasAdjustedVerticalGuides = false;
		hasAdjustedHorizontalGuides = false;
	}

	let pageZoom = $state(1);

	let pendingDetection = $state(false);

	let frozenStage = $state<{ width: number; height: number } | null>(null);

	let zoomLevel = $state(1);

	let imageReadyForControls = $state(false);

	let draggingCorner: keyof typeof corners | null = null;

	let didDragCorner = $state(false);
	let suppressClearSelectionUntil = 0;

	let draggingGuide = $state<GuideKey | null>(null);

	function onPointerMove(e: PointerEvent) {
		if (!draggingCorner || !imageEl) return;

		didDragCorner = true;

		const rect = imageEl.getBoundingClientRect();

		const x = ((e.clientX - rect.left) / rect.width) * imageEl.naturalWidth;
		const y = ((e.clientY - rect.top) / rect.height) * imageEl.naturalHeight;

		const clampedX = Math.max(0, Math.min(imageEl.naturalWidth, x));
		const clampedY = Math.max(0, Math.min(imageEl.naturalHeight, y));

		const current = corners[draggingCorner];

		moveCorner(draggingCorner, clampedX - current.x, clampedY - current.y, false);
	}

	function stopDrag() {
		const draggedCorner = draggingCorner;
		draggingCorner = null;

		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', stopDrag);

		if (draggedCorner) {
			selectCorner(draggedCorner);
		}
		if (didDragCorner) {
			suppressClearSelectionUntil = Date.now() + 250;
		}

		didDragCorner = false;
		runWarpPreview();
	}

	function clearActiveSelection() {
		if (Date.now() < suppressClearSelectionUntil) return;

		selectedTarget = null;
		activeGuide = null;
		activeCorner = null;
	}

	function imageXToPercent(x: number) {
		return `${(x / Math.max(imageEl?.naturalWidth || 1, 1)) * 100}%`;
	}

	function imageYToPercent(y: number) {
		return `${(y / Math.max(imageEl?.naturalHeight || 1, 1)) * 100}%`;
	}

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

	function loadFile(file: File) {
		if (!file.type.startsWith('image/')) return;

		imageFile = file;

		if (imageUrl) URL.revokeObjectURL(imageUrl);
		imageUrl = URL.createObjectURL(file);

		if (warpedImageUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(warpedImageUrl);
		}

		if (segmentationMaskUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(segmentationMaskUrl);
		}
		segmentationMaskUrl = '';

		warpedImageUrl = '';

		frozenZoom = null;
		autoZoomToCorners = false;
		zoomLevel = 1;

		frozenStage = null;

		pendingDetection = true;

		imageReadyForControls = false;

		animateSourceZoom = false;

		sourceImageVisible = false;
	}

	function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		loadFile(file);
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		const file = event.dataTransfer?.files?.[0];
		if (!file) return;
		loadFile(file);
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
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

	function runWarpPreview() {
		if (!imageEl) return;

		const backendCorners = getCornersForBackend();
		if (!backendCorners) return;

		const unordered: Quad = [
			{ x: backendCorners[0].x, y: backendCorners[0].y },
			{ x: backendCorners[1].x, y: backendCorners[1].y },
			{ x: backendCorners[2].x, y: backendCorners[2].y },
			{ x: backendCorners[3].x, y: backendCorners[3].y }
		];

		const corners = ensureClockwise(orderCorners(unordered));

		try {
			const nextUrl = warpImageToDataUrl(imageEl, corners);

			if (warpedImageUrl?.startsWith('blob:')) {
				URL.revokeObjectURL(warpedImageUrl);
			}

			warpedImageUrl = nextUrl;
		} catch (error) {
			console.error('Frontend warp failed:', error);
		}
	}

	function updateSize() {
		if (!containerEl) return;

		containerSize = {
			width: containerEl.clientWidth,
			height: containerEl.clientHeight
		};

		updateDisplayedImageRect();
	}

	let resizeObserver: ResizeObserver;

	onMount(() => {
		resizeObserver = new ResizeObserver(() => {
			updateSize();
			updateWarpDisplayedImageRect();
		});

		window.addEventListener('keydown', inputController.handleKeydown);
		window.addEventListener('keyup', inputController.handleKeyup);
		window.addEventListener('blur', inputController.clearPressedDirections);

		return () => {
			resizeObserver?.disconnect();
			window.removeEventListener('keydown', inputController.handleKeydown);
			window.removeEventListener('keyup', inputController.handleKeyup);
			window.removeEventListener('blur', inputController.clearPressedDirections);
			inputController.destroy();
		};
	});

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
			segmentationMaskUrl = getSegmentationMaskUrl(result);

			console.log('API corners raw', result.corners);

			if (!result.ok || !result.corners) {
				throw new Error('API did not return corners');
			}

			if (
				!Array.isArray(result.corners) ||
				result.corners.length !== 4 ||
				result.corners.some((c: any) => !Number.isFinite(c.x) || !Number.isFinite(c.y))
			) {
				throw new Error('API returned invalid corners');
			}

			applyReturnedCorners(result.corners);

			if (zoomLevel === 1) {
				autoZoomToCorners = false;
				frozenZoom = null;
				frozenStage = null;
				animateSourceZoom = false;

				await tick();

				const naturalWidth = imageEl?.naturalWidth || 1;
				const naturalHeight = imageEl?.naturalHeight || 1;

				const centerX =
					(corners.topLeft.x + corners.topRight.x + corners.bottomRight.x + corners.bottomLeft.x) /
					4;

				const centerY =
					(corners.topLeft.y + corners.topRight.y + corners.bottomRight.y + corners.bottomLeft.y) /
					4;

				const z = computeZoomMetrics({
					autoZoomToCorners: true,
					displayedImageRect,
					naturalWidth,
					naturalHeight,
					corners
				});

				frozenStage = {
					width: displayedImageRect.width,
					height: displayedImageRect.height
				};

				await tick();

				animateSourceZoom = true;

				requestAnimationFrame(() => {
					frozenZoom = {
						scale: z.scale,
						centerXNorm: centerX / naturalWidth,
						centerYNorm: centerY / naturalHeight
					};
				});
			} else {
				autoZoomToCorners = false;
				frozenZoom = null;
				frozenStage = null;
				animateSourceZoom = false;
			}

		} catch (error) {
			console.error(error);
		} finally {
			isSegmenting = false;
			imageReadyForControls = true;
		}
	}

	function getCornersForBackend() {
		return [
			{ id: 'top-left', ...corners.topLeft },
			{ id: 'top-right', ...corners.topRight },
			{ id: 'bottom-right', ...corners.bottomRight },
			{ id: 'bottom-left', ...corners.bottomLeft }
		];
	}

	function moveActiveGuide(direction: Direction) {
		if (!activeGuide) return;

		markGuideAdjusted(activeGuide);

		guideInsetsPx = applyGuideDirection(
			activeGuide,
			direction,
			guideInsetsPx,
			stepSize,
			warpDisplayedImageRect.width,
			warpDisplayedImageRect.height
		);
	}

	function updateWarpDisplayedImageRect() {
		if (!warpContainerEl) return;

		const width = warpContainerEl.clientWidth;
		const height = warpContainerEl.clientHeight;

		warpBoxSize = { width, height };

		warpDisplayedImageRect = {
			x: 0,
			y: 0,
			width,
			height
		};
	}

	const centeringStats = $derived(getCenteringStats(guideInsetsPx));

	function zoomPageIn() {
		applyPageZoom(1);
	}

	function zoomPageOut() {
		applyPageZoom(-1);
	}

	const verticalIsPerfect = $derived(
		hasAdjustedVerticalGuides &&
			Math.abs(centeringStats.topPct - 50) < 0.05 &&
			Math.abs(centeringStats.bottomPct - 50) < 0.05
	);

	const horizontalIsPerfect = $derived(
		hasAdjustedHorizontalGuides &&
			Math.abs(centeringStats.leftPct - 50) < 0.05 &&
			Math.abs(centeringStats.rightPct - 50) < 0.05
	);

	function markGuideAdjusted(guideKey: GuideKey) {
		if (guideKey === 'top' || guideKey === 'bottom') {
			hasAdjustedVerticalGuides = true;
		}

		if (guideKey === 'left' || guideKey === 'right') {
			hasAdjustedHorizontalGuides = true;
		}
	}

	function applyZoomDelta(direction: 1 | -1) {
		const currentIndex = ZOOM_VALUES.findIndex((v) => Math.abs(v - zoomLevel) < 0.001);
		const safeIndex = currentIndex === -1 ? ZOOM_VALUES.indexOf(1) : currentIndex;
		const nextIndex = Math.max(0, Math.min(ZOOM_VALUES.length - 1, safeIndex + direction));

		zoomLevel = ZOOM_VALUES[nextIndex];

		if (zoomLevel === 1) {
			frozenStage = null;
			frozenZoom = null;
			autoZoomToCorners = false;
			return;
		}

		if (!imageEl) return;

		const naturalWidth = imageEl.naturalWidth || 1;
		const naturalHeight = imageEl.naturalHeight || 1;

		const centerX =
			(corners.topLeft.x + corners.topRight.x + corners.bottomRight.x + corners.bottomLeft.x) / 4;

		const centerY =
			(corners.topLeft.y + corners.topRight.y + corners.bottomRight.y + corners.bottomLeft.y) / 4;

		frozenStage = null;

		frozenZoom = {
			scale: zoomLevel,
			centerXNorm: centerX / naturalWidth,
			centerYNorm: centerY / naturalHeight
		};

		autoZoomToCorners = false;
	}

	function updateDisplayedImageRect() {
		if (!containerEl || !imageEl) return;

		const containerWidth = containerSize.width;
		const containerHeight = containerSize.height;

		const naturalWidth = imageEl.naturalWidth;
		const naturalHeight = imageEl.naturalHeight;

		if (!naturalWidth || !naturalHeight) return;

		const imageAspect = naturalWidth / naturalHeight;

		if (frozenStage) {
			const width = frozenStage.width;
			const height = frozenStage.height;
			const x = (containerWidth - width) / 2;
			const y = (containerHeight - height) / 2;
			displayedImageRect = { x, y, width, height };
			return;
		}

		const maxStageWidth = Math.min(containerWidth, 720);
		const maxStageHeight = Math.min(containerHeight, 960);

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

	function applyPageZoom(direction: 1 | -1) {
		const currentIndex = PAGE_ZOOM_VALUES.findIndex((v) => Math.abs(v - pageZoom) < 0.001);
		const safeIndex = currentIndex === -1 ? PAGE_ZOOM_VALUES.indexOf(1) : currentIndex;

		const nextIndex = Math.max(0, Math.min(PAGE_ZOOM_VALUES.length - 1, safeIndex + direction));

		pageZoom = PAGE_ZOOM_VALUES[nextIndex];
	}

	function getZoomStyleLocal() {
		return getZoomStyle({
			frozenZoom,
			displayedImageRect,
			autoZoomToCorners,
			naturalWidth: imageEl?.naturalWidth || 1,
			naturalHeight: imageEl?.naturalHeight || 1,
			corners
		});
	}

	function getCornerPoint(cornerKey: keyof typeof corners) {
		return corners[cornerKey];
	}

	function getPrevCornerKey(cornerKey: keyof typeof corners): keyof typeof corners {
		if (cornerKey === 'topLeft') return 'bottomLeft';
		if (cornerKey === 'topRight') return 'topLeft';
		if (cornerKey === 'bottomRight') return 'topRight';
		return 'bottomRight';
	}

	function getNextCornerKey(cornerKey: keyof typeof corners): keyof typeof corners {
		if (cornerKey === 'topLeft') return 'topRight';
		if (cornerKey === 'topRight') return 'bottomRight';
		if (cornerKey === 'bottomRight') return 'bottomLeft';
		return 'topLeft';
	}

	function drawCornerZoomPatch() {
		if (!cornerZoomCanvas || !imageEl || !activeCorner) return;

		const ctx = cornerZoomCanvas.getContext('2d');
		if (!ctx) return;

		const naturalWidth = imageEl.naturalWidth;
		const naturalHeight = imageEl.naturalHeight;

		if (!naturalWidth || !naturalHeight) return;

		const cornerPt = getCornerPoint(activeCorner);

		const sx = Math.round(cornerPt.x - CORNER_PATCH_RADIUS);
		const sy = Math.round(cornerPt.y - CORNER_PATCH_RADIUS);
		const sw = CORNER_PATCH_RADIUS * 2;
		const sh = CORNER_PATCH_RADIUS * 2;

		ctx.clearRect(0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE);
		ctx.imageSmoothingEnabled = false;

		// black background for out-of-bounds areas near image edge
		ctx.fillStyle = '#09090b';
		ctx.fillRect(0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE);

		// draw cropped patch from source image
		ctx.drawImage(imageEl, sx, sy, sw, sh, 0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE);

		// overlay line segments connected to this corner
		const prevKey = getPrevCornerKey(activeCorner);
		const nextKey = getNextCornerKey(activeCorner);

		const prevPt = corners[prevKey];
		const nextPt = corners[nextKey];

		const scale = CORNER_ZOOM_SIZE / (CORNER_PATCH_RADIUS * 2);

		function toPatchX(x: number) {
			return (x - sx) * scale;
		}

		function toPatchY(y: number) {
			return (y - sy) * scale;
		}

		const cx = toPatchX(cornerPt.x);
		const cy = toPatchY(cornerPt.y);

		ctx.strokeStyle = '#22d3ee';
		ctx.lineWidth = 2;
		ctx.setLineDash([10, 8]);
		ctx.lineCap = 'round';

		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.lineTo(toPatchX(prevPt.x), toPatchY(prevPt.y));
		ctx.stroke();

		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.lineTo(toPatchX(nextPt.x), toPatchY(nextPt.y));
		ctx.stroke();

		// highlight active corner
		ctx.setLineDash([]);
		ctx.fillStyle = '#f87171';
		ctx.beginPath();
		ctx.arc(cx, cy, 5, 0, Math.PI * 2);
		ctx.fill();

		// crosshair
		ctx.strokeStyle = '#f87171';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(cx - 16, cy);
		ctx.lineTo(cx + 16, cy);
		ctx.moveTo(cx, cy - 16);
		ctx.lineTo(cx, cy + 16);
		ctx.stroke();
	}

	function handleSourceTrapKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab' || !sourceFocusTrapEl || !imageUrl) return;

		const focusable = Array.from(
			sourceFocusTrapEl.querySelectorAll<HTMLButtonElement>('button[data-source-corner="true"]')
		).filter((el) => !el.disabled);

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
		nextEl.focus();

		const cornerKey = nextEl.dataset.cornerKey as keyof typeof corners | undefined;
		if (cornerKey) {
			activeCorner = cornerKey;
			activeGuide = null;
		}
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
				logging: false
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

	function onGuidePointerMove(e: PointerEvent) {
		if (!draggingGuide || !warpContainerEl) return;

		const rect = warpContainerEl.getBoundingClientRect();

		const localX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
		const localY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

		markGuideAdjusted(draggingGuide);

		if (draggingGuide === 'top') {
			guideInsetsPx.top = Math.max(0, Math.min(rect.height, localY));
			return;
		}

		if (draggingGuide === 'bottom') {
			guideInsetsPx.bottom = Math.max(0, Math.min(rect.height, rect.height - localY));
			return;
		}

		if (draggingGuide === 'left') {
			guideInsetsPx.left = Math.max(0, Math.min(rect.width, localX));
			return;
		}

		if (draggingGuide === 'right') {
			guideInsetsPx.right = Math.max(0, Math.min(rect.width, rect.width - localX));
		}
	}

	function stopGuideDrag() {
		window.removeEventListener('pointermove', onGuidePointerMove);
		window.removeEventListener('pointerup', stopGuideDrag);

		if (draggingGuide) {
			selectGuide(draggingGuide);
		}

		draggingGuide = null;
	}

	function startGuideDrag(e: PointerEvent, guideKey: GuideKey) {
		e.stopPropagation();
		e.preventDefault();

		selectGuide(guideKey);
		draggingGuide = guideKey;

		window.addEventListener('pointermove', onGuidePointerMove);
		window.addEventListener('pointerup', stopGuideDrag);
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
			runSegmentationInBrowser();
		}
	}
</script>

<div
	class="origin-top-left w-full overflow-x-hidden"
	style={`
		transform: scale(${pageZoom});
		width: 100%;
	`}
>
	<div
		class="min-h-screen bg-zinc-950
		text-zinc-100 select-none"
	>
		<header class="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
			<div class="max-w-8xl mx-auto flex items-center justify-end px-6 py-4">
				<div class="text-right">
					<h1 class="text-2xl font-semibold tracking-tight">Card Centering</h1>
					<p class="text-sm text-zinc-400">Upload, detect, refine, and warp</p>
				</div>
			</div>
		</header>

		<main class="mx-auto flex h-[calc(100vh-220px)] w-full flex-col gap-6 px-6 py-6">
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
								<!-- row 1: one full-width action button -->
								<div>
									<button
										class={`w-full rounded-lg border px-3 py-2.5 text-sm transition ${
											isSegmenting
												? 'border-blue-400 bg-zinc-800 text-blue-300 animate-pulse shadow-[0_0_12px_rgba(59,130,246,0.7)]'
												: !imageUrl
													? 'border-cyan-400 bg-zinc-900 text-cyan-300 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.5)] hover:bg-zinc-800'
													: 'border-zinc-700 bg-zinc-950 hover:bg-zinc-800'
										}`}
										type="button"
										onclick={() => {
											if (isSegmenting) return;

											if (!imageUrl) {
												document.getElementById('image-upload')?.click();
												return;
											}

											resetHandler();
										}}
										disabled={isSegmenting}
									>
										{isSegmenting ? 'Running...' : !imageUrl ? 'Upload' : 'Reset'}
									</button>
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
										<option value={0.25}>.25 px</option>
										<option value={0.5}>.5 px</option>
										<option value={1}>1 px</option>
										<option value={2}>2 px</option>
										<option value={5}>5 px</option>
									</select>
								</div>

								<!-- row 3: zoom controls -->
								<div class="grid grid-cols-3 gap-3">
									<button
										class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm hover:bg-zinc-800"
										onclick={zoomPageOut}
										type="button"
									>
										-
									</button>

									<div
										class="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300"
									>
										{Math.round(pageZoom * 100)}%
									</div>

									<button
										class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm hover:bg-zinc-800"
										onclick={zoomPageIn}
										type="button"
									>
										+
									</button>
								</div>
							</div>
						</div>

						<div class="hidden xl:block rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
							<div class="mb-3 flex items-center justify-between">
								<div class="text-xs font-medium tracking-[0.2em] text-zinc-500 uppercase">
									Card Controls MINI MAP
								</div>
							</div>

							<div class="mx-auto flex max-w-[260px] flex-col items-center gap-1 p-2">
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
								<svg viewBox="0 0 220 210" class="w-full overflow-visible">
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
											selectGuide('top');
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectGuide('top');
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
											selectGuide('right');
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectGuide('right');
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
											selectGuide('bottom');
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectGuide('bottom');
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
											selectGuide('left');
										}}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												selectGuide('left');
											}
										}}
									/>

									<!-- corner hotspots -->
									<circle
										cx="60"
										cy="30"
										r="12"
										class={activeCorner === 'topLeft'
											? 'fill-cyan-400 stroke-cyan-300'
											: 'fill-zinc-700 stroke-zinc-500'}
										stroke-width="2"
										onclick={() => selectCorner('topLeft')}
									/>
									<circle
										cx="160"
										cy="30"
										r="12"
										class={activeCorner === 'topRight'
											? 'fill-cyan-400 stroke-cyan-300'
											: 'fill-zinc-700 stroke-zinc-500'}
										stroke-width="2"
										onclick={() => selectCorner('topRight')}
									/>
									<circle
										cx="60"
										cy="170"
										r="12"
										class={activeCorner === 'bottomLeft'
											? 'fill-cyan-400 stroke-cyan-300'
											: 'fill-zinc-700 stroke-zinc-500'}
										stroke-width="2"
										onclick={() => selectCorner('bottomLeft')}
									/>
									<circle
										cx="160"
										cy="170"
										r="12"
										class={activeCorner === 'bottomRight'
											? 'fill-cyan-400 stroke-cyan-300'
											: 'fill-zinc-700 stroke-zinc-500'}
										stroke-width="2"
										onclick={() => selectCorner('bottomRight')}
									/>
								</svg>
								<div class="grid grid-cols-3 gap-2">
									<div></div>
									<button
										class={getPadButtonClass('up')}
										type="button"
										onpointerdown={(e) => {
											e.preventDefault();
											inputController.startPadHold('up');
										}}
										onpointerup={inputController.stopPadHold}
										onpointerleave={inputController.stopPadHold}
										onpointercancel={inputController.stopPadHold}
									>
										↑
									</button>
									<div></div>

									<button
										class={getPadButtonClass('left')}
										type="button"
										onpointerdown={(e) => {
											e.preventDefault();
											inputController.startPadHold('left');
										}}
										onpointerup={inputController.stopPadHold}
										onpointerleave={inputController.stopPadHold}
										onpointercancel={inputController.stopPadHold}
									>
										←
									</button>

									<button
										class="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
										type="button"
										onclick={() => {
											selectedTarget = null;
											activeCorner = null;
											activeGuide = null;
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
											inputController.startPadHold('right');
										}}
										onpointerup={inputController.stopPadHold}
										onpointerleave={inputController.stopPadHold}
										onpointercancel={inputController.stopPadHold}
									>
										→
									</button>

									<div></div>
									<button
										class={getPadButtonClass('down')}
										type="button"
										onpointerdown={(e) => {
											e.preventDefault();
											inputController.startPadHold('down');
										}}
										onpointerup={inputController.stopPadHold}
										onpointerleave={inputController.stopPadHold}
										onpointercancel={inputController.stopPadHold}
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
										can be used to adjust.
									</li>
									<li>
										Use the warp preview to verify alignment. WASD, arrow pads, directional keys,
										and mouse can be used to adjust.
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
						>
							<input
								id="image-upload"
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
										class="absolute inset-0 touch-none"
										role="button"
										tabindex="0"
										bind:this={sourceFocusTrapEl}
										onclick={clearActiveSelection}
										onkeydown={(e) => {
											handleSourceTrapKeydown(e);

											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												clearActiveSelection();
											}
										}}
									>
										<!-- fixed review viewport -->
										<div class="absolute inset-0 overflow-hidden rounded-xl">
											<!-- static background fill so no black bars ever appear -->
											<div class="absolute inset-0 bg-zinc-950"></div>

											<!-- fixed image plane -->
											<div
												class={`absolute overflow-hidden ${animateSourceZoom ? 'transition-[transform] duration-700 ease-out' : ''}`}
												style={`
															left: ${displayedImageRect.x}px;
															top: ${displayedImageRect.y}px;
															width: ${displayedImageRect.width}px;
															height: ${displayedImageRect.height}px;
															will-change: transform;
															${getZoomStyleLocal()}
														`}
											>
												<div class="absolute inset-0">
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
												</div>
												{#each cornerOverlayItems as corner}
													<button
														type="button"
														aria-label={`Toggle ${corner.key} arrow control`}
														aria-pressed={activeCorner === corner.key}
														class="absolute z-10 flex h-10 w-10 items-center justify-center"
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

															selectCorner(corner.key);
															draggingCorner = corner.key;
															didDragCorner = false;

															window.addEventListener('pointermove', onPointerMove);
															window.addEventListener('pointerup', stopDrag);
														}}
														onclick={(e) => {
															e.stopPropagation();
															selectCorner(corner.key);
														}}
														data-source-corner="true"
														data-corner-key={corner.key}
													>
														<div
															class={`h-7 w-7 transition ${
																activeCorner === corner.key
																	? '[filter:drop-shadow(0_0_6px_rgba(34,211,238,0.9)) drop-shadow(0_0_12px_rgba(34,211,238,0.7))] animate-pulse text-red-400'
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
											</div>
										</div>
									</div>
								{/if}
							</div>
							{#if imageUrl && activeCorner}
								<div
									transition:fade={{ duration: 180 }}
									class="pointer-events-none absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
								>
									<div
										class="corner-zoom-frame pointer-events-auto relative border-2 border-dotted border-cyan-400 p-0"
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

						<div class="mx-auto grid w-full max-w-[420px] grid-cols-2 items-center gap- p-1">
							<svg viewBox="0 0 220 210" class="h-[210px] w-full overflow-visible">
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

								<!-- corner hotspots -->
								<circle
									cx="60"
									cy="30"
									r="12"
									class={activeCorner === 'topLeft'
										? 'fill-cyan-400 stroke-cyan-300'
										: 'fill-zinc-700 stroke-zinc-500'}
									stroke-width="2"
									onclick={() => selectCorner('topLeft')}
								/>
								<circle
									cx="160"
									cy="30"
									r="12"
									class={activeCorner === 'topRight'
										? 'fill-cyan-400 stroke-cyan-300'
										: 'fill-zinc-700 stroke-zinc-500'}
									stroke-width="2"
									onclick={() => selectCorner('topRight')}
								/>
								<circle
									cx="60"
									cy="170"
									r="12"
									class={activeCorner === 'bottomLeft'
										? 'fill-cyan-400 stroke-cyan-300'
										: 'fill-zinc-700 stroke-zinc-500'}
									stroke-width="2"
									onclick={() => selectCorner('bottomLeft')}
								/>
								<circle
									cx="160"
									cy="170"
									r="12"
									class={activeCorner === 'bottomRight'
										? 'fill-cyan-400 stroke-cyan-300'
										: 'fill-zinc-700 stroke-zinc-500'}
									stroke-width="2"
									onclick={() => selectCorner('bottomRight')}
								/>
							</svg>
							<div class="grid h-[150px] w-full grid-cols-3 gap-2 self-center">
								<div></div>
								<button
									class={getPadButtonClass('up')}
									type="button"
									onpointerdown={(e) => {
										e.preventDefault();
										inputController.startPadHold('up');
									}}
									onpointerup={inputController.stopPadHold}
									onpointerleave={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
								>
									↑
								</button>
								<div></div>

								<button
									class={getPadButtonClass('left')}
									type="button"
									onpointerdown={(e) => {
										e.preventDefault();
										inputController.startPadHold('left');
									}}
									onpointerup={inputController.stopPadHold}
									onpointerleave={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
								>
									←
								</button>

								<button
									class="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
									type="button"
									onclick={() => {
										selectedTarget = null;
										activeCorner = null;
										activeGuide = null;
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
										inputController.startPadHold('right');
									}}
									onpointerup={inputController.stopPadHold}
									onpointerleave={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
								>
									→
								</button>

								<div></div>
								<button
									class={getPadButtonClass('down')}
									type="button"
									onpointerdown={(e) => {
										e.preventDefault();
										inputController.startPadHold('down');
									}}
									onpointerup={inputController.stopPadHold}
									onpointerleave={inputController.stopPadHold}
									onpointercancel={inputController.stopPadHold}
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
											? 'border-yellow-300 shadow-[0_0_18px_rgba(250,204,21,0.65)]'
											: 'border-zinc-800'
									}`}
								>
									<div class="relative grid grid-cols-2 gap-x-4 sm:gap-x-8">
										<div class="text-left">
											<div class="text-sm text-zinc-400">Top</div>
											<div
												class={`mt-2 text-xl sm:text-2xl font-semibold transition ${
													verticalIsPerfect
														? 'text-yellow-300 drop-shadow-[0_0_8px_rgba(250,204,21,0.9)]'
														: centeringStats.topPct > ALERT_THRESHOLD
															? 'text-red-400'
															: 'text-zinc-100'
												}`}
											>
												{formatPct(centeringStats.topPct)}
											</div>
										</div>

										<div class="text-right">
											<div class="text-sm text-zinc-400">Bottom</div>
											<div
												class={`mt-2 text-xl sm:text-2xl font-semibold transition ${
													verticalIsPerfect
														? 'text-yellow-300 drop-shadow-[0_0_8px_rgba(250,204,21,0.9)]'
														: centeringStats.bottomPct > ALERT_THRESHOLD
															? 'text-red-400'
															: 'text-zinc-100'
												}`}
											>
												{formatPct(centeringStats.bottomPct)}
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
											? 'border-yellow-300 shadow-[0_0_18px_rgba(250,204,21,0.65)]'
											: 'border-zinc-800'
									}`}
								>
									<div class="relative grid grid-cols-2 gap-x-4 sm:gap-x-8">
										<div class="text-left">
											<div class="text-sm text-zinc-400">Left</div>
											<div
												class={`mt-2 text-xl sm:text-2xl font-semibold transition ${
													horizontalIsPerfect
														? 'text-yellow-300 drop-shadow-[0_0_8px_rgba(250,204,21,0.9)]'
														: centeringStats.leftPct > ALERT_THRESHOLD
															? 'text-red-400'
															: 'text-zinc-100'
												}`}
											>
												{formatPct(centeringStats.leftPct)}
											</div>
										</div>

										<div class="text-right">
											<div class="text-sm text-zinc-400">Right</div>
											<div
												class={`mt-2 text-xl sm:text-2xl font-semibold transition ${
													horizontalIsPerfect
														? 'text-yellow-300 drop-shadow-[0_0_8px_rgba(250,204,21,0.9)]'
														: centeringStats.rightPct > ALERT_THRESHOLD
															? 'text-red-400'
															: 'text-zinc-100'
												}`}
											>
												{formatPct(centeringStats.rightPct)}
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
								class="relative aspect-[5/7] w-full xl:w-[525px] touch-none border border-dashed border-zinc-700 bg-zinc-950"
								bind:this={warpContainerEl}
								role="button"
								tabindex="0"
								onclick={clearActiveSelection}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										clearActiveSelection();
									}
								}}
							>
								{#if warpedImageUrl}
									<div class="absolute inset-0 overflow-hidden">
										<img
											src={warpedImageUrl}
											alt="Warped preview"
											class="absolute inset-0 h-full w-full object-cover"
											onload={() => updateWarpDisplayedImageRect()}
											draggable="false"
										/>

										<svg
											class="pointer-events-none absolute inset-0 h-full w-full"
											viewBox={`0 0 ${Math.max(warpDisplayedImageRect.width, 1)} ${Math.max(warpDisplayedImageRect.height, 1)}`}
											preserveAspectRatio="none"
										>
											<!-- top -->
											<line
												x1="0"
												y1={guideInsetsPx.top}
												x2={warpDisplayedImageRect.width}
												y2={guideInsetsPx.top}
												stroke={activeGuide === 'top' ? '#f87171' : '#22d3ee'}
												stroke-width="2"
												stroke-dasharray="10 8"
												stroke-linecap="round"
												vector-effect="non-scaling-stroke"
											/>

											<!-- bottom -->
											<line
												x1="0"
												y1={warpDisplayedImageRect.height - guideInsetsPx.bottom}
												x2={warpDisplayedImageRect.width}
												y2={warpDisplayedImageRect.height - guideInsetsPx.bottom}
												stroke={activeGuide === 'bottom' ? '#f87171' : '#22d3ee'}
												stroke-width="2"
												stroke-dasharray="10 8"
												stroke-linecap="round"
												vector-effect="non-scaling-stroke"
											/>

											<!-- left -->
											<line
												x1={guideInsetsPx.left}
												y1="0"
												x2={guideInsetsPx.left}
												y2={warpDisplayedImageRect.height}
												stroke={activeGuide === 'left' ? '#f87171' : '#22d3ee'}
												stroke-width="2"
												stroke-dasharray="10 8"
												stroke-linecap="round"
												vector-effect="non-scaling-stroke"
											/>

											<!-- right -->
											<line
												x1={warpDisplayedImageRect.width - guideInsetsPx.right}
												y1="0"
												x2={warpDisplayedImageRect.width - guideInsetsPx.right}
												y2={warpDisplayedImageRect.height}
												stroke={activeGuide === 'right' ? '#f87171' : '#22d3ee'}
												stroke-width="2"
												stroke-dasharray="10 8"
												stroke-linecap="round"
												vector-effect="non-scaling-stroke"
											/>
										</svg>

										<div class="absolute inset-0">
											<!-- top click target -->
											<!-- top -->
											<button
												type="button"
												aria-label="Adjust top guide"
												class="absolute left-0 right-0 h-10 -translate-y-1/2 cursor-pointer"
												style={`top: ${guideInsetsPx.top}px;`}
												onpointerdown={(e) => {
													e.stopPropagation();
													startGuideDrag(e, 'top');
												}}
												onclick={(e) => {
													e.stopPropagation();
													selectGuide('top');
												}}
												onfocus={() => {
													selectGuide('top');
												}}
											></button>

											<!-- bottom -->
											<button
												type="button"
												aria-label="Adjust bottom guide"
												class="absolute left-0 right-0 h-10 -translate-y-1/2 cursor-pointer"
												style={`top: ${warpDisplayedImageRect.height - guideInsetsPx.bottom}px;`}
												onpointerdown={(e) => {
													e.stopPropagation();
													startGuideDrag(e, 'bottom');
												}}
												onclick={(e) => {
													e.stopPropagation();
													selectGuide('bottom');
												}}
												onfocus={() => {
													selectGuide('bottom');
												}}
											></button>

											<!-- left -->
											<button
												type="button"
												aria-label="Adjust left guide"
												class="absolute top-0 bottom-0 w-10 -translate-x-1/2 cursor-pointer"
												style={`left: ${guideInsetsPx.left}px;`}
												onpointerdown={(e) => {
													e.stopPropagation();
													startGuideDrag(e, 'left');
												}}
												onclick={(e) => {
													e.stopPropagation();
													selectGuide('left');
												}}
												onfocus={() => {
													selectGuide('left');
												}}
											></button>

											<!-- right -->
											<button
												type="button"
												aria-label="Adjust right guide"
												class="absolute top-0 bottom-0 w-10 -translate-x-1/2 cursor-pointer"
												style={`left: ${warpDisplayedImageRect.width - guideInsetsPx.right}px;`}
												onpointerdown={(e) => {
													e.stopPropagation();
													startGuideDrag(e, 'right');
												}}
												onclick={(e) => {
													e.stopPropagation();
													selectGuide('right');
												}}
												onfocus={() => {
													selectGuide('right');
												}}
											></button>

											{#if activeGuide === 'top'}
												<div
													class="pointer-events-none absolute left-1/2 flex -translate-x-1/2 translate-y-[40%] items-center justify-center"
													style={`top: ${guideInsetsPx.top}px;`}
												>
													<svg
														viewBox="0 0 80 80"
														class="h-16 w-16 text-red-400 [filter:drop-shadow(0_0_6px_rgba(248,113,113,0.95))_drop-shadow(0_0_14px_rgba(248,113,113,0.75))]"
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
											{/if}

											{#if activeGuide === 'bottom'}
												<div
													class="pointer-events-none absolute left-1/2 flex -translate-x-1/2 -translate-y-[140%] items-center justify-center"
													style={`top: ${warpDisplayedImageRect.height - guideInsetsPx.bottom}px;`}
												>
													<svg
														viewBox="0 0 80 80"
														class="h-16 w-16 rotate-180 text-red-400 [filter:drop-shadow(0_0_6px_rgba(248,113,113,0.95))_drop-shadow(0_0_14px_rgba(248,113,113,0.75))]"
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
											{/if}

											{#if activeGuide === 'left'}
												<div
													class="pointer-events-none absolute top-1/2 flex translate-x-[40%] -translate-y-1/2 items-center justify-center"
													style={`left: ${guideInsetsPx.left}px;`}
												>
													<svg
														viewBox="0 0 80 80"
														class="h-16 w-16 -rotate-90 text-red-400 [filter:drop-shadow(0_0_6px_rgba(248,113,113,0.95))_drop-shadow(0_0_14px_rgba(248,113,113,0.75))]"
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
											{/if}

											{#if activeGuide === 'right'}
												<div
													class="pointer-events-none absolute top-1/2 flex -translate-x-[140%] -translate-y-1/2 items-center justify-center"
													style={`left: ${warpDisplayedImageRect.width - guideInsetsPx.right}px;`}
												>
													<svg
														viewBox="0 0 80 80"
														class="h-16 w-16 rotate-90 text-red-400 [filter:drop-shadow(0_0_6px_rgba(248,113,113,0.95))_drop-shadow(0_0_14px_rgba(248,113,113,0.75))]"
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
											{/if}
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

						<div class="mx-auto grid w-full max-w-[420px] grid-cols-2 items-center gap- p-1">
							<svg viewBox="0 0 220 210" class="h-[210px] w-full overflow-visible">
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
										selectGuide('top');
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectGuide('top');
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
										selectGuide('right');
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectGuide('right');
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
										selectGuide('bottom');
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectGuide('bottom');
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
										selectGuide('left');
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectGuide('left');
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
									onclick={() => nudgeSelected('up')}>↑</button
								>
								<div></div>

								<button
									class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
									onclick={() => nudgeSelected('left')}>←</button
								>
								<button
									class="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2"
									onclick={() => {
										selectedTarget = null;
										activeCorner = null;
										activeGuide = null;
									}}>•</button
								>
								<button
									class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
									onclick={() => nudgeSelected('right')}>→</button
								>

								<div></div>
								<button
									class="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2"
									onclick={() => nudgeSelected('down')}>↓</button
								>
								<div></div>
							</div>
						</div>
					</div>
				</section>
			</div>
		</main>
	</div>
</div>
