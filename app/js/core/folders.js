// @ts-check
/**
 * Folders organise projects, and folders can hold folders. A folder names
 * its parent (parentId, null at the top level) and a project its folder
 * (folderId, null at the top level). Folders sync like every other record,
 * so a folder's parent may be deleted on another device, or two devices may
 * move two folders into each other at the same time. The tree built here
 * repairs both, the same way on every device. Pure: no DOM and no storage.
 */

/** @typedef {import('./types.js').Folder} Folder */
/** @typedef {import('./types.js').Project} Project */

/**
 * @typedef {Object} FolderTree
 * @property {Map<string, Folder>} byId live folders by id
 * @property {Map<string, string | null>} parent where each folder shows: its parent's id, or null for the top level
 * @property {Map<string | null, Folder[]>} children the folders in each folder (key null: the top level), by name
 */

/**
 * Names in the order people expect: "Batch 2" before "Batch 10".
 * @param {Folder} a
 * @param {Folder} b
 */
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The folder tree. A folder whose parent is missing or deleted shows at the
 * top level. In a loop of folders (A in B and B in A), the one with the
 * lowest id moves to the top level, so every device draws the same tree.
 * @param {readonly Folder[]} folders tombstones are ignored
 * @returns {FolderTree}
 */
export function folderTree(folders) {
  const live = folders.filter((f) => f && !f.deleted && typeof f.id === 'string');
  const byId = new Map(live.map((f) => [f.id, f]));
  /** @type {Map<string, string | null>} */
  const parent = new Map();
  for (const f of live) parent.set(f.id, f.parentId && f.parentId !== f.id && byId.has(f.parentId) ? f.parentId : null);
  for (const f of live) {
    /** @type {string[]} */
    const seen = [];
    /** @type {string | null} */
    let cur = f.id;
    while (cur !== null && !seen.includes(cur)) {
      seen.push(cur);
      cur = parent.get(cur) ?? null;
    }
    if (cur !== null) {
      const loop = seen.slice(seen.indexOf(cur));
      parent.set(loop.reduce((a, b) => (b < a ? b : a)), null);
    }
  }
  /** @type {Map<string | null, Folder[]>} */
  const children = new Map([[null, []]]);
  for (const f of live) children.set(f.id, []);
  for (const f of live) children.get(parent.get(f.id) ?? null)?.push(f);
  for (const list of children.values()) list.sort(byName);
  return { byId, parent, children };
}

/**
 * The folders from the top level down to this one (empty for the top level
 * or an unknown folder).
 * @param {FolderTree} tree
 * @param {string | null | undefined} id
 * @returns {Folder[]}
 */
export function folderPath(tree, id) {
  /** @type {Folder[]} */
  const out = [];
  let cur = id && tree.byId.has(id) ? id : null;
  while (cur !== null && out.length <= tree.byId.size) {
    out.unshift(/** @type {Folder} */ (tree.byId.get(cur)));
    cur = tree.parent.get(cur) ?? null;
  }
  return out;
}

/**
 * "Thesis › Chapter 3", or '' for the top level.
 * @param {FolderTree} tree
 * @param {string | null | undefined} id
 * @param {string} [sep]
 * @returns {string}
 */
export function pathText(tree, id, sep = ' › ') {
  return folderPath(tree, id).map((f) => f.name).join(sep);
}

/**
 * The folder a project shows in: its folder, or null for the top level
 * (also when its folder was deleted on another device).
 * @param {FolderTree} tree
 * @param {{folderId?: string | null} | null | undefined} project
 * @returns {string | null}
 */
export function projectFolderId(tree, project) {
  const id = project && project.folderId;
  return id && tree.byId.has(id) ? id : null;
}

/**
 * This folder and every folder inside it, at any depth.
 * @param {FolderTree} tree
 * @param {string} id
 * @returns {Set<string>}
 */
export function subtreeIds(tree, id) {
  /** @type {Set<string>} */
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = /** @type {string} */ (stack.pop());
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of tree.children.get(cur) || []) stack.push(c.id);
  }
  return out;
}

/**
 * Whether a folder may move into target (null: the top level): never into
 * itself or a folder inside it.
 * @param {FolderTree} tree
 * @param {string} id
 * @param {string | null} target
 * @returns {boolean}
 */
export function canMoveFolder(tree, id, target) {
  return target === null || (tree.byId.has(target) && !subtreeIds(tree, id).has(target));
}

/**
 * Every folder in tree order, for pickers.
 * @param {FolderTree} tree
 * @param {string | null} [skip] leave out this folder and those inside it (where a folder cannot move)
 * @returns {{folder: Folder, depth: number}[]} depth 0 is the top level
 */
export function folderOptions(tree, skip = null) {
  /** @type {{folder: Folder, depth: number}[]} */
  const out = [];
  /** @param {string | null} parentId @param {number} depth */
  const walk = (parentId, depth) => {
    for (const f of tree.children.get(parentId) || []) {
      if (f.id === skip) continue;
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * The projects shown directly in a folder.
 * @template {{folderId?: string | null}} P
 * @param {FolderTree} tree
 * @param {readonly P[]} projects
 * @param {string | null} folderId null: the top level
 * @returns {P[]}
 */
export function projectsIn(tree, projects, folderId) {
  return projects.filter((p) => projectFolderId(tree, p) === folderId);
}

/**
 * What a folder holds: projects at any depth (and how many of them are
 * active) and folders at any depth.
 * @param {FolderTree} tree
 * @param {readonly Project[]} projects live projects
 * @param {string} id
 * @returns {{projects: number, active: number, folders: number}}
 */
export function folderCounts(tree, projects, id) {
  const ids = subtreeIds(tree, id);
  const inside = projects.filter((p) => ids.has(projectFolderId(tree, p) ?? ''));
  return { projects: inside.length, active: inside.filter((p) => p.status === 'active').length, folders: ids.size - 1 };
}

/**
 * "3 projects (1 active), 2 folders", or "Empty".
 * @param {{projects: number, active: number, folders: number}} c
 * @returns {string}
 */
export function countsText(c) {
  const parts = [];
  if (c.projects) parts.push(`${c.projects} project${c.projects === 1 ? '' : 's'}${c.active ? ` (${c.active} active)` : ''}`);
  if (c.folders) parts.push(`${c.folders} folder${c.folders === 1 ? '' : 's'}`);
  return parts.join(', ') || 'Empty';
}

/**
 * Field changes to some folders and projects, as {id, patch} pairs: a
 * change to write, or the values that undo one.
 * @typedef {{folders: {id: string, patch: Record<string, any>}[], projects: {id: string, patch: Record<string, any>}[]}} Change
 */

/**
 * What deleting a folder changes. With its contents: the folder, every
 * folder inside it and every project in them are deleted. Without: the
 * folder is deleted and what it holds moves up into its parent; a moved
 * folder whose name a folder there already has is renamed "Name (from
 * Deleted)", so two folders in one place never share a name. Built from the
 * repaired tree, so a folder in a loop or under a deleted parent counts
 * where the screens show it.
 * @param {FolderTree} tree
 * @param {readonly {id: string, folderId?: string | null}[]} projects live projects
 * @param {string} id
 * @param {boolean} withContents
 * @returns {Change}
 */
export function folderDeletePlan(tree, projects, id, withContents) {
  const gone = tree.byId.get(id);
  if (!gone) return { folders: [], projects: [] };
  if (withContents) {
    const ids = subtreeIds(tree, id);
    return {
      folders: [...ids].map((fid) => ({ id: fid, patch: { deleted: true } })),
      projects: projects.filter((p) => ids.has(projectFolderId(tree, p) ?? '')).map((p) => ({ id: p.id, patch: { deleted: true } })),
    };
  }
  const up = tree.parent.get(id) ?? null;
  const key = (/** @type {string} */ n) => n.trim().toLocaleLowerCase();
  const taken = new Set((tree.children.get(up) || []).filter((f) => f.id !== id).map((f) => key(f.name)));
  const moved = (tree.children.get(id) || []).map((f) => {
    let name = f.name;
    if (taken.has(key(name))) {
      const long = `${f.name} (from ${gone.name})`;
      // Within the name limit, with room for a counter, so the renamed folder can still be renamed.
      const base = long.length > MAX_FOLDER_NAME - 3 ? `${long.slice(0, MAX_FOLDER_NAME - 4).trimEnd()}…` : long;
      name = base;
      for (let i = 2; taken.has(key(name)); i++) name = `${base} ${i}`;
    }
    taken.add(key(name));
    return { id: f.id, patch: name === f.name ? { parentId: up } : { parentId: up, name } };
  });
  return {
    folders: [{ id, patch: { deleted: true } }, ...moved],
    projects: projects.filter((p) => projectFolderId(tree, p) === id).map((p) => ({ id: p.id, patch: { folderId: up } })),
  };
}

/**
 * The patch that puts a record's fields back as they were before `patch`
 * (a missing field comes back as null).
 * @param {Record<string, any>} cur the record before the change
 * @param {Record<string, any>} patch
 * @returns {Record<string, any>}
 */
export function undoPatch(cur, patch) {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, cur[k] ?? null]));
}

export const MAX_FOLDER_NAME = 80;

/**
 * Whether another folder in the same place has this name (case and
 * surrounding spaces ignored).
 * @param {FolderTree} tree
 * @param {string} name
 * @param {string | null} parentId where the folder is or goes
 * @param {string | null} [selfId] the folder itself, which does not count
 * @returns {boolean}
 */
export function folderNameClash(tree, name, parentId, selfId = null) {
  const key = String(name || '').trim().toLocaleLowerCase();
  return (tree.children.get(parentId) || []).some((f) => f.id !== selfId && f.name.trim().toLocaleLowerCase() === key);
}

/**
 * What is wrong with a folder name, or '' when it is fine: it needs some
 * text and must differ from the other folders in the same place.
 * @param {FolderTree} tree
 * @param {string} name
 * @param {string | null} parentId where the folder is or goes
 * @param {string | null} [selfId] the folder being renamed
 * @returns {string}
 */
export function folderNameProblem(tree, name, parentId, selfId = null) {
  const n = String(name || '').trim();
  if (!n) return 'Give the folder a name.';
  if (n.length > MAX_FOLDER_NAME) return `Keep the name under ${MAX_FOLDER_NAME} characters.`;
  return folderNameClash(tree, n, parentId, selfId) ? `There is already a folder called “${n}” here.` : '';
}
