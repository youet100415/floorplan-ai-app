import type { Point, ViewTransform, Wall } from "./types";

export const worldToScreen = (p: Point, v: ViewTransform): Point => ({
  x: p.x * v.scale + v.ox,
  y: -p.y * v.scale + v.oy,
});

export const screenToWorld = (p: Point, v: ViewTransform): Point => ({
  x: (p.x - v.ox) / v.scale,
  y: -(p.y - v.oy) / v.scale,
});

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const len = (a: Point): number => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const normalize = (a: Point): Point => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

/** 좌측 법선 벡터 */
export const normal = (a: Point): Point => ({ x: -a.y, y: a.x });

export const angleDeg = (a: Point, b: Point): number =>
  (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

export const snapToGrid = (p: Point, step: number): Point =>
  step > 0 ? { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step } : p;

/** 직교(0/45/90도) 보정 */
export const orthoConstrain = (from: Point, to: Point): Point => {
  const d = sub(to, from);
  const a = Math.atan2(d.y, d.x);
  const step = Math.PI / 4;
  const snapped = Math.round(a / step) * step;
  const l = len(d);
  return { x: from.x + Math.cos(snapped) * l, y: from.y + Math.sin(snapped) * l };
};

/** 완전 직각(0/90도) 보정 */
export const rightAngleConstrain = (from: Point, to: Point): Point => {
  const d = sub(to, from);
  return Math.abs(d.x) >= Math.abs(d.y)
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y };
};

/**
 * 자유 각도 기본 + 가벼운 보정.
 * 0/45/90도에 toleranceDeg 이내로 근접할 때만 살짝 붙고, 그 외에는 원래 각도를 유지한다.
 */
export const softAngleConstrain = (
  from: Point,
  to: Point,
  toleranceDeg = 3,
): Point => {
  const d = sub(to, from);
  const l = len(d);
  if (l === 0) return to;
  const a = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  const step = 45;
  const nearest = Math.round(a / step) * step;
  if (Math.abs(a - nearest) > toleranceDeg) return to;
  const r = (nearest * Math.PI) / 180;
  return { x: from.x + Math.cos(r) * l, y: from.y + Math.sin(r) * l };
};

/** 각도는 유지한 채 길이만 step 단위로 반올림 */
export const snapLength = (from: Point, to: Point, step: number): Point => {
  if (step <= 0) return to;
  const d = sub(to, from);
  const l = len(d);
  if (l === 0) return to;
  const snapped = Math.max(step, Math.round(l / step) * step);
  return { x: from.x + (d.x / l) * snapped, y: from.y + (d.y / l) * snapped };
};


/** 기존 벽 끝점에 붙기 */
export function snapToEndpoints(p: Point, walls: Wall[], tolerance: number): Point | null {
  let best: Point | null = null;
  let bestD = tolerance;
  for (const w of walls) {
    for (const e of [w.a, w.b]) {
      const d = dist(p, e);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
  }
  return best;
}

/** 점과 선분 사이 거리 및 투영 파라미터 */
export function projectOnSegment(p: Point, a: Point, b: Point) {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
  const point = add(a, mul(ab, t));
  return { t, point, distance: dist(p, point) };
}

/** 클릭 지점에서 가장 가까운 벽 찾기 */
export function pickWall(p: Point, walls: Wall[], tolerance: number) {
  let best: { wall: Wall; t: number; distance: number } | null = null;
  for (const w of walls) {
    const pr = projectOnSegment(p, w.a, w.b);
    const tol = Math.max(tolerance, w.thickness / 2);
    if (pr.distance <= tol && (!best || pr.distance < best.distance)) {
      best = { wall: w, t: pr.t, distance: pr.distance };
    }
  }
  return best;
}

/** 정렬 기준에 따른 벽 중심선 오프셋 벡터 */
export function wallOffset(w: Wall): Point {
  const align = w.align ?? "left";
  if (align === "center") return { x: 0, y: 0 };
  const d = normalize(sub(w.b, w.a));
  const k = (align === "left" ? 1 : -1) * (w.thickness / 2);
  return mul(normal(d), k);
}

/** 작도선(모서리 기준)을 중심선으로 변환 */
export function wallCenterline(w: Wall): { a: Point; b: Point } {
  const o = wallOffset(w);
  return { a: add(w.a, o), b: add(w.b, o) };
}

/** 벽 사각형 폴리곤 좌표 (m) — 작도점은 벽의 모서리(pivot) */
export function wallPolygon(w: Wall): Point[] {
  const d = normalize(sub(w.b, w.a));
  const n = mul(normal(d), w.thickness / 2);
  const c = wallCenterline(w);
  return [add(c.a, n), add(c.b, n), sub(c.b, n), sub(c.a, n)];
}

/** 두 직선(점+방향)의 교점 — 평행이면 null */
function lineIntersect(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/**
 * 이웃 벽과 자동으로 이어지는(마이터 조인) 벽 폴리곤.
 * 좌/우 어느 방향으로 꺾여도 피봇이 자동 보정돼 모서리에 틈이 생기지 않는다.
 */
export function wallPolygonJoined(w: Wall, walls: Wall[]): Point[] {
  const base = wallPolygon(w);
  if (walls.length < 2) return base;

  const d = normalize(sub(w.b, w.a));
  const n = mul(normal(d), w.thickness / 2);
  const c = wallCenterline(w);
  const eps = Math.max(w.thickness, 0.05);
  const maxMiter = w.thickness * 6;

  // side +n: [a+n, b+n], side -n: [a-n, b-n]
  const corners: Record<"ap" | "bp" | "am" | "bm", Point> = {
    ap: add(c.a, n),
    bp: add(c.b, n),
    am: sub(c.a, n),
    bm: sub(c.b, n),
  };

  const solve = (endpoint: Point, sign: 1 | -1, key: "ap" | "bp" | "am" | "bm") => {
    const neighbors = walls.filter(
      (v) => v.id !== w.id && (dist(v.a, endpoint) < eps || dist(v.b, endpoint) < eps),
    );
    if (neighbors.length !== 1) return;
    const v = neighbors[0];
    const vd = normalize(sub(v.b, v.a));
    if (Math.abs(vd.x * d.x + vd.y * d.y) > 0.9999) return; // 평행
    const vn = mul(normal(vd), v.thickness / 2);
    const vc = wallCenterline(v);
    const myPoint = corners[key];
    const candidates = [add(vc.a, vn), sub(vc.a, vn)];
    let best: Point | null = null;
    let bestD = maxMiter;
    for (const cp of candidates) {
      const hit = lineIntersect(myPoint, d, cp, vd);
      if (!hit) continue;
      const dd = dist(hit, endpoint);
      if (dd < bestD) {
        bestD = dd;
        best = hit;
      }
    }
    if (best) corners[key] = best;
    void sign;
  };

  solve(w.a, 1, "ap");
  solve(w.b, 1, "bp");
  solve(w.a, -1, "am");
  solve(w.b, -1, "bm");

  return [corners.ap, corners.bp, corners.bm, corners.am];
}



export const formatMeters = (v: number): string => `${v.toFixed(2)} m`;

export const uid = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

/** 폴리곤 내부 판정 */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 폴리곤 면적 (m²) */
export function polygonArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    sum += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(sum / 2);
}

/** 폴리곤 무게중심 */
export function polygonCentroid(poly: Point[]): Point {
  if (poly.length === 0) return { x: 0, y: 0 };
  const sx = poly.reduce((s, p) => s + p.x, 0);
  const sy = poly.reduce((s, p) => s + p.y, 0);
  return { x: sx / poly.length, y: sy / poly.length };
}
