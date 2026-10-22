// @ts-check
/**
 * Settings -> Tools: the tool list, and the tool editor (name, category,
 * kind, half-life override, notes, archive) with the tool's templates.
 */
import { h, uid, append } from '../ui/dom.js';
import {
  button, linkButton, section, listRow, badge, emptyState, segmented, toggle, toast, chip, errorText, confirmDialog, labelRow,
} from '../ui/components.js';
import { textInput, numberStepper } from '../ui/fields.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate, refresh } from '../router.js';
import {
  listTools, listTemplates, getTool, saveTool, getDraft, saveDraft, clearDraft, getSettings,
} from '../data/repo.js';
import { CATEGORY_LABELS, TOOL_CATEGORIES } from '../core/vocab.js';
import { withTuning } from '../config.js';
import { HELP } from '../core/app-help.js';

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  return ctx.params.id ? renderTool(ctx, ctx.params.id) : renderList(ctx);
}

/** @param {import('../router.js').ViewContext} ctx */
async function renderList(ctx) {
  ctx.setTitle('Tools');
  const [tools, templates] = await Promise.all([listTools({ includeArchived: true }), listTemplates()]);
  const count = (/** @type {string} */ id) => templates.filter((t) => t.toolId === id).length;
  const row = (/** @type {import('../core/types.js').Tool} */ t) => listRow({
    title: t.name,
    subtitle: `${CATEGORY_LABELS[t.category]} · ${t.kind} · ${count(t.id)} template${count(t.id) === 1 ? '' : 's'}`,
    href: `#/settings/tool/${t.id}`,
    badges: t.active ? [] : [badge('Archived', 'muted')],
  });
  const active = tools.filter((t) => t.active);
  const archived = tools.filter((t) => !t.active);
  // Active tools grouped by category, in the usual process order.
  const groups = TOOL_CATEGORIES
    .map((c) => ({ c, list: active.filter((t) => t.category === c) }))
    .filter((g) => g.list.length);
  append(ctx.root, [
    h('p', { class: 'muted small' }, `${active.length} active tools. Archive the ones you never use: they leave the pickers, and their runs stay.`),
    active.length ? groups.map((g) => section(`${CATEGORY_LABELS[g.c]} (${g.list.length})`, h('div', { class: 'list' }, g.list.map(row))))
      : emptyState('No active tools.'),
    archived.length ? section(`Archived (${archived.length})`, h('div', { class: 'list' }, archived.map(row))) : null,
  ]);
  ctx.setActions([linkButton('Add tool', '#/settings/tool/new', { kind: 'primary', icon: 'plus', big: true })]);
}

/**
 * @param {import('../router.js').ViewContext} ctx
 * @param {string} id
 */
async function renderTool(ctx, id) {
  const isNew = id === 'new';
  const existing = isNew ? null : await getTool(id);
  if (!isNew && (!existing || existing.deleted)) {
    ctx.setTitle('Tool not found');
    append(ctx.root, [emptyState('This tool does not exist.', linkButton('All tools', '#/settings/tools'))]);
    return;
  }
  const draftKey = `tool:${id}`;
  const [draft, templates, settings] = await Promise.all([
    getDraft(draftKey), isNew ? Promise.resolve([]) : listTemplates(id), getSettings(),
  ]);
  /** @type {Record<string, any>} */
  let state = draft || (existing ? { ...existing } : {
    name: '', shortName: '', category: 'etch', kind: 'process', active: true, defaultTemplateId: null, halfLifeDays: null, notes: '',
  });
  const autosave = createAutosave(() => saveDraft(draftKey, state));
  let dirty = !!draft;
  const change = (/** @type {Record<string, any>} */ patch) => {
    state = { ...state, ...patch };
    dirty = true;
    autosave.schedule();
  };
  ctx.setTitle(isNew ? 'New tool' : existing?.name || 'Tool');

  const nameId = uid('tool');
  const shortId = uid('tool');
  const halfId = uid('tool');
  const notesId = uid('tool');
  const kindSlot = h('div');
  const drawKind = () => kindSlot.replaceChildren(segmented({
    label: 'Kind', help: HELP.toolKind,
    options: [{ value: 'process', label: 'Process tool' }, { value: 'metrology', label: 'Metrology' }],
    value: state.kind,
    onChange: (v) => change({ kind: v || 'process' }),
  }));
  drawKind();
  const defaultHalfLife = withTuning(settings.tuning).HALF_LIFE_DAYS;

  append(ctx.root, [
    draft ? h('div', null, chip('Restored unsaved changes', {
      actionLabel: 'Discard',
      onClick: async () => { autosave.cancel(); await clearDraft(draftKey); refresh(); },
    })) : null,
    section('Tool',
      h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: nameId }, 'Name'), 'Name', HELP.toolName),
        textInput({ id: nameId, value: state.name, onChange: (v) => change({ name: v || '' }), autocapitalize: 'words' }).el),
      h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: shortId }, 'Short name'), 'Short name', HELP.toolShortName),
        textInput({ id: shortId, value: state.shortName, onChange: (v) => change({ shortName: v || '' }) }).el,
        h('p', { class: 'field-note' }, 'Shown in lists, e.g. “ICP-2”.')),
      segmented({
        label: 'Category', help: HELP.toolCategory,
        options: TOOL_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
        value: state.category,
        onChange: (v) => {
          const category = v || 'other';
          const kind = category === 'metrology' ? 'metrology' : state.kind === 'metrology' ? 'process' : state.kind;
          change({ category, kind });
          drawKind();
        },
      }),
      kindSlot,
      h('div', { class: 'field' },
        labelRow(h('label', { class: 'label', for: halfId }, 'Recency half-life', h('span', { class: 'unit' }, ' (days)')),
          'Recency half-life', HELP.toolHalfLife),
        numberStepper({
          id: halfId, label: 'half-life', value: state.halfLifeDays ?? null, step: 5, min: 1, max: 3650,
          placeholder: null, onChange: (v) => change({ halfLifeDays: v }),
        }).el,
        h('p', { class: 'field-note' }, `Leave empty to use the setting (${defaultHalfLife} days). Use a shorter half-life for tools that drift fast.`)),
      h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: notesId }, 'Notes'), 'Notes', HELP.toolNotes),
        textInput({ id: notesId, value: state.notes, multiline: true, onChange: (v) => change({ notes: v || '' }) }).el),
      isNew ? null : toggle({
        label: 'Active', hint: 'Archived tools are hidden from pickers; their runs stay.',
        checked: !!state.active, onChange: (v) => change({ active: v }),
      })),
    isNew ? null : section('Templates',
      templates.length
        ? h('div', { class: 'list' }, templates.map((t) => listRow({
          title: t.name,
          subtitle: `${t.fields.length} fields · ${t.processType}`,
          href: `#/template/${t.id}`,
          badges: t.id === state.defaultTemplateId ? [badge('Default', 'brand', 'check')] : [],
        })))
        : emptyState('No templates yet. A template defines the form for this tool.'),
      h('div', { class: 'row-wrap' },
        linkButton('New template', `#/template/new?tool=${encodeURIComponent(id)}`, { icon: 'plus' }),
        linkButton('Events and charts', `#/tool/${id}`, { icon: 'chart' }))),
  ]);

  const save = async () => {
    if (!String(state.name || '').trim()) {
      toast('Enter a name for the tool.', { kind: 'error' });
      return;
    }
    try {
      const saved = await saveTool({ ...state, name: state.name.trim(), shortName: String(state.shortName || '').trim() });
      autosave.cancel();
      await clearDraft(draftKey);
      toast(isNew ? 'Tool added. Now add a template.' : 'Tool saved.');
      navigate(isNew ? `/settings/tool/${saved.id}` : '/settings/tools', { replace: true });
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
  };
  ctx.setActions([
    button('Cancel', {
      onClick: async () => {
        if (dirty && !await confirmDialog({ title: 'Discard changes?', message: 'Your unsaved edits to this tool will be lost.', confirmLabel: 'Discard', danger: true })) return;
        autosave.cancel();
        await clearDraft(draftKey);
        navigate('/settings/tools', { replace: true });
      },
    }),
    button('Save', { kind: 'primary', icon: 'check', onClick: save }),
  ]);
  return () => autosave.flush();
}
