// @ts-check
/**
 * Seed versions.
 * - 1: generic example tools (seed-tools.js).
 * - 2: the LNF equipment list and materials taken from the public LNF wiki
 *   (seed-lnf.js), each tool with its own copy of its type's template.
 *
 * Fresh installs get version 2 directly. planSeedUpgrade() works out what an
 * older database needs. It only ever adds records that are missing, never
 * overwrites a record (so renames and template edits survive), and archives
 * example tools that were never used or edited.
 */
import { seedForType } from './seed-types.js';
import { LNF_TOOLS, LNF_MATERIALS } from './seed-lnf.js';
import { SEED_TIME, SEED_AUTHOR, SEED_TOOLS, SEED_MATERIALS } from './seed-tools.js';
import { normText } from '../core/vocab.js';

export { SEED_VERSION } from './schema.js';

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
 * What an older database needs to reach SEED_VERSION.
 * @param {{tools: any[], templates: any[], runs: any[], events: any[], materials: string[]}} existing
 *   all records, tombstones included, plus the current materials list
 * @returns {{tools: any[], templates: any[], archiveIds: string[], materials: string[]}}
 *   new tool and template records to add, example tools to archive, and the merged materials list
 */
export function planSeedUpgrade(existing) {
  const toolIds = new Set(existing.tools.map((t) => t.id));
  const templateIds = new Set(existing.templates.map((t) => t.id));
  const seed = lnfSeedRecords();
  const used = new Set([...existing.runs.map((r) => r.toolId), ...existing.events.map((e) => e.toolId)]);
  const examples = new Set(SEED_TOOLS.map((t) => t.id));
  const archiveIds = existing.tools
    .filter((t) => examples.has(t.id) && !t.deleted && t.active && t.updatedAt === SEED_TIME && !used.has(t.id))
    .map((t) => t.id);
  return {
    tools: seed.tools.filter((t) => !toolIds.has(t.id)),
    templates: seed.templates.filter((t) => !templateIds.has(t.id)),
    archiveIds,
    materials: mergeMaterialLists(existing.materials, LNF_MATERIALS),
  };
}
