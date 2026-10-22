// @ts-check
/**
 * Run detail parts: the results list (derived values marked, manual values
 * editable, "Use derived" to go back) and the measurement list.
 */
import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, badge, listRow, emptyState, helpToggle } from './components.js';
import { numberStepper, renderField } from './fields.js';
import { computeDerived, pointStats, DERIVED_INFO } from '../core/derive.js';
import { fmtValue, fmtNum } from '../core/format.js';
import { formatDateTime } from '../core/time.js';
import { KIND_LABELS, PHASE_LABELS } from '../core/vocab.js';
import { fieldHelp } from '../core/field-help.js';

/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').Template} Template */
/** @typedef {import('../core/types.js').Measurement} Measurement */
/** @typedef {import('../core/types.js').FieldValue} FieldValue */

/**
 * One row per output field.
 * - Derived values are read-only and marked; "Edit" turns them into a manual value.
 * - Manual values are editable; "Use derived" removes them when a derived value exists.
 * - Empty outputs with a derivation say what is missing.
 * @param {{run: Run, template: Template, measurements: Measurement[],
 *   onManual: (key: string, v: FieldValue) => void, onUseDerived: (key: string) => void}} o
 * @returns {HTMLElement}
 */
export function outputsList(o) {
  const outputs = o.template.fields.filter((f) => f.role === 'output');
  if (!outputs.length) return emptyState('This template has no output fields.');
  const { values, missing } = computeDerived(o.run, o.template, o.measurements);
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
      id, label: f.label, value: typeof v === 'number' ? v : null, step: f.step, min: f.min, max: f.max,
      onChange: (nv) => o.onManual(f.key, nv),
    }).el);
    return h('div', { class: 'card stack' }, head, help.note, field, note,
      derivable ? button(`Use derived (${fmtValue(values[f.key], f.unit)})`, {
        icon: 'undo', onClick: () => o.onUseDerived(f.key),
      }) : null);
  });
  return h('div', { class: 'stack' }, rows);
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
