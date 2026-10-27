// @ts-check
/**
 * What LNF tools take, for the plan's compatibility checks. The facts come
 * from the LNF wiki's recipe and process pages as already shipped with the
 * app (lnf-recipes-*.js, read by hand on 2026-10-21 with the project
 * owner's agreement); `note` quotes the text each entry rests on. Nothing
 * here is fetched, and nothing is invented: a tool without an entry has no
 * LNF facts, so its steps get only the checks that follow the wafer (KOH not
 * yet cleaned off, mask plates against the wafers, the bond rules) and, for
 * the LNF's wet benches, PFC Bench 01's rule on where wafers come from.
 * General practice (TYPE_COMPAT) adds only that a step on an evaporator,
 * sputter or plating tool leaves a wafer metal-contaminated, even for a
 * dielectric. The person can change the sizes, pieces, thickness, mask
 * plates and materials per tool (Settings → Tools → a tool → Compatibility).
 */
import { LNF_TOOLS } from './seed-lnf.js';
import { mergeProfile } from '../core/compat.js';

/** @typedef {import('../core/compat.js').Profile} Profile */
/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {Partial<Profile> & {note: string, byTemplate?: Record<string, Partial<Profile>>}} LnfFacts */

const TUBE = 'PFC Bench 01: its RCA clean is "required before any CMOS-clean furnace (S1-S5 tubes except the S1/T1 sintering tube)."';
/** A CMOS-clean Tempress tube. @param {string[] | null} sizes @param {string} note @returns {LnfFacts} */
const tube = (sizes, note) => ({ ...(sizes ? { sizes } : {}), substrates: ['silicon'], accepts: 'clean', needsPreclean: true, note: `${note} ${TUBE}` });
const ACID_02 = 'dd696ccc-04a0-4395-9ac3-732231fba65c';
const RCA_81 = 'a559f066-3811-469d-a0f0-b08a26d1baf8';
const PFC_01 = 'ff0c929c-9d8d-4cce-b327-dc92429353fa';
const KOH_TEXT = 'KOH-exposed samples are not allowed in the cleanroom until cleaned with Piranha and SC2 ionic clean in Acid Bench 92 and an RCA clean (SC1+SC2) in RCA Bench 81, plus an RCA clean in PFC Bench 01 if the next step is a furnace.';

/** LNF facts by tool id. @type {Readonly<Record<string, LnfFacts>>} */
export const LNF_COMPAT = Object.freeze({
  // Tempress furnace tubes.
  '1fc474be-ce5e-4992-be04-a4ecc4be95c9': { substrates: ['silicon'], note: 'Tempress S1T1 (the sintering tube): "Silicon wafers only." It is not one of the CMOS-clean tubes that need the PFC clean.' },
  'dd2f69e4-615a-4fd3-a293-ea0f8e8c14d4': tube(['100mm'], 'S1T2 LTO: up to 25 RCA-cleaned 100 mm silicon wafers.'),
  'a944055d-eeec-4ace-86f4-cb8117906c1a': tube(['150mm'], 'S1T3 N-type poly: silicon wafers only (up to 25 × 150 mm) after the RCA pre-furnace clean.'),
  '568d1ff5-12ef-44b2-bc96-3ec9a3682f23': tube(['150mm'], 'S1T4 LTO: 150 mm Si wafers.'),
  'a5f01725-ebab-4071-ba55-62ffe1b531c3': {
    sizes: ['100mm', '150mm'], accepts: 'clean', needsPreclean: true, keepsPreclean: true,
    note: 'S2T1 Storage: "Only samples that have gone through the RCA pre-furnace clean may be loaded, up to 25 wafers (100 mm at 525 um or 150 mm at 675 um thick)." It holds them until their next clean furnace run.',
  },
  '3b16231c-e5f9-4b25-b804-3e6c96a36e93': tube(['100mm'], 'S2T2 Nitride-HTO 4": deposits on 100 mm Si wafers.'),
  '780732b9-cdd4-4fd0-8d2d-db60aaa0a988': tube(['150mm'], 'S2T3 Nitride-HTO 6": "150 mm silicon wafers only, RCA pre-furnace cleaned."'),
  '121dd7a6-2e03-41c6-8258-5a30c717b8ac': tube(null, 'S3T1 Dry Oxide: "Silicon wafers only, RCA pre-furnace cleaned."'),
  'fc51e5eb-912f-4a19-9a4c-52abe838c756': tube(null, 'S3T2 Wet Oxide: "Silicon wafers only, RCA pre-furnace cleaned."'),
  'fe85ba2c-118f-42b2-899f-198fbee3593b': tube(['100mm'], 'S3T3 Flat Poly-Si 4": 100 mm Si wafers; wafers must go through the RCA pre-furnace clean.'),
  '0271d547-b6b3-4aab-a4d7-ad9ba4802bf4': tube(['100mm'], 'S3T4 N-type poly 4": up to 25 RCA-cleaned 100 mm silicon wafers.'),
  '30dad1b4-630f-4a49-9b2d-0741f1c2f4f5': tube(['150mm'], 'S4T3 Flat Poly 6": silicon wafers only (up to 25 × 150 mm) after the RCA pre-furnace clean.'),
  'f092d788-6433-43ff-95ad-36cc032d8a7e': tube(['100mm'], 'S4T4 TEOS 4": on 100 mm Si wafers.'),
  '7eda0939-8086-4158-974d-53410a438a84': tube(['100mm', '150mm'], 'S5T1 Phosphorous Diffusion: silicon only, up to 25 × 100 mm and/or 150 mm wafers after the RCA pre-furnace clean.'),
  '06c34507-81ba-4769-a868-6a6cd1b68c6f': tube(['100mm', '150mm'], 'S5T2 Phosphorous Anneal Oxidation: silicon only, up to 25 wafers, 100 mm (525 µm thick) and/or 150 mm (675 µm thick); all samples must go through the RCA pre-furnace clean first.'),
  'c0968849-c307-4fac-928d-7b3ae7dfda83': tube(['100mm'], 'S5T3 Boron Diffusion 4": boron diffusion into 100 mm Si wafers.'),
  '44e65af5-f962-4ca1-bda0-84f813929fe7': tube(null, 'S5T4 Boron Anneal Oxidation: "Silicon wafers only"; "RCA pre-furnace clean required."'),
  'ba10e8cf-d04d-4779-9a4f-f77b82174a8d': {
    sizes: ['100mm'], substrates: ['silicon'], marks: 'metals', marksWhy: 'the Metals-class tube',
    note: 'Tempress S6T1: up to 25 silicon 100 mm wafers in the Metals-class tube.',
  },
  // Wet benches.
  [PFC_01]: {
    accepts: 'clean', restores: true, precleans: true, excludes: ['noble', 'metal', 'organic', 'glass'], cautions: ['silica'],
    cautionText: 'the PFC bench takes fused silica only with staff approval.',
    // Its own clean counts too: a wafer cleaned here, then in a furnace, comes back for its next clean.
    wetFrom: [ACID_02, RCA_81, PFC_01], wetText: 'the PFC bench takes no wafers from wet benches other than Acid 02 or RCA 81',
    note: 'PFC Bench 01: "CMOS-clean materials only: no metals, photoresist or glass (fused silica only with staff approval), and no wafers from wet benches other than Acid 02 or RCA 81." Its three-stage RCA clean is required before any CMOS-clean furnace.',
  },
  [RCA_81]: {
    restores: true, kohSafe: true, kohStage: 'rca', substrates: ['silicon', 'silica', 'glass'], excludes: ['noble', 'metal', 'compound', 'organic'],
    askSizes: ['150mm'], askText: 'RCA Bench 81 is built for 4 in wafers, and 6 in wafers need a helpdesk ticket', pieces: 'ask',
    note: 'RCA Bench 81: "Only Si, fused silica and glass are allowed (no metals, compound semiconductors, photoresists or other polymers)"; "the bench is built for 4" wafers, and 6" wafers or pieces need a helpdesk ticket." Its RCA clean removes organic and ionic contaminants from samples that are not CMOS-clean.',
  },
  [ACID_02]: {
    accepts: 'clean', substrates: ['silicon'], sizes: ['100mm', '150mm'],
    note: 'Acid Bench 02: "CMOS-clean silicon wafers only (4" and 6")."',
  },
  '6351c2c1-5185-42cd-9f9d-593f94a67e78': { note: 'Acid Bench 12: for non-CMOS-clean substrates. The PFC bench takes no wafer whose last wet bench was this one.' },
  '47e2985c-7368-4479-a81e-177998a78616': { note: 'Acid Bench 73: for silicon substrates that have been in non-CMOS-clean tools. The PFC bench takes no wafer whose last wet bench was this one.' },
  '1fd27166-0706-4a40-bf11-6a0593d38fe8': {
    kohSafe: true, kohStage: 'piranha',
    note: 'Acid Bench 92: "wafers going into furnaces or other CMOS-clean tools should not otherwise be processed in Acid Bench 92." Its Piranha and SC2 clean is the first step for KOH-exposed samples.',
  },
  '2c7b5a46-cb4f-4ab9-9c28-837459956211': { kohSafe: true, koh: KOH_TEXT, note: `Base Bench 91: "Wafers going into furnaces or other CMOS-clean tools should not be processed at this bench." For KOH: "${KOH_TEXT}"` },
  // Its KOH is a developer (AZ 400K): its own note keeps the wafers out of the clean and semi-clean tools only.
  // It is not one of the KOH cleaning benches, so a KOH etch not yet cleaned off is still stopped here.
  '216dc749-941b-45bb-9f2f-e2e02df3cf3a': { kohDev: 'KOH is not compatible with semi-clean or clean tools', note: 'Base Bench 63: "KOH is not compatible with semi-clean or clean tools"; TMAH "is CMOS compatible (samples may go into clean and semi-clean tools)."' },
  '2148af73-7c1c-44f8-85ff-83c10b92c89c': { marks: 'metals', marksWhy: 'a non-CMOS solvent bench', note: 'Solvent Bench 83: "Samples processed at this non-CMOS bench may not go into furnaces or semi-clean tools."' },
  'b756c55a-17cd-4dd6-8dcd-11b913fafdf7': {
    marks: 'metals', marksWhy: 'a metals-class bench', pieces: 'yes', maxDiameterMm: 150,
    note: 'E-Beam Solvent Bench 22: a non-CMOS-clean, metals-class bench for piece parts to 6" wafers; "Do not process wafers that are going into furnaces or other CMOS-clean tools here."',
  },
  '5d88b4ab-15be-4244-ab84-7a37666d9699': { pieces: 'yes', note: 'EDP Bench 93: "6" and 4" wafers and pieces can be processed" (a user process note).' },
  // Etch and deposition.
  '710b60bb-dd31-4b24-af52-fdb308ff01b9': { accepts: 'clean', note: 'P5000 RIE Chamber C: "CMOS Clean samples" only.' },
  '37c0a294-7640-47a1-86a5-cef6b0e0cfaa': {
    sizes: ['150mm'], carrier: '150mm', pieces: 'carrier',
    note: 'P5000 PECVD: "Pieces and 100 mm wafers go on the a-Si carrier wafer, which must be stripped by 2 µm accumulation." The LNF store sells 6" a-Si and standard carrier wafers for it.',
  },
  '60fa5897-41ec-4082-9089-2b1c15f1af08': {
    sizes: ['150mm'], carrier: '150mm', pieces: 'carrier',
    note: 'RIE KLA SPTS Synapse: "Samples smaller than 150 mm, non-conducting, or thinner than 100 um before or after etch must be mounted on a 150 mm carrier wafer."',
  },
  '477d965c-3402-46cb-b733-eac37c52b991': {
    pieces: 'no', piecesHint: 'samples that need a carrier go on a 150 mm wafer in the STS Pegasus 6',
    note: 'STS Pegasus 4: "Samples that need a carrier must be mounted on a 150 mm wafer and run in the STS Pegasus 6."',
  },
  '4e8b6ffd-f639-425b-97ea-a602ea90b752': {
    carrier: '150mm', pieces: 'carrier',
    note: 'STS Pegasus 6: "Samples that need a carrier must be mounted on a 150 mm wafer and run in the STS Pegasus 6."',
  },
  '38ec44e8-16bf-46b6-b492-a7993291dc7f': {
    note: 'Plasmatherm 790: in the right (PECVD) chamber, "Polymers such as photoresist are not allowed in the PECVD chamber unless their melting temperature is well above the process temperature (helpdesk ticket)."',
    byTemplate: {
      '6119e6b6-53b2-4b07-822f-3d00980c5cb0': {
        cautions: ['organic'],
        cautionText: 'polymers such as photoresist are not allowed in the 790\'s PECVD chamber unless their melting temperature is well above the process temperature (helpdesk ticket).',
      },
    },
  },
  '2c30aab1-ad83-40bb-ad26-bc2f4c762e1a': { pieces: 'yes', maxDiameterMm: 150, maxThicknessUm: 4000, note: 'Lab 18-2: "for pieces up to 150 mm (6") wafers up to 4 mm thick."' },
  '6b2e074f-d1c9-4f2e-8b6e-e3e06fae7ee2': { pieces: 'yes', maxDiameterMm: 150, note: 'PVD 75 Proline: "on pieces or wafers up to 150 mm."' },
  '346db55a-47fa-4794-b1da-c73705955a81': { pieces: 'yes', note: 'Cooke Evaporator: "suited to lift-off on pieces and 2–4" wafers."' },
  '4881e7f3-f668-4849-989a-ee0ee6069730': {
    sizes: ['100mm', '150mm'], excludes: ['organic'],
    note: 'Endeavor M1 AlN: "on 4-inch or 6-inch wafers"; "the wafer heats to ~500°C or more, so no organics or low-temperature films."',
  },
  'e8280618-9f71-415f-83f5-d5910d7ed4c2': {
    askSizes: ['150mm'], askText: '6 in wafers need additional configuration by LNF staff on Gold Plating',
    note: 'Gold Plating: "6" wafers need additional configuration by LNF staff."',
  },
  'b367fc05-163c-4e43-92d1-3a8ae2b32b5f': {
    pieces: 'yes', maxDiameterMm: 300, maxThicknessUm: 3000,
    note: 'NP12 nanoPREP: "The tool takes 10 mm pieces up to 300 mm wafers and is Restricted class, so only approved materials are allowed"; samples at most 3 mm.',
  },
  // Lithography.
  'd7e61157-0dfd-46a5-89c4-d8af8372a6ab': { sizes: ['100mm', '150mm'], pieces: 'no', minThicknessUm: 200, maxThicknessUm: 1000, note: 'TEL Mark Vz Coater: "4" or 6" wafers only (200-1000 µm thick, no through holes or backside resist)."' },
  '5eb7a9cb-9ca2-4a9f-80d0-b874424736e3': { sizes: ['100mm', '150mm', '200mm'], pieces: 'ask', note: 'Spinner CEE Apogee ROBIN: "Wafers only (4", 6" or 8"; pieces need a ticket)."' },
  '1ab3bbce-9122-450f-8d5e-cb7746229459': { sizes: ['100mm', '150mm'], pieces: 'yes', note: 'CEE 200X spinner 1: spin coats on "pieces or 100/150 mm wafers."' },
  '3da5adda-c817-4339-9196-ce5ea12e554f': { sizes: ['100mm', '150mm'], pieces: 'yes', note: 'CEE 200X spinner 2: spin coats on "pieces or 100/150 mm wafers."' },
  '2a35e513-6073-4205-ba6b-891d24d087dc': { sizes: ['100mm', '150mm'], pieces: 'yes', masks: ['plate5'], note: 'CEE Developer 1: develops "pieces, 100 mm and 150 mm wafers", and 5-inch mask plates from the Heidelberg mask maker.' },
  '6cae81c9-38b9-4459-80c1-fc5ac8c65118': { sizes: ['100mm', '150mm'], pieces: 'yes', masks: ['plate5'], note: 'CEE Developer 2: develops "pieces, 100 mm or 150 mm wafers", and 5" mask plates from the Heidelberg Mask Maker.' },
  '353b8e89-6133-4553-adf4-4940fe75d11b': { masks: ['plate4', 'plate5'], note: 'Heidelberg µPG 501: exposes "LNF-store photomask blanks (4" or 5" soda lime glass, 90 mil thick, low-reflectance chromium with 400 nm AZ1518 photoresist)."' },
  'ec58d4ab-83dd-4e25-a5f7-fcd51c9e991a': { masks: ['plate4', 'plate5', 'plate7'], note: 'Mask Bench 13: chrome etch of "photomask plates (4", 5" or 7")."' },
  // Other.
  '16cb1f1d-5233-480c-9db9-fb34d78ca770': { sizes: ['100mm', '150mm'], pieces: 'carrier', note: 'CMP Strasbaugh 6EC: 4-inch and 6-inch recipes; "Mount pieces on a 4-inch or 6-inch carrier wafer."' },
  'ab5e923e-16a5-4751-8b21-9e8cb06f819b': {
    sizes: ['100mm', '150mm'], pieces: 'carrier', masks: ['plate5', 'plate7'],
    note: 'SSEC Wafer and Mask Cleaner: 4" and 6" wafers, 5" and 7" masks; "pieces must be mounted on a wafer without exposed mounting wax."',
  },
  'dfbb57ba-7a26-47e6-b2cb-a34ff7da820d': {
    marks: 'metals', marksWhy: 'diced samples count as metal-contaminated', maxThicknessUm: 2000,
    note: 'ADT 7100 Dicing Saw: "Diced samples count as metal-contaminated: SPR-220-protect both sides, then strip and Piranha/RCA clean before other cleanroom tools"; total stack thickness max 2 mm.',
  },
  '783b84e4-bcd9-4f25-b38a-976844bf52b2': {
    bondNote: 'The LNF wiki recommends the EVG 520IS for non-polymer bonds, because polymer bonding in the EVG 510 can leave contaminants.',
    note: 'EVG 510: "The wiki recommends the EVG 520IS for non-polymer bonds because polymer bonding in the EVG 510 can leave contaminants."',
  },
});

/**
 * General practice by LNF tool type: a step on an evaporator, sputter or plating tool leaves wafers
 * metal-contaminated, even for a dielectric (the chamber or bath holds metal).
 * @type {Readonly<Record<string, Partial<Profile>>>}
 */
export const TYPE_COMPAT = Object.freeze({
  'ebeam-evaporation': { marks: 'metals', marksWhy: 'an evaporator' },
  'thermal-evaporation': { marks: 'metals', marksWhy: 'an evaporator' },
  sputter: { marks: 'metals', marksWhy: 'a sputter tool' },
  electroplating: { marks: 'metals', marksWhy: 'a plating tool' },
});

const TYPE_OF = new Map(LNF_TOOLS.map(([id, , , type]) => [id, type]));
/** The LNF tool types that are wet benches (acid, base, RCA, solvent and wet-etch benches). */
const WET_TYPES = new Set(['wet-bench', 'wet-etch', 'solvent-clean']);

/**
 * @param {string} toolId
 * @returns {string} the tool's LNF type ("lpcvd", "wafer-bonder"), or "" for a tool the person added
 */
export function lnfType(toolId) {
  return TYPE_OF.get(toolId) || '';
}

/**
 * The LNF facts for a tool (with its template's, when a step uses one), or null.
 * @param {string} toolId
 * @param {string | null} [templateId]
 * @returns {LnfFacts | null}
 */
export function lnfFacts(toolId, templateId = null) {
  const f = LNF_COMPAT[toolId];
  if (!f) return null;
  const t = templateId && f.byTemplate ? f.byTemplate[templateId] : null;
  return t ? { ...f, ...t } : f;
}

/**
 * A tool's profile for a step: general practice for its kind, the LNF
 * notes, then the person's settings on the tool.
 * @param {Tool} tool
 * @param {string | null} [templateId]
 * @returns {Profile}
 */
export function toolProfile(tool, templateId = null) {
  const facts = lnfFacts(tool.id, templateId);
  /** @type {Partial<Profile> | null} */
  let lnf = WET_TYPES.has(lnfType(tool.id)) ? { wetBench: true } : null;
  if (facts) {
    const { note, byTemplate, ...rest } = facts;
    lnf = { ...(lnf || {}), ...rest };
  }
  return mergeProfile({ general: TYPE_COMPAT[lnfType(tool.id)] || null, lnf, yours: tool.compat || null });
}
