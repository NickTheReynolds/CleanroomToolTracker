// @ts-check
/**
 * Quick capture: tool, photo and note only (and the projects the run is
 * for, when there are any), saved as a draft run to fill in later from Open
 * runs.
 */
import { h, append, fill, uid } from '../ui/dom.js';
import { button, linkButton, section, emptyState, toast, errorText, confirmDialog } from '../ui/components.js';
import { textInput } from '../ui/fields.js';
import { toolTiles, mineOf } from '../ui/pickers.js';
import { projectLinks } from '../ui/project-picker.js';
import { photoStrip } from '../ui/photos.js';
import { createAutosave } from '../ui/autosave.js';
import { navigate } from '../router.js';
import {
  listTools, listTemplates, listRuns, getDraft, saveDraft, clearDraft, saveRun, lastUsedByTool, purgeUnsavedPhotos,
  getSettings, listProjects,
} from '../data/repo.js';
import { uuid } from '../core/ids.js';

const DRAFT = 'capture';

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Quick capture');
  const [tools, templates, runs, saved, settings, projects] = await Promise.all([
    listTools(), listTemplates(), listRuns(), getDraft(DRAFT), getSettings(), listProjects(),
  ]);
  /** @type {{runId: string, toolId: string | null, notes: string, photoIds: string[], startedAt: string,
   *   projects?: import('../core/types.js').ProjectLink[]}} */
  let state = saved || { runId: uuid(), toolId: null, notes: '', photoIds: [], startedAt: new Date().toISOString(), projects: [] };
  const lastUsed = lastUsedByTool(runs);
  const autosave = createAutosave(() => saveDraft(DRAFT, state));
  const change = (/** @type {Partial<typeof state>} */ patch) => {
    state = { ...state, ...patch };
    autosave.schedule();
  };
  const body = h('div', { class: 'view' });
  /** @type {{dispose: () => void} | null} */
  let photos = null;

  const draw = () => {
    photos?.dispose();
    photos = null;
    const tool = tools.find((t) => t.id === state.toolId);
    if (!tool) {
      ctx.setActions([]);
      fill(body, tools.length
        ? toolTiles({ tools, lastUsed, mine: mineOf(settings.myTools, lastUsed), onPick: (t) => { change({ toolId: t.id }); draw(); } })
        : emptyState('No tools yet.', linkButton('Set up tools', '#/settings/tools')));
      return;
    }
    const notesId = uid('qc');
    const strip = photoStrip({ runId: state.runId, onChange: (ids) => change({ photoIds: ids }) });
    photos = strip;
    const projectBox = projectLinks({
      projects, runs, toolId: tool.id, links: state.projects || [], title: 'Projects', onChange: (links) => change({ projects: links }), newRun: true,
    });
    fill(body,
      h('div', { class: 'spread card' }, h('strong', null, tool.name),
        button('Change', { kind: 'ghost', onClick: () => { change({ toolId: null }); draw(); } })),
      section('Photo', strip.el),
      section('Note', h('div', { class: 'field' }, h('label', { class: 'label visually-hidden', for: notesId }, 'Note'),
        textInput({ id: notesId, value: state.notes, multiline: true, onChange: (v) => change({ notes: v || '' }) }).el,
        h('p', { class: 'field-note' }, 'Use the keyboard microphone to dictate.'))),
      projectBox ? section('Project', projectBox) : null);
    ctx.setActions([
      button('Discard', { icon: 'trash', onClick: discard }),
      button('Save draft', { kind: 'primary', icon: 'check', onClick: save }),
    ]);
  };

  const discard = async () => {
    const ok = await confirmDialog({
      title: 'Discard this capture?', message: 'Its note and photos will be deleted.', confirmLabel: 'Discard', danger: true,
    });
    if (!ok) return;
    autosave.cancel();
    await clearDraft(DRAFT);
    await purgeUnsavedPhotos(state.runId);
    navigate('/', { replace: true });
  };

  const save = async () => {
    const tool = tools.find((t) => t.id === state.toolId);
    if (!tool) return;
    const own = templates.filter((t) => t.toolId === tool.id);
    const templateId = tool.defaultTemplateId && own.some((t) => t.id === tool.defaultTemplateId)
      ? tool.defaultTemplateId
      : own.length === 1 ? own[0].id : null;
    try {
      autosave.cancel();
      await saveRun({
        id: state.runId, toolId: tool.id, templateId, status: 'draft', startedAt: state.startedAt,
        notes: state.notes.trim(), photoIds: state.photoIds, projects: state.projects || [],
      });
      await clearDraft(DRAFT);
      toast('Draft saved. Finish it from Open runs.');
      navigate('/', { replace: true });
    } catch (err) {
      autosave.schedule();
      toast(errorText(err), { kind: 'error' });
    }
  };

  draw();
  append(ctx.root, [body]);
  return async () => {
    photos?.dispose();
    await autosave.flush();
  };
}
