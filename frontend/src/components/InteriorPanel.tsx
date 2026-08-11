"use client";

/** 2단계 전용 좌측 패널 — 라이브러리 · 유닛 목록 · 문 일괄 · 점수 (Finch 스타일). */

import { useState } from "react";
import { seriesColor, type Mode } from "@/utils/palette";
import type { DoorType, Plan, UnitInterior, UnitTemplate } from "@/utils/types";

type Scope = "selected" | "type" | "all";

interface Props {
  plan: Plan;
  mode: Mode;
  templates: UnitTemplate[];
  interiors: Record<string, UnitInterior>;
  selectedId: string | null;
  selectedUnitIds: string[];
  agentLog: string[];
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
  onBackToZoning: () => void;
}

export default function InteriorPanel({
  plan,
  mode,
  templates,
  interiors,
  selectedId,
  selectedUnitIds,
  agentLog,
  busy,
  onSelectUnit,
  onApplyTemplate,
  onAutoFitInteriors,
  onClearInteriors,
  onBatchDoors,
  onBackToZoning,
}: Props) {
  const [libTpl, setLibTpl] = useState(templates[0]?.id ?? "1BR_A");
  const selected = selectedId ? interiors[selectedId] : null;
  const interiorsCount = Object.keys(interiors).length;
  const unit = plan.units.find((u) => u.id === selectedId) ?? null;

  return (
    <aside className="sidebar panel interiorPanel">
      <div className="stageBanner stage2">
        <div>
          <strong>2단계 · 내부 평면</strong>
          <p>유닛에 라이브러리 도면을 끼우고 점수·문을 다듬습니다.</p>
        </div>
        <button type="button" className="ghost compact" onClick={onBackToZoning}>
          ← 1단계
        </button>
      </div>

      <div className="panelBody">
        <section>
          <h2>라이브러리</h2>
          <p className="note">Finch Plan Library처럼 타입별 평면을 유닛에 맞춥니다.</p>
          <div className="tplCards">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tplCard${libTpl === t.id ? " on" : ""}`}
                disabled={busy}
                onClick={() => setLibTpl(t.id)}
              >
                <strong>{t.name}</strong>
                <em>
                  {t.bbox.w.toFixed(1)}×{t.bbox.d.toFixed(1)} m
                  {t.unitTypeHint ? ` · ${t.unitTypeHint}` : ""}
                </em>
                <span>{t.rooms.length}실 · 문 {t.doors.length}</span>
              </button>
            ))}
          </div>
          <div className="drawRow" style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={busy}
              onClick={() => onApplyTemplate(libTpl, "selected")}
            >
              선택 유닛에 적용
            </button>
          </div>
          <div className="drawRow" style={{ marginTop: 6 }}>
            <button disabled={busy} onClick={() => onApplyTemplate(libTpl, "type")}>
              같은 타입
            </button>
            <button disabled={busy} onClick={() => onApplyTemplate(libTpl, "all")}>
              전 유닛
            </button>
          </div>
          <button
            className="ghost"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={onAutoFitInteriors}
          >
            타입별 자동 배치
          </button>
          {interiorsCount > 0 && (
            <button
              className="ghost danger"
              style={{ marginTop: 6 }}
              disabled={busy}
              onClick={onClearInteriors}
            >
              내부 모두 제거 ({interiorsCount})
            </button>
          )}
        </section>

        <section>
          <h2>유닛 목록 · {plan.units.length}호</h2>
          <p className="note">클릭해 선택 · Shift+클릭으로 다중 선택(도면).</p>
          <ul className="unitPickList">
            {plan.units.map((u) => {
              const it = interiors[u.id];
              const on =
                u.id === selectedId || selectedUnitIds.includes(u.id);
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

        <section>
          <h2>링크 유닛 · 문 일괄</h2>
          <p className="note">같은 템플릿 그룹에 문 사양을 한꺼번에 반영합니다.</p>
          <div className="drawRow">
            <button
              disabled={busy || interiorsCount === 0}
              onClick={() => onBatchDoors("bathroom", 0.762, "swing_left")}
            >
              욕실 30″ 스윙
            </button>
            <button
              disabled={busy || interiorsCount === 0}
              onClick={() => onBatchDoors("entrance", 0.914, "swing_left")}
            >
              현관 36″
            </button>
          </div>
          <div className="drawRow" style={{ marginTop: 6 }}>
            <button
              disabled={busy || interiorsCount === 0}
              onClick={() => onBatchDoors("all", 0.864, "swing_left")}
            >
              전 문 34″ 스윙
            </button>
          </div>
        </section>

        {(selected || unit) && (
          <section>
            <h2>선택 유닛 상세</h2>
            {unit && (
              <p className="note">
                <strong>{unit.id}</strong> · {unit.type} · {unit.area.toFixed(1)} m²
                {unit.door_point ? " · 현관 있음" : ""}
              </p>
            )}
            {selected?.score ? (
              <>
                <div className="scoreGrid">
                  <div>
                    <span>종합</span>
                    <strong>{selected.score.total}%</strong>
                  </div>
                  <div>
                    <span>Compliance</span>
                    <strong>{selected.score.compliance}</strong>
                  </div>
                  <div>
                    <span>Adaptivity</span>
                    <strong>{selected.score.adaptivity}</strong>
                  </div>
                  <div>
                    <span>Daylight</span>
                    <strong>{selected.score.daylight}</strong>
                  </div>
                </div>
                <ul className="miniChecks">
                  {selected.score.checks.slice(0, 8).map((c, i) => (
                    <li key={i} className={c.level}>
                      {c.message}
                    </li>
                  ))}
                </ul>
                {selected.rooms.length > 0 && (
                  <ul className="roomChips">
                    {selected.rooms.map((r) => (
                      <li key={r.id}>{r.name}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="note warn">아직 템플릿이 없습니다. 위에서 적용하세요.</p>
            )}
          </section>
        )}

        <section className="agentSection">
          <h2>작업 로그</h2>
          {agentLog.length === 0 ? (
            <p className="note">템플릿 적용 · 문 변경 기록이 여기에 쌓입니다.</p>
          ) : (
            <ul className="agentLog chatStyle">
              {agentLog.map((line, i) => (
                <li key={i}>
                  <span className="agentWho">System</span>
                  {line}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
