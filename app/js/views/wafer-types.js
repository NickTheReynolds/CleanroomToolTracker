// @ts-check
/**
 * Settings → Wafer types: the wafers and masks you keep to add to
 * projects, and the LNF store's items (read only; "Copy to your types"
 * makes an editable copy). A mask is a type of kind mask, kept with the
 * wafers. The editor names a type and says what it is.
 */
import { h, append, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  button, linkButton, section, listRow, emptyState, toast, chip, errorText, confirmDialog, labelRow,
} from '../ui/components.js';
import { textInput } from '../ui/fields.js';
import { createAutosave } from '../ui/autosave.js';
import { specEditor } from '../ui/wafer-spec-editor.js';
import { openStoreItem, maskBadge } from '../ui/wafer-types.js';
import { formatDay } from '../core/time.js';
import { navigate, refresh } from '../router.js';
import {
  listSavedWafers, getSavedWafer, saveSavedWafer, deleteSavedWafer, restoreSavedWafer, getDraft, saveDraft, clearDraft,
  getSettings, saveSettings,
} from '../data/repo.js';
import { LNF_STORE, storeItem } from '../data/lnf-store.js';
import { specShort, specEmpty, cleanSpec } from '../core/wafer-spec.js';
import { normText } from '../core/vocab.js';
import { HELP } from '../core/app-help.js';

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  return ctx.params.id ? renderType(ctx, ctx.params.id) : renderList(ctx);
}

/** @param {import('../router.js').ViewContext} ctx */
async function renderList(ctx) {
  ctx.setTitle('Wafer types');
  const saved = await listSavedWafers();
  const store = (/** @type {import('../data/lnf-store.js').StoreItem} */ x) => h('button', {
    type: 'button', class: 'row', onClick: () => openStoreItem(x, { onCopy: () => navigate(`/settings/wafer-type/new?from=${encodeURIComponent(x.id)}`) }),
  }, h('span', { class: 'row-lead' }, icon(x.spec.kind === 'mask' ? 'layers' : 'wafer')),
  h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, x.storeName),
    h('span', { class: 'row-sub' }, [specShort(x.spec), `$${x.price.toFixed(2)}`].filter(Boolean).join(' · '))));
  append(ctx.root, [
    h('p', { class: 'muted' }, 'Wafers and masks you use, to pick when you add them to a project. Each project keeps its own copy of the details.'),
    section(`Your types (${saved.length})`, saved.length
      ? h('div', { class: 'list' }, saved.map((w) => listRow({
        title: w.name, subtitle: specShort(w.spec) || 'No details yet', href: `#/settings/wafer-type/${encodeURIComponent(w.id)}`,
        lead: icon(w.spec?.kind === 'mask' ? 'layers' : 'wafer'), badges: [maskBadge(w)].filter(/** @returns {b is HTMLElement} */ (b) => !!b),
      })))
      : emptyState('None yet. Add one, or copy an LNF store item below.')),
    section(`LNF store (${LNF_STORE.length})`,
      h('p', { class: 'muted small' }, `From the LNF store’s page on ${formatDay(`${LNF_STORE[0].priceSeen}T12:00:00Z`, 0)}: names and descriptions as the store writes them, prices as seen that day (they change; stock is not shown). Tap one to see it or copy it.`),
      h('div', { class: 'list' }, LNF_STORE.map(store))),
  ]);
  ctx.setActions([linkButton('New type', '#/settings/wafer-type/new', { kind: 'primary', icon: 'plus', big: true })]);
}

/**
 * @param {import('../router.js').ViewContext} ctx
 * @param {string} id
 */
async function renderType(ctx, id) {
  const isNew = id === 'new';
  const existing = isNew ? null : await getSavedWafer(id);
  if (!isNew && !existing) {
    ctx.setTitle('Wafer type');
    append(ctx.root, [emptyState('This wafer type does not exist.', linkButton('All wafer types', '#/settings/wafer-types'))]);
    return;
  }
  const from = isNew ? storeItem(ctx.query.get('from')) : null;
  const draftKey = `wafertype:${from ? from.id : id}`;
  const [draft, settings] = await Promise.all([getDraft(draftKey), getSettings()]);
  /** @type {Record<string, any>} */
  let state = draft || (existing ? { ...existing, spec: { ...(existing.spec || {}) } }
    : from ? { name: from.storeName, spec: { ...from.spec } }
      : { name: '', spec: ctx.query.get('kind') === 'mask' ? { kind: 'mask' } : {} });
  const autosave = createAutosave(() => saveDraft(draftKey, state));
  let dirty = !!draft;
  const change = (/** @type {Record<string, any>} */ patch) => {
    state = { ...state, ...patch };
    dirty = true;
    autosave.schedule();
  };
  ctx.setTitle(isNew ? 'New wafer type' : existing?.name || 'Wafer type');
  const nameId = uid('wtype');
  const materials = [...settings.materials];
  append(ctx.root, [
    draft ? h('div', null, chip('Restored unsaved changes', {
      actionLabel: 'Discard', onClick: async () => { autosave.cancel(); await clearDraft(draftKey); refresh(); },
    })) : null,
    from ? h('p', { class: 'muted' }, 'A copy of an LNF store item, yours to change. The store’s own item stays as it is.') : null,
    section('Wafer type',
      h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: nameId }, 'Name'), 'Name', HELP.waferTypeName),
        textInput({ id: nameId, value: state.name, placeholder: 'e.g. Si 100 mm DSP', onChange: (v) => change({ name: v || '' }) }).el),
      specEditor({
        spec: state.spec, kindChoice: true, materials,
        onChange: (spec) => change({ spec }),
        onAddMaterial: async (name) => {
          const s = await getSettings();
          if (!s.materials.some((m) => normText(m) === normText(name))) await saveSettings({ materials: [...s.materials, name] });
        },
      })),
    isNew ? null : section('Delete', button('Delete this type', {
      icon: 'trash', kind: 'ghost',
      onClick: async () => {
        if (!existing || !await confirmDialog({
          title: 'Delete this wafer type?', confirmLabel: 'Delete', danger: true,
          message: 'Projects keep the wafers they have, with their details. You can undo for a few seconds.',
        })) return;
        autosave.cancel();
        await clearDraft(draftKey);
        await deleteSavedWafer(existing.id);
        navigate('/settings/wafer-types', { replace: true });
        toast('Wafer type deleted.', { action: { label: 'Undo', fn: async () => { await restoreSavedWafer(existing.id); refresh(); } } });
      },
    })),
  ]);

  const save = async () => {
    const spec = cleanSpec(state.spec);
    // No name typed: the type is named after what it is, so it can be saved without typing.
    const name = String(state.name || '').trim() || specShort(spec);
    if (!name) { toast('Give the type a name, or say what it is.', { kind: 'error' }); return; }
    if (specEmpty(spec) && !String(state.name || '').trim()) { toast('Give the type a name, or say what it is.', { kind: 'error' }); return; }
    try {
      await saveSavedWafer({ ...state, name, spec });
      autosave.cancel();
      await clearDraft(draftKey);
      toast(isNew ? 'Wafer type added.' : 'Wafer type saved.');
      navigate('/settings/wafer-types', { replace: true });
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
  };
  ctx.setActions([
    button('Cancel', {
      onClick: async () => {
        if (dirty && !await confirmDialog({ title: 'Discard changes?', message: 'Your unsaved edits to this wafer type will be lost.', confirmLabel: 'Discard', danger: true })) return;
        autosave.cancel();
        await clearDraft(draftKey);
        navigate('/settings/wafer-types', { replace: true });
      },
    }),
    button('Save', { kind: 'primary', icon: 'check', onClick: save }),
  ]);
  return () => autosave.flush();
}
