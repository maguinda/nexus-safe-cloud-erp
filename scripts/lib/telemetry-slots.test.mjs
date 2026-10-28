import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MINUTE, batchFor, buildSlots, cycleLength, nextCursor, parseArgs } from './telemetry-slots.mjs';

const real = JSON.parse(readFileSync(new URL('../../services/analytics/prisma/data/iot-readings.json', import.meta.url), 'utf8'));
const r = (id, at, deviceId = 'D1') => ({ id, deviceId, recordedAt: at, status: 'NORMAL', value: id, unit: '°C', note: null });

test('buildSlots groups by instant, in order, whatever the input order', () => {
  const slots = buildSlots([r(3, '2026-09-13T08:02:00.000Z', 'B'), r(1, '2026-09-13T08:01:00.000Z', 'B'), r(2, '2026-09-13T08:01:00.000Z', 'A')]);
  assert.deepEqual(slots.map((s) => s.readings.map((x) => x.id)), [[2, 1], [3]]);
  assert.equal(slots[0].at, Date.parse('2026-09-13T08:01:00Z'));
});

test('buildSlots rejects empty input and impossible dates instead of making them up', () => {
  assert.throws(() => buildSlots([]), /no hay lecturas/);
  assert.throws(() => buildSlots([r(1, 'nunca')]), /fecha inválida/);
});

test('with the real data: 200 one-minute slots of 21 devices, a cycle lasts 200 minutes', () => {
  const slots = buildSlots(real);
  assert.equal(slots.length, 200);
  assert.ok(slots.every((s) => s.readings.length === 21));
  assert.ok(slots.slice(1).every((s, i) => s.at - slots[i].at === MINUTE), 'un tramo por minuto, sin huecos');
  assert.equal(cycleLength(slots), 200 * MINUTE);
});

test('cycle 1 continues right after the last original minute: no gap and no overlap with the loaded data', () => {
  const slots = buildSlots(real);
  const lastOriginal = slots[slots.length - 1].at; // 11:20 UTC
  const first = batchFor(slots, 1, 0);
  assert.equal(first.at, lastOriginal + MINUTE);
  assert.equal(first.body.readings[0].recordedAt, '2026-09-13T11:21:00.000Z');
  assert.equal(batchFor(slots, 2, 0).at, lastOriginal + 201 * MINUTE);
});

test('batchFor keeps everything but the date, never sends an id, and the same instant repeats the same batch', () => {
  const slots = buildSlots(real);
  const b = batchFor(slots, 3, 17);
  assert.equal(b.body.readings.length, 21);
  assert.ok(b.body.readings.every((x) => Object.keys(x).sort().join() === 'deviceId,note,recordedAt,status,unit,value'));
  assert.deepEqual(batchFor(slots, 3, 17), b);
  const orig = slots[17].readings[0];
  const sent = b.body.readings.find((x) => x.deviceId === orig.deviceId);
  assert.equal(sent.value, orig.value); assert.equal(sent.status, orig.status); assert.equal(sent.unit, orig.unit);
  assert.equal(Date.parse(sent.recordedAt) - Date.parse(orig.recordedAt), 3 * 200 * MINUTE);
});

test('every (device, instant) over several cycles is unique: the simulator never sends the same reading for two different moments', () => {
  const slots = buildSlots(real); const seen = new Set();
  for (let c = 1; c <= 3; c++) for (let i = 0; i < slots.length; i++) for (const x of batchFor(slots, c, i).body.readings) { const k = `${x.deviceId}|${x.recordedAt}`; assert.ok(!seen.has(k), k); seen.add(k); }
  assert.equal(seen.size, 3 * 200 * 21);
});

test('nextCursor walks the slots and wraps to the next cycle', () => {
  const slots = [{ at: 1, readings: [] }, { at: 2, readings: [] }];
  assert.deepEqual(nextCursor(slots, { cycle: 1, index: 0 }), { cycle: 1, index: 1 });
  assert.deepEqual(nextCursor(slots, { cycle: 1, index: 1 }), { cycle: 2, index: 0 });
});

test('parseArgs: defaults, every option, and loud errors for bad values', () => {
  assert.deepEqual(parseArgs([]), { interval: 5000, cycles: 1, startCycle: 1, startIndex: 0, maxBatches: 0, url: 'http://localhost:8080', dryRun: false });
  assert.deepEqual(parseArgs(['--interval', '0', '--cycles', '0', '--start-cycle', '4', '--start-index', '9', '--max-batches', '7', '--url', 'http://x:1/', '--dry-run']), { interval: 0, cycles: 0, startCycle: 4, startIndex: 9, maxBatches: 7, url: 'http://x:1', dryRun: true });
  for (const bad of [['--interval', '-1'], ['--interval', 'abc'], ['--cycles', '1.5'], ['--start-cycle', '0'], ['--max-batches', '-2'], ['--interval'], ['--nope']]) assert.throws(() => parseArgs(bad), Error, bad.join(' '));
});
