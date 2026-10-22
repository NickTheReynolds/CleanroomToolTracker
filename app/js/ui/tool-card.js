// @ts-check
/**
 * A tool's header on run screens: its category icon, name and a line about
 * it, and a "?" button that gathers the tool's LNF wiki links (its page,
 * process page, SOPs and other documents) and its recipes in one place. The
 * app never loads anything from the wiki by itself: the wiki opens in the
 * browser only when the person taps one of these links (DECISIONS.md 77).
 */
import { h } from './dom.js';
import { icon, categoryIcon } from './icons.js';
import { button, sheet } from './components.js';
import { openRecipeSheet } from './recipes.js';
import { TOOL_WIKI, wikiPageUrl } from '../data/lnf-wiki.js';

/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Template} Template */
/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */

/**
 * A link row that opens in the browser.
 * @param {string} title
 * @param {string} sub
 * @param {string} href
 * @returns {HTMLElement}
 */
function linkRow(title, sub, href) {
  return h('a', { class: 'row', href, target: '_blank', rel: 'noopener noreferrer' },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), h('span', { class: 'row-sub' }, sub)),
    icon('external', { class: 'row-chev' }));
}

/** @param {string} url @returns {string} what kind of document a link opens */
const docKind = (url) => (/spreadsheets/.test(url) ? 'Google Sheet' : /presentation/.test(url) ? 'Google Slides'
  : /drive\.google/.test(url) ? 'File on Google Drive' : 'Google Doc');

/**
 * @typedef {Object} ToolCardOpts
 * @property {Tool} tool
 * @property {string} [subtitle] a line under the name, such as the template
 * @property {WikiRecipe[]} [recipes] the tool's LNF recipes, offered in the "?" sheet
 * @property {Template | null} [template] marks what a recipe fills
 * @property {string} [useLabel] the recipe sheet's Use button
 * @property {(r: WikiRecipe, step: number) => void} [onUse]
 */

/**
 * Everything about the tool on the LNF wiki, and its recipes, in one sheet.
 * @param {ToolCardOpts} o
 */
export function openWikiSheet(o) {
  const w = TOOL_WIKI[o.tool.id];
  const rows = [];
  if (w) {
    rows.push(linkRow('Tool page', w.page, wikiPageUrl(w.page)));
    if (w.processes) rows.push(linkRow('Processes and recipes', w.processes, wikiPageUrl(w.processes)));
    for (const [label, url] of w.docs || []) rows.push(linkRow(label, docKind(url), url));
  }
  const recipes = o.recipes || [];
  const s = sheet(o.tool.name, [
    rows.length ? h('div', { class: 'list' }, rows) : h('p', null, 'This tool has no page on the LNF wiki.'),
    recipes.length && o.onUse ? button(`Recipes in this app (${recipes.length})`, {
      icon: 'book',
      onClick: () => {
        s.close();
        openRecipeSheet({
          title: `${o.tool.shortName || o.tool.name} recipes`, recipes, template: o.template || null,
          useLabel: o.useLabel || 'Use recipe', onUse: /** @type {(r: WikiRecipe, step: number) => void} */ (o.onUse),
        });
      },
    }) : null,
    h('p', { class: 'muted small' }, 'Links open the LNF wiki in your browser, where the tool page shows its photo. If the wiki or a document asks for a UMich login or the UMich network (VPN), sign in there. The app itself never contacts the wiki.'),
  ]);
}

/**
 * The tool's header card: its category icon and name; "?" opens the wiki sheet.
 * @param {ToolCardOpts} o
 * @returns {HTMLElement}
 */
export function toolCard(o) {
  const help = TOOL_WIKI[o.tool.id] || (o.recipes && o.recipes.length);
  return h('div', { class: 'tool-card', dataset: { category: o.tool.category } },
    h('span', { class: 'tool-card-icon', dataset: { category: o.tool.category } }, categoryIcon(o.tool.category, { size: 28 })),
    h('span', { class: 'tool-card-text' },
      h('span', { class: 'tool-card-name' }, o.tool.name),
      o.subtitle ? h('span', { class: 'tool-card-sub' }, o.subtitle) : null),
    help ? button('', {
      kind: 'ghost', icon: 'help', class: 'tool-card-help', ariaLabel: `${o.tool.name} on the LNF wiki`, onClick: () => openWikiSheet(o),
    }) : null);
}
