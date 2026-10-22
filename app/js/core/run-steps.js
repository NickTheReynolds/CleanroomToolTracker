// @ts-check
/**
 * Runs with several steps: a breakthrough, the main etch and an ash, or the
 * layers of a stack. run.steps lists the steps in order and marks one as the
 * main step. The main step's values live in run.params, as for a one-step
 * run, so lookup, derived values and every export keep reading run.params;
 * the other steps keep their own values. An empty list is a one-step run.
 * Pure: no DOM, no storage.
 */
import { recipeFill, applyFill, recipeMaterial } from './recipes.js';
import { compactValues } from './values.js';
import { fmtValue } from './format.js';
import { formatMmSs } from './time.js';

/** @typedef {import('./types.js').RunStep} RunStep */
/** @typedef {import('./types.js').FieldValue} FieldValue */
/** @typedef {import('./types.js').Template} Template */
/** @typedef {import('./recipes.js').WikiRecipe} WikiRecipe */
/** @typedef {Record<string, FieldValue>} Values */

/** @param {unknown} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * @param {readonly RunStep[]} steps
 * @returns {number} index of the main step, or -1 for a one-step run
 */
export function mainIndex(steps) {
  return list(steps).findIndex((s) => s && s.main === true);
}

/**
 * The values of step i (the main step reads the run's params).
 * @param {readonly RunStep[]} steps
 * @param {Values} params
 * @param {number} i
 * @returns {Values}
 */
export function stepValues(steps, params, i) {
  const s = list(steps)[i];
  if (!s || s.main) return params || {};
  return s.params || {};
}

/**
 * Store new values for step i.
 * @param {readonly RunStep[]} steps
 * @param {Values} params
 * @param {number} i
 * @param {Values} values
 * @returns {{steps: RunStep[], params: Values}}
 */
export function withStepValues(steps, params, i, values) {
  const s = list(steps)[i];
  if (!s || s.main) return { steps: [...list(steps)], params: values };
  return { steps: list(steps).map((x, j) => (j === i ? { ...x, params: values } : x)), params };
}

/**
 * Add an empty step at the end. A one-step run first becomes a main step
 * named `mainName` (its values stay in params).
 * @param {readonly RunStep[]} steps
 * @param {string} name
 * @param {string} [mainName]
 * @returns {RunStep[]}
 */
export function addStep(steps, name, mainName = 'Main step') {
  const base = list(steps).length ? [...list(steps)] : [{ name: mainName, main: true }];
  return [...base, { name, params: {} }];
}

/**
 * Remove a step that is not the main one. With only the main step left the
 * run is a one-step run again.
 * @param {readonly RunStep[]} steps
 * @param {number} i
 * @returns {RunStep[]}
 */
export function removeStep(steps, i) {
  const s = list(steps)[i];
  if (!s || s.main) return [...list(steps)];
  const rest = list(steps).filter((_, j) => j !== i);
  return rest.length === 1 && rest[0].main ? [] : rest;
}

/**
 * Make step i the main step: its values move into params and the old main
 * step keeps the old params as its own values.
 * @param {readonly RunStep[]} steps
 * @param {Values} params
 * @param {number} i
 * @returns {{steps: RunStep[], params: Values}}
 */
export function setMain(steps, params, i) {
  const all = list(steps);
  const target = all[i];
  if (!target || target.main) return { steps: [...all], params };
  const next = all.map((s, j) => {
    if (j === i) return { name: s.name, main: true };
    if (s.main) return { name: s.name, params: { ...params } };
    return s;
  });
  return { steps: next, params: { ...(target.params || {}) } };
}

/**
 * Rename step i.
 * @param {readonly RunStep[]} steps
 * @param {number} i
 * @param {string} name
 * @returns {RunStep[]}
 */
export function renameStep(steps, i, name) {
  return list(steps).map((s, j) => (j === i ? { ...s, name } : s));
}

/**
 * A recipe's steps for a run: one-step recipes give no steps; otherwise
 * every step with its values for this template, and step `main` as the main
 * step (its values are returned as `params`, to apply over the form's).
 * @param {WikiRecipe} recipe
 * @param {Template} template
 * @param {number} main
 * @param {string[]} [roles] field roles to fill (default input and context)
 * @returns {{mainFill: import('./recipes.js').RecipeFill, steps: RunStep[]}}
 */
export function recipeSteps(recipe, template, main, roles) {
  const mainFill = recipeFill(recipe, template, { step: main, roles });
  if (list(recipe.steps).length < 2) return { mainFill, steps: [] };
  const steps = recipe.steps.map((s, j) => (j === main
    ? { name: s.name || `Step ${j + 1}`, main: true }
    : { name: s.name || `Step ${j + 1}`, params: compactValues(applyFill({}, recipeFill(recipe, template, { step: j, roles }).values)) }));
  return { mainFill, steps };
}

/**
 * What using a recipe changes in a run form: the recipe name; the main
 * step's values over the form's; every step of a multi-step recipe (a
 * recipe with one step or none fills the main step and leaves the run's
 * other steps as they are); and the material, but only when the form has
 * none and the recipe names exactly one listed material (recipeMaterial),
 * so a run never moves to a name Lookup's Same material rule would not
 * match.
 * @param {{params: Values, material: string, steps?: RunStep[]}} form
 * @param {WikiRecipe} recipe
 * @param {Template} template
 * @param {number} main the recipe step that becomes the run's main step
 * @param {readonly string[]} materials the materials list
 * @returns {{patch: {recipe: string, params: Values, material: string, steps: RunStep[]},
 *   fill: import('./recipes.js').RecipeFill, material: string | null}} material: the one it set
 */
export function recipeForForm(form, recipe, template, main, materials) {
  const { mainFill, steps } = recipeSteps(recipe, template, main);
  const material = form.material ? null : recipeMaterial(recipe, materials);
  return {
    patch: {
      recipe: recipe.name, params: applyFill(form.params, mainFill.values), material: material || form.material,
      steps: steps.length ? steps : [...list(form.steps)],
    },
    fill: mainFill,
    material,
  };
}

/**
 * Only the fields a template knows (inputs and conditions, the values a
 * step has in the form), set, for the steps a new run copies.
 * @param {readonly RunStep[]} steps
 * @param {Template} template
 * @returns {RunStep[]}
 */
export function copySteps(steps, template) {
  const keys = new Set(template.fields.filter((f) => f.role === 'input' || f.role === 'context').map((f) => f.key));
  return list(steps).map((s) => {
    if (s.main) return { name: String(s.name || ''), main: true };
    /** @type {Values} */
    const params = {};
    for (const [k, v] of Object.entries(compactValues(s.params || {}))) if (keys.has(k)) params[k] = v;
    return { name: String(s.name || ''), params };
  });
}

/**
 * Steps as stored: names trimmed, empty values dropped, at most one main
 * step (the first), and no steps at all when only the main one is left.
 * @param {readonly RunStep[]} steps
 * @returns {RunStep[]}
 */
export function tidySteps(steps) {
  let seenMain = false;
  const out = list(steps).filter((s) => s && typeof s === 'object').map((s, j) => {
    const name = String(s.name || '').trim() || `Step ${j + 1}`;
    if (s.main && !seenMain) {
      seenMain = true;
      return { name, main: true };
    }
    return { name, params: compactValues(s.params || {}) };
  });
  if (!out.length) return [];
  if (!seenMain) out[0] = { name: out[0].name, main: true };
  return out.length === 1 ? [] : out;
}

/**
 * "Break Through: Pressure 5 mTorr, TCP power 300 W; Ash: O2 50 sccm" — the
 * steps other than the main one, for exports and reports.
 * @param {{steps?: RunStep[]}} run
 * @param {Template | null | undefined} template
 * @returns {string}
 */
export function stepsText(run, template) {
  const fields = new Map((template ? template.fields : []).map((f) => [f.key, f]));
  return list(run.steps).map((s, j) => {
    const name = String(s.name || '').trim() || `Step ${j + 1}`;
    if (s.main) return `${name} (main step)`;
    const parts = Object.entries(compactValues(s.params || {})).map(([k, v]) => {
      const f = fields.get(k);
      if (!f) return `${k} ${String(v)}`;
      const shown = f.type === 'duration' && typeof v === 'number' ? formatMmSs(v)
        : typeof v === 'number' ? fmtValue(v, f.unit) : String(v);
      return `${f.label} ${shown}`;
    });
    return parts.length ? `${name}: ${parts.join(', ')}` : name;
  }).join('; ');
}
