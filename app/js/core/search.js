// @ts-check
/**
 * History search and chart series. Pure filters over runs (tool, template,
 * material, status, a local-day date range and keywords), the materials used
 * in runs, and the points of a template's primary output. No DOM and no
 * storage, so it runs unchanged in Node tests.
 */
import { normText } from './vocab.js';
import { fromLocalInput, toMs } from './time.js';
import { isNum } from './stats.js';

/** @typedef {import('./types.js').Run} Run */
/** @typedef {import('./types.js').Tool} Tool */
/** @typedef {import('./types.js').Template} Template */

/**
 * History filters. An empty string means "any".
 * @typedef {Object} RunFilters
 * @property {string} toolId
 * @property {string} templateId
 * @property {string} material compared with normText (case, spacing and Unicode forms folded)
 * @property {string} status "draft", "open" or "complete" ("all" also means any)
 * @property {string} from first local day "YYYY-MM-DD", inclusive
 * @property {string} to last local day "YYYY-MM-DD", inclusive (the whole day)
 * @property {string} q keywords: every whitespace-separated word must appear in the notes, recipe or tags
 * @property {string} projectId only runs that belong to this project
 */

/** Filters that match every run. */
export const EMPTY_FILTERS = Object.freeze({
  toolId: '', templateId: '', material: '', status: '', from: '', to: '', q: '', projectId: '',
});

const KEYS = /** @type {(keyof RunFilters)[]} */ (Object.keys(EMPTY_FILTERS));

/**
 * Every filter as a trimmed string. Missing and non-string values become ""
 * (any), and so does status "all".
 * @param {Partial<RunFilters> | null | undefined} f
 * @returns {RunFilters}
 */
export function normalizeFilters(f) {
  /** @type {RunFilters} */
  const out = { ...EMPTY_FILTERS };
  for (const k of KEYS) {
    const v = f ? f[k] : undefined;
    out[k] = typeof v === 'string' ? v.trim() : '';
  }
  if (out.status === 'all') out.status = '';
  return out;
}

/**
 * @param {Partial<RunFilters> | null | undefined} f
 * @returns {boolean} true when at least one filter is set
 */
export function hasFilters(f) {
  const n = normalizeFilters(f);
  return KEYS.some((k) => n[k] !== '');
}

/**
 * Local midnight at the start of a "YYYY-MM-DD" day, moved by whole
 * calendar days (so a 23- or 25-hour DST day still ends at midnight).
 * @param {string} day
 * @param {number} [addDays]
 * @returns {number | null} epoch ms, or null when `day` is not a real calendar day
 */
function dayStart(day, addDays = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const iso = m ? fromLocalInput(day) : null;
  if (!m || !iso) return null;
  const d = new Date(iso);
  if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null; // e.g. "2026-02-30"
  d.setDate(d.getDate() + addDays);
  return d.getTime();
}

/**
 * @param {Run} r
 * @returns {number} start time; runs without a valid date sort last
 */
function startMs(r) {
  const t = toMs(r.startedAt);
  return Number.isNaN(t) ? -Infinity : t;
}

/** @param {Run} a @param {Run} b */
const newestFirst = (a, b) => startMs(b) - startMs(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The text a keyword search looks in: notes, recipe and tags, normalised.
 * @param {Run} r
 * @returns {string}
 */
function searchText(r) {
  const tags = Array.isArray(r.tags) ? r.tags : [];
  return normText([r.notes, r.recipe, ...tags].map((s) => String(s ?? '')).join(' '));
}

/**
 * Runs that pass every filter, newest startedAt first (ties by id). Deleted
 * runs never match. Neither the array nor the runs are modified.
 * @param {readonly Run[]} runs
 * @param {Partial<RunFilters> | null} [filters] empty values mean "any"
 * @param {{tools?: Map<string, Tool>, templates?: Map<string, Template>}} [lookups] the
 *   view's id maps (as built by ui/run-list.js), accepted so callers can pass one
 *   object everywhere; the filters match by id and need no names
 * @returns {Run[]}
 */
export function filterRuns(runs, filters, lookups) {
  const f = normalizeFilters(filters);
  const material = normText(f.material);
  const from = f.from ? dayStart(f.from) : null;
  const end = f.to ? dayStart(f.to, 1) : null; // exclusive: midnight after the last day
  const words = normText(f.q).split(' ').filter(Boolean);
  const out = runs.filter((r) => {
    if (!r || r.deleted) return false;
    if (f.toolId && r.toolId !== f.toolId) return false;
    if (f.templateId && r.templateId !== f.templateId) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.projectId && !(Array.isArray(r.projects) && r.projects.some((l) => l && l.projectId === f.projectId))) return false;
    if (material && normText(r.material) !== material) return false;
    if (from !== null || end !== null) {
      const t = toMs(r.startedAt);
      if (Number.isNaN(t) || (from !== null && t < from) || (end !== null && t >= end)) return false;
    }
    if (words.length) {
      const text = searchText(r);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
  return out.sort(newestFirst);
}

/**
 * The materials used in non-deleted runs, one spelling per normText key (the
 * most recently used spelling), sorted alphabetically.
 * @param {readonly Run[]} runs
 * @returns {string[]}
 */
export function distinctMaterials(runs) {
  /** @type {Map<string, {name: string, t: number}>} */
  const seen = new Map();
  for (const r of runs) {
    if (!r || r.deleted) continue;
    const name = String(r.material ?? '').trim();
    const key = normText(name);
    if (!key) continue;
    const t = startMs(r);
    const cur = seen.get(key);
    if (!cur || t > cur.t) seen.set(key, { name, t });
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v.name);
}

/**
 * The numeric inputs of a template that take at least two different values
 * across these runs' complete, non-deleted ones, most varied first: the
 * inputs worth plotting a result against.
 * @param {Template} template
 * @param {readonly Run[]} runs
 * @returns {import('./types.js').FieldSpec[]}
 */
export function variedInputs(template, runs) {
  const done = runs.filter((r) => r && !r.deleted && r.status === 'complete');
  return template.fields.filter((f) => f.role === 'input' && f.type === 'number')
    .map((f) => ({ f, n: new Set(done.map((r) => (r.params ? r.params[f.key] : undefined)).filter(isNum)).size }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.f);
}

/**
 * Points of one result against one input, for complete, non-deleted runs
 * that have both as numbers.
 * @param {readonly Run[]} runs
 * @param {string} xKey input field key
 * @param {string} yKey output field key
 * @returns {{x: number, y: number, run: Run}[]}
 */
export function scatterSeries(runs, xKey, yKey) {
  /** @type {{x: number, y: number, run: Run}[]} */
  const out = [];
  for (const r of runs) {
    if (!r || r.deleted || r.status !== 'complete') continue;
    const x = r.params ? r.params[xKey] : undefined;
    const y = r.results ? r.results[yKey] : undefined;
    if (isNum(x) && isNum(y)) out.push({ x, y, run: r });
  }
  return out;
}

/**
 * Chart points for a template's primary output: complete, non-deleted runs
 * of that template with a finite numeric value, oldest first.
 * @param {readonly Run[]} runs
 * @param {Template | null | undefined} template
 * @returns {{x: number, y: number, id: string}[]} x = startedAt in epoch ms
 */
export function primarySeries(runs, template) {
  const key = template ? template.primaryOutput : null;
  if (!template || !key) return [];
  /** @type {{x: number, y: number, id: string}[]} */
  const out = [];
  for (const r of runs) {
    if (!r || r.deleted || r.status !== 'complete' || r.templateId !== template.id) continue;
    const y = r.results ? r.results[key] : undefined;
    const x = toMs(r.startedAt);
    if (isNum(y) && Number.isFinite(x)) out.push({ x, y, id: r.id });
  }
  return out.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
