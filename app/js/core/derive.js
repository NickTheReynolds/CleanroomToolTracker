// @ts-check
/**
 * Derived outputs (spec Section 8). A template's `derived` entries map an
 * output key to one of a fixed set of built-in functions; there are no user
 * formulas. A missing input makes the output absent (never 0) and yields a
 * reason such as "needs pre measurement".
 */
import { isNum, mean, sampleStd } from './stats.js';
import { normText } from './vocab.js';
import { toMs } from './time.js';

/** @typedef {import('./types.js').Run} Run */
/** @typedef {import('./types.js').Template} Template */
/** @typedef {import('./types.js').Measurement} Measurement */
/** @typedef {import('./types.js').DerivedSpec} DerivedSpec */
/** @typedef {import('./types.js').Point} Point */

export const DERIVED_FUNCTIONS = Object.freeze([
  'etchRate', 'depRate', 'removed', 'deposited', 'uniformity', 'uniformityStd', 'selectivity',
]);

/** @type {Readonly<Record<string, {label: string, unit: string, formula: string, usesTime: boolean}>>} */
export const DERIVED_INFO = Object.freeze({
  etchRate: { label: 'Etch rate', unit: 'nm/min', formula: '(pre − post) / (time / 60)', usesTime: true },
  depRate: { label: 'Deposition rate', unit: 'nm/min', formula: '(post − pre) / (time / 60), pre = 0 if absent', usesTime: true },
  removed: { label: 'Removed', unit: 'nm', formula: 'pre − post', usesTime: false },
  deposited: { label: 'Deposited', unit: 'nm', formula: 'post − pre, pre = 0 if absent', usesTime: false },
  uniformity: { label: 'Uniformity', unit: '%', formula: '(max − min) / (2 × mean) × 100', usesTime: false },
  uniformityStd: { label: 'Uniformity (std)', unit: '%', formula: 'sample std / mean × 100', usesTime: false },
  selectivity: { label: 'Selectivity', unit: 'ratio', formula: 'rate of material / rate of mask material', usesTime: false },
});

/**
 * The one small unit table: entry units per measurement kind and the factor
 * that converts each to the stored (canonical) unit. Kind "other" keeps the
 * unit as typed.
 */
export const UNIT_TABLE = Object.freeze({
  thickness: { canonical: 'nm', factors: { nm: 1, 'Å': 0.1, 'µm': 1000 } },
  stepHeight: { canonical: 'nm', factors: { nm: 1, 'Å': 0.1, 'µm': 1000 } },
  cd: { canonical: 'µm', factors: { 'µm': 1, nm: 0.001 } },
  sheetResistance: { canonical: 'Ω/sq', factors: { 'Ω/sq': 1 } },
  refractiveIndex: { canonical: '', factors: { '': 1 } },
  stress: { canonical: 'MPa', factors: { MPa: 1 } },
});

/**
 * @param {string} kind
 * @returns {{canonical: string, factors: Record<string, number>} | null}
 */
function unitEntry(kind) {
  return /** @type {Record<string, any>} */ (UNIT_TABLE)[kind] || null;
}

/**
 * Entry units offered for a measurement kind (canonical first), or null
 * when the unit is free text.
 * @param {string} kind
 * @returns {string[] | null}
 */
export function unitsFor(kind) {
  const e = unitEntry(kind);
  return e ? Object.keys(e.factors) : null;
}

/**
 * Convert a value entered in `unit` to the kind's stored unit.
 * @param {string} kind
 * @param {string} unit
 * @param {number} value
 * @returns {{value: number, unit: string}}
 */
export function toCanonical(kind, unit, value) {
  const e = unitEntry(kind);
  if (!e) return { value, unit };
  const f = e.factors[unit];
  if (f === undefined) throw new Error(`Unknown unit "${unit}" for ${kind}`);
  return { value: value * f, unit: e.canonical };
}

/**
 * Summary of a measurement's points. A measurement's mean is the arithmetic
 * mean of its points.
 * @param {Point[] | null | undefined} points
 * @returns {{n: number, mean: number, min: number, max: number, range: number,
 *   uniformity: number | null, uniformityStd: number | null} | null} null when
 *   there are no numeric points
 */
export function pointStats(points) {
  const vals = (points || []).map((p) => p && p.value).filter(isNum);
  if (!vals.length) return null;
  const m = /** @type {number} */ (mean(vals));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const sd = sampleStd(vals);
  const am = Math.abs(m);
  return {
    n: vals.length,
    mean: m,
    min,
    max,
    range: max - min,
    uniformity: am > 0 ? ((max - min) / (2 * am)) * 100 : null,
    uniformityStd: am > 0 && sd !== null ? (sd / am) * 100 : null,
  };
}

/**
 * The latest non-deleted measurement of a phase, kind and material. A
 * measurement with a blank material counts as the run's own material.
 * @param {Measurement[]} ms
 * @param {{phase: string, kind: string, material: string, runMaterial: string}} q
 * @returns {Measurement | null}
 */
export function pickMeasurement(ms, q) {
  const want = normText(q.material);
  const runMat = normText(q.runMaterial);
  let best = null;
  for (const m of ms || []) {
    if (!m || m.deleted || m.phase !== q.phase || (m.kind || 'thickness') !== q.kind) continue;
    const mat = normText(m.material) || runMat;
    if (mat !== want) continue;
    if (!best || toMs(m.takenAt) > toMs(best.takenAt)
      || (toMs(m.takenAt) === toMs(best.takenAt) && m.updatedAt > best.updatedAt)) best = m;
  }
  return best;
}

/** @typedef {{value: number} | {missing: string}} Outcome */

/**
 * @param {Template} t
 * @param {string} key
 */
function fieldLabel(t, key) {
  const f = (t.fields || []).find((x) => x.key === key);
  return f ? f.label.toLowerCase() : key;
}

/**
 * Process time in seconds from the spec's timeField (default: the first
 * duration field of the template).
 * @param {DerivedSpec} spec
 * @param {Run} run
 * @param {Template} t
 * @returns {{seconds: number} | {missing: string}}
 */
function processSeconds(spec, run, t) {
  const key = spec.timeField || (t.fields || []).find((f) => f.type === 'duration')?.key;
  if (!key) return { missing: 'template has no time field' };
  const v = run.params ? run.params[key] : undefined;
  const label = fieldLabel(t, key);
  if (v === undefined || v === null || v === '') return { missing: `needs ${label}` };
  if (!isNum(v)) return { missing: `${label} is not a number` };
  if (v <= 0) return { missing: `${label} must be greater than 0` };
  return { seconds: v };
}

/**
 * Pre and post mean thickness of one material.
 * @param {Measurement[]} ms
 * @param {Run} run
 * @param {string} material
 * @param {string} kind
 * @param {boolean} preOptional pre = 0 when absent
 * @returns {{pre: number, post: number} | {missing: string}}
 */
function prePost(ms, run, material, kind, preOptional) {
  const base = { kind, material, runMaterial: run.material };
  const pre = pickMeasurement(ms, { ...base, phase: 'pre' });
  const post = pickMeasurement(ms, { ...base, phase: 'post' });
  const of = normText(material) && normText(material) !== normText(run.material) ? ` of ${material}` : '';
  if (!post && !pre && !preOptional) return { missing: `needs pre and post measurements${of}` };
  if (!post) return { missing: `needs post measurement${of}` };
  if (!pre && !preOptional) return { missing: `needs pre measurement${of}` };
  const postStats = pointStats(post.points);
  if (!postStats) return { missing: `post measurement${of} has no points` };
  if (!pre) return { pre: 0, post: postStats.mean };
  const preStats = pointStats(pre.points);
  if (!preStats) return { missing: `pre measurement${of} has no points` };
  return { pre: preStats.mean, post: postStats.mean };
}

/**
 * Evaluate one derived spec.
 * @param {DerivedSpec} spec
 * @param {Run} run
 * @param {Template} t
 * @param {Measurement[]} ms
 * @returns {Outcome}
 */
function evaluate(spec, run, t, ms) {
  const kind = spec.kind || 'thickness';
  switch (spec.fn) {
    case 'etchRate':
    case 'depRate': {
      const etch = spec.fn === 'etchRate';
      const pp = prePost(ms, run, run.material, kind, !etch);
      if ('missing' in pp) return pp;
      const time = processSeconds(spec, run, t);
      if ('missing' in time) return time;
      const delta = etch ? pp.pre - pp.post : pp.post - pp.pre;
      return { value: delta / (time.seconds / 60) };
    }
    case 'removed':
    case 'deposited': {
      const removed = spec.fn === 'removed';
      const pp = prePost(ms, run, run.material, kind, !removed);
      if ('missing' in pp) return pp;
      return { value: removed ? pp.pre - pp.post : pp.post - pp.pre };
    }
    case 'uniformity':
    case 'uniformityStd': {
      const phase = spec.phase || 'post';
      const m = pickMeasurement(ms, { phase, kind, material: run.material, runMaterial: run.material });
      if (!m) return { missing: `needs ${phase} measurement` };
      const st = pointStats(m.points);
      if (!st) return { missing: `${phase} measurement has no points` };
      if (spec.fn === 'uniformityStd') {
        if (st.n < 2) return { missing: 'needs 2 or more points' };
        return st.uniformityStd === null ? { missing: 'mean is 0' } : { value: st.uniformityStd };
      }
      return st.uniformity === null ? { missing: 'mean is 0' } : { value: st.uniformity };
    }
    case 'selectivity': {
      // Both films etch for the same time, so the rate ratio equals the
      // ratio of thickness removed and needs no time value.
      if (!normText(run.maskMaterial)) return { missing: 'needs mask material' };
      const film = prePost(ms, run, run.material, kind, false);
      if ('missing' in film) return film;
      const mask = prePost(ms, run, /** @type {string} */ (run.maskMaterial), kind, false);
      if ('missing' in mask) return mask;
      const maskRemoved = mask.pre - mask.post;
      if (!(maskRemoved > 0)) return { missing: 'mask was not etched (selectivity undefined)' };
      return { value: (film.pre - film.post) / maskRemoved };
    }
    default:
      return { missing: `unknown function "${spec.fn}"` };
  }
}

/**
 * Evaluate every derived spec of a template for a run.
 * @param {Run} run
 * @param {Template | null | undefined} template
 * @param {Measurement[]} measurements the run's measurements
 * @returns {{values: Record<string, number>, missing: Record<string, string>}}
 */
export function computeDerived(run, template, measurements) {
  /** @type {Record<string, number>} */
  const values = {};
  /** @type {Record<string, string>} */
  const missing = {};
  if (!template) return { values, missing };
  for (const spec of template.derived || []) {
    const out = evaluate(spec, run, template, measurements || []);
    if ('value' in out && isNum(out.value)) values[spec.output] = out.value;
    else missing[spec.output] = 'missing' in out ? out.missing : 'could not be computed';
  }
  return { values, missing };
}

/**
 * The duration field a rate is waiting for: the run has the measurements
 * the rate needs, but its time is empty, not a number or 0.
 * @param {Run} run
 * @param {Template | null | undefined} template
 * @param {Measurement[]} measurements the run's measurements
 * @returns {string | null} the time field's key; null when no rate waits on the time
 */
export function missingTimeField(run, template, measurements) {
  if (!template) return null;
  for (const spec of template.derived || []) {
    if (!DERIVED_INFO[spec.fn] || !DERIVED_INFO[spec.fn].usesTime) continue;
    const pp = prePost(measurements || [], run, run.material, spec.kind || 'thickness', spec.fn !== 'etchRate');
    if ('missing' in pp || !('missing' in processSeconds(spec, run, template))) continue;
    const key = spec.timeField || (template.fields || []).find((f) => f.type === 'duration')?.key;
    if (key) return key;
  }
  return null;
}

/**
 * What an unfinished run is waiting for, as words that follow "This run":
 * "needs post measurement", "needs time", "needs results", "cannot work out
 * Etch rate: time must be greater than 0" when the main result's formula
 * has what it needs but cannot use it, or "ready to mark complete" once its
 * main result (or, without one, any result) has a value.
 * @param {Run} run
 * @param {Template | null | undefined} template
 * @param {Measurement[]} measurements the run's measurements
 * @returns {string}
 */
export function waitingFor(run, template, measurements) {
  if (!template) return 'needs a template';
  if (run.status === 'draft') return 'needs its inputs';
  const results = run.results || {};
  const outputs = (template.fields || []).filter((f) => f.role === 'output');
  const has = (/** @type {string} */ k) => results[k] !== undefined && results[k] !== null && results[k] !== '';
  const main = template.primaryOutput;
  if (main ? has(main) : outputs.some((f) => has(f.key))) return 'ready to mark complete';
  const { missing } = computeDerived(run, template, measurements || []);
  if (main && missing[main]) {
    const why = missing[main];
    if (why.startsWith('needs ')) return why.replace(/^needs (\S+)$/, (m, w) => `needs ${w.toLowerCase()}`);
    const label = outputs.find((f) => f.key === main)?.label || main;
    return `cannot work out ${label}: ${why}`;
  }
  return outputs.length ? 'needs results' : 'ready to mark complete';
}

/**
 * Recompute derived outputs into a copy of run.results. A value present in
 * results but absent from derivedKeys was entered by hand and wins; derived
 * values that can no longer be computed are removed.
 * @param {Run} run
 * @param {Template | null | undefined} template
 * @param {Measurement[]} measurements
 * @returns {{results: Record<string, import('./types.js').FieldValue>, derivedKeys: string[],
 *   missing: Record<string, string>, values: Record<string, number>}}
 */
export function applyDerived(run, template, measurements) {
  const { values, missing } = computeDerived(run, template, measurements);
  const results = { ...(run.results || {}) };
  const prev = new Set(run.derivedKeys || []);
  /** @type {string[]} */
  const derivedKeys = [];
  for (const spec of template ? template.derived || [] : []) {
    const key = spec.output;
    if (derivedKeys.includes(key)) continue;
    const v = results[key];
    const manual = !prev.has(key) && v !== undefined && v !== null && v !== '';
    if (manual) continue;
    if (key in values) {
      results[key] = values[key];
      derivedKeys.push(key);
    } else if (prev.has(key)) {
      delete results[key];
    }
  }
  return { results, derivedKeys, missing, values };
}
