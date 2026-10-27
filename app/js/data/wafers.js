// @ts-check
/**
 * Saved wafers and masks: specs the person keeps to add to projects. A
 * mask is stored here like a wafer, with spec.kind "mask". The LNF store's
 * items are not stored: they come with the app (data/lnf-store.js), and
 * "Copy to your types" turns one into a saved entry.
 */
import { createRecord, updateRecord, getLive, getRecord, listLive, softDelete, restoreRecord } from './records.js';
import { cleanSpec } from '../core/wafer-spec.js';

/** @typedef {import('../core/types.js').SavedWafer} SavedWafer */

/**
 * @returns {Promise<SavedWafer[]>} live saved entries: wafers first, then masks, each by name
 */
export async function listSavedWafers() {
  const all = /** @type {SavedWafer[]} */ (await listLive('wafers'));
  const rank = (/** @type {SavedWafer} */ w) => (w.spec?.kind === 'mask' ? 1 : 0);
  return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * @param {string} id
 * @returns {Promise<SavedWafer | null>}
 */
export function getSavedWafer(id) {
  return getLive('wafers', id);
}

/**
 * A saved entry even when deleted, so a project can still show where its wafer came from.
 * @param {string} id
 * @returns {Promise<SavedWafer | null>}
 */
export function getSavedWaferRecord(id) {
  return getRecord('wafers', id);
}

/**
 * @param {SavedWafer | Record<string, any>} w
 * @returns {Promise<SavedWafer>}
 */
export function saveSavedWafer(w) {
  const rec = { ...w, name: String(w.name || '').trim(), spec: cleanSpec(w.spec) };
  return /** @type {any} */ (rec).createdAt ? updateRecord('wafers', rec) : createRecord('wafers', rec);
}

/**
 * Soft delete; projects keep their own copy of the spec.
 * @param {string} id
 * @returns {Promise<SavedWafer | null>}
 */
export function deleteSavedWafer(id) {
  return softDelete('wafers', id);
}

/**
 * @param {string} id
 * @returns {Promise<SavedWafer | null>}
 */
export function restoreSavedWafer(id) {
  return restoreRecord('wafers', id);
}
