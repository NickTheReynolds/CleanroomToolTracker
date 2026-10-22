// @ts-check
/**
 * Backup, CSV export, the export of everything (CSV, Excel or PDF) and
 * import in the browser: reads and writes the database, builds File
 * objects and hands them to the share sheet or a download link. The merge,
 * CSV, workbook and report logic is pure and lives in export-import.js and
 * core/ (export-all.js, xlsx.js, pdf.js).
 */
import { withTx, req, putAll, deleteDatabase } from './db.js';
import { getSettings, saveSettings } from './records.js';
import { photoBlob, photoUsage } from './runs.js';
import { DATA_STORES, validateBackupEnvelope } from './schema.js';
import {
  buildBackup, backupFileName, planImport, runsCsv, measurementsCsv, eventsCsv, encodePhoto, bytesToBase64,
  base64ToBytes,
} from './export-import.js';
import { allRunsCsv, allSheets, reportBlocks, localStamp } from '../core/export-all.js';
import { xlsxBytes } from '../core/xlsx.js';
import { pdfBytes } from '../core/pdf.js';
import { localDateKey } from '../core/time.js';
import { APP_VERSION } from '../../version.js';

/** Byte-order mark: Excel needs it to read a CSV file as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** @typedef {import('./export-import.js').MergeCounts} MergeCounts */
/** @typedef {{counts: Record<string, MergeCounts>, errors: string[], materialsAdded: number}} ImportResult */

/**
 * Every record of these stores, tombstones included, read in one
 * transaction so the stores agree with each other.
 * @param {readonly string[]} stores
 * @returns {Promise<Record<string, any[]>>}
 */
async function readStores(stores) {
  const lists = await withTx([...stores], 'readonly',
    (tx) => Promise.all(stores.map((s) => req(tx.objectStore(s).getAll()))));
  return Object.fromEntries(stores.map((s, i) => [s, lists[i]]));
}

/**
 * About how many bytes the photos add to a backup (base64 is 4/3 of the
 * image size).
 * @returns {Promise<number>}
 */
export async function estimatePhotoBytes() {
  const { bytes } = await photoUsage();
  return Math.ceil(bytes / 3) * 4;
}

/**
 * A stored photo with its image as base64. Deleted photos travel without
 * their image: no screen can show them again, and they would only bloat
 * the file.
 * @param {any} rec stored photo record
 * @returns {Promise<{rec: any, ok: boolean}>} ok is false when a live photo had no readable image
 */
async function encodeStoredPhoto(rec) {
  const blob = rec.deleted ? null : photoBlob(rec);
  if (blob) {
    try {
      const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      return { rec: encodePhoto(rec, data, blob.type || rec.type || 'image/jpeg'), ok: true };
    } catch { /* unreadable image: keep the record without it */ }
  }
  return { rec: encodePhoto(rec, null), ok: !!rec.deleted };
}

/**
 * The JSON backup as a File. It holds every record, tombstones included, so
 * deletions travel too. With includePhotos each photo's image is embedded
 * as base64. The JSON is assembled in parts, one per photo, so a large
 * backup never needs one giant string.
 * @param {{includePhotos?: boolean, onWarning?: (message: string) => void}} [opts]
 * @returns {Promise<File>}
 */
export async function makeBackupFile(opts = {}) {
  const withPhotos = !!opts.includePhotos;
  const stores = withPhotos ? DATA_STORES : DATA_STORES.filter((s) => s !== 'photos');
  const [all, settings] = await Promise.all([readStores(stores), getSettings()]);
  const now = new Date();
  const json = JSON.stringify(buildBackup({
    tools: all.tools, templates: all.templates, runs: all.runs, measurements: all.measurements, events: all.events,
    settings, appVersion: APP_VERSION, exportedAt: now.toISOString(),
  }));
  /** @type {BlobPart[]} */
  const parts = [json];
  if (withPhotos) {
    // The same JSON as buildBackup({..., photos}), where "photos" is the last key.
    parts[0] = `${json.slice(0, -1)},"photos":[`;
    let missing = 0;
    for (let i = 0; i < all.photos.length; i++) {
      const { rec, ok } = await encodeStoredPhoto(all.photos[i]);
      if (!ok) missing += 1;
      parts.push(`${i ? ',' : ''}${JSON.stringify(rec)}`);
    }
    parts.push(']}');
    if (missing) {
      opts.onWarning?.(`${missing} photo${missing === 1 ? ' has' : 's have'} no readable image and went into the backup without it.`);
    }
  }
  return new File(parts, backupFileName(now), { type: 'application/json' });
}

/**
 * runs.csv, measurements.csv and events.csv as UTF-8 files with a
 * byte-order mark, so Excel shows µ, Ω and ° correctly.
 * @returns {Promise<File[]>}
 */
export async function makeCsvFiles() {
  const all = await readStores(['tools', 'templates', 'runs', 'measurements', 'events']);
  const csv = (/** @type {string} */ name, /** @type {string} */ text) => new File([BOM + text], name, { type: 'text/csv' });
  return [
    csv('runs.csv', runsCsv(all.runs, all.tools, all.templates)),
    csv('measurements.csv', measurementsCsv(all.measurements, all.runs, all.tools)),
    csv('events.csv', eventsCsv(all.events, all.tools)),
  ];
}

/** The formats of the export of everything. */
export const ALL_FORMATS = Object.freeze(/** @type {const} */ (['csv', 'xlsx', 'pdf']));

/**
 * Everything in one file: every run with its parameters, results and
 * measurements, as one CSV table, an Excel workbook or a PDF report (the
 * workbook and the report also hold the tool events).
 * @param {'csv' | 'xlsx' | 'pdf'} format
 * @param {Date} [now]
 * @returns {Promise<File[]>}
 */
export async function makeAllExport(format, now = new Date()) {
  const [all, settings] = await Promise.all([readStores(['tools', 'templates', 'runs', 'measurements', 'events']), getSettings()]);
  const input = { tools: all.tools, templates: all.templates, runs: all.runs, measurements: all.measurements, events: all.events };
  const base = `lnf-runlog-all-${localDateKey(now)}`;
  // The bytes are a plain (not shared) buffer; newer TypeScript lib types need telling.
  const part = (/** @type {Uint8Array} */ bytes) => /** @type {BlobPart} */ (/** @type {unknown} */ (bytes));
  if (format === 'csv') return [new File([BOM + allRunsCsv(input)], `${base}.csv`, { type: 'text/csv' })];
  if (format === 'xlsx') {
    return [new File([part(xlsxBytes(allSheets(input)))], `${base}.xlsx`,
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })];
  }
  const blocks = reportBlocks(input, { now: now.getTime(), who: settings.userName ? `by ${settings.userName}` : '' });
  const pdf = pdfBytes(blocks, { title: 'LNF Run Log: all runs', footer: `LNF Run Log, exported ${localStamp(now.getTime())}` });
  return [new File([part(pdf)], `${base}.pdf`, { type: 'application/pdf' })];
}

/**
 * @param {File[]} files
 * @returns {boolean} true when the share sheet can take these files
 */
export function canShareFiles(files) {
  const nav = /** @type {any} */ (globalThis.navigator);
  try {
    return !!nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && !!nav.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * Open the share sheet (Files, Drive, email...). Call it straight from a
 * tap with no await before it: iOS opens the sheet only from a fresh tap.
 * @param {File[]} files
 * @param {string} title
 * @returns {Promise<'shared' | 'cancelled' | 'unsupported'>}
 */
export async function shareFiles(files, title) {
  if (!canShareFiles(files)) return 'unsupported';
  try {
    await navigator.share({ files, title });
    return 'shared';
  } catch (err) {
    if (err && /** @type {any} */ (err).name === 'AbortError') return 'cancelled';
    throw err;
  }
}

/**
 * Save a file through a temporary download link. The object URL is revoked
 * a minute later, once the browser has taken the file.
 * @param {File} file
 */
export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Record that a backup left the device (drives the Home reminder).
 * @returns {Promise<string>} the new lastExportAt
 */
export async function markExported() {
  const at = new Date().toISOString();
  await saveSettings({ lastExportAt: at });
  return at;
}

/**
 * A planned photo with its base64 `data` turned back into a Blob of its
 * `type`.
 * @param {any} rec
 * @returns {any}
 */
function decodePhoto(rec) {
  if (typeof rec.data !== 'string') return rec;
  const out = { ...rec };
  delete out.data;
  out.type = typeof rec.type === 'string' && rec.type ? rec.type : 'image/jpeg';
  out.blob = new Blob([base64ToBytes(rec.data)], { type: out.type });
  return out;
}

/**
 * Older Safari cannot store Blobs: keep the image as an ArrayBuffer and
 * its type, as runs.js addPhoto does (photoBlob reads both).
 * @param {any} rec
 * @returns {Promise<any>}
 */
async function blobToBytes(rec) {
  if (!(rec.blob instanceof Blob)) return rec;
  return { ...rec, blob: null, bytes: await rec.blob.arrayBuffer(), type: rec.blob.type || rec.type || 'image/jpeg' };
}

/**
 * Merge a backup file into this device's data (spec Section 12). Records
 * match by id and an incoming record wins only when it is newer; nothing is
 * deleted or wiped. Every write, including new material names, happens in
 * one transaction, so a failed import changes nothing.
 * @param {Blob} file
 * @returns {Promise<ImportResult>}
 * @throws {Error} with a readable message when the file is not a usable backup
 */
export async function importBackupFile(file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    throw new Error(`Could not read the file (${err instanceof Error ? err.message : String(err)}).`);
  }
  let backup;
  try {
    backup = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
  } catch {
    throw new Error('This file is not an LNF Run Log backup: it is not valid JSON. Choose a file named lnf-runlog-backup-….json.');
  }
  const problems = validateBackupEnvelope(backup);
  if (problems.length) throw new Error(problems.join(' '));
  const [existing, settings] = await Promise.all([readStores(DATA_STORES), getSettings()]);
  const local = Array.isArray(settings.materials) ? settings.materials : [];
  const plan = planImport(existing, backup, local);
  /** @type {Record<string, any[]>} */
  const writes = { ...plan.put, photos: plan.put.photos.map(decodePhoto) };
  if (plan.materials) writes.meta = [{ key: 'settings', value: { ...settings, materials: plan.materials } }];
  try {
    await putAll(writes);
  } catch (err) {
    // Old Safari's DOMException is not always an Error, so test the name only.
    if (!err || /** @type {any} */ (err).name !== 'DataCloneError' || !writes.photos.length) throw err;
    writes.photos = await Promise.all(writes.photos.map(blobToBytes));
    await putAll(writes);
  }
  return {
    counts: plan.counts,
    errors: plan.errors,
    materialsAdded: plan.materials ? plan.materials.length - local.length : 0,
  };
}

/**
 * Delete the whole database on this device (Settings -> Erase all data).
 * The app re-creates it, with the example tools, on the next load.
 * @returns {Promise<void>}
 */
export function eraseAllData() {
  return deleteDatabase();
}
