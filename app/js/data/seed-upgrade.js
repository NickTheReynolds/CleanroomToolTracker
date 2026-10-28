// @ts-check
/**
 * Seed versions.
 * - 1: generic example tools (seed-tools.js).
 * - 2: the LNF equipment list and materials taken from the public LNF wiki
 *   (seed-lnf.js), each tool with its own copy of its type's template.
 * - 3: a second template for tools with two kinds of process (the
 *   Plasmatherm 790's PECVD chamber).
 * - 4: an Expose time field on the Heidelberg µPG 501's template.
 * - 5: the wet benches (acid, base, solvent, clean and wet etch) in their
 *   own category, "wet"; their seeded templates' process type with them.
 *
 * Fresh installs get the latest version directly. planSeedUpgrade() works
 * out what an older database needs. It adds records that are missing and
 * fields a seeded template gained, moves tools a later seed put in another
 * category unless the person chose one, never replaces a record (so renames
 * and template edits survive), and archives example tools that were never
 * used or edited.
 */
import { seedForType } from './seed-types.js';
import { LNF_TOOLS, LNF_MATERIALS, LNF_EXTRA_TEMPLATES, LNF_ADDED_FIELDS } from './seed-lnf.js';
import { SEED_TIME, SEED_AUTHOR, SEED_TOOLS, SEED_MATERIALS } from './seed-tools.js';
import { normalizeRecord } from './schema.js';
import { prepareUpdate } from './records.js';
import { normText } from '../core/vocab.js';

export { SEED_VERSION } from './schema.js';

/** When seed 5 moved the wet benches: the stamp every device puts on an untouched seed copy it moves. */
export const RECATEGORISE_TIME = '2026-10-28T00:00:00.000Z';

/**
 * A tool or template moved to another category, as it is stored. A copy no
 * one has edited keeps "seed" as its device and takes RECATEGORISE_TIME, so
 * every device writes the very same record and an edit made anywhere after
 * that date wins over it; a copy the person had edited is saved as their
 * edit, since it differs from device to device anyway.
 * @param {string} store "tools" or "templates"
 * @param {any} rec the moved record
 * @param {{deviceId: string, userName: string}} who
 * @returns {any}
 */
export function movedRecord(store, rec, who) {
  if (rec.updatedAt === SEED_TIME) return normalizeRecord(store, { ...rec, updatedAt: RECATEGORISE_TIME });
  return prepareUpdate(store, rec, who);
}

/**
 * The LNF tools and their templates as complete records.
 * @returns {{tools: any[], templates: any[]}}
 */
export function lnfSeedRecords() {
  const base = { createdAt: SEED_TIME, updatedAt: SEED_TIME, deleted: false, deviceId: 'seed', author: SEED_AUTHOR };
  const tools = [];
  const templates = [];
  for (const [toolId, templateId, name, type, gases] of LNF_TOOLS) {
    const { category, kind, template } = seedForType(type, gases);
    if (template) templates.push({ ...base, ...structuredClone(template), id: templateId, toolId });
    tools.push({
      ...base, id: toolId, name, shortName: name, category, kind, active: true,
      defaultTemplateId: template ? templateId : null, halfLifeDays: null,
      notes: 'From the LNF wiki equipment list. Adjust its template to match how you use it.',
    });
  }
  for (const [toolId, templateId, type, gases, name] of LNF_EXTRA_TEMPLATES) {
    const { template } = seedForType(type, gases);
    if (template) templates.push({ ...base, ...structuredClone(template), name, id: templateId, toolId });
  }
  return { tools, templates };
}

/**
 * Union of material lists: the first list's order, then new names from the
 * others (compared case- and Unicode-insensitively).
 * @param {...ReadonlyArray<string>} lists
 * @returns {string[]}
 */
export function mergeMaterialLists(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const m of list || []) {
      const k = normText(m);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(String(m).trim());
    }
  }
  return out;
}

/** @returns {string[]} materials for a fresh install */
export function seedMaterials() {
  return mergeMaterialLists(LNF_MATERIALS, SEED_MATERIALS);
}

/**
 * What an older database needs to reach SEED_VERSION. Missing LNF tools
 * and templates are added at every step (a tombstone counts as present, so
 * a deleted one stays deleted). Only the step from seed 1 to 2, which
 * brought the LNF list, merges the LNF materials and archives unused
 * example tools: later steps leave the materials list alone, so materials
 * the person removed stay removed. A step that gave a seeded template a new
 * field (LNF_ADDED_FIELDS) adds it to the stored copy, edits and all, unless
 * that copy is deleted or already has a field with the same key or label.
 * Seed 5 put the wet benches in their own category: a stored tool of those
 * types still in the category the earlier seed gave it moves there (one the
 * person chose stays), and its seeded template's process type follows when
 * it was "other".
 * @param {{tools: any[], templates: any[], runs: any[], events: any[], materials: string[]}} existing
 *   all records, tombstones included, plus the current materials list
 * @param {number} [from] the database's seed version (meta.seedVersion)
 * @returns {{tools: any[], templates: any[], withFields: any[], archiveIds: string[], materials: string[],
 *   recategorised: {tools: any[], templates: any[]}}}
 *   new tool and template records to add, stored templates with their new fields (to save as edits),
 *   example tools to archive, the materials list, and stored tools and templates moved to a new category (edits)
 */
export function planSeedUpgrade(existing, from = 1) {
  const toolIds = new Set(existing.tools.map((t) => t.id));
  const templateIds = new Set(existing.templates.map((t) => t.id));
  const seed = lnfSeedRecords();
  const used = new Set([...existing.runs.map((r) => r.toolId), ...existing.events.map((e) => e.toolId)]);
  const examples = new Set(SEED_TOOLS.map((t) => t.id));
  const archiveIds = from >= 2 ? [] : existing.tools
    .filter((t) => examples.has(t.id) && !t.deleted && t.active && t.updatedAt === SEED_TIME && !used.has(t.id))
    .map((t) => t.id);
  /** @type {Map<string, any>} */
  const withFields = new Map();
  for (const [version, templateId, key] of LNF_ADDED_FIELDS) {
    const own = withFields.get(templateId) || existing.templates.find((t) => t.id === templateId);
    const seeded = seed.templates.find((t) => t.id === templateId);
    const field = seeded?.fields.find((/** @type {any} */ f) => f.key === key);
    if (version <= from || !own || own.deleted || !field) continue;
    if (own.fields.some((/** @type {any} */ f) => f.key === key || normText(f.label) === normText(field.label))) continue;
    withFields.set(templateId, addField(own, seeded, field));
  }
  return {
    tools: seed.tools.filter((t) => !toolIds.has(t.id)),
    templates: seed.templates.filter((t) => !templateIds.has(t.id)),
    withFields: [...withFields.values()],
    archiveIds,
    materials: from >= 2 ? [...existing.materials] : mergeMaterialLists(existing.materials, LNF_MATERIALS),
    recategorised: from >= 5 ? { tools: [], templates: [] } : recategorise(existing),
  };
}

/** Tool types that moved to the wet category in seed 5, with the category the earlier seeds gave them. */
const WET_TYPES = /** @type {Record<string, string>} */ ({ 'wet-etch': 'etch', 'wet-bench': 'other', 'solvent-clean': 'other' });

/**
 * The stored wet-bench tools still in their old category, moved to "wet",
 * and their seeded templates still of process type "other", moved too.
 * @param {{tools: any[], templates: any[]}} existing
 * @returns {{tools: any[], templates: any[]}}
 */
function recategorise(existing) {
  const tools = [];
  const templates = [];
  for (const [toolId, templateId, , type] of LNF_TOOLS) {
    const prev = WET_TYPES[type];
    if (!prev) continue;
    const tool = existing.tools.find((t) => t.id === toolId);
    if (tool && !tool.deleted && tool.category === prev) tools.push({ ...tool, category: 'wet' });
    const tpl = existing.templates.find((t) => t.id === templateId);
    if (tpl && !tpl.deleted && tpl.processType === 'other' && seedForType(type).template?.processType === 'wet') templates.push({ ...tpl, processType: 'wet' });
  }
  return { tools, templates };
}

/**
 * A copy of `template` with `field` placed after the field that comes before
 * it in the seed's template, or before the first output when this copy lacks
 * that one.
 * @param {any} template @param {any} seeded the seed's copy of the template @param {any} field
 * @returns {any}
 */
function addField(template, seeded, field) {
  const fields = [...template.fields];
  const prev = seeded.fields[seeded.fields.indexOf(field) - 1];
  let at = prev ? fields.findIndex((f) => f.key === prev.key) + 1 : 0;
  if (at === 0) at = fields.findIndex((f) => f.role === 'output');
  fields.splice(at < 0 ? fields.length : at, 0, structuredClone(field));
  return { ...template, fields };
}
