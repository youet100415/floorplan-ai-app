"use client";

/** 메인 에디터 페이지 — 상태를 보관하고 캔버스/사이드바/지표 패널을 연결한다. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FloorCanvas, { type EditMode, type Overlays } from "@/components/FloorCanvas";
import InteriorApplyPanel from "@/components/InteriorApplyPanel";
import InteriorDrawPanel from "@/components/InteriorDrawPanel";
import MetricsPanel from "@/components/MetricsPanel";
import PlanDocCanvas from "@/components/PlanDocCanvas";
import UnitSettingsPanel from "@/components/UnitSettingsPanel";
import Sidebar from "@/components/Sidebar";
import {
  blankAuthorDocument,
  ensurePlanDocForUnit,
  planDocumentToExtrudeSolids,
  planDocumentToTemplate,
  planDocumentToUnitInterior,
  unitToPlanDocument,
  type OpeningKind,
  type PlanDocument,
  type ToolId,
} from "@/lib/plan";
import {
  API_BASE,
  explorePlans,
  fetchPresets,
  generatePlan,
  revisePlan,
  type Presets,
} from "@/utils/api";
import {
  addDoor,
  addFurniture,
  addRoom,
  autoFitAll,
  batchUpdateDoors,
  deleteUserTemplate,
  emptyInterior,
  fitTemplateToUnit,
  getTemplate,
  listTemplates,
  loadUserTemplates,
  pickTemplateForType,
  populationFromUnits,
  removeDoor,
  removeFurniture,
  removeRoom,
  runAgentLocal,
  saveUserTemplate,
  validatePlanDocument,
  validateUnitTemplate,
  type AgentMessage,
} from "@/utils/interior";
import { asCorners } from "@/utils/path";
import { makeDoc, type ProjectDoc } from "@/utils/project";
import { loadAutosave, saveAutosave } from "@/utils/storage";
import type { Mode } from "@/utils/palette";
import type {
  CoreSpec,
  CorridorPath,
  DoorCategory,
  DoorType,
  GenerateParams,
  InteriorTool,
  PathVertex,
  Plan,
  Pt,
  RoomKind,
  Underlay,
  UnitInterior,
  UnitTemplate,
  VertexRole,
} from "@/utils/types";
import type { Wall } from "@/lib/plan";

const DEFAULT_PARAMS: GenerateParams = {
  boundary: asCorners([
    [0, 0],
    [60, 0],
    [60, 22],
    [0, 22],
  ]),
  unit_mix: [
    { name: "1BR", target_area: 45, ratio: 0.3, min_width: 3.6 },
    { name: "2BR", target_area: 66, ratio: 0.4, min_width: 4.5 },
    { name: "3BR", target_area: 84, ratio: 0.3, min_width: 5.4 },
  ],
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

let corridorIdSeq = 0;
function newCorridorId(): string {
  corridorIdSeq += 1;
  return `c${Date.now().toString(36)}_${corridorIdSeq}`;
}

export default function EditorPage() {
  const [params, setParams] = useState<GenerateParams>(DEFAULT_PARAMS);
  const [presets, setPresets] = useState<Presets | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  /** 현재 결과를 만들어낸 파라미터 스냅샷. 이후 입력이 바뀌면 결과가 낡았음을 알린다. */
  const [generatedFrom, setGeneratedFrom] = useState<string | null>(null);
  const [options, setOptions] = useState<Plan[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState(8);
  const [mode, setMode] = useState<Mode>("light");
  const [editMode, setEditMode] = useState<EditMode>("view");
  const [draft, setDraft] = useState<PathVertex[]>([]);
  /** 다음에 찍을 점의 역할 — 곡선 모드면 3점 원호의 중간점. */
  const [nextRole, setNextRole] = useState<VertexRole>("corner");
  const [underlay, setUnderlay] = useState<Underlay | null>(null);
  const [underlayAction, setUnderlayAction] = useState<"move" | "calibrate" | null>(null);
  const [calibrationMm, setCalibrationMm] = useState(1000);
  const [underlayNotice, setUnderlayNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  /** 크기 편집 대상 코어. 도면에서 사각 핸들을 클릭하면 지정된다. */
  const [selectedCoreId, setSelectedCoreId] = useState<string | null>(null);
  /** 유닛별 내부 평면 (2단계 라이브러리 적용 결과). */
  const [interiors, setInteriors] = useState<Record<string, UnitInterior>>({});
  const [highlightedUnitIds, setHighlightedUnitIds] = useState<string[]>([]);
  const [agentLog, setAgentLog] = useState<string[]>([]);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  /**
   * 안 A 글로벌 워크스페이스
   * - unit: 유닛 에디터 (독립 캔버스 · 모듈 제작/저장)
   * - plan: 평면 완성 (조닝 → 유닛 배치)
   */
  type Workspace = "unit" | "plan";
  type PlanStep = "zoning" | "place";
  const [workspace, setWorkspace] = useState<Workspace>("plan");
  const [planStep, setPlanStep] = useState<PlanStep>("zoning");
  /** 레거시 호환: 1 조닝 · 2 유닛에디터 · 3 유닛배치 */
  const stage: 1 | 2 | 3 =
    workspace === "unit" ? 2 : planStep === "zoning" ? 1 : 3;
  const setStage = (s: 1 | 2 | 3) => {
    if (s === 1) {
      setWorkspace("plan");
      setPlanStep("zoning");
    } else if (s === 2) {
      setWorkspace("unit");
    } else {
      setWorkspace("plan");
      setPlanStep("place");
    }
  };
  const [userTemplates, setUserTemplates] = useState<UnitTemplate[]>([]);
  const [interiorTool, setInteriorTool] = useState<InteriorTool>("select");
  const [interiorRoomKind, setInteriorRoomKind] = useState<RoomKind>("living");
  const [interiorDoorCategory, setInteriorDoorCategory] = useState<DoorCategory>("entrance");
  const [interiorDoorWidth, setInteriorDoorWidth] = useState(0.9);
  const [interiorFurnId, setInteriorFurnId] = useState("sofa_2000");
  const [interiorDraft, setInteriorDraft] = useState<Pt[]>([]);
  /** 유닛별 Rayon PlanDocument — 적용 후 편집·3D 소스 */
  const [planDocs, setPlanDocs] = useState<Record<string, PlanDocument>>({});
  const [planTool, setPlanTool] = useState<ToolId>("zone");
  const [planOpeningKind, setPlanOpeningKind] = useState<OpeningKind>("door-single");
  /** 내부 그리기 탭 전용 캔버스 */
  const [authorDoc, setAuthorDoc] = useState<PlanDocument>(() =>
    blankAuthorDocument(8.4, 7.2, 0.2, "새 내부 평면"),
  );
  const [authorW, setAuthorW] = useState(8.4);
  const [authorD, setAuthorD] = useState(7.2);
  const [authorSaveName, setAuthorSaveName] = useState("");
  const [authorTypeHint, setAuthorTypeHint] = useState("2BR");
  const [authorGen, setAuthorGen] = useState(0);
  const [unitEditorDockLeft, setUnitEditorDockLeft] = useState(false);

  const agentId = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  useEffect(() => {
    setUserTemplates(loadUserTemplates());
  }, []);

  // ------------------------------------------------------------ 프로젝트 저장
  const [projectName, setProjectName] = useState("제목 없음");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  /** 마지막으로 서버/파일에 저장한 내용. 이것과 다르면 '저장 안 됨'. */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<Overlays>({
    labels: true,
    dims: true,
    graph: false,
    travel: false,
    doors: true,
    grid: true,
    underlay: true,
    interiors: true,
    zones: true,
    egress: false,
  });

  const [themeLocked, setThemeLocked] = useState(false);
  useEffect(() => {
    if (themeLocked) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setMode(mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [themeLocked]);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  useEffect(() => {
    fetchPresets()
      .then(setPresets)
      .catch(() =>
        setError(`백엔드에 연결하지 못했습니다 (${API_BASE}). backend 디렉터리에서 uvicorn을 실행하세요.`),
      );
  }, []);

  const patch = useCallback((p: Partial<GenerateParams>) => {
    setParams((prev) => ({ ...prev, ...p }));
  }, []);

  /**
   * 생성/탐색 실행. override 를 주면 그 파라미터로 돌린다 — setParams 는 다음
   * 렌더에야 반영되므로, 값을 바꾸면서 곧바로 재생성할 때 필요하다.
   */
  const run = useCallback(
    async (explore: boolean, override?: GenerateParams) => {
      const p = override ?? params;
      setBusy(true);
      setError(null);
      try {
        if (explore) {
          const res = await explorePlans(p, variants);
          setOptions(res.options);
          setActiveIndex(0);
          setPlan(res.options[0]);
        } else {
          const res = await generatePlan(p);
          setOptions([]);
          setActiveIndex(0);
          setPlan(res);
        }
        setGeneratedFrom(JSON.stringify(p));
        setSelectedId(null);
        setSelectedUnitIds([]);
        setInteriors({});
        setHighlightedUnitIds([]);
        setAgentLog([]);
        setAgentMessages([]);
        setPlanDocs({});
        // 생성 직후에는 1단계에 머물고, 상단/하단 CTA 로 2단계 진입
        setStage(1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [params, variants],
  );

  const handleSelectUnit = useCallback((id: string | null, additive?: boolean) => {
    if (!id) {
      setSelectedId(null);
      if (!additive) setSelectedUnitIds([]);
      return;
    }
    setSelectedId(id);
    setSelectedUnitIds((prev) => {
      if (additive) {
        return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      }
      return [id];
    });
  }, []);

  const handleWallMove = useCallback(
    async (edits: { id: string; polygon: Pt[] }[]) => {
      if (!plan || edits.length === 0) return;
      const map = new Map(edits.map((e) => [e.id, e.polygon]));
      const units = plan.units.map((u) => ({
        id: u.id,
        type: u.type,
        polygon: map.get(u.id) ?? u.polygon,
      }));
      setBusy(true);
      setError(null);
      try {
        const next = await revisePlan(
          plan,
          params.unit_mix,
          {
            max_travel_distance: params.max_travel_distance,
            min_facade_width: params.min_facade_width,
            wall_thickness_external: params.wall_thickness_external,
            wall_thickness_internal: params.wall_thickness_internal,
          },
          units,
        );
        setPlan(next);
        setOptions([]);
        // 내부 평면은 폴리곤이 바뀌면 무효 — 같은 템플릿 있으면 재피팅
        setInteriors((prev) => {
          const out: Record<string, UnitInterior> = {};
          for (const u of next.units) {
            const old = prev[u.id];
            if (old?.templateId) {
              const tpl = getTemplate(old.templateId);
              if (tpl) out[u.id] = fitTemplateToUnit(u, tpl);
            }
          }
          return out;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [plan, params],
  );

  const applyLibraryTemplate = useCallback(
    (templateId: string, scope: "selected" | "type" | "all") => {
      if (!plan) {
        setError("먼저 평면을 생성하세요.");
        return;
      }
      const tpl =
        getTemplate(templateId) ?? userTemplates.find((t) => t.id === templateId);
      if (!tpl) return;
      if (tpl.validation?.placeable === false) {
        setError(
          `「${tpl.name}」은(는) 배치 불가 상태입니다. 유닛 에디터에서 오류를 수정한 뒤 다시 저장하세요.`,
        );
        return;
      }
      const targets =
        scope === "all"
          ? plan.units
          : scope === "selected"
            ? plan.units.filter((u) => selectedUnitIds.includes(u.id) || u.id === selectedId)
            : plan.units.filter(
                (u) =>
                  u.type.toUpperCase().includes((tpl.unitTypeHint ?? "").toUpperCase()) ||
                  (tpl.unitTypeHint ?? "") === "",
              );
      if (targets.length === 0) {
        setError("적용할 유닛이 없습니다. 도면에서 세대를 선택하세요.");
        return;
      }
      setInteriors((prev) => {
        const next = { ...prev };
        for (const u of targets) next[u.id] = fitTemplateToUnit(u, tpl);
        return next;
      });
      // Rayon PlanDocument 동기 (3D 소스)
      setPlanDocs((prev) => {
        const next = { ...prev };
        for (const u of targets) {
          const it = fitTemplateToUnit(u, tpl);
          next[u.id] = unitToPlanDocument(u, it, {
            wallThickness: params.wall_thickness_external || 0.2,
          });
        }
        return next;
      });
      setOverlays((o) => ({ ...o, interiors: true, zones: true }));
      setHighlightedUnitIds(targets.map((u) => u.id));
      setAgentLog((logs) => [
        `${tpl.name} → ${targets.length}개 유닛 적용 (${scope})`,
        ...logs,
      ].slice(0, 12));
      setError(null);
      window.setTimeout(() => setHighlightedUnitIds([]), 2200);
    },
    [plan, selectedId, selectedUnitIds, userTemplates, params.wall_thickness_external],
  );

  const applyAutoInteriors = useCallback(() => {
    if (!plan) {
      setError("먼저 평면을 생성하세요.");
      return;
    }
    const next = autoFitAll(plan.units, pickTemplateForType);
    setInteriors(next);
    setPlanDocs(() => {
      const docs: Record<string, PlanDocument> = {};
      for (const u of plan.units) {
        docs[u.id] = unitToPlanDocument(u, next[u.id], {
          wallThickness: params.wall_thickness_external || 0.2,
        });
      }
      return docs;
    });
    setOverlays((o) => ({ ...o, interiors: true, zones: true }));
    setHighlightedUnitIds(plan.units.map((u) => u.id));
    setAgentLog((logs) => [`타입별 자동 템플릿 ${plan.units.length}호 적용`, ...logs].slice(0, 12));
    window.setTimeout(() => setHighlightedUnitIds([]), 2200);
  }, [plan, params.wall_thickness_external]);

  const clearInteriors = useCallback(() => {
    setInteriors({});
    setAgentLog((logs) => ["내부 평면 모두 제거", ...logs].slice(0, 12));
  }, []);

  const batchDoorUpdate = useCallback(
    (
      category: "all" | "entrance" | "bathroom" | "bedroom",
      width: number,
      type: DoorType = "swing_left",
    ) => {
      if (!plan) return;
      const groups = new Set(
        Object.values(interiors)
          .map((i) => i.linkedGroupId ?? i.templateId)
          .filter(Boolean) as string[],
      );
      if (groups.size === 0) {
        setError("내부 평면이 없습니다. 라이브러리를 먼저 적용하세요.");
        return;
      }
      const polys: Record<string, Pt[]> = {};
      for (const u of plan.units) polys[u.id] = u.polygon;
      let merged = { ...interiors };
      const allLogs: string[] = [];
      const allIds: string[] = [];
      for (const g of groups) {
        const { next, logs, updatedIds } = batchUpdateDoors(
          merged,
          g,
          category,
          { width, type },
          polys,
        );
        merged = next;
        allLogs.push(...logs);
        allIds.push(...updatedIds);
      }
      setInteriors(merged);
      setHighlightedUnitIds(allIds);
      setAgentLog((logs) => [...allLogs, ...logs].slice(0, 12));
      setOverlays((o) => ({ ...o, interiors: true }));
      window.setTimeout(() => setHighlightedUnitIds([]), 2200);
    },
    [plan, interiors],
  );

  const population = useMemo(
    () => (plan ? populationFromUnits(plan.units) : []),
    [plan],
  );

  const selectedInterior = selectedId ? interiors[selectedId] : null;
  const selectedUnit = plan && selectedId ? plan.units.find((u) => u.id === selectedId) ?? null : null;
  const selectedPlanDoc = selectedId ? planDocs[selectedId] : undefined;

  /** PlanDocument 편집 → UnitInterior + 3D 스펙 동기화 */
  const updatePlanDoc = useCallback(
    (unitId: string, doc: PlanDocument) => {
      if (!plan) return;
      const unit = plan.units.find((u) => u.id === unitId);
      if (!unit) return;
      setPlanDocs((prev) => ({ ...prev, [unitId]: doc }));
      const nextInterior = planDocumentToUnitInterior(unit, doc);
      setInteriors((prev) => ({ ...prev, [unitId]: nextInterior }));
      setOverlays((o) => ({ ...o, interiors: true, zones: true }));
      // 3D 연동 준비: 콘솔/추후 API — solids 개수만 로깅
      if (typeof window !== "undefined" && (window as unknown as { __FP_DEBUG_3D?: boolean }).__FP_DEBUG_3D) {
        console.debug("[3d-solids]", unitId, planDocumentToExtrudeSolids(doc).length);
      }
    },
    [plan],
  );

  /** 적용 탭: 유닛 선택 시 PlanDocument 보장 */
  useEffect(() => {
    if (stage !== 3 || !plan || !selectedId) return;
    const unit = plan.units.find((u) => u.id === selectedId);
    if (!unit) return;
    setPlanDocs((prev) => {
      if (prev[selectedId]?.walls.length) return prev;
      const doc = ensurePlanDocForUnit(
        unit,
        prev[selectedId],
        interiors[selectedId],
        params.wall_thickness_external || 0.2,
      );
      queueMicrotask(() => {
        setInteriors((ip) => {
          if (ip[selectedId]?.rooms.length) return ip;
          return { ...ip, [selectedId]: planDocumentToUnitInterior(unit, doc) };
        });
      });
      return { ...prev, [selectedId]: doc };
    });
  }, [stage, plan, selectedId, interiors, params.wall_thickness_external]);

  /** 내부 그리기 탭 — 건물 평면 없어도 가능 */
  const enterStageDraw = useCallback(() => {
    setStage(2);
    setEditMode("view");
    setDraft([]);
    setPlanTool("zone");
    setError(null);
  }, []);

  /** 내부 적용 탭 — 구획 평면 필요 */
  const enterStageApply = useCallback(() => {
    if (!plan) {
      setError("먼저 1단계 조닝에서 평면을 생성하세요.");
      return;
    }
    setStage(3);
    setEditMode("view");
    setDraft([]);
    setOverlays((o) => ({
      ...o,
      interiors: true,
      zones: true,
      travel: false,
      graph: false,
      egress: true,
    }));
    setError(null);
    if (agentMessages.length === 0) {
      setAgentMessages([
        {
          id: agentId(),
          role: "agent",
          text: "저장된 내부 평면을 유닛에 적용한 뒤, 문으로 일괄 수정할 수 있습니다.",
          details: [
            "「내부 그리기」에서 만든 저장본을 위 목록에서 고르세요.",
            "예: 모든 욕실·현관 문을 스윙으로. 욕실 34인치, 현관 36인치",
          ],
        },
      ]);
    }
  }, [plan, agentMessages.length]);

  const enterStage2 = enterStageApply;

  const autoTraceWallsFromUnderlay = useCallback(() => {
    if (!underlay?.src) {
      setUnderlayNotice("먼저 도면 이미지를 선택해 주세요.");
      return;
    }
    const image = new Image();
    image.onload = () => {
      const maxSide = 900;
      const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * ratio));
      const height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const dark = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 < 150 && pixels[i + 3] > 40;
      };
      const horizontal: Wall[] = [];
      const vertical: Wall[] = [];
      const thickness = 0.2;
      const imageHeightM = underlay.heightM ?? underlay.widthM * (height / width);
      const toPoint = (x: number, y: number) => ({
        x: underlay.origin[0] + (x / width) * underlay.widthM,
        y: underlay.origin[1] + (y / height) * imageHeightM,
      });
      const addRuns = (axis: "h" | "v") => {
        const limit = axis === "h" ? height : width;
        const span = axis === "h" ? width : height;
        const candidates: { index: number; start: number; end: number }[] = [];
        for (let i = 0; i < limit; i += 1) {
          let start = -1;
          let end = -1;
          for (let j = 0; j < span; j += 1) {
            const isDark = axis === "h" ? dark(j, i) : dark(i, j);
            if (isDark && start < 0) start = j;
            if (!isDark && start >= 0) { end = j - 1; break; }
          }
          if (start >= 0 && end < 0) end = span - 1;
          if (start >= 0 && end - start >= span * 0.2) candidates.push({ index: i, start, end });
        }
        let cluster: typeof candidates = [];
        const flush = () => {
          if (!cluster.length) return;
          const middle = cluster[Math.floor(cluster.length / 2)];
          const first = Math.min(...cluster.map((v) => v.start));
          const last = Math.max(...cluster.map((v) => v.end));
          const a = axis === "h" ? toPoint(first, middle.index) : toPoint(middle.index, first);
          const b = axis === "h" ? toPoint(last, middle.index) : toPoint(middle.index, last);
          const wall: Wall = { id: `auto-wall-${Date.now()}-${axis}-${middle.index}`, a, b, thickness, align: "center", storyId: "story-1" };
          (axis === "h" ? horizontal : vertical).push(wall);
          cluster = [];
        };
        candidates.forEach((candidate, index) => {
          if (!cluster.length || candidate.index - candidates[index - 1].index <= 3) cluster.push(candidate);
          else { flush(); cluster.push(candidate); }
        });
        flush();
      };
      addRuns("h");
      addRuns("v");
      const walls = [...horizontal, ...vertical];
      if (!walls.length) {
        setUnderlayNotice("뚜렷한 벽 선을 찾지 못했습니다. 대비가 높은 이미지로 다시 시도해 주세요.");
        return;
      }
      setAuthorDoc((current) => ({ ...current, walls, openings: [], name: current.name }));
      setUnderlayNotice(`벽체 ${walls.length}개를 추출했습니다. 두께 200mm 기준이며 검토 후 수정해 주세요.`);
    };
    image.onerror = () => setUnderlayNotice("도면 이미지를 분석하지 못했습니다.");
    image.src = underlay.src;
  }, [underlay]);

  const saveAuthorToLibrary = useCallback(() => {
    const name = authorSaveName.trim() || `유닛 모듈 ${new Date().toLocaleString("ko-KR")}`;
    const docCheck = validatePlanDocument({ ...authorDoc, name });
    // 외곽 자체가 없으면 초안 저장도 불가
    if (!authorDoc.siteBoundary || authorDoc.siteBoundary.length < 3) {
      setError(
        `저장 불가: ${docCheck.errors.map((e) => e.message).join(" · ") || "외곽선이 필요합니다."}`,
      );
      return;
    }
    let tpl = planDocumentToTemplate(authorDoc, name, authorTypeHint.trim() || undefined);
    const tplCheck = validateUnitTemplate(tpl);
    const validation = {
      is_valid: docCheck.is_valid && tplCheck.is_valid,
      placeable: docCheck.placeable && tplCheck.placeable,
      errors: [...docCheck.errors, ...tplCheck.errors],
      warnings: [...docCheck.warnings, ...tplCheck.warnings],
      validated_at: new Date().toISOString(),
    };
    // 명세: 오류 있어도 draft 저장 가능. placeable/published 만 엄격 게이트.
    tpl = {
      ...tpl,
      validation,
      status: validation.placeable ? (validation.is_valid ? "published" : "valid") : "draft",
    };
    const next = saveUserTemplate(tpl);
    setUserTemplates(next);
    setAuthorSaveName("");
    const statusNote = !validation.placeable
      ? `초안(draft) 저장 · 배치 불가 · 오류 ${validation.errors.length}건`
      : validation.warnings.length > 0
        ? `경고 ${validation.warnings.length}건 · 배치 가능(${tpl.status})`
        : "검증 통과 · 배치 가능(published)";
    setError(
      !validation.placeable
        ? `라이브러리에 초안으로 저장됨 (배치 불가): ${validation.errors
            .slice(0, 3)
            .map((e) => e.message)
            .join(" · ")}`
        : null,
    );
    setAgentMessages((prev) => [
      ...prev,
      {
        id: agentId(),
        role: "agent",
        text: `유닛 라이브러리 저장: 「${tpl.name}」`,
        details: [
          `${tpl.rooms.length}실 · 문 ${tpl.doors.length} · ${statusNote}`,
          "평면 완성 → 유닛 배치에서 모듈을 선택해 적용하세요.",
          ...validation.errors.slice(0, 3).map((e) => `✗ ${e.message}`),
          ...validation.warnings.slice(0, 3).map((w) => `⚠ ${w.message}`),
        ],
        summaryCard: {
          title: "Saved to Unit Library",
          changes: [
            tpl.name,
            `${tpl.bbox.w.toFixed(1)}×${tpl.bbox.d.toFixed(1)} m`,
            `status: ${tpl.status}`,
          ],
          unitIds: [],
        },
      },
    ]);
  }, [authorDoc, authorSaveName, authorTypeHint]);

  const runArchie = useCallback(
    (text: string) => {
      if (!plan) return;
      const userMsg: AgentMessage = { id: agentId(), role: "user", text };
      setAgentMessages((prev) => [...prev, userMsg]);
      setAgentBusy(true);

      // 짧은 딜레이로 영상처럼 "연산 중" 체감
      window.setTimeout(() => {
        const polys: Record<string, Pt[]> = {};
        for (const u of plan.units) polys[u.id] = u.polygon;

        let current = interiors;
        // 문 변경인데 내부가 없으면 영상처럼 먼저 템플릿을 깔고 진행
        if (Object.keys(current).length === 0 && /문|door|스윙|swing|욕실|현관|bath|entrance/i.test(text)) {
          current = autoFitAll(plan.units, pickTemplateForType);
        }

        let result = runAgentLocal(text, current, polys, {
          onApplyAuto: () => autoFitAll(plan.units, pickTemplateForType),
        });
        // 파서가 update_doors 인데 여전히 비면 자동 배치 후 재시도
        if (!result.ok && Object.keys(result.nextInteriors).length === 0) {
          current = autoFitAll(plan.units, pickTemplateForType);
          result = runAgentLocal(text, current, polys, {
            onApplyAuto: () => autoFitAll(plan.units, pickTemplateForType),
          });
        }

        setInteriors(result.nextInteriors);
        if (result.updatedUnitIds.length > 0) {
          setHighlightedUnitIds(result.updatedUnitIds);
          setOverlays((o) => ({ ...o, interiors: true, zones: true }));
          window.setTimeout(() => setHighlightedUnitIds([]), 2800);
        }

        const details = result.details.slice(0, 16);
        const agentMsg: AgentMessage = {
          id: agentId(),
          role: "agent",
          text: result.summary,
          details: details.length > 0 ? details : undefined,
          summaryCard: result.ok
            ? {
                title: "Changes Made",
                changes: [
                  result.summary,
                  result.doorCounts.total > 0
                    ? `Bathroom doors: ${result.doorCounts.bathroom} · Entrance: ${result.doorCounts.entrance} · Total: ${result.doorCounts.total}`
                    : `Updated units: ${result.updatedUnitIds.length}`,
                ],
                unitIds: result.updatedUnitIds,
                doorCounts: {
                  bathroom: result.doorCounts.bathroom,
                  entrance: result.doorCounts.entrance,
                  total: result.doorCounts.total,
                },
              }
            : undefined,
        };
        setAgentMessages((prev) => [...prev, agentMsg]);
        setAgentLog((logs) => [result.summary, ...logs].slice(0, 12));
        setAgentBusy(false);
        setError(null);
      }, 450);
    },
    [plan, interiors],
  );

  const enterStage1 = useCallback(() => {
    setStage(1);
    setEditMode("view");
    setInteriorTool("select");
    setInteriorDraft([]);
  }, []);

  /** planDocument 선택 시 ensure — 적용 탭(3)에서만 */
  // (아래 useEffect stage === 3 으로 교체)

  const patchSelectedInterior = useCallback(
    (fn: (unit: NonNullable<Plan["units"][0]>, it: UnitInterior | null) => UnitInterior) => {
      if (!plan || !selectedId) {
        setError("유닛을 먼저 선택하세요.");
        return;
      }
      const unit = plan.units.find((u) => u.id === selectedId);
      if (!unit) return;
      setInteriors((prev) => {
        const next = fn(unit, prev[selectedId] ?? null);
        return { ...prev, [selectedId]: next };
      });
      setOverlays((o) => ({ ...o, interiors: true, zones: true }));
      setError(null);
    },
    [plan, selectedId],
  );

  const startEmptyInterior = useCallback(() => {
    patchSelectedInterior((unit) => emptyInterior(unit));
    setInteriorTool("room");
  }, [patchSelectedInterior]);

  const commitRoomDraft = useCallback(() => {
    if (interiorDraft.length < 3) return;
    patchSelectedInterior((unit, it) => addRoom(unit, it, interiorDraft, interiorRoomKind));
    setInteriorDraft([]);
  }, [interiorDraft, interiorRoomKind, patchSelectedInterior]);

  const placeDoor = useCallback(
    (at: Pt) => {
      patchSelectedInterior((unit, it) =>
        addDoor(unit, it, at, interiorDoorCategory, interiorDoorWidth, "swing_left"),
      );
    },
    [interiorDoorCategory, interiorDoorWidth, patchSelectedInterior],
  );

  const placeFurn = useCallback(
    (at: Pt) => {
      patchSelectedInterior((unit, it) => addFurniture(unit, it, interiorFurnId, at));
    },
    [interiorFurnId, patchSelectedInterior],
  );

  // 적용 탭 레거시 실 드래프트 Enter / Esc
  useEffect(() => {
    if (stage !== 3) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.tagName === "SELECT"))
        return;
      if (e.key === "Enter" && interiorTool === "room" && interiorDraft.length >= 3) {
        e.preventDefault();
        commitRoomDraft();
      }
      if (e.key === "Escape" && interiorDraft.length > 0) {
        e.preventDefault();
        setInteriorDraft([]);
      }
      if ((e.key === "Backspace" || e.key === "Delete") && interiorTool === "room" && interiorDraft.length > 0) {
        e.preventDefault();
        setInteriorDraft((d) => d.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, interiorTool, interiorDraft, commitRoomDraft]);

  /** 결과 패널의 세대수 ± — 목표를 바꾸고 곧바로 그 값으로 다시 생성한다. */
  const setUnitCountTarget = useCallback(
    (n: number | null) => {
      const next = { ...params, unit_count_target: n };
      setParams(next);
      void run(false, next);
    },
    [params, run],
  );

  const coresSnapshotRef = useRef<CoreSpec[] | null | undefined>(undefined);

  const startDraw = (m: EditMode) => {
    coresSnapshotRef.current = undefined;
    setEditMode(m);
    setDraft([]);
    setNextRole("corner");
  };

  const commitDraw = () => {
    if (editMode === "boundary") {
      if (draft.length < 3) return;
      patch({ boundary: draft, corridors: null });
      setPlan(null);
      setGeneratedFrom(null);
      setOptions([]);
    } else if (editMode === "corridor") {
      if (draft.length < 2) return;
      setParams((prev) => {
        const next: CorridorPath = {
          id: newCorridorId(),
          vertices: draft.map((v) => ({ p: [v.p[0], v.p[1]] as Pt, role: v.role })),
          strategy: prev.strategy,
        };
        return { ...prev, corridors: [...(prev.corridors ?? []), next] };
      });
    } else if (editMode === "core") {
      coresSnapshotRef.current = undefined;
    } else if (editMode === "coreOutline") {
      if (draft.length < 3) return;
      // 자유 외곽 코어. 앵커는 외곽선 중심 — 이동·정사영의 기준점이 된다.
      const pts = draft.map((v) => v.p);
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      setParams((prev) => ({
        ...prev,
        cores: [
          ...(prev.cores ?? []),
          {
            id: `core-${Date.now().toString(36)}`,
            anchor: [cx, cy] as Pt,
            length: prev.core_length,
            reach: prev.core_reach,
            outline: pts,
          },
        ],
      }));
      coresSnapshotRef.current = undefined;
    } else {
      return;
    }
    setEditMode("view");
    setDraft([]);
    setNextRole("corner");
  };

  const cancelDraw = () => {
    if (
      (editMode === "core" || editMode === "coreOutline") &&
      coresSnapshotRef.current !== undefined
    ) {
      const snap = coresSnapshotRef.current;
      patch({ cores: snap && snap.length > 0 ? snap.map((c) => ({ ...c })) : null });
      coresSnapshotRef.current = undefined;
    }
    setEditMode("view");
    setDraft([]);
    setNextRole("corner");
  };

  const editGeometry = (
    kind: "boundary" | "corridor",
    data: PathVertex[],
    pathId?: string,
  ) => {
    if (kind === "boundary") {
      patch({ boundary: data });
      return;
    }
    if (!pathId) return;
    setParams((prev) => {
      const list = prev.corridors ?? [];
      if (data.length < 2) {
        const next = list.filter((c) => c.id !== pathId);
        return { ...prev, corridors: next.length > 0 ? next : null };
      }
      return {
        ...prev,
        corridors: list.map((c) => (c.id === pathId ? { ...c, vertices: data } : c)),
      };
    });
  };

  /** 코어 목록 갱신. 비면 자동 배치로 되돌린다. */
  const editCores = (cores: CoreSpec[]) => {
    patch({ cores: cores.length > 0 ? cores : null });
  };

  /** 선택된 코어의 크기(또는 다른 속성) 수정. */
  const patchCore = (id: string, p: Partial<CoreSpec>) => {
    setParams((prev) => ({
      ...prev,
      cores: (prev.cores ?? []).map((c) => (c.id === id ? { ...c, ...p } : c)),
    }));
  };

  /** 수동 코어 하나 삭제. 비면 자동 배치로 되돌린다. */
  const removeCore = useCallback((id: string) => {
    setParams((prev) => {
      const next = (prev.cores ?? []).filter((c) => c.id !== id);
      return { ...prev, cores: next.length > 0 ? next : null };
    });
    setSelectedCoreId((cur) => (cur === id ? null : cur));
  }, []);

  const removeCorridor = (pathId: string) => {
    setParams((prev) => {
      const next = (prev.corridors ?? []).filter((c) => c.id !== pathId);
      return { ...prev, corridors: next.length > 0 ? next : null };
    });
  };

  /**
   * 코어 배치/외곽 그리기 시작. 아직 수동 코어가 없으면 결과의 자동 배치를
   * 출발점으로 가져온다 — 빈 화면에서 처음부터 찍는 것보다 조정이 쉽다.
   */
  const startCores = (m: "core" | "coreOutline") => {
    coresSnapshotRef.current =
      params.cores === null ? null : params.cores.map((c) => ({ ...c }));
    if (params.cores === null && m === "core") {
      const seeded: CoreSpec[] = (plan?.cores ?? []).map((c, i) => ({
        id: `core-seed-${i}`,
        anchor: c.anchor,
        length: params.core_length,
        reach: params.core_reach,
        outline: null,
      }));
      patch({ cores: seeded });
    }
    setEditMode(m);
    setDraft([]);
    setNextRole("corner");
  };

  const loadUnderlay = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result ?? "");
      if (!src) return;
      // 기본: 현재 외곽선 가로에 맞춤 (대략)
      const xs = params.boundary.map((v) => v.p[0]);
      const ys = params.boundary.map((v) => v.p[1]);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const image = new Image();
      image.onload = () => {
        const aspectRatio = image.naturalWidth / Math.max(image.naturalHeight, 1);
        const isUnitEditor = stage === 2;
        const availableW = isUnitEditor ? authorW : Math.max(maxX - minX, 10);
        const availableH = isUnitEditor ? authorD : Math.max(Math.max(...ys) - minY, 10);
        // Fit to the active canvas while preserving the image's original ratio.
        const widthM = Math.min(availableW, availableH * aspectRatio);
        const heightM = widthM / aspectRatio;
        setUnderlay({
          src,
          origin: isUnitEditor ? [0, 0] : [minX, minY],
          widthM,
          heightM,
          aspectRatio,
          lockAspectRatio: true,
          opacity: 0.45,
          visible: true,
          locked: true,
        });
        setOverlays((o) => ({ ...o, underlay: true }));
      };
      image.src = src;
    };
    reader.readAsDataURL(file);
  };

  // 보기 모드: 선택한 코어 Delete / Backspace 로 삭제
  useEffect(() => {
    if (editMode !== "view") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedCoreId) {
        e.preventDefault();
        removeCore(selectedCoreId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode, selectedCoreId, removeCore]);

  // 작도 중 Esc / Enter / Backspace / C(곡선 토글)
  useEffect(() => {
    if (editMode === "view") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      if (e.key === "Escape") {
        cancelDraw();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        commitDraw();
        return;
      }
      if (e.key === "c" || e.key === "C") {
        if (editMode === "boundary" || editMode === "corridor") {
          e.preventDefault();
          setNextRole((r) => (r === "curve" ? "corner" : "curve"));
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (editMode === "core") {
          // 선택 코어가 있으면 그것만, 없으면 마지막 코어 제거
          if (selectedCoreId) {
            removeCore(selectedCoreId);
            return;
          }
          setParams((prev) => {
            const pts = prev.cores ?? [];
            if (pts.length === 0) return prev;
            const next = pts.slice(0, -1);
            return { ...prev, cores: next.length > 0 ? next : null };
          });
        } else {
          setDraft((d) => d.slice(0, -1));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className={`app workspace-${workspace} planstep-${planStep}`}>
      <header className="topbar topbarGlobal">
        <h1>
          Floorplan<span>AI</span>
        </h1>

        {/* 글로벌: 유닛 에디터 | 평면 완성 */}
        <nav className="globalTabs" aria-label="워크스페이스">
          <button
            type="button"
            className={`globalTab${workspace === "unit" ? " on" : ""}`}
            onClick={enterStageDraw}
            title="방/유닛 모듈을 단독으로 그리고 저장"
          >
            <span className="globalTabIcon" aria-hidden>
              ▦
            </span>
            <span className="globalTabText">
              <strong>유닛 에디터</strong>
              <em>모듈 제작 · 저장 · 학습</em>
            </span>
          </button>
          <button
            type="button"
            className={`globalTab${workspace === "plan" ? " on" : ""}`}
            onClick={() => {
              setWorkspace("plan");
              if (!plan) setPlanStep("zoning");
            }}
            title="건물 조닝 후 유닛 배치"
          >
            <span className="globalTabIcon" aria-hidden>
              ▣
            </span>
            <span className="globalTabText">
              <strong>평면 완성</strong>
              <em>조닝 · 유닛 배치</em>
            </span>
          </button>
        </nav>

        <div className="topActions">
          {workspace === "unit" && (
            <span className="scorePill">
              라이브러리 <strong>{userTemplates.length}</strong>
            </span>
          )}
          {workspace === "plan" && planStep === "zoning" && plan && (
            <span className="scorePill">
              건물 점수 <strong>{plan.score.toFixed(1)}</strong>
            </span>
          )}
          {workspace === "plan" && planStep === "place" && plan && (
            <span className="scorePill">
              배치 {Object.keys(interiors).length}/{plan.units.length}호
              {selectedInterior?.score && (
                <>
                  {" "}
                  · 선택 <strong>{selectedInterior.score.total}%</strong>
                </>
              )}
            </span>
          )}
          <button
            className="ghost"
            onClick={() => {
              setThemeLocked(true);
              setMode(mode === "light" ? "dark" : "light");
            }}
          >
            {mode === "light" ? "다크" : "라이트"}
          </button>
        </div>
      </header>

      {/* 평면 완성 내부 스텝 */}
      {workspace === "plan" && (
        <div className="planStepBar">
          <nav className="planSteps" aria-label="평면 완성 단계">
            <button
              type="button"
              className={`planStep${planStep === "zoning" ? " on" : ""}`}
              onClick={enterStage1}
            >
              <span className="stageNum">1</span>
              조닝
              <em>건물 구역 · 복도 · 코어</em>
            </button>
            <span className="planStepArrow" aria-hidden>
              →
            </span>
            <button
              type="button"
              className={`planStep${planStep === "place" ? " on" : ""}`}
              disabled={!plan}
              title={plan ? "유닛 에디터 모듈을 존에 배치" : "먼저 조닝에서 평면을 생성하세요"}
              onClick={enterStageApply}
            >
              <span className="stageNum">2</span>
              유닛 배치
              <em>라이브러리 모듈 적용</em>
            </button>
          </nav>
          {plan && planStep === "zoning" && (
            <button type="button" className="primary" onClick={enterStageApply}>
              유닛 배치로 →
            </button>
          )}
          {planStep === "place" && (
            <button type="button" className="ghost" onClick={enterStageDraw}>
              유닛 에디터 열기
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="errorBar" role="alert">
          {error}
        </div>
      )}

      {workspace === "plan" && planStep === "zoning" && plan && (
        <div className="stageNudge">
          <span>조닝 완료 — 유닛 에디터에서 만든 모듈을 배치하거나, 바로 유닛 배치로 이동하세요.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={enterStageDraw}>
              유닛 에디터
            </button>
            <button type="button" className="primary" onClick={enterStageApply}>
              유닛 배치 →
            </button>
          </div>
        </div>
      )}

      <main className={`layout${stage !== 1 ? " layoutStage2" : ""}${stage === 2 ? " unitEditorLayout" : ""}${stage === 2 && unitEditorDockLeft ? " editorDockLeft" : ""}`}>
        {stage === 2 && (
          <nav className="editorRail" aria-label="도면 작업 메뉴">
            <button type="button" className="editorRailItem" aria-label="템플릿">
              <span>▤</span><em>템플릿</em>
            </button>
            <button type="button" className="editorRailItem active" aria-current="page" aria-pressed={unitEditorDockLeft} aria-label="도면 그리기" onClick={() => setUnitEditorDockLeft((value) => !value)}>
              <span>▦</span><em>도면 그리기</em>
            </button>
            <button type="button" className="editorRailItem" aria-label="제품">
              <span>◇</span><em>제품</em>
            </button>
            <button type="button" className="editorRailItem" aria-label="마감재">
              <span>▧</span><em>마감재</em>
            </button>
            <button type="button" className="editorRailItem" aria-label="설계형 라이브러리">
              <span>⚒</span><em>설계형<br />라이브러리</em>
            </button>
            <button type="button" className="editorRailItem railBottom" aria-label="리소스 관리">
              <span>▱</span><em>리소스 관리</em>
            </button>
          </nav>
        )}
        {stage === 1 && (
          <Sidebar
            params={params}
            onChange={patch}
            mode={mode}
            boundaries={presets?.boundaries ?? []}
            onPickBoundary={(coords) => {
              patch({ boundary: asCorners(coords), corridors: null });
              setPlan(null);
              setGeneratedFrom(null);
              setOptions([]);
              setStage(1);
              setInteriors({});
              setPlanDocs({});
            }}
            editMode={editMode}
            draft={draft}
            nextRole={nextRole}
            onNextRole={setNextRole}
            onStartDraw={startDraw}
            onStartCores={startCores}
            selectedCoreId={selectedCoreId}
            onSelectCore={setSelectedCoreId}
            onPatchCore={patchCore}
            onRemoveCore={removeCore}
            onCommitDraw={commitDraw}
            onCancelDraw={cancelDraw}
            onRemoveCorridor={removeCorridor}
            underlay={underlay}
            onUnderlay={setUnderlay}
            onLoadUnderlay={loadUnderlay}
            overlays={overlays}
            onOverlays={(p) => setOverlays((o) => ({ ...o, ...p }))}
            variants={variants}
            onVariants={setVariants}
            busy={busy}
            onGenerate={() => run(false)}
            onExplore={() => run(true)}
            hasPlan={!!plan}
            onGoStage2={enterStageApply}
          />
        )}

        {stage === 2 && (
          <InteriorDrawPanel
            canvasW={authorW}
            canvasD={authorD}
            tool={planTool}
            openingKind={planOpeningKind}
            saveName={authorSaveName}
            unitTypeHint={authorTypeHint}
            userTemplates={userTemplates}
            zoneCount={authorDoc.zones.length}
            wallCount={authorDoc.walls.length}
            openingCount={authorDoc.openings.length}
            onCanvasW={setAuthorW}
            onCanvasD={setAuthorD}
            onTool={setPlanTool}
            onOpeningKind={setPlanOpeningKind}
            onSaveName={setAuthorSaveName}
            onUnitTypeHint={setAuthorTypeHint}
            onNewBlank={() => {
              setAuthorDoc(
                blankAuthorDocument(
                  authorW,
                  authorD,
                  params.wall_thickness_external || 0.2,
                  authorSaveName || "새 내부 평면",
                ),
              );
              setAuthorGen((g) => g + 1);
            }}
            onSave={saveAuthorToLibrary}
            onDeleteTemplate={(id) => setUserTemplates(deleteUserTemplate(id))}
            onGoApply={enterStageApply}
            canGoApply={!!plan}
            underlay={underlay}
            onUnderlay={setUnderlay}
            underlayAction={underlayAction}
            onUnderlayAction={setUnderlayAction}
            calibrationMm={calibrationMm}
            onCalibrationMm={setCalibrationMm}
            onSaveSample={() => { localStorage.setItem("floorplan-ai-unit-underlay-sample", JSON.stringify({ underlay, authorDoc, authorW, authorD })); setUnderlayNotice("현재 도면 샘플을 저장했습니다."); }}
            onLoadSample={() => { const raw = localStorage.getItem("floorplan-ai-unit-underlay-sample"); if (!raw) { setUnderlayNotice("저장된 샘플이 없습니다."); return; } try { const sample = JSON.parse(raw); if (sample.underlay) setUnderlay(sample.underlay); if (sample.authorDoc) setAuthorDoc(sample.authorDoc); if (sample.authorW) setAuthorW(sample.authorW); if (sample.authorD) setAuthorD(sample.authorD); setUnderlayNotice("저장된 도면 샘플을 불러왔습니다."); } catch { setUnderlayNotice("샘플을 불러오지 못했습니다."); } }}
            underlayNotice={underlayNotice}
            onLoadUnderlay={loadUnderlay}
            onClearUnderlay={() => setUnderlay(null)}
            onAutoTraceWalls={autoTraceWallsFromUnderlay}
          />
        )}

        {stage === 3 && plan && (
          <InteriorApplyPanel
            plan={plan}
            mode={mode}
            builtinTemplates={listTemplates()}
            userTemplates={userTemplates}
            interiors={interiors}
            selectedId={selectedId}
            selectedUnitIds={selectedUnitIds}
            agentMessages={agentMessages}
            agentBusy={agentBusy}
            busy={busy}
            onSelectUnit={(id) => handleSelectUnit(id, false)}
            onApplyTemplate={applyLibraryTemplate}
            onAutoFitInteriors={applyAutoInteriors}
            onClearInteriors={clearInteriors}
            onBatchDoors={batchDoorUpdate}
            onAgentSend={runArchie}
            onGoDraw={enterStageDraw}
            onBackZoning={enterStage1}
          />
        )}

        {stage === 2 ? (
          <div className="planCanvasStack">
            <div className="planToolbar">
              <strong style={{ fontSize: 12, marginRight: 8 }}>유닛 에디터 · 독립 캔버스</strong>
              {(
                [
                  ["select", "선택"],
                  ["wall", "벽"],
                  ["zone", "실(존)"],
                  ["door", "문"],
                  ["pan", "팬"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={planTool === id ? "on" : ""}
                  onClick={() => setPlanTool(id)}
                >
                  {label}
                </button>
              ))}
              <span className="sep" />
              <em style={{ fontSize: 11, color: "var(--muted)" }}>
                저장 후 평면 완성 → 유닛 배치에서 적용
              </em>
            </div>
            <PlanDocCanvas
              key={`author-${authorGen}`}
              doc={authorDoc}
              onChange={setAuthorDoc}
              tool={planTool}
              openingKind={planOpeningKind}
              underlay={underlay}
              onUnderlay={setUnderlay}
              underlayAction={underlayAction}
              calibrationMm={calibrationMm}
            />
          </div>
        ) : stage === 3 && selectedUnit && selectedPlanDoc ? (
          <div className="planCanvasStack">
            <div className="planToolbar">
              <strong style={{ fontSize: 12, marginRight: 8 }}>
                {selectedUnit.id} · 적용 결과 (편집 가능)
              </strong>
              {(
                [
                  ["select", "선택"],
                  ["wall", "벽"],
                  ["zone", "실"],
                  ["door", "문"],
                  ["pan", "팬"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={planTool === id ? "on" : ""}
                  onClick={() => setPlanTool(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <PlanDocCanvas
              key={selectedUnit.id}
              doc={selectedPlanDoc}
              onChange={(doc) => updatePlanDoc(selectedUnit.id, doc)}
              tool={planTool}
              openingKind={planOpeningKind}
            />
          </div>
        ) : (
          <FloorCanvas
            plan={plan}
            mode={mode}
            editMode={stage === 1 ? editMode : "view"}
            draft={draft}
            nextRole={nextRole}
            onDraftChange={setDraft}
            onCommitDraw={commitDraw}
            onCancelDraw={cancelDraw}
            inputBoundary={params.boundary}
            inputCorridors={params.corridors}
            inputCores={params.cores}
            corridorWidth={params.corridor_width}
            staleParams={
              stage === 1 && generatedFrom !== null && generatedFrom !== JSON.stringify(params)
            }
            defaultCoreLength={params.core_length}
            defaultCoreReach={params.core_reach}
            onEditGeometry={editGeometry}
            onEditCores={editCores}
            selectedCoreId={stage === 1 ? selectedCoreId : null}
            onSelectCore={setSelectedCoreId}
            underlay={underlay}
            onUnderlay={setUnderlay}
            overlays={overlays}
            selectedId={selectedId}
            onSelect={handleSelectUnit}
            selectedUnitIds={selectedUnitIds}
            onWallMove={(edits) => void handleWallMove(edits)}
            interiors={interiors}
            highlightedUnitIds={highlightedUnitIds}
            interiorTool="select"
            interiorRoomKind={interiorRoomKind}
            interiorDoorCategory={interiorDoorCategory}
            interiorDoorWidth={interiorDoorWidth}
            interiorFurnCatalogId={interiorFurnId}
            interiorDraft={interiorDraft}
            onInteriorDraftChange={setInteriorDraft}
            onInteriorRoomCommit={(pts) => {
              patchSelectedInterior((unit, it) => addRoom(unit, it, pts, interiorRoomKind));
              setInteriorDraft([]);
            }}
            onInteriorDoorPlace={placeDoor}
            onInteriorFurnPlace={placeFurn}
          />
        )}

        {stage === 2 ? (
          <UnitSettingsPanel
            canvasW={authorW}
            canvasD={authorD}
            wallCount={authorDoc.walls.length}
            zoneCount={authorDoc.zones.length}
            openingCount={authorDoc.openings.length}
            underlay={underlay}
            onCanvasW={setAuthorW}
            onCanvasD={setAuthorD}
            onUnderlay={setUnderlay}
          />
        ) : <MetricsPanel
          plan={plan}
          mode={mode}
          options={options}
          activeIndex={activeIndex}
          onPickOption={(i) => {
            setActiveIndex(i);
            setPlan(options[i]);
            setInteriors({});
            setPlanDocs({});
            setStage(1);
          }}
          unitCountTarget={params.unit_count_target}
          onUnitCountTarget={setUnitCountTarget}
          busy={busy}
          interiors={interiors}
          selectedId={selectedId}
          population={population}
          stage={stage}
        />}
      </main>
    </div>
  );
}
