// @ts-check
/**
 * Projects, in folders: the folders here (with what each holds), then the
 * projects here, active first, then paused, finished (green) and failed
 * (red). Inside a folder: where it is, and rename,
 * move or delete it. Each project's card has Copy, which opens a new project
 * copied from it; "Select" picks projects to copy, move into a folder or
 * delete together. A project follows a batch of wafers from start to
 * finish; runs work without one, and several projects can run at once.
 */
import { h, append, fill } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  button, linkButton, section, emptyState, listRow, toast, confirmDialog, sheet, errorText,
} from '../ui/components.js';
import { projectCard } from '../ui/project-card.js';
import { chooseFolder, folderForm } from '../ui/folder-picker.js';
import { navigate, refresh } from '../router.js';
import {
  listProjects, listRuns, listTools, listFolders, saveFolder, moveProjects, deleteProjects, moveFolder, deleteFolder, restoreChange,
  copyProjects,
} from '../data/repo.js';
import { folderTree, folderPath, pathText, projectsIn, folderCounts, countsText, folderNameClash } from '../core/folders.js';
import { projectStatus } from '../core/projects.js';
import { PROJECT_STATUS_LABELS } from '../core/vocab.js';

/** @typedef {import('../core/types.js').Project} Project */
/** @typedef {import('../data/folders.js').Change} Change */

/**
 * Mark a button with a data attribute, so focus can find it again after a redraw.
 * @param {HTMLButtonElement} el
 * @param {string} attr
 * @returns {HTMLButtonElement}
 */
const marked = (el, attr) => { el.setAttribute(attr, ''); return el; };

/** @param {number} n @param {string} word */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @param {string | null} id a folder, or null for the top level
 * @returns {string} its route, e.g. "/folder/<id>"
 */
export const folderRoute = (id) => (id ? `/folder/${encodeURIComponent(id)}` : '/projects');

/**
 * Where a folder or project is, in words, from a fresh read (a folder made
 * in the picker is not in the screen's list yet).
 * @param {string | null} id
 * @returns {Promise<string>}
 */
async function placeName(id) {
  return pathText(folderTree(await listFolders()), id) || 'the top level';
}

/**
 * Report a change, with Undo.
 * @param {string} message
 * @param {Change} undo
 * @param {() => void} [after] what to show once undone (default: this screen again)
 */
function undoToast(message, undo, after = refresh) {
  toast(message, { action: { label: 'Undo', fn: async () => { await restoreChange(undo); after(); } } });
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const folderId = ctx.params.id || null;
  const [projects, folders, runs, tools] = await Promise.all([
    listProjects(), listFolders(), listRuns(), listTools({ includeArchived: true }),
  ]);
  const tree = folderTree(folders);
  const here = folderId ? tree.byId.get(folderId) || null : null;
  if (folderId && !here) {
    ctx.setTitle('Folder');
    append(ctx.root, [emptyState('This folder no longer exists.', linkButton('All projects', '#/projects'))]);
    return;
  }
  ctx.setTitle(here ? here.name : 'Projects');
  const toolMap = new Map(tools.map((t) => [t.id, t]));
  const subfolders = tree.children.get(folderId) || [];
  const mine = projectsIn(tree, projects, folderId);
  const upId = here ? tree.parent.get(here.id) ?? null : null;
  const newProjectHref = `#/project/new${folderId ? `?folder=${encodeURIComponent(folderId)}` : ''}`;
  let selecting = false;
  /** @type {Set<string>} */
  const picked = new Set();
  const body = h('div', { class: 'view' });

  const newFolder = () => folderForm({
    title: here ? `New folder in “${here.name}”` : 'New folder', folders, parentId: folderId, saveLabel: 'Create folder',
    onSave: async (name, parentId) => {
      await saveFolder({ name, parentId });
      toast('Folder created.');
      refresh();
    },
  });

  // This folder: rename, move, delete.
  const rename = (/** @type {import('../core/types.js').Folder} */ f) => folderForm({
    title: 'Rename folder', folders, name: f.name, parentId: upId, selfId: f.id, saveLabel: 'Save',
    onSave: async (name) => {
      await saveFolder({ ...f, name });
      toast('Folder renamed.');
      refresh();
    },
  });
  const move = (/** @type {import('../core/types.js').Folder} */ f) => chooseFolder({
    title: `Move “${f.name}” to`, folders, current: upId, skip: f.id,
    onPick: async (target) => {
      // A move keeps the name: only a folder of the same name already there stops it.
      if (folderNameClash(folderTree(await listFolders()), f.name, target, f.id)) {
        toast(`There is already a folder called “${f.name}” there.`, { kind: 'error' });
        return;
      }
      try {
        const undo = await moveFolder(f.id, target);
        undoToast(`Moved to ${await placeName(target)}.`, undo);
        refresh();
      } catch (err) {
        toast(errorText(err), { kind: 'error' });
      }
    },
  });
  const remove = async (/** @type {import('../core/types.js').Folder} */ f) => {
    const c = folderCounts(tree, projects, f.id);
    const gone = (/** @type {Change} */ undo) => {
      navigate(folderRoute(upId), { replace: true });
      undoToast('Folder deleted.', undo, () => navigate(folderRoute(f.id)));
    };
    if (!c.projects && !c.folders) {
      if (!await confirmDialog({ title: `Delete “${f.name}”?`, message: 'The folder is empty.', confirmLabel: 'Delete', danger: true })) return;
      gone(await deleteFolder(f.id, false));
      return;
    }
    const upName = pathText(tree, upId) || 'the top level';
    const s = sheet(`Delete “${f.name}”?`, [
      h('p', null, `It holds ${countsText(c)}.`),
      button('Delete the folder only', {
        big: true, icon: 'folder', onClick: async () => { s.close(); gone(await deleteFolder(f.id, false)); },
      }),
      h('p', { class: 'muted small' }, `What it holds moves to ${upName}.`),
      button(c.projects ? `Delete it and its ${plural(c.projects, 'project')}` : 'Delete it and the folders inside', {
        big: true, kind: 'danger', icon: 'trash', onClick: async () => { s.close(); gone(await deleteFolder(f.id, true)); },
      }),
      h('p', { class: 'muted small' }, 'Runs stay, without the deleted projects. You can undo for a few seconds; the records are kept as deleted.'),
    ]);
  };

  // Several projects at once.
  const copySelected = async () => {
    try {
      const made = await copyProjects(mine.filter((p) => picked.has(p.id)).map((p) => p.id));
      toast(made.length === 1 ? `Copied as “${made[0].name}”.` : `${plural(made.length, 'project')} copied.`, {
        action: { label: 'Undo', fn: async () => { await deleteProjects(made.map((p) => p.id)); refresh(); } },
      });
      refresh();
    } catch (err) {
      toast(errorText(err), { kind: 'error' });
    }
  };
  const moveSelected = () => chooseFolder({
    title: `Move ${plural(picked.size, 'project')} to`, folders, current: folderId,
    onPick: async (target) => {
      try {
        const n = picked.size;
        const undo = await moveProjects([...picked], target);
        undoToast(`${plural(n, 'project')} moved to ${await placeName(target)}.`, undo);
        refresh();
      } catch (err) {
        toast(errorText(err), { kind: 'error' });
      }
    },
  });
  const deleteSelected = async () => {
    const n = picked.size;
    if (!await confirmDialog({
      title: `Delete ${plural(n, 'project')}?`, confirmLabel: 'Delete', danger: true,
      message: 'Their runs stay, without the projects. You can undo for a few seconds; the records are kept as deleted.',
    })) return;
    undoToast(`${plural(n, 'project')} deleted.`, await deleteProjects([...picked]));
    refresh();
  };

  /** The Select all / Select none button, kept in step with the ticks. */
  let allBtn = /** @type {HTMLButtonElement | null} */ (null);
  /** How many are picked, in words (the bottom buttons may show only icons). */
  let pickedLine = /** @type {HTMLElement | null} */ (null);
  const allLabel = () => (picked.size === mine.length ? 'Select none' : 'Select all');
  const pickRow = (/** @type {Project} */ p) => {
    const btn = h('button', {
      type: 'button', class: 'row', role: 'checkbox', 'aria-checked': String(picked.has(p.id)), dataset: { project: p.id },
      onClick: () => {
        if (picked.has(p.id)) picked.delete(p.id);
        else picked.add(p.id);
        btn.setAttribute('aria-checked', String(picked.has(p.id)));
        if (allBtn) /** @type {Element} */ (allBtn.lastElementChild).textContent = allLabel();
        drawActions();
      },
    }, h('span', { class: 'row-lead' }, icon('project')),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, p.name),
      h('span', { class: 'row-sub' }, PROJECT_STATUS_LABELS[projectStatus(p)] || p.status)),
    h('span', { class: 'check-box', 'aria-hidden': 'true' }, icon('check', { size: 20 })));
    return btn;
  };
  const cards = (/** @type {Project[]} */ ps) => h('div', { class: 'stack' }, ps.map((p) => projectCard(p, runs, toolMap, { copy: true })));

  /** Focus a control of the redrawn screen (the one pressed was replaced). */
  const focusIn = (/** @type {string} */ sel) => { /** @type {HTMLElement | null} */ (document.querySelector(sel))?.focus(); };
  const drawActions = () => {
    if (pickedLine) pickedLine.textContent = picked.size ? `${plural(picked.size, 'project')} selected` : 'None selected';
    // On a narrow phone Copy, Move and Delete show only their icons (layout.css), so the four buttons fit.
    ctx.setActions(selecting ? [
      button('Cancel', { onClick: () => { selecting = false; picked.clear(); draw(); focusIn('[data-select-mode]'); } }),
      button(`Copy${picked.size ? ` (${picked.size})` : ''}`, { icon: 'copy', class: 'select-action', disabled: !picked.size, onClick: copySelected }),
      button(`Move${picked.size ? ` (${picked.size})` : ''}`, { icon: 'move', class: 'select-action', disabled: !picked.size, onClick: moveSelected }),
      button(`Delete${picked.size ? ` (${picked.size})` : ''}`, {
        icon: 'trash', kind: 'danger', class: 'select-action', disabled: !picked.size, onClick: deleteSelected,
      }),
    ] : [
      button('New folder', { icon: 'folderPlus', onClick: newFolder }),
      linkButton('New project', newProjectHref, { kind: 'primary', icon: 'plus' }),
    ]);
  };

  const draw = () => {
    const active = mine.filter((p) => p.status === 'active');
    const paused = mine.filter((p) => p.status === 'paused');
    const done = mine.filter((p) => projectStatus(p) === 'done');
    const failed = mine.filter((p) => projectStatus(p) === 'failed');
    const crumbs = here ? h('nav', { class: 'crumbs', 'aria-label': 'Folder path' },
      h('a', { href: '#/projects' }, icon('list', { size: 18 }), 'Projects'),
      folderPath(tree, here.id).map((f) => [h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›'),
        f.id === here.id ? h('span', { 'aria-current': 'page' }, f.name) : h('a', { href: `#${folderRoute(f.id)}` }, f.name)])) : null;
    fill(body,
      crumbs,
      !selecting && subfolders.length ? section(`Folders (${subfolders.length})`, h('div', { class: 'list' }, subfolders.map((f) => listRow({
        lead: icon('folder'), title: f.name, subtitle: countsText(folderCounts(tree, projects, f.id)), href: `#${folderRoute(f.id)}`,
      })))) : null,
      selecting ? section(`Select projects (${mine.length})`,
        h('div', { class: 'spread' }, pickedLine = h('p', { class: 'muted small', role: 'status' }), allBtn = marked(button(allLabel(), {
          kind: 'ghost', onClick: () => {
            if (picked.size === mine.length) picked.clear();
            else mine.forEach((p) => picked.add(p.id));
            draw();
            focusIn('[data-select-all]');
          },
        }), 'data-select-all')),
        h('div', { class: 'list' }, mine.map(pickRow)))
        : mine.length ? [
          h('div', { class: 'row-end' }, marked(button('Select', {
            kind: 'ghost', icon: 'check', onClick: () => { selecting = true; draw(); focusIn('[role="checkbox"]'); },
          }), 'data-select-mode')),
          active.length ? section(`Active (${active.length})`, cards(active)) : null,
          paused.length ? section(`Paused (${paused.length})`, cards(paused)) : null,
          done.length ? h('details', { class: 'more' }, h('summary', null, icon('check', { size: 18 }), `Finished (${done.length})`), cards(done)) : null,
          failed.length ? h('details', { class: 'more' }, h('summary', null, icon('close', { size: 18 }), `Failed (${failed.length})`), cards(failed)) : null,
        ] : here ? emptyState(subfolders.length ? 'No projects directly in this folder.' : 'This folder is empty. Add a project or a folder to it.') : null,
      !selecting && here ? section('This folder',
        h('p', { class: 'muted small' }, `In ${pathText(tree, upId) || 'the top level'} · ${(() => {
          const c = folderCounts(tree, projects, here.id);
          return c.projects || c.folders ? `holds ${countsText(c)}` : 'empty';
        })()}`),
        h('div', { class: 'row-wrap' },
          button('Rename', { icon: 'edit', onClick: () => rename(here) }),
          button('Move', { icon: 'move', onClick: () => move(here) }),
          button('Delete folder', { icon: 'trash', kind: 'ghost', onClick: () => remove(here) }))) : null);
    drawActions();
  };

  if (!projects.length && !folders.length) {
    append(ctx.root, [
      h('div', { class: 'card stack' },
        h('h2', null, 'Follow wafers from start to finish'),
        h('p', null, 'A project gathers the runs a batch of wafers goes through. Plan its steps if you like, log each run into the project, and it keeps a traveler of what every wafer went through, ready to export.'),
        h('p', { class: 'muted' }, 'Projects are optional: runs logged without one work as before. Several projects can run at once, one run (a furnace load, say) can carry wafers of more than one, and folders keep many projects in order.')),
      emptyState('No projects yet.', linkButton('New project', '#/project/new', { icon: 'plus' })),
    ]);
    drawActions();
    return;
  }
  append(ctx.root, [body]);
  draw();
}
