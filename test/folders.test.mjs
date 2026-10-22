// @ts-check
// Project folders: the tree (sorted, repaired when a parent is gone or two
// folders ended up inside each other), paths, what a folder holds, where a
// folder may move, folder names, record validation, and copying a project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  folderTree, folderPath, pathText, projectFolderId, subtreeIds, canMoveFolder, folderOptions, projectsIn, folderCounts,
  countsText, folderNameProblem, folderDeletePlan, undoPatch,
} from '../app/js/core/folders.js';
import { copyName, duplicateProject, newWafers, newStep } from '../app/js/core/projects.js';
import { normalizeRecord, validateRecord } from '../app/js/data/schema.js';

const T = '2026-10-01T10:00:00.000Z';
const base = { createdAt: T, updatedAt: T, deleted: false, deviceId: 'd', author: '' };
/** @param {string} id @param {string} name @param {string | null} [parentId] @param {boolean} [deleted] */
const folder = (id, name, parentId = null, deleted = false) => ({ ...base, id, name, parentId, deleted });
/** @param {string} id @param {string | null} folderId @param {string} [status] */
const project = (id, folderId, status = 'active') => /** @type {any} */ ({
  ...base, id, name: id, folderId, status, goal: '', startedAt: T, endedAt: null, substrate: '', notes: '', wafers: [], steps: [],
});

/** Thesis > Chapter 2, Chapter 10; Teaching; a deleted folder and a folder inside it. */
const FOLDERS = [
  folder('t', 'Thesis'), folder('c10', 'Chapter 10', 't'), folder('c2', 'Chapter 2', 't'), folder('teach', 'teaching'),
  folder('gone', 'Old', null, true), folder('orphan', 'Orphan', 'gone'),
];

test('the tree sorts names naturally and lifts folders whose parent is gone', () => {
  const tree = folderTree(FOLDERS);
  assert.deepEqual((tree.children.get(null) || []).map((f) => f.id), ['orphan', 'teach', 't']);
  assert.deepEqual((tree.children.get('t') || []).map((f) => f.name), ['Chapter 2', 'Chapter 10']);
  assert.equal(tree.byId.has('gone'), false, 'deleted folders are left out');
  assert.equal(tree.parent.get('orphan'), null);
  assert.deepEqual(folderPath(tree, 'c2').map((f) => f.id), ['t', 'c2']);
  assert.equal(pathText(tree, 'c2'), 'Thesis › Chapter 2');
  assert.equal(pathText(tree, 'c2', ' / '), 'Thesis / Chapter 2');
  assert.equal(pathText(tree, null), '');
  assert.equal(pathText(tree, 'nope'), '');
});

test('folders inside each other: the lowest id goes to the top level, whichever device draws the tree', () => {
  const two = folderTree([folder('b', 'B', 'a'), folder('a', 'A', 'b')]);
  assert.equal(two.parent.get('a'), null);
  assert.equal(two.parent.get('b'), 'a');
  const reversed = folderTree([folder('a', 'A', 'b'), folder('b', 'B', 'a')]);
  assert.deepEqual([...reversed.parent.entries()].sort(), [...two.parent.entries()].sort());
  // A loop of three, with a folder hanging off it, and a folder inside itself.
  const three = folderTree([folder('x', 'X', 'z'), folder('y', 'Y', 'x'), folder('z', 'Z', 'y'), folder('w', 'W', 'y'), folder('s', 'S', 's')]);
  assert.equal(three.parent.get('x'), null);
  assert.equal(three.parent.get('s'), null);
  assert.deepEqual(folderPath(three, 'w').map((f) => f.id), ['x', 'y', 'w']);
  assert.deepEqual(folderPath(three, 'z').map((f) => f.id), ['x', 'y', 'z']);
  // Every folder is reachable from the top level.
  const seen = new Set(folderOptions(three).map((o) => o.folder.id));
  assert.deepEqual([...seen].sort(), ['s', 'w', 'x', 'y', 'z']);
});

test('what a folder holds, where it may move, and the picker order', () => {
  const tree = folderTree(FOLDERS);
  const projects = [project('p1', 't'), project('p2', 'c2'), project('p3', 'c2', 'done'), project('p4', null), project('p5', 'gone')];
  assert.deepEqual([...subtreeIds(tree, 't')].sort(), ['c10', 'c2', 't']);
  assert.deepEqual(folderCounts(tree, projects, 't'), { projects: 3, active: 2, folders: 2 });
  assert.deepEqual(folderCounts(tree, projects, 'teach'), { projects: 0, active: 0, folders: 0 });
  assert.equal(countsText(folderCounts(tree, projects, 't')), '3 projects (2 active), 2 folders');
  assert.equal(countsText(folderCounts(tree, projects, 'c2')), '2 projects (1 active)');
  assert.equal(countsText({ projects: 0, active: 0, folders: 1 }), '1 folder');
  assert.equal(countsText(folderCounts(tree, projects, 'teach')), 'Empty');
  assert.equal(projectFolderId(tree, projects[4]), null, 'a project in a deleted folder shows at the top level');
  assert.deepEqual(projectsIn(tree, projects, null).map((p) => p.id), ['p4', 'p5']);
  assert.deepEqual(projectsIn(tree, projects, 'c2').map((p) => p.id), ['p2', 'p3']);
  assert.equal(canMoveFolder(tree, 't', 'c2'), false, 'not into a folder inside it');
  assert.equal(canMoveFolder(tree, 't', 't'), false);
  assert.equal(canMoveFolder(tree, 'c2', 'teach'), true);
  assert.equal(canMoveFolder(tree, 'c2', null), true);
  assert.equal(canMoveFolder(tree, 'c2', 'gone'), false, 'not into a deleted folder');
  assert.deepEqual(folderOptions(tree).map((o) => `${o.depth}:${o.folder.id}`), ['0:orphan', '0:teach', '0:t', '1:c2', '1:c10']);
  assert.deepEqual(folderOptions(tree, 't').map((o) => o.folder.id), ['orphan', 'teach']);
});

test('folder names need text and must differ from their neighbours', () => {
  const tree = folderTree(FOLDERS);
  assert.equal(folderNameProblem(tree, '  ', null), 'Give the folder a name.');
  assert.match(folderNameProblem(tree, 'x'.repeat(81), null), /under 80/);
  assert.match(folderNameProblem(tree, ' thesis ', null), /already a folder called “thesis”/);
  assert.equal(folderNameProblem(tree, 'Thesis', 'teach'), '', 'the same name elsewhere is fine');
  assert.equal(folderNameProblem(tree, 'THESIS', null, 't'), '', 'renaming a folder to itself');
  assert.equal(folderNameProblem(tree, 'Old', null), '', 'a deleted folder does not block its name');
});

test('deleting a folder with its contents takes every folder and project inside it', () => {
  const tree = folderTree(FOLDERS);
  const projects = [project('p1', 't'), project('p2', 'c2'), project('p3', 'teach'), project('p4', null), project('p5', 'gone')];
  const plan = folderDeletePlan(tree, projects, 't', true);
  assert.deepEqual(plan.folders.map((c) => c.id).sort(), ['c10', 'c2', 't']);
  assert.ok(plan.folders.every((c) => c.patch.deleted === true));
  assert.deepEqual(plan.projects.map((c) => c.id).sort(), ['p1', 'p2']);
  assert.ok(plan.projects.every((c) => c.patch.deleted === true));
  // A loop counts as the tree draws it: deleting x (on top) takes y and z, which hang under it.
  const loop = folderTree([folder('x', 'X', 'z'), folder('y', 'Y', 'x'), folder('z', 'Z', 'y')]);
  assert.deepEqual(folderDeletePlan(loop, [project('q', 'z')], 'x', true).projects.map((c) => c.id), ['q']);
  assert.deepEqual(folderDeletePlan(tree, projects, 'nope', true), { folders: [], projects: [] });
});

test('deleting only the folder moves what it holds up, renaming a folder whose name is taken there', () => {
  const tree = folderTree(FOLDERS);
  const projects = [project('p1', 't'), project('p2', 'c2'), project('p4', null)];
  const plan = folderDeletePlan(tree, projects, 't', false);
  assert.deepEqual(plan.folders, [
    { id: 't', patch: { deleted: true } }, { id: 'c2', patch: { parentId: null } }, { id: 'c10', patch: { parentId: null } }]);
  assert.deepEqual(plan.projects, [{ id: 'p1', patch: { folderId: null } }], 'projects in a subfolder stay there');
  // P holds "Data" and F; F holds another "Data". Moving F's "Data" up would make two.
  const clash = folderTree([folder('P', 'Parent'), folder('d1', 'Data', 'P'), folder('F', 'Old', 'P'), folder('d2', 'data', 'F'),
    folder('d3', 'Data (from Old)', 'P')]);
  const moved = folderDeletePlan(clash, [], 'F', false);
  assert.deepEqual(moved.folders[1], { id: 'd2', patch: { parentId: 'P', name: 'data (from Old) 2' } });
  const after = folderTree([...[folder('P', 'Parent'), folder('d1', 'Data', 'P'), folder('d3', 'Data (from Old)', 'P')],
    { ...folder('d2', 'data (from Old) 2', 'P') }]);
  assert.equal(folderNameProblem(after, 'Data', 'P', 'd1'), '', 'the names in P stay distinct');
  // A long generated name stays within the limit, so the folder can still be renamed.
  const longName = folderTree([folder('P', 'Parent'), folder('a', 'Profilometer and ellipsometry', 'P'),
    folder('F', 'LiNbO3 resonators batch 3 (thesis chapter 4)', 'P'), folder('b', 'Profilometer and ellipsometry', 'F')]);
  const renamed = folderDeletePlan(longName, [], 'F', false).folders[1].patch.name;
  assert.ok(renamed.length <= 80 && renamed.endsWith('…'), renamed);
});

test('undo puts back exactly the fields a change wrote', () => {
  const cur = { id: 'f', name: 'Old', parentId: 'P', deleted: false };
  assert.deepEqual(undoPatch(cur, { deleted: true }), { deleted: false });
  assert.deepEqual(undoPatch(cur, { parentId: null, name: 'New' }), { parentId: 'P', name: 'Old' });
  assert.deepEqual(undoPatch({ id: 'p' }, { folderId: 'x' }), { folderId: null }, 'a field the record lacked comes back as null');
});

test('folder records validate; a project names its folder', () => {
  const f = normalizeRecord('folders', { ...base, id: 'f', name: 'Thesis' });
  assert.equal(f.parentId, null);
  assert.deepEqual(validateRecord('folders', f), []);
  assert.deepEqual(validateRecord('folders', { ...f, name: ' ' }), ['name is required']);
  assert.deepEqual(validateRecord('folders', { ...f, parentId: 'f' }), ['a folder cannot be inside itself']);
  assert.deepEqual(validateRecord('folders', { ...f, parentId: 3 }), ['parentId must be text']);
  const p = normalizeRecord('projects', { ...base, id: 'p', name: 'Batch', startedAt: T });
  assert.equal(p.folderId, null);
  assert.deepEqual(validateRecord('projects', p), []);
  assert.deepEqual(validateRecord('projects', { ...p, folderId: 'f' }), []);
  assert.deepEqual(validateRecord('projects', { ...p, folderId: 7 }), ['folderId must be text']);
});

test('a copy gets a free name, new ids, every wafer in process and no step done', () => {
  assert.equal(copyName('Batch 3'), 'Batch 3 (copy)');
  assert.equal(copyName('Batch 3', ['Batch 3 (copy)']), 'Batch 3 (copy 2)');
  assert.equal(copyName('Batch 3 (copy)', ['batch 3 (COPY)', 'Batch 3 (copy 2)']), 'Batch 3 (copy 3)', 'no stacked suffixes');
  assert.equal(copyName(''), 'Project (copy)');
  const wafers = newWafers([], 3).map((w, i) => ({ ...w, status: i ? 'done' : 'scrapped', notes: 'chipped' }));
  const steps = [{ ...newStep({ title: 'Oxidize', toolId: 'furnace', recipe: 'Wet 1000' }), doneAt: T }, { ...newStep({ title: 'Etch' }), skipped: true }];
  const from = { ...project('src', 'c2', 'done'), name: 'Batch 3', goal: 'Release', substrate: 'Si', notes: 'Mask v2', endedAt: T, wafers, steps };
  const copy = duplicateProject(from, { now: '2026-10-21T08:00:00.000Z', taken: ['Batch 3'] });
  assert.equal(copy.name, 'Batch 3 (copy)');
  assert.equal(copy.status, 'active');
  assert.equal(copy.startedAt, '2026-10-21T08:00:00.000Z');
  assert.equal(copy.endedAt, null);
  assert.equal(copy.folderId, 'c2');
  assert.deepEqual([copy.goal, copy.substrate, copy.notes], ['Release', 'Si', 'Mask v2']);
  assert.deepEqual(copy.wafers.map((/** @type {any} */ w) => [w.label, w.status, w.notes]), [['W1', 'active', ''], ['W2', 'active', ''], ['W3', 'active', '']]);
  assert.ok(copy.wafers.every((/** @type {any} */ w, /** @type {number} */ i) => w.id && w.id !== wafers[i].id));
  assert.deepEqual(copy.steps.map((/** @type {any} */ s) => [s.title, s.toolId, s.recipe, s.doneAt, s.skipped]),
    [['Oxidize', 'furnace', 'Wet 1000', null, false], ['Etch', null, '', null, false]]);
  assert.ok(copy.steps.every((/** @type {any} */ s, /** @type {number} */ i) => s.id !== steps[i].id));
  assert.deepEqual(validateRecord('projects', normalizeRecord('projects', { ...base, id: 'copy', ...copy })), []);
});
