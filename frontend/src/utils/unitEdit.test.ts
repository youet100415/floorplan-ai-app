/** 세대 편집(벽 이동) 순수 기하 함수 단위 테스트 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampWallShift,
  findSharedWalls,
  moveWall,
  wallNormal,
  type UnitLike,
} from "./unitEdit.ts";
import type { Pt } from "./types.ts";

// 10x10 정사각형을 x=4 에서 세로로 나눈 두 세대 — 왼쪽 4x10, 오른쪽 6x10.
// 오른쪽은 반시계 순서가 왼쪽과 반대로 감기도록(백엔드 슬라이싱과 동일하게
// 인접 폴리곤은 공유 변에서 반대 방향으로 순회) 좌표를 잡는다.
function twoUnits(): UnitLike[] {
  const left: Pt[] = [
    [0, 0],
    [4, 0],
    [4, 10],
    [0, 10],
  ];
  const right: Pt[] = [
    [4, 0],
    [10, 0],
    [10, 10],
    [4, 10],
  ];
  return [
    { id: "u0", polygon: left },
    { id: "u1", polygon: right },
  ];
}

test("findSharedWalls: 인접한 두 세대의 공유 변을 찾는다", () => {
  const walls = findSharedWalls(twoUnits());
  assert.equal(walls.length, 1);
  const w = walls[0];
  assert.equal(w.a, "u0");
  assert.equal(w.b, "u1");
  // 공유 변은 x=4 선분(0,4)-(4,10)이어야 한다 (순서는 무관).
  const xs = [w.p1[0], w.p2[0]];
  const ys = [w.p1[1], w.p2[1]].sort((a, b) => a - b);
  assert.ok(xs.every((x) => Math.abs(x - 4) < 1e-9));
  assert.deepEqual(ys, [0, 10]);
});

test("findSharedWalls: 떨어진 두 세대는 벽이 없다", () => {
  const units: UnitLike[] = [
    { id: "u0", polygon: [[0, 0], [4, 0], [4, 10], [0, 10]] },
    { id: "u1", polygon: [[20, 0], [26, 0], [26, 10], [20, 10]] },
  ];
  assert.equal(findSharedWalls(units).length, 0);
});

test("wallNormal: 세로 벽의 법선은 수평(가로) 방향", () => {
  const walls = findSharedWalls(twoUnits());
  const n = wallNormal(walls[0]);
  assert.ok(Math.abs(n[1]) < 1e-9, "y 성분은 0이어야 함");
  assert.ok(Math.abs(Math.abs(n[0]) - 1) < 1e-9, "x 성분은 단위길이");
});

test("moveWall: 벽을 오른쪽(u1 쪽)으로 옮기면 두 폴리곤이 여전히 맞물린다", () => {
  const units = twoUnits();
  const wall = findSharedWalls(units)[0];
  const n = wallNormal(wall);
  // n 이 +x 를 가리키지 않으면 부호를 뒤집어 항상 u1 쪽(오른쪽, +x)으로 미는 shift를 만든다.
  const shift = n[0] > 0 ? 2 : -2;
  const moved = moveWall(units, wall, shift);
  assert.ok(moved);
  const areaOf = (poly: Pt[]) => {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s / 2);
  };
  const areaA = areaOf(moved!.a);
  const areaB = areaOf(moved!.b);
  // 원래 4x10=40 / 6x10=60. 벽이 2m 이동했으니 6x10=60 / 4x10=40 이 되어야 한다(±eps).
  assert.ok(Math.abs(areaA - 60) < 1e-6, `areaA=${areaA}`);
  assert.ok(Math.abs(areaB - 40) < 1e-6, `areaB=${areaB}`);
  assert.ok(Math.abs(areaA + areaB - 100) < 1e-6, "총 면적은 보존되어야 함");
});

test("clampWallShift: 최소 안깊이 이하로는 밀 수 없다 (양쪽 방향 모두)", () => {
  const units = twoUnits();
  const wall = findSharedWalls(units)[0];
  const margin = 0.6;
  const depthOf = (poly: Pt[]) =>
    Math.max(...poly.map((p) => p[0])) - Math.min(...poly.map((p) => p[0]));

  // 방향에 대한 가정 없이 양쪽 모두 극단적인 이동을 시도해, 어느 쪽이든
  // 결과 폭이 margin 이상으로 clamp 되는지만 확인한다.
  for (const raw of [1000, -1000]) {
    const clamped = clampWallShift(units, wall, raw, margin);
    assert.notEqual(clamped, raw, `raw=${raw} 는 반드시 clamp 되어야 함`);
    const moved = moveWall(units, wall, clamped)!;
    const depthA = depthOf(moved.a);
    const depthB = depthOf(moved.b);
    assert.ok(depthA >= margin - 1e-6, `raw=${raw}: depthA=${depthA} < margin`);
    assert.ok(depthB >= margin - 1e-6, `raw=${raw}: depthB=${depthB} < margin`);
    assert.ok(Math.abs(depthA + depthB - 10) < 1e-6, "총 폭(10m)은 보존되어야 함");
    // 둘 중 하나는 margin 근처까지 눌려야 실제로 상한에 닿은 것이다.
    assert.ok(
      Math.min(depthA, depthB) < margin + 0.05,
      `raw=${raw}: 어느 쪽도 상한에 닿지 않음 (depthA=${depthA}, depthB=${depthB})`,
    );
  }
});

test("clampWallShift: 여유가 있는 소폭 이동은 그대로 통과한다", () => {
  const units = twoUnits();
  const wall = findSharedWalls(units)[0];
  const n = wallNormal(wall);
  const shift = n[0] > 0 ? 1 : -1;
  const clamped = clampWallShift(units, wall, shift, 0.6);
  assert.ok(Math.abs(clamped - shift) < 1e-9, "여유 안에서는 clamp 되지 않아야 함");
});
