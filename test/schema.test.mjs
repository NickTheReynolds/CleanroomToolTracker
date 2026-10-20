// @ts-check
// Schema validation, normalisation, migrations and the seed data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateField, validateTemplateBody, validateRecord, normalizeRecord, validateBackupEnvelope,
  migrateRecords, SCHEMA_VERSION, MIGRATIONS, MAX_REQUIRED_FIELDS,
} from '../app/js/data/schema.js';
import { seedRecords, SEED_TOOLS, SEED_MATERIALS, SEED_TIME } from '../app/js/data/seed-tools.js';
import { isUuid } from '../app/js/core/ids.js';
import { oxideEtchTemplate } from './fixtures.mjs';

const base = { id: 'x1', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', deleted: false, deviceId: 'd', author: 'a' };

test('every seed tool and template is valid, with unique UUIDs', () => {
  const { tools, templates } = seedRecords();
  const ids = [...tools, ...templates].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(isUuid(id), `${id} is not a v4 UUID`);
  for (const t of tools) assert.deepEqual(validateRecord('tools', t), [], t.name);
  for (const t of templates) assert.deepEqual(validateRecord('templates', t), [], t.name);
  for (const r of [...tools, ...templates]) assert.equal(r.updatedAt, SEED_TIME);
});

test('seed covers each category and every process tool has a default template of its own', () => {
  const { tools, templates } = seedRecords();
  for (const c of ['etch', 'deposition', 'thermal', 'litho', 'metrology']) {
    assert.ok(tools.some((t) => t.category === c), `no ${c} tool`);
  }
  for (const t of tools.filter((x) => x.kind === 'process')) {
    const tpl = templates.find((x) => x.id === t.defaultTemplateId);
    assert.ok(tpl, `${t.name} has no default template`);
    assert.equal(tpl.toolId, t.id);
  }
  const names = templates.map((t) => t.name);
  for (const n of ['Oxide etch', 'RIE etch', 'PECVD film', 'Sputter film', 'E-beam evaporation', 'ALD film',
    'Furnace oxidation', 'Spin coat', 'Ellipsometry', 'Profilometry']) assert.ok(names.includes(n), n);
  assert.ok(SEED_TOOLS.every((t) => /\(example\)$/.test(t.name)), 'seed tools are labelled as examples');
  assert.deepEqual([...SEED_MATERIALS], ['Si', 'SiO2 (thermal)', 'SiO2 (PECVD)', 'Si3N4 (LPCVD)', 'SiNx (PECVD)',
    'Al', 'Au', 'Cr', 'Ti', 'Positive resist', 'Negative resist']);
});

test('the seeded Oxide etch template matches the spec example on every lookup property', () => {
  const seeded = seedRecords().templates.find((t) => t.name === 'Oxide etch');
  assert.ok(seeded);
  const pick = (/** @type {any} */ f) => ({
    key: f.key, type: f.type, role: f.role, unit: f.unit, spreadHint: f.spreadHint,
    weight: f.weight, chemistry: f.chemistry, matchExact: f.matchExact,
  });
  assert.deepEqual(seeded.fields.map(pick), oxideEtchTemplate.fields.map(pick));
  assert.deepEqual(seeded.derived, oxideEtchTemplate.derived);
  assert.equal(seeded.primaryOutput, 'etchRate');
});

test('validateField rejects bad keys, empty choices and misplaced flags', () => {
  assert.deepEqual(validateField({ key: 'icpPower', label: 'ICP', type: 'number', role: 'input' }), []);
  assert.ok(validateField({ key: '1abc', label: 'x', type: 'number', role: 'input' }).length);
  assert.ok(validateField({ key: 'a.b', label: 'x', type: 'number', role: 'input' }).length);
  assert.ok(validateField({ key: 'gas', label: 'Gas', type: 'select', role: 'input' }).length);
  assert.ok(validateField({ key: 'p', label: 'P', type: 'number', role: 'input', matchExact: true }).length);
  assert.ok(validateField({ key: 't', label: 'T', type: 'text', role: 'input', chemistry: true }).length);
  assert.ok(validateField({ key: 'p', label: 'P', type: 'number', role: 'input', step: 0 }).length);
  assert.ok(validateField({ key: 'p', label: 'P', type: 'number', role: 'input', weight: -1 }).length);
  assert.ok(validateField({ key: 'p', label: 'P', type: 'number', role: 'input', min: 5, max: 1 }).length);
  assert.ok(validateField({ key: 'p', label: '', type: 'number', role: 'input' }).length);
  assert.ok(validateField({ key: 'p', label: 'P', type: 'float', role: 'input' }).length);
});

test('validateTemplateBody checks keys, derived entries, primary output and required count', () => {
  const ok = structuredClone(oxideEtchTemplate);
  assert.deepEqual(validateTemplateBody(ok), []);
  const dup = structuredClone(ok);
  dup.fields.push({ ...dup.fields[0] });
  assert.ok(validateTemplateBody(dup).some((e) => e.includes('duplicate')));
  const badOut = structuredClone(ok);
  badOut.derived = [{ output: 'icpPower', fn: 'etchRate' }];
  assert.ok(validateTemplateBody(badOut).some((e) => e.includes('output')));
  const noTime = structuredClone(ok);
  noTime.fields = noTime.fields.filter((/** @type {any} */ f) => f.key !== 'time');
  noTime.derived = [{ output: 'etchRate', fn: 'etchRate' }];
  assert.ok(validateTemplateBody(noTime).some((e) => e.includes('duration')));
  const badFn = structuredClone(ok);
  badFn.derived = [{ output: 'etchRate', fn: 'magic' }];
  assert.ok(validateTemplateBody(badFn).length);
  const badPrimary = structuredClone(ok);
  badPrimary.primaryOutput = 'pressure';
  assert.ok(validateTemplateBody(badPrimary).some((e) => e.includes('primary')));
  const tooMany = structuredClone(ok);
  tooMany.fields.forEach((/** @type {any} */ f) => { f.required = true; });
  assert.ok(tooMany.fields.length > MAX_REQUIRED_FIELDS);
  assert.ok(validateTemplateBody(tooMany).some((e) => e.includes('required')));
});

test('validateRecord checks runs, measurements and events', () => {
  const run = normalizeRecord('runs', { ...base, toolId: 't', status: 'open', startedAt: base.createdAt });
  assert.deepEqual(validateRecord('runs', run), []);
  assert.ok(validateRecord('runs', { ...run, status: 'done' }).length);
  assert.ok(validateRecord('runs', { ...run, params: { a: NaN } }).length);
  assert.ok(validateRecord('runs', { ...run, params: { a: { b: 1 } } }).length);
  assert.ok(validateRecord('runs', { ...run, tags: 'x' }).length);
  assert.ok(validateRecord('runs', { ...run, startedAt: 'yesterday' }).length);
  assert.deepEqual(validateRecord('runs', { ...run, params: { a: 1, b: 'x', c: true, d: null } }), []);

  const m = normalizeRecord('measurements', { ...base, runId: 'r', phase: 'pre', takenAt: base.createdAt, points: [{ site: 'C', value: 1 }] });
  assert.deepEqual(validateRecord('measurements', m), []);
  assert.ok(validateRecord('measurements', { ...m, points: [{ site: 'C', value: 'x' }] }).length);
  assert.ok(validateRecord('measurements', { ...m, phase: 'mid' }).length);

  const e = normalizeRecord('events', { ...base, toolId: 't', type: 'clean', major: true, at: base.createdAt });
  assert.deepEqual(validateRecord('events', e), []);
  assert.ok(validateRecord('events', { ...e, type: 'party' }).length);
  assert.ok(validateRecord('nope', e).length);
  assert.ok(validateRecord('runs', null).length);
});

test('normalizeRecord fills optional fields without inventing required ones', () => {
  const r = normalizeRecord('runs', { id: 'r1', updatedAt: base.updatedAt, toolId: 't', startedAt: base.createdAt });
  assert.equal(r.createdAt, base.updatedAt);
  assert.equal(r.deleted, false);
  assert.deepEqual(r.params, {});
  assert.deepEqual(r.tags, []);
  assert.equal(r.status, 'open');
  const noId = normalizeRecord('tools', { name: 'x' });
  assert.equal(noId.id, undefined);
  assert.ok(validateRecord('tools', noId).some((e) => e.includes('id')));
});

test('backup envelope validation', () => {
  const ok = { format: 'lnf-runlog', version: SCHEMA_VERSION, tools: [], templates: [], runs: [], measurements: [], events: [] };
  assert.deepEqual(validateBackupEnvelope(ok), []);
  assert.ok(validateBackupEnvelope(null).length);
  assert.ok(validateBackupEnvelope({ ...ok, format: 'other' })[0].includes('not an LNF'));
  assert.ok(validateBackupEnvelope({ ...ok, version: SCHEMA_VERSION + 1 })[0].includes('newer'));
  assert.ok(validateBackupEnvelope({ ...ok, runs: undefined }).length);
  assert.ok(validateBackupEnvelope({ ...ok, photos: 'x' }).length);
});

test('migrations are ordered, start at 1 and end at the schema version', () => {
  const versions = MIGRATIONS.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
  assert.equal(versions[0], 1);
  assert.equal(versions[versions.length - 1], SCHEMA_VERSION);
  const recs = [{ id: 'a' }];
  assert.deepEqual(migrateRecords('runs', recs, SCHEMA_VERSION), recs);
});
