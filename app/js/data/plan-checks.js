// @ts-check
/**
 * Runs the compatibility checks (core/compat.js) on a project's plan with
 * what the app knows about each step: the tool's profile (data/compat-lnf.js
 * and the person's settings) and, from the step's LNF recipe, the film a
 * deposition leaves or the resist a spin coat leaves.
 */
import { allRecipes } from './recipes.js';
import { toolProfile, lnfType } from './compat-lnf.js';
import { checkPlan, strips } from '../core/compat.js';
import { materialClasses } from '../core/wafer-spec.js';
import { findRecipe } from '../core/recipes.js';

/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Template} Template */
/** @typedef {import('../core/types.js').PlanStep} PlanStep */
/** @typedef {import('../core/types.js').Wafer} Wafer */
/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */
/** @typedef {import('../core/compat.js').Note} Note */

/** LNF tool types whose recipes' films stay on the wafer. */
const DEPOSITS = new Set(['pecvd', 'lpcvd', 'sputter', 'ebeam-evaporation', 'thermal-evaporation', 'ald', 'electroplating', 'parylene', 'oxidation-furnace']);

/**
 * What a step's LNF recipe leaves on the wafers: a deposition or plating
 * recipe's film, a spin coat's resist (any spin coat leaves resist).
 * @param {PlanStep} step
 * @param {ReadonlyMap<string, Tool>} toolMap
 * @param {ReadonlyMap<string, Template>} tplMap
 * @param {readonly WikiRecipe[]} recipes
 * @returns {string[]}
 */
export function recipeAdds(step, toolMap, tplMap, recipes) {
  const tool = step.toolId ? toolMap.get(step.toolId) : null;
  if (!tool) return [];
  const type = lnfType(tool.id);
  const tpl = (step.templateId && tplMap.get(step.templateId)) || (tool.defaultTemplateId && tplMap.get(tool.defaultTemplateId)) || null;
  const recipe = step.recipe ? findRecipe(recipes.filter((r) => r.tool === tool.id), step.recipe) : null;
  if (type === 'spin-coat' || tpl?.name === 'Spin coat') {
    // A strip recipe on a coater ("STRIP") takes resist off rather than putting it on. Only the recipe says so:
    // a title such as "Spin S1813 (lift-off bilayer)" still coats.
    if (strips(step.recipe || '')) return [];
    // The person named the resist in What it adds: that is the one on the wafer.
    if ((Array.isArray(step.adds) ? step.adds : []).some((a) => materialClasses(a).has('organic'))) return [];
    // A recipe that lists several resists says what it suits, not which one is on the wafer.
    return recipe && recipe.films.length === 1 ? [...recipe.films] : ['Photoresist'];
  }
  // Plating at a wet bench (Acid Bench 92's copper or nickel pulse plating) leaves its metal too.
  if (recipe && (DEPOSITS.has(type) || tpl?.processType === 'deposition' || /\bplating\b/i.test(recipe.name))) return [...recipe.films];
  return [];
}

/**
 * The project's wafers as the checks see them: a wafer whose type gives no
 * material takes the project's substrate.
 * @param {{wafers: Wafer[], substrate?: string}} project
 * @returns {Wafer[]}
 */
function withSubstrate(project) {
  const sub = String(project.substrate || '').trim();
  return (project.wafers || []).map((w) => (sub && !(w.spec && w.spec.material) && w.spec?.kind !== 'mask'
    ? { ...w, spec: { ...(w.spec || {}), material: sub } } : w));
}

/**
 * @param {{wafers: Wafer[], steps: PlanStep[], substrate?: string}} project
 * @param {readonly Tool[]} tools every tool, archived ones too
 * @param {readonly Template[]} templates
 * @param {readonly WikiRecipe[]} recipes
 * @returns {{notes: Note[], byStep: Map<string, Note[]>}}
 */
export function planChecksWith(project, tools, templates, recipes) {
  const toolMap = new Map(tools.map((t) => [t.id, t]));
  const tplMap = new Map(templates.map((t) => [t.id, t]));
  return checkPlan({
    project: { wafers: withSubstrate(project), steps: project.steps },
    profileOf: (step) => {
      const tool = step.toolId ? toolMap.get(step.toolId) : null;
      return tool ? toolProfile(tool, step.templateId) : null;
    },
    toolName: (id) => {
      const t = id ? toolMap.get(id) : null;
      return t ? t.shortName || t.name : 'this tool';
    },
    stepMaterials: (step) => ({ adds: recipeAdds(step, toolMap, tplMap, recipes), removes: [] }),
  });
}

/**
 * The checks for a plan, with the LNF recipes loaded (without them when they cannot load).
 * @param {{wafers: Wafer[], steps: PlanStep[], substrate?: string}} project
 * @param {readonly Tool[]} tools
 * @param {readonly Template[]} templates
 * @returns {Promise<{notes: Note[], byStep: Map<string, Note[]>}>}
 */
export async function planChecks(project, tools, templates) {
  /** @type {WikiRecipe[]} */
  let recipes = [];
  try { recipes = await allRecipes(); } catch { /* checks without recipe films */ }
  return planChecksWith(project, tools, templates, recipes);
}
