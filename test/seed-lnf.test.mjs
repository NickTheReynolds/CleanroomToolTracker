// @ts-check
// The LNF equipment seed (seed version 2): template types, the generated tool
// list, materials, and the upgrade from the generic example seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedForType, knownTypes, gasKey, gasFields } from '../app/js/data/seed-types.js';
import { lnfSeedRecords, seedMaterials, planSeedUpgrade, mergeMaterialLists } from '../app/js/data/seed-upgrade.js';
import { LNF_TOOLS, LNF_MATERIALS, LNF_MATERIAL_WORDS, LNF_EXTRA_TEMPLATES, LNF_ADDED_FIELDS } from '../app/js/data/seed-lnf.js';
import { seedRecords, SEED_MATERIALS, SEED_TIME } from '../app/js/data/seed-tools.js';
import { validateRecord, validateTemplateBody, SEED_VERSION } from '../app/js/data/schema.js';
import { isUuid } from '../app/js/core/ids.js';
import { normText, TOOL_CATEGORIES } from '../app/js/core/vocab.js';

test('every tool type builds a valid template, with default and custom gases', () => {
  for (const type of knownTypes()) {
    for (const gases of [[], ['CF4', 'O2', 'SiH2Cl2 (DCS)', 'O2', '3-gas mix']]) {
      const { category, kind, template } = seedForType(type, gases);
      assert.ok(TOOL_CATEGORIES.includes(category), `${type}: category ${category}`);
      assert.ok(kind === 'process' || kind === 'metrology');
      if (!template) continue;
      assert.deepEqual(validateTemplateBody(template), [], `${type} with ${gases.join(',') || 'default gases'}`);
    }
  }
  assert.equal(seedForType('unheard-of').template?.name, 'General process');
  assert.equal(seedForType('sem').template, null);
  assert.equal(seedForType('sem').kind, 'metrology');
});

test('gas keys are stable identifiers', () => {
  assert.equal(gasKey('C4F8'), 'c4f8');
  assert.equal(gasKey('SiH2Cl2 (DCS)'), 'sih2cl2dcs');
  assert.equal(gasKey('3-gas mix'), 'gas3gasmix');
  assert.deepEqual(gasFields(['O2', 'o2', 'Ar']).map((f) => f.key), ['o2', 'ar']);
  assert.ok(gasFields(['SF6']).every((f) => f.chemistry && f.unit === 'sccm'));
});

test('the LNF seed: valid records, stable UUIDs, unique names, a template per process tool', () => {
  const { tools, templates } = lnfSeedRecords();
  assert.ok(tools.length >= 20, `only ${tools.length} tools`);
  const ids = [...tools, ...templates].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
  for (const id of ids) assert.ok(isUuid(id), `${id} is not a v4 UUID`);
  const names = tools.map((t) => normText(t.name));
  assert.equal(new Set(names).size, names.length, 'duplicate tool names');
  for (const t of tools) assert.deepEqual(validateRecord('tools', t), [], t.name);
  for (const t of templates) assert.deepEqual(validateRecord('templates', t), [], t.name);
  for (const tool of tools) {
    const own = templates.filter((x) => x.toolId === tool.id);
    if (tool.defaultTemplateId) assert.ok(own.some((x) => x.id === tool.defaultTemplateId), `${tool.name}: default template missing`);
    else assert.equal(tool.kind, 'metrology', `${tool.name}: process tool without a template`);
    assert.equal(tool.updatedAt, SEED_TIME);
  }
  // Same input, same records: devices that seed separately merge without duplicates.
  assert.deepEqual(lnfSeedRecords(), lnfSeedRecords());
  for (const row of LNF_TOOLS) assert.equal(row.length, 5);
});

test('a tool with two chambers gets a second template: the Plasmatherm 790 PECVD side', () => {
  const { tools, templates } = lnfSeedRecords();
  for (const [toolId, templateId, , , name] of LNF_EXTRA_TEMPLATES) {
    const tool = tools.find((t) => t.id === toolId);
    assert.ok(tool, `${name}: unknown tool`);
    const own = templates.filter((t) => t.toolId === toolId);
    assert.equal(own.length, 2, `${tool.name} has its first template and the extra one`);
    const extra = own.find((t) => t.id === templateId);
    assert.ok(extra && extra.name === name && extra.processType !== own.find((t) => t.id !== templateId)?.processType);
    assert.equal(tool.defaultTemplateId === templateId, false, 'the first template stays the default');
  }
  const pecvd = templates.find((t) => t.id === '6119e6b6-53b2-4b07-822f-3d00980c5cb0');
  assert.deepEqual(pecvd?.fields.filter((f) => f.chemistry).map((f) => f.key), ['sih4', 'nh3', 'n2o', 'n2', 'he']);
});

test('materials: LNF list plus the generic list, bulk lithium niobate included, no duplicates', () => {
  const m = seedMaterials();
  assert.ok(m.includes('LiNbO3 (bulk)'));
  for (const s of SEED_MATERIALS) assert.ok(m.some((x) => normText(x) === normText(s)), `${s} missing`);
  assert.equal(new Set(m.map(normText)).size, m.length);
  assert.ok(LNF_MATERIALS.length >= 50);
  // A fresh install offers the same first chips as the generic list did.
  assert.deepEqual(m.slice(0, SEED_MATERIALS.length), [...SEED_MATERIALS]);
  assert.deepEqual(mergeMaterialLists(['Pt', 'si'], ['Si', 'Au', ' pt ']), ['Pt', 'si', 'Au']);
  for (const [name, words] of Object.entries(LNF_MATERIAL_WORDS)) {
    assert.ok(LNF_MATERIALS.includes(name), `search words for ${name}, which is not in the list`);
    assert.match(words, /^[\p{Ll}\p{N}]+( [\p{Ll}\p{N}]+)*$/u, `${name}: lower-case words`);
  }
  assert.match(LNF_MATERIAL_WORDS.Au, /\bgold\b/);
});

test('upgrading an example-seeded database adds the LNF set without overwriting edits', () => {
  const ex = seedRecords();
  const lnf = lnfSeedRecords();
  const [usedTool, renamedTool, idleTool] = ex.tools;
  const renamed = { ...renamedTool, name: 'My ICP', updatedAt: '2026-05-01T00:00:00.000Z' };
  const editedLnf = { ...lnf.tools[0], name: 'Renamed by me', updatedAt: '2026-10-21T00:00:00.000Z' };
  const existing = {
    tools: [...ex.tools.filter((t) => t.id !== renamedTool.id), renamed, editedLnf],
    templates: [...ex.templates, lnf.templates[0]],
    runs: [{ toolId: usedTool.id }],
    events: [],
    materials: ['Custom film', 'Si'],
  };
  const plan = planSeedUpgrade(existing);
  assert.ok(!plan.tools.some((t) => t.id === editedLnf.id), 'an existing LNF tool is not overwritten');
  assert.equal(plan.tools.length, lnf.tools.length - 1);
  assert.ok(!plan.templates.some((t) => t.id === lnf.templates[0].id));
  assert.ok(plan.archiveIds.includes(idleTool.id), 'unused example tool archived');
  assert.ok(!plan.archiveIds.includes(usedTool.id), 'used example tool kept');
  assert.ok(!plan.archiveIds.includes(renamedTool.id), 'renamed example tool kept');
  assert.equal(plan.materials[0], 'Custom film');
  assert.ok(plan.materials.includes('LiNbO3 (bulk)'));
  assert.equal(SEED_VERSION, 4);
  const again = planSeedUpgrade({ ...existing, tools: [...existing.tools, ...plan.tools], templates: [...existing.templates, ...plan.templates] });
  assert.deepEqual(again.tools, []);
  assert.deepEqual(again.templates, []);
});

test('upgrading a version-2 database adds only the second chamber template', () => {
  const lnf = lnfSeedRecords();
  const extraIds = new Set(LNF_EXTRA_TEMPLATES.map((x) => x[1]));
  const v2 = { tools: lnf.tools, templates: lnf.templates.filter((t) => !extraIds.has(t.id)), runs: [], events: [], materials: seedMaterials() };
  const plan = planSeedUpgrade(v2);
  assert.deepEqual(plan.tools, []);
  assert.deepEqual(plan.templates.map((t) => t.id), [...extraIds]);
  // A template the person deleted stays deleted: its tombstone counts as present.
  const deleted = planSeedUpgrade({ ...v2, templates: [...v2.templates, { ...plan.templates[0], deleted: true }] }, 2);
  assert.deepEqual(deleted.templates, []);
  // Materials the person removed stay removed: only the step from seed 1 merges the LNF list.
  const trimmed = planSeedUpgrade({ ...v2, materials: ['Si', 'SiO2 (thermal)', 'My film'] }, 2);
  assert.deepEqual(trimmed.materials, ['Si', 'SiO2 (thermal)', 'My film']);
  assert.deepEqual(trimmed.archiveIds, []);
  assert.ok(planSeedUpgrade({ ...v2, materials: ['Si'] }, 1).materials.length > 50, 'from seed 1 the LNF materials arrive');
});

test('upgrading a version-3 database gives the µPG 501 template its Expose time field, edits kept', () => {
  const lnf = lnfSeedRecords();
  const [[, templateId, key]] = LNF_ADDED_FIELDS;
  const fresh = lnf.templates.find((t) => t.id === templateId);
  assert.deepEqual(fresh.fields.slice(0, 4).map((f) => f.key), ['resist', 'dose', key, 'focus']);
  assert.equal(fresh.fields[2].label, 'Expose time');
  const dwl = lnf.templates.find((t) => t.id === '33aa44cd-50d8-4158-b6d9-6423e90f9718');
  assert.ok(!dwl.fields.some((f) => f.key === key), 'the DWL 66+ keeps the plain laser-write template');
  const old = { ...fresh, fields: fresh.fields.filter((f) => f.key !== key) };
  const v3 = (t) => ({ tools: lnf.tools, templates: [...lnf.templates.filter((x) => x.id !== templateId), t], runs: [], events: [], materials: seedMaterials() });
  const mine = { key: 'mine', label: 'Mine', type: 'text', role: 'context' };
  const edited = { ...old, name: 'My mask write', fields: [...old.fields, mine], updatedAt: '2026-10-21T00:00:00.000Z' };
  const plan = planSeedUpgrade(v3(edited), 3);
  assert.deepEqual(plan.templates, []);
  assert.equal(plan.withFields.length, 1);
  const grown = plan.withFields[0];
  assert.deepEqual(grown.fields.map((f) => f.key), [...fresh.fields.map((f) => f.key), 'mine']);
  assert.equal(grown.name, 'My mask write');
  assert.deepEqual(validateRecord('templates', grown), []);
  // Already there (by key or by label), deleted, or the database is already at seed 4: nothing to add.
  assert.deepEqual(planSeedUpgrade(v3(fresh), 3).withFields, []);
  const ownField = { ...old, fields: [...old.fields, { key: 'myExpose', label: 'expose TIME', type: 'number', role: 'input' }] };
  assert.deepEqual(planSeedUpgrade(v3(ownField), 3).withFields, []);
  assert.deepEqual(planSeedUpgrade(v3({ ...old, deleted: true }), 3).withFields, []);
  assert.deepEqual(planSeedUpgrade(v3(old), 4).withFields, []);
  // Without the field it follows (the dose), it goes before the first output.
  const noDose = { ...old, fields: old.fields.filter((f) => f.key !== 'dose') };
  const keys = planSeedUpgrade(v3(noDose), 3).withFields[0].fields.map((f) => f.key);
  assert.equal(keys.indexOf(key), keys.indexOf('cd') - 1);
});
