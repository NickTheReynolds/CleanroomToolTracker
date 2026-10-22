// @ts-check
// Runs with several steps: the main step's values stay in params, the others
// keep their own; adding, removing, renaming and swapping the main step; a
// multi-step recipe fills every step; copying and tidying for storage; and
// the text exports use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mainIndex, stepValues, withStepValues, addStep, removeStep, setMain, renameStep, recipeSteps, copySteps, tidySteps, stepsText, recipeForForm,
} from '../app/js/core/run-steps.js';

const template = /** @type {any} */ ({
  id: 't', name: 'ICP etch', processType: 'etch', primaryOutput: 'etchRate', derived: [],
  fields: [
    { key: 'pressure', label: 'Pressure', type: 'number', unit: 'mTorr', role: 'input' },
    { key: 'icpPower', label: 'ICP power', type: 'number', unit: 'W', role: 'input' },
    { key: 'cl2', label: 'Cl2', type: 'number', unit: 'sccm', role: 'input', chemistry: true },
    { key: 'hbr', label: 'HBr', type: 'number', unit: 'sccm', role: 'input', chemistry: true },
    { key: 'time', label: 'Time', type: 'duration', unit: 's', role: 'input' },
    { key: 'chuckTemp', label: 'Chuck temp', type: 'number', unit: '°C', role: 'context' },
    { key: 'etchRate', label: 'Etch rate', type: 'number', unit: 'nm/min', role: 'output' },
  ],
});

test('a one-step run has no steps; adding one makes the current values the main step', () => {
  assert.equal(mainIndex([]), -1);
  const steps = addStep([], 'Ash');
  assert.deepEqual(steps, [{ name: 'Main step', main: true }, { name: 'Ash', params: {} }]);
  assert.equal(mainIndex(steps), 0);
  assert.deepEqual(stepValues(steps, { pressure: 10 }, 0), { pressure: 10 }, 'the main step reads params');
  assert.deepEqual(stepValues(steps, { pressure: 10 }, 1), {});
  assert.deepEqual(addStep(steps, 'Cool').map((s) => s.name), ['Main step', 'Ash', 'Cool']);
});

test('values go to the step being edited; the main step writes params', () => {
  const steps = addStep([], 'Ash');
  const a = withStepValues(steps, { pressure: 10 }, 1, { pressure: 30 });
  assert.deepEqual(a.params, { pressure: 10 });
  assert.deepEqual(a.steps[1], { name: 'Ash', params: { pressure: 30 } });
  const b = withStepValues(a.steps, a.params, 0, { pressure: 12 });
  assert.deepEqual(b.params, { pressure: 12 });
  assert.deepEqual(b.steps, a.steps);
});

test('making another step the main one swaps the values', () => {
  const steps = [{ name: 'BT', params: { pressure: 5 } }, { name: 'Main', main: true }, { name: 'Ash', params: { pressure: 40 } }];
  const r = setMain(/** @type {any} */ (steps), { pressure: 10 }, 2);
  assert.deepEqual(r.params, { pressure: 40 });
  assert.deepEqual(r.steps, [{ name: 'BT', params: { pressure: 5 } }, { name: 'Main', params: { pressure: 10 } }, { name: 'Ash', main: true }]);
  assert.deepEqual(setMain(r.steps, r.params, 2), { steps: r.steps, params: r.params }, 'already main: no change');
});

test('removing steps; the main step stays; renaming', () => {
  const steps = /** @type {any} */ ([{ name: 'BT', params: {} }, { name: 'Main', main: true }, { name: 'Ash', params: {} }]);
  assert.deepEqual(removeStep(steps, 1), steps, 'the main step cannot be removed');
  assert.deepEqual(removeStep(steps, 0).map((/** @type {any} */ s) => s.name), ['Main', 'Ash']);
  assert.deepEqual(removeStep(removeStep(steps, 0), 1), [], 'only the main step left: a one-step run again');
  assert.equal(renameStep(steps, 2, 'O2 ash')[2].name, 'O2 ash');
});

test('a multi-step recipe fills every step, with the chosen one as main', () => {
  const recipe = /** @type {any} */ ({
    id: 'x', tool: 't', name: 'LNF_Poly', main: 1, films: ['Si'], mask: [], gases: ['Cl2', 'HBr'], results: [], expect: {}, notes: '', src: '', url: '', date: '',
    about: '',
    steps: [
      { name: 'Breakthrough', values: [{ l: 'Pressure', v: 5, k: 'pressure' }, { l: 'Cl2', v: 100, k: 'cl2' }, { l: 'Time', v: 10, k: 'time' }] },
      { name: 'Main etch', values: [{ l: 'Pressure', v: 15, k: 'pressure' }, { l: 'HBr', v: 200, k: 'hbr' }] },
    ],
  });
  const r = recipeSteps(recipe, template, 1);
  assert.deepEqual(r.mainFill.values, { pressure: 15, hbr: 200, cl2: null });
  assert.deepEqual(r.steps, [{ name: 'Breakthrough', params: { pressure: 5, cl2: 100, time: 10 } }, { name: 'Main etch', main: true }]);
  const one = recipeSteps({ ...recipe, steps: [recipe.steps[1]], main: 0 }, template, 0);
  assert.deepEqual(one.steps, []);
});

test('copying keeps known inputs and conditions only; tidying keeps one main step', () => {
  const steps = /** @type {any} */ ([{ name: 'BT', params: { pressure: 5, chuckTemp: 20, gone: 1, cl2: null } }, { name: 'Main', main: true, params: { x: 1 } }]);
  assert.deepEqual(copySteps(steps, template), [{ name: 'BT', params: { pressure: 5, chuckTemp: 20 } }, { name: 'Main', main: true }]);
  assert.deepEqual(tidySteps([{ name: '  ', params: { a: 1, b: '' } }, { name: 'M', main: true }, { name: 'N', main: true, params: {} }]),
    [{ name: 'Step 1', params: { a: 1 } }, { name: 'M', main: true }, { name: 'N', params: {} }]);
  assert.deepEqual(tidySteps([{ name: 'A', params: { a: 1 } }, { name: 'B', params: {} }]),
    [{ name: 'A', main: true }, { name: 'B', params: {} }], 'without a main step the first becomes main');
  assert.deepEqual(tidySteps([{ name: 'M', main: true }]), [], 'one step is a one-step run');
});

test('steps as text for exports', () => {
  const run = { steps: [{ name: 'BT', params: { pressure: 5, time: 10 } }, { name: 'Main', main: true }, { name: 'Ash', params: {} }] };
  assert.equal(stepsText(/** @type {any} */ (run), template), 'BT: Pressure 5 mTorr, Time 0:10; Main (main step); Ash');
  assert.equal(stepsText({ steps: [] }, template), '');
  const edited = { steps: [{ name: ' ', params: { pressure: null, time: 10 } }, { name: 'Main', main: true }] };
  assert.equal(stepsText(/** @type {any} */ (edited), template), 'Step 1: Time 0:10; Main (main step)', 'cleared values and blank names');
});

test('using a recipe on a form: values, steps, and the material only when unambiguous and empty', () => {
  const recipe = /** @type {any} */ ({
    id: 'x', tool: 't', name: 'mnf_oxide1', main: 0, films: ['SiO2'], mask: [], gases: ['Cl2'], results: [], expect: {}, notes: '',
    src: '', url: '', date: '', about: '', steps: [{ name: '', values: [{ l: 'Pressure', v: 10, k: 'pressure' }, { l: 'Cl2', v: 50, k: 'cl2' }] }],
  });
  const materials = ['Si', 'SiO2 (thermal)', 'SiO2 (PECVD)'];
  const kept = recipeForForm({ params: { pressure: 5, hbr: 20, icpPower: 400 }, material: 'SiO2 (thermal)', steps: [] }, recipe, template, 0, materials);
  assert.deepEqual(kept.patch, { recipe: 'mnf_oxide1', params: { pressure: 10, cl2: 50, icpPower: 400 }, material: 'SiO2 (thermal)', steps: [] });
  assert.equal(kept.material, null, 'a material already chosen is never replaced');
  const blank = recipeForForm({ params: {}, material: '' }, recipe, template, 0, materials);
  assert.equal(blank.patch.material, '', '"SiO2" is ambiguous: no material is set');
  const si = recipeForForm({ params: {}, material: '' }, { ...recipe, films: ['Si'] }, template, 0, materials);
  assert.equal(si.material, 'Si');
  const two = recipeForForm({ params: {}, material: '', steps: [{ name: 'Old', main: true }, { name: 'X', params: {} }] },
    { ...recipe, main: 1, steps: [recipe.steps[0], { name: 'Ash', values: [{ l: 'Pressure', v: 40, k: 'pressure' }] }] }, template, 1, materials);
  assert.deepEqual(two.patch.steps, [{ name: 'Step 1', params: { pressure: 10, cl2: 50 } }, { name: 'Ash', main: true }]);
  assert.deepEqual(two.patch.params, { pressure: 40 });
  // A one-step (or name-only) recipe fills the main step and keeps the run's other steps.
  const ownSteps = [{ name: 'BT', params: { pressure: 5 } }, { name: 'Main', main: true }];
  const keep = recipeForForm({ params: {}, material: 'Si', steps: ownSteps }, recipe, template, 0, materials);
  assert.deepEqual(keep.patch.steps, ownSteps);
  const nameOnly = recipeForForm({ params: {}, material: 'Si', steps: ownSteps }, { ...recipe, main: -1, steps: [] }, template, 0, materials);
  assert.deepEqual(nameOnly.patch.steps, ownSteps);
});
