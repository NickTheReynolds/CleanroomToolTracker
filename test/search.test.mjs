// @ts-check
// History search (core/search.js): filterRuns with each filter, inclusive
// local-day date edges (DST days too), multi-word and non-ASCII keywords, no
// mutation; distinctMaterials and primarySeries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRuns, distinctMaterials, primarySeries, normalizeFilters, hasFilters, EMPTY_FILTERS, variedInputs, scatterSeries,
} from '../app/js/core/search.js';
import { template, runA, runB, runC } from './fixtures.mjs';

/**
 * A local wall-clock time as ISO, so the date-edge tests hold in any time zone.
 * @param {number} y @param {number} mo 1-12 @param {number} d
 * @param {number} [hh] @param {number} [mm] @param {number} [ss] @param {number} [ms]
 */
const local = (y, mo, d, hh = 12, mm = 0, ss = 0, ms = 0) => new Date(y, mo - 1, d, hh, mm, ss, ms).toISOString();

/**
 * A complete SiO2 run on the ICP "oxide" template, with overrides.
 * @param {string} id
 * @param {Record<string, any>} [over]
 * @returns {any}
 */
function run(id, over = {}) {
  return {
    id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deleted: false,
    deviceId: 'test', author: 'tester', toolId: 'icp', templateId: 'oxide', material: 'SiO2', substrate: 'Si',
    maskMaterial: '', status: 'complete', startedAt: local(2026, 10, 6), endedAt: null, params: {}, results: {},
    derivedKeys: [], targetThickness: null, recipe: '', notes: '', tags: [], photoIds: [], ...over,
  };
}

const L = { tools: new Map(), templates: new Map() };
/** @param {any[]} list */
const ids = (list) => list.map((r) => r.id);

test('no filters: every non-deleted run of any status, newest startedAt first', () => {
  const runs = [
    run('a', { startedAt: local(2026, 10, 1) }),
    run('b', { startedAt: local(2026, 10, 3), status: 'open' }),
    run('c', { startedAt: local(2026, 10, 2), deleted: true }),
    run('d', { startedAt: local(2026, 9, 30), status: 'draft' }),
    run('e', { startedAt: local(2026, 10, 3) }),
  ];
  const all = ['b', 'e', 'a', 'd']; // b and e tie on startedAt: id order
  assert.deepEqual(ids(filterRuns(runs, {}, L)), all);
  assert.deepEqual(ids(filterRuns(runs, null)), all);
  assert.deepEqual(ids(filterRuns(runs, EMPTY_FILTERS, L)), all);
  assert.deepEqual(ids(filterRuns(runs, { toolId: '', status: 'all', q: '   ', from: '', to: '' }, L)), all);
  assert.deepEqual(filterRuns([], { q: 'x' }, L), []);
});

test('tool and template filters match by id and combine', () => {
  const runs = [
    run('a', { startedAt: local(2026, 10, 4) }),
    run('b', { startedAt: local(2026, 10, 3), toolId: 'rie', templateId: 'rie-etch' }),
    run('c', { startedAt: local(2026, 10, 2), templateId: 'nitride' }),
    run('d', { startedAt: local(2026, 10, 1), templateId: null }),
  ];
  assert.deepEqual(ids(filterRuns(runs, { toolId: 'icp' }, L)), ['a', 'c', 'd']);
  assert.deepEqual(ids(filterRuns(runs, { templateId: 'nitride' }, L)), ['c']);
  assert.deepEqual(ids(filterRuns(runs, { toolId: 'icp', templateId: 'oxide' }, L)), ['a']);
  assert.deepEqual(ids(filterRuns(runs, { toolId: 'rie', templateId: 'oxide' }, L)), []);
  assert.deepEqual(ids(filterRuns(runs, { toolId: 'gone' }, L)), []);
});

test('material uses normText equality (case, spacing, Unicode forms), not a prefix match', () => {
  const runs = [
    run('a', { startedAt: local(2026, 10, 5), material: 'SiO2' }),
    run('b', { startedAt: local(2026, 10, 4), material: ' sio2 ' }),
    run('c', { startedAt: local(2026, 10, 3), material: 'SiO₂' }),
    run('d', { startedAt: local(2026, 10, 2), material: 'SiO2 (thermal)' }),
    run('e', { startedAt: local(2026, 10, 1), material: 'Si' }),
    run('f', { startedAt: local(2026, 9, 30), material: 'Résist' }),
  ];
  assert.deepEqual(ids(filterRuns(runs, { material: 'SIO2' }, L)), ['a', 'b', 'c']);
  assert.deepEqual(ids(filterRuns(runs, { material: 'SiO₂' }, L)), ['a', 'b', 'c']);
  assert.deepEqual(ids(filterRuns(runs, { material: '  SiO2   (thermal) ' }, L)), ['d']);
  assert.deepEqual(ids(filterRuns(runs, { material: 'Si' }, L)), ['e']);
  assert.deepEqual(ids(filterRuns(runs, { material: 'RÉSIST' }, L)), ['f']);
  assert.deepEqual(ids(filterRuns(runs, { material: 'Résist' }, L)), ['f'], 'decomposed é');
});

test('status filter', () => {
  const runs = [
    run('d', { startedAt: local(2026, 10, 3), status: 'draft' }),
    run('o', { startedAt: local(2026, 10, 2), status: 'open' }),
    run('c', { startedAt: local(2026, 10, 1), status: 'complete' }),
  ];
  assert.deepEqual(ids(filterRuns(runs, { status: 'draft' }, L)), ['d']);
  assert.deepEqual(ids(filterRuns(runs, { status: 'open' }, L)), ['o']);
  assert.deepEqual(ids(filterRuns(runs, { status: 'complete' }, L)), ['c']);
  assert.deepEqual(ids(filterRuns(runs, { status: 'all' }, L)), ['d', 'o', 'c']);
});

test('date range: local days, both ends inclusive, the whole "to" day', () => {
  const runs = [
    run('before', { startedAt: local(2026, 10, 5, 23, 59, 59, 999) }),
    run('start', { startedAt: local(2026, 10, 6, 0, 0, 0, 0) }),
    run('mid', { startedAt: local(2026, 10, 8, 12) }),
    run('end', { startedAt: local(2026, 10, 10, 23, 59, 59, 999) }),
    run('after', { startedAt: local(2026, 10, 11, 0, 0, 0, 0) }),
  ];
  assert.deepEqual(ids(filterRuns(runs, { from: '2026-10-06', to: '2026-10-10' }, L)), ['end', 'mid', 'start']);
  assert.deepEqual(ids(filterRuns(runs, { from: '2026-10-06' }, L)), ['after', 'end', 'mid', 'start']);
  assert.deepEqual(ids(filterRuns(runs, { to: '2026-10-10' }, L)), ['end', 'mid', 'start', 'before']);
  assert.deepEqual(ids(filterRuns(runs, { from: '2026-10-08', to: '2026-10-08' }, L)), ['mid'], 'one day');
  assert.deepEqual(ids(filterRuns(runs, { from: '2026-10-10', to: '2026-10-06' }, L)), [], 'reversed range');
  // Unparseable bounds are ignored rather than hiding everything.
  assert.equal(filterRuns(runs, { from: 'soon', to: '2026-02-30' }, L).length, 5);
  // A run with no valid start date cannot be placed in a range.
  const undated = [run('x', { startedAt: 'unknown' }), ...runs];
  assert.deepEqual(ids(filterRuns(undated, {}, L)).at(-1), 'x');
  assert.ok(!ids(filterRuns(undated, { from: '2000-01-01' }, L)).includes('x'));
});

test('date range: "to" covers the whole local day on DST change days', () => {
  // US DST starts on 2026-03-08 and ends on 2026-11-01 (23- and 25-hour days
  // there); in other zones these are ordinary days and the test still holds.
  const runs = [
    run('spring-late', { startedAt: local(2026, 3, 8, 23, 30) }),
    run('spring-next', { startedAt: local(2026, 3, 9, 0, 0) }),
    run('fall-late', { startedAt: local(2026, 11, 1, 23, 30) }),
    run('fall-next', { startedAt: local(2026, 11, 2, 0, 0) }),
  ];
  assert.deepEqual(ids(filterRuns(runs, { from: '2026-03-08', to: '2026-03-08' }, L)), ['spring-late']);
  assert.deepEqual(ids(filterRuns(runs, { from: '2026-11-01', to: '2026-11-01' }, L)), ['fall-late']);
});

test('keywords: every word must appear, in any of notes, recipe or tags, any order and case', () => {
  const runs = [
    run('a', { startedAt: local(2026, 10, 3), notes: 'Chamber was seasoned first', recipe: 'OX-1', tags: ['trench'] }),
    run('b', { startedAt: local(2026, 10, 2), notes: 'Trench etch, slow', recipe: 'OX-2' }),
    run('c', { startedAt: local(2026, 10, 1), recipe: 'Nitride strip', tags: ['seasoning', 'chamber'] }),
  ];
  assert.deepEqual(ids(filterRuns(runs, { q: 'chamber season' }, L)), ['a', 'c']);
  assert.deepEqual(ids(filterRuns(runs, { q: 'season chamber' }, L)), ['a', 'c']);
  assert.deepEqual(ids(filterRuns(runs, { q: 'TRENCH ox-1' }, L)), ['a'], 'tag + recipe');
  assert.deepEqual(ids(filterRuns(runs, { q: 'trench' }, L)), ['a', 'b']);
  assert.deepEqual(ids(filterRuns(runs, { q: '  slow \t  trench ' }, L)), ['b']);
  assert.deepEqual(ids(filterRuns(runs, { q: 'strip' }, L)), ['c']);
  assert.deepEqual(ids(filterRuns(runs, { q: 'chamber nitride trench' }, L)), [], 'no run has all three');
  assert.deepEqual(ids(filterRuns(runs, { q: 'etch,' }, L)), ['b'], 'punctuation is part of the word');
});

test('keywords and materials with non-ASCII text: SiO₂, Résist, Ω', () => {
  const runs = [
    run('a', { startedAt: local(2026, 10, 4), notes: 'Film is SiO₂ on Si' }),
    run('b', { startedAt: local(2026, 10, 3), tags: ['Résist', 'Ω/sq check'] }), // OHM SIGN
    run('c', { startedAt: local(2026, 10, 2), notes: 'Résist strip' }), // decomposed é
    run('d', { startedAt: local(2026, 10, 1), notes: 'plain ASCII' }),
  ];
  assert.deepEqual(ids(filterRuns(runs, { q: 'sio2' }, L)), ['a']);
  assert.deepEqual(ids(filterRuns(runs, { q: 'SiO₂ si' }, L)), ['a']);
  assert.deepEqual(ids(filterRuns(runs, { q: 'résist' }, L)), ['b', 'c']);
  assert.deepEqual(ids(filterRuns(runs, { q: 'RÉSIST' }, L)), ['b', 'c']);
  assert.deepEqual(ids(filterRuns(runs, { q: 'Ω/sq' }, L)), ['b'], 'Greek omega finds the ohm sign');
  assert.deepEqual(ids(filterRuns(runs, { q: 'résist strip' }, L)), ['c']);
});

test('filters combine with AND', () => {
  const runs = [
    run('hit', { startedAt: local(2026, 10, 7), status: 'open', material: 'Au', notes: 'lift-off test' }),
    run('wrong-status', { startedAt: local(2026, 10, 7), material: 'Au', notes: 'lift-off test' }),
    run('wrong-day', { startedAt: local(2026, 10, 12), status: 'open', material: 'Au', notes: 'lift-off test' }),
    run('wrong-tool', { startedAt: local(2026, 10, 7), toolId: 'ebeam', status: 'open', material: 'Au', notes: 'lift-off test' }),
  ];
  const f = { toolId: 'icp', status: 'open', material: 'au', from: '2026-10-01', to: '2026-10-10', q: 'LIFT-OFF' };
  assert.deepEqual(ids(filterRuns(runs, f, L)), ['hit']);
});

test('filterRuns never mutates its input and returns a new array', () => {
  const runs = [run('a', { startedAt: local(2026, 10, 1), tags: ['x'] }), run('b', { startedAt: local(2026, 10, 3) })];
  for (const r of runs) {
    Object.freeze(r.tags);
    Object.freeze(r);
  }
  Object.freeze(runs);
  const before = JSON.stringify(runs);
  const filters = Object.freeze({ material: ' SiO2 ', q: ' X ' });
  const all = filterRuns(runs, {}, L);
  assert.notEqual(all, runs);
  assert.deepEqual(ids(all), ['b', 'a']);
  assert.deepEqual(ids(filterRuns(runs, filters, L)), ['a']);
  assert.equal(JSON.stringify(runs), before);
  assert.deepEqual(filters, { material: ' SiO2 ', q: ' X ' });
});

test('normalizeFilters and hasFilters', () => {
  assert.deepEqual(normalizeFilters(null), { ...EMPTY_FILTERS });
  assert.deepEqual(normalizeFilters(/** @type {any} */ ({ toolId: ' t1 ', status: 'all', q: 5, extra: 'x' })),
    { ...EMPTY_FILTERS, toolId: 't1' });
  assert.equal(hasFilters({}), false);
  assert.equal(hasFilters({ q: '   ', status: 'all' }), false);
  assert.equal(hasFilters({ material: 'Si' }), true);
  assert.equal(hasFilters({ to: '2026-10-10' }), true);
});

test('distinctMaterials: one entry per normalised name (latest spelling), sorted, no blanks or deleted runs', () => {
  const runs = [
    run('a', { material: 'SiO2', startedAt: local(2026, 10, 1) }),
    run('b', { material: 'sio2', startedAt: local(2026, 10, 5) }),
    run('g', { material: 'SiO₂', startedAt: local(2026, 9, 1) }),
    run('c', { material: 'Au' }),
    run('d', { material: '   ' }),
    run('e', { material: 'Cr', deleted: true }),
    run('f', { material: 'Résist ' }),
    run('h', { material: '' }),
  ];
  assert.deepEqual(distinctMaterials(runs), ['Au', 'Résist', 'sio2']);
  assert.deepEqual(distinctMaterials([]), []);
});

test('primarySeries: complete, non-deleted runs of the template with a numeric value, oldest first', () => {
  const extra = [
    { ...runA, id: 'draft', status: 'draft' },
    { ...runA, id: 'open', status: 'open' },
    { ...runA, id: 'deleted', deleted: true },
    { ...runA, id: 'other-template', templateId: 'tpl-other' },
    { ...runA, id: 'text-value', results: { etchRate: '85' } },
    { ...runA, id: 'nan', results: { etchRate: NaN } },
    { ...runA, id: 'infinite', results: { etchRate: Infinity } },
    { ...runA, id: 'missing', results: { uniformity: 2 } },
    { ...runA, id: 'no-date', startedAt: 'unknown' },
  ];
  const pts = primarySeries([runB, ...extra, runA, runC], template);
  assert.deepEqual(pts, [
    { x: Date.parse(runC.startedAt), y: 71, id: 'C' },
    { x: Date.parse(runA.startedAt), y: 85, id: 'A' },
    { x: Date.parse(runB.startedAt), y: 94, id: 'B' },
  ]);
  assert.deepEqual(primarySeries([runA], { ...template, primaryOutput: null }), []);
  assert.deepEqual(primarySeries([runA], null), []);
  assert.deepEqual(primarySeries([], template), []);
});

test('History filters by project; the inputs worth plotting and their points', () => {
  const a = run('a', { projects: [{ projectId: 'p1', waferIds: [], stepId: null }] });
  const b = run('b', { projects: [{ projectId: 'p2', waferIds: [], stepId: null }, { projectId: 'p1', waferIds: ['w'], stepId: null }] });
  const c = run('c');
  assert.deepEqual(filterRuns([a, b, c], { projectId: 'p1' }).map((r) => r.id).sort(), ['a', 'b']);
  assert.deepEqual(filterRuns([a, b, c], { projectId: 'p3' }), []);
  assert.equal(normalizeFilters({}).projectId, '');
  assert.ok(hasFilters({ projectId: 'p1' }));
  const varied = variedInputs(template, [runA, runB, runC]);
  assert.deepEqual(varied.map((f) => f.key), ['icpPower', 'pressure', 'chf3'], 'o2 is 0 in every run');
  assert.deepEqual(variedInputs(template, [runA, { ...runB, status: 'open' }, { ...runC, status: 'draft' }]), [],
    'inputs that vary only in open or draft runs are not offered');
  assert.deepEqual(variedInputs(template, [runA, { ...runB, deleted: true }]), [], 'nor in deleted runs');
  const pts = scatterSeries([runA, runB, runC, { ...runA, id: 'x', deleted: true }], 'icpPower', 'etchRate');
  assert.deepEqual(pts.map((p) => [p.x, p.y]), [[400, 85], [450, 94], [400, 71]]);
});
