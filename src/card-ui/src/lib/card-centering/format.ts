/**
 * Small display-formatting helpers for centering measurements.
 *
 * These functions keep guide rounding, percentage labels, and opposing-edge ratios consistent
 * everywhere they are rendered in the interface.
 */

/**
 * Rounds a guide measurement to the nearest half pixel for stable display.
 *
 * @param value - Raw guide position or inset in pixels.
 * @returns The value rounded to increments of 0.5 pixels.
 */
export function snapGuideDisplayPx(value: number) {
	return Math.round(value * 2) / 2;
}

/**
 * Formats a numeric percentage with one decimal place.
 *
 * @param value - Percentage value without a percent sign.
 * @returns A one-decimal percentage label such as `50.0%`.
 */
export function formatPct(value: number) {
	return `${value.toFixed(1)}%`;
}

/**
 * Formats the larger-to-smaller ratio of two positive measurements.
 *
 * @param a - First measurement to compare.
 * @param b - Second measurement to compare.
 * @returns A two-decimal ratio, or `--` when either measurement is non-positive.
 */
export function formatRatio(a: number, b: number) {
	if (a <= 0 || b <= 0) return '--';
	const ratio = a > b ? a / b : b / a;
	return ratio.toFixed(2);
}
