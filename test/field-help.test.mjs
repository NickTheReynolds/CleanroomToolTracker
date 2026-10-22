// @ts-check
// The notes behind the "i" buttons: every seeded template field and every
// LNF gas has its own text, a key gets the text its template means, the
// Lookup line follows the field spec, and every help name the views use
// exists (a misspelt one would quietly drop the button).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aboutField, lookupUse, fieldHelp, KNOWN_KEYS } from '../app/js/core/field-help.js';
import { HELP, TUNING_HELP } from '../app/js/core/app-help.js';
import { TUNABLE } from '../app/js/config.js';
import { DERIVED_INFO } from '../app/js/core/derive.js';
import { LNF_TOOLS } from '../app/js/data/seed-lnf.js';
import { seedForType, knownTypes, gasKey } from '../app/js/data/seed-types.js';
import { SEED_TEMPLATES } from '../app/js/data/seed-templates.js';

/** @typedef {import('../app/js/core/types.js').FieldSpec} FieldSpec */
/** @typedef {import('../app/js/core/field-help.js').TemplateLike} TemplateLike */

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'js');

/** @returns {{source: string, template: TemplateLike & {fields: FieldSpec[]}}[]} every seeded template */
function seededTemplates() {
  const out = [];
  for (const [, , name, type, gases] of LNF_TOOLS) {
    const s = seedForType(type, gases);
    if (s.template) out.push({ source: name, template: s.template });
  }
  for (const type of knownTypes()) {
    const s = seedForType(type, []);
    if (s.template) out.push({ source: `type ${type}`, template: s.template });
  }
  for (const t of SEED_TEMPLATES) out.push({ source: 'example tools', template: /** @type {any} */ (t) });
  return out;
}

/**
 * The text a field gets in the first seeded template with this name.
 * @param {string} templateName
 * @param {string} key
 * @returns {string}
 */
function textFor(templateName, key) {
  const found = seededTemplates().find((x) => x.template.name === templateName && x.template.fields.some((f) => f.key === key));
  assert.ok(found, `no seeded template "${templateName}" with field ${key}`);
  const t = found.template;
  return aboutField(/** @type {FieldSpec} */ (t.fields.find((f) => f.key === key)), t);
}

test('every field of every seeded template has its own note and a Lookup line', () => {
  const missing = [];
  for (const { source, template } of seededTemplates()) {
    for (const f of template.fields) {
      const about = aboutField(f, template);
      if (!about || / a gas line\./.test(about)) missing.push(`${source} / ${template.name}: ${f.key}`);
      assert.equal(fieldHelp(f, template).length, 2, `${template.name}: ${f.key} should have a note and a Lookup line`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every gas an LNF tool lists has its own text', () => {
  const gases = new Set(LNF_TOOLS.flatMap((row) => row[4]));
  const missing = [...gases].filter((g) => !KNOWN_KEYS.gases.includes(gasKey(g)));
  assert.deepEqual(missing, []);
});

test('a key gets the text its template means', () => {
  assert.match(textFor('XeF2 etch', 'pressure'), /XeF2/);
  assert.match(textFor('CMP', 'pressure'), /Preston/);
  assert.match(textFor('Nanoimprint', 'pressure'), /stamp/);
  assert.match(textFor('Sputter film', 'pressure'), /sputter/i);
  assert.match(textFor('LPCVD film', 'pressure'), /LPCVD/);
  assert.match(textFor('PECVD film', 'pressure'), /deposition/);
  assert.match(textFor('ICP etch', 'pressure'), /anisotropic/);
  assert.match(textFor('Plasma clean / descum', 'pressure'), /clean/);
  assert.match(textFor('ICP etch', 'rfPower'), /bias/);
  assert.match(textFor('RIE etch', 'rfPower'), /reactive ion etcher/);
  assert.match(textFor('PECVD film', 'rfPower'), /deposition rate/);
  assert.match(textFor('Sputter film', 'source'), /DC/);
  assert.match(textFor('E-beam evaporation', 'source'), /evaporated/);
  assert.match(textFor('Deep Si etch (DRIE)', 'cycles'), /passivation/);
  assert.match(textFor('ALD film', 'cycles'), /growth per cycle/);
  assert.match(textFor('XeF2 etch', 'cycles'), /pulses/);
  assert.match(textFor('Furnace oxidation', 'time'), /square root/);
  // "Oxide etch" is an etch: it must not get the oxidation texts.
  assert.doesNotMatch(textFor('Oxide etch', 'time'), /oxide/i);
  assert.match(textFor('Oxide etch', 'time'), /etch runs/);
  assert.match(textFor('Furnace oxidation', 'ambient'), /steam/);
  assert.match(textFor('Furnace anneal', 'ambient'), /forming gas/i);
  assert.match(textFor('E-beam write', 'dose'), /proximity/);
  assert.match(textFor('Contact exposure', 'dose'), /lamp intensity/);
  assert.match(textFor('Laser write', 'dose'), /Laser/);
  assert.match(textFor('Wire bonding', 'time'), /ultrasonic/);
  assert.match(textFor('Wire bonding', 'force'), /wire/);
  assert.match(textFor('Wafer bonding', 'force'), /wafers/);
  assert.match(textFor('Reflectometry', 'model'), /film stack/);
  assert.match(textFor('Ellipsometry', 'model'), /optical model/);
});

test('a note survives the edits people make to a template', () => {
  /** @param {string} type @param {string} [name] @returns {TemplateLike & {fields: FieldSpec[]}} */
  const seeded = (type, name) => {
    const t = /** @type {TemplateLike & {fields: FieldSpec[]}} */ (structuredClone(seedForType(type, []).template));
    if (name) t.name = name;
    return t;
  };
  /** @param {TemplateLike & {fields: FieldSpec[]}} t @param {string} key @param {Partial<FieldSpec>} [patch] */
  const about = (t, key, patch = {}) => {
    const f = t.fields.find((x) => x.key === key) || /** @type {FieldSpec} */ ({ key, label: key, type: 'number', role: 'input' });
    return aboutField({ ...f, ...patch }, t);
  };
  // A unit changed in the field editor keeps the template's own note.
  assert.match(about(seeded('pecvd'), 'pressure', { unit: 'Torr' }), /deposition/);
  assert.doesNotMatch(about(seeded('lpcvd'), 'pressure', { unit: 'Torr' }), /XeF2/);
  assert.match(about(seeded('ald'), 'pulse', { unit: 's' }), /precursor/);
  assert.match(about(seeded('cmp'), 'pressure', { unit: 'kPa' }), /Preston/);
  assert.match(about(seeded('sputter'), 'power', { unit: 'kW' }), /target/);
  assert.match(about(seeded('ebeam-lithography'), 'current', { unit: 'pA' }), /Beam current/);
  assert.match(about(seeded('wire-bonder'), 'power', { unit: 'W' }), /Ultrasonic/);
  // A field of another kind with a familiar unit does not borrow another tool's note.
  assert.doesNotMatch(about(seeded('critical-point-dryer'), 'pressure', { unit: 'psi' }), /pad/);
  assert.doesNotMatch(about(seeded('die-bonder'), 'force', { unit: 'g' }), /wire/);
  assert.doesNotMatch(about(seeded('parylene'), 'pressure', { unit: 'mTorr' }), /LPCVD/);
  assert.doesNotMatch(about(seeded('ebeam-evaporation'), 'source', { type: 'select', options: ['Ti', 'Au'] }), /Power supply/);
  // A renamed template keeps its notes, and a name that only looks alike does not take them.
  assert.match(about(seeded('plasma-clean', 'Glen O2'), 'pressure'), /clean/);
  assert.match(about(seeded('oxidation-furnace', 'Wet ox 1100C'), 'temp'), /Oxide grows/);
  assert.match(about(seeded('anneal-furnace', 'Post-oxidation anneal'), 'temp'), /Anneal temperature/);
  assert.match(about(seeded('critical-point-dryer', 'CPD'), 'time'), /purge/);
  assert.doesNotMatch(about(seeded('other', 'Spin Rinse Dryer'), 'time'), /purge/);
  assert.match(about(seeded('drie'), 'time'), /aspect-ratio/);
});

test('a gas text fits the process it is used in', () => {
  const pecvd = /** @type {TemplateLike & {fields: FieldSpec[]}} */ (seedForType('pecvd', ['SiH4', 'NF3', 'CF4']).template);
  const icp = /** @type {TemplateLike & {fields: FieldSpec[]}} */ (seedForType('icp-etch', ['NF3', 'CF4', 'O2']).template);
  const about = (/** @type {TemplateLike & {fields: FieldSpec[]}} */ t, /** @type {string} */ key) =>
    aboutField(/** @type {FieldSpec} */ (t.fields.find((f) => f.key === key)), t);
  assert.match(about(pecvd, 'nf3'), /clean the chamber/);
  assert.match(about(icp, 'nf3'), /etching/);
  assert.match(about(pecvd, 'cf4'), /clean the chamber/);
  assert.match(about(icp, 'o2'), /resist/);
  for (const key of ['sih4', 'nf3', 'cf4']) assert.match(about(pecvd, key), /Flow in sccm/);
  // The flow sentence follows the unit; a gas the app knows nothing about still says what it is.
  assert.match(aboutField({ key: 'n2', label: 'N2', type: 'number', role: 'context', unit: 'slm' }, pecvd), /Flow in slm/);
  assert.doesNotMatch(aboutField({ key: 'n2', label: 'N2', type: 'number', role: 'input', unit: 'Torr', chemistry: true }, pecvd), /Flow in/);
  assert.equal(aboutField({ key: 'zz9', label: 'ZZ9', type: 'number', role: 'input', unit: 'sccm', chemistry: true }, pecvd),
    'ZZ9: a gas line. Flow in sccm (standard cubic centimetres per minute).');
});

test('the Lookup line follows the field spec', () => {
  /** @param {Partial<FieldSpec>} f @returns {FieldSpec} */
  const spec = (f) => /** @type {FieldSpec} */ ({ key: 'x', label: 'X', type: 'number', role: 'input', ...f });
  assert.match(lookupUse(spec({ role: 'context' })), /never matches/);
  assert.match(lookupUse(spec({ type: 'duration', unit: 's' })), /leaves it out/);
  assert.match(lookupUse(spec({ type: 'duration', unit: 's', weight: 0 })), /leaves it out/);
  assert.match(lookupUse(spec({ weight: 0 })), /ignores it/);
  assert.match(lookupUse(spec({ weight: -2 })), /ignores it/);
  assert.equal(lookupUse(spec({ unit: 'mTorr', spreadHint: 5, weight: 1 })),
    'Lookup prefers past runs close to this value: a difference of 5 mTorr adds 1 to the distance.');
  assert.match(lookupUse(spec({ unit: 'W', spreadHint: 25, weight: 2 })), /a difference of 25 W adds 2 to the distance/);
  assert.match(lookupUse(spec({ type: 'duration', unit: 's', weight: 1, spreadHint: 30 })), /a difference of 30 s adds 1/);
  assert.match(lookupUse(spec({ unit: 'W' })), /spread of your similar past runs once at least 4/);
  assert.match(lookupUse(spec({ unit: 'sccm', weight: 0, chemistry: true })), /out of the distance \(weight 0\)\. With Strict chemistry/);
  assert.match(lookupUse(spec({ unit: 'sccm', spreadHint: 10, chemistry: true })), /leave a gas you will not use empty rather than 0/);
  assert.match(lookupUse(spec({ type: 'text', matchExact: true })), /only compares runs with the same value/);
  assert.match(lookupUse(spec({ type: 'select', options: ['A', 'B'] })), /a different one adds 1 to the distance/);
  assert.match(lookupUse(spec({ unit: 'sccm', spreadHint: 10, chemistry: true })), /Strict chemistry/);
  const t = { fields: [], derived: [{ output: 'rate', fn: 'etchRate' }], primaryOutput: 'rate' };
  const out = lookupUse(spec({ key: 'rate', role: 'output', unit: 'nm/min' }), t);
  assert.match(out, /main result/);
  assert.ok(out.includes(DERIVED_INFO.etchRate.formula), out);
  assert.match(lookupUse(spec({ key: 'other', role: 'output' }), t), /^A result, kept with the run\./);
  const withInputs = { ...t, fields: [spec({ key: 'p' })] };
  assert.match(lookupUse(spec({ key: 'rate', role: 'output', unit: 'nm/min' }), withInputs), /Lookup estimates it first/);
  assert.match(lookupUse(spec({ key: 'other', role: 'output' }), withInputs), /^A result\. Lookup can estimate it/);
  assert.match(lookupUse(spec({ key: 'note', role: 'output', type: 'text' }), withInputs), /^A result, kept with the run\./);
});

test('every Lookup tuning constant has a note, and nothing else does', () => {
  assert.deepEqual(Object.keys(TUNING_HELP).sort(), TUNABLE.map((t) => t.key).sort());
  for (const t of TUNABLE) assert.ok(TUNING_HELP[t.key].length >= 2, `${t.key} needs what it does and what changing it does`);
});

test('the notes are short plain sentences', () => {
  const texts = [...Object.values(HELP), ...Object.values(TUNING_HELP).flat()];
  for (const { template } of seededTemplates()) for (const f of template.fields) texts.push(...fieldHelp(f, template));
  for (const s of texts) {
    assert.ok(s.length <= 420, `too long (${s.length}): ${s.slice(0, 60)}…`);
    assert.match(s, /[.)”]$/, `ends without a full stop: ${s.slice(-40)}`);
    assert.doesNotMatch(s, /<|>|\s{2}/, `markup or double space: ${s.slice(0, 60)}`);
  }
});

test('every help name the app uses exists, and every help text is used', () => {
  /** @param {string} dir @returns {string[]} */
  const files = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []));
  const used = new Set();
  for (const f of files(APP)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\bHELP\.(\w+)/g)) {
      assert.ok(m[1] in HELP, `${f} uses HELP.${m[1]}, which does not exist`);
      used.add(m[1]);
    }
  }
  assert.deepEqual(Object.keys(HELP).filter((k) => !used.has(k)), []);
});
