/**
 * Shared configuration values for card-centering controls and presentation.
 *
 * The exported collections define selectable corner/guide metadata, movement increments, zoom
 * presets, and the centering threshold consumed by the page and helper modules.
 */
export const cornerPads = [
	{ id: 'topLeft', label: 'Top Left' },
	{ id: 'topRight', label: 'Top Right' },
	{ id: 'bottomLeft', label: 'Bottom Left' },
	{ id: 'bottomRight', label: 'Bottom Right' }
] as const;

export const STEP_VALUES = [0.25, 0.5, 1, 2, 5];

export const PAGE_ZOOM_VALUES = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

export const ZOOM_VALUES = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];

export const ALERT_THRESHOLD = 55.4;

export const centeringGuides = [
	{ id: 'top', orientation: 'horizontal' },
	{ id: 'bottom', orientation: 'horizontal' },
	{ id: 'left', orientation: 'vertical' },
	{ id: 'right', orientation: 'vertical' }
] as const;

export const cornerOverlayItems = [
	{ key: 'topLeft', label: '' },
	{ key: 'topRight', label: '' },
	{ key: 'bottomLeft', label: '' },
	{ key: 'bottomRight', label: '' }
] as const;
