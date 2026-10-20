// @ts-check
// Lookup summary (core/summary.js and core/summary-text.js): spec Section 11
// cases 1–5 plus estimates, sensitivity, trend, confidence, suggested time
// and the exact sentence formats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookup } from '../app/js/core/similarity.js';
import { summarize, sensitivities } from '../app/js/core/summary.js';
import { joinLabels, plural } from '../app/js/core/summary-text.js';
import { weightedMean } from '../app/js/core/stats.js';
import { DEFAULTS } from '../app/js/config.js';
import { NOW, template, runs, runA, cleanEvent, query1, query2, query3, query5, lookupInput } from './fixtures.mjs';

const DAY = 86_400_000;
/** @param {number} n @returns {string} the ISO time n days before NOW */
const daysAgo = (n) => new Date(Date.parse(NOW) - n * DAY).toISOString();
/** Case 1's query without the target thickness. */
const qT = { ...query1, targetThickness: null };

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} tol
 */
function near(actual, expected, tol) {
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected} ± ${tol}, got ${actual}`);
}

/**
 * A complete run on the fixture tool and template; params default to the
 * Case 1 query values and other fields to run A.
 * @param {string} id
 * @param {Record<string, any>} [params]
 * @param {Record<string, any>} [extra]
 * @returns {any}
 */
function mk(id, params = {}, extra = {}) {
  return { ...runA, id, params: { icpPower: 400, pressure: 10, chf3: 50, o2: 0, ...params }, ...extra };
}

/**
 * @param {any} input lookup input
 * @param {{outputKey?: string}} [opts]
 * @returns {any} the summary (tests assert on its fields directly)
 */
const summaryOf = (input, opts) => summarize(lookup(input), opts);

/**
 * Runs like A that are 40, 30, 20 and 10 days old, with the given etch rates.
 * @param {number[]} rates
 */
const series = (rates) => rates.map((etchRate, i) => mk(`T${i}`, {}, { startedAt: daysAgo(40 - 10 * i), results: { etchRate } }));

test('Case 1: exact match, weighted mean, sensitivity, suggested time, medium confidence', () => {
  const s = summaryOf(lookupInput(query1));
  assert.deepEqual([s.outputKey, s.outputLabel, s.unit, s.n], ['etchRate', 'Etch rate', 'nm/min', 3]);
  assert.deepEqual([s.closest.match.run.id, s.closest.value], ['A', 85]);
  assert.deepEqual(s.estimate, { value: 85, kind: 'exact', adjustments: [] });
  assert.equal(s.closestOnly, null);
  assert.deepEqual(s.headline, { value: 85, kind: 'exact', label: 'exact match' });
  near(s.average.mean, 88.36, 0.05);
  const ws = [0.5 ** (14 / 30), Math.exp(-0.5) * 0.5 ** (7 / 30), Math.exp(-1.5) * 0.125];
  const xs = [85, 94, 71];
  const mu = /** @type {number} */ (weightedMean(xs, ws));
  const std = Math.sqrt(ws.reduce((t, w, i) => t + w * (xs[i] - mu) ** 2, 0) / ws.reduce((t, w) => t + w, 0));
  near(s.average.std, std, 1e-9);
  assert.deepEqual([s.average.min, s.average.max, s.average.n], [71, 94, 3]);
  assert.deepEqual(Object.keys(s.sensitivity), ['icpPower']); // none for pressure or CHF3
  near(s.sensitivity.icpPower.value, 0.18, 1e-12);
  assert.equal(s.sensitivity.icpPower.pairs, 1);
  assert.deepEqual([s.trend, s.lastEvent], [null, null]);
  near(s.suggestedTime.minutes, 5.882, 0.001);
  assert.equal(s.suggestedTime.mmss, '5:53');
  near(s.suggestedTime.rangeMin, 500 / 94, 1e-12);
  near(s.suggestedTime.rangeMax, 500 / 71, 1e-12);
  assert.deepEqual([s.suggestedTime.verb, s.suggestedTime.target], ['etch', 500]);
  assert.deepEqual(s.confidence, { level: 'medium', reasons: ['Only 2 runs within distance 0.5; high confidence needs 3.'] });
  assert.deepEqual(s.warnings, []);
  assert.deepEqual(s.sentences, [
    '3 similar runs. Closest: Oct 6 (exact match), 85 nm/min.',
    'Similar runs average 88.4 nm/min (71–94).',
    'Etch rate rises ~0.18 nm/min per W of ICP power (1 pair).',
    'For 500 nm, etch ~5.9 min (5:53).',
  ]);
});

test('Case 2: adjusted from B, 94 + 0.18 × (425 − 450) = 89.5', () => {
  const s = summaryOf(lookupInput(query2));
  assert.equal(s.closest.match.run.id, 'B');
  near(s.headline.value, 89.5, 1e-9);
  assert.deepEqual([s.headline.kind, s.headline.label], ['adjusted', 'adjusted']);
  const [adj] = s.estimate.adjustments;
  assert.deepEqual([s.estimate.adjustments.length, adj.key, adj.label, adj.unit, adj.delta], [1, 'icpPower', 'ICP power', 'W', -25]);
  near(adj.sens, 0.18, 1e-12);
  near(adj.contribution, -4.5, 1e-12);
  assert.equal(s.suggestedTime, null);
  assert.equal(s.confidence.level, 'medium');
  assert.deepEqual(s.sentences.slice(0, 2), [
    '3 similar runs. Closest: Oct 13 (distance 0.25), 94 nm/min.',
    'Adjusted for ICP power −25 W: ~89.5 nm/min.',
  ]);
});

test('Case 3: extrapolated to 103 nm/min with a warning and low confidence', () => {
  const s = summaryOf(lookupInput(query3));
  near(s.headline.value, 103, 1e-9);
  assert.equal(s.headline.kind, 'adjusted');
  assert.deepEqual(s.warnings, ['ICP power 500 W is outside your range (400–450 W); the estimate is extrapolated.']);
  assert.deepEqual(s.confidence, { level: 'low', reasons: ['ICP power is outside the range of similar runs.'] });
  assert.ok(s.sentences.includes('Adjusted for ICP power +50 W: ~103 nm/min.'));
});

test('Case 4: the clean lowers older weights and is reported with the runs since', () => {
  const s = summaryOf(lookupInput(query1, [cleanEvent]));
  near(s.average.mean, 89.99, 0.05);
  assert.equal(s.lastEvent.event, cleanEvent);
  assert.equal(s.lastEvent.runsSince, 1);
  assert.ok(s.sentences.includes('Chamber clean on Oct 10; 1 run since.'));
  assert.equal(s.confidence.level, 'medium');
  assert.ok(s.confidence.reasons.includes('A major tool event happened after the closest run.'));
  // runsSince counts matches without the output too; events of other tools do not count.
  const later = mk('U', {}, { startedAt: daysAgo(2), results: { uniformity: 2 } });
  const s2 = summaryOf({ ...lookupInput(query1, [cleanEvent]), runs: [...runs, later] });
  assert.ok(s2.sentences.includes('Chamber clean on Oct 10; 2 runs since.'));
  assert.equal(summaryOf(lookupInput(query1, [{ ...cleanEvent, toolId: 'tool-other' }])).lastEvent, null);
});

test('Case 5 and empty results: no summary', () => {
  assert.equal(summaryOf(lookupInput(query5)), null);
  assert.equal(summaryOf({ ...lookupInput(query1), runs: [] }), null);
  assert.equal(summaryOf(lookupInput(query1), { outputKey: 'uniformity' }), null); // no run has it
  assert.equal(summaryOf({ ...lookupInput(query1), templates: [{ ...template, primaryOutput: null }] }), null);
  assert.equal(summarize(/** @type {any} */ (null)), null);
});

test('a single candidate gives low confidence and no average sentence', () => {
  const s = summaryOf({ ...lookupInput(query1), runs: [runA] });
  assert.equal(s.n, 1);
  assert.deepEqual(s.sensitivity, {});
  assert.deepEqual(s.confidence, { level: 'low', reasons: ['Only one similar run has this output.'] });
  assert.deepEqual(s.sentences, ['1 similar run. Closest: Oct 6 (exact match), 85 nm/min.', 'For 500 nm, etch ~5.9 min (5:53).']);
});

test('nearest: differences below DIFF_THRESHOLD × s keep the closest value', () => {
  const s = summaryOf(lookupInput({ ...qT, params: { icpPower: 405, pressure: 10, chf3: 50 } }));
  assert.deepEqual(s.headline, { value: 85, kind: 'nearest', label: 'closest run' });
  assert.equal(s.sentences[0], '3 similar runs. Closest: Oct 6 (distance 0.05), 85 nm/min.');
});

test('closest run shown as is when a differing input has no sensitivity; the headline is the mean', () => {
  const s = summaryOf(lookupInput({ ...qT, params: { icpPower: 400, pressure: 12, chf3: 50 } }));
  assert.equal(s.estimate, null);
  assert.deepEqual(s.closestOnly, { value: 85, unexplained: ['Pressure'] });
  assert.deepEqual(s.headline, { value: s.average.mean, kind: 'mean', label: 'similar-runs average' });
  assert.ok(s.sentences.includes('Pressure differs from the closest run and has no measured sensitivity, so the closest run is shown as is.'));
  const two = summaryOf(lookupInput({ ...qT, params: { icpPower: 400, pressure: 12, chf3: 45 } }));
  assert.ok(two.sentences.includes('Pressure and CHF3 differ from the closest run and have no measured sensitivity, so the closest run is shown as is.'));
  // An input the closest run lacks cannot be adjusted either.
  const rf = summaryOf(lookupInput({ ...qT, params: { ...qT.params, rfPower: 100 } }));
  assert.deepEqual(rf.closestOnly, { value: 85, unexplained: ['RF power'] });
  assert.equal(joinLabels(['A', 'B', 'C']), 'A, B and C');
  assert.deepEqual([plural(1, 'run'), plural(0, 'run')], ['1 run', '0 runs']);
});

test('sensitivity: falls, "per unit of", no change, and pairs that differ in more than one input', () => {
  const noUnit = { ...template, fields: template.fields.map((f) => (f.key === 'pressure' ? { ...f, unit: '' } : f)) };
  const p = (/** @type {string} */ id, /** @type {any} */ params, /** @type {number} */ etchRate) => mk(id, params, { results: { etchRate } });
  const base = { ...lookupInput(qT), templates: [noUnit] };
  const falls = summaryOf({ ...base, runs: [p('P1', { pressure: 10 }, 85), p('P2', { pressure: 15 }, 80)] });
  assert.deepEqual(falls.sensitivity, { pressure: { value: -1, pairs: 1 } });
  assert.ok(falls.sentences.includes('Etch rate falls ~1 nm/min per unit of Pressure (1 pair).'));
  const flat = summaryOf({ ...base, runs: [p('P1', { pressure: 10 }, 85), p('P2', { pressure: 15 }, 85)] });
  assert.ok(flat.sentences.includes('Etch rate does not change with Pressure (1 pair).'));
  /** @param {any[]} rs */
  const sens = (rs, tpl = noUnit) => sensitivities(lookup({ ...base, templates: [tpl], runs: rs }).matches, tpl, {}, 'etchRate', DEFAULTS);
  // ICP within SENS_MAX_OTHER × s (10 W) still pairs; 15 W does not; RF power set on one run only does not.
  assert.equal(sens([p('P1', { pressure: 10 }, 85), p('P2', { pressure: 15, icpPower: 405 }, 80)]).pressure.pairs, 1);
  assert.deepEqual(sens([p('P1', { pressure: 10 }, 85), p('P2', { pressure: 15, icpPower: 415 }, 80)]), {});
  assert.deepEqual(sens([p('P1', { pressure: 10 }, 85), p('P2', { pressure: 15, rfPower: 50 }, 80)]), {});
  // Categorical inputs must be equal (normText) or absent in both.
  const clampTpl = { ...noUnit, fields: [...noUnit.fields, { key: 'clamp', label: 'Clamp', type: 'select', role: 'input', options: ['A', 'B'] }] };
  assert.deepEqual(sens([p('P1', { pressure: 10, clamp: 'A' }, 85), p('P2', { pressure: 15, clamp: 'B' }, 80)], clampTpl), {});
  assert.deepEqual(sens([p('P1', { pressure: 10, clamp: 'A' }, 85), p('P2', { pressure: 15 }, 80)], clampTpl), {});
  assert.equal(sens([p('P1', { pressure: 10, clamp: 'A' }, 85), p('P2', { pressure: 15, clamp: ' a' }, 80)], clampTpl).pressure.value, -1);
  // The median over several pairs: slopes −0.5, −2.5 and −3 (their mean would be −2).
  const many = [p('P1', { pressure: 10 }, 85), p('P2', { pressure: 12 }, 84), p('P3', { pressure: 20 }, 60)];
  assert.deepEqual(sens(many), { pressure: { value: -2.5, pairs: 3 } });
});

test('trend: rising, falling and stable over at least TREND_MIN_N recent, close runs', () => {
  const extra = [
    mk('old', {}, { startedAt: daysAgo(100), results: { etchRate: 50 } }), // outside the 90-day window
    mk('far', { icpPower: 520 }, { startedAt: daysAgo(15), results: { etchRate: 200 } }), // d = 1.2
    mk('future', {}, { startedAt: '2026-10-21T12:00:00Z', results: { etchRate: 200 } }),
  ];
  const rising = summaryOf({ ...lookupInput(qT), runs: [...series([80, 82, 84, 86]), ...extra] });
  near(rising.trend.slopePerDay, 0.2, 1e-9);
  near(rising.trend.slopePerWeek, 1.4, 1e-9);
  assert.deepEqual([rising.trend.n, rising.trend.spanDays, rising.trend.direction], [4, 30, 'rising']);
  assert.ok(rising.sentences.includes('Etch rate is rising ~1.4 nm/min per week over 4 runs.'));
  const falling = summaryOf({ ...lookupInput(qT), runs: series([86, 84, 82, 80]) });
  assert.equal(falling.trend.direction, 'falling');
  assert.ok(falling.sentences.includes('Etch rate is falling ~1.4 nm/min per week over 4 runs.'));
  const stable = summaryOf({ ...lookupInput(qT), runs: series([85, 86, 86, 85]) });
  assert.equal(stable.trend.direction, 'stable');
  assert.ok(stable.sentences.includes('Etch rate has been stable over 4 runs.'));
  assert.equal(summaryOf({ ...lookupInput(qT), runs: series([85, 85, 85, 85]) }).trend.direction, 'stable');
  assert.equal(summaryOf({ ...lookupInput(qT), runs: series([80, 82, 84]) }).trend, null);
});

test('high confidence needs 3 close matches and a recent closest run with no event since', () => {
  const input = { ...lookupInput(qT), runs: series([85, 86, 86, 85]) };
  const s = summaryOf(input);
  assert.deepEqual(s.confidence, {
    level: 'high',
    reasons: ['4 runs within distance 0.5.', 'The closest run is 10 days old, with no major tool event since.',
      'No input is outside the range of similar runs.'],
  });
  const ev = summaryOf({ ...input, events: [{ ...cleanEvent, at: daysAgo(5) }] });
  assert.equal(ev.confidence.level, 'medium');
  const aged = summaryOf({ ...input, runs: input.runs.map((/** @type {any} */ r) => ({ ...r, startedAt: new Date(Date.parse(r.startedAt) - 60 * DAY).toISOString() })) });
  assert.deepEqual(aged.confidence, { level: 'medium', reasons: ['The closest run is 70 days old; high confidence needs 60 or fewer.'] });
  const far = summaryOf({ ...lookupInput({ ...qT, params: { ...qT.params, pressure: 20 } }), runs: series([85, 86, 86, 85]) });
  assert.equal(far.confidence.level, 'low'); // closest d = 2 > CONF_LOW_MIN_D
});

test('suggested time only for nm/min outputs with a positive target and rate', () => {
  assert.equal(summaryOf(lookupInput(query2)).suggestedTime, null);
  const withUni = runs.map((r, i) => ({ ...r, results: { ...r.results, uniformity: [1.5, 2, 3][i] } }));
  const u = summaryOf({ ...lookupInput(query1), runs: withUni }, { outputKey: 'uniformity' });
  assert.deepEqual([u.outputLabel, u.unit, u.suggestedTime], ['Uniformity', '%', null]);
  assert.equal(u.sentences[0], '3 similar runs. Closest: Oct 6 (exact match), 1.5%.');
  const neg = summaryOf({ ...lookupInput(query1), runs: runs.map((r) => ({ ...r, results: { etchRate: -5 } })) });
  assert.equal(neg.suggestedTime, null);
  const spaced = { ...template, fields: template.fields.map((f) => (f.key === 'etchRate' ? { ...f, unit: 'NM / Min' } : f)) };
  assert.equal(summaryOf({ ...lookupInput(query1), templates: [spaced] }).suggestedTime.mmss, '5:53');
  const thermal = summaryOf({ ...lookupInput(query1), templates: [{ ...template, processType: 'thermal' }] });
  assert.ok(thermal.sentences.includes('For 500 nm, run ~5.9 min (5:53).'));
  const dep = summaryOf({ ...lookupInput(query1), templates: [{ ...template, processType: 'deposition' }] });
  assert.equal(dep.suggestedTime.verb, 'deposit');
});

test('the average falls back to equal weights when every weight is 0', () => {
  const lateClean = { ...cleanEvent, at: '2026-10-14T12:00:00Z' };
  const s = summaryOf({ ...lookupInput(query1, [lateClean]), cfg: { ...DEFAULTS, EVENT_PENALTY: 0 } });
  near(s.average.mean, (85 + 94 + 71) / 3, 1e-9);
  const top1 = summaryOf({ ...lookupInput(query1), cfg: { ...DEFAULTS, TOP_K: 1 } });
  assert.deepEqual([top1.average.n, top1.average.mean], [1, 85]);
});

test('summaries are deterministic and leave the lookup result untouched', () => {
  const r = lookup(lookupInput(query2, [cleanEvent]));
  const before = structuredClone(r);
  const s1 = summarize(r);
  assert.deepEqual(summarize(r), s1);
  assert.deepEqual(r, before);
});
