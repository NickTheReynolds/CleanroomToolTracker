// @ts-check
/**
 * History: every run (draft, open and complete), newest first. Search looks
 * in the notes, recipe and tags; the filters (tool, project, status,
 * template, material and a local date range) fold into one line that says
 * which are set. The filters autosave, so they survive a reload;
 * "#/history?tool=<id>" or "?project=<id>" starts from that alone. On a
 * wide screen the runs show as a table that sorts by any column.
 */
import { h, append, fill, uid, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, linkButton, emptyState, segmented, labelRow } from '../ui/components.js';
import { runList, runRow, lookups } from '../ui/run-list.js';
import { runTable, runTableRow, sortRuns, DEFAULT_SORT } from '../ui/run-table.js';
import { createAutosave } from '../ui/autosave.js';
import { listRuns, listTools, listTemplates, getDraft, saveDraft, listProjects, listFolders } from '../data/repo.js';
import { filterRuns, distinctMaterials, normalizeFilters, hasFilters, EMPTY_FILTERS } from '../core/search.js';
import { folderTree, pathText } from '../core/folders.js';
import { RUN_STATUSES, STATUS_LABELS, normText } from '../core/vocab.js';
import { UI } from '../config.js';
import { HELP } from '../core/app-help.js';

/** @typedef {import('../core/search.js').RunFilters} RunFilters */
/** @typedef {import('../ui/run-list.js').Lookups} Lookups */
/** @typedef {import('../ui/run-table.js').RunSort} RunSort */
/** @typedef {import('../core/types.js').Run} Run */

const DRAFT = 'history';
const STATUS_OPTIONS = [{ value: '', label: 'All' }, ...RUN_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))];

/**
 * Saved or preset filters with anything that no longer applies dropped: a
 * deleted tool or project, a template of another tool, a material no run uses.
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
  if (!L.projects.has(f.projectId)) f.projectId = '';
  f.material = materials.find((m) => normText(m) === normText(f.material)) || '';
  return f;
}

/**
 * The filters that are set, in a few words: "ICP-2, Open, from 2026-10-01".
 * @param {RunFilters} f
 * @param {Lookups} L
 * @returns {string}
 */
function setText(f, L) {
  const tool = L.tools.get(f.toolId);
  return [
    tool ? tool.shortName || tool.name : '',
    L.projects.get(f.projectId)?.name || '',
    f.status ? STATUS_LABELS[f.status] : '',
    L.templates.get(f.templateId)?.name || '',
    f.material,
    f.from ? `from ${f.from}` : '',
    f.to ? `to ${f.to}` : '',
  ].filter(Boolean).join(', ');
}

/**
 * A labelled native select.
 * @param {string} label
 * @param {[string, string][]} options [value, text]
 * @param {string} value
 * @param {(v: string) => void} onChange
 * @param {{disabled?: boolean, note?: string, help?: string}} [o] help: the note behind its "i" button
 * @returns {HTMLElement}
 */
function selectField(label, options, value, onChange, o = {}) {
  const id = uid('hf');
  const sel = /** @type {HTMLSelectElement} */ (h('select', { id, class: 'input', disabled: o.disabled },
    options.map(([v, text]) => h('option', { value: v }, text))));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: id }, label), label, o.help), sel,
    o.note ? h('p', { class: 'field-note' }, o.note) : null);
}

/**
 * A labelled date input ("YYYY-MM-DD", empty for no limit).
 * @param {string} label
 * @param {string} value
 * @param {(v: string) => void} onChange
 * @param {string} [help] the note behind its "i" button
 * @returns {HTMLElement}
 */
function dateField(label, value, onChange, help) {
  const id = uid('hf');
  const input = /** @type {HTMLInputElement} */ (h('input', { id, class: 'input', type: 'date', value }));
  input.addEventListener('change', () => onChange(input.value));
  return h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: id }, label), label, help), input);
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('History');
  const [runs, tools, templates, saved, projects, folders] = await Promise.all([
    listRuns(), listTools({ includeArchived: true }), listTemplates(), getDraft(DRAFT), listProjects(), listFolders(),
  ]);
  if (!runs.length) {
    append(ctx.root, [emptyState('No runs yet. Every run you log appears here, newest first.',
      linkButton('Log a run', '#/log', { kind: 'primary', icon: 'plus' }))]);
    return;
  }
  ctx.root.classList.add('view-wide');
  const L = lookups(tools, templates, projects);
  const materials = distinctMaterials(runs);
  const tree = folderTree(folders);
  const projectOptions = projects
    .map((p) => /** @type {[string, string]} */ ([p.id, [pathText(tree, p.folderId), p.name].filter(Boolean).join(' › ')]))
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: 'base' }));
  const presetTool = ctx.query.get('tool');
  const presetProject = ctx.query.get('project');
  let filters = usable(presetTool || presetProject ? { toolId: presetTool || '', projectId: presetProject || '' } : saved, L, materials);
  const autosave = createAutosave(() => saveDraft(DRAFT, filters));
  if (presetTool || presetProject) {
    autosave.schedule();
    // A reload should show the person's later changes, not re-apply the preset.
    try { history.replaceState(history.state, '', '#/history'); } catch { /* the preset stays in the URL */ }
  }
  /** @type {RunSort} */
  let sort = { ...DEFAULT_SORT };

  const filtersBox = h('div', { class: 'stack' });
  const setState = h('span', { class: 'more-state' });
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
      : `${n} run${n === 1 ? '' : 's'}${sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir ? ', newest first' : ''}.`;
    return shown < n ? `${head} Showing ${shown}.` : head;
  };
  const showMore = () => {
    const list = listBox.querySelector('.history-list .list');
    const body = listBox.querySelector('.history-table tbody');
    if (!list || !body) return;
    const next = matches.slice(shown, shown + UI.HISTORY_PAGE);
    shown += next.length;
    const rows = next.map((r) => runRow(r, L));
    const trs = next.map((r) => runTableRow(r, L));
    append(list, rows);
    append(body, trs);
    countEl.textContent = countText();
    drawMore();
    // Focus the first new run in whichever form is shown: the list on a phone, the table on a wide screen.
    const first = rows[0] && rows[0].offsetParent ? rows[0] : /** @type {HTMLElement | null} */ (trs[0] ? trs[0].querySelector('a') : null);
    first?.focus();
  };
  const drawMore = () => {
    const left = matches.length - shown;
    fill(moreBox, left > 0 ? button(`Show more (${left} left)`, { icon: 'down', onClick: showMore }) : null);
  };
  const drawResults = () => {
    matches = sortRuns(filterRuns(runs, filters, L), sort, L);
    shown = Math.min(UI.HISTORY_PAGE, matches.length);
    countEl.textContent = countText();
    const page = matches.slice(0, shown);
    fill(listBox, matches.length
      ? [h('div', { class: 'history-list' }, runList(page, L)), runTable(page, L, sort, (key) => {
        sort = sort.key === key ? { key, dir: /** @type {1 | -1} */ (-sort.dir) } : { key, dir: key === 'startedAt' || key === 'result' ? -1 : 1 };
        drawResults();
        /** @type {HTMLElement | null} */ (listBox.querySelector(`.history-table th[aria-sort="${sort.dir === 1 ? 'ascending' : 'descending'}"] button`))?.focus();
      })]
      : emptyState('No runs match these filters.', button('Clear filters', { onClick: () => clearAll() })));
    drawMore();
  };
  const redraw = debounce(drawResults, 200);

  const clearBtn = button('Clear filters', { kind: 'ghost', icon: 'close', onClick: () => clearAll() });
  const updateChrome = () => {
    const text = setText(filters, L);
    setState.textContent = text ? `: ${text}` : '';
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
        filters.toolId ? { help: HELP.historyTemplate } : { disabled: true, note: 'Choose a tool first.', help: HELP.historyTemplate }));
    };
    drawTemplate();
    const set = Object.keys(EMPTY_FILTERS).some((k) => k !== 'q' && filters[/** @type {keyof RunFilters} */ (k)]);
    fill(filtersBox,
      h('div', { class: 'field' },
        labelRow(h('label', { class: 'label', for: qId }, 'Search notes, recipe and tags'), 'Search', HELP.historySearch), q),
      h('details', { class: 'more history-filters', open: set || undefined },
        h('summary', null, icon('filter', { size: 18 }), 'Filters', setState),
        h('div', { class: 'fields' },
          selectField('Tool',
            /** @type {[string, string][]} */ ([['', 'All tools'], ...tools.map((t) => [t.id, t.active ? t.name : `${t.name} (archived)`])]),
            filters.toolId, (v) => {
              change({ toolId: v, templateId: '' });
              drawTemplate();
            }, { help: HELP.historyTool }),
          projectOptions.length ? selectField('Project', /** @type {[string, string][]} */ ([['', 'Any project'], ...projectOptions]),
            filters.projectId, (v) => change({ projectId: v }), { help: HELP.historyProject }) : null,
          h('div', { class: 'history-status' }, segmented({
            label: 'Status', options: STATUS_OPTIONS, value: filters.status, help: HELP.historyStatus,
            onChange: (v) => change({ status: v || '' }),
          })),
          templateSlot,
          selectField('Material', /** @type {[string, string][]} */ ([['', 'Any material'], ...materials.map((m) => [m, m])]),
            filters.material, (v) => change({ material: v }), { help: HELP.historyMaterial }),
          h('div', { class: 'filter-dates' },
            dateField('From', filters.from, (v) => change({ from: v }), HELP.historyFrom),
            dateField('To', filters.to, (v) => change({ to: v }), HELP.historyTo)))),
      h('div', { class: 'row-end' }, clearBtn));
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
  append(ctx.root, [
    h('section', { class: 'section', 'aria-label': 'Search and filters' }, filtersBox),
    h('section', { class: 'section', 'aria-label': 'Runs' }, countEl, listBox, moreBox),
    h('div', { class: 'row-wrap' }, linkButton('Export everything (Excel, CSV or PDF)', '#/settings/data', { icon: 'download' })),
  ]);
  return () => {
    redraw.cancel();
    return autosave.flush();
  };
}
