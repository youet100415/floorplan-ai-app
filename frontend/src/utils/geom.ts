/** 캔버스 좌표 변환 · 작도 스냅 · 치수 계산 (React 비의존 순수 함수).
 *
 * 월드는 미터(m), y축 위쪽이 +. 화면은 픽셀, y축 아래쪽이 +.
 */

import type { Pt } from "./types";

export interface View {
  scale: number;
  tx: number;
  ty: number;
}

/** 작도 종료 스냅이 걸리는 반경(화면 px). */
export const SNAP_PX = 12;
/** 작도 좌표 격자(m). */
export const GRID_M = 0.25;

export function toScreen(view: View, p: Pt): [number, number] {
  return [view.tx + p[0] * view.scale, view.ty - p[1] * view.scale];
}

export function toWorld(view: View, sx: number, sy: number): Pt {
  return [(sx - view.tx) / view.scale, (view.ty - sy) / view.scale];
}

/** 부호 있는 면적. 양수면 반시계(CCW) 방향이다. */
export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function polygonArea(pts: Pt[]): number {
  return Math.abs(signedArea(pts));
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 닫힌 폴리곤의 각 변에 대해 바깥쪽을 가리키는 월드 단위법선을 만든다.
 * 감김 방향(CW/CCW)에 무관하게 항상 도형 외부를 향한다.
 */
export function outwardNormalOf(pts: Pt[]) {
  const sign = signedArea(pts) > 0 ? 1 : -1;
  return (a: Pt, b: Pt): [number, number] => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [(dy / len) * sign, (-dx / len) * sign];
  };
}

/** 0.25m 격자 스냅. ortho 면 직전 점에서 수평/수직으로 구속한다. */
export function constrainPoint(w: Pt, last: Pt | null, ortho: boolean): Pt {
  const p: Pt = [Math.round(w[0] / GRID_M) * GRID_M, Math.round(w[1] / GRID_M) * GRID_M];
  if (!ortho || !last) return p;
  return Math.abs(p[0] - last[0]) >= Math.abs(p[1] - last[1])
    ? [p[0], last[1]]
    : [last[0], p[1]];
}

// ------------------------------------------------------- 꼭짓점 편집 지원

export type RingKind = "boundary" | "corridor" | "core";

export interface Ring {
  kind: RingKind;
  pts: Pt[];
  /** 외곽선은 닫힌 고리, 복도 중심선은 열린 폴리라인. */
  closed: boolean;
  /** 연속한 점이 변으로 이어지는가. 코어는 서로 독립된 점이라 false. */
  linked: boolean;
  /** 동일 kind 가 여러 개일 때 구분 (복도 경로 id). */
  id?: string;
}

export interface VertexRef {
  kind: RingKind;
  index: number;
  id?: string;
}

/** 편집 핸들을 잡는 반경(화면 px). */
export const HANDLE_PX = 10;
/** 변 중점의 '점 추가' 표식을 잡는 반경(화면 px). */
export const MIDPOINT_PX = 10;
/** '＋' 표식이 나타나기 시작하는 반경(화면 px). 잡는 반경보다 넉넉해야 발견된다. */
export const MIDPOINT_REVEAL_PX = 38;

/** 커서에 가장 가까운 꼭짓점. 반경 밖이면 null. */
export function hitVertex(
  view: View | null,
  rings: Ring[],
  cursor: Pt | null,
  radiusPx = HANDLE_PX,
): VertexRef | null {
  if (!view || !cursor) return null;
  const c = toScreen(view, cursor);
  let best: VertexRef | null = null;
  let bestD = radiusPx;
  for (const ring of rings) {
    ring.pts.forEach((p, i) => {
      const t = toScreen(view, p);
      const d = Math.hypot(c[0] - t[0], c[1] - t[1]);
      if (d <= bestD) {
        bestD = d;
        best = ring.id
          ? { kind: ring.kind, index: i, id: ring.id }
          : { kind: ring.kind, index: i };
      }
    });
  }
  return best;
}

/** 링의 변 목록. 닫힌 고리는 마지막 변이 끝점→시작점으로 이어진다. */
export function ringEdges(ring: Ring): [Pt, Pt, number][] {
  if (!ring.linked) return []; // 독립된 점 무리(코어)에는 변이 없다
  const out: [Pt, Pt, number][] = [];
  const n = ring.pts.length;
  const last = ring.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    out.push([ring.pts[i], ring.pts[(i + 1) % n], i]);
  }
  return out;
}

export interface MidpointHit {
  kind: RingKind;
  /** 이 인덱스 '뒤에' 새 점을 끼워 넣는다. */
  afterIndex: number;
  at: Pt;
  id?: string;
}

/** 커서에 가장 가까운 변 중점(= 점 추가 지점). 반경 밖이면 null. */
export function hitEdgeMidpoint(
  view: View | null,
  rings: Ring[],
  cursor: Pt | null,
  radiusPx = MIDPOINT_PX,
): MidpointHit | null {
  if (!view || !cursor) return null;
  const c = toScreen(view, cursor);
  let best: MidpointHit | null = null;
  let bestD = radiusPx;
  for (const ring of rings) {
    for (const [a, b, i] of ringEdges(ring)) {
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const t = toScreen(view, mid);
      const d = Math.hypot(c[0] - t[0], c[1] - t[1]);
      if (d <= bestD) {
        bestD = d;
        best = ring.id
          ? { kind: ring.kind, afterIndex: i, at: mid, id: ring.id }
          : { kind: ring.kind, afterIndex: i, at: mid };
      }
    }
  }
  return best;
}

/**
 * 커서 근처에 있어 화면에 띄울 변 중점들. 잡는 반경보다 넓게 잡아,
 * 외곽선에 다가가면 '＋'가 먼저 보이고 그 다음에 눌리도록 한다.
 */
export function midpointsNear(
  view: View | null,
  rings: Ring[],
  cursor: Pt | null,
  radiusPx = MIDPOINT_REVEAL_PX,
): MidpointHit[] {
  if (!view || !cursor) return [];
  const c = toScreen(view, cursor);
  const out: MidpointHit[] = [];
  for (const ring of rings) {
    for (const [a, b, i] of ringEdges(ring)) {
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const t = toScreen(view, mid);
      if (Math.hypot(c[0] - t[0], c[1] - t[1]) <= radiusPx) {
        out.push(
          ring.id
            ? { kind: ring.kind, afterIndex: i, at: mid, id: ring.id }
            : { kind: ring.kind, afterIndex: i, at: mid },
        );
      }
    }
  }
  return out;
}

function orient(a: Pt, b: Pt, c: Pt): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
}

/** 두 선분이 끝점을 공유하지 않고 실제로 교차하는가. */
function properlyIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * 폴리곤/폴리라인이 자기 자신과 교차하는가.
 *
 * 꼭짓점을 끌다가 변을 가로지르면 나비넥타이 모양이 되는데, 백엔드(shapely)는
 * 이를 조용히 보정해 의도와 다른 도형을 만든다. 그 전에 경고하기 위한 판정.
 */
export function selfIntersects(pts: Pt[], closed: boolean): boolean {
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  // 닫힌 고리는 변이 4개는 되어야 교차할 수 있다(삼각형은 불가).
  // 열린 폴리라인은 3개면 충분하다.
  if (segCount < (closed ? 4 : 3)) return false;

  for (let i = 0; i < segCount; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < segCount; j++) {
      // 끝점을 공유하는 이웃 변은 건너뛴다. 첫 변과 끝 변이 맞닿는 것은
      // 닫힌 고리일 때뿐 — 열린 폴리라인에서는 정상적인 검사 대상이다.
      if (j === i + 1) continue;
      if (closed && i === 0 && j === segCount - 1) continue;
      if (properlyIntersect(a1, a2, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

export type SnapKind = "close" | null;

/**
 * 작도 스냅 판정 (일반 폴리라인 방식).
 * - boundary / coreOutline: 첫 점 근처면 닫기(close). 최소 3점. CAD 폐합 관례.
 * - corridor/core: 종료 스냅 없음 — 우클릭 확인 / Enter / 더블클릭으로 끝낸다.
 */
export function snapKind(
  view: View | null,
  editMode: "view" | "boundary" | "corridor" | "core" | "coreOutline",
  draft: Pt[],
  cursor: Pt | null,
): SnapKind {
  const closes = editMode === "boundary" || editMode === "coreOutline";
  if (!cursor || !view || !closes || draft.length < 3) return null;
  const c = toScreen(view, cursor);
  const t = toScreen(view, draft[0]);
  if (Math.hypot(c[0] - t[0], c[1] - t[1]) <= SNAP_PX) return "close";
  return null;
}

/** 선분 위에서 p 에 가장 가까운 점 (양 끝으로 clamp). */
export function closestOnSegment(a: Pt, b: Pt, p: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return a;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + dx * t, a[1] + dy * t];
}

/**
 * 폴리라인 위에서 p 에 가장 가까운 점.
 *
 * 코어는 복도 중심선 위에만 놓일 수 있다(백엔드도 정사영해서 배치한다).
 * 클릭 좌표를 미리 여기에 붙여야 화면에 보이는 위치와 실제 배치가 일치한다.
 */
export function projectOntoPolyline(line: Pt[], p: Pt): Pt {
  if (line.length === 0) return p;
  if (line.length === 1) return line[0];
  let best = line[0];
  let bestD = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const q = closestOnSegment(line[i], line[i + 1], p);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** 여러 복도 중심선 중 가장 가까운 선 위로 정사영. */
export function projectOntoPolylines(lines: Pt[][], p: Pt): Pt {
  if (lines.length === 0) return p;
  let best = p;
  let bestD = Infinity;
  for (const line of lines) {
    if (line.length < 1) continue;
    const q = projectOntoPolyline(line, p);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/**
 * 폴리라인 위에서 p 에 가장 가까운 지점의 단위 접선벡터.
 * 코어 사각형을 복도 방향에 맞춰 세우는 데 쓴다.
 */
export function tangentOnPolyline(line: Pt[], p: Pt): Pt {
  if (line.length < 2) return [1, 0];
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const q = closestOnSegment(line[i], line[i + 1], p);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const a = line[bestI];
  const b = line[bestI + 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
}

/**
 * 앵커·길이·깊이로 코어 사각형 네 꼭짓점을 만든다.
 * length 는 복도 축 방향 전체 길이, reach 는 복도 양옆 한쪽 깊이.
 *
 * 주의: 백엔드는 코어 뒤에 세대가 못 되는 자투리가 남으면 그쪽 reach 를
 * 외피까지 늘린다. 따라서 이 사각형은 '요청한 크기'이고, 결과 도면의
 * 코어는 그보다 커질 수 있다.
 */
export function coreRectangle(anchor: Pt, length: number, reach: number, tangent: Pt): Pt[] {
  const u = tangent;
  const n: Pt = [-u[1], u[0]];
  const hl = length / 2;
  return [
    [anchor[0] - u[0] * hl - n[0] * reach, anchor[1] - u[1] * hl - n[1] * reach],
    [anchor[0] + u[0] * hl - n[0] * reach, anchor[1] + u[1] * hl - n[1] * reach],
    [anchor[0] + u[0] * hl + n[0] * reach, anchor[1] + u[1] * hl + n[1] * reach],
    [anchor[0] - u[0] * hl + n[0] * reach, anchor[1] - u[1] * hl + n[1] * reach],
  ];
}

/** 변의 실제 길이(m). 치수 문자열용. */
export function edgeLength(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * 두 점열이 사실상 같은지. 백엔드가 소수 4자리로 반올림해 돌려주므로
 * 정확 비교 대신 1cm 허용오차를 쓴다.
 */
export function samePts(a: Pt[], b: Pt[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => Math.abs(p[0] - b[i][0]) < 0.01 && Math.abs(p[1] - b[i][1]) < 0.01);
}

/**
 * 화면에 그려진 결과가 현재 입력 도형과 다른지 판정한다.
 * 다르면 입력 도형을 직접 그려야 한다 — 안 그리면 방금 확정한 외곽선이
 * 결과 생성 전까지 화면에서 사라진다.
 */
export function geometryDirty(
  planBoundary: Pt[] | null,
  planCenterlines: Pt[][] | null,
  inputBoundary: Pt[],
  inputCorridors: Pt[][] | null,
): boolean {
  if (!planBoundary) return true;
  if (!samePts(planBoundary, inputBoundary)) return true;
  if (inputCorridors && inputCorridors.length > 0) {
    if (!planCenterlines || planCenterlines.length !== inputCorridors.length) return true;
    for (let i = 0; i < inputCorridors.length; i++) {
      if (!samePts(planCenterlines[i], inputCorridors[i])) return true;
    }
  }
  return false;
}
