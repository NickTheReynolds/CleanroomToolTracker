// @ts-check
/**
 * A plan step's pictures and files, and an exposure step's GDS layout, in
 * the step's sheet on the project page. Pictures are resized on the device
 * like run photos; other files are kept as they are. The bytes stay on the
 * device that added them, so a name synced from another device says so.
 */
import { h, fill } from './dom.js';
import { icon } from './icons.js';
import { button, sheet, toast, errorText, listRow } from './components.js';
import { textInput } from './fields.js';
import { formatBytes } from './export-flow.js';
import { resizePhoto } from '../data/photos.js';
import { downloadFile } from '../data/backup.js';
import { getProject, addStepFile, removeStepFile, setStepGds, stepFileBlob } from '../data/repo.js';
import { webLink, downloadName } from '../core/attachments.js';

/** @typedef {import('../core/types.js').PlanStep} PlanStep */
/** @typedef {import('../core/types.js').StepFile} StepFile */
/** @typedef {import('../core/types.js').GdsLayout} GdsLayout */

const ELSEWHERE = 'On another device';

/**
 * A hidden file input that hands over what was picked.
 * @param {string} accept
 * @param {boolean} multiple
 * @param {(files: File[]) => void} onFiles
 * @returns {HTMLInputElement}
 */
function picker(accept, multiple, onFiles) {
  const input = /** @type {HTMLInputElement} */ (h('input', {
    type: 'file', accept: accept || null, multiple, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true',
  }));
  input.addEventListener('change', () => {
    const files = [...(input.files || [])];
    input.value = '';
    if (files.length) onFiles(files);
  });
  return input;
}

/** @param {Blob} blob @param {string} name @param {string} [type] */
const download = (blob, name, type) => downloadFile(new File([blob], downloadName(name), { type: type || blob.type }));

/** @param {string} name a picked image's name @returns {string} the name of its resized JPEG */
const jpegName = (name) => `${String(name || '').replace(/\.[^.]*$/, '').trim() || 'picture'}.jpg`;

/**
 * @param {{projectId: string, stepId: string, exposure: boolean, onChange: () => void}} o
 *   exposure: the step exposes a pattern, so it offers a GDS layout; onChange: something was added or removed
 * @returns {{el: HTMLElement, dispose: () => void}}
 */
export function stepFiles(o) {
  /** @type {string[]} */
  let urls = [];
  const revoke = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  };
  const box = h('div', { class: 'stack' });
  const status = h('p', { class: 'field-note', role: 'status' });

  /** Redraw after a change and say what happened, with Undo when it can be taken back. */
  const changed = async (/** @type {string} */ message, /** @type {(() => Promise<void>) | null} */ undo) => {
    o.onChange();
    await draw();
    toast(message, undo ? { action: { label: 'Undo', fn: async () => { await undo(); o.onChange(); await draw(); } } } : {});
  };
  const add = async (/** @type {File[]} */ files, /** @type {'photo' | 'file'} */ kind) => {
    let n = 0;
    for (const file of files) {
      status.textContent = `Saving ${file.name || 'the file'}…`;
      try {
        if (kind === 'photo') {
          const r = await resizePhoto(file);
          await addStepFile(o.projectId, o.stepId, { blob: r.blob, name: jpegName(file.name), kind, width: r.width, height: r.height });
        } else {
          await addStepFile(o.projectId, o.stepId, { blob: file, name: file.name || 'file', kind });
        }
        n++;
      } catch (err) {
        toast(`${file.name || 'The file'} was not saved: ${errorText(err)}`, { kind: 'error' });
      }
    }
    status.textContent = '';
    const what = kind === 'photo' ? ['Picture', 'pictures'] : ['File', 'files'];
    if (n) await changed(n === 1 ? `${what[0]} added.` : `${n} ${what[1]} added.`, null);
  };
  const pictures = picker('image/*', true, (f) => add(f, 'photo'));
  const others = picker('', true, (f) => add(f, 'file'));

  const view = (/** @type {StepFile} */ a, /** @type {Blob | null} */ blob, /** @type {string} */ url) => {
    const s = sheet(a.name, [
      url ? h('img', { class: 'photo-full', src: url, alt: a.name }) : null,
      h('p', { class: 'muted small' }, blob ? formatBytes(a.size ?? blob.size)
        : `${formatBytes(a.size)}. ${ELSEWHERE}: the file stays on the device that added it. A backup with photos from that device brings it here.`),
      blob ? button('Download', { kind: 'primary', icon: 'download', onClick: () => download(blob, a.name, a.type) }) : null,
      button('Remove from this step', {
        kind: 'danger', icon: 'trash',
        onClick: async () => {
          s.close();
          try {
            await changed(`${a.name} removed.`, await removeStepFile(o.projectId, o.stepId, a.id));
          } catch (err) {
            toast(errorText(err), { kind: 'error' });
          }
        },
      }),
    ]);
  };

  const gdsForm = (/** @type {GdsLayout | null} */ g) => {
    const v = { name: g?.name || '', cell: g?.cell || '', layer: g?.layer || '', link: g?.link || '' };
    /** @type {File | null} */
    let file = null;
    const field = (/** @type {string} */ label, /** @type {'name' | 'cell' | 'layer' | 'link'} */ key, /** @type {string} */ placeholder) => {
      const id = `gds-${key}`;
      const input = textInput({ id, value: v[key], placeholder, autocapitalize: 'off', onChange: (x) => { v[key] = x || ''; } });
      return { input, el: h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), input.el) };
    };
    const name = field('Name', 'name', 'mask_v3.gds');
    const fileNote = h('p', { class: 'small' }, g?.fileId ? 'The attached file stays unless you pick another.'
      : 'Optional. Without it, the name, cell and link are kept.');
    const pick = picker('', false, ([f]) => {
      file = f;
      fileNote.textContent = `${f.name}, ${formatBytes(f.size)}`;
      if (!v.name.trim()) name.input.set(f.name);
    });
    /** @type {{close: () => void}} */
    let sh;
    const save = async () => {
      if (!v.name.trim() && !file && !g?.fileId) { toast('Name the layout or pick its file.', { kind: 'error' }); return; }
      sh.close();
      status.textContent = file ? `Saving ${file.name}…` : '';
      try {
        const undo = await setStepGds(o.projectId, o.stepId, { ...(g || {}), ...v }, file);
        await changed(g ? 'GDS layout changed.' : 'GDS layout added.', undo);
      } catch (err) {
        toast(errorText(err), { kind: 'error' });
      }
      status.textContent = '';
    };
    sh = sheet(g ? 'Change the GDS layout' : 'Add a GDS layout', [
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'GDS file'), fileNote,
        button(g?.fileId ? 'Pick another file' : 'Pick the file', { icon: 'upload', onClick: () => pick.click() }), pick),
      name.el, field('Top cell', 'cell', 'TOP').el, field('Layer', 'layer', '1').el,
      field('Where it is kept', 'link', 'A web link or a folder path').el,
      h('p', { class: 'muted small' }, 'The file stays on this device. Its name, cell, layer and link sync to your other devices and go into the traveler.'),
      h('div', { class: 'row-wrap' }, button('Save', { kind: 'primary', icon: 'check', onClick: save }), button('Cancel', { onClick: () => sh.close() })),
    ]);
  };

  const gdsCard = (/** @type {GdsLayout | undefined} */ g, /** @type {Blob | null} */ blob) => {
    if (!g) {
      return h('div', { class: 'card stack' },
        h('span', { class: 'label' }, 'GDS layout'),
        h('p', { class: 'muted small' }, 'Optional: the layout this exposure writes.'),
        button('Add a GDS layout', { icon: 'layers', onClick: () => gdsForm(null) }));
    }
    const href = webLink(g.link);
    /** @type {[string, string | Node][]} */
    const facts = [];
    if (g.cell) facts.push(['Top cell', g.cell]);
    if (g.layer) facts.push(['Layer', g.layer]);
    if (g.link) facts.push(['Kept at', href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, g.link) : g.link]);
    facts.push(['File', !g.fileId ? 'Not attached' : blob ? `On this device, ${formatBytes(g.size ?? blob.size)}` : `${ELSEWHERE}, ${formatBytes(g.size)}`]);
    return h('div', { class: 'card stack' },
      h('span', { class: 'label' }, 'GDS layout'),
      h('strong', { class: 'pre-line' }, g.name),
      h('dl', { class: 'facts' }, facts.map(([k, val]) => [h('dt', null, k), h('dd', null, val)])),
      h('div', { class: 'row-wrap' },
        blob ? button('Download', { icon: 'download', onClick: () => download(blob, g.name) }) : null,
        button('Change', { icon: 'edit', onClick: () => gdsForm(g) }),
        button('Remove', {
          icon: 'trash', kind: 'ghost',
          onClick: async () => {
            try {
              await changed('GDS layout removed.', await setStepGds(o.projectId, o.stepId, null));
            } catch (err) {
              toast(errorText(err), { kind: 'error' });
            }
          },
        })));
  };

  const draw = async () => {
    const step = (await getProject(o.projectId))?.steps.find((s) => s.id === o.stepId);
    revoke();
    if (!step) { fill(box, h('p', { class: 'muted' }, 'This step is no longer in the plan.')); return; }
    const files = step.attachments || [];
    const [gdsBlob, ...blobs] = await Promise.all([stepFileBlob(step.gds?.fileId), ...files.map((a) => stepFileBlob(a.id))]);
    /** @type {Node[]} */
    const thumbs = [];
    /** @type {Node[]} */
    const rows = [];
    files.forEach((a, i) => {
      const blob = blobs[i];
      if (a.kind === 'photo' && blob) {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        thumbs.push(h('button', { type: 'button', class: 'photo-thumb', 'aria-label': `Picture ${a.name}`, onClick: () => view(a, blob, url) },
          h('img', { src: url, alt: '' })));
      } else {
        rows.push(listRow({
          lead: icon(a.kind === 'photo' ? 'image' : 'file'),
          title: a.name,
          subtitle: blob ? formatBytes(a.size ?? blob.size) : `${formatBytes(a.size)} · ${ELSEWHERE}`,
          onClick: () => view(a, blob, ''),
        }));
      }
    });
    fill(box,
      o.exposure || step.gds ? gdsCard(step.gds, gdsBlob) : null,
      h('span', { class: 'label' }, 'Pictures and files'),
      thumbs.length ? h('div', { class: 'photo-grid' }, thumbs) : null,
      rows.length ? h('div', { class: 'list' }, rows) : null,
      files.length ? null : h('p', { class: 'muted small' }, 'None yet: pictures of the wafers, a microscope image, a measurement file.'),
      h('div', { class: 'row-wrap' },
        button('Add picture', { icon: 'camera', onClick: () => pictures.click() }),
        button('Add file', { icon: 'upload', onClick: () => others.click() })),
      status);
  };
  draw();
  return { el: h('div', { class: 'stack' }, box, pictures, others), dispose: revoke };
}
