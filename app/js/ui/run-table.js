// @ts-check
/**
 * Runs as a table, for wide screens (History): the start, tool and
 * template, material, recipe, status, main result and projects of each
 * run. A column header sorts by that column; again, the other way round.
 * Empty values sort last either way.
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { runTitle, primaryText } from './run-list.js';
import { formatDateTime } from '../core/time.js';
import { STATUS_LABELS } from '../core/vocab.js';
import { runLinks } from '../core/projects.js';

/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('./run-list.js').Lookups} Lookups */
/** @typedef {{key: string, dir: 1 | -1}} RunSort */

/** Newest first, as History lists runs on a phone. */
export const DEFAULT_SORT = Object.freeze(/** @type {RunSort} */ ({ key: 'startedAt', dir: -1 }));

/** @type {ReadonlyArray<[string | null, string]>} [sort key, header] */
const COLUMNS = Object.freeze([
  ['startedAt', 'Started'], ['tool', 'Tool'], ['material', 'Material'], ['recipe', 'Recipe'], ['status', 'Status'],
  ['result', 'Result'], [null, 'Projects'],
]);

/**
 * @param {Run} r
 * @param {Lookups} L
 * @returns {number | null} the main result
 */
function resultValue(r, L) {
  const tpl = r.templateId ? L.templates.get(r.templateId) : null;
  const v = tpl && tpl.primaryOutput && r.results ? r.results[tpl.primaryOutput] : undefined;
  return typeof v === 'number' ? v : null;
}

/**
 * @param {Run} r
 * @param {string} key
 * @param {Lookups} L
 * @returns {string | number | null}
 */
function sortValue(r, key, L) {
  if (key === 'tool') return runTitle(r, L);
  if (key === 'material') return r.material || null;
  if (key === 'recipe') return r.recipe || null;
  if (key === 'status') return STATUS_LABELS[r.status] || r.status;
  if (key === 'result') return resultValue(r, L);
  return r.startedAt;
}

/**
 * Runs in a column's order; ties newest first.
 * @param {readonly Run[]} runs
 * @param {RunSort} sort
 * @param {Lookups} L
 * @returns {Run[]}
 */
export function sortRuns(runs, sort, L) {
  return [...runs].sort((a, b) => {
    const x = sortValue(a, sort.key, L);
    const y = sortValue(b, sort.key, L);
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else {
      const c = typeof x === 'number' && typeof y === 'number' ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      if (c) return c * sort.dir;
    }
    return a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0;
  });
}

/**
 * One run as a table row; its date opens the run.
 * @param {Run} r
 * @param {Lookups} L
 * @returns {HTMLElement}
 */
export function runTableRow(r, L) {
  const projects = runLinks(r).map((l) => L.projects.get(l.projectId)?.name).filter(Boolean).join(', ');
  return h('tr', null,
    h('td', { class: 'nowrap' }, h('a', { href: `#/run/${r.id}` }, formatDateTime(r.startedAt, L.now))),
    h('td', null, runTitle(r, L)),
    h('td', null, r.material || ''),
    h('td', null, r.recipe || ''),
    h('td', { class: 'nowrap' }, STATUS_LABELS[r.status] || r.status),
    h('td', { class: 'num' }, primaryText(r, L) || ''),
    h('td', null, projects));
}

/**
 * @param {Run[]} runs the rows to show now
 * @param {Lookups} L
 * @param {RunSort} sort
 * @param {(key: string) => void} onSort a header was tapped
 * @returns {HTMLElement}
 */
export function runTable(runs, L, sort, onSort) {
  const head = h('tr', null, COLUMNS.map(([key, label]) => {
    if (!key) return h('th', { scope: 'col' }, label);
    const on = sort.key === key;
    return h('th', {
      scope: 'col', class: key === 'result' ? 'num' : undefined,
      'aria-sort': on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none',
    }, h('button', { type: 'button', onClick: () => onSort(key) }, label, on ? icon(sort.dir === 1 ? 'up' : 'down', { size: 14 }) : null));
  }));
  return h('table', { class: 'history-table' }, h('thead', null, head), h('tbody', null, runs.map((r) => runTableRow(r, L))));
}
