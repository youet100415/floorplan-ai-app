/** 작도 경로: 직선 + 3점 원호(중간 곡선점).
 *
 * PathVertex.role === "curve" 인 점은 양옆 모서리와 함께 원호를 만든다.
 * 백엔드/충돌 판정에는 densifyPath 로 촘촘한 Pt[] 를 넘긴다.
 */

import type { PathVertex, Pt, VertexRole } from "./types";

/** 직선 점열 → 전부 모서리 정점. */
export function asCorners(pts: Pt[]): PathVertex[] {
  return pts.map((p) => ({ p: [p[0], p[1]] as Pt, role: "corner" as const }));
}

export function pathPoints(verts: PathVertex[]): Pt[] {
  return verts.map((v) => v.p);
}

/** 세 점이 거의 일직선이면 원호 대신 꺾은선. */
export function nearlyCollinear(a: Pt, b: Pt, c: Pt, eps = 1e-4): boolean {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const bcx = c[0] - b[0];
  const bcy = c[1] - b[1];
  const cross = abx * bcy - aby * bcx;
  const lab = Math.hypot(abx, aby);
  const lbc = Math.hypot(bcx, bcy);
  if (lab < 1e-9 || lbc < 1e-9) return true;
  return Math.abs(cross) / (lab * lbc) < eps;
}

/**
 * 세 점을 지나는 원(외접원). 일직선이면 null.
 * 반환: 중심, 반지름, 각 점의 각도(atan2).
 */
export function circleThrough3(
  a: Pt,
  b: Pt,
  c: Pt,
): { cx: number; cy: number; r: number; aa: number; ab: number; ac: number } | null {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const [x3, y3] = c;
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-10) return null;

  const u =
    ((x1 * x1 + y1 * y1) * (y2 - y3) +
      (x2 * x2 + y2 * y2) * (y3 - y1) +
      (x3 * x3 + y3 * y3) * (y1 - y2)) /
    d;
  const v =
    ((x1 * x1 + y1 * y1) * (x3 - x2) +
      (x2 * x2 + y2 * y2) * (x1 - x3) +
      (x3 * x3 + y3 * y3) * (x2 - x1)) /
    d;
  const r = Math.hypot(x1 - u, y1 - v);
  if (!Number.isFinite(r) || r < 1e-9 || r > 1e6) return null;

  return {
    cx: u,
    cy: v,
    r,
    aa: Math.atan2(y1 - v, x1 - u),
    ab: Math.atan2(y2 - v, x2 - u),
    ac: Math.atan2(y3 - v, x3 - u),
  };
}

/**
 * 세 점 A-B-C 를 지나는 원호를 n 등분 샘플 (A 포함, C 포함, B 경유).
 * 일직선이면 [A,B,C] 그대로.
 */
export function sampleArcThrough3(a: Pt, b: Pt, c: Pt, segments = 20): Pt[] {
  if (nearlyCollinear(a, b, c)) return [a, b, c];
  const cir = circleThrough3(a, b, c);
  if (!cir) return [a, b, c];

  const { cx, cy, r, aa, ab, ac } = cir;
  // a→c 두 방향 중 b 를 포함하는 쪽
  const norm2 = (t: number) => {
    let x = t;
    while (x < 0) x += Math.PI * 2;
    while (x >= Math.PI * 2) x -= Math.PI * 2;
    return x;
  };
  const a0 = norm2(aa);
  const b0 = norm2(ab);
  const c0 = norm2(ac);

  const dist = (from: number, to: number, ccw: boolean) => {
    if (ccw) {
      let d = to - from;
      if (d < 0) d += Math.PI * 2;
      return d;
    }
    let d = from - to;
    if (d < 0) d += Math.PI * 2;
    return d;
  };
  const onArc = (from: number, to: number, mid: number, ccw: boolean) => {
    const total = dist(from, to, ccw);
    const toMid = dist(from, mid, ccw);
    return toMid <= total + 1e-6;
  };

  const ccwOk = onArc(a0, c0, b0, true);
  const cwOk = onArc(a0, c0, b0, false);
  const useCcw = ccwOk || !cwOk;
  const total = dist(a0, c0, useCcw);
  const n = Math.max(4, segments);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = useCcw ? a0 + total * t : a0 - total * t;
    out.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
  }
  // 끝점을 정확히 A,C 에 스냅
  out[0] = [a[0], a[1]];
  out[out.length - 1] = [c[0], c[1]];
  return out;
}

/**
 * PathVertex[] → 렌더/API 용 촘촘한 점열.
 * 패턴: corner → curve → corner 이면 원호, 그 외는 직선.
 */
export function densifyPath(verts: PathVertex[], segmentsPerArc = 20): Pt[] {
  if (verts.length === 0) return [];
  if (verts.length === 1) return [[verts[0].p[0], verts[0].p[1]]];

  const out: Pt[] = [];
  const push = (p: Pt, force = false) => {
    if (!force && out.length > 0) {
      const last = out[out.length - 1];
      if (Math.hypot(last[0] - p[0], last[1] - p[1]) < 1e-9) return;
    }
    out.push([p[0], p[1]]);
  };

  let i = 0;
  while (i < verts.length) {
    const cur = verts[i];
    // 다음이 curve 이고 그 다음이 있으면 원호
    if (
      i + 2 < verts.length &&
      verts[i + 1].role === "curve" &&
      cur.role !== "curve"
    ) {
      const a = cur.p;
      const b = verts[i + 1].p;
      const c = verts[i + 2].p;
      const samples = sampleArcThrough3(a, b, c, segmentsPerArc);
      for (let s = 0; s < samples.length; s++) {
        push(samples[s], s === 0 && out.length === 0);
      }
      // 끝점 C 는 다음 구간의 시작 — i 를 C 로
      i += 2;
      continue;
    }
    // curve 가 단독/끝이면 모서리처럼 취급
    push(cur.p, out.length === 0);
    i += 1;
  }
  return out;
}

/** 닫힌 외곽선 densify (마지막→첫 구간도 원호 가능). */
export function densifyClosedPath(verts: PathVertex[], segmentsPerArc = 20): Pt[] {
  if (verts.length < 3) return densifyPath(verts, segmentsPerArc);
  // 끝점이 curve 로 첫 점과 이어지는 경우는 드묾 — 열린 densify 후 폐합은 폴리곤 close 로
  const open = densifyPath(verts, segmentsPerArc);
  return open;
}

export function toggleVertexRole(role: VertexRole): VertexRole {
  return role === "curve" ? "corner" : "curve";
}

/** 정점 이동 시 role 유지. */
export function movePathVertex(verts: PathVertex[], index: number, to: Pt): PathVertex[] {
  return verts.map((v, i) => (i === index ? { ...v, p: [to[0], to[1]] as Pt } : v));
}

export function insertPathVertex(
  verts: PathVertex[],
  afterIndex: number,
  at: Pt,
  role: VertexRole = "corner",
): PathVertex[] {
  const next = [...verts];
  next.splice(afterIndex + 1, 0, { p: [at[0], at[1]], role });
  return next;
}
