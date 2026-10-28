// @ts-check
/**
 * One step of a project's plan, on its tool (2.0): the page where the step
 * is done. The project's name stays at the top as the page scrolls, and the
 * tool's banner takes the colour of its category, so a tool's page looks
 * unlike the project's. Start step saves a run for the step (prefilled from
 * the last run on the tool, with the step's recipe and wafers) and shows
 * its editor: recipe, inputs, timer, results, with the rest under More
 * details. Finish step marks the run complete and asks whether to go on to
 * the next step. A done step shows its values with Edit values. The step's
 * pictures, files and GDS layout live here too ("?files=1" opens them), as
 * do Mark done without a run and Skip.
 */
import { h, append, fill } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, linkButton, section, badge, emptyState, listRow, toast, errorText } from '../ui/components.js';
import { toolBanner } from '../ui/tool-card.js';
import { runEditor } from '../ui/run-editor.js';
import { nextStepPrompt, stepHref } from '../ui/step-flow.js';
import { stepFiles } from '../ui/step-files.js';
import { noteLine, openNotes } from '../ui/compat-notes.js';
import { chooseMaterialKind, askButtons } from '../ui/material-kind.js';
import { lookups, primaryText } from '../ui/run-list.js';
import { navigate, refresh } from '../router.js';
import {
  getProject, saveProject, listRuns, listTools, listTemplates, listProjects, getSettings, saveSettings, listMeasurements, listPhotos,
  recomputeRun, saveRun, lastRunFor,
} from '../data/repo.js';
import { recipesForTool } from '../data/recipes.js';
import { planChecks } from '../data/plan-checks.js';
import { stepStates, projectRuns, linkFor, waferText, stepWaferIds, statusPatch, projectStatus } from '../core/projects.js';
import { blankDraft, prefillFrom, draftToRun } from '../core/run-draft.js';
import { recipesFor } from '../core/recipes.js';
import { isExposureStep } from '../core/attachments.js';
import { waitingFor } from '../core/derive.js';
import { runTimer, timerText } from '../core/timers.js';
import { uuid } from '../core/ids.js';
import { formatDay, formatDateTime } from '../core/time.js';
import { STATUS_LABELS, PROJECT_STATUS_LABELS } from '../core/vocab.js';

/** @typedef {import('../core/types.js').Project} Project */
/** @typedef {import('../core/types.js').PlanStep} PlanStep */
/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').Template} Template */

/** @type {Readonly<Record<string, {icon: string, text: string, kind: 'ok' | 'info' | 'muted'}>>} */
const STATE = Object.freeze({
  done: { icon: 'check', text: 'Done', kind: 'ok' },
  active: { icon: 'timer', text: 'In progress', kind: 'info' },
  todo: { icon: 'flag', text: 'Not started', kind: 'muted' },
  skipped: { icon: 'minus', text: 'Skipped', kind: 'muted' },
});

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const { id, stepId } = ctx.params;
  const p = await getProject(id);
  ctx.setTitle('Step');
  if (!p) {
    append(ctx.root, [emptyState('This project no longer exists.', linkButton('All projects', '#/projects'))]);
    return;
  }
  const step = p.steps.find((s) => s.id === stepId);
  if (!step) {
    append(ctx.root, [emptyState('This step is no longer in the plan.', linkButton('Open the project', `#/project/${encodeURIComponent(id)}`))]);
    return;
  }
  const [runs, tools, templates, projects, settings] = await Promise.all([
    listRuns(), listTools({ includeArchived: true }), listTemplates(), listProjects(), getSettings(),
  ]);
  const checks = await planChecks(p, tools, templates);
  if (!ctx.isCurrent()) return;
  const L = lookups(tools, templates, projects);
  const states = stepStates(p, runs);
  const s = /** @type {import('../core/projects.js').StepState} */ (states.find((x) => x.step.id === stepId));
  const tool = step.toolId ? tools.find((t) => t.id === step.toolId) || null : null;
  // The template a run of this step uses: the step's own when it exists, else the tool's default, else its first.
  const own = tool ? templates.filter((t) => t.toolId === tool.id) : [];
  const stepTemplate = own.find((t) => t.id === step.templateId) || own.find((t) => t.id === tool?.defaultTemplateId) || own[0] || null;
  // The run this page shows: the step's latest run still going, else its latest complete one.
  const going = s.runs.filter((r) => r.status !== 'complete');
  const finished = s.runs.filter((r) => r.status === 'complete');
  const shownId = (going[going.length - 1] || finished[finished.length - 1] || null)?.id || null;
  const run = shownId ? (await recomputeRun(shownId)) || null : null;
  const [measurements, localPhotos, recipes] = await Promise.all([
    run ? listMeasurements(run.id) : [], run ? listPhotos(run.id) : [], tool ? recipesForTool(tool.id) : [],
  ]);
  if (!ctx.isCurrent()) return;
  const template = run ? templates.find((t) => t.id === run.templateId) || null : stepTemplate;
  const shownRecipes = template ? recipesFor(recipes, template, own) : recipes;
  const toolName = (/** @type {string | null} */ tid) => { const t = tid ? L.tools.get(tid) : null; return t ? t.shortName || t.name : ''; };
  ctx.setTitle(tool ? tool.shortName || tool.name : `Step ${s.index + 1}`);
  ctx.root.classList.add('step-page');
  ctx.root.dataset.category = tool ? tool.category : 'other';
  ctx.setTone(tool ? tool.category : 'other');
  const active = p.status === 'active';

  /**
   * Save a change to the project as stored now.
   * @param {(cur: Project) => Partial<Project>} patch
   * @param {string} message
   */
  const saveStep = async (patch, message) => {
    try {
      const cur = (await getProject(id)) || p;
      await saveProject({ ...cur, ...patch(cur) });
      toast(message);
      refresh();
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
  };
  const mark = (/** @type {Partial<PlanStep>} */ patch, /** @type {string} */ message) => saveStep(
    (cur) => ({ steps: cur.steps.map((x) => (x.id === stepId ? { ...x, ...patch } : x)) }), message);
  // Reopen the project itself (finished or failed, or paused): its steps can be started again.
  const reopenProject = () => saveStep((cur) => statusPatch(cur, 'active'), 'The project is active again.');
  /**
   * Reopen a done step (2.1): every complete run linked to it becomes open again (the shown one through the editor,
   * any other directly) and a mark made by hand is cleared, so the step is to do or in progress again; a project that
   * had ended becomes active again with it. The page is then drawn afresh from what is stored.
   */
  const reopenStep = async () => {
    try {
      const cur = editor ? editor.current() : null;
      if (cur && cur.status === 'complete' && editor && !await editor.setStatus('open')) return;
      for (const r of s.runs) if (r.status === 'complete' && r.id !== cur?.id) await saveRun({ ...r, status: 'open' });
      const now = (await getProject(id)) || p;
      await saveProject({ ...now, ...(active ? {} : statusPatch(now, 'active')), steps: now.steps.map((x) => (x.id === stepId ? { ...x, doneAt: null } : x)) });
      const going = s.runs.some((r) => r.status === 'complete') || !!(cur && cur.status === 'complete') || s.runs.some((r) => r.status !== 'complete');
      toast(`${active ? 'The step' : 'The project is active again and the step'} is ${going ? 'in progress' : 'to do'} again.`);
      refresh();
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
  };
  const star = async (/** @type {boolean} */ on) => {
    if (!tool) return;
    const mine = new Set((await getSettings()).myTools || []);
    if (on) mine.add(tool.id); else mine.delete(tool.id);
    await saveSettings({ myTools: [...mine] });
    toast(on ? `${tool.shortName || tool.name} is now one of your tools.` : `${tool.shortName || tool.name} is no longer one of your tools.`);
  };

  // The ribbon stays in view as the page scrolls: the project's name (a link to its page) and a pager through the
  // plan in order, so the step before and the step after are one tap away (2.1; before, the whole ribbon opened the
  // project and its chevron read as a "next" that did nothing of the kind). At an end the arrow's place stays empty.
  const STATE_WORD = { done: ', done', active: ', in progress', skipped: ', skipped', todo: '' };
  const pager = (/** @type {'prev' | 'next'} */ dir) => {
    const t = states[s.index + (dir === 'next' ? 1 : -1)] || null;
    if (!t) return h('span', { class: 'strip-step is-off', 'aria-hidden': 'true' });
    return h('a', {
      class: 'strip-step', href: stepHref(id, t.step.id),
      'aria-label': `${dir === 'next' ? 'Next' : 'Previous'} step: ${t.index + 1}. ${t.step.title}${STATE_WORD[t.state]}`,
    }, icon(dir === 'next' ? 'chevron' : 'back'));
  };
  const strip = h('nav', { class: 'project-strip', 'aria-label': 'Project and its steps' },
    h('a', { class: 'project-strip-link', href: `#/project/${encodeURIComponent(id)}`, 'aria-label': `${p.name}: open the project` },
      icon('project', { size: 20 }), h('span', { class: 'project-strip-name' }, p.name)),
    pager('prev'),
    h('span', { class: 'project-strip-step' }, `${s.index + 1} of ${p.steps.length}`),
    pager('next'));
  // The badge follows the run as the editor has it now (a finish, a reopen, a timer started or stopped).
  const stateBadge = () => {
    const cur = editor ? editor.current() : run;
    const now = cur ? stepStates(p, runs.map((r) => (r.id === cur.id ? cur : r))).find((x) => x.step.id === stepId) || s : s;
    const st = STATE[now.state];
    const t = cur ? runTimer(cur) : null;
    return badge(now.state === 'done' && now.doneAt ? `Done ${formatDay(now.doneAt, Date.now())}` : t ? `Timer ${timerText(t, Date.now())}` : st.text, st.kind, st.icon);
  };
  /** @type {import('../ui/run-editor.js').RunEditor | null} */
  let editor = null;
  const banner = tool ? toolBanner({
    tool, title: `${s.index + 1}. ${step.title}`, subtitle: template ? template.name : undefined, recipes: shownRecipes, template, allSteps: true,
    onUse: (r, st) => editor?.useRecipe(r, st), starred: (settings.myTools || []).includes(tool.id), onStar: star, badge: stateBadge(),
  }) : h('div', { class: 'card stack tool-banner-none' },
    h('span', { class: 'tool-banner-title' }, `${s.index + 1}. ${step.title}`),
    h('p', { class: 'muted small' }, 'No tool chosen for this step. ', h('a', { href: `#/project/${encodeURIComponent(id)}/edit` }, 'Edit the plan'), ' to choose one.'),
    h('span', { class: 'tool-banner-badge' }, stateBadge()));

  // What the run waits for, in one line under the banner.
  const line = h('p', { class: 'muted small step-line' });
  const drawLine = () => {
    const cur = editor ? editor.current() : run;
    const parts = [waferText(p, (cur ? linkFor(cur, id)?.waferIds : step.waferIds) || stepWaferIds(p, step)) || ''];
    if (cur) {
      parts.push(`started ${formatDateTime(cur.startedAt, Date.now())}`);
      if (cur.status !== 'complete' && template) {
        const why = waitingFor(cur, template, measurements);
        parts.push(why === 'ready to mark complete' ? 'ready to finish' : why);
      }
    } else if (step.recipe) parts.push(`recipe ${step.recipe}`);
    line.textContent = parts.filter(Boolean).join(' · ');
  };
  drawLine();

  // The plan's open notes for this step, with Mark as checked and What is …? for a material the app does not know.
  const notes = s.state === 'done' || s.state === 'skipped' ? [] : openNotes(checks.byStep.get(stepId) || [], step);
  const noteBox = notes.length ? h('div', { class: 'card stack' }, h('p', { class: 'small' }, h('strong', null, 'Before you start:')),
    h('div', { class: 'compat-notes' }, notes.map((n) => noteLine(n, {
      checked: false,
      onCheck: () => saveStep((cur) => ({ steps: cur.steps.map((x) => (x.id === stepId ? { ...x, checked: [...(x.checked || []), n.key] } : x)) }), 'Marked as checked.'),
      action: askButtons(n.materials, (name) => chooseMaterialKind({ name, onSaved: () => refresh() })),
    })))) : null;

  // Start: a run for this step, prefilled from the last run on the tool, with the step's recipe and wafers. One run
  // per tap, however many Start buttons the page has and however fast the thumb.
  let starting = false;
  const start = async () => {
    if (!tool || !stepTemplate || starting) return;
    starting = true;
    try {
      let d = blankDraft({ runId: uuid(), toolId: tool.id, templateId: stepTemplate.id, now: new Date().toISOString() });
      const last = await lastRunFor(tool.id, stepTemplate.id);
      if (last) d = prefillFrom(d, last, stepTemplate);
      d = { ...d, recipe: step.recipe || d.recipe, projects: [{ projectId: id, waferIds: stepWaferIds(p, step), stepId }], touched: true };
      await saveRun(draftToRun(d, 'open'));
      toast(run ? 'A new run was started for this step.' : 'Step started. Check the recipe and inputs, then time the run.');
      refresh();
    } catch (err) {
      starting = false;
      toast(errorText(err), { kind: 'error' });
    }
  };
  const startButton = (/** @type {boolean} */ big) => (tool && stepTemplate ? button(run ? 'Run this step again' : 'Start this step', {
    kind: run ? 'secondary' : 'primary', icon: run ? 'copy' : 'play', big, onClick: start,
  }) : tool ? linkButton('Add a template to the tool', `#/settings/tool/${encodeURIComponent(tool.id)}`, { icon: 'wrench', big })
    : linkButton('Choose a tool', `#/project/${encodeURIComponent(id)}/edit`, { icon: 'edit', big }));

  // The step's pictures, files and GDS layout.
  const files = stepFiles({ projectId: id, stepId, exposure: isExposureStep(step, stepTemplate), onChange: () => {} });
  const filesSection = h('div', { class: 'card stack step-files' }, files.el);
  /** @type {[string, string][]} */
  const facts = [['Recipe', step.recipe || '–'], ['Wafers', waferText(p, stepWaferIds(p, step)) || 'None in process']];
  if (step.notes) facts.push(['Notes', step.notes]);
  const others = s.runs.filter((r) => r.id !== shownId);
  const stepFold = h('details', { class: 'more fold', open: !run || undefined }, h('summary', null, icon('down', { size: 18 }), 'This step in the plan'),
    h('div', { class: 'stack' },
      h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      others.length ? h('div', { class: 'stack' }, h('span', { class: 'label' }, run ? 'Other runs on this step' : 'Runs on this step'),
        h('div', { class: 'list' }, others.map((r) => listRow({
          title: `${formatDateTime(r.startedAt, Date.now())} · ${toolName(r.toolId)}`,
          subtitle: [STATUS_LABELS[r.status], primaryText(r, L)].filter(Boolean).join(' · '), href: `#/run/${encodeURIComponent(r.id)}`,
        })))) : null,
      h('div', { class: 'row-wrap' },
        run ? startButton(false) : null,
        s.state === 'done' && !(run && run.status === 'complete') ? button('Reopen step', { icon: 'undo', onClick: reopenStep })
          : s.state !== 'done' ? button('Mark done without a run', { icon: 'check', onClick: () => mark({ doneAt: new Date().toISOString(), skipped: false }, 'Step marked done.') }) : null,
        step.skipped ? button('Don’t skip', { icon: 'undo', onClick: () => mark({ skipped: false }, 'The step is back in the plan.') })
          : s.state === 'todo' ? button('Skip this step', { icon: 'minus', onClick: () => mark({ skipped: true }, 'Step skipped.') }) : null),
      h('p', { class: 'muted small' }, 'A step is done when a complete run in this project is linked to it, or when you mark it done. Reopen step makes it to do again, and reopens a finished project with it.')));

  if (run) {
    editor = runEditor({
      run, template, tool, measurements, tools, settings, runs, projects, recipes: shownRecipes, toolTemplates: own, localPhotos,
      summary: run.status === 'complete', onReload: refresh,
      onChange: () => {
        drawLine();
        drawActions();
        const slot = banner.querySelector('.tool-banner-badge');
        if (slot) fill(/** @type {HTMLElement} */ (slot), stateBadge());
      },
    });
  }
  // Finish: the run is complete; then on to the next step.
  const finish = async () => {
    if (!editor || !await editor.setStatus('complete')) return;
    const cur = editor.current();
    const fresh = stepStates(p, runs.map((r) => (r.id === cur.id ? cur : r)));
    nextStepPrompt({
      project: p, states: fresh, stepId, tools: L.tools, filesHref: `${stepHref(id, stepId)}?files=1`,
      onFinishProject: async () => {
        const now = (await getProject(id)) || p;
        await saveProject({ ...now, ...statusPatch(now, 'done') });
        toast('Project finished.');
        navigate(`/project/${encodeURIComponent(id)}`);
      },
    });
  };
  const drawActions = () => {
    const cur = editor ? editor.current() : null;
    if (!cur) {
      ctx.setActions(active ? [linkButton('Project', `#/project/${encodeURIComponent(id)}`, { icon: 'project' }), startButton(false)]
        : [linkButton('Project', `#/project/${encodeURIComponent(id)}`, { icon: 'project' }),
          button(s.state === 'done' ? 'Reopen step' : 'Reopen project', { kind: 'primary', icon: 'undo', onClick: s.state === 'done' ? reopenStep : reopenProject })]);
      return;
    }
    if (cur.status === 'complete') {
      // A finished step still takes its measurements (the rate is worked out when they come).
      ctx.setActions([
        linkButton('Measure', `#/run/${encodeURIComponent(cur.id)}/measure`, { icon: 'ruler' }),
        button('Reopen step', { icon: 'undo', onClick: reopenStep }),
      ]);
      return;
    }
    ctx.setActions([
      linkButton('Measure', `#/run/${encodeURIComponent(cur.id)}/measure`, { icon: 'ruler' }),
      button('Finish step', { kind: 'primary', icon: 'check', onClick: finish }),
    ]);
  };

  append(ctx.root, [
    strip,
    banner,
    line,
    !active ? h('div', { class: 'card spread' },
      h('p', { class: 'muted small' }, `This project is ${PROJECT_STATUS_LABELS[projectStatus(p)].toLowerCase()}. ${s.state === 'done' ? 'Reopen step makes this step to do again and the project active.' : 'Reopen it to start steps.'}`),
      s.state === 'done' ? null : button('Reopen project', { icon: 'undo', onClick: reopenProject })) : null,
    noteBox,
    editor ? editor.el : active ? h('div', { class: 'card stack start-card' },
      h('p', null, tool && stepTemplate ? 'Start saves a run for this step, prefilled from your last run on this tool, so you only change what differs.'
        : tool ? 'This tool has no template yet, so a run cannot be logged on it.' : 'Choose a tool for this step to log a run on it, or mark the step done.'),
      startButton(true)) : null,
    run && run.status !== 'complete' ? null : filesSection,
    stepFold,
  ]);
  if (run && run.status !== 'complete') stepFold.before(filesSection);
  drawActions();
  // "?files=1" (from Add picture or file) opens the pictures and files; the address drops it.
  if (ctx.query.get('files')) {
    history.replaceState(history.state, '', stepHref(id, stepId));
    filesSection.scrollIntoView({ block: 'start' });
  }
  return async () => {
    files.dispose();
    if (editor) await editor.dispose();
  };
}
