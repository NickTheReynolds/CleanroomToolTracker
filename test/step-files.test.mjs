// @ts-check
// Pictures, files and GDS layouts on plan steps (1.6): which steps expose a
// pattern, tidy GDS entries and safe links, the step list helpers, records
// that validate, copies that keep the layout but not the pictures, and the
// traveler naming both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isExposureStep, cleanGds, webLink, gdsText, filesText, withFile, withoutFile, fileInUse, downloadName, stepFilesRoute, MAX_FILE_BYTES,
} from '../app/js/core/attachments.js';
import { newStep, newWafers, duplicateProject } from '../app/js/core/projects.js';
import { travelerBlocks, travelerSheets } from '../app/js/core/project-report.js';
import { seedForType } from '../app/js/data/seed-types.js';
import { normalizeRecord, validateRecord } from '../app/js/data/schema.js';

const T = '2026-10-27T10:00:00.000Z';
const base = { createdAt: T, updatedAt: T, deleted: false, deviceId: 'd', author: '' };
/** @type {import('../app/js/core/types.js').StepFile} */
const PIC = { id: 'f1', name: 'after develop.jpg', kind: 'photo', type: 'image/jpeg', size: 240000, addedAt: T };
/** @type {import('../app/js/core/types.js').StepFile} */
const CSV = { id: 'f2', name: 'profile.csv', kind: 'file', type: 'text/csv', size: 1200, addedAt: T };

test('exposure steps: lithography templates with a dose or exposure setting, or a title that says so', () => {
  for (const type of ['mask-aligner', 'stepper', 'laser-writer', 'mask-maker', 'ebeam-lithography']) {
    assert.equal(isExposureStep({ title: 'x' }, seedForType(type).template), true, type);
  }
  for (const type of ['spin-coat', 'develop', 'bake', 'icp-etch', 'ebeam-evaporation']) {
    assert.equal(isExposureStep({ title: 'Expose' }, seedForType(type).template), false, `${type}: its template decides, not the title`);
  }
  for (const title of ['Expose layer 1', 'Photolithography', 'Laser write', 'Mask making']) assert.equal(isExposureStep({ title }, null), true, title);
  for (const title of ['E-beam evaporation', 'Strip resist', 'Spin coat']) assert.equal(isExposureStep({ title }, null), false, title);
});

test('a GDS entry is tidied, and only web links open', () => {
  assert.deepEqual(cleanGds({ name: ' mask_v3.gds ', cell: ' TOP ', layer: '', link: '  ' }), { name: 'mask_v3.gds', cell: 'TOP' });
  assert.deepEqual(cleanGds({ name: '', fileId: 'b1', size: 5 }), { name: '', fileId: 'b1', size: 5 });
  assert.equal(cleanGds({ name: ' ', cell: 'TOP' }), null, 'a cell alone names no layout');
  assert.equal(cleanGds(null), null);
  assert.equal(webLink('https://drive.google.com/x?id=1'), 'https://drive.google.com/x?id=1');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '\\\\nas\\masks\\v3.gds', 'mask folder', '', undefined]) assert.equal(webLink(bad), null, String(bad));
  assert.equal(gdsText({ name: 'mask_v3.gds', cell: 'TOP', layer: '1', link: '\\\\nas\\masks' }), 'mask_v3.gds, cell TOP, layer 1, \\\\nas\\masks');
  assert.equal(gdsText(undefined), '');
});

test('a step’s list of pictures and files', () => {
  const step = newStep({ title: 'Expose' });
  const one = withFile(step, PIC);
  const two = withFile(one, CSV);
  assert.deepEqual(two.attachments?.map((a) => a.id), ['f1', 'f2']);
  assert.deepEqual(withFile(two, { ...PIC, name: 'renamed.jpg' }).attachments?.map((a) => a.name), ['profile.csv', 'renamed.jpg'], 'no duplicate ids');
  assert.equal(filesText(two), 'after develop.jpg, profile.csv');
  assert.equal('attachments' in withoutFile(one, 'f1'), false, 'the list goes once empty');
  assert.deepEqual(withoutFile(two, 'f1').attachments, [CSV]);
  assert.equal(step.attachments, undefined, 'the helpers do not change the step they get');
  assert.equal(downloadName(' a/b:c*.gds '), 'a_b_c_.gds');
  assert.equal(downloadName('  '), 'file');
  assert.equal(MAX_FILE_BYTES, 100e6);
});

test('a stored file stays while any step names it', () => {
  const s1 = { ...newStep({ title: 'Expose' }), gds: { name: 'm.gds', fileId: 'g1' } };
  const s2 = withFile(newStep({ title: 'Inspect' }), PIC);
  const projects = /** @type {any[]} */ ([{ id: 'p1', steps: [s1] }, { id: 'p2', steps: [s2] }]);
  assert.equal(fileInUse(projects, 'g1'), true);
  assert.equal(fileInUse(projects, 'f1'), true);
  assert.equal(fileInUse(projects, 'f2'), false);
  assert.equal(fileInUse([], 'g1'), false);
});

test('after a complete run, the offer goes to the step it carries out', () => {
  assert.equal(stepFilesRoute({ projects: [{ projectId: 'p 1', stepId: null }, { projectId: 'p2', stepId: 's/2' }] }), '/project/p2?step=s%2F2');
  assert.equal(stepFilesRoute({ projects: [{ projectId: 'p1', stepId: null }] }), null);
  assert.equal(stepFilesRoute({}), null);
});

test('records: steps with pictures, files and a layout validate; malformed ones do not; photos may carry a name', () => {
  const step = { ...withFile(newStep({ title: 'Expose' }), PIC), gds: { name: 'm.gds', cell: 'TOP', fileId: 'g1', size: 10 } };
  const project = normalizeRecord('projects', { ...base, id: 'p', name: 'Batch', startedAt: T, steps: [step] });
  assert.deepEqual(validateRecord('projects', project), []);
  const bad = (/** @type {any} */ patch) => validateRecord('projects', { ...project, steps: [{ ...step, ...patch }] });
  assert.ok(bad({ attachments: [{ id: 'x', name: 'a', kind: 'video' }] }).some((e) => e.includes('attachments')));
  assert.ok(bad({ attachments: 'a.jpg' }).some((e) => e.includes('attachments')));
  assert.ok(bad({ gds: { cell: 'TOP' } }).some((e) => e.includes('gds')));
  assert.ok(bad({ gds: { name: 'm.gds', layer: 1 } }).some((e) => e.includes('gds')));
  const file = normalizeRecord('photos', { ...base, id: 'f2', runId: step.id, name: 'profile.csv', type: 'text/csv', takenAt: T });
  assert.deepEqual(validateRecord('photos', file), []);
  assert.ok(validateRecord('photos', { ...file, name: 5 }).length);
});

test('a copied project keeps each step’s GDS layout but not its pictures and files', () => {
  const step = { ...withFile(newStep({ title: 'Expose' }), PIC), gds: { name: 'm.gds', layer: '2', fileId: 'g1', size: 10 } };
  const from = /** @type {any} */ ({ ...base, id: 'p', name: 'Batch 3', wafers: newWafers([], 2), steps: [step, newStep({ title: 'Develop' })] });
  const copy = duplicateProject(from, { now: T });
  assert.deepEqual(copy.steps[0].gds, step.gds);
  assert.notEqual(copy.steps[0].gds, step.gds, 'its own copy of the entry');
  assert.equal(copy.steps[0].attachments, undefined);
  assert.equal('gds' in copy.steps[1], false);
});

test('the traveler names each step’s layout and files', () => {
  const step = { ...withFile(withFile(newStep({ title: 'Expose' }), PIC), CSV), gds: { name: 'm.gds', cell: 'TOP' } };
  const project = { ...base, id: 'p1', name: 'Batch', goal: '', status: 'active', startedAt: T, endedAt: null, substrate: '', notes: '',
    wafers: newWafers([], 1), steps: [step, newStep({ title: 'Develop' })] };
  const input = { project, projects: [project], tools: [], templates: [], runs: [], measurements: [] };
  const line = travelerBlocks(/** @type {any} */ (input), { now: Date.parse(T) }).find((b) => b.kind === 'kv' && b.label === '1. Expose');
  assert.ok(line && 'text' in line && line.text.includes('GDS m.gds, cell TOP') && line.text.includes('files: after develop.jpg, profile.csv'));
  const plan = travelerSheets(/** @type {any} */ (input))[1];
  const col = (/** @type {string} */ name) => plan.rows[0].indexOf(name);
  assert.equal(plan.rows[1][col('GDS layout')], 'm.gds, cell TOP');
  assert.equal(plan.rows[1][col('Pictures and files')], 'after develop.jpg, profile.csv');
  assert.equal(plan.rows[2][col('GDS layout')], '');
});
