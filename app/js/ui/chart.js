// @ts-check
/**
 * Hand-written SVG line chart (no library) of a value over time: points
 * joined by a line, nice 1-2-5 value ticks, local-date ticks and dashed
 * vertical markers for tool events (major: long, thick dashes; minor: dots).
 * Tapping a point rings it and writes "Oct 6 · 85 nm/min · label" under the
 * chart, with an Open button when onSelect is given; the arrow keys do the
 * same from the keyboard. Paint comes from theme tokens set inline as
 * var(--…), so both themes work even before chart.css loads. A visually
 * hidden table repeats every value for screen readers.
 */
import { h, svg, fill } from './dom.js';
import { button, emptyState } from './components.js';
import { DAY_MS, formatDay, formatDateTime, localDateKey } from '../core/time.js';
import { fmtNum, withUnit } from '../core/format.js';

/**
 * @typedef {Object} ChartPoint
 * @property {number} x epoch ms
 * @property {number} y
 * @property {string} [id]
 * @property {string} [label] shown after the value in the caption
 * @property {boolean} [hollow] drawn as a ring (e.g. a run from before the last clean)
 * @property {boolean} [highlight] drawn larger, with a halo
 */

/**
 * @typedef {Object} ChartEvent
 * @property {number} x epoch ms
 * @property {string} label short text drawn at the top of the marker
 * @property {boolean} major
 */

const W = 360; // viewBox width; text sizes are in the same units (about 1 px on a phone)
const FONT = 12;
const EVENT_FONT = 11;
const EM = 0.56; // average glyph width in em, used to fit labels
const HIT_R = 22; // tap radius around a point
const ROW = 14; // height of one row of event labels
const MIN_SPAN = 2 * DAY_MS; // narrowest date axis
const REACH_FLOOR = 30 * DAY_MS; // events within 10% of max(data span, this) are drawn
const LABEL_MAX = 14;
const HINT = 'Tap a point to see its value.';
const KEY_HINT = 'Use the left and right arrow keys to step through the points.';

const PAINT = {
  grid: 'stroke: var(--chart-grid); stroke-width: 1',
  ink2: 'fill: var(--text-2)',
  line: 'fill: none; stroke: var(--chart-line); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round',
  dot: 'fill: var(--chart-line); stroke: var(--surface); stroke-width: 2',
  ring: 'fill: var(--surface); stroke: var(--chart-line); stroke-width: 2',
  denseDot: 'fill: var(--chart-line); stroke: none',
  denseRing: 'fill: var(--surface); stroke: var(--chart-line); stroke-width: 1.5',
  halo: 'fill: none; stroke: var(--chart-line); stroke-width: 1.5',
  major: 'stroke: var(--warn); stroke-width: 2.5; stroke-dasharray: 7 4',
  minor: 'stroke: var(--text-2); stroke-width: 2; stroke-dasharray: 0.1 4.5; stroke-linecap: round',
  select: 'fill: none; stroke: var(--text); stroke-width: 2.5',
  guide: 'stroke: var(--text-2); stroke-width: 1',
};

/** @param {number} n */
const r1 = (n) => Math.round(n * 10) / 10;
/** @param {string} s @param {number} size @returns {number} estimated width in viewBox units */
const textWidth = (s, size) => s.length * size * EM;
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Nice 1-2-5 ticks for a value axis. The data range is padded by 8% (by 10%
 * of the value, or 1, when all values are equal), kept at 0 or above for
 * non-negative data, and covered as tightly as possible in 2 to
 * `maxIntervals` steps.
 * @param {number} min @param {number} max @param {number} [maxIntervals]
 * @returns {{lo: number, hi: number, ticks: number[], decimals: number}}
 */
export function niceTicks(min, max, maxIntervals = 5) {
  let lo = min;
  let hi = max;
  const pad = hi > lo ? (hi - lo) * 0.08 : Math.abs(lo) * 0.1 || 1;
  lo -= pad;
  hi += pad;
  if (min >= 0 && lo < 0) lo = 0;
  const e0 = Math.floor(Math.log10((hi - lo) / maxIntervals));
  let best = { step: 10 ** (e0 + 1), a: Math.floor(lo / 10 ** (e0 + 1)), b: Math.ceil(hi / 10 ** (e0 + 1)) };
  let bestScore = Infinity;
  for (let e = e0 - 1; e <= e0 + 2; e++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** e;
      const a = Math.floor(lo / step + 1e-9);
      const b = Math.ceil(hi / step - 1e-9);
      if (b - a < 2 || b - a > maxIntervals) continue;
      const score = (b - a) * step * (1 + Math.abs(b - a - 4) * 1e-6); // tightest, then about 4 steps
      if (score < bestScore) {
        bestScore = score;
        best = { step, a, b };
      }
    }
  }
  if (best.b <= best.a) best.b = best.a + 1;
  const decimals = Math.max(0, -Math.floor(Math.log10(best.step) + 1e-9));
  /** @type {number[]} */
  const ticks = [];
  for (let i = best.a; i <= best.b; i++) ticks.push(Number((i * best.step).toFixed(Math.min(decimals, 20))));
  return { lo: ticks[0], hi: ticks[ticks.length - 1], ticks, decimals };
}

/** @param {number} v @param {number} decimals @returns {string} "85", "0.5", "−20" */
function tickText(v, decimals) {
  return Math.abs(v) < 1e-12 ? '0' : v.toFixed(Math.min(decimals, 12)).replace('-', '−');
}

/** Date-tick steps, finest first. */
const STEPS = /** @type {[string, number][]} */ ([
  ['day', 1], ['day', 2], ['week', 1], ['week', 2], ['month', 1], ['month', 2], ['month', 3], ['month', 6],
  ['year', 1], ['year', 2], ['year', 5], ['year', 10], ['year', 25], ['year', 100],
]);

/**
 * Local-midnight tick times in [lo, hi] for one step (weeks start on
 * Mondays, months and years on their first day).
 * @param {string} unit @param {number} n @param {number} lo @param {number} hi
 * @returns {number[]} at most 61 ticks
 */
function stepTicks(unit, n, lo, hi) {
  const s = new Date(lo);
  let d;
  if (unit === 'day' || unit === 'week') {
    d = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    if (d.getTime() < lo) d.setDate(d.getDate() + 1);
    if (unit === 'week') d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
  } else if (unit === 'month') {
    d = new Date(s.getFullYear(), s.getMonth(), 1);
    while (d.getTime() < lo || d.getMonth() % n) d.setMonth(d.getMonth() + 1);
  } else {
    d = new Date(s.getFullYear(), 0, 1);
    while (d.getTime() < lo || d.getFullYear() % n) d.setFullYear(d.getFullYear() + 1);
  }
  /** @type {number[]} */
  const out = [];
  while (d.getTime() <= hi && out.length <= 60) {
    out.push(d.getTime());
    if (unit === 'day') d.setDate(d.getDate() + n);
    else if (unit === 'week') d.setDate(d.getDate() + 7 * n);
    else if (unit === 'month') d.setMonth(d.getMonth() + n);
    else d.setFullYear(d.getFullYear() + n);
  }
  return out;
}

/**
 * Date ticks at local midnights for [lo, hi]: the finest step (days, weeks,
 * months or years) whose labels fit side by side in `width`.
 * @param {number} lo epoch ms
 * @param {number} hi epoch ms
 * @param {number} width axis length in viewBox units
 * @param {(t: number) => string} label
 * @returns {{t: number, label: string}[]}
 */
export function dateTicks(lo, hi, width, label) {
  for (const [unit, n] of STEPS) {
    const ts = stepTicks(unit, n, lo, hi);
    if (!ts.length) continue;
    const labels = ts.map(label);
    const widest = Math.max(...labels.map((s) => textWidth(s, FONT)));
    if (ts.length <= Math.max(1, Math.floor(width / (widest + 14)))) return ts.map((t, i) => ({ t, label: labels[i] }));
  }
  return [{ t: lo, label: label(lo) }];
}

/**
 * Give each event label a row (0 nearest the plot, then 1) so labels never
 * overlap, major events first. A label that fits nowhere gets row -1; its
 * line is still drawn. Labels sit right of their line, or left of it near
 * the right edge.
 * @param {{e: ChartEvent, x: number}[]} items x in viewBox units
 * @returns {{e: ChartEvent, x: number, full: string, text: string, row: number, tx: number, anchor: string}[]}
 */
function placeEventLabels(items) {
  /** @type {[number, number][][]} */
  const rows = [[], []];
  const out = items.map(({ e, x }) => {
    const full = String(e.label || '').trim() || 'Event';
    const text = full.length > LABEL_MAX ? `${full.slice(0, LABEL_MAX - 1)}…` : full;
    return { e, x, full, text, row: -1, tx: x, anchor: 'start' };
  });
  for (const it of [...out].sort((a, b) => Number(!!b.e.major) - Number(!!a.e.major) || a.x - b.x)) {
    const w = textWidth(it.text, EVENT_FONT);
    const onRight = it.x + 4 + w <= W - 2;
    const x0 = onRight ? it.x + 4 : Math.max(2, it.x - 4 - w);
    const x1 = x0 + w;
    const r = rows.findIndex((taken) => taken.every(([a, b]) => x1 + 6 <= a || x0 >= b + 6));
    if (r < 0) continue;
    rows[r].push([x0, x1]);
    Object.assign(it, { row: r, tx: onRight ? x0 : x1, anchor: onRight ? 'start' : 'end' });
  }
  return out;
}

/**
 * A line chart of values over time.
 * @param {{points: ChartPoint[], events?: ChartEvent[], unit?: string, yLabel?: string, ariaLabel?: string,
 *   onSelect?: (p: ChartPoint) => void, height?: number}} o
 * @returns {HTMLElement} a <figure class="chart">
 */
export function lineChart({ points, events = [], unit = '', yLabel = '', ariaLabel, onSelect, height = 220 }) {
  const pts = (Array.isArray(points) ? points : [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x);
  if (!pts.length) return h('figure', { class: 'chart chart-empty' }, emptyState('No data to chart.'));
  const H = Number.isFinite(height) ? clamp(Math.round(height), 140, 800) : 220;
  const now = Date.now();

  // X domain: the data plus nearby events; far events are dropped.
  const first = pts[0].x;
  const last = pts[pts.length - 1].x;
  const reach = 0.1 * Math.max(last - first, REACH_FLOOR);
  const evs = (Array.isArray(events) ? events : [])
    .filter((e) => e && Number.isFinite(e.x) && e.x >= first - reach && e.x <= last + reach)
    .sort((a, b) => a.x - b.x);
  let lo = evs.length ? Math.min(first, evs[0].x) : first;
  let hi = evs.length ? Math.max(last, evs[evs.length - 1].x) : last;
  if (hi - lo < MIN_SPAN) {
    const mid = (lo + hi) / 2;
    lo = mid - MIN_SPAN / 2;
    hi = mid + MIN_SPAN / 2;
  }
  const padX = (hi - lo) * 0.04;
  lo -= padX;
  hi += padX;

  // Vertical layout: axis title, event-label rows, plot, date labels.
  const title = [yLabel, unit && (yLabel ? `(${unit})` : unit)].filter(Boolean).join(' ');
  const bandTop = title ? 22 : 6;
  const bottom = H - 24;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of pts) {
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  }
  const estTop = bandTop + Math.min(2, evs.length) * ROW + 8;
  const yt = niceTicks(yMin, yMax, clamp(Math.floor((bottom - estTop) / 26), 2, 7));
  const yTexts = yt.ticks.map((v) => tickText(v, yt.decimals));
  const left = clamp(Math.max(...yTexts.map((s) => textWidth(s, FONT))) + 10, 28, 96);
  const right = W - 12;
  const sx = (/** @type {number} */ x) => left + ((x - lo) / (hi - lo)) * (right - left);
  const labels = placeEventLabels(evs.map((e) => ({ e, x: sx(e.x) })));
  const rows = labels.reduce((n, l) => Math.max(n, l.row + 1), 0);
  const top = bandTop + rows * ROW + 8;
  const sy = (/** @type {number} */ y) => bottom - ((y - yt.lo) / (yt.hi - yt.lo)) * (bottom - top);
  const rowTop = (/** @type {number} */ r) => bandTop + (rows - 1 - r) * ROW;
  const pos = pts.map((p) => ({ x: r1(sx(p.x)), y: r1(sy(p.y)) }));

  // Date axis; the year shows when the axis spans years or is not this year.
  const spansYears = new Date(lo).getFullYear() !== new Date(hi).getFullYear();
  const dayLabel = (/** @type {number} */ t) => (spansYears ? `${formatDay(t)}, ${new Date(t).getFullYear()}` : formatDay(t, now));
  const xMarks = [];
  const xTexts = [];
  let lastEnd = -Infinity;
  for (const t of dateTicks(lo, hi, right - left, dayLabel)) {
    const x = r1(sx(t.t));
    const w = textWidth(t.label, FONT);
    const cx = clamp(x, 2 + w / 2, W - 2 - w / 2);
    if (cx - w / 2 < lastEnd + 8) continue;
    lastEnd = cx + w / 2;
    xMarks.push(svg('line', { x1: x, x2: x, y1: bottom, y2: bottom + 4 }));
    xTexts.push(svg('text', { x: r1(cx), y: bottom + 17 }, t.label));
  }

  const eventLines = labels.map((l) => svg('line', {
    x1: r1(l.x), x2: r1(l.x), y1: l.row >= 0 ? rowTop(l.row) + 1 : top, y2: bottom, style: l.e.major ? PAINT.major : PAINT.minor,
  }, svg('title', null, `${l.full}: ${l.e.major ? 'major' : 'minor'} event, ${formatDateTime(l.e.x, now)}`)));
  const eventTexts = labels.filter((l) => l.row >= 0).map((l) => svg('text', {
    x: r1(l.tx), y: rowTop(l.row) + 11, 'text-anchor': l.anchor, 'font-size': EVENT_FONT,
    style: `fill: var(${l.e.major ? '--text' : '--text-2'}); font-weight: ${l.e.major ? 650 : 400}; `
      + 'stroke: var(--surface); stroke-width: 3; stroke-linejoin: round; paint-order: stroke',
  }, l.text));

  // Points closer than 9 units get smaller marks without the surface ring, so the line stays visible.
  const dense = (right - left) / pts.length < 9;
  const marks = pts.map((p, i) => {
    const { x, y } = pos[i];
    const r = (p.highlight ? 6 : 4) - (dense ? 1.5 : 0);
    const dot = p.hollow
      ? svg('circle', { cx: x, cy: y, r, style: dense ? PAINT.denseRing : PAINT.ring })
      : svg('circle', { cx: x, cy: y, r: dense ? r : r + 1, style: dense ? PAINT.denseDot : PAINT.dot });
    return p.highlight ? [svg('circle', { cx: x, cy: y, r: r + 4, style: PAINT.halo }), dot] : dot;
  });

  // Summary for assistive technology.
  const name = String(ariaLabel || title || 'Chart').trim().replace(/[.:;,]+$/, '');
  const span = pts.length === 1 ? `1 point on ${formatDay(first, now)}`
    : `${pts.length} points from ${formatDay(first, now)} to ${formatDay(last, now)}`;
  const values = yMin === yMax ? `${pts.length > 1 ? 'all ' : ''}${withUnit(fmtNum(yMin), unit)}`
    : `${fmtNum(yMin)} to ${withUnit(fmtNum(yMax), unit)}`;
  const evText = evs.length ? `; ${evs.length} tool event${evs.length === 1 ? '' : 's'} marked` : '';

  const selGuide = svg('line', { y2: bottom, style: PAINT.guide, visibility: 'hidden', 'vector-effect': 'non-scaling-stroke' });
  const selRing = svg('circle', { r: 10, style: PAINT.select, visibility: 'hidden' });
  const svgEl = /** @type {SVGSVGElement} */ (svg('svg', {
    class: 'chart-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${name}: ${span}, ${values}${evText}.`,
    tabindex: 0, 'font-size': FONT,
    style: `display: block; width: 100%; max-width: 720px; height: auto; aspect-ratio: ${W} / ${H}; margin: 0 auto; touch-action: manipulation`,
  },
  title ? svg('text', { x: 2, y: 14, style: `${PAINT.ink2}; font-weight: 600` }, title) : null,
  svg('g', { style: PAINT.grid, 'shape-rendering': 'crispEdges' }, yt.ticks.map((v) => {
    const y = r1(sy(v));
    return svg('line', { x1: left, x2: right, y1: y, y2: y, 'vector-effect': 'non-scaling-stroke' });
  }), xMarks),
  svg('g', { style: PAINT.ink2, 'text-anchor': 'end' }, yt.ticks.map((v, i) => svg('text', { x: left - 6, y: r1(sy(v) + 4) }, yTexts[i]))),
  svg('g', { style: PAINT.ink2, 'text-anchor': 'middle' }, xTexts),
  selGuide,
  eventLines,
  pts.length > 1 ? svg('polyline', { points: pos.map((q) => `${q.x},${q.y}`).join(' '), style: PAINT.line }) : null,
  marks,
  eventTexts,
  selRing,
  svg('g', { style: 'fill: transparent' }, pos.map((q) => svg('circle', { class: 'chart-hit', cx: q.x, cy: q.y, r: HIT_R })))));

  // Caption: the selected point, and Open when the caller can open it.
  /** @type {Map<string, number>} */
  const perDay = new Map();
  for (const p of pts) perDay.set(localDateKey(p.x), (perDay.get(localDateKey(p.x)) || 0) + 1);
  const when = (/** @type {ChartPoint} */ p) => ((perDay.get(localDateKey(p.x)) || 0) > 1 ? formatDateTime(p.x, now) : formatDay(p.x, now));
  const readout = h('p', { class: 'chart-readout is-hint', 'aria-live': 'polite' }, HINT);
  let sel = -1;
  const openBtn = onSelect ? button('Open', { onClick: () => { if (sel >= 0) onSelect(pts[sel]); } }) : null;
  if (openBtn) openBtn.hidden = true;
  const select = (/** @type {number} */ i) => {
    sel = i;
    const on = i >= 0;
    for (const el of [selGuide, selRing]) el.setAttribute('visibility', on ? 'visible' : 'hidden');
    readout.classList.toggle('is-hint', !on);
    if (openBtn) openBtn.hidden = !on;
    if (!on) {
      fill(readout, HINT);
      return;
    }
    const p = pts[i];
    const { x, y } = pos[i];
    const ring = p.highlight ? 12 : 9;
    // A drop line from the ring to the date axis, solid so it never reads as an event marker.
    selGuide.setAttribute('x1', String(x));
    selGuide.setAttribute('x2', String(x));
    selGuide.setAttribute('y1', String(Math.min(bottom, y + ring)));
    selRing.setAttribute('cx', String(x));
    selRing.setAttribute('cy', String(y));
    selRing.setAttribute('r', String(ring));
    fill(readout, h('strong', null, `${when(p)} · ${withUnit(fmtNum(p.y), unit)}`), p.label ? ` · ${p.label}` : null);
  };
  /** @param {MouseEvent} e @returns {{x: number, y: number}} the pointer in viewBox units */
  const toViewBox = (e) => {
    const m = svgEl.getScreenCTM();
    if (m) return new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const b = svgEl.getBoundingClientRect();
    return { x: ((e.clientX - b.left) * W) / (b.width || 1), y: ((e.clientY - b.top) * H) / (b.height || 1) };
  };
  svgEl.addEventListener('click', (e) => {
    const at = toViewBox(e);
    let best = -1;
    let bestD = HIT_R * HIT_R;
    pos.forEach((q, i) => {
      const d = (q.x - at.x) ** 2 + (q.y - at.y) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    select(best);
  });
  svgEl.addEventListener('keydown', (e) => {
    const n = pts.length;
    const go = { ArrowRight: sel < 0 ? 0 : Math.min(n - 1, sel + 1), ArrowLeft: sel < 0 ? n - 1 : Math.max(0, sel - 1), Home: 0, End: n - 1 };
    if (Object.prototype.hasOwnProperty.call(go, e.key)) select(go[/** @type {keyof typeof go} */ (e.key)]);
    else if (e.key === 'Escape' && sel >= 0) select(-1);
    else if ((e.key === 'Enter' || e.key === ' ') && sel >= 0 && onSelect) onSelect(pts[sel]);
    else return;
    e.preventDefault();
  });
  svgEl.addEventListener('focus', () => {
    let keyboard = false;
    try { keyboard = svgEl.matches(':focus-visible'); } catch { /* older browsers */ }
    if (sel < 0 && keyboard) readout.textContent = KEY_HINT;
  });
  svgEl.addEventListener('blur', () => { if (sel < 0) readout.textContent = HINT; });

  // The same data as a table, for screen readers.
  const tableRows = [
    ...pts.map((p) => ({ x: p.x, cells: [when(p), fmtNum(p.y), [p.label, p.hollow && 'hollow marker', p.highlight && 'highlighted'].filter(Boolean).join('; ')] })),
    ...evs.map((e) => ({ x: e.x, cells: [formatDay(e.x, now), '', `${e.major ? 'Major' : 'Minor'} tool event: ${String(e.label || 'Event')}`] })),
  ].sort((a, b) => a.x - b.x);
  const table = h('table', null,
    h('caption', null, name),
    h('thead', null, h('tr', null, ['Date', title || 'Value', 'Note'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', null, tableRows.map((r) => h('tr', null, r.cells.map((c) => h('td', null, c))))));

  // data-events: how many event markers were drawn (far ones are dropped), for legends.
  return h('figure', { class: 'chart', dataset: { events: String(evs.length) } }, svgEl,
    h('div', { class: 'chart-caption' }, readout, openBtn), h('div', { class: 'visually-hidden' }, table));
}
