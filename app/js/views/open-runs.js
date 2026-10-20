// @ts-check
/** Open runs: draft and open runs, oldest first, with their age. */
import { h, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { linkButton, emptyState } from '../ui/components.js';
import { runList, lookups } from '../ui/run-list.js';
import { openRuns, listTools, listTemplates, getDraft, LOG_DRAFT } from '../data/repo.js';
import { formatDateTime } from '../core/time.js';

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Open runs');
  const [runs, tools, templates, draft] = await Promise.all([
    openRuns(), listTools({ includeArchived: true }), listTemplates(), getDraft(LOG_DRAFT),
  ]);
  const L = lookups(tools, templates);
  const unsaved = draft ? h('div', { class: 'banner banner-info' }, icon('edit'), h('div', { class: 'banner-body' },
    h('p', null, h('strong', null, 'Unsaved run form'), ` started ${formatDateTime(draft.startedAt, L.now)}.`),
    h('div', null, linkButton('Resume', `#/log/${draft.toolId}/${draft.templateId}`, { kind: 'primary' })))) : null;
  append(ctx.root, [
    unsaved,
    runs.length
      ? h('div', { class: 'stack' },
        h('p', { class: 'muted small' }, `${runs.length} run${runs.length === 1 ? '' : 's'} waiting for results, oldest first.`),
        runList(runs, L, { showAge: true }))
      : emptyState('No open runs. Runs stay open until you mark them complete.', linkButton('Log a run', '#/log', { kind: 'primary', icon: 'plus' })),
  ]);
}
