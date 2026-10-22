// @ts-check
/**
 * Hand-written SVG scatter chart of a result against one input (etch rate
 * against ICP power), with a least-squares line when the input varies.
 * Points before the latest major tool event are hollow, as in the line
 * chart; a point can be drawn fainter (`fade`) or highlighted. Tapping a
 * point writes its values under the chart, with an Open button when
 * onSelect is given; the arrow keys step through the points. A visually
 * hidden table repeats the values for screen readers.
 */
import { h, svg, fill } from './dom.js';
import { button, emptyState, section, segmented } from './components.js';
import { niceTicks } from './chart.js';
import { linearFit, isNum } from '../core/stats.js';
import { fmtNum, fmtSigned, withUnit } from '../core/format.js';
import { variedInputs, scatterSeries } from '../core/search.js';
import { formatDay } from '../core/time.js';
import { HELP } from '../core/app-help.js';

/**
 * @typedef {Object} ScatterPoint
 * @property {number} x the input's value
 * @property {number} y the result
 * @property {string} [id]
 * @property {string} [label] shown after the values (the run's date)
 * @property {boolean} [hollow]
 * @property {boolean} [highlight]
 * @property {number} [fade] 0 (solid) to 1 (faint)
 */

const W = 360;
const H = 230;
const FONT = 12;
const EM = 0.56;
const HIT_R = 22;
const HINT = 'Tap a point to see its values.';
const PAINT = {
  grid: 'stroke: var(--chart-grid); stroke-width: 1',
  ink2: 'fill: var(--text-2)',
  dot: 'fill: var(--chart-line); stroke: var(--surface); stroke-width: 1.5',
  ring: 'fill: var(--surface); stroke: var(--chart-line); stroke-width: 2',
  halo: 'fill: none; stroke: var(--chart-line); stroke-width: 1.5',
  fit: 'stroke: var(--warn); stroke-width: 2; stroke-dasharray: 6 4',
  select: 'fill: none; stroke: var(--text); stroke-width: 2.5',
};

/** @param {number} n */
const r1 = (n) => Math.round(n * 10) / 10;
/** @param {string} s */
const textWidth = (s) => s.length * FONT * EM;
/** @param {number} v @param {number} d */
const tick = (v, d) => (Math.abs(v) < 1e-12 ? '0' : v.toFixed(Math.min(d, 12)).replace('-', '−'));

/**
 * @param {{points: ScatterPoint[], xLabel: string, xUnit?: string, yLabel: string, yUnit?: string, ariaLabel?: string,
 *   fit?: boolean, onSelect?: (p: ScatterPoint) => void}} o
 * @returns {HTMLElement} a <figure class="chart">
 */
export function scatterChart(o) {
  const pts = (o.points || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return h('figure', { class: 'chart chart-empty' }, emptyState('No data to chart.'));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xt = niceTicks(Math.min(...xs), Math.max(...xs), 5);
  const yt = niceTicks(Math.min(...ys), Math.max(...ys), 5);
  const yTexts = yt.ticks.map((v) => tick(v, yt.decimals));
  const yTitle = [o.yLabel, o.yUnit && `(${o.yUnit})`].filter(Boolean).join(' ');
  const xTitle = [o.xLabel, o.xUnit && `(${o.xUnit})`].filter(Boolean).join(' ');
  const left = Math.min(96, Math.max(28, Math.max(...yTexts.map(textWidth)) + 10));
  const right = W - 12;
  const top = 26;
  const bottom = H - 40;
  const sx = (/** @type {number} */ x) => left + ((x - xt.lo) / (xt.hi - xt.lo)) * (right - left);
  const sy = (/** @type {number} */ y) => bottom - ((y - yt.lo) / (yt.hi - yt.lo)) * (bottom - top);
  const pos = pts.map((p) => ({ x: r1(sx(p.x)), y: r1(sy(p.y)) }));
  const line = o.fit === false ? null : linearFit(xs, ys);

  const marks = pts.map((p, i) => {
    const { x, y } = pos[i];
    const opacity = Math.max(0.3, 1 - Math.min(1, Math.max(0, p.fade || 0)) * 0.7);
    const r = p.highlight ? 6 : 4.5;
    const dot = svg('circle', { cx: x, cy: y, r, style: `${p.hollow ? PAINT.ring : PAINT.dot}; opacity: ${opacity}` });
    return p.highlight ? [svg('circle', { cx: x, cy: y, r: r + 4, style: PAINT.halo }), dot] : dot;
  });
  // The line's ends are not clamped (that would bend its slope): the clip path keeps it in the plot.
  const fitLine = line ? svg('line', {
    x1: r1(sx(xt.lo)), x2: r1(sx(xt.hi)), y1: r1(sy(line.intercept + line.slope * xt.lo)),
    y2: r1(sy(line.intercept + line.slope * xt.hi)), style: PAINT.fit,
  }) : null;
  const clipId = `sc-${Math.random().toString(36).slice(2, 8)}`;
  const selRing = svg('circle', { r: 10, style: PAINT.select, visibility: 'hidden' });
  const name = String(o.ariaLabel || `${o.yLabel} against ${o.xLabel}`);
  const svgEl = /** @type {SVGSVGElement} */ (svg('svg', {
    class: 'chart-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0, 'font-size': FONT,
    'aria-label': `${name}: ${pts.length} point${pts.length === 1 ? '' : 's'}${line ? `, fitted slope ${fmtSigned(line.slope)} ${o.yUnit || ''} per ${o.xUnit || 'unit'}` : ''}.`,
    style: `display: block; width: 100%; max-width: 720px; height: auto; aspect-ratio: ${W} / ${H}; margin: 0 auto; touch-action: manipulation`,
  },
  svg('defs', null, svg('clipPath', { id: clipId }, svg('rect', { x: left, y: top, width: right - left, height: bottom - top }))),
  yTitle ? svg('text', { x: 2, y: 14, style: `${PAINT.ink2}; font-weight: 600` }, yTitle) : null,
  svg('g', { style: PAINT.grid, 'shape-rendering': 'crispEdges' },
    yt.ticks.map((v) => svg('line', { x1: left, x2: right, y1: r1(sy(v)), y2: r1(sy(v)) })),
    xt.ticks.map((v) => svg('line', { x1: r1(sx(v)), x2: r1(sx(v)), y1: bottom, y2: bottom + 4 }))),
  svg('g', { style: PAINT.ink2, 'text-anchor': 'end' }, yt.ticks.map((v, i) => svg('text', { x: left - 6, y: r1(sy(v) + 4) }, yTexts[i]))),
  svg('g', { style: PAINT.ink2, 'text-anchor': 'middle' }, xt.ticks.map((v) => svg('text', { x: r1(sx(v)), y: bottom + 17 }, tick(v, xt.decimals)))),
  xTitle ? svg('text', { x: r1((left + right) / 2), y: H - 4, 'text-anchor': 'middle', style: `${PAINT.ink2}; font-weight: 600` }, xTitle) : null,
  fitLine ? svg('g', { 'clip-path': `url(#${clipId})` }, fitLine) : null,
  marks,
  selRing,
  svg('g', { style: 'fill: transparent' }, pos.map((q) => svg('circle', { class: 'chart-hit', cx: q.x, cy: q.y, r: HIT_R })))));

  const readout = h('p', { class: 'chart-readout is-hint', 'aria-live': 'polite' }, HINT);
  let sel = -1;
  const openBtn = o.onSelect ? button('Open', { onClick: () => { if (sel >= 0) o.onSelect?.(pts[sel]); } }) : null;
  if (openBtn) openBtn.hidden = true;
  const select = (/** @type {number} */ i) => {
    sel = i;
    selRing.setAttribute('visibility', i >= 0 ? 'visible' : 'hidden');
    readout.classList.toggle('is-hint', i < 0);
    if (openBtn) openBtn.hidden = i < 0;
    if (i < 0) { fill(readout, HINT); return; }
    selRing.setAttribute('cx', String(pos[i].x));
    selRing.setAttribute('cy', String(pos[i].y));
    const p = pts[i];
    fill(readout, h('strong', null, `${o.xLabel} ${withUnit(fmtNum(p.x), o.xUnit || '')} · ${withUnit(fmtNum(p.y), o.yUnit || '')}`),
      p.label ? ` · ${p.label}` : null);
  };
  svgEl.addEventListener('click', (e) => {
    const m = svgEl.getScreenCTM();
    const at = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : { x: -1e9, y: -1e9 };
    let best = -1;
    let bestD = HIT_R * HIT_R;
    pos.forEach((q, i) => {
      const d = (q.x - at.x) ** 2 + (q.y - at.y) ** 2;
      if (d <= bestD) { bestD = d; best = i; }
    });
    select(best);
  });
  // Keyboard order follows the input, left to right.
  const order = pts.map((_, i) => i).sort((a, b) => pts[a].x - pts[b].x || pts[a].y - pts[b].y);
  svgEl.addEventListener('keydown', (e) => {
    const at = order.indexOf(sel);
    const n = order.length;
    /** @type {Record<string, number>} */
    const go = { ArrowRight: at < 0 ? 0 : Math.min(n - 1, at + 1), ArrowLeft: at < 0 ? n - 1 : Math.max(0, at - 1), Home: 0, End: n - 1 };
    if (e.key in go) select(order[go[e.key]]);
    else if (e.key === 'Escape' && sel >= 0) select(-1);
    else if ((e.key === 'Enter' || e.key === ' ') && sel >= 0 && o.onSelect) o.onSelect(pts[sel]);
    else return;
    e.preventDefault();
  });
  const fitText = line ? h('p', { class: 'muted small chart-legend' },
    `Dashed line: least-squares fit, ${fmtSigned(line.slope)} ${o.yUnit || ''} per ${o.xUnit || 'unit'} of ${o.xLabel} (${line.n} runs).`) : null;
  const table = h('table', null, h('caption', null, name),
    h('thead', null, h('tr', null, [xTitle || 'Input', yTitle || 'Result', 'Note'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', null, order.map((i) => h('tr', null, [fmtNum(pts[i].x), fmtNum(pts[i].y), [pts[i].label, pts[i].hollow && 'before the latest major tool event'].filter(Boolean).join('; ')]
      .map((c) => h('td', null, c))))));
  return h('figure', { class: 'chart' }, svgEl, h('div', { class: 'chart-caption' }, readout, openBtn), fitText,
    h('div', { class: 'visually-hidden' }, table));
}

/**
 * A titled section with a result against one input of a template, for
 * every numeric input that takes at least two values among the plotted
 * runs: the complete ones with a value for the result (how the rate moves
 * with power, pressure or a gas flow), with a choice of input.
 * @param {{runs: import('../core/types.js').Run[], template: import('../core/types.js').Template,
 *   output: import('../core/types.js').FieldSpec, fade?: (runId: string) => number,
 *   planned?: Record<string, unknown>, note: string, onSelect: (runId: string) => void}} o
 *   runs: the runs to plot (complete ones with both values count); fade: how faint each run's point is;
 *   planned: the planned inputs, named under the chart
 * @returns {HTMLElement | null} null when no input varies
 */
export function inputScatter(o) {
  const plotted = o.runs.filter((r) => r && !r.deleted && r.status === 'complete' && isNum(r.results ? r.results[o.output.key] : undefined));
  const inputs = variedInputs(o.template, plotted);
  if (!inputs.length) return null;
  const slot = h('div');
  const draw = (/** @type {string} */ key) => {
    const f = /** @type {import('../core/types.js').FieldSpec} */ (inputs.find((x) => x.key === key));
    const points = scatterSeries(o.runs, key, o.output.key).map((p) => ({
      x: p.x, y: p.y, id: p.run.id, label: formatDay(p.run.startedAt, Date.now()), fade: o.fade ? o.fade(p.run.id) : 0,
    }));
    const planned = o.planned ? o.planned[key] : undefined;
    fill(slot, scatterChart({
      points, xLabel: f.label, xUnit: f.unit || '', yLabel: o.output.label, yUnit: o.output.unit || '', fit: true,
      ariaLabel: `${o.output.label} against ${f.label}`, onSelect: (p) => { if (p.id) o.onSelect(p.id); },
    }), typeof planned === 'number' ? h('p', { class: 'muted small' }, `Planned ${f.label}: ${fmtNum(planned)}${f.unit ? ` ${f.unit}` : ''}.`) : null);
  };
  draw(inputs[0].key);
  return section(`${o.output.label} against an input`,
    segmented({
      label: 'Input', compact: true, help: HELP.scatterInput, value: inputs[0].key, options: inputs.slice(0, 6).map((f) => ({ value: f.key, label: f.label })),
      onChange: (v) => { if (v) draw(v); },
    }),
    slot,
    h('p', { class: 'muted small' }, o.note));
}
