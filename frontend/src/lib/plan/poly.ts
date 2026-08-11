/**
 * 폴리곤 기하 유틸 (미터 단위, 월드 XY).
 * 자동 조닝에서 대지 경계 처리를 위해 사용한다.
 */

export interface Pt {
  x: number;
  y: number;
}

export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function area(poly: Pt[]): number {
  return Math.abs(signedArea(poly));
}

/** CCW 방향으로 정규화한 사본 */
export function toCCW(poly: Pt[]): Pt[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : [...poly];
}

export function centroid(poly: Pt[]): Pt {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      y: poly.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(poly: Pt[]): Bounds {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** 점-선분 거리 */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
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

/** 내부 또는 경계선에서 tol 이내 */
export function pointInOrOn(p: Pt, poly: Pt[], tol = 0.05): boolean {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (distToSegment(p, poly[i], poly[(i + 1) % poly.length]) <= tol) return true;
  }
  return false;
}

/** 반평면 클리핑 — value(p) >= 0 영역만 남긴다 (Sutherland–Hodgman) */
export function clipHalfPlane(poly: Pt[], value: (p: Pt) => number): Pt[] {
  if (poly.length === 0) return [];
  const out: Pt[] = [];
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

/**
 * 볼록 클리퍼로 임의(오목 포함) 폴리곤을 자른 교집합.
 * subject 는 오목해도 되며, clipper 는 반드시 볼록해야 한다.
 */
export function clipByConvex(subject: Pt[], clipper: Pt[]): Pt[] {
  if (subject.length < 3 || clipper.length < 3) return [];
  const cw = toCCW(clipper);
  let res = [...subject];
  for (let i = 0; i < cw.length; i++) {
    const a = cw[i];
    const b = cw[(i + 1) % cw.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    res = clipHalfPlane(res, (p) => (p.x - a.x) * ey * -1 + (p.y - a.y) * ex);
    if (res.length < 3) return [];
  }
  return dedupe(res);
}

/** 축 정렬 사각형으로 자르기 (rect 는 항상 볼록) */
export function clipByRect(
  subject: Pt[],
  r: { x: number; y: number; w: number; h: number },
): Pt[] {
  return clipByConvex(subject, [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ]);
}

/** 인접 중복점 제거 */
export function dedupe(poly: Pt[], eps = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > eps) out.push(p);
  }
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= eps) out.pop();
    else break;
  }
  return out;
}

/** 거의 일직선인 정점 제거 */
export function simplify(poly: Pt[], tol = 1e-4): Pt[] {
  const pts = dedupe(poly);
  if (pts.length < 4) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    if (distToSegment(cur, prev, next) > tol) out.push(cur);
  }
  return out.length >= 3 ? out : pts;
}

const lineIntersect = (p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null => {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
};

/**
 * 폴리곤을 안쪽으로 d 만큼 오프셋(마이터).
 * 자기교차가 생길 정도로 크게 줄이면 원본을 그대로 반환한다.
 */
export function inset(poly: Pt[], d: number): Pt[] {
  if (d <= 0 || poly.length < 3) return [...poly];
  const src = toCCW(simplify(poly));
  const n = src.length;
  const lines: { p: Pt; dir: Pt }[] = [];
  for (let i = 0; i < n; i++) {
    const a = src[i];
    const b = src[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // CCW 폴리곤의 내부는 좌측 법선 방향
    const nx = -dir.y;
    const ny = dir.x;
    lines.push({ p: { x: a.x + nx * d, y: a.y + ny * d }, dir });
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    const hit = lineIntersect(prev.p, prev.dir, cur.p, cur.dir);
    out.push(hit ?? cur.p);
  }
  const res = simplify(out);
  if (res.length < 3) return [...poly];
  if (area(res) < 1e-6 || area(res) > area(poly)) return [...poly];
  // 심하게 뒤집힌 경우 방어
  if (signedArea(res) * signedArea(src) < 0) return [...poly];
  return res;
}

/** 최소 면적 회전 바운딩 박스의 변 길이 (장변, 단변) */
export function obbDims(poly: Pt[]): { long: number; short: number } {
  if (poly.length < 3) return { long: 0, short: 0 };
  let best = { long: Infinity, short: Infinity, a: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of poly) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const w = maxU - minU;
    const h = maxV - minV;
    if (w * h < best.a) {
      best = { long: Math.max(w, h), short: Math.min(w, h), a: w * h };
    }
  }
  if (!Number.isFinite(best.long)) return { long: 0, short: 0 };
  return { long: best.long, short: best.short };
}

/** 두 폴리곤의 교집합 면적 (부호 있는 삼각형 분해로 오목 폴리곤도 정확) */
export function intersectionArea(a: Pt[], b: Pt[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  let total = 0;
  for (let i = 1; i < b.length - 1; i++) {
    const tri = [b[0], b[i], b[i + 1]];
    const sign = signedArea(tri) >= 0 ? 1 : -1;
    total += sign * area(clipByConvex(a, tri));
  }
  return Math.abs(total);
}
