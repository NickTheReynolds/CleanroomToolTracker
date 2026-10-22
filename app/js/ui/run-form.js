// @ts-check
/**
 * Form sections shared by Log run and Run detail: the recipe (with the
 * tool's LNF recipes), sample details (material pickers, target thickness),
 * notes and tags, the run timer and the start time.
 */
import { h, uid } from './dom.js';
import { button } from './components.js';
import { textInput, numberStepper } from './fields.js';
import { materialPicker } from './pickers.js';
import { recipeButton } from './recipes.js';
import { formatMmSs, formatClock, toLocalInput, fromLocalInput } from '../core/time.js';
import { elapsedSeconds } from '../core/run-draft.js';

/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */
/** @typedef {import('../core/types.js').Template} Template */

/**
 * @typedef {Object} SampleState
 * @property {string} material
 * @property {string} substrate
 * @property {string} [maskMaterial]
 * @property {string} recipe
 * @property {number | null | undefined} [targetThickness]
 */

/**
 * @typedef {Object} MaterialLists
 * @property {string[]} material
 * @property {string[]} substrate
 * @property {string[]} maskMaterial
 */

/**
 * The recipe name, with the tool's LNF recipes one tap away. Using one
 * fills its parameters (the caller applies them).
 * @param {{value: string, onChange: (v: string) => void, recipes: WikiRecipe[], template: Template | null,
 *   title: string, useLabel?: string, roles?: string[], onUse: (r: WikiRecipe, step: number) => void}} o
 * @returns {HTMLElement}
 */
export function recipeField(o) {
  const id = uid('recipe');
  const pick = recipeButton({
    title: o.title, recipes: o.recipes, template: o.template, useLabel: o.useLabel || 'Use recipe', roles: o.roles, onUse: o.onUse,
  });
  return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, 'Recipe'),
    textInput({ id, value: o.value, autocapitalize: 'off', onChange: (v) => o.onChange(v || '') }).el,
    pick ? h('div', { class: 'row-wrap' }, pick) : null,
    pick ? h('p', { class: 'field-note' }, 'Choosing an LNF recipe fills in its parameters. You can still change any value.') : null);
}

/**
 * Material, substrate, mask material, recipe (unless showRecipe is false)
 * and target thickness.
 * @param {SampleState} s
 * @param {{lists: MaterialLists, onChange: (patch: Partial<SampleState>) => void,
 *   onAddMaterial: (name: string) => void, showMask?: boolean, showTarget?: boolean, showRecipe?: boolean}} o
 * @returns {HTMLElement[]}
 */
export function sampleFields(s, o) {
  const recipeId = uid('recipe');
  const targetId = uid('target');
  const mask = materialPicker({
    label: 'Mask material (optional)', value: s.maskMaterial || '', options: o.lists.maskMaterial,
    onChange: (v) => o.onChange({ maskMaterial: v }), onAddNew: o.onAddMaterial, show: 4,
  });
  return [
    materialPicker({
      label: 'Material', value: s.material, options: o.lists.material,
      onChange: (v) => o.onChange({ material: v }), onAddNew: o.onAddMaterial,
    }),
    materialPicker({
      label: 'Substrate', value: s.substrate, options: o.lists.substrate,
      onChange: (v) => o.onChange({ substrate: v }), onAddNew: o.onAddMaterial, show: 4,
    }),
    o.showMask || s.maskMaterial ? mask : h('details', { class: 'more' }, h('summary', null, 'Mask material'), mask),
    o.showRecipe === false ? null : h('div', { class: 'field' }, h('label', { class: 'label', for: recipeId }, 'Recipe'),
      textInput({ id: recipeId, value: s.recipe, autocapitalize: 'off', onChange: (v) => o.onChange({ recipe: v || '' }) }).el),
    o.showTarget === false ? null : h('div', { class: 'field' },
      h('label', { class: 'label', for: targetId }, 'Target thickness', h('span', { class: 'unit' }, ' (nm, optional)')),
      numberStepper({
        id: targetId, label: 'target thickness', value: s.targetThickness ?? null, step: 10, min: 0,
        onChange: (v) => o.onChange({ targetThickness: v }),
      }).el),
  ];
}

/**
 * Notes (keyboard dictation works) and comma-separated tags.
 * @param {{notes: string, tags: string}} s
 * @param {(patch: {notes?: string, tags?: string}) => void} onChange
 * @returns {HTMLElement[]}
 */
export function notesFields(s, onChange) {
  const notesId = uid('notes');
  const tagsId = uid('tags');
  return [
    h('div', { class: 'field' }, h('label', { class: 'label', for: notesId }, 'Notes'),
      textInput({ id: notesId, value: s.notes, multiline: true, onChange: (v) => onChange({ notes: v || '' }) }).el,
      h('p', { class: 'field-note' }, 'Tip: use the microphone on the keyboard to dictate.')),
    h('div', { class: 'field' }, h('label', { class: 'label', for: tagsId }, 'Tags', h('span', { class: 'unit' }, ' (comma-separated)')),
      textInput({ id: tagsId, value: s.tags, autocapitalize: 'off', onChange: (v) => onChange({ tags: v || '' }) }).el),
  ];
}

/**
 * The optional run timer. Start records the start time; Stop reports the
 * elapsed seconds (the caller fills the template's duration field). The
 * clock is computed from the stored start, so it survives a locked phone.
 * @param {{timerStartedAt: string | null, lastSeconds: number | null, onStart: () => void,
 *   onStop: (seconds: number) => void}} o
 * @returns {{el: HTMLElement, dispose: () => void}}
 */
export function timerCard(o) {
  let startedAt = o.timerStartedAt;
  let last = o.lastSeconds;
  const clock = h('span', { class: 'timer-clock', role: 'timer', 'aria-live': 'off' });
  const note = h('p', { class: 'field-note' });
  const slot = h('div');
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let tick;
  const draw = () => {
    clearInterval(tick);
    if (startedAt) {
      const update = () => { clock.textContent = formatMmSs(elapsedSeconds(startedAt, Date.now())); };
      update();
      tick = setInterval(update, 1000);
      note.textContent = `Started ${formatClock(startedAt)}. Stop fills the time field.`;
      slot.replaceChildren(button('Stop', {
        kind: 'danger', icon: 'stop', big: true,
        onClick: () => {
          const secs = elapsedSeconds(startedAt, Date.now());
          startedAt = null;
          last = secs;
          o.onStop(secs);
          draw();
        },
      }));
    } else {
      clock.textContent = formatMmSs(last ?? 0);
      note.textContent = last ? 'Timer stopped. Start again to time a new run.' : 'Optional: time the run on the tool.';
      slot.replaceChildren(button('Start', {
        kind: 'primary', icon: 'play', big: true,
        onClick: () => {
          startedAt = new Date().toISOString();
          o.onStart();
          draw();
        },
      }));
    }
  };
  draw();
  const el = h('div', { class: 'card stack' },
    h('div', { class: 'timer' }, h('span', { class: 'visually-hidden' }, 'Run timer'), clock, slot), note);
  return { el, dispose: () => clearInterval(tick) };
}

/**
 * Start time as a local date-time input with a Now button.
 * @param {string} label
 * @param {string} value ISO
 * @param {(iso: string) => void} onChange
 * @returns {HTMLElement}
 */
export function dateTimeField(label, value, onChange) {
  const id = uid('when');
  const input = /** @type {HTMLInputElement} */ (h('input', {
    id, class: 'input', type: 'datetime-local', value: toLocalInput(value),
  }));
  input.addEventListener('change', () => {
    const iso = fromLocalInput(input.value);
    if (iso) onChange(iso);
  });
  return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label),
    h('div', { class: 'stepper' }, input, button('Now', {
      onClick: () => {
        const now = new Date().toISOString();
        input.value = toLocalInput(now);
        onChange(now);
      },
    })));
}
