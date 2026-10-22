// @ts-check
// GitHub sync: client, codec, snapshot merge rules, and multi-device
// convergence against an in-memory fake of the GitHub API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubClient, parseRepo, GitHubError } from '../app/js/sync/github.js';
import { encodeSyncFile, decodeSyncFile } from '../app/js/sync/codec.js';
import { buildSnapshot, validateSnapshot, planMerge, SYNC_STORES, describeResult } from '../app/js/sync/plan.js';
import { runSync, checkRepo } from '../app/js/sync/sync.js';
import { normalizeRecord, SCHEMA_VERSION } from '../app/js/data/schema.js';

const TOKEN = 'github_pat_test';

/** @param {number} status @param {unknown} body @param {Record<string, string>} [headers] */
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** An in-memory GitHub with one repository, lab/data. */
function fakeGitHub({ isPrivate = true } = {}) {
  /** @type {Map<string, {sha: string, bytes: Uint8Array}>} */
  const files = new Map();
  /** @type {string[]} */
  const calls = [];
  let n = 0;
  /** @type {(path: string) => void} */
  let beforePut = () => {};
  /** @param {any} url @param {any} [init] */
  const fetchFn = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    calls.push(`${method} ${u.pathname}`);
    if (init.headers.Authorization !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' });
    const p = u.pathname;
    if (p === '/repos/lab/data' && method === 'GET') return json(200, { private: isPrivate, full_name: 'lab/data', permissions: { push: true } });
    let m = /^\/repos\/lab\/data\/contents\/(.+)$/.exec(p);
    if (m) {
      const path = m[1].split('/').map(decodeURIComponent).join('/');
      if (method === 'GET') {
        const entries = [...files].filter(([k]) => k.startsWith(`${path}/`))
          .map(([k, v]) => ({ name: k.slice(path.length + 1), path: k, sha: v.sha, type: 'file', size: v.bytes.length }));
        return entries.length ? json(200, entries) : json(404, { message: 'Not Found' });
      }
      beforePut(path);
      const body = JSON.parse(init.body);
      const cur = files.get(path);
      if (cur && body.sha !== cur.sha) return json(409, { message: 'sha does not match' });
      if (!cur && body.sha) return json(422, { message: 'sha given for a new file' });
      const sha = `sha${++n}`;
      files.set(path, { sha, bytes: new Uint8Array(Buffer.from(body.content, 'base64')) });
      return json(cur ? 200 : 201, { content: { sha } });
    }
    m = /^\/repos\/lab\/data\/git\/blobs\/(.+)$/.exec(p);
    if (m) {
      const hit = [...files.values()].find((v) => v.sha === m?.[1]);
      return hit ? json(200, { content: Buffer.from(hit.bytes).toString('base64'), encoding: 'base64' }) : json(404, { message: 'Not Found' });
    }
    return json(404, { message: 'Not Found' });
  };
  return { fetchFn, files, calls, setBeforePut: (/** @type {(path: string) => void} */ f) => { beforePut = f; } };
}

const T = (/** @type {number} */ day) => `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`;

/**
 * @param {string} store @param {string} id @param {string} at updatedAt @param {string} deviceId @param {Record<string, any>} [extra]
 */
function rec(store, id, at, deviceId, extra = {}) {
  const fields = {
    tools: { name: `Tool ${id}`, category: 'etch', kind: 'process' },
    runs: { toolId: 't1', templateId: null, status: 'open', startedAt: T(1) },
    events: { toolId: 't1', type: 'clean', major: true, at: T(1) },
  }[store] || {};
  return normalizeRecord(store, { id, createdAt: at, updatedAt: at, deviceId, author: deviceId, ...fields, ...extra });
}

/** A device whose storage lives in memory. */
function device(/** @type {string} */ deviceId, /** @type {Record<string, any[]>} */ seed = {}) {
  /** @type {Record<string, any[]>} */
  const db = { tools: [], templates: [], runs: [], measurements: [], events: [], ...structuredClone(seed) };
  const settings = { deviceId, deviceName: `Device ${deviceId}`, userName: `User ${deviceId}`, materials: ['Si'], sync: { repo: 'lab/data', token: TOKEN } };
  /** @type {string[]} */
  const recomputed = [];
  const store = {
    read: async () => structuredClone(db),
    /** @param {any} plan */
    write: async (plan) => {
      for (const s of SYNC_STORES) {
        for (const r of plan.put[s]) {
          const i = db[s].findIndex((x) => x.id === r.id);
          if (i >= 0) db[s][i] = r; else db[s].push(r);
        }
      }
      if (plan.materials) settings.materials = plan.materials;
    },
    /** @param {string[]} ids */
    recompute: async (ids) => { recomputed.push(...ids); },
    settings: async () => /** @type {any} */ (structuredClone(settings)),
    /** @param {any} sync */
    saveSync: async (sync) => { settings.sync = sync; },
  };
  return { db, settings, store, recomputed };
}

/** @param {ReturnType<typeof fakeGitHub>} gh @param {ReturnType<typeof device>} d */
const sync = (gh, d) => runSync({
  gh: githubClient({ repo: 'lab/data', token: TOKEN, fetch: /** @type {any} */ (gh.fetchFn) }), store: d.store, appVersion: 'test',
});

test('parseRepo accepts owner/name and github.com addresses only', () => {
  assert.equal(parseRepo('lab/data'), 'lab/data');
  assert.equal(parseRepo(' https://github.com/lab/data.git/ '), 'lab/data');
  assert.equal(parseRepo('lab'), null);
  assert.equal(parseRepo('lab/data/extra'), null);
  assert.equal(parseRepo('lab/..'), null);
  assert.equal(parseRepo('https://example.com/lab/data'), null);
  assert.throws(() => githubClient({ repo: 'nope', token: 'x' }), GitHubError);
});

test('sync files round-trip, compressed or not', async () => {
  const obj = { a: 'SiO₂ résist', n: [1, 2, 3] };
  const gz = await encodeSyncFile(obj, true);
  assert.deepEqual([...gz.subarray(0, 2)], [0x1f, 0x8b]);
  assert.deepEqual(await decodeSyncFile(gz), obj);
  assert.deepEqual(await decodeSyncFile(await encodeSyncFile(obj, false)), obj);
  await assert.rejects(decodeSyncFile(new TextEncoder().encode('{nope')), /damaged/);
});

test('GitHub errors become plain messages; a missing folder is an empty list', async () => {
  const gh = fakeGitHub();
  const bad = githubClient({ repo: 'lab/data', token: 'wrong', fetch: /** @type {any} */ (gh.fetchFn) });
  await assert.rejects(bad.repoInfo(), (e) => e instanceof GitHubError && e.status === 401 && /rejected the access token/.test(e.message));
  const good = githubClient({ repo: 'lab/data', token: TOKEN, fetch: /** @type {any} */ (gh.fetchFn) });
  assert.deepEqual(await good.list('lnf-runlog-sync/devices'), []);
  const other = githubClient({ repo: 'lab/other', token: TOKEN, fetch: /** @type {any} */ (gh.fetchFn) });
  await assert.rejects(other.repoInfo(), /Repository not found/);
  const offline = githubClient({ repo: 'lab/data', token: TOKEN, fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.repoInfo(), (e) => e instanceof GitHubError && e.status === 0);
  const limited = githubClient({ repo: 'lab/data', token: TOKEN, fetch: async () => json(403, { message: 'limit' }, { 'x-ratelimit-remaining': '0' }) });
  await assert.rejects(limited.repoInfo(), /request limit/);
});

test('sync refuses a public repository', async () => {
  const gh = fakeGitHub({ isPrivate: false });
  await assert.rejects(checkRepo(githubClient({ repo: 'lab/data', token: TOKEN, fetch: /** @type {any} */ (gh.fetchFn) })), /public/);
  await assert.rejects(sync(gh, device('a')), /public/);
  assert.equal(gh.files.size, 0, 'nothing was written');
});

test('two devices converge: additions, edits and deletions travel; unchanged files are not re-read', async () => {
  const gh = fakeGitHub();
  const a = device('aaa', { runs: [rec('runs', 'r1', T(2), 'aaa')], events: [rec('events', 'e1', T(2), 'aaa')] });
  const b = device('bbb', { runs: [rec('runs', 'r2', T(3), 'bbb')] });
  b.settings.materials = ['Si', 'LiNbO3 (bulk)'];
  const first = await sync(gh, a);
  assert.equal(first.devices, 0);
  assert.equal(gh.files.size, 1);
  const second = await sync(gh, b);
  assert.equal(second.added, 2);
  assert.deepEqual(b.db.runs.map((r) => r.id).sort(), ['r1', 'r2']);
  await sync(gh, a);
  assert.deepEqual(a.db.runs.map((r) => r.id).sort(), ['r1', 'r2']);
  assert.ok(a.settings.materials.includes('LiNbO3 (bulk)'), 'materials merge');
  assert.ok(a.recomputed.includes('r2'), 'derived results recomputed for merged runs');
  // B edits r1 and deletes e1; A picks both up.
  b.db.runs = b.db.runs.map((r) => (r.id === 'r1' ? { ...r, notes: 'edited on B', updatedAt: T(5), deviceId: 'bbb' } : r));
  b.db.events = b.db.events.map((e) => ({ ...e, deleted: true, updatedAt: T(5), deviceId: 'bbb' }));
  await sync(gh, b);
  await sync(gh, a);
  assert.equal(a.db.runs.find((r) => r.id === 'r1').notes, 'edited on B');
  assert.equal(a.db.events.find((e) => e.id === 'e1').deleted, true);
  // Nothing changed since: A reads no file again.
  const before = gh.calls.length;
  const quiet = await sync(gh, a);
  assert.equal(quiet.read, 0);
  assert.ok(!gh.calls.slice(before).some((c) => c.includes('/git/blobs/')));
  assert.match(describeResult(quiet), /1 other device · nothing new/);
});

test('files read by an app version that synced fewer stores are read once more', async () => {
  const gh = fakeGitHub();
  const project = normalizeRecord('projects', {
    id: 'P', createdAt: T(1), updatedAt: T(1), deleted: false, deviceId: 'aaa', author: 'A', name: 'Batch 3', startedAt: T(1),
  });
  const a = device('aaa', { runs: [rec('runs', 'r1', T(2), 'aaa')], projects: [project], folders: [] });
  await sync(gh, a);
  // B synced A's file on 1.3, which merged no projects, and kept its sha as read.
  const b = device('bbb', { projects: [], folders: [] });
  b.settings.sync = { ...b.settings.sync, seen: { aaa: [...gh.files.values()][0].sha } };
  const upgraded = await sync(gh, b);
  assert.equal(upgraded.read, 1, 'the file is read again');
  assert.deepEqual(b.db.projects.map((p) => p.id), ['P']);
  assert.equal(b.settings.sync.seenStores, SYNC_STORES.join(','));
  const again = await sync(gh, b);
  assert.equal(again.read, 0, 'after that, unchanged files are skipped as before');
});

test('an equal updatedAt goes to the higher device id on every device', async () => {
  const gh = fakeGitHub();
  const a = device('aaa', { runs: [rec('runs', 'r1', T(4), 'aaa', { notes: 'from aaa' })] });
  const z = device('zzz', { runs: [rec('runs', 'r1', T(4), 'zzz', { notes: 'from zzz' })] });
  await sync(gh, a);
  await sync(gh, z);
  await sync(gh, a);
  assert.equal(a.db.runs[0].notes, 'from zzz');
  assert.equal(z.db.runs[0].notes, 'from zzz');
});

test('damaged or newer files are reported and skipped; the sync still writes this device', async () => {
  const gh = fakeGitHub();
  gh.files.set('lnf-runlog-sync/devices/bad.lnfsync', { sha: 'x1', bytes: new TextEncoder().encode('{oops') });
  const newer = await encodeSyncFile({ format: 'lnf-runlog-sync', version: SCHEMA_VERSION + 1, deviceId: 'new', stores: {} });
  gh.files.set('lnf-runlog-sync/devices/new.lnfsync', { sha: 'x2', bytes: newer });
  const a = device('aaa');
  const r = await sync(gh, a);
  assert.equal(r.problems.length, 2);
  assert.ok(gh.files.has('lnf-runlog-sync/devices/aaa.lnfsync'));
});

test('a conflicting write is retried with the current version', async () => {
  const gh = fakeGitHub();
  const a = device('aaa');
  await sync(gh, a);
  let bumped = false;
  gh.setBeforePut((path) => {
    if (bumped) return;
    bumped = true;
    const cur = /** @type {any} */ (gh.files.get(path));
    gh.files.set(path, { ...cur, sha: 'changed-elsewhere' });
  });
  await sync(gh, a);
  assert.equal(gh.calls.filter((c) => c.startsWith('PUT')).length, 3, 'first sync PUT, then one conflict and one retry');
});

test('the snapshot carries records and materials but never the token or photos', async () => {
  const snap = buildSnapshot({
    records: { runs: [rec('runs', 'r1', T(1), 'aaa')], photos: [{ id: 'p1' }] }, materials: ['Si'],
    deviceId: 'aaa', deviceName: 'Phone', author: 'Ana', appVersion: '1.0.0', now: T(9),
  });
  assert.deepEqual(validateSnapshot(snap), []);
  assert.equal(snap.stores.photos, undefined);
  assert.ok(!JSON.stringify(snap).includes(TOKEN));
  assert.deepEqual(validateSnapshot({ ...snap, format: 'other' }), ['not an LNF Run Log sync file']);
  const plan = planMerge({ runs: [] }, snap, []);
  assert.equal(plan.counts.runs.added, 1);
});

test('projects and their folders sync; a snapshot from an older version without them still merges', () => {
  const project = normalizeRecord('projects', {
    id: 'P', createdAt: T(1), updatedAt: T(2), deleted: false, deviceId: 'bbb', author: 'Ana', name: 'Batch 3', startedAt: T(1),
    wafers: [{ id: 'w1', label: 'W1' }],
  });
  const folder = normalizeRecord('folders', { id: 'F', createdAt: T(1), updatedAt: T(1), deleted: false, deviceId: 'bbb', author: 'Ana', name: 'Thesis' });
  const snap = buildSnapshot({
    records: { runs: [rec('runs', 'r1', T(1), 'bbb')], projects: [{ ...project, folderId: 'F' }], folders: [folder] }, materials: [],
    deviceId: 'bbb', deviceName: 'PC', author: 'Ana', appVersion: '1.4.0', now: T(9),
  });
  assert.ok(SYNC_STORES.includes('projects') && SYNC_STORES.includes('folders'));
  assert.deepEqual(validateSnapshot(snap), []);
  const plan = planMerge({ runs: [], projects: [], folders: [] }, snap, []);
  assert.equal(plan.counts.projects.added, 1);
  assert.equal(plan.counts.folders.added, 1);
  assert.equal(plan.put.projects[0].folderId, 'F');
  assert.deepEqual(plan.put.projects[0].wafers, [{ id: 'w1', label: 'W1', status: 'active', notes: '' }]);
  // A device on an app version from before projects writes no projects list.
  const old = { ...snap, stores: { ...snap.stores } };
  delete old.stores.projects;
  delete old.stores.folders;
  assert.deepEqual(validateSnapshot(old), []);
  const merged = planMerge({ runs: [], projects: [project], folders: [folder] }, old, []);
  assert.equal(merged.put.projects.length + merged.put.folders.length, 0, 'nothing is removed');
  assert.deepEqual(validateSnapshot({ ...snap, stores: { ...snap.stores, projects: 'x' } }), ['no projects list']);
});
