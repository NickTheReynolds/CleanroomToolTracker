// @ts-check
/**
 * Generic example templates, one or more per tool category. They are
 * starting points, not LNF recipes: the user edits them to match the real
 * tools. Ids are fixed so the same seed record never duplicates when
 * backups from two devices are merged.
 */

/** @typedef {import('../core/types.js').FieldSpec} FieldSpec */

/**
 * A numeric process input.
 * @param {string} key
 * @param {string} label
 * @param {string} unit
 * @param {number} step
 * @param {number} spreadHint
 * @param {Partial<FieldSpec>} [extra]
 * @returns {FieldSpec}
 */
const num = (key, label, unit, step, spreadHint, extra = {}) => ({
  key, label, type: 'number', unit, role: 'input', step, min: 0, spreadHint, weight: 1, ...extra,
});

/**
 * A gas flow that takes part in the strict chemistry filter.
 * @param {string} key
 * @param {string} label
 * @param {number} spreadHint
 * @returns {FieldSpec}
 */
const gas = (key, label, spreadHint) => num(key, label, 'sccm', 1, spreadHint, { chemistry: true });

/**
 * Process time, stored in seconds and entered as mm:ss. Weight 0 by default
 * because time changes thickness, not rate.
 * @param {Partial<FieldSpec>} [extra]
 * @returns {FieldSpec}
 */
const time = (extra = {}) => ({
  key: 'time', label: 'Time', type: 'duration', unit: 's', role: 'input', step: 10, min: 0, weight: 0, ...extra,
});

/**
 * Recorded but never matched by lookup.
 * @param {string} key
 * @param {string} label
 * @param {string} unit
 * @param {number} step
 * @returns {FieldSpec}
 */
const ctx = (key, label, unit, step) => ({ key, label, type: 'number', unit, role: 'context', step });

/**
 * @param {string} key
 * @param {string} label
 * @param {string} unit
 * @returns {FieldSpec}
 */
const out = (key, label, unit) => ({ key, label, type: 'number', unit, role: 'output' });

/**
 * A text or choice input that must match exactly in lookup.
 * @param {string} key
 * @param {string} label
 * @param {string[]} [options] makes it a choice field
 * @returns {FieldSpec}
 */
const exact = (key, label, options) => (options
  ? { key, label, type: 'select', role: 'input', options, matchExact: true }
  : { key, label, type: 'text', role: 'input', matchExact: true });

export const SEED_TEMPLATES = Object.freeze([
  {
    id: '1ed09dbc-941f-4056-8b83-ae2312c7f083',
    toolId: '45b9e620-b8dd-4c27-aaee-ba385ffa424d',
    name: 'Oxide etch',
    processType: 'etch',
    primaryOutput: 'etchRate',
    fields: [
      num('icpPower', 'ICP power', 'W', 10, 100),
      num('rfPower', 'RF power', 'W', 5, 25),
      num('pressure', 'Pressure', 'mTorr', 1, 5),
      gas('chf3', 'CHF3', 20),
      gas('o2', 'O2', 5),
      time(),
      ctx('chuckTemp', 'Chuck temp', '°C', 1),
      out('etchRate', 'Etch rate', 'nm/min'),
      out('uniformity', 'Uniformity', '%'),
    ],
    derived: [
      { output: 'etchRate', fn: 'etchRate', timeField: 'time' },
      { output: 'uniformity', fn: 'uniformity', phase: 'post' },
    ],
  },
  {
    id: '1319d50b-0d62-411e-b8a6-6a94aaa6f5af',
    toolId: '392167d2-43de-489e-8fdd-841f31cba5be',
    name: 'RIE etch',
    processType: 'etch',
    primaryOutput: 'etchRate',
    fields: [
      num('rfPower', 'RF power', 'W', 5, 25),
      num('pressure', 'Pressure', 'mTorr', 1, 5),
      gas('cf4', 'CF4', 10),
      gas('chf3', 'CHF3', 10),
      gas('sf6', 'SF6', 10),
      gas('o2', 'O2', 5),
      gas('ar', 'Ar', 10),
      time(),
      ctx('chuckTemp', 'Chuck temp', '°C', 1),
      out('etchRate', 'Etch rate', 'nm/min'),
      out('removed', 'Removed', 'nm'),
      out('uniformity', 'Uniformity', '%'),
      out('selectivity', 'Selectivity', 'ratio'),
    ],
    derived: [
      { output: 'etchRate', fn: 'etchRate', timeField: 'time' },
      { output: 'removed', fn: 'removed' },
      { output: 'uniformity', fn: 'uniformity', phase: 'post' },
      { output: 'selectivity', fn: 'selectivity' },
    ],
  },
  {
    id: '0a845cbb-dbc9-4535-b6a5-6ddb6c5416a2',
    toolId: 'aa512674-7c3f-4f72-9706-2f80e67bec75',
    name: 'PECVD film',
    processType: 'deposition',
    primaryOutput: 'depRate',
    fields: [
      num('rfPower', 'RF power', 'W', 5, 20),
      num('pressure', 'Pressure', 'mTorr', 10, 100),
      num('temp', 'Temperature', '°C', 5, 25),
      gas('sih4', 'SiH4', 20),
      gas('n2o', 'N2O', 50),
      gas('nh3', 'NH3', 10),
      gas('n2', 'N2', 100),
      time(),
      out('thickness', 'Thickness', 'nm'),
      out('depRate', 'Deposition rate', 'nm/min'),
      out('uniformity', 'Uniformity', '%'),
      out('refractiveIndex', 'Refractive index', ''),
      out('stress', 'Stress', 'MPa'),
    ],
    derived: [
      { output: 'thickness', fn: 'deposited' },
      { output: 'depRate', fn: 'depRate', timeField: 'time' },
      { output: 'uniformity', fn: 'uniformity', phase: 'post' },
    ],
  },
  {
    id: 'e71bbe31-5ce0-4f03-a34f-288d64cac36d',
    toolId: 'ff54054d-f58f-4cec-b87e-c550149927d7',
    name: 'Sputter film',
    processType: 'deposition',
    primaryOutput: 'depRate',
    fields: [
      exact('target', 'Target'),
      exact('source', 'Power supply', ['DC', 'RF', 'Pulsed DC']),
      num('power', 'Power', 'W', 10, 50),
      num('pressure', 'Pressure', 'mTorr', 0.5, 1),
      gas('ar', 'Ar', 5),
      gas('n2', 'N2', 2),
      gas('o2', 'O2', 2),
      time(),
      ctx('substrateTemp', 'Substrate temp', '°C', 5),
      out('thickness', 'Thickness', 'nm'),
      out('depRate', 'Deposition rate', 'nm/min'),
      out('uniformity', 'Uniformity', '%'),
      out('sheetResistance', 'Sheet resistance', 'Ω/sq'),
      out('stress', 'Stress', 'MPa'),
    ],
    derived: [
      { output: 'thickness', fn: 'deposited' },
      { output: 'depRate', fn: 'depRate', timeField: 'time' },
      { output: 'uniformity', fn: 'uniformity', phase: 'post' },
    ],
  },
  {
    id: 'a7bc2f61-2d8e-49d5-a485-1fb6770ac92a',
    toolId: 'eae02b8e-15dc-4181-a12e-53c634e09454',
    name: 'E-beam evaporation',
    processType: 'deposition',
    primaryOutput: 'thickness',
    fields: [
      exact('source', 'Source'),
      num('rateSetpoint', 'Rate setpoint', 'Å/s', 0.1, 0.5),
      num('qcmThickness', 'QCM thickness', 'nm', 5, 50),
      time(),
      ctx('basePressure', 'Base pressure', 'µTorr', 0.1),
      out('thickness', 'Thickness', 'nm'),
      out('depRate', 'Deposition rate', 'nm/min'),
      out('uniformity', 'Uniformity', '%'),
    ],
    derived: [
      { output: 'thickness', fn: 'deposited' },
      { output: 'depRate', fn: 'depRate', timeField: 'time' },
      { output: 'uniformity', fn: 'uniformity', phase: 'post' },
    ],
  },
  {
    id: 'e21a86be-0a5e-46e9-b61e-0c7f0a29fabb',
    toolId: '2c336f21-3961-4022-8772-3a346ccad62a',
    name: 'ALD film',
    processType: 'deposition',
    primaryOutput: 'thickness',
    fields: [
      exact('precursor', 'Precursor'),
      exact('coreactant', 'Co-reactant', ['H2O', 'O3', 'O2 plasma', 'N2 plasma', 'NH3 plasma']),
      num('temp', 'Temperature', '°C', 5, 25),
      num('cycles', 'Cycles', 'cycles', 10, 50),
      ctx('pulse', 'Precursor pulse', 'ms', 5),
      ctx('purge', 'Purge', 's', 1),
      out('thickness', 'Thickness', 'nm'),
      out('gpc', 'Growth per cycle', 'Å/cycle'),
      out('uniformity', 'Uniformity', '%'),
      out('refractiveIndex', 'Refractive index', ''),
    ],
    derived: [
      { output: 'thickness', fn: 'deposited' },
      { output: 'uniformity', fn: 'uniformity', phase: 'post' },
    ],
  },
  {
    id: '2a92a70a-038b-4bfd-a8db-bca030d6c793',
    toolId: '1fedf680-5dc3-40d6-9b14-fd602ee722e9',
    name: 'Furnace oxidation',
    processType: 'thermal',
    primaryOutput: 'thickness',
    fields: [
      exact('ambient', 'Ambient', ['Dry O2', 'Wet (steam)']),
      num('temp', 'Temperature', '°C', 10, 25),
      time({ step: 60, weight: 1, spreadHint: 600 }),
      ctx('o2Flow', 'O2 flow', 'slm', 0.5),
      out('thickness', 'Thickness', 'nm'),
      out('uniformity', 'Uniformity', '%'),
      out('refractiveIndex', 'Refractive index', ''),
    ],
    derived: [
      { output: 'thickness', fn: 'deposited' },
      { output: 'uniformity', fn: 'uniformity', phase: 'post' },
    ],
  },
  {
    id: '6c8eefea-dc41-4c75-b31a-1adc2fcdbad8',
    toolId: '86fc9282-5bdb-4a0d-8967-ea7a728b3941',
    name: 'Spin coat',
    processType: 'litho',
    primaryOutput: 'thickness',
    fields: [
      exact('resist', 'Resist'),
      num('speed', 'Spin speed', 'rpm', 100, 500),
      { ...time({ step: 5 }), key: 'spinTime', label: 'Spin time' },
      ctx('accel', 'Acceleration', 'rpm/s', 100),
      ctx('bakeTemp', 'Soft bake temp', '°C', 5),
      { key: 'bakeTime', label: 'Soft bake time', type: 'duration', unit: 's', role: 'context', step: 10 },
      out('thickness', 'Thickness', 'nm'),
      out('uniformity', 'Uniformity', '%'),
    ],
    derived: [
      { output: 'thickness', fn: 'deposited' },
      { output: 'uniformity', fn: 'uniformity', phase: 'post' },
    ],
  },
  {
    id: 'd1165c21-cd9c-43d6-8f19-1b5da92fea54',
    toolId: '9639cb68-f89f-43ae-97b4-907d7fd0ad97',
    name: 'Ellipsometry',
    processType: 'metrology',
    primaryOutput: 'thickness',
    fields: [
      { key: 'model', label: 'Fit model', type: 'text', role: 'context' },
      out('thickness', 'Thickness', 'nm'),
      out('refractiveIndex', 'Refractive index', ''),
      out('uniformity', 'Uniformity', '%'),
      out('gof', 'Fit quality (GOF)', ''),
    ],
    derived: [{ output: 'uniformity', fn: 'uniformity', phase: 'post' }],
  },
  {
    id: 'd2bb4c17-0d17-482d-b252-b3a031977920',
    toolId: '4ee2077c-c137-4731-8c5f-ad934c74a54f',
    name: 'Profilometry',
    processType: 'metrology',
    primaryOutput: 'stepHeight',
    fields: [
      ctx('scanLength', 'Scan length', 'µm', 100),
      ctx('stylusForce', 'Stylus force', 'mg', 0.5),
      out('stepHeight', 'Step height', 'nm'),
      out('uniformity', 'Uniformity', '%'),
    ],
    derived: [{ output: 'uniformity', fn: 'uniformity', phase: 'post', kind: 'stepHeight' }],
  },
]);
