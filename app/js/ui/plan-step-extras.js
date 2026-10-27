// @ts-check
/**
 * The folded part of a plan step in the project editor: which wafers (and
 * masks) the step is for, the stacks it bonds and how, whether the stacks
 * come apart there, and what it adds to or removes from the wafers. The
 * fold's summary says its state, so it can stay closed. Every control has
 * a stable id, so focus returns to it after the editor redraws.
 */
import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, segmented, toggle, labelRow } from './components.js';
import { textInput } from './fields.js';
import { stacksBefore } from '../core/projects.js';
import { isMask, BOND_LABELS, specShort } from '../core/wafer-spec.js';
import { uuid } from '../core/ids.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').PlanStep} PlanStep */
/** @typedef {import('../core/types.js').Wafer} Wafer */
/** @typedef {import('../core/types.js').Bond} Bond */

/** @param {unknown} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * "Cr, Au" → ["Cr", "Au"].
 * @param {string} text
 * @returns {string[]}
 */
export function splitMaterials(text) {
  return [...new Set(String(text || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))];
}

/**
 * A proposal for pairing wafers: across two equal groups of different
 * types (each device wafer with a cap wafer), otherwise in order.
 * @param {Wafer[]} wafers the step's wafers, not yet in a stack
 * @returns {string[][]} pairs of wafer ids
 */
export function proposePairs(wafers) {
  if (wafers.length < 2) return [];
  /** @type {Map<string, Wafer[]>} */
  const groups = new Map();
  for (const w of wafers) {
    const k = w.specId || specShort(w.spec) || '';
    groups.set(k, [...(groups.get(k) || []), w]);
  }
  const g = [...groups.values()];
  if (g.length === 2 && g[0].length === g[1].length) return g[0].map((w, i) => [w.id, g[1][i].id]);
  /** @type {string[][]} */
  const pairs = [];
  for (let i = 0; i + 1 < wafers.length; i += 2) pairs.push([wafers[i].id, wafers[i + 1].id]);
  return pairs;
}

/**
 * @typedef {Object} ExtrasOpts
 * @property {{wafers: Wafer[], steps: PlanStep[]}} project the form's project
 * @property {PlanStep} step
 * @property {() => PlanStep} current the step as it is now: a method change does not redraw the fold, so the
 *   stack buttons build on this, not on the step it was drawn from
 * @property {number} index
 * @property {boolean} bonder the step's tool bonds wafers
 * @property {string} [defaultMethod] the method the first stacks get (a mount on a carrier is temporary)
 * @property {string[]} fromRecipe what the step's recipe leaves on the wafers
 * @property {boolean} open
 * @property {(open: boolean) => void} onToggle
 * @property {(patch: Partial<PlanStep>, redraw?: boolean, focus?: string | null) => void} update
 * @property {string[]} picking wafers tapped for a stack being made (kept by the editor across redraws)
 * @property {(ids: string[]) => void} setPicking
 */

/**
 * @param {ExtrasOpts} o
 * @returns {HTMLElement}
 */
export function stepExtras(o) {
  const { project: p, step: s } = o;
  const wafers = list(p.wafers);
  const label = (/** @type {string} */ id) => wafers.find((w) => w.id === id)?.label || '?';
  const named = list(s.waferIds).filter((id) => wafers.some((w) => w.id === id));
  /** @param {PlanStep} x @returns {Bond[]} */
  const bondsOf = (x) => list(x.bonds).filter((b) => b && list(b.waferIds).length);
  const bonds = bondsOf(s);
  const stacked = new Set(bonds.flatMap((b) => list(b.waferIds)));
  const before = stacksBefore(/** @type {any} */ (p), o.index);
  const sid = s.id;
  const summary = [
    named.length ? `For ${named.map(label).join(', ')}` : 'For every wafer in process',
    bonds.length ? `Bonds ${bonds.map((b) => list(b.waferIds).map(label).join('+')).join(', ')}` : '',
    s.debond ? 'Debond' : '',
    list(s.adds).length || o.fromRecipe.length ? `Adds ${[...o.fromRecipe, ...list(s.adds)].join(', ')}` : '',
    list(s.removes).length ? `Removes ${list(s.removes).join(', ')}` : '',
  ].filter(Boolean).join(' · ');

  const chip = (/** @type {string} */ text, /** @type {boolean} */ on, /** @type {() => void} */ onClick, /** @type {string} */ id,
    /** @type {string} */ aria, disabled = false) => h('button', {
    type: 'button', class: 'pick-btn', id, 'aria-pressed': String(on), 'aria-label': aria, disabled, onClick,
  }, icon('check', { class: 'pick-check' }), text);

  const wId = uid('sw');
  const waferChips = wafers.length > 1 ? h('div', { class: 'field' },
    labelRow(h('span', { class: 'label', id: wId }, 'Wafers in this step'), 'Wafers in this step', HELP.stepWafers),
    h('div', { class: 'picker', role: 'group', 'aria-labelledby': wId }, wafers.map((w) => {
      const on = named.includes(w.id);
      const together = before.get(w.id);
      const text = `${w.label}${isMask(w) ? ' (mask)' : ''}${together ? ` (with ${together.filter((x) => x !== w.id).map(label).join('+')})` : ''}`;
      return chip(text, on, () => o.update({ waferIds: on ? named.filter((x) => x !== w.id) : [...named, w.id] }, true, `#stepw-${sid}-${w.id}`),
        `stepw-${sid}-${w.id}`, `${text}: ${on ? 'in' : 'not in'} this step`);
    })),
    named.length ? null : h('p', { class: 'field-note' }, 'None chosen: every wafer in process.')) : null;

  // Bonding: on a bonder step, or when the step already bonds.
  let bonding = null;
  if (o.bonder || bonds.length) {
    const bId = uid('bond');
    const method = bonds[0]?.method || '';
    // The stacks and method as they are now (a method chosen since the draw is kept).
    const now = () => bondsOf(o.current());
    const setMethod = (/** @type {string | null} */ v) => o.update({ bonds: now().map((b) => ({ ...b, method: v || undefined })) }, false);
    const candidates = wafers.filter((w) => !isMask(w) && w.status === 'active' && (!named.length || named.includes(w.id)) && !before.has(w.id));
    const free = candidates.filter((w) => !stacked.has(w.id));
    const proposal = bonds.length ? [] : proposePairs(free);
    /** @param {string[][]} groups the new stacks; focus goes to the first one's Remove */
    const addStacks = (groups) => {
      const cur = now();
      const m = cur.length ? cur[0].method || '' : o.defaultMethod || '';
      o.update({ bonds: [...cur, ...groups.map((ids) => ({ id: uuid(), waferIds: ids, ...(m ? { method: m } : {}) }))] },
        true, `#bonddel-${sid}-${cur.length}`);
    };
    const picking = o.picking.filter((id) => free.some((w) => w.id === id));
    bonding = h('div', { class: 'field' },
      labelRow(h('span', { class: 'label', id: bId }, 'Bond into stacks'), 'Bond into stacks', HELP.stepBonds),
      bonds.length ? h('div', { class: 'stack-chips', role: 'group', 'aria-labelledby': bId }, bonds.map((b, i) => h('span', { class: 'chip' },
        icon('layers', { size: 18 }), h('span', null, list(b.waferIds).map(label).join('+')),
        h('button', {
          type: 'button', class: 'chip-action', id: `bonddel-${sid}-${i}`, 'aria-label': `Remove the stack ${list(b.waferIds).map(label).join('+')}`,
          onClick: () => o.update({ bonds: now().filter((_, j) => j !== i) }, true, `#extras-${sid}`),
        }, 'Remove')))) : null,
      proposal.length ? Object.assign(button(`Pair them: ${proposal.map((ids) => ids.map(label).join('+')).join(', ')}`, {
        kind: 'primary', icon: 'layers', onClick: () => addStacks(proposal),
      }), { id: `bondpair-${sid}` }) : null,
      free.length >= 2 ? h('div', { class: 'stack' },
        h('p', { class: 'field-note' }, 'Pair them myself: tap the wafers of one stack, then Make the stack.'),
        h('div', { class: 'picker' }, free.map((w) => chip(w.label, picking.includes(w.id), () => o.setPicking(picking.includes(w.id)
          ? picking.filter((x) => x !== w.id) : [...picking, w.id]), `bondpick-${sid}-${w.id}`, `${w.label} for the next stack`))),
        Object.assign(button(picking.length >= 2 ? `Make the stack ${picking.map(label).join('+')}` : 'Make the stack', {
          icon: 'plus', disabled: picking.length < 2,
          onClick: () => { o.setPicking([]); addStacks([picking]); },
        }), { id: `bondadd-${sid}` })) : h('span', { id: `bondadd-${sid}`, tabindex: '-1' }),
      bonds.length ? segmented({
        label: 'Bond method', compact: true, allowNone: true, help: HELP.bondMethod, value: method || null,
        options: Object.entries(BOND_LABELS).map(([value, text]) => ({ value, label: text })), onChange: setMethod,
      }) : null);
  }

  const debond = before.size || s.debond ? toggle({
    label: 'Debond: the stacks come apart here', checked: !!s.debond, onChange: (v) => o.update({ debond: v || undefined }),
    help: HELP.stepDebond,
  }) : null;

  const addsId = `stepadds-${sid}`;
  const remId = `steprem-${sid}`;
  const details = /** @type {HTMLDetailsElement} */ (h('details', { class: 'more step-extras', open: o.open },
    h('summary', { id: `extras-${sid}` }, summary),
    h('div', { class: 'stack' },
      waferChips, bonding, debond,
      // A spin coat's resist when the recipe does not name one (or there is no recipe) is the app's default.
      o.fromRecipe.length ? h('p', { class: 'field-note' }, s.recipe && o.fromRecipe.join() !== 'Photoresist'
        ? `From the recipe: ${o.fromRecipe.join(', ')}.`
        : 'A spin coat leaves resist: “Photoresist” unless you name the resist in Adds to the wafers.') : null,
      h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: addsId }, 'Adds to the wafers'), 'Adds to the wafers', HELP.stepAdds),
        textInput({ id: addsId, value: list(s.adds).join(', '), placeholder: 'e.g. Cr, Au', onChange: (v) => o.update({ adds: splitMaterials(v || '') }) }).el),
      h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: remId }, 'Removes from the wafers'), 'Removes from the wafers', HELP.stepRemoves),
        textInput({ id: remId, value: list(s.removes).join(', '), placeholder: 'e.g. SiO2 (thermal)', onChange: (v) => o.update({ removes: splitMaterials(v || '') }) }).el))));
  details.addEventListener('toggle', () => o.onToggle(details.open));
  return details;
}
