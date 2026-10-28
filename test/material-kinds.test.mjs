// @ts-check
// Materials the app does not know (1.5.1): which names the checks know, the
// notes they raise where a rule could apply, the person's answers about
// materials (Settings → Materials, "What is it?"), which only fill in what the
// app does not know, and how those answers travel in backups and sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  materialClasses, materialKnown, substrateClass, substrateKnown, kindOf, saidByPerson, materialReading, unknownParts, isNothing, noSodium,
  MATERIAL_KINDS, MATERIAL_KIND_LABELS, WAFER_KINDS, WAFER_KIND_LABELS,
} from '../app/js/core/wafer-spec.js';
import { SOURCE_TEXT } from '../app/js/core/compat.js';
import { planChecksWith, recipeAdds } from '../app/js/data/plan-checks.js';
import { cleanKinds, mergeKinds, planImport, exportableSettings } from '../app/js/data/export-import.js';
import { describeResult } from '../app/js/sync/plan.js';
import { LNF_TOOLS, LNF_MATERIALS } from '../app/js/data/seed-lnf.js';
import { LNF_STORE } from '../app/js/data/lnf-store.js';
import { RECIPES as ETCH } from '../app/js/data/lnf-recipes-etch.js';
import { RECIPES as DEP } from '../app/js/data/lnf-recipes-dep.js';
import { RECIPES as OTHER } from '../app/js/data/lnf-recipes-other.js';
import { SCHEMA_VERSION } from '../app/js/data/schema.js';

const RECIPES = /** @type {any[]} */ ([...ETCH, ...DEP, ...OTHER]);
/** LNF tool ids by name. */
const ID = Object.fromEntries(LNF_TOOLS.map(([id, , name]) => [name, id]));
const tools = LNF_TOOLS.map(([id, , name]) => (/** @type {any} */ ({ id, name, shortName: '', category: 'other', kind: 'process' })));
/** @param {string} label @param {Record<string, any>} [spec] @returns {any} */
const wafer = (label, spec) => ({ id: `id-${label}`, label, status: 'active', notes: '', ...(spec ? { spec } : {}) });
let n = 0;
/** @param {string} toolName @param {Record<string, any>} [extra] @returns {any} */
const step = (toolName, extra = {}) => ({
  id: `k${++n}`, title: extra.title || toolName, toolId: toolName ? ID[toolName] : null, templateId: null, recipe: '', notes: '',
  doneAt: null, skipped: false, ...extra,
});
/** @param {any[]} wafers @param {any[]} steps @param {any} [kinds] */
const run = (wafers, steps, kinds = null) => planChecksWith({ wafers, steps }, tools, [], RECIPES, kinds);
/** @param {Record<string, string>} o name → kind @param {string} [at] @returns {any} what the person said materials are */
const said = (o, at = '2026-10-27T10:00:00.000Z') => Object.fromEntries(Object.entries(o).map(([name, kind]) => [name.toLowerCase(), { name, kind, at }]));
/** @param {{byStep: Map<string, any[]>}} r @param {any} s @returns {any[]} [code, severity, source] of each note of a step */
const notesOf = (r, s) => (r.byStep.get(s.id) || []).map((x) => [x.code, x.severity, x.source]);
/** @param {{byStep: Map<string, any[]>}} r @param {any} s @returns {string[]} */
const textsOf = (r, s) => (r.byStep.get(s.id) || []).map((x) => x.text);
/** @param {string} m @returns {string[]} */
const cls = (m, /** @type {any} */ kinds = null) => [...materialClasses(m, kinds)].sort();
const SI = { material: 'Si', size: '100mm' };
const PFC = 'PFC Bench 01';
const TUBE = 'Tempress S3T1 - Dry Oxide';
const RCA = 'RCA Bench 81';
/** @param {string} label @param {string} material @returns {any} a Si wafer with one film */
const filmed = (label, material) => wafer(label, { ...SI, films: [{ material, thicknessNm: 100 }] });

test('every material the app ships is one the checks know, except selenium, which they leave to the person', () => {
  assert.deepEqual(LNF_MATERIALS.filter((m) => !materialKnown(m)), ['Se']);
  // Every film a plan step's LNF recipe can leave on the wafers.
  const toolMap = new Map(tools.map((t) => [t.id, t]));
  const added = new Set(RECIPES.flatMap((r) => recipeAdds(step('', { toolId: r.tool, recipe: r.name }), toolMap, new Map(), RECIPES)));
  assert.ok(added.size > 40);
  assert.deepEqual([...added].filter((m) => !materialKnown(m)), []);
  // The LNF store's wafers and their films.
  for (const x of LNF_STORE) for (const m of [x.spec.material, ...(x.spec.films || []).map((/** @type {any} */ f) => f.material)]) assert.ok(materialKnown(m), m);
});

test('known names: every word must be a material or say how, how much or where; one familiar word hides nothing', () => {
  for (const m of ['SiO2 (thermal)', 'Thermal oxide', 'Native oxide', 'Poly-Si (n-doped)', 'a-Si', 'Poly', 'In situ doped poly', 'HfO2',
    'Hafnium oxide', 'Graphene', 'HMDS', 'Ti/Pt/Au', 'Kapton (polyimide)', 'Teflon', 'Ru', 'Cr/AZ 1518', 'FZ Si', 'p+ Si', 'n+ poly-Si',
    'Si, p-type', 'Si, <100>', 'Ti/Au 10/100 nm', 'AZ1518, 400 nm', 'Al/Si 99/1', 'Sapphire C-plane', 'LiNbO3 128 Y-cut', 'GaN on Si',
    'Sb-doped Si', 'E-beam Ti', 'Au seed', 'Low-stress SiNx', 'Fluorocarbon', '']) {
    assert.equal(materialKnown(m), true, m);
  }
  for (const m of ['PZT', 'Ti/PZT', 'Foo/Si', 'PZT on Si', 'Amorphous selenium', 'Unobtainium oxide', 'Se', 'Eagle XG', 'Kovar']) {
    assert.equal(materialKnown(m), false, m);
  }
  assert.deepEqual(cls('Na'), ['noble'], 'sodium, a mobile ion');
  // A name that says there is nothing is no material, and nothing about it throws.
  for (const m of ['-', '–', '--', 'n/a', 'None', 'Ti/-', 'Ti, -', '- (none)']) {
    assert.doesNotThrow(() => { materialClasses(m); substrateClass(m); materialKnown(m); substrateKnown(m); materialReading(m); unknownParts(m); }, m);
  }
  assert.equal(isNothing('-'), true);
  assert.equal(isNothing('n/a'), true);
  assert.deepEqual(cls('Ti/-'), ['metal']);
  assert.deepEqual(unknownParts('Ti/PZT'), ['PZT'], 'ask about the part the app does not know');
  assert.deepEqual(unknownParts('Zeonor (COC)'), ['Zeonor', 'COC'], 'what is in brackets is asked about too');
  assert.deepEqual(unknownParts('Evaporated Se'), ['Se'], 'only the word the app does not know');
  assert.deepEqual(unknownParts('PZT/Pt/PZT'), ['PZT'], 'once');
  assert.deepEqual(unknownParts('Ti/Au'), []);
});

test('classes: dopants, spelled-out compounds and polymers, doped glasses, and what 1.5.0 already read', () => {
  assert.deepEqual(cls('Sb-doped Si'), [], 'a dopant is not a film');
  assert.deepEqual(cls('Antimony-doped silicon'), []);
  assert.deepEqual(cls('Er-doped glass'), ['glass', 'metal'], 'erbium is a metal, however it got there');
  assert.deepEqual(cls('Sb'), ['metal'], 'on its own, antimony is a film');
  assert.deepEqual(cls('Gallium nitride'), ['compound'], 'as GaN is');
  assert.deepEqual(cls('Indium phosphide'), ['compound'], 'as InP is');
  assert.deepEqual(cls('Indium tin oxide'), ['noble'], 'ITO stays a fast-diffusing metal oxide');
  assert.deepEqual(cls('Gallium'), ['metal']);
  assert.deepEqual(cls('Poly(methyl methacrylate)'), ['organic'], 'as PMMA is');
  assert.deepEqual(cls('Polyvinylidene fluoride'), ['organic']);
  assert.deepEqual(cls('Polysilicon'), []);
  assert.deepEqual(cls('Magnesium fluoride'), ['metal'], 'as in 1.5.0');
  assert.deepEqual(cls('Hafnium silicate'), [], 'a dielectric written out, as in 1.5.0');
  assert.deepEqual(cls('Yttrium-stabilized zirconia'), []);
  assert.deepEqual(cls('Fluorocarbon'), [], 'as in 1.5.0');
  for (const m of ['Phosphosilicate glass', 'Spin-on glass', 'Spin on glass', 'Phosphorus silicate glass', 'Borophosphosilicate glass']) assert.deepEqual(cls(m), [], m);
  assert.deepEqual(cls('Cr/AZ 1518'), ['metal', 'organic'], 'each material of a list says its own kind');
  assert.deepEqual(cls('AlCu'), ['noble']);
  assert.equal(substrateClass('Silicon dioxide'), 'other', 'as SiO2 is, not silicon');
  assert.equal(substrateClass('Si/SiO2'), 'silicon');
});

test('answers fill in only what the app does not know, and never take away what it reads', () => {
  const kinds = { ...said({ PZT: 'metal', D263: 'glass', Goo: '', Zap: 'plasma' }) };
  assert.equal(kindOf('pzt', kinds), 'metal');
  assert.equal(kindOf('Goo', kinds), null, 'taken back');
  assert.equal(kindOf('Zap', kinds), null, 'a kind this version does not know');
  assert.deepEqual(cls('PZT', kinds), ['metal']);
  assert.deepEqual(cls('Ti/PZT', kinds), ['metal'], 'the answer for the part');
  assert.equal(materialKnown('Ti/PZT', kinds), true);
  assert.equal(materialKnown('Goo', kinds), false);
  assert.equal(substrateClass('D263', kinds), 'glass');
  assert.equal(substrateClass('D263 (Schott)', kinds), 'glass', 'the answer for the material in the name');
  // An answer for a name with a material the app knows adds to it: Ti stays a metal.
  assert.deepEqual(cls('Ti/PZT', said({ 'Ti/PZT': 'dielectric' })), ['metal']);
  assert.deepEqual(cls('Ti/PZT', said({ 'Ti/PZT': 'organic' })), ['metal', 'organic']);
  // An answer about a name the app knows changes nothing it reads.
  assert.deepEqual(cls('Au', said({ Au: 'dielectric' })), ['noble']);
  assert.deepEqual(cls('BCB (cured)', said({ BCB: 'dielectric' })), ['organic']);
  assert.equal(substrateClass('Glass', said({ Glass: 'silicon' })), 'glass');
  // An SiO2 wafer the person said is fused silica: SiO2 wafers change, SiO2 films do not.
  const sio2 = said({ SiO2: 'silica' });
  assert.equal(substrateClass('SiO2', sio2), 'silica');
  assert.equal(substrateKnown('SiO2', sio2), true);
  assert.deepEqual(cls('SiO2 (thermal)', sio2), []);
  assert.deepEqual(cls('SiO2', sio2), []);
  assert.equal(substrateClass('Si/SiO2', sio2), 'silicon');
  assert.equal(saidByPerson('Ti/PZT', kinds), true);
  assert.equal(saidByPerson('Ti', kinds), false);
  assert.equal(saidByPerson('Au', said({ Au: 'dielectric' })), false, 'an answer that changes nothing decides nothing');
  assert.deepEqual(MATERIAL_KINDS.filter((k) => !MATERIAL_KIND_LABELS[k]), []);
  assert.deepEqual(WAFER_KINDS.filter((k) => !WAFER_KIND_LABELS[k]), []);
  assert.deepEqual(materialReading('PZT'), { text: '', known: false, said: false, wafer: '' });
  assert.deepEqual(materialReading('PZT', kinds), { text: 'a metal', known: true, said: true, wafer: '' });
  assert.deepEqual(materialReading('Cr/Au'), { text: 'a fast-diffusing metal and a metal', known: true, said: false, wafer: '' });
  assert.deepEqual(materialReading('SiO2 (thermal)'), { text: 'no rule for it', known: true, said: false, wafer: '' });
  assert.deepEqual(materialReading('SiO2', sio2), { text: 'no rule for it', known: true, said: false, wafer: 'fused silica or quartz' });
  assert.deepEqual(materialReading('Se', said({ Se: 'unclean' })), { text: 'not CMOS-clean', known: true, said: true, wafer: '' });
});

test('substrates: a kind the app knows, a polymer or a metal is known; SiO2 and new names are asked about', () => {
  for (const m of ['Si', 'Glass', 'Sapphire', 'Kapton', 'Ti foil', 'GaAs', 'Sb-doped Si']) assert.equal(substrateKnown(m), true, m);
  for (const m of ['SiO2', 'FZ wafer', 'AF32', 'Graphene', 'Silicon dioxide']) assert.equal(substrateKnown(m), false, m);
  assert.equal(substrateKnown('FZ wafer', said({ 'FZ wafer': 'silicon' })), true);
  assert.equal(substrateKnown('AF32', said({ AF32: 'nosodium' })), true);
  assert.equal(substrateKnown(''), true, 'not set is not unknown');
});

test('a material the app does not know: a Check with the rule where one could apply, asking about the part it does not know', () => {
  const pzt = filmed('W1', 'PZT');
  const pfc = step(PFC);
  const tube = step(TUBE);
  const r = run([pzt], [pfc, tube]);
  const [atPfc] = r.byStep.get(pfc.id) || [];
  assert.equal(atPfc.text, 'W1: the app does not know PZT (as bought); PFC Bench 01 allows no metals, resists and polymers, glass, or anything else that is not CMOS-clean.');
  assert.deepEqual([atPfc.code, atPfc.severity, atPfc.source, atPfc.materials], ['material-unknown', 'caution', 'lnf', ['PZT']]);
  assert.deepEqual(textsOf(r, tube), [`W1: the app does not know PZT (as bought); ${TUBE} takes CMOS-clean wafers only.`]);
  // Said to be a metal, or not CMOS-clean: Not allowed, resting on the person's answer. A dielectric: nothing to say.
  assert.deepEqual(notesOf(run([pzt], [pfc, tube], said({ PZT: 'metal' })), pfc), [['clean', 'stop', 'yours'], ['material', 'stop', 'yours']]);
  const se = run([filmed('W1', 'Se')], [step(RCA), pfc, tube], said({ Se: 'unclean' }));
  assert.deepEqual(se.notes.map((x) => [x.code, x.severity, x.source]),
    [['material', 'stop', 'yours'], ['clean', 'stop', 'yours'], ['material', 'stop', 'yours'], ['clean', 'stop', 'yours']]);
  assert.match(se.notes[1].text, /^W1 came with Se on it: PFC Bench 01 takes CMOS-clean wafers only/);
  assert.equal(SOURCE_TEXT.yours, 'From a setting made in this app.');
  assert.deepEqual(run([pzt], [pfc, tube], said({ PZT: 'dielectric' })).notes, []);
  // A list with a metal the app knows: only the Not allowed, never a second note on the same film.
  const tipzt = run([filmed('W1', 'Ti/PZT')], [step(RCA), step(PFC)]);
  assert.deepEqual(tipzt.notes.map((x) => x.code), ['material', 'clean', 'material']);
  // An answer for the whole list cannot clear the metal.
  assert.deepEqual(run([filmed('W1', 'Ti/PZT')], [step(PFC)], said({ 'Ti/PZT': 'dielectric' })).notes.map((x) => x.code), ['clean', 'material']);
  // The unknown part is what is asked about, named within its film.
  const endeavor = step('Endeavor M1 AlN Sputter Tool');
  const [atEndeavor] = run([filmed('W1', 'Cr/PZT')], [endeavor]).byStep.get(endeavor.id) || [];
  assert.equal(atEndeavor.text, 'W1: the app does not know PZT (in Cr/PZT, as bought); Endeavor M1 AlN Sputter Tool allows no resists and polymers.');
  assert.deepEqual(atEndeavor.materials, ['PZT']);
  // Two wafers with the same film: one note names both.
  const two = run([pzt, filmed('W2', 'PZT')], [step(PFC)]);
  assert.match(two.notes[0].text, /^W1 and W2: the app does not know PZT/);
  // No rule that could apply (an evaporator, an etcher): nothing to say. A "-" says nothing either.
  assert.deepEqual(run([pzt], [step('Cooke Evaporator'), step('LAM 9400')]).notes, []);
  assert.deepEqual(run([filmed('W1', '-')], [step(PFC), step('', { title: 'Coat', adds: ['-', 'n/a'] }), step(TUBE)]).notes.map((x) => x.code), ['preclean']);
  // A wafer already out of the clean tools: the clean rule has said it.
  const p5000 = step('P5000 RIE/Chamber C');
  assert.deepEqual(notesOf(run([wafer('W1', SI)], [step('Cooke Evaporator', { adds: ['Goo'] }), p5000]), p5000), [['clean', 'stop', 'general']]);
  // Descriptors are not materials: "p+ Si" and "Si, p-type" raise nothing new.
  assert.deepEqual(run([wafer('W1', { material: 'p+ Si', size: '100mm' }), wafer('W2', { material: 'Si, p-type', size: '100mm' })], [step(RCA), step(PFC)]).notes, []);
  // A dopant in a name is not metal.
  assert.deepEqual(run([wafer('W1', { material: 'Sb-doped Si', size: '100mm' })], [step(PFC), tube]).notes, []);
});

test('substrates the app does not know: asked where a rule on wafers applies, once; answers count for wafers only', () => {
  const pecvd = step('Plasmatherm 790', { templateId: '6119e6b6-53b2-4b07-822f-3d00980c5cb0' });
  const [n790] = run([wafer('W1', SI)], [step('', { title: 'Coat', adds: ['Goo'] }), pecvd]).byStep.get(pecvd.id) || [];
  assert.match(n790.text, /^W1: the app does not know Goo \(step 1\)\. Polymers such as photoresist are not allowed in the 790's PECVD chamber/);
  const fz = wafer('W1', { material: 'FZ wafer', size: '100mm' });
  const rca = step(RCA);
  const pfc = step(PFC);
  const tube = step(TUBE);
  const r = run([fz], [rca, pfc, tube]);
  assert.deepEqual(textsOf(r, rca), ['W1: RCA Bench 81 takes silicon, fused silica or quartz and glass only, and the app does not know what kind of wafer FZ wafer is.']);
  assert.deepEqual(notesOf(r, pfc), [['material-unknown', 'caution', 'lnf']], 'a material it does not know at all');
  assert.deepEqual(notesOf(r, tube), [['substrate-unknown', 'caution', 'lnf']]);
  assert.deepEqual(run([fz], [rca, pfc, tube], said({ 'FZ wafer': 'silicon' })).notes, []);
  // SiO2, a film the app knows, as a wafer: asked where wafers matter, also at PFC Bench 01 (fused silica, glass).
  const sio2 = wafer('W1', { material: 'SiO2', size: '100mm' });
  const s = run([sio2], [rca, pfc]);
  assert.deepEqual(textsOf(s, pfc), ['W1: the app does not know what kind of wafer SiO2 is; PFC Bench 01 allows no glass, and the PFC bench takes fused silica only with staff approval.']);
  assert.deepEqual(s.notes[0].materials, ['SiO2']);
  // Answered fused silica: RCA Bench 81 takes it, PFC Bench 01 asks for staff approval, and SiO2 films stay as they are.
  const a = run([sio2, filmed('W2', 'SiO2 (thermal)')], [rca, pfc], said({ SiO2: 'silica' }));
  assert.deepEqual(a.notes.map((x) => [x.code, x.severity, x.source, x.waferIds.join()]), [['material', 'caution', 'yours', 'id-W1']]);
  // A polymer wafer is no kind a furnace takes; the person's "something else" is not either, and says so.
  const s1t1 = step('Tempress S1T1 - Annealing');
  assert.deepEqual(textsOf(run([wafer('W1', { material: 'Kapton', size: '100mm' })], [s1t1]), s1t1), ['W1: Tempress S1T1 - Annealing takes silicon only, not Kapton.']);
  assert.deepEqual(notesOf(run([fz], [s1t1], said({ 'FZ wafer': 'dielectric' })), s1t1), [['substrate', 'stop', 'yours']]);
});

test('bonds: anodic needs sodium and asks about what it does not know; fusion asks about films', () => {
  const si = wafer('W1', SI);
  const af32 = wafer('X1', { material: 'AF32', size: '100mm' });
  const anodic = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [si.id, af32.id], method: 'anodic' }] });
  const [ask] = run([si, af32], [anodic]).byStep.get(anodic.id) || [];
  assert.equal(ask.text, 'W1+X1: anodic bonding joins a sodium-containing glass (such as Pyrex or Borofloat) to silicon, and the app does not know what AF32 is.');
  assert.deepEqual(ask.materials, ['AF32']);
  assert.deepEqual(textsOf(run([si, af32], [anodic], said({ AF32: 'nosodium' })), anodic),
    ['W1+X1: anodic bonding needs a sodium-containing glass such as Pyrex or Borofloat; AF32 has no sodium.']);
  assert.deepEqual(notesOf(run([si, af32], [anodic], said({ AF32: 'nosodium' })), anodic), [['bond-anodic', 'stop', 'yours']]);
  assert.deepEqual(run([si, af32], [anodic], said({ AF32: 'glass' })).notes, []);
  // A film the app does not know could be evaporated glass: asked about, not guessed at.
  const goo = filmed('W2', 'Goo');
  const sigoo = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [si.id, goo.id], method: 'anodic' }] });
  assert.deepEqual(notesOf(run([si, goo], [sigoo]), sigoo), [['bond-unknown', 'caution', 'general']]);
  // An answer that agrees with the app decides nothing: the note rests on general practice.
  const sisi = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [si.id, 'id-W3'], method: 'anodic' }] });
  assert.deepEqual(notesOf(run([si, wafer('W3', SI)], [sisi], said({ Si: 'silicon' })), sisi), [['bond-anodic', 'stop', 'general']]);
  const fusion = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [si.id, goo.id], method: 'fusion' }] });
  assert.deepEqual(textsOf(run([si, goo], [fusion]), fusion), ['W2: the app does not know Goo; fusion bonding needs clean surfaces, with no metal or polymer.']);
  assert.deepEqual(notesOf(run([si, goo], [fusion], said({ Goo: 'organic' })), fusion), [['bond-clean', 'caution', 'yours']]);
});

test('a note rests on the person\'s answer only while nothing else makes it', () => {
  // PZT (answered: a metal) and then Au: the Au, general practice, makes the note.
  const w1 = wafer('W1', SI);
  const steps = [step('Oxford OpAL ALD', { adds: ['PZT'] }), step('Cooke Evaporator', { adds: ['Au'] }), step(PFC)];
  const r = run([w1], steps, said({ PZT: 'metal' }));
  assert.deepEqual(notesOf(r, steps[2]), [['clean', 'stop', 'general'], ['material', 'stop', 'lnf']]);
  assert.match(textsOf(r, steps[2])[0], /^W1 carries Au from step 2/);
});

test('recipes: a removal recipe leaves nothing, and a resist the person named counts as the resist', () => {
  const toolMap = new Map(tools.map((t) => [t.id, t]));
  const s5t2 = step('Tempress S5T2 - Phosphorous Anneal Oxidation', { recipe: 'Fluorocarbon Removal' });
  assert.deepEqual(recipeAdds(s5t2, toolMap, new Map(), RECIPES), []);
  const spin = step('CEE 200X photoresist spinner 1', { adds: ['XR-17'] });
  assert.deepEqual(recipeAdds(spin, toolMap, new Map(), RECIPES), ['Photoresist'], 'the app does not know XR-17');
  assert.deepEqual(recipeAdds(spin, toolMap, new Map(), RECIPES, said({ 'XR-17': 'organic' })), [], 'now it does');
  // Said to be a resist, it comes off with a strip like any resist.
  assert.deepEqual(run([wafer('W1', SI)], [spin, step('', { title: 'Strip resist' }), step(RCA)], said({ 'XR-17': 'organic' })).notes, []);
});

test('answers merge by material, the newer winning (a taken-back one too); imports and syncs say how many came in', () => {
  const at = (/** @type {number} */ h) => `2026-10-27T${String(h).padStart(2, '0')}:00:00.000Z`;
  const local = { pzt: { name: 'PZT', kind: 'metal', at: at(10) } };
  assert.equal(mergeKinds(local, { pzt: { name: 'PZT', kind: 'dielectric', at: at(9) } }), null, 'older: nothing changes');
  assert.deepEqual(mergeKinds(local, { x: { name: 'pzt', kind: '', at: at(11) } }), { pzt: { name: 'pzt', kind: '', at: at(11) } }, 'newer, by its own name');
  // The same time: every device keeps the same one.
  const tie = { pzt: { name: 'PZT', kind: 'noble', at: at(10) } };
  assert.deepEqual(mergeKinds(local, tie), tie);
  assert.equal(mergeKinds(tie, local), null);
  assert.deepEqual(cleanKinds({ a: { name: ' Goo ', kind: 'metal', at: at(1) }, b: { name: 'X', kind: 3, at: at(1) }, c: { name: 'Y', kind: 'metal', at: 'later' }, d: 'nope' }),
    { goo: { name: 'Goo', kind: 'metal', at: at(1) } });
  assert.deepEqual(exportableSettings({ materials: ['Si'], materialKinds: local, deviceId: 'secret' }), { materials: ['Si'], materialKinds: local, tuning: {} });
  // A backup's answers: the newer ones come in, and a material whose answer comes in joins the list.
  const backup = {
    format: 'lnf-runlog', version: SCHEMA_VERSION, tools: [], templates: [], runs: [], measurements: [], events: [],
    settings: { materials: ['Si'], materialKinds: { goo: { name: 'Goo', kind: 'organic', at: at(12) }, ...local } },
  };
  const plan = planImport({}, backup, ['Si'], { kinds: local });
  assert.deepEqual(plan.materialKinds, { ...local, goo: { name: 'Goo', kind: 'organic', at: at(12) } });
  assert.equal(plan.answersChanged, 1);
  assert.deepEqual(plan.materials, ['Si', 'Goo']);
  const before = planImport({}, { ...backup, settings: { materials: ['Si'] } }, ['Si'], { kinds: local });
  assert.equal(before.materialKinds, null, 'a backup from before 1.5.1 has no answers');
  assert.equal(before.answersChanged, 0);
  assert.equal(before.materials, null);
  assert.equal(describeResult({ devices: 1, read: 1, added: 0, updated: 0, invalid: 0, answers: 2 }), '1 other device · 0 added, 0 updated · 2 answers about materials');
  // An answer that is newer but says the same is no change.
  const same = planImport({}, { ...backup, settings: { materialKinds: { pzt: { name: 'PZT', kind: 'metal', at: at(13) } } } }, ['Si', 'PZT'], { kinds: local });
  assert.equal(same.answersChanged, 0);
});

test('dopants, element symbols and brackets: what a name says is read, and nothing hides in it', () => {
  // A semiconductor dopant is not a film; a metal is, however it got there; the host of "X doped with Y" stays.
  for (const m of ['B-doped Si', 'Boron-doped Si', 'Si:B', 'Si doped with boron', 'Si, B-doped', 'Phosphorus-doped Si', 'Sb-doped Si']) {
    assert.equal(materialKnown(m), true, m);
    assert.deepEqual(cls(m), [], m);
    assert.equal(substrateClass(m), 'silicon', m);
  }
  assert.deepEqual(cls('Au-doped Si'), ['noble']);
  assert.deepEqual(cls('Si doped with Au'), ['noble']);
  assert.deepEqual(cls('Cu-doped SiO2'), ['noble']);
  assert.deepEqual(cls('GaAs doped with Si'), ['compound']);
  assert.equal(substrateClass('GaAs doped with Si'), 'compound');
  assert.deepEqual(cls('Mg-doped GaN'), ['compound', 'metal'], 'only a silicon dopant is no film');
  // Element symbols that are also words count as elements unless the words around them say otherwise.
  assert.deepEqual(cls('W on Si'), ['metal']);
  assert.deepEqual(cls('In on Si'), ['noble']);
  assert.deepEqual(cls('In situ doped poly'), []);
  assert.deepEqual(cls('III-V oxide'), ['compound'], 'a III-V, and no vanadium');
  assert.deepEqual(cls('Bi-layer resist'), ['organic']);
  assert.deepEqual(cls('LiNbO3 128 Y-cut'), ['alkali']);
  // What is in brackets counts: a metal there is a metal, a material the app does not know is asked about.
  assert.deepEqual(cls('Si (Au-coated)'), ['noble']);
  assert.deepEqual(unknownParts('Si (with PZT)'), ['PZT']);
  assert.deepEqual(cls('Si (Sb)'), [], 'a dopant in brackets');
  // A glass or resist word does not vouch for a name it is in.
  for (const m of ['FTO glass', 'AF32 glass', 'Eagle XG glass', 'CIGS on glass']) assert.equal(materialKnown(m), false, m);
  assert.equal(materialKnown('Alkali-free glass'), true, 'a glass, with no sodium');
  assert.deepEqual(unknownParts('Eagle XG glass'), ['Eagle XG']);
  for (const m of ['Pyrex 7740', 'Borofloat 33', 'AZ P4620', 'AZ 12XT', 'PMGI SF9', 'Positive resist', 'S1800 series', 'Kapton(polyimide)']) {
    assert.equal(materialKnown(m), true, m);
  }
  // Words that say how, how much or what state, written the many ways people write them.
  for (const m of ['Bare Si', 'Polished Si', 'Thermally oxidized Si', 'High-resistivity Si', 'Float-zone Si', 'Si >1000 Ω-cm',
    'Al 1 wt% Si', 'Cr 50Å/Au 1000Å', 'Silicon on insulator', 'Lithium niobate', 'Tungsten silicide', 'Boron nitride']) {
    assert.equal(materialKnown(m), true, m);
  }
  assert.deepEqual(cls('Lithium niobate'), ['alkali']);
  assert.deepEqual(cls('Tungsten silicide'), ['metal']);
  assert.deepEqual(cls('Indium gallium oxide'), ['noble'], 'indium stays');
  assert.deepEqual(cls('Gallium arsenide wafer'), ['compound']);
  assert.deepEqual(cls('Gallium nitride on Si'), ['compound']);
  for (const m of ['Polycide', 'Polysilicide', 'Polyoxide', 'Polygermanium']) assert.ok(!materialClasses(m).has('organic'), m);
  for (const m of ['(none)', '- (none)', '-/-', '– –', '(n/a)', 'N/A']) assert.equal(isNothing(m), true, m);
  // An answer counts for the material wherever it is written with words that only say how.
  const se = said({ Se: 'unclean' });
  for (const m of ['Evaporated Se', 'Amorphous Se', 'Se film', 'Se (evaporated)']) assert.deepEqual(cls(m, se), ['unclean'], m);
});

test('not CMOS-clean: compound semiconductors, lithium niobate and the person\'s answers keep wafers out of CMOS-clean tools', () => {
  const p5000 = step('P5000 RIE/Chamber C');
  assert.deepEqual(notesOf(run([filmed('W1', 'GaAs')], [p5000]), p5000), [['clean', 'stop', 'general']]);
  assert.deepEqual(notesOf(run([wafer('W1', { material: 'LiNbO3', size: '100mm' })], [p5000]), p5000), [['clean', 'stop', 'general']]);
  assert.deepEqual(notesOf(run([filmed('W1', 'Foo')], [p5000], said({ Foo: 'compound' })), p5000), [['clean', 'stop', 'yours']]);
  // A strip does not take a polymer wafer's own material away.
  const pfc = step(PFC);
  assert.deepEqual(notesOf(run([wafer('W1', { material: 'Kapton', size: '100mm' })], [step('', { title: 'Strip resist' }), pfc]), pfc),
    [['material', 'stop', 'lnf']]);
  // A rule the person set is said as it is.
  const mine = tools.map((t) => (t.id === ID['LAM 9400'] ? { ...t, compat: { excludes: ['unclean'] } } : t));
  const lam = step('LAM 9400');
  assert.deepEqual(planChecksWith({ wafers: [filmed('W1', 'Goo')], steps: [lam] }, mine, [], RECIPES).notes.map((x) => x.text),
    ['W1: the app does not know Goo (as bought); LAM 9400 allows no materials that are not CMOS-clean.']);
  const nobleOnly = tools.map((t) => (t.id === ID['LAM 9400'] ? { ...t, compat: { excludes: ['noble'] } } : t));
  assert.match(planChecksWith({ wafers: [filmed('W1', 'Goo')], steps: [lam] }, nobleOnly, [], RECIPES).notes[0].text, /allows no fast-diffusing metals \(gold, copper…\)\.$/);
});

test('bonds and kinds of wafer: one question per material per step, and the right question', () => {
  const si = wafer('W1', SI);
  const sio2 = wafer('Q1', { material: 'SiO2', size: '100mm' });
  const anodic = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [si.id, sio2.id], method: 'anodic' }] });
  assert.deepEqual(textsOf(run([si, sio2], [anodic]), anodic),
    ['W1+Q1: anodic bonding joins a sodium-containing glass (such as Pyrex or Borofloat) to silicon, and the app does not know what kind of wafer SiO2 is.']);
  // PFC Bench 01 asks about a wafer that could be fused silica, not about AlN.
  const pfc = step(PFC);
  assert.deepEqual(run([wafer('A1', { material: 'AlN', size: '100mm' })], [pfc]).notes, []);
  // A bonder with the person's rule on polymers: the film is asked about once.
  const mine = tools.map((t) => (t.id === ID['EVG 520IS'] ? { ...t, compat: { excludes: ['organic'] } } : t));
  const goo = filmed('W2', 'Goo');
  const fusion = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [si.id, goo.id], method: 'fusion' }] });
  assert.deepEqual(planChecksWith({ wafers: [si, goo], steps: [fusion] }, mine, [], RECIPES).notes.map((x) => x.code), ['material-unknown']);
  // A GaAs wafer is no dirt for a fusion bond; a material that is not CMOS-clean is, and is named so.
  const gaas = wafer('G1', { material: 'GaAs', size: '100mm', polish: 'dsp' });
  const f2 = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [si.id, gaas.id], method: 'fusion' }] });
  assert.deepEqual(run([si, gaas], [f2]).notes, []);
  const se = filmed('W3', 'Se');
  const f3 = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [si.id, se.id], method: 'fusion' }] });
  assert.match(textsOf(run([si, se], [f3], said({ Se: 'unclean' })), f3)[0], /carries metal, polymer or another material that is not CMOS-clean/);
  // A stack takes a reason that does not rest on the person's answers when one is there, whatever the order.
  const w2 = wafer('W2', SI);
  const steps = [step('Oxford OpAL ALD', { adds: ['PZT'], waferIds: [si.id] }), step('Cooke Evaporator', { adds: ['Au'], waferIds: [w2.id] }),
    step('Sample mounting station', { bonds: [{ id: 'b', waferIds: [si.id, w2.id], method: 'temporary' }] }), step(PFC)];
  const r = run([si, w2], steps, said({ PZT: 'metal' }));
  assert.deepEqual(notesOf(r, steps[3]).filter(([c]) => c === 'clean'), [['clean', 'stop', 'general']]);
});

test('metal is never lost: a metal dopant, a metal on a named wafer, a metal etched off before a fusion bond', () => {
  assert.deepEqual(cls('Al-doped Si'), ['metal']);
  assert.deepEqual(cls('Si doped with indium'), ['noble']);
  assert.deepEqual(cls('Aluminum on thermal oxide wafer'), ['metal']);
  assert.deepEqual(cls('Titanium on hafnia'), ['metal']);
  // "Poly" with a process in brackets is polysilicon; poly(...) with a chemical inside is a polymer.
  assert.deepEqual(cls('Poly (LPCVD)'), []);
  assert.deepEqual(cls('Poly(methyl methacrylate)'), ['organic']);
  // Letters that are a cut or a unit are no element.
  assert.deepEqual(cls('128 Y-X LiNbO3'), ['alkali']);
  assert.deepEqual(cls('SiO2 (PECVD, 100 W)'), []);
  // The sodium in a glass's name is the glass's own; an alkali-free glass has none.
  assert.deepEqual(cls('Sodium glass'), ['glass']);
  assert.equal(noSodium('Alkali-free glass'), true);
  assert.equal(noSodium('Pyrex 7740'), false);
  // Names people use for what the app knows are known whole.
  for (const m of ['Gate oxide', 'a-Si:H', 'Spin-on glass', 'Soda lime glass', 'Bond adhesive', 'Temporary bonding adhesive']) {
    assert.equal(materialKnown(m), true, m);
  }
  // Lithium niobate is not allowed at the RCA bench.
  const rca = step(RCA);
  assert.deepEqual(notesOf(run([filmed('W1', 'LiNbO3')], [rca]), rca), [['material', 'stop', 'lnf']]);
  // A resist strip leaves the metal of "Cr/AZ 1518".
  const pfc = step(PFC);
  assert.deepEqual(notesOf(run([filmed('W1', 'Cr/AZ 1518')], [step('', { title: 'Strip resist' }), pfc]), pfc), [['clean', 'stop', 'general'], ['material', 'stop', 'lnf']]);
  // A chromium film etched off still leaves a wafer a fusion bond must not take.
  const si = wafer('W1', SI);
  const cr = filmed('W2', 'Cr');
  const fusion = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [si.id, cr.id], method: 'fusion' }] });
  const etched = run([si, cr], [step('', { title: 'Cr etch', removes: ['Cr'], waferIds: [cr.id] }), fusion]);
  assert.deepEqual(notesOf(etched, fusion), [['bond-clean', 'caution', 'general']]);
  // A GaAs wafer is still no dirt for one.
  const gaas = wafer('G1', { material: 'GaAs', size: '100mm' });
  const f2 = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [si.id, gaas.id], method: 'fusion' }] });
  assert.deepEqual(run([si, gaas], [f2]).notes, []);
});
