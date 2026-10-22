// @ts-check
/**
 * Folders for projects: a sheet to choose where a project or a folder goes
 * (the top level or any folder, indented by depth, with "New folder" one tap
 * away), and a small form for a folder's name and place.
 */
import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, sheet, errorText, labelRow } from './components.js';
import { textInput } from './fields.js';
import { saveFolder } from '../data/repo.js';
import { folderTree, folderOptions, folderNameProblem, pathText, folderPath } from '../core/folders.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/types.js').Folder} Folder */

/**
 * The places a folder or project can go, for a native select: the top level,
 * then every folder indented by depth.
 * @param {import('../core/folders.js').FolderTree} tree
 * @param {string | null} value
 * @param {string | null} [skip] a folder that cannot hold the thing (itself, when moving a folder)
 * @returns {HTMLOptionElement[]}
 */
function placeOptions(tree, value, skip = null) {
  return [
    /** @type {HTMLOptionElement} */ (h('option', { value: '', selected: value === null }, 'Top level (no folder)')),
    ...folderOptions(tree, skip).map(({ folder, depth }) => /** @type {HTMLOptionElement} */ (h('option', {
      value: folder.id, selected: folder.id === value, 'aria-label': pathText(tree, folder.id),
    }, `${'   '.repeat(depth + 1)}${folder.name}`))),
  ];
}

/**
 * A folder's name and, with askParent, its place, in a sheet.
 * @param {{title: string, folders: readonly Folder[], name?: string, parentId: string | null, selfId?: string | null,
 *   askParent?: boolean, skip?: string | null, saveLabel: string,
 *   onSave: (name: string, parentId: string | null) => Promise<void> | void}} o
 *   selfId: the folder being renamed; skip: a folder the new one cannot go into
 */
export function folderForm(o) {
  const tree = folderTree(o.folders);
  const nameId = uid('folder-name');
  const placeId = uid('folder-place');
  let name = o.name || '';
  let parentId = o.parentId && tree.byId.has(o.parentId) ? o.parentId : null;
  const err = h('p', { class: 'field-error', role: 'alert' });
  const input = textInput({ id: nameId, value: name, onChange: (v) => { name = v || ''; err.textContent = ''; } });
  const place = o.askParent ? /** @type {HTMLSelectElement} */ (h('select', { id: placeId, class: 'input' }, placeOptions(tree, parentId, o.skip))) : null;
  place?.addEventListener('change', () => { parentId = place.value || null; err.textContent = ''; });
  let busy = false;
  const save = async () => {
    const problem = folderNameProblem(tree, name, parentId, o.selfId ?? null);
    if (problem) { err.textContent = problem; input.focus(); return; }
    if (busy) return;
    busy = true;
    try {
      await o.onSave(name.trim(), parentId);
      s.close();
    } catch (e) {
      err.textContent = errorText(e);
    } finally {
      busy = false;
    }
  };
  const s = sheet(o.title, [h('form', { class: 'stack', onSubmit: (/** @type {Event} */ e) => { e.preventDefault(); save(); } },
    h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: nameId }, 'Folder name'), 'Folder name', HELP.folderName), input.el),
    place ? h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: placeId }, 'Inside'), 'Inside', HELP.folderPlace), place) : null,
    err,
    button(o.saveLabel, { kind: 'primary', icon: 'check', type: 'submit', big: true }))]);
  input.focus();
  return s;
}

/**
 * Choose a folder in a sheet. "New folder" makes one and chooses it.
 * @param {{title: string, folders: readonly Folder[], current: string | null, skip?: string | null,
 *   onPick: (folderId: string | null) => void | Promise<void>}} o
 *   current: where the thing is now (marked, and not offered); skip: a folder being moved, which cannot go into itself
 */
export function chooseFolder(o) {
  const tree = folderTree(o.folders);
  const rows = [
    { id: /** @type {string | null} */ (null), name: 'Top level (no folder)', depth: 0 },
    ...folderOptions(tree, o.skip).map(({ folder, depth }) => ({ id: /** @type {string | null} */ (folder.id), name: folder.name, depth: depth + 1 })),
  ];
  const s = sheet(o.title, [
    h('div', { class: 'list folder-list' }, rows.map((r) => {
      const here = r.id === o.current;
      // Nesting shows by indentation; a screen reader hears where the folder is: "Batch 2, in Chapter 3, in Thesis".
      const path = r.id ? folderPath(tree, r.id).map((f) => f.name).reverse().join(', in ') : r.name;
      return h('button', {
        type: 'button', class: 'row', disabled: here, style: { paddingInlineStart: `${0.75 + r.depth * 1.1}rem` },
        'aria-label': here ? `${path} (here now)` : path,
        onClick: () => { s.close(); o.onPick(r.id); },
      }, h('span', { class: 'row-lead' }, icon(r.id ? 'folder' : 'list')),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.name), here ? h('span', { class: 'row-sub' }, 'Here now') : null));
    })),
    button('New folder', {
      icon: 'folderPlus',
      onClick: () => {
        s.close();
        folderForm({
          title: 'New folder', folders: o.folders, parentId: o.current, askParent: true, skip: o.skip, saveLabel: 'Create and choose',
          onSave: async (name, parentId) => {
            const f = await saveFolder({ name, parentId });
            await o.onPick(f.id);
          },
        });
      },
    }),
  ]);
  return s;
}
