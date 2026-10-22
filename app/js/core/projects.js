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
 * @param {Project} project
 * @returns {Wafer[]} wafers still in process
 */
export function activeWafers(project) {
  return list(project.wafers).filter((w) => w.status !== 'done' && w.status !== 'scrapped');
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
 * New wafers that continue the project's numbering: "W1".."Wn", or after
 * the highest number already used.
 * @param {readonly Wafer[]} existing
 * @param {number} count
 * @param {string} [prefix]
 * @returns {Wafer[]}
 */
export function newWafers(existing, count, prefix = 'W') {
  let top = 0;
  for (const w of existing) {
    const m = /(\d+)$/.exec(String(w.label));
    if (m) top = Math.max(top, Number(m[1]));
  }
  /** @type {Wafer[]} */
  const out = [];
  for (let i = 1; i <= Math.max(0, Math.floor(count)); i++) {
    out.push({ id: uuid(), label: `${prefix}${top + i}`, status: 'active', notes: '' });
  }
  return out;
}

/**
 * A plan step with a fresh id.
 * @param {Partial<PlanStep>} [s]
 * @returns {PlanStep}
 */
export function newStep(s = {}) {
  return {
    id: uuid(), title: String(s.title || '').trim(), toolId: s.toolId || null, templateId: s.templateId || null,
    recipe: String(s.recipe || '').trim(), notes: String(s.notes || '').trim(), doneAt: null, skipped: false,
  };
}

/**
 * A copy of another project's plan for a new project: the same steps with
 * new ids and no marks.
 * @param {Project} from
 * @returns {PlanStep[]}
 */
export function copyPlan(from) {
  return list(from.steps).map((s) => newStep(s));
}

/**
 * A name for a copy that no other project uses: "Name (copy)", then
 * "Name (copy 2)" and so on. Copying a copy does not stack the suffix.
 * @param {string} name
 * @param {readonly string[]} [taken] names in use
 * @returns {string}
 */
export function copyName(name, taken = []) {
  const base = String(name || '').trim().replace(/\s*\(copy(?: \d+)?\)$/i, '') || 'Project';
  const used = new Set(taken.map((t) => String(t).trim().toLocaleLowerCase()));
  for (let i = 1; ; i++) {
    const n = i === 1 ? `${base} (copy)` : `${base} (copy ${i})`;
    if (!used.has(n.toLocaleLowerCase())) return n;
  }
}

/**
 * A new project like this one, for the next batch: the same goal,
 * substrate, notes, folder, wafer labels and plan, with new ids, every
 * wafer in process, no step done and no runs (they stay with the original).
 * @param {Project} from
 * @param {{now?: string, taken?: readonly string[]}} [o] taken: names in use, so the copy gets its own
 * @returns {Record<string, any>} the new project's fields, not stored yet
 */
export function duplicateProject(from, o = {}) {
  return {
    name: copyName(from.name, o.taken),
    goal: from.goal || '',
    status: 'active',
    startedAt: o.now || new Date().toISOString(),
    endedAt: null,
    substrate: from.substrate || '',
    notes: from.notes || '',
    folderId: from.folderId || null,
    wafers: list(from.wafers).map((w) => ({ id: uuid(), label: w.label, status: 'active', notes: '' })),
    steps: copyPlan(from),
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
 * A link for a project as a new run joins it: its wafers still in process
 * and the suggested step for the run's tool.
 * @param {Project} project
 * @param {readonly Run[]} runs
 * @param {string} toolId
 * @returns {ProjectLink}
 */
export function defaultLink(project, runs, toolId) {
  const step = suggestStep(stepStates(project, runs), toolId);
  return { projectId: project.id, waferIds: activeWafers(project).map((w) => w.id), stepId: step ? step.id : null };
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
