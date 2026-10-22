// @ts-check
/**
 * Log run: pick a tool (your tools first) -> pick a template (skipped when
 * the tool has one) -> fill the form, prefilled from the last run with the
 * same tool and template. An LNF recipe can fill the inputs, every step of
 * a multi-step recipe included. "?project=<id>&step=<id>" (from a project's
 * "Log this step") puts the run in that project. Every change autosaves to
 * IndexedDB.
 */
import { h, append, fill } from '../ui/dom.js';
import {
  button, linkButton, section, chip, emptyState, toast, confirmDialog, errorText,
} from '../ui/components.js';
import { renderFields } from '../ui/fields.js';
import { toolTiles, templateTiles, mineOf } from '../ui/pickers.js';
import { recipeField, sampleFields, notesFields, dateTimeField } from '../ui/run-form.js';
import { timerCard, disarmAlarm } from '../ui/timer.js';
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
  LOG_DRAFT as DRAFT, setAsideLogDraft, getProject, listProjects, logTimerRunning,
} from '../data/repo.js';
import { recipesForTool } from '../data/recipes.js';
import {
  blankDraft, prefillFrom, clearPrefill, missingRequired, hasAnyOutput, draftToRun, timerField, fieldsWithRole,
} from '../core/run-draft.js';
import { recipesFor, undoFill } from '../core/recipes.js';
import {
  mainIndex, stepValues, withStepValues, addStep, removeStep, setMain, renameStep, recipeForForm,
} from '../core/run-steps.js';
import { defaultLink } from '../core/projects.js';
import { uuid } from '../core/ids.js';
import { formatDay, formatDateTime } from '../core/time.js';
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
            disarmAlarm();
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
 * only moves to the step asked for. The caller keeps this out of the stored
 * draft until the person changes something, so leaving the form untouched
 * leaves no link behind.
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
      ...d, recipe: asked.recipe && !d.touched ? asked.recipe : d.recipe,
      projects: links.map((l) => (l.projectId === id ? { ...l, stepId: asked.id } : l)),
    };
  }
  const link = defaultLink(p, runs, d.toolId);
  const step = asked || p.steps.find((s) => s.id === link.stepId) || null;
  const recipe = step && step.recipe && !d.touched ? step.recipe : d.recipe;
  return { ...d, recipe, projects: [...links, { ...link, stepId: step ? step.id : null }] };
}

/**
 * @param {import('../router.js').ViewContext} ctx
 * @param {string} toolId
 * @param {string} templateId
 */
async function form(ctx, toolId, templateId) {
  const [tool, template, settings, runs, recipes, toolTemplates, projects] = await Promise.all([
    getTool(toolId), getTemplate(templateId), getSettings(), listRuns(), recipesForTool(toolId), listTemplates(toolId), listProjects(),
  ]);
  // The person may have moved on while this loaded: then leave the address alone.
  if (!ctx.isCurrent()) return;
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
    disarmAlarm();
    d = null;
  }
  if (!d) {
    d = blankDraft({ runId: uuid(), toolId, templateId, now: new Date().toISOString() });
    const last = await lastRunFor(toolId, templateId);
    if (last) d = prefillFrom(d, last, template);
  }
  // An alarm armed for a form that was set aside (from another screen) must not keep the screen awake.
  if (!d.timerStartedAt || !d.timerTarget) disarmAlarm();
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
  const timeKey = timerField(template);
  const photos = photoStrip({
    runId: draft.runId,
    onChange: (ids) => { if (ids.join() !== draft.photoIds.join()) change({ photoIds: ids }); },
  });
  /** @type {{el: HTMLElement, dispose: () => void} | null} */
  let timer = null;
  // The step whose inputs the form shows (the main step at first).
  let active = Math.max(0, mainIndex(draft.steps));
  const body = h('div', { class: 'view' });
  // An LNF recipe fills its values (every step's, for a multi-step recipe) and the material when that is
  // unambiguous. Undo takes back only what the recipe changed, and goes away with the form.
  /** @type {{close: () => void} | null} */
  let undoToast = null;
  const useRecipe = (/** @type {WikiRecipe} */ r, /** @type {number} */ step) => {
    const before = { recipe: draft.recipe, params: draft.params, material: draft.material, steps: draft.steps };
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
          change({ recipe: before.recipe, params: undoFill(draft.params, before.params, res.fill.values), material: before.material, steps: before.steps });
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
    const secs = timeKey && typeof draft.params[timeKey] === 'number' ? /** @type {number} */ (draft.params[timeKey]) : null;
    const runningSince = draft.timerStartedAt || '';
    timer = timerCard({
      state: { startedAt: draft.timerStartedAt, target: draft.timerTarget ?? null, ran: !!draft.timerRan },
      formSeconds: secs,
      href: `#/log/${encodeURIComponent(toolId)}/${encodeURIComponent(templateId)}`,
      stillRunning: () => logTimerRunning(runningSince),
      fills: draft.steps.length ? 'the main step’s (★) time' : 'the time field',
      onStart: (target) => {
        const now = new Date().toISOString();
        change({ timerStartedAt: now, timerTarget: target, timerRan: false, startedAt: now, endedAt: null });
        draw();
      },
      onStop: (s) => {
        change({
          timerStartedAt: null, timerTarget: null, timerRan: true, endedAt: new Date().toISOString(),
          params: timeKey ? { ...draft.params, [timeKey]: s } : draft.params,
        });
        draw();
      },
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
      projects, runs, toolId, links: draft.projects, title: 'Projects', onChange: (links) => change({ projects: links }),
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
      timer.el,
      projectBox ? section('Project', projectBox) : null,
      section('Recipe', recipeField({
        value: draft.recipe, onChange: (v) => change({ recipe: v }), recipes: shownRecipes, template, allSteps: true,
        title: `${tool.shortName || tool.name} recipes`, onUse: useRecipe,
      })),
      inputs.length ? section('Inputs', steps,
        renderFields(inputs, values, setParam, { template, collapseGases: true })) : null,
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
      h('details', { class: 'more' }, h('summary', null, 'Start time'),
        h('div', { class: 'stack' }, dateTimeField('Started', draft.startedAt, (iso) => change({ startedAt: iso }), HELP.started))),
    );
  };

  const save = async (/** @type {'open' | 'complete'} */ status) => {
    let dd = draft;
    if (dd.timerStartedAt && timeKey) {
      const secs = Math.max(0, Math.round((Date.now() - Date.parse(dd.timerStartedAt)) / 1000));
      dd = { ...dd, timerStartedAt: null, endedAt: new Date().toISOString(), params: { ...dd.params, [timeKey]: dd.params[timeKey] ?? secs } };
    }
    const missing = missingRequired(template, dd.params, dd.results);
    if (missing.length) {
      toast(`Fill in: ${missing.join(', ')}`, { kind: 'error' });
      return;
    }
    try {
      autosave.cancel();
      undoToast?.close();
      const saved = await saveRun(draftToRun(dd, status));
      await clearDraft(DRAFT);
      disarmAlarm();
      toast(status === 'complete' ? 'Run saved as complete.' : 'Run saved. Add measurements when you have them.');
      navigate(`/run/${saved.id}`, { replace: true });
    } catch (err) {
      autosave.schedule();
      toast(errorText(err), { kind: 'error' });
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
