// @ts-check
/**
 * Compatibility checks for a project's plan. They walk the plan in order and
 * follow each wafer, or each bonded stack, through its steps: its size and
 * thickness, its substrate, the materials on it, how clean it is (a history:
 * once metal-contaminated, always so; an RCA clean brings back a wafer that
 * was only semi-clean), the last wet bench it saw, and KOH waiting to be
 * cleaned off. At each step they compare that with the tool's profile: what
 * the tool takes and what it does to a wafer.
 *
 * Profiles come from three places, in this order: general practice by kind
 * of tool, the LNF's own notes (the tool facts in data/compat-lnf.js, read
 * from the LNF wiki's recipe pages), and the person's settings on the tool.
 * Each note says which one it rests on. Anything not set raises nothing: no
 * size, no material, no profile field means no note. A material the app does
 * not know raises a "Check" wherever a rule could apply to it, and once the
 * person says what it is (Settings → Materials), the checks use that and the
 * notes rest on it. Notes advise; they never block saving. Pure: no DOM and
 * no storage.
 */
import {
  sizeInfo, isMask, materialClasses, substrateClass, materialKnown, substrateKnown, unknownParts, noSodium, isNothing, CLASS_LABELS,
  SUBSTRATE_LABELS,
} from './wafer-spec.js';
import { normText } from './vocab.js';

/** @typedef {import('./types.js').Project} Project */
/** @typedef {import('./types.js').PlanStep} PlanStep */
/** @typedef {import('./types.js').Wafer} Wafer */
/** @typedef {import('./types.js').Tool} Tool */
/** @typedef {import('./types.js').ToolCompat} ToolCompat */
/** @typedef {'lnf' | 'general' | 'yours'} Source */

/**
 * What a tool takes and does. Every field may be null: not known.
 * @typedef {Object} Profile
 * @property {string[] | null} sizes wafer sizes it takes
 * @property {number | null} maxDiameterMm the largest wafer it takes, when it takes "up to" a size
 * @property {string[] | null} askSizes sizes that need a helpdesk ticket or staff
 * @property {string} [askText] what those sizes need, quoted
 * @property {string | null} carrier the carrier wafer size smaller wafers and pieces go on
 * @property {'yes' | 'carrier' | 'ask' | 'no' | null} pieces
 * @property {string} [piecesHint] where pieces go instead
 * @property {number | null} minThicknessUm
 * @property {number | null} maxThicknessUm
 * @property {string[] | null} masks mask plate sizes it takes
 * @property {'clean' | 'semiclean' | null} accepts only wafers this clean may go in
 * @property {'semiclean' | 'metals' | null} marks what a wafer counts as afterwards: semi-clean (an RCA clean
 *   restores it) or not CMOS-clean for good
 * @property {string} [marksWhy] why, in a few words ("an evaporator", "a metals-class bench")
 * @property {boolean} restores an RCA clean: a semi-clean wafer is clean again
 * @property {boolean} precleans the RCA pre-furnace clean itself (PFC Bench 01)
 * @property {boolean} needsPreclean the RCA pre-furnace clean must be the step right before
 * @property {boolean} keepsPreclean a wafer stays pre-cleaned through this step (storage)
 * @property {boolean} wetBench a wet bench (acid, base, solvent, RCA)
 * @property {string[] | null} wetFrom the only wet benches (tool ids) a wafer may come from
 * @property {string} [wetText] that rule, quoted
 * @property {string[] | null} substrates substrate classes it takes
 * @property {string[] | null} excludes material classes not allowed in it
 * @property {string[] | null} cautions material classes that need staff approval
 * @property {string} [cautionText] the rule for those, quoted
 * @property {string} [koh] for KOH benches: the cleaning KOH-exposed wafers need
 * @property {string} [kohDev] for a KOH developer bench: its rule for the wafers, quoted (they stay out of clean and
 *   semi-clean tools until the KOH cleaning)
 * @property {boolean} kohSafe a KOH-exposed wafer may come here (the KOH and cleaning benches)
 * @property {'piranha' | 'rca' | null} kohStage the stage of the KOH cleaning done here: Piranha and SC2, then RCA
 * @property {string} [bondNote] a note for bonds on this tool that are not polymer bonds
 * @property {Record<string, Source>} src where each field came from
 */

/** @returns {Profile} */
export function emptyProfile() {
  return {
    sizes: null, maxDiameterMm: null, askSizes: null, carrier: null, pieces: null, minThicknessUm: null, maxThicknessUm: null,
    masks: null, accepts: null, marks: null, restores: false, precleans: false, needsPreclean: false, keepsPreclean: false,
    wetBench: false, wetFrom: null, substrates: null, excludes: null, cautions: null, kohSafe: false, kohStage: null, src: {},
  };
}

/** The fields the person can set on a tool (ToolCompat). Choosing sizes also sets the LNF size limits (up to, ask staff) aside. */
export const EDITABLE = Object.freeze(['sizes', 'maxDiameterMm', 'askSizes', 'pieces', 'maxThicknessUm', 'masks', 'accepts', 'marks', 'excludes']);

/**
 * A tool's profile: general practice for its kind, then the LNF notes, then
 * the person's own settings; each later one wins field by field.
 * @param {{general?: Partial<Profile> | null, lnf?: Partial<Profile> | null, yours?: ToolCompat | null}} parts
 * @returns {Profile}
 */
export function mergeProfile(parts) {
  const out = emptyProfile();
  /** @param {Partial<Profile> | ToolCompat | null | undefined} p @param {Source} source @param {readonly string[] | null} only */
  const apply = (p, source, only) => {
    if (!p) return;
    for (const [k, v] of Object.entries(p)) {
      if (k === 'src' || (only && !only.includes(k)) || v === undefined) continue;
      /** @type {any} */ (out)[k] = v;
      out.src[k] = source;
    }
  };
  apply(parts.general, 'general', null);
  apply(parts.lnf, 'lnf', null);
  apply(parts.yours, 'yours', EDITABLE);
  return out;
}

/**
 * @typedef {Object} Note
 * @property {string} stepId
 * @property {'stop' | 'caution'} severity stop: the tool does not take it or it will not work; caution: check first
 * @property {string} code what kind of problem: size, pieces, thickness, substrate, clean, material, preclean, wet, koh,
 *   koh-order, mask-size, mask-small, bond-size, bond-anodic, bond-polish, bond-clean, bond-tool; and, for what the
 *   app does not know, substrate-unknown, material-unknown, bond-unknown
 * @property {string[]} waferIds the wafers it is about
 * @property {string} key what "Mark as checked" stores on the step (noteKey)
 * @property {string} text one or two plain sentences
 * @property {Source} source what it rests on
 * @property {string[]} [materials] for the -unknown codes: the material names the app does not know, so the screen
 *   can ask what each is
 */

/**
 * Why a wafer is less than CMOS-clean, as a verb and the rest of the clause,
 * so the sentence agrees with one wafer or several.
 * @typedef {{verb: 'carries' | 'has been in' | 'has been at' | 'came', rest: string}} Why
 */

/**
 * @typedef {Object} Unit one wafer, or a stack of bonded wafers
 * @property {string[]} ids wafer ids
 * @property {string} label "W1" or "W1+C1"
 * @property {boolean} mask
 * @property {string | null} size
 * @property {number | null} thick nominal thickness, µm
 * @property {number} tol ± µm
 * @property {Map<string, string>} subs substrate materials (a stack has several) with their substrate class, or
 *   "unknown" for one the app does not know as a substrate
 * @property {Set<string>} subNames the substrate materials, normalised (they "are" the wafer; films are "carried")
 * @property {Map<string, {name: string, step: number}>} mats materials on it, by normalised name; step 0 = it came with it
 * @property {'clean' | 'semiclean' | 'metals'} level
 * @property {Why | null} why what lowered the level
 * @property {number} whyStep the step that lowered it (0: it came that way)
 * @property {Source} whySrc what that rests on: general practice (metal on it), or the source of the tool's mark
 * @property {boolean} pre pre-cleaned for a furnace
 * @property {{toolId: string, name: string, step: number} | null} wet the last wet bench it was at
 * @property {{step: number, piranha: boolean, dev?: string} | null} koh exposed to KOH and not yet cleaned; piranha: Acid 92
 *   done; dev: only a KOH developer, with its bench's rule
 * @property {'' | 'general' | 'yours'} stain metal or another material that is not CMOS-clean was on it, or a tool marked
 *   it (an evaporator): what a fusion bond must not have, even after the metal is etched off. 'yours' when only the person's
 *   settings say so
 * @property {Unit[]} [members] a stack's wafers as they were when bonded
 * @property {number} [bondStep] the step that bonded the stack
 */

/** @param {unknown} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : []);
const RANK = { clean: 0, semiclean: 1, metals: 2 };
// "PG" is Remover PG, not the µPG mask maker (µ is not a word character, so \b would match after it).
const STRIP = /\bstrip(?!line)|\bash(ing)?\b|lift-?off|piranha|nanostrip|acetone|remover\b|\b1165\b|(?:^|[^\wµμ])pg\b|\bprs\b|resist\s+remov|remov\w*\s+(the\s+)?(photo)?resist|\bwax\s+remov|remov\w*\s+(the\s+)?(mounting\s+)?wax\b/i;
const DESCUM = /descum/i;
const PERMANENT = /parylene|polyimide|pdms|su-?8|bcb|benzocyclobutene/i;
const KOH = /\bKOH\b|\b400K\b/i;
const CLASS_ORDER = Object.keys(CLASS_LABELS);
/** A stack's bond adhesive, by its key among the materials. */
const ADHESIVE = 'bond adhesive';
/** What a step can name in What it removes to take a mount's adhesive off ("Crystalbond", "mounting wax", "Beeswax"). */
const MOUNT = /adhesive|wax\b|crystalbond|santovac|waferbond|\bglue\b/i;
/** A debond in one of these dissolves the mount (Crystalbond 555 dissolves in DI water). */
const SOLVENT = /acetone|xylene|toluene|\bnmp\b|\bipa\b|isopropanol|alcohol|methanol|ethanol|solvent|\bwater\b|\bsoak/i;

/** What each source means, said with every note (on screen and in the traveler). @type {Readonly<Record<Source, string>>} */
export const SOURCE_TEXT = Object.freeze({
  lnf: 'From the LNF wiki notes in the app.',
  general: 'General practice, not an LNF rule.',
  yours: 'From a setting made in this app.',
});
/** Classes as a tool's rule names them, for a material the app does not know: fast-diffusing and other metals are metals. */
const RULE_WORDS = /** @type {Record<string, string>} */ ({
  noble: 'metals', metal: 'metals', organic: 'resists and polymers', glass: 'glass', silica: 'fused silica',
  alkali: 'lithium niobate or tantalate', compound: 'compound semiconductors', unclean: 'anything else that is not CMOS-clean',
});
/** The classes a kind of wafer can be: a rule on these is a rule on wafers too. */
const WAFER_CLASSES = ['glass', 'silica', 'compound', 'alkali'];

/**
 * What the checks make of material names, with the person's answers, each
 * name worked out once per plan.
 * @typedef {Object} Know
 * @property {(name: string) => Set<string>} classes materialClasses
 * @property {(name: string) => string} substrate substrateClass
 * @property {(name: string) => boolean} known the app knows the material
 * @property {(name: string) => boolean} subKnown the app knows what kind of substrate it is
 * @property {(name: string) => boolean} noSodium a glass without sodium, by the person's answer
 * @property {(name: string) => string[]} ask the materials of the name the app does not know, to ask about
 * @property {(name: string) => Set<string>} plain the classes without the person's answers: a note rests on the
 *   person's settings when only their answer makes it
 * @property {(name: string) => string} plainSub the substrate class without the person's answers, "unknown" when the
 *   app does not know it
 */

/**
 * @param {import('./types.js').MaterialKinds | null | undefined} kinds
 * @returns {Know}
 */
function knowledge(kinds) {
  const k = kinds || null;
  /** @template T @param {(name: string) => T} f @returns {(name: string) => T} */
  const memo = (f) => {
    /** @type {Map<string, T>} */
    const seen = new Map();
    return (name) => {
      if (!seen.has(name)) seen.set(name, f(name));
      return /** @type {T} */ (seen.get(name));
    };
  };
  return {
    classes: memo((name) => materialClasses(name, k)),
    substrate: memo((name) => substrateClass(name, k)),
    known: memo((name) => materialKnown(name, k)),
    subKnown: memo((name) => substrateKnown(name, k)),
    noSodium: memo((name) => noSodium(name, k)),
    ask: memo((name) => unknownParts(name, k)),
    plain: memo((name) => materialClasses(name)),
    plainSub: memo((name) => (substrateKnown(name) ? substrateClass(name) : 'unknown')),
  };
}

/**
 * @param {Set<string>} c
 * @returns {boolean} metal, a compound semiconductor, lithium niobate or tantalate, or anything else that is not
 *   CMOS-clean: the wafer is not CMOS-clean for good
 */
const dirties = (c) => c.has('noble') || c.has('metal') || c.has('unclean') || c.has('compound') || c.has('alkali');
/** @param {string} name @returns {boolean} a wafer of it could be fused silica (SiO2, silicon dioxide, oxide) */
const silicaLike = (name) => /\bsio[2x]?\b|silicon[\s-]+(di|mon)?oxide|^(thermal\s+)?oxide$/.test(normText(name));
/** @param {Set<string>} c @returns {boolean} */
const isMetal = (c) => c.has('noble') || c.has('metal');

/** @param {Unit} u @returns {string[]} the kinds of substrate it is, as far as the app knows */
const subKinds = (u) => [...new Set([...u.subs.values()].filter((c) => c !== 'unknown'))];
/** @param {Unit} u @returns {string[]} its substrate materials the app does not know as substrates */
const subUnknown = (u) => [...u.subs].filter(([, c]) => c === 'unknown').map(([name]) => name);

/**
 * Whether a step's title or recipe says it strips resist: strip, ash,
 * lift-off, piranha, Nanostrip, acetone, a remover, "remove resist", wax
 * removal (a descum is not a strip).
 * @param {string} text
 * @returns {boolean}
 */
export function strips(text) {
  return STRIP.test(text) && !DESCUM.test(text);
}

/**
 * "W1", "W1 and W2", "W1, W2 and W3".
 * @param {string[]} labels
 * @returns {string}
 */
export function andList(labels) {
  if (labels.length <= 1) return labels[0] || '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** @param {string | null} key @returns {string} "100 mm", "5 in plate", "a piece" */
const sizeWords = (key) => (key === 'piece' ? 'a piece' : sizeInfo(key)?.short || '');
/** @param {readonly string[]} keys @returns {string} "100 mm or 150 mm" */
const sizesWords = (keys) => {
  const s = keys.map((k) => sizeInfo(k)?.short || k);
  return s.length <= 1 ? s[0] || '' : `${s.slice(0, -1).join(', ')} or ${s[s.length - 1]}`;
};
/** @param {readonly string[]} keys plate sizes @returns {string} "4 in or 5 in plates" */
const platesWords = (keys) => `${sizesWords(keys).replace(/ plate/g, '')} plates`;
/** @param {boolean} many @param {string} one @param {string} more */
const agree = (many, one, more) => (many ? more : one);
/** @param {Why} why @param {boolean} many @returns {string} "carries Au from step 2", "have been in …" */
const whyText = (why, many) => {
  const verb = !many ? why.verb : why.verb === 'carries' ? 'carry' : why.verb.startsWith('has') ? why.verb.replace(/^has/, 'have') : why.verb;
  return `${verb} ${many ? why.rest.replace(/\bon it\b/, 'on them') : why.rest}`;
};
/** @param {number | null} thick @param {number} tol @returns {string} "1025 ± 50 µm" */
const thickText = (thick, tol) => `${Math.round(thick || 0)}${tol ? ` ± ${Math.round(tol)}` : ''} µm`;
/** @param {string[]} xs @returns {string} "metals", "metals or glass", "metals, resists and polymers, or glass" */
const orList = (xs) => (xs.length <= 2 ? xs.join(' or ') : `${xs.slice(0, -1).join(', ')}, or ${xs[xs.length - 1]}`);
/** @param {readonly string[]} classes @returns {string} a rule's classes in words, in a fixed order */
const ruleWords = (classes) => {
  const has = (/** @type {string} */ c) => classes.includes(c);
  const words = [has('noble') && has('metal') ? 'metals' : has('noble') ? 'fast-diffusing metals (gold, copper…)'
    : has('metal') ? 'metals other than fast-diffusing ones' : ''];
  for (const c of ['organic', 'glass', 'silica', 'alkali', 'compound']) if (has(c)) words.push(RULE_WORDS[c]);
  if (has('unclean')) words.push(words.some(Boolean) ? RULE_WORDS.unclean : 'materials that are not CMOS-clean');
  return orList(words.filter(Boolean));
};

/**
 * @typedef {Object} PlanInput
 * @property {{wafers: Wafer[], steps: PlanStep[]}} project
 * @property {(step: PlanStep) => Profile | null} profileOf the step's tool profile, or null without a tool
 * @property {(toolId: string | null) => string} toolName
 * @property {(step: PlanStep) => {adds: string[], removes: string[]}} [stepMaterials] what the step leaves and removes,
 *   beyond its own adds and removes (a deposition recipe's film, a spin-coat recipe's resist)
 * @property {import('./types.js').MaterialKinds | null} [kinds] what the person said materials are (settings)
 */

/**
 * The wafers a step is for: the ones it names (masks too: a lithography
 * step can name the mask it uses), else every wafer in process, leaving
 * masks out when the project also has wafers. A wafer in a stack brings its
 * stack along in the checks.
 * @param {{wafers: Wafer[]}} project
 * @param {PlanStep} step
 * @returns {Wafer[]}
 */
export function stepWafers(project, step) {
  const wafers = list(project.wafers);
  const byId = new Map(wafers.map((w) => [w.id, w]));
  const named = list(step.waferIds).map((id) => byId.get(id)).filter(Boolean);
  // Named wafers that are done or scrapped go no further; naming only those means no wafers.
  if (named.length) return named.filter((w) => w.status !== 'done' && w.status !== 'scrapped');
  const anyWafer = wafers.some((w) => !isMask(w));
  return wafers.filter((w) => w.status === 'active' && (!anyWafer || !isMask(w)));
}

/**
 * A note's identity for "Mark as checked": its kind, how serious it is and
 * which wafers. It changes, and the note comes back, when the wafers
 * change; checking a "Check" never hides a "Not allowed".
 * @param {Pick<Note, 'code' | 'severity' | 'waferIds'>} note
 * @returns {string}
 */
export function noteKey(note) {
  return `${note.code}/${note.severity}:${[...note.waferIds].sort().join(',')}`;
}

/**
 * Check a plan. Skipped steps are left out.
 * @param {PlanInput} input
 * @returns {{notes: Note[], byStep: Map<string, Note[]>}}
 */
export function checkPlan(input) {
  const { project } = input;
  const know = knowledge(input.kinds);
  const wafers = list(project.wafers).filter((w) => w && typeof w.id === 'string');
  /** @type {Map<string, Unit>} unit by wafer id (every member of a stack points at the stack) */
  const unitOf = new Map();
  for (const w of wafers) unitOf.set(w.id, newUnit(w, know));
  /** @type {Note[]} */
  const notes = [];
  const steps = list(project.steps);
  steps.forEach((step, i) => {
    if (!step || step.skipped) return;
    const n = i + 1;
    const profile = step.toolId ? input.profileOf(step) : null;
    const tool = step.toolId ? input.toolName(step.toolId) : '';
    const here = stepWafers({ wafers }, step);
    const units = [...new Set(here.map((w) => unitOf.get(w.id)).filter(Boolean))];
    /** @type {Raw[]} */
    const found = [];
    /** @type {NoteFn} */
    const note = (us, severity, code, source, make, materials) => {
      found.push({ severity, code, source, units: us, make, ...(materials && materials.length ? { materials } : {}) });
    };
    const wafersHere = units.filter((u) => !u.mask);
    const masksHere = units.filter((u) => u.mask);
    if (profile) checkTool(profile, tool, n, wafersHere, masksHere, note, know);
    // What the tool's notes already ask about: a bond at the same step does not ask again.
    const asked = new Set(found.flatMap((x) => x.materials || []).map((name) => normText(name)));
    const mats = input.stepMaterials ? input.stepMaterials(step) : { adds: [], removes: [] };
    for (const u of units) applyStep(u, profile, tool, n, step, mats, know);
    if (list(step.bonds).length) bondStep(step, profile, n, wafers, unitOf, note, know, asked);
    if (step.debond) for (const u of new Set(here.map((w) => unitOf.get(w.id)))) if (u && u.members) split(u, unitOf);
    notes.push(...merge(step.id, found));
  });
  /** @type {Map<string, Note[]>} */
  const byStep = new Map();
  for (const x of notes) byStep.set(x.stepId, [...(byStep.get(x.stepId) || []), x]);
  return { notes, byStep };
}

/**
 * A raw note: the wafers, how serious, its kind, what it rests on, its text given the wafers' labels, and the
 * names the app does not know (for the -unknown notes).
 * @typedef {(us: Unit[], sev: Note['severity'], code: string, src: Source, text: (who: string, many: boolean) => string,
 *   materials?: string[]) => void} NoteFn
 */

/** @param {Wafer} w @param {Know} know @returns {Unit} */
function newUnit(w, know) {
  const spec = w.spec || {};
  /** @type {Map<string, {name: string, step: number}>} */
  const mats = new Map();
  // "-" or "n/a" says there is no material.
  const add = (/** @type {string} */ m) => { if (!isNothing(m)) mats.set(normText(m), { name: String(m).trim(), step: 0 }); };
  add(spec.material || '');
  for (const f of list(spec.films)) add(f && f.material);
  const material = isNothing(spec.material) ? '' : String(spec.material).trim();
  // Metal, or another material that is not CMOS-clean (by the person's answer), leaves it out of CMOS-clean tools.
  const dirt = [...mats.values()].map((m) => m.name).filter((name) => dirties(know.classes(name)));
  const metal = dirt.some((name) => isMetal(know.classes(name)));
  return {
    ids: [w.id], label: w.label, mask: isMask(w), size: spec.size || null,
    thick: typeof spec.thicknessUm === 'number' ? spec.thicknessUm : null, tol: typeof spec.thicknessTolUm === 'number' ? spec.thicknessTolUm : 0,
    subs: new Map(material ? [[material, know.subKnown(material) ? know.substrate(material) : 'unknown']] : []),
    subNames: new Set(material ? [normText(material)] : []), mats,
    level: dirt.length ? 'metals' : 'clean', why: dirt.length ? { verb: 'came', rest: `with ${metal ? 'metal' : andList(dirt)} on it` } : null, whyStep: 0,
    // Dirt known only from the person's answer rests on that answer.
    whySrc: dirt.length && !dirt.some((name) => dirties(know.plain(name))) ? 'yours' : 'general',
    stain: stainOf([...mats.values()].map((m) => m.name), know), pre: false, wet: null, koh: null,
  };
}

/** @param {Set<string>} c @returns {boolean} metal, or anything else not CMOS-clean: what a fusion bond's surfaces must not have had */
const staining = (c) => c.has('noble') || c.has('metal') || c.has('unclean');
/**
 * @param {string[]} names materials
 * @param {Know} know
 * @returns {Unit['stain']} what they leave for a fusion bond: '' nothing, 'general' by the app's own reading, 'yours' only by
 *   the person's answers
 */
const stainOf = (names, know) => {
  const hit = names.filter((name) => staining(know.classes(name)));
  return !hit.length ? '' : hit.some((name) => staining(know.plain(name))) ? 'general' : 'yours';
};
/** @param {Unit['stain']} a @param {Unit['stain']} b @returns {Unit['stain']} both stains, the app's own reading first */
const stains = (a, b) => (a === 'general' || b === 'general' ? 'general' : a || b);

/**
 * What a note rests on when it joins a rule and the wafer's history: the
 * person's setting if either is one, else general practice if either is,
 * else the LNF notes.
 * @param {Source} a
 * @param {Source} b
 * @returns {Source}
 */
function weaker(a, b) {
  if (a === 'yours' || b === 'yours') return 'yours';
  return a === 'general' || b === 'general' ? 'general' : 'lnf';
}

/**
 * The checks one tool makes of the wafers and masks of a step. Everything a
 * note says is read now, before the step changes the wafers.
 * @param {Profile} p
 * @param {string} tool
 * @param {number} n step number
 * @param {Unit[]} units wafers and stacks
 * @param {Unit[]} masks
 * @param {NoteFn} note
 * @param {Know} know
 */
function checkTool(p, tool, n, units, masks, note, know) {
  const src = (/** @type {string} */ k) => p.src[k] || 'general';
  const is = (/** @type {boolean} */ many) => agree(many, 'is', 'are');
  for (const u of units) {
    // KOH first: until cleaned, the wafer belongs only at the KOH and cleaning benches. After only a KOH
    // developer, its bench's note keeps it out of the clean and semi-clean tools.
    const koh = u.koh ? { ...u.koh } : null;
    if (koh && (koh.dev ? !!p.accepts : !p.kohSafe)) {
      const dev = koh.dev;
      note([u], 'stop', 'koh', 'lnf', (who) => (dev ? `${who} had KOH at step ${koh.step}: the LNF notes say ${dev}.`
        : `${who} had KOH at step ${koh.step}: the LNF notes say KOH-exposed samples must be cleaned with Piranha and SC2 at Acid Bench 92 and then an RCA clean at RCA Bench 81 before other tools.`));
    } else if (koh && p.kohStage === 'rca' && !koh.piranha) {
      note([u], 'caution', 'koh-order', 'lnf', (who) => `${who} had KOH at step ${koh.step}: the LNF notes put the Piranha and SC2 clean at Acid Bench 92 before this RCA clean.`);
    }
    const size = u.size ? sizeInfo(u.size) : null;
    if (size && !size.plate) {
      if (u.size === 'piece') {
        if (p.pieces === 'no') note([u], 'stop', 'pieces', src('pieces'), (who) => `${who}: ${tool} does not take pieces${p.piecesHint ? `; ${p.piecesHint}` : ''}.`);
        else if (p.pieces === 'carrier') note([u], 'caution', 'pieces', src('pieces'), (who) => `${who}: mount pieces on a ${p.carrier ? `${sizeWords(p.carrier)} ` : ''}carrier wafer for ${tool}.`);
        else if (p.pieces === 'ask') note([u], 'caution', 'pieces', src('pieces'), (who) => `${who}: pieces need a helpdesk ticket on ${tool}.`);
      } else if (p.askSizes && p.askSizes.includes(u.size || '')) {
        note([u], 'caution', 'size', src('askSizes'), (who, many) => `${who} ${is(many)} ${size.short}: ${p.askText || `that size needs a helpdesk ticket on ${tool}`}.`);
      } else if (p.sizes && !p.sizes.includes(u.size || '')) {
        const onCarrier = p.carrier && (sizeInfo(p.carrier)?.mm || 0) > (size.mm || 0);
        if (onCarrier) note([u], 'caution', 'size', src('carrier'), (who, many) => `${who} ${is(many)} ${size.short}: ${tool} takes ${sizesWords(p.sizes || [])} wafers, so smaller ones go on a ${sizeWords(p.carrier)} carrier wafer.`);
        else note([u], 'stop', 'size', src('sizes'), (who, many) => `${who} ${is(many)} ${size.short}; ${tool} takes ${sizesWords(p.sizes || [])} wafers.`);
      } else if (p.maxDiameterMm && (size.mm || 0) > p.maxDiameterMm + 1) {
        note([u], 'stop', 'size', src('maxDiameterMm'), (who, many) => `${who} ${is(many)} ${size.short}; ${tool} takes up to ${p.maxDiameterMm} mm.`);
      }
    }
    if (u.thick !== null && (p.maxThicknessUm || p.minThicknessUm)) {
      const t = thickText(u.thick, u.tol);
      if (p.maxThicknessUm && u.thick + u.tol > p.maxThicknessUm) {
        note([u], 'stop', 'thickness', src('maxThicknessUm'), (who, many) => `${who} ${is(many)} ${t} thick; ${tool} takes up to ${p.maxThicknessUm} µm.`);
      } else if (p.minThicknessUm && u.thick - u.tol < p.minThicknessUm) {
        note([u], 'stop', 'thickness', src('minThicknessUm'), (who, many) => `${who} ${is(many)} ${t} thick; ${tool} takes ${p.minThicknessUm} µm and up.`);
      }
    }
    // A kind of substrate the tool does not take ("other": the person said it is none of the kinds a tool lists).
    const allowed = p.substrates ? andList(p.substrates.map((s) => SUBSTRATE_LABELS[/** @type {'silicon'} */ (s)] || s)) : '';
    const badSubs = p.substrates ? [...u.subs].filter(([, c]) => c !== 'unknown' && !(p.substrates || []).includes(c)) : [];
    if (badSubs.length) {
      const bad = andList([...new Set(badSubs.map(([name, c]) => (c === 'other' ? name : SUBSTRATE_LABELS[/** @type {'silicon'} */ (c)] || c)))]);
      // When only the person's answer makes it a kind the tool does not take, the note rests on that answer.
      const plain = badSubs.some(([name]) => { const c = know.plainSub(name); return c !== 'unknown' && !(p.substrates || []).includes(c); });
      note([u], 'stop', 'substrate', plain ? src('substrates') : weaker(src('substrates'), 'yours'), (who) => `${who}: ${tool} takes ${allowed} only, not ${bad}.`);
    }
    // A substrate the app does not know ("FZ wafer", or SiO2, which could be fused silica): the person can say. A tool
    // that lists what it takes asks about any; one with a rule on a kind of wafer (glass, fused silica…) asks about a
    // film the app knows used as a wafer (SiO2), since a material it does not know at all is asked about below.
    const waferRules = WAFER_CLASSES.filter((c) => (p.excludes || []).includes(c) || (p.cautions || []).includes(c));
    // Without a list of what it takes, only a wafer that could be fused silica or glass (SiO2) is asked about.
    const unknownSubs = p.substrates ? subUnknown(u)
      : waferRules.length ? subUnknown(u).filter((name) => know.known(name) && silicaLike(name)) : [];
    if (unknownSubs.length) {
      const what = `the app does not know what kind of wafer ${andList(unknownSubs)} ${unknownSubs.length > 1 ? 'are' : 'is'}`;
      if (p.substrates) {
        note([u], 'caution', 'substrate-unknown', src('substrates'), (who) => `${who}: ${tool} takes ${allowed} only, and ${what}.`, unknownSubs);
      } else {
        const barred = waferRules.filter((c) => (p.excludes || []).includes(c));
        const cautioned = waferRules.some((c) => (p.cautions || []).includes(c)) ? p.cautionText || '' : '';
        const rule = [barred.length ? `${tool} allows no ${ruleWords(barred)}` : '', cautioned].filter(Boolean).join(', and ');
        const source = barred.length && cautioned ? weaker(src('excludes'), src('cautions')) : src(barred.length ? 'excludes' : 'cautions');
        if (rule) note([u], 'caution', 'substrate-unknown', source, (who) => `${who}: ${what}; ${rule}${/[.)”]$/.test(rule) ? '' : '.'}`, unknownSubs);
      }
    }
    if (p.accepts && RANK[u.level] > RANK[p.accepts] && u.why) {
      const why = u.why;
      const back = u.level === 'semiclean';
      note([u], 'stop', 'clean', weaker(src('accepts'), u.whySrc), (who, many) => `${who} ${whyText(why, many)}: ${tool} takes ${p.accepts === 'clean' ? 'CMOS-clean' : 'clean or semi-clean'} wafers only.${p.accepts !== 'clean' ? ''
        : back ? ` An RCA clean (RCA Bench 81) first brings ${agree(many, 'it', 'them')} back.` : ` ${agree(many, 'It', 'They')} cannot be made CMOS-clean again.`}`);
    }
    if (p.wetFrom && u.wet && !p.wetFrom.includes(u.wet.toolId)) {
      const wet = { ...u.wet };
      note([u], 'stop', 'wet', src('wetFrom'), (who, many) => `${who} ${agree(many, 'comes', 'come')} from ${wet.name} (step ${wet.step}): ${p.wetText || `${tool} takes no wafers from that wet bench`}.`);
    }
    // A substrate the tool does not take is said once, by the substrate rule.
    const names = [...u.mats.values()].filter((m) => !(badSubs.length && u.subNames.has(normText(m.name))));
    // A wafer's own kind counts among what it is: an SiO2 wafer the person said is fused silica is fused silica at the
    // PFC bench, though SiO2 films stay what they are.
    const subOf = new Map([...u.subs].map(([name, c]) => [normText(name), c]));
    const classesHere = (/** @type {{name: string}} */ m, /** @type {boolean} */ plain) => {
      const c = new Set(plain ? know.plain(m.name) : know.classes(m.name));
      const sub = subOf.get(normText(m.name));
      const kind = sub === undefined ? '' : plain ? know.plainSub(m.name) : sub;
      if (kind === 'silica' || kind === 'glass' || kind === 'compound') c.add(kind);
      return c;
    };
    /** Materials a note here already names (Not allowed or Check): a name is not also asked about. */
    const stopped = new Set();
    for (const [classes, sev, text] of /** @type {[string[] | null, Note['severity'], string][]} */ ([[p.excludes, 'stop', ''], [p.cautions, 'caution', p.cautionText || '']])) {
      if (!classes) continue;
      const hit = names.filter((m) => [...classesHere(m, false)].some((c) => classes.includes(c)));
      if (!hit.length) continue;
      for (const m of hit) stopped.add(m.name);
      const own = hit.filter((m) => u.subNames.has(normText(m.name))).map((m) => m.name);
      const carried = hit.filter((m) => !u.subNames.has(normText(m.name))).map((m) => `${m.name} ${m.step ? `(step ${m.step})` : '(as bought)'}`);
      // In a fixed order ("gold … and other metals"), whatever order the materials came in.
      const hitClasses = [...new Set(hit.flatMap((m) => [...classesHere(m, false)].filter((c) => classes.includes(c))))]
        .sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b));
      const rule = src(sev === 'stop' ? 'excludes' : 'cautions');
      // When only the person's answers put these materials under the rule, the note rests on those answers.
      const plain = hit.some((m) => [...classesHere(m, true)].some((c) => classes.includes(c)));
      note([u], sev, 'material', plain ? rule : weaker(rule, 'yours'), (who, many) => {
        const what = [own.length ? `${is(many)} ${andList(own)}` : '', carried.length ? `${agree(many, 'carries', 'carry')} ${andList(carried)}` : '']
          .filter(Boolean).join(' and ');
        return sev === 'stop'
          ? `${who} ${what}: ${tool} allows no ${andList(hitClasses.map((c) => CLASS_LABELS[/** @type {'noble'} */ (c)] || c))}.`
          : `${who} ${what}: ${text}`;
      });
    }
    // Materials the app does not know, where a rule here could apply to them, with the rule, so the person can say
    // what each is. The clean rule matters only while the wafer is clean enough for it and no rule here already bars
    // metals and anything else that is not CMOS-clean.
    const dirtBarred = !!p.excludes && ['noble', 'metal', 'unclean'].every((c) => (p.excludes || []).includes(c));
    const cleanOnly = !!p.accepts && RANK[u.level] <= RANK[p.accepts] && !dirtBarred;
    const rules = [p.excludes ? `allows no ${ruleWords(p.excludes)}` : '',
      cleanOnly ? `takes ${p.accepts === 'clean' ? 'CMOS-clean' : 'clean or semi-clean'} wafers only` : ''].filter(Boolean);
    const cautionText = !rules.length && p.cautions && p.cautions.length ? p.cautionText || '' : '';
    const unknown = rules.length || cautionText
      ? names.filter((m) => !know.known(m.name) && !stopped.has(m.name) && !unknownSubs.some((s) => normText(s) === normText(m.name))) : [];
    if (unknown.length) {
      // "PZT (as bought)", "PZT (in Ti/PZT, step 3)": the materials the app does not know, in the name they came in.
      const what = andList(unknown.map((m) => {
        const ask = know.ask(m.name);
        const when = u.subNames.has(normText(m.name)) ? '' : m.step ? `step ${m.step}` : 'as bought';
        if (ask.length === 1 && normText(ask[0]) === normText(m.name)) return when ? `${m.name} (${when})` : m.name;
        return `${andList(ask)} (in ${m.name}${when ? `, ${when}` : ''})`;
      }));
      const source = !rules.length ? src('cautions') : p.excludes && cleanOnly ? weaker(src('excludes'), src('accepts')) : src(p.excludes ? 'excludes' : 'accepts');
      note([u], 'caution', 'material-unknown', source, (who) => (rules.length
        ? `${who}: the app does not know ${what}; ${tool} ${rules.join(' and ')}.`
        : `${who}: the app does not know ${what}. ${cautionText.charAt(0).toUpperCase()}${cautionText.slice(1)}`), [...new Set(unknown.flatMap((m) => know.ask(m.name)))]);
    }
    if (p.needsPreclean && !u.pre) {
      note([u], 'stop', 'preclean', src('needsPreclean'), (who, many) => `${who} ${agree(many, 'needs', 'need')} the RCA pre-furnace clean at PFC Bench 01 as the step right before ${tool}, on the same day (or kept in Tempress S2T1 storage in between).`);
    }
  }
  for (const m of masks) {
    const plate = m.size ? sizeInfo(m.size) : null;
    if (!plate || !plate.plate) continue;
    if (p.masks && !p.masks.includes(m.size || '')) {
      note([m], 'stop', 'mask-size', src('masks'), (who, many) => `${who} ${agree(many, `is a ${plate.short}`, `are ${plate.short}s`)}; ${tool} takes ${platesWords(p.masks || [])}.`);
    }
    const big = units.map((u) => sizeInfo(u.size)).filter((s) => s && !s.plate && s.mm).sort((a, b) => (b?.mm || 0) - (a?.mm || 0))[0];
    if (big && big.mm && (plate.mm || 0) < big.mm + 20) {
      note([m], 'caution', 'mask-small', 'general', (who, many) => `${who} (${plate.short}) ${is(many)} small for ${big.short} wafers: a mask plate is usually at least an inch wider than the wafer (5 in plates for 100 mm, 7 in for 150 mm).`);
    }
  }
}

/**
 * What a step does to a wafer: materials removed and added, its cleanliness
 * class, the pre-furnace clean, the last wet bench, KOH.
 * @param {Unit} u
 * @param {Profile | null} p
 * @param {string} tool
 * @param {number} n
 * @param {PlanStep} step
 * @param {{adds: string[], removes: string[]}} mats
 * @param {Know} know
 */
function applyStep(u, p, tool, n, step, mats, know) {
  const text = `${step.title || ''} ${step.recipe || ''}`;
  // A stack's bond adhesive sits between its wafers: nothing reaches it until the wafers come apart (this step
  // may be the one that takes them apart, "Debond in acetone").
  const reachable = !u.members || !!step.debond;
  const removes = [...list(step.removes), ...mats.removes];
  for (const r of removes) {
    u.mats.delete(normText(r));
    // Naming the mount ("Crystalbond", "mounting wax") takes its adhesive off.
    if (MOUNT.test(r) && reachable) u.mats.delete(ADHESIVE);
  }
  // "-" or "n/a" in What it adds says there is nothing.
  const adds = [...list(step.adds), ...mats.adds].filter((a) => !isNothing(a));
  // Resist and other removable organics come off (the bond adhesive only when it can be reached). A polymer wafer
  // (Kapton) stays what it is, and so does a film named with a metal too ("Cr/AZ 1518": the Cr stays).
  const stripOrganics = () => {
    for (const [k, m] of u.mats) {
      const cls = know.classes(m.name);
      if (cls.has('organic') && [...cls].every((c) => c === 'organic') && !PERMANENT.test(m.name) && (k !== ADHESIVE || reachable)
        && !u.subNames.has(k)) u.mats.delete(k);
    }
  };
  // A step that leaves a film is a deposition, whatever its title says ("Evaporate Au for lift-off").
  if (!adds.length && strips(text)) stripOrganics();
  // A debond that dissolves the mount takes its adhesive off: in a solvent, at a wet bench, or with the mount's own
  // LNF recipe (whose removal ends in its solvent). A dry debond (a hot plate slide) leaves it for a later clean.
  if (step.debond && u.members && (SOLVENT.test(text) || /\bmounting\b/i.test(step.recipe || '') || p?.wetBench)) u.mats.delete(ADHESIVE);
  for (const a of adds) u.mats.set(normText(a), { name: String(a).trim(), step: n });
  // A worse level takes the new reason; at the same level, a reason that does not rest on the person's settings
  // replaces one that does, so the note rests on the person's settings only when nothing else makes it.
  const lower = (/** @type {Unit['level']} */ level, /** @type {Why} */ why, /** @type {Source} */ whySrc) => {
    if (RANK[level] > RANK[u.level] || (level === u.level && u.whySrc === 'yours' && whySrc !== 'yours')) {
      u.level = level; u.why = why; u.whyStep = n; u.whySrc = whySrc;
    }
  };
  // Metal, or anything else that is not CMOS-clean (by the person's answer).
  const dirt = adds.filter((a) => dirties(know.classes(a)));
  // Dirt known only from the person's answer rests on that answer.
  if (dirt.length) lower('metals', { verb: 'carries', rest: `${andList(dirt)} from step ${n}` }, dirt.some((a) => dirties(know.plain(a))) ? 'general' : 'yours');
  if (p?.marks) {
    lower(p.marks, { verb: p.marks === 'metals' ? 'has been in' : 'has been at', rest: `${tool} (step ${n}${p.marksWhy ? `, ${p.marksWhy}` : ''})` }, p.src.marks || 'general');
  }
  // What a fusion bond must not have had stays after an etch takes the metal off.
  u.stain = stains(u.stain, stainOf(adds, know));
  if (p?.marks === 'metals') u.stain = stains(u.stain, p.src.marks === 'yours' ? 'yours' : 'general');
  if (p?.restores) {
    if (u.level === 'semiclean') { u.level = 'clean'; u.why = null; u.whyStep = 0; u.whySrc = 'general'; }
    stripOrganics();
  }
  // KOH: Piranha and SC2 at Acid 92, then the RCA clean at RCA 81 (in that order) clean it off.
  if (u.koh && p?.kohStage === 'piranha') u.koh = { ...u.koh, piranha: true };
  else if (u.koh && p?.kohStage === 'rca' && u.koh.piranha) u.koh = null;
  if (p?.koh && KOH.test(text)) u.koh = { step: n, piranha: false };
  // A KOH developer: KOH again, but a KOH etch not yet cleaned off stays the stricter one.
  else if (p?.kohDev && KOH.test(text)) u.koh = u.koh && !u.koh.dev ? { ...u.koh, piranha: false } : { step: n, piranha: false, dev: p.kohDev };
  u.pre = !!p?.precleans || (!!p?.keepsPreclean && u.pre);
  if (p?.wetBench && step.toolId) u.wet = { toolId: step.toolId, name: tool, step: n };
}

/**
 * Bond the step's groups into stacks, after checking each group.
 * @param {PlanStep} step
 * @param {Profile | null} p
 * @param {number} n
 * @param {Wafer[]} wafers
 * @param {Map<string, Unit>} unitOf
 * @param {NoteFn} note
 * @param {Know} know
 * @param {Set<string>} asked materials the tool's notes at this step already ask about, normalised
 */
function bondStep(step, p, n, wafers, unitOf, note, know, asked) {
  const known = new Set(wafers.map((w) => w.id));
  for (const b of list(step.bonds)) {
    const members = [...new Set(list(b && b.waferIds).filter((id) => known.has(id)).map((id) => unitOf.get(id)))]
      .filter(/** @returns {u is Unit} */ (u) => !!u && !u.mask);
    if (members.length < 2) continue;
    const method = String(b.method || '');
    // The group as one thing to name: "W1+G1" (two pairs with one problem read "W1+G1 and W2+G2").
    const group = /** @type {Unit} */ ({ ...members[0], ids: members.flatMap((u) => u.ids), label: members.map((u) => u.label).join('+') });
    const sizes = [...new Set(members.map((u) => u.size).filter((s) => s && s !== 'piece'))];
    // A piece mounted on a carrier with wax or adhesive is a usual thing, not a mismatch.
    if (sizes.length > 1 && method !== 'adhesive' && method !== 'temporary') {
      note([group], 'caution', 'bond-size', 'general', (who, many) => `${who} ${agree(many, 'mixes', 'mix')} sizes (${andList(sizes.map((s) => sizeWords(s)))}): bonders usually need wafers of one size.`);
    }
    // A glass with sodium: a glass wafer, or a glass film on a wafer (evaporated Pyrex). A glass the person said has no
    // sodium (AF32) is glass, but does not anodic bond.
    const sodiumGlass = (/** @type {Unit} */ u) => [...u.subs].some(([name, c]) => c === 'glass' && !know.noSodium(name))
      || [...u.mats.values()].some((m) => know.classes(m.name).has('glass') && !know.noSodium(m.name));
    // What the app does not know about the wafers: a material, or the kind of wafer a film it knows makes (SiO2).
    // To ask about, not to guess at; what the tool's notes here already ask is not asked again.
    const filmsOf = (/** @type {Unit[]} */ us) => [...new Set(us.flatMap((u) => [...u.mats.values()].filter((m) => !know.known(m.name)).flatMap((m) => know.ask(m.name))))];
    const wafersOf = (/** @type {Unit[]} */ us) => [...new Set(us.flatMap((u) => subUnknown(u).filter((name) => know.known(name))))];
    const fresh = (/** @type {string[]} */ names) => names.filter((name) => !asked.has(normText(name)));
    /** @param {string[]} films @param {string[]} kinds @returns {string} "what AF32 is", "what kind of wafer SiO2 is" */
    const notKnown = (films, kinds) => [films.length ? `what ${andList(films)} ${films.length > 1 ? 'are' : 'is'}` : '',
      kinds.length ? `what kind of wafer ${andList(kinds)} ${kinds.length > 1 ? 'are' : 'is'}` : ''].filter(Boolean).join(' or ');
    if (method === 'anodic' && !members.some(sodiumGlass)) {
      const films = filmsOf(members);
      const kinds = wafersOf(members);
      if (films.length || kinds.length) {
        const [f, k] = [fresh(films), fresh(kinds)];
        if (f.length || k.length) {
          note([group], 'caution', 'bond-unknown', 'general', (who) => `${who}: anodic bonding joins a sodium-containing glass (such as Pyrex or Borofloat) to silicon, and the app does not know ${notKnown(f, k)}.`, [...f, ...k]);
        }
      } else if (members.every((u) => subKinds(u).length)) {
        const silica = members.some((u) => subKinds(u).includes('silica'));
        const noNa = [...new Set(members.flatMap((u) => [...u.subs].filter(([name, c]) => c === 'glass' && know.noSodium(name)).map(([name]) => name)))];
        // Without the person's answers the app would ask, or find a glass: then the answers decide, and the note rests on them.
        const plainAsks = members.some((u) => [...u.subs.keys()].some((name) => know.plainSub(name) === 'unknown')
          || [...u.mats.values()].some((m) => !materialKnown(m.name)));
        const plainGlass = members.some((u) => [...u.subs.keys()].some((name) => know.plainSub(name) === 'glass')
          || [...u.mats.values()].some((m) => know.plain(m.name).has('glass')));
        note([group], 'stop', 'bond-anodic', plainAsks || plainGlass ? 'yours' : 'general', (who, many) => (silica
          ? `${who}: anodic bonding needs a sodium-containing glass such as Pyrex or Borofloat; fused silica and quartz have no sodium and do not anodic bond.`
          : noNa.length ? `${who}: anodic bonding needs a sodium-containing glass such as Pyrex or Borofloat; ${andList(noNa)} ${noNa.length > 1 ? 'have' : 'has'} no sodium.`
            : `${who} ${agree(many, 'has', 'have')} no glass wafer: anodic bonding joins a sodium-containing glass (such as Pyrex or Borofloat) to silicon.`));
      }
    }
    if (method === 'fusion') {
      const rough = members.filter((u) => u.ids.some((id) => wafers.find((w) => w.id === id)?.spec?.polish === 'none'));
      if (rough.length) note(rough, 'stop', 'bond-polish', 'general', (who, many) => `${who} ${agree(many, 'is', 'are')} unpolished: fusion bonding needs polished, flat surfaces.`);
      // Dirt on the surfaces: metal or another material that is not CMOS-clean, now or before (an etch leaves
      // traces), a tool's mark (an evaporator), or a polymer on it now. A compound semiconductor or lithium niobate
      // wafer is not dirt for a fusion bond.
      const polymer = (/** @type {Unit} */ u, /** @type {boolean} */ plain) => [...u.mats.values()]
        .some((m) => (plain ? know.plain(m.name) : know.classes(m.name)).has('organic'));
      const dirty = members.filter((u) => u.stain || polymer(u, false));
      // Dirt known only from the person's settings (a tool's mark, a material's answer) rests on them.
      const plainDirt = dirty.some((u) => u.stain === 'general' || polymer(u, true));
      const unclean = dirty.some((u) => [...u.mats.values()].some((m) => know.classes(m.name).has('unclean')));
      if (dirty.length) {
        note(dirty, 'caution', 'bond-clean', plainDirt ? 'general' : 'yours', (who, many) => `${who} ${agree(many, 'carries', 'carry')} metal${unclean
          ? ', polymer or another material that is not CMOS-clean' : ' or polymer'}: fusion bonding needs clean surfaces and a high-temperature anneal.`);
      }
      // A wafer the app cannot clear, because it carries a material the app does not know.
      for (const u of members) {
        const names = dirty.includes(u) ? [] : fresh(filmsOf([u]));
        if (names.length) note([u], 'caution', 'bond-unknown', 'general', (who) => `${who}: the app does not know ${andList(names)}; fusion bonding needs clean surfaces, with no metal or polymer.`, names);
      }
    }
    if (p?.bondNote && method && method !== 'adhesive' && method !== 'temporary') {
      const text = p.bondNote;
      note([group], 'caution', 'bond-tool', 'lnf', () => text);
    }
    const stack = joinUnits(members, method, n);
    for (const id of stack.ids) unitOf.set(id, stack);
  }
}

/**
 * @param {Unit[]} members
 * @param {string} method
 * @param {number} n
 * @returns {Unit}
 */
function joinUnits(members, method, n) {
  const mats = new Map();
  for (const u of members) for (const [k, m] of u.mats) mats.set(k, m);
  if (method === 'adhesive' || method === 'temporary') mats.set(ADHESIVE, { name: method === 'adhesive' ? 'Bond adhesive' : 'Temporary bonding adhesive', step: n });
  const level = members.reduce((a, b) => (RANK[b.level] > RANK[a] ? b.level : a), members[0].level);
  // At the worst level, a reason that does not rest on the person's settings comes first, as in lower().
  const atWorst = members.filter((u) => u.level === level);
  const worst = atWorst.find((u) => u.whySrc !== 'yours') || atWorst[0];
  const big = members.map((u) => u.size).filter(Boolean).sort((a, b) => (sizeInfo(b)?.mm || 0) - (sizeInfo(a)?.mm || 0))[0] || null;
  const thick = members.every((u) => u.thick !== null) ? members.reduce((s, u) => s + (u.thick || 0), 0) : null;
  return {
    ids: members.flatMap((u) => u.ids), label: members.map((u) => u.label).join('+'), mask: false, size: big, thick,
    tol: members.reduce((s, u) => s + u.tol, 0), subs: new Map(members.flatMap((u) => [...u.subs])),
    subNames: new Set(members.flatMap((u) => [...u.subNames])), mats,
    level: worst.level, why: worst.why, whyStep: worst.whyStep, whySrc: worst.whySrc, pre: false, wet: null,
    stain: members.reduce((s, u) => stains(s, u.stain), /** @type {Unit['stain']} */ ('')),
    koh: members.find((u) => u.koh && !u.koh.dev)?.koh || members.find((u) => u.koh)?.koh || null,
    members, bondStep: n,
  };
}

/**
 * Separate a stack: each wafer goes on as it was bonded, less what came off
 * the stack meanwhile (a strip while mounted), with what the stack picked up
 * from the bond on (the adhesive, later films) and the stack's cleanliness
 * when that is worse.
 * @param {Unit} stack
 * @param {Map<string, Unit>} unitOf
 */
function split(stack, unitOf) {
  const bonded = stack.bondStep || 0;
  for (const m of stack.members || []) {
    const mats = new Map([...m.mats].filter(([k]) => stack.mats.has(k)));
    for (const [k, x] of stack.mats) if (x.step >= bonded) mats.set(k, x);
    // The stack's reason when it is worse, or as bad and not resting on the person's settings while the wafer's
    // own does (as lower() does for one wafer).
    const take = RANK[stack.level] > RANK[m.level] || (stack.level === m.level && m.whySrc === 'yours' && stack.whySrc !== 'yours');
    // Worse because of a step on the stack: that step is the reason. Worse because of another wafer's past
    // (its metal): the bond is, as that metal is not on this wafer.
    const onStack = stack.whyStep >= bonded;
    /** @type {Why | null} */
    const why = !take ? m.why : onStack ? stack.why : { verb: 'has been in', rest: `the stack ${stack.label} (bonded at step ${bonded})` };
    /** @type {Unit} */
    const back = {
      ...m, mats, level: take ? stack.level : m.level, why, whyStep: !take ? m.whyStep : onStack ? stack.whyStep : bonded,
      // That a bonded partner passes its state on is general practice, whatever marked the partner.
      whySrc: !take ? m.whySrc : onStack ? stack.whySrc : weaker(stack.whySrc, 'general'), koh: stack.koh, wet: stack.wet, pre: false,
      stain: stains(m.stain, stack.stain),
    };
    for (const id of back.ids) unitOf.set(id, back);
  }
}

/**
 * @typedef {Object} Raw a note before notes about several wafers are joined
 * @property {Note['severity']} severity
 * @property {string} code
 * @property {Source} source
 * @property {Unit[]} units
 * @property {(who: string, many: boolean) => string} make the text, given the wafers' labels
 * @property {string[]} [materials] names the app does not know (in the text, so joined notes share them)
 */

/**
 * One note per problem and step: notes whose text differs only in the
 * wafers they name become one note that names them all ("W1 and W2 are
 * 150 mm; …"). A stack is one thing ("W1+G1 is …").
 * @param {string} stepId
 * @param {Raw[]} found
 * @returns {Note[]}
 */
function merge(stepId, found) {
  /** @type {Map<string, Raw>} */
  const groups = new Map();
  for (const x of found) {
    const key = `${x.severity}|${x.code}|${x.source}|${x.make('\u0000', false)}`;
    const prev = groups.get(key);
    if (prev) prev.units = [...new Set([...prev.units, ...x.units])];
    else groups.set(key, { ...x, units: [...x.units] });
  }
  return [...groups.values()].map((g) => {
    const waferIds = [...new Set(g.units.flatMap((u) => u.ids))];
    return {
      stepId, severity: g.severity, code: g.code, source: g.source, waferIds, key: noteKey({ code: g.code, severity: g.severity, waferIds }),
      text: g.make(andList(g.units.map((u) => u.label)), g.units.length > 1),
      ...(g.materials ? { materials: [...g.materials] } : {}),
    };
  });
}

/**
 * The counts for a summary line: "1 problem and 2 things to check".
 * @param {Note[]} notes
 * @returns {{stops: number, cautions: number}}
 */
export function noteCounts(notes) {
  return { stops: notes.filter((x) => x.severity === 'stop').length, cautions: notes.filter((x) => x.severity === 'caution').length };
}
