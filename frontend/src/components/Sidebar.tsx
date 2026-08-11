"use client";

/** 1단계 좌측 파라미터 패널 — 조닝 / Unit Mix / 표시 탭. */

import { useEffect, useState } from "react";
import { seriesColor, type Mode } from "@/utils/palette";
import type {
  CoreSpec,
  GenerateParams,
  PathVertex,
  Pt,
  Underlay,
  UnitTypeSpec,
  VertexRole,
} from "@/utils/types";
import type { EditMode, Overlays } from "./FloorCanvas";

type SideTab = "zoning" | "mix" | "view";

interface Props {
  params: GenerateParams;
  onChange: (patch: Partial<GenerateParams>) => void;
  mode: Mode;
  boundaries: { name: string; coords: Pt[] }[];
  onPickBoundary: (coords: Pt[]) => void;
  editMode: EditMode;
  draft: PathVertex[];
  nextRole: VertexRole;
  onNextRole: (r: VertexRole) => void;
  onStartDraw: (m: EditMode) => void;
  onStartCores: (mode: "core" | "coreOutline") => void;
  selectedCoreId: string | null;
  onSelectCore: (id: string | null) => void;
  onPatchCore: (id: string, patch: Partial<CoreSpec>) => void;
  onRemoveCore: (id: string) => void;
  onCommitDraw: () => void;
  onCancelDraw: () => void;
  onRemoveCorridor: (id: string) => void;
  underlay: Underlay | null;
  onUnderlay: (u: Underlay | null) => void;
  onLoadUnderlay: (file: File) => void;
  overlays: Overlays;
  onOverlays: (patch: Partial<Overlays>) => void;
  variants: number;
  onVariants: (n: number) => void;
  busy: boolean;
  onGenerate: () => void;
  onExplore: () => void;
  /** 평면 생성 후 2단계로 넘어갈 때 */
  hasPlan: boolean;
  onGoStage2?: () => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="ctl">
      <span className="ctlHead">
        {label}
        <output>
          {value}
          {unit}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

const TABS: { id: SideTab; label: string; hint: string }[] = [
  { id: "zoning", label: "조닝", hint: "외곽 · 복도 · 코어" },
  { id: "mix", label: "Unit Mix", hint: "타입 · 면적 · 비율" },
  { id: "view", label: "표시", hint: "작도 · 밑깔기 · 레이어" },
];

function tabForEditMode(m: EditMode): SideTab | null {
  if (m === "boundary" || m === "corridor" || m === "core" || m === "coreOutline") return "zoning";
  return null;
}

export default function Sidebar({
  params, onChange, mode, boundaries, onPickBoundary,
  editMode, draft, nextRole, onNextRole,
  onStartDraw, onStartCores, onCommitDraw, onCancelDraw,
  selectedCoreId, onSelectCore, onPatchCore, onRemoveCore,
  onRemoveCorridor, underlay, onUnderlay, onLoadUnderlay,
  overlays, onOverlays, variants, onVariants, busy, onGenerate, onExplore,
  hasPlan, onGoStage2,
}: Props) {
  const [tab, setTab] = useState<SideTab>("zoning");
  const ratioSum = params.unit_mix.reduce((s, u) => s + u.ratio, 0);
  const selectedCore = (params.cores ?? []).find((c) => c.id === selectedCoreId) ?? null;

  // 작도 모드 들어가면 해당 탭으로 자동 전환
  useEffect(() => {
    const t = tabForEditMode(editMode);
    if (t) setTab(t);
  }, [editMode]);

  // 코어 선택 시 조닝 탭에서 편집 보이게
  useEffect(() => {
    if (selectedCoreId) setTab("zoning");
  }, [selectedCoreId]);

  const patchUnit = (i: number, patch: Partial<UnitTypeSpec>) => {
    const next = params.unit_mix.map((u, j) => (j === i ? { ...u, ...patch } : u));
    onChange({ unit_mix: next });
  };

  const addUnit = () => {
    const n = params.unit_mix.length + 1;
    onChange({
      unit_mix: [
        ...params.unit_mix,
        { name: `Type${n}`, target_area: 55, ratio: 0.2, min_width: 4 },
      ],
    });
  };

  const zoningActive =
    editMode === "boundary" ||
    editMode === "corridor" ||
    editMode === "core" ||
    editMode === "coreOutline";

  return (
    <aside className="sidebar panel">
      <nav className="panelTabs" aria-label="설정 탭">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`panelTab${tab === t.id ? " on" : ""}${
              t.id === "zoning" && zoningActive ? " activeWork" : ""
            }`}
            title={t.hint}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="panelBody">
        {tab === "zoning" && (
          <>
            <section>
              <h2>1. 건물 외곽선</h2>
              <div className="presetGrid">
                {boundaries.map((b) => (
                  <button key={b.name} className="preset" onClick={() => onPickBoundary(b.coords)}>
                    {b.name}
                  </button>
                ))}
              </div>
              {editMode === "boundary" ? (
                <div className="drawRow">
                  <button className="primary" disabled={draft.length < 3} onClick={onCommitDraw}>
                    확인 ({draft.length}점)
                  </button>
                  <button onClick={onCancelDraw}>취소</button>
                </div>
              ) : (
                <button className="ghost" onClick={() => onStartDraw("boundary")}>
                  직접 그리기
                </button>
              )}
              {editMode === "view" && (
                <p className="note">
                  외곽선 {params.boundary.length}점
                  {params.corridors?.length ? ` · 복도 ${params.corridors.length}줄` : ""} — 도면에서
                  점 드래그, 변 ＋ 추가, 우클릭 삭제.
                </p>
              )}
            </section>

            <section>
              <h2>2. 복도 동선</h2>
              <div className="segmented">
                {(["double_loaded", "single_loaded"] as const).map((s) => (
                  <button
                    key={s}
                    className={params.strategy === s ? "on" : ""}
                    onClick={() => onChange({ strategy: s })}
                  >
                    {s === "double_loaded" ? "중복도" : "편복도"}
                  </button>
                ))}
              </div>
              <p className="note">
                선택한 모드로 중심선을 <strong>추가</strong>합니다. 중복도·편복도를 겹칠 수 있습니다.
              </p>

              {editMode === "corridor" ? (
                <div className="drawRow">
                  <button className="primary" disabled={draft.length < 2} onClick={onCommitDraw}>
                    {params.strategy === "single_loaded" ? "편복도" : "중복도"} 추가 ({draft.length}점)
                  </button>
                  <button onClick={onCancelDraw}>취소</button>
                </div>
              ) : (
                <div className="drawRow">
                  <button className="ghost" onClick={() => onStartDraw("corridor")}>
                    중심선 그리기
                  </button>
                  <button
                    className="ghost"
                    disabled={!params.corridors?.length}
                    onClick={() => onChange({ corridors: null })}
                  >
                    자동 배치로
                  </button>
                </div>
              )}

              {(params.corridors ?? []).length > 0 && (
                <ul className="corridorList">
                  {(params.corridors ?? []).map((c, i) => (
                    <li key={c.id}>
                      <span
                        className="swatch"
                        style={{
                          background: seriesColor(mode, c.strategy === "single_loaded" ? 2 : 1),
                        }}
                      />
                      <span className="corridorMeta">
                        {c.strategy === "single_loaded" ? "편복도" : "중복도"} {i + 1}
                        <em>{c.vertices.length}점</em>
                      </span>
                      <button
                        type="button"
                        className="iconBtn"
                        title="이 경로 삭제"
                        onClick={() => onRemoveCorridor(c.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="note">
                {params.corridors?.length
                  ? `수동 ${params.corridors.length}줄 — 도면에서 점 편집`
                  : "자동 — 외곽선 장축을 따라 배치"}
              </p>

              <Slider
                label="복도 폭"
                value={params.corridor_width}
                min={1.2}
                max={4}
                step={0.1}
                unit=" m"
                onChange={(v) => onChange({ corridor_width: v })}
              />
              <Slider
                label="단부 여백"
                value={params.corridor_end_inset}
                min={0}
                max={12}
                step={0.5}
                unit=" m"
                hint="복도를 외피에서 물린 거리."
                onChange={(v) => onChange({ corridor_end_inset: v })}
              />
            </section>

            <section>
              <h2>3. 코어 · 피난</h2>

              {editMode === "core" || editMode === "coreOutline" ? (
                <div className="drawRow">
                  <button
                    className="primary"
                    disabled={editMode === "coreOutline" && draft.length < 3}
                    onClick={onCommitDraw}
                  >
                    {editMode === "coreOutline"
                      ? `외곽 확정 (${draft.length}점)`
                      : `확인 (${params.cores?.length ?? 0}개)`}
                  </button>
                  <button onClick={onCancelDraw}>취소</button>
                </div>
              ) : (
                <>
                  <div className="drawRow">
                    <button className="ghost" onClick={() => onStartCores("core")}>
                      {params.cores ? "코어 더 찍기" : "직접 배치"}
                    </button>
                    <button
                      className="ghost"
                      disabled={!params.cores}
                      onClick={() => onChange({ cores: null })}
                    >
                      자동 배치로
                    </button>
                  </div>
                  <div className="drawRow" style={{ marginTop: 6 }}>
                    <button className="ghost" onClick={() => onStartCores("coreOutline")}>
                      외곽선으로 그리기
                    </button>
                  </div>
                </>
              )}
              <p className="note">
                {editMode === "coreOutline"
                  ? "코어 외곽을 그리고 첫 점으로 돌아와 닫으세요."
                  : params.cores
                    ? `수동 ${params.cores.length}개 — 목록·핸들 선택, 우클릭/Delete 삭제`
                    : "자동 — 보행거리 기준 균등 배치"}
              </p>

              {(params.cores ?? []).length > 0 && (
                <ul className="corridorList">
                  {(params.cores ?? []).map((c, i) => (
                    <li
                      key={c.id}
                      className={c.id === selectedCoreId ? "isSelected" : undefined}
                      onClick={() => onSelectCore(c.id)}
                    >
                      <span className="swatch" style={{ background: "var(--critical)" }} />
                      <span className="corridorMeta">
                        코어 {i + 1}
                        <em>
                          {c.outline
                            ? `외곽 ${c.outline.length}점`
                            : `${c.length.toFixed(1)}×${c.reach.toFixed(1)} m`}
                        </em>
                      </span>
                      <button
                        type="button"
                        className="iconBtn"
                        title="이 코어 삭제"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveCore(c.id);
                        }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {selectedCore && (
                <div className="coreEdit">
                  <div className="coreEditHead">
                    <strong>선택한 코어</strong>
                    <button className="iconBtn" title="선택 해제" onClick={() => onSelectCore(null)}>
                      ×
                    </button>
                  </div>
                  {selectedCore.outline ? (
                    <p className="note">
                      자유 외곽선 {selectedCore.outline.length}점 — 도면에서 점 조정.
                    </p>
                  ) : (
                    <>
                      <Slider
                        label="길이 (복도 방향)"
                        value={selectedCore.length}
                        min={2}
                        max={20}
                        step={0.5}
                        unit=" m"
                        onChange={(v) => onPatchCore(selectedCore.id, { length: v })}
                      />
                      <Slider
                        label="깊이 (복도 양옆)"
                        value={selectedCore.reach}
                        min={1}
                        max={20}
                        step={0.5}
                        unit=" m"
                        onChange={(v) => onPatchCore(selectedCore.id, { reach: v })}
                      />
                    </>
                  )}
                  <div className="drawRow" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onRemoveCore(selectedCore.id)}
                    >
                      이 코어 삭제
                    </button>
                  </div>
                </div>
              )}

              {!params.cores && (
                <label className="ctl">
                  <span className="ctlHead">
                    코어 개수
                    <output>{params.core_count === null ? "자동" : params.core_count}</output>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={6}
                    step={1}
                    value={params.core_count ?? 0}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      onChange({ core_count: v === 0 ? null : v });
                    }}
                  />
                  <small>0 = 보행거리 기준 자동</small>
                </label>
              )}
              <Slider
                label="코어 길이"
                value={params.core_length}
                min={3}
                max={14}
                step={0.5}
                unit=" m"
                onChange={(v) => onChange({ core_length: v })}
              />
              <Slider
                label="코어 깊이"
                value={params.core_reach}
                min={2}
                max={14}
                step={0.5}
                unit=" m"
                hint="복도 양옆으로 뻗는 깊이"
                onChange={(v) => onChange({ core_reach: v })}
              />
              <Slider
                label="최대 보행거리"
                value={params.max_travel_distance}
                min={10}
                max={80}
                step={1}
                unit=" m"
                onChange={(v) => onChange({ max_travel_distance: v })}
              />
              <Slider
                label="최소 창면 폭"
                value={params.min_facade_width}
                min={0}
                max={8}
                step={0.2}
                unit=" m"
                onChange={(v) => onChange({ min_facade_width: v })}
              />
            </section>
          </>
        )}

        {tab === "mix" && (
          <section>
            <h2>Unit Mix</h2>
            {ratioSum > 0 && Math.abs(ratioSum - 1) > 0.005 && (
              <p className="note warn">비율 합 {ratioSum.toFixed(2)} — 자동 정규화됩니다.</p>
            )}
            <table className="mixTable">
              <thead>
                <tr>
                  <th />
                  <th>타입</th>
                  <th>면적 m²</th>
                  <th>비율</th>
                  <th>최소폭</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {params.unit_mix.map((u, i) => (
                  <tr key={i}>
                    <td>
                      <span className="swatch" style={{ background: seriesColor(mode, i) }} />
                    </td>
                    <td>
                      <input value={u.name} onChange={(e) => patchUnit(i, { name: e.target.value })} />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={10}
                        step={1}
                        value={u.target_area}
                        onChange={(e) => patchUnit(i, { target_area: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={u.ratio}
                        onChange={(e) => patchUnit(i, { ratio: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={2}
                        step={0.1}
                        value={u.min_width}
                        onChange={(e) => patchUnit(i, { min_width: Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <button
                        className="iconBtn"
                        title="삭제"
                        disabled={params.unit_mix.length <= 1}
                        onClick={() =>
                          onChange({ unit_mix: params.unit_mix.filter((_, j) => j !== i) })
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="ghost" onClick={addUnit}>
              + 타입 추가
            </button>
            <p className="note" style={{ marginTop: 12 }}>
              생성 후 우측 패널에서 목표 대비 실적 비율을 확인할 수 있습니다.
            </p>
          </section>
        )}

        {tab === "view" && (
          <>
            <section>
              <h2>작도 · 곡선</h2>
              <p className="note">
                점 3개(모서리–곡선–모서리)로 원호. 중간 곡선점은 ◆ 표시.
              </p>
              {(editMode === "boundary" || editMode === "corridor") && (
                <div className="segmented">
                  <button
                    className={nextRole === "corner" ? "on" : ""}
                    onClick={() => onNextRole("corner")}
                  >
                    모서리 ●
                  </button>
                  <button
                    className={nextRole === "curve" ? "on" : ""}
                    onClick={() => onNextRole("curve")}
                  >
                    곡선점 ◆
                  </button>
                </div>
              )}
              <p className="note">
                작도 중 <kbd>C</kbd> 토글 · 중간점 우클릭으로 곡선 전환
              </p>
              {(editMode === "boundary" || editMode === "corridor") && (
                <p className="note warn">지금 조닝 탭에서 작도 중입니다 — 곡선 모드만 여기서 바꿉니다.</p>
              )}
            </section>

            <section>
              <h2>도면 밑깔기</h2>
              <p className="note">스캔·도면 이미지를 깔고 그 위에 그립니다.</p>
              <label className="ghost fileBtn">
                이미지 불러오기
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onLoadUnderlay(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {underlay && (
                <>
                  <label className="toggle" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={overlays.underlay && underlay.visible}
                      onChange={(e) => {
                        onOverlays({ underlay: e.target.checked });
                        onUnderlay({ ...underlay, visible: e.target.checked });
                      }}
                    />
                    밑깔기 표시
                  </label>
                  <Slider
                    label="투명도"
                    value={Math.round(underlay.opacity * 100)}
                    min={5}
                    max={100}
                    step={5}
                    unit="%"
                    onChange={(v) => onUnderlay({ ...underlay, opacity: v / 100 })}
                  />
                  <Slider
                    label="가로 실측"
                    value={underlay.widthM}
                    min={5}
                    max={200}
                    step={0.5}
                    unit=" m"
                    hint="이미지 가로 스케일"
                    onChange={(v) => onUnderlay({ ...underlay, widthM: v })}
                  />
                  <button className="ghost" style={{ marginTop: 8 }} onClick={() => onUnderlay(null)}>
                    밑깔기 제거
                  </button>
                </>
              )}
            </section>

            <section>
              <h2>레이어 표시</h2>
              <div className="toggles">
                {(
                  [
                    ["labels", "세대 라벨"],
                    ["dims", "치수"],
                    ["graph", "동선 그래프"],
                    ["travel", "보행거리 음영"],
                    ["doors", "현관 위치"],
                    ["grid", "격자"],
                    ["underlay", "도면 밑깔기"],
                    ["interiors", "내부 실·문"],
                    ["zones", "존 오버레이"],
                    ["egress", "피난 직선"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="toggle">
                    <input
                      type="checkbox"
                      checked={overlays[k]}
                      onChange={(e) => onOverlays({ [k]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      <div className="actions stickyActions">
        <button className="primary big" disabled={busy} onClick={onGenerate}>
          {busy ? "연산 중…" : "평면 생성"}
        </button>
        <div className="exploreRow">
          <button disabled={busy} onClick={onExplore}>
            대안 {variants}개
          </button>
          <input
            type="range"
            min={2}
            max={16}
            step={1}
            value={variants}
            onChange={(e) => onVariants(Number(e.target.value))}
            aria-label="대안 개수"
          />
        </div>
        {hasPlan && onGoStage2 && (
          <button className="primary big stage2Cta" disabled={busy} onClick={onGoStage2}>
            내부 적용 탭 →
          </button>
        )}
      </div>
    </aside>
  );
}
