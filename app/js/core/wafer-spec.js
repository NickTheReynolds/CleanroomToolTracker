// @ts-check
/**
 * Wafer and mask specs: the vocabulary (sizes, polish, doping, bond
 * methods), a one-line summary, tidying a spec typed in a form, and the
 * material and substrate classes the compatibility checks use. A mask is
 * a wafer spec of kind "mask": it lives with the wafers and is called a
 * mask on screen. Every field is optional: empty means not known, and
 * nothing here guesses a value. Pure: no DOM and no storage.
 */
import { normText } from './vocab.js';

/** @typedef {import('./types.js').WaferSpec} WaferSpec */
/** @typedef {import('./types.js').Wafer} Wafer */

/**
 * @typedef {Object} SizeInfo
 * @property {string} key stored value
 * @property {string} label for pickers, without the inch glyph so exports print it
 * @property {string} short for summaries
 * @property {number | null} mm diameter of a round wafer, side of a mask plate; null for pieces
 * @property {boolean} [plate] a square mask plate
 */

/** Round wafers by diameter, pieces, then square mask plates by side. @type {ReadonlyArray<SizeInfo>} */
export const SIZES = Object.freeze([
  { key: '50mm', label: '2 in (50 mm)', short: '2 in', mm: 50.8 },
  { key: '76mm', label: '3 in (76 mm)', short: '3 in', mm: 76.2 },
  { key: '100mm', label: '100 mm (4 in)', short: '100 mm', mm: 100 },
  { key: '150mm', label: '150 mm (6 in)', short: '150 mm', mm: 150 },
  { key: '200mm', label: '200 mm (8 in)', short: '200 mm', mm: 200 },
  { key: '300mm', label: '300 mm (12 in)', short: '300 mm', mm: 300 },
  { key: 'piece', label: 'Piece', short: 'piece', mm: null },
  { key: 'plate4', label: '4 in plate', short: '4 in plate', mm: 101.6, plate: true },
  { key: 'plate5', label: '5 in plate', short: '5 in plate', mm: 127, plate: true },
  { key: 'plate6', label: '6 in plate', short: '6 in plate', mm: 152.4, plate: true },
  { key: 'plate7', label: '7 in plate', short: '7 in plate', mm: 177.8, plate: true },
]);
const SIZE_BY_KEY = new Map(SIZES.map((s) => [s.key, s]));
/** Sizes a wafer can have. */
export const WAFER_SIZES = Object.freeze(SIZES.filter((s) => !s.plate).map((s) => s.key));
/** Sizes a mask plate can have. */
export const PLATE_SIZES = Object.freeze(SIZES.filter((s) => s.plate).map((s) => s.key));

/** @type {Readonly<Record<string, string>>} */
export const KIND_LABELS = Object.freeze({ wafer: 'Wafer', mask: 'Mask' });
/** @type {Readonly<Record<string, string>>} */
export const POLISH_LABELS = Object.freeze({ ssp: 'One side polished', dsp: 'Both sides polished', none: 'Unpolished' });
const POLISH_SHORT = /** @type {Record<string, string>} */ ({ ssp: 'SSP', dsp: 'DSP', none: 'unpolished' });
/** @type {Readonly<Record<string, string>>} */
export const DOPING_LABELS = Object.freeze({ p: 'p-type', n: 'n-type', undoped: 'Undoped' });
/** @type {Readonly<Record<string, string>>} */
export const POLARITY_LABELS = Object.freeze({ clear: 'Clear field', dark: 'Dark field' });
/** How wafers can be bonded; empty is "not chosen yet". @type {Readonly<Record<string, string>>} */
export const BOND_LABELS = Object.freeze({
  anodic: 'Anodic', fusion: 'Fusion (direct)', eutectic: 'Eutectic', thermocompression: 'Thermocompression',
  adhesive: 'Adhesive', temporary: 'Temporary',
});
/** Quick choices for typed fields. */
export const ORIENTATIONS = Object.freeze(['<100>', '<110>', '<111>']);
export const DOPANTS = Object.freeze(['B', 'P', 'As', 'Sb']);
export const GRADES = Object.freeze(['Prime', 'Test', 'Mechanical']);

/** @param {unknown} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : []);
/** @param {unknown} v @returns {string} */
const str = (v) => (typeof v === 'string' ? v.trim() : '');
/** @param {unknown} v @returns {number | null} */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * @param {string | null | undefined} key
 * @returns {SizeInfo | null}
 */
export function sizeInfo(key) {
  return (key && SIZE_BY_KEY.get(key)) || null;
}

/**
 * @param {Partial<Wafer> | null | undefined} w a project wafer or a saved entry
 * @returns {boolean} it is a mask
 */
export function isMask(w) {
  return !!w && /** @type {any} */ (w).spec?.kind === 'mask';
}

/**
 * @param {Partial<WaferSpec> | null | undefined} spec
 * @returns {string} "525 ± 25 µm", "500 µm" or ""
 */
export function thicknessText(spec) {
  const t = num(spec?.thicknessUm);
  if (t === null) return '';
  const tol = num(spec?.thicknessTolUm);
  return tol ? `${t} ± ${tol} µm` : `${t} µm`;
}

/**
 * @param {number | null | undefined} nm
 * @returns {string} "500 nm", "2 µm", "1.5 µm"
 */
export function filmThicknessText(nm) {
  const n = num(nm);
  if (n === null) return '';
  return n >= 1000 ? `${Number((n / 1000).toFixed(3))} µm` : `${n} nm`;
}

/**
 * A spec in one line: "Si · 100 mm · <100> · p (B) · DSP · 525 ± 25 µm ·
 * 10–40 Ω·cm · Prime · with 2 µm SiO2 (thermal)". Masks: "5 in plate ·
 * Soda-lime glass · Chrome · AZ1518".
 * @param {Partial<WaferSpec> | null | undefined} spec
 * @returns {string} "" when nothing is known
 */
export function specSummary(spec) {
  if (!spec) return '';
  const size = sizeInfo(spec.size);
  const sizeText = size ? (size.key === 'piece' && str(spec.pieceSize) ? `piece ${str(spec.pieceSize)}` : size.short) : '';
  const dop = spec.doping ? `${DOPING_LABELS[spec.doping] ? (spec.doping === 'undoped' ? 'undoped' : spec.doping) : ''}${str(spec.dopant) ? ` (${str(spec.dopant)})` : ''}` : '';
  const films = list(spec.films).filter((f) => f && str(f.material))
    .map((f) => [filmThicknessText(f.thicknessNm), str(f.material)].filter(Boolean).join(' '));
  const parts = spec.kind === 'mask'
    ? [sizeText, str(spec.material), str(spec.coating), str(spec.resist), spec.polarity ? POLARITY_LABELS[spec.polarity] || '' : '',
      thicknessText(spec), str(spec.grade), str(spec.design)]
    : [str(spec.material), sizeText, str(spec.orientation), str(spec.cut), dop, spec.polish ? POLISH_SHORT[spec.polish] || '' : '',
      thicknessText(spec), str(spec.resistivity), str(spec.grade), films.length ? `with ${films.join(', ')}` : ''];
  return parts.filter(Boolean).join(' · ');
}

/**
 * A spec in a few words for lists and rows: "Si · 100 mm · p · DSP ·
 * with 2 µm SiO2 (thermal)", "5 in plate · Soda-lime glass".
 * @param {Partial<WaferSpec> | null | undefined} spec
 * @returns {string} "" when nothing is known
 */
export function specShort(spec) {
  if (!spec) return '';
  const size = sizeInfo(spec.size);
  const sizeText = size ? size.short : '';
  const films = list(spec.films).filter((f) => f && str(f.material))
    .map((f) => [filmThicknessText(f.thicknessNm), str(f.material)].filter(Boolean).join(' '));
  const parts = spec.kind === 'mask'
    ? [sizeText, str(spec.material), str(spec.design)]
    : [str(spec.material), sizeText, spec.doping && spec.doping !== 'undoped' ? spec.doping : '', spec.polish ? POLISH_SHORT[spec.polish] || '' : '',
      films.length ? `with ${films.join(', ')}` : ''];
  return parts.filter(Boolean).join(' · ');
}

/**
 * A spec as typed in a form, tidied for storage: text trimmed, numbers
 * checked, empty fields and empty films left out. Fields and values this
 * version does not know are kept (a size or polish a newer app adds, a
 * film's extra details), so a newer app's data survives an edit here.
 * @param {Partial<WaferSpec> | null | undefined} spec
 * @returns {WaferSpec}
 */
export function cleanSpec(spec) {
  /** @type {Record<string, any>} */
  const out = { ...(spec || {}) };
  for (const k of ['material', 'pieceSize', 'orientation', 'cut', 'dopant', 'resistivity', 'grade', 'coating', 'resist', 'design', 'vendor', 'partNo', 'notes']) {
    const v = str(out[k]);
    if (v) out[k] = v; else delete out[k];
  }
  for (const k of ['thicknessUm', 'thicknessTolUm']) {
    const v = num(out[k]);
    if (v !== null) out[k] = v; else delete out[k];
  }
  if (out.kind !== 'mask') delete out.kind;
  for (const k of ['size', 'polish', 'doping', 'polarity']) {
    if (str(out[k])) out[k] = str(out[k]); else delete out[k];
  }
  if (out.size !== 'piece') delete out.pieceSize;
  const films = list(out.films).filter((f) => f && str(f.material))
    .map((f) => ({ ...f, material: str(f.material), thicknessNm: num(f.thicknessNm) }));
  if (films.length) out.films = films; else delete out.films;
  if (out.kind === 'mask') { delete out.orientation; delete out.cut; delete out.doping; delete out.dopant; delete out.resistivity; delete out.films; delete out.polish; }
  else { delete out.coating; delete out.resist; delete out.polarity; delete out.design; }
  return /** @type {WaferSpec} */ (out);
}

/**
 * @param {Partial<WaferSpec> | null | undefined} spec
 * @returns {boolean} nothing but the kind is known
 */
export function specEmpty(spec) {
  return !Object.keys(cleanSpec(spec)).some((k) => k !== 'kind');
}

/**
 * The label prefix new items of this kind get: W for wafers, M for masks.
 * @param {'wafer' | 'mask' | undefined} kind
 * @returns {string}
 */
export function labelPrefix(kind) {
  return kind === 'mask' ? 'M' : 'W';
}

// ---------------------------------------------------------------------------
// Material classes, for the compatibility checks.

/**
 * @typedef {'noble' | 'metal' | 'organic' | 'glass' | 'silica' | 'alkali' | 'compound'} MaterialClass
 *   noble: gold, copper and other fast-diffusing metals; metal: other metals; organic: resists, polymers,
 *   waxes and adhesives; glass: borosilicate or soda-lime glass; silica: fused silica and quartz; alkali:
 *   lithium niobate or tantalate; compound: III-V and other compound semiconductors
 */

/** @type {Readonly<Record<MaterialClass, string>>} */
export const CLASS_LABELS = Object.freeze({
  noble: 'gold, copper and other fast-diffusing metals', metal: 'other metals', organic: 'resists and polymers',
  glass: 'glass', silica: 'fused silica or quartz', alkali: 'lithium niobate or tantalate', compound: 'compound semiconductors',
});

/** Formula names, matched with their case ("TiN" is a metal nitride, "Sn" is tin). */
const FORMULA = /** @type {Record<string, MaterialClass>} */ ({
  Au: 'noble', Cu: 'noble', Ag: 'noble', Pt: 'noble', Pd: 'noble', Ni: 'noble', Fe: 'noble', Co: 'noble', Zn: 'noble',
  Sn: 'noble', In: 'noble', Ir: 'noble', NiCr: 'noble', NiFe: 'noble', CuOx: 'noble', ITO: 'noble', IGZO: 'noble',
  AZO: 'noble', ZnO: 'noble', ZnS: 'noble', ZnSe: 'noble',
  Al: 'metal', Ti: 'metal', TiN: 'metal', TiW: 'metal', W: 'metal', Mo: 'metal', Ta: 'metal', Cr: 'metal', V: 'metal',
  Mg: 'metal', Nb: 'metal', NbN: 'metal', Hf: 'metal', Zr: 'metal',
  GaAs: 'compound', GaN: 'compound', GaP: 'compound', InP: 'compound', InGaP: 'compound', InGaAs: 'compound',
  AlGaAs: 'compound', InAs: 'compound', GaSb: 'compound', Ga2O3: 'compound',
  LiNbO3: 'alkali', LiTaO3: 'alkali',
});
/** Words, matched in lower case. */
const WORDS = /** @type {Record<string, MaterialClass>} */ ({
  gold: 'noble', copper: 'noble', silver: 'noble', platinum: 'noble', palladium: 'noble', nickel: 'noble', iron: 'noble',
  cobalt: 'noble', zinc: 'noble', tin: 'noble', indium: 'noble', iridium: 'noble',
  aluminum: 'metal', aluminium: 'metal', titanium: 'metal', tungsten: 'metal', molybdenum: 'metal', tantalum: 'metal',
  chromium: 'metal', chrome: 'metal', vanadium: 'metal', magnesium: 'metal', niobium: 'metal',
  glass: 'glass', pyrex: 'glass', borofloat: 'glass', borosilicate: 'glass', 'soda-lime': 'glass', sodalime: 'glass',
  quartz: 'silica', silica: 'silica',
});
const ORGANIC = /resist(?!iv|an|or)|polymer|polyimide|parylene|pdms|\bsu-?8\b|kmpr|pmma|\bzep|\blor\b|\bbcb\b|benzocyclobutene|crystalbond|santovac|wax\b|waferbond|adhesive|epoxy|\bhsq\b|barli|nlof|pmgi|\bma-?[np]\b|csar|shipley|microposit|megaposit|\bmir\b|\boir\b|^az(\s|-?\d)|^spr(\s|-?\d)|^s18\d\d|^s1800/;
/** Element symbols that are also words or Roman numerals: they count only in a name made of formulas ("Cr/Au", not "In situ"). */
const AMBIGUOUS = new Set(['In', 'V', 'W']);
/** A name ending in these is a dielectric, whatever metal it names ("Aluminum oxide" is Al2O3, which has no class either). */
const OXIDE = /^(oxide|dioxide|trioxide|pentoxide|sesquioxide|oxynitride)$/;

/**
 * The classes of a material name, as typed or listed: "Au" → noble,
 * "Cr/Au" → metal and noble, "SPR 220 3.0" → organic, "Pyrex
 * (borosilicate glass)" → glass. Unknown names have no class, so they never
 * raise a warning.
 * @param {string | null | undefined} name
 * @returns {Set<MaterialClass>}
 */
export function materialClasses(name) {
  /** @type {Set<MaterialClass>} */
  const out = new Set();
  const raw = String(name || '').normalize('NFKC').trim();
  if (!raw) return out;
  const low = normText(raw);
  if (ORGANIC.test(low)) out.add('organic');
  if (/fused silica/.test(low)) out.add('silica');
  else if (/glass|pyrex|borofloat|borosilicate|soda-?lime/.test(low) && !/\bpsg\b|spin-on/.test(low)) out.add('glass');
  // Formula and word tokens: "Cr/Au", "Al 1% Si", "CuOx (ALD)", "Ti + Pt". A name lists materials split by
  // "/", ",", "+" or "&"; each part is one material, in words or formulas.
  const parts = raw.replace(/\([^)]*\)/g, ' ').split(/[/,+&]+/).map((x) => x.split(/[\s–-]+/).filter(Boolean)).filter((x) => x.length);
  const tokens = parts.flat();
  const formulaOnly = tokens.every((t) => Object.hasOwn(FORMULA, t) || t === 'Si' || /^[\d.]+%?$/.test(t));
  for (const words of parts) {
    // "Titanium dioxide", "Aluminum scandium nitride": a dielectric written out, as its formula is (no class);
    // TiN, a conductor, stays a metal, as "Titanium nitride" does.
    const head = words[words.length - 1].toLowerCase();
    const dielectric = OXIDE.test(head) || (head === 'nitride' && words.some((t) => /^alumini?um$/i.test(t)));
    words.forEach((t, i) => {
      // A formula keeps its case ("TiN"); anything else is read as a word ("tin", "Gold").
      if (Object.hasOwn(FORMULA, t)) {
        if (formulaOnly || !AMBIGUOUS.has(t)) out.add(FORMULA[t]);
      } else {
        const c = WORDS[t.toLowerCase()];
        // The oxide may also come right after the metal, with more words after it ("Aluminum oxide ALD").
        const oxide = dielectric || OXIDE.test(String(words[i + 1] || '').toLowerCase());
        if (c && !(oxide && c === 'metal')) out.add(c);
      }
    });
  }
  return out;
}

/**
 * @param {Iterable<string>} names
 * @returns {Set<MaterialClass>} every class of these materials
 */
export function classesOf(names) {
  /** @type {Set<MaterialClass>} */
  const out = new Set();
  for (const n of names) for (const c of materialClasses(n)) out.add(c);
  return out;
}

/**
 * @typedef {'silicon' | 'silica' | 'glass' | 'compound' | 'crystal' | 'other'} SubstrateClass
 */

/** @type {Readonly<Record<SubstrateClass, string>>} */
export const SUBSTRATE_LABELS = Object.freeze({
  silicon: 'silicon', silica: 'fused silica or quartz', glass: 'glass', compound: 'compound semiconductor',
  crystal: 'crystal (sapphire, SiC, LiNbO3…)', other: 'other material',
});

/**
 * What kind of substrate a wafer's material is; "" when the material is
 * not set.
 * @param {string | null | undefined} material
 * @returns {SubstrateClass | ''}
 */
export function substrateClass(material) {
  const raw = String(material || '').normalize('NFKC').trim();
  if (!raw) return '';
  const low = normText(raw);
  const cls = materialClasses(raw);
  if (cls.has('compound')) return 'compound';
  if (cls.has('alkali') || /sapphire|\bsic\b|silicon carbide|diamond|\bge\b|germanium|linbo|litao|niobate|tantalate/.test(low)) return 'crystal';
  if (cls.has('silica')) return 'silica';
  if (cls.has('glass')) return 'glass';
  // "Si", "p-type Si <100>", "FZ Si", "Poly-Si", "SOI" (but not SiO2, SiC or Si3N4, which are other words).
  if (/(^|[^a-z0-9])(si|silicon|soi)([^a-z0-9]|$)/.test(low)) return 'silicon';
  return 'other';
}
