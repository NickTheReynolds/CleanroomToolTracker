// @ts-check
/**
 * LNF wiki recipes in the UI: the "LNF recipes" button and sheet (search,
 * then one recipe's steps, results and source, with a Use button), and the
 * recipe list for Tool detail.
 */
import { h, fill, uid } from './dom.js';
import { icon } from './icons.js';
import { button, sheet, segmented, emptyState, listRow, section, labelRow, badge } from './components.js';
import { valueText, recipeFill, recipeMatches, sortRecipes, hasValues } from '../core/recipes.js';
import { formatDay } from '../core/time.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */
/** @typedef {import('../core/types.js').Template} Template */

/**
 * @typedef {Object} RecipeSheetOpts
 * @property {string} title
 * @property {WikiRecipe[]} recipes
 * @property {Template | null} template the form's template: marks the values that fill its fields
 * @property {(r: WikiRecipe) => Template | null} [templateFor] the template each recipe fills, when that depends on
 *   the recipe (Tool detail opens a PECVD recipe on the PECVD template); `template` otherwise
 * @property {string} useLabel the Use button ("Use recipe", "Log run with this recipe")
 * @property {(r: WikiRecipe, step: number) => void} onUse
 * @property {string[]} [roles] field roles that Use fills (default input and context)
 * @property {WikiRecipe} [open] show this recipe first
 * @property {boolean} [allSteps] Use fills every step of a multi-step recipe, and the chosen step
 *   becomes the run's main step (run forms); without it Use fills the chosen step only (Look up)
 */

const SUBTITLE_MAX = 100;

/**
 * One line about a recipe for lists: its films and gases, else its summary.
 * @param {WikiRecipe} r
 * @returns {string}
 */
export function recipeSubtitle(r) {
  const line = [r.films.join(', '), r.gases.join(', ')].filter(Boolean).join(' · ');
  if (line) return line;
  return r.about.length > SUBTITLE_MAX ? `${r.about.slice(0, SUBTITLE_MAX - 1).trimEnd()}…` : r.about;
}

/**
 * The toast after a recipe was used.
 * @param {WikiRecipe} r
 * @param {import('../core/recipes.js').RecipeFill | null} f
 * @returns {string}
 */
export function fillMessage(r, f) {
  const n = f ? f.filled.length : 0;
  if (!n) return `Recipe set to ${r.name}.`;
  const other = f && f.skipped.length ? `; ${f.skipped.length} other value${f.skipped.length === 1 ? ' is' : 's are'} not on this template` : '';
  return `${r.name}: ${n} value${n === 1 ? '' : 's'} filled in${other}.`;
}

/**
 * Where a recipe comes from, in words.
 * @param {WikiRecipe} r
 * @returns {string}
 */
function sourceLine(r) {
  const when = r.date ? formatDay(`${r.date}T12:00:00`, Date.now()) : '';
  return `${r.src}${when ? ` (copy of ${when})` : ''}`;
}

/**
 * The parameters of one step; a check marks those that fill a field.
 * @param {WikiRecipe} r
 * @param {number} index
 * @param {Template | null} template
 * @param {string[] | undefined} roles
 * @returns {HTMLElement}
 */
function stepValues(r, index, template, roles) {
  const step = r.steps[index];
  if (!step || !step.values.length) return h('p', { class: 'muted' }, 'The source gives no parameters for this recipe.');
  const fill = template ? recipeFill(r, template, { step: index, roles }) : null;
  const fields = new Map((template ? template.fields : []).map((f) => [f.key, f]));
  const rows = step.values.map((v) => {
    const f = v.k ? fields.get(v.k) : undefined;
    const fills = !!(fill && f && v.k && v.k in fill.values && fill.values[v.k] !== null);
    return [h('dt', null, v.l), h('dd', null, valueText(v),
      fills && f ? h('span', { class: 'recipe-fills' }, icon('check', { size: 16 }), h('span', null, `fills ${f.label}`)) : null)];
  });
  const count = fill ? fill.filled.length : 0;
  return h('div', { class: 'stack' },
    h('dl', { class: 'facts recipe-values' }, rows),
    template ? h('p', { class: 'field-note' }, count
      ? `Use fills ${count} field${count === 1 ? '' : 's'} of ${template.name}${fill && fill.cleared.length ? ` and clears the gases it does not use` : ''}.`
      : `None of these values matches a field of ${template.name}; Use sets the recipe name only.`) : null);
}

/**
 * One recipe: summary, step chooser, parameters, results, notes, source and Use.
 * @param {WikiRecipe} r
 * @param {RecipeSheetOpts} o
 * @param {() => void} close
 * @param {(() => void) | null} back
 * @returns {HTMLElement}
 */
function recipeDetail(r, o, close, back) {
  let step = r.main;
  const values = h('div');
  const use = button(o.useLabel, {
    kind: 'primary', big: true, icon: 'check',
    onClick: () => {
      close();
      o.onUse(r, step);
      // The form redraws under the sheet: give focus back to the recipes button rather than the page.
      if (document.activeElement === document.body) /** @type {HTMLElement | null} */ (document.querySelector('#view .recipe-open'))?.focus({ preventScroll: true });
    },
  });
  const many = r.steps.length > 1;
  const draw = () => {
    fill(values, stepValues(r, step, o.templateFor ? o.templateFor(r) : o.template, o.roles));
    const name = r.steps[step] ? r.steps[step].name : '';
    /** @type {Element} */ (use.lastElementChild).textContent = !many || !name ? o.useLabel
      : o.allSteps ? `${o.useLabel} (all ${r.steps.length} steps)` : `${o.useLabel} (${name})`;
  };
  draw();
  const facts = [['Films', r.films.join(', ')], ['Mask', r.mask.join(', ')], ['Gases', r.gases.join(', ')]].filter(([, v]) => v);
  return h('div', { class: 'stack recipe-detail' },
    back ? h('div', null, button('All recipes', { kind: 'ghost', icon: 'back', onClick: back })) : null,
    h('h3', { class: 'recipe-name', tabindex: '-1' }, r.name),
    r.about ? h('p', null, r.about) : null,
    r.caveat ? h('p', { class: 'field-note warn' }, `Check this one: ${r.caveat}`) : null,
    facts.length ? h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])) : null,
    many ? segmented({
      label: o.allSteps ? 'Main step' : 'Step', compact: true, value: step, help: o.allSteps ? HELP.recipeMainStep : HELP.recipeStep,
      options: r.steps.map((s, i) => ({ value: i, label: s.name || `Step ${i + 1}` })),
      onChange: (v) => { if (v !== null) { step = v; draw(); } },
    }) : null,
    values,
    r.results.length ? h('div', { class: 'stack' }, h('h3', null, 'Results on the wiki'),
      h('ul', { class: 'recipe-results' }, r.results.map((x) => h('li', null, x)))) : null,
    r.notes ? h('p', { class: 'small' }, r.notes) : null,
    h('p', { class: 'muted small' }, 'Source: ', sourceLine(r), '. ',
      r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the source') : null),
    h('div', { class: 'sheet-actions' }, use));
}

/**
 * The sheet with a tool's recipes: a searchable list, then one recipe.
 * @param {RecipeSheetOpts} o
 */
export function openRecipeSheet(o) {
  const list = sortRecipes(o.recipes);
  const body = h('div', { class: 'stack' });
  let query = '';
  const close = () => s.close();
  // Swapping list and detail removes the pressed control, so focus moves on with it.
  const showList = (/** @type {WikiRecipe | null} */ from = null) => {
    const id = uid('findrecipe');
    const input = /** @type {HTMLInputElement} */ (h('input', {
      id, class: 'input', type: 'search', placeholder: 'Name, film or gas', autocomplete: 'off', enterkeyhint: 'search', value: query,
    }));
    const rows = h('div', { class: 'list' });
    /** @type {HTMLElement | null} */
    let back = null;
    const draw = () => {
      const shown = list.filter((r) => recipeMatches(r, query));
      fill(rows, shown.length ? shown.map((r) => {
        const row = listRow({ title: r.name, subtitle: recipeSubtitle(r), badges: nameOnly(r), onClick: () => showDetail(r) });
        if (r === from) back = row;
        return row;
      }) : emptyState('No recipe matches.'));
    };
    input.addEventListener('input', () => { query = input.value; draw(); });
    draw();
    fill(body,
      h('p', { class: 'muted small' }, `${list.length} recipe${list.length === 1 ? '' : 's'} from the LNF wiki. Check a recipe against the tool before you rely on it.`),
      list.length > 6 ? h('div', { class: 'field' },
        labelRow(h('label', { class: 'label', for: id }, 'Search recipes'), 'Search recipes', HELP.recipeSearch), input) : null,
      rows);
    /** @type {HTMLElement | null} */ (back)?.focus();
  };
  const showDetail = (/** @type {WikiRecipe} */ r) => {
    fill(body, recipeDetail(r, o, close, list.length > 1 ? () => showList(r) : null));
    body.parentElement?.scrollTo?.(0, 0);
    /** @type {HTMLElement | null} */ (body.querySelector('.recipe-name'))?.focus();
  };
  const s = sheet(o.title, [body]);
  if (o.open) showDetail(o.open);
  else showList();
}

/**
 * The button that opens a tool's recipes, or null when it has none.
 * @param {RecipeSheetOpts} o
 * @returns {HTMLButtonElement | null}
 */
export function recipeButton(o) {
  if (!o.recipes.length) return null;
  return button(`LNF recipes (${o.recipes.length})`, { icon: 'book', class: 'recipe-open', onClick: () => openRecipeSheet(o) });
}

/**
 * What the wiki says a recipe gives, for the lookup results; null when it
 * says nothing.
 * @param {WikiRecipe} r
 * @param {import('../core/types.js').FieldSpec | undefined} field the output being estimated
 * @returns {HTMLElement | null}
 */
export function wikiReference(r, field) {
  const v = field ? r.expect[field.key] : undefined;
  if (v === undefined && !r.results.length) return null;
  return section('What the LNF wiki says', h('div', { class: 'card stack' },
    h('strong', null, r.name),
    v !== undefined && field ? h('p', null, `The wiki gives ${field.label} ${v}${field.unit ? ` ${field.unit}` : ''} for this recipe.`) : null,
    r.results.length ? h('ul', { class: 'recipe-results' }, r.results.map((x) => h('li', null, x))) : null,
    h('p', { class: 'muted small' }, `Source: ${sourceLine(r)}. Your own runs reflect the tool as it is now; the wiki's numbers may be older.`)));
}

/**
 * A "Name only" badge for a recipe the wiki names without parameters.
 * @param {WikiRecipe} r
 * @returns {HTMLElement[]}
 */
function nameOnly(r) {
  return hasValues(r) ? [] : [badge('Name only', 'muted')];
}

/**
 * A tool's recipes as list rows (the first `limit` when given); a row opens
 * that recipe in a sheet that holds all of them.
 * @param {RecipeSheetOpts & {limit?: number}} o
 * @returns {HTMLElement}
 */
export function recipeList(o) {
  return h('div', { class: 'list' }, sortRecipes(o.recipes).slice(0, o.limit).map((r) => listRow({
    title: r.name, subtitle: recipeSubtitle(r), badges: nameOnly(r), onClick: () => openRecipeSheet({ ...o, open: r }),
  })));
}
