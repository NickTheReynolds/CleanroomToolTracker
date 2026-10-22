// @ts-check
/**
 * A tool's header on run screens: its photo (or category icon), name and a
 * line about it, and a "?" button that gathers the tool's LNF wiki links (its
 * page, process page, SOPs and other documents) and its recipes in one place.
 * The photos come with the app (data/tool-photos.js). The app never loads
 * anything from the wiki by itself: the wiki opens in the browser only when
 * the person taps one of these links (DECISIONS.md 77 and 110).
 */
import { h } from './dom.js';
import { icon, categoryIcon } from './icons.js';
import { button, sheet } from './components.js';
import { openRecipeSheet } from './recipes.js';
import { TOOL_WIKI, wikiPageUrl } from '../data/lnf-wiki.js';
import { TOOL_PHOTOS } from '../data/tool-photos.js';

/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Template} Template */
/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */

const PHOTO_CREDIT = 'Photo: LNF wiki, © University of Michigan.';

/**
 * The tool's photo that comes with the app, or null.
 * @param {string} toolId
 * @returns {string | null}
 */
export function toolPhotoSrc(toolId) {
  const file = TOOL_PHOTOS[toolId];
  return file ? `img/tools/${file}` : null;
}

/** @param {Tool} tool @returns {HTMLElement} the category icon in the photo's place */
const iconBox = (tool) => h('span', { class: 'tool-card-icon', dataset: { category: tool.category } },
  categoryIcon(tool.category, { size: 28 }));

/**
 * The photo at full width, with its source.
 * @param {Tool} tool
 * @param {string} src
 */
function openPhoto(tool, src) {
  sheet(tool.name, [
    h('img', { class: 'tool-photo-large', src, alt: `Photo of ${tool.name}` }),
    h('p', { class: 'muted small' }, PHOTO_CREDIT),
  ]);
}

/**
 * The tool's photo as a button that shows it larger, or its category icon
 * when there is no photo (or it fails to load).
 * @param {Tool} tool
 * @returns {HTMLElement}
 */
function thumbnail(tool) {
  const src = toolPhotoSrc(tool.id);
  if (!src) return iconBox(tool);
  const img = h('img', { class: 'tool-photo', src, alt: '', decoding: 'async' });
  const btn = h('button', {
    type: 'button', class: 'tool-photo-btn', 'aria-label': `Show the photo of ${tool.name}`, onClick: () => openPhoto(tool, src),
  }, img);
  img.addEventListener('error', () => btn.replaceWith(iconBox(tool)), { once: true });
  return btn;
}

/**
 * The tool's photo at the top of its page, with its source; null without one.
 * @param {Tool} tool
 * @returns {HTMLElement | null}
 */
export function toolPhotoFigure(tool) {
  const src = toolPhotoSrc(tool.id);
  if (!src) return null;
  const img = h('img', { class: 'tool-hero-img', src, alt: `Photo of ${tool.name}`, decoding: 'async' });
  const fig = h('figure', { class: 'tool-hero' }, img, h('figcaption', { class: 'muted small' }, PHOTO_CREDIT));
  img.addEventListener('error', () => fig.remove(), { once: true });
  return fig;
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
 * @property {(r: WikiRecipe) => Template | null} [templateFor] the template each recipe fills, when it depends on the recipe
 * @property {string} [useLabel] the recipe sheet's Use button
 * @property {(r: WikiRecipe, step: number) => void} [onUse]
 * @property {boolean} [allSteps] Use fills every step of a multi-step recipe
 * @property {boolean} [link] the name opens the tool's page (events, charts, recipes)
 * @property {boolean} [starred] the tool is one of My tools
 * @property {(on: boolean) => void} [onStar] shows a star that adds the tool to My tools or takes it off
 * @property {boolean} [noPhoto] show the category icon even when there is a photo (the tool's page shows it large)
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
          title: `${o.tool.shortName || o.tool.name} recipes`, recipes, template: o.template || null, templateFor: o.templateFor,
          allSteps: o.allSteps,
          useLabel: o.useLabel || 'Use recipe', onUse: /** @type {(r: WikiRecipe, step: number) => void} */ (o.onUse),
        });
      },
    }) : null,
    h('p', { class: 'muted small' }, 'Links open the LNF wiki in your browser. If the wiki or a document asks for a UMich login or the UMich network (VPN), sign in there. The app itself never contacts the wiki: its tool photos come with the app.'),
  ]);
}

/**
 * The tool's header card: its photo (tap to enlarge) or category icon, and
 * its name. With `link` the name opens the tool's page (events, charts,
 * recipes); the star adds the tool to My tools; "?" opens the wiki sheet.
 * @param {ToolCardOpts} o
 * @returns {HTMLElement}
 */
export function toolCard(o) {
  const help = TOOL_WIKI[o.tool.id] || (o.recipes && o.recipes.length);
  let starred = !!o.starred;
  /** @type {HTMLElement | null} */
  const star = o.onStar ? h('button', {
    type: 'button', class: 'btn btn-ghost btn-icon tool-card-star', 'aria-pressed': String(starred),
    'aria-label': `${o.tool.name} is one of my tools`,
    onClick: () => {
      starred = !starred;
      star?.setAttribute('aria-pressed', String(starred));
      o.onStar?.(starred);
    },
  }, icon('star')) : null;
  return h('div', { class: 'tool-card', dataset: { category: o.tool.category } },
    o.noPhoto ? iconBox(o.tool) : thumbnail(o.tool),
    h('span', { class: 'tool-card-text' },
      o.link
        ? h('a', { class: 'tool-card-name tool-card-link', href: `#/tool/${encodeURIComponent(o.tool.id)}` }, o.tool.name, icon('chevron', { size: 18 }))
        : h('span', { class: 'tool-card-name' }, o.tool.name),
      o.subtitle ? h('span', { class: 'tool-card-sub' }, o.subtitle) : null),
    star,
    help ? button('', {
      kind: 'ghost', icon: 'help', class: 'tool-card-help', ariaLabel: `${o.tool.name} on the LNF wiki`, onClick: () => openWikiSheet(o),
    }) : null);
}
