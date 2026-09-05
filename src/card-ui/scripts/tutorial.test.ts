import test from 'node:test';
import assert from 'node:assert/strict';
import { tutorialEntry, tutorialGate, tutorialSteps, type TutorialState } from '../src/lib/tutorial/tutorial.ts';
const empty: TutorialState = { hasImage:false, ready:false, busy:false, failed:false, cornerSelected:false };
test('entry follows the current image, and missing image blocks progress', () => {
    assert.equal(tutorialEntry(empty), 0);
    assert.match(tutorialGate(0, empty)!, /Upload/);
    assert.equal(tutorialEntry({ ...empty, hasImage:true }), 1);
});
test('detection gates adjustments and explains failures', () => {
    assert.match(tutorialGate(1, { ...empty, hasImage:true, busy:true })!, /Wait/);
    assert.match(tutorialGate(1, { ...empty, hasImage:true, failed:true })!, /Reset/);
    assert.equal(tutorialGate(1, { ...empty, hasImage:true, ready:true }), null);
});
test('corner selection is required only at its teaching step', () => {
    const ready = { ...empty, hasImage:true, ready:true };
    assert.match(tutorialGate(2, ready)!, /corner nodes/);
    assert.equal(tutorialGate(2, { ...ready, cornerSelected:true }), null);
    for (let step=3; step<tutorialSteps.length; step++) assert.equal(tutorialGate(step, ready), null);
});
