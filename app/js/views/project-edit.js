// @ts-check
/**
 * New or edit project: name, folder, goal, start date and substrate, its
 * status (a failed one says what went wrong), the wafers and masks (added
 * in one go with their type, renamed, finished or scrapped one by one) and
 * an optional plan of steps, each with a tool and
 * a recipe, which wafers it is for, the stacks it bonds and what it adds or
 * removes. Each step shows the plan's compatibility notes, kept up to date
 * as the plan changes. "?copy=<id>" starts from a copy of another project,
 * "?folder=<id>" in a folder. Autosaves as a draft until saved.
 */
import { h, append, fill, uid, debounce } from '../ui/dom.js';
import {
  button, section, segmented, emptyState, toast, chip, confirmDialog, errorText, labelRow, sheet,
} from '../ui/components.js';
import { textInput } from '../ui/fields.js';
import { materialPicker, toolTiles, mineOf } from '../ui/pickers.js';
import { recipeButton } from '../ui/recipes.js';
import { chooseFolder } from '../ui/folder-picker.js';
import { createAutosave } from '../ui/autosave.js';
import { openAddWafers, openWaferType, typeButton } from '../ui/wafer-types.js';
import { stepExtras } from '../ui/plan-step-extras.js';
import { noteLine, notesSummary, toggleChecked } from '../ui/compat-notes.js';
import { chooseMaterialKind, askButtons } from '../ui/material-kind.js';
import { navigate, refresh } from '../router.js';
import {
  getProject, saveProject, listProjects, listRuns, listTools, listTemplates, getDraft, saveDraft, clearDraft, getSettings,
  lastUsedByTool, listFolders, listSavedWafers, saveSavedWafer, saveSettings,
} from '../data/repo.js';
import { recipesForTool, allRecipes } from '../data/recipes.js';
import { planChecksWith, recipeAdds } from '../data/plan-checks.js';
import { lnfType, LNF_COMPAT } from '../data/compat-lnf.js';
import {
  newWafers, newStep, copyPlanInto, projectRuns, linkFor, duplicateProject, stepStates, projectStatus, statusPatch,
} from '../core/projects.js';
import { isMask, labelPrefix, specShort, specEmpty } from '../core/wafer-spec.js';
import { normText } from '../core/vocab.js';
import { folderTree, pathText } from '../core/folders.js';
import { recipesFor } from '../core/recipes.js';
import { PROJECT_SHOWN_STATUSES, PROJECT_STATUS_LABELS, WAFER_STATUSES, WAFER_STATUS_LABELS } from '../core/vocab.js';
import { localDateKey, fromLocalInput } from '../core/time.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').PlanStep} PlanStep */
/** @typedef {import('../core/types.js').Wafer} Wafer */
/** @typedef {import('../ui/wafer-types.js').TypeChoice} TypeChoice */

/** The type last added in this session, offered first next time. @type {TypeChoice | null} */
let lastType = null;
/** PFC Bench 01, the RCA pre-furnace clean the CMOS-clean tubes need right before. */
const PFC_ID = 'ff0c929c-9d8d-4cce-b327-dc92429353fa';

/** @param {unknown} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * A three-way merge of two sets that started equal: what either side added
 * is in, what either side took out is out.
 * @param {string[]} base
 * @param {string[]} mine
 * @param {string[]} theirs
 * @returns {string[]}
 */
function merge3(base, mine, theirs) {
  const b = new Set(base);
  const m = new Set(mine);
  const t = new Set(theirs);
  const out = new Set(base.filter((k) => m.has(k) && t.has(k)));
  for (const k of [...mine, ...theirs]) if (!b.has(k)) out.add(k);
  return [...out];
}

/**
 * A step as saved: wafer choices and bonds that name removed wafers are
 * dropped (a stack needs two), and empty extras are left out.
 * @param {PlanStep} s
 * @param {ReadonlySet<string>} ids the project's wafer ids
 * @returns {PlanStep}
 */
function tidyStep(s, ids) {
  /** @type {Record<string, any>} */
  const out = { ...s };
  const named = list(s.waferIds).filter((id) => ids.has(id));
  if (named.length) out.waferIds = named; else delete out.waferIds;
  const bonds = list(s.bonds).map((b) => ({ ...b, waferIds: list(b.waferIds).filter((id) => ids.has(id)) })).filter((b) => b.waferIds.length >= 2);
  if (bonds.length) out.bonds = bonds; else delete out.bonds;
  for (const k of ['adds', 'removes', 'checked', 'attachments']) if (!list(out[k]).length) delete out[k];
  if (!out.debond) delete out.debond;
  if (!out.gds) delete out.gds;
  return /** @type {PlanStep} */ (out);
}

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
  const [draft, projects, runs, tools, templates, settings, folders, savedTypes, recipes, allTools] = await Promise.all([
    getDraft(draftKey), listProjects(), listRuns(), listTools(), listTemplates(), getSettings(), listFolders(), listSavedWafers(),
    allRecipes().catch(() => /** @type {import('../core/recipes.js').WikiRecipe[]} */ ([])), listTools({ includeArchived: true }),
  ]);
  if (!ctx.isCurrent()) return;
  let tree = folderTree(folders);
  const inFolder = ctx.query.get('folder');
  // The project page (a pause, a finish, a failure, a move) or another device may have changed the project since
  // these unsaved edits were made. They are restored, but status (and whether it failed), end and folder come from
  // the stored project unless the person changed them in this form (`_base` holds what the form started from).
  // Step marks are merged on Save, which also asks before saving over the newer version.
  const stale = !!(draft && existing && draft.updatedAt !== existing.updatedAt);
  /** @type {Record<string, any> | null} */
  let restored = draft;
  if (stale && draft && existing) {
    const base = draft._base || { status: draft.status, endedAt: draft.endedAt ?? null, folderId: draft.folderId ?? null, failed: draft.failed ?? null };
    /** @param {'status' | 'endedAt' | 'folderId' | 'failed'} k */
    const pick = (k) => ((draft[k] ?? null) === (base[k] ?? null) ? existing[k] ?? null : draft[k]);
    restored = { ...draft, status: pick('status'), endedAt: pick('endedAt'), folderId: pick('folderId'), failed: pick('failed') };
  }
  /** @type {Record<string, any>} */
  let p = restored || (existing ? {
    ...structuredClone(existing),
    // What the form started from: for the stale-draft merge, and the marks of checked notes for Save's three-way merge.
    _base: {
      status: existing.status, endedAt: existing.endedAt ?? null, folderId: existing.folderId ?? null, failed: existing.failed ?? null,
      checked: Object.fromEntries(existing.steps.map((s) => [s.id, list(s.checked)])),
    },
  } : source ? duplicateProject(source, { taken: projects.map((x) => x.name) }) : {
    name: '', goal: '', status: 'active', startedAt: new Date().toISOString(), endedAt: null, substrate: '', notes: '',
    wafers: newWafers([], 1), steps: [], folderId: inFolder && tree.byId.has(inFolder) ? inFolder : null,
  });
  const autosave = createAutosave(() => saveDraft(draftKey, p));
  let dirty = !!restored;
  /** Compatibility notes for the plan as it stands (archived tools too, as on the project page); painted into each step's slot. */
  let checks = { notes: /** @type {import('../core/compat.js').Note[]} */ ([]), byStep: new Map() };
  /** What the person said materials are; a note's "What is it?" updates it. */
  let kinds = settings.materialKinds || {};
  const computeChecks = () => { checks = planChecksWith(/** @type {any} */ (p), allTools, templates, recipes, kinds); };
  const recheck = debounce(() => { computeChecks(); paintChecks(); }, 250);
  /**
   * @param {Record<string, any>} patch
   * @param {boolean} [redraw]
   * @param {string | null} [focus] what to focus after the redraw (default: the control that had focus)
   */
  const change = (patch, redraw = false, focus = null) => {
    p = { ...p, ...patch };
    dirty = true;
    autosave.schedule();
    // A redraw paints the notes at once, so no button of an old note (add the PFC clean) is left to tap twice.
    if (redraw) {
      computeChecks();
      draw(focus);
    } else {
      recheck();
    }
  };
  // Wafers and steps that runs name cannot be removed: finish or scrap a wafer, skip a step.
  const linked = existing ? projectRuns(runs, existing.id).map((r) => linkFor(r, existing.id)) : [];
  const usedWafers = new Set(linked.flatMap((l) => (l ? l.waferIds : [])));
  const usedSteps = new Set(linked.map((l) => (l ? l.stepId : null)).filter(Boolean));
  const toolMap = new Map(tools.map((t) => [t.id, t]));
  const tplMap = new Map(templates.map((t) => [t.id, t]));
  const lastUsed = lastUsedByTool(runs);
  /** Open folds and wafers tapped for a stack, by step id, kept across redraws. */
  const openExtras = new Set();
  /** @type {Map<string, string[]>} */
  const picking = new Map();
  const addMaterial = async (/** @type {string} */ name) => {
    const s = await getSettings();
    if (!s.materials.some((m) => normText(m) === normText(name))) await saveSettings({ materials: [...s.materials, name] });
  };
  /** Plan steps name this wafer: as one of the step's wafers or in a stack. */
  const namedBySteps = (/** @type {string} */ wid) => p.steps.some((/** @type {PlanStep} */ s) => list(s.waferIds).includes(wid)
    || list(s.bonds).some((b) => list(b.waferIds).includes(wid)));
  /** The project still has only the W1 every new project starts with, untouched. */
  // Only a project not stored yet: a stored one's W1 may be named by runs on another device or in a draft.
  const untouchedDefault = () => !existing && p.wafers.length === 1 && !usedWafers.has(p.wafers[0].id) && !namedBySteps(p.wafers[0].id)
    && !p.wafers[0].spec && !String(p.wafers[0].notes || '').trim()
    && p.wafers[0].status === 'active' && /^w1$/i.test(String(p.wafers[0].label).trim());
  const setTypes = (/** @type {string[]} */ ids, /** @type {any} */ spec, /** @type {string | null} */ specId) => {
    const pick = new Set(ids);
    change({
      wafers: p.wafers.map((/** @type {Wafer} */ w) => {
        if (!pick.has(w.id)) return w;
        const { spec: _s, specId: _i, ...rest } = w;
        return spec ? { ...rest, spec: structuredClone(spec), ...(specId ? { specId } : {}) } : rest;
      }),
    }, true, `#wtype-${ids[0]}`);
  };
  const chooseType = (/** @type {Wafer} */ w) => openWaferType({
    wafer: w, saved: savedTypes, materials: settings.materials, onAddMaterial: addMaterial,
    others: p.wafers.filter((/** @type {Wafer} */ x) => x.id !== w.id && specEmpty(x.spec) && isMask(x) === isMask(w)),
    onApply: setTypes,
    onSaveType: async (spec) => {
      try {
        const saved = await saveSavedWafer({ name: specShort(spec) || `${w.label} type`, spec });
        savedTypes.push(saved);
        toast(`Saved as the wafer type “${saved.name}”.`);
      } catch (err) {
        toast(errorText(err), { kind: 'error' });
      }
    },
  });
  const addWafers = () => openAddWafers({
    saved: savedTypes, lastType,
    onAdd: (count, kind, type) => {
      lastType = type;
      /** @type {import('../core/types.js').WaferSpec | undefined} */
      const spec = type.spec ? { ...type.spec, ...(kind === 'mask' ? { kind: /** @type {'mask'} */ ('mask') } : {}) } : kind === 'mask' ? { kind: 'mask' } : undefined;
      // A new project's untouched W1 gives way, so four typed wafers are W1–W4.
      const base = kind === 'wafer' && untouchedDefault() ? [] : p.wafers;
      const added = newWafers(base, count, labelPrefix(kind), { spec, specId: type.specId });
      change({ wafers: [...base, ...added] }, true, added.length ? `#wafer-${added[0].id}` : '#add-wafers');
    },
  });
  /** Paint the notes into each step's slot and the plan's summary, without redrawing the form. */
  const paintChecks = () => {
    // A note's button may have focus (a repaint after typing can come just as it is reached): keep it there.
    const active = document.activeElement;
    const had = active && body.contains(active) && active.closest('.compat-notes') ? focusKey(active) : null;
    for (const s of /** @type {PlanStep[]} */ (p.steps)) {
      const slot = body.querySelector(`#checks-${CSS.escape(s.id)}`);
      if (!slot) continue;
      const notes = checks.byStep.get(s.id) || [];
      const checked = new Set(list(s.checked));
      const i = p.steps.findIndex((/** @type {PlanStep} */ x) => x.id === s.id);
      fill(/** @type {HTMLElement} */ (slot), notes.map((n, k) => noteLine(n, {
        checked: checked.has(n.key), checkId: `check-${s.id}-${k}`,
        onCheck: (on) => change({ steps: p.steps.map((/** @type {PlanStep} */ x) => (x.id === s.id ? { ...x, checked: toggleChecked(x, n.key, on) } : x)) },
          true, `#check-${CSS.escape(s.id)}-${k}`),
        // A material the app does not know: say what it is, and every note on it updates.
        action: n.materials && !checked.has(n.key) ? askButtons(n.materials, (name, j) => chooseMaterialKind({
          name,
          onSaved: async () => {
            // The editor may have closed meanwhile (an Undo tapped on another screen): show that screen afresh.
            if (!ctx.isCurrent()) { refresh(); return; }
            const fresh = await getSettings();
            kinds = fresh.materialKinds || {};
            settings.materials = fresh.materials;
            computeChecks();
            draw();
            // Focus stays with the step's notes: the same button if it is still there, else the step's first note
            // button, else the step's title.
            const id = CSS.escape(s.id);
            const target = /** @type {HTMLElement | undefined} */ ([`#kind-${id}-${k}-${j}`, `#checks-${id} button`, `#step-title-${id}`]
              .map((sel) => body.querySelector(sel)).find(Boolean));
            target?.focus();
            // Clear of the action bar at the bottom.
            target?.scrollIntoView({ block: 'center' });
          },
        }), `kind-${s.id}-${k}`)
          : n.code === 'preclean' && toolMap.has(PFC_ID) && !checked.has(n.key) ? Object.assign(button('Add the PFC Bench 01 clean before this step', {
          icon: 'plus',
          onClick: () => {
            // The clean is for the same wafers as the furnace step.
            const clean = { ...newStep({ title: 'RCA pre-furnace clean', toolId: PFC_ID, templateId: liveTemplate(PFC_ID, null) }),
              ...(list(s.waferIds).length ? { waferIds: [...list(s.waferIds)] } : {}) };
            change({ steps: [...p.steps.slice(0, i), clean, ...p.steps.slice(i)] }, true, `#step-title-${clean.id}`);
          },
        }), { id: `pfc-${s.id}` }) : null,
      })));
    }
    // Steps done (by hand or by a complete linked run) do not count, as on the project page.
    const done = new Set(stepStates(/** @type {any} */ (p), runs).filter((x) => x.state === 'done').map((x) => x.step.id));
    const summary = body.querySelector('#plan-checks');
    // Notes on done or skipped steps, or marked as checked, still show on their steps but leave nothing to act on.
    if (summary) {
      summary.textContent = notesSummary(checks.byStep, p.steps, (s) => !done.has(s.id))
        || (checks.notes.length ? 'No notes left for the steps still to do.'
          : p.steps.some((/** @type {PlanStep} */ s) => s.toolId) ? 'No notes for the plan as it stands. The checks cover only what the app knows.' : '');
    }
    const gap = body.querySelector('#plan-checks-gap');
    if (gap) {
      const ruled = p.steps.some((/** @type {PlanStep} */ s) => s.toolId && LNF_COMPAT[s.toolId]);
      const untyped = p.wafers.some((/** @type {Wafer} */ w) => w.status === 'active' && !isMask(w) && (!w.spec?.size || !(w.spec?.material || p.substrate)));
      gap.textContent = ruled && untyped ? 'Checks need each wafer’s size and material: set the type under Wafers and masks.' : '';
    }
    if (had) /** @type {HTMLElement | null} */ (body.querySelector(had))?.focus();
  };
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
    const typeBtn = typeButton(w, () => chooseType(w), `${w.label || `Wafer ${i + 1}`} type: ${specShort(w.spec) || 'not set'}`);
    typeBtn.id = `wtype-${w.id}`;
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
        // A wafer that runs or plan steps name stays: finish or scrap it, or take it off the steps first.
        usedWafers.has(w.id) || namedBySteps(w.id) ? null : button('', {
          kind: 'ghost', icon: 'trash', ariaLabel: `Remove ${w.label || `wafer ${i + 1}`}`,
          onClick: () => {
            const near = p.wafers[i + 1] || p.wafers[i - 1];
            change({ wafers: p.wafers.filter((/** @type {Wafer} */ _, /** @type {number} */ j) => j !== i) }, true,
              near ? `#wafer-${near.id}` : '#add-wafers');
          },
        })),
      h('div', { class: 'wafer-type' }, typeBtn),
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
    // A tool with LNF mounting recipes (the Sample mounting station) mounts samples on carriers: a temporary bond.
    const mounts = !!tool && recipes.some((r) => r.tool === tool.id && /\bmounting\b/i.test(r.name));
    const bonder = !!tool && (mounts || lnfType(tool.id) === 'wafer-bonder'
      || own.some((t) => t.fields.some((f) => f.key === 'method' && list(f.options).includes('Anodic'))));
    const extras = stepExtras({
      project: /** @type {any} */ (p), step: s, current: () => p.steps.find((/** @type {PlanStep} */ x) => x.id === s.id) || s,
      index: i, bonder, defaultMethod: mounts ? 'temporary' : '', fromRecipe: recipeAdds(s, toolMap, tplMap, recipes, kinds),
      open: openExtras.has(s.id), onToggle: (v) => { if (v) openExtras.add(s.id); else openExtras.delete(s.id); },
      update: (patch, redraw = false, focus = null) => { openExtras.add(s.id); update(patch, redraw, focus); },
      picking: picking.get(s.id) || [],
      setPicking: (ids) => { picking.set(s.id, ids); openExtras.add(s.id); draw(); },
    });
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
      textField('Step notes', s.notes, (v) => update({ notes: v }), { help: HELP.planStepNotes, placeholder: 'e.g. aim for 500 nm, check the mask first' }),
      extras,
      h('div', { class: 'compat-notes', id: `checks-${s.id}`, 'aria-live': 'polite' }));
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
  const draw = (/** @type {string | null} */ focus = null) => {
    const refocus = focus || focusKey(document.activeElement);
    const startInput = /** @type {HTMLInputElement} */ (h('input', { id: 'project-start', class: 'input', type: 'date', value: localDateKey(p.startedAt) }));
    startInput.addEventListener('change', () => { const iso = fromLocalInput(startInput.value); if (iso) change({ startedAt: iso }); });
    const others = projects.filter((x) => x.id !== id && x.steps.length);
    // What went wrong: shown while the status is Failed, kept (hidden) otherwise.
    const reason = textField('What went wrong', p.failReason || '', (v) => change({ failReason: v }), {
      multiline: true, help: HELP.projectFailReason, id: 'project-fail-reason', placeholder: 'e.g. the resist lifted off in develop',
    });
    reason.hidden = projectStatus(/** @type {any} */ (p)) !== 'failed';
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
          label: 'Status', value: projectStatus(/** @type {any} */ (p)), help: HELP.projectStatus,
          options: PROJECT_SHOWN_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] })),
          onChange: (v) => {
            change(statusPatch(/** @type {any} */ (p), v || 'active'));
            reason.hidden = v !== 'failed';
          },
        }),
        isNew ? null : reason),
      section(`Wafers and masks (${p.wafers.length})`,
        h('p', { class: 'muted small' }, 'Each wafer gets its own path through the process; a run says which wafers it processed. No wafers: runs join the project as a whole. Give them a type to have the plan checked.'),
        p.wafers.length ? h('div', { class: 'stack' }, p.wafers.map(waferRow)) : null,
        h('div', { class: 'add-wafers' },
          Object.assign(button('Add wafers', { icon: 'plus', onClick: addWafers }), { id: 'add-wafers' }))),
      section(`Plan (${p.steps.length} step${p.steps.length === 1 ? '' : 's'})`,
        h('p', { class: 'muted small' }, 'Optional. List the steps in order; a complete run linked to a step marks it done.'),
        p.steps.length ? h('div', { class: 'field' }, labelRow(h('span', { class: 'label' }, 'Checks'), 'Checks', HELP.planChecks),
          h('p', { class: 'small', id: 'plan-checks', 'aria-live': 'polite' }), h('p', { class: 'muted small', id: 'plan-checks-gap' })) : null,
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
              const { wafers, steps } = copyPlanInto(from, p.wafers, untouchedDefault());
              change({ wafers, steps }, true, steps.length ? `#step-title-${steps[0].id}` : '#add-step');
            });
            return h('div', { class: 'field' }, h('label', { class: 'visually-hidden', for: selId }, 'Copy the plan of another project'), sel);
          })() : null)),
      section('Notes', textField('Project notes', p.notes, (v) => change({ notes: v }), { multiline: true, help: HELP.projectNotes })));
    paintChecks();
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
  computeChecks();
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
    const hasContent = (/** @type {PlanStep} */ s) => usedSteps.has(s.id) || s.toolId || String(s.recipe || '').trim() || String(s.notes || '').trim()
      || list(s.waferIds).length || list(s.bonds).length || s.debond || list(s.adds).length || list(s.removes).length;
    if (titled.some((/** @type {PlanStep} */ s) => !s.title && hasContent(s))) {
      toast('Give every step a title: say what happens in it.', { kind: 'error' });
      return;
    }
    // Build on the project as stored now, so what the form does not edit stays: the marks on each step
    // (done, skipped), its pictures, files and GDS layout, and the record's own fields. Ask before saving
    // over changes made meanwhile.
    const cur = existing ? await getProject(id) : null;
    if (existing && !cur) { toast('This project was deleted meanwhile, so these edits cannot be saved.', { kind: 'error' }); return; }
    if (cur && cur.updatedAt !== p.updatedAt && !await confirmDialog({
      title: 'Save over newer changes?', confirmLabel: 'Save anyway',
      message: 'This project changed since you started editing it, on this device or another. Save your version anyway? Steps marked done or skipped keep their marks.',
    })) return;
    const marks = new Map((cur ? cur.steps : []).map((s) => [s.id, s]));
    const concurrent = !!cur && cur.updatedAt !== p.updatedAt;
    const ids = new Set(p.wafers.map((/** @type {Wafer} */ w) => w.id));
    const steps = titled.filter((/** @type {PlanStep} */ s) => s.title).map((/** @type {PlanStep} */ s) => {
      const m = marks.get(s.id);
      // Checked notes: when the project changed meanwhile, a three-way merge with what the form started from,
      // so a mark added or taken off on either side wins (without that start, both sides' marks).
      const base = p._base && p._base.checked ? p._base.checked[s.id] : null;
      const checked = concurrent && m ? (base ? merge3(list(base), list(s.checked), list(m.checked)) : [...new Set([...list(m.checked), ...list(s.checked)])])
        : list(s.checked);
      return tidyStep(m ? { ...s, doneAt: m.doneAt ?? null, skipped: !!m.skipped, checked, attachments: m.attachments, gds: m.gds } : s, ids);
    });
    try {
      const saved = await saveProject({
        ...(cur || p), name, goal: String(p.goal || '').trim(), notes: String(p.notes || '').trim(), steps,
        startedAt: p.startedAt, substrate: p.substrate || '', status: p.status, endedAt: p.endedAt ?? null, folderId: p.folderId ?? null,
        failed: p.status === 'done' && p.failed === true, failReason: String(p.failReason || '').trim(),
        wafers: p.wafers.map((/** @type {Wafer} */ w, /** @type {number} */ i) => ({
          ...w, label: labels[i], notes: String(w.notes || '').trim(),
        })),
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
