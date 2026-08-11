"use client";

/** 내부 평면 적용 전용 패널 — 저장본을 유닛에 끼움. */

import { useState } from "react";
import AIAgentChat from "@/components/AIAgentChat";
import type { AgentMessage } from "@/utils/interior/agent";
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
  const selected = selectedId ? interiors[selectedId] : null;
  const interiorsCount = Object.keys(interiors).length;
  const all = [...userTemplates, ...builtinTemplates];

  return (
    <aside className="sidebar panel interiorPanel">
      <div className="stageBanner stage2">
        <div>
          <strong>내부 평면 적용</strong>
          <p>저장된 내부 평면을 골라 세대에 적용합니다.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button type="button" className="ghost compact" onClick={onGoDraw}>
            그리기 탭
          </button>
          <button type="button" className="ghost compact" onClick={onBackZoning}>
            ← 조닝
          </button>
        </div>
      </div>

      <div className="panelBody">
        <section>
          <h2>적용할 내부 평면</h2>
          {userTemplates.length === 0 && (
            <p className="note warn">
              직접 그린 저장본이 없습니다. 「내부 그리기」 탭에서 만들고 저장하세요.
            </p>
          )}
          <div className="tplCards">
            {all.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tplCard${libTpl === t.id ? " on" : ""}`}
                disabled={busy}
                onClick={() => setLibTpl(t.id)}
              >
                <strong>
                  {t.name}
                  {t.id.startsWith("user-") ? " · 내 저장" : " · 기본"}
                </strong>
                <em>
                  {t.bbox.w.toFixed(1)}×{t.bbox.d.toFixed(1)} m
                  {t.unitTypeHint ? ` · ${t.unitTypeHint}` : ""}
                </em>
                <span>
                  {t.rooms.length}실 · 문 {t.doors.length}
                </span>
              </button>
            ))}
          </div>

          <div className="drawRow" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="primary"
              disabled={busy || !libTpl}
              onClick={() => onApplyTemplate(libTpl, "selected")}
            >
              선택 유닛에 적용
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

        {selected?.score && (
          <section>
            <h2>선택 유닛 점수</h2>
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
