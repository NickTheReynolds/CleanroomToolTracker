// @ts-check
/**
 * Big-target pickers: tool tiles (recently used first, with search),
 * template tiles and the material chip picker (recent first, "More…" sheet,
 * add new).
 */
import { h, fill, uid } from './dom.js';
import { icon } from './icons.js';
import { button, sheet, emptyState } from './components.js';
import { CATEGORY_LABELS, normText } from '../core/vocab.js';
import { formatAge } from '../core/time.js';

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
  const draw = () => {
    const want = normText(query);
    const shown = ordered.filter((t) => !want || normText(`${t.name} ${t.shortName} ${t.category}`).includes(want));
    fill(grid, shown.length ? shown.map((t) => {
      const used = o.lastUsed.get(t.id);
      const sub = o.hint ? o.hint(t) : `${CATEGORY_LABELS[t.category] || t.category}${used ? ` · ${formatAge(used, now)} ago` : ''}`;
      const on = selectable && selected === t.id;
      return h('button', {
        type: 'button', class: 'tile', 'aria-pressed': selectable ? String(on) : undefined,
        onClick: () => {
          if (selectable) { selected = t.id; draw(); }
          o.onPick(t);
        },
      }, h('span', { class: 'tile-title' }, on ? icon('check', { size: 18 }) : null, t.name), h('span', { class: 'tile-sub' }, sub));
    }) : emptyState('No tool matches.'));
  };
  draw();
  if (o.tools.length <= 6) return grid;
  const id = uid('search');
  const search = /** @type {HTMLInputElement} */ (h('input', {
    id, class: 'input', type: 'search', placeholder: 'Search tools', autocomplete: 'off', enterkeyhint: 'search',
  }));
  search.addEventListener('input', () => { query = search.value; draw(); });
  return h('div', { class: 'stack' },
    h('label', { class: 'visually-hidden', for: id }, 'Search tools'), search, grid);
}

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

/**
 * Material chips: the first few options (recent first) plus the current
 * value; "More…" opens the full list with an "add new" box. Tapping the
 * selected chip clears it when allowNone.
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
    const id = uid('newmat');
    const input = /** @type {HTMLInputElement} */ (h('input', {
      id, class: 'input', type: 'text', placeholder: 'New material', autocomplete: 'off', enterkeyhint: 'done',
    }));
    const addNew = () => {
      const name = input.value.trim();
      if (!name) return;
      s.close();
      o.onAddNew?.(name);
      value = '';
      choose(name);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addNew(); });
    const s = sheet(o.label, [
      h('div', { class: 'picker' }, o.options.map((m) => h('button', {
        type: 'button', class: 'pick-btn', 'aria-pressed': String(!!value && normText(m) === normText(value)),
        onClick: () => { s.close(); value = ''; choose(m); },
      }, icon('check', { class: 'pick-check' }), m))),
      h('div', { class: 'field' }, h('label', { class: 'label', for: id }, 'Not in the list?'),
        h('div', { class: 'stepper' }, input, button('Use', { kind: 'primary', onClick: addNew }))),
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
