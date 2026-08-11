"use client";

/** 메인 에디터 페이지 — 상태를 보관하고 캔버스/사이드바/지표 패널을 연결한다. */

import { useCallback, useEffect, useRef, useState } from "react";
import FloorCanvas, { type EditMode, type Overlays } from "@/components/FloorCanvas";
import MetricsPanel from "@/components/MetricsPanel";
import Sidebar from "@/components/Sidebar";
import { API_BASE, explorePlans, fetchPresets, generatePlan, type Presets } from "@/utils/api";
import { asCorners } from "@/utils/path";
import { makeDoc, type ProjectDoc } from "@/utils/project";
import { loadAutosave, saveAutosave } from "@/utils/storage";
import type { Mode } from "@/utils/palette";
import type {
  CoreSpec,
  CorridorPath,
  GenerateParams,
  PathVertex,
  Plan,
  Pt,
  Underlay,
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
  /** 크기 편집 대상 코어. 도면에서 사각 핸들을 클릭하면 지정된다. */
  const [selectedCoreId, setSelectedCoreId] = useState<string | null>(null);

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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [params, variants],
  );

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
    <div className="app">
      <header className="topbar">
        <h1>
          Floorplan<span>AI</span>
          <em>평면 · 동선 자동 생성기</em>
        </h1>
        <div className="topActions">
          {plan && (
            <span className="scorePill">
              점수 <strong>{plan.score.toFixed(1)}</strong>
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

      <main className="layout">
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
        />

        <FloorCanvas
          plan={plan}
          mode={mode}
          editMode={editMode}
          draft={draft}
          nextRole={nextRole}
          onDraftChange={setDraft}
          onCommitDraw={commitDraw}
          onCancelDraw={cancelDraw}
          inputBoundary={params.boundary}
          inputCorridors={params.corridors}
          inputCores={params.cores}
          corridorWidth={params.corridor_width}
          staleParams={generatedFrom !== null && generatedFrom !== JSON.stringify(params)}
          defaultCoreLength={params.core_length}
          defaultCoreReach={params.core_reach}
          onEditGeometry={editGeometry}
          onEditCores={editCores}
          selectedCoreId={selectedCoreId}
          onSelectCore={setSelectedCoreId}
          underlay={underlay}
          onUnderlay={setUnderlay}
          overlays={overlays}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <MetricsPanel
          plan={plan}
          mode={mode}
          options={options}
          activeIndex={activeIndex}
          onPickOption={(i) => {
            setActiveIndex(i);
            setPlan(options[i]);
          }}
          unitCountTarget={params.unit_count_target}
          onUnitCountTarget={setUnitCountTarget}
          busy={busy}
        />
      </main>
    </div>
  );
}
