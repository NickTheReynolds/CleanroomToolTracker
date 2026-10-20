// @ts-check
/**
 * Install on your devices: the app's public HTTPS address with a QR code a
 * phone camera can open, then install steps per platform (the current one
 * first) and the one-time publishing steps. Phones run the installed web
 * app; Windows and macOS also have desktop installers.
 */
import { h, append, fill, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, section, toast, badge } from '../ui/components.js';
import { isIos, isStandalone, canInstall, promptInstall, desktopWrapper } from '../ui/pwa.js';
import { getSettings, saveSettings } from '../data/repo.js';

/**
 * The address phones should open: this page's own address when it is served
 * over public HTTPS, else the address saved in Settings.
 * @param {string} saved
 * @returns {string}
 */
function publicAddress(saved) {
  const { protocol, hostname, origin, pathname } = window.location;
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.example');
  if (protocol === 'https:' && !local && !desktopWrapper()) return origin + pathname.replace(/index\.html$/, '');
  return saved;
}

/** @param {string} s @returns {boolean} */
const isHttpsUrl = (s) => {
  try { return new URL(s).protocol === 'https:'; } catch { return false; }
};

/**
 * @param {string} title
 * @param {(string | Node)[]} items
 * @param {boolean} [current]
 * @returns {HTMLElement}
 */
function steps(title, items, current) {
  return h('div', { class: 'card stack' },
    h('div', { class: 'spread' }, h('h3', null, title), current ? badge('This device', 'brand', 'check') : null),
    h('ol', { class: 'steps' }, items.map((s) => h('li', null, s))));
}

const IOS = [
  'Open the address in Safari.',
  'Tap the Page Menu button next to the address (iOS 27), or the More (…) button (iOS 26), then tap Share. With the Bottom or Top tab layout, tap Share directly.',
  'Scroll down and tap Add to Home Screen.',
  'Keep “Open as Web App” on, then tap Add.',
  'Open LNF Run Log from the Home Screen icon. It works offline from now on.',
];
const ANDROID = [
  'Open the address in Chrome.',
  'Tap ⋮ (top right), then Install and create shortcut → Install.',
  'Open LNF Run Log from the app drawer or home screen. It is listed under Settings → Apps like any app.',
];
const WINDOWS = [
  'Run the installer LNF-Run-Log-Setup-<version>.exe (built from this project with npm run build:windows).',
  'It installs for your Windows account only; no administrator rights are needed.',
  'Start LNF Run Log from the Start menu or the desktop icon. Run a newer installer to update; your data is kept.',
  'Or, in Chrome or Edge, open the address and click the install icon in the address bar.',
];
const MAC = [
  'Run the macOS app (LNF Run Log.app, built on a Mac with desktop/macos/build-macos.sh) and drag it to Applications.',
  'Or, in Safari, open the address and choose File → Add to Dock; in Chrome or Edge, use the install icon in the address bar.',
];
const PUBLISH = [
  'In GitHub Desktop, choose File → Add local repository and pick the project folder.',
  'Click Publish repository. Untick “Keep this code private”: free GitHub Pages needs a public repository. Only the app’s code is published, never your data.',
  'On github.com, open the repository → Settings → Pages, and set Source to GitHub Actions.',
  'Wait for the “Deploy to GitHub Pages” run under Actions. The address appears there: https://<your-user>.github.io/<repository>/.',
  'Enter that address above. Every later push updates all installed copies.',
];

/** @param {import('../router.js').ViewContext} ctx */
export async function render(ctx) {
  ctx.setTitle('Install on your devices');
  const settings = await getSettings();
  const wrapper = desktopWrapper();
  const ios = isIos();
  const android = /Android/i.test(navigator.userAgent);
  const qrBox = h('div', { class: 'stack' });
  // The QR renderer loads on demand; without it the address still shows as text.
  /** @type {((text: string, o: {ecc?: string, label?: string, size?: number}) => Element) | null} */
  let qrSvg = null;
  try {
    qrSvg = (await import('../ui/qr.js')).qrSvg;
  } catch {
    qrSvg = null;
  }

  const drawQr = (/** @type {string} */ url) => {
    if (!isHttpsUrl(url)) {
      fill(qrBox, h('p', { class: 'field-note' }, 'Enter the app’s HTTPS address to show a QR code that phones can scan.'));
      return;
    }
    fill(qrBox,
      qrSvg ? h('div', { class: 'qr-frame' }, qrSvg(url, { ecc: 'M', label: `QR code for ${url}`, size: 232 })) : null,
      h('p', { class: 'qr-url mono' }, url),
      h('div', { class: 'row-wrap' },
        button('Copy address', {
          icon: 'copy',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast('Address copied.');
            } catch {
              toast('Could not copy; select the address and copy it instead.', { kind: 'error' });
            }
          },
        }),
        typeof navigator.share === 'function' ? button('Share address', {
          icon: 'share',
          onClick: () => navigator.share({ title: 'LNF Run Log', url }).catch(() => {}),
        }) : null),
      h('p', { class: 'field-note' }, 'Point the phone’s camera at the code, open the link, then follow the steps for that phone below.'));
  };

  const address = publicAddress(settings.publicUrl || '');
  const own = address && address !== settings.publicUrl;
  const inputId = uid('url');
  const input = /** @type {HTMLInputElement} */ (h('input', {
    id: inputId, class: 'input mono', type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off',
    spellcheck: 'false', placeholder: 'https://your-user.github.io/your-repository/', value: settings.publicUrl || '',
  }));
  input.addEventListener('change', async () => {
    const v = input.value.trim();
    if (v && !isHttpsUrl(v)) {
      toast('The address must start with https://', { kind: 'error' });
      return;
    }
    await saveSettings({ publicUrl: v.endsWith('/') || !v ? v : `${v}/` });
    drawQr(v);
  });
  drawQr(address);

  const here = ios ? 'ios' : android ? 'android' : wrapper ? wrapper.platform : navigator.userAgent.includes('Mac') ? 'macos' : 'windows';
  const cards = [
    { key: 'ios', el: steps('iPhone and iPad', IOS, here === 'ios') },
    { key: 'android', el: steps('Android', ANDROID, here === 'android') },
    { key: 'windows', el: steps('Windows', WINDOWS, here === 'windows') },
    { key: 'macos', el: steps('Mac', MAC, here === 'macos') },
  ].sort((a, b) => Number(b.key === here) - Number(a.key === here)).map((c) => c.el);

  append(ctx.root, [
    wrapper ? h('div', { class: 'banner banner-info' }, icon('info'), h('div', { class: 'banner-body' },
      h('p', null, `You are using the ${wrapper.platform === 'macos' ? 'macOS' : 'Windows'} desktop app${wrapper.version ? ` (version ${wrapper.version})` : ''}.`))) : null,
    isStandalone() && !wrapper ? h('div', { class: 'banner banner-info' }, icon('check'), h('div', { class: 'banner-body' },
      h('p', null, 'This copy is already installed as an app.'))) : null,
    canInstall() ? button('Install this app now', { kind: 'primary', icon: 'download', big: true, onClick: () => promptInstall() }) : null,
    section('App address',
      own ? null : h('div', { class: 'field' },
        h('label', { class: 'label', for: inputId }, 'Published HTTPS address'),
        input,
        h('p', { class: 'field-note' }, 'Phones install the app from its HTTPS address. Not published yet? See “Publish the app” below.')),
      qrBox),
    section('Install steps', ...cards),
    h('p', { class: 'muted small' }, 'Each installed copy keeps its own data, separate from the browser and from your other devices. Move runs between devices with Settings → Backup and import.'),
    h('details', { class: 'more card' }, h('summary', null, 'Publish the app (once, free)'),
      h('ol', { class: 'steps' }, PUBLISH.map((s) => h('li', null, s))),
      h('p', { class: 'field-note' }, 'GitHub Desktop is a free app from GitHub. Any other static HTTPS host also works, including a Synology NAS with Web Station; see docs/DEPLOY.md.')),
  ]);
}
