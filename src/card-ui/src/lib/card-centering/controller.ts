/**
 * Unified directional-input controller for keyboard keys and on-screen direction pads.
 *
 * The controller translates key/pointer holds into immediate and repeating nudge callbacks,
 * tracks the currently active direction for UI feedback, and owns cleanup for all repeat timers.
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

type CreateInputControllerArgs = {
	onNudge: (direction: Direction) => void;
	onStop: () => void;
	onStateChange?: () => void;
};

/**
 * Creates a stateful controller for directional nudging from keyboard and pad controls.
 *
 * Keyboard input supports Arrow and WASD keys, including overlapping presses where the most
 * recently pressed direction wins. Pad input nudges immediately and repeats after a short delay.
 * Consumers must call `destroy` when the controller is no longer used.
 *
 * @param args - Nudge, stop, and optional state-notification callbacks.
 * @returns Event handlers, pad-hold controls, active-state lookup, and a cleanup function.
 */
export function createInputController({
	onNudge,
	onStop,
	onStateChange
}: CreateInputControllerArgs) {
	let padActiveDirection: Direction | null = null;
	let activeDirection: Direction | null = null;
	let pressedDirections: Direction[] = [];

	let keyboardHoldTimeout: ReturnType<typeof setTimeout> | null = null;

	let padHoldTimeout: ReturnType<typeof setTimeout> | null = null;
	let padHoldInterval: ReturnType<typeof setInterval> | null = null;
	let keyboardRepeatInterval: ReturnType<typeof setInterval> | null = null;

	const PAD_HOLD_DELAY = 180;
	const PAD_REPEAT_MS = 45;
	const KEYBOARD_REPEAT_MS = 22;

	/**
	 * Notifies the consumer that active-direction state may need to be rendered again.
	 *
	 * The callback is optional because movement can be consumed without exposing pressed-state UI.
	 */
	function notifyStateChange() {
		onStateChange?.();
	}

	/**
	 * Maps a keyboard key to a supported direction.
	 *
	 * @param key - KeyboardEvent key value.
	 * @returns The matching direction, or `null` for unrelated keys.
	 */
	function keyToDirection(key: string): Direction | null {
		const k = key.toLowerCase();

		if (k === 'arrowup' || k === 'w') return 'up';
		if (k === 'arrowdown' || k === 's') return 'down';
		if (k === 'arrowleft' || k === 'a') return 'left';
		if (k === 'arrowright' || k === 'd') return 'right';

		return null;
	}

	/**
	 * Cancels and clears both timers used by an on-screen pad hold.
	 *
	 * Clearing stored handles makes repeated cleanup safe and allows a future hold to start cleanly.
	 */
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

	/**
	 * Cancels the keyboard hold delay and active repeat interval.
	 *
	 * This is used both on final key release and before repetition is retargeted to another key.
	 */
	function stopKeyboardRepeat() {
	if (keyboardHoldTimeout) {
		clearTimeout(keyboardHoldTimeout);
		keyboardHoldTimeout = null;
	}

	if (keyboardRepeatInterval) {
		clearInterval(keyboardRepeatInterval);
		keyboardRepeatInterval = null;
	}
}

	/**
	 * Starts delayed keyboard repetition for the current active direction.
	 *
	 * Any prior repeat is stopped first; if no direction remains active, no timer is scheduled.
	 */
	function startKeyboardRepeat() {
	stopKeyboardRepeat();
	if (!activeDirection) return;

	keyboardHoldTimeout = setTimeout(() => {
		keyboardRepeatInterval = setInterval(() => {
			if (!activeDirection) return;
			onNudge(activeDirection);
		}, KEYBOARD_REPEAT_MS);
	}, PAD_HOLD_DELAY);
}

	/**
	 * Marks a direction as most recently pressed and restarts keyboard repetition.
	 *
	 * @param direction - Direction newly pressed by the user.
	 */
	function addPressedDirection(direction: Direction) {
		const next = [direction, ...pressedDirections.filter((d) => d !== direction)];
		pressedDirections = next;
		activeDirection = next[0] ?? null;
		startKeyboardRepeat();
		notifyStateChange();
	}

	/**
	 * Removes a released direction and resumes any previously held direction.
	 *
	 * @param direction - Direction whose key was released.
	 */
	function removePressedDirection(direction: Direction) {
		const next = pressedDirections.filter((d) => d !== direction);
		pressedDirections = next;
		activeDirection = next[0] ?? null;

		if (activeDirection) startKeyboardRepeat();
		else stopKeyboardRepeat();

		notifyStateChange();
	}

	/**
	 * Begins an on-screen pad interaction with one immediate nudge and delayed repetition.
	 *
	 * @param direction - Direction represented by the pressed pad control.
	 */
	function startPadHold(direction: Direction) {
		clearPadTimers();
		padActiveDirection = direction;

		// first click happens immediately
		onNudge(direction);
		notifyStateChange();

		// only begin repeating after a short hold
		padHoldTimeout = setTimeout(() => {
			padHoldInterval = setInterval(() => {
				onNudge(direction);
			}, PAD_REPEAT_MS);
		}, PAD_HOLD_DELAY);
	}

	/**
	 * Ends the current pad hold, stops repetition, and signals movement completion.
	 *
	 * Active-state notification is emitted after clearing the stored pad direction.
	 */
	function stopPadHold() {
		clearPadTimers();
		padActiveDirection = null;
		onStop();
		notifyStateChange();
	}

	/**
	 * Handles the initial keydown for Arrow or WASD movement.
	 *
	 * @param event - Browser keyboard event to translate and, when handled, cancel.
	 */
	function handleKeydown(event: KeyboardEvent) {
		const direction = keyToDirection(event.key);
		if (!direction) return;

		event.preventDefault();
		if (event.repeat) return;

		addPressedDirection(direction);
		onNudge(direction);
	}

	/**
	 * Handles key release, selecting another still-held direction when available.
	 *
	 * @param event - Browser keyboard event to translate and, when handled, cancel.
	 */
	function handleKeyup(event: KeyboardEvent) {
		const direction = keyToDirection(event.key);
		if (!direction) return;

		event.preventDefault();
		removePressedDirection(direction);

		if (!activeDirection) {
			onStop();
		}
	}

	/**
	 * Clears every held keyboard direction and cancels keyboard repetition.
	 *
	 * The stop callback runs only when there was active keyboard movement to finish.
	 */
	function clearPressedDirections() {
		const hadActiveDirection = !!activeDirection || pressedDirections.length > 0;

		pressedDirections = [];
		activeDirection = null;
		stopKeyboardRepeat();
		notifyStateChange();

		if (hadActiveDirection) {
			onStop();
		}
	}

	/**
	 * Reports whether either the keyboard or direction pad is actively moving in a direction.
	 *
	 * @param direction - Direction whose active state should be queried.
	 * @returns `true` when that direction is the active keyboard or pad direction.
	 */
	function isDirectionActive(direction: Direction) {
		return padActiveDirection === direction || activeDirection === direction;
	}

	/**
	 * Releases timers and input state owned by this controller.
	 *
	 * Consumers should call this during component teardown to prevent delayed callbacks.
	 */
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
