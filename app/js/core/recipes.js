// @ts-check
/**
 * LNF wiki recipes: which template fields a recipe step fills, search and
 * display text. Pure: the recipes (data/lnf-recipes-*.js) and templates are
 * passed in.
 */
import { normText } from './vocab.js';

/** @typedef {import('./types.js').Template} Template */
/** @typedef {import('./types.js').FieldSpec} FieldSpec */
/** @typedef {import('./types.js').FieldValue} FieldValue */

/**
 * One parameter of a recipe step.
 * @typedef {Object} RecipeValue
 * @property {string} l label as the wiki gives it ("TCP power")
 * @property {number | string | boolean | null} v the value; in the unit of field `k` when `k` is set
 *   (durations in seconds), otherwise as the wiki gives it
 * @property {string} [u] unit of `v`
 * @property {string} [k] key of the generic template field it fills ("icpPower")
 * @property {string} [t] the wiki's own wording when it differs from "v u" ("5 min", "variable")
 */

/**
 * @typedef {Object} RecipeStep
 * @property {string} name "Main etch", "Breakthrough", or "" for a one-step recipe
 * @property {RecipeValue[]} values
 */

/**
 * A recipe as the LNF wiki (or a sheet it embeds) documents it.
 * @typedef {Object} WikiRecipe
 * @property {string} id stable and unique
 * @property {string} tool tool id
 * @property {string} name the recipe name as on the wiki ("LNF_Poly")
 * @property {string} about one plain sentence
 * @property {string[]} films materials it etches, deposits or treats (app material names)
 * @property {string[]} mask mask materials
 * @property {string[]} gases gases the recipe uses
 * @property {RecipeStep[]} steps
 * @property {number} main index of the step that fills a run form; -1 when there are no steps
 * @property {string[]} results expected results as short lines ("Si: 181 nm/min")
 * @property {Record<string, number>} expect expected outputs by template output key ({etchRate: 181})
 * @property {string} notes
 * @property {string} src the source: a wiki page title, or a sheet or document it embeds
 * @property {string} url the source address
 * @property {string} date YYYY-MM-DD of the copy the recipe was read from
 * @property {string} [caveat] why to check this recipe before relying on it (sources disagree or are unclear)
 * @property {string} [process] the process type of the template it belongs with, on a tool with
 *   templates of two kinds (the Plasmatherm 790's PECVD recipes: "deposition"); by default the
 *   process type of the tool's default template
 */

/**
 * @typedef {Object} RecipeFill
 * @property {Record<string, FieldValue>} values field key -> value; null clears the field
 * @property {string[]} filled labels of the fields that get a value
 * @property {string[]} cleared labels of gas fields the recipe does not use
 * @property {string[]} skipped the step's other parameters, as "label value"
 * @property {RecipeStep | null} step
 */

/**
 * The value text of a recipe parameter: the wiki's wording when given,
 * else the value and unit.
 * @param {RecipeValue} v
 * @returns {string}
 */
export function valueText(v) {
  if (v.t) return v.t;
  if (v.v === null || v.v === undefined || v.v === '') return '–';
  if (typeof v.v === 'boolean') return v.v ? 'Yes' : 'No';
  return v.u ? `${v.v} ${v.u}` : String(v.v);
}

/**
 * The value a field takes from a recipe parameter, or undefined when it does
 * not suit the field: a finite number for number and duration fields, one
 * of the options (any case) for choice fields, text for text fields.
 * @param {FieldSpec} f
 * @param {RecipeValue} v
 * @returns {FieldValue | undefined}
 */
export function fieldValue(f, v) {
  const x = v.v;
  if (f.type === 'number' || f.type === 'duration') return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
  if (f.type === 'bool') return typeof x === 'boolean' ? x : undefined;
  if (typeof x !== 'string' || !x.trim()) return undefined;
  if (f.type === 'select') return (f.options || []).find((o) => normText(o) === normText(x));
  return x.trim();
}

/**
 * What a recipe step puts into a run form or lookup for this template.
 * Gas fields the step leaves out are cleared when the step names any gas
 * flow, because a recipe names its whole chemistry. A gas the step lists
 * without one number ("30-0 sccm (ramped)") is used, so it stays as it is.
 * @param {WikiRecipe} recipe
 * @param {Template} template
 * @param {{step?: number, roles?: string[]}} [o] the step (default: the recipe's main step) and
 *   the field roles to fill (default: input and context)
 * @returns {RecipeFill}
 */
export function recipeFill(recipe, template, o = {}) {
  const roles = o.roles || ['input', 'context'];
  const index = o.step ?? recipe.main;
  const step = recipe.steps[index] || null;
  /** @type {RecipeFill} */
  const out = { values: {}, filled: [], cleared: [], skipped: [], step };
  if (!step) return out;
  const fields = new Map(template.fields.filter((f) => roles.includes(f.role)).map((f) => [f.key, f]));
  // Fields of the roles not being filled (Look up leaves context out) are on the template all the same.
  const elsewhere = new Set(template.fields.filter((f) => !roles.includes(f.role)).map((f) => f.key));
  /** @type {Set<string>} */
  const varying = new Set();
  let gasGiven = false;
  for (const v of step.values) {
    const f = v.k ? fields.get(v.k) : undefined;
    const value = f ? fieldValue(f, v) : undefined;
    if (f && value !== undefined) {
      out.values[f.key] = value;
      if (!out.filled.includes(f.label)) out.filled.push(f.label);
      if (f.chemistry) gasGiven = true;
    } else if (f && v.v === null && v.t && !/^[-–—]$/.test(v.t.trim())) {
      varying.add(f.key);
    } else if (!(v.k && elsewhere.has(v.k)) && v.v !== null && v.v !== undefined && v.v !== '') {
      out.skipped.push(`${v.l} ${valueText(v)}`);
    }
  }
  if (gasGiven) {
    for (const f of fields.values()) {
      if (f.chemistry && !(f.key in out.values) && !varying.has(f.key)) {
        out.values[f.key] = null;
        out.cleared.push(f.label);
      }
    }
  }
  return out;
}

/**
 * Field values with a fill applied (a null in the fill removes the key).
 * @param {Record<string, FieldValue>} params
 * @param {Record<string, FieldValue>} values
 * @returns {Record<string, FieldValue>}
 */
export function applyFill(params, values) {
  const out = { ...params };
  for (const [k, v] of Object.entries(values)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/**
 * Undo a fill: the keys it wrote go back to their earlier values (or away);
 * everything else, such as values typed in other fields since, stays.
 * @param {Record<string, FieldValue>} params the current values
 * @param {Record<string, FieldValue>} before the values before the fill
 * @param {Record<string, FieldValue>} values the fill's values
 * @returns {Record<string, FieldValue>}
 */
export function undoFill(params, before, values) {
  const out = { ...params };
  for (const k of Object.keys(values)) {
    if (Object.prototype.hasOwnProperty.call(before, k)) out[k] = before[k];
    else delete out[k];
  }
  return out;
}

/**
 * The recipe's film, when it names exactly one.
 * @param {WikiRecipe} recipe
 * @returns {string | null}
 */
export function recipeFilm(recipe) {
  return recipe.films.length === 1 ? recipe.films[0] : null;
}

/**
 * The material a recipe may set: the listed material its one film names,
 * when the match is unambiguous. That is the same name (case, spacing and
 * Unicode forms ignored), or the only listed material whose name is the
 * film's plus a process in brackets ("SiNx" -> "SiNx (PECVD)" when that is
 * the only SiNx). Otherwise null: "SiO2" could be thermal, PECVD or LTO
 * oxide, and a name outside the list would split runs of one material
 * under two names, so Lookup's Same material rule would miss them.
 * @param {WikiRecipe} recipe
 * @param {readonly string[]} materials the materials list
 * @returns {string | null}
 */
export function recipeMaterial(recipe, materials) {
  const film = recipeFilm(recipe);
  if (!film) return null;
  const want = normText(film);
  const exact = materials.find((m) => normText(m) === want);
  if (exact) return exact;
  const family = materials.filter((m) => normText(m).replace(/\s*\([^)]*\)$/, '') === want);
  return family.length === 1 ? family[0] : null;
}

/**
 * @param {WikiRecipe} r
 * @returns {boolean} true when the recipe gives parameters (some only give a name)
 */
export function hasValues(r) {
  const step = r.main >= 0 ? r.steps[r.main] : null;
  return !!step && step.values.length > 0;
}

/**
 * The recipes that belong with a template. A tool with templates of one
 * kind shows every recipe with each. On a tool with two kinds (an RIE and a
 * PECVD chamber) a recipe that names its process type shows with the
 * templates of that type, and one that does not shows with every template.
 * Which template is the tool's default never matters, since a person can
 * change it.
 * @param {WikiRecipe[]} recipes the tool's recipes
 * @param {Template} template
 * @param {readonly Template[]} toolTemplates the tool's templates
 * @returns {WikiRecipe[]}
 */
export function recipesFor(recipes, template, toolTemplates) {
  const kinds = new Set(toolTemplates.map((t) => t.processType));
  if (kinds.size <= 1) return recipes;
  return recipes.filter((r) => !r.process || r.process === template.processType);
}

/**
 * The template a recipe fills when it starts a run: the tool's default
 * template when the recipe names no process type or the default is of its
 * type, else the tool's first template of the recipe's type.
 * @param {WikiRecipe} recipe
 * @param {readonly Template[]} toolTemplates
 * @param {string | null | undefined} defaultTemplateId
 * @returns {Template | null}
 */
export function templateForRecipe(recipe, toolTemplates, defaultTemplateId) {
  const def = toolTemplates.find((t) => t.id === defaultTemplateId) || toolTemplates[0] || null;
  if (!recipe.process || !def || def.processType === recipe.process) return def;
  return toolTemplates.find((t) => t.processType === recipe.process) || def;
}

/** @param {string} s @returns {string[]} */
const words = (s) => normText(s).split(/[^\p{L}\p{N}.]+/u).filter(Boolean);

/**
 * True when every word of the query starts a word of the recipe's name,
 * summary, films, mask, gases or source: "poly hbr" finds LNF_Poly.
 * @param {WikiRecipe} r
 * @param {string} query
 * @returns {boolean}
 */
export function recipeMatches(r, query) {
  const want = words(query);
  if (!want.length) return true;
  const have = words([r.name, r.name.replace(/[_-]+/g, ' '), r.about, ...r.films, ...r.mask, ...r.gases, r.src].join(' '));
  return want.every((w) => have.some((x) => x.startsWith(w)));
}

/**
 * The recipe a run's recipe text names, if any (case, spaces, "_" and "-"
 * ignored): "lnf poly" finds LNF_Poly.
 * @param {WikiRecipe[]} recipes
 * @param {string | null | undefined} name
 * @returns {WikiRecipe | null}
 */
export function findRecipe(recipes, name) {
  const key = (/** @type {string} */ s) => normText(s).replace(/[\s_-]+/g, '');
  const want = key(name || '');
  if (!want) return null;
  return recipes.find((r) => key(r.name) === want) || null;
}

/**
 * Recipes in display order: those with parameters first, then the ones the
 * wiki only names; by name within each, numbers in natural order.
 * @param {WikiRecipe[]} recipes
 * @returns {WikiRecipe[]}
 */
export function sortRecipes(recipes) {
  return [...recipes].sort((a, b) => Number(!hasValues(a)) - Number(!hasValues(b))
    || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}
