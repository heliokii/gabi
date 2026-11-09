import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAYPOINTS, NOTES, anchorsFor, progressAt, poseAt, damp } from './path.js';
import { groundAt, solids, STAIR, houses, CANDLE_COUNT, PAROL_COUNT } from './layout.js';

const N = WAYPOINTS.length - 1;
const ASPECTS = { desktop: 1440 / 900, phone: 390 / 844 };

test('every page section has a waypoint, in the same order', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/data-shot="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, WAYPOINTS.map((w) => w.id));
});

test('anchors start at the top, centre each chapter and always increase', () => {
  const vh = 900;
  const sections = [0, 900, 2100, 3300, 4500, 5700].map((top) => ({ top, height: 1200 }));
  const a = anchorsFor(sections, vh, 7000);
  assert.equal(a[0], 0);
  assert.equal(a[1], 900 + 600 - 450);
  assert.equal(a.at(-1), 5700 + 600 - 450); // a footer below lets the last chapter reach the centre
  assert.equal(anchorsFor(sections, vh, 5000).at(-1), 5000); // without one, the bottom of the page
  for (let i = 1; i < a.length; i++) assert.ok(a[i] > a[i - 1], `anchor ${i}`);
  // sections stacked on top of each other still give increasing anchors
  const squashed = anchorsFor(sections.map(() => ({ top: 0, height: 10 })), vh, 6000);
  for (let i = 1; i < squashed.length; i++) assert.ok(squashed[i] > squashed[i - 1]);
});

test('progress runs 0 to N, never backwards, and lands on each chapter at its anchor', () => {
  const a = [0, 700, 1900, 3100, 4300, 5000];
  assert.equal(progressAt(-50, a), 0);
  assert.equal(progressAt(9999, a), N);
  a.forEach((y, i) => assert.equal(progressAt(y, a), i));
  let prev = -1;
  for (let y = 0; y <= 5000; y += 7) {
    const p = progressAt(y, a);
    assert.ok(p >= prev, `progress went back at y=${y}`);
    prev = p;
  }
});

test('each chapter shows exactly its waypoint on a wide screen', () => {
  WAYPOINTS.forEach((w, i) => {
    const pose = poseAt(i, ASPECTS.desktop);
    assert.deepEqual(pose.position.toArray().map((v) => +v.toFixed(6) + 0), w.p);
    assert.deepEqual(pose.target.toArray().map((v) => +v.toFixed(6) + 0), w.t);
    assert.equal(pose.fov, w.fov);
  });
});

test('the camera glides: no jumps between neighbouring scroll positions', () => {
  for (const aspect of Object.values(ASPECTS)) {
    let prev = poseAt(0, aspect).position.clone();
    for (let s = 1; s <= 4000; s++) {
      const pos = poseAt((s / 4000) * N, aspect).position;
      assert.ok(pos.distanceTo(prev) < 0.12, `jump at ${(s / 4000) * N}`);
      prev = pos.clone();
    }
  }
});

test('the camera never goes underground or through a building', () => {
  for (const [name, aspect] of Object.entries(ASPECTS)) {
    for (let s = 0; s <= 3000; s++) {
      const p = (s / 3000) * N;
      const { position: c } = poseAt(p, aspect);
      const floor = groundAt(c.x, c.z);
      assert.ok(c.y >= floor + 0.8, `${name}: ${c.y.toFixed(2)} m over ground ${floor.toFixed(2)} at progress ${p.toFixed(3)}`);
      for (const b of solids) {
        const m = 0.6;
        const inside = c.x > b.x0 - m && c.x < b.x1 + m && c.y > b.y0 - m && c.y < b.y1 + m && c.z > b.z0 - m && c.z < b.z1 + m;
        assert.ok(!inside, `${name}: camera inside a building at progress ${p.toFixed(3)}`);
      }
    }
  }
});

test('same scroll, same frame', () => {
  for (const p of [0, 0.37, 1.5, 2.999, 4.2, N]) {
    assert.deepEqual(poseAt(p).position.toArray(), poseAt(p).position.toArray());
  }
});

test('damp eases toward the target the same way at any frame rate', () => {
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) a = damp(a, 1, 5, 1 / 60);
  for (let i = 0; i < 144; i++) b = damp(b, 1, 5, 1 / 144);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test('the numbers on the page are counted from the town itself', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const count = (k) => Number(html.match(new RegExp(`data-count="${k}">(\\d+)<`))[1]);
  assert.equal(count('steps'), STAIR.steps);
  assert.equal(count('candles'), CANDLE_COUNT);
  assert.equal(count('houses'), houses.length);
  assert.equal(count('parols'), PAROL_COUNT);
});

test('every field note has a card, and its camera stands in open air', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const cards = [...html.matchAll(/data-note="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cards, NOTES.map((n) => n.id));
  for (const n of NOTES) {
    const [x, y, z] = n.p;
    assert.ok(y >= groundAt(x, z) + 0.8, `${n.id} underground`);
    for (const b of solids) assert.ok(!(x > b.x0 - 0.3 && x < b.x1 + 0.3 && y > b.y0 && y < b.y1 && z > b.z0 - 0.3 && z < b.z1 + 0.3), `${n.id} inside a building`);
  }
});
