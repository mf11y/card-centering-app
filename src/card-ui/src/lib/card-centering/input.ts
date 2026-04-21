export type Direction = 'up' | 'down' | 'left' | 'right';

export type InputHandlers = {
	getHasActiveCorner: () => boolean;
	getHasActiveGuide: () => boolean;
	getStepSize: () => number;

	clearSelection: () => void;
	setActiveDirection: (direction: Direction | null) => void;

	moveActiveCorner: (dx: number, dy: number) => void;
	moveActiveGuide: (direction: Direction) => void;
};

export function handleInputKeydown(event: KeyboardEvent, handlers: InputHandlers) {
	const target = event.target as HTMLElement | null;
	const tag = target?.tagName;

	if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as HTMLElement | null)?.isContentEditable) {
		return;
	}

	const key = event.key.toLowerCase();
	const hasActiveCorner = handlers.getHasActiveCorner();
	const hasActiveGuide = handlers.getHasActiveGuide();
	const stepSize = handlers.getStepSize();

	switch (key) {
		case 'escape':
			handlers.clearSelection();
			handlers.setActiveDirection(null);
			return;

		case 'arrowup':
		case 'w':
			if (!hasActiveCorner && !hasActiveGuide) return;
			event.preventDefault();
			(document.activeElement as HTMLElement | null)?.blur();
			handlers.setActiveDirection('up');

			if (hasActiveCorner) {
				handlers.moveActiveCorner(0, -stepSize);
			} else if (hasActiveGuide) {
				handlers.moveActiveGuide('up');
			}
			return;

		case 'arrowdown':
		case 's':
			if (!hasActiveCorner && !hasActiveGuide) return;
			event.preventDefault();
			(document.activeElement as HTMLElement | null)?.blur();
			handlers.setActiveDirection('down');

			if (hasActiveCorner) {
				handlers.moveActiveCorner(0, stepSize);
			} else if (hasActiveGuide) {
				handlers.moveActiveGuide('down');
			}
			return;

		case 'arrowleft':
		case 'a':
			if (!hasActiveCorner && !hasActiveGuide) return;
			event.preventDefault();
			(document.activeElement as HTMLElement | null)?.blur();
			handlers.setActiveDirection('left');

			if (hasActiveCorner) {
				handlers.moveActiveCorner(-stepSize, 0);
			} else if (hasActiveGuide) {
				handlers.moveActiveGuide('left');
			}
			return;

		case 'arrowright':
		case 'd':
			if (!hasActiveCorner && !hasActiveGuide) return;
			event.preventDefault();
			(document.activeElement as HTMLElement | null)?.blur();
			handlers.setActiveDirection('right');

			if (hasActiveCorner) {
				handlers.moveActiveCorner(stepSize, 0);
			} else if (hasActiveGuide) {
				handlers.moveActiveGuide('right');
			}
			return;
	}
}

export function handleInputKeyup(handlers: Pick<InputHandlers, 'setActiveDirection'>) {
	handlers.setActiveDirection(null);
}