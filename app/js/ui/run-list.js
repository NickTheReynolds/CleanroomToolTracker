// @ts-check
/** Run rows shared by Home, Open runs, History and Tool detail. */
import { h } from './dom.js';
import { listRow, badge } from './components.js';
import { categoryIcon } from './icons.js';
import { fmtValue } from '../core/format.js';
import { formatDateTime, formatAge } from '../core/time.js';
import { STATUS_LABELS } from '../core/vocab.js';

/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Template} Template */

/**
 * @typedef {Object} Lookups
 * @property {Map<string, Tool>} tools
 * @property {Map<string, Template>} templates
 * @property {number} now epoch ms
 */

/**
 * Build id -> record maps for run rows.
 * @param {Tool[]} tools
 * @param {Template[]} templates
 * @returns {Lookups}
 */
export function lookups(tools, templates) {
  return {
    tools: new Map(tools.map((t) => [t.id, t])),
    templates: new Map(templates.map((t) => [t.id, t])),
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
 * @param {Run} run
 * @param {Lookups} L
 * @param {{showAge?: boolean}} [opts] showAge for open runs
 * @returns {HTMLElement}
 */
export function runRow(run, L, opts = {}) {
  const when = opts.showAge ? `${formatAge(run.startedAt, L.now)} ago` : formatDateTime(run.startedAt, L.now);
  const sub = [when, run.material, run.recipe].filter(Boolean).join(' · ');
  const badges = [];
  if (run.status !== 'complete') {
    badges.push(badge(STATUS_LABELS[run.status] || run.status, run.status === 'draft' ? 'warn' : 'info'));
  }
  const tool = L.tools.get(run.toolId);
  return listRow({
    lead: categoryIcon(tool ? tool.category : 'other'),
    title: runTitle(run, L),
    subtitle: sub,
    meta: primaryText(run, L) || undefined,
    href: `#/run/${run.id}`,
    badges,
  });
}

/**
 * @param {Run[]} runs
 * @param {Lookups} L
 * @param {{showAge?: boolean}} [opts]
 * @returns {HTMLElement}
 */
export function runList(runs, L, opts) {
  return h('div', { class: 'list' }, runs.map((r) => runRow(r, L, opts)));
}
