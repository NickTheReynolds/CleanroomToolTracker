// @ts-check
// JSON backup, merge import and CSV export: the pure logic in data/export-import.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  buildBackup, exportableSettings, backupFileName, mergeStore, planImport, mergeMaterials, encodePhoto,
  bytesToBase64, base64ToBytes, csvCell, toCsv, runsCsv, measurementsCsv, eventsCsv, MAX_ERRORS,
} from '../app/js/data/export-import.js';
import { SCHEMA_VERSION, DATA_STORES, validateBackupEnvelope, normalizeRecord } from '../app/js/data/schema.js';
import { DEFAULT_SETTINGS, DEVICE_SETTINGS } from '../app/js/data/records.js';
import { seedRecords } from '../app/js/data/seed-tools.js';
import { tool, template, runs, runA, runB, runC, cleanEvent, measurement } from './fixtures.mjs';

const T1 = '2026-10-01T00:00:00.000Z';
const T2 = '2026-10-02T00:00:00.000Z';
const T3 = '2026-10-03T00:00:00.000Z';
const EXPORTED = '2026-10-20T12:00:00.000Z';

/** Full settings, device-specific values included. */
const settings = {
  ...DEFAULT_SETTINGS,
  userName: 'Ana', deviceName: 'Lab phone', deviceId: 'dev-secret', theme: 'dark', lastExportAt: T1,
  iosHintDismissed: true, persistAsked: true, firstRunAt: T1, sync: { url: 'sync-server', token: 'tok' },
  materials: ['Si', 'SiO2 (thermal)'], tuning: { halfLifeDays: 45 },
};

/**
 * A valid tool event.
 * @param {string} id
 * @param {string} updatedAt
 * @param {Record<string, any>} [extra]
 */
const ev = (id, updatedAt, extra = {}) => ({ ...cleanEvent, id, createdAt: T1, updatedAt, ...extra });

/** A stored photo; `blob` stands in for the real Blob, which the pure code never opens. */
const photo = {
  id: 'p1', createdAt: T1, updatedAt: T1, deleted: false, deviceId: 'd', author: 'a',
  runId: 'A', width: 4, height: 3, caption: 'wafer', takenAt: T1, blob: { stand: 'in' },
};

/** @returns {Record<string, any[]>} a device with no records */
const emptyDb = () => Object.fromEntries(DATA_STORES.map((s) => [s, []]));

/**
 * Split CSV text naively (the values used here hold no commas or quotes).
 * @param {string} csv
 * @returns {string[][]}
 */
const cells = (csv) => csv.trimEnd().split('\r\n').map((l) => l.split(','));

/** @param {Record<string, any>} b */
const minimal = (b = {}) => buildBackup({
  tools: [], templates: [], runs: [], measurements: [], events: [], settings, appVersion: '1.0.0', exportedAt: EXPORTED, ...b,
});

test('buildBackup writes the envelope, keeps only materials, their answers and tuning, and adds photos only when given', () => {
  const b = buildBackup({
    tools: [tool], templates: [template], runs, measurements: [], events: [cleanEvent], settings, appVersion: '1.2.3', exportedAt: EXPORTED,
  });
  assert.deepEqual(Object.keys(b), [
    'format', 'version', 'appVersion', 'exportedAt', 'tools', 'templates', 'runs', 'measurements', 'events', 'projects', 'folders',
    'wafers', 'settings',
  ]);
  assert.deepEqual(b.projects, [], 'no projects given: an empty list');
  assert.deepEqual(b.folders, [], 'no folders given: an empty list');
  assert.deepEqual(b.wafers, [], 'no saved wafers given: an empty list');
  assert.equal(b.format, 'lnf-runlog');
  assert.equal(b.version, SCHEMA_VERSION);
  assert.equal(b.appVersion, '1.2.3');
  assert.equal(b.exportedAt, EXPORTED);
  assert.deepEqual(b.runs, runs);
  assert.deepEqual(b.settings, { materials: ['Si', 'SiO2 (thermal)'], materialKinds: {}, tuning: { halfLifeDays: 45 } });
  for (const k of DEVICE_SETTINGS) assert.ok(!(k in b.settings), `${k} must stay on the device`);
  const text = JSON.stringify(b);
  for (const secret of ['dev-secret', 'Lab phone', 'sync-server']) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(validateBackupEnvelope(JSON.parse(text)), []);

  const withPhotos = minimal({ photos: [] });
  assert.deepEqual(withPhotos.photos, []);
  assert.equal(Object.keys(withPhotos).at(-1), 'photos');
  assert.deepEqual(exportableSettings(null), { materials: [], materialKinds: {}, tuning: {} });
  const ex = exportableSettings({ materials: ['Al', 7], tuning: { topK: 3 } });
  assert.deepEqual(ex, { materials: ['Al'], materialKinds: {}, tuning: { topK: 3 } });
});

test('backupFileName uses the local calendar date', () => {
  assert.equal(backupFileName(new Date(2026, 0, 5, 23, 59)), 'lnf-runlog-backup-2026-01-05.json');
  assert.equal(backupFileName(new Date(2026, 9, 20, 0, 1)), 'lnf-runlog-backup-2026-10-20.json');
  assert.match(backupFileName(), /^lnf-runlog-backup-\d{4}-\d{2}-\d{2}\.json$/);
});

test('mergeStore adds new ids, takes strictly newer versions and skips older or equal ones', () => {
  const existing = [ev('newer', T2, { notes: 'local' }), ev('older', T2, { notes: 'local' }), ev('tie', T2, { notes: 'local' }), ev('untouched', T2)];
  const incoming = [
    { id: 'new', createdAt: T1, updatedAt: T1, toolId: 'tool-icp', type: 'pm', at: T1 },
    ev('newer', T3, { notes: 'from backup' }),
    ev('older', T1, { notes: 'stale' }),
    ev('tie', T2, { notes: 'same time' }),
  ];
  const r = mergeStore('events', existing, incoming, SCHEMA_VERSION);
  assert.deepEqual(r.counts, { added: 1, updated: 1, skipped: 2, invalid: 0 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.put.map((x) => x.id), ['new', 'newer']);
  assert.equal(r.put[1].notes, 'from backup');
  // Incoming records are normalised: missing optional fields get their defaults.
  assert.deepEqual(r.put[0], {
    id: 'new', createdAt: T1, updatedAt: T1, toolId: 'tool-icp', type: 'pm', at: T1,
    deleted: false, deviceId: '', author: '', major: false, notes: '',
  });
  // The same id twice in one backup: the newer copy is the one written.
  const twice = mergeStore('events', [], [ev('d', T2, { notes: 'first' }), ev('d', T3, { notes: 'second' }), ev('d', T1)]);
  assert.deepEqual(twice.put.map((x) => x.notes), ['second']);
});

test('mergeStore respects tombstones both ways and never deletes anything', () => {
  const existing = [ev('a', T1), ev('b', T3, { deleted: true }), ev('c', T1)];
  const incoming = [ev('a', T2, { deleted: true }), ev('b', T2, { notes: 'edited before the local delete' }), ev('z', T2, { deleted: true })];
  const r = mergeStore('events', existing, incoming);
  assert.deepEqual(r.counts, { added: 1, updated: 1, skipped: 1, invalid: 0 });
  const byId = Object.fromEntries(r.put.map((x) => [x.id, x]));
  assert.equal(byId.a.deleted, true, 'a newer incoming tombstone deletes');
  assert.equal(byId.b, undefined, 'a newer local tombstone keeps the record deleted');
  assert.equal(byId.z.deleted, true, 'an unknown tombstone is kept as a tombstone');
  assert.equal(byId.c, undefined, 'records missing from the backup are left alone');
  const restored = mergeStore('events', [ev('b', T2, { deleted: true })], [ev('b', T3)]);
  assert.equal(restored.counts.updated, 1);
  assert.equal(restored.put[0].deleted, false, 'a newer restore undeletes');
});

test('mergeStore counts invalid records and keeps the first few reasons', () => {
  const bad = [
    null, 'text', [], { id: 'no-fields' }, ev('bad-date', 'yesterday'), ev('bad-type', T1, { type: 'party' }),
    ev('bad-at', T1, { at: 'soon' }), ev('bad-major', T1, { major: 'yes' }),
  ];
  const r = mergeStore('events', [], [...bad, ev('good', T1)]);
  assert.deepEqual(r.counts, { added: 1, updated: 0, skipped: 0, invalid: bad.length });
  assert.equal(r.errors.length, MAX_ERRORS);
  assert.match(r.errors[0], /^events #1: not a record/);
  assert.match(r.errors[3], /^events #4 \(no-fields\): .*\(\+\d more\)$/);
  assert.match(r.errors[4], /^events #5 \(bad-date\): updatedAt must be a date/);
  assert.deepEqual(r.put.map((x) => x.id), ['good']);

  const photos = mergeStore('photos', [], [encodePhoto(photo, 'not base64!'), encodePhoto({ ...photo, id: 'p2' }, 'AAE=')]);
  assert.deepEqual(photos.counts, { added: 1, updated: 0, skipped: 0, invalid: 1 });
  assert.match(photos.errors[0], /photo data is not base64/);
});

test('merging never modifies its inputs', () => {
  const existing = Object.freeze([Object.freeze(ev('a', T1)), Object.freeze({ ...photo })]);
  const incoming = Object.freeze([Object.freeze(ev('a', T2)), Object.freeze(ev('b', T1))]);
  const before = structuredClone([existing, incoming]);
  mergeStore('events', [...existing], [...incoming]);
  mergeStore('photos', [existing[1]], [Object.freeze(encodePhoto({ ...photo, updatedAt: T2 }, null))]);
  assert.deepEqual([existing, incoming], before);
});

test('photos: base64 data travels as is, and a record without data keeps the stored image', () => {
  const encoded = encodePhoto(photo, 'AAECAw==', 'image/jpeg');
  assert.ok(!('blob' in encoded));
  assert.equal(encoded.data, 'AAECAw==');
  assert.equal(encoded.type, 'image/jpeg');
  assert.deepEqual(mergeStore('photos', [], [encoded]).put, [encoded]);

  const renamed = encodePhoto({ ...photo, caption: 'renamed', updatedAt: T3 }, null);
  assert.equal(renamed.blob, null);
  const r = mergeStore('photos', [photo], [renamed]);
  assert.equal(r.counts.updated, 1);
  assert.equal(r.put[0].caption, 'renamed');
  assert.equal(r.put[0].blob, photo.blob, 'the stored image is kept');
  assert.ok(!('data' in r.put[0]));
  const oldSafari = { ...photo, blob: null, bytes: new ArrayBuffer(3), type: 'image/png' };
  const r2 = mergeStore('photos', [oldSafari], [renamed]);
  assert.equal(r2.put[0].bytes, oldSafari.bytes);
  assert.equal(r2.put[0].type, 'image/png');
});

test('planImport merges every store and unions the materials list', () => {
  const local = { ...emptyDb(), tools: [tool], templates: [template], runs: [runA], photos: [photo] };
  const editedA = { ...runA, notes: 'edited on the PC', updatedAt: '2026-10-21T00:00:00.000Z' };
  const backup = JSON.parse(JSON.stringify(minimal({
    tools: [tool], templates: [template], runs: [editedA, runB, { ...runC, status: 'finished' }],
    measurements: [measurement('m1', 'pre', [1000])], events: [cleanEvent],
    settings: { materials: ['si', 'SiO₂ (THERMAL)', ' Pt ', '', 'Pt'] },
    photos: [encodePhoto({ ...photo, id: 'p2' }, 'AAAA', 'image/jpeg')],
  })));
  const plan = planImport(local, backup, ['Si', 'SiO2 (thermal)', 'Au']);
  assert.deepEqual(Object.keys(plan.put).sort(), [...DATA_STORES].sort());
  assert.deepEqual(plan.counts, {
    tools: { added: 0, updated: 0, skipped: 1, invalid: 0 },
    templates: { added: 0, updated: 0, skipped: 1, invalid: 0 },
    runs: { added: 1, updated: 1, skipped: 0, invalid: 1 },
    measurements: { added: 1, updated: 0, skipped: 0, invalid: 0 },
    events: { added: 1, updated: 0, skipped: 0, invalid: 0 },
    photos: { added: 1, updated: 0, skipped: 0, invalid: 0 },
    projects: { added: 0, updated: 0, skipped: 0, invalid: 0 },
    folders: { added: 0, updated: 0, skipped: 0, invalid: 0 },
    wafers: { added: 0, updated: 0, skipped: 0, invalid: 0 },
  });
  assert.deepEqual(plan.put.runs.map((r) => [r.id, r.notes]), [['A', 'edited on the PC'], ['B', '']]);
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /^runs #3 \(C\): status must be one of/);
  assert.deepEqual(plan.materials, ['Si', 'SiO2 (thermal)', 'Au', 'Pt']);
  assert.equal(planImport(local, backup, ['Si', 'SiO2 (thermal)', 'Pt']).materials, null, 'nothing new: no settings write');
});

test('mergeMaterials keeps the local list and order, and appends new names without NFKC or case duplicates', () => {
  const local = ['Si', 'SiO2 (thermal)', 'Au'];
  assert.deepEqual(mergeMaterials(local, ['AU', 'sio₂ (thermal)', ' Pt ', '', '  ', 3, null, 'pt', 'Cr']),
    ['Si', 'SiO2 (thermal)', 'Au', 'Pt', 'Cr']);
  assert.deepEqual(local, ['Si', 'SiO2 (thermal)', 'Au'], 'the local list is not modified');
  assert.deepEqual(mergeMaterials([], []), []);
});

test('a backup from a newer format is refused before anything is planned', () => {
  const newer = { ...minimal(), version: SCHEMA_VERSION + 1 };
  const errs = validateBackupEnvelope(newer);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /newer app version/);
  const plan = planImport({ ...emptyDb(), runs: [runA] }, { ...newer, runs: [runB] }, ['Si']);
  assert.deepEqual(plan.errors, errs);
  for (const s of DATA_STORES) assert.deepEqual(plan.put[s], [], s);
  assert.equal(plan.materials, null);
  assert.match(validateBackupEnvelope({ ...minimal(), format: 'something-else' })[0], /not an LNF/);
});

test('csvCell quotes per RFC 4180 and defuses spreadsheet formulas', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(85), '85');
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(0.1), '0.1');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell(true), 'true');
  assert.equal(csvCell(false), 'false');
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('SiO₂ 5 µm, 20 °C'), '"SiO₂ 5 µm, 20 °C"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell('=SUM(A1:A3)'), "'=SUM(A1:A3)");
  assert.equal(csvCell('+cmd'), "'+cmd");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@here'), "'@here");
  assert.equal(csvCell('\tx'), "'\tx");
  assert.equal(csvCell('\rx'), '"\'\rx"');
  assert.equal(csvCell('=1,2'), '"\'=1,2"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  for (const n of ['-5', '+3.5', '-1.5e3', '-.25']) assert.equal(csvCell(n), n, `${n} is a plain number`);
});

test('toCsv ends every line with CRLF and adds no byte-order mark', () => {
  const text = toCsv([['a', 'b'], [1, 'x,y'], [null, '=x']]);
  assert.equal(text, 'a,b\r\n1,"x,y"\r\n,\'=x\r\n');
  assert.notEqual(text.charCodeAt(0), 0xfeff);
  assert.equal(toCsv([]), '');
});

test('runsCsv: fixed columns, then p. and r. columns across templates; deleted runs left out', () => {
  const depTool = { ...tool, id: 'tool-dep', name: 'Sputter', shortName: 'SPT', category: 'deposition' };
  const depTemplate = { ...template, id: 'tpl-dep', toolId: 'tool-dep', name: 'Metal film' };
  const runX = {
    ...runA, id: 'X', toolId: 'tool-dep', templateId: 'tpl-dep', startedAt: '2026-10-07T12:00:00Z', material: 'Al',
    params: { power: 200, time: 330 }, results: { depRate: 12.5 }, tags: ['lot 7', 'test'], notes: '=cmd',
    targetThickness: 100, recipe: 'AL-01',
  };
  const gone = { ...runB, id: 'G', deleted: true, params: { ghostParam: 1 }, results: { ghostResult: 2 } };
  const csv = runsCsv([runB, runX, gone, runA], [tool, depTool], [template, depTemplate]);
  const rows = cells(csv);
  assert.deepEqual(rows[0], [
    'id', 'tool', 'template', 'status', 'startedAt', 'endedAt', 'material', 'substrate', 'maskMaterial', 'recipe',
    'targetThickness_nm', 'tags', 'notes', 'author', 'createdAt', 'updatedAt', 'projects', 'steps',
    'p.chf3', 'p.icpPower', 'p.o2', 'p.power', 'p.pressure', 'p.time', 'r.depRate', 'r.etchRate',
  ]);
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ['A', 'X', 'B'], 'oldest first; the deleted run is left out');
  assert.ok(!csv.includes('ghost'));
  const col = (/** @type {string} */ name) => rows[0].indexOf(name);
  const x = rows[2];
  assert.equal(x[col('tool')], 'Sputter');
  assert.equal(x[col('template')], 'Metal film');
  assert.equal(x[col('p.time')], '330', 'durations stay in seconds');
  assert.equal(x[col('p.icpPower')], '', 'a key this run lacks is empty');
  assert.equal(x[col('r.depRate')], '12.5');
  assert.equal(x[col('tags')], 'lot 7; test');
  assert.equal(x[col('notes')], "'=cmd");
  assert.equal(x[col('targetThickness_nm')], '100');
  assert.equal(rows[1][col('tool')], 'ICP etcher');
  assert.equal(rows[1][col('p.icpPower')], '400');
  assert.equal(rows[1][col('r.etchRate')], '85');
  assert.equal(rows[1][col('endedAt')], '');
  const proto = cells(runsCsv([{ ...runA, params: { constructor: 1 } }, runB], [tool], [template]));
  assert.equal(proto[2][proto[0].indexOf('p.constructor')], '', 'inherited properties are never read');
});

test('measurementsCsv summarises points, fills a blank material from the run and skips deleted records', () => {
  const runD = { ...runA, id: 'D', material: 'SiO2' };
  const runGone = { ...runB, id: 'G', deleted: true };
  const pre = { ...measurement('m-pre', 'pre', [1000]), material: '' };
  const post = measurement('m-post', 'post', [412, 398, 405]);
  const deleted = { ...measurement('m-del', 'post', [1]), deleted: true };
  const ofDeletedRun = { ...measurement('m-gone', 'post', [5]), runId: 'G' };
  const lost = { ...measurement('m-lost', 'post', [7]), runId: 'nowhere', metrologyToolId: 'old-tool', takenAt: '2026-10-19T14:00:00Z' };
  const ellipsometer = { ...tool, id: 'ellipsometer', name: 'Ellipsometer', kind: 'metrology', category: 'metrology' };
  const rows = cells(measurementsCsv([post, deleted, lost, ofDeletedRun, pre], [runD, runGone], [ellipsometer]));
  assert.deepEqual(rows[0], [
    'id', 'runId', 'metrologyTool', 'kind', 'phase', 'material', 'unit', 'n', 'mean', 'min', 'max', 'uniformity_pct',
    'points', 'takenAt', 'notes',
  ]);
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ['m-pre', 'm-post', 'm-lost']);
  const [, preRow, postRow, lostRow] = rows;
  assert.deepEqual(preRow.slice(2, 12), ['Ellipsometer', 'thickness', 'pre', 'SiO2', 'nm', '1', '1000', '1000', '1000', '']);
  assert.deepEqual(postRow.slice(7, 11), ['3', '405', '398', '412']);
  assert.ok(Math.abs(Number(postRow[11]) - 1.728) < 0.001, 'uniformity in %');
  assert.equal(postRow[12], '1=412; 2=398; 3=405');
  assert.equal(postRow[13], '2026-10-19T13:00:00Z');
  assert.equal(lostRow[2], 'old-tool', 'an unknown tool shows its id');
});

test('eventsCsv lists live events oldest first with tool names', () => {
  const pm = { ...cleanEvent, id: 'e-pm', type: 'pm', major: false, at: '2026-09-01T08:00:00Z', notes: 'new liner, checked rates' };
  const gone = { ...cleanEvent, id: 'e-gone', deleted: true };
  assert.equal(eventsCsv([cleanEvent, gone, pm], [tool]), 'id,tool,type,major,at,notes\r\n'
    + 'e-pm,ICP etcher,pm,false,2026-09-01T08:00:00Z,"new liner, checked rates"\r\n'
    + 'event-clean,ICP etcher,clean,true,2026-10-10T12:00:00Z,\r\n');
});

test('base64 helpers encode in chunks that join cleanly', () => {
  for (const n of [0, 1, 2, 3, 4, 24575, 24576, 24577, 100001]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256);
    const b64 = bytesToBase64(bytes);
    assert.equal(b64, Buffer.from(bytes).toString('base64'), `n = ${n}`);
    assert.deepEqual(base64ToBytes(b64), bytes);
  }
});

test('round trip: backup -> JSON -> import into an empty device reproduces every record exactly', () => {
  const seed = seedRecords();
  const unicodeRun = {
    ...runC, id: 'U', status: 'open', material: 'SiO₂ (PECVD)', substrate: 'Si ⟨100⟩', endedAt: '2026-07-22T13:00:00Z',
    notes: 'Résumé: "quoted", comma, line\nbreak, µm Ω °C', tags: ['α', 'β'],
    params: { ...runC.params, time: 90.5 }, results: { etchRate: 70.123456789, uniformity: null },
  };
  /** @type {Record<string, any[]>} */
  const data = {
    tools: [...seed.tools, tool],
    templates: [...seed.templates, template],
    runs: [...runs, unicodeRun, { ...runB, id: 'deleted-run', deleted: true, updatedAt: T3 }],
    measurements: [measurement('m1', 'pre', [1000, 1001.5]), measurement('m2', 'post', [575])],
    events: [cleanEvent, { ...cleanEvent, id: 'deleted-event', deleted: true }],
    photos: [
      encodePhoto(photo, bytesToBase64(new Uint8Array([0, 1, 2, 250, 255])), 'image/jpeg'),
      encodePhoto({ ...photo, id: 'p-deleted', deleted: true }, null),
    ],
    projects: [{
      id: 'P', createdAt: T1, updatedAt: T2, deleted: false, deviceId: 'dev-a', author: 'Ana', name: 'Résonateurs batch 3', goal: 'Release',
      status: 'active', startedAt: T1, endedAt: null, substrate: 'Si', notes: 'α', folderId: 'F2',
      wafers: [
        { id: 'w1', label: 'W1', status: 'active', notes: '', spec: { material: 'Si', size: '100mm', orientation: '<100>' }, specId: 'lnf-store/wafer-4in-p-10-20' },
        { id: 'w2', label: 'W2', status: 'scrapped', notes: 'chipped' },
        { id: 'm1', label: 'M1', status: 'active', notes: '', spec: { kind: 'mask', size: 'plate5', design: 'Résonateur, layer 1' }, specId: null },
      ],
      steps: [
        { id: 's1', title: 'Etch', toolId: tool.id, templateId: null, recipe: '', notes: '', doneAt: null, skipped: false, waferIds: ['w1', 'm1'], checked: ['size:w1'] },
        { id: 's2', title: 'Bond', toolId: null, templateId: null, recipe: '', notes: '', doneAt: null, skipped: false,
          bonds: [{ id: 'b1', waferIds: ['w1', 'w2'], method: 'anodic' }], adds: ['Au'], removes: ['Photoresist'], debond: false },
      ],
    }],
    folders: [
      { id: 'F1', createdAt: T1, updatedAt: T1, deleted: false, deviceId: 'dev-a', author: 'Ana', name: 'Thèse', parentId: null },
      { id: 'F2', createdAt: T1, updatedAt: T2, deleted: false, deviceId: 'dev-a', author: 'Ana', name: 'Chapitre 3', parentId: 'F1' },
      { id: 'F3', createdAt: T1, updatedAt: T3, deleted: true, deviceId: 'dev-b', author: 'Ben', name: 'Old', parentId: null },
    ],
    wafers: [
      { id: 'S1', createdAt: T1, updatedAt: T2, deleted: false, deviceId: 'dev-a', author: 'Ana', name: 'Si 100 mm DSP',
        spec: { material: 'Si', size: '100mm', polish: 'dsp', films: [{ material: 'SiO2 (thermal)', thicknessNm: 2000 }] } },
      { id: 'S2', createdAt: T1, updatedAt: T3, deleted: true, deviceId: 'dev-b', author: 'Ben', name: 'Old mask', spec: { kind: 'mask', size: 'plate5' } },
    ],
  };
  const text = JSON.stringify(buildBackup({
    tools: data.tools, templates: data.templates, runs: data.runs, measurements: data.measurements, events: data.events,
    photos: data.photos, projects: data.projects, folders: data.folders, wafers: data.wafers, settings, appVersion: '1.0.0', exportedAt: EXPORTED,
  }));
  const plan = planImport(emptyDb(), JSON.parse(text), []);
  assert.deepEqual(plan.errors, []);
  for (const s of DATA_STORES) {
    // As stored: records written before a field existed get its empty default (runs: steps, projects).
    assert.deepEqual(plan.put[s], data[s].map((r) => (s === 'photos' ? r : normalizeRecord(s, r))), `${s} differ after the round trip`);
    assert.deepEqual(plan.counts[s], { added: data[s].length, updated: 0, skipped: 0, invalid: 0 }, s);
  }
  assert.deepEqual(plan.materials, settings.materials);
  // Importing the same file again changes nothing.
  const again = planImport(plan.put, JSON.parse(text), plan.materials || []);
  for (const s of DATA_STORES) assert.deepEqual(again.put[s], [], s);
  assert.equal(again.materials, null);
});
