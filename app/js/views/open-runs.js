// @ts-check
/**
 * Open runs: draft and open runs, oldest first, with their age and what
 * each one waits for (a post measurement, its time, results), so the next
 * thing to do is visible without opening every run.
 */
import { h, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { linkButton, emptyState } from '../ui/components.js';
import { runList, lookups } from '../ui/run-list.js';
import { openRuns, listTools, listTemplates, getDraft, LOG_DRAFT, allMeasurements, listProjects } from '../data/repo.js';
import { waitingFor } from '../core/derive.js';
import { formatDateTime } from '../core/time.js';

/** @typedef {import('../core/types.js').Measurement} Measurement */

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
  // Only a form someone typed in is worth resuming; an untouched one is just a prefilled copy.
  const tool = draft ? L.tools.get(draft.toolId) : null;
  const unsaved = draft && draft.touched ? h('div', { class: 'banner banner-info' }, icon('edit'), h('div', { class: 'banner-body' },
    h('p', null, h('strong', null, `Unsaved run on ${tool ? tool.shortName || tool.name : 'a tool'}`), `, started ${formatDateTime(draft.startedAt, L.now)}.`),
    h('div', null, linkButton('Resume', `#/log/${draft.toolId}/${draft.templateId}`, { kind: 'primary' })))) : null;
  append(ctx.root, [
    unsaved,
    runs.length
      ? h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, `${runs.length} run${runs.length === 1 ? '' : 's'} not complete yet, oldest first.`),
        runList(runs, L, { showAge: true, waiting }))
      : emptyState('No open runs. Runs stay open until you mark them complete.', linkButton('Log a run', '#/log', { kind: 'primary', icon: 'plus' })),
  ]);
}
