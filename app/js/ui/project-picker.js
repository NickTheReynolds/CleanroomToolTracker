// @ts-check
/**
 * The Project part of run forms (Log run, Run detail, Quick capture): which
 * projects a run belongs to, which of their wafers it processed and which
 * planned step it carries out. Projects are optional: with none, the
 * section is not shown at all.
 */
import { h, fill, uid } from './dom.js';
import { icon } from './icons.js';
import { labelRow } from './components.js';
import { stepStates, defaultLink, activeWafers } from '../core/projects.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').Project} Project */
/** @typedef {import('../core/types.js').ProjectLink} ProjectLink */
/** @typedef {import('../core/types.js').Run} Run */

/** @type {Readonly<Record<string, string>>} */
const MARK = Object.freeze({ done: '✓ ', active: '… ', skipped: '– ', todo: '' });

/**
 * A toggle chip (aria-pressed) with a check mark when on.
 * @param {string} text
 * @param {boolean} on
 * @param {() => void} onClick
 * @param {string} key identifies the chip across redraws, so focus can return to it
 * @param {string} [label] accessible name when it differs from the text
 * @returns {HTMLElement}
 */
function toggleChip(text, on, onClick, key, label) {
  return h('button', { type: 'button', class: 'pick-btn', 'aria-pressed': String(on), 'aria-label': label, onClick, dataset: { key } },
    icon('check', { class: 'pick-check' }), text);
}

/**
 * @param {{projects: Project[], runs: Run[], toolId: string, links: ProjectLink[],
 *   onChange: (links: ProjectLink[]) => void, title?: string, openLinks?: boolean}} o
 *   projects: the active projects plus any the run already links to; openLinks: each linked
 *   project's name opens its page
 * @returns {HTMLElement | null} null when there is no project to offer
 */
export function projectLinks(o) {
  let links = [...o.links];
  const byId = new Map(o.projects.map((p) => [p.id, p]));
  const offered = o.projects.filter((p) => p.status === 'active' || links.some((l) => l.projectId === p.id));
  if (!offered.length) return null;
  const box = h('div', { class: 'stack project-links' });
  const set = (/** @type {ProjectLink[]} */ next) => {
    // The redraw replaces every control: give focus back to the one just used.
    const key = /** @type {HTMLElement | null} */ (document.activeElement)?.dataset?.key;
    links = next;
    o.onChange(links);
    draw();
    if (key) /** @type {HTMLElement | null} */ (box.querySelector(`[data-key="${CSS.escape(key)}"]`))?.focus();
  };
  const draw = () => {
    const chips = offered.map((p) => {
      const on = links.some((l) => l.projectId === p.id);
      return toggleChip(p.name, on, () => set(on ? links.filter((l) => l.projectId !== p.id)
        : [...links, defaultLink(p, o.runs, o.toolId)]), `p:${p.id}`, `${p.name}: ${on ? 'in' : 'not in'} this run`);
    });
    const cards = links.map((l) => {
      const p = byId.get(l.projectId);
      if (!p) return null;
      const wafers = p.wafers.filter((w) => w.status === 'active' || l.waferIds.includes(w.id));
      const update = (/** @type {Partial<ProjectLink>} */ patch) => set(links.map((x) => (x.projectId === l.projectId ? { ...x, ...patch } : x)));
      const allOn = wafers.length > 0 && wafers.every((w) => l.waferIds.includes(w.id));
      const states = stepStates(p, o.runs);
      const selId = uid('step');
      const sel = /** @type {HTMLSelectElement} */ (h('select', { id: selId, class: 'input', dataset: { key: `s:${p.id}` } },
        h('option', { value: '' }, 'Not a planned step'),
        states.map((s) => h('option', { value: s.step.id, selected: s.step.id === l.stepId },
          `${MARK[s.state]}${s.index + 1}. ${s.step.title}`))));
      sel.addEventListener('change', () => update({ stepId: sel.value || null }));
      const waferId = uid('wafers');
      return h('div', { class: 'card stack' },
        o.openLinks ? h('a', { class: 'project-open', href: `#/project/${encodeURIComponent(p.id)}` }, icon('project', { size: 18 }), p.name, icon('chevron', { size: 16 }))
          : h('strong', null, p.name),
        wafers.length ? h('div', { class: 'field' },
          labelRow(h('span', { class: 'label', id: waferId }, 'Wafers in this run'), 'Wafers in this run', HELP.runWafers),
          h('div', { class: 'picker', role: 'group', 'aria-labelledby': waferId },
            wafers.length > 1 ? toggleChip('All', allOn, () => update({ waferIds: allOn ? [] : activeWafers(p).map((w) => w.id) }),
              `a:${p.id}`, 'All wafers') : null,
            wafers.map((w) => {
              const on = l.waferIds.includes(w.id);
              return toggleChip(w.label, on, () => update({ waferIds: on ? l.waferIds.filter((x) => x !== w.id) : [...l.waferIds, w.id] }),
                `w:${p.id}:${w.id}`);
            }))) : null,
        states.length ? h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: selId }, 'Step of the plan'), 'Step of the plan', HELP.runPlanStep), sel) : null);
    });
    fill(box,
      h('div', { class: 'picker', role: 'group', 'aria-label': o.title || 'Projects' }, chips),
      cards);
  };
  draw();
  return box;
}
