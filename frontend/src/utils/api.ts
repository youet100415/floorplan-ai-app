/** 백엔드 API 통신 함수. */

import { densifyClosedPath, densifyPath, pathPoints } from "./path";
import type { ProjectDoc, ProjectSummary, StoredProject } from "./project";
import type {
  CorridorPath,
  ExploreResult,
  GenerateParams,
  PathVertex,
  Plan,
  Pt,
  UnitTypeSpec,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

/** 응답 본문에서 사람이 읽을 오류 문구를 뽑는다. */
async function errorDetail(res: Response): Promise<string> {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const j = await res.json();
    if (typeof j.detail === "string") detail = j.detail;
    else if (Array.isArray(j.detail)) detail = j.detail.map((d: { msg: string }) => d.msg).join(", ");
  } catch {
    /* 본문이 JSON이 아니면 상태 문자열을 그대로 쓴다 */
  }
  return detail;
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json() as Promise<T>;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return send<T>("POST", path, body);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await errorDetail(res));
  return res.json() as Promise<T>;
}

export interface Presets {
  boundaries: { name: string; coords: Pt[] }[];
  unit_mix: UnitTypeSpec[];
}

export async function fetchPresets(): Promise<Presets> {
  const res = await fetch(`${BASE}/api/presets`);
  if (!res.ok) throw new Error("프리셋을 불러오지 못했습니다.");
  return res.json();
}

/** 프론트 경로 → 백엔드 점열 (곡선 densify). */
function payloadFromParams(params: GenerateParams) {
  const boundaryPts = densifyClosedPath(params.boundary, 24);
  const corridors =
    params.corridors && params.corridors.length > 0
      ? params.corridors.map((c) => ({
          id: c.id,
          centerline: densifyPath(c.vertices, 24),
          strategy: c.strategy,
        }))
      : null;

  return {
    boundary: boundaryPts,
    unit_mix: params.unit_mix,
    corridor: null as Pt[] | null,
    corridors,
    corridor_width: params.corridor_width,
    corridor_end_inset: params.corridor_end_inset,
    strategy: params.strategy,
    cores: params.cores
      ? params.cores.map((c) => ({
          id: c.id,
          anchor: c.anchor,
          length: c.length,
          reach: c.reach,
          outline: c.outline && c.outline.length >= 3 ? c.outline : null,
        }))
      : null,
    core_count: params.core_count,
    core_length: params.core_length,
    core_reach: params.core_reach,
    max_travel_distance: params.max_travel_distance,
    min_facade_width: params.min_facade_width,
    unit_count_target: params.unit_count_target,
    wall_thickness_external: params.wall_thickness_external,
    wall_thickness_internal: params.wall_thickness_internal,
    seed: params.seed,
  };
}

export function generatePlan(params: GenerateParams): Promise<Plan> {
  return post<Plan>("/api/generate", payloadFromParams(params));
}

export function explorePlans(params: GenerateParams, variants: number): Promise<ExploreResult> {
  return post<ExploreResult>("/api/explore", { ...payloadFromParams(params), variants });
}

// -------------------------------------------------------- 세대 후편집(revise)

/** 편집 후 살아남는 세대 하나. 삭제는 이 목록에서 빼는 것으로 표현한다. */
export interface ReviseUnitEdit {
  id: string;
  type: string;
  polygon: Pt[];
}

/** 합칠 세대 id 목록. type 을 생략하면 첫 세대의 타입을 따른다. */
export interface MergeGroup {
  ids: string[];
  type?: string | null;
}

/**
 * 생성된 평면을 후편집(삭제·합침·벽 이동)한 뒤 서버에서 동선·법규를 다시
 * 계산한다. plan 은 편집의 바탕이 된 그 결과여야 한다 — boundary·복도·코어는
 * 거기서 그대로 가져오고, units/merges 만 이번 편집을 반영한다.
 */
export function revisePlan(
  plan: Plan,
  unitMix: UnitTypeSpec[],
  params: Pick<
    GenerateParams,
    "max_travel_distance" | "min_facade_width" | "wall_thickness_external" | "wall_thickness_internal"
  >,
  units: ReviseUnitEdit[],
  merges: MergeGroup[] = [],
): Promise<Plan> {
  return post<Plan>("/api/revise", {
    boundary: plan.boundary,
    corridor_centerlines:
      plan.corridor.centerlines && plan.corridor.centerlines.length > 0
        ? plan.corridor.centerlines
        : [plan.corridor.centerline],
    corridor_width: plan.corridor.width,
    cores: plan.cores.map((c) => ({ id: c.id, polygon: c.polygon })),
    cores_manual: plan.core_placement.manual,
    units,
    merges,
    unit_mix: unitMix,
    max_travel_distance: params.max_travel_distance,
    min_facade_width: params.min_facade_width,
    wall_thickness_external: params.wall_thickness_external,
    wall_thickness_internal: params.wall_thickness_internal,
  });
}

export const API_BASE = BASE;

// ---------------------------------------------------------- 프로젝트 저장

export function listProjects(): Promise<{ projects: ProjectSummary[] }> {
  return get<{ projects: ProjectSummary[] }>("/api/projects");
}

export function loadProject(id: string): Promise<StoredProject> {
  return get<StoredProject>(`/api/projects/${encodeURIComponent(id)}`);
}

export function createProject(name: string, doc: ProjectDoc): Promise<StoredProject> {
  return post<StoredProject>("/api/projects", { name, doc });
}

export function saveProject(id: string, name: string, doc: ProjectDoc): Promise<StoredProject> {
  return send<StoredProject>("PUT", `/api/projects/${encodeURIComponent(id)}`, { name, doc });
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(await errorDetail(res));
}

/** 표시용: 경로 densify 헬퍼 */
export function densifyCorridor(c: CorridorPath): Pt[] {
  return densifyPath(c.vertices, 24);
}

export function densifyBoundary(verts: PathVertex[]): Pt[] {
  return densifyClosedPath(verts, 24);
}

export function boundaryAsPts(verts: PathVertex[]): Pt[] {
  return pathPoints(verts);
}
