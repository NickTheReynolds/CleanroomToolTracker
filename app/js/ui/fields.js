// @ts-check
/**
 * Form fields driven by a template field spec: a numeric stepper with
 * hold-to-repeat, an mm:ss duration input, choice, yes/no and text fields,
 * each with an "i" button that explains the field (core/field-help.js).
 * Every control returns {el, set} so callers can reset it.
 */
import { h, on, uid } from './dom.js';
import { icon } from './icons.js';
import { segmented, helpToggle, labelRow } from './components.js';
import { parseNumber, stepValue } from '../core/format.js';
import { fieldHelp } from '../core/field-help.js';
import { isSet } from '../core/values.js';
import { HELP } from '../core/app-help.js';
import { splitMinSec } from '../core/time.js';
import { UI } from '../config.js';

/** @typedef {import('../core/types.js').FieldSpec} FieldSpec */
/** @typedef {import('../core/types.js').FieldValue} FieldValue */
/** @typedef {import('../core/field-help.js').TemplateLike} TemplateLike */
/** @typedef {{el: HTMLElement, set: (v: any) => void, focus?: () => void}} Control */

/**
 * Repeat a button's action while it is held. Pointer presses act on
 * pointerdown; keyboard activation arrives as a click with detail 0.
 * The action receives a multiplier that grows during long holds.
 * @param {HTMLElement} btn
 * @param {(mult: number) => void} fn
 */
export function holdRepeat(btn, fn) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let interval;
  let count = 0;
  const stop = () => {
    clearTimeout(timer);
    clearInterval(interval);
  };
  on(btn, 'pointerdown', (/** @type {PointerEvent} */ e) => {
    if (e.button !== 0) return;
    stop();
    count = 0;
    fn(1);
    timer = setTimeout(() => {
      interval = setInterval(() => {
        count += 1;
        fn(count > 40 ? 5 : count > 15 ? 2 : 1);
      }, UI.STEPPER_REPEAT_MS);
    }, UI.STEPPER_DELAY_MS);
    try { btn.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) on(btn, t, stop);
  on(btn, 'click', (/** @type {MouseEvent} */ e) => { if (e.detail === 0) fn(1); });
  on(btn, 'contextmenu', (/** @type {Event} */ e) => e.preventDefault());
}

/**
 * Numeric input between − and + buttons. Typing works too (decimal comma
 * accepted). An empty value is null. A ± button flips the sign when the
 * value may be negative (`signed`; by default when there is no minimum or
 * it is below 0), since phone number pads have no minus key.
 * @param {{id?: string, label: string, value: number | null, step?: number, min?: number, max?: number,
 *   placeholder?: number | null, signed?: boolean, onChange: (v: number | null) => void}} o
 * @returns {Control & {input: HTMLInputElement}}
 */
export function numberStepper(o) {
  const step = o.step && o.step > 0 ? o.step : 1;
  let current = o.value ?? null;
  const allowNegative = o.signed ?? (o.min === undefined || o.min < 0);
  const input = /** @type {HTMLInputElement} */ (h('input', {
    id: o.id, class: 'input stepper-input', type: 'text', inputmode: 'decimal', autocomplete: 'off',
    enterkeyhint: 'done', value: current === null ? '' : String(current),
    placeholder: o.placeholder === null || o.placeholder === undefined ? '' : String(o.placeholder),
  }));
  const set = (/** @type {number | null} */ v, /** @type {boolean} */ typed = false) => {
    current = v;
    if (!typed) input.value = v === null ? '' : String(v);
    input.removeAttribute('aria-invalid');
    o.onChange(v);
  };
  on(input, 'input', () => {
    const t = input.value.trim();
    if (!t) return set(null, true);
    const n = parseNumber(t);
    if (n === null) input.setAttribute('aria-invalid', 'true');
    else set(n, true);
  });
  on(input, 'blur', () => {
    if (input.getAttribute('aria-invalid') === 'true') {
      input.value = current === null ? '' : String(current);
      input.removeAttribute('aria-invalid');
    }
  });
  const bump = (/** @type {1 | -1} */ dir) => (/** @type {number} */ mult) => {
    if (current === null) {
      const hint = typeof o.placeholder === 'number' ? o.placeholder : null;
      set(hint !== null ? hint : stepValue(o.min ?? 0, step, dir, o.min, o.max));
    } else {
      set(stepValue(current, step * mult, dir, o.min, o.max));
    }
  };
  const minus = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Decrease ${o.label}` }, icon('minus'));
  const plus = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Increase ${o.label}` }, icon('plus'));
  holdRepeat(minus, bump(-1));
  holdRepeat(plus, bump(1));
  const sign = allowNegative ? h('button', {
    type: 'button', class: 'stepper-sign', 'aria-label': `Change sign of ${o.label}`,
    onClick: () => { if (current !== null && current !== 0) set(-current); },
  }, '±') : null;
  const el = h('div', { class: 'stepper' }, minus, input, sign, plus);
  return { el, input, set: (v) => set(v), focus: () => input.focus() };
}

/** @param {number} n */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Duration entered as minutes and seconds (two numeric boxes, since phone
 * number pads have no colon key) between − and + buttons. Value in seconds.
 * @param {{id?: string, label: string, value: number | null, step?: number, min?: number, max?: number,
 *   onChange: (v: number | null) => void}} o min and max (seconds) bound the − and + buttons; never below 0
 * @returns {Control}
 */
export function durationInput(o) {
  const step = o.step && o.step > 0 ? o.step : 10;
  let current = o.value ?? null;
  const mk = (/** @type {string} */ part, /** @type {string} */ ph) => /** @type {HTMLInputElement} */ (h('input', {
    class: `input dur-${part}`, type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: ph,
    'aria-label': `${o.label} ${part === 'min' ? 'minutes' : 'seconds'}`, enterkeyhint: 'done',
  }));
  const minIn = mk('min', 'mm');
  const secIn = mk('sec', 'ss');
  if (o.id) minIn.id = o.id;
  const show = () => {
    const ms = splitMinSec(current);
    minIn.value = ms ? String(ms.min) : '';
    secIn.value = ms ? pad2(ms.sec) : '';
  };
  const set = (/** @type {number | null} */ v, /** @type {boolean} */ typed = false) => {
    current = v;
    if (!typed) show();
    o.onChange(v);
  };
  const read = () => {
    const m = minIn.value.trim();
    const s = secIn.value.trim();
    if (!m && !s) return null;
    if ((m && !/^\d+$/.test(m)) || (s && !/^\d+(\.\d+)?$/.test(s))) return undefined;
    return (m ? Number(m) : 0) * 60 + (s ? Number(s) : 0);
  };
  for (const inp of [minIn, secIn]) {
    on(inp, 'input', () => {
      const v = read();
      inp.toggleAttribute('aria-invalid', v === undefined);
      if (v !== undefined) set(v, true);
    });
    on(inp, 'blur', () => { if (read() !== undefined) show(); });
  }
  const bump = (/** @type {1 | -1} */ dir) => (/** @type {number} */ mult) => {
    set(stepValue(current ?? 0, step * mult, dir, Math.max(0, o.min ?? 0), o.max));
  };
  const minus = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Decrease ${o.label}` }, icon('minus'));
  const plus = h('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Increase ${o.label}` }, icon('plus'));
  holdRepeat(minus, bump(-1));
  holdRepeat(plus, bump(1));
  show();
  const el = h('div', { class: 'stepper stepper-dur' }, minus,
    h('div', { class: 'dur-box' }, minIn, h('span', { class: 'dur-colon', 'aria-hidden': 'true' }, ':'), secIn), plus);
  return { el, set: (v) => set(v), focus: () => minIn.focus() };
}

/**
 * @param {{id?: string, value: string | null, onChange: (v: string | null) => void, placeholder?: string,
 *   multiline?: boolean, autocapitalize?: string}} o
 * @returns {Control}
 */
export function textInput(o) {
  const el = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (h(o.multiline ? 'textarea' : 'input', {
    id: o.id, class: 'input', type: o.multiline ? undefined : 'text', rows: o.multiline ? 3 : undefined,
    value: o.value ?? '', placeholder: o.placeholder || '', autocapitalize: o.autocapitalize || 'sentences',
    autocomplete: 'off', enterkeyhint: o.multiline ? undefined : 'done',
  }));
  on(el, 'input', () => o.onChange(el.value === '' ? null : el.value));
  return { el, set: (v) => { el.value = v ?? ''; o.onChange(v); }, focus: () => el.focus() };
}

/**
 * Whether a choice field is shown as big buttons (up to 5 short options)
 * rather than a native select.
 * @param {FieldSpec} f
 * @returns {boolean}
 */
const asButtons = (f) => (f.options || []).length <= 5 && (f.options || []).every((x) => x.length <= 14);

/**
 * Choice field: big buttons for up to 5 short options, else a native select.
 * @param {{id: string, labelId: string, field: FieldSpec, value: string | null, clearable?: boolean,
 *   onChange: (v: string | null) => void}} o
 * @returns {Control}
 */
function choiceInput(o) {
  const options = o.field.options || [];
  if (asButtons(o.field)) {
    let seg = buildSeg(o.value);
    function buildSeg(/** @type {string | null} */ v) {
      return segmented({
        options: options.map((x) => ({ value: x, label: x })), value: v, allowNone: true, onChange: o.onChange,
      });
    }
    seg.querySelector('[role=radiogroup]')?.setAttribute('aria-labelledby', o.labelId);
    const wrap = h('div', null, seg);
    return {
      el: wrap,
      set: (v) => {
        const next = buildSeg(v);
        next.querySelector('[role=radiogroup]')?.setAttribute('aria-labelledby', o.labelId);
        seg.replaceWith(next);
        seg = next;
        o.onChange(v);
      },
    };
  }
  const sel = /** @type {HTMLSelectElement} */ (h('select', { id: o.id, class: 'input' },
    h('option', { value: '' }, o.clearable ? 'Any' : 'Choose…'),
    options.map((x) => h('option', { value: x, selected: x === o.value }, x))));
  on(sel, 'change', () => o.onChange(sel.value || null));
  return { el: sel, set: (v) => { sel.value = v ?? ''; o.onChange(v); }, focus: () => sel.focus() };
}

/**
 * Yes / no as two big buttons; tapping the selected one clears it.
 * @param {{labelId: string, value: boolean | null, onChange: (v: boolean | null) => void}} o
 * @returns {Control}
 */
function boolInput(o) {
  const build = (/** @type {boolean | null} */ v) => {
    const seg = segmented({
      options: [{ value: true, label: 'Yes' }, { value: false, label: 'No' }], value: v, allowNone: true, onChange: o.onChange,
    });
    seg.querySelector('[role=radiogroup]')?.setAttribute('aria-labelledby', o.labelId);
    return seg;
  };
  let seg = build(o.value);
  const wrap = h('div', null, seg);
  return {
    el: wrap,
    set: (v) => { const next = build(v); seg.replaceWith(next); seg = next; o.onChange(v); },
  };
}

/**
 * Render one template field with its label, unit, "i" button and control.
 * @param {FieldSpec} f
 * @param {FieldValue | undefined} value
 * @param {(v: FieldValue) => void} onChange
 * @param {{clearable?: boolean, placeholder?: FieldValue, note?: string | Node, template?: TemplateLike | null}} [opts]
 *   clearable adds a Clear button (lookup: every field optional); template picks the
 *   field's help text (a key can mean different things in different templates)
 * @returns {HTMLElement}
 */
export function renderField(f, value, onChange, opts = {}) {
  const id = uid(f.key);
  const labelId = `${id}-label`;
  const v = value === undefined ? null : value;
  /** @type {Control} */
  let control;
  if (f.type === 'number') {
    control = numberStepper({
      id, label: f.label, value: typeof v === 'number' ? v : null, step: f.step, min: f.min, max: f.max, signed: signedField(f),
      placeholder: typeof opts.placeholder === 'number' ? opts.placeholder : null, onChange,
    });
  } else if (f.type === 'duration') {
    control = durationInput({ id, label: f.label, value: typeof v === 'number' ? v : null, step: f.step, min: f.min, max: f.max, onChange });
  } else if (f.type === 'select') {
    control = choiceInput({ id, labelId, field: f, value: typeof v === 'string' ? v : null, clearable: opts.clearable, onChange });
  } else if (f.type === 'bool') {
    control = boolInput({ labelId, value: typeof v === 'boolean' ? v : null, onChange });
  } else {
    control = textInput({ id, value: v === null ? null : String(v), onChange });
  }
  const labelTag = (f.type === 'select' && asButtons(f)) || f.type === 'bool' ? 'span' : 'label';
  const label = h(labelTag, { class: 'label', id: labelId, for: labelTag === 'label' ? id : undefined },
    f.label,
    f.unit && f.type !== 'duration' ? h('span', { class: 'unit' }, ` (${f.unit})`) : null,
    f.type === 'duration' ? h('span', { class: 'unit' }, ' (mm:ss)') : null,
    f.required ? h('span', { class: 'req' }, ' · required') : null);
  const help = helpToggle(f.label, fieldHelp(f, opts.template || null));
  const head = h('div', { class: 'field-head' }, h('span', { class: 'label-help' }, label, help.btn),
    opts.clearable ? h('button', {
      type: 'button', class: 'link-btn', 'aria-label': `Clear ${f.label}`, onClick: () => control.set(null),
    }, 'Clear') : null);
  return h('div', { class: ['field', `field-${f.type}`], dataset: { key: f.key } },
    head, help.note, control.el, opts.note ? h('p', { class: 'field-note' }, opts.note) : null);
}

/** A template with at least this many gas lines shows only the ones in use, with the rest one tap away. */
const COLLAPSE_GASES_FROM = 4;

/**
 * Render a list of fields into one container. With `collapseGases`, a
 * template with several gas lines shows only the gases that have a value;
 * the others wait behind a row of "+ gas" buttons. Every field is rendered
 * once and only hidden, so revealing one never loses what was typed.
 * @param {FieldSpec[]} fields
 * @param {Record<string, FieldValue>} values
 * @param {(key: string, v: FieldValue) => void} onChange
 * @param {{clearable?: boolean, notes?: Record<string, string | Node>, template?: TemplateLike | null,
 *   collapseGases?: boolean}} [opts]
 * @returns {HTMLElement}
 */
export function renderFields(fields, values, onChange, opts = {}) {
  const nodes = fields.map((f) => renderField(f, values[f.key], (v) => onChange(f.key, v), {
    clearable: opts.clearable, note: opts.notes ? opts.notes[f.key] : undefined, template: opts.template,
  }));
  const gases = fields.filter((f) => f.chemistry && f.type === 'number');
  const unused = opts.collapseGases && gases.length >= COLLAPSE_GASES_FROM
    ? gases.filter((f) => !f.required && !isSet(values[f.key])) : [];
  if (!unused.length) return h('div', { class: 'fields' }, nodes);
  const byKey = new Map(fields.map((f, i) => [f.key, nodes[i]]));
  for (const f of unused) /** @type {HTMLElement} */ (byKey.get(f.key)).hidden = true;
  const labelId = uid('gases');
  const chips = h('div', { class: 'picker', role: 'group', 'aria-labelledby': labelId }, unused.map((f) => {
    const chip = h('button', {
      type: 'button', class: 'pick-btn', 'aria-label': `Add the ${f.label} line`,
      onClick: () => {
        const node = /** @type {HTMLElement} */ (byKey.get(f.key));
        node.hidden = false;
        chip.remove();
        if (!chips.childElementCount) adder.remove();
        /** @type {HTMLElement | null} */ (node.querySelector('input'))?.focus();
      },
    }, icon('plus', { size: 18 }), f.label);
    return chip;
  }));
  const adder = h('div', { class: 'field gas-add' },
    labelRow(h('span', { class: 'label', id: labelId }, `Other gas lines (${unused.length} not in use)`), 'Other gas lines', HELP.gasLines), chips);
  return h('div', { class: 'fields' }, nodes, adder);
}

/**
 * Whether a number field takes negative values, so shows a ± button: when
 * its minimum is below 0, or, without a minimum, when it holds a quantity
 * that can be negative: a temperature in °C, a stress, a voltage, a focus
 * or an offset. A rate, thickness or pressure never shows one.
 * @param {FieldSpec} f
 * @returns {boolean}
 */
export function signedField(f) {
  if (typeof f.min === 'number') return f.min < 0;
  return ['°C', 'MPa', 'V'].includes(String(f.unit || '').trim()) || /focus|offset|stress|bias/i.test(f.key);
}
