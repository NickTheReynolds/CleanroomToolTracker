// @ts-check
// Time on tools (2.1): the run time a project's runs report, and how long its
// remaining steps will likely take from past runs on their tools, with Look
// up's weights; and the words for a length of time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeconds, estimateStep, projectTime } from '../app/js/core/plan-time.js';
import { stepStates, newStep, newWafers, onProjectStep, stepLink } from '../app/js/core/projects.js';
import { formatDuration } from '../app/js/core/time.js';
import { template, tool } from './fixtures.mjs';

const NOW = '2026-10-20T12:00:00.000Z';
const base = { createdAt: NOW, updatedAt: NOW, deleted: false, deviceId: 'd', author: '' };
const daysAgo = (/** @type {number} */ d) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
/** A complete run on the fixture tool and template that took `time` seconds. */
const past = (/** @type {string} */ id, /** @type {number} */ time, /** @type {number} */ age, /** @type {Record<string, any>} */ extra = {}) => ({
  ...base, id, toolId: tool.id, templateId: template.id, status: 'complete', startedAt: daysAgo(age), endedAt: daysAgo(age),
  material: 'SiO2', substrate: 'Si', params: { icpPower: 400, time }, results: { etchRate: 85 }, derivedKeys: [], recipe: 'OX-1', notes: '', tags: [],
  photoIds: [], steps: [], projects: [], ...extra,
});

test('a run reports its main step’s time plus its other steps’ times', () => {
  assert.equal(runSeconds({ params: { time: 300 } }, template), 300);
  assert.equal(runSeconds({ params: { time: 300 }, steps: [{ name: 'Main', main: true }, { name: 'Over-etch', params: { time: 60 } }] }, template), 360);
  assert.equal(runSeconds({ params: { icpPower: 400 } }, template), null, 'no time reported');
  assert.equal(runSeconds({ params: { time: 0 } }, template), null, 'a zero is no time');
  assert.equal(runSeconds({ params: { time: 300 } }, null), null, 'no template, no time field');
});

test('a step’s estimate is the recency-weighted mean of past runs on its tool and template, the step’s recipe first', () => {
  const h = { runs: [past('a', 300, 1), past('b', 600, 40), past('c', 100, 2, { recipe: 'FAST' })], tools: [tool], events: [], now: NOW };
  const step = newStep({ title: 'Etch', toolId: tool.id, recipe: 'OX-1' });
  const est = estimateStep(step, template, h);
  assert.equal(est.n, 2, 'only the OX-1 runs');
  assert.ok(est.sameRecipe);
  // 1 day old: weight 0.5^(1/30) ≈ 0.977; 40 days: 0.5^(40/30) ≈ 0.397. Mean ≈ (0.977·300 + 0.397·600) / 1.374 ≈ 386.7 s.
  assert.ok(Math.abs(/** @type {number} */ (est.seconds) - 386.7) < 1, `got ${est.seconds}`);
  // No run with the step's recipe: every run of the template counts.
  const any = estimateStep(newStep({ title: 'Etch', toolId: tool.id, recipe: 'NEW' }), template, h);
  assert.equal(any.n, 3);
  assert.equal(any.sameRecipe, false);
  // A major event since a run halves its weight (the default penalty).
  const clean = { ...base, id: 'e', toolId: tool.id, type: 'clean', major: true, at: daysAgo(20), notes: '' };
  const after = estimateStep(step, template, { ...h, events: [/** @type {any} */ (clean)] });
  // run b (40 days) is before the clean: weight 0.397·0.5. Mean ≈ (0.977·300 + 0.199·600) / 1.176 ≈ 350.6 s.
  assert.ok(Math.abs(/** @type {number} */ (after.seconds) - 350.6) < 1, `got ${after.seconds}`);
  // Nothing to go on: no tool, no template, no complete run with a time, an open run, another tool.
  assert.equal(estimateStep(newStep({ title: 'Inspect' }), template, h).seconds, null);
  assert.equal(estimateStep(step, null, h).seconds, null);
  assert.equal(estimateStep(step, template, { ...h, runs: [past('x', 300, 1, { status: 'open' }), past('y', 300, 1, { toolId: 'other' }), past('z', 300, 1, { params: {} })] }).seconds, null);
});

test('a project’s time on tools: what its runs report, and what the steps left will likely take', () => {
  const steps = [newStep({ title: 'Etch 1', toolId: tool.id, recipe: 'OX-1' }), newStep({ title: 'Etch 2', toolId: tool.id, recipe: 'OX-1' }),
    newStep({ title: 'Inspect' }), newStep({ title: 'Etch 3', toolId: tool.id })];
  const project = /** @type {any} */ ({ ...base, id: 'p', name: 'P', goal: '', status: 'active', startedAt: NOW, endedAt: null, substrate: '', notes: '',
    wafers: newWafers([], 1), steps });
  const link = (/** @type {string} */ stepId) => [{ projectId: 'p', waferIds: [], stepId }];
  const runs = [
    past('h1', 300, 10), past('h2', 300, 20), // history, outside the project
    past('d1', 300, 3, { projects: link(steps[0].id) }), // step 1 done in 5:00 (history for the steps left, like any complete run)
    past('d2', 120, 1, { status: 'open', projects: link(steps[1].id) }), // step 2 in progress, 2:00 reported so far
    past('d3', 0, 1, { params: {}, projects: link(steps[3].id), status: 'open' }), // step 4 started, nothing reported
  ];
  const states = stepStates(project, /** @type {any} */ (runs));
  assert.deepEqual(states.map((s) => s.state), ['done', 'active', 'todo', 'active']);
  const t = projectTime(project, states, () => template, { runs: /** @type {any} */ (runs), tools: [tool], events: [], now: NOW, templates: [template] });
  assert.equal(t.soFar, 420, '5:00 + 2:00 reported by the project’s runs');
  assert.equal(t.timedRuns, 2);
  assert.equal(t.untimedRuns, 1);
  assert.equal(t.stepsLeft, 3);
  assert.equal(t.estimated, 2, 'Inspect has no tool');
  // Every past run took 300 s (weights cancel), so each etch step is estimated at 300 s: step 2 has 120 s to go, step 4 all 300 s.
  assert.ok(Math.abs(/** @type {number} */ (t.remaining) - 480) < 1, `got ${t.remaining}`);
  assert.deepEqual(t.steps.map((s) => s.seconds === null), [false, true, false]);
  // Skipped steps are not left; a plan with nothing estimable has no remaining time.
  const skipped = { ...project, steps: steps.map((s, i) => (i === 2 ? { ...s, skipped: true } : s)) };
  assert.equal(projectTime(skipped, stepStates(skipped, /** @type {any} */ (runs)), () => template, { runs: /** @type {any} */ (runs), tools: [tool], events: [], now: NOW, templates: [template] }).stepsLeft, 2);
  // Steps whose template is unknown get no estimate; runs whose template is unknown report no time.
  const none = projectTime(project, states, () => null, { runs: /** @type {any} */ (runs), tools: [tool], events: [], now: NOW, templates: [] });
  assert.equal(none.remaining, null);
  assert.equal(none.estimated, 0);
  assert.equal(none.soFar, 0, 'without its template a run reports no time');
  assert.equal(none.untimedRuns, 3);
});

test('runs on a project’s step are the project’s business; the others are open runs', () => {
  assert.equal(onProjectStep({ projects: [{ projectId: 'p', waferIds: [], stepId: 's' }] }), true);
  assert.equal(onProjectStep({ projects: [{ projectId: 'p', waferIds: [], stepId: null }] }), false, 'in a project but on no step');
  assert.equal(onProjectStep({ projects: [] }), false);
  assert.equal(onProjectStep({}), false);
  assert.deepEqual(stepLink({ projects: [{ projectId: 'a', waferIds: [], stepId: null }, { projectId: 'b', waferIds: ['w'], stepId: 's' }] }), { projectId: 'b', waferIds: ['w'], stepId: 's' });
  assert.equal(stepLink({}), null);
  // With the live projects: a deleted project, or a step no longer in the plan, leaves the run a loose run.
  const live = new Map([['b', /** @type {any} */ ({ id: 'b', steps: [{ id: 's' }] })]]);
  const run = { projects: [{ projectId: 'b', waferIds: [], stepId: 's' }] };
  assert.equal(onProjectStep(run, live), true);
  assert.equal(onProjectStep({ projects: [{ projectId: 'gone', waferIds: [], stepId: 's' }] }, live), false);
  assert.equal(onProjectStep({ projects: [{ projectId: 'b', waferIds: [], stepId: 'removed' }] }, live), false);
  assert.equal(stepLink({ projects: [{ projectId: 'gone', waferIds: [], stepId: 's' }, { projectId: 'b', waferIds: [], stepId: 's' }] }, live)?.projectId, 'b');
});

test('a length of time in words', () => {
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(59.6), '60 s');
  assert.equal(formatDuration(300), '5 min');
  assert.equal(formatDuration(3899), '1 h 05 min');
  assert.equal(formatDuration(94_200), '26 h 10 min');
  assert.equal(formatDuration(-1), '');
  assert.equal(formatDuration(NaN), '');
});
