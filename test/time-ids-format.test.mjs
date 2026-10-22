// @ts-check
// Core helpers: ids.js, time.js, format.js, vocab.js and config.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uuid, uuidFromBytes, isUuid } from '../app/js/core/ids.js';
import {
  ageDays, formatDay, formatMmSs, parseDuration, splitMinSec, toLocalInput, fromLocalInput, formatAge, formatAgo, isIsoDate, toMs,
} from '../app/js/core/time.js';
import { fmtNum, fmtSigned, withUnit, fmtRange, parseNumber, stepValue } from '../app/js/core/format.js';
import { normText } from '../app/js/core/vocab.js';
import { DEFAULTS, withTuning } from '../app/js/config.js';

test('uuid: crypto.randomUUID, getRandomValues fallback and format', () => {
  assert.ok(isUuid(uuid()));
  assert.equal(uuid({ randomUUID: () => 'from-crypto' }), 'from-crypto');
  const viaBytes = uuid({ getRandomValues: (a) => a.fill(255) });
  assert.equal(viaBytes, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.ok(isUuid(uuid({})));
  assert.equal(uuidFromBytes(new Uint8Array(16)), '00000000-0000-4000-8000-000000000000');
  assert.throws(() => uuidFromBytes(new Uint8Array(3)));
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(42), false);
});

test('ageDays and formatDay', () => {
  assert.equal(ageDays('2026-10-06T12:00:00Z', '2026-10-20T12:00:00Z'), 14);
  assert.equal(formatDay('2026-10-06T12:00:00Z'), 'Oct 6');
  assert.equal(formatDay('2025-10-06T12:00:00Z', '2026-10-20T12:00:00Z'), 'Oct 6, 2025');
  assert.equal(formatDay('nonsense'), '?');
  assert.ok(Number.isNaN(toMs('')));
  assert.equal(isIsoDate('2026-10-06T12:00:00Z'), true);
  assert.equal(isIsoDate('soon'), false);
  assert.equal(formatAge('2026-10-17T12:00:00Z', '2026-10-20T12:00:00Z'), '3 d');
  assert.equal(formatAge('2026-10-20T11:30:00Z', '2026-10-20T12:00:00Z'), '30 min');
  assert.equal(formatAgo('2026-10-20T11:59:40Z', '2026-10-20T12:00:00Z'), 'just now');
  assert.equal(formatAgo('2026-10-20T11:30:00Z', '2026-10-20T12:00:00Z'), '30 min ago');
});

test('mm:ss formatting and parsing', () => {
  assert.equal(formatMmSs(352.94), '5:53');
  assert.equal(formatMmSs(300), '5:00');
  assert.equal(formatMmSs(59.4), '0:59');
  assert.equal(formatMmSs(3725), '1:02:05');
  assert.equal(formatMmSs(NaN), '');
  assert.equal(parseDuration('5:53'), 353);
  assert.equal(parseDuration('75:00'), 4500);
  assert.equal(parseDuration('1:02:05'), 3725);
  assert.equal(parseDuration('90'), 90);
  assert.equal(parseDuration(' 0:30 '), 30);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('5:5x'), null);
  assert.equal(parseDuration('-1:00'), null);
  assert.deepEqual(splitMinSec(353), { min: 5, sec: 53 });
  assert.equal(splitMinSec(null), null);
  assert.equal(splitMinSec(-5), null);
});

test('datetime-local round trip in local time', () => {
  const iso = fromLocalInput('2026-10-20T08:15');
  assert.ok(iso);
  assert.equal(toLocalInput(/** @type {string} */ (iso)), '2026-10-20T08:15');
  assert.ok(fromLocalInput('2026-10-20'));
  assert.equal(fromLocalInput('20/10/2026'), null);
  assert.equal(toLocalInput('bad'), '');
});

test('fmtNum rounds to 3 significant figures for display only', () => {
  assert.equal(fmtNum(88.356), '88.4');
  assert.equal(fmtNum(0.18), '0.18');
  assert.equal(fmtNum(1.7284), '1.73');
  assert.equal(fmtNum(85), '85');
  assert.equal(fmtNum(71.0), '71');
  assert.equal(fmtNum(1234.5), '1235');
  assert.equal(fmtNum(0.000123456), '0.000123');
  assert.equal(fmtNum(-25), '−25');
  assert.equal(fmtNum(-0.0001, 1), '−0.0001');
  assert.equal(fmtNum(0), '0');
  assert.equal(fmtNum(NaN), '');
  assert.equal(fmtNum(undefined), '');
  assert.equal(fmtSigned(50), '+50');
  assert.equal(fmtSigned(-25), '−25');
  assert.equal(fmtSigned(0), '0');
  assert.equal(withUnit('85', 'nm/min'), '85 nm/min');
  assert.equal(withUnit('1.73', '%'), '1.73%');
  assert.equal(fmtRange(71, 94, 'nm/min'), '71–94 nm/min');
});

test('parseNumber accepts decimal commas and the minus sign, rejects junk', () => {
  assert.equal(parseNumber('12.5'), 12.5);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('−3'), -3);
  assert.equal(parseNumber(' 7 '), 7);
  assert.equal(parseNumber('.5'), 0.5);
  assert.equal(parseNumber('1e3'), 1000);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('1.2.3'), null);
  assert.equal(parseNumber(4), 4);
  assert.equal(parseNumber(Infinity), null);
});

test('stepValue avoids float noise and clamps to bounds', () => {
  assert.equal(stepValue(0.1, 0.2, 1), 0.3);
  assert.equal(stepValue(10, 0.5, -1), 9.5);
  assert.equal(stepValue(400, 10, 1), 410);
  assert.equal(stepValue(0, 10, -1, 0), 0);
  assert.equal(stepValue(95, 10, 1, 0, 100), 100);
  assert.equal(stepValue(1.25, 0.1, 1), 1.35);
  assert.ok(!Object.is(stepValue(0.1, 0.1, -1), -0));
});

test('normText folds case, spacing and Unicode compatibility forms', () => {
  assert.equal(normText('  SiO2  (thermal) '), 'sio2 (thermal)');
  assert.equal(normText('SiO₂'), normText('sio2'));
  assert.equal(normText('Ωcm'), normText('Ωcm'));
  assert.equal(normText(null), '');
  assert.equal(normText('Résist'), 'résist');
});

test('withTuning overrides only the tunable constants within range', () => {
  const c = withTuning({ halfLifeDays: 45, eventPenalty: 0.25, topK: 7.4 });
  assert.equal(c.HALF_LIFE_DAYS, 45);
  assert.equal(c.EVENT_PENALTY, 0.25);
  assert.equal(c.TOP_K, 7);
  const bad = withTuning({ halfLifeDays: -1, eventPenalty: 'x', topK: 1000 });
  assert.equal(bad.HALF_LIFE_DAYS, DEFAULTS.HALF_LIFE_DAYS);
  assert.equal(bad.EVENT_PENALTY, DEFAULTS.EVENT_PENALTY);
  assert.equal(bad.TOP_K, DEFAULTS.TOP_K);
  assert.deepEqual(withTuning(null), { ...DEFAULTS });
});
