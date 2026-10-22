// @ts-check
/**
 * "Export everything": all runs with their parameters, results and
 * measurements, plus tool events, as one CSV table, an Excel workbook (all
 * runs, one sheet per tool with labelled columns, measurements, events) or
 * a printable report. Pure: records in, rows and report blocks out; deleted
 * records are left out. data/backup.js turns these into files.
 */
import { pointStats } from './derive.js';
import { fmtNum, fmtValue } from './format.js';
import { formatMmSs, toMs } from './time.js';
import { CATEGORY_LABELS, STATUS_LABELS, KIND_LABELS, PHASE_LABELS, EVENT_LABELS, normText } from './vocab.js';
import { toCsv } from './csv.js';

/** @typedef {import('./xlsx.js').XlsxSheet} XlsxSheet */
/** @typedef {import('./xlsx.js').XlsxCell} XlsxCell */
/** @typedef {import('./pdf.js').PdfBlock} PdfBlock */

/**
 * All records, tombstones included (they are left out).
 * @typedef {Object} ExportInput
 * @property {any[]} tools
 * @property {any[]} templates
 * @property {any[]} runs
 * @property {any[]} measurements
 * @property {any[]} events
 */

/** @param {unknown} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
/** @param {unknown} v @returns {string} tags as "a; b" */
const tagText = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).join('; ') : '');
/** @param {unknown} v @returns {XlsxCell} a stored value as a cell */
const cell = (v) => (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : null);
/** @param {any} a @param {any} b */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** @param {number} n @param {string} word @returns {string} "1 run", "3 runs" */
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** @param {number} n @returns {string} */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * "2026-10-06 14:05" in local time, or "" when the time is not valid.
 * @param {unknown} at
 * @returns {string}
 */
export function localStamp(at) {
  const ms = toMs(/** @type {any} */ (at));
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Live records sorted oldest first by a time field, then by id.
 * @param {any[]} records
 * @param {string} field
 * @returns {any[]}
 */
function liveSorted(records, field) {
  const t = (/** @type {any} */ r) => { const ms = toMs(r[field]); return Number.isFinite(ms) ? ms : Infinity; };
  return list(records).filter((r) => !r.deleted).sort((a, b) => cmp(t(a), t(b)) || cmp(String(a.id), String(b.id)));
}

/**
 * Runs with their tool, template and measurements.
 * @param {ExportInput} input
 */
function prepare(input) {
  const tools = new Map(list(input.tools).map((t) => [t.id, t]));
  const templates = new Map(list(input.templates).map((t) => [t.id, t]));
  const runs = liveSorted(input.runs, 'startedAt');
  const ids = new Set(runs.map((r) => r.id));
  /** @type {Map<string, any[]>} */
  const byRun = new Map();
  for (const m of liveSorted(input.measurements, 'takenAt')) {
    if (!ids.has(m.runId)) continue;
    if (!byRun.has(m.runId)) byRun.set(m.runId, []);
    /** @type {any[]} */ (byRun.get(m.runId)).push(m);
  }
  const events = liveSorted(input.events, 'at');
  const name = (/** @type {string} */ id) => { const t = tools.get(id); return t ? String(t.name || '') : ''; };
  return { tools, templates, runs, byRun, events, name };
}

/**
 * "Post thickness 575 nm (5 points, uniformity 0.35%)".
 * @param {any} m
 * @param {string} [tool] the metrology tool's name
 * @returns {string}
 */
export function measurementText(m, tool) {
  const st = pointStats(list(m.points));
  const what = `${PHASE_LABELS[m.phase] || m.phase || ''} ${String(KIND_LABELS[m.kind] || m.kind || '').toLowerCase()}`.trim();
  if (!st) return `${what}: no points`;
  const extra = [`${st.n} point${st.n === 1 ? '' : 's'}`, st.n > 1 && st.uniformity !== null ? `uniformity ${fmtNum(st.uniformity)}%` : '', tool || '']
    .filter(Boolean).join(', ');
  return `${what}${m.material ? ` of ${m.material}` : ''}: ${fmtNum(st.mean)}${m.unit ? ` ${m.unit}` : ''} (${extra})`;
}

/**
 * Mean of the latest measurement per phase, kind, material and unit of a
 * run: "m.post.thickness [nm]" for the run's own material (a blank material
 * counts as the run's, as for derived values), "m.post.thickness Photoresist
 * [nm]" for any other, such as the mask.
 * @param {any[]} ms the run's measurements, oldest first
 * @param {any} run
 * @returns {Map<string, number>}
 */
function measurementMeans(ms, run) {
  const own = normText(run.material);
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const m of ms) {
    const st = pointStats(list(m.points));
    if (!st) continue;
    const mat = normText(m.material);
    const other = mat && mat !== own ? ` ${String(m.material).trim()}` : '';
    out.set(`m.${m.phase}.${m.kind}${other}${m.unit ? ` [${m.unit}]` : ''}`, st.mean);
  }
  return out;
}

/** @param {any[]} recs @param {string} field @returns {string[]} sorted keys of an object field */
const keysOf = (recs, field) => [...new Set(recs.flatMap((r) => (r[field] && typeof r[field] === 'object' ? Object.keys(r[field]) : [])))]
  .sort((a, b) => cmp(a.toLowerCase(), b.toLowerCase()) || cmp(a, b));

/**
 * The all-runs table: the run's facts, a p. column per parameter key, an r.
 * column per result key, the mean of each kind of measurement, and every
 * measurement in words. Times as local "YYYY-MM-DD HH:MM" and ISO 8601.
 * @param {ExportInput} input
 * @param {boolean} [asDates] Excel: times as dates
 * @returns {XlsxCell[][]}
 */
export function allRunsTable(input, asDates = false) {
  const P = prepare(input);
  const pKeys = keysOf(P.runs, 'params');
  const rKeys = keysOf(P.runs, 'results');
  const mKeys = [...new Set(P.runs.flatMap((r) => [...measurementMeans(P.byRun.get(r.id) || [], r).keys()]))].sort();
  const when = (/** @type {any} */ at) => (asDates && Number.isFinite(toMs(at)) ? { date: toMs(at) } : localStamp(at));
  const header = ['date', 'tool', 'category', 'template', 'status', 'recipe', 'material', 'substrate', 'mask', 'target_nm', 'tags', 'notes',
    ...pKeys.map((k) => `p.${k}`), ...rKeys.map((k) => `r.${k}`), ...mKeys, 'measurements', 'started', 'ended', 'author', 'id'];
  const rows = P.runs.map((r) => {
    const tool = P.tools.get(r.toolId);
    const tpl = P.templates.get(r.templateId);
    const ms = P.byRun.get(r.id) || [];
    const means = measurementMeans(ms, r);
    return [
      when(r.startedAt), P.name(r.toolId), tool ? CATEGORY_LABELS[tool.category] || tool.category : '', tpl ? tpl.name : '',
      STATUS_LABELS[r.status] || r.status, r.recipe, r.material, r.substrate, r.maskMaterial, r.targetThickness,
      tagText(r.tags), r.notes,
      ...pKeys.map((k) => cell(r.params && r.params[k])), ...rKeys.map((k) => cell(r.results && r.results[k])),
      ...mKeys.map((k) => means.get(k) ?? null), ms.map((m) => measurementText(m, P.name(m.metrologyToolId))).join('; '),
      asDates ? when(r.startedAt) : r.startedAt, asDates ? when(r.endedAt) : r.endedAt, r.author, r.id,
    ];
  });
  return [header, ...rows];
}

/**
 * The one-file CSV export (no byte-order mark; the caller adds one).
 * @param {ExportInput} input
 * @returns {string}
 */
export function allRunsCsv(input) {
  return toCsv(allRunsTable(input));
}

/**
 * A tool's fields across the templates its runs use, inputs and context
 * first, then outputs, labelled "Label (unit)".
 * @param {any[]} runs
 * @param {Map<string, any>} templates
 * @returns {{key: string, label: string, role: string, type: string}[]}
 */
function toolFields(runs, templates) {
  /** @type {Map<string, {key: string, label: string, role: string, type: string}>} */
  const out = new Map();
  for (const r of runs) {
    const tpl = templates.get(r.templateId);
    for (const f of tpl ? list(tpl.fields) : []) {
      if (out.has(f.key)) continue;
      const unit = f.type === 'duration' ? 's' : f.unit;
      out.set(f.key, { key: f.key, label: `${f.label}${unit ? ` (${unit})` : ''}`, role: f.role, type: f.type });
    }
  }
  const order = { input: 0, context: 1, output: 2 };
  return [...out.values()].sort((a, b) => (order[/** @type {'input'} */ (a.role)] ?? 3) - (order[/** @type {'input'} */ (b.role)] ?? 3));
}

/**
 * The Excel workbook: all runs, one sheet per tool, measurements, events.
 * @param {ExportInput} input
 * @returns {XlsxSheet[]}
 */
export function allSheets(input) {
  const P = prepare(input);
  const date = (/** @type {any} */ at) => (Number.isFinite(toMs(at)) ? { date: toMs(at) } : null);
  /** @type {XlsxSheet[]} */
  const sheets = [{ name: 'All runs', rows: allRunsTable(input, true), widths: [16, 22, 12, 16, 10, 18, 16, 14, 14, 10, 16, 40] }];
  const toolIds = [...new Set(P.runs.map((r) => r.toolId))].sort((a, b) => cmp(P.name(a).toLowerCase(), P.name(b).toLowerCase()));
  for (const id of toolIds) {
    const runs = P.runs.filter((r) => r.toolId === id);
    const fields = toolFields(runs, P.templates);
    const header = ['Date', 'Template', 'Status', 'Recipe', 'Material', 'Substrate', 'Mask', ...fields.map((f) => f.label), 'Measurements', 'Notes'];
    const rows = runs.map((r) => {
      const tpl = P.templates.get(r.templateId);
      return [
        date(r.startedAt), tpl ? tpl.name : '', STATUS_LABELS[r.status] || r.status, r.recipe, r.material, r.substrate, r.maskMaterial,
        ...fields.map((f) => cell(f.role === 'output' ? r.results && r.results[f.key] : r.params && r.params[f.key])),
        (P.byRun.get(r.id) || []).map((m) => measurementText(m, P.name(m.metrologyToolId))).join('; '), r.notes,
      ];
    });
    const tool = P.tools.get(id);
    sheets.push({ name: (tool && (tool.shortName || tool.name)) || 'Unknown tool', rows: [header, ...rows], widths: [16, 16, 10, 18, 14, 14, 12] });
  }
  const runById = new Map(P.runs.map((r) => [r.id, r]));
  const mRows = P.runs.flatMap((r) => (P.byRun.get(r.id) || []).map((m) => {
    const st = pointStats(list(m.points));
    return [
      date(m.takenAt), P.name(r.toolId), date(r.startedAt), r.recipe, P.name(m.metrologyToolId), PHASE_LABELS[m.phase] || m.phase,
      KIND_LABELS[m.kind] || m.kind, m.material || runById.get(m.runId)?.material || '', m.unit, st ? st.n : 0, st ? st.mean : null,
      st ? st.min : null, st ? st.max : null, st && st.n > 1 ? st.uniformity : null,
      list(m.points).map((p) => `${p.site}=${p.value}`).join('; '), m.notes, m.runId,
    ];
  }));
  sheets.push({
    name: 'Measurements',
    rows: [['Measured', 'Process tool', 'Run started', 'Recipe', 'Metrology tool', 'Phase', 'Kind', 'Material', 'Unit', 'Points', 'Mean', 'Min', 'Max',
      'Uniformity (%)', 'Values', 'Notes', 'Run id'], ...mRows],
    widths: [16, 20, 16, 16, 20, 7, 14, 14, 8, 7, 10, 10, 10, 12, 30, 30],
  });
  sheets.push({
    name: 'Tool events',
    rows: [['Date', 'Tool', 'Event', 'Major', 'Notes'], ...P.events.map((e) => [date(e.at), P.name(e.toolId), EVENT_LABELS[e.type] || e.type, !!e.major, e.notes])],
    widths: [16, 22, 16, 7, 50],
  });
  return sheets;
}

/**
 * "ICP power 600 W; Time 5:00" for a run's fields of some roles.
 * @param {any} run
 * @param {any} tpl
 * @param {string[]} roles
 * @returns {string}
 */
function fieldText(run, tpl, roles) {
  const src = roles.includes('output') ? run.results : run.params;
  const derived = new Set(Array.isArray(run.derivedKeys) ? run.derivedKeys : []);
  /** @type {string[]} */
  const parts = [];
  for (const f of tpl ? list(tpl.fields).filter((x) => roles.includes(x.role)) : []) {
    const v = src ? src[f.key] : undefined;
    if (v === null || v === undefined || v === '') continue;
    const shown = f.type === 'duration' && typeof v === 'number' ? formatMmSs(v)
      : typeof v === 'number' ? fmtValue(v, f.unit) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
    parts.push(`${f.label} ${shown}${derived.has(f.key) ? ' (derived)' : ''}`);
  }
  return parts.join('; ');
}

/**
 * Values kept from fields the run's template no longer has (Run detail's
 * "Other values"), as "key value".
 * @param {any} run
 * @param {any} tpl
 * @returns {string}
 */
function otherText(run, tpl) {
  const known = new Set(tpl ? list(tpl.fields).map((f) => f.key) : []);
  return [...Object.entries(run.params || {}), ...Object.entries(run.results || {})]
    .filter(([k, v]) => !known.has(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k} ${typeof v === 'number' ? fmtNum(v, 4) : String(v)}`).join('; ');
}

/**
 * The printable report: per tool, every run with its inputs, conditions,
 * results, measurements and notes, then the tool's events.
 * @param {ExportInput} input
 * @param {{now: number, who?: string}} o
 * @returns {PdfBlock[]}
 */
export function reportBlocks(input, o) {
  const P = prepare(input);
  const nMeas = [...P.byRun.values()].reduce((n, ms) => n + ms.length, 0);
  const toolIds = [...new Set([...P.runs.map((r) => r.toolId), ...P.events.map((e) => e.toolId)])]
    .sort((a, b) => cmp(P.name(a).toLowerCase(), P.name(b).toLowerCase()));
  /** @type {PdfBlock[]} */
  const out = [
    { kind: 'title', text: 'LNF Run Log: all runs' },
    { kind: 'small', text: [`Exported ${localStamp(o.now)}`, o.who || '', `${count(P.runs.length, 'run')} on ${count(new Set(P.runs.map((r) => r.toolId)).size, 'tool')}`,
      count(nMeas, 'measurement'), count(P.events.length, 'tool event')].filter(Boolean).join(' · ') },
  ];
  if (!P.runs.length && !P.events.length) out.push({ kind: 'p', text: 'There are no runs yet.' });
  for (const id of toolIds) {
    const tool = P.tools.get(id);
    const runs = P.runs.filter((r) => r.toolId === id);
    out.push({ kind: 'h1', text: P.name(id) || 'Unknown tool' });
    out.push({ kind: 'small', text: [tool ? CATEGORY_LABELS[tool.category] : '', count(runs.length, 'run')].filter(Boolean).join(' · ') });
    for (const r of runs) {
      const tpl = P.templates.get(r.templateId);
      const head = [localStamp(r.startedAt), r.recipe || (tpl ? tpl.name : ''), r.material, r.status === 'complete' ? '' : STATUS_LABELS[r.status]]
        .filter(Boolean).join(' · ');
      out.push({ kind: 'h2', text: head });
      const sample = [r.material && `material ${r.material}`, r.substrate && `substrate ${r.substrate}`, r.maskMaterial && `mask ${r.maskMaterial}`,
        typeof r.targetThickness === 'number' ? `target ${fmtNum(r.targetThickness)} nm` : ''].filter(Boolean).join('; ');
      const rows = [
        ['Template', tpl && r.recipe ? tpl.name : ''], ['Inputs', fieldText(r, tpl, ['input'])], ['Conditions', fieldText(r, tpl, ['context'])],
        ['Results', fieldText(r, tpl, ['output'])], ['Other values', otherText(r, tpl)], ['Sample', sample],
        ['Measurements', (P.byRun.get(r.id) || []).map((m) => measurementText(m, P.name(m.metrologyToolId))).join('; ')],
        ['Notes', r.notes || ''], ['Tags', tagText(r.tags)],
      ];
      for (const [label, text] of rows) if (text) out.push({ kind: 'kv', label, text });
    }
    const events = P.events.filter((e) => e.toolId === id);
    if (events.length) {
      out.push({ kind: 'h2', text: 'Tool events' });
      for (const e of events) {
        out.push({ kind: 'kv', label: localStamp(e.at), text: `${EVENT_LABELS[e.type] || e.type}${e.major ? ' (major)' : ''}${e.notes ? `: ${e.notes}` : ''}` });
      }
    }
  }
  return out;
}
