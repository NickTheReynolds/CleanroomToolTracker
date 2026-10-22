// @ts-check
/**
 * Database layout, ordered migrations, record normalisation and validation.
 * Pure: no IndexedDB access here (db.js applies the layout), so the
 * validators run in Node tests and on imported backups.
 */
import {
  TOOL_CATEGORIES, TOOL_KINDS, PROCESS_TYPES, RUN_STATUSES, MEASUREMENT_KINDS, PHASES,
  EVENT_TYPES, FIELD_TYPES, FIELD_ROLES,
} from '../core/vocab.js';
import { DERIVED_FUNCTIONS, DERIVED_INFO } from '../core/derive.js';
import { isIsoDate } from '../core/time.js';

export const DB_NAME = 'lnf-runlog';
/** IndexedDB structural version (object stores and indexes). */
export const DB_VERSION = 1;
/** Record format version, stored in meta and in backups. */
export const SCHEMA_VERSION = 1;
/** Seed data version (meta.seedVersion): 1 = generic examples, 2 = the LNF equipment list. */
export const SEED_VERSION = 2;
/** Stores holding user records (meta excluded). */
export const DATA_STORES = Object.freeze(['tools', 'templates', 'runs', 'measurements', 'events', 'photos']);
export const MAX_REQUIRED_FIELDS = 5;

/**
 * Ordered migrations. `stores` lists object stores and indexes to create
 * when upgrading to `version`; `records` upgrades one record from the
 * previous version (used for older backups and in-place upgrades).
 * @type {ReadonlyArray<{version: number, stores: Record<string, {keyPath: string, indexes: [string, string | string[]][]}>,
 *   records: ((store: string, rec: any) => any) | null}>}
 */
export const MIGRATIONS = Object.freeze([
  {
    version: 1,
    stores: {
      tools: { keyPath: 'id', indexes: [['category', 'category']] },
      templates: { keyPath: 'id', indexes: [['toolId', 'toolId']] },
      runs: {
        keyPath: 'id',
        indexes: [['toolId', 'toolId'], ['toolTemplate', ['toolId', 'templateId']], ['startedAt', 'startedAt'], ['status', 'status']],
      },
      measurements: { keyPath: 'id', indexes: [['runId', 'runId']] },
      events: { keyPath: 'id', indexes: [['toolAt', ['toolId', 'at']]] },
      photos: { keyPath: 'id', indexes: [['runId', 'runId']] },
      meta: { keyPath: 'key', indexes: [] },
    },
    records: null,
  },
]);

/**
 * Upgrade records written by an older schema version.
 * @param {string} store
 * @param {any[]} records
 * @param {number} fromVersion
 * @returns {any[]}
 */
export function migrateRecords(store, records, fromVersion) {
  let out = records;
  for (const m of MIGRATIONS) {
    if (m.version > fromVersion && m.version <= SCHEMA_VERSION && m.records) {
      const fn = m.records;
      out = out.map((r) => fn(store, r));
    }
  }
  return out;
}

const isStr = (/** @type {unknown} */ v) => typeof v === 'string';
const isBool = (/** @type {unknown} */ v) => typeof v === 'boolean';
const isNum = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNullish = (/** @type {unknown} */ v) => v === null || v === undefined;
const isFieldValue = (/** @type {unknown} */ v) => v === null || isStr(v) || isNum(v) || isBool(v);
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Defaults for optional fields, per store. */
/** @type {Record<string, Record<string, () => unknown>>} */
const DEFAULTS = {
  tools: { shortName: () => '', active: () => true, defaultTemplateId: () => null, notes: () => '', kind: () => 'process', category: () => 'other' },
  templates: { fields: () => [], derived: () => [], primaryOutput: () => null, processType: () => 'other' },
  runs: {
    templateId: () => null, material: () => '', substrate: () => '', maskMaterial: () => '', status: () => 'open',
    endedAt: () => null, params: () => ({}), results: () => ({}), derivedKeys: () => [], targetThickness: () => null,
    recipe: () => '', notes: () => '', tags: () => [], photoIds: () => [],
  },
  measurements: { metrologyToolId: () => null, kind: () => 'thickness', material: () => '', unit: () => '', points: () => [], notes: () => '' },
  events: { major: () => false, notes: () => '', type: () => 'other' },
  photos: { caption: () => '', width: () => 0, height: () => 0, blob: () => null },
};

/**
 * Fill missing optional fields with their defaults (a shallow copy).
 * Required fields such as ids and dates are never invented, except that a
 * missing createdAt copies updatedAt.
 * @param {string} store
 * @param {any} rec
 * @returns {any}
 */
export function normalizeRecord(store, rec) {
  if (!isObj(rec)) return rec;
  const out = { ...rec };
  if (store !== 'meta') {
    if (isNullish(out.deleted)) out.deleted = false;
    if (isNullish(out.deviceId)) out.deviceId = '';
    if (isNullish(out.author)) out.author = '';
    if (isNullish(out.createdAt) && isStr(out.updatedAt)) out.createdAt = out.updatedAt;
  }
  for (const [k, make] of Object.entries(DEFAULTS[store] || {})) {
    if (out[k] === undefined) out[k] = make();
  }
  return out;
}

/**
 * @param {any} f
 * @returns {string[]} problems with one template field spec
 */
export function validateField(f) {
  if (!isObj(f)) return ['each field must be an object'];
  const errs = [];
  const name = isStr(f.key) && f.key ? f.key : '(no key)';
  if (!isStr(f.key) || !KEY_RE.test(f.key)) errs.push(`${name}: key must start with a letter and use only letters, digits and _`);
  if (!isStr(f.label) || !f.label.trim()) errs.push(`${name}: label is required`);
  if (!isNullish(f.unit) && !isStr(f.unit)) errs.push(`${name}: unit must be text`);
  if (!FIELD_TYPES.includes(f.type)) errs.push(`${name}: type must be one of ${FIELD_TYPES.join(', ')}`);
  if (!FIELD_ROLES.includes(f.role)) errs.push(`${name}: role must be one of ${FIELD_ROLES.join(', ')}`);
  for (const k of ['step', 'min', 'max', 'weight', 'spreadHint']) {
    if (!isNullish(f[k]) && !isNum(f[k])) errs.push(`${name}: ${k} must be a number`);
  }
  for (const k of ['required', 'matchExact', 'chemistry']) {
    if (!isNullish(f[k]) && !isBool(f[k])) errs.push(`${name}: ${k} must be true or false`);
  }
  if (isNum(f.step) && f.step <= 0) errs.push(`${name}: step must be greater than 0`);
  if (isNum(f.weight) && f.weight < 0) errs.push(`${name}: weight cannot be negative`);
  if (isNum(f.spreadHint) && f.spreadHint <= 0) errs.push(`${name}: spread hint must be greater than 0`);
  if (isNum(f.min) && isNum(f.max) && f.min > f.max) errs.push(`${name}: min is above max`);
  if (f.type === 'select') {
    const ok = Array.isArray(f.options) && f.options.length > 0 && f.options.every((o) => isStr(o) && o.trim());
    if (!ok) errs.push(`${name}: a choice field needs at least one option`);
  } else if (!isNullish(f.options) && !Array.isArray(f.options)) {
    errs.push(`${name}: options must be a list`);
  }
  if (f.matchExact && !['select', 'text', 'bool'].includes(f.type)) errs.push(`${name}: exact match applies to choice, text or yes/no fields`);
  if (f.chemistry && f.type !== 'number') errs.push(`${name}: chemistry applies to number fields`);
  return errs;
}

/**
 * @param {any} t template (without base fields checked)
 * @returns {string[]} problems with the template's fields, derived list and primary output
 */
export function validateTemplateBody(t) {
  const errs = [];
  if (!isStr(t.name) || !t.name.trim()) errs.push('template name is required');
  if (!PROCESS_TYPES.includes(t.processType)) errs.push(`process type must be one of ${PROCESS_TYPES.join(', ')}`);
  if (!Array.isArray(t.fields)) return [...errs, 'fields must be a list'];
  const keys = new Set();
  for (const f of t.fields) {
    errs.push(...validateField(f));
    if (isObj(f) && isStr(f.key)) {
      if (keys.has(f.key)) errs.push(`${f.key}: duplicate key`);
      keys.add(f.key);
    }
  }
  const required = t.fields.filter((/** @type {any} */ f) => isObj(f) && f.required).length;
  if (required > MAX_REQUIRED_FIELDS) errs.push(`at most ${MAX_REQUIRED_FIELDS} fields may be required (found ${required})`);
  /** @param {string} k */
  const field = (k) => t.fields.find((/** @type {any} */ f) => isObj(f) && f.key === k);
  if (!Array.isArray(t.derived)) return [...errs, 'derived must be a list'];
  for (const d of t.derived) {
    if (!isObj(d)) { errs.push('each derived entry must be an object'); continue; }
    if (!DERIVED_FUNCTIONS.includes(d.fn)) { errs.push(`derived: unknown function "${d.fn}"`); continue; }
    const out = field(d.output);
    if (!out || out.role !== 'output') errs.push(`derived ${d.fn}: output "${d.output}" must be an output field`);
    if (DERIVED_INFO[d.fn].usesTime) {
      const tf = d.timeField ? field(d.timeField) : t.fields.find((/** @type {any} */ f) => isObj(f) && f.type === 'duration');
      if (!tf) errs.push(`derived ${d.fn}: needs a duration field for time`);
      else if (!['duration', 'number'].includes(tf.type)) errs.push(`derived ${d.fn}: time field must be a duration`);
    }
    if (!isNullish(d.phase) && !PHASES.includes(d.phase)) errs.push(`derived ${d.fn}: phase must be pre or post`);
    if (!isNullish(d.kind) && !MEASUREMENT_KINDS.includes(d.kind)) errs.push(`derived ${d.fn}: unknown measurement kind`);
  }
  if (!isNullish(t.primaryOutput)) {
    const p = field(t.primaryOutput);
    if (!p || p.role !== 'output') errs.push(`primary output "${t.primaryOutput}" must be an output field`);
  }
  return errs;
}

/**
 * @param {any} r
 * @param {string[]} errs
 */
function checkBase(r, errs) {
  if (!isStr(r.id) || !r.id) errs.push('id must be a non-empty string');
  if (!isIsoDate(r.createdAt)) errs.push('createdAt must be a date');
  if (!isIsoDate(r.updatedAt)) errs.push('updatedAt must be a date');
  if (!isBool(r.deleted)) errs.push('deleted must be true or false');
  if (!isStr(r.deviceId)) errs.push('deviceId must be text');
  if (!isStr(r.author)) errs.push('author must be text');
}

/**
 * @param {any} obj
 * @param {string} name
 * @param {string[]} errs
 */
function checkValues(obj, name, errs) {
  if (!isObj(obj)) { errs.push(`${name} must be an object`); return; }
  for (const [k, v] of Object.entries(obj)) {
    if (!isFieldValue(v)) errs.push(`${name}.${k} must be text, a number, true/false or empty`);
  }
}

/** @type {Record<string, (r: any, errs: string[]) => void>} */
const CHECKS = {
  tools(r, errs) {
    if (!isStr(r.name) || !r.name.trim()) errs.push('name is required');
    if (!isStr(r.shortName)) errs.push('shortName must be text');
    if (!TOOL_CATEGORIES.includes(r.category)) errs.push(`category must be one of ${TOOL_CATEGORIES.join(', ')}`);
    if (!TOOL_KINDS.includes(r.kind)) errs.push('kind must be process or metrology');
    if (!isBool(r.active)) errs.push('active must be true or false');
    if (!isNullish(r.defaultTemplateId) && !isStr(r.defaultTemplateId)) errs.push('defaultTemplateId must be text');
    if (!isNullish(r.halfLifeDays) && !(isNum(r.halfLifeDays) && r.halfLifeDays > 0)) errs.push('halfLifeDays must be a positive number');
    if (!isStr(r.notes)) errs.push('notes must be text');
  },
  templates(r, errs) {
    if (!isStr(r.toolId) || !r.toolId) errs.push('toolId is required');
    errs.push(...validateTemplateBody(r));
  },
  runs(r, errs) {
    if (!isStr(r.toolId) || !r.toolId) errs.push('toolId is required');
    if (!isNullish(r.templateId) && !isStr(r.templateId)) errs.push('templateId must be text');
    if (!RUN_STATUSES.includes(r.status)) errs.push(`status must be one of ${RUN_STATUSES.join(', ')}`);
    if (!isIsoDate(r.startedAt)) errs.push('startedAt must be a date');
    if (!isNullish(r.endedAt) && !isIsoDate(r.endedAt)) errs.push('endedAt must be a date');
    for (const k of ['material', 'substrate', 'maskMaterial', 'recipe', 'notes']) {
      if (!isNullish(r[k]) && !isStr(r[k])) errs.push(`${k} must be text`);
    }
    checkValues(r.params, 'params', errs);
    checkValues(r.results, 'results', errs);
    for (const k of ['derivedKeys', 'tags', 'photoIds']) {
      if (!Array.isArray(r[k]) || !r[k].every(isStr)) errs.push(`${k} must be a list of text`);
    }
    if (!isNullish(r.targetThickness) && !isNum(r.targetThickness)) errs.push('targetThickness must be a number');
  },
  measurements(r, errs) {
    if (!isStr(r.runId) || !r.runId) errs.push('runId is required');
    if (!isNullish(r.metrologyToolId) && !isStr(r.metrologyToolId)) errs.push('metrologyToolId must be text');
    if (!MEASUREMENT_KINDS.includes(r.kind)) errs.push(`kind must be one of ${MEASUREMENT_KINDS.join(', ')}`);
    if (!PHASES.includes(r.phase)) errs.push('phase must be pre or post');
    if (!isStr(r.material)) errs.push('material must be text');
    if (!isStr(r.unit)) errs.push('unit must be text');
    if (!Array.isArray(r.points) || !r.points.every((/** @type {any} */ p) => isObj(p) && isStr(p.site) && isNum(p.value))) {
      errs.push('points must be a list of {site, value}');
    }
    if (!isIsoDate(r.takenAt)) errs.push('takenAt must be a date');
    if (!isStr(r.notes)) errs.push('notes must be text');
  },
  events(r, errs) {
    if (!isStr(r.toolId) || !r.toolId) errs.push('toolId is required');
    if (!EVENT_TYPES.includes(r.type)) errs.push(`type must be one of ${EVENT_TYPES.join(', ')}`);
    if (!isBool(r.major)) errs.push('major must be true or false');
    if (!isIsoDate(r.at)) errs.push('at must be a date');
    if (!isStr(r.notes)) errs.push('notes must be text');
  },
  photos(r, errs) {
    if (!isStr(r.runId) || !r.runId) errs.push('runId is required');
    for (const k of ['width', 'height']) if (!(isNum(r[k]) && r[k] >= 0)) errs.push(`${k} must be a number`);
    if (!isStr(r.caption)) errs.push('caption must be text');
    if (!isIsoDate(r.takenAt)) errs.push('takenAt must be a date');
  },
};

/**
 * Validate a (normalised) record for a store.
 * @param {string} store
 * @param {any} rec
 * @returns {string[]} problems; empty when valid
 */
export function validateRecord(store, rec) {
  if (!isObj(rec)) return ['record must be an object'];
  const check = CHECKS[store];
  if (!check) return [`unknown store "${store}"`];
  /** @type {string[]} */
  const errs = [];
  checkBase(rec, errs);
  check(rec, errs);
  return errs;
}

/**
 * Validate the envelope of a JSON backup (records are checked one by one
 * during the merge).
 * @param {any} obj
 * @returns {string[]} problems; empty when the envelope is usable
 */
export function validateBackupEnvelope(obj) {
  if (!isObj(obj)) return ['The file is not a backup (expected a JSON object).'];
  if (obj.format !== 'lnf-runlog') return ['The file is not an LNF Run Log backup.'];
  if (!Number.isInteger(obj.version) || obj.version < 1) return ['The backup has no valid version number.'];
  if (obj.version > SCHEMA_VERSION) {
    return [`The backup is from a newer app version (format ${obj.version}). Update the app, then import again.`];
  }
  const errs = [];
  for (const s of ['tools', 'templates', 'runs', 'measurements', 'events']) {
    if (!Array.isArray(obj[s])) errs.push(`The backup has no ${s} list.`);
  }
  if (!isNullish(obj.photos) && !Array.isArray(obj.photos)) errs.push('The backup photos entry is not a list.');
  if (!isNullish(obj.settings) && !isObj(obj.settings)) errs.push('The backup settings entry is not an object.');
  return errs;
}
