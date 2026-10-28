// @ts-check
/**
 * Generic template for each kind of tool. A seeded tool gets its own copy of
 * its type's template; etch and deposition tools get the gas lines its LNF
 * wiki page lists. These are parameter sets, not LNF recipes.
 */

/** @typedef {import('../core/types.js').FieldSpec} FieldSpec */
/** @typedef {import('../core/types.js').DerivedSpec} DerivedSpec */
/**
 * @typedef {Object} TemplateBody
 * @property {string} name
 * @property {string} processType
 * @property {string | null} primaryOutput
 * @property {FieldSpec[]} fields
 * @property {DerivedSpec[]} derived
 */

/**
 * @param {string} key @param {string} label @param {string} unit @param {number} step @param {number} spread
 * @param {Partial<FieldSpec>} [extra]
 * @returns {FieldSpec}
 */
const num = (key, label, unit, step, spread, extra = {}) => ({
  key, label, type: 'number', unit, role: 'input', step, min: 0, spreadHint: spread, weight: 1, ...extra,
});
/** @param {Partial<FieldSpec>} [extra] @returns {FieldSpec} */
const time = (extra = {}) => ({ key: 'time', label: 'Time', type: 'duration', unit: 's', role: 'input', step: 10, min: 0, weight: 0, ...extra });
/** @param {string} key @param {string} label @param {string} unit @param {number} step @returns {FieldSpec} */
const ctx = (key, label, unit, step) => ({ key, label, type: 'number', unit, role: 'context', step });
/** @param {string} key @param {string} label @param {string} unit @returns {FieldSpec} */
const out = (key, label, unit) => ({ key, label, type: 'number', unit, role: 'output' });
/** @param {string} key @param {string} label @param {string[]} [options] @returns {FieldSpec} */
const exact = (key, label, options) => (options
  ? { key, label, type: 'select', role: 'input', options, matchExact: true }
  : { key, label, type: 'text', role: 'input', matchExact: true });
/** @param {string} key @param {string} label @returns {FieldSpec} */
const note = (key, label) => ({ key, label, type: 'text', role: 'context' });

/** Typical run-to-run spread per gas, sccm; others use 10. */
const GAS_SPREAD = /** @type {Record<string, number>} */ ({ o2: 5, n2: 100, n2o: 50, sih4: 20, nh3: 10, ar: 10, he: 50, h2: 10 });

/**
 * A stable field key for a gas name: "C4F8" -> "c4f8", "SiH2Cl2 (DCS)" -> "sih2cl2dcs".
 * @param {string} gas
 * @returns {string}
 */
export function gasKey(gas) {
  const k = String(gas).normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return /^[a-z]/.test(k) ? k.slice(0, 40) : `gas${k}`.slice(0, 40);
}

/**
 * Chemistry fields for a list of gases (duplicates by key dropped).
 * @param {string[]} gases
 * @returns {FieldSpec[]}
 */
export function gasFields(gases) {
  const seen = new Set();
  /** @type {FieldSpec[]} */
  const fields = [];
  for (const g of gases) {
    const key = gasKey(g);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fields.push(num(key, String(g).trim(), 'sccm', 1, GAS_SPREAD[key] || 10, { chemistry: true }));
  }
  return fields;
}

const RATE_DERIVED = /** @type {DerivedSpec[]} */ ([
  { output: 'etchRate', fn: 'etchRate', timeField: 'time' },
  { output: 'removed', fn: 'removed' },
  { output: 'uniformity', fn: 'uniformity', phase: 'post' },
]);
const ETCH_OUT = [out('etchRate', 'Etch rate', 'nm/min'), out('removed', 'Removed', 'nm'), out('uniformity', 'Uniformity', '%')];
const DEP_OUT = [out('thickness', 'Thickness', 'nm'), out('depRate', 'Deposition rate', 'nm/min'), out('uniformity', 'Uniformity', '%')];
const DEP_DERIVED = /** @type {DerivedSpec[]} */ ([
  { output: 'thickness', fn: 'deposited' },
  { output: 'depRate', fn: 'depRate', timeField: 'time' },
  { output: 'uniformity', fn: 'uniformity', phase: 'post' },
]);
const EXPOSE_OUT = [out('cd', 'Critical dimension', 'µm'), out('sidewall', 'Sidewall angle', '°')];
/** @param {FieldSpec[]} [extra] inputs after the dose @returns {FieldSpec[]} */
const laserWrite = (extra = []) => [
  exact('resist', 'Resist'), num('dose', 'Dose', 'mJ/cm²', 5, 20), ...extra, num('focus', 'Defocus', '', 1, 2, { min: undefined }),
  ctx('resistThickness', 'Resist thickness', 'nm', 10), { key: 'devTime', label: 'Develop time', type: 'duration', unit: 's', role: 'context', step: 5 },
  ...EXPOSE_OUT,
];

/**
 * @param {string} name @param {string} processType @param {string | null} primary
 * @param {FieldSpec[]} fields @param {DerivedSpec[]} [derived]
 * @returns {TemplateBody}
 */
const t = (name, processType, primary, fields, derived = []) => ({ name, processType, primaryOutput: primary, fields, derived });

/**
 * Template builders by tool type. `gases` is the tool's own gas list from
 * its wiki page (empty when the page lists none; the default then applies).
 * @type {Record<string, (gases: string[]) => TemplateBody>}
 */
const BUILDERS = {
  'icp-etch': (g) => t('ICP etch', 'etch', 'etchRate', [
    num('icpPower', 'ICP power', 'W', 10, 100), num('rfPower', 'RF (bias) power', 'W', 5, 25), num('pressure', 'Pressure', 'mTorr', 1, 5),
    ...gasFields(g.length ? g : ['CF4', 'CHF3', 'C4F8', 'SF6', 'O2', 'Ar', 'Cl2', 'BCl3']), time(),
    ctx('chuckTemp', 'Chuck temp', '°C', 1), ctx('heBackside', 'He backside', 'Torr', 1),
    ...ETCH_OUT, out('selectivity', 'Selectivity', 'ratio'),
  ], [...RATE_DERIVED, { output: 'selectivity', fn: 'selectivity' }]),
  'rie-etch': (g) => t('RIE etch', 'etch', 'etchRate', [
    num('rfPower', 'RF power', 'W', 5, 25), num('pressure', 'Pressure', 'mTorr', 1, 5),
    ...gasFields(g.length ? g : ['CF4', 'CHF3', 'SF6', 'O2', 'Ar']), time(), ctx('chuckTemp', 'Chuck temp', '°C', 1),
    ...ETCH_OUT, out('selectivity', 'Selectivity', 'ratio'),
  ], [...RATE_DERIVED, { output: 'selectivity', fn: 'selectivity' }]),
  drie: (g) => t('Deep Si etch (DRIE)', 'etch', 'etchRateUm', [
    num('icpPower', 'Coil (ICP) power', 'W', 10, 100), num('platenPower', 'Platen power', 'W', 1, 5), num('pressure', 'Pressure', 'mTorr', 1, 5),
    ...gasFields(g.length ? g : ['SF6', 'C4F8', 'O2']), num('etchStep', 'Etch step', 's', 0.1, 0.5), num('passStep', 'Passivation step', 's', 0.1, 0.5),
    num('cycles', 'Cycles', 'cycles', 10, 50, { weight: 0 }), time(),
    out('depth', 'Etch depth', 'µm'), out('etchRateUm', 'Etch rate', 'µm/min'), out('selectivity', 'Selectivity', 'ratio'), out('sidewall', 'Sidewall angle', '°'),
  ]),
  'xef2-etch': () => t('XeF2 etch', 'etch', 'depth', [
    num('pressure', 'XeF2 pressure', 'Torr', 0.1, 0.5), num('pulse', 'Pulse time', 's', 1, 5), num('cycles', 'Cycles', 'cycles', 1, 5),
    out('depth', 'Etch depth / undercut', 'µm'),
  ]),
  'ion-mill': (g) => t('Ion mill', 'etch', 'etchRate', [
    num('beamVoltage', 'Beam voltage', 'V', 10, 50), num('beamCurrent', 'Beam current', 'mA', 1, 10), num('angle', 'Stage angle', '°', 5, 10, { max: 90 }),
    ...gasFields(g.length ? g : ['Ar']), time(), ...ETCH_OUT,
  ], RATE_DERIVED),
  'plasma-clean': (g) => t('Plasma clean / descum', 'etch', 'etchRate', [
    num('rfPower', 'RF power', 'W', 10, 50), num('pressure', 'Pressure', 'mTorr', 10, 50), ...gasFields(g.length ? g : ['O2', 'Ar', 'CF4']), time(),
    ...ETCH_OUT,
  ], RATE_DERIVED),
  'wet-etch': () => t('Wet etch', 'etch', 'etchRate', [
    exact('etchant', 'Etchant'), note('ratio', 'Mix / concentration'), num('temp', 'Temperature', '°C', 1, 2), time({ weight: 0 }),
    ...ETCH_OUT,
  ], RATE_DERIVED),
  'wet-bench': () => t('Wet process', 'wet', null, [exact('chemistry', 'Chemistry'), num('temp', 'Temperature', '°C', 1, 2), time()]),
  'solvent-clean': () => t('Solvent clean', 'wet', null, [note('sequence', 'Solvents / sequence'), time()]),
  pecvd: (g) => t('PECVD film', 'deposition', 'depRate', [
    num('rfPower', 'RF power', 'W', 5, 20), num('pressure', 'Pressure', 'mTorr', 10, 100), num('temp', 'Temperature', '°C', 5, 25),
    ...gasFields(g.length ? g : ['SiH4', 'N2O', 'NH3', 'N2']), time(),
    ...DEP_OUT, out('refractiveIndex', 'Refractive index', ''), out('stress', 'Stress', 'MPa'),
  ], DEP_DERIVED),
  lpcvd: (g) => t('LPCVD film', 'deposition', 'depRate', [
    num('temp', 'Temperature', '°C', 5, 10), num('pressure', 'Pressure', 'mTorr', 10, 50),
    ...gasFields(g.length ? g : ['SiH4', 'SiH2Cl2', 'NH3', 'N2O', 'O2']), time(),
    ...DEP_OUT, out('refractiveIndex', 'Refractive index', ''), out('stress', 'Stress', 'MPa'),
  ], DEP_DERIVED),
  sputter: (g) => t('Sputter film', 'deposition', 'depRate', [
    exact('target', 'Target'), exact('source', 'Power supply', ['DC', 'RF', 'Pulsed DC']), num('power', 'Power', 'W', 10, 50),
    num('pressure', 'Pressure', 'mTorr', 0.5, 1), ...gasFields(g.length ? g : ['Ar', 'N2', 'O2']), time(), ctx('substrateTemp', 'Substrate temp', '°C', 5),
    ...DEP_OUT, out('sheetResistance', 'Sheet resistance', 'Ω/sq'), out('stress', 'Stress', 'MPa'),
  ], DEP_DERIVED),
  'ebeam-evaporation': () => t('E-beam evaporation', 'deposition', 'thickness', [
    exact('source', 'Source material'), num('rateSetpoint', 'Rate setpoint', 'Å/s', 0.1, 0.5), num('qcmThickness', 'QCM thickness', 'nm', 5, 50),
    time(), ctx('basePressure', 'Base pressure', 'µTorr', 0.1), ...DEP_OUT,
  ], DEP_DERIVED),
  'thermal-evaporation': () => t('Thermal evaporation', 'deposition', 'thickness', [
    exact('source', 'Source material'), num('rateSetpoint', 'Rate setpoint', 'Å/s', 0.1, 0.5), num('qcmThickness', 'QCM thickness', 'nm', 5, 50),
    time(), ctx('basePressure', 'Base pressure', 'µTorr', 0.1), ...DEP_OUT,
  ], DEP_DERIVED),
  ald: () => t('ALD film', 'deposition', 'thickness', [
    exact('precursor', 'Precursor'), exact('coreactant', 'Co-reactant', ['H2O', 'O3', 'O2 plasma', 'N2 plasma', 'NH3 plasma']),
    num('temp', 'Temperature', '°C', 5, 25), num('cycles', 'Cycles', 'cycles', 10, 50), ctx('pulse', 'Precursor pulse', 'ms', 5), ctx('purge', 'Purge', 's', 1),
    out('thickness', 'Thickness', 'nm'), out('gpc', 'Growth per cycle', 'Å/cycle'), out('uniformity', 'Uniformity', '%'), out('refractiveIndex', 'Refractive index', ''),
  ], [{ output: 'thickness', fn: 'deposited' }, { output: 'uniformity', fn: 'uniformity', phase: 'post' }]),
  electroplating: () => t('Electroplating', 'deposition', 'thickness', [
    exact('bath', 'Bath / metal'), num('current', 'Current density', 'mA/cm²', 0.5, 2), num('temp', 'Temperature', '°C', 1, 2), time({ weight: 1, spreadHint: 300 }),
    ...DEP_OUT,
  ], DEP_DERIVED),
  parylene: () => t('Parylene coating', 'deposition', 'thickness', [
    exact('dimer', 'Parylene type', ['C', 'N', 'D', 'HT']), num('dimerMass', 'Dimer mass', 'g', 0.1, 1),
    out('thickness', 'Thickness', 'nm'), out('uniformity', 'Uniformity', '%'),
  ], [{ output: 'thickness', fn: 'deposited' }, { output: 'uniformity', fn: 'uniformity', phase: 'post' }]),
  'oxidation-furnace': (g) => t('Furnace oxidation', 'thermal', 'thickness', [
    exact('ambient', 'Ambient', ['Dry O2', 'Wet (steam)']), num('temp', 'Temperature', '°C', 10, 25), time({ step: 60, weight: 1, spreadHint: 600 }),
    ...(g.length ? gasFields(g).map((f) => ({ ...f, role: /** @type {'context'} */ ('context'), chemistry: undefined })) : [ctx('o2Flow', 'O2 flow', 'slm', 0.5)]),
    out('thickness', 'Thickness', 'nm'), out('uniformity', 'Uniformity', '%'), out('refractiveIndex', 'Refractive index', ''),
  ], [{ output: 'thickness', fn: 'deposited' }, { output: 'uniformity', fn: 'uniformity', phase: 'post' }]),
  'anneal-furnace': () => t('Furnace anneal', 'thermal', 'sheetResistance', [
    exact('ambient', 'Ambient', ['N2', 'Ar', 'Forming gas', 'O2', 'Vacuum']), num('temp', 'Temperature', '°C', 10, 25), time({ step: 60, weight: 1, spreadHint: 600 }),
    out('sheetResistance', 'Sheet resistance', 'Ω/sq'), out('stress', 'Stress', 'MPa'),
  ]),
  rta: () => t('Rapid thermal anneal', 'thermal', 'sheetResistance', [
    exact('ambient', 'Ambient', ['N2', 'Ar', 'Forming gas', 'O2', 'Vacuum']), num('temp', 'Temperature', '°C', 10, 25),
    time({ step: 5, weight: 1, spreadHint: 30 }), ctx('ramp', 'Ramp rate', '°C/s', 5),
    out('sheetResistance', 'Sheet resistance', 'Ω/sq'),
  ]),
  'spin-coat': () => t('Spin coat', 'litho', 'thickness', [
    exact('resist', 'Resist'), num('speed', 'Spin speed', 'rpm', 100, 500), { ...time({ step: 5 }), key: 'spinTime', label: 'Spin time' },
    ctx('accel', 'Acceleration', 'rpm/s', 100), ctx('bakeTemp', 'Soft bake temp', '°C', 5),
    { key: 'bakeTime', label: 'Soft bake time', type: 'duration', unit: 's', role: 'context', step: 10 },
    out('thickness', 'Thickness', 'nm'), out('uniformity', 'Uniformity', '%'),
  ], [{ output: 'thickness', fn: 'deposited' }, { output: 'uniformity', fn: 'uniformity', phase: 'post' }]),
  bake: () => t('Bake', 'litho', null, [exact('purpose', 'Purpose', ['Soft bake', 'Post-exposure bake', 'Hard bake', 'Dehydration', 'Other']),
    num('temp', 'Temperature', '°C', 5, 5), time({ weight: 1, spreadHint: 30 })]),
  'mask-aligner': () => t('Contact exposure', 'litho', 'cd', [
    exact('resist', 'Resist'), num('dose', 'Dose', 'mJ/cm²', 5, 20), exact('mode', 'Contact mode', ['Hard', 'Soft', 'Vacuum', 'Proximity']),
    ctx('resistThickness', 'Resist thickness', 'nm', 10), { key: 'devTime', label: 'Develop time', type: 'duration', unit: 's', role: 'context', step: 5 },
    ...EXPOSE_OUT,
  ]),
  stepper: () => t('Stepper exposure', 'litho', 'cd', [
    exact('resist', 'Resist'), num('dose', 'Dose (or exposure time)', 'mJ/cm²', 5, 20), num('focus', 'Focus offset', 'µm', 0.1, 0.2, { min: undefined }),
    ctx('resistThickness', 'Resist thickness', 'nm', 10), { key: 'devTime', label: 'Develop time', type: 'duration', unit: 's', role: 'context', step: 5 },
    ...EXPOSE_OUT,
  ]),
  'laser-writer': () => t('Laser write', 'litho', 'cd', laserWrite()),
  // The µPG 501 is set by an exposure time; the LNF wiki posts the standard value (45 ms).
  'mask-maker': () => t('Laser write', 'litho', 'cd', laserWrite([num('exposeTime', 'Expose time', 'ms', 1, 5)])),
  'ebeam-lithography': () => t('E-beam write', 'litho', 'linewidth', [
    exact('resist', 'Resist'), num('dose', 'Dose', 'µC/cm²', 10, 50), num('current', 'Beam current', 'nA', 0.1, 1),
    ctx('stepSize', 'Beam step', 'nm', 1), ctx('resistThickness', 'Resist thickness', 'nm', 10),
    { key: 'devTime', label: 'Develop time', type: 'duration', unit: 's', role: 'context', step: 5 },
    out('linewidth', 'Line width', 'nm'),
  ]),
  nanoimprint: () => t('Nanoimprint', 'litho', 'residual', [
    exact('resist', 'Resist'), num('temp', 'Temperature', '°C', 5, 10), num('pressure', 'Pressure', 'bar', 1, 5), time({ weight: 1, spreadHint: 60 }),
    out('residual', 'Residual layer', 'nm'),
  ]),
  develop: () => t('Develop', 'litho', 'cd', [
    exact('developer', 'Developer'), time({ weight: 1, spreadHint: 10, step: 5 }), num('temp', 'Temperature', '°C', 1, 1), ...EXPOSE_OUT,
  ]),
  cmp: () => t('CMP', 'other', 'etchRate', [
    exact('slurry', 'Slurry'), num('pressure', 'Down pressure', 'psi', 0.5, 1), num('platen', 'Platen speed', 'rpm', 5, 10),
    num('carrier', 'Carrier speed', 'rpm', 5, 10), time(), out('etchRate', 'Removal rate', 'nm/min'), out('removed', 'Removed', 'nm'),
    out('uniformity', 'Uniformity', '%'),
  ], RATE_DERIVED),
  'wafer-bonder': () => t('Wafer bonding', 'other', null, [
    exact('method', 'Bond type', ['Anodic', 'Fusion', 'Eutectic', 'Thermocompression', 'Adhesive']), num('temp', 'Temperature', '°C', 10, 20),
    num('force', 'Force', 'kN', 0.5, 1), num('voltage', 'Voltage', 'V', 50, 100, { weight: 0 }), time({ weight: 1, spreadHint: 300 }),
  ]),
  'critical-point-dryer': () => t('Critical point dry', 'other', null, [time(), note('recipe', 'Program')]),
  'dicing-saw': () => t('Dicing', 'other', null, [exact('blade', 'Blade'), num('spindle', 'Spindle speed', 'krpm', 1, 2), num('feed', 'Feed rate', 'mm/s', 0.5, 1)]),
  'wire-bonder': () => t('Wire bonding', 'other', 'pull', [exact('wire', 'Wire', ['Au', 'Al']), num('power', 'Ultrasonic power', '', 1, 5),
    num('time', 'Bond time', 'ms', 5, 10), num('force', 'Bond force', 'g', 1, 5), out('pull', 'Pull strength', 'g')]),
  'die-bonder': () => t('Die bonding', 'other', null, [exact('adhesive', 'Adhesive / method'), num('temp', 'Temperature', '°C', 5, 10), time()]),
  ellipsometer: () => t('Ellipsometry', 'metrology', 'thickness', [note('model', 'Fit model'),
    out('thickness', 'Thickness', 'nm'), out('refractiveIndex', 'Refractive index', ''), out('uniformity', 'Uniformity', '%'), out('gof', 'Fit quality (GOF)', '')],
  [{ output: 'uniformity', fn: 'uniformity', phase: 'post' }]),
  reflectometer: () => t('Reflectometry', 'metrology', 'thickness', [note('model', 'Film stack'),
    out('thickness', 'Thickness', 'nm'), out('uniformity', 'Uniformity', '%')], [{ output: 'uniformity', fn: 'uniformity', phase: 'post' }]),
  profilometer: () => t('Profilometry', 'metrology', 'stepHeight', [ctx('scanLength', 'Scan length', 'µm', 100), ctx('stylusForce', 'Stylus force', 'mg', 0.5),
    out('stepHeight', 'Step height', 'nm'), out('uniformity', 'Uniformity', '%')], [{ output: 'uniformity', fn: 'uniformity', phase: 'post', kind: 'stepHeight' }]),
  'optical-profilometer': () => t('Optical profilometry', 'metrology', 'stepHeight', [note('objective', 'Objective / mode'),
    out('stepHeight', 'Step height', 'nm'), out('roughness', 'Roughness (Ra)', 'nm')]),
  'four-point-probe': () => t('Sheet resistance', 'metrology', 'sheetResistance', [note('probe', 'Probe / program'),
    out('sheetResistance', 'Sheet resistance', 'Ω/sq'), out('uniformity', 'Uniformity', '%')],
  [{ output: 'uniformity', fn: 'uniformity', phase: 'post', kind: 'sheetResistance' }]),
  stress: () => t('Film stress', 'metrology', 'stress', [note('film', 'Film'), out('stress', 'Stress', 'MPa')]),
  afm: () => t('AFM scan', 'metrology', 'roughness', [ctx('scanSize', 'Scan size', 'µm', 1), out('roughness', 'Roughness (Ra)', 'nm'), out('stepHeight', 'Step height', 'nm')]),
  other: () => t('General process', 'other', null, [time(), note('settings', 'Settings')]),
};

/** Tool types whose tools get no template (pure inspection tools): they still appear as metrology tools for measurements. */
const NO_TEMPLATE = new Set(['sem', 'optical-microscope', 'xrd']);

const METROLOGY_TYPES = new Set(['ellipsometer', 'reflectometer', 'profilometer', 'optical-profilometer', 'sem', 'afm',
  'optical-microscope', 'four-point-probe', 'xrd', 'stress']);

/** App category for each tool type. The wet benches (acid, base, solvent, clean, wet etch) have their own since seed 5. */
const CATEGORY_BY_TYPE = /** @type {Record<string, string>} */ ({
  'icp-etch': 'etch', 'rie-etch': 'etch', drie: 'etch', 'xef2-etch': 'etch', 'ion-mill': 'etch', 'plasma-clean': 'etch',
  'wet-etch': 'wet', 'wet-bench': 'wet', 'solvent-clean': 'wet',
  pecvd: 'deposition', lpcvd: 'deposition', sputter: 'deposition', 'ebeam-evaporation': 'deposition', 'thermal-evaporation': 'deposition',
  ald: 'deposition', electroplating: 'deposition', parylene: 'deposition',
  'oxidation-furnace': 'thermal', 'anneal-furnace': 'thermal', rta: 'thermal',
  'spin-coat': 'litho', bake: 'litho', 'mask-aligner': 'litho', stepper: 'litho', 'laser-writer': 'litho', 'mask-maker': 'litho',
  'ebeam-lithography': 'litho', nanoimprint: 'litho', develop: 'litho',
});

/**
 * Category, kind and template body for a tool type.
 * @param {string} type one of the wiki research vocabulary
 * @param {string[]} [gases] the tool's gas lines, if its wiki page lists them
 * @returns {{category: string, kind: 'process' | 'metrology', template: TemplateBody | null}}
 */
export function seedForType(type, gases = []) {
  const kind = METROLOGY_TYPES.has(type) ? 'metrology' : 'process';
  const category = kind === 'metrology' ? 'metrology' : CATEGORY_BY_TYPE[type] || 'other';
  if (NO_TEMPLATE.has(type)) return { category, kind, template: null };
  const build = BUILDERS[type] || BUILDERS.other;
  return { category, kind, template: build(gases) };
}

/** @returns {string[]} every tool type with a template builder */
export function knownTypes() {
  return [...Object.keys(BUILDERS), ...NO_TEMPLATE];
}
