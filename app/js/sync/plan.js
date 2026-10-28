// @ts-check
/**
 * Pure parts of sync. Each device keeps one snapshot file in the repository
 * (all its records, tombstones included, but no photos). Sync merges the
 * other devices' snapshots into this device by id:
 * - the newer `updatedAt` wins;
 * - an equal one goes to the higher `deviceId`, so every device ends up with
 *   the same version;
 * - deletions travel as tombstones and nothing is ever removed.
 */
import { planImport, cleanKinds } from '../data/export-import.js';
import { SCHEMA_VERSION } from '../data/schema.js';

export const SYNC_FORMAT = 'lnf-runlog-sync';
/** Folder in the repository that holds one file per device. */
export const SYNC_DIR = 'lnf-runlog-sync/devices';
export const SYNC_EXT = '.lnfsync';
/** Stores that sync. Photos are too large and stay on the device that took them. */
export const SYNC_STORES = Object.freeze(['tools', 'templates', 'runs', 'measurements', 'events', 'projects', 'folders', 'wafers']);
/** Stores a snapshot may lack: devices on an app version from before they existed write none. */
const OPTIONAL_STORES = Object.freeze(['projects', 'folders', 'wafers']);
/**
 * What a device's merge of another's file covers: the stores, then the answers about materials (1.5.1). A file
 * merged by a version that covered less is read once more.
 */
export const SYNC_SCOPE = [...SYNC_STORES, 'materialKinds'].join(',');

/**
 * @param {string} deviceId
 * @returns {string} the device's file path in the repository
 */
export function syncPath(deviceId) {
  return `${SYNC_DIR}/${deviceId}${SYNC_EXT}`;
}

/**
 * @param {string} fileName e.g. "3f2c….lnfsync"
 * @returns {string | null} the device id, or null for other files
 */
export function deviceIdOf(fileName) {
  return fileName.endsWith(SYNC_EXT) ? fileName.slice(0, -SYNC_EXT.length) : null;
}

/**
 * This device's snapshot. `materialKinds` (what the person said materials
 * are) is new in 1.5.1; older apps read the snapshot without it.
 * @param {{records: Record<string, any[]>, materials: string[], materialKinds?: import('../core/types.js').MaterialKinds,
 *   deviceId: string, deviceName: string, author: string, appVersion: string, now: string}} o
 * @returns {Record<string, any>}
 */
export function buildSnapshot(o) {
  /** @type {Record<string, any[]>} */
  const stores = {};
  for (const s of SYNC_STORES) stores[s] = o.records[s] || [];
  return {
    format: SYNC_FORMAT,
    version: SCHEMA_VERSION,
    appVersion: o.appVersion,
    exportedAt: o.now,
    deviceId: o.deviceId,
    deviceName: o.deviceName,
    author: o.author,
    stores,
    materials: o.materials,
    materialKinds: cleanKinds(o.materialKinds),
  };
}

/**
 * @param {any} snap
 * @returns {string[]} problems; empty when the snapshot can be merged
 */
export function validateSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return ['not a sync file'];
  if (snap.format !== SYNC_FORMAT) return ['not an LNF Run Log sync file'];
  if (!Number.isInteger(snap.version) || snap.version < 1) return ['no valid version'];
  if (snap.version > SCHEMA_VERSION) return [`written by a newer app version (format ${snap.version}); update this app`];
  if (typeof snap.deviceId !== 'string' || !snap.deviceId) return ['no device id'];
  if (!snap.stores || typeof snap.stores !== 'object') return ['no records'];
  for (const s of SYNC_STORES) {
    const missing = snap.stores[s] === undefined && OPTIONAL_STORES.includes(s);
    if (!missing && !Array.isArray(snap.stores[s])) return [`no ${s} list`];
  }
  return [];
}

/**
 * Plan merging another device's snapshot into this device.
 * @param {Record<string, any[]>} local this device's records per store, tombstones included
 * @param {any} snap a validated snapshot
 * @param {string[]} localMaterials
 * @param {import('../core/types.js').MaterialKinds} [localKinds] this device's answers about materials
 * @returns {import('../data/export-import.js').ImportPlan}
 */
export function planMerge(local, snap, localMaterials, localKinds = {}) {
  const asBackup = {
    format: 'lnf-runlog',
    version: snap.version,
    ...snap.stores,
    photos: [],
    settings: { materials: Array.isArray(snap.materials) ? snap.materials : [], materialKinds: snap.materialKinds },
  };
  return planImport(local, asBackup, localMaterials, { deviceTieBreak: true, kinds: localKinds });
}

/**
 * One-line summary of a sync result: "2 other devices · 5 added, 1 updated".
 * @param {{devices: number, read: number, added: number, updated: number, invalid: number, answers?: number} | null | undefined} r
 * @returns {string}
 */
export function describeResult(r) {
  if (!r) return '';
  const parts = [r.devices ? `${r.devices} other device${r.devices === 1 ? '' : 's'}` : 'no other devices yet'];
  if (r.read) parts.push(`${r.added} added, ${r.updated} updated`);
  else if (r.devices) parts.push('nothing new');
  if (r.answers) parts.push(`${r.answers} answer${r.answers === 1 ? '' : 's'} about materials`);
  if (r.invalid) parts.push(`${r.invalid} records refused`);
  return parts.join(' · ');
}

/**
 * Runs whose derived results may change after a merge: updated runs and the
 * runs of updated measurements.
 * @param {import('../data/export-import.js').ImportPlan} plan
 * @returns {string[]}
 */
export function touchedRuns(plan) {
  const ids = new Set();
  for (const r of plan.put.runs || []) ids.add(r.id);
  for (const m of plan.put.measurements || []) ids.add(m.runId);
  return [...ids];
}
