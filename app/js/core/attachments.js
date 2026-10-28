// @ts-check
/**
 * Pictures and files on plan steps, and an exposure step's GDS layout. The
 * step lists them (`attachments`, `gds`), so their names and sizes sync with
 * the project; the bytes stay on the device that added them, stored under
 * the same id (data/attachments.js). Pure: no storage here.
 */

/** @typedef {import('./types.js').PlanStep} PlanStep */
/** @typedef {import('./types.js').StepFile} StepFile */
/** @typedef {import('./types.js').GdsLayout} GdsLayout */
/** @typedef {import('./types.js').Project} Project */

/** The largest file a step takes. A backup carries files as text, a third larger, and must fit in a phone's memory. */
export const MAX_FILE_BYTES = 100e6;

/** @param {unknown} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : []);
/** @param {unknown} v @returns {string} */
const text = (v) => String(v ?? '').trim();

/**
 * Whether a step exposes a pattern, so a GDS layout belongs on it: its
 * template is a lithography one with a dose or exposure setting (aligners,
 * steppers, laser and e-beam writers, the mask maker). A step without a
 * template counts when its title says so.
 * @param {{title?: string}} step
 * @param {{processType: string, fields: {key: string, label: string}[]} | null | undefined} template
 * @returns {boolean}
 */
export function isExposureStep(step, template) {
  if (template) return template.processType === 'litho' && template.fields.some((f) => /dose|expos/i.test(`${f.key} ${f.label}`));
  return /expos|litho|\bwrit(e|ing)\b|mask mak/i.test(step.title || '');
}

/**
 * A GDS entry as stored: text trimmed and empty parts left out; null when it
 * names nothing.
 * @param {Partial<GdsLayout> | null | undefined} g
 * @returns {GdsLayout | null}
 */
export function cleanGds(g) {
  if (!g) return null;
  /** @type {GdsLayout} */
  const out = { name: text(g.name) };
  for (const k of /** @type {const} */ (['cell', 'layer', 'link'])) if (text(g[k])) out[k] = text(g[k]);
  if (g.fileId) {
    out.fileId = g.fileId;
    if (Number.isFinite(g.size)) out.size = g.size;
  }
  return out.name || out.fileId ? out : null;
}

/**
 * The address a GDS link opens: only a web address. Anything else (a network
 * path, a note) is shown as text, so a link synced from another device can
 * never run script.
 * @param {string | undefined} link
 * @returns {string | null}
 */
export function webLink(link) {
  try {
    const u = new URL(text(link));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * "mask_v3.gds, cell TOP, layer 1", for the step sheet and the traveler.
 * @param {GdsLayout | null | undefined} g
 * @returns {string}
 */
export function gdsText(g) {
  if (!g) return '';
  return [g.name, g.cell ? `cell ${g.cell}` : '', g.layer ? `layer ${g.layer}` : '', g.link || ''].filter(Boolean).join(', ');
}

/**
 * The names of a step's pictures and files, for the traveler.
 * @param {PlanStep} step
 * @returns {string}
 */
export function filesText(step) {
  return list(step.attachments).map((a) => a.name).join(', ');
}

/**
 * The step with one more picture or file.
 * @param {PlanStep} step
 * @param {StepFile} file
 * @returns {PlanStep}
 */
export function withFile(step, file) {
  return { ...step, attachments: [...list(step.attachments).filter((a) => a.id !== file.id), file] };
}

/**
 * The step without one picture or file (the list is left out once empty).
 * @param {PlanStep} step
 * @param {string} id
 * @returns {PlanStep}
 */
export function withoutFile(step, id) {
  const out = { ...step, attachments: list(step.attachments).filter((a) => a.id !== id) };
  if (!out.attachments.length) delete out.attachments;
  return out;
}

/**
 * Whether any step of these projects still names a stored file: a copied
 * project's GDS shares its file with the original, so removing it from one
 * step must not delete it for the other.
 * @param {readonly Project[]} projects live projects
 * @param {string} fileId
 * @returns {boolean}
 */
export function fileInUse(projects, fileId) {
  return projects.some((p) => list(p.steps).some((s) => list(s.attachments).some((a) => a.id === fileId) || s.gds?.fileId === fileId));
}

/**
 * Where to add pictures and files after a run is complete: the project page
 * with the sheet of the plan step the run carries out, or null when it
 * carries out none.
 * @param {{projects?: {projectId: string, stepId: string | null}[]}} run
 * @returns {string | null} a route, e.g. "/project/abc?step=def"
 */
export function stepFilesRoute(run) {
  const link = list(run.projects).find((l) => l && l.projectId && l.stepId);
  return link ? `/project/${encodeURIComponent(link.projectId)}?step=${encodeURIComponent(link.stepId)}` : null;
}

/**
 * A safe download name: no folder separators or control characters.
 * @param {string} name
 * @returns {string}
 */
export function downloadName(name) {
  return text(name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_') || 'file';
}
