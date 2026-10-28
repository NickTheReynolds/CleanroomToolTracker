// @ts-check
/**
 * What comes after a plan step is finished (2.0): a sheet that names the
 * next step of the plan, with one button that goes there, so the person
 * moves from tool to tool without finding the way back through the project.
 * It also offers the finished step's pictures and files. Once every step is
 * done it offers the project page and Mark finished.
 */
import { h } from './dom.js';
import { button, linkButton, sheet, toast, errorText } from './components.js';
import { stepAfter, progress } from '../core/projects.js';

/** @typedef {import('../core/types.js').Project} Project */
/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/projects.js').StepState} StepState */

/** @param {string} projectId @param {string} stepId */
export const stepHref = (projectId, stepId) => `#/project/${encodeURIComponent(projectId)}/step/${encodeURIComponent(stepId)}`;

/**
 * @param {{project: Project, states: StepState[], stepId: string, tools: Map<string, Tool>, filesHref?: string | null,
 *   onFinishProject?: () => Promise<void>}} o
 *   stepId: the step just finished; filesHref: where its pictures and files are added; onFinishProject: Mark finished,
 *   offered once every step is done
 */
export function nextStepPrompt(o) {
  const next = stepAfter(o.states, o.stepId);
  const done = o.states.find((s) => s.step.id === o.stepId);
  const n = done ? done.index + 1 : 0;
  const prog = progress(o.states);
  const tool = next && next.step.toolId ? o.tools.get(next.step.toolId) : null;
  const sh = sheet(next ? `Step ${n} done` : 'Every step is done', [
    next ? h('div', { class: 'card stack next-step' },
      h('span', { class: 'label' }, 'Next step'),
      h('strong', { class: 'next-step-title' }, `${next.index + 1}. ${next.step.title}`),
      h('p', { class: 'muted small' }, [tool ? tool.shortName || tool.name : '', next.step.recipe, next.state === 'active' ? 'a run is in progress' : '']
        .filter(Boolean).join(' · ') || 'No tool chosen for this step.'),
      linkButton(`Go to step ${next.index + 1}`, stepHref(o.project.id, next.step.id), { kind: 'primary', icon: 'chevron', big: true }))
      : h('p', null, `All ${prog.total} planned step${prog.total === 1 ? '' : 's'} of ${o.project.name} ${prog.total === 1 ? 'is' : 'are'} done.`),
    h('div', { class: 'row-wrap' },
      !next && o.onFinishProject ? button('Mark the project finished', {
        kind: 'primary', icon: 'check',
        onClick: async () => {
          sh.close();
          try { await o.onFinishProject?.(); } catch (err) { toast(errorText(err), { kind: 'error' }); }
        },
      }) : null,
      o.filesHref ? linkButton('Add picture or file', o.filesHref, { icon: 'camera' }) : null,
      next ? null : linkButton('Back to the project', `#/project/${encodeURIComponent(o.project.id)}`, { icon: 'project' }),
      button('Stay here', { kind: 'ghost', onClick: () => sh.close() })),
  ]);
}
