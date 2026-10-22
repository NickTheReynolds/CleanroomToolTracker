// @ts-check
/**
 * Runs, measurements and photos. Every run save recomputes its derived
 * outputs, so stored results always match the current measurements.
 */
import { deleteKey, getAll } from './db.js';
import {
  createRecord, updateRecord, getLive, getRecord, listLive, softDelete, restoreRecord, getDraft, saveDraft, clearDraft,
} from './records.js';
import { applyDerived } from '../core/derive.js';
import { draftToRun } from '../core/run-draft.js';
import { toMs } from '../core/time.js';

/** Draft key of the Log run form. */
export const LOG_DRAFT = 'log';
/** Draft key of the current lookup query. */
export const LOOKUP_DRAFT = 'lookup';

/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/types.js').Measurement} Measurement */
/** @typedef {import('../core/types.js').Photo} Photo */

/** @param {Run} a @param {Run} b */
const newestFirst = (a, b) => toMs(b.startedAt) - toMs(a.startedAt);

/** @returns {Promise<Run[]>} all non-deleted runs */
export function listRuns() {
  return listLive('runs');
}

/**
 * @param {string} id
 * @returns {Promise<Run | null>}
 */
export function getRun(id) {
  return getLive('runs', id);
}

/**
 * @param {string} toolId
 * @returns {Promise<Run[]>} newest first
 */
export async function runsForTool(toolId) {
  return (await listLive('runs', 'toolId', toolId)).sort(newestFirst);
}

/**
 * The run a new form copies from: the latest non-deleted run with the same
 * tool and template that has at least one parameter.
 * @param {string} toolId
 * @param {string} templateId
 * @returns {Promise<Run | null>}
 */
export async function lastRunFor(toolId, templateId) {
  const runs = await listLive('runs', 'toolTemplate', [toolId, templateId]);
  const withParams = runs.filter((r) => Object.values(r.params || {}).some((v) => v !== null && v !== ''));
  return withParams.sort(newestFirst)[0] || null;
}

/** @returns {Promise<Run[]>} draft and open runs, oldest first */
export async function openRuns() {
  const runs = await listRuns();
  return runs.filter((r) => r.status !== 'complete').sort((a, b) => -newestFirst(a, b));
}

/**
 * @param {number} n
 * @returns {Promise<Run[]>}
 */
export async function recentRuns(n) {
  return (await listRuns()).sort(newestFirst).slice(0, n);
}

/**
 * Store a run (create when it has no createdAt), recomputing derived outputs
 * from its template and measurements first.
 * @param {Run | Record<string, any>} run
 * @returns {Promise<Run>}
 */
export async function saveRun(run) {
  const template = run.templateId ? await getRecord('templates', run.templateId) : null;
  const ms = run.createdAt ? await listMeasurements(run.id) : [];
  const { results, derivedKeys } = applyDerived(/** @type {Run} */ (run), template, ms);
  const next = { ...run, results, derivedKeys };
  return run.createdAt ? updateRecord('runs', next) : createRecord('runs', next);
}

/**
 * Recompute a stored run's derived outputs; writes only when they changed.
 * @param {string} runId
 * @returns {Promise<Run | null>}
 */
export async function recomputeRun(runId) {
  const run = await getRun(runId);
  if (!run) return null;
  const template = run.templateId ? await getRecord('templates', run.templateId) : null;
  const { results, derivedKeys } = applyDerived(run, template, await listMeasurements(runId));
  const same = JSON.stringify(results) === JSON.stringify(run.results)
    && JSON.stringify(derivedKeys) === JSON.stringify(run.derivedKeys);
  return same ? run : updateRecord('runs', { ...run, results, derivedKeys });
}

/**
 * @param {string} id
 * @returns {Promise<Run | null>}
 */
export function deleteRun(id) {
  return softDelete('runs', id);
}

/**
 * @param {string} id
 * @returns {Promise<Run | null>}
 */
export function restoreRun(id) {
  return restoreRecord('runs', id);
}

/**
 * @param {string} runId
 * @returns {Promise<Measurement[]>}
 */
export function listMeasurements(runId) {
  return listLive('measurements', 'runId', runId);
}

/** @returns {Promise<Measurement[]>} every non-deleted measurement */
export function allMeasurements() {
  return listLive('measurements');
}

/**
 * @param {string} id
 * @returns {Promise<Measurement | null>}
 */
export function getMeasurement(id) {
  return getLive('measurements', id);
}

/**
 * Save a measurement, then recompute its run's derived outputs.
 * @param {Measurement | Record<string, any>} m
 * @returns {Promise<Measurement>}
 */
export async function saveMeasurement(m) {
  const saved = m.createdAt ? await updateRecord('measurements', m) : await createRecord('measurements', m);
  await recomputeRun(saved.runId);
  return saved;
}

/**
 * @param {string} id
 * @returns {Promise<Measurement | null>}
 */
export async function deleteMeasurement(id) {
  const m = await softDelete('measurements', id);
  if (m) await recomputeRun(m.runId);
  return m;
}

/**
 * @param {string} id
 * @returns {Promise<Measurement | null>}
 */
export async function restoreMeasurement(id) {
  const m = await restoreRecord('measurements', id);
  if (m) await recomputeRun(m.runId);
  return m;
}

/**
 * @param {string} runId
 * @returns {Promise<Photo[]>} oldest first
 */
export async function listPhotos(runId) {
  return (await listLive('photos', 'runId', runId)).sort((a, b) => toMs(a.takenAt) - toMs(b.takenAt));
}

/**
 * The image of a stored photo. Older Safari versions cannot store Blobs in
 * IndexedDB, so a photo may hold its bytes as an ArrayBuffer instead.
 * @param {any} rec
 * @returns {Blob | null}
 */
export function photoBlob(rec) {
  if (!rec) return null;
  if (rec.blob instanceof Blob) return rec.blob;
  if (rec.bytes) return new Blob([rec.bytes], { type: rec.type || 'image/jpeg' });
  return null;
}

/**
 * Store a photo for a run (the run need not be saved yet) and link it from
 * the run when the run exists.
 * @param {{runId: string, blob: Blob, width: number, height: number, caption?: string, takenAt: string}} p
 * @returns {Promise<Photo>}
 */
export async function addPhoto(p) {
  let rec;
  try {
    rec = await createRecord('photos', { ...p, caption: p.caption || '' });
  } catch (err) {
    if (!(err instanceof Error) || err.name !== 'DataCloneError') throw err;
    const bytes = await p.blob.arrayBuffer();
    rec = await createRecord('photos', { ...p, blob: null, bytes, type: p.blob.type, caption: p.caption || '' });
  }
  const run = await getRun(p.runId);
  if (run && !run.photoIds.includes(rec.id)) {
    await updateRecord('runs', { ...run, photoIds: [...run.photoIds, rec.id] });
  }
  return rec;
}

/**
 * Soft-delete a photo and unlink it from its run.
 * @param {string} id
 * @returns {Promise<Photo | null>}
 */
export async function deletePhoto(id) {
  const p = await softDelete('photos', id);
  const run = p ? await getRun(p.runId) : null;
  if (run && run.photoIds.includes(id)) {
    await updateRecord('runs', { ...run, photoIds: run.photoIds.filter((x) => x !== id) });
  }
  return p;
}

/**
 * Undo deletePhoto.
 * @param {string} id
 * @returns {Promise<Photo | null>}
 */
export async function restorePhoto(id) {
  const p = await restoreRecord('photos', id);
  const run = p ? await getRun(p.runId) : null;
  if (run && !run.photoIds.includes(id)) {
    await updateRecord('runs', { ...run, photoIds: [...run.photoIds, id] });
  }
  return p;
}

/**
 * Physically remove the photos of a discarded, never-saved form. They were
 * never part of a stored run, so no tombstone is needed.
 * @param {string} runId
 * @returns {Promise<void>}
 */
export async function purgeUnsavedPhotos(runId) {
  if (await getRecord('runs', runId)) return;
  for (const p of await getAll('photos', 'runId', runId)) await deleteKey('photos', p.id);
}

/**
 * Whether the Log run form's timer that started at `startedAt` still runs:
 * the form was not saved, discarded or set aside since, and not stopped.
 * @param {string} startedAt
 * @returns {Promise<boolean>}
 */
export async function logTimerRunning(startedAt) {
  /** @type {import('../core/run-draft.js').RunDraft | null} */
  const d = await getDraft(LOG_DRAFT);
  return !!d && d.timerStartedAt === startedAt;
}

/**
 * Move the current Log run form out of the way without losing typed data:
 * a form the person changed becomes a draft run in Open runs; an untouched
 * one is dropped with its unsaved photos.
 * @returns {Promise<boolean>} true when a draft run was kept
 */
export async function setAsideLogDraft() {
  /** @type {import('../core/run-draft.js').RunDraft | null} */
  const d = await getDraft(LOG_DRAFT);
  if (!d) return false;
  if (d.touched) {
    await saveRun(draftToRun(d, 'draft'));
    await clearDraft(LOG_DRAFT);
    return true;
  }
  await clearDraft(LOG_DRAFT);
  await purgeUnsavedPhotos(d.runId);
  return false;
}

/**
 * Start a new Log run form (Duplicate, Log this run), setting aside any
 * unsaved one first.
 * @param {import('../core/run-draft.js').RunDraft} draft
 * @returns {Promise<boolean>} true when an earlier form was kept as a draft run
 */
export async function startLogDraft(draft) {
  const kept = await setAsideLogDraft();
  await saveDraft(LOG_DRAFT, draft);
  return kept;
}

/** @returns {Promise<{count: number, bytes: number}>} stored photo usage */
export async function photoUsage() {
  const all = await listLive('photos');
  let bytes = 0;
  for (const p of all) bytes += photoBlob(p)?.size || 0;
  return { count: all.length, bytes };
}
