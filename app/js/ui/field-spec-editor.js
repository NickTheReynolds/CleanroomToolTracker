// @ts-check
/**
 * Bottom-sheet editors for one template field spec and one derived-output
 * entry, used by the template editor.
 */
import { h, uid, fill } from './dom.js';
import { button, segmented, sheet, toggle } from './components.js';
import { textInput } from './fields.js';
import { validateField } from '../data/schema.js';
import { parseNumber } from '../core/format.js';
import { DERIVED_FUNCTIONS, DERIVED_INFO } from '../core/derive.js';
import {
  FIELD_TYPES, FIELD_TYPE_LABELS, FIELD_ROLES, ROLE_LABELS, MEASUREMENT_KINDS, KIND_LABELS,
} from '../core/vocab.js';

/** @typedef {import('../core/types.js').FieldSpec} FieldSpec */
/** @typedef {import('../core/types.js').DerivedSpec} DerivedSpec */

/**
 * A stable key from a label: "ICP power" -> "icpPower", unique among `taken`.
 * @param {string} label
 * @param {string[]} taken
 * @returns {string}
 */
export function keyFromLabel(label, taken) {
  const words = String(label).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  if (!key) key = 'field';
  else if (!/^[A-Za-z]/.test(key)) key = `f${key}`;
  key = key.slice(0, 48);
  let out = key;
  for (let n = 2; taken.includes(out); n++) out = `${key}${n}`;
  return out;
}

/**
 * A labelled plain number input for a spec property (blank = unset).
 * @param {string} label
 * @param {number | undefined} value
 * @param {(v: number | undefined) => void} onChange
 * @param {string} [note]
 */
function numberProp(label, value, onChange, note) {
  const id = uid('prop');
  const input = /** @type {HTMLInputElement} */ (h('input', {
    id, class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: value === undefined ? '' : String(value),
  }));
  input.addEventListener('input', () => {
    const t = input.value.trim();
    const n = parseNumber(t);
    input.toggleAttribute('aria-invalid', !!t && n === null);
    onChange(t && n !== null ? n : undefined);
  });
  return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), input,
    note ? h('p', { class: 'field-note' }, note) : null);
}

/**
 * Edit one field spec in a sheet.
 * @param {{field: FieldSpec | null, takenKeys: string[], usedBy: number,
 *   onDone: (f: FieldSpec) => void}} o field null = new field; usedBy = runs using its key
 */
export function editFieldSheet(o) {
  const isNew = !o.field;
  /** @type {Record<string, any>} */
  const f = o.field ? structuredClone(o.field) : { key: '', label: '', type: 'number', role: 'input', unit: '' };
  let keyTouched = !isNew;
  const keyLocked = !isNew && o.usedBy > 0;
  const errBox = h('div', { class: 'field-note warn', role: 'alert' });
  const dynamic = h('div', { class: 'stack' });

  const keyId = uid('key');
  const keyInput = /** @type {HTMLInputElement} */ (h('input', {
    id: keyId, class: 'input mono', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    value: f.key, disabled: keyLocked,
  }));
  keyInput.addEventListener('input', () => { keyTouched = true; f.key = keyInput.value.trim(); });
  const labelId = uid('lbl');
  const labelInput = textInput({
    id: labelId, value: f.label, autocapitalize: 'sentences',
    onChange: (v) => {
      f.label = v || '';
      if (!keyTouched) {
        f.key = keyFromLabel(f.label, o.takenKeys);
        keyInput.value = f.key;
      }
    },
  });
  const unitId = uid('unit');

  const drawDynamic = () => {
    const isInput = f.role === 'input';
    const numeric = f.type === 'number' || f.type === 'duration';
    fill(dynamic,
      numeric ? h('div', { class: 'row-wrap' },
        numberProp('Step', f.step, (v) => { f.step = v; }),
        numberProp('Min', f.min, (v) => { f.min = v; }),
        numberProp('Max', f.max, (v) => { f.max = v; })) : null,
      f.type === 'select' ? (() => {
        const id = uid('opts');
        const ta = /** @type {HTMLTextAreaElement} */ (h('textarea', { id, class: 'input', rows: 4 }));
        ta.value = (f.options || []).join('\n');
        ta.addEventListener('input', () => { f.options = ta.value.split('\n').map((x) => x.trim()).filter(Boolean); });
        return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, 'Options (one per line)'), ta);
      })() : null,
      isInput ? numberProp('Lookup weight', f.weight,
        (v) => { f.weight = v; }, `Default ${f.type === 'duration' ? 0 : 1}; 0 means lookup ignores this field.`) : null,
      isInput && numeric ? numberProp('Spread hint', f.spreadHint, (v) => { f.spreadHint = v; },
        'Typical run-to-run variation, in the field’s unit. Normalises lookup distance.') : null,
      isInput && ['select', 'text', 'bool'].includes(f.type) ? toggle({
        label: 'Must match exactly', hint: 'Lookup only compares runs with the same value.',
        checked: !!f.matchExact, onChange: (v) => { f.matchExact = v || undefined; },
      }) : null,
      isInput && f.type === 'number' ? toggle({
        label: 'Chemistry (gas flow)', hint: 'Used by the strict chemistry filter.',
        checked: !!f.chemistry, onChange: (v) => { f.chemistry = v || undefined; },
      }) : null,
      toggle({
        label: 'Required', hint: 'Needed before a run can be saved as open or complete.',
        checked: !!f.required, onChange: (v) => { f.required = v || undefined; },
      }));
  };
  drawDynamic();

  const clean = () => {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(f)) {
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length && k === 'options')) continue;
      out[k] = v;
    }
    if (f.type !== 'select') delete out.options;
    if (f.role !== 'input') { delete out.weight; delete out.spreadHint; delete out.matchExact; delete out.chemistry; }
    if (!['number', 'duration'].includes(f.type)) { delete out.step; delete out.min; delete out.max; delete out.spreadHint; }
    if (!['select', 'text', 'bool'].includes(f.type)) delete out.matchExact;
    if (f.type !== 'number') delete out.chemistry;
    out.label = String(out.label || '').trim();
    return /** @type {FieldSpec} */ (out);
  };

  const s = sheet(isNew ? 'New field' : `Edit ${o.field?.label}`, [
    h('div', { class: 'field' }, h('label', { class: 'label', for: labelId }, 'Label'), labelInput.el),
    h('div', { class: 'field' }, h('label', { class: 'label', for: keyId }, 'Key'), keyInput,
      h('p', { class: 'field-note' }, keyLocked
        ? `Used by ${o.usedBy} run${o.usedBy === 1 ? '' : 's'}, so the key cannot change.`
        : 'Stored with each run. Letters, digits and _; start with a letter.')),
    segmented({
      label: 'Type', options: FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t].replace(' (mm:ss)', '') })),
      value: f.type, onChange: (v) => { f.type = v || 'number'; drawDynamic(); },
    }),
    segmented({
      label: 'Role', options: FIELD_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
      value: f.role, onChange: (v) => { f.role = v || 'input'; drawDynamic(); },
    }),
    h('p', { class: 'field-note' }, 'Inputs drive lookup; outputs are results; context is recorded but never matched.'),
    h('div', { class: 'field' }, h('label', { class: 'label', for: unitId }, 'Unit'),
      textInput({ id: unitId, value: f.unit || '', autocapitalize: 'off', onChange: (v) => { f.unit = v || ''; } }).el),
    dynamic,
    errBox,
    h('div', { class: 'dialog-actions' },
      button('Cancel', { onClick: () => s.close() }),
      button(isNew ? 'Add field' : 'Done', {
        kind: 'primary', icon: 'check',
        onClick: () => {
          const out = clean();
          const errs = validateField(out);
          if (o.takenKeys.includes(out.key)) errs.push(`${out.key}: another field already uses this key`);
          errBox.replaceChildren(...errs.map((e) => h('p', null, e)));
          if (errs.length) return;
          s.close();
          o.onDone(out);
        },
      })),
  ]);
}

/**
 * Edit one derived-output entry in a sheet.
 * @param {{entry: DerivedSpec | null, fields: FieldSpec[], onDone: (d: DerivedSpec) => void}} o
 */
export function editDerivedSheet(o) {
  const outputs = o.fields.filter((f) => f.role === 'output');
  const times = o.fields.filter((f) => f.type === 'duration' || (f.type === 'number' && f.role !== 'output'));
  /** @type {Record<string, any>} */
  const d = o.entry ? { ...o.entry } : { fn: 'etchRate', output: outputs[0]?.key || '' };
  const dynamic = h('div', { class: 'stack' });
  const errBox = h('div', { class: 'field-note warn', role: 'alert' });
  const select = (/** @type {string} */ label, /** @type {{value: string, label: string}[]} */ opts,
    /** @type {string} */ value, /** @type {(v: string) => void} */ onChange) => {
    const id = uid('sel');
    const el = /** @type {HTMLSelectElement} */ (h('select', { id, class: 'input' },
      opts.map((x) => h('option', { value: x.value, selected: x.value === value }, x.label))));
    el.addEventListener('change', () => onChange(el.value));
    return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), el);
  };
  const drawDynamic = () => {
    const info = DERIVED_INFO[d.fn];
    fill(dynamic,
      h('p', { class: 'field-note' }, `${info.formula} (${info.unit})`),
      info.usesTime ? select('Time field', [{ value: '', label: 'First duration field' },
        ...times.map((f) => ({ value: f.key, label: f.label }))], d.timeField || '', (v) => { d.timeField = v || undefined; }) : null,
      d.fn === 'uniformity' || d.fn === 'uniformityStd' ? segmented({
        label: 'Measurement phase', options: [{ value: 'post', label: 'Post' }, { value: 'pre', label: 'Pre' }],
        value: d.phase || 'post', onChange: (v) => { d.phase = v || 'post'; },
      }) : null,
      select('Measurement kind', MEASUREMENT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
        d.kind || 'thickness', (v) => { d.kind = v === 'thickness' ? undefined : v; }));
  };
  drawDynamic();
  const s = sheet(o.entry ? 'Edit derived output' : 'New derived output', [
    outputs.length ? null : h('p', { class: 'field-note warn' }, 'Add an output field first.'),
    select('Function', DERIVED_FUNCTIONS.map((fn) => ({ value: fn, label: DERIVED_INFO[fn].label })), d.fn,
      (v) => { d.fn = v; drawDynamic(); }),
    select('Stored in output', outputs.map((f) => ({ value: f.key, label: `${f.label}${f.unit ? ` (${f.unit})` : ''}` })),
      d.output, (v) => { d.output = v; }),
    dynamic,
    errBox,
    h('div', { class: 'dialog-actions' },
      button('Cancel', { onClick: () => s.close() }),
      button('Done', {
        kind: 'primary', icon: 'check',
        onClick: () => {
          if (!d.output) { errBox.textContent = 'Choose an output field.'; return; }
          /** @type {Record<string, any>} */
          const out = { output: d.output, fn: d.fn };
          if (DERIVED_INFO[d.fn].usesTime && d.timeField) out.timeField = d.timeField;
          if ((d.fn === 'uniformity' || d.fn === 'uniformityStd') && d.phase) out.phase = d.phase;
          if (d.kind) out.kind = d.kind;
          s.close();
          o.onDone(/** @type {DerivedSpec} */ (out));
        },
      })),
  ]);
}
