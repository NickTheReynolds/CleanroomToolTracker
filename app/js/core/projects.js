// @ts-check
/**
 * Projects follow wafers through a process, from the first clean to the last
 * measurement. A run joins a project through run.projects, a list of links
 * {projectId, waferIds, stepId}: one run can carry wafers of several
 * projects (a furnace load, a wet bench). These helpers are pure: plan
 * progress, the next step, a project's runs in process order (its traveler)
 * and short labels. No DOM and no storage.
 */
import { toMs } from './time.js';
import { uuid } from './ids.js';
import { isMask } from './wafer-spec.js';

/** @typedef {import('./types.js').Run} Run */
/** @typedef {import('./types.js').Project} Project */
/** @typedef {import('./types.js').ProjectLink} ProjectLink */
/** @typedef {import('./types.js').PlanStep} PlanStep */
/** @typedef {import('./types.js').Wafer} Wafer */

/**
 * @typedef {Object} StepState
 * @property {PlanStep} step
 * @property {number} index position in the plan, from 0
 * @property {'done' | 'active' | 'todo' | 'skipped'} state done: a complete run did it, or it was marked done;
 *   active: a draft or open run is doing it
 * @property {Run[]} runs live runs linked to the step, oldest first
 * @property {string | null} doneAt when it was done: the latest complete run's start, or the manual mark
 */

/** @param {unknown} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : []);

/** @param {Run} a @param {Run} b oldest first, then by id */
const processOrder = (a, b) => (toMs(a.startedAt) - toMs(b.startedAt)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A run's well-formed project links.
 * @param {Partial<Run> | null | undefined} run
 * @returns {ProjectLink[]}
 */
export function runLinks(run) {
  return list(run && run.projects).filter((l) => l && typeof l.projectId === 'string' && l.projectId);
}

/**
 * @param {Partial<Run> | null | undefined} run
 * @param {string} projectId
 * @returns {ProjectLink | null} the run's link to that project
 */
export function linkFor(run, projectId) {
  return runLinks(run).find((l) => l.projectId === projectId) || null;
}

/**
 * A project's live runs in process order (oldest first): its traveler.
 * @param {readonly Run[]} runs
 * @param {string} projectId
 * @param {string | null} [waferId] only the runs that processed this wafer
 * @returns {Run[]}
 */
export function projectRuns(runs, projectId, waferId = null) {
  return runs.filter((r) => {
    if (!r || r.deleted) return false;
    const l = linkFor(r, projectId);
    return !!l && (!waferId || list(l.waferIds).includes(waferId));
  }).sort(processOrder);
}

/**
 * The state of every planned step, from the runs linked to it and the
 * manual marks (doneAt, skipped) on the plan.
 * @param {Project} project
 * @param {readonly Run[]} runs every run (or the project's)
 * @returns {StepState[]}
 */
export function stepStates(project, runs) {
  const mine = projectRuns(runs, project.id);
  return list(project.steps).map((step, index) => {
    const linked = mine.filter((r) => linkFor(r, project.id)?.stepId === step.id);
    const complete = linked.filter((r) => r.status === 'complete');
    /** @type {StepState['state']} */
    let state = 'todo';
    let doneAt = null;
    if (complete.length) {
      state = 'done';
      doneAt = complete[complete.length - 1].startedAt;
    } else if (step.doneAt) {
      state = 'done';
      doneAt = step.doneAt;
    } else if (linked.length) {
      state = 'active';
    } else if (step.skipped) {
      state = 'skipped';
    }
    return { step, index, state, runs: linked, doneAt };
  });
}

/**
 * The step to do next: the first one that is neither done nor skipped (a
 * step in progress counts).
 * @param {StepState[]} states
 * @returns {StepState | null}
 */
export function nextStep(states) {
  return states.find((s) => s.state === 'todo' || s.state === 'active') || null;
}

/**
 * Plan progress: done steps out of the steps not skipped.
 * @param {StepState[]} states
 * @returns {{done: number, total: number}}
 */
export function progress(states) {
  const counted = states.filter((s) => s.state !== 'skipped');
  return { done: counted.filter((s) => s.state === 'done').length, total: counted.length };
}

/**
 * The step a new run on this tool most likely carries out: the first step
 * still to do on that tool, else the next step of the plan.
 * @param {StepState[]} states
 * @param {string} toolId
 * @returns {PlanStep | null}
 */
export function suggestStep(states, toolId) {
  const open = states.filter((s) => s.state === 'todo' || s.state === 'active');
  const onTool = open.find((s) => s.step.toolId === toolId);
  return (onTool || open[0] || null)?.step || null;
}

/**
 * What a project's runs process: its wafers, or its masks when it has only
 * masks (a project that makes masks). Masks in a project with wafers are
 * used by steps that name them, not processed with every run.
 * @param {Project} project
 * @returns {Wafer[]}
 */
export function processItems(project) {
  const all = list(project.wafers);
  const wafers = all.filter((w) => !isMask(w));
  return wafers.length ? wafers : all;
}

/**
 * @param {Project} project
 * @returns {Wafer[]} wafers still in process (masks only in a project of masks)
 */
export function activeWafers(project) {
  return processItems(project).filter((w) => w.status !== 'done' && w.status !== 'scrapped');
}

/**
 * The stacks bonded before a step: for each wafer in one, all the wafers of
 * its stack. Bonds come from the steps before (skipped ones left out); a
 * step that debonds separates the stacks among its wafers.
 * @param {Project} project
 * @param {number} index the step's position in the plan
 * @returns {Map<string, string[]>}
 */
export function stacksBefore(project, index) {
  const known = new Set(list(project.wafers).map((w) => w.id));
  /** @type {Map<string, string[]>} */
  const of = new Map();
  const steps = list(project.steps);
  for (let i = 0; i < Math.min(index, steps.length); i++) {
    const s = steps[i];
    if (!s || s.skipped) continue;
    for (const b of list(s.bonds)) {
      const ids = [...new Set(list(b && b.waferIds).filter((id) => known.has(id)).flatMap((id) => of.get(id) || [id]))];
      if (ids.length < 2) continue;
      for (const id of ids) of.set(id, ids);
    }
    if (s.debond) {
      const named = list(s.waferIds).filter((id) => known.has(id));
      for (const id of named.length ? named : [...of.keys()]) {
        for (const m of of.get(id) || []) of.delete(m);
      }
    }
  }
  return of;
}

/** @param {Wafer | undefined} w @returns {boolean} still in process (not done, not scrapped) */
const inProcess = (w) => !!w && w.status !== 'done' && w.status !== 'scrapped';

/**
 * The wafers a run of this step processes, as far as they are still in
 * process: the ones the step names (none left, no wafers), else every wafer
 * in process; a wafer in a stack brings the whole stack. A step that names
 * only wafers no longer in the project counts as naming none.
 * @param {Project} project
 * @param {PlanStep} step
 * @returns {string[]}
 */
export function stepWaferIds(project, step) {
  const wafers = list(project.wafers);
  const byId = new Map(wafers.map((w) => [w.id, w]));
  const named = list(step.waferIds).filter((id) => byId.has(id));
  const base = named.length ? named.filter((id) => inProcess(byId.get(id))) : activeWafers(project).map((w) => w.id);
  const stacks = stacksBefore(project, list(project.steps).findIndex((s) => s.id === step.id));
  const ids = new Set(base.flatMap((id) => stacks.get(id) || [id]));
  return wafers.filter((w) => ids.has(w.id) && inProcess(w)).map((w) => w.id);
}

/**
 * A run's wafers when its link moves to another step. A new run still on
 * the previous step's wafers (every wafer in process, without a step)
 * takes the new step's; otherwise the wafers stay as chosen, and a wafer
 * bonded before the new step brings its stack. The Log run form and its
 * step menu both use this, so they agree.
 * @param {Project} project
 * @param {{stepId: string | null, waferIds: string[]}} link the link as it is now
 * @param {PlanStep} step the step it moves to
 * @param {boolean} newRun a run being logged (a saved run's wafers never follow the step)
 * @returns {string[]}
 */
export function wafersOnStepChange(project, link, step, newRun) {
  const steps = list(project.steps);
  const prev = steps.find((s) => s.id === link.stepId) || null;
  const prevDefault = prev ? stepWaferIds(project, prev) : activeWafers(project).map((w) => w.id);
  const held = list(link.waferIds);
  const same = held.length === prevDefault.length && held.every((id) => prevDefault.includes(id));
  if (newRun && same) return stepWaferIds(project, step);
  const stacks = stacksBefore(project, steps.findIndex((s) => s.id === step.id));
  const byId = new Map(list(project.wafers).map((w) => [w.id, w]));
  // A partner that is done or scrapped stays out, as it does from a step's own wafers.
  return [...new Set(held.flatMap((id) => (stacks.get(id) || [id]).filter((x) => x === id || inProcess(byId.get(x)))))];
}

/**
 * A new run's recipe when its link moves to another step: the step's recipe
 * while the form's is still the previous step's (an empty one included),
 * otherwise the one the person typed or chose. Log this step and the step
 * menu both use this, so they agree.
 * @param {Project} project
 * @param {string | null} prevStepId the step the link had (null: none)
 * @param {PlanStep} step the step it moves to
 * @param {string} recipe the form's recipe now
 * @returns {string}
 */
export function recipeOnStepChange(project, prevStepId, step, recipe) {
  const prev = list(project.steps).find((s) => s.id === prevStepId) || null;
  return String(recipe || '') === String(prev?.recipe || '') ? String(step.recipe || '') : recipe;
}

/**
 * Wafer labels in a compact form: "W1–W4", "W1, W3", "all 4 wafers".
 * Labels of the form <prefix><number> with consecutive numbers collapse
 * into a range.
 * @param {Project} project
 * @param {readonly string[]} waferIds
 * @returns {string}
 */
export function waferText(project, waferIds) {
  const wafers = list(project.wafers);
  const ids = new Set(waferIds);
  const picked = wafers.filter((w) => ids.has(w.id));
  if (!picked.length) return '';
  if (picked.length > 2 && picked.length === wafers.length) return `all ${picked.length} wafers`;
  /** @type {string[]} */
  const parts = [];
  let run = /** @type {{prefix: string, first: number, last: number, labels: string[]} | null} */ (null);
  const flush = () => {
    if (!run) return;
    // The first and last labels as written, so "W01–W03" keeps its zero padding.
    parts.push(run.labels.length > 2 ? `${run.labels[0]}–${run.labels[run.labels.length - 1]}` : run.labels.join(', '));
    run = null;
  };
  for (const w of picked) {
    const m = /^(.*?)(\d+)$/.exec(String(w.label));
    if (m && run && run.prefix === m[1] && Number(m[2]) === run.last + 1) {
      run.last = Number(m[2]);
      run.labels.push(w.label);
      continue;
    }
    flush();
    if (m) run = { prefix: m[1], first: Number(m[2]), last: Number(m[2]), labels: [w.label] };
    else parts.push(w.label);
  }
  flush();
  return parts.join(', ');
}

/**
 * New wafers that continue the project's numbering for their prefix:
 * "W1".."Wn" for wafers, "M1".."Mn" for masks, after the highest number
 * already used with that prefix. With a type they get a copy of its spec
 * and say where it came from.
 * @param {readonly Wafer[]} existing
 * @param {number} count
 * @param {string} [prefix] letters only
 * @param {{spec?: import('./types.js').WaferSpec, specId?: string | null}} [type]
 * @returns {Wafer[]}
 */
export function newWafers(existing, count, prefix = 'W', type = {}) {
  let top = 0;
  const p = prefix.toLowerCase();
  for (const w of existing) {
    const label = String(w.label).trim().toLowerCase();
    const m = /^(\D*)(\d+)$/.exec(label);
    if (m && m[1] === p) top = Math.max(top, Number(m[2]));
  }
  /** @type {Wafer[]} */
  const out = [];
  for (let i = 1; i <= Math.max(0, Math.floor(count)); i++) {
    /** @type {Wafer} */
    const w = { id: uuid(), label: `${prefix}${top + i}`, status: 'active', notes: '' };
    if (type.spec) w.spec = structuredClone(type.spec);
    if (type.specId) w.specId = type.specId;
    out.push(w);
  }
  return out;
}

/**
 * A plan step with a fresh id. A GDS layout comes along (the next batch
 * writes the same layout, and on this device shares its file); pictures and
 * files stay with the step they were added to.
 * @param {Partial<PlanStep>} [s]
 * @returns {PlanStep}
 */
export function newStep(s = {}) {
  /** @type {PlanStep} */
  const out = {
    id: uuid(), title: String(s.title || '').trim(), toolId: s.toolId || null, templateId: s.templateId || null,
    recipe: String(s.recipe || '').trim(), notes: String(s.notes || '').trim(), doneAt: null, skipped: false,
  };
  if (list(s.adds).length) out.adds = [...list(s.adds)];
  if (list(s.removes).length) out.removes = [...list(s.removes)];
  if (s.debond) out.debond = true;
  if (s.gds && (s.gds.name || s.gds.fileId)) out.gds = { ...s.gds };
  return out;
}

/**
 * A copy of another project's plan: the same steps (and GDS layouts) with
 * new ids and no marks. With `waferMap` (old wafer id to new one) the steps keep which
 * wafers they are for and the stacks they bond; wafers not in the map are
 * left out (a stack needs two of them to stay).
 * @param {Project} from
 * @param {ReadonlyMap<string, string>} [waferMap]
 * @returns {PlanStep[]}
 */
export function copyPlan(from, waferMap) {
  return list(from.steps).map((s) => {
    const step = newStep(s);
    if (!waferMap) return step;
    /** @param {unknown} ids @returns {string[]} */
    const map = (ids) => [...new Set(list(ids).map((id) => waferMap.get(id) || '').filter(Boolean))];
    const waferIds = map(s.waferIds);
    if (waferIds.length) step.waferIds = waferIds;
    const bonds = list(s.bonds).map((b) => ({ id: uuid(), waferIds: map(b && b.waferIds), ...(b && b.method ? { method: b.method } : {}) }))
      .filter((b) => b.waferIds.length >= 2);
    if (bonds.length) step.bonds = bonds;
    return step;
  });
}

/**
 * Another project's plan for this one ("Copy the plan of"). When this one
 * still has only its untouched first wafer, the other project's wafers come
 * too (labels and types, nothing done); otherwise steps find their wafers by
 * label.
 * @param {Project} from
 * @param {readonly Wafer[]} wafers this project's wafers
 * @param {boolean} replaceWafers this project's wafers are an untouched default
 * @returns {{wafers: Wafer[], steps: PlanStep[]}}
 */
export function copyPlanInto(from, wafers, replaceWafers) {
  if (replaceWafers && list(from.wafers).length) {
    const copied = list(from.wafers).map((w) => copyWafer(w));
    const map = new Map(list(from.wafers).map((w, i) => [w.id, copied[i].id]));
    return { wafers: copied, steps: copyPlan(from, map) };
  }
  const byLabel = new Map(wafers.map((w) => [String(w.label).trim().toLowerCase(), w.id]));
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const w of list(from.wafers)) {
    const to = byLabel.get(String(w.label).trim().toLowerCase());
    if (to) map.set(w.id, to);
  }
  return { wafers: [...wafers], steps: copyPlan(from, map) };
}

/**
 * A wafer for a copy: the same label and type, a new id, in process, no note.
 * @param {Wafer} w
 * @returns {Wafer}
 */
function copyWafer(w) {
  /** @type {Wafer} */
  const out = { id: uuid(), label: w.label, status: 'active', notes: '' };
  if (w.spec) out.spec = structuredClone(w.spec);
  if (w.specId) out.specId = w.specId;
  return out;
}

/**
 * A name for a copy that no other project uses. A name that ends in a
 * number of up to three digits counts on to the next free one ("Batch 3"
 * to "Batch 4", "Mask_01" to "Mask_02"); a longer number is likely a year
 * or a part number, so that name, like any other, gets "Name (copy)", then
 * "Name (copy 2)" and so on. Copying a copy does not stack the suffix.
 * @param {string} name
 * @param {readonly string[]} [taken] names in use
 * @returns {string}
 */
export function copyName(name, taken = []) {
  const base = String(name || '').trim().replace(/\s*\(copy(?: \d+)?\)$/i, '') || 'Project';
  const used = new Set([...taken, base].map((t) => String(t).trim().toLocaleLowerCase()));
  const numbered = /^(.*\D)(\d{1,3})$/.exec(base);
  if (numbered) {
    for (let i = Number(numbered[2]) + 1; i < 1000; i++) {
      const n = `${numbered[1]}${String(i).padStart(numbered[2].length, '0')}`;
      if (!used.has(n.toLocaleLowerCase())) return n;
    }
  }
  for (let i = 1; ; i++) {
    const n = i === 1 ? `${base} (copy)` : `${base} (copy ${i})`;
    if (!used.has(n.toLocaleLowerCase())) return n;
  }
}

/**
 * A new project like this one, for the next batch: the same goal,
 * substrate, notes, folder, wafer labels and plan, with new ids, every
 * wafer in process, no step done and no runs (they stay with the original).
 * It starts active: a copy of a failed project does not carry the failure.
 * @param {Project} from
 * @param {{now?: string, taken?: readonly string[]}} [o] taken: names in use, so the copy gets its own
 * @returns {Record<string, any>} the new project's fields, not stored yet
 */
export function duplicateProject(from, o = {}) {
  const wafers = list(from.wafers).map((w) => copyWafer(w));
  const map = new Map(list(from.wafers).map((w, i) => [w.id, wafers[i].id]));
  return {
    name: copyName(from.name, o.taken),
    goal: from.goal || '',
    status: 'active',
    startedAt: o.now || new Date().toISOString(),
    endedAt: null,
    substrate: from.substrate || '',
    notes: from.notes || '',
    folderId: from.folderId || null,
    wafers,
    steps: copyPlan(from, map),
  };
}

/**
 * Keep only links that still make sense: to a known, live project, with
 * wafer ids of that project and a step id of its plan.
 * @param {readonly ProjectLink[]} links
 * @param {ReadonlyMap<string, Project>} projects live projects by id
 * @returns {ProjectLink[]}
 */
export function cleanLinks(links, projects) {
  /** @type {ProjectLink[]} */
  const out = [];
  for (const l of links) {
    const p = projects.get(l.projectId);
    if (!p || out.some((x) => x.projectId === l.projectId)) continue;
    const wafers = new Set(list(p.wafers).map((w) => w.id));
    const steps = new Set(list(p.steps).map((s) => s.id));
    out.push({
      projectId: l.projectId,
      waferIds: list(l.waferIds).filter((id) => wafers.has(id)),
      stepId: l.stepId && steps.has(l.stepId) ? l.stepId : null,
    });
  }
  return out;
}

/**
 * A link for a project as a new run joins it: the step asked for, else the
 * suggested step for the run's tool, and that step's wafers still in
 * process (every wafer in process without a step).
 * @param {Project} project
 * @param {readonly Run[]} runs
 * @param {string} toolId
 * @param {string | null} [stepId] the step the person asked for ("Log this step")
 * @returns {ProjectLink}
 */
export function defaultLink(project, runs, toolId, stepId = null) {
  const asked = stepId ? list(project.steps).find((s) => s.id === stepId) || null : null;
  const step = asked || suggestStep(stepStates(project, runs), toolId);
  const waferIds = step ? stepWaferIds(project, step) : activeWafers(project).map((w) => w.id);
  return { projectId: project.id, waferIds, stepId: step ? step.id : null };
}

/**
 * A run's projects in words, for lists and exports:
 * "Resonators batch 3 (W1–W3; step 2: Etch oxide)".
 * @param {Partial<Run>} run
 * @param {ReadonlyMap<string, Project>} projects live projects by id; links to others are left out
 * @returns {string}
 */
export function projectsText(run, projects) {
  return runLinks(run).map((l) => {
    const p = projects.get(l.projectId);
    if (!p) return '';
    const i = list(p.steps).findIndex((s) => s.id === l.stepId);
    const parts = [waferText(p, list(l.waferIds)), i >= 0 ? `step ${i + 1}: ${p.steps[i].title}` : ''].filter(Boolean);
    return parts.length ? `${p.name} (${parts.join('; ')})` : p.name;
  }).filter(Boolean).join('; ');
}

/**
 * When the project last saw activity: its newest run, else when it started.
 * @param {Project} project
 * @param {readonly Run[]} runs the project's runs, oldest first
 * @returns {string}
 */
export function lastActivity(project, runs) {
  return runs.length ? runs[runs.length - 1].startedAt : project.startedAt;
}

/**
 * Whether a project is this person's: its author is them. Names compare by
 * their words, case aside, and the shorter may be the start of the longer
 * ("Nick" is "Nick Reynolds"); a project or person without a name counts.
 * @param {Project} project
 * @param {string} userName
 * @returns {boolean}
 */
export function ownedBy(project, userName) {
  const words = (/** @type {unknown} */ s) => String(s || '').toLowerCase().split(/\s+/).filter(Boolean);
  const [a, b] = [words(project.author), words(userName)];
  if (!a.length || !b.length) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((w, i) => w === long[i]);
}

/**
 * A project's status as people see it: active, paused, done (finished) or
 * failed. A failed project is stored as done with `failed` (1.8), so versions
 * that know only the three statuses keep syncing it, as finished. `failed`
 * left over from an older version that reopened the project does not count.
 * @param {Project} project
 * @returns {'active' | 'paused' | 'done' | 'failed'}
 */
export function projectStatus(project) {
  return project.status === 'done' && project.failed === true ? 'failed' : project.status;
}

/**
 * The stored fields for a status chosen in words: finished and failed both
 * end the project (keeping the date it ended, if it had one); the others
 * clear the end.
 * @param {Pick<Project, 'endedAt'>} project as stored now
 * @param {string} shown active, paused, done or failed
 * @param {string} [now]
 * @returns {Pick<Project, 'status' | 'endedAt' | 'failed'>}
 */
export function statusPatch(project, shown, now = new Date().toISOString()) {
  const ends = shown === 'done' || shown === 'failed';
  return {
    status: ends ? 'done' : shown === 'paused' ? 'paused' : 'active',
    endedAt: ends ? project.endedAt || now : null,
    failed: shown === 'failed',
  };
}

/**
 * Projects in display order: active first, then paused, then done; newest
 * start first within each group.
 * @param {readonly Project[]} projects
 * @returns {Project[]}
 */
export function sortProjects(projects) {
  const rank = { active: 0, paused: 1, done: 2 };
  return [...projects].sort((a, b) => ((rank[/** @type {'active'} */ (a.status)] ?? 3) - (rank[/** @type {'active'} */ (b.status)] ?? 3))
    || toMs(b.startedAt) - toMs(a.startedAt) || a.name.localeCompare(b.name));
}
