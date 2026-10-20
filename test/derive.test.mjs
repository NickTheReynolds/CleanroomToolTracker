// @ts-check
// Derived values (spec Section 8 and Section 11 Case 6) and their edge cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDerived, applyDerived, pointStats, pickMeasurement, toCanonical, unitsFor, DERIVED_FUNCTIONS,
} from '../app/js/core/derive.js';
import { template, derivedRun, measurement } from './fixtures.mjs';

const close = (/** @type {number} */ a, /** @type {number} */ b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

/** A template with every derived function. */
const fullTemplate = {
  ...template,
  fields: [
    ...template.fields,
    { key: 'depRate', label: 'Dep rate', type: 'number', unit: 'nm/min', role: 'output' },
    { key: 'removed', label: 'Removed', type: 'number', unit: 'nm', role: 'output' },
    { key: 'deposited', label: 'Deposited', type: 'number', unit: 'nm', role: 'output' },
    { key: 'uStd', label: 'Uniformity std', type: 'number', unit: '%', role: 'output' },
    { key: 'sel', label: 'Selectivity', type: 'number', unit: 'ratio', role: 'output' },
  ],
  derived: [
    ...template.derived,
    { output: 'depRate', fn: 'depRate', timeField: 'time' },
    { output: 'removed', fn: 'removed' },
    { output: 'deposited', fn: 'deposited' },
    { output: 'uStd', fn: 'uniformityStd' },
    { output: 'sel', fn: 'selectivity' },
  ],
};

test('Case 6: pre 1000 nm, post 575 nm and 300 s give 85 nm/min', () => {
  const ms = [measurement('m1', 'pre', [1000]), measurement('m2', 'post', [575])];
  const { values, missing } = computeDerived(derivedRun, template, ms);
  close(values.etchRate, 85);
  assert.equal(missing.etchRate, undefined);
});

test('Case 6: points 412, 398 and 405 nm give mean 405 nm and uniformity 1.728%', () => {
  const st = pointStats([412, 398, 405].map((value, i) => ({ site: String(i), value })));
  assert.ok(st);
  close(st.mean, 405);
  assert.ok(Math.abs(/** @type {number} */ (st.uniformity) - 1.728) <= 0.001, String(st.uniformity));
  assert.equal(st.n, 3);
  assert.equal(st.min, 398);
  assert.equal(st.max, 412);
  assert.equal(st.range, 14);
  close(/** @type {number} */ (st.uniformityStd), (7 / 405) * 100);
  const ms = [measurement('m1', 'pre', [1000]), measurement('m2', 'post', [412, 398, 405])];
  const { values } = computeDerived(derivedRun, template, ms);
  close(values.uniformity, (14 / 810) * 100);
});

test('every built-in function, with a mask for selectivity', () => {
  const run = { ...derivedRun, maskMaterial: 'Positive resist' };
  const ms = [
    measurement('a', 'pre', [1000]), measurement('b', 'post', [575]),
    measurement('c', 'pre', [1500], 'Positive resist'), measurement('d', 'post', [1415], 'Positive resist'),
  ];
  const { values, missing } = computeDerived(run, fullTemplate, ms);
  assert.deepEqual(missing, { uStd: 'needs 2 or more points' });
  close(values.etchRate, 85);
  close(values.depRate, -85);
  close(values.removed, 425);
  close(values.deposited, -425);
  close(values.sel, 425 / 85);
  assert.deepEqual([...DERIVED_FUNCTIONS].sort(), ['depRate', 'deposited', 'etchRate', 'removed', 'selectivity', 'uniformity', 'uniformityStd']);
});

test('a missing input makes the output absent with a reason, never 0', () => {
  const onlyPost = [measurement('b', 'post', [575])];
  const r = computeDerived(derivedRun, fullTemplate, onlyPost);
  assert.equal(r.values.etchRate, undefined);
  assert.equal(r.missing.etchRate, 'needs pre measurement');
  assert.equal(r.missing.removed, 'needs pre measurement');
  assert.equal(r.missing.sel, 'needs mask material');
  // depRate and deposited take pre = 0 when there is no pre measurement.
  close(r.values.depRate, 115);
  close(r.values.deposited, 575);
  const none = computeDerived(derivedRun, fullTemplate, []);
  assert.equal(none.missing.etchRate, 'needs pre and post measurements');
  assert.equal(none.missing.depRate, 'needs post measurement');
  assert.equal(none.missing.uniformity, 'needs post measurement');
  for (const v of Object.values({ ...r.values, ...none.values })) assert.ok(Number.isFinite(v));
});

test('time of zero, negative or missing is rejected with a clear message', () => {
  const ms = [measurement('a', 'pre', [1000]), measurement('b', 'post', [575])];
  for (const [time, msg] of /** @type {[any, string][]} */ ([[0, 'time must be greater than 0'], [-5, 'time must be greater than 0'],
    [undefined, 'needs time'], ['abc', 'time is not a number']])) {
    const run = { ...derivedRun, params: { ...derivedRun.params, time } };
    const r = computeDerived(run, template, ms);
    assert.equal(r.values.etchRate, undefined);
    assert.equal(r.missing.etchRate, msg);
  }
});

test('empty point lists and zero means are rejected, not NaN', () => {
  const empty = { ...measurement('b', 'post', []) };
  const r = computeDerived(derivedRun, template, [measurement('a', 'pre', [1000]), empty]);
  assert.equal(r.missing.etchRate, 'post measurement has no points');
  assert.equal(r.missing.uniformity, 'post measurement has no points');
  assert.equal(pointStats([]), null);
  const zeros = pointStats([{ site: '1', value: 0 }, { site: '2', value: 0 }]);
  assert.equal(zeros?.uniformity, null);
  const zr = computeDerived(derivedRun, template, [measurement('z', 'post', [0, 0])]);
  assert.equal(zr.missing.uniformity, 'mean is 0');
});

test('mask that did not thin gives no selectivity', () => {
  const run = { ...derivedRun, maskMaterial: 'Cr' };
  const ms = [measurement('a', 'pre', [1000]), measurement('b', 'post', [575]),
    measurement('c', 'pre', [50], 'Cr'), measurement('d', 'post', [50], 'Cr')];
  const r = computeDerived(run, fullTemplate, ms);
  assert.equal(r.values.sel, undefined);
  assert.match(r.missing.sel, /mask was not etched/);
  const noMaskPre = computeDerived(run, fullTemplate, ms.slice(0, 2));
  assert.equal(noMaskPre.missing.sel, 'needs pre and post measurements of Cr');
});

test('pickMeasurement: latest wins, blank material is the run material, deleted ignored, NFKC match', () => {
  const older = { ...measurement('o', 'post', [600]), takenAt: '2026-10-19T12:00:00Z' };
  const newer = { ...measurement('n', 'post', [575]), takenAt: '2026-10-19T14:00:00Z' };
  const deleted = { ...measurement('x', 'post', [1]), takenAt: '2026-10-19T15:00:00Z', deleted: true };
  const q = { phase: 'post', kind: 'thickness', material: 'SiO2', runMaterial: 'SiO2' };
  assert.equal(pickMeasurement([older, newer, deleted], q)?.id, 'n');
  const blank = { ...measurement('b', 'post', [1]), material: '' };
  assert.equal(pickMeasurement([blank], q)?.id, 'b');
  const unicode = { ...measurement('u', 'post', [1]), material: 'SiO₂' };
  assert.equal(pickMeasurement([unicode], q)?.id, 'u');
  assert.equal(pickMeasurement([unicode], { ...q, material: 'Résist', runMaterial: 'Résist' }), null);
  const step = { ...measurement('s', 'post', [1]), kind: 'stepHeight' };
  assert.equal(pickMeasurement([step], q), null);
});

test('uniformity can use the pre measurement and another kind', () => {
  const t = { ...template, derived: [{ output: 'uniformity', fn: 'uniformity', phase: 'pre', kind: 'stepHeight' }] };
  const pre = { ...measurement('p', 'pre', [100, 110]), kind: 'stepHeight' };
  const r = computeDerived(derivedRun, /** @type {any} */ (t), [pre]);
  close(r.values.uniformity, (10 / (2 * 105)) * 100);
});

test('applyDerived stores values with derivedKeys, keeps manual overrides, drops stale derived values', () => {
  const ms = [measurement('a', 'pre', [1000]), measurement('b', 'post', [575])];
  const first = applyDerived(derivedRun, template, ms);
  assert.deepEqual(first.derivedKeys, ['etchRate', 'uniformity']);
  close(/** @type {number} */ (first.results.etchRate), 85);
  // A manual value (in results, not in derivedKeys) wins.
  const manual = applyDerived({ ...derivedRun, results: { etchRate: 90 }, derivedKeys: [] }, template, ms);
  assert.equal(manual.results.etchRate, 90);
  assert.ok(!manual.derivedKeys.includes('etchRate'));
  close(manual.values.etchRate, 85);
  // A derived value that can no longer be computed is removed, never left at 0.
  const stale = applyDerived({ ...derivedRun, results: first.results, derivedKeys: first.derivedKeys }, template, []);
  assert.equal(stale.results.etchRate, undefined);
  assert.deepEqual(stale.derivedKeys, []);
  // Values for keys the template no longer derives are kept.
  const other = applyDerived({ ...derivedRun, results: { gone: 3 }, derivedKeys: ['gone'] }, template, ms);
  assert.equal(other.results.gone, 3);
  // No template: nothing changes.
  assert.deepEqual(applyDerived(derivedRun, null, ms).results, derivedRun.results);
});

test('unit table converts Å and µm to nm on entry and nothing else', () => {
  assert.deepEqual(toCanonical('thickness', 'Å', 5000), { value: 500, unit: 'nm' });
  assert.deepEqual(toCanonical('thickness', 'µm', 1.2), { value: 1200, unit: 'nm' });
  assert.deepEqual(toCanonical('stepHeight', 'nm', 42), { value: 42, unit: 'nm' });
  assert.deepEqual(toCanonical('cd', 'nm', 500), { value: 0.5, unit: 'µm' });
  assert.deepEqual(toCanonical('other', 'mV', 3), { value: 3, unit: 'mV' });
  assert.throws(() => toCanonical('thickness', 'mm', 1));
  assert.deepEqual(unitsFor('thickness'), ['nm', 'Å', 'µm']);
  assert.equal(unitsFor('other'), null);
});
