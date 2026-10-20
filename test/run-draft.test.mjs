// @ts-check
// Run form helpers: blank drafts, prefill from the last run, required fields, saving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankDraft, prefillFrom, clearPrefill, missingRequired, hasAnyOutput, parseTags, compactValues, draftToRun,
  timerField, elapsedSeconds, isSet, fieldsWithRole,
} from '../app/js/core/run-draft.js';
import { template, runA } from './fixtures.mjs';

const now = '2026-10-20T12:00:00.000Z';

test('blank draft starts empty with the given ids', () => {
  const d = blankDraft({ runId: 'r1', toolId: 't', templateId: 'p', now });
  assert.equal(d.runId, 'r1');
  assert.deepEqual(d.params, {});
  assert.equal(d.startedAt, now);
  assert.equal(d.touched, false);
  assert.equal(d.copiedFrom, null);
});

test('prefill copies inputs, context and sample details but never outputs, notes or photos', () => {
  const last = {
    ...runA, params: { ...runA.params, chuckTemp: 20, stray: 5 }, notes: 'old note', photoIds: ['p1'], recipe: 'OX-1', tags: ['a', 'b'],
    targetThickness: 500, maskMaterial: 'Cr',
  };
  const d = prefillFrom(blankDraft({ runId: 'r1', toolId: 't', templateId: 'p', now }), last, template);
  assert.deepEqual(d.params, { icpPower: 400, pressure: 10, chf3: 50, o2: 0, chuckTemp: 20 });
  assert.deepEqual(d.results, {});
  assert.equal(d.notes, '');
  assert.deepEqual(d.photoIds, []);
  assert.equal(d.material, 'SiO2');
  assert.equal(d.recipe, 'OX-1');
  assert.equal(d.tags, 'a, b');
  assert.equal(d.targetThickness, 500);
  assert.deepEqual(d.copiedFrom, { runId: 'A', startedAt: runA.startedAt });
  const cleared = clearPrefill(d);
  assert.deepEqual(cleared.params, {});
  assert.equal(cleared.material, '');
  assert.equal(cleared.copiedFrom, null);
});

test('required fields, outputs present and set values', () => {
  const t = { ...template, fields: template.fields.map((f) => (f.key === 'icpPower' || f.key === 'etchRate' ? { ...f, required: true } : f)) };
  assert.deepEqual(missingRequired(/** @type {any} */ (t), {}, {}), ['ICP power', 'Etch rate']);
  assert.deepEqual(missingRequired(/** @type {any} */ (t), { icpPower: 0 }, { etchRate: 5 }), []);
  assert.deepEqual(missingRequired(null, {}), []);
  assert.equal(hasAnyOutput(template, { etchRate: 85 }), true);
  assert.equal(hasAnyOutput(template, { etchRate: null, icpPower: 3 }), false);
  assert.equal(isSet(0), true);
  assert.equal(isSet(false), true);
  assert.equal(isSet('  '), false);
  assert.equal(isSet(NaN), false);
  assert.equal(isSet(null), false);
  assert.deepEqual(fieldsWithRole(template, ['output']).map((f) => f.key), ['etchRate', 'uniformity']);
});

test('tags and compact values', () => {
  assert.deepEqual(parseTags('a, b,, c ,a'), ['a', 'b', 'c']);
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(compactValues({ a: 1, b: '', c: null, d: ' x ', e: false, f: NaN }), { a: 1, d: 'x', e: false });
});

test('draftToRun builds run fields; completing sets endedAt', () => {
  const d = {
    ...blankDraft({ runId: 'r1', toolId: 't', templateId: 'p', now }),
    params: { icpPower: 400, rfPower: null }, results: { etchRate: 85 }, material: ' SiO2 ', tags: 'x, y', photoIds: ['p1'],
  };
  const open = draftToRun(d, 'open');
  assert.equal(open.id, 'r1');
  assert.equal(open.status, 'open');
  assert.deepEqual(open.params, { icpPower: 400 });
  assert.deepEqual(open.results, { etchRate: 85 });
  assert.equal(open.material, 'SiO2');
  assert.deepEqual(open.tags, ['x', 'y']);
  assert.equal(open.endedAt, null);
  assert.deepEqual(open.derivedKeys, []);
  const done = draftToRun(d, 'complete', '2026-10-20T13:00:00.000Z');
  assert.equal(done.endedAt, '2026-10-20T13:00:00.000Z');
});

test('timer fills the template time field and counts whole seconds', () => {
  assert.equal(timerField(template), 'time');
  assert.equal(timerField(null), null);
  const noRate = { ...template, derived: [], fields: template.fields.filter((f) => f.key !== 'time') };
  assert.equal(timerField(/** @type {any} */ (noRate)), null);
  assert.equal(elapsedSeconds('2026-10-20T12:00:00.000Z', Date.parse('2026-10-20T12:05:00.400Z')), 300);
  assert.equal(elapsedSeconds(null, Date.now()), 0);
  assert.equal(elapsedSeconds('2026-10-20T12:00:00.000Z', Date.parse('2026-10-20T11:00:00.000Z')), 0);
});
