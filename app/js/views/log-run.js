// @ts-check
/**
 * Log run: pick a tool (your tools first) -> pick a template (skipped when
 * the tool has one) -> fill the form, prefilled from the last run with the
 * same tool and template. An LNF recipe can fill the inputs, every step of
 * a multi-step recipe included. "?project=<id>&step=<id>" (from a project)
 * puts the run in that project. The recipe and inputs come first; the rest
 * waits under More details. Every change autosaves to IndexedDB; starting
 * the timer saves the run and opens its page, where the timer runs (2.0).
 */
import { h, append, fill } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  button, linkButton, section, chip, emptyState, toast, confirmDialog, errorText,
} from '../ui/components.js';
import { renderFields } from '../ui/fields.js';
import { toolTiles, templateTiles, mineOf } from '../ui/pickers.js';
import { recipeField, sampleFields, notesFields, dateTimeField } from '../ui/run-form.js';
import { timerCard } from '../ui/timer.js';
import { startRunTimer } from '../ui/timers.js';
import { stepControls } from '../ui/run-steps.js';
import { projectLinks } from '../ui/project-picker.js';
import { fillMessage } from '../ui/recipes.js';
import { toolCard } from '../ui/tool-card.js';
import { photoStrip } from '../ui/photos.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate } from '../router.js';
import {
  listTools, listTemplates, getTool, getTemplate, listRuns, lastRunFor, getDraft, saveDraft, clearDraft,
  saveRun, purgeUnsavedPhotos, getSettings, saveSettings, lastUsedByTool, materialsByRecency,
  LOG_DRAFT as DRAFT, setAsideLogDraft, getProject, listProjects,
} from '../data/repo.js';
import { recipesForTool, allRecipes } from '../data/recipes.js';
import { planChecksWith } from '../data/plan-checks.js';
import { openNotes } from '../ui/compat-notes.js';
import {
  blankDraft, prefillFrom, clearPrefill, missingRequired, hasAnyOutput, draftToRun, fieldsWithRole,
} from '../core/run-draft.js';
import { recipesFor, undoFill } from '../core/recipes.js';
import {
  mainIndex, stepValues, withStepValues, addStep, removeStep, setMain, renameStep, recipeForForm,
} from '../core/run-steps.js';
import { defaultLink, wafersOnStepChange, recipeOnStepChange } from '../core/projects.js';
import { stepFilesRoute, stepRoute } from '../core/attachments.js';
import { uuid } from '../core/ids.js';
import { formatDay, formatDateTime, formatMmSs } from '../core/time.js';
import { normText } from '../core/vocab.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/run-draft.js').RunDraft} RunDraft */
/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */

/**
 * The project and step a project page asked for, carried through the tool
 * and template pickers.
 * @param {URLSearchParams} query
 * @returns {string} "?project=…&step=…", or ''
 */
function carried(query) {
  const q = new URLSearchParams();
  for (const k of ['project', 'step']) {
    const v = query.get(k);
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const { toolId, templateId } = ctx.params;
  if (!toolId) return pickTool(ctx);
  if (!templateId) return pickTemplate(ctx, toolId);
  return form(ctx, toolId, templateId);
}

/**
 * "For Resonators batch 3, step 2: Etch oxide", when a project page sent the person here.
 * @param {URLSearchParams} query
 * @returns {Promise<HTMLElement | null>}
 */
async function forProject(query) {
  const id = query.get('project');
  const p = id ? await getProject(id) : null;
  if (!p) return null;
  const i = p.steps.findIndex((s) => s.id === query.get('step'));
  return h('p', { class: 'muted' }, 'For ', h('strong', null, p.name), i >= 0 ? `, step ${i + 1}: ${p.steps[i].title}` : '', '.');
}

/** @param {import('../router.js').ViewContext} ctx */
async function pickTool(ctx) {
  ctx.setTitle('Log run');
  const [tools, templates, runs, draft, settings, note] = await Promise.all([
    listTools(), listTemplates(), listRuns(), getDraft(DRAFT), getSettings(), forProject(ctx.query),
  ]);
  const withTemplates = tools.filter((t) => templates.some((x) => x.toolId === t.id));
  const lastUsed = lastUsedByTool(runs);
  let resume = null;
  // Only a form someone typed in is worth resuming; an untouched one is just a prefilled copy.
  if (draft && draft.touched) {
    const tool = tools.find((t) => t.id === draft.toolId);
    const tpl = templates.find((t) => t.id === draft.templateId);
    resume = h('div', { class: 'banner banner-info' }, h('div', { class: 'banner-body' },
      h('p', null, h('strong', null, `Unsaved run on ${tool ? tool.shortName || tool.name : 'a tool'}`),
        `${tpl ? ` (${tpl.name})` : ''}, started ${formatDateTime(draft.startedAt, Date.now())}.`),
      h('div', { class: 'row-wrap' },
        linkButton('Resume', `#/log/${draft.toolId}/${draft.templateId}`, { kind: 'primary' }),
        button('Discard', {
          onClick: async () => {
            if (!await confirmDialog({ title: 'Discard the unsaved run?', message: 'Its values and photos will be deleted.', confirmLabel: 'Discard', danger: true })) return;
            await clearDraft(DRAFT);
            await purgeUnsavedPhotos(draft.runId);
            resume?.remove();
          },
        }))));
  }
  const pass = carried(ctx.query);
  append(ctx.root, [
    resume,
    note,
    withTemplates.length
      ? toolTiles({
        tools: withTemplates, lastUsed, mine: mineOf(settings.myTools, lastUsed), chooseLink: true,
        onPick: (t) => navigate(`/log/${t.id}${pass}`),
      })
      : emptyState('No tools with templates yet.', linkButton('Set up tools', '#/settings/tools')),
    h('p', { class: 'muted small' }, 'In a hurry? ', h('a', { href: '#/capture' }, 'Quick capture'), ' saves a tool, photo and note to fill in later.'),
  ]);
}

/**
 * @param {import('../router.js').ViewContext} ctx
 * @param {string} toolId
 */
async function pickTemplate(ctx, toolId) {
  const [tool, templates, note] = await Promise.all([getTool(toolId), listTemplates(toolId), forProject(ctx.query)]);
  ctx.setTitle(tool ? tool.shortName || tool.name : 'Log run');
  const pass = carried(ctx.query);
  if (templates.length === 1) {
    if (ctx.isCurrent()) navigate(`/log/${toolId}/${templates[0].id}${pass}`, { replace: true });
    return;
  }
  append(ctx.root, [
    note,
    templates.length
      ? templateTiles({ templates, defaultId: tool?.defaultTemplateId, onPick: (t) => navigate(`/log/${toolId}/${t.id}${pass}`) })
      : emptyState('This tool has no template yet.', linkButton('Add a template', `#/settings/tool/${toolId}`)),
  ]);
}

/**
 * The run joins the project a project page named (with its wafers still in
 * process and the step, else the suggested one), and takes the step's
 * recipe name while the form is untouched. A form already in the project
 * moves to the step asked for: its wafers follow as the step menu's do
 * (wafersOnStepChange), and its recipe while it is still the previous
 * step's. The caller keeps this out of the stored draft until the person
 * changes something, so leaving the form untouched leaves no link behind.
 * @param {RunDraft} d
 * @param {URLSearchParams} query
 * @param {import('../core/types.js').Run[]} runs
 * @returns {Promise<RunDraft>}
 */
async function joinProject(d, query, runs) {
  const id = query.get('project');
  if (!id) return d;
  const p = await getProject(id);
  if (!p || p.status === 'done') return d;
  const asked = p.steps.find((s) => s.id === query.get('step')) || null;
  const links = d.projects || [];
  const linked = links.find((l) => l.projectId === id);
  if (linked) {
    if (!asked || linked.stepId === asked.id) return d;
    return {
      ...d, recipe: d.touched ? recipeOnStepChange(p, linked.stepId, asked, d.recipe) : asked.recipe || d.recipe,
      projects: links.map((l) => (l.projectId === id ? { ...l, stepId: asked.id, waferIds: wafersOnStepChange(p, l, asked, true) } : l)),
    };
  }
  const link = defaultLink(p, runs, d.toolId, asked ? asked.id : null);
  const step = asked || p.steps.find((s) => s.id === link.stepId) || null;
  // As the project's chip and step menu would: a changed form keeps a recipe it has, an empty one takes the step's.
  const recipe = !step ? d.recipe : !d.touched ? step.recipe || d.recipe : recipeOnStepChange(p, null, step, d.recipe);
  return { ...d, recipe, projects: [...links, { ...link, stepId: step ? step.id : null }] };
}

/**
 * A new run's recipe after its links moved from one set of steps to
 * another: each link whose step changed brings that step's recipe while
 * the recipe is still the previous step's (recipeOnStepChange).
 * @param {import('../core/types.js').Project[]} projects
 * @param {import('../core/types.js').ProjectLink[]} from
 * @param {import('../core/types.js').ProjectLink[]} to
 * @param {string} recipe
 * @returns {string}
 */
function followSteps(projects, from, to, recipe) {
  let out = recipe;
  for (const l of to) {
    const before = from.find((x) => x.projectId === l.projectId);
    const p = projects.find((x) => x.id === l.projectId);
    const step = p && l.stepId && l.stepId !== (before ? before.stepId : null) ? p.steps.find((s) => s.id === l.stepId) : null;
    if (p && step) out = recipeOnStepChange(p, before ? before.stepId : null, step, out);
  }
  return out;
}

/**
 * @param {import('../router.js').ViewContext} ctx
 * @param {string} toolId
 * @param {string} templateId
 */
async function form(ctx, toolId, templateId) {
  const [tool, template, settings, runs, recipes, toolTemplates, projects, allTools, allTemplates, everyRecipe] = await Promise.all([
    getTool(toolId), getTemplate(templateId), getSettings(), listRuns(), recipesForTool(toolId), listTemplates(toolId), listProjects(),
    listTools({ includeArchived: true }), listTemplates(), allRecipes().catch(() => /** @type {import('../core/recipes.js').WikiRecipe[]} */ ([])),
  ]);
  // The person may have moved on while this loaded: then leave the address alone.
  if (!ctx.isCurrent()) return;
  // The plan's open notes for a linked step, so they show at the tool.
  /** @type {Map<string, ReturnType<typeof planChecksWith>>} */
  const checksOf = new Map();
  const stepNotes = (/** @type {import('../core/types.js').Project} */ p, /** @type {string} */ stepId) => {
    const c = checksOf.get(p.id) || planChecksWith(p, allTools, allTemplates, everyRecipe, settings.materialKinds);
    checksOf.set(p.id, c);
    const step = p.steps.find((x) => x.id === stepId);
    return step ? openNotes(c.byStep.get(stepId) || [], step) : [];
  };
  ctx.setTitle('Log run');
  // A deleted template (a plan step can still name one): choose another of the tool's templates.
  if (tool && !tool.deleted && (!template || template.deleted) && toolTemplates.length) {
    navigate(`/log/${encodeURIComponent(toolId)}${carried(ctx.query)}`, { replace: true });
    return;
  }
  if (!tool || tool.deleted || !template || template.deleted || template.toolId !== toolId) {
    append(ctx.root, [emptyState('This tool or template no longer exists.', linkButton('Choose a tool', '#/log'))]);
    return;
  }
  /** @type {RunDraft | null} */
  let d = await getDraft(DRAFT);
  if (d && (d.toolId !== toolId || d.templateId !== templateId)) {
    if (await setAsideLogDraft()) toast('Your other unsaved run was kept in Open runs as a draft.');
    d = null;
  }
  if (!d) {
    d = blankDraft({ runId: uuid(), toolId, templateId, now: new Date().toISOString() });
    const last = await lastRunFor(toolId, templateId);
    if (last) d = prefillFrom(d, last, template);
  }
  // Stored before joining a project: the link is saved with the person's first change, so an untouched form
  // leaves nothing behind. Applied once: Back, Forward or a reload cannot bring a removed link back.
  await saveDraft(DRAFT, d);
  if (ctx.query.has('project')) {
    d = await joinProject(d, ctx.query, runs);
    if (!ctx.isCurrent()) return;
    try { history.replaceState(history.state, '', `#/log/${encodeURIComponent(toolId)}/${encodeURIComponent(templateId)}`); } catch { /* the query stays */ }
  }
  /** @type {RunDraft} */
  let draft = { ...d, steps: d.steps || [], projects: d.projects || [] };
  const autosave = createAutosave(() => saveDraft(DRAFT, draft));
  const change = (/** @type {Partial<RunDraft>} */ patch) => {
    draft = { ...draft, ...patch, touched: true };
    autosave.schedule();
    syncActions();
  };
  const lists = {
    material: materialsByRecency(settings.materials, runs, 'material'),
    substrate: materialsByRecency(settings.materials, runs, 'substrate'),
    maskMaterial: materialsByRecency(settings.materials, runs, 'maskMaterial'),
  };
  const addMaterial = async (/** @type {string} */ name) => {
    const s = await getSettings();
    if (!s.materials.some((m) => normText(m) === normText(name))) await saveSettings({ materials: [...s.materials, name] });
  };
  const shownRecipes = recipesFor(recipes, template, toolTemplates);
  const photos = photoStrip({
    runId: draft.runId,
    onChange: (ids) => { if (ids.join() !== draft.photoIds.join()) change({ photoIds: ids }); },
  });
  /** @type {{el: HTMLElement, dispose: () => void} | null} */
  let timer = null;
  // The step whose inputs the form shows (the main step at first).
  let active = Math.max(0, mainIndex(draft.steps));
  const body = h('div', { class: 'view' });
  // More details stays open across redraws once opened.
  let moreOpen = false;
  // An LNF recipe fills its values (every step's, for a multi-step recipe) and the material when that is
  // unambiguous. Undo takes back only what the recipe changed, and goes away with the form.
  /** @type {{close: () => void} | null} */
  let undoToast = null;
  const useRecipe = (/** @type {WikiRecipe} */ r, /** @type {number} */ step) => {
    const before = { recipe: draft.recipe, params: draft.params, material: draft.material, steps: draft.steps, projects: draft.projects };
    const res = recipeForForm(draft, r, template, step, settings.materials);
    change(res.patch);
    active = Math.max(0, mainIndex(res.patch.steps));
    draw();
    undoToast?.close();
    const more = [
      r.steps.length > 1 && res.patch.steps.length ? `All ${res.patch.steps.length} steps are in the run; the form shows the main step.` : '',
      res.material ? `Material set to ${res.material}.` : '',
    ].filter(Boolean).join(' ');
    undoToast = toast(`${fillMessage(r, res.fill)}${more ? ` ${more}` : ''}`, {
      action: {
        label: 'Undo',
        fn: () => {
          if (!ctx.isCurrent()) return;
          // The fill's name comes off only while it is still there, and a step chosen since then has its say.
          const recipe = draft.recipe === r.name ? followSteps(projects, before.projects, draft.projects, before.recipe || '') : draft.recipe;
          change({ recipe, params: undoFill(draft.params, before.params, res.fill.values), material: before.material, steps: before.steps });
          active = Math.max(0, mainIndex(before.steps));
          draw();
        },
      },
    });
  };
  let starred = (settings.myTools || []).includes(tool.id);
  const star = async (/** @type {boolean} */ on) => {
    starred = on;
    const mine = new Set((await getSettings()).myTools || []);
    if (on) mine.add(tool.id);
    else mine.delete(tool.id);
    await saveSettings({ myTools: [...mine] });
    toast(on ? `${tool.shortName || tool.name} is now one of your tools.` : `${tool.shortName || tool.name} is no longer one of your tools.`);
  };
  /** Focus a control again after a redraw replaced the one the person used. */
  const focusIn = (/** @type {string} */ sel) => { /** @type {HTMLElement | null} */ (body.querySelector(sel))?.focus(); };
  const checkedStep = '.run-steps [role="radio"][aria-checked="true"]';

  const draw = () => {
    timer?.dispose();
    // Starting the timer saves the run (as Save does) and opens its page, where the clock runs with the run.
    timer = timerCard({
      run: { params: draft.params, timer: null, endedAt: null }, template, startLabel: 'Save and start',
      fills: draft.steps.length ? 'the main step’s (★) time' : 'the time field',
      onStart: async (target) => {
        const saved = await save('open', { quiet: true });
        if (!saved) return;
        try {
          await startRunTimer(saved, target);
          toast(target ? `Run saved; counting down ${formatMmSs(target)}.` : 'Run saved; the timer is running.');
        } catch (err) {
          toast(errorText(err), { kind: 'error' });
        }
        navigate(stepRoute(saved) || `/run/${saved.id}`, { replace: true });
      },
      onStop: () => {},
    });
    const inputs = fieldsWithRole(template, ['input']);
    const context = fieldsWithRole(template, ['context']);
    const outputs = fieldsWithRole(template, ['output']);
    const values = stepValues(draft.steps, draft.params, active);
    const setParam = (/** @type {string} */ k, /** @type {any} */ v) => {
      const cur = stepValues(draft.steps, draft.params, active);
      change(withStepValues(draft.steps, draft.params, active, { ...cur, [k]: v }));
    };
    const steps = stepControls({
      steps: draft.steps, active,
      onSelect: (i) => { active = i; draw(); focusIn(checkedStep); },
      onAdd: () => {
        const next = addStep(draft.steps, `Step ${Math.max(draft.steps.length, 1) + 1}`);
        change({ steps: next });
        active = next.length - 1;
        draw();
        focusIn('.run-steps input');
      },
      onRename: (i, name) => change({ steps: renameStep(draft.steps, i, name) }),
      onMakeMain: (i) => { change(setMain(draft.steps, draft.params, i)); draw(); focusIn(checkedStep); },
      onRemove: (i) => {
        const next = removeStep(draft.steps, i);
        change({ steps: next });
        active = Math.max(0, mainIndex(next));
        draw();
        focusIn(next.length ? checkedStep : '.run-steps button');
      },
    });
    const projectBox = projectLinks({
      projects, runs, toolId, links: draft.projects, title: 'Projects', stepNotes, newRun: true,
      onChange: (links) => {
        // A step chosen in the menu brings its recipe, as Log this step does, while the form's is still the previous step's.
        const recipe = followSteps(projects, draft.projects, links, draft.recipe || '');
        const moved = recipe !== (draft.recipe || '');
        change({ projects: links, ...(moved ? { recipe } : {}) });
        // Shown at once, without redrawing the form under the person's finger.
        const box = /** @type {HTMLInputElement | null} */ (body.querySelector('#run-recipe'));
        if (moved && box) box.value = recipe;
      },
    });
    fill(body,
      toolCard({
        tool, subtitle: template.name, recipes: shownRecipes, template, onUse: useRecipe, allSteps: true, link: true,
        starred, onStar: star,
      }),
      draft.copiedFrom ? h('div', null, chip(`Copied from ${formatDay(draft.copiedFrom.startedAt, Date.now())} run`, {
        icon: 'copy', actionLabel: 'Clear',
        onClick: () => { draft = { ...clearPrefill(draft), touched: true }; active = 0; autosave.schedule(); draw(); },
      })) : null,
      projectBox ? section('Project', projectBox) : null,
      section('Recipe', recipeField({
        id: 'run-recipe', value: draft.recipe, onChange: (v) => change({ recipe: v }), recipes: shownRecipes, template, allSteps: true,
        title: `${tool.shortName || tool.name} recipes`, onUse: useRecipe,
      })),
      inputs.length ? section('Inputs', draft.steps.length ? steps : null,
        renderFields(inputs, values, setParam, { template, collapseGases: true })) : null,
      timer.el,
      h('details', {
        class: 'more fold', open: moreOpen || undefined,
        onToggle: (/** @type {Event} */ e) => { moreOpen = /** @type {HTMLDetailsElement} */ (e.target).open; },
      }, h('summary', null, icon('down', { size: 18 }), 'More details'), h('div', { class: 'stack' },
        section('Sample', h('div', { class: 'fields' }, sampleFields(draft, {
          lists, onChange: (p) => change(p), onAddMaterial: addMaterial,
          showMask: template.derived.some((x) => x.fn === 'selectivity'), showRecipe: false,
        }))),
        context.length ? section('Conditions', renderFields(context, values, setParam, { template })) : null,
        outputs.length ? h('details', { class: 'more card', open: hasAnyOutput(template, draft.results) || undefined },
          h('summary', null, 'Results now (optional)'),
          renderFields(outputs, draft.results, (k, v) => change({ results: { ...draft.results, [k]: v } }), { template })) : null,
        section('Photos', photos.el),
        section('Notes and tags', h('div', { class: 'fields' }, notesFields(draft, (p) => change(p)))),
        draft.steps.length ? null : section('Steps of this run', steps),
        section('Start time', dateTimeField('Started', draft.startedAt, (iso) => change({ startedAt: iso }), HELP.started)))),
    );
  };

  /**
   * Save the run. Quiet: no message and no navigation (the timer's Save and
   * start says and does its own).
   * @param {'open' | 'complete'} status
   * @param {{quiet?: boolean}} [o]
   * @returns {Promise<import('../core/types.js').Run | null>} the saved run, or null when it was not saved
   */
  const save = async (status, o = {}) => {
    const missing = missingRequired(template, draft.params, draft.results);
    if (missing.length) {
      toast(`Fill in: ${missing.join(', ')}`, { kind: 'error' });
      return null;
    }
    try {
      autosave.cancel();
      undoToast?.close();
      const saved = await saveRun(draftToRun(draft, status));
      await clearDraft(DRAFT);
      if (o.quiet) return saved;
      // A complete run that carries out a plan step offers that step's pictures and files.
      const files = status === 'complete' ? stepFilesRoute(saved) : null;
      toast(status === 'complete' ? 'Run saved as complete.' : 'Run saved. Add measurements when you have them.',
        files ? { action: { label: 'Add picture or file', fn: () => navigate(files) }, timeout: 10000 } : {});
      // A run on a project's step opens on the step's page, the rest on the run's.
      navigate(stepRoute(saved) || `/run/${saved.id}`, { replace: true });
      return saved;
    } catch (err) {
      autosave.schedule();
      toast(errorText(err), { kind: 'error' });
      return null;
    }
  };
  const completeBtn = button('Save complete', { icon: 'check', onClick: () => save('complete') });
  const syncActions = () => { completeBtn.disabled = !hasAnyOutput(template, draft.results); };
  syncActions();
  ctx.setActions([completeBtn, button('Save', { kind: 'primary', icon: 'check', onClick: () => save('open') })]);
  draw();
  append(ctx.root, [body]);
  return async () => {
    undoToast?.close();
    timer?.dispose();
    photos.dispose();
    await autosave.flush();
  };
}
