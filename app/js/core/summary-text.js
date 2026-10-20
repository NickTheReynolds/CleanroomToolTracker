// @ts-check
/**
 * Wording for a lookup summary: the plain-language sentences (spec Section
 * 10), the extrapolation warnings and the confidence reasons. A sentence
 * appears only when its numbers exist. Numbers use fmtNum (3 significant
 * figures, "−" minus) and dates use formatDay ("Oct 6", local time).
 */
import { fmtNum, fmtRange, fmtSigned, fmtValue, withUnit } from './format.js';
import { formatDay } from './time.js';
import { EVENT_LABELS } from './vocab.js';
import { inputFields } from './similarity.js';

/** @typedef {import('./similarity.js').LookupResult} LookupResult */
/** @typedef {import('./similarity.js').Extrapolation} Extrapolation */
/** @typedef {import('./summary.js').Summary} Summary */
/** @typedef {import('../config.js').Config} Config */

/**
 * "1 run", "3 runs".
 * @param {number} n
 * @param {string} word
 * @returns {string}
 */
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * "A", "A and B", "A, B and C".
 * @param {string[]} labels
 * @returns {string}
 */
export function joinLabels(labels) {
  if (labels.length < 2) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * One warning per extrapolated input:
 * "ICP power 500 W is outside your range (400–450 W); the estimate is extrapolated."
 * @param {LookupResult} result
 * @returns {string[]}
 */
export function summaryWarnings(result) {
  return (result.extrapolation || []).map((x) => `${x.label} ${fmtValue(x.q, x.unit)} is outside your range `
    + `(${fmtRange(x.min, x.max, x.unit)}); the estimate is extrapolated.`);
}

/**
 * @typedef {Object} ConfidenceFacts
 * @property {number} n matches with the output
 * @property {number} d distance of the closest run
 * @property {number} ageDays age of the closest run
 * @property {boolean} eventSince a major event happened since the closest run
 * @property {number} near matches with the output and d ≤ CONF_HIGH_MAX_D
 * @property {Extrapolation[]} extrapolation
 */

/**
 * Short reasons for a confidence level: what made it low, what kept it from
 * high, or what made it high.
 * @param {'low'|'medium'|'high'} level
 * @param {ConfidenceFacts} f
 * @param {Config} cfg
 * @returns {string[]}
 */
export function confidenceReasons(level, f, cfg) {
  const maxD = fmtNum(cfg.CONF_HIGH_MAX_D);
  const days = plural(Math.max(0, Math.round(f.ageDays)), 'day');
  /** @type {string[]} */
  const out = [];
  if (level === 'low') {
    if (f.n === 1) out.push('Only one similar run has this output.');
    if (f.d > cfg.CONF_LOW_MIN_D) {
      out.push(`The closest run is at distance ${fmtNum(f.d)}, above ${fmtNum(cfg.CONF_LOW_MIN_D)}.`);
    }
    for (const x of f.extrapolation) out.push(`${x.label} is outside the range of similar runs.`);
    return out;
  }
  if (level === 'high') {
    return [
      `${plural(f.near, 'run')} within distance ${maxD}.`,
      `The closest run is ${days} old, with no major tool event since.`,
      'No input is outside the range of similar runs.',
    ];
  }
  if (f.near < cfg.CONF_HIGH_MIN_MATCHES) {
    out.push(`Only ${plural(f.near, 'run')} within distance ${maxD}; high confidence needs ${cfg.CONF_HIGH_MIN_MATCHES}.`);
  }
  if (f.ageDays > cfg.CONF_HIGH_MAX_AGE_DAYS) {
    out.push(`The closest run is ${days} old; high confidence needs ${cfg.CONF_HIGH_MAX_AGE_DAYS} or fewer.`);
  }
  if (f.eventSince) out.push('A major tool event happened after the closest run.');
  return out;
}

/**
 * The summary sentences, in a fixed order: count and closest run; the
 * adjustment (or why the closest run is shown as is); the average;
 * sensitivities; trend; last tool event; suggested time.
 * @param {Summary} s
 * @param {LookupResult} result
 * @returns {string[]}
 */
export function summarySentences(s, result) {
  /** @type {string[]} */
  const out = [];
  const unit = s.unit;
  const label = s.outputLabel;

  if (s.closest) {
    const m = s.closest.match;
    const how = m.d === 0 ? 'exact match' : `distance ${fmtNum(m.d)}`;
    out.push(`${plural(s.n, 'similar run')}. Closest: ${formatDay(m.run.startedAt, result.now)} (${how}), `
      + `${fmtValue(s.closest.value, unit)}.`);
  }

  if (s.estimate && s.estimate.kind === 'adjusted') {
    const parts = s.estimate.adjustments.map((a) => `${a.label} ${withUnit(fmtSigned(a.delta), a.unit)}`);
    out.push(`Adjusted for ${parts.join(' and ')}: ~${fmtValue(s.estimate.value, unit)}.`);
  } else if (s.closestOnly) {
    const names = s.closestOnly.unexplained;
    const one = names.length === 1;
    out.push(`${joinLabels(names)} ${one ? 'differs' : 'differ'} from the closest run and ${one ? 'has' : 'have'} `
      + 'no measured sensitivity, so the closest run is shown as is.');
  }

  if (s.average && s.average.n >= 2) {
    out.push(`Similar runs average ${fmtValue(s.average.mean, unit)} (${fmtNum(s.average.min)}–${fmtNum(s.average.max)}).`);
  }

  for (const f of inputFields(result.template)) {
    const sens = s.sensitivity[f.key];
    if (!sens) continue;
    const pairs = plural(sens.pairs, 'pair');
    const name = f.label || f.key;
    if (sens.value === 0) {
      out.push(`${label} does not change with ${name} (${pairs}).`);
    } else {
      const per = f.unit ? `per ${f.unit} of ${name}` : `per unit of ${name}`;
      out.push(`${label} ${sens.value > 0 ? 'rises' : 'falls'} ~${withUnit(fmtNum(Math.abs(sens.value)), unit)} ${per} (${pairs}).`);
    }
  }

  if (s.trend) {
    const t = s.trend;
    out.push(t.direction === 'stable'
      ? `${label} has been stable over ${t.n} runs.`
      : `${label} is ${t.direction} ~${withUnit(fmtNum(Math.abs(t.slopePerWeek)), unit)} per week over ${t.n} runs.`);
  }

  if (s.lastEvent) {
    const e = s.lastEvent.event;
    const name = EVENT_LABELS[e.type] || EVENT_LABELS.other;
    out.push(`${name} on ${formatDay(e.at, result.now)}; ${plural(s.lastEvent.runsSince, 'run')} since.`);
  }

  if (s.suggestedTime) {
    const t = s.suggestedTime;
    out.push(`For ${withUnit(fmtNum(t.target), 'nm')}, ${t.verb} ~${t.minutes.toFixed(1)} min (${t.mmss}).`);
  }
  return out;
}
