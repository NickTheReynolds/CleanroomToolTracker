// @ts-check
/**
 * Tool event: what happened (no preset: the person chooses), the tool (one
 * line with Change once chosen, or when the tool page sent its id), major
 * toggle (defaults by type), date and time (default now) and notes. Events
 * feed lookup: runs before a major event get less weight.
 */
import { h, append, fill, uid } from '../ui/dom.js';
import {
  button, section, segmented, toggle, emptyState, linkButton, toast, confirmDialog, errorText, labelRow, helpSection,
} from '../ui/components.js';
import { textInput } from '../ui/fields.js';
import { toolTiles, mineOf } from '../ui/pickers.js';
import { dateTimeField } from '../ui/run-form.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate } from '../router.js';
import {
  getEvent, saveEvent, deleteEvent, restoreEvent, listTools, listRuns, listEvents, getDraft, saveDraft, clearDraft,
  lastUsedByTool, getSettings,
} from '../data/repo.js';
import { EVENT_TYPES, MAJOR_BY_DEFAULT } from '../core/vocab.js';
import { HELP } from '../core/app-help.js';
import { toMs } from '../core/time.js';

/** Short button labels for event types. */
const TYPE_LABELS = /** @type {Record<string, string>} */ ({
  pm: 'PM', clean: 'Clean', seasoning: 'Seasoning', targetChange: 'Target change',
  gasChange: 'Gas change', fault: 'Fault', other: 'Other',
});

/**
 * @typedef {Object} EventState
 * @property {string | null} toolId
 * @property {string} type '' until the person chooses
 * @property {boolean} major
 * @property {boolean} majorTouched the person set Major by hand
 * @property {string} at
 * @property {string} notes
 */

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  const id = ctx.params.id || null;
  const existing = id ? await getEvent(id) : null;
  if (id && !existing) {
    ctx.setTitle('Tool event');
    append(ctx.root, [emptyState('This event does not exist.', linkButton('Home', '#/'))]);
    return;
  }
  ctx.setTitle(existing ? 'Edit tool event' : 'Tool event');
  const draftKey = `event:${id || 'new'}`;
  const [tools, runs, events, draft, settings] = await Promise.all([listTools(), listRuns(), listEvents(), getDraft(draftKey), getSettings()]);
  /** @type {EventState} */
  let state = draft || (existing
    ? { toolId: existing.toolId, type: existing.type, major: existing.major, majorTouched: true, at: existing.at, notes: existing.notes }
    : { toolId: ctx.query.get('tool'), type: '', major: false, majorTouched: false, at: new Date().toISOString(), notes: '' });
  if (!state.toolId && ctx.query.get('tool')) state = { ...state, toolId: ctx.query.get('tool') };
  const autosave = createAutosave(() => saveDraft(draftKey, state));
  const change = (/** @type {Partial<EventState>} */ patch) => {
    state = { ...state, ...patch };
    autosave.schedule();
  };
  // Recently used first: the latest run or event on each tool.
  const lastUsed = lastUsedByTool(runs);
  for (const e of events) {
    const t = toMs(e.at);
    const cur = lastUsed.get(e.toolId);
    if (cur === undefined || cur < t) lastUsed.set(e.toolId, t);
  }
  const majorSlot = h('div');
  const drawMajor = () => fill(majorSlot, toggle({
    label: 'Major event', help: HELP.eventMajor,
    hint: 'Major events (PM, chamber clean, target change) reduce the weight of earlier runs in lookup.',
    checked: state.major,
    onChange: (v) => change({ major: v, majorTouched: true }),
  }));
  drawMajor();
  // The tool: one line with Change once chosen, the tool tiles while choosing.
  const toolBox = h('div');
  let choosing = false;
  const drawTool = () => {
    const t = tools.find((x) => x.id === state.toolId);
    if (t && !choosing) {
      fill(toolBox, h('div', { class: 'card spread' }, h('strong', null, t.name),
        button('Change', { kind: 'ghost', onClick: () => { choosing = true; drawTool(); } })));
      return;
    }
    fill(toolBox, tools.length
      ? toolTiles({
        tools, lastUsed, mine: mineOf(settings.myTools, lastUsed), selectedId: state.toolId,
        onPick: (x) => { change({ toolId: x.id }); choosing = false; drawTool(); },
      })
      : emptyState('No tools yet.', linkButton('Set up tools', '#/settings/tools')));
  };
  drawTool();
  const notesId = uid('ev');
  append(ctx.root, [
    segmented({
      label: 'What happened', options: EVENT_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] })), value: state.type || null, compact: true,
      help: HELP.eventType,
      onChange: (v) => {
        const type = v || 'other';
        change(state.majorTouched ? { type } : { type, major: MAJOR_BY_DEFAULT.includes(type) });
        if (!state.majorTouched) drawMajor();
      },
    }),
    helpSection('Tool', HELP.eventTool, toolBox),
    majorSlot,
    dateTimeField('When', state.at, (iso) => change({ at: iso }), HELP.eventWhen),
    h('div', { class: 'field' }, labelRow(h('label', { class: 'label', for: notesId }, 'Notes'), 'Notes', HELP.eventNotes),
      textInput({ id: notesId, value: state.notes, multiline: true, onChange: (v) => change({ notes: v || '' }) }).el),
  ]);

  const save = async () => {
    if (!state.type) {
      toast('Choose what happened first.', { kind: 'error' });
      return;
    }
    if (!state.toolId) {
      toast('Choose the tool first.', { kind: 'error' });
      return;
    }
    try {
      autosave.cancel();
      const saved = await saveEvent({
        ...(existing || {}), toolId: state.toolId, type: state.type, major: state.major, at: state.at, notes: state.notes.trim(),
      });
      await clearDraft(draftKey);
      toast('Tool event saved.');
      navigate(`/tool/${saved.toolId}`, { replace: true });
    } catch (err) {
      autosave.schedule();
      toast(errorText(err), { kind: 'error' });
    }
  };
  ctx.setActions([
    existing ? button('Delete', {
      icon: 'trash',
      onClick: async () => {
        if (!await confirmDialog({ title: 'Delete this event?', message: 'Lookup will stop counting it.', confirmLabel: 'Delete', danger: true })) return;
        autosave.cancel();
        await clearDraft(draftKey);
        await deleteEvent(existing.id);
        navigate(`/tool/${existing.toolId}`, { replace: true });
        toast('Event deleted.', { action: { label: 'Undo', fn: async () => { await restoreEvent(existing.id); navigate(`/event/${existing.id}`); } } });
      },
    }) : button('Cancel', {
      onClick: async () => { autosave.cancel(); await clearDraft(draftKey); navigate('/', { replace: true }); },
    }),
    button('Save', { kind: 'primary', icon: 'check', onClick: save }),
  ]);
  return () => autosave.flush();
}
