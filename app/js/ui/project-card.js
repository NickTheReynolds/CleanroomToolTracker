// @ts-check
/**
 * A project at a glance, for Projects and Home: its name, goal, progress
 * through the plan, the next step and its wafers; green once finished, red
 * when it failed. Plus the step bar and status badge the project page uses.
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { badge } from './components.js';
import {
  stepStates, nextStep, progress, projectRuns, lastActivity, activeWafers, processItems, projectStatus,
} from '../core/projects.js';
import { isMask } from '../core/wafer-spec.js';
import { PROJECT_STATUS_LABELS } from '../core/vocab.js';
import { formatAgo } from '../core/time.js';

/** @typedef {import('../core/types.js').Project} Project */
/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/projects.js').StepState} StepState */

/** Above this many steps the bar is one fill instead of a segment per step. */
const MAX_SEGMENTS = 40;

/**
 * How each status looks: its badge, and the card's colour once the project
 * ended (layout.css). The badge says it in words, so colour is never alone.
 * @type {Readonly<Record<string, {kind: 'brand' | 'muted' | 'ok' | 'danger', icon?: string, tone?: string}>>}
 */
const LOOK = Object.freeze({
  active: { kind: 'brand' },
  paused: { kind: 'muted' },
  done: { kind: 'ok', icon: 'check', tone: 'project-finished' },
  failed: { kind: 'danger', icon: 'close', tone: 'project-failed' },
});

/**
 * A project's status as a badge: Finished in green with a check, Failed in
 * red with a cross.
 * @param {Project} p
 * @returns {HTMLElement}
 */
export function statusBadge(p) {
  const s = projectStatus(p);
  const look = LOOK[s] || LOOK.paused;
  return badge(PROJECT_STATUS_LABELS[s] || s, look.kind, look.icon);
}

/**
 * The class that colours a project's card: green when it is finished, red
 * when it failed, none before it ends.
 * @param {Project} p
 * @returns {string | null}
 */
export function statusTone(p) {
  return LOOK[projectStatus(p)]?.tone || null;
}

/**
 * The plan's progress as a bar with a segment per step, done, in progress or
 * to do (skipped steps are left out), with its numbers for assistive
 * technology.
 * @param {StepState[]} states
 * @returns {HTMLElement}
 */
export function stepBar(states) {
  const counted = states.filter((s) => s.state !== 'skipped');
  const { done, total } = progress(states);
  const active = counted.filter((s) => s.state === 'active').length;
  const attrs = {
    role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done),
    'aria-label': `${done} of ${total} steps done${active ? `, ${active} in progress` : ''}`,
  };
  if (total > MAX_SEGMENTS) {
    return h('div', { ...attrs, class: 'step-bar step-bar-fill' },
      h('span', { class: 'is-done', style: { width: `${Math.round((done / total) * 100)}%` } }));
  }
  return h('div', { ...attrs, class: 'step-bar' }, counted.map((s) => h('span', { class: `is-${s.state}` })));
}

/**
 * "4. Etch oxide (LAM 9400)", the next step in words, or '', with the plan's
 * progress.
 * @param {Project} p
 * @param {Run[]} runs the project's runs
 * @param {Map<string, Tool>} tools
 * @returns {{text: string, done: number, total: number, states: StepState[], next: StepState | null}}
 */
export function nextStepText(p, runs, tools) {
  const states = stepStates(p, runs);
  const prog = progress(states);
  const next = nextStep(states);
  const tool = next && next.step.toolId ? tools.get(next.step.toolId) : null;
  const text = next ? `${next.index + 1}. ${next.step.title}${tool ? ` (${tool.shortName || tool.name})` : ''}` : '';
  return { text, ...prog, states, next };
}

/**
 * One project as a card that opens it. Its name is the link, stretched over
 * the card, so the card can also hold a Copy button.
 * @param {Project} p
 * @param {Run[]} runs every run
 * @param {Map<string, Tool>} tools
 * @param {{copy?: boolean}} [o] copy: a Copy button that opens a new project copied from this one
 * @returns {HTMLElement}
 */
export function projectCard(p, runs, tools, o = {}) {
  const mine = projectRuns(runs, p.id);
  const next = nextStepText(p, mine, tools);
  const inProcess = activeWafers(p).length;
  const items = processItems(p);
  // A project of masks counts its masks; one with wafers counts wafers and names its masks apart.
  const maskOnly = items.length > 0 && items.every(isMask);
  const masks = maskOnly ? 0 : p.wafers.filter(isMask).length;
  const noun = maskOnly ? 'mask' : 'wafer';
  const facts = [
    items.length ? `${inProcess} of ${items.length} ${noun}${items.length === 1 ? '' : 's'} in process` : '',
    masks ? `${masks} mask${masks === 1 ? '' : 's'}` : '',
    `${mine.length} run${mine.length === 1 ? '' : 's'}`,
    `last activity ${formatAgo(lastActivity(p, mine), Date.now())}`,
  ].filter(Boolean).join(' · ');
  return h('div', { class: ['card project-card', statusTone(p)] },
    h('span', { class: 'spread' },
      h('a', { class: 'project-name project-link', href: `#/project/${encodeURIComponent(p.id)}` }, icon('project', { size: 20 }), p.name),
      p.status === 'active' ? null : statusBadge(p)),
    p.goal ? h('span', { class: 'muted small clamp-2' }, p.goal) : null,
    next.total ? h('span', { class: 'stack project-progress' }, stepBar(next.states),
      h('span', { class: 'small' }, `${next.done} of ${next.total} steps done`,
        next.text ? h('span', { class: 'muted' }, ` · next: ${next.text}`) : null)) : null,
    h('span', { class: 'project-card-foot' }, h('span', { class: 'muted small' }, facts),
      o.copy ? h('a', {
        class: 'btn btn-ghost project-card-copy', href: `#/project/new?copy=${encodeURIComponent(p.id)}`, 'aria-label': `Copy ${p.name}`,
      }, icon('copy'), h('span', null, 'Copy')) : null));
}

/**
 * Where "Continue" on a project goes: the page of the step in progress or
 * next, else the project itself.
 * @param {Project} p
 * @param {StepState | null} next
 * @returns {string}
 */
export function continueHref(p, next) {
  const base = `#/project/${encodeURIComponent(p.id)}`;
  return next ? `${base}/step/${encodeURIComponent(next.step.id)}` : base;
}

/**
 * A project's progress for Home: its name (the link, stretched over the card
 * as on Projects), the step bar, the step in progress or next with a
 * Continue button that opens that step's page, and when anything last
 * happened.
 * @param {Project} p
 * @param {Run[]} runs every run
 * @param {Map<string, Tool>} tools
 * @returns {HTMLElement}
 */
export function projectProgress(p, runs, tools) {
  const mine = projectRuns(runs, p.id);
  const next = nextStepText(p, mine, tools);
  const doing = next.next?.state === 'active';
  return h('div', { class: 'card project-card' },
    h('span', { class: 'spread' }, h('a', { class: 'project-name project-link', href: `#/project/${encodeURIComponent(p.id)}` }, p.name),
      next.total ? h('span', { class: 'progress-count', 'aria-hidden': 'true' }, `${next.done}/${next.total}`) : null),
    next.total ? stepBar(next.states) : null,
    h('span', { class: 'project-card-foot' },
      h('span', { class: 'small' }, next.text
        ? [h('strong', { class: [doing && 'state-active'] }, doing ? 'In progress: ' : 'Next: '), next.text]
        : next.total ? 'Every planned step is done.' : 'No steps planned yet.'),
      next.next ? h('a', { class: 'btn btn-primary project-card-go', href: continueHref(p, next.next), 'aria-label': `${doing ? 'Continue' : 'Start'} ${p.name}: ${next.text}` },
        icon(doing ? 'play' : 'chevron'), h('span', null, doing ? 'Continue' : 'Start')) : null),
    h('span', { class: 'muted small' }, `Last activity ${formatAgo(lastActivity(p, mine), Date.now())}`));
}
