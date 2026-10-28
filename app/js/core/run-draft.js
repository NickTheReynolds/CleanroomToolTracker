// @ts-check
/**
 * Pure helpers for run forms: a blank form state, prefill from a previous
 * run, required-field checks and turning a form state into run fields.
 */
import { toMs } from './time.js';
import { isSet, compactValues } from './values.js';
import { copySteps, tidySteps } from './run-steps.js';

export { isSet, compactValues };

/** @typedef {import('./types.js').Run} Run */
/** @typedef {import('./types.js').Template} Template */
/** @typedef {import('./types.js').FieldValue} FieldValue */
/** @typedef {import('./types.js').RunStep} RunStep */
/** @typedef {import('./types.js').ProjectLink} ProjectLink */

/**
 * @typedef {Object} RunDraft
 * @property {string} runId id the run will get (photos attach to it before saving)
 * @property {string} toolId
 * @property {string | null} templateId
 * @property {Record<string, FieldValue>} params the main step's values
 * @property {Record<string, FieldValue>} results
 * @property {string} material
 * @property {string} substrate
 * @property {string} maskMaterial
 * @property {string} recipe
 * @property {number | null} targetThickness nm
 * @property {string} notes
 * @property {string} tags comma-separated while editing
 * @property {string[]} photoIds
 * @property {string} startedAt
 * @property {string | null} endedAt
 * @property {RunStep[]} [steps] the steps of a run with several; empty for one step
 * @property {ProjectLink[]} [projects] the projects the run belongs to
 * @property {{runId: string, startedAt: string} | null} copiedFrom
 * @property {boolean} touched the person changed something (prefill does not count)
 */

/**
 * @param {{runId: string, toolId: string, templateId: string | null, now: string}} o
 * @returns {RunDraft}
 */
export function blankDraft(o) {
  return {
    runId: o.runId,
    toolId: o.toolId,
    templateId: o.templateId,
    params: {},
    results: {},
    material: '',
    substrate: '',
    maskMaterial: '',
    recipe: '',
    targetThickness: null,
    notes: '',
    tags: '',
    photoIds: [],
    startedAt: o.now,
    endedAt: null,
    steps: [],
    projects: [],
    copiedFrom: null,
    touched: false,
  };
}

/**
 * @param {Template | null | undefined} t
 * @param {string[]} roles
 * @returns {import('./types.js').FieldSpec[]}
 */
export function fieldsWithRole(t, roles) {
  return t ? t.fields.filter((f) => roles.includes(f.role)) : [];
}

/**
 * Copy a previous run's inputs, context values, steps and sample details
 * into a form (outputs, notes, photos and projects are not copied).
 * @param {RunDraft} draft
 * @param {Run} run
 * @param {Template} template
 * @returns {RunDraft}
 */
export function prefillFrom(draft, run, template) {
  /** @type {Record<string, FieldValue>} */
  const params = {};
  for (const f of fieldsWithRole(template, ['input', 'context'])) {
    const v = run.params ? run.params[f.key] : undefined;
    if (isSet(v)) params[f.key] = /** @type {FieldValue} */ (v);
  }
  return {
    ...draft,
    params,
    steps: copySteps(run.steps || [], template),
    material: run.material || '',
    substrate: run.substrate || '',
    maskMaterial: run.maskMaterial || '',
    recipe: run.recipe || '',
    targetThickness: typeof run.targetThickness === 'number' ? run.targetThickness : null,
    tags: (run.tags || []).join(', '),
    copiedFrom: { runId: run.id, startedAt: run.startedAt },
  };
}

/**
 * Undo a prefill: empty the copied values (anything typed since stays only
 * in notes, photos and results, which were never copied).
 * @param {RunDraft} draft
 * @returns {RunDraft}
 */
export function clearPrefill(draft) {
  return {
    ...draft,
    params: {},
    steps: [],
    material: '',
    substrate: '',
    maskMaterial: '',
    recipe: '',
    targetThickness: null,
    tags: '',
    copiedFrom: null,
  };
}

/**
 * Labels of required fields that are still empty.
 * @param {Template | null | undefined} template
 * @param {Record<string, FieldValue>} params
 * @param {Record<string, FieldValue>} [results]
 * @returns {string[]}
 */
export function missingRequired(template, params, results = {}) {
  if (!template) return [];
  return template.fields
    .filter((f) => f.required && !isSet(f.role === 'output' ? results[f.key] : params[f.key]))
    .map((f) => f.label);
}

/**
 * @param {Template | null | undefined} template
 * @param {Record<string, FieldValue> | undefined} results
 * @returns {boolean} true when at least one output of the template has a value
 */
export function hasAnyOutput(template, results) {
  if (!template || !results) return false;
  return template.fields.some((f) => f.role === 'output' && isSet(results[f.key]));
}

/**
 * "a, b,, c" -> ["a", "b", "c"] (trimmed, duplicates removed).
 * @param {string} text
 * @returns {string[]}
 */
export function parseTags(text) {
  const out = [];
  for (const t of String(text || '').split(',')) {
    const s = t.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Run fields (not yet stamped with id metadata) from a form state.
 * @param {RunDraft} d
 * @param {'draft' | 'open' | 'complete'} status
 * @param {string} [now] ISO time used as endedAt when completing without one
 * @returns {Record<string, any>}
 */
export function draftToRun(d, status, now = new Date().toISOString()) {
  return {
    id: d.runId,
    toolId: d.toolId,
    templateId: d.templateId,
    status,
    startedAt: d.startedAt,
    endedAt: d.endedAt || (status === 'complete' ? now : null),
    params: compactValues(d.params),
    results: compactValues(d.results),
    derivedKeys: [],
    material: d.material.trim(),
    substrate: d.substrate.trim(),
    maskMaterial: d.maskMaterial.trim(),
    recipe: d.recipe.trim(),
    targetThickness: typeof d.targetThickness === 'number' && Number.isFinite(d.targetThickness) ? d.targetThickness : null,
    notes: d.notes.trim(),
    tags: parseTags(d.tags),
    photoIds: [...d.photoIds],
    steps: tidySteps(d.steps || []),
    projects: (d.projects || []).map((l) => ({ projectId: l.projectId, waferIds: [...(l.waferIds || [])], stepId: l.stepId || null })),
  };
}

/**
 * The duration field the run timer fills: the time field of the first rate
 * derivation, else the first duration input.
 * @param {Template | null | undefined} t
 * @returns {string | null}
 */
export function timerField(t) {
  if (!t) return null;
  const spec = (t.derived || []).find((d) => d.timeField);
  if (spec && t.fields.some((f) => f.key === spec.timeField)) return /** @type {string} */ (spec.timeField);
  const f = t.fields.find((x) => x.type === 'duration' && x.role === 'input');
  return f ? f.key : null;
}

/**
 * Seconds a timer has run since it started (never negative).
 * @param {string | null} startedAt
 * @param {number} nowMs
 * @returns {number}
 */
export function elapsedSeconds(startedAt, nowMs) {
  const t = toMs(startedAt);
  return Number.isFinite(t) ? Math.max(0, Math.round((nowMs - t) / 1000)) : 0;
}
