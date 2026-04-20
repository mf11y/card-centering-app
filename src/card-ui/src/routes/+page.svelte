<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	const API_BASE = 'https://card-centering-api.onrender.com/api';

	const cornerPads = [
		{ id: 'topLeft', label: 'Top Left' },
		{ id: 'topRight', label: 'Top Right' },
		{ id: 'bottomLeft', label: 'Bottom Left' },
		{ id: 'bottomRight', label: 'Bottom Right' }
	];

	let imageFile = $state<File | null>(null);
	let imageUrl = $state('');

	let corners = $state({
		topLeft: { x: 20, y: 20 },
		topRight: { x: 80, y: 20 },
		bottomLeft: { x: 20, y: 80 },
		bottomRight: { x: 80, y: 80 }
	});

	let stepSize = $state(1);

	let containerEl = $state.raw<HTMLDivElement | null>(null);
	let containerSize = $state({ width: 1, height: 1 });

	let activeCorner = $state<keyof typeof corners | null>(null);

	let activeDirection = $state<'up' | 'down' | 'left' | 'right' | null>(null);

	let isSegmenting = $state(false);
	let segmentationResult = $state<any>(null);
	let segmentationError = $state('');

	const STEP_VALUES = [1, 2, 5];

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

	let guideInsets = $state({
		top: 6,
		bottom: 6,
		left: 6,
		right: 6
	});

	let warpContainerEl = $state.raw<HTMLDivElement | null>(null);
	let warpImageEl = $state.raw<HTMLImageElement | null>(null);

	let warpContainerSize = $state({ width: 1, height: 1 });
	let warpDisplayedImageRect = $state({ x: 0, y: 0, width: 1, height: 1 });

	let frozenZoom = $state<{ scale: number; tx: number; ty: number } | null>(null);

	let warpBoxSize = $state({ width: 0, height: 0 });

	const GUIDE_STEP = 1;

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

	function loadFile(file: File) {
		if (!file.type.startsWith('image/')) return;

		imageFile = file;

		if (imageUrl) URL.revokeObjectURL(imageUrl);
		imageUrl = URL.createObjectURL(file);

		setTimeout(() => {
			runSegmentation();
		}, 50);
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
		const { scale } = getZoomMetrics();

		const adjustedDx = dx / scale;
		const adjustedDy = dy / scale;

		const pxX = (corners[cornerKey].x / 100) * containerSize.width - displayedImageRect.x;
		const pxY = (corners[cornerKey].y / 100) * containerSize.height - displayedImageRect.y;

		const newPxX = pxX + adjustedDx;
		const newPxY = pxY + adjustedDy;

		const clampedX = Math.max(0, Math.min(displayedImageRect.width, newPxX));
		const clampedY = Math.max(0, Math.min(displayedImageRect.height, newPxY));

		const xInContainer = displayedImageRect.x + clampedX;
		const yInContainer = displayedImageRect.y + clampedY;

		const nextX = (xInContainer / containerSize.width) * 100;
		const nextY = (yInContainer / containerSize.height) * 100;

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
		const containerAspect = containerWidth / containerHeight;

		let width: number;
		let height: number;
		let x: number;
		let y: number;

		// COVER rect
		if (imageAspect > containerAspect) {
			height = containerHeight;
			width = height * imageAspect;
			x = (containerWidth - width) / 2;
			y = 0;
		} else {
			width = containerWidth;
			height = width / imageAspect;
			x = 0;
			y = (containerHeight - height) / 2;
		}

		displayedImageRect = { x, y, width, height };
	}

	function updateSize() {
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		containerSize = {
			width: rect.width,
			height: rect.height
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
		if (!segmentationResult?.ok) return;

		// touch corners so this effect depends on them
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
			if (!frozenZoom) {
				frozenZoom = computeZoomMetrics();
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
		if (!imageEl) return;

		const naturalWidth = imageEl.naturalWidth;
		const naturalHeight = imageEl.naturalHeight;

		if (!naturalWidth || !naturalHeight) return;

		const mapped: typeof corners = {
			topLeft: { x: corners.topLeft.x, y: corners.topLeft.y },
			topRight: { x: corners.topRight.x, y: corners.topRight.y },
			bottomRight: { x: corners.bottomRight.x, y: corners.bottomRight.y },
			bottomLeft: { x: corners.bottomLeft.x, y: corners.bottomLeft.y }
		};

		for (const corner of returnedCorners) {
			const xInContainer =
				displayedImageRect.x + (corner.x / naturalWidth) * displayedImageRect.width;
			const yInContainer =
				displayedImageRect.y + (corner.y / naturalHeight) * displayedImageRect.height;

			const xPct = (xInContainer / containerSize.width) * 100;
			const yPct = (yInContainer / containerSize.height) * 100;

			if (corner.id === 'top-left') {
				mapped.topLeft = { x: xPct, y: yPct };
			} else if (corner.id === 'top-right') {
				mapped.topRight = { x: xPct, y: yPct };
			} else if (corner.id === 'bottom-right') {
				mapped.bottomRight = { x: xPct, y: yPct };
			} else if (corner.id === 'bottom-left') {
				mapped.bottomLeft = { x: xPct, y: yPct };
			}
		}
		console.log('Mapped corners for overlay:', mapped);
		corners = mapped;
	}

	async function runSegmentation() {
		if (!imageFile) return;

		isSegmenting = true;
		segmentationError = '';
		segmentationResult = null;

		frozenZoom = null;

		try {
			const formData = new FormData();
			formData.append('file', imageFile);

			const response = await fetch(`${API_BASE}/warp-from-corners`, {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				throw new Error(`Segmentation failed: ${response.status}`);
			}

			const data = await response.json();
			segmentationResult = data;

			console.log('Segmentation result:', data);
			console.log('Container size:', containerSize);

			if (data.ok && data.corners) {
				updateSize();
				updateDisplayedImageRect();
				applyReturnedCorners(data.corners);
				autoZoomToCorners = true;

				setTimeout(() => {
					frozenZoom = computeZoomMetrics();
				}, 0);
			}

			console.log('Segmentation result:', data);
		} catch (error) {
			segmentationError = error instanceof Error ? error.message : 'Unknown error';
			console.error(error);
		} finally {
			isSegmenting = false;
		}
	}

	function getZoomStyle() {
		const { scale, tx, ty } = getZoomMetrics();
		return `transform-origin: top left; transform: translate(${tx}px, ${ty}px) scale(${scale});`;
	}

	function getZoomMetrics() {
		if (frozenZoom) return frozenZoom;
		return computeZoomMetrics();
	}

	function getCornersForBackend() {
		if (!imageEl) return null;

		const naturalWidth = imageEl.naturalWidth;
		const naturalHeight = imageEl.naturalHeight;

		if (!naturalWidth || !naturalHeight) return null;

		const toImageCoords = (xPct: number, yPct: number) => {
			const xInContainer = (xPct / 100) * containerSize.width;
			const yInContainer = (yPct / 100) * containerSize.height;

			const xInImage = xInContainer - displayedImageRect.x;
			const yInImage = yInContainer - displayedImageRect.y;

			const x = (xInImage / displayedImageRect.width) * naturalWidth;
			const y = (yInImage / displayedImageRect.height) * naturalHeight;

			return {
				x: Math.max(0, Math.min(naturalWidth, x)),
				y: Math.max(0, Math.min(naturalHeight, y))
			};
		};

		return [
			{
				id: 'top-left',
				...toImageCoords(corners.topLeft.x, corners.topLeft.y)
			},
			{
				id: 'top-right',
				...toImageCoords(corners.topRight.x, corners.topRight.y)
			},
			{
				id: 'bottom-right',
				...toImageCoords(corners.bottomRight.x, corners.bottomRight.y)
			},
			{
				id: 'bottom-left',
				...toImageCoords(corners.bottomLeft.x, corners.bottomLeft.y)
			}
		];
	}

	async function runWarpPreview() {
		if (!imageFile) return;

		const backendCorners = getCornersForBackend();
		if (!backendCorners) return;

		try {
			const formData = new FormData();
			formData.append('file', imageFile);
			formData.append('corners_json', JSON.stringify(backendCorners));

			const response = await fetch(`${API_BASE}/infer-json`, {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				throw new Error(`Warp failed: ${response.status}`);
			}

			const blob = await response.blob();

			if (warpedImageUrl) {
				URL.revokeObjectURL(warpedImageUrl);
			}

			warpedImageUrl = URL.createObjectURL(blob);
		} catch (error) {
			console.error(error);
		}
	}
	function toggleGuideActive(guideKey: GuideKey) {
		activeGuide = guideKey;
		activeCorner = null;
	}

	function getGuideStepPct(guideKey: GuideKey) {
		const effectivePxStep = stepSize;

		if (guideKey === 'left' || guideKey === 'right') {
			return (effectivePxStep / Math.max(warpDisplayedImageRect.width, 1)) * 100;
		}

		return (effectivePxStep / Math.max(warpDisplayedImageRect.height, 1)) * 100;
	}

	function moveGuide(guideKey: GuideKey, directionDelta: number) {
		const stepPct = getGuideStepPct(guideKey);
		const next = guideInsets[guideKey] + directionDelta * stepPct;

		guideInsets[guideKey] = Math.max(0, Math.min(100, next));
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
		if (guideId === 'top') {
			return `
			top: ${guideInsets.top}%;
			left: 0%;
			width: 100%;
			height: 40px;
			transform: translateY(-50%);
		`;
		}

		if (guideId === 'bottom') {
			return `
			top: ${100 - guideInsets.bottom}%;
			left: 0%;
			width: 100%;
			height: 40px;
			transform: translateY(-50%);
		`;
		}

		if (guideId === 'left') {
			return `
			left: ${guideInsets.left}%;
			top: 0%;
			width: 40px;
			height: 100%;
			transform: translateX(-50%);
		`;
		}

		return `
		left: ${100 - guideInsets.right}%;
		top: 0%;
		width: 40px;
		height: 100%;
		transform: translateX(-50%);
	`;
	}

	function updateWarpDisplayedImageRect() {
		if (!warpContainerEl) return;

		const rect = warpContainerEl.getBoundingClientRect();
		const availW = rect.width;
		const availH = rect.height;

		warpContainerSize = {
			width: availW,
			height: availH
		};

		const targetAspect = 63 / 88;

		let width = availW;
		let height = width / targetAspect;

		if (height > availH) {
			height = availH;
			width = height * targetAspect;
		}

		warpBoxSize = { width, height };

		warpDisplayedImageRect = {
			x: (availW - width) / 2,
			y: (availH - height) / 2,
			width,
			height
		};
	}

	function computeZoomMetrics() {
		if (!autoZoomToCorners || !displayedImageRect.width || !displayedImageRect.height) {
			return { scale: 1, tx: 0, ty: 0 };
		}

		const xs = [
			(corners.topLeft.x / 100) * containerSize.width - displayedImageRect.x,
			(corners.topRight.x / 100) * containerSize.width - displayedImageRect.x,
			(corners.bottomRight.x / 100) * containerSize.width - displayedImageRect.x,
			(corners.bottomLeft.x / 100) * containerSize.width - displayedImageRect.x
		];

		const ys = [
			(corners.topLeft.y / 100) * containerSize.height - displayedImageRect.y,
			(corners.topRight.y / 100) * containerSize.height - displayedImageRect.y,
			(corners.bottomRight.y / 100) * containerSize.height - displayedImageRect.y,
			(corners.bottomLeft.y / 100) * containerSize.height - displayedImageRect.y
		];

		// more breathing room
		const padX = 40;
		const padY = 50;

		const minX = Math.max(0, Math.min(...xs) - padX);
		const maxX = Math.min(displayedImageRect.width, Math.max(...xs) + padX);
		const minY = Math.max(0, Math.min(...ys) - padY);
		const maxY = Math.min(displayedImageRect.height, Math.max(...ys) + padY);

		const boxWidth = Math.max(1, maxX - minX);
		const boxHeight = Math.max(1, maxY - minY);

		const scale = Math.min(
			displayedImageRect.width / boxWidth,
			displayedImageRect.height / boxHeight,
			1.5
		);

		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		const tx = displayedImageRect.width / 2 - centerX * scale;
		const ty = displayedImageRect.height / 2 - centerY * scale;

		return { scale, tx, ty };
	}

	function formatPct(value: number) {
		return `${value.toFixed(1)}%`;
	}

	function formatRatio(a: number, b: number) {
		if (a <= 0 || b <= 0) return '--';
		const ratio = a > b ? a / b : b / a;
		return ratio.toFixed(2);
	}

	const centeringStats = $derived(getCenteringStats());

	function getCenteringStats() {
		const top = guideInsets.top;
		const bottom = guideInsets.bottom;
		const left = guideInsets.left;
		const right = guideInsets.right;

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
</script>

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

	<main class="mx-auto flex h-[calc(100vh-160px)] max-w-[1600px] flex-col gap-6 px-6 py-6">
		<div class="grid h-full gap-6 xl:grid-cols-[420px_minmax(0,1fr)_minmax(0,1fr)]">
			<section
				class="flex h-full min-h-0 flex-col overflow-hidden border border-zinc-800 bg-zinc-900 shadow-sm"
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
									<option value={1}>1 px</option>
									<option value={2}>2 px</option>
									<option value={5}>5 px</option>
								</select>
							</div>

							<div class="grid grid-cols-2 gap-3">
								<button
									class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm hover:bg-zinc-800"
								>
									Reset
								</button>

								<button
									class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm hover:bg-zinc-800"
									onclick={runSegmentation}
									disabled={!imageFile || isSegmenting}
								>
									{isSegmenting ? 'Running...' : 'Re-detect'}
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
												onclick={() => moveCorner(corner.id as keyof typeof corners, 0, -stepSize)}
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
												onclick={() => moveCorner(corner.id as keyof typeof corners, -stepSize, 0)}
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
			<section class="flex h-full flex-col border border-zinc-800 bg-zinc-900 shadow-sm">
				<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
					<div>
						<h2 class="text-sm font-semibold tracking-wide text-zinc-300 uppercase">Source</h2>
						<p class="text-xs text-zinc-500">Original image with corner overlay</p>
					</div>
				</div>

				<div class="flex h-full items-center justify-center p-5">
					<label
						for="image-upload"
						class={`group flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-zinc-700 bg-zinc-950 transition ${
							imageUrl
								? 'cursor-default opacity-80'
								: 'cursor-pointer hover:border-zinc-500 hover:bg-zinc-900'
						}`}
						ondrop={!imageUrl ? handleDrop : undefined}
						ondragover={!imageUrl ? handleDragOver : undefined}
					>
						<input
							id="image-upload"
							type="file"
							accept="image/*"
							class="hidden"
							onchange={handleFileChange}
							disabled={!!imageUrl}
						/>

						<div class="flex h-full w-full items-center justify-center">
							<div class="relative h-full w-full overflow-hidden" bind:this={containerEl}>
								{#if imageUrl}
									<div class="absolute inset-0" onclick={clearActiveSelection}>
										<!-- fixed review viewport -->
										<div class="absolute inset-0 overflow-hidden rounded-xl">
											<!-- static background fill so no black bars ever appear -->
											<img
												src={imageUrl}
												alt=""
												aria-hidden="true"
												class="absolute inset-0 h-full w-full object-cover opacity-100"
												draggable="false"
											/>

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
												<img
													bind:this={imageEl}
													src={imageUrl}
													alt="Uploaded source"
													class="block h-full w-full object-fill"
													draggable="false"
													ondragstart={(e) => e.preventDefault()}
													onload={updateSize}
												/>
												<svg class="pointer-events-none absolute inset-0 h-full w-full">
													<line
														x1={`${(((corners.topLeft.x / 100) * containerSize.width - displayedImageRect.x) / Math.max(displayedImageRect.width, 1)) * 100}%`}
														y1={`${(((corners.topLeft.y / 100) * containerSize.height - displayedImageRect.y) / Math.max(displayedImageRect.height, 1)) * 100}%`}
														x2={`${(((corners.topRight.x / 100) * containerSize.width - displayedImageRect.x) / Math.max(displayedImageRect.width, 1)) * 100}%`}
														y2={`${(((corners.topRight.y / 100) * containerSize.height - displayedImageRect.y) / Math.max(displayedImageRect.height, 1)) * 100}%`}
														stroke="cyan"
														stroke-width="1.5"
														stroke-dasharray="6 6"
														opacity="0.9"
													/>
													<line
														x1={`${(((corners.topRight.x / 100) * containerSize.width - displayedImageRect.x) / Math.max(displayedImageRect.width, 1)) * 100}%`}
														y1={`${(((corners.topRight.y / 100) * containerSize.height - displayedImageRect.y) / Math.max(displayedImageRect.height, 1)) * 100}%`}
														x2={`${(((corners.bottomRight.x / 100) * containerSize.width - displayedImageRect.x) / Math.max(displayedImageRect.width, 1)) * 100}%`}
														y2={`${(((corners.bottomRight.y / 100) * containerSize.height - displayedImageRect.y) / Math.max(displayedImageRect.height, 1)) * 100}%`}
														stroke="cyan"
														stroke-width="1.5"
														stroke-dasharray="6 6"
														opacity="0.9"
													/>
													<line
														x1={`${(((corners.bottomRight.x / 100) * containerSize.width - displayedImageRect.x) / Math.max(displayedImageRect.width, 1)) * 100}%`}
														y1={`${(((corners.bottomRight.y / 100) * containerSize.height - displayedImageRect.y) / Math.max(displayedImageRect.height, 1)) * 100}%`}
														x2={`${(((corners.bottomLeft.x / 100) * containerSize.width - displayedImageRect.x) / Math.max(displayedImageRect.width, 1)) * 100}%`}
														y2={`${(((corners.bottomLeft.y / 100) * containerSize.height - displayedImageRect.y) / Math.max(displayedImageRect.height, 1)) * 100}%`}
														stroke="cyan"
														stroke-width="1.5"
														stroke-dasharray="6 6"
														opacity="0.9"
													/>
													<line
														x1={`${(((corners.bottomLeft.x / 100) * containerSize.width - displayedImageRect.x) / Math.max(displayedImageRect.width, 1)) * 100}%`}
														y1={`${(((corners.bottomLeft.y / 100) * containerSize.height - displayedImageRect.y) / Math.max(displayedImageRect.height, 1)) * 100}%`}
														x2={`${(((corners.topLeft.x / 100) * containerSize.width - displayedImageRect.x) / Math.max(displayedImageRect.width, 1)) * 100}%`}
														y2={`${(((corners.topLeft.y / 100) * containerSize.height - displayedImageRect.y) / Math.max(displayedImageRect.height, 1)) * 100}%`}
														stroke="cyan"
														stroke-width="1.5"
														stroke-dasharray="6 6"
														opacity="0.9"
													/>
												</svg>

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
														style:left={`${(((corners[corner.key].x / 100) * containerSize.width - displayedImageRect.x) / Math.max(displayedImageRect.width, 1)) * 100}%`}
														style:top={`${(((corners[corner.key].y / 100) * containerSize.height - displayedImageRect.y) / Math.max(displayedImageRect.height, 1)) * 100}%`}
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
					</label>
				</div>
			</section>

			<section
				class="flex h-full min-h-0 flex-col overflow-hidden border border-zinc-800 bg-zinc-900 shadow-sm"
			>
				<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
					<div>
						<h2 class="text-sm font-semibold tracking-wide text-zinc-300 uppercase">
							Warp Preview
						</h2>
						<p class="text-xs text-zinc-500">Live output from current corner positions</p>
					</div>
				</div>

				<div class="flex min-h-0 flex-1 flex-col gap-4 p-5">
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
					<div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
						{#if warpedImageUrl}
							<div
								class="relative h-full w-full"
								bind:this={warpContainerEl}
								onclick={clearActiveSelection}
							>
								<div
									class="absolute overflow-hidden border border-dashed border-zinc-700 bg-zinc-950"
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

									<div class="pointer-events-none absolute inset-0">
										{#each centeringGuides as guide}
											<button
												type="button"
												class="pointer-events-auto absolute cursor-pointer"
												style={getGuideLineStyle(guide.id)}
												onclick={(e) => {
													e.stopPropagation();
													toggleGuideActive(guide.id);
												}}
											>
												<div
													class={`absolute ${
														guide.id === 'top' || guide.id === 'bottom'
															? 'top-1/2 right-0 left-0 -translate-y-1/2 border-t-2'
															: 'top-0 bottom-0 left-1/2 -translate-x-1/2 border-l-2'
													} border-dashed ${
														activeGuide === guide.id ? 'border-red-400' : 'border-cyan-400/90'
													}`}
												></div>

												{#if activeGuide === guide.id}
													<div
														class={`pointer-events-none absolute flex items-center justify-center ${
															guide.id === 'top'
																? 'top-1/2 left-1/2 -translate-x-1/2 translate-y-[40%]'
																: guide.id === 'bottom'
																	? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-[140%]'
																	: guide.id === 'left'
																		? 'top-1/2 left-1/2 translate-x-[40%] -translate-y-1/2'
																		: 'top-1/2 left-1/2 -translate-x-[140%] -translate-y-1/2'
														}`}
													>
														<svg
															viewBox="0 0 80 80"
															class={`h-16 w-16 text-red-400 [filter:drop-shadow(0_0_6px_rgba(248,113,113,0.95))_drop-shadow(0_0_14px_rgba(248,113,113,0.75))] ${
																guide.id === 'top'
																	? ''
																	: guide.id === 'bottom'
																		? 'rotate-180'
																		: guide.id === 'right'
																			? 'rotate-90'
																			: '-rotate-90'
															}`}
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
											</button>
										{/each}
									</div>
								</div>
							</div>
						{/if}
					</div>
				</div>
			</section>
		</div>
	</main>
</div>
