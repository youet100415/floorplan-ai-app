import type { Point, Wall } from "./types";

/** 벽 조인(마이터) 계산 — 중심선 그래프에서 폴리곤을 매번 새로 계산한다. */

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
const norm = (a: Point): Point => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
const perp = (a: Point): Point => ({ x: -a.y, y: a.x });
const distp = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Endpoints this close are treated as one authored wall junction.
 *
 * Keep this value shared by 2D, the built-in 3D viewport, and external scene
 * adapters. Otherwise a visually joined 2D corner can arrive in another 3D
 * engine as two independent square-ended walls.
 */
export const WALL_JOIN_TOLERANCE = 0.001;

/**
 * Return wall copies whose near-coincident endpoints use one canonical point.
 * Walls must already belong to the same story; callers handling a full model
 * should normalize each story independently.
 */
export function normalizeWallJunctions(walls: Wall[], tolerance = WALL_JOIN_TOLERANCE): Wall[] {
  const nodes: Point[] = [];
  const canonicalPoint = (point: Point): Point => {
    const node = nodes.find((candidate) => distp(candidate, point) <= tolerance);
    if (node) return { ...node };
    const next = { ...point };
    nodes.push(next);
    return { ...next };
  };

  return walls.map((wall) => ({
    ...wall,
    a: canonicalPoint(wall.a),
    b: canonicalPoint(wall.b),
  }));
}

function intersectLines(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / det;
  return add(p1, scale(d1, t));
}

export interface WallPolygon {
  wall: Wall;
  /** [s.right, e.left, e.right, s.left] — [0-1], [2-3] 이 긴 변 */
  polygon: Point[];
  startJoined: boolean;
  endJoined: boolean;
}

type EndKey = string;

export interface WallJoinResult {
  polys: WallPolygon[];
  /** 3갈래 이상 노드의 허브 채움 폴리곤 (T/X 접합 내부 메움) */
  patches: Point[][];
}

/** 중심선 그래프 기반 벽 폴리곤 계산 (L/T/X 조인, 두께 혼합, 막다른 끝 처리) */
export function computeWallPolygons(walls: Wall[], tol = WALL_JOIN_TOLERANCE): WallJoinResult {
  // 원본을 변형하지 않기 위해 복사본으로 작업
  const items = normalizeWallJunctions(walls, tol).map((w) => ({
    wall: w,
    start: { ...w.a },
    end: { ...w.b },
  }));

  const nodes: {
    pos: Point;
    ends: { it: (typeof items)[number]; end: "start" | "end" }[];
  }[] = [];

  for (const it of items) {
    for (const end of ["start", "end"] as const) {
      const p = it[end];
      let node = nodes.find((n) => distp(n.pos, p) <= tol);
      if (!node) {
        node = { pos: { ...p }, ends: [] };
        nodes.push(node);
      }
      node.ends.push({ it, end });
      it[end] = { ...node.pos }; // 하드 스냅
    }
  }

  const endGeo = new Map<EndKey, { left: Point; right: Point; joined: boolean }>();
  const patches: Point[][] = [];
  const keyOf = (id: string, end: "start" | "end") => `${id}:${end}`;

  for (const node of nodes) {
    const P = node.pos;
    const arms = node.ends
      .map((e) => {
        const other = e.end === "start" ? e.it.end : e.it.start;
        const d = norm(sub(other, P));
        return {
          id: e.it.wall.id,
          end: e.end,
          d,
          n: perp(d),
          t: e.it.wall.thickness,
          angle: Math.atan2(d.y, d.x),
        };
      })
      .sort((a, b) => a.angle - b.angle);

    const m = arms.length;
    if (m === 1) {
      const it = arms[0];
      endGeo.set(keyOf(it.id, it.end), {
        left: add(P, scale(it.n, it.t / 2)),
        right: add(P, scale(it.n, -it.t / 2)),
        joined: false,
      });
      continue;
    }

    const corners: Point[] = [];
    for (let i = 0; i < m; i++) {
      const a = arms[i];
      const b = arms[(i + 1) % m];
      const pa = add(P, scale(a.n, a.t / 2));
      const pb = add(P, scale(b.n, -b.t / 2));
      let c = intersectLines(pa, a.d, pb, b.d);
      const MITER_LIMIT = 4 * Math.max(a.t, b.t);
      if (!c || distp(c, P) > MITER_LIMIT) c = pa;
      corners.push(c);
    }
    for (let i = 0; i < m; i++) {
      endGeo.set(keyOf(arms[i].id, arms[i].end), {
        left: corners[i],
        right: corners[(i - 1 + m) % m],
        joined: true,
      });
    }
    if (m >= 3) patches.push(corners);
  }

  const polys = items.map(({ wall }) => {
    const s = endGeo.get(keyOf(wall.id, "start"))!;
    const e = endGeo.get(keyOf(wall.id, "end"))!;
    return {
      wall,
      polygon: [s.right, e.left, e.right, s.left],
      startJoined: s.joined,
      endJoined: e.joined,
    };
  });

  return { polys, patches };
}

/** 벽 끝점 스냅 (없으면 null) */
export function snapToWallNode(p: Point, walls: Wall[], tolerance: number): Point | null {
  let best: Point | null = null;
  let bestD = tolerance;
  for (const w of walls) {
    for (const e of [w.a, w.b]) {
      const d = distp(p, e);
      if (d < bestD) {
        bestD = d;
        best = { ...e };
      }
    }
  }
  return best;
}

/** 벽 중심선 위(내부)로의 수직 투영 스냅 — T 접합용 */
export function snapToWallBody(
  p: Point,
  walls: Wall[],
  tolerance: number,
): { point: Point; wall: Wall } | null {
  let best: { point: Point; wall: Wall } | null = null;
  let bestD = tolerance;
  for (const w of walls) {
    const ab = sub(w.b, w.a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    if (l2 < 1e-9) continue;
    const t = ((p.x - w.a.x) * ab.x + (p.y - w.a.y) * ab.y) / l2;
    if (t <= 0.02 || t >= 0.98) continue;
    const point = add(w.a, scale(ab, t));
    const d = distp(p, point);
    if (d < bestD) {
      bestD = d;
      best = { point, wall: w };
    }
  }
  return best;
}
