// @ts-check
// The worked example from spec Section 11: one ICP tool, the "Oxide etch"
// template from Section 6 and runs A, B and C. All runs are complete, with
// material SiO2 and O2 = 0; now = 2026-10-20T12:00:00Z; half-life 30 days.

export const NOW = '2026-10-20T12:00:00Z';
export const TOOL_ID = 'tool-icp';
export const TEMPLATE_ID = 'tpl-oxide-etch';

const base = {
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  deleted: false,
  deviceId: 'test-device',
  author: 'tester',
};

/** The Section 6 example template, verbatim. */
export const oxideEtchTemplate = {
  name: 'Oxide etch',
  processType: 'etch',
  primaryOutput: 'etchRate',
  fields: [
    { key: 'icpPower', label: 'ICP power', type: 'number', unit: 'W', role: 'input', step: 10, spreadHint: 100, weight: 1 },
    { key: 'rfPower', label: 'RF power', type: 'number', unit: 'W', role: 'input', step: 5, spreadHint: 25, weight: 1 },
    { key: 'pressure', label: 'Pressure', type: 'number', unit: 'mTorr', role: 'input', step: 1, spreadHint: 5, weight: 1 },
    { key: 'chf3', label: 'CHF3', type: 'number', unit: 'sccm', role: 'input', step: 1, spreadHint: 20, weight: 1, chemistry: true },
    { key: 'o2', label: 'O2', type: 'number', unit: 'sccm', role: 'input', step: 1, spreadHint: 5, weight: 1, chemistry: true },
    { key: 'time', label: 'Time', type: 'duration', unit: 's', role: 'input', weight: 0 },
    { key: 'chuckTemp', label: 'Chuck temp', type: 'number', unit: '°C', role: 'context' },
    { key: 'etchRate', label: 'Etch rate', type: 'number', unit: 'nm/min', role: 'output' },
    { key: 'uniformity', label: 'Uniformity', type: 'number', unit: '%', role: 'output' },
  ],
  derived: [
    { output: 'etchRate', fn: 'etchRate', timeField: 'time' },
    { output: 'uniformity', fn: 'uniformity', phase: 'post' },
  ],
};

export const tool = {
  ...base,
  id: TOOL_ID,
  name: 'ICP etcher',
  shortName: 'ICP',
  category: 'etch',
  kind: 'process',
  active: true,
  defaultTemplateId: TEMPLATE_ID,
  halfLifeDays: null,
  notes: '',
};

export const template = { ...base, ...structuredClone(oxideEtchTemplate), id: TEMPLATE_ID, toolId: TOOL_ID };

/**
 * @param {string} id
 * @param {number} icpPower
 * @param {number} pressure
 * @param {number} chf3
 * @param {number} etchRate
 * @param {string} startedAt
 */
function run(id, icpPower, pressure, chf3, etchRate, startedAt) {
  return {
    ...base,
    id,
    toolId: TOOL_ID,
    templateId: TEMPLATE_ID,
    material: 'SiO2',
    substrate: 'Si',
    maskMaterial: '',
    status: /** @type {'complete'} */ ('complete'),
    startedAt,
    endedAt: null,
    params: { icpPower, pressure, chf3, o2: 0 },
    results: { etchRate },
    derivedKeys: [],
    targetThickness: null,
    recipe: '',
    notes: '',
    tags: [],
    photoIds: [],
  };
}

export const runA = run('A', 400, 10, 50, 85, '2026-10-06T12:00:00Z');
export const runB = run('B', 450, 10, 50, 94, '2026-10-13T12:00:00Z');
export const runC = run('C', 400, 15, 40, 71, '2026-07-22T12:00:00Z');
export const runs = [runA, runB, runC];

/** Case 4: a major chamber clean between A and B. */
export const cleanEvent = {
  ...base,
  id: 'event-clean',
  toolId: TOOL_ID,
  type: 'clean',
  major: true,
  at: '2026-10-10T12:00:00Z',
  notes: '',
};

/** Case 1 query: ICP 400, pressure 10, CHF3 50, 500 nm target. */
export const query1 = {
  toolId: TOOL_ID,
  templateId: TEMPLATE_ID,
  material: 'SiO2',
  params: { icpPower: 400, pressure: 10, chf3: 50 },
  targetThickness: 500,
  strictChemistry: true,
  sameMaterial: true,
  includeSiblings: false,
};
export const query2 = { ...query1, params: { icpPower: 425, pressure: 10, chf3: 50 }, targetThickness: null };
export const query3 = { ...query1, params: { icpPower: 500, pressure: 10, chf3: 50 }, targetThickness: null };
export const query5 = { ...query1, params: { ...query1.params, o2: 10 } };

/**
 * Lookup input for a query with the fixture data.
 * @param {any} query
 * @param {any[]} [events]
 */
export function lookupInput(query, events = []) {
  return { query, runs, templates: [template], tools: [tool], events, now: NOW };
}

/** Case 6: derived values. */
export const derivedRun = {
  ...run('D', 400, 10, 50, 0, '2026-10-19T12:00:00Z'),
  results: {},
  params: { icpPower: 400, pressure: 10, chf3: 50, o2: 0, time: 300 },
};

/**
 * @param {string} id
 * @param {'pre' | 'post'} phase
 * @param {number[]} values
 * @param {string} [material]
 */
export function measurement(id, phase, values, material = 'SiO2') {
  return {
    ...base,
    id,
    runId: 'D',
    metrologyToolId: 'ellipsometer',
    kind: 'thickness',
    phase,
    material,
    unit: 'nm',
    points: values.map((value, i) => ({ site: String(i + 1), value })),
    takenAt: phase === 'pre' ? '2026-10-19T11:00:00Z' : '2026-10-19T13:00:00Z',
    notes: '',
  };
}
