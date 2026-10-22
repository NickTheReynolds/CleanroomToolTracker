// @ts-check
/**
 * Projects: create, edit, list, soft delete and restore. A project's runs
 * link to it from their side (run.projects), so this store holds only the
 * project itself: its wafers, its plan and its notes.
 */
import { createRecord, updateRecord, getLive, listLive, softDelete, restoreRecord } from './records.js';
import { sortProjects } from '../core/projects.js';

/** @typedef {import('../core/types.js').Project} Project */

/**
 * @param {{statuses?: string[]}} [opts] only projects with these statuses
 * @returns {Promise<Project[]>} live projects: active, paused, then done; newest first in each
 */
export async function listProjects(opts = {}) {
  const all = await listLive('projects');
  return sortProjects(opts.statuses ? all.filter((p) => opts.statuses?.includes(p.status)) : all);
}

/** @returns {Promise<Project[]>} the projects a new run can join */
export function activeProjects() {
  return listProjects({ statuses: ['active'] });
}

/**
 * @param {string} id
 * @returns {Promise<Project | null>}
 */
export function getProject(id) {
  return getLive('projects', id);
}

/**
 * @param {Project | Record<string, any>} p
 * @returns {Promise<Project>}
 */
export function saveProject(p) {
  return p.createdAt ? updateRecord('projects', p) : createRecord('projects', p);
}

/**
 * Soft delete; its runs keep their links, which the screens then ignore.
 * @param {string} id
 * @returns {Promise<Project | null>}
 */
export function deleteProject(id) {
  return softDelete('projects', id);
}

/**
 * @param {string} id
 * @returns {Promise<Project | null>}
 */
export function restoreProject(id) {
  return restoreRecord('projects', id);
}
