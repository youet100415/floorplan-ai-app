/** 백엔드 /api/generate 응답 스키마 (backend/core/generator.py 와 1:1 대응). */

export type Pt = [number, number];

/**
 * 작도 경로 정점.
 * - corner: 모서리(직선 연결)
 * - curve: 양옆 모서리와 함께 3점 원호의 중간점 (도면 곡선)
 */
export type VertexRole = "corner" | "curve";

export interface PathVertex {
  p: Pt;
  role: VertexRole;
}

/** 추적 도면 밑깔기 — 나중에 스캔/PDF 도면 위에 그릴 때 사용. */
export interface Underlay {
  /** data URL 또는 blob URL */
  src: string;
  /** 월드 좌표 왼쪽 아래(m) */
  origin: Pt;
  /** 이미지 가로 실측(m) */
  widthM: number;
  /** 이미지 세로 실측(m). null 이면 원본 비율 유지 */
  heightM: number | null;
  aspectRatio?: number;
  lockAspectRatio?: boolean;
  opacity: number;
  visible: boolean;
  locked: boolean;
}

export interface UnitTypeSpec {
  name: string;
  target_area: number;
  ratio: number;
  min_width: number;
}

export interface Unit {
  id: string;
  type: string;
  type_index: number;
  polygon: Pt[];
  label_at: Pt;
  area: number;
  target_area: number;
  area_error: number;
  aspect_ratio: number;
  facade_length: number;
  facade_ratio: number;
  accessible: boolean;
  door_width: number;
  door_point: Pt | null;
  travel_distance: number | null;
  nearest_core: string | null;
}

export interface Core {
  id: string;
  polygon: Pt[];
  area: number;
  /** 편집 핸들이 붙을 코어 중심점. */
  anchor: Pt;
}

export interface CorePlacement {
  manual: boolean;
  requested: number;
  placed: number;
  /** 건물 밖이라 무시된 코어 수. */
  dropped: number;
}

export interface Corridor {
  centerline: Pt[];
  /** 다중 중심선(중복도+편복도 등). 없으면 centerline 한 줄만 사용. */
  centerlines?: Pt[][];
  polygons: Pt[][];
  width: number;
  length: number;
}

export interface Leftover {
  polygon: Pt[];
  area: number;
  /** unassigned: 편집(삭제 등)으로 비워진 자리 — /api/revise 에서만 나온다. */
  reason: "too_small" | "no_access" | "unassigned";
}

export interface GraphNode {
  id: string;
  kind: "corridor" | "core" | "unit";
  x: number;
  y: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: "corridor" | "access" | "door";
  weight: number;
}

export interface MixRow {
  type: string;
  target_ratio: number;
  actual_ratio: number;
  ratio_error: number;
  count: number;
  area: number;
  target_area: number;
  avg_area: number;
}

export interface Metrics {
  gross_area: number;
  net_unit_area: number;
  corridor_area: number;
  core_area: number;
  leftover_area: number;
  unreachable_area: number;
  efficiency: number;
  unit_count: number;
  accessible_count: number;
  connected_count: number;
  max_travel_distance: number | null;
  avg_travel_distance: number | null;
  dead_end_length: number;
  mean_area_error_pct: number;
  mix: MixRow[];
}

export interface Check {
  code: string;
  level: "pass" | "warn" | "fail";
  message: string;
}

export interface PlanParams {
  core_count: number | null;
  corridor_end_inset: number;
  corridor_width: number;
  /** 요청한 목표 세대수. null 이면 면적 기준 자동 산정. */
  unit_count_target: number | null;
  seed: number;
}

export interface Plan {
  boundary: Pt[];
  corridor: Corridor;
  cores: Core[];
  core_placement: CorePlacement;
  units: Unit[];
  leftovers: Leftover[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  metrics: Metrics;
  compliance: Check[];
  score: number;
  params: PlanParams;
}

export interface ExploreResult {
  count: number;
  best: PlanParams;
  options: Plan[];
}

/** 복도 전략 — 경로마다 따로 둘 수 있다 (중복도 + 편복도 중첩). */
export type CorridorStrategy = "double_loaded" | "single_loaded";

/** 수동 지정 복도 중심선 한 줄. strategy 는 그릴 때 선택한 모드. */
export interface CorridorPath {
  id: string;
  /** 직선/곡선 정점. API 전송 시 densify 됨. */
  vertices: PathVertex[];
  strategy: CorridorStrategy;
}

/** 생성 요청 파라미터 (UI 상태). 백엔드 전송 시 곡선은 점열로 densify. */
export interface GenerateParams {
  /** 외곽선 정점(곡선 포함). */
  boundary: PathVertex[];
  unit_mix: UnitTypeSpec[];
  /**
   * 수동 복도 경로들. null/빈 배열이면 자동 배치.
   * 여러 줄이면 중복도·편복도를 겹쳐 둘 수 있다.
   */
  corridors: CorridorPath[] | null;
  corridor_width: number;
  corridor_end_inset: number;
  /** 다음 작도/자동 배치에 쓸 기본 전략. */
  strategy: CorridorStrategy;
  /**
   * 수동 코어. null 이면 자동 배치.
   * 앵커+크기 사각형, 또는 outline 자유 외곽.
   */
  cores: CoreSpec[] | null;
  core_count: number | null;
  /** 기본 코어 길이(복도 축 방향, m) — 개별 length 없을 때 */
  core_length: number;
  /** 기본 코어 깊이(복도 양옆, m) — 개별 reach 없을 때 */
  core_reach: number;
  max_travel_distance: number;
  min_facade_width: number;
  /**
   * 목표 총 세대수. null 이면 면적 기준으로 자동 산정한다.
   * 최소 세대폭이 상한, 구획 조각 수가 하한이라 목표에 못 미칠 수 있고
   * 그때는 결과의 UNIT_COUNT 검토항목이 이유를 알려준다.
   */
  unit_count_target: number | null;
  wall_thickness_external: number;
  wall_thickness_internal: number;
  seed: number;
}

/** 수동 배치 코어 하나. */
export interface CoreSpec {
  id: string;
  /** 복도 위 앵커 (외곽선만 있을 때는 중심) */
  anchor: Pt;
  /** 복도 축 방향 길이 m */
  length: number;
  /** 복도 수직 방향 한쪽 깊이 m (양옆 동일) */
  reach: number;
  /** 자유 외곽선(≥3점). 있으면 사각형 대신 사용 */
  outline: Pt[] | null;
}

// ------------------------------------------------------------------ 2단계: 내부 평면 · 라이브러리 · 분석

export type DoorType = "swing_left" | "swing_right" | "sliding" | "pocket";
export type DoorCategory = "entrance" | "bathroom" | "bedroom" | "other";
export type RoomKind =
  | "living"
  | "dining"
  | "bedroom"
  | "kitchen"
  | "bathroom"
  | "hallway"
  | "storage"
  | "other";

/** 2단계 내부 작도 도구 */
export type InteriorTool = "select" | "room" | "door" | "furniture";

export interface Door {
  id: string;
  unitId: string;
  category: DoorCategory;
  position: Pt;
  width: number;
  type: DoorType;
  /** 문 방향(라디안). 생략 시 자동 */
  angle?: number;
}

export interface Room {
  id: string;
  name: string;
  kind: RoomKind;
  polygon: Pt[];
}

/** 가구·공용 오브젝트 (영상 Public Objects 대응) */
export interface FurnItem {
  id: string;
  name: string;
  /** catalog id */
  catalogId: string;
  /** 중심 월드 좌표 */
  at: Pt;
  width: number;
  depth: number;
  rotation: number;
}

export interface Zone {
  id: string;
  label: string;
  category: "gfa" | "apartment" | "room";
  polygon: Pt[];
  color: string;
}

export interface EgressPath {
  startPoint: Pt;
  exitPoint: Pt;
  waypoints?: Pt[];
  distanceMeters: number;
}

export interface UnitScore {
  total: number;
  compliance: number;
  adaptivity: number;
  daylight: number;
  checks: { code: string; level: "pass" | "warn" | "fail"; message: string }[];
}

/** 라이브러리 유닛 상태 (명세: draft / valid / published / archived) */
export type UnitLibraryStatus = "draft" | "valid" | "published" | "archived";

export interface UnitValidationIssue {
  code: string;
  level: "error" | "warning";
  message: string;
}

export interface UnitValidation {
  is_valid: boolean;
  /** 배치 가능 여부 — 치명 오류 없으면 true */
  placeable: boolean;
  errors: UnitValidationIssue[];
  warnings: UnitValidationIssue[];
  validated_at: string;
}

export interface ConnectionPoint {
  connection_id: string;
  type: "door" | "corridor" | "service";
  /** 로컬 좌표 (템플릿) 또는 월드 (인스턴스) */
  at: Pt;
  wall_id?: string;
  offset?: number;
  direction?: "inward" | "outward";
  category?: DoorCategory;
}

export interface PlacementConstraints {
  zone_categories: string[];
  min_zone_area_sqm?: number;
  requires_exterior_contact?: boolean;
}

/** 프로젝트에 배치된 인스턴스 변환 정보 */
export interface ProjectInstanceMeta {
  instance_id: string;
  source_unit_id: string;
  library_version: number;
  rotation_deg: number;
  mirrored: boolean;
  scale: number;
  placed_at: string;
}

/** 유닛에 적용된 내부 평면(월드 좌표) — 프로젝트 인스턴스. */
export interface UnitInterior {
  unitId: string;
  templateId: string | null;
  /** 라이브러리 원본 ID (복제본 편집 시 원본 불변) */
  source_unit_id?: string | null;
  linkedGroupId?: string;
  rooms: Room[];
  doors: Door[];
  furniture?: FurnItem[];
  zones?: Zone[];
  egressPath?: EgressPath;
  edges?: number;
  areaM2?: number;
  score?: UnitScore;
  connection_points?: ConnectionPoint[];
  project_instance?: ProjectInstanceMeta;
  /** 사용자가 직접 작도한 데이터면 true (라이브러리 후보) */
  handAuthored?: boolean;
}

/** 라이브러리 템플릿 — 재사용 원본 (명세 Unit Library). */
export interface UnitTemplate {
  schema_version: string;
  /** 측정 단위 — 앱 내부 기본 m */
  unit: "m" | "mm";
  id: string;
  name: string;
  /** 대상 유닛 타입 힌트 (1BR, 2BR, bedroom…) */
  unitTypeHint?: string;
  version: number;
  library_version: number;
  status: UnitLibraryStatus;
  coordinate_system: string;
  /** 로컬 좌표계 가로·세로 (m). rooms/doors 는 이 박스 안. */
  bbox: { w: number; d: number };
  anchor_point: { type: "bottom_left" | "center"; x: number; y: number };
  entry: { side: "south" | "north" | "east" | "west"; offset: number; width: number };
  rooms: { id: string; name: string; kind: RoomKind; polygon: Pt[] }[];
  doors: {
    id: string;
    category: DoorCategory;
    type: DoorType;
    width: number;
    at: Pt;
  }[];
  connection_points?: ConnectionPoint[];
  placement_constraints?: PlacementConstraints;
  /** 유닛 분류 및 추천 메타데이터 (AI 학습과 구분) */
  classification?: {
    tags: string[];
    room_kinds: RoomKind[];
    object_summary: string[];
  };
  validation?: UnitValidation;
  created_at?: string;
  updated_at?: string;
}

export interface PopulationPoint {
  id: string;
  areaM2: number;
  edges: number;
  type?: string;
}
