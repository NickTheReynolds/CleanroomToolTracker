// @ts-check
/** Small DOM helpers: the h() element builder, clear(), on() and friends. */

/** Properties set directly on the element instead of as attributes. */
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate', 'textContent', 'htmlFor']);

/** @typedef {Node | string | number | null | undefined | boolean | any[]} Child */

/**
 * Apply props to an element. `class` takes a string or a list (falsy
 * entries dropped), `style` an object or string, `dataset` an object;
 * `onClick`-style keys add listeners; `true` sets an empty attribute and
 * `false`/null/undefined skip it.
 * @param {Element} el
 * @param {Record<string, any> | null | undefined} props
 */
function setProps(el, props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') {
      const cls = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
      if (cls) el.setAttribute('class', cls);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(/** @type {HTMLElement} */ (el).style, v);
    } else if (k === 'dataset') {
      Object.assign(/** @type {HTMLElement} */ (el).dataset, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (PROPS.has(k)) {
      /** @type {any} */ (el)[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
}

/**
 * Append children, flattening arrays and skipping null, undefined and
 * booleans. Strings become text nodes (never parsed as HTML).
 * @param {Element | DocumentFragment} el
 * @param {Child[]} children
 */
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

/**
 * Create an HTML element.
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an SVG element.
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...Child} children
 * @returns {SVGElement}
 */
export function svg(tag, props, ...children) {
  const el = /** @type {SVGElement} */ (document.createElementNS(SVG_NS, tag));
  setProps(el, props);
  append(el, children);
  return el;
}

/**
 * Remove every child.
 * @template {Element} T
 * @param {T} el
 * @returns {T}
 */
export function clear(el) {
  el.replaceChildren();
  return el;
}

/**
 * Replace an element's children, skipping null/undefined/booleans (the
 * native replaceChildren and append would print "null").
 * @template {Element} T
 * @param {T} el
 * @param {...Child} children
 * @returns {T}
 */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/**
 * Add a listener and return a function that removes it.
 * @param {EventTarget} target
 * @param {string} type
 * @param {(e: any) => void} fn
 * @param {AddEventListenerOptions | boolean} [opts]
 * @returns {() => void}
 */
export function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn, opts);
}

let idCounter = 0;

/**
 * A page-unique id for label/for and aria references.
 * @param {string} [prefix]
 * @returns {string}
 */
export function uid(prefix = 'f') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Debounce a function; the returned function also has flush() and cancel().
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @param {number} ms
 * @returns {((...args: Parameters<F>) => void) & {flush: () => void, cancel: () => void}}
 */
export function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {Parameters<F> | null} */
  let pending = null;
  const run = () => {
    timer = null;
    const args = pending;
    pending = null;
    if (args) fn(...args);
  };
  const d = (/** @type {Parameters<F>} */ ...args) => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
  };
  d.flush = () => {
    if (timer) clearTimeout(timer);
    run();
  };
  d.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return d;
}
