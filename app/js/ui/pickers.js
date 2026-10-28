// @ts-check
/**
 * Big-target pickers: tool tiles (your tools first, recently used first,
 * with search and "All tools"), template tiles and the material chip picker
 * (recent first, "More…" sheet with search and add new).
 */
import { h, fill, uid } from './dom.js';
import { icon, categoryIcon } from './icons.js';
import { button, linkButton, sheet, emptyState, segmented, labelRow } from './components.js';
import { HELP } from '../core/app-help.js';
import { CATEGORY_LABELS, normText } from '../core/vocab.js';
import { formatAgo, DAY_MS } from '../core/time.js';
import { LNF_MATERIAL_WORDS } from '../data/seed-lnf.js';

/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').Template} Template */

/** A tool used within this many days counts as one of yours. */
const RECENT_DAYS = 60;

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
 * The person's tools: the ones chosen in My tools and the ones used in the
 * last weeks.
 * @param {readonly string[] | null | undefined} myTools settings.myTools
 * @param {Map<string, number>} lastUsed toolId -> epoch ms of its latest run
 * @param {number} [now]
 * @returns {Set<string>}
 */
export function mineOf(myTools, lastUsed, now = Date.now()) {
  const out = new Set(myTools || []);
  for (const [id, t] of lastUsed) if (now - t <= RECENT_DAYS * DAY_MS) out.add(id);
  return out;
}

/**
 * @param {{tools: Tool[], lastUsed: Map<string, number>, onPick: (t: Tool) => void, selectedId?: string | null,
 *   hint?: (t: Tool) => string, mine?: Set<string> | null, chooseLink?: boolean}} o
 *   mine: the person's tools (mineOf); when some are listed, only those show until All tools, a
 *   search or a category asks for the rest. chooseLink: offer "Choose my tools" while there are none.
 * @returns {HTMLElement}
 */
export function toolTiles(o) {
  const ordered = byRecent(o.tools, o.lastUsed);
  const mine = o.mine || null;
  // A short list fits on the screen as it is, so only a long one folds to the person's tools.
  const hasMine = o.tools.length > 6 && !!mine && o.tools.some((t) => mine.has(t.id));
  let showAll = !hasMine;
  const grid = h('div', { class: 'tiles' });
  const more = h('div', { class: 'row-wrap' });
  const now = Date.now();
  // With selectedId (even null) the tiles act as a single-choice group.
  const selectable = o.selectedId !== undefined;
  let selected = o.selectedId ?? null;
  let query = '';
  /** @type {string | null} */
  let category = null;
  const chipsSlot = h('div');
  const draw = () => {
    const want = normText(query);
    const narrowing = !!want || !!category;
    const pool = showAll || narrowing ? ordered : ordered.filter((t) => /** @type {Set<string>} */ (mine).has(t.id) || t.id === selected);
    const shown = pool.filter((t) => (!category || t.category === category)
      && (!want || normText(`${t.name} ${t.shortName} ${t.category}`).includes(want)));
    fill(grid, shown.length ? shown.map((t) => {
      const used = o.lastUsed.get(t.id);
      const sub = o.hint ? o.hint(t) : `${CATEGORY_LABELS[t.category] || t.category}${used ? ` · ${formatAgo(used, now)}` : ''}`;
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
    fill(more, hasMine && !narrowing
      ? button(showAll ? 'Only my tools' : `All tools (${o.tools.length})`, {
        icon: showAll ? 'up' : 'down',
        onClick: () => {
          showAll = !showAll;
          draw();
          /** @type {HTMLElement | null} */ (more.querySelector('button'))?.focus();
        },
      }) : null);
    chipsSlot.hidden = hasMine && !showAll && !category;
  };
  draw();
  if (o.tools.length <= 6) return grid;
  const id = uid('search');
  const search = /** @type {HTMLInputElement} */ (h('input', {
    id, class: 'input', type: 'search', placeholder: 'Search all tools', autocomplete: 'off', enterkeyhint: 'search',
  }));
  search.addEventListener('input', () => { query = search.value; draw(); });
  // Many tools: category chips narrow the tiles (combined with the search).
  const present = CATEGORY_ORDER.filter((c) => o.tools.some((t) => t.category === c));
  if (o.tools.length > 12 && present.length > 1) {
    fill(chipsSlot, segmented({
      label: 'Category', compact: true, allowNone: true, value: /** @type {string | null} */ (null), help: HELP.toolFilter,
      options: present.map((c) => ({ value: c, label: CATEGORY_LABELS[c] || c })),
      onChange: (v) => { category = v; draw(); },
    }));
  }
  draw();
  const choose = o.chooseLink && mine && !hasMine && o.tools.length > 12 ? h('div', { class: 'banner banner-info' }, icon('star'),
    h('div', { class: 'banner-body' },
      h('p', null, h('strong', null, 'Pick the tools you use. '), 'Tool pickers then show those first, with every other tool one tap away.'),
      h('div', null, linkButton('Choose my tools', '#/settings/my-tools', { icon: 'star' })))) : null;
  return h('div', { class: 'stack' }, choose,
    h('label', { class: 'visually-hidden', for: id }, 'Search all tools'), search, chipsSlot, grid, more);
}

/** Display order of tool categories. */
const CATEGORY_ORDER = ['etch', 'deposition', 'thermal', 'litho', 'wet', 'metrology', 'other'];

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
 * What the More… box does with typed text: use the listed material it
 * names, or the only one it finds ("gold" finds Au), else add it as new.
 * @param {readonly string[]} options
 * @param {string} typed
 * @returns {{use: string | null, add: string | null, shown: string[]}}
 */
export function typedMaterial(options, typed) {
  const name = typed.trim();
  const shown = options.filter((m) => materialMatches(m, typed));
  if (!name) return { use: null, add: null, shown };
  const exact = options.find((m) => normText(m) === normText(name));
  if (exact) return { use: exact, add: null, shown };
  return { use: shown.length === 1 ? shown[0] : null, add: name, shown };
}

/**
 * Material chips: the first few options (recent first) plus the current
 * value; "More…" opens the full list with a box that searches it or adds a
 * new material. "Clear" empties the choice when allowNone. With `collapse`,
 * a chosen value shows alone with Change, which saves room for something
 * that rarely changes (the substrate).
 * @param {{label: string, value: string, options: string[], onChange: (v: string) => void,
 *   allowNone?: boolean, onAddNew?: (name: string) => void, show?: number, help?: string | readonly string[],
 *   collapse?: boolean}} o
 *   help adds an "i" button beside the label
 * @returns {HTMLElement}
 */
export function materialPicker(o) {
  let value = o.value || '';
  let expanded = !o.collapse || !value;
  const labelId = uid('mat');
  const row = h('div', { class: 'picker', role: 'group', 'aria-labelledby': labelId });
  const current = h('span', { class: 'unit' });
  const clearSlot = h('span');
  const choose = (/** @type {string} */ v) => {
    value = v;
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
    const pick = (/** @type {string} */ m) => { s.close(); choose(m); };
    // The typed text: the listed material it names or finds alone, else a new one.
    const useTyped = () => {
      const t = typedMaterial(o.options, input.value);
      if (t.use) pick(t.use);
      else if (t.add) addNew(t.add);
    };
    const addNew = (/** @type {string} */ name) => {
      o.onAddNew?.(name);
      pick(name);
    };
    const use = button('Add', { kind: 'primary', onClick: useTyped });
    const addOther = h('div');
    const chips = h('div', { class: 'picker' });
    const drawAll = () => {
      const t = typedMaterial(o.options, input.value);
      use.disabled = !input.value.trim();
      /** @type {Element} */ (use.lastElementChild).textContent = t.use ? `Use ${t.use}` : t.add ? 'Add' : 'Add';
      // One match that is not the typed name: offer the typed name as new too.
      fill(addOther, t.use && t.add ? button(`Add “${t.add}” as a new material`, { kind: 'ghost', onClick: () => addNew(/** @type {string} */ (t.add)) }) : null);
      fill(chips, t.shown.length ? t.shown.map((m) => h('button', {
        type: 'button', class: 'pick-btn', 'aria-pressed': String(!!value && normText(m) === normText(value)), onClick: () => pick(m),
      }, icon('check', { class: 'pick-check' }), m)) : h('p', { class: 'muted small' }, 'Not in the list. Tap Add to use it as a new material.'));
    };
    input.addEventListener('input', drawAll);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') useTyped(); });
    drawAll();
    const s = sheet(o.label, [
      h('div', { class: 'field' },
        labelRow(h('label', { class: 'label', for: id }, 'Find or add a material'), 'finding or adding a material',
          o.onAddNew ? HELP.findMaterial : HELP.findMaterialHere),
        h('div', { class: 'stepper' }, input, use), addOther),
      chips,
    ]);
  };
  const draw = () => {
    current.textContent = value ? ` (${value})` : '';
    fill(clearSlot, value && o.allowNone !== false ? h('button', {
      type: 'button', class: 'link-btn', 'aria-label': `Clear ${o.label}`,
      onClick: () => {
        expanded = true;
        choose('');
        /** @type {HTMLElement | null} */ (row.querySelector('button'))?.focus();
      },
    }, 'Clear') : null);
    if (!expanded) {
      fill(row, chipFor(value), button('Change', {
        kind: 'ghost',
        onClick: () => {
          expanded = true;
          draw();
          /** @type {HTMLElement | null} */ (row.querySelector('button'))?.focus();
        },
      }));
      return;
    }
    const show = o.show || 6;
    const first = o.options.slice(0, show);
    if (value && !first.some((m) => normText(m) === normText(value))) first.unshift(value);
    fill(row, first.map(chipFor), button('More…', { kind: 'ghost', onClick: openAll }));
  };
  draw();
  return h('div', { class: ['field', 'picker-field'] },
    labelRow(h('span', { class: 'label', id: labelId }, o.label, current), o.label, o.help, clearSlot), row);
}
