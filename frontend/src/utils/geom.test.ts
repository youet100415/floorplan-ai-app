/** 작도 스냅 · 치수 기하 점검.
 *
 * 실행:  node --experimental-strip-types src/utils/geom.test.ts   (frontend 에서)
 */

import assert from "node:assert/strict";
import {
  SNAP_PX,
  constrainPoint,
  coreRectangle,
  edgeLength,
  geometryDirty,
  hitEdgeMidpoint,
  hitVertex,
  midpointsNear,
  outwardNormalOf,
  pointInPolygon,
  polygonArea,
  projectOntoPolyline,
  ringEdges,
  selfIntersects,
  signedArea,
  snapKind,
  tangentOnPolyline,
  toScreen,
  toWorld,
  type Ring,
  type View,
} from "./geom.ts";
import type { Pt } from "./types.ts";

const tests: [string, () => void][] = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// 10 px/m, 원점이 화면 (100, 500) 에 오는 뷰
const view: View = { scale: 10, tx: 100, ty: 500 };

const RECT: Pt[] = [[0, 0], [60, 0], [60, 22], [0, 22]]; // CCW
const RECT_CW: Pt[] = [[0, 0], [0, 22], [60, 22], [60, 0]];
const L_SHAPE: Pt[] = [[0, 0], [56, 0], [56, 20], [26, 20], [26, 46], [0, 46]];

test("좌표 변환은 왕복해도 같은 점", () => {
  const p: Pt = [12.5, 7.25];
  const [sx, sy] = toScreen(view, p);
  const back = toWorld(view, sx, sy);
  assert.ok(Math.abs(back[0] - p[0]) < 1e-9 && Math.abs(back[1] - p[1]) < 1e-9);
});

test("월드 y축은 위쪽이 +, 화면 y축은 아래쪽이 +", () => {
  const [, lowY] = toScreen(view, [0, 0]);
  const [, highY] = toScreen(view, [0, 10]);
  assert.ok(highY < lowY, "월드에서 위에 있는 점이 화면에서 더 위(작은 y)여야 한다");
});

test("면적/감김방향", () => {
  assert.equal(polygonArea(RECT), 60 * 22);
  assert.ok(signedArea(RECT) > 0, "RECT 는 CCW");
  assert.ok(signedArea(RECT_CW) < 0, "RECT_CW 는 CW");
  assert.equal(polygonArea(L_SHAPE), 56 * 20 + 26 * 26);
});

test("바깥법선은 감김방향과 무관하게 도형 밖을 향한다", () => {
  for (const ring of [RECT, RECT_CW, L_SHAPE]) {
    const outward = outwardNormalOf(ring);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const n = outward(a, b);
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // 법선 방향으로 살짝 나간 점은 밖, 반대로 들어간 점은 안이어야 한다
      const out: Pt = [mid[0] + n[0] * 0.5, mid[1] + n[1] * 0.5];
      const into: Pt = [mid[0] - n[0] * 0.5, mid[1] - n[1] * 0.5];
      assert.ok(!pointInPolygon(out, ring), `변 ${i}: 법선 방향이 안쪽을 향함`);
      assert.ok(pointInPolygon(into, ring), `변 ${i}: 반대 방향이 바깥을 향함`);
      assert.ok(Math.abs(Math.hypot(n[0], n[1]) - 1) < 1e-9, "단위벡터가 아님");
    }
  }
});

test("격자 스냅은 0.25m 단위", () => {
  assert.deepEqual(constrainPoint([3.13, 7.62], null, false), [3.25, 7.5]);
  assert.deepEqual(constrainPoint([-1.1, -0.4], null, false), [-1, -0.5]);
});

test("Shift 직각 구속은 변화량이 큰 축을 남긴다", () => {
  const last: Pt = [10, 10];
  assert.deepEqual(constrainPoint([25.1, 11.4], last, true), [25, 10], "가로 우세 → y 고정");
  assert.deepEqual(constrainPoint([11.4, 25.1], last, true), [10, 25], "세로 우세 → x 고정");
  assert.deepEqual(constrainPoint([25.1, 11.4], last, false), [25, 11.5], "ortho 꺼지면 그대로");
});

test("외곽선: 첫 점 근처에서만, 3점 이상일 때만 닫힌다", () => {
  const draft: Pt[] = [[0, 0], [60, 0], [60, 22]];
  assert.equal(snapKind(view, "boundary", draft, [0, 0]), "close");
  // SNAP_PX=12px, scale=10 → 1.2m 안쪽이면 스냅
  assert.equal(snapKind(view, "boundary", draft, [0.9, 0]), "close");
  assert.equal(snapKind(view, "boundary", draft, [1.5, 0]), null, "반경 밖은 스냅 안 됨");
  assert.equal(snapKind(view, "boundary", draft.slice(0, 2), [0, 0]), null, "2점은 닫을 수 없음");
  assert.equal(snapKind(view, "boundary", draft, [60, 22]), null, "마지막 점으로는 안 닫힘");
});

test("복도: 종료 스냅 없음 (확인/더블클릭으로 끝냄)", () => {
  const draft: Pt[] = [[0, 10], [60, 10]];
  assert.equal(snapKind(view, "corridor", draft, [60, 10]), null);
  assert.equal(snapKind(view, "corridor", draft, [0, 10]), null);
  assert.equal(snapKind(view, "corridor", draft.slice(0, 1), [0, 10]), null);
});

test("보기 모드나 커서 없음에서는 스냅하지 않는다", () => {
  const draft: Pt[] = [[0, 0], [60, 0], [60, 22]];
  assert.equal(snapKind(view, "view", draft, [0, 0]), null);
  assert.equal(snapKind(view, "boundary", draft, null), null);
  assert.equal(snapKind(null, "boundary", draft, [0, 0]), null);
});

test("확대해도 스냅 반경은 화면 px 기준으로 일정", () => {
  const draft: Pt[] = [[0, 0], [60, 0], [60, 22]];
  const zoomed: View = { ...view, scale: 100 }; // 100 px/m
  // 12px = 0.12m
  assert.equal(snapKind(zoomed, "boundary", draft, [0.1, 0]), "close");
  assert.equal(snapKind(zoomed, "boundary", draft, [0.9, 0]), null, "확대 시엔 더 가까워야 함");
  assert.ok(SNAP_PX > 0);
});

test("변 길이는 미터 실치수", () => {
  assert.equal(edgeLength([0, 0], [60, 0]), 60);
  assert.equal(edgeLength([0, 0], [3, 4]), 5);
});

// --- 입력 도형을 언제 직접 그려야 하는가 ---------------------------------

test("결과가 없으면 입력 도형을 그려야 한다", () => {
  assert.equal(geometryDirty(null, null, RECT, null), true, "외곽선 확정 직후 화면이 비면 안 됨");
  assert.equal(geometryDirty(null, null, RECT, [[[0, 10], [60, 10]]]), true);
});

test("결과가 입력과 같으면 중복해서 그리지 않는다", () => {
  // 백엔드는 소수 4자리로 반올림해 돌려준다
  const returned: Pt[] = [[0, 0], [60, 0], [60, 22], [0, 22]];
  assert.equal(geometryDirty(returned, [[[0, 11], [60, 11]]], RECT, null), false);
});

test("외곽선을 새로 그리면 결과와 어긋난 것으로 본다", () => {
  const drawn: Pt[] = [[0, 0], [40, 0], [40, 30], [0, 30]];
  assert.equal(geometryDirty(RECT, null, drawn, null), true);
  assert.equal(geometryDirty(RECT, null, RECT.slice(0, 3), null), true, "점 개수가 달라도 감지");
});

test("복도를 새로 그리면 결과와 어긋난 것으로 본다", () => {
  const planLine: Pt[] = [[0, 11], [60, 11]];
  const drawn: Pt[] = [[0, 6], [60, 6]];
  assert.equal(geometryDirty(RECT, [planLine], RECT, [drawn]), true);
  assert.equal(geometryDirty(RECT, [planLine], RECT, [planLine]), false);
});

test("복도 자동 배치(입력 null)는 결과 중심선과 비교하지 않는다", () => {
  // 자동일 때 백엔드가 만든 중심선은 입력이 아니므로 '어긋남'이 아니다
  assert.equal(geometryDirty(RECT, [[[0, 11], [60, 11]]], RECT, null), false);
});

test("복도 여러 줄 중첩 시 개수·좌표가 다르면 어긋남", () => {
  const a: Pt[] = [[0, 11], [60, 11]];
  const b: Pt[] = [[0, 4], [30, 4]];
  assert.equal(geometryDirty(RECT, [a], RECT, [a, b]), true);
  assert.equal(geometryDirty(RECT, [a, b], RECT, [a, b]), false);
});

// --- 꼭짓점 편집 ---------------------------------------------------------

const boundaryRing: Ring = { kind: "boundary", pts: RECT, closed: true, linked: true };
const corridorRing: Ring = {
  kind: "corridor",
  pts: [[0, 11], [60, 11]],
  closed: false,
  linked: true,
};
const coreRing: Ring = {
  kind: "core",
  pts: [[15, 11], [45, 11]],
  closed: false,
  linked: false,
};
const rings = [boundaryRing, corridorRing];

test("닫힌 고리는 마지막 변이 시작점으로 돌아온다", () => {
  const be = ringEdges(boundaryRing);
  assert.equal(be.length, 4, "사각형은 변 4개");
  assert.deepEqual(be[3][1], RECT[0], "마지막 변의 끝점 = 첫 점");
  const ce = ringEdges(corridorRing);
  assert.equal(ce.length, 1, "2점 폴리라인은 변 1개 (닫지 않음)");
});

test("꼭짓점 명중 판정은 반경 안에서만", () => {
  assert.deepEqual(hitVertex(view, rings, [60, 22]), { kind: "boundary", index: 2 });
  // HANDLE_PX=9px, scale=10 → 0.9m
  assert.deepEqual(hitVertex(view, rings, [60.5, 22]), { kind: "boundary", index: 2 });
  assert.equal(hitVertex(view, rings, [58, 20]), null, "반경 밖은 잡히지 않음");
  assert.deepEqual(hitVertex(view, rings, [0, 11]), { kind: "corridor", index: 0 });
});

test("가장 가까운 꼭짓점을 고른다", () => {
  // (0,11) 은 외곽선 (0,0)/(0,22) 보다 복도 시작점에 훨씬 가깝다
  assert.deepEqual(hitVertex(view, rings, [0.2, 11.1]), { kind: "corridor", index: 0 });
});

test("변 중점에서 점 추가 지점을 찾는다", () => {
  const hit = hitEdgeMidpoint(view, rings, [30, 0]);
  assert.ok(hit, "아래 변 중점이 잡혀야 함");
  assert.equal(hit!.kind, "boundary");
  assert.equal(hit!.afterIndex, 0, "0번 점 뒤에 삽입");
  assert.deepEqual(hit!.at, [30, 0]);
  assert.equal(hitEdgeMidpoint(view, rings, [15, 0]), null, "중점이 아닌 곳은 잡히지 않음");
});

test("중점 삽입은 변을 둘로 나눈다", () => {
  const hit = hitEdgeMidpoint(view, rings, [30, 0])!;
  const next = [...RECT];
  next.splice(hit.afterIndex + 1, 0, hit.at);
  assert.equal(next.length, 5);
  assert.deepEqual(next[1], [30, 0]);
  assert.equal(polygonArea(next), polygonArea(RECT), "변 위의 점 추가는 면적을 바꾸지 않는다");
});

test("＋ 표식은 잡히기 전에 먼저 보인다", () => {
  // scale=10 → 잡기 10px=1m, 노출 38px=3.8m
  const mid: Pt = [30, 0]; // 아래 변의 중점
  const approaching: Pt = [30, 2.5]; // 2.5m 떨어짐 — 보이되 아직 안 잡힘
  assert.equal(hitEdgeMidpoint(view, rings, approaching), null, "먼 거리에서는 눌리면 안 됨");
  const shown = midpointsNear(view, rings, approaching);
  assert.ok(
    shown.some((m) => m.kind === "boundary" && m.at[0] === mid[0] && m.at[1] === mid[1]),
    "다가가면 표식이 먼저 나타나야 함",
  );
  assert.ok(hitEdgeMidpoint(view, rings, [30, 0.5]), "가까이 가면 눌린다");
});

test("멀리 있으면 어떤 표식도 뜨지 않는다", () => {
  assert.deepEqual(midpointsNear(view, rings, [30, 30]), [], "도형에서 먼 곳");
});

test("꼭짓점이 변 중점보다 우선한다", () => {
  // 핸들과 ＋ 가 동시에 잡히면 이동이 우선 — 실수로 점이 늘어나면 안 된다
  const nearCorner: Pt = [0.3, 0.3];
  assert.ok(hitVertex(view, rings, nearCorner), "모서리 핸들이 잡혀야 함");
});

// --- 코어 배치 -----------------------------------------------------------

test("코어끼리는 변으로 이어지지 않는다", () => {
  assert.deepEqual(ringEdges(coreRing), [], "코어 사이에 ＋ 표식이 생기면 안 됨");
  assert.equal(hitEdgeMidpoint(view, [coreRing], [30, 11]), null, "코어 중간은 삽입 지점이 아님");
});

test("코어 핸들은 잡힌다", () => {
  assert.deepEqual(hitVertex(view, [coreRing], [15, 11]), { kind: "core", index: 0 });
  assert.deepEqual(hitVertex(view, [coreRing], [45.5, 11]), { kind: "core", index: 1 });
  assert.equal(hitVertex(view, [coreRing], [30, 11]), null, "둘 사이 빈 곳");
});

test("코어는 복도 중심선 위로 붙는다", () => {
  const rail: Pt[] = [[0, 11], [60, 11]];
  assert.deepEqual(projectOntoPolyline(rail, [30, 3]), [30, 11], "복도에서 떨어져 찍어도 올라탐");
  assert.deepEqual(projectOntoPolyline(rail, [30, 11]), [30, 11], "이미 위면 그대로");
});

test("중심선 밖으로 나간 점은 끝단으로 clamp 된다", () => {
  const rail: Pt[] = [[0, 11], [60, 11]];
  assert.deepEqual(projectOntoPolyline(rail, [200, 11]), [60, 11], "오른쪽 끝");
  assert.deepEqual(projectOntoPolyline(rail, [-50, 4]), [0, 11], "왼쪽 끝");
});

test("꺾인 복도에서는 가장 가까운 구간에 붙는다", () => {
  const bent: Pt[] = [[0, 0], [40, 0], [40, 40]];
  assert.deepEqual(projectOntoPolyline(bent, [20, 9]), [20, 0], "수평 구간");
  assert.deepEqual(projectOntoPolyline(bent, [49, 25]), [40, 25], "수직 구간");
  assert.deepEqual(projectOntoPolyline(bent, [45, -5]), [40, 0], "코너 근처");
});

test("중심선이 없으면 정사영하지 않는다", () => {
  assert.deepEqual(projectOntoPolyline([], [30, 3]), [30, 3], "원래 좌표 유지");
  assert.deepEqual(projectOntoPolyline([[5, 5]], [30, 3]), [5, 5], "점 하나뿐이면 그 점");
});

// --- 코어 크기 사각형 -----------------------------------------------------

test("코어 사각형은 복도 방향에 맞춰 선다", () => {
  const rail: Pt[] = [[0, 11], [60, 11]]; // 수평 복도
  const t = tangentOnPolyline(rail, [30, 11]);
  assert.deepEqual(t, [1, 0], "수평 복도의 접선은 +x");
  const rect = coreRectangle([30, 11], 6, 5, t);
  assert.equal(rect.length, 4);
  const xs = rect.map((p) => p[0]);
  const ys = rect.map((p) => p[1]);
  assert.equal(Math.min(...xs), 27, "길이 6 → x 27~33");
  assert.equal(Math.max(...xs), 33);
  assert.equal(Math.min(...ys), 6, "깊이 5 → 양옆 5씩");
  assert.equal(Math.max(...ys), 16);
  assert.equal(polygonArea(rect), 6 * 10, "면적 = 길이 × (깊이×2)");
});

test("세로 복도에서는 사각형도 90도 돌아간다", () => {
  const rail: Pt[] = [[20, 0], [20, 40]];
  const t = tangentOnPolyline(rail, [20, 20]);
  assert.deepEqual(t, [0, 1]);
  const rect = coreRectangle([20, 20], 6, 5, t);
  const xs = rect.map((p) => p[0]);
  const ys = rect.map((p) => p[1]);
  assert.equal(Math.max(...xs) - Math.min(...xs), 10, "깊이 방향이 x축");
  assert.equal(Math.max(...ys) - Math.min(...ys), 6, "길이 방향이 y축");
});

test("꺾인 복도에서는 가까운 구간의 방향을 쓴다", () => {
  const bent: Pt[] = [[0, 0], [40, 0], [40, 40]];
  assert.deepEqual(tangentOnPolyline(bent, [20, 2]), [1, 0], "수평 구간");
  assert.deepEqual(tangentOnPolyline(bent, [42, 25]), [0, 1], "수직 구간");
});

test("코어 크기를 키우면 면적도 비례해 커진다", () => {
  const t: Pt = [1, 0];
  const small = polygonArea(coreRectangle([30, 11], 6, 5, t));
  const longer = polygonArea(coreRectangle([30, 11], 12, 5, t));
  const deeper = polygonArea(coreRectangle([30, 11], 6, 10, t));
  assert.equal(longer, small * 2);
  assert.equal(deeper, small * 2);
});

test("자기교차 판정", () => {
  assert.equal(selfIntersects(RECT, true), false, "정상 사각형");
  assert.equal(selfIntersects(L_SHAPE, true), false, "오목한 L자도 정상");
  // (60,22) 를 반대편으로 끌어 나비넥타이를 만든 경우
  const bowtie: Pt[] = [[0, 0], [60, 0], [0, 22], [60, 22]];
  assert.equal(selfIntersects(bowtie, true), true, "나비넥타이를 잡아내야 함");
  assert.equal(selfIntersects([[0, 0], [10, 0], [10, 10]], true), false, "삼각형은 항상 정상");
  const crossingLine: Pt[] = [[0, 0], [10, 0], [5, 5], [5, -5]];
  assert.equal(selfIntersects(crossingLine, false), true, "열린 폴리라인의 교차도 감지");
});

test("꼭짓점을 옮겨도 나머지 점은 그대로", () => {
  const moved = RECT.map((p, i) => (i === 2 ? ([70, 30] as Pt) : p));
  assert.deepEqual(moved[0], RECT[0]);
  assert.deepEqual(moved[2], [70, 30]);
  assert.equal(selfIntersects(moved, true), false);
  assert.ok(polygonArea(moved) > polygonArea(RECT), "밖으로 끌면 면적이 늘어난다");
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  OK   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
