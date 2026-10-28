// @ts-check
/**
 * The plan's compatibility notes on screen. Each note leads with a word and
 * an icon, never colour alone: "Not allowed" (ban) or "Check" (alert), and
 * "Checked" once the person marked it so. It says what it rests on: the LNF
 * wiki notes in the app, general practice, or the person's settings (a tool's
 * compatibility, what they said a material is).
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { button } from './components.js';
import { SOURCE_TEXT } from '../core/compat.js';

/** @typedef {import('../core/compat.js').Note} Note */
/** @typedef {import('../core/types.js').PlanStep} PlanStep */

/**
 * @param {Note} n
 * @param {{checked?: boolean, onCheck?: (on: boolean) => void, action?: Node | Node[] | null, checkId?: string}} [o]
 *   onCheck: offer "Mark as checked" (or "Not checked" to undo); action: other buttons, e.g. adding the PFC clean or
 *   asking what a material is; checkId: the check button's id, so focus can return to it after a redraw
 * @returns {HTMLElement}
 */
export function noteLine(n, o = {}) {
  const checked = !!o.checked;
  const word = checked ? 'Checked' : n.severity === 'stop' ? 'Not allowed' : 'Check';
  return h('div', { class: ['compat-note', checked ? 'note-checked' : n.severity === 'stop' ? 'note-stop' : 'note-check'] },
    icon(checked ? 'check' : n.severity === 'stop' ? 'ban' : 'alert', { size: 20 }),
    h('div', { class: 'compat-note-body' },
      h('span', null, h('span', { class: 'compat-note-word' }, `${word}: `), n.text),
      h('span', { class: 'compat-note-src' }, SOURCE_TEXT[n.source] || ''),
      o.onCheck || o.action ? h('div', { class: 'row-wrap' },
        o.action || null,
        o.onCheck ? Object.assign(button(checked ? 'Not checked' : 'Mark as checked', {
          kind: 'ghost', icon: checked ? 'undo' : 'check', onClick: () => o.onCheck?.(!checked),
        }), o.checkId ? { id: o.checkId } : {}) : null) : null));
}

/**
 * A step's notes that still count: not marked as checked.
 * @param {Note[]} notes
 * @param {PlanStep} step
 * @returns {Note[]}
 */
export function openNotes(notes, step) {
  const checked = new Set(Array.isArray(step.checked) ? step.checked : []);
  return notes.filter((n) => !checked.has(n.key));
}

/**
 * The plan's summary line: "Not allowed as planned: steps 5 and 7 · To check:
 * step 9". Done and skipped steps and checked notes do not count.
 * @param {Map<string, Note[]>} byStep
 * @param {PlanStep[]} steps
 * @param {(step: PlanStep) => boolean} [counts] whether a step still counts (not done)
 * @returns {string} "" when nothing is open
 */
export function notesSummary(byStep, steps, counts = () => true) {
  /** @type {number[]} */
  const stops = [];
  /** @type {number[]} */
  const checks = [];
  steps.forEach((s, i) => {
    if (s.skipped || !counts(s)) return;
    const open = openNotes(byStep.get(s.id) || [], s);
    if (open.some((x) => x.severity === 'stop')) stops.push(i + 1);
    else if (open.length) checks.push(i + 1);
  });
  const words = (/** @type {number[]} */ ns) => (ns.length === 1 ? `step ${ns[0]}` : `steps ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);
  return [stops.length ? `Not allowed as planned: ${words(stops)}` : '', checks.length ? `To check: ${words(checks)}` : ''].filter(Boolean).join(' · ');
}

/**
 * A step's marks after "Mark as checked" or "Not checked".
 * @param {PlanStep} step
 * @param {string} key
 * @param {boolean} on
 * @returns {string[]}
 */
export function toggleChecked(step, key, on) {
  const set = new Set(Array.isArray(step.checked) ? step.checked : []);
  if (on) set.add(key); else set.delete(key);
  return [...set];
}
