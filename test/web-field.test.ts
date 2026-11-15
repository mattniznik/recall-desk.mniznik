// The dot field ("one dot per owner complaint, a square per recall"): a lit mark has to fit
// inside its own grid cell. Until 2026-11-14 lit marks
// were 2.1 times a grid dot (a circle 1.26 grid steps wide, a square about one
// step), so lit marks overlapped their neighbours and clumped.

import { test } from "node:test";
import assert from "node:assert/strict";

import { markSizes } from "../web/src/shared/field.ts";

test("lit dots and recall squares fit inside one grid cell at every size", () => {
  for (const pitch of [5, 8, 12, 21, 30]) {
    const s = markSizes(pitch);
    // the plain grid dot is unchanged (0.3 of a step, at least 1.6 px): 0.64 at the 5 px floor
    assert.ok(2 * s.dot <= pitch * 0.7, `grid dot ${2 * s.dot} at pitch ${pitch}`);
    assert.ok(2 * s.lit <= pitch * 0.85, `lit dot ${2 * s.lit} at pitch ${pitch}`);
    assert.ok(2 * s.pulse <= pitch * 0.9, `pulse ${2 * s.pulse} at pitch ${pitch}`);
    assert.ok(s.square <= pitch * 0.85, `square ${s.square} at pitch ${pitch}`);
  }
});

test("a lit mark is still larger than a grid dot, so it reads as picked out", () => {
  const s = markSizes(21);
  assert.ok(s.lit > s.dot * 1.2);
  assert.ok(s.square > 2 * s.dot);
});
