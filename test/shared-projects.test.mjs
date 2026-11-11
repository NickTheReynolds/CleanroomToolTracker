// @ts-check
// Projects that come with the app (2.2): every listed file is a valid backup
// holding exactly the project the list names, its steps on tools the seed has,
// with their seeded templates, and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_PROJECTS } from '../app/js/data/shared-projects.js';
import { validateBackupEnvelope, validateRecord, normalizeRecord } from '../app/js/data/schema.js';
import { LNF_TOOLS } from '../app/js/data/seed-lnf.js';
import { stepStates, progress } from '../app/js/core/projects.js';
import { planImport } from '../app/js/data/export-import.js';
import { planChecksWith } from '../app/js/data/plan-checks.js';
import { lnfSeedRecords } from '../app/js/data/seed-upgrade.js';
import { allRecipes } from '../app/js/data/recipes.js';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const tools = new Map(LNF_TOOLS.map((t) => [t[0], t]));

test('every project that comes with the app is a valid backup of that one project', () => {
  assert.ok(SHARED_PROJECTS.length >= 1);
  for (const sp of SHARED_PROJECTS) {
    const file = join(APP, 'projects', sp.file);
    assert.ok(existsSync(file), `${sp.file} is missing from app/projects`);
    const backup = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(validateBackupEnvelope(backup), []);
    for (const store of ['tools', 'templates', 'runs', 'measurements', 'events', 'photos', 'folders', 'wafers']) {
      assert.deepEqual(backup[store], [], `${sp.file} carries ${store}`);
    }
    assert.equal(backup.projects.length, 1);
    const p = normalizeRecord('projects', backup.projects[0]);
    assert.deepEqual(validateRecord('projects', p), []);
    assert.equal(p.id, sp.id, 'the list names the project by its id');
    assert.equal(p.name, sp.name);
    assert.equal(p.status, 'active');
    assert.ok(p.wafers.length >= 1 && p.steps.length >= 1);
    // Every step with a tool names a seeded LNF tool and that tool's seeded template; ids are unique.
    for (const s of p.steps) {
      if (!s.toolId) { assert.equal(s.templateId, null); continue; }
      const t = tools.get(s.toolId);
      assert.ok(t, `step "${s.title}" names an unknown tool ${s.toolId}`);
      assert.equal(s.templateId, t[1], `step "${s.title}" uses ${t[2]}'s seeded template`);
      assert.ok(!s.doneAt && !s.skipped, 'no step is done or skipped');
    }
    assert.equal(new Set(p.steps.map((s) => s.id)).size, p.steps.length);
    assert.equal(new Set(p.wafers.map((w) => w.id)).size, p.wafers.length);
    // It imports as one added project, and a second import changes nothing.
    const plan = planImport({}, backup);
    assert.deepEqual(plan.counts.projects, { added: 1, updated: 0, skipped: 0, invalid: 0 });
    assert.deepEqual(plan.errors, []);
    const again = planImport({ projects: plan.put.projects }, backup);
    assert.deepEqual(again.counts.projects, { added: 0, updated: 0, skipped: 1, invalid: 0 });
  }
});

test('the plan of every project that comes with the app passes the checks: nothing Not allowed', async () => {
  const { tools, templates } = lnfSeedRecords();
  const recipes = await allRecipes();
  for (const sp of SHARED_PROJECTS) {
    const p = JSON.parse(readFileSync(join(APP, 'projects', sp.file), 'utf8')).projects[0];
    const { notes } = planChecksWith(p, tools, templates, recipes);
    assert.deepEqual(notes.filter((n) => n.severity === 'stop').map((n) => n.text), [], sp.name);
  }
});

test('nrr_regjig_v9_1 is the README’s 24 rows after the RCA pre-furnace clean, with its two µPG layers', () => {
  const sp = SHARED_PROJECTS.find((x) => x.name === 'nrr_regjig_v9_1');
  assert.ok(sp);
  const p = JSON.parse(readFileSync(join(APP, 'projects', sp.file), 'utf8')).projects[0];
  assert.equal(p.steps.length, 25);
  assert.equal(p.wafers.length, 2);
  assert.equal(p.wafers[0].spec.size, '100mm');
  assert.equal(p.wafers[0].spec.thicknessUm, 525);
  const by = (/** @type {string} */ name) => { const t = LNF_TOOLS.find((x) => x[2] === name); assert.ok(t, name); return t[0]; };
  // The clean the LNF requires right before a CMOS-clean tube, then the README's row 1, the furnace.
  assert.equal(p.steps[0].toolId, by('PFC Bench 01'));
  assert.equal(p.steps[1].toolId, by('Tempress S3T2 - Wet Oxide'));
  assert.deepEqual([p.steps[4].gds, p.steps[15].gds], [{ name: 'nrr_regjig_sweep_v9.gds', layer: '1/0' }, { name: 'nrr_regjig_sweep_v9.gds', layer: '2/0' }]);
  const mpg = by('Heidelberg µPG 501 Mask Maker');
  assert.ok(p.steps[4].toolId === mpg && p.steps[15].toolId === mpg);
  assert.equal(p.steps.filter((s) => s.toolId === by('STS Pegasus 4')).length, 4, 'descum, run 1, top-up, run 2');
  assert.ok(p.steps[11].title.startsWith('RUN 1') && p.steps[20].title.startsWith('RUN 2'));
  assert.deepEqual(p.steps.filter((s) => !s.toolId).map((s) => s.title), ['Back-face oxide strip [staff]', 'Cleave along the 100 µm lines']);
  assert.deepEqual(progress(stepStates(p, [])), { done: 0, total: 25 });
});
