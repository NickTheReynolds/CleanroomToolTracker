// @ts-check
/**
 * Lookup results: the summary card (estimate, range, confidence, warnings,
 * trend, suggested time) with the chart of the output over time beside it
 * (below it on a phone), ranked matches with signed differences and flags,
 * the result against any input that varies, relax suggestions when nothing
 * matches, and "Log this run".
 */
import { h, append } from '../ui/dom.js';
import { button, linkButton, section, segmented, emptyState, toast } from '../ui/components.js';
import { summaryCard, matchRow, noMatchesCard } from '../ui/lookup-card.js';
import { lineChart } from '../ui/chart.js';
import { inputScatter } from '../ui/scatter.js';
import { wikiReference } from '../ui/recipes.js';
import { navigate, refresh } from '../router.js';
import {
  getDraft, saveDraft, listRuns, listTemplates, listTools, listEvents, getSettings, lastRunFor, startLogDraft,
  LOOKUP_DRAFT,
} from '../data/repo.js';
import { recipesForTool } from '../data/recipes.js';
import { lookup } from '../core/similarity.js';
import { summarize } from '../core/summary.js';
import { blankDraft, prefillFrom, timerField } from '../core/run-draft.js';
import { recipeSteps } from '../core/run-steps.js';
import { findRecipe } from '../core/recipes.js';
import { uuid } from '../core/ids.js';
import { fmtValue } from '../core/format.js';
import { toMs, formatMmSs } from '../core/time.js';
import { EVENT_LABELS } from '../core/vocab.js';
import { HELP } from '../core/app-help.js';
import { withTuning } from '../config.js';

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Similar runs');
  ctx.root.classList.add('view-wide');
  const q = await getDraft(LOOKUP_DRAFT);
  if (!q) {
    append(ctx.root, [emptyState('Start a lookup first.', linkButton('Look up', '#/lookup', { kind: 'primary', icon: 'search' }))]);
    return;
  }
  const [runs, templates, tools, events, settings, recipes] = await Promise.all([
    listRuns(), listTemplates(), listTools({ includeArchived: true }), listEvents(), getSettings(),
    q.recipe ? recipesForTool(q.toolId) : [],
  ]);
  const template = templates.find((t) => t.id === q.templateId);
  const tool = tools.find((t) => t.id === q.toolId);
  if (!template || !tool) {
    append(ctx.root, [emptyState('The tool or template of this lookup no longer exists.', linkButton('New lookup', '#/lookup'))]);
    return;
  }
  const cfg = withTuning(settings.tuning);
  const now = Date.now();
  const result = lookup({ query: q, runs, templates, tools, events, now, cfg });
  const outputs = template.fields.filter((f) => f.role === 'output');
  const wanted = ctx.query.get('output');
  const outputKey = outputs.some((f) => f.key === wanted) ? /** @type {string} */ (wanted) : template.primaryOutput || outputs[0]?.key;
  const field = outputs.find((f) => f.key === outputKey);
  // The LNF recipe the query came from, if any: what the wiki says it gives.
  const wiki = findRecipe(recipes, q.recipe);
  const summary = outputKey ? summarize(result, { outputKey }) : null;
  const toolName = (/** @type {string} */ id) => {
    const t = tools.find((x) => x.id === id);
    return t ? t.shortName || t.name : 'tool';
  };
  ctx.setTitle('Similar runs');

  const recap = Object.entries(q.params || {})
    .map(([k, v]) => {
      const f = template.fields.find((x) => x.key === k && x.role === 'input');
      if (!f || v === null || v === '') return null;
      return f.type === 'duration' && typeof v === 'number' ? `${f.label} ${formatMmSs(v)}` : `${f.label} ${typeof v === 'number' ? fmtValue(v, f.unit) : v}`;
    })
    .filter(Boolean);
  const rules = [q.strictChemistry ? 'strict chemistry' : null, q.sameMaterial && q.material ? 'same material' : null,
    q.includeSiblings ? 'sibling tools' : null].filter(Boolean);

  const relax = async (/** @type {'strictChemistry' | 'sameMaterial' | 'includeSiblings'} */ key) => {
    await saveDraft(LOOKUP_DRAFT, { ...q, [key]: key === 'includeSiblings' });
    refresh();
  };

  const withOutput = result.matches.filter((m) => typeof m.run.results?.[outputKey] === 'number');
  const topK = cfg.TOP_K;
  const list = h('div', { class: 'list' });
  const showRows = (/** @type {number} */ count) => {
    list.replaceChildren(...result.matches.slice(0, count).map((m) => matchRow(m, {
      outputKey, unit: field?.unit || '', toolName, showTool: q.includeSiblings, now,
    })));
  };
  showRows(topK);
  const more = result.matches.length > topK ? button(`Show ${result.matches.length - topK} more`, {
    onClick: () => { showRows(result.matches.length); more?.remove(); },
  }) : null;

  // Chart: the output over time for matching runs, with events of the tools involved. Only exact
  // matches are joined by a line (a trend of the same recipe); runs beyond the closest K fade.
  const toolIds = new Set(result.matches.map((m) => m.run.toolId));
  toolIds.add(q.toolId);
  const rank = new Map(result.matches.map((m, i) => [m.run.id, i]));
  /** @type {Map<string, number>} run id -> fade */
  const fades = new Map(result.matches.map((m, i) => [m.run.id, m.exact || i < topK ? 0 : 0.55]));
  const exactIds = new Set(result.matches.filter((m) => m.exact).map((m) => m.run.id));
  const chart = withOutput.length ? lineChart({
    points: withOutput.map((m) => ({
      x: toMs(m.run.startedAt), y: /** @type {number} */ (m.run.results[outputKey]), id: m.run.id,
      label: m.exact ? 'exact match' : `d ${m.d.toFixed(2)}, #${(rank.get(m.run.id) ?? 0) + 1}`, hollow: m.eventSince,
      highlight: m === summary?.closest?.match, fade: fades.get(m.run.id) || 0,
    })),
    connect: exactIds.size >= 2 ? (p) => !!p.id && exactIds.has(p.id) : false,
    events: events.filter((e) => toolIds.has(e.toolId)).map((e) => ({ x: toMs(e.at), label: EVENT_LABELS[e.type] || e.type, major: e.major })),
    unit: field?.unit || '',
    yLabel: field?.label || '',
    ariaLabel: `${field?.label || 'Output'} of matching runs over time`,
    onSelect: (p) => navigate(`/run/${p.id}`),
  }) : null;

  const scatter = field ? inputScatter({
    runs: runs.filter((r) => r.toolId === q.toolId && r.templateId === q.templateId), template, output: field,
    fade: (id) => fades.get(id) ?? 0.7, planned: q.params || {}, onSelect: (id) => navigate(`/run/${id}`),
    note: 'Every complete run on this tool and template. Faded points are runs far from your plan or outside the match rules, so other settings may explain them. Tap a point to open the run.',
  }) : null;
  const chartBox = chart ? section(`${field?.label || 'Output'} over time`, chart,
    h('p', { class: 'muted small' }, `Hollow points are runs before a later major tool event; faded points are beyond the closest ${topK}.${exactIds.size >= 2 ? ' The line joins exact matches.' : ''} Dashed lines are tool events.`)) : null;
  append(ctx.root, [
    h('p', { class: 'muted small' }, [`${tool.shortName || tool.name} · ${template.name}`, q.material || 'any material', ...recap,
      typeof q.targetThickness === 'number' ? `target ${q.targetThickness} nm` : null].filter(Boolean).join(' · '),
    rules.length ? ` · ${rules.join(', ')}` : ''),
    outputs.length > 1 ? segmented({
      label: 'Result to estimate', compact: true, help: HELP.lookupOutput,
      options: outputs.map((f) => ({ value: f.key, label: f.label })), value: outputKey,
      onChange: (v) => { if (v) navigate(`/results?output=${encodeURIComponent(v)}`, { replace: true }); },
    }) : null,
    result.matches.length === 0 ? noMatchesCard(result, relax) : null,
    h('div', { class: 'results-top' },
      summary ? summaryCard(summary) : result.matches.length
        ? h('div', { class: 'card' }, h('p', null, `${result.matches.length} matching runs, but none has a value for ${field?.label || 'this result'}.`))
        : null,
      chartBox),
    wiki ? wikiReference(wiki, field) : null,
    result.matches.length ? section(`Matches (${result.matches.length})`,
      h('p', { class: 'muted small' }, 'Ranked by distance d (0 = same inputs). w is the weight in the average: similarity × recency × events.'),
      list, more) : null,
    scatter,
    h('div', { class: 'row-wrap' }, linkButton(`Every run on ${tool.shortName || tool.name}`, `#/tool/${encodeURIComponent(tool.id)}`, { icon: 'chart' })),
  ]);

  ctx.setActions([
    linkButton('Edit query', `#/lookup/${q.toolId}/${q.templateId}`, { icon: 'edit' }),
    button('Log this run', {
      kind: 'primary', icon: 'plus',
      onClick: async () => {
        const last = await lastRunFor(q.toolId, q.templateId);
        let d = blankDraft({ runId: uuid(), toolId: q.toolId, templateId: q.templateId, now: new Date().toISOString() });
        if (last) d = prefillFrom(d, last, template);
        // The run's steps: the LNF recipe's when it has several (the planned inputs are its main step), else the
        // last run's when it used the same recipe. Steps of another recipe never come along unseen.
        // The step the planned inputs came from is the run's main step (★), and the others keep their own values.
        const main = wiki && typeof q.recipeStep === 'number' && wiki.steps[q.recipeStep] ? q.recipeStep : wiki && wiki.main >= 0 ? wiki.main : 0;
        const own = wiki && wiki.steps.length > 1 ? recipeSteps(wiki, template, main).steps : null;
        const steps = own || (last && (q.recipe || '') === (last.recipe || '') ? d.steps : []);
        d = {
          ...d, params: { ...d.params, ...q.params }, copiedFrom: null, steps,
          material: q.material || d.material,
          recipe: q.recipe ?? d.recipe,
          targetThickness: typeof q.targetThickness === 'number' ? q.targetThickness : d.targetThickness,
        };
        const timeKey = timerField(template);
        if (timeKey && summary?.suggestedTime) {
          d.params[timeKey] = Math.round(summary.suggestedTime.seconds);
          toast(`Time set to the suggested ${summary.suggestedTime.mmss}.`);
        }
        if (await startLogDraft(d)) toast('Your other unsaved run was kept in Open runs as a draft.');
        navigate(`/log/${q.toolId}/${q.templateId}`);
      },
    }),
  ]);
}
