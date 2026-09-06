export type TutorialState = { hasImage: boolean; ready: boolean; busy: boolean; failed: boolean; cornerSelected: boolean; guideSelected?: boolean };
export const tutorialSteps = [
    { title: 'Upload a card', target: '[data-tour="upload"]', text: 'Start by uploading a clear photo with all four card corners visible. Try Me also works for this walkthrough.' },
    { title: 'Check automatic detection', target: '[data-tour="source"]', text: 'The app estimates the card edges. Check that each corner in the SOURCE PANEL sits on the physical card boundary, not a sleeve or slab.' },
    { title: 'Select a source corner', target: '[aria-label="Card controls mini map"] svg', text: "Use the four corner nodes in the Adjustments mini map to choose a corner in the SOURCE PANEL. Its side controls adjust the inner guides in the WARP PANEL.", mobileText: "Use the four dots in the SOURCE PANEL mini map to choose a corner. This mini map controls corners only; use the WARP PANEL mini map for inner guides." },
    { title: 'Choose a step size', target: '[data-tour="step-size"]', text: "Choose how far each nudge moves the selected corner using Step Size in Adjustments. Start larger, then reduce it for precision.", mobileText: "Choose how far each nudge moves the selected corner. Step Size sits below each panel's controls; both selectors stay in sync. Start larger, then reduce it for precision." },
    { title: 'Nudge the corner', target: '[data-tour="arrows"]', text: 'Use the arrows to line up the selected corner with the real card edge. Notice how the selected corner moves in the SOURCE PANEL.' },
    { title: 'Check the WARP PANEL', target: '[data-tour="warp"]', text: 'The outline in the SOURCE PANEL becomes a rectangle in the WARP PANEL. Check its alignment here.' },
    { title: 'Review the inner borders', target: '[data-tour="warp"]', text: "In the WARP PANEL, check the estimated inner guides against the printed border. Drag a guide, or select a side in the Adjustments mini map and nudge it. These guides determine the centering ratios.", mobileText: "In the WARP PANEL, check the estimated inner guides against the printed border. Drag a guide, or select a line in the WARP PANEL mini map and use its arrows. These guides determine the centering ratios." },
    { title: 'Nudge an inner guide', target: '[data-guide-arrows]', text: 'Select a side in the Adjustments mini map, then use the arrows. Notice how the selected inner guide moves in the WARP PANEL. Align it with the printed border; reduce Step Size for finer moves.', mobileText: 'Select a line in the WARP PANEL mini map, then use its arrows. Notice how the selected inner guide moves in the WARP PANEL. Align it with the printed border; use Step Size below the controls for finer moves.' },
    { title: 'Read the centering', target: '[data-tour="results"]', text: 'In the WARP PANEL, read Top/Bottom for vertical centering and Left/Right for horizontal centering. Near 50/50 means balanced guide spacing, not a verified grade.' },
    { title: 'Ready to keep adjusting', target: '[data-tour="results"]', text: 'Done. You can keep adjusting any corner or inner guide at any time. Use the camera button in the WARP PANEL to save your measurements.' }
] as const;

export function tutorialEntry(state: TutorialState) { return state.hasImage ? 1 : 0; }
export function tutorialGate(step: number, state: TutorialState): string | null {
    if (!state.hasImage) return 'Upload a photo or choose Try Me to continue.';
    if (!state.ready) return state.failed
        ? 'No usable card outline was found. Use Reset, then try a clearer photo with all four corners visible.'
        : 'Wait for detection and the card preview to finish before continuing.';
    if (step === 2 && !state.cornerSelected) return 'Select one of the four corner nodes in the mini map to continue.';
    if (step === 7 && !state.guideSelected) return 'Select an inner guide in the mini map to try nudging it before continuing.';
    return null;
}
