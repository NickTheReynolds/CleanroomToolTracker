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
 *   active: boolean, defaultTemplateId: string|null, halfLifeDays?: number|null, notes: string,
 *   compat?: ToolCompat
 * }} Tool
 *
 * The person's own compatibility settings for a tool, over the profile the
 * app ships (core/compat.js). A field left out uses the shipped value; null
 * means "not set": nothing is checked for it.
 * @typedef {Object} ToolCompat
 * @property {string[] | null} [sizes] wafer sizes it takes (core/wafer-spec.js SIZES keys)
 * @property {number | null} [maxDiameterMm] the largest wafer it takes (null: the person's sizes set the LNF limit aside)
 * @property {string[] | null} [askSizes] sizes that need a helpdesk ticket (null: set aside, as above)
 * @property {'yes'|'carrier'|'ask'|'no'|null} [pieces] whether it takes pieces
 * @property {number | null} [maxThicknessUm] thickest wafer or stack it takes
 * @property {string[] | null} [masks] mask plate sizes it takes
 * @property {'clean'|'semiclean'|null} [accepts] the cleanest class of tool: which wafers may go in
 * @property {'semiclean'|'metals'|null} [marks] what a wafer counts as after it
 * @property {string[] | null} [excludes] material classes not allowed in it
 *
 * A film already on a wafer when it arrives (thermal oxide on a store wafer).
 * @typedef {{material: string, thicknessNm: number|null}} Film
 *
 * What a wafer or mask is. Every field is optional: empty means not known.
 * @typedef {Object} WaferSpec
 * @property {'wafer'|'mask'} [kind] a mask is kept like a wafer and called a mask on screen
 * @property {string} [material] substrate or plate material
 * @property {string} [size] a SIZES key: 100mm, 150mm, piece, plate5…
 * @property {string} [pieceSize] for pieces, e.g. "10 × 10 mm"
 * @property {number} [thicknessUm]
 * @property {number} [thicknessTolUm] the tolerance, plus or minus, around thicknessUm
 * @property {string} [orientation] e.g. "<100>", "<100> 4° off"
 * @property {string} [cut] crystal cut: "Z-cut", "128° Y-cut", "C-plane"
 * @property {'ssp'|'dsp'|'none'} [polish]
 * @property {'p'|'n'|'undoped'} [doping]
 * @property {string} [dopant] B, P, As, Sb
 * @property {string} [resistivity] as stated, e.g. "10–40 Ω·cm"
 * @property {string} [grade] Prime, Test, Mechanical, Master
 * @property {Film[]} [films]
 * @property {string} [coating] mask: chrome, low-reflectance chrome
 * @property {string} [resist] mask: the resist on a blank
 * @property {'clear'|'dark'} [polarity] mask: clear or dark field
 * @property {string} [design] mask: design and layer
 * @property {string} [vendor]
 * @property {string} [partNo]
 * @property {string} [notes]
 *
 * A saved wafer or mask the person can add to projects (store "wafers").
 * @typedef {BaseRecord & {name: string, spec: WaferSpec}} SavedWafer
 *
 * Wafers a plan step bonds into one stack.
 * @typedef {{id: string, waferIds: string[], method?: string}} Bond
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
 * A project's wafer or mask. `spec` is a copy of what it is (editing the
 * saved entry later does not rewrite the project); `specId` says where it
 * came from: a saved entry's id or an LNF store item's id.
 * @typedef {{id: string, label: string, status: 'active'|'done'|'scrapped', notes: string,
 *   spec?: WaferSpec, specId?: string|null}} Wafer
 *
 * A planned step. The optional parts: which wafers (and masks) it is for
 * (none: every wafer in process), the stacks it bonds, whether it separates
 * stacks, what it leaves on or removes from the wafers, and the
 * compatibility notes the person marked as checked (core/compat.js noteKey).
 * @typedef {{id: string, title: string, toolId: string|null, templateId: string|null, recipe: string,
 *   notes: string, doneAt: string|null, skipped: boolean, waferIds?: string[], bonds?: Bond[], debond?: boolean,
 *   adds?: string[], removes?: string[], checked?: string[]}} PlanStep
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
