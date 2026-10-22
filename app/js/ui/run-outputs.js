// @ts-check
/**
 * Run detail parts: the results list (derived values marked, manual values
 * editable, "Use derived" to go back) and the measurement list.
 */
import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, badge, listRow, emptyState, helpToggle, labelRow } from './components.js';
import { numberStepper, renderField, durationInput, signedField } from './fields.js';
import { computeDerived, pointStats, missingTimeField, DERIVED_INFO } from '../core/derive.js';
import { fmtValue, fmtNum } from '../core/format.js';
import { formatDateTime } from '../core/time.js';
import { KIND_LABELS, PHASE_LABELS } from '../core/vocab.js';
import { fieldHelp } from '../core/field-help.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').Template} Template */
/** @typedef {import('../core/types.js').Measurement} Measurement */
/** @typedef {import('../core/types.js').FieldValue} FieldValue */

/**
 * The run's time, asked for where the rate needs it: the measurements are
 * in, and only the time is missing.
 * @param {Template} t
 * @param {string} key the time field
 * @param {(seconds: number | null) => void} onTime
 * @returns {HTMLElement}
 */
function timeCard(t, key, onTime) {
  const f = t.fields.find((x) => x.key === key);
  const id = uid('runtime');
  const rates = (t.derived || []).filter((d) => DERIVED_INFO[d.fn]?.usesTime)
    .map((d) => t.fields.find((x) => x.key === d.output)?.label).filter(Boolean).join(' and ');
  return h('div', { class: 'card stack needs-time' },
    h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: id }, `${f ? f.label : 'Time'} of the run (mm:ss)`), 'Run time', HELP.runTime),
      durationInput({ id, label: f ? f.label : 'time', value: null, step: f && f.step ? f.step : 10, onChange: onTime }).el,
      h('p', { class: 'field-note warn' }, `The measurements are in: ${rates || 'the rate'} only needs the run’s time.`)));
}

/**
 * The results while a run has none: what they come from and what they are
 * waiting for, with a way to type them in by hand.
 * @param {Template} t
 * @param {Record<string, string>} missing reasons from computeDerived
 * @param {() => void} onExpand
 * @returns {HTMLElement}
 */
function waitingCard(t, missing, onExpand) {
  const outputs = t.fields.filter((f) => f.role === 'output');
  const main = outputs.find((f) => f.key === t.primaryOutput) || outputs[0];
  const why = main && missing[main.key] ? `${main.label}: ${missing[main.key]}.` : '';
  const derived = (t.derived || []).length > 0;
  return h('div', { class: 'card stack' },
    h('p', null, derived ? 'Worked out from the measurements: ' : 'To fill in: ', outputs.map((f) => f.label).join(', '), '.'),
    why ? h('p', { class: 'muted small' }, why) : null,
    h('div', { class: 'row-wrap' }, button('Type a result by hand', { icon: 'edit', onClick: onExpand })));
}

/**
 * One row per output field.
 * - Derived values are read-only and marked; "Edit" turns them into a manual value.
 * - Manual values are editable; "Use derived" removes them when a derived value exists.
 * - Empty outputs with a derivation say what is missing.
 * - While no output has a value, one card says what the results wait for (unless `expanded`).
 * - When a rate waits only for the run's time, a time box comes first.
 * @param {{run: Run, template: Template, measurements: Measurement[],
 *   onManual: (key: string, v: FieldValue) => void, onUseDerived: (key: string) => void,
 *   expanded?: boolean, onExpand?: () => void, onTime?: (key: string, seconds: number | null) => void}} o
 * @returns {HTMLElement}
 */
export function outputsList(o) {
  const outputs = o.template.fields.filter((f) => f.role === 'output');
  if (!outputs.length) return emptyState('This template has no output fields.');
  const { values, missing } = computeDerived(o.run, o.template, o.measurements);
  const timeKey = o.onTime ? missingTimeField(o.run, o.template, o.measurements) : null;
  const time = timeKey && o.onTime ? timeCard(o.template, timeKey, (s) => o.onTime?.(timeKey, s)) : null;
  const anySet = outputs.some((f) => o.run.results && o.run.results[f.key] !== undefined && o.run.results[f.key] !== null && o.run.results[f.key] !== '');
  if (!anySet && !o.expanded && o.onExpand) return h('div', { class: 'stack' }, time, waitingCard(o.template, missing, o.onExpand));
  const rows = outputs.map((f) => {
    const spec = (o.template.derived || []).find((d) => d.output === f.key);
    const v = o.run.results ? o.run.results[f.key] : undefined;
    const isDerived = (o.run.derivedKeys || []).includes(f.key) && typeof v === 'number';
    const id = uid(f.key);
    const editable = !isDerived && f.type === 'number';
    const help = helpToggle(f.label, fieldHelp(f, o.template));
    const head = h('div', { class: 'spread' },
      h('span', { class: 'label-help' },
        h(editable ? 'label' : 'span', { class: 'label', for: editable ? id : undefined }, f.label, f.unit ? h('span', { class: 'unit' }, ` (${f.unit})`) : null),
        help.btn),
      isDerived ? badge('derived', 'ok', 'check') : v !== undefined && v !== null && v !== '' ? badge('manual', 'muted', 'edit') : null);
    if (isDerived) {
      return h('div', { class: 'card stack' }, head, help.note,
        h('div', { class: 'spread' }, h('strong', { class: 'big-value' }, fmtValue(/** @type {number} */ (v), f.unit)),
          button('Edit', { kind: 'ghost', icon: 'edit', onClick: () => o.onManual(f.key, /** @type {number} */ (v)) })),
        spec ? h('p', { class: 'field-note' }, `From measurements: ${DERIVED_INFO[spec.fn]?.formula || spec.fn}`) : null);
    }
    const derivable = spec && f.key in values;
    const note = spec
      ? derivable ? null : h('p', { class: 'field-note' }, `Derived value: ${missing[f.key] || 'not available'}.`)
      : null;
    if (!editable) {
      // A text, choice or yes/no output: renderField brings its own label.
      return h('div', { class: 'card stack' }, renderField(f, v, (nv) => o.onManual(f.key, nv), { template: o.template }), note);
    }
    const field = h('div', { class: 'field' }, numberStepper({
      id, label: f.label, value: typeof v === 'number' ? v : null, step: f.step, min: f.min, max: f.max, signed: signedField(f),
      onChange: (nv) => o.onManual(f.key, nv),
    }).el);
    return h('div', { class: 'card stack' }, head, help.note, field, note,
      derivable ? button(`Use derived (${fmtValue(values[f.key], f.unit)})`, {
        icon: 'undo', onClick: () => o.onUseDerived(f.key),
      }) : null);
  });
  return h('div', { class: 'stack' }, time, rows);
}

/**
 * @param {Measurement} m
 * @param {Map<string, import('../core/types.js').Tool>} tools
 * @param {number} now
 * @returns {HTMLElement}
 */
function measurementRow(m, tools, now) {
  const st = pointStats(m.points);
  const tool = m.metrologyToolId ? tools.get(m.metrologyToolId) : null;
  const unit = m.unit || '';
  const parts = st ? [
    `mean ${fmtValue(st.mean, unit)}`,
    `${st.n} pt${st.n === 1 ? '' : 's'}`,
    st.n > 1 && st.uniformity !== null ? `U ${fmtNum(st.uniformity)}%` : null,
  ] : ['no points'];
  return listRow({
    title: `${PHASE_LABELS[m.phase] || m.phase} · ${KIND_LABELS[m.kind] || m.kind}${m.material ? ` · ${m.material}` : ''}`,
    subtitle: [...parts, tool ? tool.shortName || tool.name : null, formatDateTime(m.takenAt, now)].filter(Boolean).join(' · '),
    href: `#/measure/${m.id}`,
    lead: icon('ruler'),
  });
}

/**
 * @param {{runId: string, measurements: Measurement[], tools: Map<string, import('../core/types.js').Tool>}} o
 * @returns {HTMLElement}
 */
export function measurementList(o) {
  const now = Date.now();
  const sorted = [...o.measurements].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  return h('div', { class: 'stack' },
    sorted.length
      ? h('div', { class: 'list' }, sorted.map((m) => measurementRow(m, o.tools, now)))
      : h('p', { class: 'muted' }, 'No measurements yet. Add the pre measurement before the run and the post measurement after.'),
    h('a', { class: 'btn btn-secondary btn-big', href: `#/run/${o.runId}/measure` }, icon('plus'), h('span', null, 'Add measurement')));
}
