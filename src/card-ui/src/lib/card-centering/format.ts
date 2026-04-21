export function snapGuideDisplayPx(value: number) {
	return Math.round(value * 2) / 2;
}

export function formatPct(value: number) {
	return `${value.toFixed(1)}%`;
}

export function formatRatio(a: number, b: number) {
	if (a <= 0 || b <= 0) return '--';
	const ratio = a > b ? a / b : b / a;
	return ratio.toFixed(2);
}