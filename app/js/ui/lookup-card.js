// @ts-check
/**
 * Lookup results parts: the summary card, ranked match rows with signed
 * differences and flags, and the "no matches" card with relax suggestions.
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { button, badge, listRow } from './components.js';
import { fmtNum, fmtSigned, fmtValue, fmtRange } from '../core/format.js';
import { formatDay, formatMmSs } from '../core/time.js';
import { matchFlags } from '../core/similarity.js';

/** @typedef {import('../core/similarity.js').LookupResult} LookupResult */
/** @typedef {import('../core/summary.js').Summary} Summary */

const CONFIDENCE = {
  high: { text: 'High confidence', kind: 'ok', icon: 'check' },
  medium: { text: 'Medium confidence', kind: 'info', icon: 'info' },
  low: { text: 'Low confidence', kind: 'warn', icon: 'alert' },
};

/**
 * The suggested time with its range. The range comes from the closest runs'
 * rates; an estimate adjusted beyond them (extrapolated) can fall outside
 * it, and then the card says so instead of showing a range that seems not
 * to contain its own value.
 * @param {NonNullable<Summary['suggestedTime']>} t
 * @returns {HTMLElement}
 */
function suggestedTime(t) {
  const lo = t.rangeMin;
  const hi = t.rangeMax;
  const range = typeof lo === 'number' && typeof hi === 'number' ? `${formatMmSs(lo * 60)}–${formatMmSs(hi * 60)}` : '';
  const outside = !!range && (t.minutes < /** @type {number} */ (lo) - 1e-9 || t.minutes > /** @type {number} */ (hi) + 1e-9);
  return h('div', { class: 'suggest' }, icon('timer'),
    h('div', { class: 'stack suggest-text' },
      h('span', null, h('strong', null, `Suggested time ${t.mmss}`), h('span', { class: 'muted' }, ` for ${fmtNum(t.target)} nm`)),
      range ? h('span', { class: 'muted small' }, outside
        ? `The closest runs alone would take ${range}; this estimate is beyond them.`
        : `Range from the closest runs: ${range}.`) : null));
}

/**
 * @param {Summary} s
 * @returns {HTMLElement}
 */
export function summaryCard(s) {
  const conf = CONFIDENCE[s.confidence.level] || CONFIDENCE.medium;
  const head = s.headline;
  const avg = s.average;
  return h('div', { class: 'card summary-card stack' },
    h('div', { class: 'spread' }, h('span', { class: 'label' }, s.outputLabel),
      badge(conf.text, /** @type {any} */ (conf.kind), conf.icon)),
    head ? h('div', null,
      h('div', { class: 'headline' }, fmtValue(head.value, s.unit)),
      h('p', { class: 'muted' }, [head.label,
        avg && avg.n > 1 ? `range ${fmtRange(avg.min, avg.max, s.unit)} in the ${avg.n < s.n ? `closest ${avg.n} of ${s.n}` : avg.n} runs` : null,
      ].filter(Boolean).join(' · '))) : null,
    s.warnings.length ? h('div', { class: 'stack' }, s.warnings.map((w) => h('p', { class: 'warn-line' }, icon('alert', { size: 18 }), h('span', null, w)))) : null,
    s.suggestedTime ? suggestedTime(s.suggestedTime) : null,
    s.sentences.length ? h('ul', { class: 'sentences' }, s.sentences.map((t) => h('li', null, t))) : null,
    s.confidence.reasons.length ? h('details', { class: 'more' }, h('summary', null, 'Why this confidence?'),
      h('ul', { class: 'sentences' }, s.confidence.reasons.map((r) => h('li', null, r)))) : null);
}

/**
 * One ranked match: date and output value, distance and weight, signed
 * differences from the query ("ICP power +50 W") and flags.
 * @param {import('../core/similarity.js').Match} m
 * @param {{outputKey: string, unit: string, toolName: (id: string) => string, showTool: boolean, now: number}} o
 * @returns {HTMLElement}
 */
export function matchRow(m, o) {
  const v = m.run.results ? m.run.results[o.outputKey] : undefined;
  const value = typeof v === 'number' ? fmtValue(v, o.unit) : 'no value';
  const diffs = m.diffs.map((d) => {
    if (d.missing) return `${d.label} not recorded`;
    if (typeof d.delta === 'number') return `${d.label} ${fmtSigned(d.delta)}${d.unit ? ` ${d.unit}` : ''}`;
    return `${d.label}: ${d.r}`;
  });
  const flags = matchFlags(m).map((f) => (f === 'Exact match' ? badge(f, 'ok', 'check') : badge(f, 'warn', 'flag')));
  return listRow({
    title: `${formatDay(m.run.startedAt, o.now)}${o.showTool ? ` · ${o.toolName(m.run.toolId)}` : ''} · ${value}`,
    subtitle: diffs.length ? diffs.join(' · ') : 'Same inputs as your query',
    meta: h('span', { class: 'match-meta' }, `d ${fmtNum(m.d, 2)}`, h('br'), `w ${fmtNum(m.w, 2)}`),
    badges: flags,
    href: `#/run/${m.run.id}`,
  });
}

/**
 * Shown when no run passes the filters: offer the relaxed options that
 * would add runs.
 * @param {LookupResult} r
 * @param {(option: 'strictChemistry' | 'sameMaterial' | 'includeSiblings') => void} onRelax
 * @returns {HTMLElement}
 */
export function noMatchesCard(r, onRelax) {
  const options = [
    { key: /** @type {const} */ ('strictChemistry'), label: 'Turn off Strict chemistry' },
    { key: /** @type {const} */ ('sameMaterial'), label: 'Turn off Same material' },
    { key: /** @type {const} */ ('includeSiblings'), label: 'Include sibling tools' },
  ].filter((x) => r.relax[x.key] > 0);
  return h('div', { class: 'card stack' },
    h('h2', null, 'No similar runs'),
    options.length
      ? h('p', null, 'No complete run with results passes the filters. Relaxing one would add runs:')
      : h('p', null, 'There are no complete runs with results to compare yet, even with relaxed filters. Log runs and add measurements first.'),
    options.map((x) => button(`${x.label} (+${r.relax[x.key]} run${r.relax[x.key] === 1 ? '' : 's'})`, {
      icon: 'filter', big: true, onClick: () => onRelax(x.key),
    })));
}
