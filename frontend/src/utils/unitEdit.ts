/** 생성 후 세대 편집(삭제 · 합침 · 벽 이동)을 위한 순수 기하 함수.
 *
 * 세대 폴리곤은 백엔드 슬라이싱 결과라 인접한 두 세대는 반드시 변 하나를
 * 정확히 공유한다(감김 방향은 반대일 수 있다). "벽 이동"은 이 공유 변을
 * 그 변에 수직인 방향으로 미끄러뜨리는 것과 같다 — 백엔드의 슬라이싱 절단선
 * 개념과 정확히 대응된다. 두 폴리곤이 공유하던 두 점을 함께 옮기기만 하면
 * 항상 서로 맞물린 채로 남으므로, 이동 자체는 클라이언트에서 갭/겹침 없이
 * 계산할 수 있다. 결과를 반영하는 지표·법규 재계산은 서버(/api/revise)의
 * 몫이다.
 */

// geom.test.ts 와 마찬가지로 node --experimental-strip-types 로 직접 실행되므로
// .ts 확장자가 필요하다 (tsconfig의 allowImportingTsExtensions 참고).
import { closestOnSegment, toScreen, type View } from "./geom.ts";
import type { Pt } from "./types.ts";

function ptEq(a: Pt, b: Pt, tol = 0.01): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
}

export interface UnitLike {
  id: string;
  polygon: Pt[];
}

export interface SharedWall {
  a: string;
  b: string;
  /** 공유 변의 두 점이 각 폴리곤의 정점 배열에서 있는 인덱스. */
  aP1: number;
  aP2: number;
  bP1: number;
  bP2: number;
  p1: Pt;
  p2: Pt;
}

/** 세대 목록에서 서로 변을 공유하는 모든 이웃 쌍(=벽)을 찾는다. */
export function findSharedWalls(units: UnitLike[]): SharedWall[] {
  const walls: SharedWall[] = [];
  for (let ui = 0; ui < units.length; ui++) {
    const A = units[ui];
    const na = A.polygon.length;
    for (let uj = ui + 1; uj < units.length; uj++) {
      const B = units[uj];
      const nb = B.polygon.length;
      for (let i = 0; i < na; i++) {
        const p1 = A.polygon[i];
        const p2 = A.polygon[(i + 1) % na];
        for (let j = 0; j < nb; j++) {
          const q1 = B.polygon[j];
          const q2 = B.polygon[(j + 1) % nb];
          // 인접한 두 세대는 보통 반대 방향으로 감기므로 A의 p1→p2 는
          // B에서 q2→q1 로 나타난다. 혹시 같은 방향이면 그것도 받아준다.
          if (ptEq(p1, q2) && ptEq(p2, q1)) {
            walls.push({
              a: A.id, b: B.id,
              aP1: i, aP2: (i + 1) % na,
              bP1: (j + 1) % nb, bP2: j,
              p1, p2,
            });
          } else if (ptEq(p1, q1) && ptEq(p2, q2)) {
            walls.push({
              a: A.id, b: B.id,
              aP1: i, aP2: (i + 1) % na,
              bP1: j, bP2: (j + 1) % nb,
              p1, p2,
            });
          }
        }
      }
    }
  }
  return walls;
}

/** 벽 선분에 수직인 단위벡터. 이 방향으로 옮기는 것이 "벽 이동"이다. */
export function wallNormal(w: SharedWall): Pt {
  const dx = w.p2[0] - w.p1[0];
  const dy = w.p2[1] - w.p1[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

function extentAlong(polygon: Pt[], n: Pt): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of polygon) {
    const t = x * n[0] + y * n[1];
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return [min, max];
}

/**
 * shift(법선 방향 이동 거리)를 두 세대가 최소 안깊이 이하로 얇아지지 않는
 * 범위로 제한한다. 서버가 최종 검증(겹침·유효성)을 하지만, 드래그 중
 * 미리보기가 명백히 깨지는 모양이 되지 않도록 클라이언트에서도 막아둔다.
 */
export function clampWallShift(
  units: UnitLike[],
  wall: SharedWall,
  rawShift: number,
  margin = 0.6,
): number {
  const ua = units.find((u) => u.id === wall.a);
  const ub = units.find((u) => u.id === wall.b);
  if (!ua || !ub) return 0;
  const n = wallNormal(wall);
  const t0 = wall.p1[0] * n[0] + wall.p1[1] * n[1];
  const [minA, maxA] = extentAlong(ua.polygon, n);
  const [minB, maxB] = extentAlong(ub.polygon, n);

  // 두 세대는 벽을 사이에 두고 반대편에 있다 — A의 본체가 +n 쪽으로 뻗어
  // 있는지로 어느 쪽이 어느 방향 상한/하한을 만드는지 판별한다.
  const aOnPlusSide = Math.abs(maxA - t0) > Math.abs(t0 - minA);
  const upper = (aOnPlusSide ? maxA : maxB) - t0 - margin;
  const lower = (aOnPlusSide ? minB : minA) - t0 + margin;
  if (upper < lower) return 0; // 여유가 없으면 이동 불가
  return Math.max(lower, Math.min(upper, rawShift));
}

/** shift 만큼 벽을 옮긴 두 세대의 새 폴리곤. 공유 변의 두 점만 움직이므로
 * 이동 후에도 두 폴리곤은 항상 정확히 맞물려 있다(갭·겹침 없음). */
export function moveWall(
  units: UnitLike[],
  wall: SharedWall,
  shift: number,
): { a: Pt[]; b: Pt[] } | null {
  const ua = units.find((u) => u.id === wall.a);
  const ub = units.find((u) => u.id === wall.b);
  if (!ua || !ub) return null;
  const n = wallNormal(wall);
  const np1: Pt = [wall.p1[0] + n[0] * shift, wall.p1[1] + n[1] * shift];
  const np2: Pt = [wall.p2[0] + n[0] * shift, wall.p2[1] + n[1] * shift];

  const a = ua.polygon.map((p, i) => (i === wall.aP1 ? np1 : i === wall.aP2 ? np2 : p));
  const b = ub.polygon.map((p, i) => (i === wall.bP1 ? np1 : i === wall.bP2 ? np2 : p));
  return { a, b };
}

/** 커서에 가장 가까운 공유 벽. 화면 픽셀 반경 밖이면 null. */
export function hitWall(
  view: View | null,
  walls: SharedWall[],
  cursor: Pt | null,
  radiusPx = 8,
): SharedWall | null {
  if (!view || !cursor) return null;
  const c = toScreen(view, cursor);
  let best: SharedWall | null = null;
  let bestD = radiusPx;
  for (const w of walls) {
    const a = toScreen(view, w.p1);
    const b = toScreen(view, w.p2);
    const q = closestOnSegment(a, b, c);
    const d = Math.hypot(c[0] - q[0], c[1] - q[1]);
    if (d <= bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}
