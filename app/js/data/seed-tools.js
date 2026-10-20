// @ts-check
/**
 * First-run seed data: generic example tools, their templates and a short
 * materials list. Names are deliberately generic and marked "(example)";
 * rename them to the real LNF tools in Settings. Do not add real LNF tool
 * names, recipes or process numbers here.
 */
import { SEED_TEMPLATES } from './seed-templates.js';

/** Seed records carry this old timestamp so any later edit wins a merge. */
export const SEED_TIME = '2026-01-01T00:00:00.000Z';
export const SEED_AUTHOR = 'example data';

const NOTE = 'Example tool. Rename it to the real tool and adjust its templates.';

export const SEED_TOOLS = Object.freeze([
  { id: '45b9e620-b8dd-4c27-aaee-ba385ffa424d', name: 'ICP etcher (example)', shortName: 'ICP', category: 'etch', kind: 'process' },
  { id: '392167d2-43de-489e-8fdd-841f31cba5be', name: 'RIE (example)', shortName: 'RIE', category: 'etch', kind: 'process' },
  { id: 'aa512674-7c3f-4f72-9706-2f80e67bec75', name: 'PECVD (example)', shortName: 'PECVD', category: 'deposition', kind: 'process' },
  { id: 'ff54054d-f58f-4cec-b87e-c550149927d7', name: 'Sputter (example)', shortName: 'Sputter', category: 'deposition', kind: 'process' },
  { id: 'eae02b8e-15dc-4181-a12e-53c634e09454', name: 'E-beam evaporator (example)', shortName: 'E-beam', category: 'deposition', kind: 'process' },
  { id: '2c336f21-3961-4022-8772-3a346ccad62a', name: 'ALD (example)', shortName: 'ALD', category: 'deposition', kind: 'process' },
  { id: '1fedf680-5dc3-40d6-9b14-fd602ee722e9', name: 'Oxidation furnace (example)', shortName: 'Furnace', category: 'thermal', kind: 'process' },
  { id: '86fc9282-5bdb-4a0d-8967-ea7a728b3941', name: 'Spin coater (example)', shortName: 'Spin', category: 'litho', kind: 'process' },
  { id: '9639cb68-f89f-43ae-97b4-907d7fd0ad97', name: 'Ellipsometer (example)', shortName: 'Ellipso', category: 'metrology', kind: 'metrology' },
  { id: '4ee2077c-c137-4731-8c5f-ad934c74a54f', name: 'Profilometer (example)', shortName: 'Profilo', category: 'metrology', kind: 'metrology' },
  { id: '83e02440-45d3-4d61-99fe-cac39b887eec', name: 'Reflectometer (example)', shortName: 'Reflecto', category: 'metrology', kind: 'metrology' },
  { id: '2c57cedf-50f6-4d4b-b2c8-3d0acc461536', name: 'Four-point probe (example)', shortName: '4PP', category: 'metrology', kind: 'metrology' },
]);

export const SEED_MATERIALS = Object.freeze([
  'Si', 'SiO2 (thermal)', 'SiO2 (PECVD)', 'Si3N4 (LPCVD)', 'SiNx (PECVD)',
  'Al', 'Au', 'Cr', 'Ti', 'Positive resist', 'Negative resist',
]);

/**
 * Complete seed records (with base fields) ready to store.
 * @returns {{tools: import('../core/types.js').Tool[], templates: import('../core/types.js').Template[]}}
 */
export function seedRecords() {
  const base = { createdAt: SEED_TIME, updatedAt: SEED_TIME, deleted: false, deviceId: 'seed', author: SEED_AUTHOR };
  const templates = SEED_TEMPLATES.map((t) => /** @type {any} */ ({
    ...base, ...structuredClone(t),
  }));
  const tools = SEED_TOOLS.map((t) => /** @type {any} */ ({
    ...base,
    ...t,
    active: true,
    defaultTemplateId: templates.find((x) => x.toolId === t.id)?.id ?? null,
    halfLifeDays: null,
    notes: NOTE,
  }));
  return { tools, templates };
}
