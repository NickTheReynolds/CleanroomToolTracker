// @ts-check
/**
 * The data layer's public API. Views reach IndexedDB only through this
 * module: CRUD and queries per store, soft delete, settings and drafts.
 */
import { getOne, getAll, withTx } from './db.js';
import {
  createRecord, updateRecord, getLive, getRecord, listLive, softDelete, restoreRecord,
  getSettings, prepareUpdate, DEFAULT_SETTINGS,
} from './records.js';
import { SCHEMA_VERSION, SEED_VERSION } from './schema.js';
import { uuid } from '../core/ids.js';
import { toMs } from '../core/time.js';
import { normText } from '../core/vocab.js';

export * from './records.js';
export * from './runs.js';
export * from './projects.js';
export * from './folders.js';
export * from './wafers.js';
export * from './attachments.js';

/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Template} Template */
/** @typedef {import('../core/types.js').ToolEvent} ToolEvent */
/** @typedef {import('../core/types.js').Run} Run */

/**
 * First run: write the LNF tool list, its templates, the materials list and
 * settings (with a new device id) in one transaction. Later runs repair a
 * missing device id and bring an older seed up to date (see seed-upgrade.js).
 * @returns {Promise<boolean>} true when the seed data was written
 */
export async function ensureSeeded() {
  const version = await getOne('meta', 'schemaVersion');
  if (version) {
    const s = await getSettings();
    if (!s.deviceId) await withTx(['meta'], 'readwrite', (tx) => {
      tx.objectStore('meta').put({ key: 'settings', value: { ...s, deviceId: uuid() } });
    });
    await upgradeSeed();
    return false;
  }
  const { lnfSeedRecords, seedMaterials } = await import('./seed-upgrade.js');
  const { tools, templates } = lnfSeedRecords();
  const existing = await getOne('meta', 'settings');
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(existing && existing.value),
    deviceId: (existing && existing.value && existing.value.deviceId) || uuid(),
    materials: seedMaterials(),
    firstRunAt: new Date().toISOString(),
  };
  await withTx(['tools', 'templates', 'meta'], 'readwrite', (tx) => {
    for (const t of tools) tx.objectStore('tools').put(t);
    for (const t of templates) tx.objectStore('templates').put(t);
    tx.objectStore('meta').put({ key: 'settings', value: settings });
    tx.objectStore('meta').put({ key: 'schemaVersion', value: SCHEMA_VERSION });
    tx.objectStore('meta').put({ key: 'seedVersion', value: SEED_VERSION });
  });
  return true;
}

/**
 * Bring a database seeded by an older app version up to the current seed:
 * add missing LNF tools, templates and template fields and, coming from the
 * example seed, merge the LNF materials and archive example tools nobody
 * used. Runs once per device, in one transaction.
 */
async function upgradeSeed() {
  const meta = await getOne('meta', 'seedVersion');
  const current = meta ? meta.value : 1;
  if (current >= SEED_VERSION) return;
  const { planSeedUpgrade, movedRecord } = await import('./seed-upgrade.js');
  const [tools, templates, runs, events, settings] = await Promise.all([
    getAll('tools'), getAll('templates'), getAll('runs'), getAll('events'), getSettings(),
  ]);
  const plan = planSeedUpgrade({ tools, templates, runs, events, materials: settings.materials }, current);
  const archived = plan.archiveIds.map((id) => prepareUpdate('tools', { ...tools.find((t) => t.id === id), active: false }, settings));
  const grown = plan.withFields.map((t) => prepareUpdate('templates', t, settings));
  // Tools a later seed put in another category (the wet benches, seed 5) move with a fixed stamp while untouched, so
  // every device writes the same record and no device's later edit is overwritten.
  const movedTools = plan.recategorised.tools.map((t) => movedRecord('tools', t, settings));
  const movedTemplates = plan.recategorised.templates.map((t) => movedRecord('templates', t, settings));
  await withTx(['tools', 'templates', 'meta'], 'readwrite', (tx) => {
    for (const t of [...plan.tools, ...archived, ...movedTools]) tx.objectStore('tools').put(t);
    for (const t of [...plan.templates, ...grown, ...movedTemplates]) tx.objectStore('templates').put(t);
    tx.objectStore('meta').put({ key: 'settings', value: { ...settings, materials: plan.materials } });
    tx.objectStore('meta').put({ key: 'seedVersion', value: SEED_VERSION });
  });
}

/** @param {{name: string}} a @param {{name: string}} b */
const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * @param {{includeArchived?: boolean}} [opts]
 * @returns {Promise<Tool[]>} sorted by name
 */
export async function listTools(opts = {}) {
  const tools = await listLive('tools');
  return tools.filter((t) => opts.includeArchived || t.active).sort(byName);
}

/**
 * @param {string} id
 * @returns {Promise<Tool | null>} the tool, even if archived; tombstones too,
 *   so old runs can still show their tool's name
 */
export function getTool(id) {
  return getRecord('tools', id);
}

/**
 * @param {Tool | Record<string, any>} tool
 * @returns {Promise<Tool>}
 */
export function saveTool(tool) {
  return tool.createdAt ? updateRecord('tools', tool) : createRecord('tools', tool);
}

/**
 * @param {string} [toolId] omit for every template
 * @returns {Promise<Template[]>} sorted by name
 */
export async function listTemplates(toolId) {
  const list = toolId ? await listLive('templates', 'toolId', toolId) : await listLive('templates');
  return list.sort(byName);
}

/**
 * @param {string} id
 * @returns {Promise<Template | null>} tombstones included
 */
export function getTemplate(id) {
  return getRecord('templates', id);
}

/**
 * @param {Template | Record<string, any>} t
 * @returns {Promise<Template>}
 */
export function saveTemplate(t) {
  return t.createdAt ? updateRecord('templates', t) : createRecord('templates', t);
}

/**
 * @param {string} id
 * @returns {Promise<Template | null>}
 */
export function deleteTemplate(id) {
  return softDelete('templates', id);
}

/**
 * Tool events, newest first.
 * @param {string} [toolId] omit for every tool
 * @returns {Promise<ToolEvent[]>}
 */
export async function listEvents(toolId) {
  const list = toolId
    ? await listLive('events', 'toolAt', IDBKeyRange.bound([toolId, ''], [toolId, '￿']))
    : await listLive('events');
  return list.sort((a, b) => toMs(b.at) - toMs(a.at));
}

/**
 * @param {string} id
 * @returns {Promise<ToolEvent | null>}
 */
export function getEvent(id) {
  return getLive('events', id);
}

/**
 * @param {ToolEvent | Record<string, any>} e
 * @returns {Promise<ToolEvent>}
 */
export function saveEvent(e) {
  return e.createdAt ? updateRecord('events', e) : createRecord('events', e);
}

/**
 * @param {string} id
 * @returns {Promise<ToolEvent | null>}
 */
export function deleteEvent(id) {
  return softDelete('events', id);
}

/**
 * @param {string} id
 * @returns {Promise<ToolEvent | null>}
 */
export function restoreEvent(id) {
  return restoreRecord('events', id);
}

/**
 * When each tool was last used, for "recently used first" pickers.
 * @param {Run[]} runs
 * @returns {Map<string, number>} toolId -> epoch ms of its latest run
 */
export function lastUsedByTool(runs) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const r of runs) {
    const t = toMs(r.startedAt);
    const cur = map.get(r.toolId);
    if (cur === undefined || cur < t) map.set(r.toolId, t);
  }
  return map;
}

/**
 * Materials for a picker: the ones used most recently in runs (for `field`)
 * first, then the rest of the settings list in its own order.
 * @param {string[]} materials settings list
 * @param {Run[]} runs
 * @param {'material' | 'substrate' | 'maskMaterial'} field
 * @returns {string[]}
 */
export function materialsByRecency(materials, runs, field) {
  /** @type {Map<string, {name: string, t: number}>} */
  const seen = new Map();
  for (const r of runs) {
    const name = String(r[field] || '').trim();
    if (!name) continue;
    const k = normText(name);
    const t = toMs(r.startedAt);
    const cur = seen.get(k);
    if (!cur || cur.t < t) seen.set(k, { name, t });
  }
  const recent = [...seen.values()].sort((a, b) => b.t - a.t).map((x) => x.name);
  const keys = new Set(recent.map(normText));
  return [...recent, ...materials.filter((m) => !keys.has(normText(m)))];
}
