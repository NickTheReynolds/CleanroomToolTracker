// @ts-check
/**
 * The LNF wiki recipes (lnf-recipes-*.js), loaded on first use so that
 * screens without recipes never parse them. Recipes are reference data that
 * ship with the app: they are not stored in IndexedDB, backed up or synced.
 */

/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */

/** @type {Promise<WikiRecipe[]> | null} */
let loading = null;

/** @returns {Promise<WikiRecipe[]>} every recipe */
export function allRecipes() {
  loading = loading || Promise.all([
    import('./lnf-recipes-etch.js'),
    import('./lnf-recipes-dep.js'),
    import('./lnf-recipes-other.js'),
  ]).then((mods) => mods.flatMap((m) => /** @type {WikiRecipe[]} */ ([...m.RECIPES])))
    .catch((err) => { loading = null; throw err; });
  return loading;
}

/**
 * @param {string} toolId
 * @returns {Promise<WikiRecipe[]>} the tool's recipes (none when they cannot load)
 */
export async function recipesForTool(toolId) {
  try {
    return (await allRecipes()).filter((r) => r.tool === toolId);
  } catch (err) {
    console.warn('LNF recipes could not load', err);
    return [];
  }
}
