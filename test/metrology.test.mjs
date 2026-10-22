// @ts-check
// Measurements: the metrology tool a new measurement most likely uses, and
// how pasted values fill the sites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultMetrologyTool, fillPoints, KIND_TOOL_TYPES } from '../app/js/core/metrology.js';
import { parseNumberList } from '../app/js/core/format.js';
import { MEASUREMENT_KINDS } from '../app/js/core/vocab.js';

const TYPES = new Map([['nano', 'reflectometer'], ['woollam', 'ellipsometer'], ['dektak', 'profilometer'], ['flexus', 'stress'], ['fpp', 'four-point-probe']]);
const tools = /** @type {any[]} */ ([...TYPES.keys()].map((id) => ({ id, name: id })));
const typeOf = (/** @type {string} */ id) => TYPES.get(id);
/** @param {string} kind @param {string | null} tool @param {string} at */
const m = (kind, tool, at) => /** @type {any} */ ({ kind, metrologyToolId: tool, takenAt: at });

test('every measurement kind but "other" names the tool types that measure it', () => {
  for (const k of MEASUREMENT_KINDS) if (k !== 'other') assert.ok(KIND_TOOL_TYPES[k]?.length, k);
});

test('a new measurement takes the tool last used for its kind, else one that measures it', () => {
  const ms = [m('thickness', 'woollam', '2026-10-01T10:00:00Z'), m('thickness', 'nano', '2026-10-03T10:00:00Z'), m('stress', 'dektak', '2026-10-05T10:00:00Z')];
  assert.equal(defaultMetrologyTool('thickness', ms, tools, typeOf), 'nano', 'the latest of that kind');
  assert.equal(defaultMetrologyTool('stress', ms, tools, typeOf), 'dektak', 'what the person used, even if unusual');
  assert.equal(defaultMetrologyTool('sheetResistance', ms, tools, typeOf), 'fpp', 'a tool of the right type');
  assert.equal(defaultMetrologyTool('refractiveIndex', [], tools, typeOf), 'woollam', 'the best type first');
  assert.equal(defaultMetrologyTool('thickness', [], tools, typeOf, new Set(['dektak'])), 'nano', 'type order wins over my tools');
  const twoReflectometers = [...tools, { id: 'f54', name: 'f54' }];
  const types2 = (/** @type {string} */ id) => (id === 'f54' ? 'reflectometer' : typeOf(id));
  assert.equal(defaultMetrologyTool('thickness', [], twoReflectometers, types2, new Set(['f54'])), 'f54', 'my tool among those of the type');
  assert.equal(defaultMetrologyTool('cd', ms, tools, typeOf), 'dektak', 'no tool of the type: the last one used');
  assert.equal(defaultMetrologyTool('cd', [], tools, typeOf), null);
  assert.equal(defaultMetrologyTool('thickness', [m('thickness', 'gone', '2026-10-09T10:00:00Z')], tools, typeOf), 'nano',
    'a tool no longer offered is skipped');
});

test('pasted values fill the sites in order, by name, or add sites', () => {
  const five = ['C', 'N', 'E', 'S', 'W'].map((site) => ({ site, value: null }));
  const inOrder = fillPoints(five, parseNumberList('1002.4\n998.1\n1004'));
  assert.deepEqual(inOrder.points.map((p) => p.value), [1002.4, 998.1, 1004, null, null]);
  assert.equal(inOrder.added, 0);
  const named = fillPoints(five, parseNumberList('w = 990; c = 1000'));
  assert.equal(named.byName, true);
  assert.deepEqual(named.points.map((p) => p.value), [1000, null, null, null, 990]);
  const more = fillPoints(five.slice(0, 2), parseNumberList('1 2 3'));
  assert.deepEqual(more.points, [{ site: 'C', value: 1 }, { site: 'N', value: 2 }, { site: '3', value: 3 }]);
  assert.equal(more.added, 1);
  const otherNames = fillPoints(five.slice(0, 1), parseNumberList('top = 5; bottom = 6'));
  assert.equal(otherNames.byName, false, 'names that are not sites here fill in order');
  assert.deepEqual(otherNames.points, [{ site: 'C', value: 5 }, { site: 'bottom', value: 6 }]);
});
