/** 도면(2D CAD) 데이터 모델 */

export interface Point {
  x: number;
  y: number;
}

export type ToolId =
  | "select"
  | "wall"
  | "rect"
  | "door"
  | "zone"
  | "divider"
  | "line"
  | "dimension"
  | "pan";

/** 층(Story) — ArchiCAD의 Story 개념 */
export interface Story {
  id: string;
  /** 예: "1층", "지하 1층" */
  name: string;
  /** 바닥 레벨 (m) */
  elevation: number;
  /** 층고 (m) */
  height: number;
}

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  /** 벽 두께 (m) */
  thickness: number;
  /** 작도선 기준(피봇) — left/right = 모서리, center = 중심 */
  align?: "left" | "right" | "center";
  /** 소속 층 */
  storyId?: string;
}

/** 창호(문/창) 종류 */
export type OpeningKind =
  | "door-single" // 외여닫이문
  | "door-double" // 쌍여닫이문
  | "door-sliding" // 미닫이문
  | "opening" // 개구부(문짝 없음)
  | "window-single" // 단창
  | "window-double" // 이중창
  | "window-sliding"; // 미서기창

/** 문 개폐 상태 */
export type DoorState = "open" | "ajar" | "closed";

/** 벽에 호스팅되는 파라메트릭 창호 */
export interface Opening {
  id: string;
  kind: OpeningKind;
  /** 호스트 벽 */
  wallId: string;
  /** 벽 시작점(a)에서 개구부 중심까지 거리 (m) */
  offset: number;
  /** 개구부 폭 (m) */
  width: number;
  /** 높이 (m) */
  height?: number;
  /** 창 하단 높이 (m) */
  sill?: number;
  /** 문틀(창틀) 두께 (m) */
  frame?: number;
  /** 문 개폐 상태 */
  state?: DoorState;
  /** 좌우/개폐 방향 반전 */
  flip: boolean;
}

/** 레거시 문 모델 (불러오기 마이그레이션용) */
export interface Door {
  id: string;
  wallId: string;
  offset: number;
  width: number;
  flip: boolean;
}

export interface LineShape {
  id: string;
  a: Point;
  b: Point;
}

export interface DimensionShape {
  id: string;
  a: Point;
  b: Point;
}


/** 존(영역) — 폴리곤으로 정의되는 공간 */
export interface Zone {
  id: string;
  name: string;
  points: Point[];
  /** Semantic floor use. Corridors remain floor zones and never become walls. */
  kind?: "room" | "corridor";
  /** 소속 층 */
  storyId?: string;
}

/** 존 나누기 — 존을 분할하는 가상 경계선 */
export interface ZoneDivider {
  id: string;
  a: Point;
  b: Point;
}

export interface PlanDocument {
  name: string;
  walls: Wall[];
  openings: Opening[];
  zones: Zone[];
  dividers: ZoneDivider[];
  lines: LineShape[];
  dimensions: DimensionShape[];
  /** 층 목록 (레거시 문서에는 없을 수 있음) */
  stories?: Story[];
  /** AI 스케치에서 그린 대지 경계 (표시 전용, 스냅/선택 대상 아님) */
  siteBoundary?: Point[];
}

/** 저장된 문서(레거시 doors 포함) */
export type StoredPlanDocument = Partial<Omit<PlanDocument, "name">> & {
  name?: string;
  doors?: Door[];
};

export interface CanvasSettings {
  showGrid: boolean;
  showAxis: boolean;
  /** 스냅 간격 (m) */
  snap: number;
  /** 기본 벽 두께 (m) */
  wallThickness: number;
  /** 기본 문 폭 (m) */
  doorWidth: number;
}

export type Selection =
  | { kind: "wall"; id: string }
  | { kind: "opening"; id: string }
  | { kind: "zone"; id: string }
  | { kind: "divider"; id: string }
  | { kind: "line"; id: string }
  | { kind: "dimension"; id: string }
  | null;

export interface ViewTransform {
  /** 픽셀 / 미터 */
  scale: number;
  /** 화면 원점 오프셋 (px) */
  ox: number;
  oy: number;
}

export const DEFAULT_STORY_HEIGHT = 2.7;

export const defaultStories = (): Story[] => [
  { id: "story-1", name: "1층", elevation: 0, height: DEFAULT_STORY_HEIGHT },
];

export const emptyDocument = (): PlanDocument => ({
  name: "New Model",
  walls: [],
  openings: [],
  zones: [],
  dividers: [],
  lines: [],
  dimensions: [],
  stories: defaultStories(),
});


export const defaultSettings = (): CanvasSettings => ({
  showGrid: true,
  showAxis: true,
  snap: 0.1,
  wallThickness: 0.2,
  doorWidth: 0.8,
});
