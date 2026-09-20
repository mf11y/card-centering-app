type Insets = { top: number; bottom: number; left: number; right: number };

/** Use live panel geometry and computed theme styles without cloning its responsive layout. */
export async function renderWarpScreenshot(options: {
	imageUrl: string;
	insets: Insets;
	panel: HTMLElement;
	card: HTMLElement;
	filter: string;
}): Promise<HTMLCanvasElement> {
	await document.fonts.ready;
	const panelRect = options.panel.getBoundingClientRect();
	const zoom = panelRect.width / options.panel.offsetWidth;
	const bounds = (element: Element) => {
		const rect = element.getBoundingClientRect();
		return { x: rect.left - panelRect.left, y: rect.top - panelRect.top, width: rect.width, height: rect.height };
	};
	const panelStyle = getComputedStyle(options.panel);
	const background = panelStyle.backgroundColor;
	const padding = parseFloat(panelStyle.paddingBottom) * zoom;
	const card = bounds(options.card);
	const metrics = Array.from(options.panel.querySelectorAll('[data-tour="results"] > div')).map(group => {
		const box = group.children[1];
		const style = getComputedStyle(box);
		const divider = box.querySelector('svg')!;
		return {
			box: bounds(box),
			background: style.backgroundColor,
			border: style.borderColor,
			radius: parseFloat(style.borderRadius) * zoom,
			perfect: box.classList.contains('centering-rgb-glow'),
			divider: bounds(divider),
			texts: Array.from(group.querySelectorAll('div')).filter(el => el.children.length === 0).map(el => {
				const textStyle = getComputedStyle(el);
				return { ...bounds(el), text: el.textContent?.trim() ?? '',
					font: `${textStyle.fontWeight} ${parseFloat(textStyle.fontSize) * zoom}px ${textStyle.fontFamily}`,
					color: textStyle.color, align: textStyle.textAlign,
					uppercase: textStyle.textTransform === 'uppercase',
					glow: el.classList.contains('centering-rgb-value') };
			})
		};
	});
	const image = new Image();
	image.src = options.imageUrl;
	await image.decode();
	// Always include the entire card, even when the interactive preview is zoomed.
	card.height = card.width * image.naturalHeight / image.naturalWidth;
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(panelRect.width * 2);
	canvas.height = Math.ceil((card.y + card.height + padding) * 2);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas rendering is unavailable');
	ctx.scale(2, 2);
	ctx.fillStyle = background;
	ctx.fillRect(0, 0, canvas.width / 2, canvas.height / 2);
	const gradient = (x: number, width: number) => {
		const paint = ctx.createLinearGradient(x, 0, x + width, 0);
		['#a855f7', '#7c3aed', '#d946ef', '#ff4fa3'].forEach((color, i) => paint.addColorStop(i / 3, color));
		return paint;
	};
	for (const metric of metrics) {
		const { box } = metric;
		ctx.save();
		ctx.beginPath();
		ctx.roundRect(box.x, box.y, box.width, box.height, metric.radius);
		ctx.fillStyle = metric.background;
		ctx.fill();
		ctx.lineWidth = (metric.perfect ? 2 : 1) * zoom;
		ctx.strokeStyle = metric.perfect ? gradient(box.x, box.width) : metric.border;
		if (metric.perfect) {
			ctx.shadowColor = '#d946ef';
			ctx.shadowBlur = 14 * zoom;
			ctx.stroke();
		}
		ctx.stroke();
		ctx.restore();
		for (const text of metric.texts) {
			ctx.save();
			ctx.font = text.font;
			ctx.textBaseline = 'middle';
			ctx.textAlign = text.align === 'right' ? 'right' : 'left';
			ctx.fillStyle = text.glow ? gradient(text.x, text.width) : text.color;
			if (text.glow) { ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 4 * zoom; }
			ctx.fillText(text.uppercase ? text.text.toUpperCase() : text.text,
				text.x + (text.align === 'right' ? text.width : 0), text.y + text.height / 2);
			ctx.restore();
		}
		const d = metric.divider;
		ctx.strokeStyle = 'rgba(82,82,91,0.7)';
		ctx.lineWidth = 1.5 * zoom;
		ctx.beginPath();
		ctx.moveTo(d.x + d.width / 2, d.y + d.height * .16);
		ctx.lineTo(d.x + d.width / 2, d.y + d.height * .84);
		ctx.stroke();
	}
	ctx.save();
	ctx.filter = options.filter;
	ctx.drawImage(image, card.x, card.y, card.width, card.height);
	ctx.restore();
	ctx.strokeStyle = '#22d3ee';
	ctx.lineWidth = 2 * zoom;
	ctx.beginPath();
	for (const fraction of [options.insets.top / 100, 1 - options.insets.bottom / 100]) {
		const y = card.y + fraction * card.height;
		ctx.moveTo(card.x, y);
		ctx.lineTo(card.x + card.width, y);
	}
	for (const fraction of [options.insets.left / 100, 1 - options.insets.right / 100]) {
		const x = card.x + fraction * card.width;
		ctx.moveTo(x, card.y);
		ctx.lineTo(x, card.y + card.height);
	}
	ctx.stroke();
	return canvas;
}
