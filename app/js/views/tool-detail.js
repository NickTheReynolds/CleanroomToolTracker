// @ts-check
/**
 * Tool detail: the tool's facts, one chart per template of the primary
 * output over time (tool events as markers; runs from before the latest
 * major event drawn hollow) and against any input that varies, its event
 * timeline, its LNF recipes and its latest runs.
 */
import { h, append } from '../ui/dom.js';
import { button, linkButton, section, listRow, badge, emptyState, toast } from '../ui/components.js';
import { recipeList, fillMessage } from '../ui/recipes.js';
import { toolCard, toolPhotoFigure } from '../ui/tool-card.js';
import { runList, lookups } from '../ui/run-list.js';
import { lineChart } from '../ui/chart.js';
import { inputScatter } from '../ui/scatter.js';
import { navigate } from '../router.js';
import {
  getTool, listTemplates, listEvents, runsForTool, getSettings, saveSettings, lastRunFor, startLogDraft,
} from '../data/repo.js';
import { recipesForTool } from '../data/recipes.js';
import { blankDraft, prefillFrom } from '../core/run-draft.js';
import { templateForRecipe } from '../core/recipes.js';
import { recipeForForm } from '../core/run-steps.js';
import { uuid } from '../core/ids.js';
import { primarySeries } from '../core/search.js';
import { CATEGORY_LABELS, EVENT_LABELS, EVENT_SHORT } from '../core/vocab.js';
import { formatDateTime, formatDay, toMs } from '../core/time.js';
import { withTuning } from '../config.js';

/** @typedef {import('../core/types.js').Tool} Tool */
/** @typedef {import('../core/types.js').ToolEvent} ToolEvent */
/** @typedef {import('../core/types.js').Template} Template */
/** @typedef {import('../core/types.js').Run} Run */
/** @typedef {import('../core/recipes.js').WikiRecipe} WikiRecipe */

const EVENTS_SHOWN = 5;
const RECIPES_SHOWN = 5;
const RUNS_SHOWN = 20;
const NOTE_MAX = 90;

/** @param {string} s */
const clip = (s) => (s.length > NOTE_MAX ? `${s.slice(0, NOTE_MAX - 1).trimEnd()}…` : s);

/**
 * @param {Tool} tool
 * @param {number} defaultHalfLife days, from Settings
 * @returns {HTMLElement}
 */
function factsCard(tool, defaultHalfLife) {
  /** @type {[string, string][]} */
  const facts = [
    ['Category', CATEGORY_LABELS[tool.category] || tool.category],
    ['Kind', tool.kind === 'metrology' ? 'Metrology tool' : 'Process tool'],
    ['Status', tool.active ? 'Active' : 'Archived'],
    ['Half-life', tool.halfLifeDays ? `${tool.halfLifeDays} days` : `Default (${defaultHalfLife} days)`],
  ];
  if (tool.notes) facts.push(['Notes', tool.notes]);
  return h('div', { class: 'card stack tool-facts' },
    h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('div', { class: 'row-wrap' }, linkButton('Edit tool', `#/settings/tool/${encodeURIComponent(tool.id)}`, { icon: 'edit' })));
}

/**
 * "Log run with this recipe": a Log run form with the template the recipe
 * belongs to (a deposition recipe of a dual-chamber tool opens its PECVD
 * template), prefilled from the last run, with the recipe on top: every
 * step's values, and the material when the form has none and the recipe
 * names exactly one listed material.
 * @param {Tool} tool
 * @param {Template[]} templates the tool's templates
 * @param {string[]} materials the materials list
 * @returns {(r: WikiRecipe, step: number) => Promise<void>}
 */
function logWithRecipe(tool, templates, materials) {
  return async (r, step) => {
    const tpl = templateForRecipe(r, templates, tool.defaultTemplateId);
    if (!tpl) { navigate(`/log/${tool.id}`); return; }
    let d = blankDraft({ runId: uuid(), toolId: tool.id, templateId: tpl.id, now: new Date().toISOString() });
    const last = await lastRunFor(tool.id, tpl.id);
    if (last) d = prefillFrom(d, last, tpl);
    // The last run's steps come along only when it used this recipe, never another recipe's.
    if (last && (last.recipe || '') !== r.name) d = { ...d, steps: [] };
    const res = recipeForForm(d, r, tpl, step, materials);
    d = { ...d, ...res.patch, touched: true };
    if (await startLogDraft(d)) toast('Your other unsaved run was kept in Open runs as a draft.');
    toast(`${fillMessage(r, res.fill)}${res.material ? ` Material set to ${res.material}.` : ''}`);
    navigate(`/log/${encodeURIComponent(tool.id)}/${encodeURIComponent(tpl.id)}`);
  };
}

/**
 * The tool's LNF wiki recipes, the first few then Show all.
 * @param {Tool} tool
 * @param {Template | null} tpl the tool's default template
 * @param {WikiRecipe[]} recipes
 * @param {(r: WikiRecipe, step: number) => Promise<void>} onUse
 * @param {(r: WikiRecipe) => Template | null} templateFor the template each recipe opens
 * @returns {HTMLElement | null}
 */
function recipesSection(tool, tpl, recipes, onUse, templateFor) {
  if (!recipes.length) return null;
  const opts = {
    title: `${tool.shortName || tool.name} recipes`, recipes, template: tpl, templateFor, useLabel: 'Log run with this recipe', onUse, allSteps: true,
  };
  const list = recipeList({ ...opts, limit: RECIPES_SHOWN });
  const showAll = recipes.length > RECIPES_SHOWN ? button(`Show all ${recipes.length} recipes`, {
    onClick: () => {
      const all = recipeList(opts);
      list.replaceWith(all);
      showAll?.remove();
      /** @type {HTMLElement} */ (all.children[RECIPES_SHOWN]).focus(); // the first newly shown row
    },
  }) : null;
  return section(`LNF recipes (${recipes.length})`,
    h('p', { class: 'muted small' }, 'From the LNF wiki. Open one for its steps, results and source.'),
    list, showAll);
}

/**
 * The event timeline, newest first; the first few, then Show all.
 * @param {string} toolId
 * @param {ToolEvent[]} events newest first
 * @param {number} now
 * @returns {HTMLElement}
 */
function eventsSection(toolId, events, now) {
  const row = (/** @type {ToolEvent} */ e) => listRow({
    title: EVENT_LABELS[e.type] || EVENT_LABELS.other,
    subtitle: [formatDateTime(e.at, now), clip(String(e.notes || '').trim())].filter(Boolean).join(' · '),
    href: `#/event/${encodeURIComponent(e.id)}`,
    badges: e.major ? [badge('Major', 'warn')] : [],
  });
  const list = h('div', { class: 'list' }, events.slice(0, EVENTS_SHOWN).map(row));
  const showAll = events.length > EVENTS_SHOWN ? button(`Show all ${events.length} events`, {
    onClick: () => {
      const rest = events.slice(EVENTS_SHOWN).map(row);
      append(list, rest);
      showAll?.remove();
      rest[0].focus();
    },
  }) : null;
  return section('Events',
    events.length ? list : emptyState('No events yet. Log PMs, chamber cleans and target changes: lookup gives runs from before a major event less weight.'),
    h('div', { class: 'row-wrap' }, showAll,
      linkButton('Add event', `#/event?tool=${encodeURIComponent(toolId)}`, { icon: 'plus' })));
}

/**
 * The sentence under a chart that explains hollow points and event lines.
 * @param {{hollow: boolean}[]} points
 * @param {ToolEvent | null} latest the latest major event up to now
 * @param {boolean} hasMarkers the chart drew at least one event line
 * @param {number} now
 * @returns {HTMLElement | null}
 */
function legend(points, latest, hasMarkers, now) {
  const parts = [];
  if (latest && points.some((p) => p.hollow)) {
    const since = points.some((p) => !p.hollow) ? 'filled points are runs since then' : 'no run has started since';
    parts.push(`Hollow points are runs that started before the latest major event (${EVENT_LABELS[latest.type] || 'tool event'}, ${formatDay(latest.at, now)}); ${since}.`);
  }
  if (hasMarkers) parts.push('Dashed lines mark tool events: long dashes for major events, dots for minor ones.');
  return parts.length ? h('p', { class: 'chart-legend muted small' }, parts.join(' ')) : null;
}

/**
 * Per template with a primary output: its chart over time, with the
 * tool's events, and against the inputs that vary.
 * @param {Template[]} templates
 * @param {Run[]} runs
 * @param {ToolEvent[]} events newest first
 * @param {number} now
 * @returns {import('../ui/dom.js').Child[]}
 */
function chartSections(templates, runs, events, now) {
  const charted = templates.filter((t) => t.primaryOutput);
  if (!charted.length) {
    return [section('Charts', emptyState('No template of this tool has a primary output to chart.'))];
  }
  // Same rule as lookup: a major event "since the run" happened after it started, up to now.
  const latest = events.find((e) => e.major && toMs(e.at) <= now) || null;
  const cut = latest ? toMs(latest.at) : -Infinity;
  const markers = events.map((e) => ({ x: toMs(e.at), label: EVENT_LABELS[e.type] || EVENT_LABELS.other, major: !!e.major }));
  const byId = new Map(runs.map((r) => [r.id, r]));
  return charted.map((t) => {
    const field = t.fields.find((f) => f.key === t.primaryOutput);
    const name = field ? field.label : String(t.primaryOutput);
    const points = primarySeries(runs, t).map((p) => {
      const r = byId.get(p.id);
      const hollow = p.x < cut;
      const before = hollow && latest ? `before last ${EVENT_SHORT[latest.type] || 'event'}` : '';
      return { ...p, hollow, label: [r && r.material, r && r.recipe, before].filter(Boolean).join(' · ') };
    });
    const chart = lineChart({
      points, events: markers, unit: (field && field.unit) || '', yLabel: name, ariaLabel: `${name} on ${t.name} over time`,
      onSelect: (p) => { location.hash = `#/run/${encodeURIComponent(String(p.id))}`; },
    });
    const own = runs.filter((r) => r.templateId === t.id);
    return [
      section(`${t.name}: ${name}`, chart, legend(points, latest, Number(chart.dataset.events) > 0, now)),
      field ? inputScatter({
        runs: own, template: t, output: field, onSelect: (runId) => navigate(`/run/${runId}`),
        fade: (runId) => (byId.get(runId) && toMs(/** @type {Run} */ (byId.get(runId)).startedAt) < cut ? 0.5 : 0),
        note: `Every complete ${t.name} run on this tool. Other settings differ from run to run, so read the line as a hint, not a law. Faded points are runs from before the latest major event. Tap a point to open the run.`,
      }) : null,
    ];
  });
}

/**
 * The latest runs on the tool and a link to all of them in History.
 * @param {string} toolId
 * @param {Run[]} runs newest first
 * @param {import('../ui/run-list.js').Lookups} L
 * @returns {HTMLElement}
 */
function runsSection(toolId, runs, L) {
  const n = runs.length;
  if (!n) return section('Recent runs', emptyState('No runs on this tool yet.'));
  return section('Recent runs',
    h('p', { class: 'muted small' }, n > RUNS_SHOWN ? `The latest ${RUNS_SHOWN} of ${n} runs.` : `${n} run${n === 1 ? '' : 's'}, newest first.`),
    runList(runs.slice(0, RUNS_SHOWN), L, { onTool: true }),
    h('div', { class: 'row-wrap' }, linkButton('All runs in History', `#/history?tool=${encodeURIComponent(toolId)}`, { icon: 'history' })));
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const id = ctx.params.id;
  const tool = await getTool(id);
  if (!tool || tool.deleted) {
    ctx.setTitle('Tool not found');
    append(ctx.root, [emptyState('This tool does not exist.', linkButton('All tools', '#/settings/tools'))]);
    return;
  }
  const [templates, events, runs, settings, recipes] = await Promise.all([
    listTemplates(id), listEvents(id), runsForTool(id), getSettings(), recipesForTool(id),
  ]);
  const L = lookups([tool], templates);
  const tpl = templates.find((t) => t.id === tool.defaultTemplateId) || templates[0] || null;
  const onUse = logWithRecipe(tool, templates, settings.materials);
  const templateFor = (/** @type {WikiRecipe} */ r) => templateForRecipe(r, templates, tool.defaultTemplateId);
  ctx.setTitle(tool.shortName || tool.name);
  ctx.root.classList.add('view-wide');
  append(ctx.root, [
    toolPhotoFigure(tool),
    toolCard({
      tool, subtitle: CATEGORY_LABELS[tool.category] || tool.category, recipes, template: tpl, templateFor,
      useLabel: 'Log run with this recipe', onUse, allSteps: true, noPhoto: true,
      starred: (settings.myTools || []).includes(tool.id),
      onStar: async (on) => {
        const mine = new Set((await getSettings()).myTools || []);
        if (on) mine.add(tool.id);
        else mine.delete(tool.id);
        await saveSettings({ myTools: [...mine] });
        toast(on ? `${tool.shortName || tool.name} is now one of your tools.` : `${tool.shortName || tool.name} is no longer one of your tools.`);
      },
    }),
    factsCard(tool, withTuning(settings.tuning).HALF_LIFE_DAYS),
    chartSections(templates, runs, events, L.now),
    eventsSection(id, events, L.now),
    recipesSection(tool, tpl, recipes, onUse, templateFor),
    runsSection(id, runs, L),
  ]);
  if (tool.active) {
    ctx.setActions([linkButton('Log run', `#/log/${encodeURIComponent(id)}`, { kind: 'primary', icon: 'plus', big: true })]);
  }
}
