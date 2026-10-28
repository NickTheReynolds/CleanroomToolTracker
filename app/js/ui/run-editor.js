// @ts-check
/**
 * The editor of a saved run, shared by a project's step page and Run detail
 * (2.0). What matters at the tool comes first: the recipe and the inputs,
 * then the timer, then the results and measurements. Everything else waits
 * under "More details": sample, conditions, the projects and wafers, photos,
 * notes and tags, the run's own steps, times and values from fields the
 * template no longer has. A complete run opens as a summary of its values
 * with Edit values, so a past run's recipe, settings and time can be
 * adjusted later. Edits autosave and recompute the derived results.
 */
import { h, fill } from './dom.js';
import { icon } from './icons.js';
import { button, section, badge, confirmDialog, toast, errorText } from './components.js';
import { renderFields } from './fields.js';
import { templateTiles } from './pickers.js';
import { recipeField, sampleFields, notesFields, dateTimeField } from './run-form.js';
import { stepControls } from './run-steps.js';
import { projectLinks } from './project-picker.js';
import { fillMessage } from './recipes.js';
import { outputsList, measurementList } from './run-outputs.js';
import { photoStrip } from './photos.js';
import { createAutosave } from './autosave.js';
import { timerCard } from './timer.js';
import { startRunTimer, stopRunTimer, loadTimers } from './timers.js';
import { saveRun, getSettings, saveSettings, materialsByRecency } from '../data/repo.js';
import { fieldsWithRole, hasAnyOutput, missingRequired, parseTags, timerField } from '../core/run-draft.js';
import {
  mainIndex, stepValues, withStepValues, addStep, removeStep, setMain, renameStep, recipeForForm, tidySteps, stepsText,
} from '../core/run-steps.js';
import { undoFill } from '../core/recipes.js';
import { waitingFor } from '../core/derive.js';
import { runTimer, stopTimer } from '../core/timers.js';
import { fmtValue } from '../core/format.js';
import { formatMmSs } from '../core/time.js';
import { normText } from '../core/vocab.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').Template} Template */
/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Project} Project */
/** @typedef {import('../core/types.js').Measurement} Measurement */
/** @typedef {import('../core/types.js').Photo} Photo */
/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */

/** @param {unknown} v */
const hasValue = (v) => v !== undefined && v !== null && v !== '';
/** The selected step's button, focused again after the inputs redraw. */
const CHECKED_STEP = '.run-steps [role="radio"][aria-checked="true"]';

/**
 * @typedef {Object} EditorOpts
 * @property {Run} run the run as stored (derived results recomputed)
 * @property {Template | null} template
 * @property {Tool | null} tool
 * @property {Measurement[]} measurements the run's
 * @property {Tool[]} tools every tool, archived too
 * @property {import('../data/records.js').Settings} settings
 * @property {Run[]} runs every run (recent materials, the projects' progress)
 * @property {Project[]} projects live projects
 * @property {WikiRecipe[]} recipes the recipes the form offers
 * @property {Template[]} toolTemplates the tool's templates, to choose one when the run has none
 * @property {Photo[]} localPhotos the run's photos on this device
 * @property {boolean} [summary] open as a summary of the values, with Edit values (a complete run)
 * @property {() => void} onReload redraw the whole screen (a template was chosen)
 * @property {(run: Run) => void} [onChange] the run was saved by the editor itself (a timer, a status)
 */

/**
 * @typedef {Object} RunEditor
 * @property {HTMLElement} el
 * @property {() => Run} current the run with every edit so far
 * @property {() => Promise<void>} flush write pending edits now
 * @property {() => void} cancel drop pending edits (before a delete)
 * @property {(status: 'draft' | 'open' | 'complete') => Promise<boolean>} setStatus after the checks (required fields, a
 *   missing main result); false when it did not happen
 * @property {(r: WikiRecipe, step: number) => void} useRecipe fill the form from an LNF recipe
 * @property {() => void} edit leave the summary for the full form
 * @property {() => boolean} summarised whether the summary shows
 * @property {() => Promise<void>} dispose
 */

/**
 * @param {EditorOpts} o
 * @returns {RunEditor}
 */
export function runEditor(o) {
  const { template, tool } = o;
  let state = { ...o.run, steps: o.run.steps || [], projects: o.run.projects || [], tagsText: (o.run.tags || []).join(', ') };
  const toRun = () => {
    const { tagsText, ...rest } = state;
    // Steps are stored tidy (names, no empty values), as Log run stores them.
    return /** @type {Run} */ ({ ...rest, steps: tidySteps(rest.steps || []), tags: parseTags(tagsText) });
  };
  const autosave = createAutosave(async () => {
    const before = JSON.stringify([state.derivedKeys, state.derivedKeys.map((k) => state.results[k])]);
    const saved = await saveRun(toRun());
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
  const save = async (/** @type {Record<string, any>} */ patch) => {
    change(patch);
    try {
      await autosave.flush();
      return true;
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
      return false;
    }
  };
  /** Take the run as the timer saved it. */
  const adopt = (/** @type {Run} */ saved) => { state = { ...saved, steps: saved.steps || [], projects: saved.projects || [], tagsText: (saved.tags || []).join(', ') }; };
  const el = h('div', { class: 'stack run-editor' });
  /** Focus a control again after a redraw replaced the one the person used. */
  const focusIn = (/** @type {string} */ sel) => { /** @type {HTMLElement | null} */ (el.querySelector(sel))?.focus(); };

  // Results: never redrawn while the person is typing in them.
  const outputsBox = h('div');
  let outputsOpen = false;
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
      run: toRun(), template, measurements: o.measurements, expanded: outputsOpen,
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
        save({ results, derivedKeys: state.derivedKeys.filter((k) => k !== key) });
      },
    }));
    if (summarised) drawSummary();
  };

  const lists = {
    material: materialsByRecency(o.settings.materials, o.runs, 'material'),
    substrate: materialsByRecency(o.settings.materials, o.runs, 'substrate'),
    maskMaterial: materialsByRecency(o.settings.materials, o.runs, 'maskMaterial'),
  };
  const addMaterial = async (/** @type {string} */ name) => {
    const s = await getSettings();
    if (!s.materials.some((m) => normText(m) === normText(name))) await saveSettings({ materials: [...s.materials, name] });
  };
  const photos = photoStrip({ runId: state.id, onChange: (ids) => { state = { ...state, photoIds: ids }; } });
  // Photos do not sync: count the ones taken on another device.
  const elsewhere = (o.run.photoIds || []).filter((pid) => !o.localPhotos.some((p) => p.id === pid)).length;
  const known = new Set(template ? template.fields.map((f) => f.key) : []);
  const orphans = [...Object.entries(o.run.params || {}), ...Object.entries(o.run.results || {})].filter(([k]) => !known.has(k));
  // The step whose inputs the form shows (the main step at first).
  let active = Math.max(0, mainIndex(state.steps));
  const setParam = (/** @type {string} */ k, /** @type {any} */ v) => {
    const cur = stepValues(state.steps, state.params, active);
    change(withStepValues(state.steps, state.params, active, { ...cur, [k]: v }));
    // The time typed into the main step is what Count down offers.
    if (k === timerField(template) && (!state.steps.length || state.steps[active]?.main)) drawTimer();
  };
  const addRunStep = () => {
    const next = addStep(state.steps, `Step ${Math.max(state.steps.length, 1) + 1}`);
    change({ steps: next });
    active = next.length - 1;
    drawForm();
    focusIn('.run-steps input');
  };

  // The recipe, the run's steps and the inputs redraw together when a recipe or a step changes them; the sample
  // and conditions (under More) follow.
  const formBox = h('div', { class: 'stack' });
  const sampleBox = h('div');
  const condBox = h('div');
  const stepsAdd = h('div');
  const drawForm = () => {
    const values = stepValues(state.steps, state.params, active);
    const inputs = template ? fieldsWithRole(template, ['input']) : [];
    const context = template ? fieldsWithRole(template, ['context']) : [];
    fill(formBox,
      recipeField({
        value: state.recipe, onChange: (v) => change({ recipe: v }), recipes: o.recipes, template, allSteps: true,
        title: `${tool ? tool.shortName || tool.name : 'Tool'} recipes`, onUse: useRecipe,
      }),
      inputs.length ? h('div', { class: 'stack' }, state.steps.length ? stepControls({
        steps: state.steps, active,
        onSelect: (i) => { active = i; drawForm(); focusIn(CHECKED_STEP); },
        onAdd: addRunStep,
        onRename: (i, name) => change({ steps: renameStep(state.steps, i, name) }),
        onMakeMain: (i) => { change(setMain(state.steps, state.params, i)); drawForm(); focusIn(CHECKED_STEP); },
        onRemove: (i) => {
          const next = removeStep(state.steps, i);
          change({ steps: next });
          active = Math.max(0, mainIndex(next));
          drawForm();
          focusIn(next.length ? CHECKED_STEP : '.run-steps button');
        },
      }) : null, renderFields(inputs, values, setParam, { template, collapseGases: true })) : null);
    fill(sampleBox, section('Sample', h('div', { class: 'fields' }, sampleFields(state, {
      lists, onChange: (p) => change(p), onAddMaterial: addMaterial,
      showMask: !!template && template.derived.some((d) => d.fn === 'selectivity'), showRecipe: false,
    }))));
    fill(condBox, context.length ? section('Conditions', renderFields(context, values, setParam, { template })) : null);
    fill(stepsAdd, template && !state.steps.length ? section('Steps of this run', stepControls({
      steps: [], active: 0, onAdd: addRunStep, onSelect: () => {}, onRename: () => {}, onMakeMain: () => {}, onRemove: () => {},
    })) : null);
  };
  // Undo takes back only what the recipe changed, and goes away with the editor.
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
    if (summarised) edit();
    const before = { recipe: state.recipe, params: state.params, material: state.material, steps: state.steps };
    const res = recipeForForm(state, r, template, step, o.settings.materials);
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
          if (!el.isConnected) return;
          change({ recipe: before.recipe, params: undoFill(state.params, before.params, res.fill.values), material: before.material, steps: before.steps });
          active = Math.max(0, mainIndex(before.steps));
          drawForm();
        },
      },
    });
  }

  // The timer: on a run not complete yet. Start and Stop save the run themselves.
  const timerSlot = h('div');
  /** @type {{el: HTMLElement, dispose: () => void} | null} */
  let timer = null;
  const drawTimer = () => {
    timer?.dispose();
    timer = null;
    if (!template || state.status === 'complete') {
      fill(timerSlot);
      return;
    }
    timer = timerCard({
      run: state, template, fills: state.steps.length ? 'the main step’s (★) time' : 'the time field',
      onStart: async (target) => {
        try {
          await autosave.flush();
          const saved = await startRunTimer(toRun(), target);
          adopt(saved);
          drawTimer();
          drawTimes();
          o.onChange?.(saved);
        } catch (err) { toast(errorText(err), { kind: 'error' }); }
      },
      onStop: async () => {
        try {
          await autosave.flush();
          const res = await stopRunTimer(toRun(), template);
          adopt(res.run);
          drawTimer();
          drawForm();
          drawOutputs();
          drawTimes();
          toast(`Stopped at ${formatMmSs(res.seconds)}. The time is in the form.`);
          o.onChange?.(res.run);
        } catch (err) { toast(errorText(err), { kind: 'error' }); }
      },
    });
    fill(timerSlot, timer.el);
  };

  // A complete run at a glance: its recipe, settings, time and results.
  const summaryBox = h('div');
  const drawSummary = () => {
    const run = toRun();
    /** @type {[string, string | Node][]} */
    const rows = [];
    if (run.recipe) rows.push(['Recipe', run.recipe]);
    for (const f of template ? fieldsWithRole(template, ['input', 'context']) : []) {
      const v = run.params[f.key];
      if (!hasValue(v)) continue;
      rows.push([f.label, f.type === 'duration' && typeof v === 'number' ? formatMmSs(v) : typeof v === 'number' ? fmtValue(v, f.unit)
        : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)]);
    }
    if (run.steps.length) rows.push(['Steps', stepsText(run, template)]);
    for (const f of template ? fieldsWithRole(template, ['output']) : []) {
      const v = run.results[f.key];
      if (!hasValue(v)) continue;
      rows.push([f.label, h('span', { class: 'row-wrap' }, h('strong', null, typeof v === 'number' ? fmtValue(v, f.unit) : String(v)),
        run.derivedKeys.includes(f.key) ? badge('derived', 'ok', 'check') : null)]);
    }
    if (o.measurements.length) rows.push(['Measurements', `${o.measurements.length}`]);
    fill(summaryBox, h('div', { class: 'card stack run-summary' },
      rows.length ? h('dl', { class: 'facts' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]))
        : h('p', { class: 'muted' }, 'No values were recorded for this run.'),
      h('div', { class: 'row-wrap' }, button('Edit values', { icon: 'edit', onClick: edit }))));
  };

  const timesBox = h('div', { class: 'stack' });
  const drawTimes = () => fill(timesBox,
    dateTimeField('Started', state.startedAt, (iso) => change({ startedAt: iso }), HELP.started),
    state.endedAt ? dateTimeField('Ended', state.endedAt, (iso) => change({ endedAt: iso }), HELP.ended) : null);
  const projectBox = projectLinks({
    projects: o.projects, runs: o.runs, toolId: state.toolId, links: state.projects, title: 'Projects', openLinks: true,
    onChange: (links) => change({ projects: links }),
  });
  const resultsSection = template ? section('Results', outputsBox,
    measurementList({ runId: state.id, measurements: o.measurements, tools: new Map(o.tools.map((t) => [t.id, t])) })) : null;
  const moreBody = h('div', { class: 'stack' });
  const more = h('details', { class: 'more fold' }, h('summary', null, icon('down', { size: 18 }), 'More details'), moreBody);
  const notesSection = section('Notes and tags', h('div', { class: 'fields' }, notesFields({ notes: state.notes, tags: state.tagsText },
    (p) => change(p.tags !== undefined ? { tagsText: p.tags } : p))));
  const photosSection = section('Photos', photos.el,
    elsewhere ? h('p', { class: 'field-note' }, `${elsewhere} photo${elsewhere === 1 ? ' is' : 's are'} on another device (photos do not sync).`) : null);
  const timesSection = section('Times', timesBox);
  const orphanSection = orphans.length ? section('Other values', h('p', { class: 'muted small' }, 'Kept from fields that the template no longer has.'),
    h('dl', { class: 'facts' }, orphans.map(([k, v]) => [h('dt', null, k), h('dd', null, String(v))]))) : null;
  const essentials = h('div', { class: 'stack run-essentials' }, formBox, timerSlot);
  let summarised = !!o.summary && !!template;
  const arrange = () => {
    fill(moreBody, summarised ? resultsSection : null, sampleBox, condBox, projectBox ? section('Projects and wafers', projectBox) : null,
      photosSection, notesSection, stepsAdd, timesSection, orphanSection);
    fill(el,
      template ? null : section('Choose a template', h('p', { class: 'muted small' }, 'The template gives the run its inputs and results.'),
        templateTiles({ templates: o.toolTemplates, defaultId: tool?.defaultTemplateId, onPick: async (t) => { if (await save({ templateId: t.id })) o.onReload(); } })),
      summarised ? summaryBox : essentials,
      summarised ? null : resultsSection,
      more);
  };
  const edit = () => {
    if (!summarised) return;
    summarised = false;
    arrange();
    drawForm();
    drawTimer();
    focusIn('input');
  };

  /**
   * Mark complete, after a word when the main result (or any result) is
   * still missing: Lookup leaves such a run out.
   * @returns {Promise<boolean>} false when the person backs out
   */
  const confirmComplete = async () => {
    const primary = template && template.primaryOutput ? template.fields.find((f) => f.key === template.primaryOutput) : null;
    if (template && primary && !hasValue(state.results[primary.key])) {
      const why = waitingFor({ ...toRun(), status: 'open' }, template, o.measurements);
      const what = why === 'needs results' || why === 'ready to mark complete' ? `${primary.label} is empty.`
        : why.startsWith('cannot work out ') ? `${primary.label} cannot be worked out: ${why.slice(why.indexOf(': ') + 2)}.`
          : `${primary.label} ${why}.`;
      return confirmDialog({
        title: `Finish without ${primary.label.toLowerCase()}?`,
        message: `${what} Lookup leaves this run out of its ${primary.label.toLowerCase()} figures until it has one; you can still add it later.`,
        confirmLabel: 'Finish',
      });
    }
    if (!hasAnyOutput(template, state.results)) {
      return confirmDialog({ title: 'Finish without results?', message: 'Lookup only uses complete runs that have at least one result.', confirmLabel: 'Finish' });
    }
    return true;
  };
  const setStatus = async (/** @type {'draft' | 'open' | 'complete'} */ status) => {
    // Results derived from edits still waiting to save (a time just typed) count.
    try { await autosave.flush(); } catch { /* save below reports a failed save */ }
    if (status !== 'draft') {
      const missing = missingRequired(template, state.params, state.results);
      if (missing.length) {
        toast(`Fill in first: ${missing.join(', ')}`, { kind: 'error' });
        return false;
      }
    }
    if (status === 'complete' && !await confirmComplete()) return false;
    /** @type {Record<string, any>} */
    let patch = { status, endedAt: status === 'complete' ? state.endedAt || new Date().toISOString() : state.endedAt };
    // A timer still running on a run marked complete stops with it; a time the person typed stays.
    if (status === 'complete' && runTimer(state)) patch = { ...patch, ...stopTimer(state, template, { keepTyped: true }).patch };
    if (!await save(patch)) return false;
    if (patch.timer === null) loadTimers();
    summarised = status === 'complete' && !!template;
    arrange();
    drawForm();
    drawTimer();
    drawOutputs();
    drawTimes();
    if (summarised) drawSummary();
    o.onChange?.(toRun());
    return true;
  };

  arrange();
  drawForm();
  drawTimer();
  drawOutputs();
  drawTimes();
  if (summarised) drawSummary();
  return {
    el,
    current: toRun,
    flush: () => autosave.flush(),
    cancel: () => autosave.cancel(),
    setStatus,
    useRecipe,
    edit,
    summarised: () => summarised,
    dispose: async () => {
      recipeUndo?.close();
      timer?.dispose();
      photos.dispose();
      try { await autosave.flush(); } catch (err) { toast(errorText(err), { kind: 'error' }); }
    },
  };
}
