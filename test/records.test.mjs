// @ts-check
// Pure record stamping: ids, timestamps that always move forward, author and deviceId.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStamp, prepareNew, prepareUpdate, ValidationError, DEVICE_SETTINGS } from '../app/js/data/records.js';
import { isUuid } from '../app/js/core/ids.js';

const who = { deviceId: 'dev-A', userName: 'Ana' };
const T0 = Date.parse('2026-10-20T12:00:00.000Z');

test('nextStamp is strictly later than the previous stamp', () => {
  assert.equal(nextStamp(undefined, T0), '2026-10-20T12:00:00.000Z');
  assert.equal(nextStamp('2026-10-20T11:00:00.000Z', T0), '2026-10-20T12:00:00.000Z');
  assert.equal(nextStamp('2026-10-20T12:00:00.000Z', T0), '2026-10-20T12:00:00.001Z');
  assert.equal(nextStamp('2026-10-21T00:00:00.000Z', T0), '2026-10-21T00:00:00.001Z');
});

test('prepareNew stamps id, dates, device and author, and fills defaults', () => {
  const r = prepareNew('events', { toolId: 't1', type: 'clean', major: true, at: '2026-10-10T12:00:00.000Z' }, who, T0);
  assert.ok(isUuid(r.id));
  assert.equal(r.createdAt, '2026-10-20T12:00:00.000Z');
  assert.equal(r.updatedAt, r.createdAt);
  assert.equal(r.deleted, false);
  assert.equal(r.deviceId, 'dev-A');
  assert.equal(r.author, 'Ana');
  assert.equal(r.notes, '');
  const keep = prepareNew('events', { id: 'fixed', toolId: 't1', type: 'pm', major: true, at: r.at }, who, T0);
  assert.equal(keep.id, 'fixed');
});

test('prepareNew refuses invalid records', () => {
  assert.throws(() => prepareNew('events', { toolId: 't1', type: 'party', major: true, at: 'x' }, who, T0), ValidationError);
});

test('prepareUpdate keeps the creator, records the last-writing device and bumps updatedAt', () => {
  const r = prepareNew('events', { toolId: 't1', type: 'clean', major: true, at: '2026-10-10T12:00:00.000Z' }, who, T0);
  const u = prepareUpdate('events', { ...r, notes: 'edited' }, { deviceId: 'dev-B', userName: 'Bo' }, T0);
  assert.equal(u.author, 'Ana');
  assert.equal(u.deviceId, 'dev-B');
  assert.equal(u.createdAt, r.createdAt);
  assert.ok(u.updatedAt > r.updatedAt);
  assert.equal(u.notes, 'edited');
});

test('device-specific settings are listed for exclusion from backups', () => {
  for (const k of ['deviceId', 'deviceName', 'theme', 'lastExportAt']) assert.ok(DEVICE_SETTINGS.includes(k));
  assert.ok(!DEVICE_SETTINGS.includes('materials'));
  assert.ok(!DEVICE_SETTINGS.includes('tuning'));
});
