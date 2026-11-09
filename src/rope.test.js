import test from 'node:test';
import assert from 'node:assert/strict';
import { rope, hang, step } from './rope.js';

const settle = (r, seconds, wind) => { for (let i = 0; i < seconds * 60; i++) step(r, 1 / 60, wind); };
const at = (r, i) => r.pos.slice(i * 3, i * 3 + 3);
const meanZ = (r) => { let s = 0; for (let i = 1; i < 12; i++) s += r.pos[i * 3 + 2]; return s / 11; };

function strung() {
  const r = rope([0, 10, 0], [6, 10, 0], 12, 0.5);
  for (const i of [3, 6, 9]) hang(r, i, 0.5, 3);
  return r;
}

test('a rope keeps its ends pinned and its links near their length', () => {
  const r = strung();
  settle(r, 5);
  assert.deepEqual(at(r, 0), [0, 10, 0]);
  assert.deepEqual(at(r, 12), [6, 10, 0]);
  for (const [i, j, len] of r.links) {
    const d = Math.hypot(...[0, 1, 2].map((c) => r.pos[j * 3 + c] - r.pos[i * 3 + c]));
    assert.ok(Math.abs(d - len) / len < 0.03, `link ${i}-${j}: ${d.toFixed(3)} vs ${len.toFixed(3)}`);
  }
});

test('it hangs with about the sag it was made with, weights below their points', () => {
  const r = strung();
  settle(r, 5);
  const sag = 10 - r.pos[6 * 3 + 1];
  assert.ok(sag > 0.4 && sag < 0.75, `sag ${sag.toFixed(3)}`);
  assert.ok(r.pos[13 * 3 + 1] < r.pos[3 * 3 + 1], 'first weight hangs below its point');
});

test('a steady wind pushes it downwind, and it comes back when the wind drops', () => {
  const r = strung();
  settle(r, 3);
  settle(r, 3, [0, 0, 4]);
  assert.ok(meanZ(r) > 0.1, `downwind by ${meanZ(r).toFixed(3)}`);
  settle(r, 8);
  assert.ok(Math.abs(meanZ(r)) < 0.02, `back to ${meanZ(r).toFixed(3)}`);
});
