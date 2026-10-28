// @ts-check
/**
 * Time on the tools of a project (2.1): the run time its runs report so far,
 * and how long the steps still to do are likely to take, from the person's
 * past runs on each step's tool and template, weighed as Look up weighs
 * runs (recent ones count most, runs from before a major tool event less).
 * Worked out afresh whenever the project page opens. Pure: no DOM, no
 * storage, no clock of its own.
 */
import { latestMajorEvent } from './similarity.js';
import { timerField } from './run-draft.js';
import { projectRuns } from './projects.js';
import { normText } from './vocab.js';
import { toMs, DAY_MS } from './time.js';
import { DEFAULTS } from '../config.js';

/** @typedef {import('./types.js').Run} Run */
/** @typedef {import('./types.js').Template} Template */
/** @typedef {import('./types.js').Tool} Tool */
/** @typedef {import('./types.js').ToolEvent} ToolEvent */
/** @typedef {import('./types.js').Project} Project */
/** @typedef {import('./types.js').PlanStep} PlanStep */
/** @typedef {import('./projects.js').StepState} StepState */

/**
 * The run time a run reports: its main step's time field (the template's
 * timer field), plus the same field of each of its other steps.
 * @param {Partial<Run>} run
 * @param {Template | null | undefined} template
 * @returns {number | null} seconds, or null when the template has no time field or the run reports no time
 */
export function runSeconds(run, template) {
  const key = timerField(template);
  if (!key) return null;
  /** @type {number | null} */
  let total = null;
  const add = (/** @type {unknown} */ v) => { if (typeof v === 'number' && Number.isFinite(v) && v > 0) total = (total || 0) + v; };
  add(run.params ? run.params[key] : undefined);
  for (const s of run.steps || []) if (s && !s.main) add(s.params ? s.params[key] : undefined);
  return total;
}

/**
 * @typedef {Object} StepEstimate
 * @property {string} stepId
 * @property {number | null} seconds the step's likely run time; null without history
 * @property {number} n the past runs it rests on
 * @property {boolean} sameRecipe those runs used the step's recipe
 */

/**
 * @typedef {Object} History
 * @property {readonly Run[]} runs every run
 * @property {readonly Tool[]} tools
 * @property {readonly ToolEvent[]} events
 * @property {string | number} [now]
 * @property {Partial<import('../config.js').Config>} [cfg] Look up's tuning (half-life, event penalty)
 */

/**
 * The likely run time of a plan step: the weighted mean of the time that
 * past complete runs on the step's tool and template reported, with Look
 * up's weights (recency with the tool's half-life, the event penalty after a
 * major tool event). Runs that used the step's recipe count alone when there
 * are any. Null without a tool, a template or any such run.
 * @param {PlanStep} step
 * @param {Template | null} template the template the step's runs use
 * @param {History} h
 * @returns {StepEstimate}
 */
export function estimateStep(step, template, h) {
  /** @type {StepEstimate} */
  const none = { stepId: step.id, seconds: null, n: 0, sameRecipe: false };
  if (!step.toolId || !template) return none;
  const nowMs = h.now === undefined ? Date.now() : toMs(h.now);
  const cfg = { ...DEFAULTS, ...(h.cfg || {}) };
  const tool = h.tools.find((t) => t.id === step.toolId);
  const halfLife = tool && typeof tool.halfLifeDays === 'number' && tool.halfLifeDays > 0 ? tool.halfLifeDays : cfg.HALF_LIFE_DAYS;
  const majors = h.events.filter((e) => e && !e.deleted && e.major === true);
  /** @type {{w: number, secs: number, recipe: string}[]} */
  const timed = [];
  for (const r of h.runs) {
    if (!r || r.deleted || r.status !== 'complete' || r.toolId !== step.toolId || r.templateId !== template.id) continue;
    const secs = runSeconds(r, template);
    const startMs = toMs(r.startedAt);
    if (secs === null || !Number.isFinite(startMs)) continue;
    const age = Math.max(0, (nowMs - startMs) / DAY_MS);
    const w = 0.5 ** (age / halfLife) * (latestMajorEvent(majors, r.toolId, startMs, nowMs) ? cfg.EVENT_PENALTY : 1);
    timed.push({ w, secs, recipe: normText(r.recipe) });
  }
  const recipe = normText(step.recipe);
  const own = recipe ? timed.filter((x) => x.recipe === recipe) : [];
  const pool = own.length ? own : timed;
  if (!pool.length) return none;
  const wsum = pool.reduce((a, x) => a + x.w, 0);
  const seconds = wsum > 0 ? pool.reduce((a, x) => a + x.w * x.secs, 0) / wsum : pool.reduce((a, x) => a + x.secs, 0) / pool.length;
  return { stepId: step.id, seconds, n: pool.length, sameRecipe: own.length > 0 };
}

/**
 * @typedef {Object} ProjectTime
 * @property {number} soFar seconds the project's runs report, added up
 * @property {number} timedRuns the project's runs that report a time
 * @property {number} untimedRuns the project's runs without one
 * @property {number} stepsLeft steps still to do or in progress (skipped ones left out)
 * @property {number} estimated how many of them have an estimate
 * @property {number | null} remaining seconds the steps left will likely take, from the estimated ones; null when none has one
 * @property {StepEstimate[]} steps the estimate of each step left, in plan order
 */

/**
 * Time on tools for a project: what its runs report so far, and what the
 * steps left will likely take. A step in progress counts what its run has
 * not yet reported of its estimate.
 * @param {Project} project
 * @param {StepState[]} states the plan's step states (core/projects.js stepStates)
 * @param {(step: PlanStep) => Template | null} templateOf the template a step's runs use
 * @param {History & {templates: readonly Template[]}} h
 * @returns {ProjectTime}
 */
export function projectTime(project, states, templateOf, h) {
  const byId = new Map(h.templates.map((t) => [t.id, t]));
  let soFar = 0;
  let timedRuns = 0;
  let untimedRuns = 0;
  for (const r of projectRuns(h.runs, project.id)) {
    const secs = runSeconds(r, r.templateId ? byId.get(r.templateId) : null);
    if (secs === null) untimedRuns++;
    else {
      soFar += secs;
      timedRuns++;
    }
  }
  const left = states.filter((s) => s.state === 'todo' || s.state === 'active');
  /** @type {StepEstimate[]} */
  const steps = [];
  let remaining = 0;
  let estimated = 0;
  for (const s of left) {
    const tpl = templateOf(s.step);
    const est = estimateStep(s.step, tpl, h);
    steps.push(est);
    if (est.seconds === null) continue;
    estimated++;
    // A step in progress: its run may have reported part of the time already.
    const reported = s.state === 'active' ? s.runs.reduce((a, r) => a + (runSeconds(r, tpl) || 0), 0) : 0;
    remaining += Math.max(0, est.seconds - reported);
  }
  return { soFar, timedRuns, untimedRuns, stepsLeft: left.length, estimated, remaining: estimated ? remaining : null, steps };
}
