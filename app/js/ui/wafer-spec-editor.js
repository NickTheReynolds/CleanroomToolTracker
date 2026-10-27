// @ts-check
/**
 * The form for what a wafer or mask is (a WaferSpec): used by the wafer
 * types editor (Settings) and by a project wafer's Details sheet. The
 * usual fields come first; the rest fold under "More details". Changes go
 * to `onChange` as they happen; the caller tidies the spec (cleanSpec)
 * when it saves.
 */
import { h, fill, uid } from './dom.js';
import { button, segmented, labelRow } from './components.js';
import { textInput, numberStepper } from './fields.js';
import { materialPicker } from './pickers.js';
import {
  SIZES, KIND_LABELS, POLISH_LABELS, DOPING_LABELS, POLARITY_LABELS, ORIENTATIONS, DOPANTS, GRADES,
} from '../core/wafer-spec.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').WaferSpec} WaferSpec */

/** Plate materials offered first for masks. */
const PLATE_MATERIALS = Object.freeze(['Soda-lime glass', 'Fused silica']);

/**
 * A labelled text box.
 * @param {string} label
 * @param {string} value
 * @param {(v: string) => void} onChange
 * @param {string} help
 * @param {{placeholder?: string, multiline?: boolean}} [o]
 * @returns {HTMLElement}
 */
function textField(label, value, onChange, help, o = {}) {
  const id = uid('spec');
  return h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: id }, label), label, help),
    textInput({ id, value, multiline: o.multiline, placeholder: o.placeholder, onChange: (v) => onChange(v || '') }).el);
}

/**
 * A text box with quick choices under it ("<100>", "Prime").
 * @param {string} label
 * @param {string} value
 * @param {readonly string[]} choices
 * @param {(v: string) => void} onChange
 * @param {string} help
 * @returns {HTMLElement}
 */
function textWithChoices(label, value, choices, onChange, help) {
  const id = uid('spec');
  const ctl = textInput({ id, value, onChange: (v) => onChange(v || '') });
  return h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: id }, label), label, help), ctl.el,
    h('div', { class: 'picker' }, choices.map((c) => button(c, { kind: 'ghost', onClick: () => { ctl.set(c); ctl.focus(); } }))));
}

/**
 * Mark a control's wrapper, so focus can find its way back to it after the
 * form is drawn again.
 * @param {HTMLElement} el
 * @param {string} key
 * @returns {HTMLElement}
 */
export function keyed(el, key) {
  el.dataset.key = key;
  return el;
}

/**
 * After a redraw, focus the control that had it: the chosen option of a
 * choice, else the group's first control (not its "i" button).
 * @param {HTMLElement} box
 * @param {string | null | undefined} key
 */
export function refocusKey(box, key) {
  if (!key) return;
  const at = `[data-key="${CSS.escape(key)}"]`;
  const el = /** @type {HTMLElement | null} */ (box.querySelector(`${at} [role="radio"][aria-checked="true"]`)
    || box.querySelector(`${at} [role="radio"], ${at} input, ${at} button:not(.help-btn)`));
  el?.focus();
}

/**
 * @param {{spec: WaferSpec, onChange: (spec: WaferSpec) => void, materials: string[],
 *   onAddMaterial?: (name: string) => void, kindChoice?: boolean}} o
 *   kindChoice: show Wafer / Mask (the types editor); otherwise the spec's kind stays
 * @returns {HTMLElement}
 */
export function specEditor(o) {
  /** @type {Record<string, any>} */
  let s = { ...o.spec };
  const box = h('div', { class: 'stack' });
  let moreOpen = false;
  const set = (/** @type {Record<string, any>} */ patch, redraw = false) => {
    s = { ...s, ...patch };
    o.onChange(/** @type {WaferSpec} */ (s));
    if (redraw) draw();
  };
  const num = (/** @type {string} */ label, /** @type {string} */ key, /** @type {number} */ step, /** @type {string} */ help) => {
    const id = uid('spec');
    return h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: id }, label), label, help),
      numberStepper({ id, label, value: typeof s[key] === 'number' ? s[key] : null, step, min: 0, placeholder: null, onChange: (v) => set({ [key]: v }) }).el);
  };
  const films = () => {
    const list = Array.isArray(s.films) ? s.films : [];
    const labelId = uid('films');
    return h('div', { class: 'field', dataset: { key: 'films' } },
      labelRow(h('span', { class: 'label', id: labelId }, 'Films already on it'), 'Films already on it', HELP.specFilms),
      h('div', { class: 'stack', role: 'group', 'aria-labelledby': labelId },
        list.map((f, i) => {
          const mid = uid('film');
          const tid = uid('film');
          const upd = (/** @type {Record<string, any>} */ patch) => set({ films: list.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          const thick = /** @type {HTMLInputElement} */ (h('input', {
            id: tid, class: 'input', type: 'text', inputmode: 'decimal', value: f.thicknessNm ?? '', placeholder: 'nm', autocomplete: 'off',
          }));
          thick.addEventListener('input', () => { const v = Number(thick.value.replace(',', '.')); upd({ thicknessNm: thick.value.trim() && Number.isFinite(v) ? v : null }); });
          return h('div', { class: 'film-row' },
            h('label', { class: 'visually-hidden', for: mid }, `Film ${i + 1} material`),
            textInput({ id: mid, value: f.material || '', placeholder: 'e.g. SiO2 (thermal)', onChange: (v) => upd({ material: v || '' }) }).el,
            h('label', { class: 'visually-hidden', for: tid }, `Film ${i + 1} thickness in nm`), thick,
            button('', { kind: 'ghost', icon: 'trash', ariaLabel: `Remove film ${i + 1}`, onClick: () => set({ films: list.filter((_, j) => j !== i) }, true) }));
        }),
        button('Add film', {
          icon: 'plus',
          onClick: () => {
            set({ films: [...list, { material: '', thicknessNm: null }] }, true);
            // Straight to the new film's material.
            const rows = box.querySelectorAll('[data-key="films"] .film-row');
            /** @type {HTMLElement | null | undefined} */ (rows[rows.length - 1]?.querySelector('input'))?.focus();
          },
        })));
  };
  const draw = () => {
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    const key = active && box.contains(active) ? active.closest('[data-key]')?.getAttribute('data-key') : null;
    const mask = s.kind === 'mask';
    const sizes = SIZES.filter((x) => (mask ? x.plate : !x.plate && x.key !== '300mm'));
    const more = /** @type {HTMLDetailsElement} */ (h('details', { class: 'more', open: moreOpen },
      h('summary', null, 'More details'),
      h('div', { class: 'stack' },
        mask ? [
          textField('Coating', s.coating || '', (v) => set({ coating: v }), HELP.specCoating, { placeholder: 'e.g. Low-reflectance chrome' }),
          textField('Resist on the blank', s.resist || '', (v) => set({ resist: v }), HELP.specResist, { placeholder: 'e.g. AZ1518, 400 nm' }),
          segmented({
            label: 'Polarity', compact: true, allowNone: true, help: HELP.specPolarity, value: s.polarity || null,
            options: Object.entries(POLARITY_LABELS).map(([value, label]) => ({ value, label })), onChange: (v) => set({ polarity: v || undefined }),
          }),
          textField('Design and layer', s.design || '', (v) => set({ design: v }), HELP.specDesign),
        ] : [
          textWithChoices('Orientation', s.orientation || '', ORIENTATIONS, (v) => set({ orientation: v }), HELP.specOrientation),
          textField('Cut', s.cut || '', (v) => set({ cut: v }), HELP.specCut, { placeholder: 'e.g. Z-cut, C-plane' }),
          segmented({
            label: 'Dopant', compact: true, allowNone: true, help: HELP.specDoping, value: s.dopant || null,
            options: DOPANTS.map((d) => ({ value: d, label: d })), onChange: (v) => set({ dopant: v || undefined }),
          }),
          textField('Resistivity', s.resistivity || '', (v) => set({ resistivity: v }), HELP.specResistivity, { placeholder: 'e.g. 1–10 Ω·cm' }),
          films(),
        ],
        textWithChoices('Grade', s.grade || '', mask ? ['Master'] : GRADES, (v) => set({ grade: v }), HELP.specGrade),
        h('div', { class: 'spec-row' },
          textField('Vendor', s.vendor || '', (v) => set({ vendor: v }), HELP.specVendor),
          textField('Part no.', s.partNo || '', (v) => set({ partNo: v }), HELP.specVendor)),
        textField('Notes', s.notes || '', (v) => set({ notes: v }), HELP.specNotes, { multiline: true }))));
    more.addEventListener('toggle', () => { moreOpen = more.open; });
    fill(box,
      o.kindChoice ? keyed(segmented({
        label: 'Kind', help: HELP.specKind, value: mask ? 'mask' : 'wafer',
        options: Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })),
        onChange: (v) => set({ kind: v === 'mask' ? 'mask' : undefined, size: undefined }, true),
      }), 'kind') : null,
      materialPicker({
        label: mask ? 'Plate material' : 'Material', value: s.material || '', help: HELP.specMaterial, collapse: true, show: 4,
        options: mask ? [...PLATE_MATERIALS, ...o.materials.filter((m) => !PLATE_MATERIALS.includes(m))] : o.materials,
        onAddNew: o.onAddMaterial, onChange: (v) => set({ material: v }),
      }),
      keyed(segmented({
        label: mask ? 'Plate size' : 'Size', compact: true, allowNone: true, help: HELP.specSize, value: s.size || null,
        options: sizes.map((x) => ({ value: x.key, label: x.plate ? x.short.replace(' plate', '') : x.short === 'piece' ? 'Piece' : x.short })),
        onChange: (v) => set({ size: v || undefined }, true),
      }), 'size'),
      s.size === 'piece' ? textField('Piece size', s.pieceSize || '', (v) => set({ pieceSize: v }), HELP.specPieceSize, { placeholder: 'e.g. 10 × 10 mm' }) : null,
      h('div', { class: 'spec-row' }, num('Thickness (µm)', 'thicknessUm', 25, HELP.specThickness), num('± (µm)', 'thicknessTolUm', 5, HELP.specThickness)),
      mask ? null : segmented({
        label: 'Polished', compact: true, allowNone: true, help: HELP.specPolish, value: s.polish || null,
        options: Object.entries(POLISH_LABELS).map(([value, label]) => ({ value, label })), onChange: (v) => set({ polish: v || undefined }),
      }),
      mask ? null : segmented({
        label: 'Doping', compact: true, allowNone: true, help: HELP.specDoping, value: s.doping || null,
        options: Object.entries(DOPING_LABELS).map(([value, label]) => ({ value, label })), onChange: (v) => set({ doping: v || undefined }),
      }),
      more);
    refocusKey(box, key);
  };
  draw();
  return box;
}
