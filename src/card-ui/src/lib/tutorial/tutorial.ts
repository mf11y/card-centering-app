export type TutorialState = { hasImage: boolean; ready: boolean; busy: boolean; failed: boolean; cornerSelected: boolean };
export const tutorialSteps = [
    { title: 'Upload a card', target: '[data-tour="upload"]', text: 'Start by uploading a clear photo with all four card corners visible. Try Me also works for this walkthrough.' },
    { title: 'Check automatic detection', target: '[data-tour="source"]', text: 'The app estimates the card edges. Check that each SOURCE corner sits on the physical card boundary, not a sleeve or slab.' },
    { title: 'Select a source corner', target: '[aria-label="Card controls mini map"] svg', text: "Use the four corner nodes in the Adjustments mini map to choose a SOURCE corner. Its side controls adjust the inner guides in WARP.", mobileText: "Use the four dots in the SOURCE mini map to choose a corner. This mini map controls corners only; use the WARP mini map for inner guides." },
    { title: 'Choose a step size', target: '[data-tour="step-size"]', text: "Choose how far each nudge moves the selected corner using Step Size in Adjustments. Start larger, then reduce it for precision.", mobileText: "Choose how far each nudge moves the selected corner. Step Size sits below each panel's controls; both selectors stay in sync. Start larger, then reduce it for precision." },
    { title: 'Nudge the corner', target: '[data-tour="arrows"]', text: 'Use the arrows to line up the selected SOURCE corner with the real card edge.' },
    { title: 'Watch the warp preview', target: '[data-tour="warp"]', text: 'Your SOURCE quadrilateral becomes a rectangle in WARP. Check its alignment here.' },
    { title: 'Review the inner borders', target: '[data-tour="warp"]', text: "Check the estimated inner guides against the printed border. Drag a guide, or select a side in the Adjustments mini map and nudge it. These guides determine the centering ratios.", mobileText: "Check the estimated inner guides against the printed border. Drag a guide, or select a line in the WARP mini map and use its arrows. These guides determine the centering ratios." },
    { title: 'Read the centering', target: '[data-tour="results"]', text: 'Read Top/Bottom for vertical centering and Left/Right for horizontal centering. Near 50/50 means balanced guide spacing, not a verified grade.' },
    { title: 'Ready to keep adjusting', target: '[data-tour="results"]', text: 'Done. You can keep adjusting any corner or inner guide at any time. Use the camera button to save your measurements.' }
] as const;

export function tutorialEntry(state: TutorialState) { return state.hasImage ? 1 : 0; }
export function tutorialGate(step: number, state: TutorialState): string | null {
    if (!state.hasImage) return 'Upload a photo or choose Try Me to continue.';
    if (!state.ready) return state.failed
        ? 'No usable card outline was found. Use Reset, then try a clearer photo with all four corners visible.'
        : 'Wait for detection and the card preview to finish before continuing.';
    if (step === 2 && !state.cornerSelected) return 'Select one of the four corner nodes in the mini map to continue.';
    return null;
}
