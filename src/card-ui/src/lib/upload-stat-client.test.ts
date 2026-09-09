import assert from 'node:assert/strict';
import test from 'node:test';
import { applyConfirmedCreate, applyStatsResponse, type UploadStatState } from './upload-stat-client.ts';

test('confirmed creation increments a displayed count locally', () => {
    assert.deepEqual(applyConfirmedCreate({ count: 131, confirmedCreates: 0 }), { count: 132, confirmedCreates: 1 });
});

test('late stats response cannot undo a confirmed local increment', () => {
    const state = applyConfirmedCreate({ count: null, confirmedCreates: 0 });
    assert.deepEqual(applyStatsResponse(state, 131), { count: 132, confirmedCreates: 1 });
});

test('invalid or unavailable stats response leaves state unchanged', () => {
    const state: UploadStatState = { count: 132, confirmedCreates: 1 };
    assert.equal(applyStatsResponse(state, null), state);
});
