/** 3점 원호 · densify 단위 테스트 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  densifyPath,
  nearlyCollinear,
  sampleArcThrough3,
} from "./path.ts";
import type { PathVertex, Pt } from "./types.ts";

test("일직선은 원호 대신 꺾은선", () => {
  const a: Pt = [0, 0];
  const b: Pt = [10, 0];
  const c: Pt = [20, 0];
  assert.equal(nearlyCollinear(a, b, c), true);
  const s = sampleArcThrough3(a, b, c, 8);
  assert.equal(s.length, 3);
});

test("세 점을 지나는 원호는 중간 근처를 지난다", () => {
  const a: Pt = [0, 0];
  const b: Pt = [5, 5];
  const c: Pt = [10, 0];
  const s = sampleArcThrough3(a, b, c, 24);
  assert.ok(s.length > 5);
  // 호의 중간 샘플이 b 근처에 있어야 함
  let minD = Infinity;
  for (const p of s) {
    minD = Math.min(minD, Math.hypot(p[0] - b[0], p[1] - b[1]));
  }
  assert.ok(minD < 0.8, `arc should pass near mid, minD=${minD}`);
  assert.deepEqual(s[0], a);
  assert.deepEqual(s[s.length - 1], c);
});

test("densifyPath: corner-curve-corner 원호", () => {
  const verts: PathVertex[] = [
    { p: [0, 0], role: "corner" },
    { p: [5, 4], role: "curve" },
    { p: [10, 0], role: "corner" },
  ];
  const d = densifyPath(verts, 12);
  assert.ok(d.length >= 10, "arc densified");
  assert.ok(Math.hypot(d[0][0] - 0, d[0][1] - 0) < 1e-6);
  assert.ok(Math.hypot(d[d.length - 1][0] - 10, d[d.length - 1][1] - 0) < 1e-6);
});

test("densifyPath: 직선만", () => {
  const verts: PathVertex[] = [
    { p: [0, 0], role: "corner" },
    { p: [5, 0], role: "corner" },
    { p: [5, 5], role: "corner" },
  ];
  const d = densifyPath(verts, 12);
  assert.equal(d.length, 3);
});
