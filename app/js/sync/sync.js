// @ts-check
/**
 * Sync now, through a private GitHub repository:
 * 1. check the repository is reachable and private;
 * 2. read every other device's snapshot that changed since the last sync,
 *    and merge it in;
 * 3. recompute the derived results of the runs it touched;
 * 4. write this device's snapshot.
 * runSync() takes its storage and GitHub client as arguments, so tests can
 * drive it with fakes; syncNow() wires the real ones.
 */
import { githubClient, GitHubError } from './github.js';
import { encodeSyncFile, decodeSyncFile } from './codec.js';
import { mergeKinds, mergeMaterials } from '../data/export-import.js';
import {
  buildSnapshot, validateSnapshot, planMerge, touchedRuns, syncPath, deviceIdOf, SYNC_DIR, SYNC_STORES, SYNC_SCOPE,
} from './plan.js';

/**
 * @typedef {Object} SyncConfig
 * @property {string} repo "owner/name"
 * @property {string} token
 * @property {Record<string, string>} [seen] device id -> blob sha already merged
 * @property {string} [seenStores] what `seen` covers (SYNC_SCOPE: the stores, and since 1.5.1 the answers about
 *   materials); when an app version syncs more, the cache is dropped so every file is read once more for it
 * @property {string} [lastSyncAt]
 * @property {string} [startedAt] when the last sync built this device's file: from then on it may carry the answers
 *   about materials made before, so an Undo makes a new change instead of putting the old answer back silently
 * @property {SyncResult} [lastResult]
 */

/**
 * @typedef {Object} SyncResult
 * @property {string} at
 * @property {number} devices other devices found in the repository
 * @property {number} read snapshots read this time (the rest had not changed)
 * @property {number} added
 * @property {number} updated
 * @property {number} invalid records refused
 * @property {number} [answers] answers about materials that came in (new or newer)
 * @property {string[]} problems files that could not be read
 */

/**
 * @typedef {Object} SyncStore storage the sync reads and writes
 * @property {() => Promise<Record<string, any[]>>} read all records of the synced stores, tombstones included
 * @property {(plan: import('../data/export-import.js').ImportPlan) => Promise<void>} write
 *   apply a merge plan in one transaction (records, materials and the answers about them)
 * @property {(runIds: string[]) => Promise<void>} recompute derived results of these runs
 * @property {() => Promise<{deviceId: string, deviceName: string, userName: string, materials: string[],
 *   materialKinds?: import('../core/types.js').MaterialKinds, sync: SyncConfig}>} settings
 * @property {(sync: SyncConfig) => Promise<void>} saveSync
 */

/**
 * Check the token and repository: must be reachable and private.
 * @param {import('./github.js').GitHubClient} gh
 * @returns {Promise<{fullName: string, canWrite: boolean | null}>}
 */
export async function checkRepo(gh) {
  const info = await gh.repoInfo();
  if (!info.private) {
    throw new GitHubError('This repository is public. Sync only uses a private repository, so your data stays private. Make it private (or use another one) and try again.', 0);
  }
  const push = info.permissions ? info.permissions.push : undefined;
  return { fullName: info.full_name, canWrite: push === undefined ? null : !!push };
}

/**
 * @param {{gh: import('./github.js').GitHubClient, store: SyncStore, appVersion: string, now?: () => string,
 *   onProgress?: (message: string) => void}} deps
 * @returns {Promise<SyncResult>}
 */
export async function runSync(deps) {
  const say = deps.onProgress || (() => {});
  const now = deps.now || (() => new Date().toISOString());
  const { gh, store } = deps;
  say('Checking the repository…');
  await checkRepo(gh);
  const s = await store.settings();
  // Files read by a version that synced less (1.3 had no projects or folders, 1.5.0 no answers about materials)
  // must be read again.
  const scope = SYNC_SCOPE;
  const seen = s.sync.seenStores === scope ? { ...(s.sync.seen || {}) } : {};
  say('Reading the other devices…');
  const files = (await gh.list(SYNC_DIR)).filter((f) => f.type === 'file' && deviceIdOf(f.name));
  const own = files.find((f) => deviceIdOf(f.name) === s.deviceId);
  const others = files.filter((f) => f !== own);
  /** @type {SyncResult} */
  const result = { at: '', devices: others.length, read: 0, added: 0, updated: 0, invalid: 0, answers: 0, problems: [] };
  /** @type {Set<string>} */
  const touched = new Set();
  for (const f of others) {
    const id = /** @type {string} */ (deviceIdOf(f.name));
    if (seen[id] === f.sha) continue;
    say(`Merging ${result.read + 1} of ${others.length}…`);
    let snap;
    try {
      snap = await decodeSyncFile(await gh.blob(f.sha));
    } catch (err) {
      if (err instanceof GitHubError) throw err;
      result.problems.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const errs = validateSnapshot(snap);
    if (errs.length) {
      result.problems.push(`${f.name}: ${errs[0]}`);
      continue;
    }
    const current = await store.settings();
    const plan = planMerge(await store.read(), snap, current.materials, current.materialKinds || {});
    await store.write(plan);
    for (const st of SYNC_STORES) {
      result.added += plan.counts[st].added;
      result.updated += plan.counts[st].updated;
      result.invalid += plan.counts[st].invalid;
    }
    result.answers = (result.answers || 0) + (plan.answersChanged || 0);
    for (const r of touchedRuns(plan)) touched.add(r);
    seen[id] = f.sha;
    result.read += 1;
  }
  if (touched.size) {
    say('Updating derived results…');
    await store.recompute([...touched]);
  }
  say('Sending this device’s data…');
  const fresh = await store.settings();
  const at = now();
  // From here this device's file carries its answers about materials: an Undo now must not put an answer back silently.
  await store.saveSync({ ...fresh.sync, startedAt: at });
  const bytes = await encodeSyncFile(buildSnapshot({
    records: await store.read(), materials: fresh.materials, materialKinds: fresh.materialKinds || {}, deviceId: fresh.deviceId,
    deviceName: fresh.deviceName, author: fresh.userName, appVersion: deps.appVersion, now: at,
  }));
  const who = [fresh.deviceName, fresh.userName].filter(Boolean).join(', ');
  const message = `Sync from ${who || 'a device'}`;
  try {
    await gh.put(syncPath(fresh.deviceId), bytes, message, own ? own.sha : undefined);
  } catch (err) {
    // Our file changed since we listed it (another tab synced): retry with its current version.
    if (!(err instanceof GitHubError) || (err.status !== 409 && err.status !== 422)) throw err;
    const again = (await gh.list(SYNC_DIR)).find((f) => deviceIdOf(f.name) === fresh.deviceId);
    await gh.put(syncPath(fresh.deviceId), bytes, message, again ? again.sha : undefined);
  }
  result.at = at;
  await store.saveSync({ ...fresh.sync, startedAt: at, seen, seenStores: scope, lastSyncAt: at, lastResult: result });
  return result;
}

/**
 * Sync this device with the configured repository.
 * @param {(message: string) => void} [onProgress]
 * @returns {Promise<SyncResult>}
 */
export async function syncNow(onProgress) {
  const [{ getAll, putAll }, repo, { APP_VERSION }] = await Promise.all([
    import('../data/db.js'), import('../data/repo.js'), import('../../version.js'),
  ]);
  const settings = await repo.getSettings();
  const cfg = /** @type {any} */ (settings).sync;
  if (!cfg || !cfg.repo || !cfg.token) throw new Error('Set up sync in Settings → Sync first.');
  /** @type {SyncStore} */
  const store = {
    async read() {
      /** @type {Record<string, any[]>} */
      const out = {};
      for (const s of SYNC_STORES) out[s] = await getAll(s);
      return out;
    },
    async write(plan) {
      /** @type {Record<string, any[]>} */
      const byStore = {};
      for (const s of SYNC_STORES) byStore[s] = plan.put[s] || [];
      await putAll(byStore);
      if (plan.materials || plan.materialKinds) {
        // Merged into what is stored now, so an answer given on another screen while the sync ran stays.
        const now = /** @type {any} */ (await repo.getSettings());
        const materials = plan.materials ? mergeMaterials(now.materials || [], plan.materials) : null;
        const materialKinds = plan.materialKinds ? mergeKinds(now.materialKinds || {}, plan.materialKinds) : null;
        if (materials || materialKinds) await repo.saveSettings({ ...(materials ? { materials } : {}), ...(materialKinds ? { materialKinds } : {}) });
      }
    },
    async recompute(ids) {
      for (const id of ids) await repo.recomputeRun(id);
    },
    settings: async () => /** @type {any} */ (await repo.getSettings()),
    saveSync: async (sync) => { await repo.saveSettings(/** @type {any} */ ({ sync })); },
  };
  return runSync({ gh: githubClient(cfg), store, appVersion: APP_VERSION, onProgress });
}
