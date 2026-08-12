/**
 * PlanDocument 공간 그래프 — 존/벽 페이스 센터 + 문 연결 엣지.
 * 유닛 에디터: 두 실 사이 센터 표시 · 문 경유 연결선.
 */

import {
  add,
  dist,
  mul,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from "./geometry";
import { getOpeningPlacement, isDoor } from "./openings";
import type { Opening, PlanDocument, Point, Wall, Zone } from "./types";

export interface SpaceNode {
  id: string;
  name: string;
  area: number;
  center: Point;
  polygon: Point[];
  kind?: "room" | "corridor";
  fromZone: boolean;
}

export interface SpaceEdge {
  id: string;
  from: string;
  to: string;
  openingId: string;
  /** 문 중심 (월드 m) */
  via?: Point;
}

export interface SpaceGraph {
  nodes: SpaceNode[];
  edges: SpaceEdge[];
}

export function getConnectionPath(
  from: SpaceNode,
  to: SpaceNode,
  opening?: Point | null,
): Point[] {
  if (opening) return [from.center, opening, to.center];
  return [from.center, to.center];
}

export function getOpeningWorldCenter(
  doc: PlanDocument,
  openingId: string,
): Point | null {
  const op = doc.openings.find((o) => o.id === openingId);
  if (!op) return null;
  const wall = doc.walls.find((w) => w.id === op.wallId);
  if (!wall) return null;
  return getOpeningPlacement(op, wall)?.center ?? null;
}

const SNAP = 0.12; // m — 작도 오차 허용

function snapKey(p: Point, snap = SNAP): string {
  const x = Math.round(p.x / snap) * snap;
  const y = Math.round(p.y / snap) * snap;
  return `${x.toFixed(3)},${y.toFixed(3)}`;
}

function snapPoint(p: Point, snap = SNAP): Point {
  return {
    x: Math.round(p.x / snap) * snap,
    y: Math.round(p.y / snap) * snap,
  };
}

function projectT(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
}

function onSegment(p: Point, a: Point, b: Point, tol = SNAP): boolean {
  const t = projectT(p, a, b);
  if (t < -1e-6 || t > 1 + 1e-6) return false;
  const q = {
    x: a.x + (b.x - a.x) * Math.max(0, Math.min(1, t)),
    y: a.y + (b.y - a.y) * Math.max(0, Math.min(1, t)),
  };
  return dist(p, q) <= tol;
}

/** 두 세그먼트 교차점 (끝점 포함, 평행 제외) */
function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const qp = { x: c.x - a.x, y: c.y - a.y };
  const t = (qp.x * s.y - qp.y * s.x) / den;
  const u = (qp.x * r.y - qp.y * r.x) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/**
 * T접합·교차점을 반영해 벽을 짧은 세그먼트로 분할.
 */
export function splitWallsAtJunctions(walls: Wall[]): { a: Point; b: Point }[] {
  const raw = walls
    .map((w) => ({ a: snapPoint(w.a), b: snapPoint(w.b) }))
    .filter((s) => dist(s.a, s.b) > SNAP * 0.4);

  const cutPts: Point[] = [];
  for (const s of raw) cutPts.push(s.a, s.b);

  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      const s = raw[i];
      const o = raw[j];
      // 끝점이 다른 변 위
      for (const p of [o.a, o.b]) {
        if (onSegment(p, s.a, s.b) && dist(p, s.a) > SNAP * 0.5 && dist(p, s.b) > SNAP * 0.5) {
          cutPts.push(snapPoint(p));
        }
      }
      for (const p of [s.a, s.b]) {
        if (onSegment(p, o.a, o.b) && dist(p, o.a) > SNAP * 0.5 && dist(p, o.b) > SNAP * 0.5) {
          cutPts.push(snapPoint(p));
        }
      }
      // 교차
      const hit = segmentIntersection(s.a, s.b, o.a, o.b);
      if (hit) cutPts.push(snapPoint(hit));
    }
  }

  const segs: { a: Point; b: Point }[] = [];
  for (const s of raw) {
    const ts: { t: number; p: Point }[] = [
      { t: 0, p: s.a },
      { t: 1, p: s.b },
    ];
    for (const p of cutPts) {
      if (!onSegment(p, s.a, s.b, SNAP * 1.2)) continue;
      const t = projectT(p, s.a, s.b);
      if (t > 1e-4 && t < 1 - 1e-4) ts.push({ t, p: snapPoint(p) });
    }
    ts.sort((a, b) => a.t - b.t);
    const uniq: { t: number; p: Point }[] = [];
    for (const x of ts) {
      if (uniq.length && Math.abs(uniq[uniq.length - 1].t - x.t) < 1e-4) continue;
      uniq.push(x);
    }
    for (let k = 0; k < uniq.length - 1; k++) {
      if (dist(uniq[k].p, uniq[k + 1].p) > SNAP * 0.35) {
        segs.push({ a: uniq[k].p, b: uniq[k + 1].p });
      }
    }
  }
  return segs;
}

export function areaCentroid(poly: Point[]): Point {
  if (poly.length < 3) return polygonCentroid(poly);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const cross = poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    a += cross;
    cx += (poly[i].x + poly[j].x) * cross;
    cy += (poly[i].y + poly[j].y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-8) return polygonCentroid(poly);
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

type DirEdge = {
  fromK: string;
  toK: string;
  from: Point;
  to: Point;
  id: string;
};

/** 벽 세그먼트 → 닫힌 실 폴리곤들 */
export function extractFacesFromWalls(walls: Wall[]): Point[][] {
  if (walls.length < 3) return [];

  const pts = new Map<string, Point>();
  type Nbr = { toK: string; to: Point };
  const adj = new Map<string, Nbr[]>();

  const addUndirected = (a: Point, b: Point) => {
    const A = snapPoint(a);
    const B = snapPoint(b);
    if (dist(A, B) < SNAP * 0.4) return;
    const ka = snapKey(A);
    const kb = snapKey(B);
    pts.set(ka, A);
    pts.set(kb, B);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    if (!adj.get(ka)!.some((n) => n.toK === kb)) adj.get(ka)!.push({ toK: kb, to: B });
    if (!adj.get(kb)!.some((n) => n.toK === ka)) adj.get(kb)!.push({ toK: ka, to: A });
  };

  for (const s of splitWallsAtJunctions(walls)) addUndirected(s.a, s.b);

  for (const [k, nbrs] of adj) {
    const p = pts.get(k)!;
    nbrs.sort(
      (a, b) =>
        Math.atan2(a.to.y - p.y, a.to.x - p.x) - Math.atan2(b.to.y - p.y, b.to.x - p.x),
    );
  }

  const dirEdges: DirEdge[] = [];
  for (const [fromK, nbrs] of adj) {
    const from = pts.get(fromK)!;
    for (const n of nbrs) {
      dirEdges.push({
        fromK,
        toK: n.toK,
        from,
        to: n.to,
        id: `${fromK}>${n.toK}`,
      });
    }
  }

  const nextCW = (arriveK: string, prevK: string): DirEdge | null => {
    const nbrs = adj.get(arriveK) ?? [];
    if (nbrs.length === 0) return null;
    const arrive = pts.get(arriveK)!;
    let idx = nbrs.findIndex((n) => n.toK === prevK);
    if (idx < 0) idx = 0;
    const n = nbrs[(idx - 1 + nbrs.length) % nbrs.length];
    return {
      fromK: arriveK,
      toK: n.toK,
      from: arrive,
      to: n.to,
      id: `${arriveK}>${n.toK}`,
    };
  };

  const used = new Set<string>();
  const faces: Point[][] = [];

  for (const start of dirEdges) {
    if (used.has(start.id)) continue;
    const path: Point[] = [start.from];
    let cur = start;
    let guard = 0;
    let closed = false;

    while (guard++ < 256) {
      if (used.has(cur.id)) break;
      used.add(cur.id);
      path.push(cur.to);
      if (cur.toK === start.fromK && path.length >= 4) {
        closed = true;
        break;
      }
      const nxt = nextCW(cur.toK, cur.fromK);
      if (!nxt) break;
      cur = nxt;
    }

    if (!closed || path.length < 4) continue;
    const ring = path.slice(0, -1);
    if (ring.length < 3) continue;
    if (polygonArea(ring) < 0.25) continue;
    faces.push(ring);
  }

  if (faces.length === 0) return [];

  const unique: Point[][] = [];
  for (const f of faces.sort((a, b) => polygonArea(b) - polygonArea(a))) {
    const c = areaCentroid(f);
    const a = polygonArea(f);
    const dup = unique.some((u) => {
      const cu = areaCentroid(u);
      return Math.abs(polygonArea(u) - a) < 0.2 && dist(c, cu) < 0.35;
    });
    if (!dup) unique.push(f);
  }

  if (unique.length === 1) return unique;

  const maxA = polygonArea(unique[0]);
  const rooms = unique.filter((f) => polygonArea(f) < maxA * 0.9);
  return rooms.length > 0 ? rooms : unique;
}

function zonesToNodes(zones: Zone[]): SpaceNode[] {
  return zones
    .filter((z) => z.points.length >= 3 && polygonArea(z.points) >= 0.2)
    .map((z) => ({
      id: z.id,
      name: z.name || "공간",
      area: polygonArea(z.points),
      center: areaCentroid(z.points),
      polygon: z.points,
      kind: z.kind,
      fromZone: true,
    }));
}

function facesToNodes(faces: Point[][], zones: Zone[]): SpaceNode[] {
  return faces.map((poly, i) => {
    const center = areaCentroid(poly);
    // 수동 존 이름이 있으면 매칭
    const hit = zones.find(
      (z) => z.points.length >= 3 && pointInPolygon(center, z.points),
    );
    return {
      id: `face-${i}`,
      name: hit?.name || `Room ${i + 1}`,
      area: polygonArea(poly),
      center,
      polygon: poly,
      kind: hit?.kind ?? "room",
      fromZone: false,
    };
  });
}

function boundaryNode(boundary: Point[]): SpaceNode | null {
  if (boundary.length < 3) return null;
  return {
    id: "face-site",
    name: "전체",
    area: polygonArea(boundary),
    center: areaCentroid(boundary),
    polygon: boundary,
    kind: "room",
    fromZone: false,
  };
}

/**
 * 문 양옆 공간 찾기.
 * - 문(door) 이 없으면 호출하지 않음 → 연결선 없음
 * - 외벽 문처럼 한 쪽만 실이면 연결하지 않음 (2실 확정 시에만)
 * - "가장 가까운 2실" 강제 연결은 사용하지 않음
 */
export function findSpacesConnectedByOpening(
  nodes: SpaceNode[],
  doc: PlanDocument,
  opening: Opening,
): string[] {
  // 창·기타는 연결 안 함. 문만 (여닫이/미닫이/쌍여닫이)
  if (!isDoor(opening.kind)) return [];
  if (nodes.length < 2) return [];

  const wall = doc.walls.find((w) => w.id === opening.wallId);
  if (!wall) return [];

  const pl = getOpeningPlacement(opening, wall);
  if (!pl) return [];

  const hitAt = (p: Point): string | null => {
    let best: { id: string; area: number } | null = null;
    for (const n of nodes) {
      if (n.polygon.length < 3) continue;
      if (!pointInPolygon(p, n.polygon)) continue;
      if (!best || n.area < best.area) best = { id: n.id, area: n.area };
    }
    return best?.id ?? null;
  };

  // 1) 문 법선 양옆 프로브 — 서로 다른 실 2개
  const probes = [0.08, 0.15, 0.25, 0.4, 0.6, 0.9, 1.2];
  const anchors = [pl.center, pl.s, pl.e];
  const hitIds = new Set<string>();
  for (const anchor of anchors) {
    for (const probe of probes) {
      for (const sign of [1, -1] as const) {
        const id = hitAt(add(anchor, mul(pl.n, sign * probe)));
        if (id) hitIds.add(id);
      }
      if (hitIds.size >= 2) return [...hitIds].slice(0, 2);
    }
  }
  if (hitIds.size >= 2) return [...hitIds].slice(0, 2);

  // 2) 이 문(벽) 기준 좌·우에 센터가 있는 실만 — 양쪽에 각각 1개 이상일 때만
  const left: { id: string; d: number }[] = [];
  const right: { id: string; d: number }[] = [];
  for (const n of nodes) {
    const side =
      (n.center.x - pl.center.x) * pl.n.x + (n.center.y - pl.center.y) * pl.n.y;
    const along =
      (n.center.x - wall.a.x) * pl.dir.x + (n.center.y - wall.a.y) * pl.dir.y;
    // 이 문 구간 근처 실만 (멀리 있는 방과 임의 연결 방지)
    const nearDoor =
      along >= pl.offset - pl.half - 1.5 &&
      along <= pl.offset + pl.half + 1.5 &&
      Math.abs(side) < 12;
    if (!nearDoor) continue;
    if (side > 0.08) left.push({ id: n.id, d: Math.abs(side) });
    else if (side < -0.08) right.push({ id: n.id, d: Math.abs(side) });
  }
  left.sort((a, b) => a.d - b.d);
  right.sort((a, b) => a.d - b.d);
  if (left.length && right.length && left[0].id !== right[0].id) {
    return [left[0].id, right[0].id];
  }

  // 한 쪽만 실(외벽 문 등) → 연결 없음
  return [];
}

/** PlanDocument → 공간 노드 + 문 연결 엣지 (문 없으면 edges 항상 빈 배열) */
export function buildSpaceGraph(doc: PlanDocument): SpaceGraph {
  const zoneNodes = zonesToNodes(doc.zones);
  const faces = extractFacesFromWalls(doc.walls);
  const faceNodes = facesToNodes(faces, doc.zones);

  // 2실 이상이면 벽 페이스 우선 (칸막이 반영)
  let nodes: SpaceNode[];
  if (faceNodes.length >= 2) {
    nodes = faceNodes;
  } else if (zoneNodes.length >= 2) {
    nodes = zoneNodes;
  } else if (faceNodes.length === 1) {
    nodes = faceNodes;
  } else if (zoneNodes.length > 0) {
    nodes = zoneNodes;
  } else if (doc.siteBoundary && doc.siteBoundary.length >= 3) {
    const bn = boundaryNode(doc.siteBoundary);
    nodes = bn ? [bn] : [];
  } else {
    nodes = [];
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: SpaceEdge[] = [];
  const seenPair = new Set<string>();

  // 문이 하나도 없으면 연결선 없음 (센터 점만)
  const doors = doc.openings.filter((op) => isDoor(op.kind));
  for (const op of doors) {
    const connected = findSpacesConnectedByOpening(nodes, doc, op).filter((id) =>
      nodeIds.has(id),
    );
    if (connected.length < 2) continue;

    const [a, b] = connected;
    if (a === b) continue;
    const key = `${[a, b].sort().join("|")}|${op.id}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);

    const wall = doc.walls.find((w) => w.id === op.wallId);
    const via = wall ? getOpeningPlacement(op, wall)?.center : undefined;

    edges.push({
      id: `edge-${op.id}`,
      from: a,
      to: b,
      openingId: op.id,
      via: via ? { ...via } : undefined,
    });
  }

  return { nodes, edges };
}

export function toggleOpeningState(state: Opening["state"]): "open" | "closed" {
  return state === "closed" ? "open" : "closed";
}
