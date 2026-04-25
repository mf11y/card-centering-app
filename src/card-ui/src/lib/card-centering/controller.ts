export type Direction = 'up' | 'down' | 'left' | 'right';

type CreateInputControllerArgs = {
	onNudge: (direction: Direction) => void;
	onStop: () => void;
};

export function createInputController({ onNudge, onStop }: CreateInputControllerArgs) {
	let padActiveDirection: Direction | null = null;
	let activeDirection: Direction | null = null;
	let pressedDirections: Direction[] = [];

	let padHoldTimeout: ReturnType<typeof setTimeout> | null = null;
	let padHoldInterval: ReturnType<typeof setInterval> | null = null;
	let keyboardRepeatInterval: ReturnType<typeof setInterval> | null = null;

	const PAD_HOLD_DELAY = 500;
	const PAD_REPEAT_MS = 45;
	const KEYBOARD_REPEAT_MS = 22;

	function keyToDirection(key: string): Direction | null {
		const k = key.toLowerCase();

		if (k === 'arrowup' || k === 'w') return 'up';
		if (k === 'arrowdown' || k === 's') return 'down';
		if (k === 'arrowleft' || k === 'a') return 'left';
		if (k === 'arrowright' || k === 'd') return 'right';

		return null;
	}

	function clearPadTimers() {
		if (padHoldTimeout) {
			clearTimeout(padHoldTimeout);
			padHoldTimeout = null;
		}
		if (padHoldInterval) {
			clearInterval(padHoldInterval);
			padHoldInterval = null;
		}
	}

	function stopKeyboardRepeat() {
		if (keyboardRepeatInterval) {
			clearInterval(keyboardRepeatInterval);
			keyboardRepeatInterval = null;
		}
	}

	function startKeyboardRepeat() {
		stopKeyboardRepeat();
		if (!activeDirection) return;

		keyboardRepeatInterval = setInterval(() => {
			if (!activeDirection) return;
			onNudge(activeDirection);
		}, KEYBOARD_REPEAT_MS);
	}

	function addPressedDirection(direction: Direction) {
		const next = [direction, ...pressedDirections.filter((d) => d !== direction)];
		pressedDirections = next;
		activeDirection = next[0] ?? null;
		startKeyboardRepeat();
	}

	function removePressedDirection(direction: Direction) {
		const next = pressedDirections.filter((d) => d !== direction);
		pressedDirections = next;
		activeDirection = next[0] ?? null;

		if (activeDirection) startKeyboardRepeat();
		else stopKeyboardRepeat();
	}

	function startPadHold(direction: Direction) {
		clearPadTimers();
		padActiveDirection = direction;
		onNudge(direction);

		padHoldTimeout = setTimeout(() => {
			padHoldInterval = setInterval(() => {
				onNudge(direction);
			}, PAD_REPEAT_MS);
		}, PAD_HOLD_DELAY);
	}

	function stopPadHold() {
		clearPadTimers();
		padActiveDirection = null;
		onStop();
	}

	function handleKeydown(event: KeyboardEvent) {
		const direction = keyToDirection(event.key);
		if (!direction) return;

		event.preventDefault();
		if (event.repeat) return;

		addPressedDirection(direction);
		onNudge(direction);
	}

	function handleKeyup(event: KeyboardEvent) {
		const direction = keyToDirection(event.key);
		if (!direction) return;

		event.preventDefault();
		removePressedDirection(direction);
		onStop();
	}

	function clearPressedDirections() {
		pressedDirections = [];
		activeDirection = null;
		stopKeyboardRepeat();
	}

	function isDirectionActive(direction: Direction) {
		return padActiveDirection === direction || activeDirection === direction;
	}

	function destroy() {
		clearPadTimers();
		stopKeyboardRepeat();
		clearPressedDirections();
	}

	return {
		startPadHold,
		stopPadHold,
		handleKeydown,
		handleKeyup,
		clearPressedDirections,
		isDirectionActive,
		destroy
	};
}