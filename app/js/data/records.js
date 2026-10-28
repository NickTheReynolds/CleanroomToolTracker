// @ts-check
/**
 * Generic record writes: id and timestamp stamping, validation, soft delete,
 * settings and autosaved form drafts. The prepare* functions are pure so
 * they can be tested in Node.
 */
import { getOne, putAll, putOne, deleteKey, getAll } from './db.js';
import { normalizeRecord, validateRecord } from './schema.js';
import { uuid } from '../core/ids.js';
import { toMs } from '../core/time.js';
import { normText } from '../core/vocab.js';

/**
 * @typedef {Object} Settings
 * @property {string} userName
 * @property {string} deviceName
 * @property {string} deviceId
 * @property {string} theme "system", "light" or "dark"
 * @property {string[]} materials
 * @property {import('../core/types.js').MaterialKinds} materialKinds what the person said materials are, for the plan
 *   checks; travels with the materials list in backups and sync
 * @property {Record<string, number>} tuning lookup overrides {halfLifeDays, eventPenalty, topK}
 * @property {string | null} lastExportAt
 * @property {boolean} iosHintDismissed
 * @property {boolean} persistAsked
 * @property {string | null} firstRunAt
 * @property {string} publicUrl published HTTPS address, for the install QR code
 * @property {import('../sync/sync.js').SyncConfig | null} sync GitHub sync settings (this device only)
 * @property {string[]} myTools ids of the tools this person uses; tool pickers show them first
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  userName: '',
  deviceName: '',
  deviceId: '',
  theme: 'system',
  materials: [],
  materialKinds: {},
  tuning: {},
  lastExportAt: null,
  iosHintDismissed: false,
  persistAsked: false,
  firstRunAt: null,
  publicUrl: '',
  sync: null,
  myTools: [],
});

/** Settings that belong to this device or person and stay out of backups. */
export const DEVICE_SETTINGS = Object.freeze([
  'userName', 'deviceName', 'deviceId', 'theme', 'lastExportAt', 'iosHintDismissed',
  'persistAsked', 'firstRunAt', 'sync', 'myTools',
]);

export class ValidationError extends Error {
  /**
   * @param {string} store
   * @param {string[]} errors
   */
  constructor(store, errors) {
    super(`Could not save ${store}: ${errors.join('; ')}`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/** @returns {Promise<Settings>} */
export async function getSettings() {
  const rec = await getOne('meta', 'settings');
  return { ...DEFAULT_SETTINGS, ...(rec && rec.value) };
}

/**
 * @param {Partial<Settings> & Record<string, unknown>} patch
 * @returns {Promise<Settings>}
 */
export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await putOne('meta', { key: 'settings', value: next });
  return next;
}

/**
 * Say what a material is for the plan checks: a MaterialKind, or "" to take
 * the answer back (kept as an empty answer, so taking it back syncs too). A
 * name given an answer joins the materials list. Answers sync; the newer wins.
 * @param {string} name
 * @param {string} kind
 * @param {{list?: string[]}} [o] list: the materials list to keep (Undo puts back the one from before)
 * @returns {Promise<Settings>}
 */
export async function saveMaterialKind(name, kind, o = {}) {
  const s = await getSettings();
  const clean = String(name || '').trim();
  const key = normText(clean);
  if (!key) return s;
  const kinds = { ...(s.materialKinds || {}) };
  kinds[key] = { name: clean, kind: kind || '', at: nextStamp(kinds[key]?.at) };
  const list = o.list || s.materials;
  const listed = list.some((m) => normText(m) === key);
  return saveSettings({ materialKinds: kinds, materials: kind && !listed ? [...list, clean] : list });
}

/**
 * Undo an answer: put back what was there before it (another answer, or
 * none) and the materials list `o.list`. While no sync has started since the
 * answer, the old answer comes back exactly as it was (none: no entry at
 * all), so the undone answer never leaves the device and cannot overwrite a
 * newer answer from another device; after one it comes back as a new change,
 * so the other devices undo it too. When the answer has changed since the
 * action being undone (`o.expect`, what that action wrote), it is left as it
 * is and only the list is put back.
 * @param {string} name
 * @param {import('../core/types.js').MaterialKindEntry | null} before
 * @param {{list?: string[], expect?: import('../core/types.js').MaterialKindEntry | null}} [o]
 * @returns {Promise<Settings>}
 */
export async function restoreMaterialKind(name, before, o = {}) {
  const s = await getSettings();
  const key = normText(String(name || '').trim());
  if (!key) return s;
  const kinds = { ...(s.materialKinds || {}) };
  const cur = kinds[key];
  const changed = o.expect !== undefined && (!cur || !o.expect || cur.at !== o.expect.at || cur.kind !== o.expect.kind);
  if (!changed) {
    const sync = /** @type {any} */ (s.sync) || {};
    const last = Math.max(...[toMs(sync.startedAt), toMs(sync.lastSyncAt)].filter(Number.isFinite));
    const sent = !!cur && Number.isFinite(last) && last >= toMs(cur.at);
    if (sent) kinds[key] = { name: before ? before.name : cur.name, kind: before ? before.kind : '', at: nextStamp(cur.at) };
    else if (before) kinds[key] = { ...before };
    else delete kinds[key];
  }
  const list = o.list || s.materials;
  const keep = kinds[key] && kinds[key].kind ? kinds[key].name : '';
  return saveSettings({ materialKinds: kinds, materials: keep && !list.some((m) => normText(m) === key) ? [...list, keep] : list });
}

/**
 * An ISO timestamp strictly later than `prev`, so every write moves
 * updatedAt forward even twice within one millisecond (merge relies on it).
 * @param {string | undefined} prev
 * @param {number} [now]
 * @returns {string}
 */
export function nextStamp(prev, now = Date.now()) {
  const p = toMs(prev);
  return new Date(Number.isFinite(p) && p >= now ? p + 1 : now).toISOString();
}

/**
 * Build a new record: id (unless given), timestamps, deviceId, author,
 * defaults, then validate.
 * @param {string} store
 * @param {Record<string, any>} fields
 * @param {{deviceId: string, userName: string}} who
 * @param {number} [now]
 * @returns {any}
 * @throws {ValidationError}
 */
export function prepareNew(store, fields, who, now = Date.now()) {
  const at = new Date(now).toISOString();
  const rec = normalizeRecord(store, {
    ...fields,
    id: fields.id || uuid(),
    createdAt: at,
    updatedAt: at,
    deleted: false,
    deviceId: who.deviceId,
    author: fields.author || who.userName,
  });
  const errs = validateRecord(store, rec);
  if (errs.length) throw new ValidationError(store, errs);
  return rec;
}

/**
 * Build the next version of an existing record. `author` keeps the
 * creator; `deviceId` becomes this device (the last writer).
 * @param {string} store
 * @param {Record<string, any>} rec
 * @param {{deviceId: string, userName: string}} who
 * @param {number} [now]
 * @returns {any}
 * @throws {ValidationError}
 */
export function prepareUpdate(store, rec, who, now = Date.now()) {
  const next = normalizeRecord(store, {
    ...rec,
    updatedAt: nextStamp(rec.updatedAt, now),
    deviceId: who.deviceId,
    author: rec.author || who.userName,
  });
  const errs = validateRecord(store, next);
  if (errs.length) throw new ValidationError(store, errs);
  return next;
}

/**
 * Create and store a record.
 * @param {string} store
 * @param {Record<string, any>} fields
 * @returns {Promise<any>} the stored record
 */
export async function createRecord(store, fields) {
  const rec = prepareNew(store, fields, await getSettings());
  await putOne(store, rec);
  return rec;
}

/**
 * Store a new version of an existing record.
 * @param {string} store
 * @param {Record<string, any>} rec
 * @returns {Promise<any>}
 */
export async function updateRecord(store, rec) {
  const next = prepareUpdate(store, rec, await getSettings());
  await putOne(store, next);
  return next;
}

/**
 * Create or update several records across stores in one transaction.
 * Records with a createdAt are treated as updates.
 * @param {Record<string, Record<string, any>[]>} byStore
 * @returns {Promise<Record<string, any[]>>} the stored versions
 */
export async function saveMany(byStore) {
  const who = await getSettings();
  /** @type {Record<string, any[]>} */
  const out = {};
  for (const [store, recs] of Object.entries(byStore)) {
    out[store] = recs.map((r) => (r.createdAt ? prepareUpdate(store, r, who) : prepareNew(store, r, who)));
  }
  await putAll(out);
  return out;
}

/**
 * @param {string} store
 * @param {string} id
 * @returns {Promise<any | null>} the record, tombstones included
 */
export async function getRecord(store, id) {
  if (!id) return null;
  return (await getOne(store, id)) || null;
}

/**
 * @param {string} store
 * @param {string} id
 * @returns {Promise<any | null>} the record unless missing or deleted
 */
export async function getLive(store, id) {
  const r = await getRecord(store, id);
  return r && !r.deleted ? r : null;
}

/**
 * All non-deleted records of a store, optionally through an index.
 * @param {string} store
 * @param {string} [index]
 * @param {IDBValidKey | IDBKeyRange} [query]
 * @returns {Promise<any[]>}
 */
export async function listLive(store, index, query) {
  return (await getAll(store, index, query)).filter((r) => !r.deleted);
}

/**
 * Soft delete: keep the record as a tombstone.
 * @param {string} store
 * @param {string} id
 * @returns {Promise<any | null>}
 */
export async function softDelete(store, id) {
  const rec = await getRecord(store, id);
  if (!rec || rec.deleted) return rec;
  return updateRecord(store, { ...rec, deleted: true });
}

/**
 * Undo a soft delete.
 * @param {string} store
 * @param {string} id
 * @returns {Promise<any | null>}
 */
export async function restoreRecord(store, id) {
  const rec = await getRecord(store, id);
  if (!rec || !rec.deleted) return rec;
  return updateRecord(store, { ...rec, deleted: false });
}

const DRAFT = 'draft:';

/**
 * @param {string} name e.g. "log", "measure:<runId>"
 * @returns {Promise<any>} the saved form state, or null
 */
export async function getDraft(name) {
  const r = await getOne('meta', DRAFT + name);
  return r ? r.value : null;
}

/**
 * Autosave an in-progress form.
 * @param {string} name
 * @param {any} value
 * @returns {Promise<void>}
 */
export function saveDraft(name, value) {
  return putOne('meta', { key: DRAFT + name, value, savedAt: new Date().toISOString() });
}

/**
 * @param {string} name
 * @returns {Promise<void>}
 */
export function clearDraft(name) {
  return deleteKey('meta', DRAFT + name);
}
