// @ts-check
// Failed projects (1.8): stored as done with `failed`, so older versions keep
// syncing them as finished; how a status chosen in words is stored; copies
// start afresh; the traveler and the workbook say what went wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectStatus, statusPatch, duplicateProject, newWafers, newStep } from '../app/js/core/projects.js';
import { travelerBlocks } from '../app/js/core/project-report.js';
import { allSheets } from '../app/js/core/export-all.js';
import { normalizeRecord, validateRecord } from '../app/js/data/schema.js';
import { PROJECT_STATUSES, PROJECT_SHOWN_STATUSES, PROJECT_STATUS_LABELS } from '../app/js/core/vocab.js';

const T = '2026-10-01T10:00:00.000Z';
const ENDED = '2026-10-20T12:00:00.000Z';
const base = { createdAt: T, updatedAt: T, deleted: false, deviceId: 'd', author: '' };
const project = {
  ...base, id: 'p1', name: 'Shadow mask 1', goal: 'Through-wafer slots', status: 'done', startedAt: T, endedAt: ENDED,
  substrate: 'Si', notes: 'Mask v3', folderId: null, wafers: newWafers([], 2), steps: [newStep({ title: 'DRIE' })],
  failed: true, failReason: 'The wafer cracked in the bonder.',
};

test('a failed project is a finished one marked failed; anything else reads as its status', () => {
  assert.equal(projectStatus(/** @type {any} */ (project)), 'failed');
  assert.equal(projectStatus(/** @type {any} */ ({ ...project, failed: false })), 'done');
  assert.equal(projectStatus(/** @type {any} */ ({ ...project, failed: undefined })), 'done', 'a 1.7 record');
  // An older version reopened it: it keeps the field it does not know, but the project is active.
  assert.equal(projectStatus(/** @type {any} */ ({ ...project, status: 'active', endedAt: null })), 'active');
  assert.equal(projectStatus(/** @type {any} */ ({ ...project, status: 'paused' })), 'paused');
  for (const s of PROJECT_SHOWN_STATUSES) assert.ok(PROJECT_STATUS_LABELS[s], `${s} has a label`);
});

test('a status chosen in words is stored as status, end and failed', () => {
  const now = '2026-10-28T09:00:00.000Z';
  const active = { endedAt: null };
  assert.deepEqual(statusPatch(active, 'failed', now), { status: 'done', endedAt: now, failed: true });
  assert.deepEqual(statusPatch(active, 'done', now), { status: 'done', endedAt: now, failed: false });
  assert.deepEqual(statusPatch(active, 'paused', now), { status: 'paused', endedAt: null, failed: false });
  // Ended already: marking it failed (or finished after all) keeps the day it ended.
  assert.deepEqual(statusPatch({ endedAt: ENDED }, 'failed', now), { status: 'done', endedAt: ENDED, failed: true });
  assert.deepEqual(statusPatch({ endedAt: ENDED }, 'done', now), { status: 'done', endedAt: ENDED, failed: false });
  assert.deepEqual(statusPatch({ endedAt: ENDED }, 'active', now), { status: 'active', endedAt: null, failed: false }, 'reopen');
});

test('failed projects validate, and older versions accept them too', () => {
  const rec = normalizeRecord('projects', project);
  assert.deepEqual(validateRecord('projects', rec), []);
  // Older versions check the status against the three they know; "failed" is never stored there.
  assert.ok(!PROJECT_STATUSES.includes('failed'));
  assert.ok(validateRecord('projects', { ...rec, status: 'failed' }).some((e) => e.includes('status')));
  assert.ok(validateRecord('projects', { ...rec, failed: 'yes' }).some((e) => e.includes('failed must be true or false')));
  assert.ok(validateRecord('projects', { ...rec, failReason: 3 }).some((e) => e.includes('failReason must be text')));
  const older = { ...rec };
  delete older.failed;
  delete older.failReason;
  assert.deepEqual(validateRecord('projects', older), [], 'a record from 1.7 or before');
});

test('a copy of a failed project starts active, without the failure', () => {
  const copy = duplicateProject(/** @type {any} */ (project), { now: T });
  assert.equal(copy.status, 'active');
  assert.equal(copy.endedAt, null);
  assert.equal('failed' in copy || 'failReason' in copy, false);
  assert.equal(copy.name, 'Shadow mask 2');
});

test('the traveler and the workbook say a project failed, and what went wrong', () => {
  const input = { project, projects: [project], tools: [], templates: [], runs: [], measurements: [] };
  const blocks = travelerBlocks(/** @type {any} */ (input), { now: Date.parse('2026-10-28T12:00:00Z') });
  const line = /** @type {any} */ (blocks[1]).text;
  assert.ok(line.includes('Failed') && line.includes('failed 2026-10-20') && !line.includes('finished'), line);
  assert.ok(blocks.some((b) => b.kind === 'kv' && b.label === 'What went wrong' && b.text === project.failReason));
  const fine = travelerBlocks(/** @type {any} */ ({ ...input, project: { ...project, failed: false } }), { now: Date.parse('2026-10-28T12:00:00Z') });
  assert.ok(/** @type {any} */ (fine[1]).text.includes('Finished'));
  assert.ok(!fine.some((b) => b.kind === 'kv' && b.label === 'What went wrong'), 'a finished project keeps no failure in its traveler');

  const finished = { ...project, id: 'p2', name: 'Shadow mask 2', failed: false, failReason: 'Left from a failure, then fixed' };
  const sheet = allSheets(/** @type {any} */ ({ tools: [], templates: [], runs: [], measurements: [], events: [], projects: [project, finished], folders: [] }))
    .find((s) => s.name === 'Projects');
  assert.ok(sheet);
  const head = /** @type {any[]} */ (sheet.rows[0]);
  const col = (/** @type {string} */ name) => head.indexOf(name);
  assert.ok(col('What went wrong') > 0 && col('Ended') > 0);
  const byName = new Map(sheet.rows.slice(1).map((r) => [r[0], r]));
  assert.equal(byName.get('Shadow mask 1')?.[col('Status')], 'Failed');
  assert.equal(byName.get('Shadow mask 1')?.[col('What went wrong')], project.failReason);
  assert.equal(byName.get('Shadow mask 2')?.[col('Status')], 'Finished');
  assert.equal(byName.get('Shadow mask 2')?.[col('What went wrong')], '');
  assert.ok(sheet.rows.every((row) => row.length === head.length) && sheet.widths?.length === head.length);
});
