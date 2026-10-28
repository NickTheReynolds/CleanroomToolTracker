// @ts-check
/**
 * Open runs: draft and open runs outside project steps, oldest first, with
 * their age and what each one waits for (a post measurement, its time,
 * results), so the next thing to do is visible without opening every run.
 * Runs on a live project's steps are the project's business: they are listed
 * apart, each a tap from its step's page, where Finish step completes it
 * (2.1).
 */
import { h, append } from '../ui/dom.js';
import { icon, categoryIcon } from '../ui/icons.js';
import { linkButton, emptyState, listRow, badge, section } from '../ui/components.js';
import { runList, lookups } from '../ui/run-list.js';
import { openRuns, listTools, listTemplates, getDraft, LOG_DRAFT, allMeasurements, listProjects } from '../data/repo.js';
import { waitingFor } from '../core/derive.js';
import { onProjectStep, stepLink } from '../core/projects.js';
import { formatDateTime, formatAgo } from '../core/time.js';
import { STATUS_LABELS } from '../core/vocab.js';

/** @typedef {import('../core/types.js').Measurement} Measurement */
/** @typedef {import('../core/types.js').Run} Run */

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Open runs');
  const [runs, tools, templates, draft, measurements, projects] = await Promise.all([
    openRuns(), listTools({ includeArchived: true }), listTemplates(), getDraft(LOG_DRAFT), allMeasurements(), listProjects(),
  ]);
  const L = lookups(tools, templates, projects);
  /** @type {Map<string, Measurement[]>} */
  const byRun = new Map();
  for (const m of measurements) {
    const list = byRun.get(m.runId);
    if (list) list.push(m);
    else byRun.set(m.runId, [m]);
  }
  const waiting = new Map(runs.map((r) => [r.id, waitingFor(r, r.templateId ? L.templates.get(r.templateId) : null, byRun.get(r.id) || [])]));
  const loose = runs.filter((r) => !onProjectStep(r, L.projects));
  const steps = runs.filter((r) => onProjectStep(r, L.projects));
  // Only a form someone typed in is worth resuming; an untouched one is just a prefilled copy.
  const tool = draft ? L.tools.get(draft.toolId) : null;
  const unsaved = draft && draft.touched ? h('div', { class: 'banner banner-info' }, icon('edit'), h('div', { class: 'banner-body' },
    h('p', null, h('strong', null, `Unsaved run on ${tool ? tool.shortName || tool.name : 'a tool'}`), `, started ${formatDateTime(draft.startedAt, L.now)}.`),
    h('div', null, linkButton('Resume', `#/log/${draft.toolId}/${draft.templateId}`, { kind: 'primary' })))) : null;
  // A run on a project's step: the project and the step, and what the run waits for; the row opens the step's page.
  const stepRow = (/** @type {Run} */ r) => {
    const l = /** @type {import('../core/types.js').ProjectLink} */ (stepLink(r, L.projects));
    const p = /** @type {import('../core/types.js').Project} */ (L.projects.get(l.projectId));
    const i = p.steps.findIndex((s) => s.id === l.stepId);
    const t = L.tools.get(r.toolId);
    return listRow({
      lead: categoryIcon(t ? t.category : 'other'),
      title: `${p.name} · step ${i + 1}: ${p.steps[i].title}`,
      subtitle: [t ? t.shortName || t.name : 'Unknown tool', waiting.get(r.id), formatAgo(r.startedAt, L.now)].filter(Boolean).join(' · '),
      badges: r.status === 'draft' ? [badge(STATUS_LABELS.draft, 'warn')] : [],
      href: `#/project/${encodeURIComponent(p.id)}/step/${encodeURIComponent(/** @type {string} */ (l.stepId))}`,
    });
  };
  append(ctx.root, [
    unsaved,
    loose.length
      ? h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, `${loose.length} run${loose.length === 1 ? '' : 's'} not complete yet, oldest first.`),
        runList(loose, L, { showAge: true, waiting }))
      : emptyState(steps.length ? 'No open runs outside your projects’ steps.' : 'No open runs. Runs stay open until you mark them complete.',
        linkButton('Log a run', '#/log', { kind: 'primary', icon: 'plus' })),
    steps.length ? section(`Steps in progress (${steps.length})`,
      h('p', { class: 'muted small' }, 'Runs on a project’s steps are tracked by the project. Open one to add its measurements or finish it.'),
      h('div', { class: 'list' }, steps.map(stepRow))) : null,
  ]);
}
