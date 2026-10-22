// @ts-check
/**
 * The steps of a run in Log run and Run detail. A one-step run shows only
 * "Add a step". With steps, a row of step buttons (the main step marked ★)
 * picks which step's inputs the form shows, and the selected step can be
 * renamed, made the main step or removed. Lookup compares the main step.
 */
import { h, uid } from './dom.js';
import { button, segmented, labelRow } from './components.js';
import { textInput } from './fields.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').RunStep} RunStep */

/**
 * @param {{steps: RunStep[], active: number, onSelect: (i: number) => void, onAdd: () => void,
 *   onRename: (i: number, name: string) => void, onMakeMain: (i: number) => void, onRemove: (i: number) => void}} o
 * @returns {HTMLElement}
 */
export function stepControls(o) {
  if (!o.steps.length) {
    return h('div', { class: 'row-wrap run-steps' }, button('Add a step', { kind: 'ghost', icon: 'plus', onClick: o.onAdd }),
      h('span', { class: 'muted small' }, 'For runs with several steps, such as a breakthrough before the main etch.'));
  }
  const i = Math.min(Math.max(0, o.active), o.steps.length - 1);
  const s = o.steps[i];
  const nameId = uid('stepname');
  return h('div', { class: 'stack run-steps' },
    segmented({
      label: 'Steps', compact: true, value: i, help: HELP.runSteps,
      options: o.steps.map((x, j) => ({ value: j, label: `${j + 1}. ${x.name || `Step ${j + 1}`}${x.main ? ' ★' : ''}` })),
      onChange: (v) => { if (v !== null) o.onSelect(v); },
    }),
    h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: nameId }, 'Step name'), 'Step name', HELP.stepName),
      textInput({ id: nameId, value: s.name, onChange: (v) => o.onRename(i, v || '') }).el),
    h('p', { class: 'field-note' }, s.main
      ? '★ Main step: Lookup compares its inputs, and its time gives the rate.'
      : 'Kept with the run. Lookup compares the main step (★).'),
    h('div', { class: 'row-wrap' },
      button('Add step', { icon: 'plus', onClick: o.onAdd }),
      s.main ? null : button('Make main step', { icon: 'check', onClick: () => o.onMakeMain(i) }),
      s.main ? null : button('Remove step', { kind: 'ghost', icon: 'trash', onClick: () => o.onRemove(i) })));
}
