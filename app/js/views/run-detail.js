// @ts-check
/**
 * Run detail: a run on its own, or one reached from History or Open runs.
 * The tool's card, then where the run stands (its status, when it started,
 * what it waits for, and the project step it carries out, one tap away),
 * then the run editor (ui/run-editor.js): recipe, inputs, timer, results,
 * with the rest under More details; a complete run opens as a summary with
 * Edit values. Actions: Measure, Mark complete (then, in a project, on to the
 * next step) or Reopen, Duplicate, Delete (soft, with Undo).
 */
import { h, append, fill } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, linkButton, section, badge, emptyState, toast, confirmDialog } from '../ui/components.js';
import { toolCard } from '../ui/tool-card.js';
import { runEditor } from '../ui/run-editor.js';
import { nextStepPrompt, stepHref } from '../ui/step-flow.js';
import { navigate, refresh } from '../router.js';
import {
  getRecord, recomputeRun, getTool, getTemplate, listTemplates, listMeasurements, listTools, listRuns, listProjects,
  deleteRun, restoreRun, startLogDraft, getSettings, saveSettings, listPhotos, saveProject, getProject,
} from '../data/repo.js';
import { recipesForTool } from '../data/recipes.js';
import { blankDraft, prefillFrom } from '../core/run-draft.js';
import { recipesFor } from '../core/recipes.js';
import { waitingFor } from '../core/derive.js';
import { runLinks, stepStates, statusPatch } from '../core/projects.js';
import { uuid } from '../core/ids.js';
import { formatDateTime } from '../core/time.js';
import { STATUS_LABELS } from '../core/vocab.js';

/** @typedef {import('../core/types.js').Run} Run */

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const id = ctx.params.id;
  ctx.setTitle('Run');
  const stored = await getRecord('runs', id);
  if (!stored || stored.deleted) {
    append(ctx.root, [emptyState(stored ? 'This run was deleted.' : 'This run does not exist.',
      stored ? button('Restore run', { kind: 'primary', icon: 'undo', onClick: async () => { await restoreRun(id); refresh(); } })
        : linkButton('Home', '#/'))]);
    return;
  }
  /** @type {Run} */
  let run = (await recomputeRun(id)) || stored;
  const [tool, template, measurements, tools, settings, runs, localPhotos, recipes, toolTemplates, projects] = await Promise.all([
    getTool(run.toolId), run.templateId ? getTemplate(run.templateId) : null, listMeasurements(id),
    listTools({ includeArchived: true }), getSettings(), listRuns(), listPhotos(id), recipesForTool(run.toolId),
    listTemplates(run.toolId), listProjects(),
  ]);
  if (!ctx.isCurrent()) return;
  const shownRecipes = template ? recipesFor(recipes, template, toolTemplates) : recipes;
  // The project step the run carries out, if any: its page is where the step is done.
  const link = runLinks(run).find((l) => l.stepId) || runLinks(run)[0] || null;
  const project = link ? projects.find((x) => x.id === link.projectId) || null : null;
  const stepIndex = project && link ? project.steps.findIndex((x) => x.id === link.stepId) : -1;

  const star = async (/** @type {boolean} */ on) => {
    if (!tool) return;
    const mine = new Set((await getSettings()).myTools || []);
    if (on) mine.add(tool.id);
    else mine.delete(tool.id);
    await saveSettings({ myTools: [...mine] });
    toast(on ? `${tool.shortName || tool.name} is now one of your tools.` : `${tool.shortName || tool.name} is no longer one of your tools.`);
  };
  const editor = runEditor({
    run, template, tool, measurements, tools, settings, runs, projects, recipes: shownRecipes, toolTemplates, localPhotos,
    summary: run.status === 'complete', onReload: refresh, onChange: (r) => { run = r; drawHead(); drawActions(); },
  });

  // Where the run stands.
  const head = h('div', { class: 'card stack' });
  const drawHead = () => {
    const why = run.status === 'complete' || !template ? '' : waitingFor(run, template, measurements);
    fill(head,
      h('div', { class: 'row-wrap' },
        badge(STATUS_LABELS[run.status], run.status === 'complete' ? 'ok' : run.status === 'draft' ? 'warn' : 'info', run.status === 'complete' ? 'check' : undefined),
        run.status === 'draft' ? button('Mark open', { kind: 'ghost', onClick: () => setStatus('open') }) : null),
      h('p', { class: 'muted' }, `Started ${formatDateTime(run.startedAt, Date.now())}${run.author ? ` · by ${run.author}` : ''}`),
      why ? h('p', { class: 'small' }, why === 'ready to mark complete' ? 'This run is ready to mark complete.' : `This run ${why}.`) : null,
      tool ? null : h('p', null, 'Unknown tool'),
      project && link ? h('a', { class: 'project-open', href: stepIndex >= 0 ? stepHref(project.id, /** @type {string} */ (link.stepId)) : `#/project/${encodeURIComponent(project.id)}` },
        icon('project', { size: 18 }), stepIndex >= 0 ? `${project.name} · step ${stepIndex + 1}: ${project.steps[stepIndex].title}` : project.name, icon('chevron', { size: 16 })) : null);
  };
  const setStatus = async (/** @type {'draft' | 'open' | 'complete'} */ status) => {
    if (!await editor.setStatus(status)) return;
    run = editor.current();
    drawHead();
    drawActions();
    if (status === 'complete' && project && link && stepIndex >= 0) {
      nextStepPrompt({
        project, states: stepStates(project, runs.map((r) => (r.id === run.id ? run : r))), stepId: /** @type {string} */ (link.stepId), tools: new Map(tools.map((t) => [t.id, t])),
        filesHref: `${stepHref(project.id, /** @type {string} */ (link.stepId))}?files=1`,
        onFinishProject: async () => {
          const cur = (await getProject(project.id)) || project;
          await saveProject({ ...cur, ...statusPatch(cur, 'done') });
          toast('Project finished.');
          navigate(`/project/${encodeURIComponent(project.id)}`);
        },
      });
    } else toast(status === 'complete' ? 'Run marked complete.' : `Run is now ${status}.`);
  };
  const drawActions = () => ctx.setActions([
    linkButton('Measure', `#/run/${id}/measure`, { icon: 'ruler' }),
    run.status === 'complete'
      ? button('Reopen', { icon: 'undo', onClick: () => setStatus('open') })
      : button('Mark complete', { kind: 'primary', icon: 'check', onClick: () => setStatus('complete') }),
  ]);
  drawHead();
  drawActions();

  append(ctx.root, [
    tool ? toolCard({
      tool, subtitle: template ? template.name : 'No template yet', recipes: shownRecipes, template, onUse: editor.useRecipe, allSteps: true,
      link: true, starred: (settings.myTools || []).includes(tool.id), onStar: star,
    }) : null,
    head,
    editor.el,
    section('Run actions', h('div', { class: 'row-wrap' },
      button('Duplicate as new run', {
        icon: 'copy',
        onClick: async () => {
          await editor.flush();
          if (!template) { navigate(`/log/${run.toolId}`); return; }
          const d = prefillFrom(blankDraft({ runId: uuid(), toolId: run.toolId, templateId: template.id, now: new Date().toISOString() }), editor.current(), template);
          if (await startLogDraft(d)) toast('Your other unsaved run was kept in Open runs as a draft.');
          navigate(`/log/${run.toolId}/${template.id}`);
        },
      }),
      button('Delete run', {
        icon: 'trash', kind: 'ghost',
        onClick: async () => {
          if (!await confirmDialog({ title: 'Delete this run?', message: 'You can undo for a few seconds; the record is kept as deleted.', confirmLabel: 'Delete', danger: true })) return;
          editor.cancel();
          await deleteRun(id);
          navigate('/open', { replace: true });
          toast('Run deleted.', { action: { label: 'Undo', fn: async () => { await restoreRun(id); navigate(`/run/${id}`); } } });
        },
      }))),
  ]);
  return () => editor.dispose();
}
