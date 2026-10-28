// @ts-check
// WCAG AA contrast for the colour tokens in app/css/base.css, light and dark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'css', 'base.css'), 'utf8');

/**
 * Token values declared in the first block whose selector matches.
 * @param {RegExp} selector
 * @returns {Record<string, string>}
 */
function tokens(selector) {
  const m = selector.exec(CSS);
  assert.ok(m, `block ${selector} not found`);
  const body = CSS.slice(m.index + m[0].length, CSS.indexOf('}', m.index + m[0].length));
  /** @type {Record<string, string>} */
  const out = {};
  for (const t of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[t[1]] = t[2].toLowerCase();
  return out;
}

/** @param {string} hex */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {string} a @param {string} b */
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Text pairs: [foreground, background] that must reach 4.5:1. */
const TEXT = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text-2', 'bg'], ['text-2', 'surface'],
  ['brand', 'bg'], ['brand', 'surface'], ['brand-ink', 'brand'], ['header-ink', 'header-bg'], ['danger-ink', 'danger'],
  ['warn', 'warn-soft'], ['warn', 'bg'], ['ok', 'ok-soft'], ['brand', 'brand-soft'], ['danger', 'danger-soft'],
  ['danger', 'surface'], ['text', 'warn-soft'], ['text', 'brand-soft'], ['text-2', 'surface-2'], ['bg', 'text'],
  // What is typed in a field, and its label beside it.
  ['text', 'field'], ['text-2', 'field'],
  // Tool category colours (icons and accents) on every surface.
  ...['etch', 'deposition', 'thermal', 'litho', 'metrology', 'other']
    .flatMap((c) => [[`cat-${c}`, 'surface'], [`cat-${c}`, 'surface-2'], [`cat-${c}`, 'bg']]),
];
/** UI component pairs that must reach 3:1 (WCAG 1.4.11). */
const UI = [['border-strong', 'surface'], ['focus', 'surface'], ['focus', 'bg'], ['chart-line', 'surface'],
  // A field's edge, and the step bar on a card: done and in-progress segments, a to-do segment's edge (border-strong on surface).
  ['border-strong', 'field'], ['ok', 'surface'], ['brand', 'surface']];

for (const [name, selector] of /** @type {[string, RegExp][]} */ ([
  ['light', /:root\s*\{/], ['dark', /:root\[data-theme="dark"\]\s*\{/],
])) {
  test(`${name} theme meets WCAG AA contrast`, () => {
    const t = tokens(selector);
    for (const [fg, bg] of TEXT) {
      assert.ok(t[fg] && t[bg], `missing --${fg} or --${bg}`);
      const c = contrast(t[fg], t[bg]);
      assert.ok(c >= 4.5, `${name}: --${fg} on --${bg} is ${c.toFixed(2)}:1 (need 4.5)`);
    }
    for (const [fg, bg] of UI) {
      const c = contrast(t[fg], t[bg]);
      assert.ok(c >= 3, `${name}: --${fg} on --${bg} is ${c.toFixed(2)}:1 (need 3)`);
    }
  });
}

test('the system dark theme repeats the manual dark tokens exactly', () => {
  const manual = tokens(/:root\[data-theme="dark"\]\s*\{/);
  const system = tokens(/:root:not\(\[data-theme="light"\]\)\s*\{/);
  assert.deepEqual(system, manual);
});
