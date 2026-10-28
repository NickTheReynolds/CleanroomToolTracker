// @ts-check
/**
 * One project, the hub of its work (2.0): its name, status and progress,
 * the step to do next with Continue, and the plan as a list of steps, each
 * opening its own page on its tool (views/project-step.js). Running timers
 * on its runs show at the top. Wafers and masks, the traveler (every run
 * the project's wafers went through, for all wafers or one), notes, exports
 * and the project's actions (move, copy, pause, finish, mark failed, delete)
 * wait under folds. Once it ends, its head is green, or red when it failed.
 */
import { h, append, fill } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  button, linkButton, section, segmented, badge, emptyState, listRow, toast, confirmDialog, sheet, errorText, labelRow,
} from '../ui/components.js';
import { textInput } from '../ui/fields.js';
import { stepBar, statusBadge, statusTone } from '../ui/project-card.js';
import { exportFlow } from '../ui/export-flow.js';
import { chooseFolder } from '../ui/folder-picker.js';
import { lookups, primaryText } from '../ui/run-list.js';
import { timerStrip } from '../ui/timers.js';
import { stepHref } from '../ui/step-flow.js';
import { navigate, refresh } from '../router.js';
import {
  getProject, getRecord, saveProject, deleteProject, restoreProject, listRuns, listTools, listTemplates, listFolders,
  moveProjects, restoreChange, listProjects,
} from '../data/repo.js';
import { makeTravelerExport } from '../data/backup.js';
import { planChecks } from '../data/plan-checks.js';
import { openNotes, notesSummary } from '../ui/compat-notes.js';
import { stepStates, nextStep, progress, projectRuns, linkFor, waferText, projectStatus, statusPatch } from '../core/projects.js';
import { specShort } from '../core/wafer-spec.js';
import { folderTree, pathText, projectFolderId } from '../core/folders.js';
import { WAFER_STATUS_LABELS, STATUS_LABELS } from '../core/vocab.js';
import { formatDay, formatDateTime } from '../core/time.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').Project} Project */
/** @typedef {import('../core/types.js').PlanStep} PlanStep */

/** @type {Readonly<Record<string, {icon: string, text: string}>>} */
const STATE = Object.freeze({
  done: { icon: 'check', text: 'Done' },
  active: { icon: 'timer', text: 'In progress' },
  todo: { icon: 'flag', text: 'To do' },
  skipped: { icon: 'minus', text: 'Skipped' },
});

/**
 * The address that opens Log run in this project: on the step's tool and
 * template when the step names them, else at the tool picker.
 * @param {Project} p
 * @param {PlanStep | null} step
 * @param {ReadonlySet<string>} [live] ids of the templates that exist
 * @returns {string}
 */
export function logHref(p, step, live) {
  const q = new URLSearchParams({ project: p.id });
  if (step) q.set('step', step.id);
  const tpl = step && step.templateId && (!live || live.has(step.templateId)) ? `/${encodeURIComponent(step.templateId)}` : '';
  const tool = step && step.toolId ? `/${encodeURIComponent(step.toolId)}${tpl}` : '';
  return `#/log${tool}?${q}`;
}

/**
 * A fold: a titled block that opens on tap, so the page shows only what
 * matters now.
 * @param {string} title
 * @param {...import('../ui/dom.js').Child} children
 * @returns {HTMLElement}
 */
const fold = (title, ...children) => h('details', { class: 'more fold' }, h('summary', null, icon('down', { size: 18 }), title), h('div', { class: 'stack' }, children));

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const id = ctx.params.id;
  const p = await getProject(id);
  ctx.setTitle('Project');
  if (!p) {
    const gone = await getRecord('projects', id);
    append(ctx.root, [emptyState(gone ? 'This project was deleted.' : 'This project does not exist.',
      gone ? button('Restore project', { kind: 'primary', icon: 'undo', onClick: async () => { await restoreProject(id); refresh(); } })
        : linkButton('All projects', '#/projects'))]);
    return;
  }
  const [runs, tools, templates, folders, projects] = await Promise.all([
    listRuns(), listTools({ includeArchived: true }), listTemplates(), listFolders(), listProjects(),
  ]);
  const checks = await planChecks(p, tools, templates);
  if (!ctx.isCurrent()) return;
  const tree = folderTree(folders);
  const folderId = projectFolderId(tree, p);
  const L = lookups(tools, templates, projects);
  const live = new Set(templates.map((t) => t.id));
  const mine = projectRuns(runs, id);
  const states = stepStates(p, mine);
  const prog = progress(states);
  const shown = projectStatus(p);
  const next = p.status === 'active' ? nextStep(states) : null;
  const toolName = (/** @type {string | null} */ tid) => {
    const t = tid ? L.tools.get(tid) : null;
    return t ? t.shortName || t.name : '';
  };
  /**
   * Save a change to the project as stored now.
   * @param {Partial<Project> | ((cur: Project) => Partial<Project>)} patch
   * @param {string} message
   */
  const save = async (patch, message) => {
    try {
      const cur = (await getProject(id)) || p;
      await saveProject({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) });
      toast(message);
      refresh();
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
  };

  // The head: name, status, goal, progress and a line of facts.
  const inProcess = p.wafers.filter((w) => w.status === 'active').length;
  const facts = [
    p.wafers.length ? `${inProcess} of ${p.wafers.length} wafer${p.wafers.length === 1 ? '' : 's'} in process` : '',
    `${mine.length} run${mine.length === 1 ? '' : 's'}`,
    `started ${formatDay(p.startedAt, Date.now())}`,
    p.endedAt ? `${shown === 'failed' ? 'failed' : 'finished'} ${formatDay(p.endedAt, Date.now())}` : '',
  ].filter(Boolean).join(' · ');
  const header = h('div', { class: ['card stack project-head', statusTone(p)] },
    h('div', { class: 'spread' }, h('h2', { class: 'project-title' }, p.name), statusBadge(p)),
    shown === 'failed' && p.failReason ? h('p', { class: 'pre-line' }, h('strong', null, 'What went wrong: '), p.failReason) : null,
    p.goal ? h('p', { class: 'pre-line' }, p.goal) : null,
    prog.total ? h('div', { class: 'stack' }, stepBar(states), h('p', { class: 'small muted' }, `${prog.done} of ${prog.total} planned steps done`)) : null,
    h('p', { class: 'small muted' }, facts, folderId ? [' · in ', h('a', { href: `#/folder/${encodeURIComponent(folderId)}` }, pathText(tree, folderId))] : null));
  const timers = timerStrip({ tools: L.tools, projects: L.projects, filter: (r) => !!linkFor(r, id) });

  // The step to do next, one tap away.
  const nextCard = next ? h('div', { class: 'card stack next-step' },
    h('span', { class: 'label' }, next.state === 'active' ? 'In progress' : 'Next step'),
    h('strong', { class: 'next-step-title' }, `${next.index + 1}. ${next.step.title}`),
    h('p', { class: 'muted small' }, [toolName(next.step.toolId), next.step.recipe].filter(Boolean).join(' · ') || 'No tool chosen for this step.'),
    linkButton(next.state === 'active' ? 'Continue' : 'Start this step', stepHref(id, next.step.id), { kind: 'primary', icon: next.state === 'active' ? 'play' : 'chevron', big: true }))
    : null;

  // The plan: a row per step, each opening the step's page.
  const counts = (/** @type {PlanStep} */ step) => { const st = states.find((x) => x.step.id === step.id); return !!st && st.state !== 'done'; };
  const summary = notesSummary(checks.byStep, p.steps, counts);
  const plan = states.length ? section(`Steps (${prog.done} of ${prog.total} done)`,
    summary ? h('p', { class: 'small plan-summary' }, icon('alert', { size: 16 }), h('span', null, summary)) : null,
    h('div', { class: 'list' }, states.map((s) => {
      const open = s.state === 'done' || s.state === 'skipped' ? [] : openNotes(checks.byStep.get(s.step.id) || [], s.step);
      const n = (s.step.attachments || []).length;
      const tool = s.step.toolId ? L.tools.get(s.step.toolId) : null;
      return listRow({
        lead: icon(STATE[s.state].icon, { class: `state-${s.state}` }),
        title: `${s.index + 1}. ${s.step.title}`,
        subtitle: [toolName(s.step.toolId), s.step.recipe, s.doneAt ? `done ${formatDay(s.doneAt, Date.now())}` : STATE[s.state].text,
          n ? `${n} picture${n === 1 ? '' : 's'} or file${n === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '),
        badges: open.some((x) => x.severity === 'stop') ? [badge('Not allowed', 'danger', 'ban')] : open.length ? [badge('Check', 'warn', 'alert')] : [],
        href: stepHref(id, s.step.id),
        meta: tool ? h('span', { class: 'cat-dot', dataset: { category: tool.category }, 'aria-hidden': 'true' }) : undefined,
      });
    }))) : section('Steps', emptyState('No steps planned yet. A plan lists the steps in order; each opens on its tool.',
    linkButton('Plan the steps', `#/project/${encodeURIComponent(id)}/edit`, { icon: 'edit' })));

  // Wafers and masks, with their types.
  /** @type {Map<string, string[]>} */
  const byType = new Map();
  for (const w of p.wafers) if (w.spec) byType.set(specShort(w.spec), [...(byType.get(specShort(w.spec)) || []), w.id]);
  const wafers = p.wafers.length ? fold(`Wafers and masks (${p.wafers.length})`,
    h('div', { class: 'row-wrap', role: 'list', 'aria-label': 'Wafers' }, p.wafers.map((w) => h('span', { role: 'listitem' }, badge(
      `${w.label}${w.status === 'active' ? '' : ` · ${String(WAFER_STATUS_LABELS[w.status] || w.status).toLowerCase()}`}`,
      w.status === 'scrapped' ? 'danger' : w.status === 'done' ? 'ok' : 'tag')))),
    [...byType.keys()].some(Boolean) ? h('p', { class: 'small muted' }, [...byType].filter(([k]) => k).map(([k, ids]) => `${waferText(p, ids)}: ${k}`).join('; ')) : null,
    p.substrate ? h('p', { class: 'small muted' }, `Substrate ${p.substrate}`) : null) : null;

  // The traveler: runs in process order, for all wafers or one.
  const recordBox = h('div', { class: 'stack' });
  const drawRecord = (/** @type {string} */ waferId) => {
    const list = waferId ? projectRuns(runs, id, waferId) : mine;
    fill(recordBox, list.length ? h('div', { class: 'list' }, list.map((r, i) => {
      const link = linkFor(r, id);
      const s = states.find((x) => x.step.id === link?.stepId);
      const tpl = r.templateId ? L.templates.get(r.templateId) : null;
      return listRow({
        lead: h('span', { class: 'traveler-no' }, String(i + 1)),
        title: `${formatDay(r.startedAt, Date.now())} · ${toolName(r.toolId) || 'Unknown tool'}${tpl ? ` · ${tpl.name}` : ''}`,
        subtitle: [s ? `step ${s.index + 1}: ${s.step.title}` : '', waferId ? '' : waferText(p, link?.waferIds || []), r.recipe, primaryText(r, L)]
          .filter(Boolean).join(' · '),
        badges: r.status === 'complete' ? [] : [badge(STATUS_LABELS[r.status] || r.status, r.status === 'draft' ? 'warn' : 'info')],
        href: s ? stepHref(id, s.step.id) : `#/run/${r.id}`,
      });
    })) : emptyState(waferId ? 'No run has this wafer yet.' : 'No runs in this project yet. Start a step, or choose this project in a run’s Project section.'));
  };
  drawRecord('');
  const waferPick = p.wafers.length > 1 ? segmented({
    label: 'Show', compact: true, value: '', help: HELP.projectWaferFilter,
    options: [{ value: '', label: 'All wafers' }, ...p.wafers.map((w) => ({ value: w.id, label: w.label }))],
    onChange: (v) => drawRecord(v || ''),
  }) : null;

  const exports = h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'Everything this project’s wafers went through, run by run, with inputs, results and measurements.'),
    exportFlow({
      label: 'Traveler as PDF', icon: 'download', busy: () => 'Preparing the traveler…', make: () => makeTravelerExport(id, 'pdf'),
      ready: () => 'Ready. Share or download it below.', title: `Traveler: ${p.name}`, shared: 'Traveler shared.',
    }).el,
    exportFlow({
      label: 'Traveler as Excel', icon: 'chart', busy: () => 'Preparing the workbook…', make: () => makeTravelerExport(id, 'xlsx'),
      ready: () => 'Ready. Share or download it below.', title: `Traveler: ${p.name}`, shared: 'Workbook shared.',
    }).el);
  // Failed: what went wrong (optional) shows under the name and in the traveler; a second failure starts from the first's words.
  const markFailed = () => {
    let reason = p.failReason || '';
    const input = textInput({
      id: 'fail-reason', value: reason, multiline: true, placeholder: 'e.g. the resist lifted off in develop', onChange: (v) => { reason = v || ''; },
    });
    const sh = sheet('Mark this project failed', [
      h('div', { class: 'field' },
        labelRow(h('label', { class: 'label', for: 'fail-reason' }, 'What went wrong (optional)'), 'What went wrong', HELP.projectFailReason), input.el),
      h('p', { class: 'muted small' }, 'Its card turns red. Its runs and wafers stay as they are; you can reopen it, or copy it to try again.'),
      h('div', { class: 'row-wrap' },
        button('Mark failed', {
          kind: 'danger', icon: 'close',
          onClick: () => { sh.close(); save((cur) => ({ ...statusPatch(cur, 'failed'), failReason: reason.trim() }), 'Project marked failed.'); },
        }),
        button('Cancel', { onClick: () => sh.close() })),
    ]);
  };
  const ended = shown === 'done' || shown === 'failed';
  const actions = h('div', { class: 'row-wrap' },
    ended ? button('Reopen', { icon: 'undo', onClick: () => save((cur) => statusPatch(cur, 'active'), 'The project is active again.') }) : null,
    shown === 'done' ? null : button('Mark finished', { icon: 'check', onClick: () => save((cur) => statusPatch(cur, 'done'), 'Project finished.') }),
    shown === 'failed' ? null : button('Mark failed', { icon: 'close', onClick: markFailed }),
    p.status === 'active' ? button('Pause', { icon: 'pause', onClick: () => save({ status: 'paused' }, 'Project paused.') })
      : p.status === 'paused' ? button('Resume', { icon: 'play', onClick: () => save({ status: 'active' }, 'The project is active again.') }) : null,
    button(folderId ? 'Move to another folder' : 'Move to a folder', {
      icon: 'move',
      onClick: () => chooseFolder({
        title: `Move “${p.name}” to`, folders, current: folderId,
        onPick: async (target) => {
          try {
            const undo = await moveProjects([id], target);
            const place = pathText(folderTree(await listFolders()), target);
            toast(place ? `Moved to ${place}.` : 'Moved to the top level.', {
              action: { label: 'Undo', fn: async () => { await restoreChange(undo); refresh(); } },
            });
            refresh();
          } catch (err) {
            toast(errorText(err), { kind: 'error' });
          }
        },
      }),
    }),
    linkButton('Copy project', `#/project/new?copy=${encodeURIComponent(id)}`, { icon: 'copy' }),
    linkButton('Log a run without a step', logHref(p, null), { icon: 'plus' }),
    button('Delete project', {
      icon: 'trash', kind: 'ghost',
      onClick: async () => {
        if (!await confirmDialog({
          title: 'Delete this project?', confirmLabel: 'Delete', danger: true,
          message: 'Its runs stay, without the project. You can undo for a few seconds; the record is kept as deleted.',
        })) return;
        await deleteProject(id);
        navigate(folderId ? `/folder/${encodeURIComponent(folderId)}` : '/projects', { replace: true });
        toast('Project deleted.', { action: { label: 'Undo', fn: async () => { await restoreProject(id); navigate(`/project/${id}`); } } });
      },
    }));

  append(ctx.root, [
    header,
    timers.el,
    nextCard,
    plan,
    wafers,
    fold(`Traveler (${mine.length} run${mine.length === 1 ? '' : 's'})`, waferPick, recordBox),
    p.notes ? fold('Notes', h('p', { class: 'pre-line' }, p.notes)) : null,
    fold('Export', exports),
    fold('Project actions', actions),
  ]);
  /** @type {Node[]} */
  const bar = [linkButton('Edit plan', `#/project/${encodeURIComponent(id)}/edit`, { icon: 'edit' })];
  if (next) bar.push(linkButton(next.state === 'active' ? 'Continue' : 'Start', stepHref(id, next.step.id), { kind: 'primary', icon: next.state === 'active' ? 'play' : 'chevron' }));
  else if (p.status !== 'done') bar.push(linkButton('Log run', logHref(p, null, live), { kind: 'primary', icon: 'plus' }));
  ctx.setActions(bar);
  return () => timers.dispose();
}
