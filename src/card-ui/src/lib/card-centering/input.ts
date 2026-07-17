/**
 * Stateless global-keyboard routing for active card corners and centering guides.
 *
 * This module filters editable targets, maps Escape/Arrow/WASD input to selection and movement
 * callbacks, and exposes the key-release reset used by consumers that do not need hold timers.
 */
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

/**
 * Handles a keyboard event for the currently selected corner or guide.
 *
 * Escape clears selection. Arrow and WASD keys nudge a corner by the current pixel step or move
 * a guide in the matching semantic direction. Keystrokes originating in editable controls are
 * ignored so typing is never intercepted.
 *
 * @param event - Browser keydown event to inspect and optionally consume.
 * @param handlers - State readers and movement callbacks supplied by the UI.
 */
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

/**
 * Clears directional UI state after a handled key is released.
 *
 * @param handlers - Consumer callback used to reset the active direction.
 */
export function handleInputKeyup(handlers: Pick<InputHandlers, 'setActiveDirection'>) {
	handlers.setActiveDirection(null);
}
