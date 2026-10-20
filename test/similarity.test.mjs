// @ts-check
// Lookup engine (core/similarity.js): spec Section 11 cases 1–5 plus edge
// cases for filters, distance, spreads, weights, ranking and relax counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lookup, distance, fieldSpread, fieldWeight, isCandidate, isSet, latestMajorEvent, matchFlags, queryValue,
} from '../app/js/core/similarity.js';
import { sampleStd } from '../app/js/core/stats.js';
import { DEFAULTS } from '../app/js/config.js';
import {
  NOW, TOOL_ID, tool, template, runs, runA, runB, runC, cleanEvent, query1, query2, query3, query5, lookupInput,
} from './fixtures.mjs';

const DAY = 86_400_000;
/** @param {number} n @returns {string} the ISO time n days before NOW */
const daysAgo = (n) => new Date(Date.parse(NOW) - n * DAY).toISOString();
/** @param {any} r @returns {string[]} match ids in rank order */
const ids = (r) => r.matches.map((/** @type {any} */ m) => m.run.id);
/** @param {any} r @param {string} id @returns {any} */
const matchOf = (r, id) => r.matches.find((/** @type {any} */ m) => m.run.id === id);

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

/** @param {any} input */
const run = (input) => lookup(input);

test('Case 1: distances, order, age factors and weights', () => {
  const r = run(lookupInput(query1));
  assert.deepEqual(ids(r), ['A', 'B', 'C']);
  const [a, b, c] = r.matches;
  assert.deepEqual([a.d, b.d, c.d], [0, 0.5, 1.5]);
  assert.deepEqual([a.ageDays, b.ageDays, c.ageDays], [14, 7, 90]);
  near(a.factors.age, 0.7236, 0.0005);
  near(b.factors.age, 0.8507, 0.0005);
  near(c.factors.age, 0.1250, 0.0005);
  near(a.w, 0.7236, 0.0005);
  near(b.w, 0.5160, 0.0005);
  near(c.w, 0.0279, 0.0005);
  for (const m of r.matches) {
    assert.equal(m.factors.event, 1);
    assert.equal(m.eventSince, false);
    assert.equal(m.lastEventSince, null);
    assert.equal(m.halfLifeDays, 30);
    near(m.w, m.factors.sim * m.factors.age * m.factors.event, 1e-15);
  }
  assert.deepEqual(r.matches.map((m) => m.exact), [true, false, false]);
  assert.deepEqual(r.matches.map(matchFlags), [['Exact match'], [], []]);
  assert.deepEqual(a.diffs, []);
  assert.deepEqual(b.diffs, [{ key: 'icpPower', label: 'ICP power', unit: 'W', q: 400, r: 450, delta: 50, missing: false }]);
  assert.deepEqual(c.terms, { icpPower: 0, pressure: 1, chf3: 0.5 });
  assert.deepEqual(c.diffs.map((x) => [x.key, x.delta]), [['pressure', 5], ['chf3', -10]]);
  assert.deepEqual(r.spreads, { icpPower: 100, rfPower: 25, pressure: 5, chf3: 20, o2: 5 });
  assert.deepEqual(r.inputs.map((f) => f.key), ['icpPower', 'pressure', 'chf3']);
  assert.deepEqual(r.extrapolation, []);
  assert.deepEqual(r.relax, { strictChemistry: 0, sameMaterial: 0, includeSiblings: 0 });
  assert.equal(r.now, Date.parse(NOW));
  assert.equal(r.template, template);
  assert.equal(distance(runC, template.fields, query1.params, r.spreads).d, 1.5);
});

test('Case 2: equal distances rank the more recent run (B) first', () => {
  const r = run(lookupInput(query2));
  assert.deepEqual(ids(r), ['B', 'A', 'C']);
  assert.deepEqual(r.matches.map((m) => m.d), [0.25, 0.25, 1.75]);
  assert.deepEqual(r.extrapolation, []);
});

test('Case 3: ICP 500 W is outside the 400–450 W range of the candidates', () => {
  const r = run(lookupInput(query3));
  assert.deepEqual(ids(r), ['B', 'A', 'C']);
  assert.deepEqual(r.matches.map((m) => m.d), [0.5, 1, 2.5]);
  assert.deepEqual(r.extrapolation, [{ key: 'icpPower', label: 'ICP power', unit: 'W', q: 500, min: 400, max: 450 }]);
});

test('Case 4: a major clean flags A and C and halves their weight', () => {
  const r = run(lookupInput(query1, [cleanEvent]));
  assert.deepEqual(r.matches.map(matchFlags), [['Exact match', 'Before last clean'], [], ['Before last clean']]);
  near(matchOf(r, 'A').w, 0.3618, 0.0005);
  assert.equal(matchOf(r, 'A').factors.event, 0.5);
  assert.equal(matchOf(r, 'A').lastEventSince, cleanEvent);
  assert.equal(matchOf(r, 'B').eventSince, false);
  assert.deepEqual(r.events, [cleanEvent]);
});

test('Case 5: O2 in the query matches nothing; strict chemistry off would add 3 runs', () => {
  const r = run(lookupInput(query5));
  assert.deepEqual(r.matches, []);
  assert.deepEqual(r.relax, { strictChemistry: 3, sameMaterial: 0, includeSiblings: 0 });
  const off = run(lookupInput({ ...query5, strictChemistry: false }));
  assert.equal(off.matches.length, 3);
  assert.equal(off.relax.strictChemistry, 0);
});

test('zero candidates: no matches, no extrapolation, nothing to relax', () => {
  const r = run({ ...lookupInput(query1), runs: [] });
  assert.deepEqual(r.matches, []);
  assert.deepEqual(r.extrapolation, []);
  assert.deepEqual(r.relax, { strictChemistry: 0, sameMaterial: 0, includeSiblings: 0 });
  assert.equal(r.spreads.icpPower, 100);
  const empty = lookup(/** @type {any} */ ({ query: undefined, now: NOW }));
  assert.deepEqual([empty.matches, empty.template, empty.inputs], [[], null, []]);
});

test('candidates: complete, not deleted, a valid start and at least one set output', () => {
  const extra = [
    { ...runB, id: 'deleted', deleted: true },
    { ...runB, id: 'open', status: 'open' },
    { ...runB, id: 'draft', status: 'draft' },
    mk('none', {}, { results: {} }),
    mk('blank', {}, { results: { etchRate: '', uniformity: null } }),
    mk('nan', {}, { results: { etchRate: NaN } }),
    mk('not-an-output', {}, { results: { chuckTemp: 20 } }),
    mk('no-date', {}, { startedAt: 'soon' }),
    mk('uniformity-only', {}, { results: { uniformity: 2.5 } }),
  ];
  const r = run({ ...lookupInput(query1), runs: [...runs, ...extra] });
  assert.deepEqual(ids(r).sort(), ['A', 'B', 'C', 'uniformity-only']);
  // When the run's template is unknown, any set results value counts.
  assert.equal(isCandidate(mk('x', {}, { results: { foo: 1 } }), undefined), true);
  assert.equal(isCandidate(mk('x', {}, { results: { foo: '  ' } }), null), false);
  assert.deepEqual([isSet(''), isSet(' '), isSet(null), isSet(undefined), isSet(NaN), isSet({})], [false, false, false, false, false, false]);
  assert.deepEqual([isSet(0), isSet(false), isSet('x')], [true, true, true]);
});

test('a missing or non-numeric run value costs weight × MISSING_PENALTY', () => {
  const lacking = mk('D', { pressure: undefined }, { startedAt: daysAgo(1) });
  const junk = mk('E', { pressure: 'ten' }, { startedAt: daysAgo(2) });
  const r = run({ ...lookupInput(query1), runs: [runA, lacking, junk] });
  assert.equal(matchOf(r, 'D').d, 1);
  assert.deepEqual(matchOf(r, 'D').diffs, [{ key: 'pressure', label: 'Pressure', unit: 'mTorr', q: 10, r: null, delta: null, missing: true }]);
  assert.equal(matchOf(r, 'E').d, 1);
  assert.deepEqual([matchOf(r, 'E').diffs[0].r, matchOf(r, 'E').diffs[0].missing], ['ten', true]);
  const heavy = run({ ...lookupInput(query1), runs: [lacking], cfg: { ...DEFAULTS, MISSING_PENALTY: 2.5 } });
  assert.equal(heavy.matches[0].d, 2.5);
});

test('spread fallbacks: hint, sample std of 4+ candidates, then 10% of |q| or of the mean |value|', () => {
  const f = /** @type {any} */ ({ key: 'x', label: 'X', type: 'number', role: 'input' });
  const withX = (/** @type {number[]} */ xs) => xs.map((x, i) => mk(`r${i}`, { x }));
  assert.equal(fieldSpread({ ...f, spreadHint: 7 }, 3, withX([1, 2, 3, 4])), 7);
  near(fieldSpread(f, 3, withX([1, 2, 3, 4])), 1.2909944487, 1e-9);
  assert.equal(fieldSpread(f, 20, withX([5, 5, 5, 5])), 2); // std 0 -> 10% of q
  assert.equal(fieldSpread(f, undefined, withX([5, 5, 5, 5])), 0.5); // no q -> 10% of mean |value|
  assert.equal(fieldSpread(f, 50, withX([10, 20, 30])), 5); // fewer than 4 values
  assert.equal(fieldSpread(f, undefined, withX([-10, -20, -30])), 2);
  assert.equal(fieldSpread(f, -40, []), 4);
  assert.equal(fieldSpread(f, undefined, []), 1e-9);
  assert.equal(fieldSpread(f, 0, withX([1, 2])), 1e-9);
  assert.equal(fieldSpread({ ...f, spreadHint: 0 }, 50, []), 5);
  // Through lookup: without a hint, 3 candidates fall back to 10% of q ...
  const bare = { ...template, fields: template.fields.map((x) => (x.key === 'icpPower' ? { ...x, spreadHint: undefined } : x)) };
  const r = run({ ...lookupInput(query1), templates: [bare] });
  assert.equal(r.spreads.icpPower, 40);
  assert.equal(matchOf(r, 'B').d, 1.25);
  // ... and 4 candidates use their sample std.
  const r4 = run({ ...lookupInput(query1), templates: [bare], runs: [...runs, mk('D', { icpPower: 500 }, { startedAt: daysAgo(3) })] });
  near(r4.spreads.icpPower, /** @type {number} */ (sampleStd([400, 450, 400, 500])), 1e-12);
});

test('materials compare by normText: "SiO₂" finds "SiO2" and "Résist" finds " résist "', () => {
  assert.equal(run(lookupInput({ ...query1, material: 'SiO₂' })).matches.length, 3);
  assert.equal(run(lookupInput({ ...query1, material: ' sio2 ' })).matches.length, 3);
  const resist = [mk('R1', {}, { material: ' résist ' }), mk('R2', {}, { material: 'Resist' }), mk('R3', {}, { material: 'RÉSIST' })];
  const all = [...runs, ...resist];
  const r = run({ ...lookupInput({ ...query1, material: 'Résist' }), runs: all });
  assert.deepEqual(ids(r).sort(), ['R1', 'R3']);
  assert.equal(r.relax.sameMaterial, 4);
  const any = run({ ...lookupInput({ ...query1, material: 'Résist', sameMaterial: false }), runs: all });
  assert.deepEqual([any.matches.length, any.relax.sameMaterial], [6, 0]);
  const blank = run({ ...lookupInput({ ...query1, material: '  ' }), runs: all });
  assert.deepEqual([blank.matches.length, blank.relax.sameMaterial], [6, 0]);
});

test('categorical inputs: 0 when equal, CATEGORICAL_PENALTY when not, MISSING_PENALTY when absent', () => {
  const cat = {
    ...template,
    fields: [...template.fields,
      { key: 'clamp', label: 'Clamp', type: 'select', role: 'input', options: ['Mechanical', 'Electrostatic'] },
      { key: 'heCool', label: 'He cooling', type: 'bool', role: 'input', weight: 2 },
      { key: 'note', label: 'Recipe note', type: 'text', role: 'input', weight: 0.5 }],
  };
  const q = { ...query1, params: { ...query1.params, clamp: 'mechanical ', heCool: true, note: 'Std' } };
  const rs = [
    mk('same', { clamp: 'Mechanical', heCool: true, note: ' std' }),
    mk('diff', { clamp: 'Electrostatic', heCool: false, note: 'other' }, { startedAt: daysAgo(1) }),
    mk('none', {}, { startedAt: daysAgo(2) }),
    mk('text-bool', { clamp: 'Mechanical', heCool: 'true', note: 'Std' }, { startedAt: daysAgo(3) }),
  ];
  const r = run({ ...lookupInput(q), templates: [cat], runs: rs, cfg: { ...DEFAULTS, CATEGORICAL_PENALTY: 3 } });
  assert.equal(matchOf(r, 'same').d, 0);
  assert.deepEqual(matchOf(r, 'diff').terms, { icpPower: 0, pressure: 0, chf3: 0, clamp: 3, heCool: 6, note: 1.5 });
  assert.deepEqual(matchOf(r, 'diff').diffs.map((x) => x.delta), [null, null, null]);
  assert.equal(matchOf(r, 'none').d, 3.5);
  assert.deepEqual(matchOf(r, 'none').diffs.map((x) => x.missing), [true, true, true]);
  assert.equal(matchOf(r, 'text-bool').terms.heCool, 6); // bool compares strictly
});

test('matchExact inputs the query sets are hard filters (even at weight 0), not distance terms', () => {
  const ex = {
    ...template,
    fields: [...template.fields,
      { key: 'mask', label: 'Mask', type: 'select', role: 'input', options: ['Resist', 'Oxide'], matchExact: true },
      { key: 'bonded', label: 'Bonded', type: 'bool', role: 'input', matchExact: true, weight: 0 }],
  };
  const rs = [
    mk('resist', { mask: ' resist', bonded: true }),
    mk('oxide', { mask: 'Oxide', bonded: true }),
    mk('no-mask', { bonded: true }),
    mk('unbonded', { mask: 'Resist', bonded: false }),
    mk('text-bool', { mask: 'Resist', bonded: 'true' }),
  ];
  const input = (/** @type {any} */ params) => ({
    ...lookupInput({ ...query1, params: { ...query1.params, ...params } }), templates: [ex], runs: rs,
  });
  const r = run(input({ mask: 'RESIST', bonded: true }));
  assert.deepEqual(ids(r), ['resist']);
  assert.deepEqual(r.matches[0].terms, { icpPower: 0, pressure: 0, chf3: 0 });
  assert.deepEqual(ids(run(input({ mask: 'Resist' }))).sort(), ['resist', 'text-bool', 'unbonded']);
  assert.equal(run(input({})).matches.length, 5);
});

test('siblings: tools of the same category and templates of the same process type', () => {
  const icp2 = { ...tool, id: 'tool-icp2', name: 'ICP 2', halfLifeDays: 10 };
  const pecvd = { ...tool, id: 'tool-pecvd', name: 'PECVD', category: 'deposition' };
  const gone = { ...tool, id: 'tool-gone', deleted: true };
  const t2 = { ...template, id: 'tpl-2', toolId: 'tool-icp2' };
  const t3 = { ...template, id: 'tpl-3', name: 'Nitride etch' };
  const t4 = { ...template, id: 'tpl-4', toolId: 'tool-pecvd', processType: 'deposition' };
  const rs = [
    ...runs,
    mk('icp2', {}, { toolId: 'tool-icp2', templateId: 'tpl-2' }),
    mk('icp2-same-template', {}, { toolId: 'tool-icp2' }),
    mk('nitride', {}, { templateId: 'tpl-3' }),
    mk('pecvd', {}, { toolId: 'tool-pecvd', templateId: 'tpl-4' }),
    mk('pecvd-etch-template', {}, { toolId: 'tool-pecvd' }),
    mk('deleted-tool', {}, { toolId: 'tool-gone' }),
  ];
  const base = { ...lookupInput(query1), tools: [tool, icp2, pecvd, gone], templates: [template, t2, t3, t4], runs: rs };
  const own = run(base);
  assert.deepEqual(ids(own), ['A', 'B', 'C']);
  assert.equal(own.relax.includeSiblings, 3);
  const sib = run({ ...base, query: { ...query1, includeSiblings: true } });
  assert.deepEqual(ids(sib).sort(), ['A', 'B', 'C', 'icp2', 'icp2-same-template', 'nitride']);
  assert.equal(sib.relax.includeSiblings, 0);
  assert.equal(matchOf(sib, 'icp2').halfLifeDays, 10); // each run uses its own tool's half-life
});

test('events: minor, deleted, future and other-tool events are ignored; "since" is strict', () => {
  const ev = (/** @type {string} */ id, /** @type {any} */ extra) => ({ ...cleanEvent, id, ...extra });
  const events = [
    ev('minor', { major: false }), ev('deleted', { deleted: true }),
    ev('future', { at: '2026-10-21T12:00:00Z' }), ev('other-tool', { toolId: 'tool-other' }),
  ];
  const r = run(lookupInput(query1, events));
  assert.ok(r.matches.every((m) => !m.eventSince && m.factors.event === 1));
  near(matchOf(r, 'A').w, 0.7236, 0.0005);
  assert.deepEqual(r.events.map((e) => e.id), ['minor', 'future', 'other-tool']);
  const atA = run(lookupInput(query1, [ev('at-A', { at: runA.startedAt })]));
  assert.deepEqual(atA.matches.map((m) => m.eventSince), [false, false, true]);
  const atNow = run(lookupInput(query1, [ev('now', { at: NOW, type: 'pm' })]));
  assert.deepEqual(atNow.matches.map(matchFlags), [['Exact match', 'Before last PM'], ['Before last PM'], ['Before last PM']]);
  const two = [cleanEvent, ev('pm', { type: 'pm', at: '2026-10-15T12:00:00Z' })];
  assert.equal(run(lookupInput(query1, two)).matches[0].lastEventSince?.id, 'pm');
  const tie = [ev('e1', { at: NOW }), ev('e2', { at: NOW })];
  assert.equal(latestMajorEvent(tie, TOOL_ID, -Infinity, Date.parse(NOW))?.id, 'e2');
});

test('a per-tool half-life override replaces HALF_LIFE_DAYS for that tool', () => {
  const r = run({ ...lookupInput(query1), tools: [{ ...tool, halfLifeDays: 14 }] });
  near(matchOf(r, 'A').factors.age, 0.5, 1e-15);
  near(matchOf(r, 'B').factors.age, Math.SQRT1_2, 1e-15);
  assert.equal(matchOf(r, 'A').halfLifeDays, 14);
  const zero = run({ ...lookupInput(query1), tools: [{ ...tool, halfLifeDays: 0 }] });
  near(matchOf(zero, 'A').factors.age, 0.5 ** (14 / 30), 1e-15);
  const tuned = run({ ...lookupInput(query1), cfg: { ...DEFAULTS, HALF_LIFE_DAYS: 60 } });
  near(matchOf(tuned, 'A').factors.age, 0.5 ** (14 / 60), 1e-15);
});

test('ranking: ties go to the more recent run, then the smaller id; float noise counts as a tie', () => {
  const twins = [mk('t2', {}, { startedAt: daysAgo(5) }), mk('t1', {}, { startedAt: daysAgo(5) }), mk('t0', {}, { startedAt: daysAgo(9) })];
  assert.deepEqual(ids(run({ ...lookupInput(query1), runs: twins })), ['t1', 't2', 't0']);
  const plain = {
    ...template,
    fields: [
      { key: 'a', label: 'A', type: 'number', role: 'input', spreadHint: 1 },
      { key: 'b', label: 'B', type: 'number', role: 'input', spreadHint: 1 },
      { key: 'etchRate', label: 'Etch rate', type: 'number', unit: 'nm/min', role: 'output' }],
  };
  const rs = [mk('old', { a: 0.3, b: 0 }, { startedAt: daysAgo(9) }), mk('new', { a: 0.1, b: 0.2 }, { startedAt: daysAgo(1) })];
  const r = run({ ...lookupInput({ ...query1, params: { a: 0, b: 0 } }), templates: [plain], runs: rs });
  assert.notEqual(r.matches[0].d, r.matches[1].d); // 0.30000000000000004 vs 0.3
  assert.deepEqual(ids(r), ['new', 'old']);
});

test('strict chemistry compares which gases flow, counting absent and non-numeric values as 0', () => {
  const rs = [mk('no-o2', { o2: undefined }), mk('junk-o2', { o2: 'n/a' }, { startedAt: daysAgo(1) }), mk('o2', { o2: 5 }, { startedAt: daysAgo(2) })];
  const zero = run({ ...lookupInput({ ...query1, params: { ...query1.params, o2: 0 } }), runs: rs });
  assert.deepEqual(ids(zero).sort(), ['junk-o2', 'no-o2']);
  const flowing = run({ ...lookupInput({ ...query1, params: { ...query1.params, o2: 4 } }), runs: rs });
  assert.deepEqual([ids(flowing), flowing.relax.strictChemistry], [['o2'], 2]);
  // The chemistry fields of a sibling run's own template join the comparison.
  const sf6Template = {
    ...template, id: 'tpl-sf6',
    fields: [...template.fields, { key: 'sf6', label: 'SF6', type: 'number', unit: 'sccm', role: 'input', chemistry: true }],
  };
  const sib = {
    ...lookupInput({ ...query1, includeSiblings: true }), templates: [template, sf6Template],
    runs: [...runs, mk('sf6', { sf6: 30 }, { templateId: 'tpl-sf6' })],
  };
  assert.deepEqual([ids(run(sib)), run(sib).relax.strictChemistry], [['A', 'B', 'C'], 1]);
});

test('query values of the wrong type and weight-0 fields are ignored', () => {
  const r = run(lookupInput({ ...query1, params: { icpPower: '400', pressure: 10, chf3: 50, time: 999, chuckTemp: 99 } }));
  assert.deepEqual(r.inputs.map((f) => f.key), ['pressure', 'chf3']);
  assert.deepEqual([matchOf(r, 'A').d, matchOf(r, 'B').d], [0, 0]);
  assert.equal('time' in r.spreads, false);
  const field = (/** @type {string} */ type) => /** @type {any} */ ({ key: 'k', label: 'K', type, role: 'input' });
  assert.equal(queryValue(field('bool'), { k: 'yes' }), undefined);
  assert.equal(queryValue(field('text'), { k: 5 }), undefined);
  assert.equal(queryValue(field('number'), { k: Infinity }), undefined);
  assert.equal(queryValue(field('select'), { k: 'A' }), 'A');
  assert.deepEqual([fieldWeight(field('number')), fieldWeight(field('duration')), fieldWeight(field('text'))], [1, 0, 1]);
  assert.deepEqual([fieldWeight({ ...field('duration'), weight: 2 }), fieldWeight({ ...field('number'), weight: -1 })], [2, 0]);
});

test('a run dated after now reports a negative age and an age factor of 1', () => {
  const r = run({ ...lookupInput(query1), runs: [mk('F', {}, { startedAt: '2026-10-21T12:00:00Z' })] });
  assert.deepEqual([r.matches[0].ageDays, r.matches[0].factors.age], [-1, 1]);
});

test('query options default to strict chemistry and same material on, siblings off', () => {
  const { strictChemistry, sameMaterial, includeSiblings, ...bare } = query1;
  const r = run(lookupInput(bare));
  assert.deepEqual([r.query.strictChemistry, r.query.sameMaterial, r.query.includeSiblings], [true, true, false]);
  assert.deepEqual(ids(r), ['A', 'B', 'C']);
  assert.equal(r.query.targetThickness, 500);
});

test('determinism: same input, same output; inputs untouched; input order and time form do not matter', () => {
  const input = lookupInput(query2, [cleanEvent]);
  const before = structuredClone(input);
  const r1 = run(input);
  assert.deepEqual(run(input), r1);
  assert.deepEqual(input, before);
  assert.deepEqual(run({ ...input, runs: [...input.runs].reverse() }).matches, r1.matches);
  assert.deepEqual(run({ ...input, now: Date.parse(NOW) }), r1);
  assert.deepEqual(run({ ...input, now: new Date(NOW) }), r1);
  assert.throws(() => run({ ...input, now: 'not a date' }), TypeError);
});
