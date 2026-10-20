// @ts-check
/**
 * Lookup (spec Section 9): hard filters, a normalised distance, recency and
 * tool-event weights, ranking, extrapolation checks and relax counts. Pure:
 * no DOM, no storage, and no clock unless `now` is omitted. The same input
 * gives the same output, and inputs are never mutated. docs/ALGORITHM.md
 * describes every rule here; keep the two in step.
 */
import { DEFAULTS } from '../config.js';
import { isNum, mean, sampleStd, minMax } from './stats.js';
import { toMs, DAY_MS } from './time.js';
import { normText, EVENT_SHORT } from './vocab.js';

/** @typedef {import('./types.js').Run} Run */
/** @typedef {import('./types.js').Tool} Tool */
/** @typedef {import('./types.js').Template} Template */
/** @typedef {import('./types.js').FieldSpec} FieldSpec */
/** @typedef {import('./types.js').FieldValue} FieldValue */
/** @typedef {import('./types.js').ToolEvent} ToolEvent */
/** @typedef {import('../config.js').Config} Config */

/**
 * @typedef {Object} LookupQuery
 * @property {string} toolId
 * @property {string} templateId
 * @property {string} [material]
 * @property {Record<string, FieldValue>} [params] any subset of the template's inputs
 * @property {number | null} [targetThickness] nm
 * @property {boolean} [strictChemistry] default true
 * @property {boolean} [sameMaterial] default true
 * @property {boolean} [includeSiblings] default false
 *
 * @typedef {LookupQuery & {material: string, params: Record<string, FieldValue>,
 *   targetThickness: number | null, strictChemistry: boolean, sameMaterial: boolean,
 *   includeSiblings: boolean}} NormalizedQuery
 *
 * @typedef {Object} Diff one distance term above 0
 * @property {string} key
 * @property {string} label
 * @property {string} unit
 * @property {FieldValue} q the query value
 * @property {FieldValue} r the run's value, null when unset
 * @property {number | null} delta r − q for numbers, else null
 * @property {boolean} missing the run has no usable value
 *
 * @typedef {Object} Match
 * @property {Run} run
 * @property {number} d distance (sum of terms)
 * @property {number} w weight = sim × age × event
 * @property {{sim: number, age: number, event: number}} factors
 * @property {number} ageDays (now − startedAt) in days, unclamped
 * @property {number} halfLifeDays the half-life used for the age factor
 * @property {boolean} eventSince a major event of the run's tool happened since the run
 * @property {ToolEvent | null} lastEventSince the latest such event
 * @property {boolean} exact d === 0
 * @property {Record<string, number>} terms one term per input the query sets
 * @property {Diff[]} diffs the terms above 0, in template order
 *
 * @typedef {{key: string, label: string, unit: string, q: number, min: number, max: number}} Extrapolation
 * @typedef {{strictChemistry: number, sameMaterial: number, includeSiblings: number}} RelaxCounts
 *
 * @typedef {Object} LookupResult
 * @property {NormalizedQuery} query the query with its options resolved
 * @property {Template | null} template the query template
 * @property {FieldSpec[]} inputs query-template inputs with weight > 0 that the query sets
 * @property {Match[]} matches every candidate that passes the hard filters, ranked
 * @property {Record<string, number>} spreads s for every numeric input with weight > 0
 * @property {Extrapolation[]} extrapolation
 * @property {RelaxCounts} relax runs each relaxed option alone would add
 * @property {number} now epoch ms
 * @property {Config} cfg
 * @property {Tool[]} tools
 * @property {Template[]} templates
 * @property {ToolEvent[]} events the non-deleted events
 *
 * @typedef {{strictChemistry: boolean, sameMaterial: boolean, includeSiblings: boolean}} FilterOptions
 */

/** Candidates needed before the sample std may serve as a spread. */
export const SPREAD_MIN_N = 4;
/** Fallback spread as a fraction of |q| (or of the mean |value|). */
export const SPREAD_FRACTION = 0.1;
/** Smallest spread, so a distance never divides by zero. */
export const SPREAD_FLOOR = 1e-9;
/** Distances that agree to 9 decimal places rank as a tie. */
const RANK_SCALE = 1e9;

/**
 * Set means a non-blank string, a finite number or a boolean; null,
 * undefined, '' and NaN are unset.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isSet(v) {
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'boolean';
}

/** @param {FieldSpec} f @returns {boolean} true for number and duration fields */
export const isNumericField = (f) => f.type === 'number' || f.type === 'duration';

/** @param {FieldSpec} f @returns {boolean} true for select, text and bool fields */
export const isCategoricalField = (f) => f.type === 'select' || f.type === 'text' || f.type === 'bool';

/** @param {FieldSpec} f @returns {boolean} a categorical input that acts as a hard filter */
export const isExactField = (f) => f.matchExact === true && isCategoricalField(f);

/**
 * Distance weight: the field's weight (negative counts as 0); by default 1,
 * or 0 for duration fields because time changes thickness, not rate.
 * @param {FieldSpec} f
 * @returns {number}
 */
export function fieldWeight(f) {
  if (isNum(f.weight)) return Math.max(0, f.weight);
  return f.type === 'duration' ? 0 : 1;
}

/**
 * The template's fields with role "input" (context and outputs are never matched).
 * @param {Template | null | undefined} template
 * @returns {FieldSpec[]}
 */
export function inputFields(template) {
  return template && Array.isArray(template.fields) ? template.fields.filter((f) => f && f.role === 'input') : [];
}

/**
 * The query's value for a field when it is set and of the field's type
 * (number for number/duration, boolean for bool, string for text/select).
 * A value of the wrong type is ignored.
 * @param {FieldSpec} f
 * @param {Record<string, FieldValue> | null | undefined} params
 * @returns {FieldValue | undefined}
 */
export function queryValue(f, params) {
  const v = params ? params[f.key] : undefined;
  if (!isSet(v)) return undefined;
  if (isNumericField(f)) return typeof v === 'number' ? v : undefined;
  if (f.type === 'bool') return typeof v === 'boolean' ? v : undefined;
  if (f.type === 'select' || f.type === 'text') return typeof v === 'string' ? v : undefined;
  return undefined;
}

/**
 * Categorical equality: strict for bool fields, normText otherwise (trimmed,
 * case-insensitive, NFKC, so "SiO₂" equals "sio2").
 * @param {FieldSpec} f
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function sameValue(f, a, b) {
  return f.type === 'bool' ? a === b : normText(a) === normText(b);
}

/**
 * A run lookup can use: not deleted, status complete, a valid startedAt, and
 * at least one set output (an output field of its own template, or any set
 * results value when that template is unknown).
 * @param {Run} run
 * @param {Template | null | undefined} runTemplate the run's own template
 * @returns {boolean}
 */
export function isCandidate(run, runTemplate) {
  if (!run || run.deleted || run.status !== 'complete') return false;
  if (!Number.isFinite(toMs(run.startedAt))) return false;
  const res = run.results || {};
  if (runTemplate) return (runTemplate.fields || []).some((f) => f && f.role === 'output' && isSet(res[f.key]));
  return Object.values(res).some(isSet);
}

/**
 * The latest non-deleted major event of a tool with afterMs < at ≤ nowMs
 * (on equal times, the larger id).
 * @param {ToolEvent[]} events
 * @param {string} toolId
 * @param {number} afterMs
 * @param {number} nowMs
 * @returns {ToolEvent | null}
 */
export function latestMajorEvent(events, toolId, afterMs, nowMs) {
  /** @type {ToolEvent | null} */
  let best = null;
  let bestAt = -Infinity;
  for (const e of events || []) {
    if (!e || e.deleted || e.major !== true || e.toolId !== toolId) continue;
    const at = toMs(e.at);
    if (!(at > afterMs && at <= nowMs)) continue;
    if (!best || at > bestAt || (at === bestAt && String(e.id) > String(best.id))) {
      best = e;
      bestAt = at;
    }
  }
  return best;
}

/**
 * @param {Run[]} runs
 * @param {string} key
 * @returns {number[]} the runs' finite numeric params[key]
 */
function numericValues(runs, key) {
  /** @type {number[]} */
  const out = [];
  for (const r of runs || []) {
    const v = r && r.params ? r.params[key] : undefined;
    if (isNum(v)) out.push(v);
  }
  return out;
}

/**
 * Spread s that normalises a numeric field: spreadHint when > 0; else the
 * sample std over the candidates when at least SPREAD_MIN_N have a value
 * and it is > 0; else max(|ref| × 0.1, 1e-9), where ref is q when the query
 * sets the field, else the mean |value| over the candidates (0 if none).
 * @param {FieldSpec} field
 * @param {FieldValue | undefined} q the query value, if set
 * @param {Run[]} candidates the filtered candidate runs
 * @returns {number}
 */
export function fieldSpread(field, q, candidates) {
  if (isNum(field.spreadHint) && field.spreadHint > 0) return field.spreadHint;
  const vals = numericValues(candidates, field.key);
  if (vals.length >= SPREAD_MIN_N) {
    const sd = sampleStd(vals);
    if (sd !== null && sd > 0) return sd;
  }
  const ref = isNum(q) ? q : (mean(vals.map((v) => Math.abs(v))) ?? 0);
  return Math.max(Math.abs(ref) * SPREAD_FRACTION, SPREAD_FLOOR);
}

/**
 * Distance of a run from the query: the SUM (not the mean) of one term per
 * input field the query sets with weight > 0. matchExact fields are hard
 * filters and add no term.
 *   numeric:      w × |q − r| / s, or w × MISSING_PENALTY when r is missing
 *   categorical:  0 when equal, else w × CATEGORICAL_PENALTY; missing as above
 * @param {Run} run
 * @param {FieldSpec[]} fields the query template's input fields
 * @param {Record<string, FieldValue>} params the query's params
 * @param {Record<string, number>} spreads s per numeric key
 * @param {Partial<Config>} [cfg]
 * @returns {{d: number, terms: Record<string, number>, diffs: Diff[]}}
 */
export function distance(run, fields, params, spreads, cfg = DEFAULTS) {
  const c = { ...DEFAULTS, ...cfg };
  const rp = (run && run.params) || {};
  let d = 0;
  /** @type {Record<string, number>} */
  const terms = {};
  /** @type {Diff[]} */
  const diffs = [];
  for (const f of fields || []) {
    const w = fieldWeight(f);
    const q = queryValue(f, params);
    if (f.role !== 'input' || !(w > 0) || q === undefined || isExactField(f)) continue;
    const r = rp[f.key];
    let term = 0;
    /** @type {number | null} */
    let delta = null;
    let missing = false;
    if (isNumericField(f)) {
      if (isNum(r)) {
        delta = r - /** @type {number} */ (q);
        const s = spreads && isNum(spreads[f.key]) && spreads[f.key] > 0 ? spreads[f.key] : fieldSpread(f, q, []);
        term = (w * Math.abs(delta)) / s;
      } else {
        missing = true;
        term = w * c.MISSING_PENALTY;
      }
    } else if (!isSet(r)) {
      missing = true;
      term = w * c.MISSING_PENALTY;
    } else {
      term = sameValue(f, q, r) ? 0 : w * c.CATEGORICAL_PENALTY;
    }
    terms[f.key] = term;
    d += term;
    if (term > 0) {
      diffs.push({ key: f.key, label: f.label || f.key, unit: f.unit || '', q, r: isSet(r) ? r : null, delta, missing });
    }
  }
  return { d, terms, diffs };
}

/**
 * Flags shown on a match row, e.g. ['Exact match', 'Before last clean'].
 * @param {Match} match
 * @returns {string[]}
 */
export function matchFlags(match) {
  /** @type {string[]} */
  const flags = [];
  if (match.d === 0) flags.push('Exact match');
  if (match.eventSince) {
    const type = match.lastEventSince ? match.lastEventSince.type : 'other';
    flags.push(`Before last ${EVENT_SHORT[type] || EVENT_SHORT.other}`);
  }
  return flags;
}

/**
 * @template {{id: string, deleted?: boolean}} T
 * @param {T[]} list
 * @returns {Map<string, T>} non-deleted records by id (the first wins)
 */
function byId(list) {
  /** @type {Map<string, T>} */
  const m = new Map();
  for (const x of list) if (x && !x.deleted && !m.has(x.id)) m.set(x.id, x);
  return m;
}

/**
 * @param {Template | null | undefined} template
 * @returns {string[]} keys of its chemistry input fields
 */
function chemistryKeys(template) {
  return inputFields(template).filter((f) => f.chemistry === true).map((f) => f.key);
}

/** @param {unknown} v @returns {boolean} a gas that flows: a number above 0 */
const flowing = (v) => isNum(v) && v > 0;

/**
 * @param {LookupQuery | null | undefined} query
 * @returns {NormalizedQuery}
 */
function normalizeQuery(query) {
  const src = query || /** @type {LookupQuery} */ ({});
  return {
    ...src,
    toolId: typeof src.toolId === 'string' ? src.toolId : '',
    templateId: typeof src.templateId === 'string' ? src.templateId : '',
    material: typeof src.material === 'string' ? src.material : '',
    params: { ...(src.params || {}) },
    targetThickness: isNum(src.targetThickness) ? src.targetThickness : null,
    strictChemistry: typeof src.strictChemistry === 'boolean' ? src.strictChemistry : true,
    sameMaterial: typeof src.sameMaterial === 'boolean' ? src.sameMaterial : true,
    includeSiblings: src.includeSiblings === true,
  };
}

/**
 * @typedef {Object} FilterContext
 * @property {NormalizedQuery} query
 * @property {Tool | undefined} qTool
 * @property {Template | null} qTemplate
 * @property {Map<string, Tool>} tools
 * @property {Map<string, Template>} templates
 * @property {string} material normText of the query material
 * @property {{field: FieldSpec, q: FieldValue}[]} exact matchExact fields the query sets
 * @property {string[]} chemKeys chemistry keys of the query template
 */

/**
 * Spec Step 1: does a candidate pass every hard filter?
 * @param {Run} run
 * @param {FilterContext} ctx
 * @param {FilterOptions} opts
 * @returns {boolean}
 */
function passes(run, ctx, opts) {
  const { query } = ctx;
  if (run.toolId !== query.toolId) {
    const t = ctx.tools.get(run.toolId);
    if (!opts.includeSiblings || !ctx.qTool || !t || !t.category || t.category !== ctx.qTool.category) return false;
  }
  if (run.templateId !== query.templateId) {
    const t = run.templateId ? ctx.templates.get(run.templateId) : undefined;
    const pt = ctx.qTemplate ? ctx.qTemplate.processType : undefined;
    if (!opts.includeSiblings || !pt || !t || t.processType !== pt) return false;
  }
  if (opts.sameMaterial && ctx.material && normText(run.material) !== ctx.material) return false;
  const rp = run.params || {};
  for (const { field, q } of ctx.exact) {
    if (!isSet(rp[field.key]) || !sameValue(field, q, rp[field.key])) return false;
  }
  if (opts.strictChemistry) {
    const rt = run.templateId ? ctx.templates.get(run.templateId) : undefined;
    const keys = new Set([...ctx.chemKeys, ...chemistryKeys(rt)]);
    for (const k of keys) if (flowing(query.params[k]) !== flowing(rp[k])) return false;
  }
  return true;
}

/**
 * Rank: distance ascending (equal to 9 decimals is a tie), then the more
 * recent startedAt, then id.
 * @param {Match} a
 * @param {Match} b
 * @returns {number}
 */
function compareMatches(a, b) {
  const da = Math.round(a.d * RANK_SCALE);
  const db = Math.round(b.d * RANK_SCALE);
  if (da !== db) return da < db ? -1 : 1;
  const ta = toMs(a.run.startedAt);
  const tb = toMs(b.run.startedAt);
  if (ta !== tb) return tb - ta;
  return a.run.id < b.run.id ? -1 : a.run.id > b.run.id ? 1 : 0;
}

/**
 * Find and rank the past runs most similar to a query (spec Section 9).
 * @param {{query: LookupQuery, runs?: Run[], templates?: Template[], tools?: Tool[],
 *   events?: ToolEvent[], now?: string | number | Date, cfg?: Partial<Config>}} input
 *   `now` defaults to the current time; pass it for repeatable output.
 * @returns {LookupResult}
 */
export function lookup({ query, runs = [], templates = [], tools = [], events = [], now, cfg = DEFAULTS }) {
  const c = /** @type {Config} */ ({ ...DEFAULTS, ...(cfg || {}) });
  const nowMs = now === undefined || now === null ? Date.now() : toMs(now);
  if (!Number.isFinite(nowMs)) throw new TypeError('lookup: `now` is not a valid time');
  const q = normalizeQuery(query);
  const toolList = Array.isArray(tools) ? tools : [];
  const templateList = Array.isArray(templates) ? templates : [];
  const liveEvents = (Array.isArray(events) ? events : []).filter((e) => e && !e.deleted);
  const toolMap = byId(toolList);
  const templateMap = byId(templateList);
  const template = templateMap.get(q.templateId) || null;
  const allInputs = inputFields(template);
  const inputs = allInputs.filter((f) => fieldWeight(f) > 0 && queryValue(f, q.params) !== undefined);

  /** @type {FilterContext} */
  const ctx = {
    query: q,
    qTool: toolMap.get(q.toolId),
    qTemplate: template,
    tools: toolMap,
    templates: templateMap,
    material: normText(q.material),
    exact: allInputs.filter(isExactField)
      .map((field) => ({ field, q: /** @type {FieldValue} */ (queryValue(field, q.params)) }))
      .filter((x) => x.q !== undefined),
    chemKeys: chemistryKeys(template),
  };
  const candidates = (Array.isArray(runs) ? runs : [])
    .filter((r) => isCandidate(r, r && r.templateId ? templateMap.get(r.templateId) : undefined));
  /** @type {FilterOptions} */
  const opts = { strictChemistry: q.strictChemistry, sameMaterial: q.sameMaterial, includeSiblings: q.includeSiblings };
  const filtered = candidates.filter((r) => passes(r, ctx, opts));

  /** @type {Record<string, number>} */
  const spreads = {};
  for (const f of allInputs) {
    if (isNumericField(f) && fieldWeight(f) > 0) spreads[f.key] = fieldSpread(f, queryValue(f, q.params), filtered);
  }

  const majors = liveEvents.filter((e) => e.major === true);
  const matches = filtered.map((run) => {
    const { d, terms, diffs } = distance(run, inputs, q.params, spreads, c);
    const startMs = toMs(run.startedAt);
    const ageDays = (nowMs - startMs) / DAY_MS;
    const tool = toolMap.get(run.toolId);
    const halfLifeDays = tool && isNum(tool.halfLifeDays) && tool.halfLifeDays > 0 ? tool.halfLifeDays : c.HALF_LIFE_DAYS;
    const lastEventSince = latestMajorEvent(majors, run.toolId, startMs, nowMs);
    const factors = {
      sim: Math.exp(-d),
      age: 0.5 ** (Math.max(ageDays, 0) / halfLifeDays),
      event: lastEventSince ? c.EVENT_PENALTY : 1,
    };
    const w = factors.sim * factors.age * factors.event;
    const eventSince = lastEventSince !== null;
    return { run, d, w, factors, ageDays, halfLifeDays, eventSince, lastEventSince, exact: d === 0, terms, diffs };
  }).sort(compareMatches);

  /** @type {Extrapolation[]} */
  const extrapolation = [];
  for (const f of inputs) {
    if (!isNumericField(f)) continue;
    const mm = minMax(numericValues(filtered, f.key));
    const qv = /** @type {number} */ (q.params[f.key]);
    if (mm && (qv < mm.min || qv > mm.max)) {
      extrapolation.push({ key: f.key, label: f.label || f.key, unit: f.unit || '', q: qv, min: mm.min, max: mm.max });
    }
  }

  /** @param {Partial<FilterOptions>} change @returns {number} runs the change would add */
  const added = (change) => {
    const o = { ...opts, ...change };
    let n = 0;
    for (const r of candidates) if (passes(r, ctx, o)) n++;
    return Math.max(0, n - filtered.length);
  };
  const relax = {
    strictChemistry: q.strictChemistry ? added({ strictChemistry: false }) : 0,
    sameMaterial: q.sameMaterial ? added({ sameMaterial: false }) : 0,
    includeSiblings: q.includeSiblings ? 0 : added({ includeSiblings: true }),
  };

  return {
    query: q, template, inputs, matches, spreads, extrapolation, relax,
    now: nowMs, cfg: c, tools: toolList, templates: templateList, events: liveEvents,
  };
}
