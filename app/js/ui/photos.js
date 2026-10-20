// @ts-check
/**
 * Photo strip for a run: take or pick photos (resized on the device),
 * thumbnails, and a viewer with delete (soft, with Undo).
 */
import { h, fill } from './dom.js';
import { button, sheet, toast, errorText } from './components.js';
import { resizePhoto } from '../data/photos.js';
import { addPhoto, deletePhoto, restorePhoto, photoBlob, listPhotos } from '../data/repo.js';

/**
 * @param {{runId: string, onChange?: (photoIds: string[]) => void}} o
 * @returns {{el: HTMLElement, dispose: () => void, refresh: () => Promise<void>}}
 */
export function photoStrip(o) {
  /** @type {string[]} */
  let urls = [];
  const grid = h('div', { class: 'photo-grid' });
  const status = h('p', { class: 'field-note', role: 'status' });
  const input = /** @type {HTMLInputElement} */ (h('input', {
    type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true',
  }));
  const revoke = () => {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  };
  const refresh = async () => {
    const photos = await listPhotos(o.runId);
    revoke();
    fill(grid, photos.map((p) => {
      const blob = photoBlob(p);
      const url = blob ? URL.createObjectURL(blob) : '';
      if (url) urls.push(url);
      return h('button', {
        type: 'button', class: 'photo-thumb', 'aria-label': `Photo${p.caption ? `: ${p.caption}` : ''}`,
        onClick: () => view(p, url),
      }, url ? h('img', { src: url, alt: '' }) : h('span', { class: 'small muted' }, 'Photo unavailable'));
    }));
    o.onChange?.(photos.map((p) => p.id));
  };
  const view = (/** @type {any} */ p, /** @type {string} */ url) => {
    const s = sheet('Photo', [
      url ? h('img', { class: 'photo-full', src: url, alt: p.caption || 'Run photo' }) : h('p', null, 'Photo unavailable'),
      h('p', { class: 'muted small' }, `${p.width} × ${p.height} px`),
      button('Delete photo', {
        kind: 'danger', icon: 'trash',
        onClick: async () => {
          s.close();
          await deletePhoto(p.id);
          await refresh();
          toast('Photo deleted.', { action: { label: 'Undo', fn: async () => { await restorePhoto(p.id); await refresh(); } } });
        },
      }),
    ]);
  };
  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    input.value = '';
    for (const file of files) {
      status.textContent = 'Saving photo…';
      try {
        const r = await resizePhoto(file);
        await addPhoto({ runId: o.runId, blob: r.blob, width: r.width, height: r.height, takenAt: new Date().toISOString() });
      } catch (err) {
        toast(`Photo not saved: ${errorText(err)}`, { kind: 'error' });
      }
    }
    status.textContent = '';
    await refresh();
  });
  const el = h('div', { class: 'stack' },
    grid,
    input,
    button('Add photo', { icon: 'camera', onClick: () => input.click() }),
    status);
  refresh();
  return { el, dispose: revoke, refresh };
}
