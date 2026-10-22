// @ts-check
/**
 * New or edit project: name, folder, goal, start date and substrate, the
 * wafers (added in one go, renamed, finished or scrapped one by one) and an
 * optional plan of steps, each with a tool and a recipe. "?copy=<id>"
 * starts from a copy of another project, "?folder=<id>" in a folder.
 * Autosaves as a draft until saved, like the other editors.
 */
import { h, append, fill, uid } from '../ui/dom.js';
import {
  button, section, segmented, emptyState, toast, chip, confirmDialog, errorText, labelRow, sheet,
} from '../ui/components.js';
import { textInput, numberStepper } from '../ui/fields.js';
import { materialPicker, toolTiles, mineOf } from '../ui/pickers.js';
import { recipeButton } from '../ui/recipes.js';
import { chooseFolder } from '../ui/folder-picker.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate, refresh } from '../router.js';
import {
  getProject, saveProject, listProjects, listRuns, listTools, listTemplates, getDraft, saveDraft, clearDraft, getSettings,
  lastUsedByTool, listFolders,
} from '../data/repo.js';
import { recipesForTool } from '../data/recipes.js';
import { newWafers, newStep, copyPlan, projectRuns, linkFor, duplicateProject } from '../core/projects.js';
import { folderTree, pathText } from '../core/folders.js';
import { recipesFor } from '../core/recipes.js';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, WAFER_STATUSES, WAFER_STATUS_LABELS } from '../core/vocab.js';
import { localDateKey, fromLocalInput } from '../core/time.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').PlanStep} PlanStep */
/** @typedef {import('../core/types.js').Wafer} Wafer */

/**
 * A labelled text box.
 * @param {string} label
 * @param {string} value
 * @param {(v: string) => void} onChange
 * @param {{help?: string, multiline?: boolean, placeholder?: string, hidden?: boolean, id?: string}} [o] hidden: the label is for screen
 *   readers only; id: a stable id, so focus can return to the box after a redraw
 * @returns {HTMLElement}
 */
function textField(label, value, onChange, o = {}) {
  const id = o.id || uid('pf');
  const lab = h('label', { class: o.hidden ? 'visually-hidden' : 'label', for: id }, label);
  return h('div', { class: 'field' }, o.hidden ? lab : labelRow(lab, label, o.help),
    textInput({ id, value, multiline: o.multiline, placeholder: o.placeholder, onChange: (v) => onChange(v || '') }).el);
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const id = ctx.params.id || 'new';
  const isNew = id === 'new';
  const existing = isNew ? null : await getProject(id);
  const source = isNew && ctx.query.get('copy') ? await getProject(ctx.query.get('copy') || '') : null;
  ctx.setTitle(source ? 'Copy project' : isNew ? 'New project' : 'Edit project');
  if (!isNew && !existing) {
    append(ctx.root, [emptyState('This project does not exist.')]);
    return;
  }
  const draftKey = source ? `project:copy:${source.id}` : `project:${id}`;
  const [draft, projects, runs, tools, templates, settings, folders] = await Promise.all([
    getDraft(draftKey), listProjects(), listRuns(), listTools(), listTemplates(), getSettings(), listFolders(),
  ]);
  let tree = folderTree(folders);
  const inFolder = ctx.query.get('folder');
  // The project page (a pause, a finish, a move) or another device may have changed the project since these
  // unsaved edits were made. They are restored, but status, end and folder come from the stored project unless
  // the person changed them in this form (`_base` holds what the form started from). Step marks are merged on
  // Save, which also asks before saving over the newer version.
  const stale = !!(draft && existing && draft.updatedAt !== existing.updatedAt);
  /** @type {Record<string, any> | null} */
  let restored = draft;
  if (stale && draft && existing) {
    const base = draft._base || { status: draft.status, endedAt: draft.endedAt ?? null, folderId: draft.folderId ?? null };
    /** @param {'status' | 'endedAt' | 'folderId'} k */
    const pick = (k) => ((draft[k] ?? null) === (base[k] ?? null) ? existing[k] ?? null : draft[k]);
    restored = { ...draft, status: pick('status'), endedAt: pick('endedAt'), folderId: pick('folderId') };
  }
  /** @type {Record<string, any>} */
  let p = restored || (existing ? {
    ...structuredClone(existing), _base: { status: existing.status, endedAt: existing.endedAt ?? null, folderId: existing.folderId ?? null },
  } : source ? duplicateProject(source, { taken: projects.map((x) => x.name) }) : {
    name: '', goal: '', status: 'active', startedAt: new Date().toISOString(), endedAt: null, substrate: '', notes: '',
    wafers: newWafers([], 1), steps: [], folderId: inFolder && tree.byId.has(inFolder) ? inFolder : null,
  });
  const autosave = createAutosave(() => saveDraft(draftKey, p));
  let dirty = !!restored;
  /**
   * @param {Record<string, any>} patch
   * @param {boolean} [redraw]
   * @param {string | null} [focus] what to focus after the redraw (default: the control that had focus)
   */
  const change = (patch, redraw = false, focus = null) => {
    p = { ...p, ...patch };
    dirty = true;
    autosave.schedule();
    if (redraw) draw(focus);
  };
  // Wafers and steps that runs name cannot be removed: finish or scrap a wafer, skip a step.
  const linked = existing ? projectRuns(runs, existing.id).map((r) => linkFor(r, existing.id)) : [];
  const usedWafers = new Set(linked.flatMap((l) => (l ? l.waferIds : [])));
  const usedSteps = new Set(linked.map((l) => (l ? l.stepId : null)).filter(Boolean));
  const toolMap = new Map(tools.map((t) => [t.id, t]));
  const lastUsed = lastUsedByTool(runs);
  const withTemplates = tools.filter((t) => templates.some((x) => x.toolId === t.id));
  const body = h('div', { class: 'view' });

  /**
   * The template a step on this tool uses: its own when that still exists, else the tool's default, else
   * the tool's first (a deleted template must not stay on the plan).
   * @param {string} toolId
   * @param {string | null | undefined} wanted
   * @returns {string | null}
   */
  const liveTemplate = (toolId, wanted) => {
    const own = templates.filter((x) => x.toolId === toolId);
    const tool = toolMap.get(toolId);
    return own.find((x) => x.id === wanted)?.id || own.find((x) => x.id === tool?.defaultTemplateId)?.id || own[0]?.id || null;
  };
  const chooseTool = (/** @type {number} */ i) => {
    const s = sheet('Tool for this step', [toolTiles({
      tools: withTemplates, lastUsed, mine: mineOf(settings.myTools, lastUsed),
      onPick: (t) => {
        s.close();
        const steps = p.steps.map((/** @type {PlanStep} */ x, /** @type {number} */ j) => (j === i
          ? { ...x, toolId: t.id, templateId: liveTemplate(t.id, null), title: x.title || t.shortName || t.name } : x));
        change({ steps }, true, `#step-tool-${p.steps[i]?.id}`);
      },
    })]);
  };

  const waferRow = (/** @type {Wafer} */ w, /** @type {number} */ i) => {
    const update = (/** @type {Partial<Wafer>} */ patch) => change({ wafers: p.wafers.map((/** @type {Wafer} */ x, /** @type {number} */ j) => (j === i ? { ...x, ...patch } : x)) });
    const labelId = `wafer-${w.id}`;
    const statusId = `wstatus-${w.id}`;
    const status = /** @type {HTMLSelectElement} */ (h('select', { id: statusId, class: 'input wafer-status' },
      WAFER_STATUSES.map((s) => h('option', { value: s, selected: s === w.status }, WAFER_STATUS_LABELS[s]))));
    status.addEventListener('change', () => update({ status: /** @type {Wafer['status']} */ (status.value) }));
    return h('div', { class: 'card stack wafer-row' },
      h('div', { class: 'wafer-line' },
        h('label', { class: 'visually-hidden', for: labelId }, `Wafer ${i + 1} label`),
        textInput({ id: labelId, value: w.label, autocapitalize: 'characters', onChange: (v) => update({ label: v || '' }) }).el,
        h('label', { class: 'visually-hidden', for: statusId }, `${w.label || `Wafer ${i + 1}`} status`), status,
        usedWafers.has(w.id) ? null : button('', {
          kind: 'ghost', icon: 'trash', ariaLabel: `Remove ${w.label || `wafer ${i + 1}`}`,
          onClick: () => {
            const near = p.wafers[i + 1] || p.wafers[i - 1];
            change({ wafers: p.wafers.filter((/** @type {Wafer} */ _, /** @type {number} */ j) => j !== i) }, true,
              near ? `#wafer-${near.id}` : '#add-wafers');
          },
        })),
      textField(`${w.label || `Wafer ${i + 1}`} note`, w.notes, (v) => update({ notes: v }), { hidden: true, placeholder: 'Note, e.g. test wafer or chipped edge' }));
  };

  const stepCard = (/** @type {PlanStep} */ s, /** @type {number} */ i) => {
    const update = (/** @type {Partial<PlanStep>} */ patch, redraw = false, /** @type {string | null} */ focus = null) => change({
      steps: p.steps.map((/** @type {PlanStep} */ x, /** @type {number} */ j) => (j === i ? { ...x, ...patch } : x)),
    }, redraw, focus);
    const move = (/** @type {number} */ d) => {
      const st = [...p.steps];
      [st[i + d], st[i]] = [st[i], st[i + d]];
      // Stay on the same button as the step moves; at the end of the list, on the other one.
      const edge = i + d === 0 || i + d === st.length - 1;
      change({ steps: st }, true, `#step-${d < 0 ? (edge ? 'down' : 'up') : (edge ? 'up' : 'down')}-${s.id}`);
    };
    const tool = s.toolId ? toolMap.get(s.toolId) : null;
    const own = tool ? templates.filter((t) => t.toolId === tool.id) : [];
    const tpl = own.find((t) => t.id === s.templateId) || own.find((t) => t.id === tool?.defaultTemplateId) || own[0] || null;
    const recipeSlot = h('div');
    if (tool && tpl) {
      recipesForTool(tool.id).then((all) => {
        const pick = recipeButton({
          title: `${tool.shortName || tool.name} recipes`, recipes: recipesFor(all, tpl, own), template: tpl,
          // The title as typed now: the card may not have redrawn since.
          useLabel: 'Use this recipe name',
          onUse: (r) => update({ recipe: r.name, title: p.steps[i]?.title || r.name }, true, `#step-title-${s.id}`),
        });
        if (pick) fill(recipeSlot, pick);
      });
    }
    const withId = (/** @type {HTMLElement} */ el, /** @type {string} */ elId) => { el.id = elId; return el; };
    return h('div', { class: 'card stack plan-step', id: `step-${s.id}` },
      h('div', { class: 'spread' }, h('strong', null, `Step ${i + 1}`), h('div', { class: 'row-wrap' },
        withId(button('', { icon: 'up', ariaLabel: `Move step ${i + 1} up`, disabled: i === 0, onClick: () => move(-1) }), `step-up-${s.id}`),
        withId(button('', { icon: 'down', ariaLabel: `Move step ${i + 1} down`, disabled: i === p.steps.length - 1, onClick: () => move(1) }), `step-down-${s.id}`),
        usedSteps.has(s.id) ? null : button('', {
          kind: 'ghost', icon: 'trash', ariaLabel: `Remove step ${i + 1}`,
          onClick: () => {
            const near = p.steps[i + 1] || p.steps[i - 1];
            change({ steps: p.steps.filter((/** @type {PlanStep} */ _, /** @type {number} */ j) => j !== i) }, true,
              near ? `#step-title-${near.id}` : '#add-step');
          },
        }))),
      textField('What happens', s.title, (v) => update({ title: v }), { help: HELP.planStepTitle, placeholder: 'e.g. Etch the oxide', id: `step-title-${s.id}` }),
      h('div', { class: 'field' }, labelRow(h('span', { class: 'label' }, 'Tool'), 'Tool', HELP.planStepTool),
        h('div', { class: 'row-wrap' },
          withId(button(tool ? tool.name : 'Choose a tool (optional)', { icon: 'wrench', onClick: () => chooseTool(i) }), `step-tool-${s.id}`),
          tool ? button('No tool', { kind: 'ghost', onClick: () => update({ toolId: null, templateId: null }, true, `#step-tool-${s.id}`) }) : null)),
      own.length > 1 ? segmented({
        // The template Save stores: the step's own, or the tool's default when the step's was deleted.
        label: 'Template', compact: true, help: HELP.planStepTemplate, value: tpl ? tpl.id : null, options: own.map((t) => ({ value: t.id, label: t.name })),
        onChange: (v) => update({ templateId: v }, true),
      }) : null,
      textField('Recipe', s.recipe, (v) => update({ recipe: v }), { help: HELP.planStepRecipe }), recipeSlot,
      textField('Step notes', s.notes, (v) => update({ notes: v }), { help: HELP.planStepNotes, placeholder: 'e.g. aim for 500 nm, check the mask first' }));
  };

  const chooseProjectFolder = () => chooseFolder({
    title: 'Folder for this project', folders: [...tree.byId.values()], current: p.folderId && tree.byId.has(p.folderId) ? p.folderId : null,
    onPick: async (folderId) => {
      tree = folderTree(await listFolders());
      change({ folderId }, true, '#project-folder');
    },
  });

  /**
   * A selector that finds the focused control again after a redraw: its id, or the checked option of
   * a step's Template choice.
   * @param {Element | null} el
   * @returns {string | null}
   */
  const focusKey = (el) => {
    if (!el || !body.contains(el)) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const card = el.closest('.plan-step');
    return card && el.getAttribute('role') === 'radio' ? `#${CSS.escape(card.id)} [role="radio"][aria-checked="true"]` : null;
  };
  let addCount = 1;
  const draw = (/** @type {string | null} */ focus = null) => {
    const refocus = focus || focusKey(document.activeElement);
    const startInput = /** @type {HTMLInputElement} */ (h('input', { id: 'project-start', class: 'input', type: 'date', value: localDateKey(p.startedAt) }));
    startInput.addEventListener('change', () => { const iso = fromLocalInput(startInput.value); if (iso) change({ startedAt: iso }); });
    const others = projects.filter((x) => x.id !== id && x.steps.length);
    fill(body,
      section('Project',
        textField('Name', p.name, (v) => change({ name: v }), { help: HELP.projectName, placeholder: 'e.g. Resonators, batch 3' }),
        h('div', { class: 'field' }, labelRow(h('span', { class: 'label' }, 'Folder'), 'Folder', HELP.projectFolder),
          h('div', { class: 'row-wrap' }, Object.assign(button(pathText(tree, p.folderId) || 'None (top level)', { icon: 'folder', onClick: chooseProjectFolder }), { id: 'project-folder' }))),
        textField('Goal', p.goal, (v) => change({ goal: v }), { help: HELP.projectGoal, multiline: true }),
        h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: 'project-start' }, 'Started'), 'Started', HELP.projectStarted), startInput),
        materialPicker({
          label: 'Substrate', value: p.substrate, options: settings.materials, show: 4, help: HELP.projectSubstrate, collapse: true,
          onChange: (v) => change({ substrate: v }),
        }),
        isNew ? null : segmented({
          label: 'Status', value: p.status, help: HELP.projectStatus,
          options: PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] })),
          onChange: (v) => change({ status: v || 'active', endedAt: v === 'done' ? p.endedAt || new Date().toISOString() : null }),
        })),
      section(`Wafers (${p.wafers.length})`,
        h('p', { class: 'muted small' }, 'Each wafer gets its own path through the process; a run says which wafers it processed. No wafers: runs join the project as a whole.'),
        p.wafers.length ? h('div', { class: 'stack' }, p.wafers.map(waferRow)) : null,
        h('div', { class: 'add-wafers' },
          h('label', { class: 'visually-hidden', for: 'add-wafer-count' }, 'Number of wafers to add'),
          numberStepper({
            id: 'add-wafer-count', label: 'wafers to add', value: addCount, step: 1, min: 1, max: 50, onChange: (v) => { addCount = v || 1; },
          }).el,
          Object.assign(button('Add wafers', {
            icon: 'plus',
            onClick: () => {
              const added = newWafers(p.wafers, addCount);
              change({ wafers: [...p.wafers, ...added] }, true, added.length ? `#wafer-${added[0].id}` : null);
            },
          }), { id: 'add-wafers' }))),
      section(`Plan (${p.steps.length} step${p.steps.length === 1 ? '' : 's'})`,
        h('p', { class: 'muted small' }, 'Optional. List the steps in order; a complete run linked to a step marks it done.'),
        p.steps.map(stepCard),
        h('div', { class: 'row-wrap' },
          Object.assign(button('Add step', {
            icon: 'plus',
            onClick: () => {
              const step = newStep();
              change({ steps: [...p.steps, step] }, true, `#step-title-${step.id}`);
            },
          }), { id: 'add-step' }),
          !p.steps.length && others.length ? (() => {
            const selId = uid('copy');
            const sel = /** @type {HTMLSelectElement} */ (h('select', { id: selId, class: 'input' }, h('option', { value: '' }, 'Copy the plan of…'),
              others.map((x) => h('option', { value: x.id }, `${x.name} (${x.steps.length} steps)`))));
            sel.addEventListener('change', () => {
              const from = others.find((x) => x.id === sel.value);
              if (!from) return;
              const steps = copyPlan(from);
              change({ steps }, true, steps.length ? `#step-title-${steps[0].id}` : '#add-step');
            });
            return h('div', { class: 'field' }, h('label', { class: 'visually-hidden', for: selId }, 'Copy the plan of another project'), sel);
          })() : null)),
      section('Notes', textField('Project notes', p.notes, (v) => change({ notes: v }), { multiline: true, help: HELP.projectNotes })));
    const target = refocus ? /** @type {HTMLElement | null} */ (body.querySelector(refocus)) : null;
    if (target && !(/** @type {HTMLButtonElement} */ (target)).disabled) target.focus();
  };

  append(ctx.root, [
    source && !restored ? h('p', { class: 'muted' }, `A copy of “${source.name}”: the same plan and wafer labels, with nothing done yet. Its runs stay with the original.`) : null,
    restored ? h('div', null, chip(stale ? 'Restored unsaved changes (the project changed since)' : 'Restored unsaved changes', {
      actionLabel: 'Discard', onClick: async () => { autosave.cancel(); await clearDraft(draftKey); refresh(); },
    })) : null,
    body,
  ]);
  draw();

  const save = async () => {
    const name = String(p.name || '').trim();
    if (!name) { toast('Give the project a name.', { kind: 'error' }); return; }
    const labels = p.wafers.map((/** @type {Wafer} */ w) => String(w.label || '').trim());
    if (labels.some((/** @type {string} */ l) => !l)) { toast('Every wafer needs a label.', { kind: 'error' }); return; }
    if (new Set(labels.map((/** @type {string} */ l) => l.toLowerCase())).size !== labels.length) { toast('Two wafers have the same label.', { kind: 'error' }); return; }
    const titled = p.steps.map((/** @type {PlanStep} */ s) => ({
      ...s, title: String(s.title || '').trim() || (s.toolId ? toolMap.get(s.toolId)?.name || '' : ''),
      templateId: s.toolId ? liveTemplate(s.toolId, s.templateId) : null,
    }));
    // A step without a title is dropped only when it is empty: one with content, or one runs use, needs a title.
    if (titled.some((/** @type {PlanStep} */ s) => !s.title && (usedSteps.has(s.id) || s.toolId || String(s.recipe || '').trim() || String(s.notes || '').trim()))) {
      toast('Give every step a title: say what happens in it.', { kind: 'error' });
      return;
    }
    // Build on the project as stored now, so what the form does not edit stays: the marks on each step
    // (done, skipped) and the record's own fields. Ask before saving over changes made meanwhile.
    const cur = existing ? await getProject(id) : null;
    if (existing && !cur) { toast('This project was deleted meanwhile, so these edits cannot be saved.', { kind: 'error' }); return; }
    if (cur && cur.updatedAt !== p.updatedAt && !await confirmDialog({
      title: 'Save over newer changes?', confirmLabel: 'Save anyway',
      message: 'This project changed since you started editing it, on this device or another. Save your version anyway? Steps marked done or skipped keep their marks.',
    })) return;
    const marks = new Map((cur ? cur.steps : []).map((s) => [s.id, s]));
    const steps = titled.filter((/** @type {PlanStep} */ s) => s.title).map((/** @type {PlanStep} */ s) => {
      const m = marks.get(s.id);
      return m ? { ...s, doneAt: m.doneAt ?? null, skipped: !!m.skipped } : s;
    });
    try {
      const saved = await saveProject({
        ...(cur || p), name, goal: String(p.goal || '').trim(), notes: String(p.notes || '').trim(), steps,
        startedAt: p.startedAt, substrate: p.substrate || '', status: p.status, endedAt: p.endedAt ?? null, folderId: p.folderId ?? null,
        wafers: p.wafers.map((/** @type {Wafer} */ w, /** @type {number} */ i) => ({ ...w, label: labels[i], notes: String(w.notes || '').trim() })),
      });
      autosave.cancel();
      await clearDraft(draftKey);
      toast(source ? 'Copy created.' : isNew ? 'Project created.' : 'Project saved.');
      navigate(`/project/${saved.id}`, { replace: true });
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
  };
  ctx.setActions([
    button('Cancel', {
      onClick: async () => {
        if (dirty && !await confirmDialog({ title: 'Discard changes?', message: 'Your unsaved edits to this project will be lost.', confirmLabel: 'Discard', danger: true })) return;
        autosave.cancel();
        await clearDraft(draftKey);
        const folder = inFolder && tree.byId.has(inFolder) ? `/folder/${encodeURIComponent(inFolder)}` : '/projects';
        navigate(source ? `/project/${source.id}` : isNew ? folder : `/project/${id}`, { replace: true });
      },
    }),
    button('Save', { kind: 'primary', icon: 'check', onClick: save }),
  ]);
  return () => autosave.flush();
}
