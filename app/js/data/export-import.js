// @ts-check
/**
 * JSON backup, merge import and CSV export: the pure part. Nothing here
 * touches IndexedDB, the DOM or File objects, so it runs unchanged in Node
 * tests; data/backup.js reads and writes the database and builds the files.
 *
 * Import merges by id. An incoming record wins only when its updatedAt is
 * strictly newer, so a tombstone wins or loses like any other edit, and
 * nothing is ever physically deleted.
 */
import {
  SCHEMA_VERSION, DATA_STORES, normalizeRecord, validateRecord, migrateRecords, validateBackupEnvelope,
} from './schema.js';
import { pointStats } from '../core/derive.js';
import { normText } from '../core/vocab.js';
import { localDateKey, toMs } from '../core/time.js';

/** The `format` tag of a backup file. */
export const BACKUP_FORMAT = 'lnf-runlog';
/** How many invalid-record reasons mergeStore keeps per store. */
export const MAX_ERRORS = 5;

/**
 * @typedef {Object} MergeCounts
 * @property {number} added new ids
 * @property {number} updated strictly newer versions of stored records
 * @property {number} skipped the same or an older version than the stored one
 * @property {number} invalid failed validation; not imported
 */

/**
 * @typedef {Object} ImportPlan
 * @property {Record<string, any[]>} put records to write, per store
 * @property {Record<string, MergeCounts>} counts per store
 * @property {string[] | null} materials the merged materials list, or null when it gains nothing
 * @property {string[]} errors why records were invalid (the first few per store)
 */

/**
 * @typedef {Object} BackupInput
 * @property {any[]} tools every record, tombstones included
 * @property {any[]} templates
 * @property {any[]} runs
 * @property {any[]} measurements
 * @property {any[]} events
 * @property {Record<string, any> | null} [settings] full settings; only materials and tuning are kept
 * @property {any[]} [photos] encoded photos (see encodePhoto); omit to leave photos out
 * @property {string} appVersion
 * @property {string} exportedAt ISO 8601
 */

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {any[]}
 */
const list = (v) => (Array.isArray(v) ? v : []);

/** @param {any} a @param {any} b */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The backup object written to lnf-runlog-backup-YYYY-MM-DD.json. `photos`
 * is present only when given.
 * @param {BackupInput} input
 * @returns {Record<string, any>}
 */
export function buildBackup(input) {
  /** @type {Record<string, any>} */
  const out = {
    format: BACKUP_FORMAT,
    version: SCHEMA_VERSION,
    appVersion: input.appVersion,
    exportedAt: input.exportedAt,
    tools: list(input.tools),
    templates: list(input.templates),
    runs: list(input.runs),
    measurements: list(input.measurements),
    events: list(input.events),
    settings: exportableSettings(input.settings),
  };
  if (Array.isArray(input.photos)) out.photos = input.photos;
  return out;
}

/**
 * The settings that travel in a backup: the materials list and the lookup
 * tuning. Device settings (DEVICE_SETTINGS in records.js: name, device id,
 * theme, last export time and so on) never leave the device.
 * @param {Record<string, any> | null | undefined} s
 * @returns {{materials: string[], tuning: Record<string, any>}}
 */
export function exportableSettings(s) {
  const src = isObj(s) ? s : {};
  return {
    materials: list(src.materials).filter((m) => typeof m === 'string'),
    tuning: isObj(src.tuning) ? { ...src.tuning } : {},
  };
}

/**
 * @param {Date | string | number} [date] default now
 * @returns {string} "lnf-runlog-backup-YYYY-MM-DD.json", dated in local time
 */
export function backupFileName(date = new Date()) {
  return `lnf-runlog-backup-${localDateKey(date)}.json`;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Import checks the schema leaves out: a photo's embedded image.
 * @param {string} store
 * @param {Record<string, any>} rec
 * @returns {string[]}
 */
function importChecks(store, rec) {
  if (store !== 'photos') return [];
  const errs = [];
  const d = rec.data;
  if (d !== undefined && !(typeof d === 'string' && d.length % 4 === 0 && BASE64_RE.test(d))) {
    errs.push('photo data is not base64');
  }
  if (rec.type !== undefined && rec.type !== null && typeof rec.type !== 'string') errs.push('photo type must be text');
  return errs;
}

/**
 * Upgrade, normalise and validate one incoming record. Migrations run
 * first, because they expect records as the older version stored them.
 * @param {string} store
 * @param {unknown} raw
 * @param {number} fromVersion
 * @returns {{rec: any, errs: string[]}}
 */
function prepareIncoming(store, raw, fromVersion) {
  if (!isObj(raw)) return { rec: null, errs: ['not a record'] };
  let rec;
  try {
    rec = normalizeRecord(store, migrateRecords(store, [raw], fromVersion)[0]);
  } catch (err) {
    return { rec: null, errs: [`could not be upgraded: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const errs = validateRecord(store, rec);
  return { rec, errs: errs.length ? errs : importChecks(store, rec) };
}

/**
 * @param {string} store
 * @param {unknown} raw
 * @param {number} i position in the backup's list
 * @param {string[]} errs
 * @returns {string} e.g. "runs #3 (id): startedAt must be a date"
 */
function reason(store, raw, i, errs) {
  const id = isObj(raw) && typeof raw.id === 'string' && raw.id ? ` (${raw.id})` : '';
  const more = errs.length > 2 ? ` (+${errs.length - 2} more)` : '';
  return `${store} #${i + 1}${id}: ${errs.slice(0, 2).join('; ')}${more}`;
}

/**
 * The image of an incoming photo: its base64 `data` when the backup carries
 * it (backup.js turns it into a Blob); otherwise the image already stored
 * under that id, so a record without image data never blanks a stored photo.
 * @param {Record<string, any>} rec normalised incoming photo
 * @param {Record<string, any> | undefined} cur the stored version, if any
 * @returns {Record<string, any>}
 */
function withPhotoPayload(rec, cur) {
  const out = { ...rec };
  delete out.blob;
  delete out.bytes;
  if (typeof out.data === 'string') return out;
  out.blob = cur && cur.blob ? cur.blob : null;
  if (cur && cur.bytes) out.bytes = cur.bytes;
  if (cur && (cur.blob || cur.bytes) && cur.type) out.type = cur.type;
  return out;
}

/**
 * Merge one store's records from a backup into the stored ones, by id:
 * - a new id is added;
 * - a strictly newer updatedAt replaces the stored version (so a newer
 *   tombstone deletes, and a newer restore undeletes);
 * - the same or an older version is skipped, so a newer local tombstone
 *   keeps the record deleted.
 * Each incoming record is migrated, normalised and validated first; invalid
 * ones are counted and the first few reasons kept. Nothing is ever removed.
 * @param {string} store
 * @param {any[]} existing stored records, tombstones included
 * @param {unknown[]} incoming records from the backup
 * @param {number} [fromVersion] the backup's format version
 * @returns {{put: any[], counts: MergeCounts, errors: string[]}}
 */
export function mergeStore(store, existing, incoming, fromVersion = SCHEMA_VERSION) {
  /** @type {Map<string, Record<string, any>>} */
  const current = new Map();
  for (const r of list(existing)) if (isObj(r) && typeof r.id === 'string') current.set(r.id, r);
  /** @type {Map<string, any>} */
  const put = new Map();
  /** @type {MergeCounts} */
  const counts = { added: 0, updated: 0, skipped: 0, invalid: 0 };
  /** @type {string[]} */
  const errors = [];
  list(incoming).forEach((raw, i) => {
    const { rec, errs } = prepareIncoming(store, raw, fromVersion);
    if (errs.length) {
      counts.invalid += 1;
      if (errors.length < MAX_ERRORS) errors.push(reason(store, raw, i, errs));
      return;
    }
    const cur = current.get(rec.id);
    // An unreadable stored timestamp is never "older": the local copy stays.
    if (cur && !(toMs(rec.updatedAt) > toMs(cur.updatedAt))) {
      counts.skipped += 1;
      return;
    }
    const next = store === 'photos' ? withPhotoPayload(rec, cur) : rec;
    counts[cur ? 'updated' : 'added'] += 1;
    current.set(rec.id, next);
    put.set(rec.id, next);
  });
  return { put: [...put.values()], counts, errors };
}

/**
 * Union of two materials lists: the local list untouched and in its own
 * order, then the incoming names it lacks. Names compare with normText
 * (Unicode NFKC, trimmed, case-insensitive), so "SiO₂" equals "sio2".
 * @param {string[]} local
 * @param {unknown[]} incoming
 * @returns {string[]}
 */
export function mergeMaterials(local, incoming) {
  const out = list(local).filter((m) => typeof m === 'string');
  const seen = new Set(out.map(normText));
  for (const m of list(incoming)) {
    if (typeof m !== 'string') continue;
    const name = m.trim();
    const key = normText(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Plan a merge import of a parsed backup across tools, templates, runs,
 * measurements, events and photos. From the settings only new material
 * names are taken; local lookup tuning stays as it is.
 * @param {Record<string, any[]>} existingByStore stored records per store, tombstones included
 * @param {any} backup parsed backup JSON
 * @param {string[]} [localMaterials] this device's materials list
 * @returns {ImportPlan}
 */
export function planImport(existingByStore, backup, localMaterials = []) {
  /** @type {ImportPlan} */
  const plan = { put: {}, counts: {}, materials: null, errors: [] };
  for (const s of DATA_STORES) {
    plan.put[s] = [];
    plan.counts[s] = { added: 0, updated: 0, skipped: 0, invalid: 0 };
  }
  const envelope = validateBackupEnvelope(backup);
  if (envelope.length) return { ...plan, errors: envelope };
  for (const s of DATA_STORES) {
    const r = mergeStore(s, list(existingByStore && existingByStore[s]), list(backup[s]), backup.version);
    plan.put[s] = r.put;
    plan.counts[s] = r.counts;
    plan.errors.push(...r.errors);
  }
  const local = list(localMaterials).filter((m) => typeof m === 'string');
  const merged = mergeMaterials(local, isObj(backup.settings) ? list(backup.settings.materials) : []);
  if (merged.length > local.length) plan.materials = merged;
  return plan;
}

/**
 * A stored photo as it goes into a backup: the image as base64 `data` with
 * its MIME `type`, and no Blob or ArrayBuffer (JSON cannot hold them).
 * Without an image the record keeps `blob: null`, its normalised form.
 * @param {Record<string, any>} rec the stored photo record
 * @param {string | null} data base64 image, or null to leave the image out
 * @param {string} [type] MIME type of the image
 * @returns {Record<string, any>}
 */
export function encodePhoto(rec, data, type) {
  const out = { ...rec };
  delete out.blob;
  delete out.bytes;
  delete out.data;
  if (data === null) {
    out.blob = null;
    return out;
  }
  out.data = data;
  out.type = type || rec.type || 'image/jpeg';
  return out;
}

/** Bytes per btoa call: a multiple of 3, so the chunks join without padding. */
const B64_CHUNK = 3 * 8192;

/**
 * Base64 of a byte array, encoded chunk by chunk (one String.fromCharCode
 * spread over a whole photo would overflow the call stack).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  /** @type {string[]} */
  const parts = [];
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    const chunk = bytes.subarray(i, i + B64_CHUNK);
    parts.push(btoa(String.fromCharCode.apply(null, /** @type {any} */ (chunk))));
  }
  return parts.join('');
}

/**
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- CSV ---------- */

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell (RFC 4180). Text that a spreadsheet would run as a formula
 * (starting with =, +, -, an at sign, a tab or CR) gets a leading apostrophe unless the
 * whole text is a plain number such as "-5". Cells holding a comma, quote
 * or line break are quoted, with quotes doubled.
 * @param {unknown} v
 * @returns {string}
 */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  let s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {unknown[][]} rows header row first
 * @returns {string} CSV text with CRLF line ends and no byte-order mark
 *   (the caller adds one, U+FEFF, for Excel)
 */
export function toCsv(rows) {
  return rows.map((r) => `${r.map((v) => csvCell(v)).join(',')}\r\n`).join('');
}

/**
 * Non-deleted records, oldest first by a date field, then by id.
 * @param {unknown} records
 * @param {string} field
 * @returns {any[]}
 */
function liveSorted(records, field) {
  const t = (/** @type {any} */ r) => {
    const ms = toMs(r[field]);
    return Number.isNaN(ms) ? Infinity : ms;
  };
  return list(records).filter((r) => isObj(r) && !r.deleted)
    .sort((a, b) => cmp(t(a), t(b)) || cmp(String(a.id), String(b.id)));
}

/**
 * @param {unknown} records tools or templates (tombstones too, so old runs keep their names)
 * @returns {(id: unknown) => string} the record's name, or the id itself when unknown
 */
function namer(records) {
  /** @type {Map<unknown, string>} */
  const names = new Map();
  for (const r of list(records)) if (isObj(r)) names.set(r.id, String(r.name ?? ''));
  return (id) => (id === null || id === undefined || id === '' ? '' : names.get(id) ?? String(id));
}

/**
 * @param {unknown} obj
 * @param {string} key
 * @returns {unknown} the object's own property, never an inherited one
 */
const own = (obj, key) => (isObj(obj) && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);

/** @param {string} a @param {string} b */
const byKey = (a, b) => cmp(a.toLowerCase(), b.toLowerCase()) || cmp(a, b);

/**
 * Sorted union of the keys of `field` (params or results) across records.
 * @param {any[]} records
 * @param {string} field
 * @returns {string[]}
 */
function keysOf(records, field) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const r of records) if (isObj(r[field])) for (const k of Object.keys(r[field])) keys.add(k);
  return [...keys].sort(byKey);
}

export const RUN_COLUMNS = Object.freeze([
  'id', 'tool', 'template', 'status', 'startedAt', 'endedAt', 'material', 'substrate', 'maskMaterial', 'recipe',
  'targetThickness_nm', 'tags', 'notes', 'author', 'createdAt', 'updatedAt',
]);
export const MEASUREMENT_COLUMNS = Object.freeze([
  'id', 'runId', 'metrologyTool', 'kind', 'phase', 'material', 'unit', 'n', 'mean', 'min', 'max', 'uniformity_pct',
  'points', 'takenAt', 'notes',
]);
export const EVENT_COLUMNS = Object.freeze(['id', 'tool', 'type', 'major', 'at', 'notes']);

/**
 * runs.csv: one row per non-deleted run, oldest first. After the fixed
 * columns comes one `p.<key>` column per parameter key used by any run,
 * then one `r.<key>` column per result key, each group sorted by key.
 * Values are as stored, so durations stay in seconds.
 * @param {any[]} runs
 * @param {any[]} tools
 * @param {any[]} templates
 * @returns {string}
 */
export function runsCsv(runs, tools, templates) {
  const live = liveSorted(runs, 'startedAt');
  const toolName = namer(tools);
  const templateName = namer(templates);
  const pKeys = keysOf(live, 'params');
  const rKeys = keysOf(live, 'results');
  const header = [...RUN_COLUMNS, ...pKeys.map((k) => `p.${k}`), ...rKeys.map((k) => `r.${k}`)];
  const rows = live.map((r) => [
    r.id, toolName(r.toolId), templateName(r.templateId), r.status, r.startedAt, r.endedAt,
    r.material, r.substrate, r.maskMaterial, r.recipe, r.targetThickness, list(r.tags).join('; '),
    r.notes, r.author, r.createdAt, r.updatedAt,
    ...pKeys.map((k) => own(r.params, k)), ...rKeys.map((k) => own(r.results, k)),
  ]);
  return toCsv([header, ...rows]);
}

/**
 * measurements.csv: one row per non-deleted measurement, oldest first, with
 * the point statistics and the points as "site=value; ...". Measurements of
 * deleted runs are left out, and a blank material shows the run's material
 * (the one derived values use). Uniformity needs at least 2 points.
 * @param {any[]} measurements
 * @param {any[]} runs tombstones included
 * @param {any[]} tools
 * @returns {string}
 */
export function measurementsCsv(measurements, runs, tools) {
  /** @type {Map<unknown, any>} */
  const runById = new Map();
  for (const r of list(runs)) if (isObj(r)) runById.set(r.id, r);
  const toolName = namer(tools);
  const rows = liveSorted(measurements, 'takenAt')
    .filter((m) => !runById.get(m.runId)?.deleted)
    .map((m) => {
      const points = /** @type {import('../core/types.js').Point[]} */ (list(m.points).filter(isObj));
      const st = pointStats(points);
      const run = runById.get(m.runId);
      return [
        m.id, m.runId, toolName(m.metrologyToolId), m.kind, m.phase, m.material || (run ? run.material : ''), m.unit,
        st ? st.n : 0, st?.mean, st?.min, st?.max, st && st.n > 1 ? st.uniformity : null,
        points.map((p) => `${p.site}=${p.value}`).join('; '), m.takenAt, m.notes,
      ];
    });
  return toCsv([[...MEASUREMENT_COLUMNS], ...rows]);
}

/**
 * events.csv: one row per non-deleted tool event, oldest first.
 * @param {any[]} events
 * @param {any[]} tools
 * @returns {string}
 */
export function eventsCsv(events, tools) {
  const toolName = namer(tools);
  const rows = liveSorted(events, 'at').map((e) => [e.id, toolName(e.toolId), e.type, e.major, e.at, e.notes]);
  return toCsv([[...EVENT_COLUMNS], ...rows]);
}
