"use client";

/** 2단계 전용 좌측 패널 — 내부 작도 · 라이브러리 · Archie (Finch 스타일). */

import { useState } from "react";
import AIAgentChat from "@/components/AIAgentChat";
import type { AgentMessage } from "@/utils/interior/agent";
import { FURNITURE_CATALOG } from "@/utils/interior/furnitureCatalog";
import { roomLabel } from "@/utils/interior/authoring";
import { seriesColor, type Mode } from "@/utils/palette";
import type {
  DoorCategory,
  DoorType,
  InteriorTool,
  Plan,
  RoomKind,
  UnitInterior,
  UnitTemplate,
} from "@/utils/types";

type Scope = "selected" | "type" | "all";

const ROOM_KINDS: RoomKind[] = [
  "living",
  "dining",
  "bedroom",
  "kitchen",
  "bathroom",
  "hallway",
  "storage",
  "other",
];

interface Props {
  plan: Plan;
  mode: Mode;
  templates: UnitTemplate[];
  userTemplates: UnitTemplate[];
  interiors: Record<string, UnitInterior>;
  selectedId: string | null;
  selectedUnitIds: string[];
  agentMessages: AgentMessage[];
  agentBusy: boolean;
  busy: boolean;
  interiorTool: InteriorTool;
  interiorRoomKind: RoomKind;
  interiorDoorCategory: DoorCategory;
  interiorDoorWidth: number;
  interiorFurnId: string;
  interiorDraftLen: number;
  onInteriorTool: (t: InteriorTool) => void;
  onInteriorRoomKind: (k: RoomKind) => void;
  onInteriorDoorCategory: (c: DoorCategory) => void;
  onInteriorDoorWidth: (w: number) => void;
  onInteriorFurnId: (id: string) => void;
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
  onStartEmptyInterior: () => void;
  onCommitRoomDraft: () => void;
  onCancelRoomDraft: () => void;
  onDeleteLastRoom: () => void;
  onDeleteLastDoor: () => void;
  onDeleteLastFurn: () => void;
  onSaveToLibrary: (name: string) => void;
  onBackToZoning: () => void;
}

export default function InteriorPanel({
  plan,
  mode,
  templates,
  userTemplates,
  interiors,
  selectedId,
  selectedUnitIds,
  agentMessages,
  agentBusy,
  busy,
  interiorTool,
  interiorRoomKind,
  interiorDoorCategory,
  interiorDoorWidth,
  interiorFurnId,
  interiorDraftLen,
  onInteriorTool,
  onInteriorRoomKind,
  onInteriorDoorCategory,
  onInteriorDoorWidth,
  onInteriorFurnId,
  onSelectUnit,
  onApplyTemplate,
  onAutoFitInteriors,
  onClearInteriors,
  onBatchDoors,
  onAgentSend,
  onStartEmptyInterior,
  onCommitRoomDraft,
  onCancelRoomDraft,
  onDeleteLastRoom,
  onDeleteLastDoor,
  onDeleteLastFurn,
  onSaveToLibrary,
  onBackToZoning,
}: Props) {
  const allTemplates = [...userTemplates, ...templates];
  const [libTpl, setLibTpl] = useState(allTemplates[0]?.id ?? "1BR_A");
  const [saveName, setSaveName] = useState("");
  const selected = selectedId ? interiors[selectedId] : null;
  const interiorsCount = Object.keys(interiors).length;
  const unit = plan.units.find((u) => u.id === selectedId) ?? null;

  return (
    <aside className="sidebar panel interiorPanel">
      <div className="stageBanner stage2">
        <div>
          <strong>2단계 · 내부 꾸미기 · 점수 데이터</strong>
          <p>실·문·가구를 그리고 점수를 매긴 뒤 라이브러리에 저장합니다.</p>
        </div>
        <button type="button" className="ghost compact" onClick={onBackToZoning}>
          ← 1단계
        </button>
      </div>

      <div className="panelBody">
        {/* ---- 작도 도구 (영상 핵심) ---- */}
        <section>
          <h2>내부 작도 도구</h2>
          <p className="note">
            유닛을 선택한 뒤 도구로 내부를 그립니다. 완성되면 자동 채점됩니다.
          </p>
          {!selectedId && <p className="note warn">도면 또는 아래 목록에서 유닛을 선택하세요.</p>}

          <div className="toolGrid">
            {(
              [
                ["select", "선택"],
                ["room", "실 그리기"],
                ["door", "문"],
                ["furniture", "가구"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`toolBtn${interiorTool === id ? " on" : ""}`}
                disabled={!selectedId && id !== "select"}
                onClick={() => onInteriorTool(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {interiorTool === "room" && (
            <div className="toolOptions">
              <label className="ctl">
                <span className="ctlHead">실 종류</span>
                <select
                  className="fullSelect"
                  value={interiorRoomKind}
                  onChange={(e) => onInteriorRoomKind(e.target.value as RoomKind)}
                >
                  {ROOM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {roomLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="note">클릭으로 점 · 첫 점 근처 또는 Enter 로 닫기 ({interiorDraftLen}점)</p>
              <div className="drawRow">
                <button
                  className="primary"
                  disabled={interiorDraftLen < 3}
                  onClick={onCommitRoomDraft}
                >
                  실 확정
                </button>
                <button onClick={onCancelRoomDraft}>취소</button>
              </div>
              <button className="ghost" style={{ marginTop: 6 }} onClick={onDeleteLastRoom}>
                마지막 실 삭제
              </button>
            </div>
          )}

          {interiorTool === "door" && (
            <div className="toolOptions">
              <label className="ctl">
                <span className="ctlHead">문 종류</span>
                <select
                  className="fullSelect"
                  value={interiorDoorCategory}
                  onChange={(e) => onInteriorDoorCategory(e.target.value as DoorCategory)}
                >
                  <option value="entrance">현관</option>
                  <option value="bathroom">욕실</option>
                  <option value="bedroom">침실</option>
                  <option value="other">기타</option>
                </select>
              </label>
              <label className="ctl">
                <span className="ctlHead">
                  문 폭
                  <output>{Math.round(interiorDoorWidth * 1000)} mm</output>
                </span>
                <input
                  type="range"
                  min={0.6}
                  max={1.2}
                  step={0.01}
                  value={interiorDoorWidth}
                  onChange={(e) => onInteriorDoorWidth(Number(e.target.value))}
                />
              </label>
              <p className="note">유닛 외곽선을 클릭해 문을 붙입니다.</p>
              <button className="ghost" onClick={onDeleteLastDoor}>
                마지막 문 삭제
              </button>
            </div>
          )}

          {interiorTool === "furniture" && (
            <div className="toolOptions">
              <p className="note">Public Objects — 유닛 안을 클릭해 배치</p>
              <div className="furnGrid">
                {FURNITURE_CATALOG.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`furnChip${interiorFurnId === f.id ? " on" : ""}`}
                    onClick={() => onInteriorFurnId(f.id)}
                  >
                    <strong>{f.name}</strong>
                    <em>
                      {Math.round(f.width * 1000)}×{Math.round(f.depth * 1000)}
                    </em>
                  </button>
                ))}
              </div>
              <button className="ghost" style={{ marginTop: 8 }} onClick={onDeleteLastFurn}>
                마지막 가구 삭제
              </button>
            </div>
          )}

          <div className="drawRow" style={{ marginTop: 10 }}>
            <button className="ghost" disabled={!selectedId} onClick={onStartEmptyInterior}>
              빈 내부로 시작
            </button>
          </div>
        </section>

        {/* ---- 점수 · 저장 ---- */}
        {(selected || unit) && (
          <section>
            <h2>점수 · 라이브러리 저장</h2>
            {unit && (
              <p className="note">
                <strong>{unit.id}</strong> · {unit.type} · {unit.area.toFixed(1)} m²
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
                      <li key={r.id}>
                        {r.name}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="note" style={{ marginTop: 8 }}>
                  실 {selected.rooms.length} · 문 {selected.doors.length} · 가구{" "}
                  {selected.furniture?.length ?? 0}
                  {selected.handAuthored ? " · 수동 작도" : ""}
                </p>
                <label className="ctl">
                  <span className="ctlHead">라이브러리 이름</span>
                  <input
                    className="fullSelect"
                    value={saveName}
                    placeholder={`${unit?.type ?? "Unit"} 수동 평면`}
                    onChange={(e) => setSaveName(e.target.value)}
                  />
                </label>
                <button
                  className="primary"
                  style={{ width: "100%", marginTop: 8 }}
                  disabled={!selected || selected.rooms.length < 1}
                  onClick={() =>
                    onSaveToLibrary(saveName.trim() || `${unit?.type ?? "Unit"} 수동 평면`)
                  }
                >
                  학습 데이터로 라이브러리 저장
                </button>
              </>
            ) : (
              <p className="note warn">
                실을 그리거나 템플릿을 적용하면 점수가 계산됩니다.
              </p>
            )}
          </section>
        )}

        <section className="archieSection">
          <AIAgentChat
            messages={agentMessages}
            busy={agentBusy}
            disabled={false}
            onSend={onAgentSend}
          />
        </section>

        <section>
          <h2>템플릿 라이브러리</h2>
          <p className="note">내장 + 직접 저장한 평면</p>
          <div className="tplCards">
            {allTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tplCard${libTpl === t.id ? " on" : ""}`}
                disabled={busy}
                onClick={() => setLibTpl(t.id)}
              >
                <strong>
                  {t.name}
                  {t.id.startsWith("user-") ? " · 내 데이터" : ""}
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
          <div className="drawRow" style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={busy}
              onClick={() => onApplyTemplate(libTpl, "selected")}
            >
              선택 적용
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
                    {it ? (
                      <span className="chip ok">{it.handAuthored ? "작도" : "적용"}</span>
                    ) : (
                      <span className="chip">—</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2>문 일괄 (링크)</h2>
          <div className="drawRow">
            <button
              disabled={busy || interiorsCount === 0}
              onClick={() => onBatchDoors("bathroom", 0.762, "swing_left")}
            >
              욕실 30″
            </button>
            <button
              disabled={busy || interiorsCount === 0}
              onClick={() => onBatchDoors("entrance", 0.914, "swing_left")}
            >
              현관 36″
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}
