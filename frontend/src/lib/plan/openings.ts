import { add, dist, mul, normal, normalize, projectOnSegment, sub } from "./geometry";
import type { DoorState, Opening, OpeningKind, Point, Wall } from "./types";

/** 한국 표준(KS) 기준 기본 치수 프리셋 */
export interface OpeningPreset {
  kind: OpeningKind;
  label: string;
  width: number;
  height: number;
  sill?: number;
  /** 문틀(창틀) 두께 (m) */
  frame: number;
}

/** 기본 문틀 두께 (m) */
export const DEFAULT_FRAME = 0.08;

export const OPENING_PRESETS: OpeningPreset[] = [
  { kind: "door-single", label: "외여닫이문", width: 0.9, height: 2.1, frame: DEFAULT_FRAME },
  { kind: "door-double", label: "쌍여닫이문", width: 1.6, height: 2.1, frame: DEFAULT_FRAME },
  { kind: "door-sliding", label: "미닫이문", width: 1.5, height: 2.1, frame: DEFAULT_FRAME },
  { kind: "opening", label: "개구부", width: 1.0, height: 2.1, frame: DEFAULT_FRAME },
  { kind: "window-single", label: "단창", width: 1.2, height: 1.5, sill: 0.9, frame: 0.06 },
  { kind: "window-double", label: "이중창", width: 1.5, height: 1.5, sill: 0.9, frame: 0.06 },
  { kind: "window-sliding", label: "미서기창", width: 1.8, height: 1.5, sill: 0.9, frame: 0.06 },
];

export const presetOf = (kind: OpeningKind): OpeningPreset =>
  OPENING_PRESETS.find((p) => p.kind === kind) ?? OPENING_PRESETS[0];

export const isWindow = (kind: OpeningKind): boolean => kind.startsWith("window");

export const isDoor = (kind: OpeningKind): boolean => kind.startsWith("door");

export const DOOR_STATES: { value: DoorState; label: string }[] = [
  { value: "open", label: "열림" },
  { value: "ajar", label: "반개" },
  { value: "closed", label: "닫힘" },
];

/** 상태별 문짝 회전 각도(라디안) */
const stateAngle = (state: DoorState): number =>
  state === "closed" ? 0 : state === "ajar" ? Math.PI / 4 : Math.PI / 2;

/** 창호의 월드 배치 정보 (벽 중심선에서 파생) */
export interface OpeningPlacement {
  wall: Wall;
  /** 벽 방향 단위 벡터 */
  dir: Point;
  /** 벽 법선 단위 벡터 */
  n: Point;
  /** 벽 두께 */
  t: number;
  /** 개구부 중심 */
  center: Point;
  /** 개구부 시작(벽 a쪽) 중심선 점 */
  s: Point;
  /** 개구부 끝(벽 b쪽) 중심선 점 */
  e: Point;
  /** 반폭 */
  half: number;
  /** 실제 사용 폭 (벽 길이로 클램프) */
  width: number;
  /** 벽 시작점부터 중심까지 거리 (클램프됨) */
  offset: number;
  wallLength: number;
}

/** 벽 중심선 기준으로 창호의 월드 배치를 계산 */
export function getOpeningPlacement(o: Opening, wall: Wall): OpeningPlacement | null {
  const L = dist(wall.a, wall.b);
  if (L < 1e-6) return null;
  const dir = normalize(sub(wall.b, wall.a));
  const n = normal(dir);
  const width = Math.min(o.width, L);
  const half = width / 2;
  const offset = Math.min(Math.max(o.offset, half), L - half);
  const center = add(wall.a, mul(dir, offset));
  return {
    wall,
    dir,
    n,
    t: wall.thickness,
    center,
    s: add(wall.a, mul(dir, offset - half)),
    e: add(wall.a, mul(dir, offset + half)),
    half,
    width,
    offset,
    wallLength: L,
  };
}

export interface OpeningMoveTarget {
  wallId: string;
  offset: number;
}

/**
 * Find the closest host wall and clamp the opening centre so the full opening
 * remains inside that wall. This keeps 2D and both 3D views on one host wall.
 */
export function findOpeningMoveTarget(
  opening: Opening,
  walls: Wall[],
  point: Point,
  tolerance = Number.POSITIVE_INFINITY,
): OpeningMoveTarget | null {
  let best: { wall: Wall; distance: number; t: number } | null = null;
  for (const wall of walls) {
    const length = dist(wall.a, wall.b);
    if (length + 1e-6 < opening.width) continue;
    const projected = projectOnSegment(point, wall.a, wall.b);
    if (projected.distance > tolerance || (best && projected.distance >= best.distance)) continue;
    best = { wall, distance: projected.distance, t: projected.t };
  }
  if (!best) return null;

  const length = dist(best.wall.a, best.wall.b);
  const half = Math.min(opening.width, length) / 2;
  return {
    wallId: best.wall.id,
    offset: Math.min(Math.max(best.t * length, half), length - half),
  };
}

/** 벽 길이축에서 잘라낼 구간 [시작, 끝] 목록 */
export function computeWallOpenings(wall: Wall, openings: Opening[]): [number, number][] {
  const L = dist(wall.a, wall.b);
  const out: [number, number][] = [];
  for (const o of openings) {
    if (o.wallId !== wall.id) continue;
    const p = getOpeningPlacement(o, wall);
    if (!p) continue;
    out.push([Math.max(0, p.offset - p.half), Math.min(L, p.offset + p.half)]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** 창호가 벽에서 차지하는 사각형(월드 좌표, 두께 방향으로 살짝 여유) */
export function openingCutQuad(p: OpeningPlacement, pad = 0.001, frame = 0): Point[] {
  const along = mul(p.dir, p.half + Math.max(0, frame));
  const across = mul(p.n, p.t / 2 + pad);
  return [
    add(add(p.center, along), across),
    add(sub(p.center, along), across),
    sub(sub(p.center, along), across),
    sub(add(p.center, along), across),
  ];
}

export interface SymbolPart {
  pts: Point[];
  dashed?: boolean;
  weight?: number;
  closed?: boolean;
}

/** 원호를 폴리라인으로 근사 */
function arcPts(center: Point, from: Point, to: Point, segments = 20): Point[] {
  const r = dist(center, from);
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  let a1 = Math.atan2(to.y - center.y, to.x - center.x);
  while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
  while (a0 - a1 > Math.PI) a1 += Math.PI * 2;
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    pts.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
  }
  return pts;
}

/** 창호 심볼을 월드 좌표 프리미티브로 생성 (건축 도면 관례) */
export interface FillPart {
  pts: Point[];
  /** frame = 문틀, leaf = 문짝/패널 */
  role: "frame" | "leaf";
}

export interface SymbolOptions {
  flip?: boolean;
  /** 문틀 두께 (m) */
  frame?: number;
  /** 문 개폐 상태 */
  state?: DoorState;
}

export interface OpeningSymbol {
  jambs: Point[][];
  parts: SymbolPart[];
  fills: FillPart[];
}

/** 방향/두께가 주어진 사각형 생성 */
function rect(from: Point, along: Point, length: number, thickness: number): Point[] {
  const u = mul(normalize(along), length);
  const q = mul(normal(normalize(along)), thickness / 2);
  return [add(from, q), add(add(from, u), q), sub(add(from, u), q), sub(from, q)];
}

export function buildOpeningSymbol(
  p: OpeningPlacement,
  kind: OpeningKind,
  opts: SymbolOptions = {},
): OpeningSymbol {
  const { dir, n, t, s, e, center, width } = p;
  const flip = opts.flip ?? false;
  const fw = Math.max(0.01, opts.frame ?? DEFAULT_FRAME);
  const state: DoorState = opts.state ?? "open";
  const nh = mul(n, t / 2);
  const side = mul(n, flip ? -1 : 1);

  // 문틀(창틀) 블록 — 개구부 양끝 바깥으로 두께 fw, 벽 두께 전체를 가로지름
  const fills: FillPart[] = [
    { pts: rect(sub(s, mul(dir, fw)), dir, fw, t), role: "frame" },
    { pts: rect(e, dir, fw, t), role: "frame" },
  ];

  // 문틀 안쪽 면(개구부 경계) 라인
  const jambs = [
    [add(s, nh), sub(s, nh)],
    [add(e, nh), sub(e, nh)],
  ];
  const parts: SymbolPart[] = [];

  const faceLines = () => {
    parts.push({ pts: [add(s, nh), add(e, nh)], weight: 1 });
    parts.push({ pts: [sub(s, nh), sub(e, nh)], weight: 1 });
  };

  /** 힌지에서 열림 상태에 따라 문짝(사각형) + 스윙 아크 생성 */
  const leaf = (hinge: Point, closedEnd: Point, leafLen: number) => {
    const u = normalize(sub(closedEnd, hinge));
    const a = stateAngle(state);
    const sv = normalize(side);
    const v = {
      x: u.x * Math.cos(a) + sv.x * Math.sin(a),
      y: u.y * Math.cos(a) + sv.y * Math.sin(a),
    };
    const lt = Math.max(0.03, fw * 0.7);
    const end = add(hinge, mul(v, leafLen));
    fills.push({ pts: rect(hinge, v, leafLen, lt), role: "leaf" });
    if (state !== "closed") {
      parts.push({ pts: arcPts(hinge, end, add(hinge, mul(u, leafLen))), weight: 1, dashed: true });
    }
  };

  if (kind === "door-single") {
    const hinge = flip ? e : s;
    const other = flip ? s : e;
    leaf(hinge, other, width);
  } else if (kind === "door-double") {
    const half = width / 2;
    leaf(s, center, half);
    leaf(e, center, half);
  } else if (kind === "door-sliding") {
    const pt = Math.max(t * 0.28, 0.03);
    const off = mul(side, t * 0.22);
    fills.push({ pts: rect(add(s, off), dir, width, pt), role: "leaf" });
    // 레일(트랙)
    parts.push({ pts: [s, e], weight: 1, dashed: true });
  } else if (kind === "opening") {
    // 깨끗한 개구부 — 문틀만
  } else if (kind === "window-single") {
    faceLines();
    parts.push({ pts: [s, e], weight: 1.25 });
  } else if (kind === "window-double") {
    faceLines();
    const g = mul(n, t / 6);
    parts.push({ pts: [add(s, g), add(e, g)], weight: 1.25 });
    parts.push({ pts: [sub(s, g), sub(e, g)], weight: 1.25 });
  } else if (kind === "window-sliding") {
    faceLines();
    const g = mul(n, t / 5);
    const ov = mul(dir, width * 0.06);
    parts.push({ pts: [add(s, g), add(add(center, ov), g)], weight: 1.5 });
    parts.push({ pts: [sub(sub(center, ov), g), sub(e, g)], weight: 1.5 });
  }

  return { jambs, parts, fills };
}
