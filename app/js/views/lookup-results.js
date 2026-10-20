// @ts-check
/**
 * Lookup results: the summary card (estimate, range, confidence, warnings,
 * trend, suggested time), ranked matches with signed differences and flags,
 * a chart of the output over time with tool events, relax suggestions when
 * nothing matches, and "Log this run".
 */
import { h, append } from '../ui/dom.js';
import { button, linkButton, section, segmented, emptyState, toast } from '../ui/components.js';
import { summaryCard, matchRow, noMatchesCard } from '../ui/lookup-card.js';
import { lineChart } from '../ui/chart.js';
import { navigate, refresh } from '../router.js';
import {
  getDraft, saveDraft, listRuns, listTemplates, listTools, listEvents, getSettings, lastRunFor, startLogDraft,
  LOOKUP_DRAFT,
} from '../data/repo.js';
import { lookup } from '../core/similarity.js';
import { summarize } from '../core/summary.js';
import { blankDraft, prefillFrom, timerField } from '../core/run-draft.js';
import { uuid } from '../core/ids.js';
import { fmtValue } from '../core/format.js';
import { toMs, formatMmSs } from '../core/time.js';
import { EVENT_LABELS } from '../core/vocab.js';
import { withTuning } from '../config.js';

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Similar runs');
  const q = await getDraft(LOOKUP_DRAFT);
  if (!q) {
    append(ctx.root, [emptyState('Start a lookup first.', linkButton('Look up', '#/lookup', { kind: 'primary', icon: 'search' }))]);
    return;
  }
  const [runs, templates, tools, events, settings] = await Promise.all([
    listRuns(), listTemplates(), listTools({ includeArchived: true }), listEvents(), getSettings(),
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
  const summary = outputKey ? summarize(result, { outputKey }) : null;
  const toolName = (/** @type {string} */ id) => {
    const t = tools.find((x) => x.id === id);
    return t ? t.shortName || t.name : 'tool';
  };
  ctx.setTitle(`Similar runs · ${tool.shortName || tool.name}`);

  const recap = Object.entries(q.params || {})
    .map(([k, v]) => {
      const f = template.fields.find((x) => x.key === k && x.role === 'input');
      if (!f || v === null || v === '') return null;
      return f.type === 'duration' && typeof v === 'number' ? `${f.label} ${formatMmSs(v)}` : `${f.label} ${typeof v === 'number' ? fmtValue(v, f.unit) : v}`;
    })
    .filter(Boolean);
  const rules = [q.strictChemistry ? 'strict chemistry' : null, q.sameMaterial ? 'same material' : null, q.includeSiblings ? 'sibling tools' : null].filter(Boolean);

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

  // Chart: the output over time for matching runs, with events of the tools involved.
  const toolIds = new Set(result.matches.map((m) => m.run.toolId));
  toolIds.add(q.toolId);
  const chart = withOutput.length ? lineChart({
    points: withOutput.map((m) => ({
      x: toMs(m.run.startedAt), y: /** @type {number} */ (m.run.results[outputKey]), id: m.run.id,
      label: m.exact ? 'exact match' : `d ${m.d.toFixed(2)}`, hollow: m.eventSince, highlight: m === summary?.closest?.match,
    })),
    events: events.filter((e) => toolIds.has(e.toolId)).map((e) => ({ x: toMs(e.at), label: EVENT_LABELS[e.type] || e.type, major: e.major })),
    unit: field?.unit || '',
    yLabel: field?.label || '',
    ariaLabel: `${field?.label || 'Output'} of matching runs over time`,
    onSelect: (p) => navigate(`/run/${p.id}`),
  }) : null;

  append(ctx.root, [
    h('p', { class: 'muted small' }, [template.name, q.material || 'any material', ...recap,
      typeof q.targetThickness === 'number' ? `target ${q.targetThickness} nm` : null].filter(Boolean).join(' · '),
    rules.length ? ` · ${rules.join(', ')}` : ''),
    outputs.length > 1 ? segmented({
      label: 'Result to estimate', compact: true,
      options: outputs.map((f) => ({ value: f.key, label: f.label })), value: outputKey,
      onChange: (v) => { if (v) navigate(`/results?output=${encodeURIComponent(v)}`, { replace: true }); },
    }) : null,
    result.matches.length === 0 ? noMatchesCard(result, relax) : null,
    summary ? summaryCard(summary) : result.matches.length
      ? h('div', { class: 'card' }, h('p', null, `${result.matches.length} matching runs, but none has a value for ${field?.label || 'this result'}.`))
      : null,
    result.matches.length ? section(`Matches (${result.matches.length})`,
      h('p', { class: 'muted small' }, 'Ranked by distance d (0 = same inputs). w is the weight in the average: similarity × recency × events.'),
      list, more) : null,
    chart ? section(`${field?.label || 'Output'} over time`, chart,
      h('p', { class: 'muted small' }, 'Hollow points are runs before a later major tool event. Dashed lines are tool events.')) : null,
  ]);

  ctx.setActions([
    linkButton('Edit query', `#/lookup/${q.toolId}/${q.templateId}`, { icon: 'edit' }),
    button('Log this run', {
      kind: 'primary', icon: 'plus',
      onClick: async () => {
        const last = await lastRunFor(q.toolId, q.templateId);
        let d = blankDraft({ runId: uuid(), toolId: q.toolId, templateId: q.templateId, now: new Date().toISOString() });
        if (last) d = prefillFrom(d, last, template);
        d = {
          ...d, params: { ...d.params, ...q.params }, copiedFrom: null,
          material: q.material || d.material,
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
