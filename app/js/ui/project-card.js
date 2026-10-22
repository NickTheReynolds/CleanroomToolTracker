// @ts-check
/**
 * A project at a glance, for Projects and Home: its name, goal, progress
 * through the plan, the next step and its wafers. Plus the progress bar the
 * project page uses.
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { badge, listRow } from './components.js';
import { stepStates, nextStep, progress, projectRuns, lastActivity, activeWafers } from '../core/projects.js';
import { PROJECT_STATUS_LABELS } from '../core/vocab.js';
import { formatAgo } from '../core/time.js';

/** @typedef {import('../core/types.js').Project} Project */
/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').Tool} Tool */

/**
 * A progress bar with its numbers for assistive technology.
 * @param {number} done
 * @param {number} total
 * @returns {HTMLElement}
 */
export function progressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('div', {
    class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done),
    'aria-label': `${done} of ${total} steps done`,
  }, h('span', { class: 'progress-fill', style: { width: `${pct}%` } }));
}

/**
 * "4. Etch oxide (LAM 9400)", the next step in words, or null.
 * @param {Project} p
 * @param {Run[]} runs the project's runs
 * @param {Map<string, Tool>} tools
 * @returns {{text: string, done: number, total: number}}
 */
export function nextStepText(p, runs, tools) {
  const states = stepStates(p, runs);
  const prog = progress(states);
  const next = nextStep(states);
  const tool = next && next.step.toolId ? tools.get(next.step.toolId) : null;
  const text = next ? `${next.index + 1}. ${next.step.title}${tool ? ` (${tool.shortName || tool.name})` : ''}` : '';
  return { text, ...prog };
}

/**
 * One project as a card that opens it.
 * @param {Project} p
 * @param {Run[]} runs every run
 * @param {Map<string, Tool>} tools
 * @returns {HTMLElement}
 */
export function projectCard(p, runs, tools) {
  const mine = projectRuns(runs, p.id);
  const next = nextStepText(p, mine, tools);
  const inProcess = activeWafers(p).length;
  const facts = [
    p.wafers.length ? `${inProcess} of ${p.wafers.length} wafer${p.wafers.length === 1 ? '' : 's'} in process` : '',
    `${mine.length} run${mine.length === 1 ? '' : 's'}`,
    `last activity ${formatAgo(lastActivity(p, mine), Date.now())}`,
  ].filter(Boolean).join(' · ');
  return h('a', { class: 'card project-card', href: `#/project/${encodeURIComponent(p.id)}` },
    h('span', { class: 'spread' }, h('span', { class: 'project-name' }, icon('project', { size: 20 }), p.name),
      p.status === 'active' ? null : badge(PROJECT_STATUS_LABELS[p.status] || p.status, p.status === 'done' ? 'ok' : 'muted')),
    p.goal ? h('span', { class: 'muted small clamp-2' }, p.goal) : null,
    next.total ? h('span', { class: 'stack project-progress' }, progressBar(next.done, next.total),
      h('span', { class: 'small' }, `${next.done} of ${next.total} steps done`,
        next.text ? h('span', { class: 'muted' }, ` · next: ${next.text}`) : null)) : null,
    h('span', { class: 'muted small' }, facts));
}

/**
 * A compact row for Home: the name, the next step and the progress.
 * @param {Project} p
 * @param {Run[]} runs every run
 * @param {Map<string, Tool>} tools
 * @returns {HTMLElement}
 */
export function projectRow(p, runs, tools) {
  const mine = projectRuns(runs, p.id);
  const next = nextStepText(p, mine, tools);
  return listRow({
    lead: icon('project'),
    title: p.name,
    subtitle: next.text ? `Next: ${next.text}` : next.total ? 'Every planned step is done' : `${mine.length} run${mine.length === 1 ? '' : 's'}`,
    meta: next.total ? `${next.done}/${next.total}` : undefined,
    href: `#/project/${encodeURIComponent(p.id)}`,
  });
}
