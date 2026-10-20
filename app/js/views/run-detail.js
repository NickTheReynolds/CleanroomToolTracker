// @ts-check
/**
 * Run detail: results (derived or manual), measurements, editable inputs and
 * sample details, photos and notes. Edits autosave and recompute derived
 * outputs. Actions: add measurement, mark complete / reopen, duplicate,
 * delete (soft, with Undo).
 */
import { h, append, fill } from '../ui/dom.js';
import {
  button, linkButton, section, badge, emptyState, toast, confirmDialog, errorText,
} from '../ui/components.js';
import { renderFields } from '../ui/fields.js';
import { templateTiles } from '../ui/pickers.js';
import { sampleFields, notesFields, dateTimeField } from '../ui/run-form.js';
import { outputsList, measurementList } from '../ui/run-outputs.js';
import { photoStrip } from '../ui/photos.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate, refresh } from '../router.js';
import {
  getRecord, recomputeRun, getTool, getTemplate, listTemplates, listMeasurements, listTools, listRuns,
  saveRun, deleteRun, restoreRun, startLogDraft, getSettings, saveSettings, materialsByRecency,
} from '../data/repo.js';
import {
  fieldsWithRole, hasAnyOutput, missingRequired, parseTags, blankDraft, prefillFrom,
} from '../core/run-draft.js';
import { uuid } from '../core/ids.js';
import { formatDateTime } from '../core/time.js';
import { STATUS_LABELS, normText } from '../core/vocab.js';

/** @typedef {import('../core/types.js').Run} Run */

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const id = ctx.params.id;
  const stored = await getRecord('runs', id);
  if (!stored || stored.deleted) {
    ctx.setTitle('Run');
    append(ctx.root, [emptyState(stored ? 'This run was deleted.' : 'This run does not exist.',
      stored ? button('Restore run', { kind: 'primary', icon: 'undo', onClick: async () => { await restoreRun(id); refresh(); } })
        : linkButton('Home', '#/'))]);
    return;
  }
  /** @type {Run} */
  let run = (await recomputeRun(id)) || stored;
  const [tool, template, measurements, tools, settings, runs] = await Promise.all([
    getTool(run.toolId), run.templateId ? getTemplate(run.templateId) : null, listMeasurements(id),
    listTools({ includeArchived: true }), getSettings(), listRuns(),
  ]);
  const toolMap = new Map(tools.map((t) => [t.id, t]));
  ctx.setTitle(`${tool ? tool.shortName || tool.name : 'Run'}${template ? ` · ${template.name}` : ''}`);

  // Editable copy; tags are edited as text.
  let state = { ...run, tagsText: (run.tags || []).join(', ') };
  const toRun = () => {
    const { tagsText, ...rest } = state;
    return /** @type {Run} */ ({ ...rest, tags: parseTags(tagsText) });
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
      run: toRun(), template, measurements,
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
  drawOutputs();

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
  const setParam = (/** @type {string} */ k, /** @type {any} */ v) => change({ params: { ...state.params, [k]: v } });

  const setStatus = async (/** @type {'draft' | 'open' | 'complete'} */ status) => {
    if (status !== 'draft') {
      const missing = missingRequired(template, state.params, state.results);
      if (missing.length) {
        toast(`Fill in first: ${missing.join(', ')}`, { kind: 'error' });
        return;
      }
    }
    if (status === 'complete' && !hasAnyOutput(template, state.results)) {
      const ok = await confirmDialog({
        title: 'Mark complete without results?',
        message: 'Lookup only uses complete runs that have at least one result.',
        confirmLabel: 'Mark complete',
      });
      if (!ok) return;
    }
    const endedAt = status === 'complete' ? state.endedAt || new Date().toISOString() : state.endedAt;
    if (await saveNow({ status, endedAt })) {
      toast(status === 'complete' ? 'Run marked complete.' : `Run is now ${status}.`);
      refresh();
    }
  };

  append(ctx.root, [
    h('div', { class: 'card stack' },
      h('div', { class: 'row-wrap' }, statusBadge,
        run.status === 'draft' ? button('Mark open', { kind: 'ghost', onClick: () => setStatus('open') }) : null),
      h('p', { class: 'muted' }, `Started ${formatDateTime(run.startedAt, Date.now())}${run.author ? ` · by ${run.author}` : ''}`),
      h('p', null, tool ? tool.name : 'Unknown tool', template ? ` · ${template.name}` : '')),
    template ? null : section('Choose a template', templateTiles({
      templates: await listTemplates(run.toolId), defaultId: tool?.defaultTemplateId,
      onPick: async (t) => { if (await saveNow({ templateId: t.id })) refresh(); },
    })),
    template ? section('Results', outputsBox) : null,
    section('Measurements', measurementList({ runId: id, measurements, tools: toolMap })),
    template && fieldsWithRole(template, ['input']).length
      ? section('Inputs', renderFields(fieldsWithRole(template, ['input']), state.params, setParam)) : null,
    section('Sample', h('div', { class: 'fields' }, sampleFields(state, {
      lists, onChange: (p) => change(p), onAddMaterial: addMaterial,
      showMask: !!template && template.derived.some((d) => d.fn === 'selectivity'),
    }))),
    template && fieldsWithRole(template, ['context']).length
      ? section('Conditions', renderFields(fieldsWithRole(template, ['context']), state.params, setParam)) : null,
    section('Photos', photos.el),
    section('Notes', h('div', { class: 'fields' }, notesFields({ notes: state.notes, tags: state.tagsText },
      (p) => change(p.tags !== undefined ? { tagsText: p.tags } : p)))),
    orphans.length ? section('Other values', h('p', { class: 'muted small' }, 'Kept from fields that the template no longer has.'),
      h('dl', { class: 'facts' }, orphans.map(([k, v]) => [h('dt', null, k), h('dd', null, String(v))]))) : null,
    h('details', { class: 'more' }, h('summary', null, 'Times'),
      h('div', { class: 'stack' },
        dateTimeField('Started', state.startedAt, (iso) => change({ startedAt: iso })),
        state.endedAt ? dateTimeField('Ended', state.endedAt, (iso) => change({ endedAt: iso })) : null)),
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
    photos.dispose();
    try { await autosave.flush(); } catch (err) { toast(errorText(err), { kind: 'error' }); }
  };
}
