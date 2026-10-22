// @ts-check
/**
 * Measurement helpers: which metrology tool a new measurement most likely
 * uses, and how pasted values fill the measurement sites. Pure: no DOM and
 * no storage.
 */
import { normText } from './vocab.js';
import { toMs } from './time.js';

/** @typedef {import('./types.js').Measurement} Measurement */
/** @typedef {import('./types.js').Tool} Tool */

/**
 * The kinds of metrology tool (LNF equipment types) that measure each kind
 * of measurement, best first.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const KIND_TOOL_TYPES = Object.freeze({
  thickness: ['reflectometer', 'ellipsometer', 'profilometer', 'optical-profilometer'],
  stepHeight: ['profilometer', 'optical-profilometer', 'afm'],
  cd: ['sem', 'optical-microscope'],
  sheetResistance: ['four-point-probe'],
  refractiveIndex: ['ellipsometer', 'reflectometer'],
  stress: ['stress'],
});

/**
 * The metrology tool a new measurement of this kind most likely uses: the
 * one used last for this kind; else one of the person's tools, then any
 * tool, of a type that measures this kind (the best type first); else the
 * metrology tool used last for anything; else none.
 * @param {string} kind
 * @param {readonly Measurement[]} measurements every measurement
 * @param {readonly Tool[]} tools the metrology tools on offer
 * @param {(toolId: string) => string | undefined} typeOf a tool's equipment type
 * @param {ReadonlySet<string>} [mine] the person's tools
 * @returns {string | null}
 */
export function defaultMetrologyTool(kind, measurements, tools, typeOf, mine = new Set()) {
  const offered = new Set(tools.map((t) => t.id));
  const latest = (/** @type {readonly Measurement[]} */ ms) => [...ms]
    .filter((m) => m.metrologyToolId && offered.has(m.metrologyToolId))
    .sort((a, b) => toMs(b.takenAt) - toMs(a.takenAt))[0]?.metrologyToolId || null;
  const sameKind = latest(measurements.filter((m) => m.kind === kind));
  if (sameKind) return sameKind;
  for (const type of KIND_TOOL_TYPES[kind] || []) {
    const fits = tools.filter((t) => typeOf(t.id) === type);
    const pick = fits.find((t) => mine.has(t.id)) || fits[0];
    if (pick) return pick.id;
  }
  return latest(measurements);
}

/**
 * Sites with pasted values. Values whose site names all match the form's
 * sites (case and spacing ignored) go to those sites; otherwise the values
 * fill the sites in order, and values beyond the last site add sites (named
 * as pasted, else numbered).
 * @param {readonly {site: string, value: number | null}[]} points the form's sites
 * @param {readonly {site: string | null, value: number}[]} pasted
 * @returns {{points: {site: string, value: number | null}[], added: number, byName: boolean}}
 */
export function fillPoints(points, pasted) {
  const index = new Map(points.map((p, i) => [normText(p.site), i]));
  const byName = pasted.length > 0 && pasted.every((v) => v.site !== null && index.has(normText(v.site)));
  const out = points.map((p) => ({ site: p.site, value: p.value }));
  if (byName) {
    for (const v of pasted) out[/** @type {number} */ (index.get(normText(/** @type {string} */ (v.site))))].value = v.value;
    return { points: out, added: 0, byName };
  }
  let added = 0;
  pasted.forEach((v, i) => {
    if (i < out.length) out[i].value = v.value;
    else {
      out.push({ site: v.site || String(i + 1), value: v.value });
      added += 1;
    }
  });
  return { points: out, added, byName };
}
