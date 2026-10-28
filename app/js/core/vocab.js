// @ts-check
/**
 * Fixed vocabularies shared by the data layer, the core and the views:
 * enum values in storage order plus their display labels.
 */

export const TOOL_CATEGORIES = Object.freeze(['etch', 'deposition', 'thermal', 'litho', 'metrology', 'other']);
export const TOOL_KINDS = Object.freeze(['process', 'metrology']);
export const PROCESS_TYPES = TOOL_CATEGORIES;
export const RUN_STATUSES = Object.freeze(['draft', 'open', 'complete']);
export const MEASUREMENT_KINDS = Object.freeze([
  'thickness', 'stepHeight', 'cd', 'sheetResistance', 'refractiveIndex', 'stress', 'other',
]);
export const PHASES = Object.freeze(['pre', 'post']);
export const EVENT_TYPES = Object.freeze(['pm', 'clean', 'seasoning', 'targetChange', 'gasChange', 'fault', 'other']);
/** Event types that default to major (spec Section 6). */
export const MAJOR_BY_DEFAULT = Object.freeze(['pm', 'clean', 'targetChange']);
export const FIELD_TYPES = Object.freeze(['number', 'text', 'select', 'bool', 'duration']);
export const FIELD_ROLES = Object.freeze(['input', 'output', 'context']);
/** A project: active (wafers in process), paused, or done (finished). */
export const PROJECT_STATUSES = Object.freeze(['active', 'paused', 'done']);
/** What a project's status reads as: the stored ones, and failed (a finished project marked failed; core/projects.js projectStatus). */
export const PROJECT_SHOWN_STATUSES = Object.freeze([...PROJECT_STATUSES, 'failed']);
/** A wafer of a project: still in process, done (finished its process), or scrapped (broken or lost). */
export const WAFER_STATUSES = Object.freeze(['active', 'done', 'scrapped']);

/** @type {Readonly<Record<string, string>>} */
export const PROJECT_STATUS_LABELS = Object.freeze({ active: 'Active', paused: 'Paused', done: 'Finished', failed: 'Failed' });

/** @type {Readonly<Record<string, string>>} */
export const WAFER_STATUS_LABELS = Object.freeze({ active: 'In process', done: 'Done', scrapped: 'Scrapped' });

/** @type {Readonly<Record<string, string>>} */
export const CATEGORY_LABELS = Object.freeze({
  etch: 'Etch', deposition: 'Deposition', thermal: 'Thermal', litho: 'Lithography',
  metrology: 'Metrology', other: 'Other',
});

/** @type {Readonly<Record<string, string>>} */
export const STATUS_LABELS = Object.freeze({ draft: 'Draft', open: 'Open', complete: 'Complete' });

/** @type {Readonly<Record<string, string>>} */
export const KIND_LABELS = Object.freeze({
  thickness: 'Thickness', stepHeight: 'Step height', cd: 'CD', sheetResistance: 'Sheet resistance',
  refractiveIndex: 'Refractive index', stress: 'Stress', other: 'Other',
});

/** @type {Readonly<Record<string, string>>} */
export const PHASE_LABELS = Object.freeze({ pre: 'Pre', post: 'Post' });

/** Event names as used in sentences ("Chamber clean on Oct 10"). */
/** @type {Readonly<Record<string, string>>} */
export const EVENT_LABELS = Object.freeze({
  pm: 'PM', clean: 'Chamber clean', seasoning: 'Seasoning', targetChange: 'Target change',
  gasChange: 'Gas change', fault: 'Fault', other: 'Tool event',
});

/** Short event names for match flags ("Before last clean"). */
/** @type {Readonly<Record<string, string>>} */
export const EVENT_SHORT = Object.freeze({
  pm: 'PM', clean: 'clean', seasoning: 'seasoning', targetChange: 'target change',
  gasChange: 'gas change', fault: 'fault', other: 'event',
});

/** @type {Readonly<Record<string, string>>} */
export const FIELD_TYPE_LABELS = Object.freeze({
  number: 'Number', text: 'Text', select: 'Choice', bool: 'Yes / no', duration: 'Duration (mm:ss)',
});

/** @type {Readonly<Record<string, string>>} */
export const ROLE_LABELS = Object.freeze({ input: 'Input', output: 'Output', context: 'Context' });

/**
 * Normalise free text for comparison: Unicode compatibility form (so "SiO₂"
 * equals "SiO2" and the micro and ohm signs fold to their Greek letters),
 * trimmed, inner whitespace collapsed, lower case.
 * @param {unknown} s
 * @returns {string}
 */
export function normText(s) {
  return String(s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
