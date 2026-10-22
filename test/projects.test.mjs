// @ts-check
// Projects: plan progress from linked runs and manual marks, the next and
// suggested step, wafer labels and ranges, a wafer's traveler, link clean-up,
// copying a plan, record validation, and the traveler report and workbook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runLinks, linkFor, projectRuns, stepStates, nextStep, progress, suggestStep, activeWafers, waferText, newWafers, newStep,
  copyPlan, cleanLinks, defaultLink, sortProjects,
} from '../app/js/core/projects.js';
import { travelerBlocks, travelerSheets, travelerFileBase } from '../app/js/core/project-report.js';
import { normalizeRecord, validateRecord } from '../app/js/data/schema.js';

const T = '2026-10-01T10:00:00.000Z';
const base = { createdAt: T, updatedAt: T, deleted: false, deviceId: 'd', author: '' };

/** A project with four wafers and a three-step plan. */
function fixture() {
  const wafers = newWafers([], 4);
  const steps = [newStep({ title: 'Oxidize', toolId: 'furnace' }), newStep({ title: 'Etch oxide', toolId: 'icp' }), newStep({ title: 'Strip resist' })];
  const project = { ...base, id: 'p1', name: 'Resonators batch 3', goal: 'Release test', status: 'active', startedAt: T, endedAt: null,
    substrate: 'Si', notes: '', wafers, steps };
  const link = (/** @type {string[]} */ waferIds, /** @type {string | null} */ stepId) => [{ projectId: 'p1', waferIds, stepId }];
  const runs = [
    { ...base, id: 'r1', toolId: 'furnace', templateId: null, status: 'complete', startedAt: '2026-10-02T10:00:00.000Z',
      params: {}, results: {}, projects: link(wafers.map((w) => w.id), steps[0].id) },
    { ...base, id: 'r2', toolId: 'icp', templateId: null, status: 'open', startedAt: '2026-10-03T10:00:00.000Z',
      params: {}, results: {}, projects: link([wafers[0].id, wafers[1].id], steps[1].id) },
    { ...base, id: 'r3', toolId: 'icp', templateId: null, status: 'complete', startedAt: '2026-10-03T09:00:00.000Z', params: {}, results: {}, projects: [] },
    { ...base, id: 'r4', toolId: 'icp', templateId: null, status: 'complete', startedAt: '2026-10-04T09:00:00.000Z', deleted: true,
      params: {}, results: {}, projects: link([wafers[2].id], steps[1].id) },
  ];
  // Stored out of process order (r3, r2, r4, r1), so a missing sort shows; r2 stays at index 1.
  return { project, wafers, steps, runs: /** @type {any[]} */ ([runs[2], runs[1], runs[3], runs[0]]) };
}

test('new wafers continue the numbering; a new step gets an id and no marks', () => {
  const w = newWafers([], 3);
  assert.deepEqual(w.map((x) => x.label), ['W1', 'W2', 'W3']);
  assert.ok(w.every((x) => x.status === 'active' && x.id && x.notes === ''));
  assert.deepEqual(newWafers([{ id: 'a', label: 'W7', status: 'active', notes: '' }], 2).map((x) => x.label), ['W8', 'W9']);
  assert.deepEqual(newWafers(w, 0), []);
  const s = newStep({ title: '  Etch  ', toolId: 't' });
  assert.equal(s.title, 'Etch');
  assert.equal(s.doneAt, null);
  assert.equal(s.skipped, false);
  assert.notEqual(newStep().id, newStep().id);
});

test('step states come from linked runs and manual marks', () => {
  const { project, runs } = fixture();
  const st = stepStates(/** @type {any} */ (project), runs);
  assert.deepEqual(st.map((s) => s.state), ['done', 'active', 'todo']);
  assert.equal(st[0].doneAt, '2026-10-02T10:00:00.000Z');
  assert.deepEqual(st[1].runs.map((r) => r.id), ['r2'], 'a deleted run does not count');
  assert.equal(nextStep(st)?.step.title, 'Etch oxide');
  assert.deepEqual(progress(st), { done: 1, total: 3 });
  const marked = { ...project, steps: project.steps.map((s, i) => (i === 2 ? { ...s, skipped: true } : i === 1 ? { ...s, doneAt: T } : s)) };
  const st2 = stepStates(/** @type {any} */ (marked), runs.filter((r) => r.id !== 'r2'));
  assert.deepEqual(st2.map((s) => s.state), ['done', 'done', 'skipped']);
  assert.deepEqual(progress(st2), { done: 2, total: 2 });
  assert.equal(nextStep(st2), null);
});

test('the suggested step prefers the run’s tool, then the next step', () => {
  const { project, runs } = fixture();
  const st = stepStates(/** @type {any} */ (project), runs);
  assert.equal(suggestStep(st, 'icp')?.title, 'Etch oxide');
  assert.equal(suggestStep(st, 'other')?.title, 'Etch oxide');
  const l = defaultLink(/** @type {any} */ (project), runs, 'icp');
  assert.equal(l.projectId, 'p1');
  assert.equal(l.waferIds.length, 4);
  assert.equal(l.stepId, project.steps[1].id);
  // A later step on the run's tool beats the plan's next step.
  const ash = newStep({ title: 'Ash', toolId: 'asher' });
  const withAsh = { ...project, steps: [...project.steps, ash] };
  assert.equal(suggestStep(stepStates(/** @type {any} */ (withAsh), runs), 'asher')?.title, 'Ash');
  assert.equal(defaultLink(/** @type {any} */ (withAsh), runs, 'asher').stepId, ash.id);
});

test('a project’s runs in process order, for all wafers or one', () => {
  const { project, wafers, runs } = fixture();
  assert.deepEqual(projectRuns(runs, 'p1').map((r) => r.id), ['r1', 'r2']);
  assert.deepEqual(projectRuns(runs, 'p1', wafers[1].id).map((r) => r.id), ['r1', 'r2']);
  assert.deepEqual(projectRuns(runs, 'p1', wafers[3].id).map((r) => r.id), ['r1']);
  assert.deepEqual(projectRuns(runs, 'nope'), []);
  assert.equal(linkFor(runs[1], 'p1')?.stepId, project.steps[1].id);
  assert.deepEqual(runLinks({ projects: [null, { projectId: '' }, { projectId: 'x', waferIds: [], stepId: null }] }).length, 1);
});

test('wafer labels collapse into ranges', () => {
  const { project, wafers } = fixture();
  const ids = (/** @type {number[]} */ ns) => ns.map((i) => wafers[i].id);
  assert.equal(waferText(/** @type {any} */ (project), ids([0, 1, 2, 3])), 'all 4 wafers');
  assert.equal(waferText(/** @type {any} */ (project), ids([0, 1, 2])), 'W1–W3');
  assert.equal(waferText(/** @type {any} */ (project), ids([0, 2])), 'W1, W3');
  assert.equal(waferText(/** @type {any} */ (project), ids([1, 2])), 'W2, W3');
  assert.equal(waferText(/** @type {any} */ (project), []), '');
  const named = { ...project, wafers: [{ id: 'a', label: 'Dummy', status: 'active', notes: '' }, ...wafers] };
  assert.equal(waferText(/** @type {any} */ (named), ['a', wafers[0].id]), 'Dummy, W1');
  const padded = { ...project, wafers: ['W01', 'W02', 'W03', 'W04', 'W05'].map((label) => ({ id: label, label, status: 'active', notes: '' })) };
  assert.equal(waferText(/** @type {any} */ (padded), ['W01', 'W02', 'W03']), 'W01–W03', 'zero padding is kept');
  const slots = { ...project, wafers: ['08', '09', '10', '11'].map((label) => ({ id: label, label, status: 'active', notes: '' })) };
  assert.equal(waferText(/** @type {any} */ (slots), ['08', '09', '10']), '08–10');
  assert.equal(activeWafers(/** @type {any} */ ({ ...project, wafers: [{ ...wafers[0], status: 'scrapped' }, wafers[1]] })).length, 1);
});

test('links keep only live projects, their wafers and their steps', () => {
  const { project, wafers, steps } = fixture();
  const clean = cleanLinks([
    { projectId: 'p1', waferIds: [wafers[0].id, 'stray'], stepId: 'stray' },
    { projectId: 'p1', waferIds: [], stepId: steps[0].id },
    { projectId: 'gone', waferIds: [], stepId: null },
  ], new Map([['p1', /** @type {any} */ (project)]]));
  assert.deepEqual(clean, [{ projectId: 'p1', waferIds: [wafers[0].id], stepId: null }]);
});

test('copying a plan gives new ids and no marks; projects sort active first', () => {
  const { project } = fixture();
  const done = { ...project, steps: project.steps.map((s) => ({ ...s, doneAt: T, skipped: true })) };
  const copy = copyPlan(/** @type {any} */ (done));
  assert.deepEqual(copy.map((s) => s.title), ['Oxidize', 'Etch oxide', 'Strip resist']);
  assert.ok(copy.every((s, i) => s.id !== project.steps[i].id && s.doneAt === null && s.skipped === false));
  const ps = [{ ...project, id: 'a', status: 'done' }, { ...project, id: 'b', status: 'paused' }, { ...project, id: 'c', startedAt: '2026-09-01T00:00:00Z' },
    { ...project, id: 'd' }];
  assert.deepEqual(sortProjects(/** @type {any} */ (ps)).map((p) => p.id), ['d', 'c', 'b', 'a']);
});

test('project records normalise and validate; runs carry project links and steps', () => {
  const { project } = fixture();
  assert.deepEqual(validateRecord('projects', normalizeRecord('projects', project)), []);
  const bare = normalizeRecord('projects', { ...base, id: 'p2', name: 'Bare', startedAt: T });
  assert.equal(bare.status, 'active');
  assert.deepEqual(bare.wafers, []);
  assert.deepEqual(validateRecord('projects', bare), []);
  assert.ok(validateRecord('projects', { ...bare, name: ' ' }).some((e) => e.includes('name')));
  assert.ok(validateRecord('projects', { ...bare, status: 'lost' }).some((e) => e.includes('status')));
  assert.ok(validateRecord('projects', { ...bare, wafers: [{ id: 'w', label: '' }] }).some((e) => e.includes('wafer')));
  assert.ok(validateRecord('projects', { ...bare, wafers: [{ id: 'w', label: 'A' }, { id: 'w', label: 'B' }] }).some((e) => e.includes('twice')));
  assert.ok(validateRecord('projects', { ...bare, steps: [{ id: 's', title: '' }] }).some((e) => e.includes('step')));
  const run = normalizeRecord('runs', { ...base, id: 'r', toolId: 't', startedAt: T });
  assert.deepEqual(run.projects, []);
  assert.deepEqual(run.steps, []);
  assert.deepEqual(validateRecord('runs', run), []);
  const linked = normalizeRecord('runs', { ...run, projects: [{ projectId: 'p1' }] });
  assert.deepEqual(linked.projects, [{ projectId: 'p1', waferIds: [], stepId: null }]);
  assert.deepEqual(validateRecord('runs', linked), []);
  assert.ok(validateRecord('runs', { ...run, projects: [{ projectId: '' }] }).length);
  assert.ok(validateRecord('runs', { ...run, projects: 'p1' }).length);
  const stepped = { ...run, steps: [{ name: 'BT', params: { pressure: 5 } }, { name: 'Main', main: true }] };
  assert.deepEqual(validateRecord('runs', stepped), []);
  assert.ok(validateRecord('runs', { ...run, steps: [{ name: 'A', params: {} }, { name: 'B', params: {} }] }).some((e) => e.includes('main')));
  assert.ok(validateRecord('runs', { ...run, steps: [{ name: 'A', params: { x: [1] } }, { name: 'B', main: true }] }).length);
});

test('the traveler lists the plan, every run in order and each wafer’s path', () => {
  const { project, runs } = fixture();
  const tools = [{ ...base, id: 'furnace', name: 'Tempress S3T1' }, { ...base, id: 'icp', name: 'LAM 9400' }];
  const input = { project, projects: [project], tools, templates: [], runs, measurements: [] };
  const blocks = travelerBlocks(input, { now: Date.parse('2026-10-05T12:00:00Z'), who: 'by Sam' });
  const texts = blocks.map((b) => ('text' in b ? b.text : ''));
  assert.equal(texts[0], 'Traveler: Resonators batch 3');
  assert.ok(texts[1].includes('2 runs') && texts[1].includes('1 of 3 steps done'));
  assert.ok(blocks.some((b) => b.kind === 'kv' && b.label === '2. Etch oxide' && b.text.startsWith('In progress')));
  const heads = blocks.filter((b) => b.kind === 'h2').map((b) => /** @type {any} */ (b).text);
  assert.equal(heads.length, 2);
  assert.ok(heads[0].includes('Tempress S3T1') && heads[0].includes('1. Oxidize'));
  assert.ok(blocks.some((b) => b.kind === 'kv' && b.label === 'W3' && b.text.includes('Tempress S3T1') && !b.text.includes('LAM')));
  const sheets = travelerSheets(input);
  assert.deepEqual(sheets.map((s) => s.name), ['Process record', 'Plan', 'Wafers']);
  assert.equal(sheets[0].rows.length, 3);
  for (const s of sheets) {
    assert.ok(s.rows.every((row) => row.length === s.rows[0].length), `${s.name}: every row has a cell per column`);
    assert.equal(s.widths?.length, s.rows[0].length, `${s.name}: a width per column`);
  }
  for (const col of ['Conditions', 'Substrate', 'Mask', 'Also in']) assert.ok(sheets[0].rows[0].includes(col), `the workbook has ${col}, as the PDF does`);
  assert.equal(sheets[2].rows.length, 5);
  assert.equal(travelerFileBase({ name: 'Résonateurs: batch #3' }, new Date(2026, 9, 5)), 'lnf-runlog-project-resonateurs-batch-3-2026-10-05');
});
