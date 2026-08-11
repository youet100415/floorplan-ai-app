/** 프로젝트 문서 — 저장 형식과 그 검증.
 *
 * 파일·localStorage·서버 어디서 오든 내용은 신뢰할 수 없다(손으로 고친 JSON,
 * 예전 버전, 다른 앱이 쓴 값). 그래서 불러온 값은 반드시 normalizeDoc 을
 * 거치게 하고, 모르는 필드는 버리고 빠진 필드는 기본값으로 채운다.
 * 이 파일이 앱을 지키는 유일한 관문이므로 여기서 통과한 값은 항상 안전하다.
 */

import type {
  CoreSpec,
  CorridorPath,
  CorridorStrategy,
  GenerateParams,
  PathVertex,
  Pt,
  Underlay,
  UnitTypeSpec,
  VertexRole,
} from "./types";

/** 저장 형식 버전. 구조를 바꾸면 올리고 migrate 에 분기를 추가한다. */
export const DOC_VERSION = 1;

export interface ProjectDoc {
  version: number;
  name: string;
  savedAt: string;
  params: GenerateParams;
  underlay: Underlay | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  boundary_points: number;
  corridor_count: number;
  core_count: number;
}

export interface StoredProject {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  doc: unknown;
}

// ------------------------------------------------------------------ 원시 검증

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 범위를 벗어난 값은 잘라낸다 — 슬라이더가 표시할 수 없는 값이 들어오면 UI가 깨진다. */
function clamped(v: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num(v, fallback)));
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function pt(v: unknown): Pt | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [x, y] = v;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function ptList(v: unknown): Pt[] {
  if (!Array.isArray(v)) return [];
  return v.map(pt).filter((p): p is Pt => p !== null);
}

function role(v: unknown): VertexRole {
  return v === "curve" ? "curve" : "corner";
}

function vertex(v: unknown): PathVertex | null {
  if (!isObj(v)) {
    // 예전 형식: 정점이 좌표 배열이던 시절
    const p = pt(v);
    return p ? { p, role: "corner" } : null;
  }
  const p = pt(v.p);
  return p ? { p, role: role(v.role) } : null;
}

function vertexList(v: unknown): PathVertex[] {
  if (!Array.isArray(v)) return [];
  return v.map(vertex).filter((x): x is PathVertex => x !== null);
}

function strategy(v: unknown): CorridorStrategy {
  return v === "single_loaded" ? "single_loaded" : "double_loaded";
}

// ------------------------------------------------------------------ 기본값

export const DEFAULT_UNIT_MIX: UnitTypeSpec[] = [
  { name: "1BR", target_area: 45, ratio: 0.3, min_width: 3.6 },
  { name: "2BR", target_area: 66, ratio: 0.4, min_width: 4.5 },
  { name: "3BR", target_area: 84, ratio: 0.3, min_width: 5.4 },
];

export const DEFAULT_BOUNDARY: PathVertex[] = (
  [
    [0, 0],
    [60, 0],
    [60, 22],
    [0, 22],
  ] as Pt[]
).map((p) => ({ p, role: "corner" as VertexRole }));

export function defaultParams(): GenerateParams {
  return {
    boundary: DEFAULT_BOUNDARY.map((v) => ({ p: [...v.p] as Pt, role: v.role })),
    unit_mix: DEFAULT_UNIT_MIX.map((u) => ({ ...u })),
    corridors: null,
    corridor_width: 1.8,
    corridor_end_inset: 0,
    strategy: "double_loaded",
    cores: null,
    core_count: null,
    core_length: 6,
    core_reach: 6,
    max_travel_distance: 40,
    min_facade_width: 2.4,
    unit_count_target: null,
    wall_thickness_external: 0.25,
    wall_thickness_internal: 0.2,
    seed: 0,
  };
}

// ------------------------------------------------------------------ 정규화

function normalizeUnitMix(v: unknown): UnitTypeSpec[] {
  if (!Array.isArray(v)) return DEFAULT_UNIT_MIX.map((u) => ({ ...u }));
  const out = v.filter(isObj).map((u, i) => ({
    name: str(u.name, `Type${i + 1}`),
    target_area: clamped(u.target_area, 60, 5, 1000),
    ratio: clamped(u.ratio, 0.25, 0, 1),
    min_width: clamped(u.min_width, 3, 0.5, 50),
  }));
  // 타입이 하나도 없으면 생성 자체가 불가능하므로 기본 믹스로 되돌린다.
  return out.length > 0 ? out : DEFAULT_UNIT_MIX.map((u) => ({ ...u }));
}

function normalizeCorridors(v: unknown): CorridorPath[] | null {
  if (!Array.isArray(v)) return null;
  const out: CorridorPath[] = [];
  v.forEach((c, i) => {
    if (!isObj(c)) return;
    const vertices = vertexList(c.vertices);
    if (vertices.length < 2) return; // 2점 미만은 복도가 아니다
    out.push({
      id: str(c.id, `c-restored-${i}`),
      vertices,
      strategy: strategy(c.strategy),
    });
  });
  return out.length > 0 ? out : null;
}

function normalizeCores(v: unknown, fallbackLen: number, fallbackReach: number): CoreSpec[] | null {
  if (!Array.isArray(v)) return null;
  const out: CoreSpec[] = [];
  v.forEach((c, i) => {
    if (!isObj(c)) {
      // 예전 형식: 코어가 좌표 배열이던 시절
      const p = pt(c);
      if (p) {
        out.push({
          id: `core-restored-${i}`,
          anchor: p,
          length: fallbackLen,
          reach: fallbackReach,
          outline: null,
        });
      }
      return;
    }
    const anchor = pt(c.anchor);
    const outline = ptList(c.outline);
    // 앵커가 없어도 외곽선이 있으면 그 중심을 앵커로 쓴다.
    const center: Pt | null =
      anchor ??
      (outline.length >= 3
        ? [
            outline.reduce((s, p) => s + p[0], 0) / outline.length,
            outline.reduce((s, p) => s + p[1], 0) / outline.length,
          ]
        : null);
    if (!center) return;
    out.push({
      id: str(c.id, `core-restored-${i}`),
      anchor: center,
      length: clamped(c.length, fallbackLen, 0.5, 200),
      reach: clamped(c.reach, fallbackReach, 0.5, 200),
      outline: outline.length >= 3 ? outline : null,
    });
  });
  return out.length > 0 ? out : null;
}

function normalizeUnderlay(v: unknown): Underlay | null {
  if (!isObj(v)) return null;
  const origin = pt(v.origin) ?? [0, 0];
  const src = typeof v.src === "string" ? v.src : "";
  if (!src) return null; // 이미지가 없으면 밑그림이 성립하지 않는다
  return {
    src,
    origin,
    widthM: clamped(v.widthM, 60, 0.1, 100000),
    heightM: v.heightM === null ? null : clamped(v.heightM, 40, 0.1, 100000),
    opacity: clamped(v.opacity, 0.5, 0, 1),
    visible: v.visible !== false,
    locked: v.locked === true,
  };
}

export function normalizeParams(v: unknown): GenerateParams {
  const d = defaultParams();
  if (!isObj(v)) return d;

  const coreLength = clamped(v.core_length, d.core_length, 0.5, 200);
  const coreReach = clamped(v.core_reach, d.core_reach, 0.5, 200);
  const boundary = vertexList(v.boundary);

  return {
    // 3점 미만이면 폴리곤이 아니다 — 기본 외곽선으로 되돌린다.
    boundary: boundary.length >= 3 ? boundary : d.boundary,
    unit_mix: normalizeUnitMix(v.unit_mix),
    corridors: normalizeCorridors(v.corridors),
    corridor_width: clamped(v.corridor_width, d.corridor_width, 0.6, 20),
    corridor_end_inset: clamped(v.corridor_end_inset, 0, 0, 200),
    strategy: strategy(v.strategy),
    cores: normalizeCores(v.cores, coreLength, coreReach),
    core_count:
      v.core_count === null || v.core_count === undefined
        ? null
        : Math.round(clamped(v.core_count, 1, 1, 12)),
    core_length: coreLength,
    core_reach: coreReach,
    max_travel_distance: clamped(v.max_travel_distance, d.max_travel_distance, 1, 500),
    min_facade_width: clamped(v.min_facade_width, d.min_facade_width, 0, 100),
    // 백엔드가 받는 상한(400)을 넘으면 422 로 튕기므로 여기서 잘라둔다.
    unit_count_target:
      v.unit_count_target === null || v.unit_count_target === undefined
        ? null
        : Math.round(clamped(v.unit_count_target, 1, 1, 400)),
    wall_thickness_external: clamped(v.wall_thickness_external, d.wall_thickness_external, 0, 5),
    wall_thickness_internal: clamped(v.wall_thickness_internal, d.wall_thickness_internal, 0, 5),
    seed: Math.round(num(v.seed, 0)),
  };
}

/** 어떤 출처의 값이든 안전한 문서로 만든다. 실패하지 않는다. */
export function normalizeDoc(v: unknown, fallbackName = "제목 없음"): ProjectDoc {
  const d = isObj(v) ? v : {};
  return {
    version: DOC_VERSION,
    name: str(d.name, fallbackName),
    savedAt: str(d.savedAt, new Date().toISOString()),
    params: normalizeParams(d.params),
    underlay: normalizeUnderlay(d.underlay),
  };
}

export function makeDoc(
  name: string,
  params: GenerateParams,
  underlay: Underlay | null,
): ProjectDoc {
  return {
    version: DOC_VERSION,
    name: name.trim() || "제목 없음",
    savedAt: new Date().toISOString(),
    params,
    underlay,
  };
}

/** 파일 이름으로 쓸 수 있게 다듬는다. */
export function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
  return cleaned || "floorplan";
}
