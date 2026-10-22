// @ts-check
/**
 * Project folders: create, rename, move and delete, and moving or deleting
 * several projects at once. A change that touches several records (a
 * folder and what it holds) is written in one transaction, and returns the
 * previous values so the toast can offer Undo. Deletes are soft, as
 * everywhere: tombstones that sync.
 */
import { createRecord, updateRecord, getRecord, listLive, saveMany } from './records.js';
import { folderTree, folderDeletePlan, undoPatch, canMoveFolder } from '../core/folders.js';

/** @typedef {import('../core/types.js').Folder} Folder */

/** @typedef {import('../core/folders.js').Change} Change */

/** @returns {Promise<Folder[]>} live folders */
export function listFolders() {
  return listLive('folders');
}

/**
 * @param {Folder | Record<string, any>} f
 * @returns {Promise<Folder>}
 */
export function saveFolder(f) {
  return f.createdAt ? updateRecord('folders', f) : createRecord('folders', { ...f, name: String(f.name || '').trim() });
}

/**
 * Apply a change in one transaction.
 * @param {Partial<Change>} change
 * @returns {Promise<Change>} the previous values, for restoreChange
 */
async function apply(change) {
  /** @type {Record<string, any[]>} */
  const put = { folders: [], projects: [] };
  /** @type {Change} */
  const undo = { folders: [], projects: [] };
  for (const store of /** @type {const} */ (['folders', 'projects'])) {
    for (const { id, patch } of change[store] || []) {
      const cur = await getRecord(store, id);
      if (!cur) continue;
      undo[store].push({ id, patch: undoPatch(cur, patch) });
      put[store].push({ ...cur, ...patch });
    }
  }
  await saveMany(put);
  return undo;
}

/**
 * Undo a change: put back the values it returned.
 * @param {Change} undo
 * @returns {Promise<void>}
 */
export async function restoreChange(undo) {
  await apply(undo);
}

/**
 * @param {readonly string[]} projectIds
 * @param {string | null} folderId null: the top level
 * @returns {Promise<Change>}
 */
export function moveProjects(projectIds, folderId) {
  return apply({ projects: projectIds.map((id) => ({ id, patch: { folderId } })) });
}

/**
 * Soft delete several projects; their runs keep their links, which the
 * screens then ignore.
 * @param {readonly string[]} projectIds
 * @returns {Promise<Change>}
 */
export function deleteProjects(projectIds) {
  return apply({ projects: projectIds.map((id) => ({ id, patch: { deleted: true } })) });
}

/**
 * Move a folder, checked against the folders as stored now (the screen's
 * list may be out of date): never into itself or a folder inside it.
 * @param {string} id
 * @param {string | null} parentId null: the top level
 * @returns {Promise<Change>}
 */
export async function moveFolder(id, parentId) {
  if (!canMoveFolder(folderTree(await listFolders()), id, parentId)) {
    throw new Error('A folder cannot go into itself or into a folder inside it.');
  }
  return apply({ folders: [{ id, patch: { parentId } }] });
}

/**
 * Delete a folder (folderDeletePlan): with its contents, every folder and
 * project inside it goes too; without, what it holds moves up into its
 * parent.
 * @param {string} id
 * @param {boolean} withContents
 * @returns {Promise<Change>}
 */
export async function deleteFolder(id, withContents) {
  const [folders, projects] = await Promise.all([listFolders(), listLive('projects')]);
  return apply(folderDeletePlan(folderTree(folders), projects, id, withContents));
}
