// @ts-check
/**
 * One project: its wafers and progress, the next step with "Log this step",
 * the plan, and the traveler: every run the project's wafers went through,
 * in process order, for all wafers or one. Export the traveler as PDF or
 * Excel; move it to a folder, copy it for the next batch, pause, finish,
 * reopen or delete it.
 */
import { h, append, fill } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  button, linkButton, section, segmented, badge, emptyState, listRow, toast, confirmDialog, sheet, errorText,
} from '../ui/components.js';
import { progressBar } from '../ui/project-card.js';
import { exportFlow } from '../ui/export-flow.js';
import { chooseFolder } from '../ui/folder-picker.js';
import { lookups, primaryText } from '../ui/run-list.js';
import { navigate, refresh } from '../router.js';
import {
  getProject, getRecord, saveProject, deleteProject, restoreProject, listRuns, listTools, listTemplates, listFolders,
  moveProjects, restoreChange,
} from '../data/repo.js';
import { makeTravelerExport } from '../data/backup.js';
import { planChecks } from '../data/plan-checks.js';
import { noteLine, notesSummary, openNotes, toggleChecked } from '../ui/compat-notes.js';
import { stepStates, nextStep, progress, projectRuns, linkFor, waferText } from '../core/projects.js';
import { specShort } from '../core/wafer-spec.js';
import { folderTree, pathText, projectFolderId } from '../core/folders.js';
import { PROJECT_STATUS_LABELS, WAFER_STATUS_LABELS, STATUS_LABELS } from '../core/vocab.js';
import { formatDay, formatDateTime } from '../core/time.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').Project} Project */
/** @typedef {import('../core/types.js').PlanStep} PlanStep */
/** @typedef {import('../core/projects.js').StepState} StepState */

/** @type {Readonly<Record<string, {icon: string, text: string, kind: 'ok' | 'info' | 'muted'}>>} */
const STATE = Object.freeze({
  done: { icon: 'check', text: 'Done', kind: 'ok' },
  active: { icon: 'timer', text: 'In progress', kind: 'info' },
  todo: { icon: 'flag', text: 'To do', kind: 'muted' },
  skipped: { icon: 'minus', text: 'Skipped', kind: 'muted' },
});

/**
 * The address that opens Log run in this project: on the step's tool and
 * template when the step names them, else at the tool picker. A template
 * that no longer exists is left out, so Log run offers the tool's others.
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
  const [runs, tools, templates, folders] = await Promise.all([
    listRuns(), listTools({ includeArchived: true }), listTemplates(), listFolders(),
  ]);
  const checks = await planChecks(p, tools, templates);
  const tree = folderTree(folders);
  const folderId = projectFolderId(tree, p);
  const L = lookups(tools, templates);
  const live = new Set(templates.map((t) => t.id));
  const mine = projectRuns(runs, id);
  const states = stepStates(p, mine);
  const prog = progress(states);
  const next = p.status === 'active' ? nextStep(states) : null;
  const toolName = (/** @type {string | null} */ tid) => {
    const t = tid ? L.tools.get(tid) : null;
    return t ? t.shortName || t.name : '';
  };
  const save = async (/** @type {Partial<Project>} */ patch, /** @type {string} */ message) => {
    try {
      await saveProject({ ...p, ...patch });
      toast(message);
      refresh();
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
  };

  /** @type {[string, string | Node][]} */
  const facts = [];
  if (folderId) facts.push(['Folder', h('a', { href: `#/folder/${encodeURIComponent(folderId)}` }, pathText(tree, folderId))]);
  facts.push(['Started', formatDay(p.startedAt, Date.now())]);
  if (p.endedAt) facts.push(['Finished', formatDay(p.endedAt, Date.now())]);
  if (p.substrate) facts.push(['Substrate', p.substrate]);
  // The wafers grouped by type: "W1–W4: Si · 100 mm · p · DSP".
  /** @type {Map<string, string[]>} */
  const byType = new Map();
  for (const w of p.wafers) if (w.spec) byType.set(specShort(w.spec), [...(byType.get(specShort(w.spec)) || []), w.id]);
  if ([...byType.keys()].some(Boolean)) {
    facts.push(['Types', [...byType].filter(([k]) => k).map(([k, ids]) => `${waferText(p, ids)}: ${k}`).join('; ')]);
  }
  facts.push(['Runs', String(mine.length)]);
  const header = h('div', { class: 'card stack project-head' },
    h('div', { class: 'spread' }, h('h2', { class: 'project-title' }, p.name),
      badge(PROJECT_STATUS_LABELS[p.status] || p.status, p.status === 'active' ? 'brand' : p.status === 'done' ? 'ok' : 'muted')),
    p.goal ? h('p', { class: 'pre-line' }, p.goal) : null,
    h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    p.wafers.length ? h('div', { class: 'row-wrap', role: 'list', 'aria-label': 'Wafers' }, p.wafers.map((w) => h('span', { role: 'listitem' }, badge(
      `${w.label}${w.status === 'active' ? '' : ` · ${String(WAFER_STATUS_LABELS[w.status] || w.status).toLowerCase()}`}`,
      w.status === 'scrapped' ? 'danger' : w.status === 'done' ? 'ok' : 'brand')))) : null,
    prog.total ? h('div', { class: 'stack' }, progressBar(prog.done, prog.total),
      h('p', { class: 'small muted' }, `${prog.done} of ${prog.total} planned steps done`)) : null);

  /** Mark a step's note as checked, or not, on the stored project. */
  const setChecked = async (/** @type {PlanStep} */ step, /** @type {string} */ key, /** @type {boolean} */ on, /** @type {(() => void) | undefined} */ close) => {
    close?.();
    await save({ steps: p.steps.map((x) => (x.id === step.id ? { ...x, checked: toggleChecked(x, key, on) } : x)) },
      on ? 'Marked as checked.' : 'The note counts again.');
  };
  /** @param {PlanStep} step @param {() => void} [close] */
  const noteLines = (step, close) => (checks.byStep.get(step.id) || []).map((n) => noteLine(n, {
    checked: (step.checked || []).includes(n.key), onCheck: (on) => setChecked(step, n.key, on, close),
  }));
  // The next step, one tap from logging it, with its notes first.
  const nextOpen = next ? openNotes(checks.byStep.get(next.step.id) || [], next.step) : [];
  const nextCard = next ? h('div', { class: 'card stack next-step' },
    h('span', { class: 'label' }, 'Next step'),
    h('strong', { class: 'next-step-title' }, `${next.index + 1}. ${next.step.title}`),
    h('p', { class: 'muted small' }, [toolName(next.step.toolId), next.step.recipe, next.state === 'active' ? 'a run is in progress' : '']
      .filter(Boolean).join(' · ') || 'No tool chosen for this step.'),
    nextOpen.length ? h('div', { class: 'compat-notes' }, h('p', { class: 'small' }, h('strong', null, 'Before you log this step:')), noteLines(next.step)) : null,
    linkButton('Log this step', logHref(p, next.step, live), { kind: 'primary', icon: 'plus', big: true })) : null;

  // The plan: a row per step; a row opens the step's sheet.
  const stepSheet = (/** @type {StepState} */ s) => {
    const st = STATE[s.state];
    const mark = async (/** @type {Partial<PlanStep>} */ patch, /** @type {string} */ message) => {
      sh.close();
      await save({ steps: p.steps.map((x) => (x.id === s.step.id ? { ...x, ...patch } : x)) }, message);
    };
    const bonds = (s.step.bonds || []).filter((b) => (b.waferIds || []).length >= 2);
    const label = (/** @type {string} */ wid) => p.wafers.find((w) => w.id === wid)?.label || '?';
    /** @type {[string, string][]} */
    const stepFacts = [['Tool', toolName(s.step.toolId) || 'Any'], ['Recipe', s.step.recipe || '–']];
    if ((s.step.waferIds || []).length) stepFacts.push(['Wafers', waferText(p, s.step.waferIds || []) || '–']);
    if (bonds.length) {
      stepFacts.push(['Bonds', `${bonds.map((b) => b.waferIds.map(label).join('+')).join(', ')}${bonds[0].method ? ` (${bonds[0].method})` : ''}`]);
    }
    if (s.step.debond) stepFacts.push(['Debond', 'The stacks come apart here']);
    if ((s.step.adds || []).length) stepFacts.push(['Adds', (s.step.adds || []).join(', ')]);
    if ((s.step.removes || []).length) stepFacts.push(['Removes', (s.step.removes || []).join(', ')]);
    stepFacts.push(['Notes', s.step.notes || '–']);
    const sh = sheet(`${s.index + 1}. ${s.step.title}`, [
      h('p', null, badge(st.text, st.kind, st.icon)),
      h('dl', { class: 'facts' }, stepFacts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      (checks.byStep.get(s.step.id) || []).length ? h('div', { class: 'compat-notes' }, noteLines(s.step, () => sh.close())) : null,
      s.runs.length ? h('div', { class: 'list' }, s.runs.map((r) => listRow({
        title: `${formatDateTime(r.startedAt, Date.now())} · ${toolName(r.toolId)}`,
        subtitle: [STATUS_LABELS[r.status], waferText(p, linkFor(r, p.id)?.waferIds || []), primaryText(r, L)].filter(Boolean).join(' · '),
        href: `#/run/${r.id}`,
      }))) : h('p', { class: 'muted' }, 'No run is linked to this step yet.'),
      p.status === 'active' ? linkButton('Log this step', logHref(p, s.step, live), { kind: 'primary', icon: 'plus', big: true }) : null,
      h('div', { class: 'row-wrap' },
        s.step.doneAt ? button('Undo “done”', { icon: 'undo', onClick: () => mark({ doneAt: null }, 'The step is no longer marked done.') })
          : s.state !== 'done' ? button('Mark done without a run', {
            icon: 'check', onClick: () => mark({ doneAt: new Date().toISOString(), skipped: false }, 'Step marked done.'),
          }) : null,
        s.step.skipped ? button('Don’t skip', { icon: 'undo', onClick: () => mark({ skipped: false }, 'The step is back in the plan.') })
          : s.state === 'todo' ? button('Skip this step', { icon: 'minus', onClick: () => mark({ skipped: true }, 'Step skipped.') }) : null),
      h('p', { class: 'muted small' }, 'A step is done when a complete run in this project is linked to it. Link a run to a step in the run’s Project section.'),
    ]);
  };
  const counts = (/** @type {PlanStep} */ step) => { const st = states.find((x) => x.step.id === step.id); return !!st && st.state !== 'done'; };
  const summary = notesSummary(checks.byStep, p.steps, counts);
  const plan = states.length ? section('Plan',
    summary ? h('p', { class: 'small plan-summary' }, icon('alert', { size: 16 }), h('span', null, summary)) : null,
    h('div', { class: 'list' }, states.map((s) => {
      const open = s.state === 'done' || s.state === 'skipped' ? [] : openNotes(checks.byStep.get(s.step.id) || [], s.step);
      return listRow({
        lead: icon(STATE[s.state].icon),
        title: `${s.index + 1}. ${s.step.title}`,
        subtitle: [toolName(s.step.toolId), s.step.recipe, s.doneAt ? `done ${formatDay(s.doneAt, Date.now())}` : STATE[s.state].text]
          .filter(Boolean).join(' · '),
        badges: open.some((n) => n.severity === 'stop') ? [badge('Not allowed', 'danger', 'ban')] : open.length ? [badge('Check', 'warn', 'alert')] : [],
        onClick: () => stepSheet(s),
      });
    }))) : null;

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
        href: `#/run/${r.id}`,
      });
    })) : emptyState(waferId ? 'No run has this wafer yet.' : 'No runs in this project yet. Tap Log run, or choose this project in a run’s Project section.'));
  };
  drawRecord('');
  const waferPick = p.wafers.length > 1 ? segmented({
    label: 'Show', compact: true, value: '', help: HELP.projectWaferFilter,
    options: [{ value: '', label: 'All wafers' }, ...p.wafers.map((w) => ({ value: w.id, label: w.label }))],
    onChange: (v) => drawRecord(v || ''),
  }) : null;

  const exports = h('div', { class: 'stack' },
    exportFlow({
      label: 'Traveler as PDF', icon: 'download', busy: () => 'Preparing the traveler…', make: () => makeTravelerExport(id, 'pdf'),
      ready: () => 'Ready. Share or download it below.', title: `Traveler: ${p.name}`, shared: 'Traveler shared.',
    }).el,
    exportFlow({
      label: 'Traveler as Excel', icon: 'chart', busy: () => 'Preparing the workbook…', make: () => makeTravelerExport(id, 'xlsx'),
      ready: () => 'Ready. Share or download it below.', title: `Traveler: ${p.name}`, shared: 'Workbook shared.',
    }).el);
  const actions = h('div', { class: 'row-wrap' },
    p.status === 'done'
      ? button('Reopen', { icon: 'undo', onClick: () => save({ status: 'active', endedAt: null }, 'The project is active again.') })
      : button('Mark finished', { icon: 'check', onClick: () => save({ status: 'done', endedAt: new Date().toISOString() }, 'Project finished.') }),
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
    nextCard,
    plan,
    section(`Traveler (${mine.length} run${mine.length === 1 ? '' : 's'})`, waferPick, recordBox),
    p.notes ? section('Notes', h('p', { class: 'pre-line' }, p.notes)) : null,
    section('Export', h('p', { class: 'muted small' }, 'Everything this project’s wafers went through, run by run, with inputs, results and measurements.'), exports),
    section('Project', actions),
  ]);
  /** @type {Node[]} */
  const bar = [linkButton('Edit', `#/project/${encodeURIComponent(id)}/edit`, { icon: 'edit' })];
  if (p.status !== 'done') bar.push(linkButton('Log run', logHref(p, null), { kind: 'primary', icon: 'plus' }));
  ctx.setActions(bar);
}
