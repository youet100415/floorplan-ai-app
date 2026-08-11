"use client";

/** 2D 평면도 및 동선 렌더링 Canvas 컴포넌트.
 *
 * 좌표계: 월드는 미터(m), y축 위쪽이 +. 화면은 픽셀, y축 아래쪽이 +.
 * 모든 그리기는 worldToScreen 을 거치고, 선 두께/글자 크기는 화면 기준으로
 * 고정해 확대해도 도면이 두꺼워지지 않게 한다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HANDLE_PX,
  type MidpointHit,
  type Ring,
  type RingKind,
  type VertexRef,
  type View,
  constrainPoint,
  coreRectangle,
  edgeLength,
  geometryDirty as isGeometryDirty,
  hitEdgeMidpoint,
  hitVertex,
  midpointsNear,
  outwardNormalOf,
  pointInPolygon,
  polygonArea,
  projectOntoPolyline,
  projectOntoPolylines,
  selfIntersects,
  snapKind,
  tangentOnPolyline,
  toScreen as project,
  toWorld as unproject,
} from "@/utils/geom";
import {
  densifyClosedPath,
  densifyPath,
  insertPathVertex,
  movePathVertex,
  pathPoints,
  toggleVertexRole,
} from "@/utils/path";
import { CHROME, type Mode, STATUS, rampColor, seriesColor, withAlpha } from "@/utils/palette";
import {
  clampWallShift,
  findSharedWalls,
  hitWall,
  moveWall,
  wallNormal,
  type SharedWall,
} from "@/utils/unitEdit";
import type {
  CoreSpec,
  CorridorPath,
  PathVertex,
  Plan,
  Pt,
  Underlay,
  Unit,
  UnitInterior,
  VertexRole,
} from "@/utils/types";

/** coreOutline: 코어 외곽을 사각형 대신 자유 폴리곤으로 직접 그린다. */
export type EditMode = "view" | "boundary" | "corridor" | "core" | "coreOutline";

export interface Overlays {
  labels: boolean;
  dims: boolean;
  graph: boolean;
  travel: boolean;
  doors: boolean;
  grid: boolean;
  /** 도면 밑깔기 표시 */
  underlay: boolean;
  /** 내부 실·문 표시 */
  interiors: boolean;
  /** GFA / 세대 / 방 존 오버레이 */
  zones: boolean;
  /** 유닛 내부 피난 직선 */
  egress: boolean;
}

interface Props {
  plan: Plan | null;
  mode: Mode;
  editMode: EditMode;
  draft: PathVertex[];
  /** 다음에 찍을 점 역할 (corner | curve). */
  nextRole: VertexRole;
  onDraftChange: (pts: PathVertex[]) => void;
  onCommitDraw: () => void;
  onCancelDraw: () => void;
  inputBoundary: PathVertex[];
  inputCorridors: CorridorPath[] | null;
  inputCores: CoreSpec[] | null;
  corridorWidth: number;
  /** 새 코어를 찍을 때 쓸 기본 크기. */
  defaultCoreLength: number;
  defaultCoreReach: number;
  staleParams: boolean;
  onEditGeometry: (
    kind: "boundary" | "corridor",
    data: PathVertex[],
    pathId?: string,
  ) => void;
  /** 코어 목록 갱신 (추가·이동·삭제·크기변경). */
  onEditCores: (cores: CoreSpec[]) => void;
  /** 크기 편집 대상으로 선택된 코어. */
  selectedCoreId: string | null;
  onSelectCore: (id: string | null) => void;
  underlay: Underlay | null;
  onUnderlay: (u: Underlay | null) => void;
  overlays: Overlays;
  selectedId: string | null;
  /** additive=true(Shift+클릭) 면 다중 선택 목록에 토글, 아니면 단독 선택으로 교체. */
  onSelect: (id: string | null, additive?: boolean) => void;
  /** 삭제·합침 대상으로 고른 세대 id 목록 (Shift+클릭으로 누적). */
  selectedUnitIds: string[];
  /** 공유 벽 드래그를 놓았을 때 — 바뀐 두 세대의 새 폴리곤만 넘긴다. */
  onWallMove: (edits: { id: string; polygon: Pt[] }[]) => void;
  /** 유닛별 내부 평면 (2단계). */
  interiors?: Record<string, UnitInterior>;
  /** AI/링크 수정 하이라이트 */
  highlightedUnitIds?: string[];
}

/** 아키캐드 스타일 우클릭 컨텍스트 메뉴 위치 (캔버스 wrap 기준 px). */
type CtxMenu = { x: number; y: number };


/** 화면맞춤 여백. 외곽선 바깥에 치수가 놓이므로 넉넉히 잡는다. */
const PAD = 64;

export default function FloorCanvas({
  plan,
  mode,
  editMode,
  draft,
  nextRole,
  onDraftChange,
  onCommitDraw,
  onCancelDraw,
  inputBoundary,
  inputCorridors,
  inputCores,
  corridorWidth,
  defaultCoreLength,
  defaultCoreReach,
  staleParams,
  onEditGeometry,
  onEditCores,
  selectedCoreId,
  onSelectCore,
  underlay,
  onUnderlay,
  overlays,
  selectedId,
  onSelect,
  selectedUnitIds,
  onWallMove,
  interiors = {},
  highlightedUnitIds = [],
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dragVertex, setDragVertex] = useState<VertexRef | null>(null);
  /** 세대 사이 공유 벽(= 슬라이싱 절단선) 드래그 상태. shift 는 벽의 법선 방향 이동량(m). */
  const [wallDrag, setWallDrag] = useState<{ wall: SharedWall; shift: number } | null>(null);
  const [hoverWall, setHoverWall] = useState<SharedWall | null>(null);
  /** 드래그 시작 시점에 커서가 벽 선분에서 이미 벌어져 있던 여유 — 이동량 계산의 기준. */
  const wallDragOffsetRef = useRef(0);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  /** pan.button: 0=좌, 1=휠(가운데) — 가운데 버튼 팬이 CAD 기본. */
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number; button: number } | null>(null);
  const [panning, setPanning] = useState(false);
  /** 메뉴를 닫은 직후 mouseup 이 점 찍기로 이어지지 않게 막는 플래그. */
  const suppressClickRef = useRef(false);

  /** 확인(OK) 가능 여부 — 외곽선 3점, 복도 2점, 코어는 항상(배치 종료). */
  const canCommit =
    editMode === "core"
      ? true
      : editMode === "boundary" || editMode === "coreOutline"
        ? draft.length >= 3
        : editMode === "corridor"
          ? draft.length >= 2
          : false;

  const draftPts = useMemo(() => pathPoints(draft), [draft]);
  const boundaryDense = useMemo(() => densifyClosedPath(inputBoundary, 24), [inputBoundary]);
  const boundaryCorners = useMemo(() => pathPoints(inputBoundary), [inputBoundary]);

  /** 마지막 점/코어 되돌리기 가능 여부. */
  const canUndoLast =
    editMode === "core"
      ? (inputCores?.length ?? 0) > 0
      : editMode !== "view" && draft.length > 0;

  // 작도 모드가 바뀌면 열린 메뉴는 닫는다.
  useEffect(() => {
    setCtxMenu(null);
  }, [editMode]);

  const menuCommit = useCallback(() => {
    if (!canCommit) return;
    setCtxMenu(null);
    onCommitDraw();
  }, [canCommit, onCommitDraw]);

  const menuCancel = useCallback(() => {
    setCtxMenu(null);
    onCancelDraw();
  }, [onCancelDraw]);

  const menuUndoLast = useCallback(() => {
    if (editMode === "core") {
      const list = inputCores ?? [];
      if (list.length === 0) return;
      onEditCores(list.slice(0, -1));
    } else if (draft.length > 0) {
      onDraftChange(draft.slice(0, -1));
    }
    setCtxMenu(null);
  }, [editMode, inputCores, draft, onEditGeometry, onDraftChange]);

  /** 작도 모드 우클릭 메뉴 열기 (좌표는 클라이언트 픽셀). */
  const openDrawMenu = useCallback(
    (clientX: number, clientY: number) => {
      if (editMode === "view") return;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const mw = 180;
      const mh = 130;
      let x = clientX - rect.left;
      let y = clientY - rect.top;
      if (x + mw > rect.width) x = Math.max(4, rect.width - mw - 4);
      if (y + mh > rect.height) y = Math.max(4, rect.height - mh - 4);
      if (x < 4) x = 4;
      if (y < 4) y = 4;
      setCtxMenu({ x, y });
      panRef.current = null;
    },
    [editMode],
  );

  const chrome = CHROME[mode];

  // 수동 전체보기 대상: 생성 결과 > 확정 외곽선 (작도 중 draft 는 제외 — 뷰 점프 방지)
  const fitTarget = useMemo<Pt[]>(() => {
    if (plan) return plan.boundary;
    if (boundaryDense.length >= 3) return boundaryDense;
    return [[0, 0], [60, 0], [60, 22], [0, 22]];
  }, [plan, boundaryDense]);

  const inputCorridorLines = useMemo(
    () =>
      (inputCorridors ?? [])
        .map((c) => densifyPath(c.vertices, 24))
        .filter((l) => l.length >= 2),
    [inputCorridors],
  );

  const planCorridorLines = useMemo(() => {
    if (!plan) return null;
    if (plan.corridor.centerlines && plan.corridor.centerlines.length > 0) {
      return plan.corridor.centerlines;
    }
    return plan.corridor.centerline.length >= 2 ? [plan.corridor.centerline] : [];
  }, [plan]);

  /** 세대 사이 모든 공유 벽. 인접 쌍마다 하나씩 — 드래그 대상 후보. */
  const sharedWalls = useMemo(() => (plan ? findSharedWalls(plan.units) : []), [plan]);

  /** 벽을 드래그하는 동안 화면에 그릴 세대 폴리곤 — 나머지는 plan 그대로,
   * 드래그 대상 두 세대만 실시간으로 갱신된 모양을 미리 보여준다. */
  const displayPolygons = useMemo(() => {
    if (!plan) return null;
    if (!wallDrag || Math.abs(wallDrag.shift) < 1e-4) return null;
    const moved = moveWall(plan.units, wallDrag.wall, wallDrag.shift);
    if (!moved) return null;
    const map = new Map<string, Pt[]>();
    map.set(wallDrag.wall.a, moved.a);
    map.set(wallDrag.wall.b, moved.b);
    return map;
  }, [plan, wallDrag]);

  const geometryDirty = useMemo(
    () =>
      isGeometryDirty(
        plan?.boundary ?? null,
        planCorridorLines,
        boundaryDense,
        inputCorridorLines.length > 0 ? inputCorridorLines : null,
      ),
    [plan, planCorridorLines, boundaryDense, inputCorridorLines],
  );

  /** 밑깔기 이미지 캐시 */
  const underlayImgRef = useRef<HTMLImageElement | null>(null);
  const [underlayReady, setUnderlayReady] = useState(0);
  useEffect(() => {
    if (!underlay?.src) {
      underlayImgRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      underlayImgRef.current = img;
      setUnderlayReady((n) => n + 1);
    };
    img.onerror = () => {
      underlayImgRef.current = null;
    };
    img.src = underlay.src;
  }, [underlay?.src]);

  // ------------------------------------------------------------ 뷰포트 크기
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback(() => {
    const xs = fitTarget.map((p) => p[0]);
    const ys = fitTarget.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const scale = Math.min((size.w - PAD * 2) / bw, (size.h - PAD * 2) / bh);
    setView({
      scale,
      tx: (size.w - bw * scale) / 2 - minX * scale,
      ty: (size.h + bh * scale) / 2 + minY * scale,
    });
  }, [fitTarget, size]);

  // 오토줌 없음: 최초 1회만 뷰 설정. 이후는 휠/팬·「전체보기」만.
  const didInitView = useRef(false);
  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    if (didInitView.current) return;
    didInitView.current = true;
    fitView();
  }, [size.w, size.h, fitView]);

  // -------------------------------------------------------------- 좌표 변환
  const toScreen = useCallback(
    (p: Pt): [number, number] => (view ? project(view, p) : [0, 0]),
    [view],
  );

  const toWorld = useCallback(
    (sx: number, sy: number): Pt => (view ? unproject(view, sx, sy) : [0, 0]),
    [view],
  );

  const constrain = useCallback(
    (w: Pt, ortho: boolean): Pt =>
      constrainPoint(w, draft.length ? draft[draft.length - 1].p : null, ortho),
    [draft],
  );

  const snapAt = useCallback(
    (w: Pt | null) => snapKind(view, editMode, draftPts, w),
    [view, editMode, draftPts],
  );

  const snap = snapAt(cursor);

  // ------------------------------------------------------------ 꼭짓점 편집
  // 별도 모드 없이 보기 모드에서 상시 가능하다. 핸들에 커서를 올리면 잡힌다.
  const editing = editMode === "view";

  /**
   * 코어가 올라탈 복도 중심선들. 수동 지정 우선, 없으면 결과 중심선.
   */
  const railLines = useMemo<Pt[][]>(() => {
    if (inputCorridorLines.length > 0) return inputCorridorLines;
    return planCorridorLines ?? [];
  }, [inputCorridorLines, planCorridorLines]);

  /** 코어를 가장 가까운 복도 중심선 위로 붙인다. */
  const snapToRail = useCallback(
    (p: Pt): Pt => (railLines.length > 0 ? projectOntoPolylines(railLines, p) : p),
    [railLines],
  );

  /** 앵커에서 가장 가까운 복도의 접선 — 코어 사각형을 복도에 맞춰 세운다. */
  const railTangent = useCallback(
    (p: Pt): Pt => {
      if (railLines.length === 0) return [1, 0];
      let best = railLines[0];
      let bestD = Infinity;
      for (const line of railLines) {
        const q = projectOntoPolyline(line, p);
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < bestD) {
          bestD = d;
          best = line;
        }
      }
      return tangentOnPolyline(best, p);
    },
    [railLines],
  );

  /** 코어 하나의 실제 외곽 — 자유 외곽선이 있으면 그것, 없으면 앵커+크기 사각형. */
  const coreShape = useCallback(
    (c: CoreSpec): Pt[] =>
      c.outline && c.outline.length >= 3
        ? c.outline
        : coreRectangle(c.anchor, c.length, c.reach, railTangent(c.anchor)),
    [railTangent],
  );

  /** 편집 대상 링 — 제어점 좌표(곡선 densify 전). */
  const rings = useMemo<Ring[]>(() => {
    const out: Ring[] = [];
    if (inputBoundary.length >= 3) {
      out.push({ kind: "boundary", pts: boundaryCorners, closed: true, linked: true });
    }
    for (const c of inputCorridors ?? []) {
      if (c.vertices.length >= 2) {
        out.push({
          kind: "corridor",
          pts: pathPoints(c.vertices),
          closed: false,
          linked: true,
          id: c.id,
        });
      }
    }
    if (inputCores && inputCores.length > 0) {
      // 코어 핸들은 앵커 좌표에 붙는다(자유 외곽선 코어는 그 중심).
      out.push({
        kind: "core",
        pts: inputCores.map((c) => c.anchor),
        closed: false,
        linked: false,
      });
    }
    return out;
  }, [inputBoundary, boundaryCorners, inputCorridors, inputCores]);

  /** 경로별 PathVertex (role 포함). */
  const vertsOf = useCallback(
    (kind: "boundary" | "corridor", pathId?: string): PathVertex[] => {
      if (kind === "boundary") return inputBoundary;
      return (inputCorridors ?? []).find((c) => c.id === pathId)?.vertices ?? [];
    },
    [inputBoundary, inputCorridors],
  );

  const hoverVertex = editing && !dragVertex ? hitVertex(view, rings, cursor) : null;
  const hoverMid: MidpointHit | null =
    editing && !dragVertex && !hoverVertex ? hitEdgeMidpoint(view, rings, cursor) : null;
  const nearMids = useMemo(
    () => (editing && !dragVertex ? midpointsNear(view, rings, cursor) : []),
    [editing, dragVertex, view, rings, cursor],
  );

  const moveVertex = useCallback(
    (ref: VertexRef, to: Pt) => {
      if (ref.kind === "core") {
        const list = inputCores ?? [];
        if (ref.index >= list.length) return;
        const prev = list[ref.index];
        // 자유 외곽선 코어는 외곽선 전체를 앵커 이동량만큼 함께 옮긴다.
        const dx = to[0] - prev.anchor[0];
        const dy = to[1] - prev.anchor[1];
        onEditCores(
          list.map((c, i) =>
            i === ref.index
              ? {
                  ...c,
                  anchor: to,
                  outline: c.outline
                    ? c.outline.map((p) => [p[0] + dx, p[1] + dy] as Pt)
                    : null,
                }
              : c,
          ),
        );
        return;
      }
      const verts = vertsOf(ref.kind, ref.id);
      if (ref.index >= verts.length) return;
      onEditGeometry(ref.kind, movePathVertex(verts, ref.index, to), ref.id);
    },
    [vertsOf, inputCores, onEditGeometry, onEditCores],
  );

  const insertVertex = useCallback(
    (hit: MidpointHit) => {
      if (hit.kind === "core") return;
      const verts = vertsOf(hit.kind, hit.id);
      const next = insertPathVertex(verts, hit.afterIndex, hit.at, "corner");
      onEditGeometry(hit.kind, next, hit.id);
      setDragVertex({ kind: hit.kind, index: hit.afterIndex + 1, id: hit.id });
    },
    [vertsOf, onEditGeometry],
  );

  /** 꼭짓점 삭제 / 곡선 토글 */
  const deleteVertex = useCallback(
    (ref: VertexRef) => {
      if (ref.kind === "core") {
        const list = inputCores ?? [];
        if (list.length === 0) return;
        if (list[ref.index]?.id === selectedCoreId) onSelectCore(null);
        onEditCores(list.filter((_c, i) => i !== ref.index));
        return;
      }
      const verts = vertsOf(ref.kind, ref.id);
      const min = ref.kind === "boundary" ? 3 : 2;
      if (verts.length <= min) {
        if (ref.kind === "corridor" && ref.id) onEditGeometry("corridor", [], ref.id);
        return;
      }
      onEditGeometry(
        ref.kind,
        verts.filter((_v, i) => i !== ref.index),
        ref.id,
      );
    },
    [vertsOf, inputCores, onEditGeometry, onEditCores, selectedCoreId, onSelectCore],
  );

  const toggleCurveAt = useCallback(
    (ref: VertexRef) => {
      if (ref.kind === "core") return;
      // 끝점은 곡선 중간점이 될 수 없음
      const verts = vertsOf(ref.kind, ref.id);
      if (ref.index <= 0 || ref.index >= verts.length - 1) return;
      const next = verts.map((v, i) =>
        i === ref.index ? { ...v, role: toggleVertexRole(v.role) } : v,
      );
      onEditGeometry(ref.kind, next, ref.id);
    },
    [vertsOf, onEditGeometry],
  );

  const tangled: "boundary" | "corridor" | null = !editing
    ? null
    : boundaryDense.length >= 3 && selfIntersects(boundaryDense, true)
      ? "boundary"
      : inputCorridorLines.some((l) => l.length >= 3 && selfIntersects(l, false))
        ? "corridor"
        : null;

  // ------------------------------------------------------------------ 그리기
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    ctx.fillStyle = chrome.surface;
    ctx.fillRect(0, 0, size.w, size.h);

    const path = (pts: Pt[]) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = toScreen(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    };

    /** 변 하나의 치수선 + 길이 문자열을 그린다. normal 은 월드 기준 바깥 방향. */
    const drawDim = (a: Pt, b: Pt, normal: [number, number] | null, color: string) => {
      const [x1, y1] = toScreen(a);
      const [x2, y2] = toScreen(b);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenPx = Math.hypot(dx, dy);
      if (lenPx < 30) return; // 화면상 너무 짧으면 숫자가 겹쳐 읽히지 않는다

      // 화면 기준 법선. 월드 법선이 주어지면 그쪽(도형 바깥)으로 맞춘다.
      let nx = -dy / lenPx;
      let ny = dx / lenPx;
      if (normal) {
        // 월드 y축은 위쪽이 +, 화면은 아래쪽이 + 이므로 y 부호를 뒤집는다.
        if (nx * normal[0] + ny * -normal[1] < 0) {
          nx = -nx;
          ny = -ny;
        }
      }

      const off = 17;
      const ax = x1 + nx * off;
      const ay = y1 + ny * off;
      const bx = x2 + nx * off;
      const by = y2 + ny * off;

      ctx.strokeStyle = withAlpha(color, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.moveTo(x1 + nx * 4, y1 + ny * 4);
      ctx.lineTo(x1 + nx * (off + 5), y1 + ny * (off + 5));
      ctx.moveTo(x2 + nx * 4, y2 + ny * 4);
      ctx.lineTo(x2 + nx * (off + 5), y2 + ny * (off + 5));
      ctx.stroke();

      let ang = Math.atan2(dy, dx);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI; // 글자 뒤집힘 방지
      const label = `${edgeLength(a, b).toFixed(2)} m`;

      ctx.save();
      ctx.translate((ax + bx) / 2, (ay + by) / 2);
      ctx.rotate(ang);
      ctx.font = "600 11px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = chrome.surface;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-tw / 2 - 3, -7, tw + 6, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    };

    // ---- 1m 격자 (확대했을 때만)
    if (overlays.grid && view.scale > 3) {
      const [wx0, wy1] = toWorld(0, 0);
      const [wx1, wy0] = toWorld(size.w, size.h);
      ctx.strokeStyle = chrome.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = view.scale > 12 ? 1 : 5;
      for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) {
        const [sx] = toScreen([x, 0]);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, size.h);
      }
      for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) {
        const [, sy] = toScreen([0, y]);
        ctx.moveTo(0, sy);
        ctx.lineTo(size.w, sy);
      }
      ctx.stroke();
    }

    if (plan) {
      const travels = plan.units
        .map((u) => u.travel_distance)
        .filter((d): d is number => d !== null);
      const maxTravel = travels.length ? Math.max(...travels) : 1;

      // ---- 외피 안쪽 바탕
      path(plan.boundary);
      ctx.fillStyle = mode === "light" ? "#ffffff" : "#111110";
      ctx.fill();

      // ---- 세대
      for (const u of plan.units) {
        const base = overlays.travel
          ? rampColor((u.travel_distance ?? 0) / Math.max(maxTravel, 1))
          : seriesColor(mode, u.type_index);
        path(u.polygon);
        ctx.fillStyle = withAlpha(base, mode === "light" ? 0.28 : 0.34);
        ctx.fill();
        // 인접 세대 사이가 붙어 보이지 않도록 면 위에 같은 색 실선 테두리
        const multi = selectedUnitIds.includes(u.id);
        const hi = highlightedUnitIds.includes(u.id);
        ctx.strokeStyle = hi ? "#2b56f0" : base;
        ctx.lineWidth =
          u.id === selectedId || multi ? 3 : u.id === hoverId ? 2.5 : hi ? 2.5 : 1.5;
        ctx.stroke();
        if (hi) {
          path(u.polygon);
          ctx.fillStyle = "rgba(43, 86, 240, 0.12)";
          ctx.fill();
        }
      }

      // ---- 내부 평면 (실 · 존 · 문 · 피난)
      if (overlays.interiors || overlays.zones || overlays.egress) {
        for (const u of plan.units) {
          const it = interiors[u.id];
          if (!it) continue;

          if (overlays.zones && it.zones) {
            for (const z of it.zones) {
              if (z.category === "apartment" && !overlays.zones) continue;
              path(z.polygon);
              ctx.fillStyle = z.color;
              ctx.fill();
            }
          }

          if (overlays.interiors) {
            for (const r of it.rooms) {
              path(r.polygon);
              ctx.fillStyle = withAlpha(seriesColor(mode, r.kind === "living" ? 0 : r.kind === "bedroom" ? 2 : 1), 0.2);
              ctx.fill();
              ctx.strokeStyle = withAlpha(chrome.ink, 0.35);
              ctx.lineWidth = 1;
              ctx.stroke();
              if (overlays.labels && r.polygon.length >= 3) {
                const cx = r.polygon.reduce((s, p) => s + p[0], 0) / r.polygon.length;
                const cy = r.polygon.reduce((s, p) => s + p[1], 0) / r.polygon.length;
                const [sx, sy] = toScreen([cx, cy]);
                ctx.fillStyle = chrome.inkSecondary;
                ctx.font = "600 10px system-ui, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(r.name, sx, sy);
              }
            }
            for (const d of it.doors) {
              const [sx, sy] = toScreen(d.position);
              const wPx = d.width * view.scale;
              ctx.save();
              ctx.strokeStyle = d.category === "entrance" ? STATUS.critical : "#2b56f0";
              ctx.lineWidth = 2;
              if (d.type.startsWith("swing")) {
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(sx + wPx * 0.15, sy - wPx);
                ctx.stroke();
                ctx.beginPath();
                ctx.setLineDash([3, 3]);
                ctx.arc(sx, sy, wPx, -Math.PI / 2, 0, false);
                ctx.stroke();
                ctx.setLineDash([]);
              } else {
                ctx.beginPath();
                ctx.moveTo(sx - wPx / 2, sy);
                ctx.lineTo(sx + wPx / 2, sy);
                ctx.stroke();
              }
              ctx.restore();
            }
            if (it.score && overlays.labels) {
              const [lx, ly] = toScreen(u.label_at);
              ctx.fillStyle = "#2b56f0";
              ctx.font = "bold 11px system-ui, sans-serif";
              ctx.textAlign = "left";
              ctx.fillText(`${it.score.total}%`, lx + 8, ly - 12);
            }
          }

          if (overlays.egress && it.egressPath) {
            const ep = it.egressPath;
            const [a, b] = [toScreen(ep.startPoint), toScreen(ep.exitPoint)];
            ctx.save();
            ctx.strokeStyle = "#ff6b00";
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#ff6b00";
            ctx.font = "bold 11px system-ui, sans-serif";
            ctx.fillText(
              `${ep.distanceMeters.toFixed(1)}m`,
              (a[0] + b[0]) / 2 + 4,
              (a[1] + b[1]) / 2 - 4,
            );
            ctx.restore();
          }
        }
      }

      // ---- 복도
      for (const poly of plan.corridor.polygons) {
        path(poly);
        ctx.fillStyle = mode === "light" ? "#eceae4" : "#232322";
        ctx.fill();
        ctx.strokeStyle = chrome.axis;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ---- 코어
      for (const c of plan.cores) {
        path(c.polygon);
        ctx.fillStyle = mode === "light" ? "#c3c2b7" : "#4a4a46";
        ctx.fill();
        ctx.strokeStyle = chrome.inkSecondary;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        const [cx, cy] = toScreen([
          c.polygon.reduce((s, p) => s + p[0], 0) / c.polygon.length,
          c.polygon.reduce((s, p) => s + p[1], 0) / c.polygon.length,
        ]);
        ctx.fillStyle = chrome.ink;
        ctx.font = "600 11px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("CORE", cx, cy);
      }

      // ---- 사장/자투리 면적
      for (const lo of plan.leftovers) {
        path(lo.polygon);
        const col = lo.reason === "no_access" ? STATUS.critical : chrome.muted;
        ctx.fillStyle = withAlpha(col, 0.22);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ---- 외곽선
      path(plan.boundary);
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // ---- 외곽선 치수 (도형 바깥쪽에 배치해 도면과 겹치지 않게)
      //      입력이 결과와 어긋나면 아래 입력 레이어가 치수를 그리므로 여기선 생략 —
      //      두 벌이 같은 자리에 겹쳐 찍히는 것을 막는다.
      if (overlays.dims && !geometryDirty) {
        const outward = outwardNormalOf(plan.boundary);
        for (let i = 0; i < plan.boundary.length; i++) {
          const a = plan.boundary[i];
          const b = plan.boundary[(i + 1) % plan.boundary.length];
          drawDim(a, b, outward(a, b), chrome.inkSecondary);
        }
      }

      // ---- 동선 그래프
      if (overlays.graph) {
        const pos = new Map(plan.graph.nodes.map((n) => [n.id, toScreen([n.x, n.y])]));
        ctx.lineWidth = 2;
        for (const e of plan.graph.edges) {
          const a = pos.get(e.source);
          const b = pos.get(e.target);
          if (!a || !b) continue;
          ctx.strokeStyle =
            e.kind === "corridor" ? seriesColor(mode, 0) : withAlpha(chrome.muted, 0.7);
          ctx.setLineDash(e.kind === "door" ? [3, 3] : []);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const n of plan.graph.nodes) {
          if (n.kind === "unit") continue;
          const [x, y] = pos.get(n.id)!;
          ctx.beginPath();
          ctx.arc(x, y, n.kind === "core" ? 6 : 3, 0, Math.PI * 2);
          ctx.fillStyle = n.kind === "core" ? STATUS.critical : seriesColor(mode, 0);
          ctx.fill();
          ctx.strokeStyle = chrome.surface;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // ---- 현관문 위치
      if (overlays.doors) {
        for (const u of plan.units) {
          if (!u.door_point) continue;
          const [x, y] = toScreen(u.door_point);
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = u.accessible ? STATUS.good : STATUS.critical;
          ctx.fill();
          ctx.strokeStyle = chrome.surface;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // ---- 세대 라벨 (색만으로 타입을 구분하지 않도록 항상 텍스트를 함께 제공)
      if (overlays.labels) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const u of plan.units) {
          const [x, y] = toScreen(u.label_at);
          const w = Math.sqrt(polygonArea(u.polygon)) * view.scale;
          if (w < 34) continue;
          ctx.fillStyle = chrome.ink;
          ctx.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
          ctx.fillText(u.type, x, y - 7);
          ctx.fillStyle = chrome.inkSecondary;
          ctx.font = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
          ctx.fillText(`${u.area.toFixed(1)}m²`, x, y + 8);
        }
      }
    }

    // ---- 확정된 설계 입력 (생성 전 상태, 또는 결과가 입력과 어긋난 상태)
    //      외곽선을 다시 그리는 중이면 교체 대상이므로 감춘다. 반대로 복도를
    //      그리는 중에는 외곽선이 보여야 안쪽에 동선을 놓을 수 있다.
    //      꼭짓점 편집 중에는 결과와 일치하더라도 편집 대상 윤곽을 항상 보여준다.
    const showInput = (geometryDirty || editing) && editMode !== "boundary";
    // 결과 위에 겹쳐 그리는 상황 — 채우면 세대가 가려지므로 윤곽만, 파선으로.
    const overlaid = plan !== null;
    const mismatch = overlaid && geometryDirty;

    // ---- 도면 밑깔기 (추적 도면) — origin = 월드 좌하단
    if (overlays.underlay && underlay?.visible && underlayImgRef.current) {
      const img = underlayImgRef.current;
      const hM =
        underlay.heightM ??
        (img.naturalWidth > 0
          ? underlay.widthM * (img.naturalHeight / img.naturalWidth)
          : underlay.widthM * 0.7);
      const ox = underlay.origin[0];
      const oy = underlay.origin[1];
      // 화면: 좌상단 (ox, oy+h), 우하단 (ox+w, oy)
      const [L, T] = toScreen([ox, oy + hM]);
      const [R, B] = toScreen([ox + underlay.widthM, oy]);
      ctx.save();
      ctx.globalAlpha = Math.max(0.05, Math.min(1, underlay.opacity));
      ctx.drawImage(img, L, T, R - L, B - T);
      ctx.restore();
    }

    if (showInput && boundaryDense.length >= 3) {
      path(boundaryDense);
      if (!overlaid) {
        ctx.fillStyle = mode === "light" ? "#ffffff" : "#111110";
        ctx.fill();
      }
      ctx.strokeStyle = mismatch ? seriesColor(mode, 1) : chrome.ink;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(mismatch ? [8, 5] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      if (!editing) {
        inputBoundary.forEach((v) => {
          const [x, y] = toScreen(v.p);
          ctx.beginPath();
          if (v.role === "curve") {
            ctx.moveTo(x, y - 5);
            ctx.lineTo(x + 5, y);
            ctx.lineTo(x, y + 5);
            ctx.lineTo(x - 5, y);
            ctx.closePath();
          } else {
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          }
          ctx.fillStyle =
            v.role === "curve"
              ? STATUS.good
              : mismatch
                ? seriesColor(mode, 1)
                : chrome.ink;
          ctx.fill();
          ctx.strokeStyle = chrome.surface;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }

      if (overlays.dims && (!overlaid || geometryDirty)) {
        const outward = outwardNormalOf(boundaryDense);
        for (let i = 0; i < boundaryDense.length; i++) {
          const a = boundaryDense[i];
          const b = boundaryDense[(i + 1) % boundaryDense.length];
          drawDim(a, b, outward(a, b), chrome.inkSecondary);
        }
      }
    }

    // ---- 확정된 복도 중심선들 (중복도·편복도 중첩, 곡선 densify)
    if (showInput && inputCorridors && inputCorridors.length > 0) {
      inputCorridors.forEach((cpath, pi) => {
        const dense = densifyPath(cpath.vertices, 24);
        if (dense.length < 2) return;
        const accent =
          cpath.strategy === "single_loaded" ? seriesColor(mode, 2) : seriesColor(mode, 1);
        const stroke = () => {
          ctx.beginPath();
          dense.forEach((p, i) => {
            const [x, y] = toScreen(p);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
        };

        if (!overlaid) {
          ctx.save();
          ctx.lineCap = "butt";
          ctx.lineJoin = "miter";
          ctx.strokeStyle = mode === "light" ? "#eceae4" : "#232322";
          ctx.lineWidth = Math.max(corridorWidth * view.scale, 1);
          stroke();
          ctx.stroke();
          ctx.restore();
        }

        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.setLineDash(cpath.strategy === "single_loaded" ? [3, 5] : [7, 4]);
        stroke();
        ctx.stroke();
        ctx.setLineDash([]);

        const mid = dense[Math.floor(dense.length / 2)];
        const [lx, ly] = toScreen(mid);
        ctx.font = "600 10px system-ui, -apple-system, 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = accent;
        ctx.fillText(
          cpath.strategy === "single_loaded" ? `편복도 ${pi + 1}` : `중복도 ${pi + 1}`,
          lx,
          ly - 6,
        );

        if (!editing) {
          cpath.vertices.forEach((v) => {
            const [x, y] = toScreen(v.p);
            ctx.beginPath();
            if (v.role === "curve") {
              ctx.moveTo(x, y - 5);
              ctx.lineTo(x + 5, y);
              ctx.lineTo(x, y + 5);
              ctx.lineTo(x - 5, y);
              ctx.closePath();
            } else {
              ctx.arc(x, y, 4, 0, Math.PI * 2);
            }
            ctx.fillStyle = v.role === "curve" ? STATUS.good : accent;
            ctx.fill();
            ctx.strokeStyle = chrome.surface;
            ctx.lineWidth = 2;
            ctx.stroke();
          });
        }
      });
    }

    // ---- 수동 코어의 실제 크기(footprint) 표시.
    //      결과 도면의 코어와 별개로, '지금 요청한 크기'를 항상 보여준다.
    if (inputCores && inputCores.length > 0) {
      for (const c of inputCores) {
        const shape = coreShape(c);
        if (shape.length < 3) continue;
        const on = c.id === selectedCoreId;
        path(shape);
        ctx.fillStyle = withAlpha(STATUS.critical, on ? 0.3 : 0.16);
        ctx.fill();
        ctx.strokeStyle = STATUS.critical;
        ctx.lineWidth = on ? 2.5 : 1.5;
        ctx.setLineDash(plan ? [6, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        // 선택된 코어에는 치수를 붙여 크기를 바로 읽게 한다.
        if (on && overlays.dims) {
          const outward = outwardNormalOf(shape);
          for (let i = 0; i < shape.length; i++) {
            const a = shape[i];
            const b = shape[(i + 1) % shape.length];
            drawDim(a, b, outward(a, b), STATUS.critical);
          }
        }
      }
    }

    // ---- 코어 찍기 미리보기.
    //      cursor 는 이미 중심선에 붙은 좌표라, 이 사각형이 곧 배치될 자리다.
    if (editMode === "core" && cursor) {
      const preview = coreShape({
        id: "__preview",
        anchor: cursor,
        length: defaultCoreLength,
        reach: defaultCoreReach,
        outline: null,
      });
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = STATUS.critical;
      ctx.lineWidth = 2;
      path(preview);
      ctx.stroke();
      ctx.setLineDash([]);
      const [cx, cy] = toScreen(cursor);
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = STATUS.critical;
      ctx.fill();
    }

    // ---- 작도 중인 폴리라인 (직선 + 3점 원호 미리보기)
    if (editMode !== "view" && editMode !== "core" && draft.length > 0) {
      const accent =
        editMode === "boundary"
          ? chrome.ink
          : editMode === "coreOutline"
            ? STATUS.critical
            : seriesColor(mode, 1);
      const rubberTo: Pt | null = snap === "close" ? draft[0].p : cursor;

      // densify 된 확정 구간 + 고무줄
      const draftDense = densifyPath(draft, 20);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      draftDense.forEach((p, i) => {
        const [x, y] = toScreen(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (rubberTo && draft.length > 0) {
        // 다음이 곡선점이면 원호 미리보기, 아니면 직선 고무줄
        if (nextRole === "curve" && draft.length >= 1) {
          // 제어점 위치만 점선 연결 (원호는 다음 점이 찍혀야 완성)
          const [x, y] = toScreen(rubberTo);
          const last = draft[draft.length - 1].p;
          const [lx, ly] = toScreen(last);
          ctx.moveTo(lx, ly);
          ctx.lineTo(x, y);
        } else if (
          draft.length >= 2 &&
          draft[draft.length - 1].role === "curve" &&
          rubberTo
        ) {
          // 마지막이 곡선 제어점이면 원호 A-B-cursor 미리보기
          const a = draft[draft.length - 2].p;
          const b = draft[draft.length - 1].p;
          const arc = densifyPath(
            [
              { p: a, role: "corner" },
              { p: b, role: "curve" },
              { p: rubberTo, role: "corner" },
            ],
            16,
          );
          arc.forEach((p, i) => {
            const [x, y] = toScreen(p);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
        } else {
          const [x, y] = toScreen(rubberTo);
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      if (overlays.dims && draftPts.length > 0) {
        const closing = snap === "close";
        const ring: Pt[] = closing
          ? draftPts
          : rubberTo
            ? [...draftPts, rubberTo]
            : draftPts;
        const outward = closing && ring.length >= 3 ? outwardNormalOf(ring) : null;
        const lastIdx = closing ? ring.length : ring.length - 1;
        for (let i = 0; i < lastIdx; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          drawDim(a, b, outward ? outward(a, b) : null, accent);
        }
      }

      draft.forEach((v, i) => {
        const [x, y] = toScreen(v.p);
        const isSnapTarget = snap === "close" && i === 0;
        ctx.beginPath();
        if (v.role === "curve") {
          ctx.moveTo(x, y - 6);
          ctx.lineTo(x + 6, y);
          ctx.lineTo(x, y + 6);
          ctx.lineTo(x - 6, y);
          ctx.closePath();
        } else {
          ctx.arc(x, y, isSnapTarget ? 9 : i === 0 ? 6 : 4, 0, Math.PI * 2);
        }
        ctx.fillStyle = isSnapTarget ? STATUS.good : v.role === "curve" ? STATUS.good : accent;
        ctx.fill();
        ctx.strokeStyle = chrome.surface;
        ctx.lineWidth = 2;
        ctx.stroke();
        if (isSnapTarget) {
          ctx.beginPath();
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.strokeStyle = STATUS.good;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    }

    // ---- 꼭짓점 편집 핸들
    if (editing) {
      for (const ring of rings) {
        const base =
          ring.kind === "boundary"
            ? chrome.ink
            : ring.kind === "corridor"
              ? seriesColor(mode, 1)
              : STATUS.critical;

        // 변 중점의 '＋' 표식 — 커서가 다가온 변에만 나타난다.
        for (const m of nearMids) {
          if (m.kind !== ring.kind) continue;
          const [a, b] = [ring.pts[m.afterIndex], ring.pts[(m.afterIndex + 1) % ring.pts.length]];
          const [x1, y1] = toScreen(a);
          const [x2, y2] = toScreen(b);
          if (Math.hypot(x2 - x1, y2 - y1) < 34) continue; // 너무 짧은 변은 생략
          const [mx, my] = toScreen(m.at);
          const on =
            hoverMid?.kind === m.kind &&
            hoverMid.afterIndex === m.afterIndex &&
            hoverMid.id === m.id;
          const r = on ? 9 : 6;
          ctx.beginPath();
          ctx.arc(mx, my, r, 0, Math.PI * 2);
          ctx.fillStyle = chrome.surface;
          ctx.globalAlpha = on ? 1 : 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = on ? STATUS.good : withAlpha(base, 0.5);
          ctx.lineWidth = on ? 2 : 1.5;
          ctx.stroke();
          ctx.strokeStyle = on ? STATUS.good : withAlpha(base, 0.65);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(mx - r / 2, my);
          ctx.lineTo(mx + r / 2, my);
          ctx.moveTo(mx, my - r / 2);
          ctx.lineTo(mx, my + r / 2);
          ctx.stroke();
        }

        // 꼭짓점 핸들 — 항상 보이되, 평소에는 작고 조용하게.
        // 코어는 성격이 다른 요소이므로 원이 아닌 사각 핸들로 구분한다.
        ring.pts.forEach((p, i) => {
          const [x, y] = toScreen(p);
          const isDrag =
            dragVertex?.kind === ring.kind &&
            dragVertex.index === i &&
            dragVertex.id === ring.id;
          const isHover =
            hoverVertex?.kind === ring.kind &&
            hoverVertex.index === i &&
            hoverVertex.id === ring.id;
          const r = isDrag || isHover ? 8 : 4.5;
          // 곡선 제어점 여부
          let isCurve = false;
          if (ring.kind === "boundary") isCurve = inputBoundary[i]?.role === "curve";
          else if (ring.kind === "corridor" && ring.id) {
            const cv = (inputCorridors ?? []).find((c) => c.id === ring.id)?.vertices[i];
            isCurve = cv?.role === "curve";
          }
          ctx.beginPath();
          if (ring.kind === "core") ctx.rect(x - r, y - r, r * 2, r * 2);
          else if (isCurve) {
            ctx.moveTo(x, y - r);
            ctx.lineTo(x + r, y);
            ctx.lineTo(x, y + r);
            ctx.lineTo(x - r, y);
            ctx.closePath();
          } else ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = isDrag ? STATUS.good : isCurve ? withAlpha(STATUS.good, 0.35) : chrome.surface;
          ctx.fill();
          ctx.strokeStyle = isDrag ? STATUS.good : isCurve ? STATUS.good : base;
          ctx.lineWidth = isDrag || isHover ? 2.5 : 2;
          ctx.stroke();
        });
      }

      // 끌고 있는 점의 좌표를 바로 옆에 표시
      if (dragVertex) {
        let p: Pt | null = null;
        if (dragVertex.kind === "core") {
          p = (inputCores ?? [])[dragVertex.index]?.anchor ?? null;
        } else {
          p = vertsOf(dragVertex.kind, dragVertex.id)[dragVertex.index]?.p ?? null;
        }
        if (p) {
          const [x, y] = toScreen(p);
          const label = `${p[0].toFixed(2)}, ${p[1].toFixed(2)} m`;
          ctx.font = "600 11px system-ui, -apple-system, 'Segoe UI', sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = chrome.surface;
          ctx.globalAlpha = 0.92;
          ctx.fillRect(x + 12, y - 9, tw + 10, 18);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = withAlpha(chrome.ink, 0.2);
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 12, y - 9, tw + 10, 18);
          ctx.fillStyle = chrome.ink;
          ctx.fillText(label, x + 17, y);
        }
      }
    }

    // ---- 스케일 바
    const targets = [1, 2, 5, 10, 20, 50, 100];
    const barM = targets.find((t) => t * view.scale > 70) ?? 100;
    const barPx = barM * view.scale;
    const bx = 20;
    const by = size.h - 24;
    ctx.strokeStyle = chrome.inkSecondary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + barPx, by);
    ctx.moveTo(bx, by - 5);
    ctx.lineTo(bx, by + 5);
    ctx.moveTo(bx + barPx, by - 5);
    ctx.lineTo(bx + barPx, by + 5);
    ctx.stroke();
    ctx.fillStyle = chrome.inkSecondary;
    ctx.font = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`${barM} m`, bx, by - 8);
  }, [
    plan, view, size, mode, chrome, overlays, editMode, draft, draftPts, nextRole,
    cursor, snap, inputBoundary, inputCorridors, inputCores, corridorWidth, geometryDirty,
    editing, rings, hoverVertex, hoverMid, nearMids, dragVertex,
    selectedId, hoverId, toScreen, toWorld, vertsOf, boundaryDense,
    underlay, underlayReady, interiors, highlightedUnitIds, selectedUnitIds,
  ]);

  // ------------------------------------------------------------ 마우스 조작
  const hitTest = useCallback(
    (w: Pt): Unit | null => {
      if (!plan) return null;
      for (const u of plan.units) if (pointInPolygon(w, u.polygon)) return u;
      return null;
    },
    [plan],
  );

  /** 화면 좌표 기준 팬 갱신 (캔버스·window 공용). panRef 시작점 기준 절대 이동. */
  const applyPan = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const pan = panRef.current;
    if (!canvas || !pan) return;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    setView((prev) =>
      prev
        ? {
            ...prev,
            tx: pan.tx + (sx - pan.x),
            ty: pan.ty + (sy - pan.y),
          }
        : prev,
    );
  }, []);

  // 팬 중: 커서가 캔버스 밖으로 나가도 window 에서 이어서 처리
  useEffect(() => {
    if (!panning) return;
    const onMove = (e: MouseEvent) => {
      if (!panRef.current) return;
      e.preventDefault();
      applyPan(e.clientX, e.clientY);
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 1 || e.button === 0) {
        panRef.current = null;
        setPanning(false);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [panning, applyPan]);

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (panRef.current) {
      // window 리스너가 붙어 있으면 이중 적용 방지 — 캔버스 안에서는 여기만
      if (!panning) applyPan(e.clientX, e.clientY);
      return;
    }
    const w = toWorld(sx, sy);
    if (editMode === "view") {
      // 핸들 명중 판정은 원본 좌표로, 실제 이동만 격자에 맞춘다.
      setCursor(w);
      if (dragVertex) {
        if (dragVertex.kind === "core") {
          moveVertex(dragVertex, snapToRail(w));
        } else {
          const verts = vertsOf(dragVertex.kind, dragVertex.id);
          const prev = dragVertex.index > 0 ? verts[dragVertex.index - 1]?.p ?? null : null;
          moveVertex(dragVertex, constrainPoint(w, prev, e.shiftKey));
        }
        return;
      }
      // 편집 핸들 위에서는 세대 호버를 끈다 — 툴팁과 핸들이 겹쳐 잡히지 않게.
      const onHandle = hitVertex(view, rings, w) ?? hitEdgeMidpoint(view, rings, w);
      setHoverId(onHandle ? null : (hitTest(w)?.id ?? null));
      return;
    }
    // 코어는 복도 위에만 놓이므로 미리보기도 중심선에 붙인다.
    // 나머지는 실제로 찍히는 좌표와 같아야 치수가 맞는다.
    setCursor(editMode === "core" ? snapToRail(w) : constrain(w, e.shiftKey));
  };

  // 휠 가운데 버튼 드래그 = 패닝 (CAD 표준). 좌클릭 드래그도 보기/작도에서 패닝.
  // 좌클릭 클릭(이동 없음) = 점 찍기/선택. 우클릭 = 확인/취소 메뉴.
  const beginPan = (sx: number, sy: number, button: number) => {
    if (!view) return;
    panRef.current = { x: sx, y: sy, tx: view.tx, ty: view.ty, button };
    setPanning(true);
  };

  const endPan = () => {
    panRef.current = null;
    setPanning(false);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!view) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // 휠 가운데 버튼: 항상 패닝 (작도 중에도)
    if (e.button === 1) {
      e.preventDefault();
      beginPan(sx, sy, 1);
      return;
    }

    // 우클릭: 브라우저 기본 메뉴 막고, 작도 모드면 메뉴
    if (e.button === 2) {
      e.preventDefault();
      endPan();
      return;
    }
    if (e.button !== 0) return;

    // 메뉴가 열려 있으면 캔버스 좌클릭으로 닫기만 한다(점 찍기 방지).
    if (ctxMenu) {
      setCtxMenu(null);
      suppressClickRef.current = true;
      return;
    }

    if (editing) {
      const w = toWorld(sx, sy);
      const v = hitVertex(view, rings, w);
      if (v) {
        setDragVertex(v);
        return;
      }
      const mid = hitEdgeMidpoint(view, rings, w);
      if (mid) {
        insertVertex(mid);
        return;
      }
    }

    // 좌클릭 드래그 패닝 (클릭만 하면 mouseup 에서 점/선택 처리)
    beginPan(sx, sy, 0);
  };

  const onMouseUp = (e: React.MouseEvent) => {
    // 가운데 버튼 팬 종료 — 클릭 동작 없음
    if (e.button === 1) {
      e.preventDefault();
      endPan();
      return;
    }

    // 우클릭 릴리즈에서도 메뉴 오픈 (contextmenu 가 막히는 환경 대비)
    if (e.button === 2) {
      e.preventDefault();
      if (editMode !== "view") openDrawMenu(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;

    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      endPan();
      return;
    }

    if (dragVertex) {
      setDragVertex(null);
      endPan();
      return;
    }
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wasLeftPan = panRef.current?.button === 0;
    const dragged =
      wasLeftPan &&
      panRef.current &&
      Math.hypot(sx - panRef.current.x, sy - panRef.current.y) > 4;
    endPan();
    if (dragged) return;

    const w = toWorld(sx, sy);
    if (editMode === "view") {
      // 핸들 위 클릭은 편집 동작이므로 세대 선택으로 넘기지 않는다.
      const v = hitVertex(view, rings, w);
      if (v?.kind === "core") {
        // 코어 핸들 클릭 = 크기 편집 대상 선택
        onSelectCore((inputCores ?? [])[v.index]?.id ?? null);
        return;
      }
      if (v || hitEdgeMidpoint(view, rings, w)) return;
      // 코어 본체 클릭으로도 선택
      if (inputCores && inputCores.length > 0) {
        for (let i = inputCores.length - 1; i >= 0; i--) {
          const shape = coreShape(inputCores[i]);
          if (shape.length >= 3 && pointInPolygon(w, shape)) {
            onSelectCore(inputCores[i].id);
            return;
          }
        }
      }
      onSelectCore(null);
      onSelect(hitTest(w)?.id ?? null, e.shiftKey);
      return;
    }
    if (editMode === "core") {
      // 클릭한 자리를 복도 중심선에 붙여 추가한다(백엔드 정사영과 결과가 같도록).
      const anchor = snapToRail(w);
      const next: CoreSpec = {
        id: `core-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        anchor,
        length: defaultCoreLength,
        reach: defaultCoreReach,
        outline: null,
      };
      onEditCores([...(inputCores ?? []), next]);
      onSelectCore(next.id);
      return;
    }

    // 더블클릭 두 번째 클릭 = CAD처럼 선 종료 (점 추가 없이 확정)
    if (e.detail >= 2) {
      if (canCommit) onCommitDraw();
      return;
    }

    const p = constrain(w, e.shiftKey);
    // 외곽선: 첫 점 근처 클릭 = 닫고 확정 (CAD 폐합). 그 외는 점 추가만.
    if (snapAt(p) === "close") {
      onCommitDraw();
      return;
    }
    const last = draft[draft.length - 1];
    if (last && Math.hypot(p[0] - last.p[0], p[1] - last.p[1]) < 1e-6) return;
    // 첫/끝 점은 항상 모서리, 중간만 curve 허용. 다음 role 이 curve 여도 첫 점은 corner.
    const role: VertexRole =
      draft.length === 0 || nextRole === "corner" ? "corner" : "curve";
    onDraftChange([...draft, { p, role }]);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // mouseup(detail>=2) 에서 이미 처리. 브라우저 기본 선택만 막음.
    e.preventDefault();
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!view) return;
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.max(0.5, Math.min(200, view.scale * factor));
    const k = scale / view.scale;
    setView({ scale, tx: sx - (sx - view.tx) * k, ty: sy - (sy - view.ty) * k });
  };

  const hovered = plan?.units.find((u) => u.id === (hoverId ?? selectedId)) ?? null;

  return (
    <div ref={wrapRef} className="canvasWrap">
      <canvas
        ref={canvasRef}
        style={{
          width: size.w,
          height: size.h,
          cursor: panning || dragVertex
            ? "grabbing"
            : hoverVertex
              ? "grab"
              : hoverMid
                ? "copy"
                : snap
                  ? "pointer"
                  : editMode === "view"
                    ? "default"
                    : "crosshair",
        }}
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onDoubleClick={onDoubleClick}
        onAuxClick={(e) => {
          // 가운데 버튼 기본 동작(자동 스크롤 등) 차단
          if (e.button === 1) e.preventDefault();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // 작도 모드: 아키캐드처럼 확인/취소 메뉴
          if (editMode !== "view") {
            openDrawMenu(e.clientX, e.clientY);
            return;
          }
          // 보기 모드: 꼭짓점 위 우클릭 → 곡선 토글 메뉴 / 삭제
          const rect = canvasRef.current!.getBoundingClientRect();
          const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
          const v = hitVertex(view, rings, w);
          if (v && v.kind !== "core") {
            // 중간점: 곡선 토글, 끝점: 삭제
            const verts = vertsOf(v.kind, v.id);
            if (v.index > 0 && v.index < verts.length - 1) {
              toggleCurveAt(v);
            } else {
              deleteVertex(v);
            }
            return;
          }
          if (v?.kind === "core") {
            deleteVertex(v);
            return;
          }
          // 핸들이 아닌 코어 본체(발자국) 위 우클릭도 삭제
          if (inputCores && inputCores.length > 0) {
            for (let i = inputCores.length - 1; i >= 0; i--) {
              const shape = coreShape(inputCores[i]);
              if (shape.length >= 3 && pointInPolygon(w, shape)) {
                deleteVertex({ kind: "core", index: i });
                return;
              }
            }
          }
        }}
        onMouseLeave={() => {
          // 가운데 팬 중이면 캔버스 밖에서도 이어서 움직이도록 window 로 넘김
          if (panRef.current?.button === 1) return;
          endPan();
          setDragVertex(null);
          setCursor(null);
          setHoverId(null);
        }}
        onWheel={(e) => {
          if (ctxMenu) setCtxMenu(null);
          onWheel(e);
        }}
      />

      {/* 아키캐드 스타일 우클릭 작도 메뉴 — 확인 / 취소 / 마지막 점 */}
      {ctxMenu && editMode !== "view" && (
        <div
          className="ctxMenu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="ctxOk"
            disabled={!canCommit}
            onClick={menuCommit}
            title={
              editMode === "core"
                ? "코어 배치를 끝내고 보기 모드로"
                : editMode === "boundary"
                  ? canCommit
                    ? "외곽선을 확정합니다"
                    : "최소 3점이 필요합니다"
                  : canCommit
                    ? "복도 중심선을 확정합니다"
                    : "최소 2점이 필요합니다"
            }
          >
            <span className="ctxLabel">확인</span>
            <kbd>Enter</kbd>
          </button>
          <button type="button" role="menuitem" onClick={menuCancel}>
            <span className="ctxLabel">취소</span>
            <kbd>Esc</kbd>
          </button>
          <div className="ctxSep" />
          <button
            type="button"
            role="menuitem"
            disabled={!canUndoLast}
            onClick={menuUndoLast}
            title={editMode === "core" ? "마지막 코어 제거" : "마지막 점 취소"}
          >
            <span className="ctxLabel">{editMode === "core" ? "마지막 코어 취소" : "마지막 점 취소"}</span>
            <kbd>⌫</kbd>
          </button>
        </div>
      )}

      <div className="canvasTools">
        <button onClick={fitView} title="화면에 맞춤">전체보기</button>
        {cursor && (
          <span className="coord">
            {cursor[0].toFixed(1)}, {cursor[1].toFixed(1)} m
          </span>
        )}
        {editMode === "view" && inputBoundary.length >= 3 && (!plan || staleParams) && (
          <span className="staleChip">
            {plan ? "입력이 바뀌었습니다 — 다시 생성하세요" : "입력 도형 — 평면 생성을 누르세요"}
          </span>
        )}
      </div>

      {/* 편집 안내는 핸들에 실제로 닿았을 때만 — 상시 띄우면 도면을 가린다 */}
      {editing && (tangled || dragVertex || hoverVertex || hoverMid) && (
        <div className={`drawHint${tangled ? " bad" : ""}`}>
          {tangled === "boundary"
            ? "외곽선이 자기 자신과 교차합니다 — 이대로 생성하면 형상이 보정됩니다"
            : tangled === "corridor"
              ? "복도 중심선이 자기 자신과 교차합니다"
              : hoverMid
                ? "클릭하면 이 자리에 점을 추가합니다"
                : "끌어서 이동 · 중간점 우클릭=곡선 토글 · 끝점 우클릭=삭제"}
          {!tangled && <em>Shift 직각</em>}
        </div>
      )}

      {editMode === "core" && !ctxMenu && (
        <div className="drawHint">
          {railLines.length > 0
            ? `복도 위를 클릭해 코어를 놓으세요 · 현재 ${inputCores?.length ?? 0}개`
            : "복도 중심선이 아직 없습니다 — 먼저 평면을 생성하거나 중심선을 그리세요"}
          <em>우클릭 확인/취소 · Esc 종료</em>
        </div>
      )}

      {editMode !== "view" && editMode !== "core" && !ctxMenu && (
        <div className={`drawHint${snap ? " snap" : ""}`}>
          {snap === "close"
            ? "클릭하면 외곽선을 닫고 확정합니다"
            : editMode === "boundary"
              ? draft.length < 3
                ? `클릭해서 점을 찍으세요 · ${draft.length}점 (최소 3점) · 다음: ${nextRole === "curve" ? "곡선점◆" : "모서리●"}`
                : `점 찍기 계속 · ${draft.length}점 · ${polygonArea(densifyClosedPath(draft, 12)).toFixed(1)} m² · 다음: ${nextRole === "curve" ? "곡선점◆" : "모서리●"}`
              : draft.length < 2
                ? `클릭해서 중심선을 추가 · ${draft.length}점 · 다음: ${nextRole === "curve" ? "곡선점◆" : "모서리●"}`
                : `점 찍기 계속 · 우클릭 확인 · ${draft.length}점 · 다음: ${nextRole === "curve" ? "곡선점◆" : "모서리●"}`}
          <em>C 곡선 토글 · Shift 직각 · Esc 취소</em>
        </div>
      )}

      {hovered && editMode === "view" && (
        <div className="tooltip">
          <strong>
            {hovered.id} · {hovered.type}
          </strong>
          <dl>
            <dt>전용면적</dt>
            <dd>
              {hovered.area.toFixed(1)} m²{" "}
              <em>
                (목표 {hovered.target_area} · {hovered.area_error > 0 ? "+" : ""}
                {hovered.area_error.toFixed(1)})
              </em>
            </dd>
            <dt>보행거리</dt>
            <dd>
              {hovered.travel_distance !== null
                ? `${hovered.travel_distance.toFixed(1)} m → ${hovered.nearest_core}`
                : "코어 연결 없음"}
            </dd>
            <dt>현관 유효폭</dt>
            <dd>{hovered.door_width.toFixed(2)} m</dd>
            <dt>외피 창면</dt>
            <dd>{hovered.facade_length.toFixed(1)} m</dd>
            <dt>장단변비</dt>
            <dd>{hovered.aspect_ratio.toFixed(2)}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
