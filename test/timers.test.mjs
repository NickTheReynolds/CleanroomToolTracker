// @ts-check
// Run timers (2.0): a timer on a saved run, so several can run at once; the
// clock, stopping into the time field, the step after a finished one, and
// that older versions accept a run with a timer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runTimer, startTimer, stopTimer, timerDueMs, timerClock, timerText, runningTimers,
} from '../app/js/core/timers.js';
import { stepAfter, stepStates, newStep, newWafers } from '../app/js/core/projects.js';
import { normalizeRecord, validateRecord } from '../app/js/data/schema.js';
import { template, runA } from './fixtures.mjs';

const T0 = '2026-10-28T14:00:00.000Z';
const at = (/** @type {number} */ secs) => Date.parse(T0) + secs * 1000;

test('a timer is read only when well formed; a countdown needs a positive target', () => {
  assert.equal(runTimer({ ...runA, timer: null }), null);
  assert.equal(runTimer({ ...runA }), null);
  assert.equal(runTimer(/** @type {any} */ ({ ...runA, timer: { startedAt: 'nope', target: 60, deviceId: 'd' } })), null);
  assert.deepEqual(runTimer(/** @type {any} */ ({ ...runA, timer: { startedAt: T0, target: 300, deviceId: 'd' } })), { startedAt: T0, target: 300, deviceId: 'd' });
  assert.deepEqual(runTimer(/** @type {any} */ ({ ...runA, timer: { startedAt: T0, target: 0 } })), { startedAt: T0, target: null, deviceId: '' }, 'no target counts up');
});

test('starting sets the run going now; stopping fills the main step’s time and ends the run', () => {
  const started = startTimer({ target: 300, deviceId: 'phone', now: T0 });
  assert.deepEqual(started, { timer: { startedAt: T0, target: 300, deviceId: 'phone' }, startedAt: T0, endedAt: null });
  assert.equal(startTimer({ target: -5, deviceId: 'phone', now: T0 }).timer.target, null);
  const run = { ...runA, params: { ...runA.params, time: 300 }, ...started };
  const stopped = stopTimer(run, template, { now: new Date(at(353)).toISOString() });
  assert.equal(stopped.seconds, 353);
  assert.equal(stopped.patch.timer, null);
  assert.equal(stopped.patch.endedAt, new Date(at(353)).toISOString());
  assert.equal(stopped.patch.params.time, 353, 'Stop writes the time that passed');
  assert.equal(stopped.patch.params.icpPower, 400, 'other values stay');
  // Marking a run complete while its timer runs keeps a time the person typed.
  assert.equal(stopTimer(run, template, { now: new Date(at(353)).toISOString(), keepTyped: true }).patch.params.time, 300);
  assert.equal(stopTimer({ ...run, params: { icpPower: 400 } }, template, { now: new Date(at(10)).toISOString(), keepTyped: true }).patch.params.time, 10);
  // Without a timer, Stop changes nothing but the end.
  const none = stopTimer({ ...runA }, template, { now: T0 });
  assert.equal(none.seconds, 0);
  assert.deepEqual(none.patch.params, runA.params);
  // A template without a time field: the run ends, nothing is filled.
  assert.deepEqual(stopTimer(run, null, { now: T0 }).patch.params, run.params);
});

test('the clock counts down, then over, or up', () => {
  const down = { startedAt: T0, target: 300, deviceId: 'd' };
  assert.equal(timerDueMs(down), at(300));
  assert.deepEqual(timerClock(down, at(0)), { text: '5:00', over: false, seconds: 0 });
  assert.deepEqual(timerClock(down, at(29)), { text: '4:31', over: false, seconds: 29 });
  assert.deepEqual(timerClock(down, at(312)), { text: '+0:12', over: true, seconds: 312 });
  assert.equal(timerText(down, at(29)), '4:31 left');
  assert.equal(timerText(down, at(312)), '+0:12 over');
  const up = { startedAt: T0, target: null, deviceId: 'd' };
  assert.equal(timerDueMs(up), null);
  assert.deepEqual(timerClock(up, at(723)), { text: '12:03', over: false, seconds: 723 });
  assert.equal(timerText(up, at(723)), '12:03');
  assert.equal(timerClock(up, at(-5)).text, '0:00', 'a clock ahead of the start shows zero');
});

test('the running timers are the live runs with one, the first started first', () => {
  const a = { ...runA, id: 'a', timer: { startedAt: new Date(at(60)).toISOString(), target: null, deviceId: 'd' } };
  const b = { ...runA, id: 'b', timer: { startedAt: T0, target: 120, deviceId: 'd' } };
  const gone = { ...runA, id: 'c', deleted: true, timer: { startedAt: T0, target: 120, deviceId: 'd' } };
  assert.deepEqual(runningTimers(/** @type {any} */ ([a, runA, b, gone])).map((r) => r.id), ['b', 'a']);
});

test('a run with a timer passes validation, with or without a target or device', () => {
  for (const timer of [{ startedAt: T0, target: 300, deviceId: 'd' }, { startedAt: T0, target: null, deviceId: '' }, { startedAt: T0 }, null]) {
    const rec = normalizeRecord('runs', { ...runA, timer });
    assert.deepEqual(validateRecord('runs', rec), [], JSON.stringify(timer));
    assert.deepEqual(rec.timer, timer, 'normalising keeps the timer as it is');
  }
  assert.deepEqual(validateRecord('runs', normalizeRecord('runs', { ...runA, timer: { startedAt: 'yesterday' } })), ['timer must be {startedAt, target, deviceId}']);
  assert.deepEqual(validateRecord('runs', normalizeRecord('runs', { ...runA, timer: 'now' })), ['timer must be {startedAt, target, deviceId}']);
});

test('the step after a finished one: the next still to do, else an earlier one left open, else none', () => {
  const steps = [newStep({ title: 'Clean' }), newStep({ title: 'Oxidize' }), newStep({ title: 'Etch' }), newStep({ title: 'Strip' })];
  const base = { createdAt: T0, updatedAt: T0, deleted: false, deviceId: 'd', author: '' };
  const project = { ...base, id: 'p', name: 'P', goal: '', status: 'active', startedAt: T0, endedAt: null, substrate: '', notes: '', wafers: newWafers([], 1), steps };
  const run = (/** @type {string} */ id, /** @type {string} */ stepId, /** @type {string} */ status) => ({
    ...base, id, toolId: 't', templateId: null, status, startedAt: T0, params: {}, results: {}, projects: [{ projectId: 'p', waferIds: [], stepId }],
  });
  // Steps 1 and 2 done: after 2 comes 3; after 1 (finished again later) comes 3 as well.
  let st = stepStates(/** @type {any} */ (project), /** @type {any} */ ([run('a', steps[0].id, 'complete'), run('b', steps[1].id, 'complete')]));
  assert.equal(stepAfter(st, steps[1].id)?.step.title, 'Etch');
  assert.equal(stepAfter(st, steps[0].id)?.step.title, 'Etch');
  // Step 3 done out of order with step 2 still open: after 3 comes 4; after 4 comes back to 2.
  st = stepStates(/** @type {any} */ (project), /** @type {any} */ ([run('a', steps[0].id, 'complete'), run('c', steps[2].id, 'complete')]));
  assert.equal(stepAfter(st, steps[2].id)?.step.title, 'Strip');
  st = stepStates(/** @type {any} */ (project), /** @type {any} */ ([run('a', steps[0].id, 'complete'), run('c', steps[2].id, 'complete'), run('d', steps[3].id, 'complete')]));
  assert.equal(stepAfter(st, steps[3].id)?.step.title, 'Oxidize');
  // A step in progress counts as next; a skipped one does not; every step done gives null.
  st = stepStates(/** @type {any} */ ({ ...project, steps: steps.map((s, i) => (i === 2 ? { ...s, skipped: true } : s)) }),
    /** @type {any} */ ([run('a', steps[0].id, 'complete'), run('b', steps[1].id, 'complete'), run('d', steps[3].id, 'open')]));
  assert.equal(stepAfter(st, steps[1].id)?.step.title, 'Strip');
  st = stepStates(/** @type {any} */ (project), /** @type {any} */ (steps.map((s, i) => run(`r${i}`, s.id, 'complete'))));
  assert.equal(stepAfter(st, steps[3].id), null);
  assert.equal(stepAfter(st, 'unknown'), null);
});
