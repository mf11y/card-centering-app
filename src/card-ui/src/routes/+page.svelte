<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { flip } from 'svelte/animate';

	const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000/api';

	const cornerPads = [
		{ id: 'topLeft', label: 'Top Left' },
		{ id: 'topRight', label: 'Top Right' },
		{ id: 'bottomLeft', label: 'Bottom Left' },
		{ id: 'bottomRight', label: 'Bottom Right' }
	];

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

	let activeDirection = $state<'up' | 'down' | 'left' | 'right' | null>(null);

	let isSegmenting = $state(false);
	let segmentationResult = $state<any>(null);
	let segmentationError = $state('');

	const STEP_VALUES = [0.25, 0.5, 1, 2, 5];

	let stepSizeFlash = $state(false);
	let stepSizeFlashTimeout: ReturnType<typeof setTimeout> | null = null;

	let imageEl = $state.raw<HTMLImageElement | null>(null);
	let displayedImageRect = $state({ x: 0, y: 0, width: 1, height: 1 });

	let autoZoomToCorners = $state(false);

	let warpedImageUrl = $state('');

	let warpPreviewTimeout: ReturnType<typeof setTimeout> | null = null;

	let centeringMetrics = $state({
		topInsetPct: 6,
		bottomInsetPct: 6,
		leftInsetPct: 6,
		rightInsetPct: 6
	});

	type GuideKey = 'top' | 'bottom' | 'left' | 'right';

	let activeGuide = $state<GuideKey | null>(null);

	let guideInsetsPx = $state({
		top: 24,
		bottom: 24,
		left: 24,
		right: 24
	});

	let warpContainerEl = $state.raw<HTMLDivElement | null>(null);
	let warpImageEl = $state.raw<HTMLImageElement | null>(null);

	let warpContainerSize = $state({ width: 1, height: 1 });
	let warpDisplayedImageRect = $state({ x: 0, y: 0, width: 1, height: 1 });

	let frozenZoom = $state<{
		scale: number;
		centerXNorm: number;
		centerYNorm: number;
	} | null>(null);

	let warpBoxSize = $state({ width: 0, height: 0 });

	let segmentationMaskUrl = $state('');

	let showUploadButton = $state(true);
	let hideUploadTimeout: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const shouldShow = !imageReadyForControls || isSegmenting;

		if (shouldShow) {
			if (hideUploadTimeout) {
				clearTimeout(hideUploadTimeout);
				hideUploadTimeout = null;
			}
			showUploadButton = true;
			return;
		}

		if (hideUploadTimeout) clearTimeout(hideUploadTimeout);

		hideUploadTimeout = setTimeout(() => {
			showUploadButton = false;
			hideUploadTimeout = null;
		}, 220);

		return () => {
			if (hideUploadTimeout) {
				clearTimeout(hideUploadTimeout);
				hideUploadTimeout = null;
			}
		};
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
			segmentationError = '';
			segmentationResult = null;
			activeCorner = null;
			activeGuide = null;
			frozenZoom = null;
			frozenStage = null;
			autoZoomToCorners = false;
			zoomLevel = 1;
			pendingDetection = false;
			imageReadyForControls = false;

			corners = {
				topLeft: { x: 0, y: 0 },
				topRight: { x: 0, y: 0 },
				bottomLeft: { x: 0, y: 0 },
				bottomRight: { x: 0, y: 0 }
			};

			const input = document.getElementById('image-upload') as HTMLInputElement | null;
			if (input) input.value = '';
		}
	}

	function snapGuideDisplayPx(value: number) {
		return Math.round(value * 2) / 2;
	}

	const GUIDE_STEP = 1;

	let pageZoom = $state(1);

	const PAGE_ZOOM_VALUES = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

	function applyPageZoom(direction: 1 | -1) {
		const currentIndex = PAGE_ZOOM_VALUES.findIndex((v) => Math.abs(v - pageZoom) < 0.001);
		const safeIndex = currentIndex === -1 ? PAGE_ZOOM_VALUES.indexOf(1) : currentIndex;

		const nextIndex = Math.max(0, Math.min(PAGE_ZOOM_VALUES.length - 1, safeIndex + direction));

		pageZoom = PAGE_ZOOM_VALUES[nextIndex];
	}

	function zoomPageIn() {
		applyPageZoom(1);
	}

	function zoomPageOut() {
		applyPageZoom(-1);
	}

	const centeringGuides = [
		{ id: 'top', orientation: 'horizontal' },
		{ id: 'bottom', orientation: 'horizontal' },
		{ id: 'left', orientation: 'vertical' },
		{ id: 'right', orientation: 'vertical' }
	] as const;

	const cornerOverlayItems = [
		{ key: 'topLeft', label: '' },
		{ key: 'topRight', label: '' },
		{ key: 'bottomLeft', label: '' },
		{ key: 'bottomRight', label: '' }
	] as const;

	const ALERT_THRESHOLD = 56;

	function clearActiveSelection() {
		activeGuide = null;
		activeCorner = null;
	}

	let pendingDetection = $state(false);

	let frozenStage = $state<{ width: number; height: number } | null>(null);

	let zoomLevel = $state(1);

	let imageReadyForControls = $state(false);

	const ZOOM_VALUES = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];

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

	function setSegmentationMaskFromResult(result: any) {
		if (segmentationMaskUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(segmentationMaskUrl);
		}
		segmentationMaskUrl = '';

		// supports:
		// result.mask_data_url
		// result.mask_base64
		// result.mask_png_base64
		// result.mask_url
		if (
			typeof result?.mask_data_url === 'string' &&
			result.mask_data_url.startsWith('data:image/')
		) {
			segmentationMaskUrl = result.mask_data_url;
			return;
		}

		if (typeof result?.mask_base64 === 'string' && result.mask_base64.length > 0) {
			segmentationMaskUrl = `data:image/png;base64,${result.mask_base64}`;
			return;
		}

		if (typeof result?.mask_png_base64 === 'string' && result.mask_png_base64.length > 0) {
			segmentationMaskUrl = `data:image/png;base64,${result.mask_png_base64}`;
			return;
		}

		if (typeof result?.mask_url === 'string' && result.mask_url.length > 0) {
			segmentationMaskUrl = result.mask_url;
		}
	}

	function zoomIn() {
		applyZoomDelta(1);
	}

	function zoomOut() {
		applyZoomDelta(-1);
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

		segmentationError = '';
		segmentationResult = null;

		frozenZoom = null;
		autoZoomToCorners = false;
		zoomLevel = 1;

		frozenStage = null;

		pendingDetection = true;

		imageReadyForControls = false;
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

	function moveCorner(cornerKey: keyof typeof corners, dx: number, dy: number) {
		if (!imageEl) return;

		const naturalWidth = imageEl.naturalWidth;
		const naturalHeight = imageEl.naturalHeight;

		if (!naturalWidth || !naturalHeight) return;

		const current = corners[cornerKey];

		const nextX = Math.max(0, Math.min(naturalWidth, current.x + dx));
		const nextY = Math.max(0, Math.min(naturalHeight, current.y + dy));

		corners[cornerKey] = {
			x: nextX,
			y: nextY
		};
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

	function orderCorners(corners: Point[]): [Point, Point, Point, Point] {
		// compute center
		const cx = corners.reduce((sum, p) => sum + p.x, 0) / 4;
		const cy = corners.reduce((sum, p) => sum + p.y, 0) / 4;

		// sort by angle around center
		const sorted = [...corners].sort((a, b) => {
			const angleA = Math.atan2(a.y - cy, a.x - cx);
			const angleB = Math.atan2(b.y - cy, b.x - cx);
			return angleA - angleB;
		});

		// now assign based on position
		let tl = sorted[0];
		let tr = sorted[1];
		let br = sorted[2];
		let bl = sorted[3];

		// fix orientation (ensure TL is actually top-left)
		const byY = [...sorted].sort((a, b) => a.y - b.y);
		const top = byY.slice(0, 2);
		const bottom = byY.slice(2, 4);

		const [topLeft, topRight] = top.sort((a, b) => a.x - b.x);
		const [bottomLeft, bottomRight] = bottom.sort((a, b) => a.x - b.x);

		return [topLeft, topRight, bottomRight, bottomLeft];
	}

	function ensureClockwise(corners: [Point, Point, Point, Point]): [Point, Point, Point, Point] {
		const [tl, tr, br, bl] = corners;

		const cross = (tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x);

		// if cross < 0 → points are flipped → fix it
		if (cross < 0) {
			return [tl, bl, br, tr]; // swap orientation
		}

		return corners;
	}

	function runWarpPreview() {
		if (!imageEl) return;

		const backendCorners = getCornersForBackend();
		if (!backendCorners) return;

		const unordered = [
			{ x: backendCorners[0].x, y: backendCorners[0].y },
			{ x: backendCorners[1].x, y: backendCorners[1].y },
			{ x: backendCorners[2].x, y: backendCorners[2].y },
			{ x: backendCorners[3].x, y: backendCorners[3].y }
		];

		let corners = orderCorners(unordered);
		corners = ensureClockwise(corners);

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

	$effect(() => {
		if (!imageFile) return;
		if (!imageEl) return;

		corners.topLeft.x;
		corners.topLeft.y;
		corners.topRight.x;
		corners.topRight.y;
		corners.bottomRight.x;
		corners.bottomRight.y;
		corners.bottomLeft.x;
		corners.bottomLeft.y;

		if (warpPreviewTimeout) {
			clearTimeout(warpPreviewTimeout);
		}

		warpPreviewTimeout = setTimeout(() => {
			runWarpPreview();
		}, 50);

		return () => {
			if (warpPreviewTimeout) {
				clearTimeout(warpPreviewTimeout);
			}
		};
	});

	let resizeObserver: ResizeObserver;

	onMount(() => {
		resizeObserver = new ResizeObserver(() => {
			updateSize();
			updateWarpDisplayedImageRect();
		});

		const handleMouseDown = (e: MouseEvent) => {
			const el = e.target as HTMLElement;
			if (el.closest('button')) {
				e.preventDefault();
			}
		};

		window.addEventListener('keydown', handleKeydown);
		window.addEventListener('keyup', handleKeyup);
		window.addEventListener('mousedown', handleMouseDown);

		return () => {
			resizeObserver?.disconnect();
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('keyup', handleKeyup);
			window.removeEventListener('mousedown', handleMouseDown);
		};
	});

	function toggleCornerActive(cornerKey: keyof typeof corners) {
		if (activeCorner === cornerKey) {
			activeCorner = null;
		} else {
			activeCorner = cornerKey;
			activeGuide = null;
			if (!frozenZoom && zoomLevel === 1) {
				const z = computeZoomMetrics();

				const naturalWidth = imageEl?.naturalWidth || 1;
				const naturalHeight = imageEl?.naturalHeight || 1;

				const centerX =
					(corners.topLeft.x + corners.topRight.x + corners.bottomRight.x + corners.bottomLeft.x) /
					4;

				const centerY =
					(corners.topLeft.y + corners.topRight.y + corners.bottomRight.y + corners.bottomLeft.y) /
					4;

				frozenZoom = {
					scale: z.scale,
					centerXNorm: centerX / naturalWidth,
					centerYNorm: centerY / naturalHeight
				};
			}
		}
	}

	function moveActiveCorner(dx: number, dy: number) {
		if (!activeCorner) return;
		moveCorner(activeCorner, dx, dy);
	}
	function handleKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const tag = target?.tagName;

		if (tag === 'INPUT' || tag === 'TEXTAREA') return;

		const key = event.key.toLowerCase();

		switch (key) {
			case 'escape':
				activeCorner = null;
				activeGuide = null;
				activeDirection = null;
				return;

			case 'arrowup':
			case 'w':
				if (!activeCorner && !activeGuide) return;
				event.preventDefault();
				(document.activeElement as HTMLElement | null)?.blur();
				activeDirection = 'up';
				if (activeCorner) {
					moveActiveCorner(0, -stepSize);
				} else if (activeGuide) {
					moveActiveGuide('up');
				}
				break;

			case 'arrowdown':
			case 's':
				if (!activeCorner && !activeGuide) return;
				event.preventDefault();
				(document.activeElement as HTMLElement | null)?.blur();
				activeDirection = 'down';
				if (activeCorner) {
					moveActiveCorner(0, stepSize);
				} else if (activeGuide) {
					moveActiveGuide('down');
				}
				break;

			case 'arrowleft':
			case 'a':
				if (!activeCorner && !activeGuide) return;
				event.preventDefault();
				(document.activeElement as HTMLElement | null)?.blur();
				activeDirection = 'left';
				if (activeCorner) {
					moveActiveCorner(-stepSize, 0);
				} else if (activeGuide) {
					moveActiveGuide('left');
				}
				break;

			case 'arrowright':
			case 'd':
				if (!activeCorner && !activeGuide) return;
				event.preventDefault();
				(document.activeElement as HTMLElement | null)?.blur();
				activeDirection = 'right';
				if (activeCorner) {
					moveActiveCorner(stepSize, 0);
				} else if (activeGuide) {
					moveActiveGuide('right');
				}
				break;
		}
	}

	function handleKeyup() {
		activeDirection = null;
	}

	function flashStepSize() {
		stepSizeFlash = true;

		if (stepSizeFlashTimeout) {
			clearTimeout(stepSizeFlashTimeout);
		}

		stepSizeFlashTimeout = setTimeout(() => {
			stepSizeFlash = false;
		}, 180);
	}

	function handleWheel(event: WheelEvent) {
		event.preventDefault();

		const currentIndex = STEP_VALUES.indexOf(stepSize);

		if (event.deltaY < 0) {
			const nextIndex = (currentIndex + 1) % STEP_VALUES.length;
			stepSize = STEP_VALUES[nextIndex];
		} else {
			const nextIndex = (currentIndex - 1 + STEP_VALUES.length) % STEP_VALUES.length;
			stepSize = STEP_VALUES[nextIndex];
		}

		flashStepSize();
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
	}

	type Point = { x: number; y: number };

	function distance(a: Point, b: Point) {
		return Math.hypot(b.x - a.x, b.y - a.y);
	}

	function computeWarpOutputSize(
		tl: Point,
		tr: Point,
		br: Point,
		bl: Point,
		targetAspect = 63 / 88
	) {
		const widthTop = distance(tl, tr);
		const widthBottom = distance(bl, br);
		const heightLeft = distance(tl, bl);
		const heightRight = distance(tr, br);

		const width = (widthTop + widthBottom) / 2;
		const height = (heightLeft + heightRight) / 2;

		let outW = width;
		let outH = height;

		const currentAspect = width / height;

		if (!Number.isFinite(currentAspect) || !Number.isFinite(width) || !Number.isFinite(height)) {
			return { width: 360, height: 504 };
		}

		if (currentAspect > targetAspect) {
			outH = outW / targetAspect;
		} else {
			outW = outH * targetAspect;
		}

		const safeWidth = Math.max(1, Math.round(outW));
		const safeHeight = Math.max(1, Math.round(outH));

		return {
			width: safeWidth,
			height: safeHeight
		};
	}

	function drawImageTriangle(
		ctx: CanvasRenderingContext2D,
		image: CanvasImageSource,
		s0: Point,
		s1: Point,
		s2: Point,
		d0: Point,
		d1: Point,
		d2: Point
	) {
		ctx.save();

		ctx.beginPath();
		ctx.moveTo(d0.x, d0.y);
		ctx.lineTo(d1.x, d1.y);
		ctx.lineTo(d2.x, d2.y);
		ctx.closePath();
		ctx.clip();

		const sx1 = s1.x - s0.x;
		const sy1 = s1.y - s0.y;
		const sx2 = s2.x - s0.x;
		const sy2 = s2.y - s0.y;

		const dx1 = d1.x - d0.x;
		const dy1 = d1.y - d0.y;
		const dx2 = d2.x - d0.x;
		const dy2 = d2.y - d0.y;

		const det = sx1 * sy2 - sy1 * sx2;
		if (Math.abs(det) < 1e-8) {
			ctx.restore();
			return;
		}

		const a = (dx1 * sy2 - dx2 * sy1) / det;
		const b = (dy1 * sy2 - dy2 * sy1) / det;
		const c = (dx2 * sx1 - dx1 * sx2) / det;
		const d = (dy2 * sx1 - dy1 * sx2) / det;
		const e = d0.x - a * s0.x - c * s0.y;
		const f = d0.y - b * s0.x - d * s0.y;

		ctx.setTransform(a, b, c, d, e, f);
		ctx.drawImage(image, 0, 0);

		ctx.restore();
	}

	async function compressImageForApiIfNeeded(file: File, maxBytes = 300_000): Promise<File> {
		if (file.size <= maxBytes) return file;

		const img = new Image();
		const objectUrl = URL.createObjectURL(file);

		try {
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error('Failed to load image for compression'));
				img.src = objectUrl;
			});

			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');

			if (!ctx) return file;

			const width = img.naturalWidth;
			const height = img.naturalHeight;

			canvas.width = width;
			canvas.height = height;

			ctx.drawImage(img, 0, 0, width, height);

			let quality = 0.9;
			let blob: Blob | null = null;

			for (let i = 0; i < 8; i++) {
				blob = await new Promise<Blob | null>((resolve) => {
					canvas.toBlob(resolve, 'image/jpeg', quality);
				});

				if (!blob) return file;
				if (blob.size <= maxBytes) break;

				quality -= 0.08;
			}

			if (!blob) return file;

			return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
				type: 'image/jpeg'
			});
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	}

	async function runSegmentationInBrowser() {
		console.log('API_BASE:', API_BASE);

		if (!imageFile || !imageEl) return;

		isSegmenting = true;
		segmentationError = '';
		segmentationResult = null;

		try {
			const apiFile = await compressImageForApiIfNeeded(imageFile);
			const formData = new FormData();
			formData.append('file', apiFile);

			const response = await fetch(`${API_BASE}/infer-json`, {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				const text = await response.text();
				throw new Error(text || 'Inference request failed');
			}

			const result = await response.json();

			setSegmentationMaskFromResult(result);

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
				autoZoomToCorners = true;
				frozenZoom = null;

				requestAnimationFrame(() => {
					const z = computeZoomMetrics();

					const naturalWidth = imageEl?.naturalWidth || 1;
					const naturalHeight = imageEl?.naturalHeight || 1;

					const centerX =
						(corners.topLeft.x +
							corners.topRight.x +
							corners.bottomRight.x +
							corners.bottomLeft.x) /
						4;

					const centerY =
						(corners.topLeft.y +
							corners.topRight.y +
							corners.bottomRight.y +
							corners.bottomLeft.y) /
						4;

					frozenZoom = {
						scale: z.scale,
						centerXNorm: centerX / naturalWidth,
						centerYNorm: centerY / naturalHeight
					};

					frozenStage = {
						width: displayedImageRect.width,
						height: displayedImageRect.height
					};
				});
			} else {
				autoZoomToCorners = false;
				frozenZoom = null;
				frozenStage = null;
			}

			// wait one frame so corners/rendered image rect are updated, then freeze

			segmentationResult = {
				ok: true,
				refine_score: result.refine_score ?? null
			};
		} catch (error) {
			segmentationError = error instanceof Error ? error.message : 'API inference error';
			console.error(error);
		} finally {
			isSegmenting = false;
			imageReadyForControls = true;
		}
	}

	function getZoomStyle() {
		const { scale, tx, ty } = getZoomMetrics();
		return `transform-origin: top left; transform: translate(${tx}px, ${ty}px) scale(${scale});`;
	}

	function getZoomMetrics() {
		if (frozenZoom) {
			const centerX = frozenZoom.centerXNorm * displayedImageRect.width;
			const centerY = frozenZoom.centerYNorm * displayedImageRect.height;

			const tx = displayedImageRect.width / 2 - centerX * frozenZoom.scale;
			const ty = displayedImageRect.height / 2 - centerY * frozenZoom.scale;

			return {
				scale: frozenZoom.scale,
				tx,
				ty
			};
		}

		if (!autoZoomToCorners || !displayedImageRect.width || !displayedImageRect.height) {
			return { scale: 1, tx: 0, ty: 0 };
		}

		return computeZoomMetrics();
	}

	function getCornersForBackend() {
		return [
			{ id: 'top-left', ...corners.topLeft },
			{ id: 'top-right', ...corners.topRight },
			{ id: 'bottom-right', ...corners.bottomRight },
			{ id: 'bottom-left', ...corners.bottomLeft }
		];
	}

	function toggleGuideActive(guideKey: GuideKey) {
		activeGuide = guideKey;
		activeCorner = null;
	}

	function moveGuide(guideKey: GuideKey, directionDelta: number) {
		const limit =
			guideKey === 'left' || guideKey === 'right'
				? Math.max(warpDisplayedImageRect.width, 1)
				: Math.max(warpDisplayedImageRect.height, 1);

		const next = guideInsetsPx[guideKey] + directionDelta * stepSize;

		guideInsetsPx[guideKey] = Math.max(0, Math.min(limit, next));
	}

	function moveActiveGuide(direction: 'up' | 'down' | 'left' | 'right') {
		if (!activeGuide) return;

		if (activeGuide === 'top') {
			if (direction === 'up') moveGuide('top', -1);
			if (direction === 'down') moveGuide('top', 1);
			return;
		}

		if (activeGuide === 'bottom') {
			if (direction === 'down') moveGuide('bottom', -1);
			if (direction === 'up') moveGuide('bottom', 1);
			return;
		}

		if (activeGuide === 'left') {
			if (direction === 'left') moveGuide('left', -1);
			if (direction === 'right') moveGuide('left', 1);
			return;
		}

		if (activeGuide === 'right') {
			if (direction === 'right') moveGuide('right', -1);
			if (direction === 'left') moveGuide('right', 1);
		}
	}

	function getGuideLineStyle(guideId: GuideKey) {
		const topPx = snapGuideDisplayPx(guideInsetsPx.top);
		const bottomPx = snapGuideDisplayPx(guideInsetsPx.bottom);
		const leftPx = snapGuideDisplayPx(guideInsetsPx.left);
		const rightPx = snapGuideDisplayPx(guideInsetsPx.right);

		if (guideId === 'top') {
			return `
				top: ${topPx}px;
				left: 0;
				width: 100%;
				height: 40px;
				transform: translateY(-50%);
			`;
		}

		if (guideId === 'bottom') {
			return `
				top: ${snapGuideDisplayPx(warpDisplayedImageRect.height - bottomPx)}px;
				left: 0;
				width: 100%;
				height: 40px;
				transform: translateY(-50%);
			`;
		}

		if (guideId === 'left') {
			return `
				left: ${leftPx}px;
				top: 0;
				width: 40px;
				height: 100%;
				transform: translateX(-50%);
			`;
		}

		return `
			left: ${snapGuideDisplayPx(warpDisplayedImageRect.width - rightPx)}px;
			top: 0;
			width: 40px;
			height: 100%;
			transform: translateX(-50%);
		`;
	}

	function updateWarpDisplayedImageRect() {
		if (!warpContainerEl) return;

		const width = warpContainerEl.clientWidth;
		const height = warpContainerEl.clientHeight;

		warpContainerSize = { width, height };
		warpBoxSize = { width, height };

		warpDisplayedImageRect = {
			x: 0,
			y: 0,
			width,
			height
		};
	}

	function formatPct(value: number) {
		return `${value.toFixed(1)}%`;
	}

	function formatRatio(a: number, b: number) {
		if (a <= 0 || b <= 0) return '--';
		const ratio = a > b ? a / b : b / a;
		return ratio.toFixed(2);
	}

	function computeZoomMetrics() {
		if (!autoZoomToCorners || !displayedImageRect.width || !displayedImageRect.height) {
			return { scale: 1, tx: 0, ty: 0 };
		}

		const naturalWidth = imageEl?.naturalWidth || 1;
		const naturalHeight = imageEl?.naturalHeight || 1;

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

		// use a capped reference viewport so big screens don't increase auto-zoom
		const refWidth = Math.min(displayedImageRect.width, 520);
		const refHeight = Math.min(displayedImageRect.height, 760);

		const currentWidthFrac = boxWidth / refWidth;
		const currentHeightFrac = boxHeight / refHeight;

		// if the card already fills most of the reference viewport, don't zoom
		if (currentWidthFrac > 0.72 || currentHeightFrac > 0.72) {
			return { scale: 1, tx: 0, ty: 0 };
		}

		const targetWidthFrac = 0.68;
		const targetHeightFrac = 0.7;

		const scaleX = (refWidth * targetWidthFrac) / boxWidth;
		const scaleY = (refHeight * targetHeightFrac) / boxHeight;

		let scale = Math.min(scaleX, scaleY);
		scale = Math.max(1, scale);

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

		const tx = displayedImageRect.width / 2 - centerX * scale;
		const ty = displayedImageRect.height / 2 - centerY * scale;

		return { scale: Math.max(1, scale), tx, ty };
	}

	const centeringStats = $derived(getCenteringStats());

	function getCenteringStats() {
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

	function solveLinearSystem8x8(A: number[][], b: number[]) {
		const n = 8;
		const M = A.map((row, i) => [...row, b[i]]);

		for (let col = 0; col < n; col++) {
			let pivotRow = col;
			let maxAbs = Math.abs(M[col][col]);

			for (let r = col + 1; r < n; r++) {
				const v = Math.abs(M[r][col]);
				if (v > maxAbs) {
					maxAbs = v;
					pivotRow = r;
				}
			}

			if (maxAbs < 1e-12) {
				throw new Error('Homography solve failed: singular matrix');
			}

			if (pivotRow !== col) {
				[M[col], M[pivotRow]] = [M[pivotRow], M[col]];
			}

			const pivot = M[col][col];
			for (let c = col; c <= n; c++) {
				M[col][c] /= pivot;
			}

			for (let r = 0; r < n; r++) {
				if (r === col) continue;
				const factor = M[r][col];
				for (let c = col; c <= n; c++) {
					M[r][c] -= factor * M[col][c];
				}
			}
		}

		return M.map((row) => row[n]);
	}

	function computeHomography(src: [Point, Point, Point, Point], dst: [Point, Point, Point, Point]) {
		const A: number[][] = [];
		const b: number[] = [];

		for (let i = 0; i < 4; i++) {
			const { x, y } = src[i];
			const { x: u, y: v } = dst[i];

			A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
			b.push(u);

			A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
			b.push(v);
		}

		const [h11, h12, h13, h21, h22, h23, h31, h32] = solveLinearSystem8x8(A, b);

		return [
			[h11, h12, h13],
			[h21, h22, h23],
			[h31, h32, 1]
		];
	}

	function invertHomography(H: number[][]) {
		const [[a, b, c], [d, e, f], [g, h, i]] = H;

		const A = e * i - f * h;
		const B = -(d * i - f * g);
		const C = d * h - e * g;
		const D = -(b * i - c * h);
		const E = a * i - c * g;
		const F = -(a * h - b * g);
		const G = b * f - c * e;
		const Hc = -(a * f - c * d);
		const I = a * e - b * d;

		const det = a * A + b * B + c * C;
		if (Math.abs(det) < 1e-12) {
			throw new Error('Homography invert failed: singular matrix');
		}

		return [
			[A / det, D / det, G / det],
			[B / det, E / det, Hc / det],
			[C / det, F / det, I / det]
		];
	}

	function applyHomography(H: number[][], x: number, y: number): Point {
		const denom = H[2][0] * x + H[2][1] * y + H[2][2];
		if (Math.abs(denom) < 1e-12) {
			return { x: 0, y: 0 };
		}

		return {
			x: (H[0][0] * x + H[0][1] * y + H[0][2]) / denom,
			y: (H[1][0] * x + H[1][1] * y + H[1][2]) / denom
		};
	}

	function sampleBilinear(src: Uint8ClampedArray, sw: number, sh: number, x: number, y: number) {
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const x1 = Math.min(x0 + 1, sw - 1);
		const y1 = Math.min(y0 + 1, sh - 1);

		const dx = x - x0;
		const dy = y - y0;

		const idx00 = (y0 * sw + x0) * 4;
		const idx10 = (y0 * sw + x1) * 4;
		const idx01 = (y1 * sw + x0) * 4;
		const idx11 = (y1 * sw + x1) * 4;

		const out = [0, 0, 0, 0];

		for (let k = 0; k < 4; k++) {
			const top = src[idx00 + k] * (1 - dx) + src[idx10 + k] * dx;
			const bottom = src[idx01 + k] * (1 - dx) + src[idx11 + k] * dx;
			out[k] = top * (1 - dy) + bottom * dy;
		}

		return out;
	}

	function warpImageToDataUrl(image: HTMLImageElement, corners: [Point, Point, Point, Point]) {
		const [tl, tr, br, bl] = corners;

		const { width: outWidth, height: outHeight } = computeWarpOutputSize(tl, tr, br, bl);

		const srcCanvas = document.createElement('canvas');
		srcCanvas.width = image.naturalWidth;
		srcCanvas.height = image.naturalHeight;

		const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
		if (!srcCtx) {
			throw new Error('Could not create source canvas');
		}
		srcCtx.drawImage(image, 0, 0);

		const srcImage = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
		const srcData = srcImage.data;
		const sw = srcCanvas.width;
		const sh = srcCanvas.height;

		const outCanvas = document.createElement('canvas');
		outCanvas.width = outWidth;
		outCanvas.height = outHeight;

		const outCtx = outCanvas.getContext('2d');
		if (!outCtx) {
			throw new Error('Could not create output canvas');
		}

		const outImage = outCtx.createImageData(outWidth, outHeight);
		const outData = outImage.data;

		const dstQuad: [Point, Point, Point, Point] = [
			{ x: 0, y: 0 },
			{ x: outWidth - 1, y: 0 },
			{ x: outWidth - 1, y: outHeight - 1 },
			{ x: 0, y: outHeight - 1 }
		];

		// map source quad -> destination rect, then invert for sampling
		const H = computeHomography(corners, dstQuad);
		const Hinv = invertHomography(H);

		for (let y = 0; y < outHeight; y++) {
			for (let x = 0; x < outWidth; x++) {
				const srcPt = applyHomography(Hinv, x + 0.5, y + 0.5);

				const outIdx = (y * outWidth + x) * 4;

				const clampedX = Math.max(0, Math.min(sw - 1.001, srcPt.x));
				const clampedY = Math.max(0, Math.min(sh - 1.001, srcPt.y));

				const [r, g, b, a] = sampleBilinear(srcData, sw, sh, clampedX, clampedY);
				outData[outIdx + 0] = Math.round(r);
				outData[outIdx + 1] = Math.round(g);
				outData[outIdx + 2] = Math.round(b);
				outData[outIdx + 3] = Math.round(a);
			}
		}

		outCtx.putImageData(outImage, 0, 0);
		return outCanvas.toDataURL('image/jpeg', 0.95);
	}
</script>

<div
	class="origin-top-left"
	style={`
		transform: scale(${pageZoom});
		width: ${100 / pageZoom}%;
	`}
>
	<div
		class="min-h-screen bg-zinc-950
		text-zinc-100 select-none"
		onwheel={handleWheel}
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
			<div class="grid items-start justify-center gap-6 xl:grid-cols-[420px_auto_auto]">
				<section
					class="flex w-[420px] flex-col overflow-hidden border border-zinc-800 bg-zinc-900 shadow-sm"
				>
					<div class="border-b border-zinc-800 px-5 py-4">
						<h2 class="text-sm font-semibold tracking-wide text-zinc-300 uppercase">Adjustments</h2>
						<p class="text-xs text-zinc-500">
							Use the directional pads to nudge each corner precisely
						</p>
					</div>

					<div class="p-5">
						<div class="mb-5 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
							<div class="space-y-3">
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
										class={`w-full rounded-lg border bg-zinc-950 px-3 py-2 text-sm transition outline-none ${
											stepSizeFlash
												? 'border-blue-400 ring-2 ring-blue-400/70'
												: 'border-zinc-700 focus:border-blue-500'
										}`}
									>
										<option value={0.25}>.25 px</option>
										<option value={0.5}>.5 px</option>
										<option value={1}>1 px</option>
										<option value={2}>2 px</option>
										<option value={5}>5 px</option>
									</select>
								</div>

								<div class="flex gap-3">
									<div
										class={`min-w-0 overflow-hidden transition-all duration-500 ease-out ${
											showUploadButton ? 'basis-1/2 max-w-full' : 'basis-full max-w-full'
										}`}
									>
										<button
											class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm hover:bg-zinc-800"
											type="button"
											onclick={resetHandler}
										>
											Reset
										</button>
									</div>

									<div
										class={`min-w-0 overflow-hidden transition-all duration-500 ease-out ${
											showUploadButton
												? 'basis-1/2 max-w-full opacity-100'
												: 'basis-0 max-w-0 opacity-0'
										}`}
									>
										<button
											class={`w-full rounded-lg border px-3 py-2 text-sm transition ${
												isSegmenting
													? 'border-blue-400 bg-zinc-800 text-blue-300 animate-pulse shadow-[0_0_12px_rgba(59,130,246,0.7)]'
													: !imageUrl
														? 'border-cyan-400 bg-zinc-900 text-cyan-300 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.5)] hover:bg-zinc-800'
														: 'border-zinc-700 bg-zinc-950 hover:bg-zinc-800'
											}`}
											type="button"
											onclick={() => {
												if (!isSegmenting) {
													document.getElementById('image-upload')?.click();
												}
											}}
											disabled={isSegmenting || !showUploadButton}
										>
											{isSegmenting ? 'Running...' : 'Upload'}
										</button>
									</div>
								</div>

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

						<div class="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
							<div class="grid grid-cols-2 gap-4">
								{#each cornerPads as corner}
									<div class="flex items-center justify-center p-3">
										<div class="w-full max-w-[140px]">
											<div class="mb-2 text-center">
												<div class="text-xs font-medium tracking-[0.2em] text-zinc-400 uppercase">
													{corner.label}
												</div>
											</div>

											<div class="grid grid-cols-3 gap-2">
												<div></div>
												<button
													class={`rounded-xl border px-2 py-2 text-sm transition ${
														activeDirection === 'up' &&
														activeCorner === (corner.id as keyof typeof corners)
															? 'border-blue-400 bg-zinc-800 ring-2 ring-blue-400'
															: 'border-zinc-700 bg-zinc-950 hover:bg-zinc-800'
													}`}
													onclick={() =>
														moveCorner(corner.id as keyof typeof corners, 0, -stepSize)}
												>
													↑
												</button>
												<div></div>

												<button
													class={`rounded-xl border px-2 py-2 text-sm transition ${
														activeDirection === 'left' &&
														activeCorner === (corner.id as keyof typeof corners)
															? 'border-blue-400 bg-zinc-800 ring-2 ring-blue-400'
															: 'border-zinc-700 bg-zinc-950 hover:bg-zinc-800'
													}`}
													onclick={() =>
														moveCorner(corner.id as keyof typeof corners, -stepSize, 0)}
												>
													←
												</button>
												<button
													aria-label={`Toggle ${corner.label} arrow control`}
													class={`flex items-center justify-center rounded-xl border transition ${
														activeCorner === (corner.id as keyof typeof corners)
															? 'border-blue-400 bg-blue-500/20'
															: 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800'
													}`}
													onclick={() => toggleCornerActive(corner.id as keyof typeof corners)}
												>
													<div
														class={`h-2 w-2 rounded-full ${
															activeCorner === (corner.id as keyof typeof corners)
																? 'bg-blue-400'
																: 'bg-zinc-500'
														}`}
													></div>
												</button>
												<button
													class={`rounded-xl border px-2 py-2 text-sm transition ${
														activeDirection === 'right' &&
														activeCorner === (corner.id as keyof typeof corners)
															? 'border-blue-400 bg-zinc-800 ring-2 ring-blue-400'
															: 'border-zinc-700 bg-zinc-950 hover:bg-zinc-800'
													}`}
													onclick={() => moveCorner(corner.id as keyof typeof corners, stepSize, 0)}
												>
													→
												</button>

												<div></div>
												<button
													class={`rounded-xl border px-2 py-2 text-sm transition ${
														activeDirection === 'down' &&
														activeCorner === (corner.id as keyof typeof corners)
															? 'border-blue-400 bg-zinc-800 ring-2 ring-blue-400'
															: 'border-zinc-700 bg-zinc-950 hover:bg-zinc-800'
													}`}
													onclick={() => moveCorner(corner.id as keyof typeof corners, 0, stepSize)}
												>
													↓
												</button>
												<div></div>
											</div>
										</div>
									</div>
								{/each}
							</div>
						</div>
					</div>
				</section>

				<section
					class="justify-self-center self-start flex flex-col border border-zinc-800 bg-zinc-900 shadow-sm"
				>
					<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
						<div>
							<h2 class="text-sm font-semibold tracking-wide text-zinc-300 uppercase">Source</h2>
							<p class="text-xs text-zinc-500">Original image with corner overlay</p>
						</div>
					</div>
					<div
						class="relative aspect-[5/7] w-[500px] max-w-[min(40vw,500px)] border border-dashed border-zinc-700 bg-zinc-950"
					>
						<div
							role="button"
							tabindex="0"
							class={`group flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-zinc-700 bg-zinc-950 transition ${
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

							<div class="flex w-full items-center justify-center">
								<div class="absolute inset-0 overflow-hidden rounded-xl" bind:this={containerEl}>
									{#if imageUrl}
										<div
											class="absolute inset-0"
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
											<!-- fixed review viewport -->
											<div class="absolute inset-0 overflow-hidden rounded-xl">
												<!-- static background fill so no black bars ever appear -->
												{#if !autoZoomToCorners && !frozenZoom}
													<img
														src={imageUrl}
														alt=""
														aria-hidden="true"
														class="absolute inset-0 h-full w-full object-cover opacity-100"
														draggable="false"
													/>
												{:else}
													<div class="absolute inset-0 bg-zinc-950"></div>
												{/if}

												<!-- fixed image plane -->
												<div
													class="absolute overflow-hidden"
													style={`
															left: ${displayedImageRect.x}px;
															top: ${displayedImageRect.y}px;
															width: ${displayedImageRect.width}px;
															height: ${displayedImageRect.height}px;
															${getZoomStyle()}
														`}
												>
													<div class="absolute inset-0">
														<img
															bind:this={imageEl}
															src={imageUrl}
															alt="Uploaded source"
															class="block h-full w-full object-contain"
															draggable="false"
															ondragstart={(e) => e.preventDefault()}
															onload={async () => {
																updateSize();

																if (pendingDetection) {
																	pendingDetection = false;
																	await runSegmentationInBrowser();
																}
																setTimeout(() => {
																	imageReadyForControls = true;
																}, 10);
															}}
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
															class={`absolute z-10 h-7 w-7 transition ${
																activeCorner === corner.key
																	? '[filter:drop-shadow(0_0_6px_rgba(34,211,238,0.9)) drop-shadow(0_0_12px_rgba(34,211,238,0.7))] animate-pulse text-red-400'
																	: 'text-cyan-400 hover:text-green-300'
															}`}
															style:left={`${(corners[corner.key].x / Math.max(imageEl?.naturalWidth || 1, 1)) * 100}%`}
															style:top={`${(corners[corner.key].y / Math.max(imageEl?.naturalHeight || 1, 1)) * 100}%`}
															style:transform={corner.key === 'topLeft'
																? 'translate(-85%, -85%)'
																: corner.key === 'topRight'
																	? 'translate(-15%, -85%)'
																	: corner.key === 'bottomLeft'
																		? 'translate(-85%, -15%)'
																		: 'translate(-15%, -15%)'}
															onclick={(e) => {
																e.stopPropagation();
																toggleCornerActive(corner.key);
															}}
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
														</button>
													{/each}
												</div>
											</div>
										</div>
									{/if}
								</div>
							</div>
						</div>
					</div>
				</section>

				<section
					class="justify-self-center self-start flex flex-col border border-zinc-800 bg-zinc-900 shadow-sm"
				>
					<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-2">
						<div>
							<h2 class="text-sm font-semibold tracking-wide text-zinc-300 uppercase">
								Warp Preview
							</h2>
							<p class="text-xs text-zinc-500">Live output from current corner positions</p>
						</div>
					</div>

					<div class="flex flex-col gap-4 p-5">
						<!-- Centering Metrics -->
						<div class="grid shrink-0 grid-cols-2 gap-4 text-sm">
							<!-- Vertical Centering -->
							<div>
								<div class="mb-2 text-xs tracking-wide text-zinc-500 uppercase">
									Vertical Centering
								</div>

								<div class="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
									<div class="flex items-center justify-between text-sm text-zinc-400">
										<span>Top</span>
										<span>Bottom</span>
									</div>

									<div class="mt-2 flex items-center justify-between text-2xl font-semibold">
										<span
											class={centeringStats.topPct > ALERT_THRESHOLD
												? 'text-red-400'
												: 'text-zinc-100'}
										>
											{formatPct(centeringStats.topPct)}
										</span>

										<span
											class={centeringStats.bottomPct > ALERT_THRESHOLD
												? 'text-red-400'
												: 'text-zinc-100'}
										>
											{formatPct(centeringStats.bottomPct)}
										</span>
									</div>
								</div>
							</div>

							<!-- Horizontal Centering -->
							<div>
								<div class="mb-2 text-xs tracking-wide text-zinc-500 uppercase">
									Horizontal Centering
								</div>

								<div class="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
									<div class="flex items-center justify-between text-sm text-zinc-400">
										<span>Left</span>
										<span>Right</span>
									</div>

									<div class="mt-2 flex items-center justify-between text-2xl font-semibold">
										<span
											class={centeringStats.leftPct > ALERT_THRESHOLD
												? 'text-red-400'
												: 'text-zinc-100'}
										>
											{formatPct(centeringStats.leftPct)}
										</span>

										<span
											class={centeringStats.rightPct > ALERT_THRESHOLD
												? 'text-red-400'
												: 'text-zinc-100'}
										>
											{formatPct(centeringStats.rightPct)}
										</span>
									</div>
								</div>
							</div>
						</div>

						<!-- Warp Image -->
						<div class="grid place-items-center overflow-hidden">
							<div
								class="relative aspect-[5/7] w-[500px] max-w-[min(40vw,500px)] border border-dashed border-zinc-700 bg-zinc-950"
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
									<div
										class="absolute inset-0 overflow-hidden"
										style={`
										left: ${warpDisplayedImageRect.x}px;
										top: ${warpDisplayedImageRect.y}px;
										width: ${warpDisplayedImageRect.width}px;
										height: ${warpDisplayedImageRect.height}px;
									`}
									>
										<img
											bind:this={warpImageEl}
											src={warpedImageUrl}
											alt="Warped preview"
											class="absolute inset-0 h-full w-full object-cover"
											onload={updateWarpDisplayedImageRect}
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
												stroke-width="3"
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
												stroke-width="3"
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
												stroke-width="3"
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
												stroke-width="3"
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
												onclick={(e) => {
													e.stopPropagation();
													toggleGuideActive('top');
												}}
											></button>

											<!-- bottom -->
											<button
												type="button"
												aria-label="Adjust bottom guide"
												class="absolute left-0 right-0 h-10 -translate-y-1/2 cursor-pointer"
												style={`top: ${warpDisplayedImageRect.height - guideInsetsPx.bottom}px;`}
												onclick={(e) => {
													e.stopPropagation();
													toggleGuideActive('bottom');
												}}
											></button>

											<!-- left -->
											<button
												type="button"
												aria-label="Adjust left guide"
												class="absolute top-0 bottom-0 w-10 -translate-x-1/2 cursor-pointer"
												style={`left: ${guideInsetsPx.left}px;`}
												onclick={(e) => {
													e.stopPropagation();
													toggleGuideActive('left');
												}}
											></button>

											<!-- right -->
											<button
												type="button"
												aria-label="Adjust right guide"
												class="absolute top-0 bottom-0 w-10 -translate-x-1/2 cursor-pointer"
												style={`left: ${warpDisplayedImageRect.width - guideInsetsPx.right}px;`}
												onclick={(e) => {
													e.stopPropagation();
													toggleGuideActive('right');
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
				</section>
			</div>
		</main>
	</div>
</div>
