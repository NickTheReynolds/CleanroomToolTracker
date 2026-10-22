// @ts-check
/**
 * Look up: tool -> template -> the planned run's inputs (every field
 * optional, prefilled from the last run or from an LNF wiki recipe),
 * material, optional target thickness and the three filter toggles. "Find
 * similar runs" opens the results screen.
 */
import { h, append, fill } from '../ui/dom.js';
import { button, linkButton, section, chip, emptyState, toggle, toast } from '../ui/components.js';
import { renderFields, numberStepper } from '../ui/fields.js';
import { toolTiles, templateTiles, materialPicker } from '../ui/pickers.js';
import { recipeButton, fillMessage } from '../ui/recipes.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate } from '../router.js';
import {
  listTools, listTemplates, getTool, getTemplate, listRuns, lastRunFor, getDraft, saveDraft, getSettings,
  lastUsedByTool, materialsByRecency, LOOKUP_DRAFT,
} from '../data/repo.js';
import { recipesForTool } from '../data/recipes.js';
import { fieldsWithRole, isSet } from '../core/run-draft.js';
import { recipeFill, undoFill, recipeFilm } from '../core/recipes.js';
import { formatDay } from '../core/time.js';

/**
 * @typedef {Object} LookupDraft
 * @property {string} toolId
 * @property {string} templateId
 * @property {string} material
 * @property {Record<string, import('../core/types.js').FieldValue>} params
 * @property {number | null} targetThickness
 * @property {boolean} strictChemistry
 * @property {boolean} sameMaterial
 * @property {boolean} includeSiblings
 * @property {{runId: string, startedAt: string} | null} copiedFrom
 * @property {string} [recipe] the LNF recipe that filled the inputs; Log this run keeps it
 */

/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const { toolId, templateId } = ctx.params;
  if (!toolId) return pickTool(ctx);
  if (!templateId) return pickTemplate(ctx, toolId);
  return form(ctx, toolId, templateId);
}

/** @param {import('../router.js').ViewContext} ctx */
async function pickTool(ctx) {
  ctx.setTitle('Look up');
  const [tools, templates, runs, draft] = await Promise.all([listTools(), listTemplates(), listRuns(), getDraft(LOOKUP_DRAFT)]);
  const usable = tools.filter((t) => templates.some((x) => x.toolId === t.id && x.fields.some((f) => f.role === 'input')));
  const last = draft ? usable.find((t) => t.id === draft.toolId) : null;
  append(ctx.root, [
    h('p', { class: 'muted' }, 'Enter the run you are planning. Lookup finds the most similar past runs and estimates the result.'),
    last ? h('div', { class: 'row-wrap' },
      linkButton(`Last lookup: ${last.shortName || last.name}`, `#/lookup/${draft.toolId}/${draft.templateId}`, { icon: 'search' }),
      linkButton('Last results', '#/results', { icon: 'chart' })) : null,
    usable.length
      ? toolTiles({ tools: usable, lastUsed: lastUsedByTool(runs), onPick: (t) => navigate(`/lookup/${t.id}`) })
      : emptyState('No tools with input fields yet.', linkButton('Set up tools', '#/settings/tools')),
  ]);
}

/**
 * @param {import('../router.js').ViewContext} ctx
 * @param {string} toolId
 */
async function pickTemplate(ctx, toolId) {
  const [tool, templates] = await Promise.all([getTool(toolId), listTemplates(toolId)]);
  ctx.setTitle(tool ? `Look up · ${tool.shortName || tool.name}` : 'Look up');
  const usable = templates.filter((t) => t.fields.some((f) => f.role === 'input'));
  if (usable.length === 1) {
    navigate(`/lookup/${toolId}/${usable[0].id}`, { replace: true });
    return;
  }
  append(ctx.root, [usable.length
    ? templateTiles({ templates: usable, defaultId: tool?.defaultTemplateId, onPick: (t) => navigate(`/lookup/${toolId}/${t.id}`) })
    : emptyState('This tool has no template with input fields.', linkButton('Edit tool', `#/settings/tool/${toolId}`))]);
}

/**
 * A fresh query prefilled from the last run with this tool and template.
 * @param {string} toolId
 * @param {import('../core/types.js').Template} template
 * @returns {Promise<LookupDraft>}
 */
async function freshQuery(toolId, template) {
  const last = await lastRunFor(toolId, template.id);
  /** @type {Record<string, any>} */
  const params = {};
  if (last) {
    for (const f of fieldsWithRole(template, ['input'])) {
      const v = last.params ? last.params[f.key] : undefined;
      if (isSet(v)) params[f.key] = v;
    }
  }
  return {
    toolId, templateId: template.id, material: last ? last.material : '', params, recipe: last ? last.recipe || '' : '',
    targetThickness: last && typeof last.targetThickness === 'number' ? last.targetThickness : null,
    strictChemistry: true, sameMaterial: true, includeSiblings: false,
    copiedFrom: last ? { runId: last.id, startedAt: last.startedAt } : null,
  };
}

/**
 * @param {import('../router.js').ViewContext} ctx
 * @param {string} toolId
 * @param {string} templateId
 */
async function form(ctx, toolId, templateId) {
  const [tool, template, settings, runs, saved, recipes] = await Promise.all([
    getTool(toolId), getTemplate(templateId), getSettings(), listRuns(), getDraft(LOOKUP_DRAFT), recipesForTool(toolId),
  ]);
  if (!tool || !template || template.toolId !== toolId) {
    ctx.setTitle('Look up');
    append(ctx.root, [emptyState('This tool or template no longer exists.', linkButton('Choose a tool', '#/lookup'))]);
    return;
  }
  ctx.setTitle(`Look up · ${tool.shortName || tool.name}`);
  /** @type {LookupDraft} */
  let q = saved && saved.toolId === toolId && saved.templateId === templateId ? saved : await freshQuery(toolId, template);
  const autosave = createAutosave(() => saveDraft(LOOKUP_DRAFT, q));
  const change = (/** @type {Partial<LookupDraft>} */ patch) => {
    q = { ...q, ...patch };
    autosave.schedule();
  };
  const inputs = fieldsWithRole(template, ['input']);
  const body = h('div', { class: 'view' });
  // An LNF recipe fills the planned inputs (inputs only: context is never matched); Undo takes back
  // only what it changed. Gases it clears stay as null, so Log this run does not bring back the last
  // run's gases.
  /** @type {{close: () => void} | null} */
  let undoToast = null;
  const useRecipe = (/** @type {WikiRecipe} */ r, /** @type {number} */ step) => {
    const before = { recipe: q.recipe || '', params: q.params, material: q.material, copiedFrom: q.copiedFrom };
    const f = recipeFill(r, template, { step, roles: ['input'] });
    change({ recipe: r.name, params: { ...q.params, ...f.values }, material: recipeFilm(r) || q.material, copiedFrom: null });
    draw();
    undoToast?.close();
    undoToast = toast(fillMessage(r, f), {
      action: {
        label: 'Undo',
        fn: () => {
          if (!ctx.isCurrent()) return;
          change({ ...before, params: undoFill(q.params, before.params, f.values) });
          draw();
        },
      },
    });
  };
  const draw = () => fill(body,
    h('p', { class: 'muted' }, `${template.name}. Every field is optional: clear a field to leave it out of the match.`),
    q.copiedFrom ? h('div', null, chip(`Prefilled from ${formatDay(q.copiedFrom.startedAt, Date.now())} run`, {
      icon: 'copy', actionLabel: 'Clear all', onClick: () => { change({ params: {}, copiedFrom: null, recipe: '' }); draw(); },
    })) : null,
    section('Planned inputs',
      recipes.length || q.recipe ? h('div', { class: 'row-wrap' },
        recipeButton({
          title: `${tool.shortName || tool.name} recipes`, recipes, template, useLabel: 'Fill planned inputs', roles: ['input'], onUse: useRecipe,
        }),
        q.recipe ? chip(`Recipe: ${q.recipe}`, { icon: 'book', actionLabel: 'Clear recipe', onClick: () => { change({ recipe: '' }); draw(); } }) : null) : null,
      renderFields(inputs, q.params, (k, v) => change({ params: { ...q.params, [k]: v } }), { clearable: true })),
    section('Sample',
      materialPicker({
        label: 'Material', value: q.material, options: materialsByRecency(settings.materials, runs, 'material'),
        onChange: (v) => change({ material: v }),
      }),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'lookup-target' }, 'Target thickness', h('span', { class: 'unit' }, ' (nm, optional)')),
        numberStepper({
          id: 'lookup-target', label: 'target thickness', value: q.targetThickness, step: 10, min: 0,
          onChange: (v) => change({ targetThickness: v }),
        }).el,
        h('p', { class: 'field-note' }, 'With a target, rate results also suggest a process time.'))),
    section('Match rules',
      toggle({ label: 'Strict chemistry', hint: 'Only runs that used the same set of gases.', checked: q.strictChemistry, onChange: (v) => change({ strictChemistry: v }) }),
      toggle({ label: 'Same material', hint: 'Only runs on the same material.', checked: q.sameMaterial, onChange: (v) => change({ sameMaterial: v }) }),
      toggle({
        label: 'Include sibling tools', hint: `Other ${tool.category} tools and templates of the same process type.`,
        checked: q.includeSiblings, onChange: (v) => change({ includeSiblings: v }),
      })),
  );
  draw();
  append(ctx.root, [body]);
  ctx.setActions([
    button('Find similar runs', {
      kind: 'primary', icon: 'search', big: true,
      onClick: async () => {
        await saveDraft(LOOKUP_DRAFT, q);
        autosave.cancel();
        navigate('/results');
      },
    }),
  ]);
  return () => {
    undoToast?.close();
    return autosave.flush();
  };
}
