// @ts-check
/**
 * A project's traveler: what its wafers went through, run by run in process
 * order, with the plan and each wafer's path. As report blocks for the PDF
 * writer and as sheets for the workbook writer. Pure: records in, blocks
 * and rows out; deleted records are left out.
 */
import { stepStates, projectRuns, waferText, linkFor, progress } from './projects.js';
import { measurementText, localStamp, fieldText } from './export-all.js';
import { stepsText } from './run-steps.js';
import { folderTree, pathText } from './folders.js';
import { STATUS_LABELS, PROJECT_STATUS_LABELS, WAFER_STATUS_LABELS } from './vocab.js';
import { toMs, localDateKey } from './time.js';

/** @typedef {import('./pdf.js').PdfBlock} PdfBlock */
/** @typedef {import('./xlsx.js').XlsxSheet} XlsxSheet */

/**
 * @typedef {Object} TravelerInput
 * @property {any} project
 * @property {any[]} projects every project, to name the other projects a shared run belongs to
 * @property {any[]} tools
 * @property {any[]} templates
 * @property {any[]} runs every run
 * @property {any[]} measurements every measurement
 * @property {any[]} [folders] project folders, for the project's folder path
 */

/** @type {Readonly<Record<string, string>>} */
const STATE_TEXT = Object.freeze({ done: 'Done', active: 'In progress', todo: 'To do', skipped: 'Skipped' });

/** @param {unknown} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
/** @param {number} n @param {string} word */
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** @param {unknown} at @returns {{date: number} | null} an Excel date cell */
const dateCell = (at) => (Number.isFinite(toMs(/** @type {any} */ (at))) ? { date: toMs(/** @type {any} */ (at)) } : null);

/**
 * The project's runs with their tools, templates, measurements and steps.
 * @param {TravelerInput} input
 */
function prepare(input) {
  const p = input.project;
  const tools = new Map(list(input.tools).map((t) => [t.id, t]));
  const templates = new Map(list(input.templates).map((t) => [t.id, t]));
  const projects = new Map(list(input.projects).filter((x) => !x.deleted).map((x) => [x.id, x]));
  const runs = projectRuns(list(input.runs), p.id);
  const ids = new Set(runs.map((r) => r.id));
  /** @type {Map<string, any[]>} */
  const byRun = new Map();
  for (const m of list(input.measurements).filter((x) => !x.deleted && ids.has(x.runId))
    .sort((a, b) => toMs(a.takenAt) - toMs(b.takenAt))) {
    if (!byRun.has(m.runId)) byRun.set(m.runId, []);
    /** @type {any[]} */ (byRun.get(m.runId)).push(m);
  }
  const states = stepStates(p, runs);
  const stepOf = new Map(states.map((s) => [s.step.id, s]));
  const name = (/** @type {string} */ id) => String(tools.get(id)?.name || '');
  const measurements = (/** @type {any} */ r) => (byRun.get(r.id) || []).map((m) => measurementText(m, name(m.metrologyToolId))).join('; ');
  /** @param {any} r @returns {string} "3. Etch oxide" */
  const stepText = (r) => {
    const s = stepOf.get(linkFor(r, p.id)?.stepId || '');
    return s ? `${s.index + 1}. ${s.step.title}` : '';
  };
  /** @param {any} r @returns {string} the other projects this run's wafers belong to */
  const shared = (r) => list(r.projects).filter((l) => l.projectId !== p.id)
    .map((l) => projects.get(l.projectId)).filter(Boolean).map((x) => x.name).join(', ');
  return { p, tools, templates, runs, states, name, measurements, stepText, shared };
}

/**
 * Each wafer's path: "Oct 3 Tempress S3T1; Oct 5 CEE 200X spinner 1; …".
 * @param {ReturnType<typeof prepare>} P
 * @param {any} wafer
 * @returns {string}
 */
function waferPath(P, wafer) {
  return P.runs.filter((r) => (linkFor(r, P.p.id)?.waferIds || []).includes(wafer.id))
    .map((r) => `${localDateKey(r.startedAt)} ${P.name(r.toolId)}${r.recipe ? ` (${r.recipe})` : ''}`).join('; ');
}

/**
 * The printable traveler.
 * @param {TravelerInput} input
 * @param {{now: number, who?: string}} o
 * @returns {PdfBlock[]}
 */
export function travelerBlocks(input, o) {
  const P = prepare(input);
  const p = P.p;
  const prog = progress(P.states);
  /** @type {PdfBlock[]} */
  const out = [
    { kind: 'title', text: `Traveler: ${p.name}` },
    { kind: 'small', text: [`Exported ${localStamp(o.now)}`, o.who || '', PROJECT_STATUS_LABELS[p.status] || p.status,
      `started ${localDateKey(p.startedAt)}`, p.endedAt ? `finished ${localDateKey(p.endedAt)}` : '', count(P.runs.length, 'run'),
      prog.total ? `${prog.done} of ${count(prog.total, 'step')} done` : ''].filter(Boolean).join(' · ') },
  ];
  if (p.goal) out.push({ kind: 'p', text: p.goal });
  const wafers = list(p.wafers);
  for (const [label, text] of [
    ['Folder', pathText(folderTree(list(input.folders)), p.folderId, ' / ')],
    ['Substrate', p.substrate || ''],
    ['Wafers', wafers.map((w) => `${w.label} (${String(WAFER_STATUS_LABELS[w.status] || w.status).toLowerCase()})${w.notes ? `: ${w.notes}` : ''}`).join('; ')],
    ['Notes', p.notes || ''],
  ]) if (text) out.push({ kind: 'kv', label, text });
  if (P.states.length) {
    out.push({ kind: 'h1', text: 'Plan' });
    for (const s of P.states) {
      const tool = s.step.toolId ? P.name(s.step.toolId) : '';
      const text = [STATE_TEXT[s.state], tool, s.step.recipe, s.doneAt ? `done ${localDateKey(s.doneAt)}` : '',
        s.runs.length ? count(s.runs.length, 'run') : '', s.step.notes].filter(Boolean).join(' · ');
      out.push({ kind: 'kv', label: `${s.index + 1}. ${s.step.title}`, text });
    }
  }
  out.push({ kind: 'h1', text: 'Process record' });
  if (!P.runs.length) out.push({ kind: 'p', text: 'No runs in this project yet.' });
  for (const r of P.runs) {
    const tpl = P.templates.get(r.templateId);
    const link = linkFor(r, p.id);
    out.push({ kind: 'h2', text: [localStamp(r.startedAt), P.name(r.toolId) || 'Unknown tool', tpl ? tpl.name : '', P.stepText(r)].filter(Boolean).join(' · ') });
    const rows = [
      ['Wafers', link ? waferText(p, link.waferIds) : ''], ['Status', r.status === 'complete' ? '' : STATUS_LABELS[r.status] || r.status],
      ['Recipe', r.recipe || ''], ['Inputs', fieldText(r, tpl, ['input'])], ['Steps', stepsText(r, tpl)],
      ['Conditions', fieldText(r, tpl, ['context'])], ['Results', fieldText(r, tpl, ['output'])],
      ['Sample', [r.material && `material ${r.material}`, r.substrate && `substrate ${r.substrate}`, r.maskMaterial && `mask ${r.maskMaterial}`].filter(Boolean).join('; ')],
      ['Measurements', P.measurements(r)], ['Notes', r.notes || ''], ['Also in', P.shared(r)],
    ];
    for (const [label, text] of rows) if (text) out.push({ kind: 'kv', label, text });
  }
  if (wafers.length) {
    out.push({ kind: 'h1', text: 'Wafer paths' });
    for (const w of wafers) out.push({ kind: 'kv', label: w.label, text: waferPath(P, w) || 'No runs yet.' });
  }
  return out;
}

/**
 * The traveler as a workbook: the process record, the plan and the wafers.
 * @param {TravelerInput} input
 * @returns {XlsxSheet[]}
 */
export function travelerSheets(input) {
  const P = prepare(input);
  const p = P.p;
  const record = P.runs.map((r) => {
    const tpl = P.templates.get(r.templateId);
    const link = linkFor(r, p.id);
    return [
      dateCell(r.startedAt), P.stepText(r), P.name(r.toolId), tpl ? tpl.name : '', r.recipe, link ? waferText(p, link.waferIds) : '',
      STATUS_LABELS[r.status] || r.status, r.material, r.substrate || '', r.maskMaterial || '', fieldText(r, tpl, ['input']),
      stepsText(r, tpl), fieldText(r, tpl, ['context']), fieldText(r, tpl, ['output']), P.measurements(r), r.notes, P.shared(r), r.id,
    ];
  });
  const plan = P.states.map((s) => [
    s.index + 1, s.step.title, s.step.toolId ? P.name(s.step.toolId) : '', s.step.recipe, STATE_TEXT[s.state], dateCell(s.doneAt), s.runs.length, s.step.notes,
  ]);
  const wafers = list(p.wafers).map((w) => [w.label, WAFER_STATUS_LABELS[w.status] || w.status, w.notes, waferPath(P, w)]);
  return [
    { name: 'Process record', rows: [['Date', 'Step', 'Tool', 'Template', 'Recipe', 'Wafers', 'Status', 'Material', 'Substrate', 'Mask',
      'Inputs', 'Steps', 'Conditions', 'Results', 'Measurements', 'Notes', 'Also in', 'Run id'], ...record],
    widths: [16, 18, 22, 16, 18, 14, 10, 14, 14, 12, 40, 30, 30, 30, 40, 30, 18, 36] },
    { name: 'Plan', rows: [['#', 'Step', 'Tool', 'Recipe', 'State', 'Done', 'Runs', 'Notes'], ...plan], widths: [4, 24, 22, 18, 12, 16, 6, 30] },
    { name: 'Wafers', rows: [['Wafer', 'Status', 'Notes', 'Path'], ...wafers], widths: [10, 10, 30, 80] },
  ];
}

/**
 * "lnf-runlog-project-resonator-batch-3-2026-10-22" (no extension).
 * @param {{name: string}} project
 * @param {Date | number | string} [date]
 * @returns {string}
 */
export function travelerFileBase(project, date = new Date()) {
  const slug = String(project.name || 'project').normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'project';
  return `lnf-runlog-project-${slug}-${localDateKey(date)}`;
}
