// @ts-check
/**
 * A tool's header on run screens: its photo, name and a line about it, and
 * a "?" button that gathers the tool's LNF wiki links (its page, process
 * page, SOPs and other documents) and its recipes in one place. The app
 * ships some photos (data/tool-photos.js); the others load from the LNF wiki
 * when it is reachable, and a category icon stands in otherwise.
 */
import { h } from './dom.js';
import { icon, categoryIcon } from './icons.js';
import { button, sheet } from './components.js';
import { openRecipeSheet } from './recipes.js';
import { TOOL_WIKI, WIKI_HOST, wikiPageUrl } from '../data/lnf-wiki.js';
import { TOOL_PHOTOS } from '../data/tool-photos.js';

/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Template} Template */
/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */

const SHIPPED = new Set(TOOL_PHOTOS);

/**
 * Where a tool's photo comes from: shipped with the app, or the wiki.
 * @param {string} toolId
 * @returns {string | null}
 */
export function toolPhotoSrc(toolId) {
  const w = TOOL_WIKI[toolId];
  if (!w || !w.image) return null;
  const file = (w.image.split('/').pop() || '').replace(/\.(png|gif|jpe?g)$/i, '.jpg');
  return SHIPPED.has(file) ? `img/tools/${file}` : `${WIKI_HOST}${w.image}`;
}

/**
 * The tool's category icon in a photo-sized box.
 * @param {Tool} tool
 * @param {string} cls
 * @returns {HTMLElement}
 */
const noPhoto = (tool, cls) => h('span', { class: [cls, 'tool-photo-none'], dataset: { category: tool.category } },
  categoryIcon(tool.category, { size: 28 }));

/**
 * The tool's photo, or its category icon when there is none or it cannot
 * load. A shipped photo shows at once. A photo from the wiki shows the icon
 * until it has loaded: off the UMich network it can take minutes to fail.
 * @param {Tool} tool
 * @param {string} cls
 * @param {(img: HTMLElement) => HTMLElement} [wrap] what a loaded photo goes in (default: itself)
 * @returns {HTMLElement}
 */
function photo(tool, cls, wrap = (img) => img) {
  const icon = noPhoto(tool, cls);
  const src = toolPhotoSrc(tool.id);
  if (!src) return icon;
  const img = h('img', { class: cls, src, alt: `Photo of ${tool.name}`, decoding: 'async', referrerpolicy: 'no-referrer' });
  if (src.startsWith('img/')) {
    const shown = wrap(img);
    img.addEventListener('error', () => shown.replaceWith(icon), { once: true });
    return shown;
  }
  img.addEventListener('load', () => icon.replaceWith(wrap(img)), { once: true });
  return icon;
}

/**
 * The photo at full width.
 * @param {Tool} tool
 */
function openPhoto(tool) {
  sheet(tool.name, [photo(tool, 'tool-photo-large'), h('p', { class: 'muted small' }, 'Photo: LNF wiki.')]);
}

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
    h('p', { class: 'muted small' }, 'Links open in your browser. The LNF wiki may need the UMich network, and some documents a UMich login.'),
  ]);
}

/**
 * The tool's header card. The photo opens larger; "?" opens the wiki sheet.
 * @param {ToolCardOpts} o
 * @returns {HTMLElement}
 */
export function toolCard(o) {
  // Only a photo that has loaded becomes a button: the icon alone opens nothing.
  const pic = photo(o.tool, 'tool-photo', (img) => h('button', {
    type: 'button', class: 'tool-photo-btn', 'aria-label': `Show the photo of ${o.tool.name}`, onClick: () => openPhoto(o.tool),
  }, img));
  const help = TOOL_WIKI[o.tool.id] || (o.recipes && o.recipes.length);
  return h('div', { class: 'tool-card', dataset: { category: o.tool.category } },
    pic,
    h('span', { class: 'tool-card-text' },
      h('span', { class: 'tool-card-name' }, o.tool.name),
      o.subtitle ? h('span', { class: 'tool-card-sub' }, o.subtitle) : null),
    help ? button('', {
      kind: 'ghost', icon: 'help', class: 'tool-card-help', ariaLabel: `${o.tool.name} on the LNF wiki`, onClick: () => openWikiSheet(o),
    }) : null);
}
