// @ts-check
/**
 * History: every run (draft, open and complete), newest first, filtered by
 * tool, template, material, status, a local date range and keywords in the
 * notes, recipe and tags. The filters autosave, so they survive a reload;
 * "#/history?tool=<id>" starts from that tool alone. Tapping a row opens
 * the run.
 */
import { h, append, fill, uid, debounce } from '../ui/dom.js';
import { button, linkButton, emptyState, segmented } from '../ui/components.js';
import { runList, runRow, lookups } from '../ui/run-list.js';
import { createAutosave } from '../ui/autosave.js';
import { listRuns, listTools, listTemplates, getDraft, saveDraft } from '../data/repo.js';
import { filterRuns, distinctMaterials, normalizeFilters, hasFilters, EMPTY_FILTERS } from '../core/search.js';
import { RUN_STATUSES, STATUS_LABELS, normText } from '../core/vocab.js';
import { UI } from '../config.js';

/** @typedef {import('../core/search.js').RunFilters} RunFilters */
/** @typedef {import('../ui/run-list.js').Lookups} Lookups */
/** @typedef {import('../core/types.js').Run} Run */

const DRAFT = 'history';
/** The less-used filters, kept behind "More filters". */
const MORE = /** @type {(keyof RunFilters)[]} */ (['templateId', 'material', 'from', 'to']);
const STATUS_OPTIONS = [{ value: '', label: 'All' }, ...RUN_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))];

/**
 * Saved or preset filters with anything that no longer applies dropped: a
 * deleted tool, a template of another tool, a material no run uses.
 * @param {Partial<RunFilters> | null} raw
 * @param {Lookups} L
 * @param {string[]} materials
 * @returns {RunFilters}
 */
function usable(raw, L, materials) {
  const f = normalizeFilters(raw);
  if (!L.tools.has(f.toolId)) f.toolId = '';
  const tpl = L.templates.get(f.templateId);
  if (!tpl || tpl.toolId !== f.toolId) f.templateId = '';
  if (!RUN_STATUSES.includes(f.status)) f.status = '';
  f.material = materials.find((m) => normText(m) === normText(f.material)) || '';
  return f;
}

/**
 * A labelled native select.
 * @param {string} label
 * @param {[string, string][]} options [value, text]
 * @param {string} value
 * @param {(v: string) => void} onChange
 * @param {{disabled?: boolean, note?: string}} [o]
 * @returns {HTMLElement}
 */
function selectField(label, options, value, onChange, o = {}) {
  const id = uid('hf');
  const sel = /** @type {HTMLSelectElement} */ (h('select', { id, class: 'input', disabled: o.disabled },
    options.map(([v, text]) => h('option', { value: v }, text))));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), sel,
    o.note ? h('p', { class: 'field-note' }, o.note) : null);
}

/**
 * A labelled date input ("YYYY-MM-DD", empty for no limit).
 * @param {string} label
 * @param {string} value
 * @param {(v: string) => void} onChange
 * @returns {HTMLElement}
 */
function dateField(label, value, onChange) {
  const id = uid('hf');
  const input = /** @type {HTMLInputElement} */ (h('input', { id, class: 'input', type: 'date', value }));
  input.addEventListener('change', () => onChange(input.value));
  return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), input);
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('History');
  const [runs, tools, templates, saved] = await Promise.all([
    listRuns(), listTools({ includeArchived: true }), listTemplates(), getDraft(DRAFT),
  ]);
  if (!runs.length) {
    append(ctx.root, [emptyState('No runs yet. Every run you log appears here, newest first.',
      linkButton('Log a run', '#/log', { kind: 'primary', icon: 'plus' }))]);
    return;
  }
  const L = lookups(tools, templates);
  const materials = distinctMaterials(runs);
  const preset = ctx.query.get('tool');
  let filters = usable(preset ? { toolId: preset } : saved, L, materials);
  const autosave = createAutosave(() => saveDraft(DRAFT, filters));
  if (preset) {
    autosave.schedule();
    // A reload should show the person's later changes, not re-apply the preset.
    try { history.replaceState(history.state, '', '#/history'); } catch { /* the preset stays in the URL */ }
  }

  const filtersBox = h('div', { class: 'stack' });
  const moreState = h('span', { class: 'more-state' });
  const countEl = h('p', { class: 'muted small history-count', role: 'status', tabindex: '-1' });
  const listBox = h('div');
  const moreBox = h('div', { class: 'history-more' });
  /** @type {Run[]} */
  let matches = [];
  let shown = 0;

  const countText = () => {
    const n = matches.length;
    const head = hasFilters(filters)
      ? `${n} of ${runs.length} run${runs.length === 1 ? '' : 's'} match.`
      : `${n} run${n === 1 ? '' : 's'}, newest first.`;
    return shown < n ? `${head} Showing ${shown}.` : head;
  };
  const showMore = () => {
    const list = listBox.querySelector('.list');
    if (!list) return;
    const rows = matches.slice(shown, shown + UI.HISTORY_PAGE).map((r) => runRow(r, L));
    shown += rows.length;
    append(list, rows);
    countEl.textContent = countText();
    drawMore();
    if (rows.length) rows[0].focus();
  };
  const drawMore = () => {
    const left = matches.length - shown;
    fill(moreBox, left > 0 ? button(`Show more (${left} left)`, { icon: 'down', onClick: showMore }) : null);
  };
  const drawResults = () => {
    matches = filterRuns(runs, filters, L);
    shown = Math.min(UI.HISTORY_PAGE, matches.length);
    countEl.textContent = countText();
    fill(listBox, matches.length
      ? runList(matches.slice(0, shown), L)
      : emptyState('No runs match these filters.', button('Clear filters', { onClick: () => clearAll() })));
    drawMore();
  };
  const redraw = debounce(drawResults, 200);

  const clearBtn = button('Clear filters', { kind: 'ghost', icon: 'close', onClick: () => clearAll() });
  const updateChrome = () => {
    const n = MORE.filter((k) => filters[k]).length;
    moreState.textContent = n ? ` · ${n} set` : '';
    clearBtn.hidden = !hasFilters(filters);
  };
  /**
   * @param {Partial<RunFilters>} patch
   * @param {boolean} [typing] wait for a pause before redrawing
   */
  const change = (patch, typing = false) => {
    filters = { ...filters, ...patch };
    autosave.schedule();
    updateChrome();
    if (typing) redraw();
    else {
      redraw.cancel();
      drawResults();
    }
  };

  const buildControls = () => {
    const qId = uid('hq');
    const q = /** @type {HTMLInputElement} */ (h('input', {
      id: qId, class: 'input', type: 'search', value: filters.q, placeholder: 'e.g. trench reseason',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
    }));
    q.addEventListener('input', () => change({ q: q.value }, true));
    q.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      redraw.flush();
      q.blur(); // hide the phone keyboard to show the results
    });
    const templateSlot = h('div');
    const drawTemplate = () => {
      const own = templates.filter((t) => t.toolId === filters.toolId);
      fill(templateSlot, selectField('Template',
        /** @type {[string, string][]} */ ([['', 'Any template'], ...own.map((t) => [t.id, t.name])]),
        filters.templateId, (v) => change({ templateId: v }),
        filters.toolId ? {} : { disabled: true, note: 'Choose a tool first.' }));
    };
    drawTemplate();
    fill(filtersBox,
      h('div', { class: 'field' }, h('label', { class: 'label', for: qId }, 'Search notes, recipe and tags'), q),
      selectField('Tool',
        /** @type {[string, string][]} */ ([['', 'All tools'], ...tools.map((t) => [t.id, t.active ? t.name : `${t.name} (archived)`])]),
        filters.toolId, (v) => {
          change({ toolId: v, templateId: '' });
          drawTemplate();
        }),
      h('div', { class: 'history-status' }, segmented({
        label: 'Status', options: STATUS_OPTIONS, value: filters.status,
        onChange: (v) => change({ status: v || '' }),
      })),
      h('details', { class: 'more', open: MORE.some((k) => filters[k]) },
        h('summary', null, 'More filters', moreState),
        h('div', { class: 'fields' },
          templateSlot,
          selectField('Material', /** @type {[string, string][]} */ ([['', 'Any material'], ...materials.map((m) => [m, m])]),
            filters.material, (v) => change({ material: v })),
          h('div', { class: 'filter-dates' },
            dateField('From', filters.from, (v) => change({ from: v })),
            dateField('To', filters.to, (v) => change({ to: v }))))));
  };

  const clearAll = () => {
    filters = { ...EMPTY_FILTERS };
    autosave.schedule();
    buildControls();
    updateChrome();
    redraw.cancel();
    drawResults();
    countEl.focus(); // the button that was pressed is gone
  };

  buildControls();
  updateChrome();
  drawResults();
  const headId = uid('hh');
  append(ctx.root, [
    h('section', { class: 'section', 'aria-labelledby': headId },
      h('div', { class: 'filter-head' }, h('h2', { class: 'section-title', id: headId }, 'Filters'), clearBtn),
      filtersBox),
    h('section', { class: 'section', 'aria-label': 'Runs' }, countEl, listBox, moreBox),
    h('div', { class: 'row-wrap' }, linkButton('Export everything (Excel, CSV or PDF)', '#/settings/data', { icon: 'download' })),
  ]);
  return () => {
    redraw.cancel();
    return autosave.flush();
  };
}
