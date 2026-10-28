// @ts-check
/** Run rows shared by Home, Open runs, History, Tool detail and projects. */
import { h } from './dom.js';
import { listRow, badge } from './components.js';
import { categoryIcon } from './icons.js';
import { fmtValue } from '../core/format.js';
import { formatDateTime, formatAgo, formatMmSs } from '../core/time.js';
import { STATUS_LABELS } from '../core/vocab.js';
import { runLinks } from '../core/projects.js';

/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Template} Template */
/** @typedef {import('../core/types.js').Project} Project */

/**
 * @typedef {Object} Lookups
 * @property {Map<string, Tool>} tools
 * @property {Map<string, Template>} templates
 * @property {Map<string, Project>} projects live projects
 * @property {number} now epoch ms
 */

/**
 * Build id -> record maps for run rows.
 * @param {Tool[]} tools
 * @param {Template[]} templates
 * @param {Project[]} [projects]
 * @returns {Lookups}
 */
export function lookups(tools, templates, projects = []) {
  return {
    tools: new Map(tools.map((t) => [t.id, t])),
    templates: new Map(templates.map((t) => [t.id, t])),
    projects: new Map(projects.filter((p) => !p.deleted).map((p) => [p.id, p])),
    now: Date.now(),
  };
}

/**
 * "ICP · Oxide etch"
 * @param {Run} run
 * @param {Lookups} L
 * @returns {string}
 */
export function runTitle(run, L) {
  const tool = L.tools.get(run.toolId);
  const tpl = run.templateId ? L.templates.get(run.templateId) : null;
  return `${tool ? tool.shortName || tool.name : 'Unknown tool'}${tpl ? ` · ${tpl.name}` : ''}`;
}

/**
 * The run's primary output, formatted, or null.
 * @param {Run} run
 * @param {Lookups} L
 * @returns {string | null}
 */
export function primaryText(run, L) {
  const tpl = run.templateId ? L.templates.get(run.templateId) : null;
  const key = tpl && tpl.primaryOutput;
  if (!tpl || !key) return null;
  const v = run.results ? run.results[key] : undefined;
  if (typeof v !== 'number') return null;
  const f = tpl.fields.find((x) => x.key === key);
  return fmtValue(v, f && f.unit);
}

/**
 * The run's first few numeric inputs with a value: "ICP power 500 W · Pressure 10 mTorr".
 * @param {Run} run
 * @param {Lookups} L
 * @param {number} [max]
 * @returns {string}
 */
export function keyInputs(run, L, max = 3) {
  const tpl = run.templateId ? L.templates.get(run.templateId) : null;
  if (!tpl) return '';
  /** @type {string[]} */
  const out = [];
  for (const f of tpl.fields) {
    if (out.length >= max || f.role !== 'input' || f.chemistry) continue;
    const v = run.params ? run.params[f.key] : undefined;
    if (typeof v !== 'number') continue;
    out.push(`${f.label} ${f.type === 'duration' ? formatMmSs(v) : fmtValue(v, f.unit)}`);
  }
  return out.join(' · ');
}

/**
 * @param {Run} run
 * @param {Lookups} L
 * @param {{showAge?: boolean, onTool?: boolean, waiting?: string}} [opts] showAge: for open runs;
 *   onTool: the list is one tool's, so the row names the template and key inputs instead of the tool;
 *   waiting: what the run waits for
 * @returns {HTMLElement}
 */
export function runRow(run, L, opts = {}) {
  const when = opts.showAge ? formatAgo(run.startedAt, L.now) : formatDateTime(run.startedAt, L.now);
  const tpl = run.templateId ? L.templates.get(run.templateId) : null;
  const sub = opts.onTool
    ? [when, run.recipe, keyInputs(run, L)].filter(Boolean).join(' · ')
    : [when, run.material, run.recipe].filter(Boolean).join(' · ');
  const badges = [];
  if (run.status !== 'complete') {
    badges.push(badge(STATUS_LABELS[run.status] || run.status, run.status === 'draft' ? 'warn' : 'info'));
  }
  if (opts.waiting) badges.push(badge(opts.waiting, 'muted', 'flag'));
  for (const l of runLinks(run)) {
    const p = L.projects.get(l.projectId);
    if (p) badges.push(badge(p.name, 'tag', 'project'));
  }
  const tool = L.tools.get(run.toolId);
  return listRow({
    lead: categoryIcon(tool ? tool.category : 'other'),
    title: opts.onTool ? (tpl ? tpl.name : 'No template') : runTitle(run, L),
    subtitle: sub,
    meta: primaryText(run, L) || undefined,
    href: `#/run/${run.id}`,
    badges,
  });
}

/**
 * @param {Run[]} runs
 * @param {Lookups} L
 * @param {{showAge?: boolean, onTool?: boolean, waiting?: Map<string, string>}} [opts]
 * @returns {HTMLElement}
 */
export function runList(runs, L, opts = {}) {
  return h('div', { class: 'list' }, runs.map((r) => runRow(r, L, {
    showAge: opts.showAge, onTool: opts.onTool, waiting: opts.waiting ? opts.waiting.get(r.id) : undefined,
  })));
}
