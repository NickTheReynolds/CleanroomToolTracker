// @ts-check
/**
 * Run detail. What the run needs next comes first: a draft its inputs, an
 * open run its measurements, a complete run its results. Then the projects
 * it belongs to, the recipe (an LNF recipe can fill every step), the inputs
 * of each step and the sample details, photos and notes. Edits autosave and
 * recompute derived outputs. Actions: add measurement, mark complete (with a
 * warning when the main result is missing) or reopen, duplicate, delete
 * (soft, with Undo).
 */
import { h, append, fill } from '../ui/dom.js';
import {
  button, linkButton, section, badge, emptyState, toast, confirmDialog, errorText,
} from '../ui/components.js';
import { renderFields } from '../ui/fields.js';
import { templateTiles } from '../ui/pickers.js';
import { recipeField, sampleFields, notesFields, dateTimeField } from '../ui/run-form.js';
import { stepControls } from '../ui/run-steps.js';
import { projectLinks } from '../ui/project-picker.js';
import { fillMessage } from '../ui/recipes.js';
import { toolCard } from '../ui/tool-card.js';
import { outputsList, measurementList } from '../ui/run-outputs.js';
import { photoStrip } from '../ui/photos.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate, refresh } from '../router.js';
import {
  getRecord, recomputeRun, getTool, getTemplate, listTemplates, listMeasurements, listTools, listRuns, listProjects,
  saveRun, deleteRun, restoreRun, startLogDraft, getSettings, saveSettings, materialsByRecency, listPhotos,
} from '../data/repo.js';
import { recipesForTool } from '../data/recipes.js';
import {
  fieldsWithRole, hasAnyOutput, missingRequired, parseTags, blankDraft, prefillFrom,
} from '../core/run-draft.js';
import { recipesFor, undoFill } from '../core/recipes.js';
import {
  mainIndex, stepValues, withStepValues, addStep, removeStep, setMain, renameStep, recipeForForm, tidySteps,
} from '../core/run-steps.js';
import { waitingFor } from '../core/derive.js';
import { uuid } from '../core/ids.js';
import { formatDateTime } from '../core/time.js';
import { STATUS_LABELS, normText } from '../core/vocab.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */

/** @param {unknown} v */
const hasValue = (v) => v !== undefined && v !== null && v !== '';

/** The selected step's button, focused again after the inputs redraw. */
const CHECKED_STEP = '.run-steps [role="radio"][aria-checked="true"]';

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
  // Photos do not sync: count the ones taken on another device.
  const elsewhere = (run.photoIds || []).filter((pid) => !localPhotos.some((p) => p.id === pid)).length;
  const toolMap = new Map(tools.map((t) => [t.id, t]));
  const shownRecipes = template ? recipesFor(recipes, template, toolTemplates) : recipes;

  // Editable copy; tags are edited as text.
  let state = { ...run, steps: run.steps || [], projects: run.projects || [], tagsText: (run.tags || []).join(', ') };
  const toRun = () => {
    const { tagsText, ...rest } = state;
    // Steps are stored tidy (names, no empty values), as Log run stores them.
    return /** @type {Run} */ ({ ...rest, steps: tidySteps(rest.steps || []), tags: parseTags(tagsText) });
  };
  const autosave = createAutosave(async () => {
    const before = JSON.stringify([state.derivedKeys, state.derivedKeys.map((k) => state.results[k])]);
    const saved = await saveRun(toRun());
    run = saved;
    // Take recomputed derived values; keep anything typed meanwhile.
    const results = { ...state.results };
    for (const k of saved.derivedKeys) results[k] = saved.results[k];
    for (const k of state.derivedKeys) if (!saved.derivedKeys.includes(k)) delete results[k];
    state = { ...state, results, derivedKeys: saved.derivedKeys, updatedAt: saved.updatedAt };
    if (JSON.stringify([state.derivedKeys, state.derivedKeys.map((k) => state.results[k])]) !== before) drawOutputsSoon();
  }, 500);
  const change = (/** @type {Record<string, any>} */ patch) => {
    state = { ...state, ...patch };
    autosave.schedule();
  };
  const saveNow = async (/** @type {Record<string, any>} */ patch) => {
    state = { ...state, ...patch };
    autosave.schedule();
    try {
      await autosave.flush();
      return true;
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
      return false;
    }
  };

  const outputsBox = h('div');
  let outputsOpen = false;
  // Never redraw the results while the person is typing in them.
  let redrawPending = false;
  const drawOutputsSoon = () => {
    if (outputsBox.contains(document.activeElement)) redrawPending = true;
    else drawOutputs();
  };
  outputsBox.addEventListener('focusout', () => setTimeout(() => {
    if (redrawPending && !outputsBox.contains(document.activeElement)) {
      redrawPending = false;
      drawOutputs();
    }
  }, 0));
  const drawOutputs = () => {
    if (!template) return;
    fill(outputsBox, outputsList({
      run: toRun(), template, measurements, expanded: outputsOpen,
      onExpand: () => { outputsOpen = true; drawOutputs(); },
      onTime: (key, secs) => {
        if (secs === null) return;
        change({ params: { ...state.params, [key]: secs } });
        drawForm();
      },
      onManual: (key, v) => {
        const results = { ...state.results };
        if (v === null || v === undefined || v === '') delete results[key];
        else results[key] = v;
        const wasDerived = state.derivedKeys.includes(key);
        change({ results, derivedKeys: state.derivedKeys.filter((k) => k !== key) });
        if (wasDerived) drawOutputs();
      },
      onUseDerived: (key) => {
        const results = { ...state.results };
        delete results[key];
        saveNow({ results, derivedKeys: state.derivedKeys.filter((k) => k !== key) });
      },
    }));
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
  const photos = photoStrip({
    runId: id,
    onChange: (ids) => { state = { ...state, photoIds: ids }; },
  });

  const statusBadge = badge(STATUS_LABELS[run.status], run.status === 'complete' ? 'ok' : run.status === 'draft' ? 'warn' : 'info',
    run.status === 'complete' ? 'check' : undefined);
  const known = new Set(template ? template.fields.map((f) => f.key) : []);
  const orphans = [...Object.entries(run.params || {}), ...Object.entries(run.results || {})].filter(([k]) => !known.has(k));
  // The step whose inputs the form shows (the main step at first).
  let active = Math.max(0, mainIndex(state.steps));
  const setParam = (/** @type {string} */ k, /** @type {any} */ v) => {
    const cur = stepValues(state.steps, state.params, active);
    change(withStepValues(state.steps, state.params, active, { ...cur, [k]: v }));
  };

  // Recipe, inputs, sample and conditions redraw together when a recipe or a step changes them.
  const formBox = h('div', { class: 'view' });
  /** Focus a control again after a redraw replaced the one the person used. */
  const focusIn = (/** @type {string} */ sel) => { /** @type {HTMLElement | null} */ (formBox.querySelector(sel))?.focus(); };
  const drawForm = () => {
    const values = stepValues(state.steps, state.params, active);
    const inputs = template ? fieldsWithRole(template, ['input']) : [];
    const context = template ? fieldsWithRole(template, ['context']) : [];
    fill(formBox,
      section('Recipe', recipeField({
        value: state.recipe, onChange: (v) => change({ recipe: v }), recipes: shownRecipes, template, allSteps: true,
        title: `${tool ? tool.shortName || tool.name : 'Tool'} recipes`, onUse: useRecipe,
      })),
      inputs.length ? section('Inputs', stepControls({
        steps: state.steps, active,
        onSelect: (i) => { active = i; drawForm(); focusIn(CHECKED_STEP); },
        onAdd: () => {
          const next = addStep(state.steps, `Step ${Math.max(state.steps.length, 1) + 1}`);
          change({ steps: next });
          active = next.length - 1;
          drawForm();
          focusIn('.run-steps input');
        },
        onRename: (i, name) => change({ steps: renameStep(state.steps, i, name) }),
        onMakeMain: (i) => { change(setMain(state.steps, state.params, i)); drawForm(); focusIn(CHECKED_STEP); },
        onRemove: (i) => {
          const next = removeStep(state.steps, i);
          change({ steps: next });
          active = Math.max(0, mainIndex(next));
          drawForm();
          focusIn(next.length ? CHECKED_STEP : '.run-steps button');
        },
      }), renderFields(inputs, values, setParam, { template, collapseGases: true })) : null,
      section('Sample', h('div', { class: 'fields' }, sampleFields(state, {
        lists, onChange: (p) => change(p), onAddMaterial: addMaterial,
        showMask: !!template && template.derived.some((d) => d.fn === 'selectivity'), showRecipe: false,
      }))),
      context.length ? section('Conditions', renderFields(context, values, setParam, { template })) : null);
  };
  // Undo takes back only what the recipe changed, and goes away with the view.
  /** @type {{close: () => void} | null} */
  let recipeUndo = null;
  /** @param {WikiRecipe} r @param {number} step */
  function useRecipe(r, step) {
    if (!template) {
      change({ recipe: r.name });
      drawForm();
      toast(`Recipe set to ${r.name}. Choose a template to fill in its values.`);
      return;
    }
    const before = { recipe: state.recipe, params: state.params, material: state.material, steps: state.steps };
    const res = recipeForForm(state, r, template, step, settings.materials);
    change(res.patch);
    active = Math.max(0, mainIndex(res.patch.steps));
    drawForm();
    recipeUndo?.close();
    const more = [
      r.steps.length > 1 && res.patch.steps.length ? `All ${res.patch.steps.length} steps are in the run; the form shows the main step.` : '',
      res.material ? `Material set to ${res.material}.` : '',
    ].filter(Boolean).join(' ');
    recipeUndo = toast(`${fillMessage(r, res.fill)}${more ? ` ${more}` : ''}`, {
      action: {
        label: 'Undo',
        fn: () => {
          if (!ctx.isCurrent()) return;
          change({ recipe: before.recipe, params: undoFill(state.params, before.params, res.fill.values), material: before.material, steps: before.steps });
          active = Math.max(0, mainIndex(before.steps));
          drawForm();
        },
      },
    });
  }
  drawForm();
  drawOutputs();

  /**
   * Mark complete, after a word when the main result (or any result) is
   * still missing: Lookup leaves such a run out.
   * @returns {Promise<boolean>} false when the person backs out
   */
  const confirmComplete = async () => {
    const primary = template && template.primaryOutput ? template.fields.find((f) => f.key === template.primaryOutput) : null;
    if (template && primary && !hasValue(state.results[primary.key])) {
      const why = waitingFor({ ...toRun(), status: 'open' }, template, measurements);
      const what = why === 'needs results' || why === 'ready to mark complete' ? `${primary.label} is empty.`
        : why.startsWith('cannot work out ') ? `${primary.label} cannot be worked out: ${why.slice(why.indexOf(': ') + 2)}.`
          : `${primary.label} ${why}.`;
      return confirmDialog({
        title: `Mark complete without ${primary.label.toLowerCase()}?`,
        message: `${what} Lookup leaves this run out of its ${primary.label.toLowerCase()} figures until it has one; you can still add it later.`,
        confirmLabel: 'Mark complete',
      });
    }
    if (!hasAnyOutput(template, state.results)) {
      return confirmDialog({
        title: 'Mark complete without results?',
        message: 'Lookup only uses complete runs that have at least one result.',
        confirmLabel: 'Mark complete',
      });
    }
    return true;
  };
  const setStatus = async (/** @type {'draft' | 'open' | 'complete'} */ status) => {
    // Results derived from edits still waiting to save (a time just typed) count.
    try { await autosave.flush(); } catch { /* saveNow below reports a failed save */ }
    if (status !== 'draft') {
      const missing = missingRequired(template, state.params, state.results);
      if (missing.length) {
        toast(`Fill in first: ${missing.join(', ')}`, { kind: 'error' });
        return;
      }
    }
    if (status === 'complete' && !await confirmComplete()) return;
    const endedAt = status === 'complete' ? state.endedAt || new Date().toISOString() : state.endedAt;
    if (await saveNow({ status, endedAt })) {
      toast(status === 'complete' ? 'Run marked complete.' : `Run is now ${status}.`);
      refresh();
    }
  };
  const star = async (/** @type {boolean} */ on) => {
    if (!tool) return;
    const mine = new Set((await getSettings()).myTools || []);
    if (on) mine.add(tool.id);
    else mine.delete(tool.id);
    await saveSettings({ myTools: [...mine] });
    toast(on ? `${tool.shortName || tool.name} is now one of your tools.` : `${tool.shortName || tool.name} is no longer one of your tools.`);
  };

  const projectBox = projectLinks({
    projects, runs, toolId: run.toolId, links: state.projects, title: 'Projects', openLinks: true,
    onChange: (links) => change({ projects: links }),
  });
  const results = template ? section('Results', outputsBox) : null;
  const measure = section('Measurements', measurementList({ runId: id, measurements, tools: toolMap }));
  const order = run.status === 'draft' ? [formBox, results, measure]
    : run.status === 'open' ? [measure, results, formBox] : [results, measure, formBox];
  append(ctx.root, [
    tool ? toolCard({
      tool, subtitle: template ? template.name : 'No template yet', recipes: shownRecipes, template, onUse: useRecipe, allSteps: true,
      link: true, starred: (settings.myTools || []).includes(tool.id), onStar: star,
    }) : null,
    h('div', { class: 'card stack' },
      h('div', { class: 'row-wrap' }, statusBadge,
        run.status === 'draft' ? button('Mark open', { kind: 'ghost', onClick: () => setStatus('open') }) : null),
      h('p', { class: 'muted' }, `Started ${formatDateTime(run.startedAt, Date.now())}${run.author ? ` · by ${run.author}` : ''}`),
      run.status === 'complete' || !template ? null : h('p', { class: 'small' }, (() => {
        const why = waitingFor(run, template, measurements);
        return why === 'ready to mark complete' ? 'This run is ready to mark complete.' : `This run ${why}.`;
      })()),
      tool ? null : h('p', null, 'Unknown tool')),
    template ? null : section('Choose a template', templateTiles({
      templates: toolTemplates, defaultId: tool?.defaultTemplateId,
      onPick: async (t) => { if (await saveNow({ templateId: t.id })) refresh(); },
    })),
    // What the run needs next comes first, then its projects.
    order.filter(Boolean).slice(0, 1),
    projectBox ? section('Project', projectBox) : null,
    order.filter(Boolean).slice(1),
    section('Photos', photos.el,
      elsewhere ? h('p', { class: 'field-note' }, `${elsewhere} photo${elsewhere === 1 ? ' is' : 's are'} on another device (photos do not sync).`) : null),
    section('Notes and tags', h('div', { class: 'fields' }, notesFields({ notes: state.notes, tags: state.tagsText },
      (p) => change(p.tags !== undefined ? { tagsText: p.tags } : p)))),
    orphans.length ? section('Other values', h('p', { class: 'muted small' }, 'Kept from fields that the template no longer has.'),
      h('dl', { class: 'facts' }, orphans.map(([k, v]) => [h('dt', null, k), h('dd', null, String(v))]))) : null,
    h('details', { class: 'more' }, h('summary', null, 'Times'),
      h('div', { class: 'stack' },
        dateTimeField('Started', state.startedAt, (iso) => change({ startedAt: iso }), HELP.started),
        state.endedAt ? dateTimeField('Ended', state.endedAt, (iso) => change({ endedAt: iso }), HELP.ended) : null)),
    section('Run actions', h('div', { class: 'row-wrap' },
      button('Duplicate as new run', {
        icon: 'copy',
        onClick: async () => {
          await autosave.flush();
          if (!template) { navigate(`/log/${run.toolId}`); return; }
          const d = prefillFrom(blankDraft({ runId: uuid(), toolId: run.toolId, templateId: template.id, now: new Date().toISOString() }), toRun(), template);
          if (await startLogDraft(d)) toast('Your other unsaved run was kept in Open runs as a draft.');
          navigate(`/log/${run.toolId}/${template.id}`);
        },
      }),
      button('Delete run', {
        icon: 'trash', kind: 'ghost',
        onClick: async () => {
          if (!await confirmDialog({ title: 'Delete this run?', message: 'You can undo for a few seconds; the record is kept as deleted.', confirmLabel: 'Delete', danger: true })) return;
          autosave.cancel();
          await deleteRun(id);
          navigate('/open', { replace: true });
          toast('Run deleted.', { action: { label: 'Undo', fn: async () => { await restoreRun(id); navigate(`/run/${id}`); } } });
        },
      }))),
  ]);

  ctx.setActions([
    linkButton('Measure', `#/run/${id}/measure`, { icon: 'ruler' }),
    run.status === 'complete'
      ? button('Reopen', { icon: 'undo', onClick: () => setStatus('open') })
      : button('Mark complete', { kind: 'primary', icon: 'check', onClick: () => setStatus('complete') }),
  ]);
  return async () => {
    recipeUndo?.close();
    photos.dispose();
    try { await autosave.flush(); } catch (err) { toast(errorText(err), { kind: 'error' }); }
  };
}
