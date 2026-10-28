// @ts-check
/**
 * The frame around each view: title, back button, main-nav highlight and
 * the sticky bottom action bar.
 */
import { clear } from './dom.js';

/** @returns {HTMLElement} */
const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {(() => void) | null} */
let backHandler = null;

/**
 * @param {string} text
 */
export function setTitle(text) {
  byId('view-title').textContent = text;
  document.title = text === 'LNF Run Log' ? text : `${text} · LNF Run Log`;
}

/**
 * Show the back button. It goes back in the in-app history when there is
 * any, else to `fallback`.
 * @param {string | null} fallback route such as "/open"; null hides the button
 * @param {() => boolean} canGoBack whether an earlier in-app page exists
 */
export function setBack(fallback, canGoBack) {
  const btn = byId('nav-back');
  if (!fallback) {
    btn.hidden = true;
    backHandler = null;
    return;
  }
  btn.hidden = false;
  backHandler = () => {
    if (canGoBack()) history.back();
    else location.hash = `#${fallback}`;
  };
}

/** Wire the back button once at start-up. */
export function initShell() {
  byId('nav-back').addEventListener('click', () => backHandler?.());
}

/**
 * Mark the main-nav link for the current section.
 * @param {string} path
 */
export function setNavActive(path) {
  const section = path === '/' ? '/' : `/${path.split('/')[1]}`;
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.getAttribute('data-nav') === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

/**
 * Colour the whole page for a tool's category (2.1): the app bar, the status
 * bar behind it and the page's wash take the category's shades (base.css,
 * `html[data-tool-category]`), so a tool's page is unmistakably not the
 * project's. null gives the app's own blue back.
 * @param {string | null} category
 */
export function setTone(category) {
  const root = document.documentElement;
  if (category) root.dataset.toolCategory = category;
  else delete root.dataset.toolCategory;
  // The standalone app's status bar follows the app bar, whatever the theme is now.
  const bar = getComputedStyle(root).getPropertyValue('--header-bg').trim();
  if (bar) for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', bar);
}

/**
 * Fill (or hide) the sticky bottom action bar.
 * @param {Node[]} nodes buttons, primary last
 */
export function setActions(nodes) {
  const bar = byId('actionbar');
  const inner = byId('actionbar-inner');
  clear(inner);
  if (!nodes.length) {
    bar.hidden = true;
    document.body.style.setProperty('--actionbar-h', '0px');
    return;
  }
  inner.append(...nodes);
  bar.hidden = false;
  requestAnimationFrame(() => document.body.style.setProperty('--actionbar-h', `${bar.offsetHeight}px`));
}
