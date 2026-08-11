/**
 * 2D 평면 → 3D 압출용 순수 기하 헬퍼.
 * Three.js 의존 없음 — 나중에 three/babylon에 mesh 생성 시 이 폴리곤을 그대로 사용.
 */
import type { Point } from "./types";

/** 신발끈 공식 — 부호 있는 면적 (CCW 양수) */
export function signedArea(poly: Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export function polygonArea(poly: Point[]): number {
  return Math.abs(signedArea(poly));
}

export function polygonProjectionRange(
  poly: Point[],
  origin: Point,
  u: Point,
): { from: number; to: number } {
  if (poly.length === 0) return { from: 0, to: 0 };
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const p of poly) {
    const projected = (p.x - origin.x) * u.x + (p.y - origin.y) * u.y;
    from = Math.min(from, projected);
    to = Math.max(to, projected);
  }
  return { from, to };
}

function clipHalfPlane(poly: Point[], value: (p: Point) => number): Point[] {
  if (poly.length === 0) return [];
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const next = poly[(i + 1) % poly.length];
    const dc = value(cur);
    const dn = value(next);
    if (dc >= 0) out.push(cur);
    if ((dc >= 0 && dn < 0) || (dc < 0 && dn >= 0)) {
      const t = dc / (dc - dn);
      out.push({ x: cur.x + (next.x - cur.x) * t, y: cur.y + (next.y - cur.y) * t });
    }
  }
  return out;
}

export function clipPolygonAlong(
  poly: Point[],
  origin: Point,
  u: Point,
  from: number,
  to: number,
): Point[] {
  if (to - from <= 1e-6) return [];
  const along = (p: Point) => (p.x - origin.x) * u.x + (p.y - origin.y) * u.y;
  let res = clipHalfPlane(poly, (p) => along(p) - from);
  if (res.length < 3) return [];
  res = clipHalfPlane(res, (p) => to - along(p));
  if (res.length < 3) return [];
  if (polygonArea(res) < 1e-6) return [];
  return res;
}

/** 3D 엔진에 넘길 압출 스펙 (엔진 비의존) */
export interface ExtrudeSolid {
  id: string;
  /** 바닥 폴리곤 (월드 XY, m) */
  footprint: Point[];
  elevation: number;
  height: number;
  kind: "wall" | "zone" | "opening-void";
  meta?: Record<string, unknown>;
}

/**
 * 월드 XY 폴리곤을 [yBottom, yTop] 수직 솔리드 스펙으로 만든다.
 * Three.js 연동 시: Shape + ExtrudeGeometry 또는 custom mesh 빌더에 footprint 전달.
 */
export function extrudePolygonSpec(
  poly: Point[],
  yBottom: number,
  yTop: number,
  id = "solid",
  kind: ExtrudeSolid["kind"] = "wall",
): ExtrudeSolid | null {
  const height = yTop - yBottom;
  if (height <= 1e-5 || poly.length < 3) return null;
  if (polygonArea(poly) < 1e-6) return null;
  const pts = poly.map((p) => ({ x: p.x, y: p.y }));
  if (signedArea(pts) < 0) pts.reverse();
  return {
    id,
    footprint: pts,
    elevation: yBottom,
    height,
    kind,
  };
}
