// @ts-check
/**
 * Log run: pick a tool (recent first) -> pick a template (skipped when the
 * tool has one) -> fill the form, prefilled from the last run with the same
 * tool and template. Every change autosaves to IndexedDB.
 */
import { h, append, fill } from '../ui/dom.js';
import {
  button, linkButton, section, chip, emptyState, toast, confirmDialog, errorText,
} from '../ui/components.js';
import { renderFields } from '../ui/fields.js';
import { toolTiles, templateTiles } from '../ui/pickers.js';
import { sampleFields, notesFields, timerCard, dateTimeField } from '../ui/run-form.js';
import { photoStrip } from '../ui/photos.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate } from '../router.js';
import {
  listTools, listTemplates, getTool, getTemplate, listRuns, lastRunFor, getDraft, saveDraft, clearDraft,
  saveRun, purgeUnsavedPhotos, getSettings, saveSettings, lastUsedByTool, materialsByRecency,
  LOG_DRAFT as DRAFT, setAsideLogDraft,
} from '../data/repo.js';
import {
  blankDraft, prefillFrom, clearPrefill, missingRequired, hasAnyOutput, draftToRun, timerField, fieldsWithRole,
} from '../core/run-draft.js';
import { uuid } from '../core/ids.js';
import { formatDay, formatDateTime } from '../core/time.js';
import { normText } from '../core/vocab.js';

/** @typedef {import('../core/run-draft.js').RunDraft} RunDraft */

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const { toolId, templateId } = ctx.params;
  if (!toolId) return pickTool(ctx);
  if (!templateId) return pickTemplate(ctx, toolId);
  return form(ctx, toolId, templateId);
}

/** @param {import('../router.js').ViewContext} ctx */
async function pickTool(ctx) {
  ctx.setTitle('Log run');
  const [tools, templates, runs, draft] = await Promise.all([listTools(), listTemplates(), listRuns(), getDraft(DRAFT)]);
  const withTemplates = tools.filter((t) => templates.some((x) => x.toolId === t.id));
  let resume = null;
  if (draft) {
    const tool = tools.find((t) => t.id === draft.toolId);
    const tpl = templates.find((t) => t.id === draft.templateId);
    resume = h('div', { class: 'banner banner-info' }, h('div', { class: 'banner-body' },
      h('p', null, h('strong', null, 'Unsaved run: '), `${tool ? tool.name : 'tool'}${tpl ? ` · ${tpl.name}` : ''}, started ${formatDateTime(draft.startedAt, Date.now())}.`),
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
  append(ctx.root, [
    resume,
    withTemplates.length
      ? toolTiles({ tools: withTemplates, lastUsed: lastUsedByTool(runs), onPick: (t) => navigate(`/log/${t.id}`) })
      : emptyState('No tools with templates yet.', linkButton('Set up tools', '#/settings/tools')),
    h('p', { class: 'muted small' }, 'In a hurry? ', h('a', { href: '#/capture' }, 'Quick capture'), ' saves a tool, photo and note to fill in later.'),
  ]);
}

/**
 * @param {import('../router.js').ViewContext} ctx
 * @param {string} toolId
 */
async function pickTemplate(ctx, toolId) {
  const [tool, templates] = await Promise.all([getTool(toolId), listTemplates(toolId)]);
  ctx.setTitle(tool ? tool.name : 'Log run');
  if (templates.length === 1) {
    navigate(`/log/${toolId}/${templates[0].id}`, { replace: true });
    return;
  }
  append(ctx.root, [
    templates.length
      ? templateTiles({ templates, defaultId: tool?.defaultTemplateId, onPick: (t) => navigate(`/log/${toolId}/${t.id}`) })
      : emptyState('This tool has no template yet.', linkButton('Add a template', `#/settings/tool/${toolId}`)),
  ]);
}

/**
 * @param {import('../router.js').ViewContext} ctx
 * @param {string} toolId
 * @param {string} templateId
 */
async function form(ctx, toolId, templateId) {
  const [tool, template, settings, runs] = await Promise.all([getTool(toolId), getTemplate(templateId), getSettings(), listRuns()]);
  if (!tool || !template || template.toolId !== toolId) {
    ctx.setTitle('Log run');
    append(ctx.root, [emptyState('This tool or template no longer exists.', linkButton('Choose a tool', '#/log'))]);
    return;
  }
  ctx.setTitle(`${tool.shortName || tool.name} · ${template.name}`);
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
    await saveDraft(DRAFT, d);
  }
  /** @type {RunDraft} */
  let draft = d;
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
  const timeKey = timerField(template);
  const photos = photoStrip({
    runId: draft.runId,
    onChange: (ids) => { if (ids.join() !== draft.photoIds.join()) change({ photoIds: ids }); },
  });
  /** @type {{dispose: () => void} | null} */
  let timer = null;
  const body = h('div', { class: 'view' });

  const draw = () => {
    timer?.dispose();
    timer = timerCard({
      timerStartedAt: draft.timerStartedAt,
      lastSeconds: timeKey && typeof draft.params[timeKey] === 'number' ? /** @type {number} */ (draft.params[timeKey]) : null,
      onStart: () => { const now = new Date().toISOString(); change({ timerStartedAt: now, startedAt: now, endedAt: null }); },
      onStop: (secs) => {
        change({
          timerStartedAt: null,
          endedAt: new Date().toISOString(),
          params: timeKey ? { ...draft.params, [timeKey]: secs } : draft.params,
        });
        draw();
      },
    });
    const inputs = fieldsWithRole(template, ['input']);
    const context = fieldsWithRole(template, ['context']);
    const outputs = fieldsWithRole(template, ['output']);
    const setParam = (/** @type {string} */ k, /** @type {any} */ v) => change({ params: { ...draft.params, [k]: v } });
    fill(body,
      draft.copiedFrom ? h('div', null, chip(`Copied from ${formatDay(draft.copiedFrom.startedAt, Date.now())} run`, {
        icon: 'copy', actionLabel: 'Clear',
        onClick: () => { draft = { ...clearPrefill(draft), touched: true }; autosave.schedule(); draw(); },
      })) : null,
      timer.el,
      inputs.length ? section('Inputs', renderFields(inputs, draft.params, setParam)) : null,
      section('Sample', h('div', { class: 'fields' }, sampleFields(draft, {
        lists, onChange: (p) => change(p), onAddMaterial: addMaterial,
        showMask: template.derived.some((x) => x.fn === 'selectivity'),
      }))),
      context.length ? section('Conditions', renderFields(context, draft.params, setParam)) : null,
      outputs.length ? h('details', { class: 'more card', open: hasAnyOutput(template, draft.results) || undefined },
        h('summary', null, 'Results now (optional)'),
        renderFields(outputs, draft.results, (k, v) => change({ results: { ...draft.results, [k]: v } }))) : null,
      section('Photos', photos.el),
      section('Notes', h('div', { class: 'fields' }, notesFields(draft, (p) => change(p)))),
      h('details', { class: 'more' }, h('summary', null, 'Start time'),
        h('div', { class: 'stack' }, dateTimeField('Started', draft.startedAt, (iso) => change({ startedAt: iso })))),
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
      const saved = await saveRun(draftToRun(dd, status));
      await clearDraft(DRAFT);
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
    timer?.dispose();
    photos.dispose();
    await autosave.flush();
  };
}
