// @ts-check
/**
 * Summary (spec Section 10): arithmetic on a lookup result. Sensitivity,
 * the closest-run estimate, the similar-runs average, the headline, trend,
 * the last tool event, a suggested time and confidence. The wording lives in
 * summary-text.js. Pure and deterministic; docs/ALGORITHM.md describes every
 * rule here.
 */
import { DEFAULTS } from '../config.js';
import { isNum, sum, median, minMax, weightedMean, weightedStd, linearFit, sampleStd } from './stats.js';
import { toMs, DAY_MS, formatMmSs } from './time.js';
import {
  fieldSpread, fieldWeight, inputFields, isCategoricalField, isNumericField, isSet, latestMajorEvent, queryValue, sameValue,
} from './similarity.js';
import { confidenceReasons, summarySentences, summaryWarnings } from './summary-text.js';

/** @typedef {import('./similarity.js').LookupResult} LookupResult */
/** @typedef {import('./similarity.js').Match} Match */
/** @typedef {import('./types.js').Template} Template */
/** @typedef {import('./types.js').FieldSpec} FieldSpec */
/** @typedef {import('./types.js').FieldValue} FieldValue */
/** @typedef {import('./types.js').ToolEvent} ToolEvent */
/** @typedef {import('../config.js').Config} Config */

/**
 * @typedef {{match: Match, value: number}} Row a match and its numeric output
 * @typedef {{key: string, label: string, unit: string, delta: number, sens: number, contribution: number}} Adjustment
 *   delta = q − c; contribution = sens × delta
 * @typedef {{value: number, kind: 'exact'|'nearest'|'adjusted', adjustments: Adjustment[]}} Estimate
 * @typedef {{value: number, unexplained: string[]}} ClosestOnly
 * @typedef {{mean: number, std: number, min: number, max: number, n: number}} Average
 * @typedef {{value: number, kind: 'exact'|'nearest'|'adjusted'|'mean', label: string}} Headline
 * @typedef {{value: number, pairs: number}} Sensitivity
 * @typedef {{slopePerDay: number, slopePerWeek: number, n: number, spanDays: number,
 *   direction: 'stable'|'rising'|'falling'}} Trend
 * @typedef {{event: ToolEvent, runsSince: number}} LastEvent
 * @typedef {{minutes: number, seconds: number, mmss: string, rangeMin: number | null,
 *   rangeMax: number | null, verb: string, target: number}} SuggestedTime
 * @typedef {{level: 'low'|'medium'|'high', reasons: string[]}} Confidence
 *
 * @typedef {Object} Summary
 * @property {string} outputKey
 * @property {string} outputLabel
 * @property {string} unit
 * @property {number} n matches with a numeric value for the output
 * @property {Row | null} closest the first ranked match with the output
 * @property {Estimate | null} estimate
 * @property {ClosestOnly | null} closestOnly
 * @property {Average | null} average
 * @property {Headline | null} headline
 * @property {Record<string, Sensitivity>} sensitivity
 * @property {Trend | null} trend
 * @property {LastEvent | null} lastEvent
 * @property {SuggestedTime | null} suggestedTime
 * @property {Confidence} confidence
 * @property {string[]} warnings
 * @property {string[]} sentences
 */

/** @type {Readonly<Record<string, string>>} */
export const HEADLINE_LABELS = Object.freeze({
  exact: 'exact match', nearest: 'closest run', adjusted: 'adjusted', mean: 'similar-runs average',
});

/** @type {Readonly<Record<string, string>>} */
const VERBS = Object.freeze({ etch: 'etch', deposition: 'deposit' });

/**
 * @param {Match[]} matches
 * @param {string} key
 * @returns {Row[]} matches whose run has a numeric results[key], in rank order
 */
function rowsWithOutput(matches, key) {
  /** @type {Row[]} */
  const rows = [];
  for (const match of matches) {
    const v = match.run.results ? match.run.results[key] : undefined;
    if (isNum(v)) rows.push({ match, value: v });
  }
  return rows;
}

/**
 * Spread of a numeric field from the lookup; computed afresh when missing.
 * @param {Record<string, number> | undefined} spreads
 * @param {FieldSpec} f
 * @param {FieldValue | undefined} q
 * @param {Match[]} matches the candidates for the fallback
 * @returns {number}
 */
function spreadOf(spreads, f, q, matches) {
  const s = spreads ? spreads[f.key] : undefined;
  return isNum(s) && s > 0 ? s : fieldSpread(f, q, matches.map((m) => m.run));
}

/**
 * Sensitivity of the output to each numeric input k with weight > 0: the
 * median of Δoutput / Δk over unordered pairs of candidates that differ in
 * k alone (|Δk| > SENS_MIN_DELTA × s_k; every other numeric input absent in
 * both or within SENS_MAX_OTHER × s; every categorical input equal or
 * absent in both). Keys with no such pair are left out.
 * @param {Match[]} matches the filtered candidates
 * @param {Template | null | undefined} template the query template
 * @param {Record<string, number>} spreads
 * @param {string} outputKey
 * @param {Partial<Config>} [cfg]
 * @returns {Record<string, Sensitivity>}
 */
export function sensitivities(matches, template, spreads, outputKey, cfg = DEFAULTS) {
  const c = { ...DEFAULTS, ...cfg };
  const inputs = inputFields(template).filter((f) => fieldWeight(f) > 0);
  const numeric = inputs.filter(isNumericField);
  const categorical = inputs.filter(isCategoricalField);
  /** @type {Record<string, number>} */
  const s = {};
  for (const f of numeric) s[f.key] = spreadOf(spreads, f, undefined, matches);
  const rows = rowsWithOutput(matches, outputKey).map((r) => ({ p: r.match.run.params || {}, y: r.value }));

  /**
   * @param {Record<string, FieldValue>} pa
   * @param {Record<string, FieldValue>} pb
   * @param {FieldSpec} k the varied input
   */
  const onlyKDiffers = (pa, pb, k) => {
    for (const j of numeric) {
      if (j === k) continue;
      const a = pa[j.key];
      const b = pb[j.key];
      if (!isNum(a) && !isNum(b)) continue;
      if (!isNum(a) || !isNum(b) || Math.abs(a - b) > c.SENS_MAX_OTHER * s[j.key]) return false;
    }
    for (const f of categorical) {
      const a = pa[f.key];
      const b = pb[f.key];
      if (!isSet(a) && !isSet(b)) continue;
      if (!isSet(a) || !isSet(b) || !sameValue(f, a, b)) return false;
    }
    return true;
  };

  /** @type {Record<string, Sensitivity>} */
  const out = {};
  for (const k of numeric) {
    /** @type {number[]} */
    const ratios = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        const ka = a.p[k.key];
        const kb = b.p[k.key];
        if (!isNum(ka) || !isNum(kb)) continue;
        const dk = kb - ka;
        if (!(Math.abs(dk) > c.SENS_MIN_DELTA * s[k.key]) || !onlyKDiffers(a.p, b.p, k)) continue;
        ratios.push((b.y - a.y) / dk);
      }
    }
    if (ratios.length) out[k.key] = { value: /** @type {number} */ (median(ratios)), pairs: ratios.length };
  }
  return out;
}

/**
 * The closest-run estimate. Inputs differ when a numeric value is missing
 * from c or |q − c| > DIFF_THRESHOLD × s, or categorical values are unequal.
 * No difference: c's value ('exact' when d = 0, else 'nearest'). Every
 * difference numeric with a sensitivity: y_c + Σ sens_k × (q_k − c_k)
 * ('adjusted'). Otherwise no estimate, and c's value is shown as is.
 * @param {LookupResult} result
 * @param {Row} closest
 * @param {Record<string, Sensitivity>} sens
 * @param {Config} cfg
 * @returns {{estimate: Estimate | null, closestOnly: ClosestOnly | null}}
 */
export function closestEstimate(result, closest, sens, cfg) {
  const cp = closest.match.run.params || {};
  /** @type {{f: FieldSpec, q: FieldValue, r: FieldValue | undefined}[]} */
  const differing = [];
  for (const f of result.inputs || []) {
    const q = queryValue(f, result.query.params);
    if (q === undefined || fieldWeight(f) <= 0) continue;
    const r = cp[f.key];
    if (isNumericField(f)) {
      if (!isNum(r) || Math.abs(/** @type {number} */ (q) - r) > cfg.DIFF_THRESHOLD * spreadOf(result.spreads, f, q, result.matches)) {
        differing.push({ f, q, r });
      }
    } else if (!isSet(r) || !sameValue(f, q, r)) {
      differing.push({ f, q, r });
    }
  }
  if (!differing.length) {
    const kind = closest.match.d === 0 ? 'exact' : 'nearest';
    return { estimate: { value: closest.value, kind, adjustments: [] }, closestOnly: null };
  }
  const unexplained = differing.filter((x) => !(isNumericField(x.f) && isNum(x.r) && sens[x.f.key]));
  if (unexplained.length) {
    return { estimate: null, closestOnly: { value: closest.value, unexplained: unexplained.map((x) => x.f.label || x.f.key) } };
  }
  const adjustments = differing.map(({ f, q, r }) => {
    const delta = /** @type {number} */ (q) - /** @type {number} */ (r);
    const k = sens[f.key].value;
    return { key: f.key, label: f.label || f.key, unit: f.unit || '', delta, sens: k, contribution: k * delta };
  });
  const value = closest.value + sum(adjustments.map((a) => a.contribution));
  return { estimate: { value, kind: 'adjusted', adjustments }, closestOnly: null };
}

/**
 * Weighted mean and weighted std, sqrt(Σw(x − μ)² / Σw), plus min, max and
 * n. Equal weights when the weights sum to 0.
 * @param {Row[]} rows
 * @returns {Average | null}
 */
export function averageOf(rows) {
  if (!rows.length) return null;
  const xs = rows.map((r) => r.value);
  const raw = rows.map((r) => r.match.w);
  const ws = sum(raw) > 0 ? raw : xs.map(() => 1);
  const mm = /** @type {{min: number, max: number}} */ (minMax(xs));
  return {
    mean: /** @type {number} */ (weightedMean(xs, ws)),
    std: /** @type {number} */ (weightedStd(xs, ws)),
    min: mm.min,
    max: mm.max,
    n: xs.length,
  };
}

/**
 * Drift: a least-squares line of the output against startedAt (in days)
 * over runs with d ≤ TREND_MAX_DISTANCE and 0 ≤ age ≤ TREND_WINDOW_DAYS,
 * when there are at least TREND_MIN_N. Stable when |slope × span| is below
 * the sample std of those outputs (or that std is 0).
 * @param {Row[]} rows
 * @param {Config} cfg
 * @returns {Trend | null}
 */
export function trendOf(rows, cfg) {
  const pts = rows.filter((r) => r.match.d <= cfg.TREND_MAX_DISTANCE
    && r.match.ageDays >= 0 && r.match.ageDays <= cfg.TREND_WINDOW_DAYS);
  if (pts.length < cfg.TREND_MIN_N) return null;
  const xs = pts.map((r) => toMs(r.match.run.startedAt) / DAY_MS);
  const ys = pts.map((r) => r.value);
  const fit = linearFit(xs, ys);
  if (!fit) return null;
  const mm = /** @type {{min: number, max: number}} */ (minMax(xs));
  const spanDays = mm.max - mm.min;
  const sd = sampleStd(ys);
  const stable = !sd || Math.abs(fit.slope * spanDays) < sd;
  /** @type {Trend['direction']} */
  const direction = stable ? 'stable' : fit.slope > 0 ? 'rising' : 'falling';
  return { slopePerDay: fit.slope, slopePerWeek: fit.slope * 7, n: pts.length, spanDays, direction };
}

/**
 * The latest major event of the query tool up to now, and how many matches
 * on that tool started after it.
 * @param {LookupResult} result
 * @returns {LastEvent | null}
 */
export function lastEventOf(result) {
  const toolId = result.query.toolId;
  const event = latestMajorEvent(result.events, toolId, -Infinity, result.now);
  if (!event) return null;
  const at = toMs(event.at);
  const runsSince = result.matches.filter((m) => m.run.toolId === toolId && toMs(m.run.startedAt) > at).length;
  return { event, runsSince };
}

/**
 * Time to reach the target thickness T at the headline rate R (nm/min
 * outputs only): T / R minutes, with a range T / max to T / min over the
 * top-K outputs above 0.
 * @param {LookupResult} result
 * @param {string} unit the output unit
 * @param {Headline | null} headline
 * @param {Row[]} top the top-K rows
 * @returns {SuggestedTime | null}
 */
export function suggestTime(result, unit, headline, top) {
  const target = result.query.targetThickness;
  if (String(unit || '').replace(/\s+/g, '').toLowerCase() !== 'nm/min') return null;
  if (!isNum(target) || !(target > 0) || !headline || !(headline.value > 0)) return null;
  const minutes = target / headline.value;
  const mm = minMax(top.map((r) => r.value).filter((v) => v > 0));
  const processType = result.template ? result.template.processType : '';
  return {
    minutes,
    seconds: minutes * 60,
    mmss: formatMmSs(minutes * 60),
    rangeMin: mm ? target / mm.max : null,
    rangeMax: mm ? target / mm.min : null,
    verb: VERBS[processType] || 'run',
    target,
  };
}

/**
 * Low: one match with the output, the closest d above CONF_LOW_MIN_D, or any
 * extrapolation. High: at least CONF_HIGH_MIN_MATCHES matches with d ≤
 * CONF_HIGH_MAX_D, the closest at most CONF_HIGH_MAX_AGE_DAYS old with no
 * major event since, and no extrapolation. Medium otherwise.
 * @param {Row[]} rows
 * @param {Row} closest
 * @param {LookupResult['extrapolation']} extrapolation
 * @param {Config} cfg
 * @returns {Confidence}
 */
export function confidenceOf(rows, closest, extrapolation, cfg) {
  const m = closest.match;
  const extra = extrapolation || [];
  const near = rows.filter((r) => r.match.d <= cfg.CONF_HIGH_MAX_D).length;
  const facts = { n: rows.length, d: m.d, ageDays: m.ageDays, eventSince: m.eventSince, near, extrapolation: extra };
  /** @type {Confidence['level']} */
  let level = 'medium';
  if (rows.length === 1 || m.d > cfg.CONF_LOW_MIN_D || extra.length) level = 'low';
  else if (near >= cfg.CONF_HIGH_MIN_MATCHES && m.ageDays <= cfg.CONF_HIGH_MAX_AGE_DAYS && !m.eventSince) level = 'high';
  return { level, reasons: confidenceReasons(level, facts, cfg) };
}

/**
 * Summarise a lookup for one output (the template's primary output by
 * default).
 * @param {LookupResult} result from lookup()
 * @param {{outputKey?: string}} [options]
 * @returns {Summary | null} null when no match has a numeric value for the output
 */
export function summarize(result, options = {}) {
  if (!result || !Array.isArray(result.matches)) return null;
  const template = result.template || null;
  const key = (options && options.outputKey) || (template && template.primaryOutput) || '';
  if (!key) return null;
  const rows = rowsWithOutput(result.matches, key);
  if (!rows.length) return null;
  const cfg = /** @type {Config} */ ({ ...DEFAULTS, ...(result.cfg || {}) });
  const field = template ? (template.fields || []).find((f) => f && f.key === key) : undefined;
  const unit = (field && field.unit) || '';
  const closest = rows[0];
  const sensitivity = sensitivities(result.matches, template, result.spreads, key, cfg);
  const { estimate, closestOnly } = closestEstimate(result, closest, sensitivity, cfg);
  const top = rows.slice(0, Math.max(1, Math.round(cfg.TOP_K) || 1));
  const average = averageOf(top);
  /** @type {Headline | null} */
  let headline = null;
  if (estimate) headline = { value: estimate.value, kind: estimate.kind, label: HEADLINE_LABELS[estimate.kind] };
  else if (average) headline = { value: average.mean, kind: 'mean', label: HEADLINE_LABELS.mean };

  /** @type {Summary} */
  const summary = {
    outputKey: key,
    outputLabel: (field && field.label) || key,
    unit,
    n: rows.length,
    closest,
    estimate,
    closestOnly,
    average,
    headline,
    sensitivity,
    trend: trendOf(rows, cfg),
    lastEvent: lastEventOf(result),
    suggestedTime: suggestTime(result, unit, headline, top),
    confidence: confidenceOf(rows, closest, result.extrapolation, cfg),
    warnings: summaryWarnings(result),
    sentences: [],
  };
  summary.sentences = summarySentences(summary, result);
  return summary;
}
