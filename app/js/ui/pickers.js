// @ts-check
/**
 * Big-target pickers: tool tiles (recently used first, with search),
 * template tiles and the material chip picker (recent first, "More…" sheet
 * with search and add new).
 */
import { h, fill, uid } from './dom.js';
import { icon, categoryIcon } from './icons.js';
import { button, sheet, emptyState, segmented } from './components.js';
import { CATEGORY_LABELS, normText } from '../core/vocab.js';
import { formatAge } from '../core/time.js';
import { LNF_MATERIAL_WORDS } from '../data/seed-lnf.js';

/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Template} Template */

/**
 * Tools ordered recently used first, then by name.
 * @param {Tool[]} tools
 * @param {Map<string, number>} lastUsed toolId -> epoch ms
 * @returns {Tool[]}
 */
export function byRecent(tools, lastUsed) {
  return [...tools].sort((a, b) => (lastUsed.get(b.id) || 0) - (lastUsed.get(a.id) || 0) || a.name.localeCompare(b.name));
}

/**
 * @param {{tools: Tool[], lastUsed: Map<string, number>, onPick: (t: Tool) => void, selectedId?: string | null,
 *   hint?: (t: Tool) => string}} o
 * @returns {HTMLElement}
 */
export function toolTiles(o) {
  const ordered = byRecent(o.tools, o.lastUsed);
  const grid = h('div', { class: 'tiles' });
  const now = Date.now();
  // With selectedId (even null) the tiles act as a single-choice group.
  const selectable = o.selectedId !== undefined;
  let selected = o.selectedId ?? null;
  let query = '';
  /** @type {string | null} */
  let category = null;
  const draw = () => {
    const want = normText(query);
    const shown = ordered.filter((t) => (!category || t.category === category)
      && (!want || normText(`${t.name} ${t.shortName} ${t.category}`).includes(want)));
    fill(grid, shown.length ? shown.map((t) => {
      const used = o.lastUsed.get(t.id);
      const sub = o.hint ? o.hint(t) : `${CATEGORY_LABELS[t.category] || t.category}${used ? ` · ${formatAge(used, now)} ago` : ''}`;
      const on = selectable && selected === t.id;
      return h('button', {
        type: 'button', class: 'tile', 'aria-pressed': selectable ? String(on) : undefined, dataset: { category: t.category },
        onClick: () => {
          if (selectable) { selected = t.id; draw(); }
          o.onPick(t);
        },
      }, h('span', { class: 'tile-title' }, on ? icon('check', { size: 18 }) : null, t.name),
      h('span', { class: 'tile-sub' }, categoryIcon(t.category, { size: 16 }), h('span', null, sub)));
    }) : emptyState('No tool matches.'));
  };
  draw();
  if (o.tools.length <= 6) return grid;
  const id = uid('search');
  const search = /** @type {HTMLInputElement} */ (h('input', {
    id, class: 'input', type: 'search', placeholder: 'Search tools', autocomplete: 'off', enterkeyhint: 'search',
  }));
  search.addEventListener('input', () => { query = search.value; draw(); });
  // Many tools: category chips narrow the tiles (combined with the search).
  const present = CATEGORY_ORDER.filter((c) => o.tools.some((t) => t.category === c));
  const chips = o.tools.length > 12 && present.length > 1 ? segmented({
    label: 'Category', compact: true, allowNone: true, value: /** @type {string | null} */ (null),
    options: present.map((c) => ({ value: c, label: CATEGORY_LABELS[c] || c })),
    onChange: (v) => { category = v; draw(); },
  }) : null;
  return h('div', { class: 'stack' },
    h('label', { class: 'visually-hidden', for: id }, 'Search tools'), search, chips, grid);
}

/** Display order of tool categories. */
const CATEGORY_ORDER = ['etch', 'deposition', 'thermal', 'litho', 'metrology', 'other'];

/**
 * @param {{templates: Template[], defaultId?: string | null, onPick: (t: Template) => void}} o
 * @returns {HTMLElement}
 */
export function templateTiles(o) {
  const list = [...o.templates].sort((a, b) => Number(b.id === o.defaultId) - Number(a.id === o.defaultId) || a.name.localeCompare(b.name));
  return h('div', { class: 'tiles' }, list.map((t) => h('button', {
    type: 'button', class: 'tile', onClick: () => o.onPick(t),
  }, h('span', { class: 'tile-title' }, t.name),
  h('span', { class: 'tile-sub' }, `${t.fields.filter((f) => f.role === 'input').length} inputs${t.id === o.defaultId ? ' · default' : ''}`))));
}

/** normText(material) -> the LNF wiki's other names for it. */
const MATERIAL_WORDS = new Map(Object.entries(LNF_MATERIAL_WORDS).map(([m, w]) => [normText(m), w]));

/** @param {string} s @returns {string[]} */
const searchWords = (s) => normText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * True when every word of `query` starts a word of the material's name or of
 * the wiki's other names for it: "gold" finds Au, "sio2 pecvd" finds
 * SiO2 (PECVD), and "si" does not find every resist.
 * @param {string} material
 * @param {string} query
 * @returns {boolean}
 */
export function materialMatches(material, query) {
  const want = searchWords(query);
  if (!want.length) return true;
  const have = searchWords(`${material} ${MATERIAL_WORDS.get(normText(material)) || ''}`);
  return want.every((w) => have.some((x) => x.startsWith(w)));
}

/**
 * Material chips: the first few options (recent first) plus the current
 * value; "More…" opens the full list with a box that searches it or adds a
 * new material. Tapping the selected chip clears it when allowNone.
 * @param {{label: string, value: string, options: string[], onChange: (v: string) => void,
 *   allowNone?: boolean, onAddNew?: (name: string) => void, show?: number}} o
 * @returns {HTMLElement}
 */
export function materialPicker(o) {
  let value = o.value || '';
  const labelId = uid('mat');
  const row = h('div', { class: 'picker', role: 'group', 'aria-labelledby': labelId });
  const current = h('span', { class: 'unit' });
  const choose = (/** @type {string} */ v) => {
    value = o.allowNone !== false && normText(v) === normText(value) ? '' : v;
    o.onChange(value);
    draw();
  };
  const chipFor = (/** @type {string} */ m) => {
    const on = !!value && normText(m) === normText(value);
    return h('button', { type: 'button', class: 'pick-btn', 'aria-pressed': String(on), onClick: () => choose(m) },
      icon('check', { class: 'pick-check' }), m);
  };
  const openAll = () => {
    const id = uid('findmat');
    const input = /** @type {HTMLInputElement} */ (h('input', {
      id, class: 'input', type: 'search', placeholder: 'e.g. SiO2, gold or a new name', autocomplete: 'off', enterkeyhint: 'done',
    }));
    const known = () => o.options.find((m) => normText(m) === normText(input.value));
    // The typed name: the listed material it spells, or a new one.
    const useTyped = () => {
      const name = input.value.trim();
      if (!name) return;
      const listed = known();
      s.close();
      if (!listed) o.onAddNew?.(name);
      value = '';
      choose(listed || name);
    };
    const use = button('Add', { kind: 'primary', onClick: useTyped });
    const chips = h('div', { class: 'picker' });
    const drawAll = () => {
      const shown = o.options.filter((m) => materialMatches(m, input.value));
      use.disabled = !input.value.trim();
      /** @type {Element} */ (use.lastElementChild).textContent = known() ? 'Use' : 'Add';
      fill(chips, shown.length ? shown.map((m) => h('button', {
        type: 'button', class: 'pick-btn', 'aria-pressed': String(!!value && normText(m) === normText(value)),
        onClick: () => { s.close(); value = ''; choose(m); },
      }, icon('check', { class: 'pick-check' }), m)) : h('p', { class: 'muted small' }, 'Not in the list. Tap Add to use it as a new material.'));
    };
    input.addEventListener('input', drawAll);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') useTyped(); });
    drawAll();
    const s = sheet(o.label, [
      h('div', { class: 'field' }, h('label', { class: 'label', for: id }, 'Find or add a material'),
        h('div', { class: 'stepper' }, input, use)),
      chips,
    ]);
  };
  const draw = () => {
    const show = o.show || 6;
    const first = o.options.slice(0, show);
    if (value && !first.some((m) => normText(m) === normText(value))) first.unshift(value);
    current.textContent = value ? ` (${value})` : '';
    fill(row, first.map(chipFor), button('More…', { kind: 'ghost', onClick: openAll }));
  };
  draw();
  return h('div', { class: 'field' }, h('span', { class: 'label', id: labelId }, o.label, current), row);
}
