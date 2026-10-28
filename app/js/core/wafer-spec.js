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
 * @typedef {'noble' | 'metal' | 'organic' | 'glass' | 'silica' | 'alkali' | 'compound' | 'unclean'} MaterialClass
 *   noble: gold, copper and other fast-diffusing metals; metal: other metals; organic: resists, polymers,
 *   waxes and adhesives; glass: borosilicate or soda-lime glass; silica: fused silica and quartz; alkali:
 *   lithium niobate or tantalate; compound: III-V and other compound semiconductors; unclean: anything else that
 *   is not CMOS-clean (only the person's answer gives it)
 */

/** @type {Readonly<Record<MaterialClass, string>>} */
export const CLASS_LABELS = Object.freeze({
  noble: 'gold, copper and other fast-diffusing metals', metal: 'other metals', organic: 'resists and polymers',
  glass: 'glass', silica: 'fused silica or quartz', alkali: 'lithium niobate or tantalate', compound: 'compound semiconductors',
  unclean: 'other materials that are not CMOS-clean',
});

/** Formula names, matched with their case ("TiN" is a metal nitride, "Sn" is tin). */
const FORMULA = /** @type {Record<string, MaterialClass>} */ ({
  Au: 'noble', Cu: 'noble', Ag: 'noble', Pt: 'noble', Pd: 'noble', Ni: 'noble', Fe: 'noble', Co: 'noble', Zn: 'noble',
  Sn: 'noble', In: 'noble', Ir: 'noble', NiCr: 'noble', NiFe: 'noble', CuOx: 'noble', ITO: 'noble', IGZO: 'noble',
  AZO: 'noble', ZnO: 'noble', ZnS: 'noble', ZnSe: 'noble', Ru: 'noble', Rh: 'noble', Os: 'noble', Mn: 'noble', Li: 'noble',
  Na: 'noble', AlCu: 'noble', AlSiCu: 'noble', AuGe: 'noble', AuSn: 'noble', NiV: 'noble', NiTi: 'noble', PtSi: 'noble',
  NiSi: 'noble', CoSi2: 'noble',
  Al: 'metal', Ti: 'metal', TiN: 'metal', TiW: 'metal', W: 'metal', Mo: 'metal', Ta: 'metal', Cr: 'metal', V: 'metal',
  Mg: 'metal', Nb: 'metal', NbN: 'metal', Hf: 'metal', Zr: 'metal', Re: 'metal', Sc: 'metal', Y: 'metal', La: 'metal',
  Er: 'metal', Gd: 'metal', Sb: 'metal', Bi: 'metal', Pb: 'metal', Cd: 'metal', Ga: 'metal', AlSi: 'metal', TaN: 'metal',
  WN: 'metal', TiAl: 'metal', TiSi2: 'metal', WSi2: 'metal', MoSi2: 'metal',
  GaAs: 'compound', GaN: 'compound', GaP: 'compound', InP: 'compound', InGaP: 'compound', InGaAs: 'compound',
  AlGaAs: 'compound', InAs: 'compound', GaSb: 'compound', Ga2O3: 'compound', AlGaN: 'compound', InGaN: 'compound',
  LiNbO3: 'alkali', LiTaO3: 'alkali',
});
/** Words, matched in lower case. */
const WORDS = /** @type {Record<string, MaterialClass>} */ ({
  gold: 'noble', copper: 'noble', silver: 'noble', platinum: 'noble', palladium: 'noble', nickel: 'noble', iron: 'noble',
  cobalt: 'noble', zinc: 'noble', tin: 'noble', indium: 'noble', iridium: 'noble', ruthenium: 'noble', rhodium: 'noble',
  osmium: 'noble', manganese: 'noble', lithium: 'noble', sodium: 'noble', potassium: 'noble',
  aluminum: 'metal', aluminium: 'metal', titanium: 'metal', tungsten: 'metal', molybdenum: 'metal', tantalum: 'metal',
  chromium: 'metal', chrome: 'metal', vanadium: 'metal', magnesium: 'metal', niobium: 'metal', hafnium: 'metal',
  zirconium: 'metal', rhenium: 'metal', scandium: 'metal', yttrium: 'metal', lanthanum: 'metal', erbium: 'metal',
  gadolinium: 'metal', antimony: 'metal', bismuth: 'metal', cadmium: 'metal', gallium: 'metal',
  glass: 'glass', pyrex: 'glass', borofloat: 'glass', borosilicate: 'glass', 'soda-lime': 'glass', sodalime: 'glass',
  quartz: 'silica', silica: 'silica', niobate: 'alkali', tantalate: 'alkali',
});
const ORGANIC = /resist(?!iv|an|or)|polymer|polyimide|\bpoly(?!silicon|crystal|si\b|ge\b|sige\b|cide|silicide|oxide|germanium|nitride|gate)[a-z(]|parylene|pdms|\bsu-?8\b|kmpr|pmma|\bzep|\blor\b|\bbcb\b|benzocyclobutene|crystalbond|santovac|wax\b|waferbond|adhesive|epoxy|\bhsq\b|barli|\bbarc\b|\bsml\b|\bptfe\b|teflon|cytop|kapton|nlof|pmgi|\bma-?[np]\b|csar|shipley|microposit|megaposit|\bmir\b|\boir\b|^az(\s|-?\d)|^spr(\s|-?\d)|^s18\d\d|^s1800/;
/** Doped oxide films called glasses: not a glass wafer. */
const NOT_GLASS = /\bb?psg\b|\bspin[\s-]?on\b|phospho-?\s?silicate|phosphorus[\s-]+silicate|borophospho/;
const GLASSY = /fused silica|glass|pyrex|borofloat|borosilicate|soda[\s-]?lime/;
/** Words that join two materials in one name ("Al on oxide", "Si with SiO2"): a dielectric's head never reaches across. */
const CONNECTORS = new Set(['on', 'with', 'over', 'under', 'atop', 'w']);
/**
 * A name ending in these is a dielectric, whatever metal it names ("Aluminum oxide" is Al2O3, "Hafnium silicate",
 * "Yttria-stabilized zirconia"), as its formula is: no class.
 */
const OXIDE = /^(oxide|dioxide|trioxide|pentoxide|sesquioxide|oxynitride|silicate|aluminate|zirconia|titania|hafnia|titanate|zirconate)$/;
/** Gallium or indium with these is a compound semiconductor, as GaAs, InP and GaN are (gallium oxide too, as Ga2O3). */
const COMPOUND_WORDS = /^(arsenide|phosphide|antimonide|nitride)$/;
/**
 * Materials the checks know and have no rule for: silicon in its forms, oxides, nitrides and other dielectrics, carbon.
 * Formulas keep their case, as in FORMULA.
 */
const PLAIN_FORMULA = new Set(['Si', 'SiO2', 'SiO', 'SiOx', 'SiOxNy', 'SiON', 'SiOC', 'Si3N4', 'SiN', 'SiNx', 'SiC', 'SiCN', 'SiGe', 'Ge',
  'aSi', 'SOI', 'DLC', 'BN', 'hBN', 'AlN', 'ScAlN', 'AlScN', 'Al2O3', 'AlOx', 'HfO2', 'HfOx', 'ZrO2', 'Ta2O5', 'TiO2', 'TiOx', 'Nb2O5',
  'V2O5', 'Y2O3', 'MgO', 'MgF2', 'HMDS', 'TEOS', 'LTO', 'HTO', 'USG', 'PSG', 'BPSG', 'BSG', 'SOG', 'CNT']);
/** The same, as words in lower case. */
const PLAIN_WORDS = new Set(['si', 'silicon', 'polysilicon', 'oxide', 'dioxide', 'trioxide', 'pentoxide', 'sesquioxide', 'oxynitride',
  'nitride', 'carbide', 'fluoride', 'silicate', 'aluminate', 'zirconia', 'titania', 'hafnia', 'arsenide', 'phosphide',
  'antimonide', 'boron', 'carbon', 'graphene', 'graphite', 'nanotube', 'nanotubes', 'diamond', 'sapphire', 'alumina', 'germanium', 'hmds',
  'teos', 'soi', 'fluorocarbon']);
/**
 * Words that say how, where or how much, not what: a process, a form, a state, doping, a side, a cut or a unit
 * ("thermal", "low-stress", "p-type", "bare", "Y-cut", "nm"). They neither make a name known nor unknown, so
 * "Si, p-type" is silicon and "Amorphous Se" is Se.
 */
const QUALIFIERS = new Set(['thermal', 'thermally', 'native', 'wet', 'dry', 'buried', 'pecvd', 'lpcvd', 'apcvd', 'sacvd', 'cvd', 'ald',
  'pvd', 'mocvd', 'mbe', 'epi', 'epitaxial', 'sputtered', 'sputter', 'evaporated', 'e', 'beam', 'ebeam', 'plated', 'electroplated',
  'electroless', 'spun', 'annealed', 'doped', 'undoped', 'intrinsic', 'degenerate', 'heavily', 'lightly', 'low', 'high', 'stress',
  'stoichiometric', 'rich', 'temperature', 'temp', 'crystalline', 'monocrystalline', 'polycrystalline', 'single', 'crystal', 'poly',
  'amorphous', 'a', 'film', 'films', 'layer', 'layers', 'wafer', 'wafers', 'substrate', 'piece', 'pieces', 'bulk', 'seed', 'foil',
  'coating', 'coated', 'cap', 'capping', 'liner', 'barrier', 'adhesion', 'hard', 'mask', 'sacrificial', 'porous', 'black', 'prime', 'test',
  'mechanical', 'grade', 'dsp', 'ssp', 'fz', 'cz', 'mcz', 'float', 'zone', 'type', 'n', 'p', 'b', 'as', 'phosphorus', 'arsenic',
  'nitrogen', 'hydrogen', 'oxygen', 'fluorine', 'on', 'with', 'and', 'of', 'in', 'side', 'sided', 'double', 'top', 'bottom', 'back',
  'front', 'thin', 'thick', 'fused', 'cured', 'baked', 'stabilized', 'stabilised', 'oxidized', 'oxidised', 'cut', 'plane', 'c', 'r', 'm',
  'x', 'z', 'off', 'offcut', 'miscut', 'angle', 'deg', 'situ', 'ii', 'iii', 'iv', 'vi', 'reflectance', 'reflective', 'anti', 'lift',
  'residue', 'trace', 'traces', 'bare', 'polished', 'unpolished', 'lapped', 'etched', 'patterned', 'blank', 'virgin', 'clean', 'cleaned',
  'dummy', 'monitor', 'handle', 'device', 'carrier', 'resistivity', 'hr', 'insulator', 'insulating', 'semi', 'conductive', 'alloy',
  'series', 'deposited', 'grown', 'implanted', 'diffused', 'nominal', 'free', 'positive', 'negative', 'tone', 'nm', 'um', 'µm', 'μm', 'mm', 'cm', 'inch', 'mil', 'mils',
  'å', 'angstrom', 'ohm', 'ω', 'sq', 'wt', 'at', '%', 'wt%', 'at%', 'gate', 'field', 'pad', 'tunnel', 'screen', 'isolation', 'passivation',
  'spacer', 'membrane', 'cladding', 'interlayer', 'locos', 'masking', 'sidewall', 'contact', 'buffer', 'etch', 'stop', 'hydrogenated',
  'fluorinated', 'deuterated', 'containing', 'bond', 'bonding', 'temporary', 'mounting', 'permanent', 'icp', 'rie', 'hdp', 'silicide',
  'corning', 'schott', 'sumco', 'siltronic', 'okmetic', 'shin', 'etsu', 'over', 'under', 'atop', 'w']);
/** Numbers, amounts and orientations: "100", "1.8", "200nm", "50Å", "4\"", "<100>", "4H", "1%", ">1000". */
const AMOUNT = /^(?:<\d{3}>|[<>≤≥~±]*[\d.,×x"″'°%]*\d[\d.,×x"″'°%]*(?:nm|um|µm|μm|mm|cm|in|h|c|å|a|k|ohm|ω|wt%|at%)?)$/i;
/** A resist's product code: "1518", "P4620", "12XT", "SF9", "3.0". */
const PRODUCT = /^(?=.*\d)[a-z\d.]{1,12}$/i;
/**
 * Silicon's dopants: before "doped" ("B-doped Si") or after "doped with", one of these is a dopant, not a film. Any metal
 * stays a metal, however it is written ("Al-doped Si", "Si doped with indium").
 */
const DOPANT_WORDS = new Set(['b', 'p', 'as', 'sb', 'n', 'c', 'ge', 'h', 'boron', 'phosphorus', 'arsenic', 'antimony', 'nitrogen', 'carbon',
  'germanium', 'hydrogen']);
/** A piece of a name that says there is nothing: "-", "n/a", "none". */
const NOTHING = /^(?:[-–—./]+|n\/a|none|nothing|nil|null)$/i;

/**
 * What the person can say a material is (Settings → Materials, or "What is
 * it?" on a plan note), for a name the app does not know. Each maps to the
 * classes and the substrate kind the checks use; an answer never takes away
 * what the app already reads.
 * @typedef {'silicon' | 'dielectric' | 'noble' | 'metal' | 'unclean' | 'organic' | 'glass' | 'nosodium' | 'silica' | 'compound' | 'alkali' | 'crystal'} MaterialKind
 */

/** In the order the chooser lists them. @type {ReadonlyArray<MaterialKind>} */
export const MATERIAL_KINDS = Object.freeze(['silicon', 'dielectric', 'noble', 'metal', 'unclean', 'organic', 'glass', 'nosodium', 'silica',
  'compound', 'alkali', 'crystal']);
/** The answers for a material. @type {Readonly<Record<MaterialKind, string>>} */
export const MATERIAL_KIND_LABELS = Object.freeze({
  silicon: 'Silicon (crystalline, poly or amorphous)', dielectric: 'A silicon oxide or nitride, or another dielectric with no metal in it',
  noble: 'Gold, copper or another fast-diffusing metal, or a compound of one', metal: 'Another metal, or a compound of one (TaN, PZT, SrTiO3)',
  unclean: 'Something else that is not CMOS-clean (selenium, for instance)', organic: 'A resist, polymer, wax or adhesive',
  glass: 'Glass with sodium (Pyrex, Borofloat, soda-lime)', nosodium: 'Glass without sodium (AF32, Eagle XG)',
  silica: 'Fused silica or quartz', compound: 'A compound semiconductor (GaAs, InP, GaN)', alkali: 'Lithium niobate or tantalate',
  crystal: 'Another crystal (sapphire, SiC, diamond)',
});
/** The answers for a wafer made of a material the app knows only as a film (an SiO2 wafer could be fused silica). */
export const WAFER_KINDS = Object.freeze(/** @type {MaterialKind[]} */ (['silicon', 'silica', 'glass', 'nosodium', 'crystal', 'dielectric']));
/** @type {Readonly<Partial<Record<MaterialKind, string>>>} */
export const WAFER_KIND_LABELS = Object.freeze({
  silicon: 'Silicon', silica: 'Fused silica or quartz', glass: 'Glass with sodium (Pyrex, Borofloat, soda-lime)',
  nosodium: 'Glass without sodium (AF32, Eagle XG)', crystal: 'Another crystal (sapphire, SiC, diamond)',
  dielectric: 'Something else: a ceramic, a metal or a polymer',
});
/** An answer in a few words, for lists. @type {Readonly<Record<MaterialKind, string>>} */
export const MATERIAL_KIND_SHORT = Object.freeze({
  silicon: 'silicon', dielectric: 'a dielectric with no metal in it', noble: 'a fast-diffusing metal', metal: 'a metal',
  unclean: 'not CMOS-clean', organic: 'a resist or polymer', glass: 'glass with sodium', nosodium: 'glass without sodium',
  silica: 'fused silica or quartz', compound: 'a compound semiconductor', alkali: 'lithium niobate or tantalate', crystal: 'a crystal',
});
/** @type {Readonly<Record<MaterialKind, ReadonlyArray<MaterialClass>>>} */
const KIND_CLASSES = Object.freeze({
  silicon: [], dielectric: [], noble: ['noble'], metal: ['metal'], unclean: ['unclean'], organic: ['organic'], glass: ['glass'],
  nosodium: ['glass'], silica: ['silica'], compound: ['compound'], alkali: ['alkali'], crystal: [],
});

/**
 * Whether a name says there is no material ("-", "n/a", "(none)", "-/-"), or is empty.
 * @param {string | null | undefined} name
 * @returns {boolean}
 */
export function isNothing(name) {
  const pieces = String(name ?? '').normalize('NFKC').split(/[\s,+&;()[\]]+/).filter(Boolean);
  return pieces.every((p) => NOTHING.test(p));
}

/** @param {unknown} name @returns {string} the name tidied, "" when it says there is nothing ("-", "n/a") */
const tidy = (name) => (isNothing(/** @type {string} */ (name)) ? '' : String(name).normalize('NFKC').trim());

/**
 * What the person said this exact name is (the whole name, any case), or
 * null: not said, taken back, or a kind this version does not know.
 * @param {string | null | undefined} name
 * @param {import('./types.js').MaterialKinds | null | undefined} kinds
 * @returns {MaterialKind | null}
 */
export function kindOf(name, kinds) {
  if (!kinds) return null;
  const key = normText(name);
  const e = key && Object.hasOwn(kinds, key) ? kinds[key] : null;
  const k = e && typeof e === 'object' ? e.kind : null;
  return typeof k === 'string' && Object.hasOwn(KIND_CLASSES, k) ? /** @type {MaterialKind} */ (k) : null;
}

/**
 * @typedef {{text: string, words: string[], inner: boolean}} Part one material of a name, with its words; inner: it was
 *   in brackets
 */

/**
 * A name's materials: split at "/", ",", "+", "&" or ";" ("Cr/Au", "Ti + Pt"),
 * then what is in brackets after a space ("SiO2 (thermal)"), each with its
 * words. "Si:B" is read as "Si doped with B", and "Poly(methyl methacrylate)"
 * as a polymer. Parts with no words ("Ti/-") are left out.
 * @param {string} raw
 * @returns {Part[]}
 */
function partsOf(raw) {
  // A polymer's chemical name: "poly(" with no space and a chemical inside, not "Poly (LPCVD)" or "Poly (n+)".
  const text = raw.replace(/\bpoly\(([^)]*)\)/gi, (m, inside) => (/[a-z]{5,}/i.test(inside)
    && !inside.split(/[\s,+-]+/).every((/** @type {string} */ w) => !w || QUALIFIERS.has(w.toLowerCase()) || PLAIN_WORDS.has(w.toLowerCase())) ? 'polymer' : m))
    // "a-Si:H" is hydrogenated; "Si:B" is doped.
    .replace(/:([HDF])\b/g, (m, x) => ({ H: ' hydrogenated', D: ' deuterated', F: ' fluorinated' })[/** @type {'H'} */ (x)])
    .replace(/([A-Za-z][A-Za-z0-9]*):([A-Z][a-z]?)\b/g, '$1 doped with $2');
  const split = (/** @type {string} */ s, /** @type {boolean} */ inner) => s.split(/[/,+&;]+/).map((x) => x.trim())
    .map((t) => ({ text: t, words: t.split(/[\s–—·()[\]-]+/).filter((w) => /[\p{L}\p{N}]/u.test(w)), inner }))
    .filter((p) => p.words.length && !p.words.every((w) => NOTHING.test(w)));
  const aside = /(^|\s)\(([^)]*)\)/g;
  const inside = [...text.matchAll(aside)].map((m) => m[2]);
  return [...split(text.replace(aside, ' '), false), ...inside.flatMap((s) => split(s, true))];
}

/**
 * Whether a token is the element or formula here, not a word that looks like one: "In situ", "III-V", "Y-cut",
 * "V-groove", "Bi-layer", "Re-deposited". In brackets, a lone symbol is a dopant ("Si (Sb)").
 * @param {string} t
 * @param {string[]} lower the part's words in lower case
 * @param {number} i
 * @param {Part} part
 * @returns {boolean}
 */
function elementHere(t, lower, i, part) {
  if (!Object.hasOwn(FORMULA, t)) return false;
  const prev = lower[i - 1] || '';
  const next = lower[i + 1] || '';
  if (part.inner && part.words.length === 1 && DOPANT_WORDS.has(lower[i])) return false;
  // A symbol that is also a word or a unit (In, V, W, Y, Re, Bi) is the element only as the first word of a material,
  // and not before a word it forms a term with: "W on Si" is tungsten; "100 W", "128° Y-X", "In situ", "III-V",
  // "Bi-layer" and "Si W/ SiO2" are not.
  if (['In', 'V', 'W', 'Y', 'Re', 'Bi'].includes(t)) {
    const first = i === 0 || CONNECTORS.has(prev);
    return first && !/^(situ|cut|axis|x|y|z|groove|grooves|shaped|notch|layer|layers|level|directional|polar|branch|junction)$/.test(next)
      && !(t === 'Re' && next && !CONNECTORS.has(next));
  }
  return true;
}

/** @param {string[]} lower @param {number} i @returns {boolean} the word is a dopant here ("B-doped", "doped with Sb") */
const dopantHere = (lower, i) => DOPANT_WORDS.has(lower[i])
  && ((lower[i + 1] === 'doped' && lower[i + 2] !== 'with') || (lower[i - 1] === 'with' && lower[i - 2] === 'doped'));

/**
 * Indexes of the words a resist, polymer or glass name covers ("AZ" in "AZ 1518", "Pyrex" in "Pyrex 7740").
 * @param {Part} part
 * @returns {Set<number>}
 */
function coveredWords(part) {
  const low = part.text.toLowerCase();
  /** @type {[number, number][]} */
  const spans = [];
  for (const re of [ORGANIC, GLASSY, NOT_GLASS]) {
    const g = new RegExp(re.source, 'g');
    for (const m of low.matchAll(g)) spans.push([m.index || 0, (m.index || 0) + Math.max(1, m[0].length)]);
  }
  /** @type {Set<number>} */
  const out = new Set();
  let at = 0;
  part.words.forEach((w, i) => {
    const pos = low.indexOf(w.toLowerCase(), at);
    if (pos < 0) return;
    at = pos + w.length;
    if (spans.some(([a, b]) => pos < b && pos + w.length > a)) out.add(i);
  });
  return out;
}

/**
 * What the app knows of one material of a name: the words it does not know (none: the part is known) and
 * whether it names a material at all (only words that say how or how much: it does not). Every word counts:
 * "Amorphous selenium", "PZT on Si" and "FTO glass" are not known because of the word that says what they are.
 * @param {Part} part
 * @returns {{unknown: string[], material: boolean}}
 */
function readPart(part) {
  const low = normText(part.text);
  const covered = coveredWords(part);
  const organic = ORGANIC.test(low);
  const lower = part.words.map((t) => t.toLowerCase());
  /** @type {string[]} */
  const unknown = [];
  let material = covered.size > 0;
  part.words.forEach((t, i) => {
    // A dopant, or what "-free" says there is none of ("Alkali-free glass"), only describes.
    if (covered.has(i) || dopantHere(lower, i) || lower[i + 1] === 'free') return;
    if (elementHere(t, lower, i, part) || PLAIN_FORMULA.has(t) || Object.hasOwn(WORDS, lower[i]) || PLAIN_WORDS.has(lower[i])) {
      material = true;
      return;
    }
    // A symbol read as a word here ("In situ"), a word that says how, an amount, a resist's product code.
    if (Object.hasOwn(FORMULA, t) || QUALIFIERS.has(lower[i]) || AMOUNT.test(t) || (organic && PRODUCT.test(t))) return;
    unknown.push(t);
  });
  // "Poly" with no other material is polysilicon ("Poly", "In situ doped poly").
  return { unknown, material: material || unknown.length > 0 || lower.includes('poly') };
}

/**
 * The person's answer for one material of a name: for its text, or for the words of it the app does not know
 * ("Se" in "Evaporated Se"). Null when there is none, or when the app knows the material (an answer only fills in).
 * @param {Part} part
 * @param {import('./types.js').MaterialKinds | null | undefined} kinds
 * @returns {MaterialKind | null}
 */
function partAnswer(part, kinds) {
  if (!kinds) return null;
  const { unknown } = readPart(part);
  if (!unknown.length) return null;
  return kindOf(part.text, kinds) || kindOf(unknown.join(' '), kinds);
}

/**
 * The materials of a name that the app does not know (and the person has
 * not answered for): what to ask about. "Ti/PZT" gives ["PZT"], "Evaporated
 * Se" gives ["Se"], "Zeonor (COC)" gives ["Zeonor", "COC"].
 * @param {string | null | undefined} name
 * @param {import('./types.js').MaterialKinds | null} [kinds]
 * @returns {string[]}
 */
export function unknownParts(name, kinds = null) {
  const raw = tidy(name);
  if (!raw || materialKnown(raw, kinds)) return [];
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const p of partsOf(raw)) {
    const { unknown } = readPart(p);
    if (!unknown.length || partAnswer(p, kinds)) continue;
    const ask = unknown.join(' ');
    if (!out.has(normText(ask))) out.set(normText(ask), ask);
  }
  return out.size ? [...out.values()] : [raw];
}

/**
 * Whether the checks know a material name: every word of each material in
 * it (brackets included) is one they give a class, one they know and have no
 * rule for (silicon, oxides, nitrides, carbon), or a word that only says how,
 * where or how much; or the person has answered for it. An empty name, or one
 * that says there is nothing ("-"), is not a material and counts as known.
 * @param {string | null | undefined} name
 * @param {import('./types.js').MaterialKinds | null} [kinds]
 * @returns {boolean}
 */
export function materialKnown(name, kinds = null) {
  const raw = tidy(name);
  if (!raw || kindOf(raw, kinds)) return true;
  const parts = partsOf(raw).map((p) => ({ p, r: readPart(p) }));
  if (parts.some(({ p, r }) => r.unknown.length && !partAnswer(p, kinds))) return false;
  if (parts.some(({ r }) => r.material)) return true;
  // Only words that say how ("Wafer"): the whole text decides.
  return ownClasses(raw).size > 0 || ownSubstrate(raw) !== 'other';
}

/**
 * Classes a part's text says outright: a resist or polymer, fused silica, a glass ("Kapton", "Pyrex 7740").
 * @param {string} low normalised
 * @param {Set<MaterialClass>} out
 */
function patternClasses(low, out) {
  if (ORGANIC.test(low)) out.add('organic');
  if (/fused silica/.test(low)) out.add('silica');
  else if (GLASSY.test(low) && !NOT_GLASS.test(low)) out.add('glass');
}

/**
 * The classes the app itself reads in a name, with no answers.
 * @param {string} raw tidied
 * @returns {Set<MaterialClass>}
 */
function ownClasses(raw) {
  /** @type {Set<MaterialClass>} */
  const out = new Set();
  // Each material of a list, and what is in brackets, says its own kind ("Cr/AZ 1518", "Si (Au-coated)").
  for (const part of partsOf(raw)) {
    const low = normText(part.text);
    patternClasses(low, out);
    const lower = part.words.map((t) => t.toLowerCase());
    // A name can join materials ("Aluminum on thermal oxide wafer"): each piece between the joining words is read alone.
    /** @type {number[]} */
    const seg = [];
    lower.forEach((w, i) => { seg[i] = i && CONNECTORS.has(lower[i - 1]) ? i : i ? seg[i - 1] : 0; });
    const pieceOf = (/** @type {number} */ i) => lower.filter((_, j) => seg[j] === seg[i] && !CONNECTORS.has(lower[j]));
    // "III-V" is a compound semiconductor.
    if (lower.some((w, i) => w === 'iii' && lower[i + 1] === 'v')) out.add('compound');
    // "Lithium niobate" is LiNbO3, not lithium; the sodium of "Sodium glass" is the glass.
    const niobate = lower.includes('niobate') || lower.includes('tantalate');
    const glassy = GLASSY.test(low);
    const notGlass = NOT_GLASS.test(low);
    part.words.forEach((t, i) => {
      // A dopant is not a film; "Sodium-free" says there is none.
      if (dopantHere(lower, i) || lower[i + 1] === 'free') return;
      const piece = pieceOf(i);
      // The last word of the piece that says what (not how): "Hafnium oxide film" ends in "oxide".
      const head = [...piece].reverse().find((w) => !QUALIFIERS.has(w) && !AMOUNT.test(w)) || '';
      // "Titanium dioxide", "Aluminum scandium nitride": a dielectric written out, as its formula is (no class);
      // TiN, a conductor, stays a metal, as "Titanium nitride" does.
      const dielectric = OXIDE.test(head) || (head === 'nitride' && piece.some((w) => /^alumini?um$/.test(w)));
      // "Gallium nitride", "Indium phosphide", "Gallium oxide": compound semiconductors, as GaN, InP and Ga2O3 are.
      const ga = piece.includes('gallium');
      const compound = ((ga || piece.includes('indium')) && piece.some((w) => COMPOUND_WORDS.test(w)))
        || (ga && piece.includes('oxide') && !piece.some((w) => w === 'indium' || w === 'zinc' || w === 'tin'));
      if (compound) out.add('compound');
      // A formula keeps its case ("TiN"); anything else is read as a word ("tin", "Gold").
      if (Object.hasOwn(FORMULA, t)) {
        if (elementHere(t, lower, i, part) && !(glassy && /^(Na|Li)$/.test(t))) out.add(FORMULA[t]);
        return;
      }
      const c = WORDS[lower[i]];
      if (!c || (compound && (lower[i] === 'gallium' || lower[i] === 'indium')) || (niobate && lower[i] === 'lithium')) return;
      if (glassy && /^(sodium|lithium|potassium)$/.test(lower[i])) return;
      // The oxide may also come right after the metal, with more words after it ("Aluminum oxide ALD").
      const oxide = dielectric || OXIDE.test(lower[i + 1] || '');
      if (!(oxide && c === 'metal') && !(notGlass && c === 'glass')) out.add(c);
    });
  }
  return out;
}

/**
 * The classes of a material name, as typed or listed: "Au" → noble,
 * "Cr/Au" → metal and noble, "SPR 220 3.0" → organic, "Pyrex
 * (borosilicate glass)" → glass. The person's answers fill in only what the
 * app does not know: the whole name, or a material of it, that it does not
 * know. An answer never takes away a class the app reads ("Ti/PZT" answered
 * for PZT keeps Ti a metal). A name with no class raises nothing by its
 * class; whether the app knows it at all is materialKnown.
 * @param {string | null | undefined} name
 * @param {import('./types.js').MaterialKinds | null} [kinds] what the person said materials are
 * @returns {Set<MaterialClass>}
 */
export function materialClasses(name, kinds = null) {
  const raw = tidy(name);
  if (!raw) return new Set();
  const out = ownClasses(raw);
  if (!kinds || materialKnown(raw)) return out;
  const own = kindOf(raw, kinds);
  if (own) for (const c of KIND_CLASSES[own]) out.add(c);
  for (const p of partsOf(raw)) {
    const said = partAnswer(p, kinds);
    if (said) for (const c of KIND_CLASSES[said]) out.add(c);
  }
  return out;
}

/**
 * @param {Iterable<string>} names
 * @param {import('./types.js').MaterialKinds | null} [kinds]
 * @returns {Set<MaterialClass>} every class of these materials
 */
export function classesOf(names, kinds = null) {
  /** @type {Set<MaterialClass>} */
  const out = new Set();
  for (const n of names) for (const c of materialClasses(n, kinds)) out.add(c);
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

/** The substrate kind each answer makes a wafer. @type {Readonly<Record<MaterialKind, SubstrateClass>>} */
const KIND_SUBSTRATE = Object.freeze({
  silicon: 'silicon', dielectric: 'other', noble: 'other', metal: 'other', unclean: 'other', organic: 'other', glass: 'glass',
  nosodium: 'glass', silica: 'silica', compound: 'compound', alkali: 'crystal', crystal: 'crystal',
});

/**
 * The kind of substrate the app itself reads in a material, with no answers.
 * @param {string} raw tidied
 * @returns {SubstrateClass}
 */
function ownSubstrate(raw) {
  const low = normText(raw);
  const cls = ownClasses(raw);
  if (cls.has('compound')) return 'compound';
  if (cls.has('alkali') || /sapphire|\bsic\b|silicon carbide|diamond|\bge\b|germanium|linbo|litao|niobate|tantalate/.test(low)) return 'crystal';
  if (cls.has('silica')) return 'silica';
  if (cls.has('glass')) return 'glass';
  // "Si", "p-type Si <100>", "FZ Si", "Poly-Si", "SOI" (but not SiO2, SiC or Si3N4, which are other words, nor
  // silicon dioxide, oxide or nitride written out).
  if (/(^|[^a-z0-9])(si|silicon|soi)([^a-z0-9]|$)/.test(low.replace(/\bsilicon[\s-]+((di|mon)?oxide|(oxy)?nitride|rich)\b/g, ' '))) return 'silicon';
  return 'other';
}

/**
 * Whether the app itself knows what kind of wafer a material makes: a kind it names (silicon, glass, a crystal…),
 * or a polymer or a metal (a kind of wafer no tool lists).
 * @param {string} raw tidied
 * @returns {boolean}
 */
function ownSubstrateKnown(raw) {
  if (ownSubstrate(raw) !== 'other') return true;
  const cls = ownClasses(raw);
  return cls.has('organic') || cls.has('noble') || cls.has('metal');
}

/**
 * The answer for the one material of a wafer's name ("D263" in "D263 (Schott)", "AF32" in "AF32, 500 µm"), or null.
 * @param {string} raw
 * @param {import('./types.js').MaterialKinds | null} kinds
 * @returns {MaterialKind | null}
 */
function singleAnswer(raw, kinds) {
  if (!kinds) return null;
  const named = partsOf(raw).filter((p) => !p.inner && readPart(p).material);
  if (named.length !== 1) return null;
  return kindOf(named[0].text, kinds) || partAnswer(named[0], kinds);
}

/**
 * What kind of substrate a wafer's material is; "" when the material is not
 * set. "other" is also what a name the app does not know gets: substrateKnown
 * tells the two apart. The person's answer counts only when the app does not
 * know the kind (an answer about SiO2 changes SiO2 wafers, never the app's own
 * reading of a wafer).
 * @param {string | null | undefined} material
 * @param {import('./types.js').MaterialKinds | null} [kinds] what the person said materials are
 * @returns {SubstrateClass | ''}
 */
export function substrateClass(material, kinds = null) {
  const raw = tidy(material);
  if (!raw) return '';
  if (!kinds || ownSubstrateKnown(raw)) return ownSubstrate(raw);
  const said = kindOf(raw, kinds) || singleAnswer(raw, kinds);
  return said ? KIND_SUBSTRATE[said] : ownSubstrate(raw);
}

/**
 * Whether the checks know what kind of substrate a material is: one they
 * name (silicon, glass, a crystal…), a polymer or a metal (a kind of wafer no
 * tool lists, "other"), or what the person said it is. SiO2 (which could be
 * fused silica) or a name the app has never seen is not known as a
 * substrate. An empty material is not set, which is not unknown.
 * @param {string | null | undefined} material
 * @param {import('./types.js').MaterialKinds | null} [kinds]
 * @returns {boolean}
 */
export function substrateKnown(material, kinds = null) {
  const raw = tidy(material);
  if (!raw || ownSubstrateKnown(raw)) return true;
  return !!(kindOf(raw, kinds) || singleAnswer(raw, kinds));
}

/**
 * Whether a wafer or film of this material is a glass without sodium, by the
 * person's answer about it or about a material of it the app does not know
 * ("AF32 glass", "Glass (D263)"): glass, but anodic bonding needs sodium.
 * @param {string | null | undefined} material
 * @param {import('./types.js').MaterialKinds | null} [kinds]
 * @returns {boolean}
 */
export function noSodium(material, kinds = null) {
  const raw = tidy(material);
  if (!raw) return false;
  // "Alkali-free glass", "Na-free glass": the name says so.
  if (GLASSY.test(normText(raw)) && /\b(alkali|sodium|na)[\s-]*free\b/.test(normText(raw))) return true;
  if (!kinds) return false;
  if (kindOf(raw, kinds) === 'nosodium' && (!materialKnown(raw) || !ownSubstrateKnown(raw))) return true;
  // The answer about the wafer's own material, not about a word in brackets ("Pyrex (Corning)").
  return partsOf(raw).some((p) => !p.inner && partAnswer(p, kinds) === 'nosodium');
}

/**
 * Whether the person's answer decides what the checks make of this name: it
 * fills in a material, or a kind of wafer, that the app does not know. A note
 * that only such an answer makes rests on the person's settings.
 * @param {string | null | undefined} name
 * @param {import('./types.js').MaterialKinds | null | undefined} kinds
 * @returns {boolean}
 */
export function saidByPerson(name, kinds) {
  const raw = tidy(name);
  if (!raw || !kinds) return false;
  const material = !materialKnown(raw) && (!!kindOf(raw, kinds) || partsOf(raw).some((p) => !!partAnswer(p, kinds)));
  return material || (!ownSubstrateKnown(raw) && !!(kindOf(raw, kinds) || singleAnswer(raw, kinds)));
}

/** @type {Readonly<Record<MaterialClass, string>>} */
const CLASS_SHORT = Object.freeze({
  noble: 'a fast-diffusing metal', metal: 'a metal', organic: 'a resist or polymer', glass: 'glass', silica: 'fused silica or quartz',
  alkali: 'lithium niobate or tantalate', compound: 'a compound semiconductor', unclean: 'not CMOS-clean',
});

/**
 * What the checks make of a material name, in a few words for lists: "a
 * metal", "a fast-diffusing metal and a metal" (Cr/Au), "silicon", "no rule
 * for it" (an oxide, a nitride), or "" when they do not know it. `said`: the
 * person's answer decides it. `wafer`: for a material the app knows only as a
 * film, the person's answer about wafers of it ("" when there is none).
 * @param {string} name
 * @param {import('./types.js').MaterialKinds | null} [kinds]
 * @returns {{text: string, known: boolean, said: boolean, wafer: string}}
 */
export function materialReading(name, kinds = null) {
  const raw = tidy(name);
  if (!raw) return { text: 'no material', known: true, said: false, wafer: '' };
  const ownKnown = materialKnown(raw);
  const said = !ownKnown && saidByPerson(raw, kinds);
  if (!materialKnown(raw, kinds)) return { text: '', known: false, said: false, wafer: '' };
  const order = Object.keys(CLASS_LABELS);
  const cls = [...materialClasses(raw, kinds)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const own = kindOf(raw, kinds);
  const sub = substrateClass(raw, kinds);
  const text = cls.length ? cls.map((c) => CLASS_SHORT[c]).join(' and ')
    : own && said ? MATERIAL_KIND_SHORT[own] : sub === 'silicon' ? 'silicon' : sub === 'crystal' ? 'a crystal' : 'no rule for it';
  // A film the app knows, with an answer about wafers made of it (an SiO2 wafer: fused silica).
  const waferKind = ownKnown && !ownSubstrateKnown(raw) ? kindOf(raw, kinds) || singleAnswer(raw, kinds) : null;
  return { text, known: true, said, wafer: waferKind ? (waferKind === 'dielectric' ? 'something else' : MATERIAL_KIND_SHORT[waferKind]) : '' };
}
