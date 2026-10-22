// @ts-check
/**
 * Shared JSDoc types for editors and `tsc --checkJs`. Import them with
 * `@typedef {import('../core/types.js').Run} Run`. No runtime code.
 *
 * @typedef {Object} BaseRecord
 * @property {string} id UUID
 * @property {string} createdAt ISO 8601
 * @property {string} updatedAt ISO 8601
 * @property {boolean} deleted soft-delete tombstone
 * @property {string} deviceId
 * @property {string} author
 *
 * @typedef {'etch'|'deposition'|'thermal'|'litho'|'metrology'|'other'} Category
 *
 * @typedef {BaseRecord & {
 *   name: string, shortName: string, category: Category, kind: 'process'|'metrology',
 *   active: boolean, defaultTemplateId: string|null, halfLifeDays?: number|null, notes: string
 * }} Tool
 *
 * @typedef {Object} FieldSpec
 * @property {string} key stable key used in params and results
 * @property {string} label
 * @property {string} [unit]
 * @property {'number'|'text'|'select'|'bool'|'duration'} type
 * @property {'input'|'output'|'context'} role
 * @property {boolean} [required]
 * @property {number} [step]
 * @property {number} [min]
 * @property {number} [max]
 * @property {string[]} [options]
 * @property {number} [weight] distance weight; 0 = ignored by lookup
 * @property {number} [spreadHint] typical variation, normalises distance
 * @property {boolean} [matchExact] hard filter in lookup
 * @property {boolean} [chemistry] gas flow used by the strict chemistry filter
 *
 * @typedef {Object} DerivedSpec
 * @property {string} output output field key
 * @property {string} fn one of the built-in functions in core/derive.js
 * @property {string} [timeField] duration field (seconds) for rate functions
 * @property {'pre'|'post'} [phase] measurement phase for uniformity functions
 * @property {string} [kind] measurement kind, default "thickness"
 *
 * @typedef {BaseRecord & {
 *   toolId: string, name: string, processType: string, fields: FieldSpec[],
 *   derived: DerivedSpec[], primaryOutput: string|null
 * }} Template
 *
 * @typedef {string | number | boolean | null} FieldValue
 *
 * One step of a run with several steps. The main step (main: true) keeps
 * its values in the run's params; every other step keeps its own.
 * @typedef {{name: string, main?: boolean, params?: Record<string, FieldValue>}} RunStep
 *
 * A run's link to a project: which of its wafers the run processed and
 * which planned step it carries out.
 * @typedef {{projectId: string, waferIds: string[], stepId: string|null}} ProjectLink
 *
 * @typedef {BaseRecord & {
 *   toolId: string, templateId: string|null, material: string, substrate: string,
 *   maskMaterial?: string, status: 'draft'|'open'|'complete', startedAt: string,
 *   endedAt: string|null, params: Record<string, FieldValue>,
 *   results: Record<string, FieldValue>, derivedKeys: string[],
 *   targetThickness?: number|null, recipe: string, notes: string, tags: string[],
 *   photoIds: string[], steps: RunStep[], projects: ProjectLink[]
 * }} Run
 *
 * @typedef {{id: string, label: string, status: 'active'|'done'|'scrapped', notes: string}} Wafer
 *
 * @typedef {{id: string, title: string, toolId: string|null, templateId: string|null, recipe: string,
 *   notes: string, doneAt: string|null, skipped: boolean}} PlanStep
 *
 * @typedef {BaseRecord & {
 *   name: string, goal: string, status: 'active'|'paused'|'done', startedAt: string, endedAt: string|null,
 *   substrate: string, notes: string, wafers: Wafer[], steps: PlanStep[], folderId: string|null
 * }} Project
 *
 * A folder of projects; parentId null is the top level.
 * @typedef {BaseRecord & {name: string, parentId: string|null}} Folder
 *
 * @typedef {{site: string, value: number}} Point
 *
 * @typedef {BaseRecord & {
 *   runId: string, metrologyToolId: string|null, kind: string, phase: 'pre'|'post',
 *   material: string, unit: string, points: Point[], takenAt: string, notes: string
 * }} Measurement
 *
 * @typedef {BaseRecord & {
 *   toolId: string, type: string, major: boolean, at: string, notes: string
 * }} ToolEvent
 *
 * @typedef {BaseRecord & {
 *   runId: string, blob: Blob|null, width: number, height: number,
 *   caption: string, takenAt: string
 * }} Photo
 */
export {};
