// @ts-check
/**
 * Inline SVG icons (24 × 24, stroked with currentColor). Icons always sit
 * next to a text label or carry an aria-label on their button; they are
 * decorative on their own.
 */
import { svg } from './dom.js';

/** @type {Record<string, string[]>} path data per icon */
const PATHS = {
  home: ['M3 11 12 4l9 7', 'M5 10v10h5v-6h4v6h5V10'],
  history: ['M12 7v5l3 2', 'M3.5 12a8.5 8.5 0 1 0 2.5-6', 'M3 4v4h4'],
  settings: ['M4 6h9', 'M17 6h3', 'M4 12h3', 'M11 12h9', 'M4 18h11', 'M19 18h1', 'M15 4v4', 'M9 10v4', 'M17 16v4'],
  back: ['M15 5l-7 7 7 7'],
  chevron: ['M9 5l7 7-7 7'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M20 20l-4.8-4.8'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
  wrench: ['M14.5 3.5a5 5 0 0 0-4.6 6.8L3.5 16.7 7.3 20.5l6.4-6.4a5 5 0 0 0 6.8-4.6l-3.2 3.2-3-.8-.8-3z'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z'],
  timer: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 9v4l2.5 2', 'M9 2h6'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  copy: ['M9 9h11v11H9z', 'M15 9V4H4v11h5'],
  alert: ['M12 3 2 21h20z', 'M12 10v5', 'M12 18v.01'],
  chart: ['M4 4v16h16', 'M7 15l4-5 3 3 5-6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
  up: ['M12 19V5', 'M6 11l6-6 6 6'],
  down: ['M12 5v14', 'M6 13l6 6 6-6'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  upload: ['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'],
  share: ['M12 3v12', 'M8 7l4-4 4 4', 'M5 12v8h14v-8'],
  bolt: ['M13 2 4 14h7l-1 8 9-12h-7z'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 7.5v.01'],
  flag: ['M5 21V4', 'M5 4h12l-2 4 2 4H5'],
  play: ['M7 4l13 8-13 8z'],
  stop: ['M6 6h12v12H6z'],
  pause: ['M9 5v14', 'M15 5v14'],
  undo: ['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
  sync: ['M4.5 10a8 8 0 0 1 14.1-3.9', 'M19 3v4h-4', 'M19.5 14a8 8 0 0 1-14.1 3.9', 'M5 21v-4h4'],
  ruler: ['M3 17 17 3l4 4L7 21z', 'M7 13l2 2', 'M10 10l2 2', 'M13 7l2 2'],
  filter: ['M4 5h16l-6 8v6l-4 2v-8z'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.6 9.3a2.5 2.5 0 1 1 3.5 2.4c-.7.3-1.1.9-1.1 1.6v.4', 'M12 16.8v.01'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  layers: ['M12 3 2.5 8 12 13l9.5-5z', 'M2.5 12.5 12 17.5l9.5-5', 'M2.5 16.5 12 21.5l9.5-5'],
  thermo: ['M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z', 'M12 9v7.5'],
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  image: ['M4 5h16v14H4z', 'M4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 18', 'M15.5 9.5h.01'],
  book: ['M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z', 'M5 20.5A2.5 2.5 0 0 1 7.5 18H19v3H7.5', 'M9 7h6'],
  star: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'],
  project: ['M9 4h6v3H9z', 'M7 5.5H5V21h14V5.5h-2', 'M8.5 12.5l2 2 4-4', 'M8.5 17.5h7'],
  steps: ['M4 7h4v4H4z', 'M10 9h10', 'M4 15h4v4H4z', 'M10 17h10', 'M6 11v4'],
  folder: ['M3 7a1.5 1.5 0 0 1 1.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z'],
  folderPlus: ['M3 7a1.5 1.5 0 0 1 1.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z', 'M12 11v6', 'M9 14h6'],
  move: ['M3 7a1.5 1.5 0 0 1 1.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z', 'M9 14h6', 'M13 11.5l2.5 2.5-2.5 2.5'],
};

/**
 * @param {string} name
 * @param {{size?: number, class?: string}} [opts]
 * @returns {SVGElement}
 */
export function icon(name, opts = {}) {
  const size = opts.size || 24;
  return svg('svg', {
    class: ['icon', opts.class],
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, (PATHS[name] || PATHS.info).map((d) => svg('path', { d })));
}

/** The icon of each tool category. */
export const CATEGORY_ICONS = Object.freeze(/** @type {Record<string, string>} */ ({
  etch: 'bolt', deposition: 'layers', thermal: 'thermo', litho: 'sun', metrology: 'ruler', other: 'wrench',
}));

/**
 * A tool category's icon, coloured by the category (class cat-icon).
 * @param {string} category
 * @param {{size?: number}} [opts]
 * @returns {SVGElement}
 */
export function categoryIcon(category, opts = {}) {
  const el = icon(CATEGORY_ICONS[category] || 'wrench', { size: opts.size, class: 'cat-icon' });
  el.dataset.category = category in CATEGORY_ICONS ? category : 'other';
  return el;
}
