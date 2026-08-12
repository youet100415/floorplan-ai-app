"use client";

/** 유닛 배치 패널 — 라이브러리 원본 → 프로젝트 인스턴스 적용. */

import { useMemo, useState } from "react";
import AIAgentChat from "@/components/AIAgentChat";
import type { AgentMessage } from "@/utils/interior/agent";
import { scoreTemplateMatch } from "@/utils/interior/validateUnit";
import { seriesColor, type Mode } from "@/utils/palette";
import type { DoorType, Plan, UnitInterior, UnitTemplate } from "@/utils/types";

type Scope = "selected" | "type" | "all";

interface Props {
  plan: Plan;
  mode: Mode;
  builtinTemplates: UnitTemplate[];
  userTemplates: UnitTemplate[];
  interiors: Record<string, UnitInterior>;
  selectedId: string | null;
  selectedUnitIds: string[];
  agentMessages: AgentMessage[];
  agentBusy: boolean;
  busy: boolean;
  onSelectUnit: (id: string | null) => void;
  onApplyTemplate: (templateId: string, scope: Scope) => void;
  onAutoFitInteriors: () => void;
  onClearInteriors: () => void;
  onBatchDoors: (
    category: "all" | "entrance" | "bathroom" | "bedroom",
    width: number,
    type?: DoorType,
  ) => void;
  onAgentSend: (text: string) => void;
  onGoDraw: () => void;
  onBackZoning: () => void;
}

export default function InteriorApplyPanel({
  plan,
  mode,
  builtinTemplates,
  userTemplates,
  interiors,
  selectedId,
  selectedUnitIds,
  agentMessages,
  agentBusy,
  busy,
  onSelectUnit,
  onApplyTemplate,
  onAutoFitInteriors,
  onClearInteriors,
  onBatchDoors,
  onAgentSend,
  onGoDraw,
  onBackZoning,
}: Props) {
  const savedFirst = userTemplates[0]?.id ?? builtinTemplates[0]?.id ?? "";
  const [libTpl, setLibTpl] = useState(savedFirst);
  const [libQuery, setLibQuery] = useState("");
  const selected = selectedId ? interiors[selectedId] : null;
  const selectedUnit = selectedId ? plan.units.find((u) => u.id === selectedId) : null;
  const interiorsCount = Object.keys(interiors).length;
  const all = useMemo(
    () => [...userTemplates, ...builtinTemplates],
    [userTemplates, builtinTemplates],
  );

  const ranked = useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    let list = all;
    if (q) {
      list = all.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.unitTypeHint ?? "").toLowerCase().includes(q) ||
          (t.classification?.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    if (!selectedUnit) {
      return list.map((t) => ({ t, score: null as number | null, reasons: [] as string[] }));
    }
    return list
      .map((t) => {
        const m = scoreTemplateMatch(
          { type: selectedUnit.type, area: selectedUnit.area },
          t,
        );
        return { t, score: m.score, reasons: m.reasons };
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [all, libQuery, selectedUnit]);

  return (
    <aside className="sidebar panel interiorPanel">
      <div className="stageBanner stage2">
        <div>
          <strong>유닛 배치 · 모듈 적용</strong>
          <p>유닛 에디터에서 만든 모듈을 조닝 결과 세대에 끼워 넣습니다.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button type="button" className="ghost compact" onClick={onGoDraw}>
            유닛 에디터
          </button>
          <button type="button" className="ghost compact" onClick={onBackZoning}>
            ← 조닝
          </button>
        </div>
      </div>

      <div className="panelBody">
        <section>
          <h2>유닛 라이브러리 (원본)</h2>
          <p className="note">
            라이브러리 유닛은 원본입니다. 적용 시 <strong>프로젝트용 복제본</strong>이
            만들어지며, 배치 후 편집해도 원본은 바뀌지 않습니다.
          </p>
          <label className="ctl">
            <span className="ctlHead">검색 · 필터</span>
            <input
              className="fullSelect"
              value={libQuery}
              placeholder="이름 · 타입 · 태그"
              onChange={(e) => setLibQuery(e.target.value)}
            />
          </label>
          {selectedUnit && (
            <p className="note">
              선택 존 <strong>{selectedUnit.id}</strong> ({selectedUnit.type} ·{" "}
              {selectedUnit.area.toFixed(0)}㎡) 기준 추천 정렬
            </p>
          )}
          {userTemplates.length === 0 && (
            <p className="note warn">
              직접 만든 모듈이 없습니다. 「유닛 에디터」에서 그리고 저장하세요.
            </p>
          )}
          <div className="tplCards">
            {ranked.map(({ t, score, reasons }) => {
              const blocked = t.validation?.placeable === false;
              return (
              <button
                key={t.id}
                type="button"
                className={`tplCard${libTpl === t.id ? " on" : ""}`}
                disabled={busy || blocked}
                title={
                  blocked
                    ? "배치 불가 — 유닛 에디터에서 수정·재저장"
                    : reasons.length
                      ? reasons.join(" · ")
                      : undefined
                }
                onClick={() => setLibTpl(t.id)}
              >
                <strong>
                  {t.name}
                  {t.id.startsWith("user-") ? " · 내 모듈" : " · 기본"}
                  {score != null ? ` · 추천 ${score}` : ""}
                </strong>
                <em>
                  {t.bbox.w.toFixed(1)}×{t.bbox.d.toFixed(1)} m
                  {t.unitTypeHint ? ` · ${t.unitTypeHint}` : ""}
                  {t.status ? ` · ${t.status}` : ""}
                </em>
                <span>
                  {t.rooms.length}실 · 문 {t.doors.length}
                  {t.classification?.object_summary?.length
                    ? ` · ${t.classification.object_summary.slice(0, 3).join(",")}`
                    : ""}
                  {blocked ? " · 배치 불가" : ""}
                </span>
              </button>
            );})}
          </div>

          <div className="drawRow" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="primary"
              disabled={busy || !libTpl}
              onClick={() => onApplyTemplate(libTpl, "selected")}
            >
              선택 존에 배치(복제)
            </button>
          </div>
          <div className="drawRow" style={{ marginTop: 6 }}>
            <button
              type="button"
              disabled={busy || !libTpl}
              onClick={() => onApplyTemplate(libTpl, "type")}
            >
              같은 타입 전부
            </button>
            <button
              type="button"
              disabled={busy || !libTpl}
              onClick={() => onApplyTemplate(libTpl, "all")}
            >
              전 유닛
            </button>
          </div>
          <button
            type="button"
            className="ghost"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={onAutoFitInteriors}
          >
            타입 힌트 자동 매칭
          </button>
          {interiorsCount > 0 && (
            <button
              type="button"
              className="ghost danger"
              style={{ marginTop: 6 }}
              disabled={busy}
              onClick={onClearInteriors}
            >
              적용 모두 제거 ({interiorsCount})
            </button>
          )}
          <p className="note">
            선택 {selectedUnitIds.length || (selectedId ? 1 : 0)}호 · 적용됨 {interiorsCount}호
          </p>
        </section>

        <section>
          <h2>유닛 목록 · {plan.units.length}호</h2>
          <ul className="unitPickList">
            {plan.units.map((u) => {
              const it = interiors[u.id];
              const on = u.id === selectedId || selectedUnitIds.includes(u.id);
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    className={`unitPick${on ? " on" : ""}`}
                    onClick={() => onSelectUnit(u.id)}
                  >
                    <span
                      className="swatch"
                      style={{ background: seriesColor(mode, u.type_index) }}
                    />
                    <span className="unitPickMeta">
                      <strong>{u.id}</strong>
                      <em>
                        {u.type} · {u.area.toFixed(0)}㎡
                        {it?.score ? ` · ${it.score.total}%` : " · 미적용"}
                      </em>
                    </span>
                    {it ? <span className="chip ok">적용</span> : <span className="chip">—</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {selectedUnit && !selected && (
          <section>
            <h2>선택 조닝 영역</h2>
            <p className="note">
              용도 <strong>{selectedUnit.type}</strong> · 면적{" "}
              {selectedUnit.area.toFixed(1)}㎡
              <br />
              라이브러리에서 후보를 고른 뒤 「선택 존에 배치」를 누르세요.
              <br />
              <em>분류·추천 점수</em>는 용도·면적·치수 기반이며 모델 학습 데이터와는 별개입니다.
            </p>
          </section>
        )}

        {selected && (
          <section>
            <h2>배치 인스턴스 속성</h2>
            {selected.project_instance ? (
              <p className="note">
                원본 라이브러리:{" "}
                <strong>{selected.source_unit_id ?? selected.templateId}</strong>
                <br />
                인스턴스 ID: {selected.project_instance.instance_id}
                <br />
                라이브러리 버전: {selected.project_instance.library_version}
                <br />
                회전 {selected.project_instance.rotation_deg}° · 반전{" "}
                {selected.project_instance.mirrored ? "Y" : "N"} · 스케일{" "}
                {selected.project_instance.scale.toFixed(2)}
                <br />
                배치 시각: {new Date(selected.project_instance.placed_at).toLocaleString("ko-KR")}
              </p>
            ) : (
              <p className="note">
                원본: {selected.source_unit_id ?? selected.templateId ?? "—"} (인스턴스 메타 없음)
              </p>
            )}
            {selected.score ? (
              <>
                <div className="scoreGrid">
                  <div>
                    <span>종합</span>
                    <strong>{selected.score.total}%</strong>
                  </div>
                  <div>
                    <span>C / A / D</span>
                    <strong>
                      {selected.score.compliance}/{selected.score.adaptivity}/
                      {selected.score.daylight}
                    </strong>
                  </div>
                </div>
                <ul className="miniChecks">
                  {selected.score.checks.slice(0, 6).map((c, i) => (
                    <li key={i} className={c.level}>
                      {c.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="note">배치됨 · 점수 없음</p>
            )}
          </section>
        )}

        <section>
          <h2>문 일괄</h2>
          <div className="drawRow">
            <button
              type="button"
              disabled={busy || interiorsCount === 0}
              onClick={() => onBatchDoors("bathroom", 0.762, "swing_left")}
            >
              욕실 30″
            </button>
            <button
              type="button"
              disabled={busy || interiorsCount === 0}
              onClick={() => onBatchDoors("entrance", 0.914, "swing_left")}
            >
              현관 36″
            </button>
          </div>
        </section>

        <section className="archieSection">
          <AIAgentChat messages={agentMessages} busy={agentBusy} onSend={onAgentSend} />
        </section>
      </div>
    </aside>
  );
}
