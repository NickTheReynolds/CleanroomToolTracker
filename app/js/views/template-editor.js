// @ts-check
/**
 * Template editor: name, process type, primary output, fields (add, remove,
 * reorder, edit spec), derived outputs and a live form preview.
 */
import { h, uid, append, fill } from '../ui/dom.js';
import {
  button, linkButton, section, badge, emptyState, toast, chip, confirmDialog, errorText,
} from '../ui/components.js';
import { textInput, renderFields } from '../ui/fields.js';
import { editFieldSheet, editDerivedSheet } from '../ui/field-spec-editor.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate, refresh } from '../router.js';
import {
  getTemplate, getTool, saveTemplate, saveTool, deleteTemplate, listRuns, getDraft, saveDraft, clearDraft,
} from '../data/repo.js';
import { validateTemplateBody } from '../data/schema.js';
import { DERIVED_INFO } from '../core/derive.js';
import { PROCESS_TYPES, CATEGORY_LABELS, ROLE_LABELS, FIELD_TYPE_LABELS } from '../core/vocab.js';

/** @typedef {import('../core/types.js').FieldSpec} FieldSpec */

/**
 * One-line summary of a field spec.
 * @param {FieldSpec} f
 * @returns {string}
 */
function fieldSummary(f) {
  const parts = [FIELD_TYPE_LABELS[f.type] || f.type];
  if (f.unit && f.type !== 'duration') parts.push(f.unit);
  if (f.step !== undefined) parts.push(`step ${f.step}`);
  if (f.role === 'input') {
    if (f.spreadHint !== undefined) parts.push(`spread ${f.spreadHint}`);
    parts.push(`weight ${f.weight ?? (f.type === 'duration' ? 0 : 1)}`);
    if (f.matchExact) parts.push('exact match');
    if (f.chemistry) parts.push('chemistry');
  }
  if (f.required) parts.push('required');
  return parts.join(' · ');
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const id = ctx.params.id;
  const isNew = id === 'new';
  const draftKey = `template:${isNew ? `new:${ctx.query.get('tool') || ''}` : id}`;
  const existing = isNew ? null : await getTemplate(id);
  if (!isNew && (!existing || existing.deleted)) {
    ctx.setTitle('Template not found');
    append(ctx.root, [emptyState('This template does not exist.', linkButton('Tools', '#/settings/tools'))]);
    return;
  }
  const toolId = existing ? existing.toolId : ctx.query.get('tool') || '';
  const tool = toolId ? await getTool(toolId) : null;
  if (!tool) {
    ctx.setTitle('Template');
    append(ctx.root, [emptyState('Open templates from a tool in Settings → Tools.', linkButton('Tools', '#/settings/tools'))]);
    return;
  }
  const from = ctx.query.get('from');
  const source = from ? await getTemplate(from) : null;
  const draft = await getDraft(draftKey);
  /** @type {Record<string, any>} */
  let t = draft || (existing ? structuredClone(existing) : {
    toolId,
    name: source ? `Copy of ${source.name}` : '',
    processType: source ? source.processType : tool.category,
    primaryOutput: source ? source.primaryOutput : null,
    fields: source ? structuredClone(source.fields) : [],
    derived: source ? structuredClone(source.derived) : [],
  });
  const runs = existing ? (await listRuns()).filter((r) => r.templateId === existing.id) : [];
  /** @param {string} key */
  const usedBy = (key) => runs.filter((r) => (r.params && key in r.params) || (r.results && key in r.results)).length;

  const autosave = createAutosave(() => saveDraft(draftKey, t));
  let dirty = !!draft;
  const touch = () => { dirty = true; autosave.schedule(); draw(); };
  ctx.setTitle(isNew ? 'New template' : `Template: ${t.name}`);

  const body = h('div', { class: 'view' });
  const nameId = uid('tpl');
  const typeId = uid('tpl');
  const primaryId = uid('tpl');
  const nameInput = textInput({
    id: nameId, value: t.name, onChange: (v) => { t.name = v || ''; dirty = true; autosave.schedule(); drawChecks(); },
  });
  const checks = h('div', { role: 'status' });
  const drawChecks = () => {
    const errs = validateTemplateBody(t);
    checks.replaceChildren(errs.length
      ? h('div', { class: 'banner' }, h('div', { class: 'banner-body' },
        h('p', null, h('strong', null, 'Fix before saving:')), ...errs.map((e) => h('p', { class: 'small' }, e))))
      : h('p', { class: 'field-note' }, 'Template is valid.'));
    return errs;
  };

  const fieldCard = (/** @type {FieldSpec} */ f, /** @type {number} */ i) => h('div', { class: 'card stack' },
    h('div', { class: 'spread' }, h('strong', null, f.label), badge(ROLE_LABELS[f.role] || f.role, f.role === 'output' ? 'ok' : f.role === 'input' ? 'brand' : 'muted')),
    h('p', { class: 'muted small mono' }, `${f.key} · ${fieldSummary(f)}`),
    h('div', { class: 'row-wrap' },
      button('', { icon: 'up', ariaLabel: `Move ${f.label} up`, disabled: i === 0, onClick: () => { [t.fields[i - 1], t.fields[i]] = [t.fields[i], t.fields[i - 1]]; touch(); } }),
      button('', { icon: 'down', ariaLabel: `Move ${f.label} down`, disabled: i === t.fields.length - 1, onClick: () => { [t.fields[i + 1], t.fields[i]] = [t.fields[i], t.fields[i + 1]]; touch(); } }),
      button('Edit', {
        icon: 'edit',
        onClick: () => editFieldSheet({
          field: f, usedBy: usedBy(f.key), takenKeys: t.fields.filter((/** @type {FieldSpec} */ x) => x !== f).map((/** @type {FieldSpec} */ x) => x.key),
          onDone: (nf) => {
            if (nf.key !== f.key) {
              for (const d of t.derived) { if (d.output === f.key) d.output = nf.key; if (d.timeField === f.key) d.timeField = nf.key; }
              if (t.primaryOutput === f.key) t.primaryOutput = nf.key;
            }
            t.fields[i] = nf;
            touch();
          },
        }),
      }),
      button('Delete', {
        icon: 'trash', kind: 'ghost',
        onClick: async () => {
          const n = usedBy(f.key);
          const ok = await confirmDialog({
            title: `Delete field “${f.label}”?`,
            message: n ? `${n} run${n === 1 ? '' : 's'} have values for it. Their data is kept but hidden from forms.` : 'It is not used by any run.',
            confirmLabel: 'Delete field', danger: true,
          });
          if (!ok) return;
          t.fields.splice(i, 1);
          t.derived = t.derived.filter((/** @type {any} */ d) => d.output !== f.key && d.timeField !== f.key);
          if (t.primaryOutput === f.key) t.primaryOutput = null;
          touch();
        },
      })));

  const draw = () => {
    const outputs = t.fields.filter((/** @type {FieldSpec} */ f) => f.role === 'output');
    const typeSel = /** @type {HTMLSelectElement} */ (h('select', { id: typeId, class: 'input' },
      PROCESS_TYPES.map((p) => h('option', { value: p, selected: p === t.processType }, CATEGORY_LABELS[p]))));
    typeSel.addEventListener('change', () => { t.processType = typeSel.value; touch(); });
    const primSel = /** @type {HTMLSelectElement} */ (h('select', { id: primaryId, class: 'input' },
      h('option', { value: '' }, 'None'),
      outputs.map((/** @type {FieldSpec} */ f) => h('option', { value: f.key, selected: f.key === t.primaryOutput }, f.label))));
    primSel.addEventListener('change', () => { t.primaryOutput = primSel.value || null; touch(); });
    const previewValues = {};
    fill(body,
      section('Fields',
        t.fields.length ? h('div', { class: 'stack' }, t.fields.map(fieldCard)) : emptyState('No fields yet.'),
        button('Add field', {
          icon: 'plus',
          onClick: () => editFieldSheet({
            field: null, usedBy: 0, takenKeys: t.fields.map((/** @type {FieldSpec} */ x) => x.key),
            onDone: (nf) => { t.fields.push(nf); touch(); },
          }),
        })),
      section('Primary output and process type',
        h('div', { class: 'field' }, h('label', { class: 'label', for: primaryId }, 'Primary output'), primSel,
          h('p', { class: 'field-note' }, 'Shown in lists and summarised by lookup.')),
        h('div', { class: 'field' }, h('label', { class: 'label', for: typeId }, 'Process type'), typeSel,
          h('p', { class: 'field-note' }, 'Sets the lookup verb (etch, deposit) and which templates count as siblings.'))),
      section('Derived outputs',
        h('p', { class: 'muted small' }, 'Computed from measurements with built-in functions. A value typed by hand overrides them.'),
        t.derived.length ? h('div', { class: 'list' }, t.derived.map((/** @type {any} */ d, /** @type {number} */ i) => {
          const out = t.fields.find((/** @type {FieldSpec} */ f) => f.key === d.output);
          return h('div', { class: 'row' },
            h('span', { class: 'row-main' },
              h('span', { class: 'row-title' }, `${out ? out.label : d.output} ← ${DERIVED_INFO[d.fn] ? DERIVED_INFO[d.fn].label : d.fn}`),
              h('span', { class: 'row-sub' }, [d.timeField && `time: ${d.timeField}`, d.phase && `phase: ${d.phase}`, d.kind && `kind: ${d.kind}`].filter(Boolean).join(' · ') || 'defaults')),
            button('', { kind: 'ghost', icon: 'edit', ariaLabel: 'Edit derived output', onClick: () => editDerivedSheet({ entry: d, fields: t.fields, onDone: (nd) => { t.derived[i] = nd; touch(); } }) }),
            button('', { kind: 'ghost', icon: 'trash', ariaLabel: 'Remove derived output', onClick: () => { t.derived.splice(i, 1); touch(); } }));
        })) : emptyState('No derived outputs.'),
        button('Add derived output', {
          icon: 'plus',
          onClick: () => editDerivedSheet({ entry: null, fields: t.fields, onDone: (nd) => { t.derived.push(nd); touch(); } }),
        })),
      section('Preview',
        h('p', { class: 'muted small' }, 'How the form looks when logging a run. Values typed here are not saved.'),
        h('div', { class: 'card' }, renderFields(t.fields, previewValues, () => {}))),
    );
    drawChecks();
  };

  append(ctx.root, [
    draft ? h('div', null, chip('Restored unsaved changes', {
      actionLabel: 'Discard',
      onClick: async () => { autosave.cancel(); await clearDraft(draftKey); refresh(); },
    })) : null,
    h('p', { class: 'muted' }, `Tool: ${tool.name}`),
    section('Template', h('div', { class: 'field' }, h('label', { class: 'label', for: nameId }, 'Name'), nameInput.el)),
    body,
    checks,
    existing ? section('More',
      h('div', { class: 'row-wrap' },
        tool.defaultTemplateId === existing.id ? badge('Default for this tool', 'brand', 'check') : button('Make default for tool', {
          icon: 'check',
          onClick: async () => { await saveTool({ ...tool, defaultTemplateId: existing.id }); toast('Default template set.'); refresh(); },
        }),
        linkButton('Duplicate', `#/template/new?tool=${encodeURIComponent(toolId)}&from=${encodeURIComponent(existing.id)}`, { icon: 'copy' }),
        button('Delete template', {
          icon: 'trash', kind: 'ghost',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Delete this template?',
              message: runs.length ? `${runs.length} runs use it. They keep their data and remain searchable in History.` : 'No runs use it.',
              confirmLabel: 'Delete', danger: true,
            });
            if (!ok) return;
            await deleteTemplate(existing.id);
            autosave.cancel();
            await clearDraft(draftKey);
            navigate(`/settings/tool/${toolId}`, { replace: true });
          },
        }))) : null,
  ]);
  draw();

  const save = async () => {
    t.name = String(t.name || '').trim();
    if (drawChecks().length) {
      toast('Fix the listed problems first.', { kind: 'error' });
      return;
    }
    try {
      const saved = await saveTemplate(t);
      if (!tool.defaultTemplateId) await saveTool({ ...tool, defaultTemplateId: saved.id });
      autosave.cancel();
      await clearDraft(draftKey);
      toast('Template saved.');
      navigate(`/settings/tool/${toolId}`, { replace: true });
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
  };
  ctx.setActions([
    button('Cancel', {
      onClick: async () => {
        if (dirty && !await confirmDialog({ title: 'Discard changes?', message: 'Your unsaved template edits will be lost.', confirmLabel: 'Discard', danger: true })) return;
        autosave.cancel();
        await clearDraft(draftKey);
        navigate(`/settings/tool/${toolId}`, { replace: true });
      },
    }),
    button('Save', { kind: 'primary', icon: 'check', onClick: save }),
  ]);
  return () => autosave.flush();
}
