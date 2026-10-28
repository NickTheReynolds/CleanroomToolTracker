// @ts-check
// Wafer specs (core/wafer-spec.js) and the plan's compatibility checks
// (core/compat.js with the LNF facts in data/compat-lnf.js and the LNF store).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  materialClasses, substrateClass, specSummary, cleanSpec, specEmpty, thicknessText, isMask, SIZES,
} from '../app/js/core/wafer-spec.js';
import { checkPlan, mergeProfile, stepWafers, andList } from '../app/js/core/compat.js';
import { toolProfile, LNF_COMPAT, lnfType } from '../app/js/data/compat-lnf.js';
import { planChecksWith } from '../app/js/data/plan-checks.js';
import { LNF_STORE, storeItem } from '../app/js/data/lnf-store.js';
import { LNF_TOOLS } from '../app/js/data/seed-lnf.js';
import { validateRecord, normalizeRecord } from '../app/js/data/schema.js';
import { RECIPES as ETCH } from '../app/js/data/lnf-recipes-etch.js';
import { RECIPES as DEP } from '../app/js/data/lnf-recipes-dep.js';
import { RECIPES as OTHER } from '../app/js/data/lnf-recipes-other.js';
import { strips, SOURCE_TEXT } from '../app/js/core/compat.js';

/** LNF tool ids by name. */
const ID = Object.fromEntries(LNF_TOOLS.map(([id, , name]) => [name, id]));
const tools = LNF_TOOLS.map(([id, , name]) => (/** @type {any} */ ({ id, name, shortName: '', category: 'other', kind: 'process' })));
const P790_PECVD = '6119e6b6-53b2-4b07-822f-3d00980c5cb0';

/** @param {string} label @param {Record<string, any>} [spec] @returns {any} */
const wafer = (label, spec) => ({ id: `id-${label}`, label, status: 'active', notes: '', ...(spec ? { spec } : {}) });
let n = 0;
/** @param {string} toolName @param {Record<string, any>} [extra] @returns {any} */
const step = (toolName, extra = {}) => ({
  id: `s${++n}`, title: extra.title || toolName, toolId: toolName ? ID[toolName] : null, templateId: null, recipe: '', notes: '',
  doneAt: null, skipped: false, ...extra,
});
/** @param {any[]} wafers @param {any[]} steps @param {any[]} [toolList] */
const run = (wafers, steps, toolList = tools) => planChecksWith({ wafers, steps }, toolList, [], []);
/** With the LNF recipes the app ships, so a step's recipe adds its film or resist. @param {any[]} wafers @param {any[]} steps */
const runR = (wafers, steps) => planChecksWith({ wafers, steps }, tools, [], /** @type {any[]} */ ([...ETCH, ...DEP, ...OTHER]));
/** @param {{byStep: Map<string, any[]>}} r @param {any} s @returns {string[]} "stop/code" for each note of a step */
const codes = (r, s) => (r.byStep.get(s.id) || []).map((x) => `${x.severity}/${x.code}`);
const SI100 = { material: 'Si', size: '100mm', thicknessUm: 525, thicknessTolUm: 25 };
const SI150 = { material: 'Si', size: '150mm', thicknessUm: 675, thicknessTolUm: 25 };
const PFC = 'PFC Bench 01';

test('material classes: metals, resists, glass and compound semiconductors, by formula or word', () => {
  const cls = (/** @type {string} */ m) => [...materialClasses(m)].sort();
  assert.deepEqual(cls('Au'), ['noble']);
  assert.deepEqual(cls('TiN'), ['metal'], 'titanium nitride is not tin');
  assert.deepEqual(cls('Sn'), ['noble']);
  assert.deepEqual(cls('tin'), ['noble']);
  assert.deepEqual(cls('Cr/Au'), ['metal', 'noble']);
  assert.deepEqual(cls('Al 1% Si'), ['metal']);
  assert.deepEqual(cls('CuOx (ALD)'), ['noble']);
  assert.deepEqual(cls('SPR 220 3.0'), ['organic']);
  assert.deepEqual(cls('S1813'), ['organic']);
  assert.deepEqual(cls('Positive resist'), ['organic']);
  assert.deepEqual(cls('Parylene C'), ['organic']);
  assert.deepEqual(cls('Pyrex (borosilicate glass)'), ['glass']);
  assert.deepEqual(cls('Glass'), ['glass']);
  assert.deepEqual(cls('Fused silica'), ['silica']);
  assert.deepEqual(cls('PSG'), [], 'phosphosilicate glass is a furnace film, not a glass wafer');
  assert.deepEqual(cls('GaAs'), ['compound']);
  assert.deepEqual(cls('LiNbO3 (bulk)'), ['alkali']);
  assert.deepEqual(cls('SiO2 (thermal)'), []);
  assert.deepEqual(cls('Si3N4 (LPCVD)'), []);
  assert.deepEqual(cls('Al2O3 (ALD)'), [], 'an oxide is not the metal');
  assert.deepEqual(cls(''), []);
  assert.equal(substrateClass('Si'), 'silicon');
  assert.equal(substrateClass('Glass'), 'glass');
  assert.equal(substrateClass('Fused silica'), 'silica');
  assert.equal(substrateClass('GaAs'), 'compound');
  assert.equal(substrateClass('Sapphire'), 'crystal');
  assert.equal(substrateClass('SiC'), 'crystal');
  assert.equal(substrateClass('LiNbO3 (bulk)'), 'crystal');
  assert.equal(substrateClass(''), '');
});

test('specs: summary, tidying, masks', () => {
  const dsp = /** @type {any} */ (storeItem('lnf-store/wafer-4in-dsp-p-boron-prime')).spec;
  assert.equal(specSummary(dsp), 'Si · 100 mm · <100> · p (B) · DSP · 525 ± 25 µm · 10–40 Ω·cm · Prime');
  const ox = /** @type {any} */ (storeItem('lnf-store/wafer-6in-p-10-80-2um-oxide')).spec;
  assert.equal(specSummary(ox), 'Si · 150 mm · p · with 2 µm SiO2 (thermal)');
  const plate = /** @type {any} */ (storeItem('lnf-store/mask-plate-5in-master-low-bow')).spec;
  assert.equal(specSummary(plate), '5 in plate · Soda-lime glass · Low-reflectance chrome · AZ1518, 400 nm · 2286 µm · MASTER');
  assert.equal(thicknessText({ thicknessUm: 500 }), '500 µm');
  assert.deepEqual(cleanSpec({ material: '  Si ', size: 'nope', thicknessUm: -3, orientation: '', future: 1, films: [{ material: '' }] }),
    { material: 'Si', size: 'nope', future: 1 }, 'empty and invalid fields go; unknown fields and values stay');
  assert.deepEqual(cleanSpec({ kind: 'mask', size: 'plate5', orientation: '<100>', coating: 'Cr' }), { kind: 'mask', size: 'plate5', coating: 'Cr' });
  assert.deepEqual(cleanSpec({ size: 'piece', pieceSize: '1 cm' }), { size: 'piece', pieceSize: '1 cm' });
  assert.deepEqual(cleanSpec({ size: '100mm', pieceSize: '1 cm' }), { size: '100mm' });
  assert.equal(specEmpty({ kind: 'mask' }), true);
  assert.equal(specEmpty({ material: 'Si' }), false);
  assert.equal(isMask(wafer('M1', { kind: 'mask' })), true);
  assert.equal(isMask(wafer('W1')), false);
  assert.ok(SIZES.every((s) => !/[″"]/.test(s.label)), 'labels print in PDFs (no inch glyph)');
});

test('the LNF store list: 13 single items, names kept, only stated facts, valid specs', () => {
  assert.equal(LNF_STORE.length, 13);
  assert.equal(new Set(LNF_STORE.map((x) => x.id)).size, 13);
  for (const x of LNF_STORE) {
    assert.match(x.id, /^lnf-store\/[a-z0-9-]+$/);
    assert.ok(!/box of/i.test(x.storeName), 'boxes are left out');
    assert.ok(x.price > 0 && x.priceSeen === '2026-10-22');
    assert.deepEqual(cleanSpec(x.spec), x.spec, `${x.id} spec is tidy`);
    assert.deepEqual(validateRecord('wafers', normalizeRecord('wafers', {
      id: 'x', createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', name: x.storeName, spec: x.spec,
    })), []);
  }
  const p1080 = LNF_STORE.filter((x) => x.storeName.includes('P-10-80'));
  assert.equal(p1080.length, 3);
  assert.ok(p1080.every((x) => !x.spec.resistivity), 'name and description disagree, so no resistivity');
  assert.ok(LNF_STORE.filter((x) => x.spec.kind === 'mask').length === 2);
});

test('furnace tubes: size, silicon only, and the RCA pre-furnace clean right before', () => {
  const ws = [wafer('W1', SI100), wafer('W2', SI150), wafer('W3', SI150)];
  const s1 = step(PFC);
  const s2 = step('Tempress S2T2 - Nitride-HTO 4"');
  const { byStep } = run(ws, [s1, s2]);
  assert.equal(byStep.get(s1.id), undefined);
  const notes = byStep.get(s2.id) || [];
  assert.equal(notes.length, 1, JSON.stringify(notes));
  assert.equal(notes[0].severity, 'stop');
  assert.equal(notes[0].code, 'size');
  assert.equal(notes[0].source, 'lnf');
  assert.equal(notes[0].text, 'W2 and W3 are 150 mm; Tempress S2T2 - Nitride-HTO 4" takes 100 mm wafers.');
  assert.deepEqual(notes[0].waferIds, ['id-W2', 'id-W3']);
  // No PFC clean right before.
  const s3 = step('Tempress S3T1 - Dry Oxide');
  const late = run([wafer('W1', SI100)], [step(PFC), step('Acid Bench 02'), s3]).byStep.get(s3.id) || [];
  assert.deepEqual(late.map((x) => x.code), ['preclean']);
  // A glass wafer in a silicon-only tube.
  const glass = run([wafer('G1', { material: 'Glass', size: '100mm' })], [step('Tempress S3T1 - Dry Oxide')]).notes;
  assert.ok(glass.some((x) => x.code === 'substrate' && x.text.includes('silicon only')), JSON.stringify(glass));
  // Kept in S2T1 storage after the clean: still pre-cleaned.
  const s5 = step('Tempress S3T2 - Wet Oxide');
  assert.equal(run([wafer('W1', SI100)], [step(PFC), step('Tempress S2T1 Storage 4" & 6"'), s5]).byStep.get(s5.id), undefined);
});

test('cleanliness follows the wafer: metal is for good, a non-CMOS bench needs an RCA clean', () => {
  const w = [wafer('W1', SI100)];
  const pfc = step(PFC);
  const tube = step('Tempress S3T2 - Wet Oxide');
  const { byStep } = run(w, [step('Cooke Evaporator', { adds: ['Au'] }), pfc, tube]);
  const atPfc = byStep.get(pfc.id) || [];
  assert.ok(atPfc.some((x) => x.code === 'clean' && x.text.includes('carries Au from step 1') && x.text.includes('cannot be made CMOS-clean again')));
  assert.ok(atPfc.some((x) => x.code === 'material' && x.text.includes('W1 carries Au (step 1)')));
  assert.ok((byStep.get(tube.id) || []).some((x) => x.code === 'clean'));
  // Evaporated without saying what: the tool still marks the wafer (general practice).
  const pfc2 = step(PFC);
  const gen = run(w, [step('SJ-20 Evaporator'), pfc2]).byStep.get(pfc2.id) || [];
  assert.deepEqual(gen.map((x) => [x.code, x.source]), [['clean', 'general']]);
  // Straight from another wet bench to the PFC clean: stop (the PFC note); with RCA Bench 81 in between: fine.
  const pfc3 = step(PFC);
  const semi = run(w, [step('Acid Bench 12'), pfc3]).byStep.get(pfc3.id) || [];
  assert.deepEqual(semi.map((x) => [x.code, x.source, x.text]), [['wet', 'lnf',
    'W1 comes from Acid Bench 12 (step 1): the PFC bench takes no wafers from wet benches other than Acid 02 or RCA 81.']]);
  const pfc4 = step(PFC);
  const tube4 = step('Tempress S3T1 - Dry Oxide');
  const ok = run(w, [step('Acid Bench 12'), step('RCA Bench 81'), pfc4, tube4]);
  assert.deepEqual(ok.notes, []);
  // Dicing: metal-contaminated per the LNF notes.
  const pfc5 = step(PFC);
  assert.ok((run(w, [step('ADT 7100 Dicing Saw'), pfc5]).byStep.get(pfc5.id) || []).some((x) => x.code === 'clean' && x.text.includes('diced')));
});

test('resist stays on the wafer until a strip; the PFC bench allows none', () => {
  const w = [wafer('W1', SI100)];
  const pfc = step(PFC);
  const coat = step('CEE 200X photoresist spinner 1');
  const withResist = run(w, [coat, pfc]).byStep.get(pfc.id) || [];
  assert.ok(withResist.some((x) => x.code === 'material' && x.text.includes('Photoresist (step')), JSON.stringify(withResist));
  const pfc2 = step(PFC);
  const stripped = run(w, [step('CEE 200X photoresist spinner 1'), step('Solvent Bench 14', { title: 'Strip resist' }), step('RCA Bench 81'), pfc2]);
  assert.equal(stripped.byStep.get(pfc2.id), undefined, 'stripped, then RCA-cleaned');
  const pfc5 = step(PFC);
  const solvent = run(w, [step('CEE 200X photoresist spinner 1'), step('Solvent Bench 14', { title: 'Remove resist' }), pfc5]);
  assert.deepEqual((solvent.byStep.get(pfc5.id) || []).map((x) => x.code), ['wet'], 'resist gone, but straight from a solvent bench');
  // A strip on a coater takes resist off (it does not put it on).
  const pfc6 = step(PFC);
  const tel = run(w, [step('CEE 200X photoresist spinner 1'), step('TEL Mark Vz Coater', { recipe: 'STRIP' }), pfc6]);
  assert.equal(tel.byStep.get(pfc6.id), undefined);
  // A descum is not a strip.
  const pfc3 = step(PFC);
  const descum = run(w, [step('CEE 200X photoresist spinner 1'), step('YES-CV200RFS(E)', { title: 'O2 descum' }), pfc3]);
  assert.ok((descum.byStep.get(pfc3.id) || []).some((x) => x.code === 'material'));
});

test('KOH-exposed wafers go only to the cleaning benches until the RCA clean', () => {
  const w = [wafer('W1', SI100)];
  const lam = step('LAM 9400');
  const koh = run(w, [step('Base Bench 91', { title: 'KOH etch' }), lam]).byStep.get(lam.id) || [];
  assert.deepEqual(koh.map((x) => [x.code, x.severity]), [['koh', 'stop']]);
  const lam2 = step('LAM 9400');
  assert.equal(run(w, [step('Base Bench 91', { title: 'KOH etch' }), step('Acid Bench 92'), step('RCA Bench 81'), lam2]).byStep.get(lam2.id), undefined);
  const lam3 = step('LAM 9400');
  assert.equal(run(w, [step('Base Bench 63', { title: 'TMAH develop' }), lam3]).byStep.get(lam3.id), undefined, 'TMAH is fine');
  // The order matters: RCA 81 without Acid 92 first does not clean it off.
  const rca = step('RCA Bench 81');
  const lam4 = step('LAM 9400');
  const early = run(w, [step('Base Bench 91', { title: 'KOH etch' }), rca, lam4]);
  assert.deepEqual((early.byStep.get(rca.id) || []).map((x) => [x.code, x.severity]), [['koh-order', 'caution']]);
  assert.deepEqual((early.byStep.get(lam4.id) || []).map((x) => x.code), ['koh']);
  // The PFC bench is not where KOH comes off.
  const pfc = step(PFC);
  assert.ok((run(w, [step('Base Bench 63', { title: 'AZ 400K develop' }), pfc]).byStep.get(pfc.id) || []).some((x) => x.code === 'koh'));
});

test('only the PFC Bench 01 clean counts as the pre-furnace clean', () => {
  const w = [wafer('W1', SI100)];
  const tube = step('Tempress S3T1 - Dry Oxide');
  assert.deepEqual((run(w, [step('RCA Bench 81'), tube]).byStep.get(tube.id) || []).map((x) => x.text),
    ['W1 needs the RCA pre-furnace clean at PFC Bench 01 as the step right before Tempress S3T1 - Dry Oxide, on the same day (or kept in Tempress S2T1 storage in between).']);
  const both = run([wafer('W1', SI100), wafer('W2', SI100)], [step('Tempress S3T1 - Dry Oxide')]).notes;
  assert.match(both[0].text, /^W1 and W2 need the RCA pre-furnace clean/);
});

test('a checked "Check" never hides a "Not allowed" on the same wafers', () => {
  const si = wafer('W1', SI100);
  const si2 = wafer('W2', SI100);
  const s = step('EVG 510', { bonds: [{ id: 'b', waferIds: [si.id, si2.id], method: 'anodic' }] });
  const notes = run([si, si2], [s]).byStep.get(s.id) || [];
  assert.deepEqual(notes.map((x) => [x.code, x.severity]), [['bond-anodic', 'stop'], ['bond-tool', 'caution']]);
  assert.equal(new Set(notes.map((x) => x.key)).size, 2);
  assert.equal(notes[0].text, 'W1+W2 has no glass wafer: anodic bonding joins a sodium-containing glass (such as Pyrex or Borofloat) to silicon.');
});

test('names: resistivity is not resist, "In situ" is not indium, and silicon is silicon however it is written', () => {
  assert.deepEqual([...materialClasses('High-resistivity Si')], []);
  assert.deepEqual([...materialClasses('In situ doped poly')], []);
  assert.deepEqual([...materialClasses('III-V oxide')], ['compound'], 'a III-V, and no vanadium');
  assert.deepEqual([...materialClasses('Au seed')], ['noble']);
  assert.deepEqual([...materialClasses('W')], ['metal'], 'a formula on its own still counts');
  for (const m of ['Si', 'n-type Si', 'p-Si', 'FZ Si', 'Prime Si', 'p-type Si <100>', 'Poly-Si', 'SOI']) assert.equal(substrateClass(m), 'silicon', m);
  assert.equal(substrateClass('SiO2 (thermal)'), 'other');
  assert.equal(substrateClass('FZ wafer'), 'other');
  const tube = step('Tempress S3T1 - Dry Oxide');
  const asks = run([wafer('W1', { material: 'FZ wafer', size: '100mm' })], [step(PFC), tube]).byStep.get(tube.id) || [];
  assert.deepEqual(asks.map((x) => [x.code, x.severity, x.materials]), [['substrate-unknown', 'caution', ['FZ wafer']]],
    'an unlisted substrate is not guessed at: the app says it does not know it');
});

test('carriers, pieces, size limits and thickness', () => {
  const p5000 = step('P5000 PECVD');
  const r = run([wafer('W1', SI100), wafer('P1', { material: 'Si', size: 'piece' }), wafer('W2', { size: '200mm' })], [p5000]).byStep.get(p5000.id) || [];
  assert.deepEqual(r.map((x) => [x.code, x.severity]).sort(), [['pieces', 'caution'], ['size', 'caution'], ['size', 'stop']]);
  const peg4 = step('STS Pegasus 4');
  const pieces = run([wafer('P1', { size: 'piece' })], [peg4]).byStep.get(peg4.id) || [];
  assert.equal(pieces[0].text, 'P1: STS Pegasus 4 does not take pieces; samples that need a carrier go on a 150 mm wafer in the STS Pegasus 6.');
  const pvd = step('PVD 75 Proline');
  assert.equal((run([wafer('W1', { size: '200mm' })], [pvd]).byStep.get(pvd.id) || [])[0].text, 'W1 is 200 mm; PVD 75 Proline takes up to 150 mm.');
  const tel = step('TEL Mark Vz Coater');
  assert.equal(run([wafer('W1', SI100)], [tel]).byStep.get(tel.id), undefined);
  const rca = step('RCA Bench 81');
  assert.deepEqual((run([wafer('W1', SI150)], [rca]).byStep.get(rca.id) || []).map((x) => x.severity), ['caution'], '6 in needs a ticket');
});

test('bonding: methods, sizes, stack thickness, debond', () => {
  const si = wafer('W1', { ...SI100, polish: 'ssp' });
  const glass = wafer('G1', { material: 'Glass', size: '100mm', thicknessUm: 500 });
  const silica = wafer('Q1', { material: 'Fused silica', size: '100mm', thicknessUm: 500 });
  const bond = (/** @type {any[]} */ ws, /** @type {string} */ method, /** @type {string} */ tool = 'EVG 520IS') => step(tool, { bonds: [{ id: 'b', waferIds: ws.map((w) => w.id), method }] });
  const good = bond([si, glass], 'anodic');
  assert.equal(run([si, glass], [good]).byStep.get(good.id), undefined, 'Si to glass bonds anodically');
  const bad = bond([si, silica], 'anodic');
  assert.match((run([si, silica], [bad]).byStep.get(bad.id) || [])[0].text, /fused silica and quartz have no sodium/);
  const si2 = wafer('W2', { ...SI100, polish: 'none' });
  const fusion = bond([si, si2], 'fusion');
  assert.match((run([si, si2], [fusion]).byStep.get(fusion.id) || [])[0].text, /^W2 is unpolished/);
  const big = wafer('W3', SI150);
  const mixed = bond([si, big], 'eutectic');
  assert.match((run([si, big], [mixed]).byStep.get(mixed.id) || [])[0].text, /^W1\+W3 mixes sizes \(100 mm and 150 mm\)/);
  const mounted = bond([si, big], 'temporary');
  assert.equal(run([si, big], [mounted]).byStep.get(mounted.id), undefined, 'a wafer waxed onto a bigger carrier is usual');
  const af32 = wafer('X1', { material: 'AF32', size: '100mm' });
  const unknownGlass = bond([si, af32], 'anodic');
  assert.deepEqual((run([si, af32], [unknownGlass]).byStep.get(unknownGlass.id) || []).map((x) => [x.code, x.severity]), [['bond-unknown', 'caution']],
    'an unlisted material is not guessed at: the app says it does not know it');
  const evg510 = bond([si, glass], 'anodic', 'EVG 510');
  assert.deepEqual((run([si, glass], [evg510]).byStep.get(evg510.id) || []).map((x) => x.source), ['lnf']);
  // The stack: 525 + 500 µm (± 25) is too thick for the TEL coater, and processes as one.
  const tel = step('TEL Mark Vz Coater');
  const stack = run([si, glass], [bond([si, glass], 'anodic'), tel]).byStep.get(tel.id) || [];
  assert.equal(stack.length, 1);
  assert.equal(stack[0].text, 'W1+G1 is 1025 ± 25 µm thick; TEL Mark Vz Coater takes up to 1000 µm.');
  assert.deepEqual(stack[0].waferIds, ['id-W1', 'id-G1']);
  // After a debond each wafer is itself again.
  const tel2 = step('TEL Mark Vz Coater');
  const apart = run([si, glass], [bond([si, glass], 'temporary'), step('', { title: 'Debond', debond: true }), tel2]);
  assert.equal(apart.byStep.get(tel2.id), undefined);
  // A glass wafer bonded to silicon makes the stack not silicon-only.
  const tube = step('Tempress S3T1 - Dry Oxide');
  assert.ok((run([si, glass], [bond([si, glass], 'anodic'), tube]).byStep.get(tube.id) || []).some((x) => x.code === 'substrate'));
  // Debonded, each wafer is itself: the silicon wafer does not carry the glass.
  const pfc = step(PFC, { waferIds: [si.id] });
  const after = run([si, glass], [bond([si, glass], 'temporary'), step('', { title: 'Debond', debond: true }), step('Acid Bench 02', { waferIds: [si.id] }), pfc]);
  assert.deepEqual((after.byStep.get(pfc.id) || []).map((x) => x.text), ['W1 carries Temporary bonding adhesive (step 1): PFC Bench 01 allows no resists and polymers.']);
});

test('masks: plate sizes per tool and against the wafer', () => {
  const m4 = wafer('M1', { kind: 'mask', size: 'plate4' });
  const m7 = wafer('M2', { kind: 'mask', size: 'plate7' });
  const w1 = wafer('W1', SI100);
  const ma6 = step('MA6 Mask Aligner', { waferIds: [w1.id, m4.id] });
  const small = run([w1, m4], [ma6]).byStep.get(ma6.id) || [];
  assert.equal(small.length, 1);
  assert.equal(small[0].severity, 'caution');
  assert.equal(small[0].code, 'mask-small');
  assert.match(small[0].text, /^M1 \(4 in plate\) is small for 100 mm wafers/);
  const m5 = wafer('M3', { kind: 'mask', size: 'plate5' });
  const upg = step('Heidelberg µPG 501 Mask Maker', { waferIds: [m5.id] });
  assert.equal(run([m5], [upg]).byStep.get(upg.id), undefined, 'a 5 in plate in the mask maker');
  const upg2 = step('Heidelberg µPG 501 Mask Maker', { waferIds: [m7.id] });
  const seven = run([wafer('W1'), m7], [upg2]).byStep.get(upg2.id) || [];
  assert.deepEqual(seven.map((x) => x.text), ['M2 is a 7 in plate; Heidelberg µPG 501 Mask Maker takes 4 in or 5 in plates.']);
  // Masks are not processed with the wafers unless a step names them.
  assert.deepEqual(stepWafers({ wafers: [wafer('W1'), m4] }, step('LAM 9400')).map((w) => w.label), ['W1']);
  assert.deepEqual(stepWafers({ wafers: [m4] }, step('Heidelberg µPG 501')).map((w) => w.label), ['M1'], 'a mask-making project');
});

test('the 790 PECVD chamber cautions on polymers; nothing set raises nothing; your settings win', () => {
  const w = [wafer('W1', SI100)];
  const pecvd = step('Plasmatherm 790', { templateId: P790_PECVD });
  const r = run(w, [step('CEE 200X photoresist spinner 1'), pecvd]).byStep.get(pecvd.id) || [];
  assert.deepEqual(r.map((x) => [x.code, x.severity]), [['material', 'caution']]);
  const rie = step('Plasmatherm 790');
  assert.equal(run(w, [step('CEE 200X photoresist spinner 1'), rie]).byStep.get(rie.id), undefined);
  // No specs at all: nothing to say anywhere.
  assert.deepEqual(run([wafer('W1'), wafer('W2')], [step('Tempress S2T2 - Nitride-HTO 4"'), step('Cooke Evaporator'), step('TEL Mark Vz Coater')])
    .notes.map((x) => x.code), ['preclean'], 'only the step-order rule needs no spec');
  const cooke = step('Cooke Evaporator');
  assert.equal(run([wafer('W1', SI150)], [cooke]).byStep.get(cooke.id), undefined, 'a description of what suits a tool is not a size limit');
  // Your settings: the tube takes 150 mm as well, or nothing is checked.
  const s2t2 = tools.map((t) => (t.id === ID['Tempress S2T2 - Nitride-HTO 4"'] ? { ...t, compat: { sizes: ['100mm', '150mm'] } } : t));
  const t1 = step('Tempress S2T2 - Nitride-HTO 4"');
  assert.equal(run([wafer('W1', SI150)], [step(PFC), t1], s2t2).byStep.get(t1.id), undefined);
  const p = toolProfile(/** @type {any} */ ({ id: ID['Tempress S2T2 - Nitride-HTO 4"'], compat: { sizes: null } }));
  assert.equal(p.sizes, null);
  assert.equal(p.src.sizes, 'yours');
  assert.equal(p.src.accepts, 'lnf');
  assert.deepEqual(mergeProfile({ general: { marks: 'metals' }, lnf: null, yours: { marks: null } }).marks, null);
});

test('LNF facts point at real tools, and skipped steps are left out', () => {
  for (const id of Object.keys(LNF_COMPAT)) assert.ok(lnfType(id) || LNF_TOOLS.some((t) => t[0] === id), id);
  const s = step('Tempress S2T2 - Nitride-HTO 4"', { skipped: true });
  assert.deepEqual(run([wafer('W1', SI150)], [s]).notes, []);
  assert.equal(andList(['W1', 'W2', 'W3']), 'W1, W2 and W3');
});

test('furnace flows: the PFC clean before each furnace run, repeated or not, is fine', () => {
  const w = [wafer('W1', SI100)];
  const flow = [step(PFC), step('Tempress S3T2 - Wet Oxide'), step(PFC), step('Tempress S2T2 - Nitride-HTO 4"')];
  assert.deepEqual(run(w, flow).notes, []);
  assert.deepEqual(run(w, [step(PFC), step(PFC), step('Tempress S3T1 - Dry Oxide')]).notes, [], 'a clean done twice');
});

test('recipes: several listed resists add "Photoresist", plating adds its metal, a lift-off title does not hide the film', () => {
  const w = [wafer('W1', SI150)];
  // The ROBIN's spin recipes list SPR 220, SU-8 and polyimide: what they suit, not what is on the wafer.
  const rca = step('RCA Bench 81');
  const robin = runR(w, [step('Spinner CEE Apogee ROBIN', { recipe: '3000RPM' }), step('MA6 Mask Aligner'), step('CEE Developer 1'),
    step('YES-CV200RFS(E)', { recipe: 'Recipe 2: Strip photoresist' }), rca]);
  assert.deepEqual(codes(robin, rca), ['caution/size'], 'no permanent SU-8 or polyimide after a plasma strip');
  // A resist named in What it adds is the one on the wafer.
  const pfc = step(PFC);
  const named = runR([wafer('W1', SI100)], [step('CEE 200X photoresist spinner 1', { adds: ['AZ4620'] }), pfc]);
  assert.deepEqual((named.byStep.get(pfc.id) || []).map((x) => x.text), ['W1 carries AZ4620 (step 1): PFC Bench 01 allows no resists and polymers.']);
  // Copper pulse plating at Acid Bench 92 leaves copper.
  const rca2 = step('RCA Bench 81');
  assert.deepEqual(codes(runR([wafer('W1', SI100)], [step('Acid Bench 92', { recipe: 'Copper pulse plating' }), rca2]), rca2), ['stop/material']);
  // "Evaporate Au for lift-off" still evaporates gold.
  const rca3 = step('RCA Bench 81');
  const lift = runR([wafer('W1', SI100)], [step('CEE 200X photoresist spinner 1'), step('Cooke Evaporator', { title: 'Evaporate Au for lift-off', recipe: 'Gold (Au)' }),
    step('Solvent Bench 14', { title: 'Lift-off' }), rca3]);
  assert.deepEqual((lift.byStep.get(rca3.id) || []).map((x) => x.text), ['W1 carries Au (step 2): RCA Bench 81 allows no gold, copper and other fast-diffusing metals.']);
  // The µPG mask maker is not a "PG" strip: the resist stays for the 790's PECVD chamber.
  assert.equal(strips('Heidelberg µPG 501 Mask Maker'), false);
  assert.equal(strips('Remover PG soak'), true);
  const pecvd = step('Plasmatherm 790', { templateId: P790_PECVD });
  assert.deepEqual(codes(run([wafer('W1', SI100)], [step('CEE 200X photoresist spinner 1'), step('Heidelberg µPG 501 Mask Maker'), pecvd]), pecvd), ['caution/material']);
  // The Endeavor heats the wafer: no organics.
  const aln = step('Endeavor M1 AlN Sputter Tool');
  assert.deepEqual(codes(run([wafer('W1', SI150)], [step('CEE 200X photoresist spinner 1'), aln]), aln), ['stop/material']);
});

test('KOH developer at Base Bench 63: kept out of clean tools only; a strip while bonded stays off after the debond', () => {
  const w = [wafer('W1', SI100)];
  const plating = step('Gold Plating');
  const rie = step('P5000 RIE/Chamber C');
  const r = run(w, [step('Base Bench 63', { title: 'AZ 400K develop' }), plating, step('Solvent Bench 83', { title: 'Strip resist' }), rie]);
  assert.deepEqual(codes(r, plating), [], 'a plating mold is not a clean tool');
  assert.deepEqual((r.byStep.get(rie.id) || []).filter((x) => x.code === 'koh').map((x) => x.text),
    ['W1 had KOH at step 1: the LNF notes say KOH is not compatible with semi-clean or clean tools.']);
  const lam = step('LAM 9400');
  assert.deepEqual(codes(run(w, [step('Base Bench 63', { title: 'AZ 400K develop' }), lam]), lam), []);
  // The KOH cleaning in order clears it.
  const rie2 = step('P5000 RIE/Chamber C');
  assert.deepEqual(codes(run(w, [step('Base Bench 63', { title: 'AZ 400K develop' }), step('Acid Bench 92'), step('RCA Bench 81'), rie2]), rie2), []);
  // Resist stripped while mounted on a carrier is gone after the dismount.
  const si = wafer('W1', SI100);
  const carrier = wafer('C1', SI150);
  const rca = step('RCA Bench 81', { waferIds: [si.id] });
  const mounted = run([si, carrier], [step('CEE 200X photoresist spinner 1', { waferIds: [si.id] }),
    step('EVG 510', { title: 'Mount on carrier', bonds: [{ id: 'b', waferIds: [si.id, carrier.id], method: 'temporary' }] }),
    step('YES-CV200RFS(E)', { title: 'Strip photoresist' }), step('', { title: 'Dismount', debond: true }), rca]);
  assert.deepEqual((mounted.byStep.get(rca.id) || []).map((x) => x.text), ['W1 carries Temporary bonding adhesive (step 2): RCA Bench 81 allows no resists and polymers.']);
});

test('notes read well: an anodic bond through a glass film, several wafers, classes in order, the source said', () => {
  const [a, b] = [wafer('W1', { ...SI100, polish: 'dsp' }), wafer('W2', { ...SI100, polish: 'dsp' })];
  const bond = step('EVG 520IS', { bonds: [{ id: 'b', waferIds: [a.id, b.id], method: 'anodic' }] });
  assert.deepEqual(codes(runR([a, b], [step('SJ-26 Evaporator', { recipe: 'Px', waferIds: [a.id] }), bond]), bond), [], 'an evaporated Pyrex film bonds anodically');
  const pfc = step(PFC);
  const coated = run([wafer('W1', { ...SI100, films: [{ material: 'Cr/Au' }] }), wafer('W2', { ...SI100, films: [{ material: 'Cr/Au' }] })], [pfc]).byStep.get(pfc.id) || [];
  assert.deepEqual(coated.map((x) => x.text), [
    'W1 and W2 came with metal on them: PFC Bench 01 takes CMOS-clean wafers only. They cannot be made CMOS-clean again.',
    'W1 and W2 carry Cr/Au (as bought): PFC Bench 01 allows no gold, copper and other fast-diffusing metals and other metals.',
  ]);
  const pfc2 = step(PFC);
  assert.deepEqual((run([wafer('W1', SI100)], [step('Lab 18-1'), pfc2]).byStep.get(pfc2.id) || []).map((x) => x.text),
    ['W1 has been in Lab 18-1 (step 1, a sputter tool): PFC Bench 01 takes CMOS-clean wafers only. It cannot be made CMOS-clean again.']);
  assert.equal(SOURCE_TEXT.general, 'General practice, not an LNF rule.');
  // Dielectrics written out in words are not their metal.
  for (const m of ['Aluminum oxide', 'Titanium dioxide', 'Tantalum pentoxide', 'Aluminum nitride', 'Low-resistance Si']) assert.deepEqual([...materialClasses(m)], [], m);
  assert.deepEqual([...materialClasses('Titanium nitride')], ['metal'], 'as TiN');
  assert.deepEqual([...materialClasses('AZ1518')], ['organic']);
});

test('mounts: a debond in a solvent or a wax removal takes the adhesive off; a strip while mounted does not reach it', () => {
  const si = wafer('W1', SI100);
  const carrier = wafer('C1', SI150);
  const mount = () => step('Sample mounting station', { recipe: 'Crystalbond 509 mounting', bonds: [{ id: 'b', waferIds: [si.id, carrier.id], method: 'temporary' }] });
  const rca = step('RCA Bench 81', { waferIds: [si.id] });
  assert.deepEqual(codes(runR([si, carrier], [mount(), step('STS Pegasus 6'), step('Solvent Bench 94', { title: 'Debond in acetone', debond: true }), rca]), rca), [],
    'the debond dissolves the mount');
  const rca2 = step('RCA Bench 81', { waferIds: [si.id] });
  assert.deepEqual(codes(runR([si, carrier], [mount(), step('', { title: 'Debond on hot plate', debond: true }),
    step('Solvent Bench 94', { recipe: 'Wax removal', waferIds: [si.id] }), rca2]), rca2), [], 'the LNF wax removal after the debond');
  const rca3 = step('RCA Bench 81', { waferIds: [si.id] });
  assert.deepEqual(codes(runR([si, carrier], [mount(), step('', { title: 'Debond on hot plate', debond: true }),
    step('Solvent Bench 94', { title: 'Clean', removes: ['Crystalbond'], waferIds: [si.id] }), rca3]), rca3), [], 'naming the mount in What it removes');
  const rca4 = step('RCA Bench 81', { waferIds: [si.id] });
  assert.deepEqual(codes(runR([si, carrier], [mount(), step('YES-CV200RFS(E)', { title: 'Strip photoresist' }), step('', { title: 'Debond', debond: true }), rca4]), rca4),
    ['stop/material'], 'a plasma strip while mounted leaves the adhesive between the wafers');
  // Debonds that dissolve the mount: in a solvent or DI water, at a wet bench, or with the mount's own LNF recipe.
  for (const debond of [{ title: 'Dismount in hot DI water' }, { title: 'Debond in xylene' }, { title: 'Debond in solvent' },
    { toolName: 'Solvent Bench 94', title: 'Debond' }, { toolName: 'Sample mounting station', title: 'Dismount', recipe: 'Crystalbond 509 mounting' }]) {
    const rca5 = step('RCA Bench 81', { waferIds: [si.id] });
    const { toolName = '', ...rest } = debond;
    assert.deepEqual(codes(runR([si, carrier], [mount(), step(toolName, { ...rest, debond: true }), rca5]), rca5), [], JSON.stringify(debond));
  }
  // A dry debond leaves it; naming the beeswax in What it removes takes it off.
  const rca6 = step('RCA Bench 81', { waferIds: [si.id] });
  assert.deepEqual(codes(runR([si, carrier], [mount(), step('', { title: 'Debond on hot plate', debond: true }), rca6]), rca6), ['stop/material']);
  const rca7 = step('RCA Bench 81', { waferIds: [si.id] });
  assert.deepEqual(codes(runR([si, carrier], [mount(), step('', { title: 'Debond on hot plate', debond: true }),
    step('', { title: 'Clean', removes: ['Beeswax'], waferIds: [si.id] }), rca7]), rca7), []);
});

test('a clean carrier debonded from a metal wafer is told why: the stack, not the metal', () => {
  const w1 = wafer('W1', { ...SI100, films: [{ material: 'Au' }] });
  const c1 = wafer('C1', SI150);
  const rie = step('P5000 RIE/Chamber C', { waferIds: [c1.id] });
  const r = run([w1, c1], [step('Sample mounting station', { bonds: [{ id: 'b', waferIds: [w1.id, c1.id], method: 'temporary' }] }),
    step('', { title: 'Debond', debond: true }), step('Solvent Bench 14', { title: 'Strip', waferIds: [c1.id] }), rie]);
  assert.deepEqual((r.byStep.get(rie.id) || []).map((x) => x.text),
    ['C1 has been in the stack W1+C1 (bonded at step 1): P5000 RIE/Chamber C takes CMOS-clean wafers only. It cannot be made CMOS-clean again.']);
  // A partner marked by an LNF rule: passing that on to the other wafer is general practice.
  const w2 = wafer('W2', SI100);
  const c2 = wafer('C2', SI150);
  const rie2 = step('P5000 RIE/Chamber C', { waferIds: [w2.id] });
  const r2 = run([w2, c2], [step('Solvent Bench 83', { title: 'Clean carrier', waferIds: [c2.id] }),
    step('Sample mounting station', { bonds: [{ id: 'b', waferIds: [w2.id, c2.id], method: 'temporary' }] }),
    step('Solvent Bench 94', { title: 'Debond in acetone', debond: true }), rie2]);
  assert.deepEqual((r2.byStep.get(rie2.id) || []).map((x) => [x.source, x.text]),
    [['general', 'W2 has been in the stack W2+C2 (bonded at step 2): P5000 RIE/Chamber C takes CMOS-clean wafers only. It cannot be made CMOS-clean again.']]);
});

test('names and titles: AZ products, AlScN, a coat titled lift-off, a KOH etch at Base Bench 63', () => {
  for (const m of ['AZ nLOF 2070', 'AZ P4620', 'AZ MiR 701', 'AZ 9260', 'AZ-4620']) assert.deepEqual([...materialClasses(m)], ['organic'], m);
  assert.deepEqual([...materialClasses('AZO')], ['noble']);
  for (const m of ['Aluminum scandium nitride', 'Chromium oxide', 'Aluminum oxide ALD', 'Titanium dioxide film']) {
    assert.deepEqual([...materialClasses(m)], [], m);
  }
  assert.deepEqual([...materialClasses('Aluminum gallium nitride')], ['compound'], 'AlGaN, a compound semiconductor as GaN is');
  for (const m of ['nLOF 2070', 'ma-N 2403', 'PMGI SF9', 'Shipley 1813', 'CSAR 62', 'MiR 701', 'Beeswax']) assert.deepEqual([...materialClasses(m)], ['organic'], m);
  assert.deepEqual([...materialClasses('Mirror Al')], ['metal']);
  assert.deepEqual([...materialClasses('Aluminum oxide / Titanium')], ['metal'], 'two materials: the second is a metal');
  // A coat whose title mentions lift-off still coats, and does not strip the layer under it.
  const rca = step('RCA Bench 81');
  const bilayer = runR([wafer('W1', SI100)], [step('Laurell Spinner', { title: 'Spin LOR 3A', adds: ['LOR 3A'] }),
    step('CEE 200X photoresist spinner 1', { title: 'Spin S1813 (lift-off bilayer)', recipe: '1813 3000 rpm' }), rca]);
  assert.deepEqual((bilayer.byStep.get(rca.id) || []).map((x) => x.text), ['W1 carries LOR 3A (step 1) and S1813 (step 2): RCA Bench 81 allows no resists and polymers.']);
  // Base Bench 63 is not a KOH cleaning bench: a KOH etch not yet cleaned off is stopped there.
  const b63 = step('Base Bench 63', { title: 'MF 319 develop' });
  assert.deepEqual(codes(run([wafer('W1', SI100)], [step('Base Bench 91', { title: 'KOH etch' }), b63]), b63), ['stop/koh']);
});

test('your sizes replace the LNF size limits, and Any size checks nothing', () => {
  const ebeam = ID['E-Beam Solvent Bench 22'];
  const w = [wafer('W1', { ...SI100, size: '200mm' })];
  const s = step('E-Beam Solvent Bench 22');
  assert.deepEqual(codes(run(w, [s]), s), ['stop/size'], 'up to 150 mm, from the LNF notes');
  const mine = tools.map((t) => (t.id === ebeam ? { ...t, compat: { sizes: ['100mm', '150mm', '200mm'], maxDiameterMm: null, askSizes: null } } : t));
  const s2 = step('E-Beam Solvent Bench 22');
  assert.deepEqual(codes(run(w, [s2], mine), s2), []);
  const rca = ID['RCA Bench 81'];
  const any = tools.map((t) => (t.id === rca ? { ...t, compat: { sizes: null, maxDiameterMm: null, askSizes: null } } : t));
  const s3 = step('RCA Bench 81');
  assert.deepEqual(codes(run([wafer('W1', SI150)], [s3], any), s3), [], 'no ticket caution once you said any size');
  assert.deepEqual(validateRecord('tools', normalizeRecord('tools', {
    id: 't', createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', name: 'T', compat: { sizes: null, maxDiameterMm: null, askSizes: null },
  })), []);
  assert.ok(validateRecord('tools', normalizeRecord('tools', {
    id: 't', createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', name: 'T', compat: { maxDiameterMm: 'big' },
  })).length);
});

test('schema: the new fields are optional and checked only for their type', () => {
  const base = { id: 'p', createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', name: 'P', startedAt: '2026-10-22T00:00:00Z' };
  const ok = normalizeRecord('projects', {
    ...base, wafers: [{ id: 'w', label: 'W1', spec: { size: '100mm' }, specId: null }],
    steps: [{ id: 's', title: 'Bond', waferIds: ['w'], bonds: [{ id: 'b', waferIds: ['w', 'gone'] }], debond: false, checked: [], adds: ['Au'], removes: [] }],
  });
  assert.deepEqual(validateRecord('projects', ok), []);
  assert.deepEqual(ok.wafers[0], { id: 'w', label: 'W1', status: 'active', notes: '', spec: { size: '100mm' }, specId: null }, 'no new defaults');
  const bad = normalizeRecord('projects', { ...base, wafers: [{ id: 'w', label: 'W1', spec: 'x' }], steps: [{ id: 's', title: 'X', bonds: [{ waferIds: [1] }] }] });
  assert.equal(validateRecord('projects', bad).length, 2);
  const tool = normalizeRecord('tools', { id: 't', createdAt: base.createdAt, updatedAt: base.updatedAt, name: 'T', compat: { sizes: ['100mm'], maxThicknessUm: 'x' } });
  assert.deepEqual(validateRecord('tools', tool), ['compat: maxThicknessUm must be a number']);
  assert.deepEqual(validateRecord('wafers', normalizeRecord('wafers', { ...base, spec: { kind: 'plate' } })), ['spec.kind must be wafer or mask']);
});
