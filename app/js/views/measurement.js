// @ts-check
/**
 * Measurement entry: metrology tool, kind, phase, material and unit, a site
 * preset with one stepper per point, and live mean / range / uniformity.
 * Saving converts to the stored unit and recomputes the run's derived
 * outputs.
 */
import { h, append, fill, uid } from '../ui/dom.js';
import {
  button, section, segmented, emptyState, linkButton, toast, confirmDialog, errorText, labelRow, helpSection,
} from '../ui/components.js';
import { numberStepper, textInput } from '../ui/fields.js';
import { toolTiles, materialPicker } from '../ui/pickers.js';
import { dateTimeField } from '../ui/run-form.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate } from '../router.js';
import {
  getMeasurement, getRun, getTool, getTemplate, listTools, listMeasurements, allMeasurements, saveMeasurement,
  deleteMeasurement, restoreMeasurement, getDraft, saveDraft, clearDraft, getSettings, getRecord,
} from '../data/repo.js';
import { pointStats, toCanonical, unitsFor } from '../core/derive.js';
import { fmtNum, fmtValue } from '../core/format.js';
import { MEASUREMENT_KINDS, KIND_LABELS } from '../core/vocab.js';
import { HELP } from '../core/app-help.js';
import { toMs } from '../core/time.js';

/** Site presets (spec Section 7). */
export const PRESETS = Object.freeze({
  center: { label: 'Center', sites: ['Center'] },
  centerEdge: { label: 'Center + 4 edge', sites: ['Center', 'N edge', 'E edge', 'S edge', 'W edge'] },
  five: { label: '5-point', sites: ['C', 'N', 'E', 'S', 'W'] },
  nine: { label: '9-point', sites: ['C', 'N', 'E', 'S', 'W', 'NE edge', 'SE edge', 'SW edge', 'NW edge'] },
  custom: { label: 'Custom', sites: [] },
});
/** @type {Record<string, number>} stepper increment per unit */
const STEP_BY_UNIT = { nm: 1, 'Å': 10, 'µm': 0.01, 'Ω/sq': 0.1, MPa: 1, '': 0.001 };

/**
 * @typedef {Object} MeasureState
 * @property {string | null} metrologyToolId
 * @property {string} kind
 * @property {'pre' | 'post'} phase
 * @property {string} material
 * @property {string} unit
 * @property {string} preset
 * @property {{site: string, value: number | null}[]} points
 * @property {string} takenAt
 * @property {string} notes
 */

/**
 * @param {string[]} sites
 * @returns {string}
 */
function presetFor(sites) {
  for (const [k, p] of Object.entries(PRESETS)) {
    if (k !== 'custom' && p.sites.length === sites.length && p.sites.every((s, i) => s === sites[i])) return k;
  }
  return 'custom';
}

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const editId = ctx.params.id || null;
  const existing = editId ? await getMeasurement(editId) : null;
  const runId = existing ? existing.runId : ctx.params.runId;
  const run = runId ? await getRun(runId) : null;
  if ((editId && !existing) || !run) {
    ctx.setTitle('Measurement');
    append(ctx.root, [emptyState('This measurement or run no longer exists.', linkButton('Open runs', '#/open'))]);
    return;
  }
  const [tool, template, tools, runMs, everyMs, settings] = await Promise.all([
    getTool(run.toolId), run.templateId ? getTemplate(run.templateId) : null, listTools({ includeArchived: true }),
    listMeasurements(run.id), allMeasurements(), getSettings(),
  ]);
  ctx.setTitle(existing ? 'Edit measurement' : 'Add measurement');
  const metrology = tools.filter((t) => t.kind === 'metrology' && (t.active || t.id === existing?.metrologyToolId));
  /** @type {Map<string, number>} */
  const lastUsed = new Map();
  for (const m of everyMs) {
    const t = toMs(m.takenAt);
    const cur = m.metrologyToolId ? lastUsed.get(m.metrologyToolId) : undefined;
    if (m.metrologyToolId && (cur === undefined || cur < t)) lastUsed.set(m.metrologyToolId, t);
  }
  const draftKey = `measure:${editId || `new:${run.id}`}`;
  /** @type {MeasureState | null} */
  const draft = await getDraft(draftKey);
  const latest = [...runMs].sort((a, b) => toMs(b.takenAt) - toMs(a.takenAt))[0];
  /** @type {MeasureState} */
  let state = draft || (existing ? {
    metrologyToolId: existing.metrologyToolId, kind: existing.kind, phase: existing.phase, material: existing.material,
    unit: existing.unit, preset: presetFor(existing.points.map((p) => p.site)),
    points: existing.points.map((p) => ({ site: p.site, value: p.value })), takenAt: existing.takenAt, notes: existing.notes,
  } : (() => {
    const kind = latest ? latest.kind : 'thickness';
    const hasPre = runMs.some((m) => m.phase === 'pre');
    const sites = latest ? latest.points.map((p) => p.site) : PRESETS.five.sites;
    const toolId = [...lastUsed.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || metrology[0]?.id || null;
    return {
      metrologyToolId: toolId, kind, phase: hasPre ? 'post' : 'pre', material: run.material,
      unit: (unitsFor(kind) || [''])[0], preset: presetFor(sites), points: sites.map((site) => ({ site, value: null })),
      takenAt: new Date().toISOString(), notes: '',
    };
  })());
  const autosave = createAutosave(() => saveDraft(draftKey, state));
  const change = (/** @type {Partial<MeasureState>} */ patch) => {
    state = { ...state, ...patch };
    autosave.schedule();
  };

  const stats = h('div', { class: 'live-stats', role: 'status', 'aria-live': 'polite' });
  const drawStats = () => {
    const st = pointStats(state.points.filter((p) => typeof p.value === 'number').map((p) => ({ site: p.site, value: /** @type {number} */ (p.value) })));
    const cell = (/** @type {string} */ v, /** @type {string} */ l) => h('div', null, h('b', null, v || '–'), h('span', null, l));
    fill(stats,
      cell(st ? fmtValue(st.mean, state.unit) : '', `mean (n = ${st ? st.n : 0})`),
      cell(st ? fmtValue(st.range, state.unit) : '', 'range'),
      cell(st && st.n > 1 && st.uniformity !== null ? `${fmtNum(st.uniformity)}%` : '', 'uniformity'));
  };

  const pointsBox = h('div', { class: 'points' });
  const drawPoints = () => {
    const step = STEP_BY_UNIT[state.unit] ?? 1;
    /** @type {HTMLInputElement[]} */
    const inputs = [];
    fill(pointsBox, state.points.map((p, i) => {
      const id = uid('pt');
      const prev = i > 0 ? state.points[i - 1].value : null;
      const st = numberStepper({
        id, label: `point ${p.site}`, value: p.value, step, min: state.kind === 'stress' ? undefined : 0,
        placeholder: typeof prev === 'number' ? prev : null,
        onChange: (v) => {
          const points = state.points.map((q, j) => (j === i ? { ...q, value: v } : q));
          change({ points });
          drawStats();
        },
      });
      st.input.setAttribute('enterkeyhint', i < state.points.length - 1 ? 'next' : 'done');
      st.input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (inputs[i + 1]) inputs[i + 1].focus();
        else st.input.blur();
      });
      inputs.push(st.input);
      return h('div', { class: 'point-row' }, h('label', { class: 'point-site', for: id }, p.site), st.el);
    }), state.preset === 'custom' ? h('div', { class: 'row-wrap' },
      button('Add point', { icon: 'plus', onClick: () => { change({ points: [...state.points, { site: String(state.points.length + 1), value: null }] }); drawPoints(); } }),
      button('Remove last', { icon: 'minus', disabled: state.points.length <= 1, onClick: () => { change({ points: state.points.slice(0, -1) }); drawPoints(); drawStats(); } })) : null);
  };

  const unitBox = h('div');
  const drawUnit = () => {
    const units = unitsFor(state.kind);
    if (!units) {
      const id = uid('unit');
      fill(unitBox, h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: id }, 'Unit'), 'Unit', HELP.measureUnitFree),
        textInput({ id, value: state.unit, autocapitalize: 'off', onChange: (v) => { change({ unit: v || '' }); drawStats(); } }).el));
    } else if (units.length > 1) {
      fill(unitBox, segmented({
        label: 'Unit (converted on save)', options: units.map((u) => ({ value: u, label: u })), value: state.unit, compact: true, help: HELP.measureUnit,
        onChange: (v) => { change({ unit: v || units[0] }); drawPoints(); drawStats(); },
      }));
    } else {
      fill(unitBox, h('p', { class: 'muted' }, `Unit: ${units[0] || 'none'}`));
    }
  };

  const materials = [...new Set([run.material, run.maskMaterial, ...settings.materials].filter(Boolean))];
  append(ctx.root, [
    h('p', { class: 'muted' }, `${tool ? tool.shortName || tool.name : 'Run'}${template ? ` · ${template.name}` : ''}${run.material ? ` · ${run.material}` : ''}`),
    helpSection('Metrology tool', HELP.measureTool, metrology.length
      ? toolTiles({ tools: metrology, lastUsed, selectedId: state.metrologyToolId, onPick: (t) => change({ metrologyToolId: t.id }) })
      : emptyState('No metrology tools yet.', linkButton('Add one', '#/settings/tool/new'))),
    segmented({
      label: 'Phase', options: [{ value: 'pre', label: 'Pre (before run)' }, { value: 'post', label: 'Post (after run)' }],
      value: state.phase, onChange: (v) => change({ phase: v === 'post' ? 'post' : 'pre' }), help: HELP.measurePhase,
    }),
    segmented({
      label: 'Kind', options: MEASUREMENT_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })), value: state.kind, compact: true,
      help: HELP.measureKind,
      onChange: (v) => {
        const kind = v || 'thickness';
        change({ kind, unit: (unitsFor(kind) || [state.unit])[0] });
        drawUnit();
        drawPoints();
        drawStats();
      },
    }),
    materialPicker({
      label: 'Material measured', value: state.material, options: materials, show: 4, help: HELP.measureMaterial,
      onChange: (v) => change({ material: v }),
    }),
    unitBox,
    segmented({
      label: 'Sites', options: Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label })), value: state.preset, compact: true,
      help: HELP.measureSites,
      onChange: (v) => {
        const preset = v || 'custom';
        const sites = preset === 'custom' ? state.points.map((p, i) => String(i + 1)) : PRESETS[/** @type {keyof typeof PRESETS} */ (preset)].sites;
        const points = sites.map((site, i) => ({ site, value: state.points[i] ? state.points[i].value : null }));
        change({ preset, points });
        drawPoints();
        drawStats();
      },
    }),
    helpSection('Points', HELP.measurePoints, pointsBox, stats, h('p', { class: 'field-note' }, 'Empty points are skipped. Enter moves to the next point.')),
    section('Notes', h('div', { class: 'field' },
      h('label', { class: 'visually-hidden', for: 'measure-notes' }, 'Measurement notes'),
      textInput({ id: 'measure-notes', value: state.notes, multiline: true, onChange: (v) => change({ notes: v || '' }) }).el)),
    h('details', { class: 'more' }, h('summary', null, 'Time measured'),
      h('div', { class: 'stack' }, dateTimeField('Measured at', state.takenAt, (iso) => change({ takenAt: iso }), HELP.measuredAt))),
  ]);
  drawUnit();
  drawPoints();
  drawStats();

  const save = async () => {
    const filled = state.points.filter((p) => typeof p.value === 'number');
    if (!filled.length) {
      toast('Enter at least one point.', { kind: 'error' });
      return;
    }
    let unit = state.unit;
    const points = filled.map((p) => {
      const c = toCanonical(state.kind, state.unit, /** @type {number} */ (p.value));
      unit = c.unit;
      return { site: p.site, value: c.value };
    });
    try {
      autosave.cancel();
      await saveMeasurement({
        ...(existing || {}), runId: run.id, metrologyToolId: state.metrologyToolId, kind: state.kind, phase: state.phase,
        material: state.material, unit, points, takenAt: state.takenAt, notes: state.notes.trim(),
      });
      await clearDraft(draftKey);
      const after = await getRecord('runs', run.id);
      const key = template?.primaryOutput;
      const f = key ? template?.fields.find((x) => x.key === key) : null;
      const v = key && after ? after.results[key] : undefined;
      toast(typeof v === 'number' && f ? `Saved. ${f.label}: ${fmtValue(v, f.unit)}.` : 'Measurement saved.');
      navigate(`/run/${run.id}`, { replace: true });
    } catch (err) {
      autosave.schedule();
      toast(errorText(err), { kind: 'error' });
    }
  };
  ctx.setActions([
    existing ? button('Delete', {
      icon: 'trash',
      onClick: async () => {
        if (!await confirmDialog({ title: 'Delete this measurement?', message: 'Derived results will be recomputed.', confirmLabel: 'Delete', danger: true })) return;
        autosave.cancel();
        await clearDraft(draftKey);
        await deleteMeasurement(existing.id);
        navigate(`/run/${run.id}`, { replace: true });
        toast('Measurement deleted.', { action: { label: 'Undo', fn: async () => { await restoreMeasurement(existing.id); navigate(`/run/${run.id}`); } } });
      },
    }) : button('Cancel', {
      onClick: async () => {
        const typed = state.points.some((p) => typeof p.value === 'number');
        if (typed && !await confirmDialog({ title: 'Discard this measurement?', message: 'The points you typed will be lost.', confirmLabel: 'Discard', danger: true })) return;
        autosave.cancel();
        await clearDraft(draftKey);
        navigate(`/run/${run.id}`, { replace: true });
      },
    }),
    button('Save', { kind: 'primary', icon: 'check', onClick: save }),
  ]);
  return () => autosave.flush();
}
