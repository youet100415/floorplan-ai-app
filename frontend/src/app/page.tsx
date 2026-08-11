"use client";

/** 메인 에디터 페이지 — 상태를 보관하고 캔버스/사이드바/지표 패널을 연결한다. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FloorCanvas, { type EditMode, type Overlays } from "@/components/FloorCanvas";
import InteriorPanel from "@/components/InteriorPanel";
import MetricsPanel from "@/components/MetricsPanel";
import Sidebar from "@/components/Sidebar";
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
  emptyInterior,
  fitTemplateToUnit,
  getTemplate,
  interiorToTemplate,
  listTemplates,
  loadUserTemplates,
  pickTemplateForType,
  populationFromUnits,
  removeDoor,
  removeFurniture,
  removeRoom,
  runAgentLocal,
  saveUserTemplate,
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
  /** 1=조닝 · 2=내부 평면 (영상처럼 탭으로 전환) */
  const [stage, setStage] = useState<1 | 2>(1);
  const [userTemplates, setUserTemplates] = useState<UnitTemplate[]>([]);
  const [interiorTool, setInteriorTool] = useState<InteriorTool>("select");
  const [interiorRoomKind, setInteriorRoomKind] = useState<RoomKind>("living");
  const [interiorDoorCategory, setInteriorDoorCategory] = useState<DoorCategory>("entrance");
  const [interiorDoorWidth, setInteriorDoorWidth] = useState(0.9);
  const [interiorFurnId, setInteriorFurnId] = useState("sofa_2000");
  const [interiorDraft, setInteriorDraft] = useState<Pt[]>([]);

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
      setOverlays((o) => ({ ...o, interiors: true, zones: true }));
      setHighlightedUnitIds(targets.map((u) => u.id));
      setAgentLog((logs) => [
        `${tpl.name} → ${targets.length}개 유닛 적용 (${scope})`,
        ...logs,
      ].slice(0, 12));
      setError(null);
      window.setTimeout(() => setHighlightedUnitIds([]), 2200);
    },
    [plan, selectedId, selectedUnitIds, userTemplates],
  );

  const applyAutoInteriors = useCallback(() => {
    if (!plan) {
      setError("먼저 평면을 생성하세요.");
      return;
    }
    const next = autoFitAll(plan.units, pickTemplateForType);
    setInteriors(next);
    setOverlays((o) => ({ ...o, interiors: true, zones: true }));
    setHighlightedUnitIds(plan.units.map((u) => u.id));
    setAgentLog((logs) => [`타입별 자동 템플릿 ${plan.units.length}호 적용`, ...logs].slice(0, 12));
    window.setTimeout(() => setHighlightedUnitIds([]), 2200);
  }, [plan]);

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

  const enterStage2 = useCallback(() => {
    if (!plan) {
      setError("먼저 1단계에서 평면을 생성하세요.");
      return;
    }
    setStage(2);
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
          text:
            "안녕하세요. Archie입니다. 유닛에 템플릿을 적용한 뒤, 욕실·현관 문을 자연어로 일괄 수정할 수 있습니다.",
          details: [
            "예: 모든 욕실·현관 문을 스윙으로. 욕실 34인치, 현관 36인치",
            "예: 타입별 자동 배치",
          ],
        },
      ]);
    }
  }, [plan, agentMessages.length]);

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

  const saveSelectedToLibrary = useCallback(
    (name: string) => {
      if (!plan || !selectedId) return;
      const unit = plan.units.find((u) => u.id === selectedId);
      const it = interiors[selectedId];
      if (!unit || !it || it.rooms.length < 1) {
        setError("저장할 실이 없습니다. 내부를 그린 뒤 저장하세요.");
        return;
      }
      const tpl = interiorToTemplate(unit, it, name);
      const next = saveUserTemplate(tpl);
      setUserTemplates(next);
      setAgentMessages((prev) => [
        ...prev,
        {
          id: agentId(),
          role: "agent",
          text: `라이브러리에 저장했습니다: 「${tpl.name}」 (점수 ${it.score?.total ?? "—"}%)`,
          details: [
            `실 ${tpl.rooms.length} · 문 ${tpl.doors.length}`,
            "같은 타입 유닛에 「선택 적용」으로 재사용할 수 있습니다.",
          ],
          summaryCard: {
            title: "Saved to Library",
            changes: [`${tpl.name}`, `Score ${it.score?.total ?? "—"}%`],
            unitIds: [unit.id],
          },
        },
      ]);
      setError(null);
    },
    [plan, selectedId, interiors],
  );

  // 2단계: 실 드래프트 Enter / Esc
  useEffect(() => {
    if (stage !== 2) return;
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
      const w = Math.max(maxX - minX, 10);
      setUnderlay({
        src,
        origin: [minX, minY],
        widthM: w,
        heightM: null,
        opacity: 0.45,
        visible: true,
        locked: true,
      });
      setOverlays((o) => ({ ...o, underlay: true }));
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
    <div className={`app stage-${stage}`}>
      <header className="topbar">
        <h1>
          Floorplan<span>AI</span>
          <em>{stage === 1 ? "1단계 · 조닝 · 동선" : "2단계 · 내부 평면 · 라이브러리"}</em>
        </h1>

        <nav className="stageTabs" aria-label="작업 단계">
          <button
            type="button"
            className={`stageTab${stage === 1 ? " on" : ""}`}
            onClick={enterStage1}
          >
            <span className="stageNum">1</span>
            조닝
          </button>
          <button
            type="button"
            className={`stageTab${stage === 2 ? " on" : ""}`}
            disabled={!plan}
            title={plan ? "내부 평면 작업" : "먼저 평면을 생성하세요"}
            onClick={enterStage2}
          >
            <span className="stageNum">2</span>
            내부 평면
          </button>
        </nav>

        <div className="topActions">
          {plan && (
            <span className="scorePill">
              {stage === 1 ? (
                <>
                  건물 점수 <strong>{plan.score.toFixed(1)}</strong>
                </>
              ) : (
                <>
                  내부 {Object.keys(interiors).length}/{plan.units.length}호
                  {selectedInterior?.score && (
                    <>
                      {" "}
                      · 선택 <strong>{selectedInterior.score.total}%</strong>
                    </>
                  )}
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

      {error && (
        <div className="errorBar" role="alert">
          {error}
        </div>
      )}

      {stage === 1 && plan && (
        <div className="stageNudge">
          <span>평면 생성 완료 — 유닛 구획이 끝났습니다.</span>
          <button type="button" className="primary" onClick={enterStage2}>
            2단계 내부 평면 시작 →
          </button>
        </div>
      )}

      <main className={`layout${stage === 2 ? " layoutStage2" : ""}`}>
        {stage === 1 ? (
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
            onGoStage2={enterStage2}
          />
        ) : plan ? (
          <InteriorPanel
            plan={plan}
            mode={mode}
            templates={listTemplates()}
            userTemplates={userTemplates}
            interiors={interiors}
            selectedId={selectedId}
            selectedUnitIds={selectedUnitIds}
            agentMessages={agentMessages}
            agentBusy={agentBusy}
            busy={busy}
            interiorTool={interiorTool}
            interiorRoomKind={interiorRoomKind}
            interiorDoorCategory={interiorDoorCategory}
            interiorDoorWidth={interiorDoorWidth}
            interiorFurnId={interiorFurnId}
            interiorDraftLen={interiorDraft.length}
            onInteriorTool={(t) => {
              setInteriorTool(t);
              setInteriorDraft([]);
            }}
            onInteriorRoomKind={setInteriorRoomKind}
            onInteriorDoorCategory={setInteriorDoorCategory}
            onInteriorDoorWidth={setInteriorDoorWidth}
            onInteriorFurnId={setInteriorFurnId}
            onSelectUnit={(id) => handleSelectUnit(id, false)}
            onApplyTemplate={applyLibraryTemplate}
            onAutoFitInteriors={applyAutoInteriors}
            onClearInteriors={clearInteriors}
            onBatchDoors={batchDoorUpdate}
            onAgentSend={runArchie}
            onStartEmptyInterior={startEmptyInterior}
            onCommitRoomDraft={commitRoomDraft}
            onCancelRoomDraft={() => setInteriorDraft([])}
            onDeleteLastRoom={() =>
              patchSelectedInterior((unit, it) => {
                if (!it || it.rooms.length === 0) return it ?? emptyInterior(unit);
                return removeRoom(unit, it, it.rooms[it.rooms.length - 1].id);
              })
            }
            onDeleteLastDoor={() =>
              patchSelectedInterior((unit, it) => {
                if (!it || it.doors.length === 0) return it ?? emptyInterior(unit);
                return removeDoor(unit, it, it.doors[it.doors.length - 1].id);
              })
            }
            onDeleteLastFurn={() =>
              patchSelectedInterior((unit, it) => {
                if (!it || !(it.furniture && it.furniture.length)) return it ?? emptyInterior(unit);
                const last = it.furniture[it.furniture.length - 1];
                return removeFurniture(unit, it, last.id);
              })
            }
            onSaveToLibrary={saveSelectedToLibrary}
            onBackToZoning={enterStage1}
          />
        ) : null}

        <FloorCanvas
          plan={plan}
          mode={mode}
          editMode={stage === 2 ? "view" : editMode}
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
          interiorTool={stage === 2 ? interiorTool : "select"}
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

        <MetricsPanel
          plan={plan}
          mode={mode}
          options={options}
          activeIndex={activeIndex}
          onPickOption={(i) => {
            setActiveIndex(i);
            setPlan(options[i]);
            setInteriors({});
            setStage(1);
          }}
          unitCountTarget={params.unit_count_target}
          onUnitCountTarget={setUnitCountTarget}
          busy={busy}
          interiors={interiors}
          selectedId={selectedId}
          population={population}
          stage={stage}
        />
      </main>
    </div>
  );
}
