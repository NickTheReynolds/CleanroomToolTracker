// @ts-check
// Projects: plan progress from linked runs and manual marks, the next and
// suggested step, wafer labels and ranges, a wafer's traveler, link clean-up,
// copying a plan, record validation, and the traveler report and workbook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runLinks, linkFor, projectRuns, stepStates, nextStep, progress, suggestStep, activeWafers, waferText, newWafers, newStep,
  copyPlan, cleanLinks, defaultLink, sortProjects, processItems, stacksBefore, stepWaferIds, duplicateProject, copyPlanInto,
  wafersOnStepChange, recipeOnStepChange,
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

test('wafers and masks: numbering per prefix, types copied, masks left out of "every wafer"', () => {
  const spec = { material: 'Si', size: '100mm' };
  const w = newWafers([], 2, 'W', { spec, specId: 'lnf-store/x' });
  assert.deepEqual(w.map((x) => [x.label, x.spec, x.specId]), [['W1', spec, 'lnf-store/x'], ['W2', spec, 'lnf-store/x']]);
  assert.notEqual(w[0].spec, spec, 'each wafer has its own copy');
  const m = newWafers(w, 2, 'M', { spec: { kind: 'mask', size: 'plate5' } });
  assert.deepEqual(m.map((x) => x.label), ['M1', 'M2'], 'masks number on their own');
  assert.deepEqual(newWafers([...w, ...m], 1).map((x) => x.label), ['W3']);
  const project = /** @type {any} */ ({ id: 'p', wafers: [...w, ...m], steps: [] });
  assert.deepEqual(activeWafers(project).map((x) => x.label), ['W1', 'W2']);
  assert.deepEqual(processItems(project).map((x) => x.label), ['W1', 'W2']);
  assert.deepEqual(processItems(/** @type {any} */ ({ wafers: m })).map((x) => x.label), ['M1', 'M2'], 'a project of masks');
});

test('stacks: a bond joins wafers for the later steps; a debond separates them; runs follow a step’s wafers', () => {
  const [w1, w2, g1, g2] = [...newWafers([], 2), ...newWafers([], 2, 'G')];
  const bond = { ...newStep({ title: 'Bond' }), bonds: [{ id: 'b1', waferIds: [w1.id, g1.id] }, { id: 'b2', waferIds: [w2.id, g2.id] }] };
  const dice = { ...newStep({ title: 'Dice', toolId: 'saw' }), waferIds: [w1.id] };
  const debond = { ...newStep({ title: 'Debond' }), debond: true };
  const after = { ...newStep({ title: 'Clean', toolId: 'bench' }), waferIds: [w1.id] };
  const project = /** @type {any} */ ({ id: 'p', wafers: [w1, w2, g1, g2], steps: [bond, dice, debond, after] });
  assert.equal(stacksBefore(project, 0).size, 0);
  assert.deepEqual(stacksBefore(project, 1).get(w1.id), [w1.id, g1.id]);
  assert.deepEqual(stepWaferIds(project, dice), [w1.id, g1.id], 'the stack comes whole');
  assert.deepEqual(stepWaferIds(project, after), [w1.id], 'after the debond, one wafer');
  assert.deepEqual(stepWaferIds(project, bond), [w1.id, w2.id, g1.id, g2.id]);
  const link = defaultLink(project, [], 'saw');
  assert.equal(link.stepId, dice.id);
  assert.deepEqual(link.waferIds, [w1.id, g1.id]);
});

test('a run of the step asked for takes that step’s wafers still in process', () => {
  const [w1, w2, w3, w4] = newWafers([], 4);
  const s1 = { ...newStep({ title: 'Etch A', toolId: 'tool' }), waferIds: [w1.id, w2.id] };
  const s2 = { ...newStep({ title: 'Etch B', toolId: 'tool' }), waferIds: [w3.id, w4.id] };
  const project = /** @type {any} */ ({ id: 'p', wafers: [w1, w2, { ...w3, status: 'scrapped' }, w4], steps: [s1, s2] });
  assert.deepEqual(defaultLink(project, [], 'tool').waferIds, [w1.id, w2.id], 'the suggested step');
  const asked = defaultLink(project, [], 'tool', s2.id);
  assert.equal(asked.stepId, s2.id);
  assert.deepEqual(asked.waferIds, [w4.id], 'the asked step, without its scrapped wafer');
  const gone = /** @type {any} */ ({ ...project, wafers: project.wafers.map((/** @type {any} */ w) => ({ ...w, status: w.id === w4.id ? 'done' : w.status })) });
  assert.deepEqual(stepWaferIds(gone, s2), [], 'every wafer it names is finished: no wafers, not all of them');
  const dangling = { ...newStep({ title: 'Old' }), waferIds: ['deleted-on-1.4'] };
  assert.deepEqual(stepWaferIds(/** @type {any} */ ({ ...project, steps: [dangling] }), dangling), [w1.id, w2.id, w4.id],
    'a step naming only wafers no longer in the project is for every wafer in process');
});

test('a new run moved to another step takes its wafers while it still has the previous step’s', () => {
  const [w1, w2, w3, w4] = newWafers([], 4);
  const s1 = { ...newStep({ title: 'Etch A', toolId: 'tool' }), waferIds: [w1.id, w2.id] };
  const s2 = { ...newStep({ title: 'Etch B', toolId: 'tool' }), waferIds: [w3.id, w4.id] };
  const bond = { ...newStep({ title: 'Bond' }), bonds: [{ id: 'b', waferIds: [w1.id, w3.id] }] };
  const s3 = newStep({ title: 'Dice', toolId: 'saw' });
  const project = /** @type {any} */ ({ id: 'p', wafers: [w1, w2, w3, w4], steps: [s1, s2, bond, s3] });
  // Log this step on S2 while the form is on S1 with S1's wafers (Log run's link and its step menu alike).
  assert.deepEqual(wafersOnStepChange(project, { stepId: s1.id, waferIds: [w1.id, w2.id] }, s2, true), [w3.id, w4.id]);
  assert.deepEqual(wafersOnStepChange(project, { stepId: s1.id, waferIds: [w1.id] }, s2, true), [w1.id], 'chosen by hand: kept');
  assert.deepEqual(wafersOnStepChange(project, { stepId: s1.id, waferIds: [w1.id, w2.id] }, s2, false), [w1.id, w2.id], 'a saved run never follows');
  assert.deepEqual(wafersOnStepChange(project, { stepId: null, waferIds: [w1.id, w2.id, w3.id, w4.id] }, s1, true), [w1.id, w2.id],
    'no step yet, every wafer in process');
  assert.deepEqual(wafersOnStepChange(project, { stepId: s1.id, waferIds: [w1.id] }, s3, true), [w1.id, w3.id], 'after the bond, the stack');
  // A stack partner that is scrapped stays out.
  const scrapped = /** @type {any} */ ({ ...project, wafers: [w1, w2, { ...w3, status: 'scrapped' }, w4] });
  assert.deepEqual(wafersOnStepChange(scrapped, { stepId: s1.id, waferIds: [w1.id] }, s3, true), [w1.id]);
});

test('a new run’s recipe follows its step while it is still the previous step’s', () => {
  const s1 = newStep({ title: 'Piranha clean', recipe: 'Piranha 10 min' });
  const s2 = newStep({ title: 'Oxide strip' });
  const s3 = newStep({ title: 'Final clean', recipe: 'SC2 5 min' });
  const project = /** @type {any} */ ({ id: 'p', wafers: [], steps: [s1, s2, s3] });
  assert.equal(recipeOnStepChange(project, s1.id, s2, 'Piranha 10 min'), '', 'the next step has none');
  assert.equal(recipeOnStepChange(project, s2.id, s3, ''), 'SC2 5 min');
  assert.equal(recipeOnStepChange(project, null, s1, ''), 'Piranha 10 min', 'no step before, an empty box');
  assert.equal(recipeOnStepChange(project, s1.id, s3, 'My recipe'), 'My recipe', 'one the person typed stays');
});

test('the traveler says what each plan note rests on', () => {
  const { project, runs } = fixture();
  const note = { stepId: project.steps[2].id, severity: 'stop', code: 'material', waferIds: [project.wafers[0].id], key: 'k', text: 'W1 carries Au.', source: 'general' };
  const input = { project, projects: [project], tools: [], templates: [], runs, measurements: [], checks: [/** @type {any} */ (note)] };
  const plan = travelerSheets(input)[1];
  assert.equal(plan.rows[3][plan.rows[0].indexOf('Checks')], 'Not allowed: W1 carries Au. General practice, not an LNF rule.');
  const blocks = travelerBlocks(input, { now: Date.parse('2026-10-05T12:00:00Z') });
  assert.ok(blocks.some((b) => 'text' in b && String(b.text).includes('Not allowed: W1 carries Au. General practice, not an LNF rule.')));
  assert.equal(travelerSheets({ ...input, checks: [{ ...note, key: 'checked' }], project: { ...project, steps: project.steps.map((s, i) => (i === 2 ? { ...s, checked: ['checked'] } : s)) } })[1].rows[3][9], '',
    'a checked note is left out');
});

test('copies keep types, wafer choices and bonds on the new wafers', () => {
  const [w1, w2] = newWafers([], 2, 'W', { spec: { material: 'Si' } });
  const bond = { ...newStep({ title: 'Bond', adds: ['Au'] }), waferIds: [w1.id, w2.id], bonds: [{ id: 'b', waferIds: [w1.id, w2.id], method: 'eutectic' }], checked: ['x'] };
  const from = /** @type {any} */ ({ id: 'a', name: 'A', wafers: [w1, { ...w2, status: 'scrapped', notes: 'broken' }], steps: [bond] });
  const copy = duplicateProject(from, { now: T });
  const [c1, c2] = copy.wafers;
  assert.deepEqual([c1.label, c1.spec, c2.status, c2.notes], ['W1', { material: 'Si' }, 'active', '']);
  assert.notEqual(c1.id, w1.id);
  const s = copy.steps[0];
  assert.deepEqual(s.waferIds, [c1.id, c2.id]);
  assert.deepEqual(s.bonds.map((/** @type {any} */ b) => [b.waferIds, b.method]), [[[c1.id, c2.id], 'eutectic']]);
  assert.notEqual(s.bonds[0].id, 'b');
  assert.deepEqual(s.adds, ['Au']);
  assert.equal(s.checked, undefined, 'checked notes stay with the original');
  // Into a new project that has only its untouched W1: the wafers come too.
  const fresh = copyPlanInto(from, newWafers([], 1), true);
  assert.deepEqual(fresh.wafers.map((x) => x.label), ['W1', 'W2']);
  assert.deepEqual(fresh.steps[0].waferIds, fresh.wafers.map((x) => x.id));
  // Into a project with wafers of its own: by label; a stack missing a wafer is left out.
  const mine = newWafers([], 1);
  const into = copyPlanInto(from, mine, false);
  assert.deepEqual(into.wafers, mine);
  assert.deepEqual(into.steps[0].waferIds, [mine[0].id]);
  assert.equal(into.steps[0].bonds, undefined);
  assert.deepEqual(copyPlan(from).map((x) => x.waferIds), [undefined], 'without a map, no wafer choices');
});
