import test from 'node:test';
import assert from 'node:assert/strict';
import { MIX } from './sound.js';
import { CHAPTER_COUNT } from './path.js';

test('the sound has one mix per chapter, every level between 0 and 1', () => {
  assert.equal(MIX.length, CHAPTER_COUNT);
  for (const row of MIX) {
    assert.equal(row.length, 3);
    for (const v of row) assert.ok(v >= 0 && v <= 1, `level ${v}`);
  }
});
