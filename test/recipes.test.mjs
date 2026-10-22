// @ts-check
// LNF wiki recipes: what a recipe fills on a template, search and lookup
// helpers, and a check of every shipped recipe against its tool's template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  recipeFill, applyFill, undoFill, valueText, fieldValue, recipeMatches, findRecipe, sortRecipes, recipeFilm,
  recipeMaterial, hasValues, recipesFor, templateForRecipe,
} from '../app/js/core/recipes.js';
import { RECIPES as ETCH } from '../app/js/data/lnf-recipes-etch.js';
import { RECIPES as DEP } from '../app/js/data/lnf-recipes-dep.js';
import { RECIPES as OTHER } from '../app/js/data/lnf-recipes-other.js';
import { LNF_TOOLS, LNF_EXTRA_TEMPLATES } from '../app/js/data/seed-lnf.js';
import { seedForType } from '../app/js/data/seed-types.js';
import { normText, PROCESS_TYPES } from '../app/js/core/vocab.js';

/** @typedef {import('../app/js/core/recipes.js').WikiRecipe} WikiRecipe */
/** @typedef {import('../app/js/core/types.js').Template} Template */

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'js', 'data');

/** @returns {Template} an ICP etch template like the seeded one, with a few gases */
function icpTemplate() {
  const body = /** @type {NonNullable<ReturnType<typeof seedForType>['template']>} */ (seedForType('icp-etch', ['Cl2', 'HBr', 'He', 'O2']).template);
  return /** @type {Template} */ ({ ...body, id: 't1', toolId: 'tool1', createdAt: '', updatedAt: '', deleted: false, deviceId: '', author: '' });
}

/**
 * @param {Partial<WikiRecipe>} [o]
 * @returns {WikiRecipe}
 */
function poly(o = {}) {
  return {
    id: 'lam-9400/lnf-poly', tool: 'tool1', name: 'LNF_Poly', about: 'Si and poly-Si etch with HBr/He.',
    films: ['Si', 'Poly-Si'], mask: ['Photoresist'], gases: ['Cl2', 'HBr', 'He'],
    steps: [
      { name: 'Breakthrough', values: [
        { l: 'Time', v: 10, u: 's', k: 'time' }, { l: 'Pressure', v: 5, u: 'mTorr', k: 'pressure' },
        { l: 'TCP Power', v: 300, u: 'W', k: 'icpPower' }, { l: 'Bias Power', v: 100, u: 'W', k: 'rfPower' },
        { l: 'Cl2 Flow', v: 60, u: 'sccm', k: 'cl2' }, { l: 'HBr Flow', v: 0, u: 'sccm', k: 'hbr' },
      ] },
      { name: 'Main Etch', values: [
        { l: 'Time', v: null, t: 'variable', k: 'time' }, { l: 'Pressure', v: 30, u: 'mTorr', k: 'pressure' },
        { l: 'TCP Power', v: 600, u: 'W', k: 'icpPower' }, { l: 'Bias Power', v: 90, u: 'W', k: 'rfPower' },
        { l: 'HBr Flow', v: 100, u: 'sccm', k: 'hbr' }, { l: 'He Flow', v: 100, u: 'sccm', k: 'he' },
        { l: 'Electrode temp', v: 20, u: '°C' },
      ] },
    ],
    main: 1, results: ['Si: 181 nm/min'], expect: { etchRate: 181 }, notes: '',
    src: 'LNF wiki: LAM 9400/Processes/LNF Poly', url: 'https://lnf-wiki.eecs.umich.edu/wiki/LAM_9400/Processes/LNF_Poly', date: '2024-09-08',
    ...o,
  };
}

test('recipeFill: the main step fills fields by key, clears unused gases and lists the rest', () => {
  const t = icpTemplate();
  const f = recipeFill(poly(), t);
  assert.equal(f.step?.name, 'Main Etch');
  assert.deepEqual(f.values, { pressure: 30, icpPower: 600, rfPower: 90, hbr: 100, he: 100, cl2: null, o2: null });
  assert.deepEqual(f.filled, ['Pressure', 'ICP power', 'RF (bias) power', 'HBr', 'He']);
  assert.deepEqual(f.cleared, ['Cl2', 'O2']);
  // A variable time fills nothing and is not reported; a value without a field is.
  assert.deepEqual(f.skipped, ['Electrode temp 20 °C']);
  const params = applyFill({ time: 120, cl2: 40, chuckTemp: 15 }, f.values);
  assert.deepEqual(params, { time: 120, chuckTemp: 15, pressure: 30, icpPower: 600, rfPower: 90, hbr: 100, he: 100 });
});

test('recipeFill: another step, input roles only, and recipes without steps', () => {
  const t = icpTemplate();
  const bt = recipeFill(poly(), t, { step: 0 });
  assert.equal(bt.values.time, 10);
  assert.equal(bt.values.hbr, 0, 'an explicit 0 flow is filled');
  assert.equal(bt.values.he, null, 'a gas the step leaves out is cleared');
  const ctxTemplate = /** @type {Template} */ ({ ...t, fields: t.fields.map((x) => (x.key === 'rfPower' ? { ...x, role: 'context' } : x)) });
  assert.ok(!('rfPower' in recipeFill(poly(), ctxTemplate, { roles: ['input'] }).values), 'lookup fills inputs only');
  assert.ok('rfPower' in recipeFill(poly(), ctxTemplate).values, 'run forms fill context fields too');
  const bare = recipeFill(poly({ steps: [], main: -1 }), t);
  assert.deepEqual([bare.values, bare.filled, bare.step], [{}, [], null]);
  // No gas flow in the step: gas fields stay as they are.
  const dry = recipeFill(poly({ steps: [{ name: '', values: [{ l: 'Pressure', v: 10, u: 'mTorr', k: 'pressure' }] }], main: 0 }), t);
  assert.deepEqual(dry.values, { pressure: 10 });
});

test('recipeFill: a ramped gas is kept, and fields of other roles are not "off the template"', () => {
  const t = icpTemplate();
  const ramped = poly({ steps: [{ name: 'Etch', values: [
    { l: 'HBr Flow', v: 100, u: 'sccm', k: 'hbr' }, { l: 'Cl2 Flow', v: null, k: 'cl2', t: '30-0 sccm (ramped)' },
    { l: 'O2 Flow', v: null, k: 'o2', t: '-' }, { l: 'He backside', v: 10, u: 'Torr', k: 'heBackside' },
  ] }], main: 0 });
  const f = recipeFill(ramped, t);
  assert.ok(!('cl2' in f.values), 'a gas listed as ramped stays as it is');
  assert.equal(f.values.o2, null, 'a gas the step marks "-" is cleared');
  assert.deepEqual(f.cleared, ['He', 'O2']);
  const lookup = recipeFill(ramped, t, { roles: ['input'] });
  assert.ok(!('heBackside' in lookup.values));
  assert.deepEqual(lookup.skipped, [], 'a context value is not reported as missing from the template');
});

test('undoFill takes back only what the fill wrote', () => {
  const before = { time: 120, cl2: 40, pressure: 12 };
  const values = { pressure: 30, hbr: 100, cl2: null };
  const after = { ...applyFill(before, values), time: 150, notes: 'x' };
  assert.deepEqual(undoFill(after, before, values), { time: 150, cl2: 40, pressure: 12, notes: 'x' });
});

test('fieldValue: values must suit the field type; choices match in any case', () => {
  const sel = { key: 'mode', label: 'Mode', type: /** @type {'select'} */ ('select'), role: /** @type {'input'} */ ('input'), options: ['Hard', 'Soft'] };
  assert.equal(fieldValue(sel, { l: 'Mode', v: 'hard contact' }), undefined);
  assert.equal(fieldValue(sel, { l: 'Mode', v: 'soft' }), 'Soft');
  const num = { key: 'p', label: 'P', type: /** @type {'number'} */ ('number'), role: /** @type {'input'} */ ('input') };
  assert.equal(fieldValue(num, { l: 'P', v: '30' }), undefined, 'text is not a number');
  assert.equal(fieldValue(num, { l: 'P', v: Number.NaN }), undefined);
  assert.equal(fieldValue(num, { l: 'P', v: 0 }), 0);
  const txt = { key: 'r', label: 'Resist', type: /** @type {'text'} */ ('text'), role: /** @type {'input'} */ ('input') };
  assert.equal(fieldValue(txt, { l: 'Resist', v: ' SPR 220 ' }), 'SPR 220');
  assert.equal(fieldValue(txt, { l: 'Resist', v: 3 }), undefined);
});

test('valueText, search, lookup by name, order and film', () => {
  assert.equal(valueText({ l: 'Time', v: 300, u: 's', t: '5 min' }), '5 min');
  assert.equal(valueText({ l: 'Power', v: 600, u: 'W' }), '600 W');
  assert.equal(valueText({ l: 'Index', v: 1.46 }), '1.46');
  assert.equal(valueText({ l: 'Time', v: null }), '–');
  const r = poly();
  assert.ok(recipeMatches(r, 'poly hbr'));
  assert.ok(recipeMatches(r, 'lnf'));
  assert.ok(recipeMatches(r, ''));
  assert.ok(!recipeMatches(r, 'oxide'));
  assert.equal(findRecipe([r], 'lnf poly'), r);
  assert.equal(findRecipe([r], 'LNF-Poly'), r);
  assert.equal(findRecipe([r], ''), null);
  assert.equal(findRecipe([r], 'LNF_Poly2'), null);
  const names = sortRecipes([poly({ name: 'Recipe 10' }), poly({ name: 'recipe 2' }), poly({ name: 'Alpha' })]).map((x) => x.name);
  assert.deepEqual(names, ['Alpha', 'recipe 2', 'Recipe 10']);
  assert.equal(recipeFilm(r), null, 'two films: the material is not set');
  assert.equal(recipeFilm(poly({ films: ['SiO2 (PECVD)'] })), 'SiO2 (PECVD)');
});

const ALL = [...ETCH, ...DEP, ...OTHER];
/** Each seeded tool with its template and any second template (a second chamber). */
const TOOLS = new Map(LNF_TOOLS.map(([id, , name, type, gases]) => {
  const seed = seedForType(type, gases);
  const extra = LNF_EXTRA_TEMPLATES.filter(([toolId]) => toolId === id).map(([, , t, g]) => seedForType(t, g).template);
  return [id, { name, ...seed, templates: [seed.template, ...extra].filter((x) => !!x) }];
}));

test('data/recipes.js loads exactly the lnf-recipes-*.js modules', () => {
  const files = readdirSync(DATA).filter((f) => /^lnf-recipes-.+\.js$/.test(f)).sort();
  const loader = readFileSync(join(DATA, 'recipes.js'), 'utf8');
  const imported = [...loader.matchAll(/import\('\.\/(lnf-recipes-[^']+\.js)'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(imported, files);
  assert.deepEqual(files, ['lnf-recipes-dep.js', 'lnf-recipes-etch.js', 'lnf-recipes-other.js']);
});

test('every shipped recipe is well formed and fits its tool\'s template', () => {
  const ids = new Set();
  /** @type {Map<string, Set<string>>} */
  const namesByTool = new Map();
  for (const r of ALL) {
    const where = `${r.id} (${r.name})`;
    assert.ok(typeof r.id === 'string' && r.id && !ids.has(r.id), `${where}: id missing or repeated`);
    ids.add(r.id);
    const tool = TOOLS.get(r.tool);
    assert.ok(tool, `${where}: unknown tool ${r.tool}`);
    assert.ok(r.name.trim() && r.name === r.name.trim(), `${where}: name`);
    const seen = namesByTool.get(r.tool) || new Set();
    assert.ok(!seen.has(normText(r.name)), `${where}: two recipes with this name on ${tool.name}`);
    namesByTool.set(r.tool, seen.add(normText(r.name)));
    for (const k of ['films', 'mask', 'gases', 'results']) {
      const list = /** @type {any} */ (r)[k];
      assert.ok(Array.isArray(list) && list.every((x) => typeof x === 'string' && x.trim()), `${where}: ${k}`);
    }
    for (const k of ['about', 'notes', 'src']) assert.equal(typeof /** @type {any} */ (r)[k], 'string', `${where}: ${k}`);
    if (r.caveat !== undefined) assert.ok(typeof r.caveat === 'string' && r.caveat.trim(), `${where}: caveat`);
    assert.match(r.url, /^https:\/\//, `${where}: url`);
    assert.match(r.date, /^20\d\d-\d\d-\d\d$/, `${where}: date`);
    assert.ok(Array.isArray(r.steps), `${where}: steps`);
    if (!r.steps.length) assert.equal(r.main, -1, `${where}: main without steps`);
    else assert.ok(Number.isInteger(r.main) && r.main >= 0 && r.main < r.steps.length, `${where}: main ${r.main}`);
    // A recipe with a process type belongs with the tool's template of that type (a second chamber).
    if (r.process !== undefined) assert.ok(PROCESS_TYPES.includes(r.process), `${where}: process ${r.process}`);
    const template = r.process ? tool.templates.find((t) => t.processType === r.process) : tool.template;
    assert.ok(!r.process || template, `${where}: ${tool.name} has no ${r.process} template`);
    const fields = new Map((template ? template.fields : []).map((f) => [f.key, f]));
    for (const s of r.steps) {
      assert.equal(typeof s.name, 'string', `${where}: step name`);
      const keys = new Set();
      for (const v of s.values) {
        assert.ok(typeof v.l === 'string' && v.l.trim(), `${where} / ${s.name}: label`);
        assert.ok(v.v === null || ['number', 'string', 'boolean'].includes(typeof v.v), `${where} / ${v.l}: value type`);
        if (typeof v.v === 'number') assert.ok(Number.isFinite(v.v), `${where} / ${v.l}: not finite`);
        if (v.t !== undefined) assert.ok(typeof v.t === 'string' && v.t.trim(), `${where} / ${v.l}: wording`);
        if (v.u !== undefined) assert.equal(typeof v.u, 'string', `${where} / ${v.l}: unit`);
        if (v.k === undefined) continue;
        const f = fields.get(v.k);
        assert.ok(f, `${where} / ${s.name || 'step'} / ${v.l}: ${tool.name}'s template has no field ${v.k}`);
        assert.notEqual(f.role, 'output', `${where} / ${v.l}: ${v.k} is an output`);
        assert.ok(!keys.has(v.k), `${where} / ${s.name || 'step'}: ${v.k} twice`);
        keys.add(v.k);
        if (v.v !== null) assert.notEqual(fieldValue(f, v), undefined, `${where} / ${v.l}: ${JSON.stringify(v.v)} does not suit ${f.type} field ${v.k}`);
        if (f.unit && f.type !== 'duration' && v.u) assert.equal(v.u, f.unit, `${where} / ${v.l}: unit ${v.u}, field ${v.k} is in ${f.unit}`);
        if (f.type === 'duration' && v.u) assert.equal(v.u, 's', `${where} / ${v.l}: durations are in seconds`);
      }
    }
    for (const [k, x] of Object.entries(r.expect)) {
      const f = fields.get(k);
      assert.ok(f && f.role === 'output', `${where}: expect.${k} is not an output of ${tool.name}`);
      assert.ok(typeof x === 'number' && Number.isFinite(x), `${where}: expect.${k}`);
    }
  }
});

test('a recipe sets the material only when its film names one listed material', () => {
  const materials = ['Si', 'SiO2 (thermal)', 'SiO2 (PECVD)', 'SiNx (PECVD)', 'Positive resist', 'Au'];
  const r = (/** @type {string[]} */ films) => poly({ films });
  assert.equal(recipeMaterial(r(['Si']), materials), 'Si');
  assert.equal(recipeMaterial(r(['sio2 (pecvd)']), materials), 'SiO2 (PECVD)', 'case and spacing ignored');
  assert.equal(recipeMaterial(r(['SiNx']), materials), 'SiNx (PECVD)', 'the only listed SiNx');
  assert.equal(recipeMaterial(r(['SiO2']), materials), null, 'several SiO2 films: ambiguous');
  assert.equal(recipeMaterial(r(['Photoresist']), materials), null, 'not in the list');
  assert.equal(recipeMaterial(r(['Si', 'Au']), materials), null, 'several films');
  assert.equal(recipeMaterial(r([]), materials), null);
});

test('recipes the wiki only names sort after the ones with parameters', () => {
  const named = poly({ name: 'BARC_1', steps: [], main: -1 });
  const sorted = sortRecipes([named, poly({ name: 'LNF_Poly' }), poly({ name: 'Bell_Poly', steps: [], main: -1 }), poly({ name: 'LNF_Al2O3' })]);
  assert.deepEqual(sorted.map((x) => x.name), ['LNF_Al2O3', 'LNF_Poly', 'BARC_1', 'Bell_Poly']);
  assert.equal(hasValues(poly()), true);
  assert.equal(hasValues(named), false);
});

test('a tool with two kinds of template shows each its own recipes', () => {
  const rie = /** @type {Template} */ ({ ...icpTemplate(), id: 'rie', processType: 'etch' });
  const pecvd = /** @type {Template} */ ({ ...icpTemplate(), id: 'pecvd', processType: 'deposition' });
  const etch = poly({ name: 'm_si_o_1', process: 'etch' });
  const dep = poly({ name: 'L_nit200', process: 'deposition' });
  const plain = poly({ name: 'house recipe' });
  assert.deepEqual(recipesFor([etch, dep, plain], rie, [rie, pecvd]), [etch, plain]);
  assert.deepEqual(recipesFor([etch, dep, plain], pecvd, [rie, pecvd]), [dep, plain], 'a recipe without a type shows with every template');
  assert.deepEqual(recipesFor([etch, dep], rie, [rie]), [etch, dep], 'one kind of template: every recipe');
  assert.equal(templateForRecipe(dep, [rie, pecvd], 'rie'), pecvd);
  assert.equal(templateForRecipe(etch, [rie, pecvd], 'rie'), rie);
  assert.equal(templateForRecipe(dep, [rie], 'rie'), rie, 'no deposition template: the default one');
  // Making the PECVD template the default changes nothing about where a typed recipe goes.
  assert.equal(templateForRecipe(etch, [rie, pecvd], 'pecvd'), rie);
  assert.equal(templateForRecipe(dep, [rie, pecvd], 'pecvd'), pecvd);
  assert.equal(templateForRecipe(plain, [rie, pecvd], 'pecvd'), pecvd, 'without a type: the default template');
  const p790 = ALL.filter((x) => x.tool === '38ec44e8-16bf-46b6-b492-a7993291dc7f');
  assert.equal(p790.filter((x) => x.process === 'deposition').length, 7, 'the Plasmatherm 790 PECVD recipes');
  assert.equal(p790.filter((x) => x.process === 'etch').length, 4, 'and its RIE recipes');
  assert.equal(p790.length, 11, 'every Plasmatherm 790 recipe names its type');
});
