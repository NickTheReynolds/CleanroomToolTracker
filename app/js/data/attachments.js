// @ts-check
/**
 * A plan step's pictures, files and GDS layout (core/attachments.js). The
 * bytes go into the photos store under the step's id: they stay on this
 * device, as run photos do, and travel in backups that include photos. The
 * step records each one's name and size, which sync with the project.
 */
import { deleteKey } from './db.js';
import { createRecord, getLive, softDelete, restoreRecord } from './records.js';
import { getProject, saveProject, listProjects } from './projects.js';
import { photoBlob } from './runs.js';
import { withFile, withoutFile, cleanGds, fileInUse, MAX_FILE_BYTES } from '../core/attachments.js';

// Types named with a prefix: repo.js re-exports this module next to projects.js, which exports `Project`.
/** @typedef {import('../core/types.js').PlanStep} AttPlanStep */
/** @typedef {import('../core/types.js').StepFile} AttStepFile */
/** @typedef {import('../core/types.js').GdsLayout} AttGdsLayout */

/**
 * Store the bytes of a step's picture or file. Older Safari versions cannot
 * store a Blob, so the record then holds an ArrayBuffer (as runs.js addPhoto).
 * @param {{stepId: string, blob: Blob, name: string, width?: number, height?: number}} f
 * @returns {Promise<any>} the stored record
 */
async function storeBytes(f) {
  if (f.blob.size > MAX_FILE_BYTES) throw new Error(`${f.name} is larger than ${MAX_FILE_BYTES / 1e6} MB, the most a step takes.`);
  const base = {
    runId: f.stepId, name: f.name, type: f.blob.type || 'application/octet-stream',
    width: f.width || 0, height: f.height || 0, caption: '', takenAt: new Date().toISOString(),
  };
  try {
    return await createRecord('photos', { ...base, blob: f.blob });
  } catch (err) {
    if (!(err instanceof Error) || err.name !== 'DataCloneError') throw err;
    return createRecord('photos', { ...base, blob: null, bytes: await f.blob.arrayBuffer() });
  }
}

/**
 * Change one step of a project as stored now, not as a screen loaded it, so
 * changes made meanwhile stay.
 * @param {string} projectId
 * @param {string} stepId
 * @param {(step: AttPlanStep) => AttPlanStep} fn
 * @returns {Promise<import('../core/types.js').Project>}
 */
async function changeStep(projectId, stepId, fn) {
  const p = await getProject(projectId);
  if (!p) throw new Error('This project was deleted.');
  if (!p.steps.some((s) => s.id === stepId)) throw new Error('This step is no longer in the plan.');
  return saveProject({ ...p, steps: p.steps.map((s) => (s.id === stepId ? fn(s) : s)) });
}

/**
 * Delete stored bytes no step names any more (as a tombstone, so Undo can
 * bring them back).
 * @param {string | null | undefined} id
 * @returns {Promise<boolean>} whether they were deleted
 */
async function dropUnused(id) {
  if (!id || fileInUse(await listProjects(), id)) return false;
  return !!(await softDelete('photos', id));
}

/**
 * Add a picture or file to a plan step.
 * @param {string} projectId
 * @param {string} stepId
 * @param {{blob: Blob, name: string, kind: 'photo' | 'file', width?: number, height?: number}} f
 * @returns {Promise<AttStepFile>}
 */
export async function addStepFile(projectId, stepId, f) {
  const rec = await storeBytes({ ...f, stepId });
  /** @type {AttStepFile} */
  const file = { id: rec.id, name: f.name, kind: f.kind, type: rec.type, size: f.blob.size, addedAt: rec.takenAt };
  try {
    await changeStep(projectId, stepId, (s) => withFile(s, file));
  } catch (err) {
    await deleteKey('photos', rec.id);
    throw err;
  }
  return file;
}

/**
 * Take a picture or file off a step. Its bytes are deleted unless another
 * step names them.
 * @param {string} projectId
 * @param {string} stepId
 * @param {string} id
 * @returns {Promise<() => Promise<void>>} undo
 */
export async function removeStepFile(projectId, stepId, id) {
  const p = await getProject(projectId);
  const file = p?.steps.find((s) => s.id === stepId)?.attachments?.find((a) => a.id === id);
  await changeStep(projectId, stepId, (s) => withoutFile(s, id));
  const dropped = await dropUnused(id);
  return async () => {
    if (dropped) await restoreRecord('photos', id);
    if (file) await changeStep(projectId, stepId, (s) => withFile(s, file));
  };
}

/**
 * Set, change or remove an exposure step's GDS layout. A newly picked file
 * replaces the old one, whose bytes are deleted unless another step (a
 * copied project's) names them.
 * @param {string} projectId
 * @param {string} stepId
 * @param {Partial<AttGdsLayout> | null} gds the layout as typed; null removes it
 * @param {(Blob & {name?: string}) | null} [file] a newly picked GDS file
 * @returns {Promise<() => Promise<void>>} undo
 */
export async function setStepGds(projectId, stepId, gds, file = null) {
  const before = (await getProject(projectId))?.steps.find((s) => s.id === stepId)?.gds || null;
  let next = gds ? { ...gds } : null;
  const added = next && file ? await storeBytes({ stepId, blob: file, name: String(next.name || file.name || 'layout.gds') }) : null;
  if (next && added && file) next = { ...next, name: next.name || added.name, fileId: added.id, size: file.size };
  const clean = cleanGds(next);
  /** @param {AttGdsLayout | null} g @returns {(s: AttPlanStep) => AttPlanStep} */
  const put = (g) => (s) => {
    const out = { ...s };
    if (g) out.gds = g; else delete out.gds;
    return out;
  };
  try {
    await changeStep(projectId, stepId, put(clean));
  } catch (err) {
    if (added) await deleteKey('photos', added.id);
    throw err;
  }
  const old = before?.fileId && before.fileId !== clean?.fileId ? before.fileId : null;
  const dropped = await dropUnused(old);
  return async () => {
    if (dropped && old) await restoreRecord('photos', old);
    await changeStep(projectId, stepId, put(before));
    if (added) await dropUnused(added.id);
  };
}

/**
 * The bytes of a step's picture or file, or null when they are on another
 * device (or were deleted).
 * @param {string | undefined} id
 * @returns {Promise<Blob | null>}
 */
export async function stepFileBlob(id) {
  return id ? photoBlob(await getLive('photos', id)) : null;
}
