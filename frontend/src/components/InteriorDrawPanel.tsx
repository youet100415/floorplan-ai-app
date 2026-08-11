"use client";

/** 내부 평면 그리기 전용 패널 — 만들고 라이브러리에 저장. */

import type { UnitTemplate } from "@/utils/types";
import type { OpeningKind, ToolId } from "@/lib/plan";

interface Props {
  canvasW: number;
  canvasD: number;
  tool: ToolId;
  openingKind: OpeningKind;
  saveName: string;
  unitTypeHint: string;
  userTemplates: UnitTemplate[];
  zoneCount: number;
  wallCount: number;
  openingCount: number;
  onCanvasW: (v: number) => void;
  onCanvasD: (v: number) => void;
  onTool: (t: ToolId) => void;
  onOpeningKind: (k: OpeningKind) => void;
  onSaveName: (s: string) => void;
  onUnitTypeHint: (s: string) => void;
  onNewBlank: () => void;
  onSave: () => void;
  onDeleteTemplate: (id: string) => void;
  onPickTemplateToEdit?: (id: string) => void;
  onGoApply: () => void;
  canGoApply: boolean;
}

export default function InteriorDrawPanel({
  canvasW,
  canvasD,
  tool,
  openingKind,
  saveName,
  unitTypeHint,
  userTemplates,
  zoneCount,
  wallCount,
  openingCount,
  onCanvasW,
  onCanvasD,
  onTool,
  onOpeningKind,
  onSaveName,
  onUnitTypeHint,
  onNewBlank,
  onSave,
  onDeleteTemplate,
  onGoApply,
  canGoApply,
}: Props) {
  return (
    <aside className="sidebar panel interiorPanel">
      <div className="stageBanner stageDraw">
        <div>
          <strong>내부 평면 그리기</strong>
          <p>벽·실·문을 그린 뒤 저장하면, 「내부 적용」 탭에서 유닛에 끼웁니다.</p>
        </div>
      </div>

      <div className="panelBody">
        <section>
          <h2>작도 캔버스 크기</h2>
          <label className="ctl">
            <span className="ctlHead">
              가로
              <output>{canvasW.toFixed(1)} m</output>
            </span>
            <input
              type="range"
              min={4}
              max={16}
              step={0.5}
              value={canvasW}
              onChange={(e) => onCanvasW(Number(e.target.value))}
            />
          </label>
          <label className="ctl">
            <span className="ctlHead">
              세로
              <output>{canvasD.toFixed(1)} m</output>
            </span>
            <input
              type="range"
              min={4}
              max={14}
              step={0.5}
              value={canvasD}
              onChange={(e) => onCanvasD(Number(e.target.value))}
            />
          </label>
          <button type="button" className="ghost" style={{ marginTop: 8 }} onClick={onNewBlank}>
            이 크기로 새 외곽 만들기
          </button>
          <p className="note">새 외곽 = 빈 사각형 벽. 기존 작도는 지워집니다.</p>
        </section>

        <section>
          <h2>도구</h2>
          <div className="toolGrid">
            {(
              [
                ["select", "선택"],
                ["wall", "벽"],
                ["zone", "실(존)"],
                ["door", "문/창"],
                ["pan", "팬"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`toolBtn${tool === id ? " on" : ""}`}
                onClick={() => onTool(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="drawRow" style={{ marginTop: 8 }}>
            {(
              [
                ["door-single", "여닫이"],
                ["door-sliding", "미닫이"],
                ["window-single", "창"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={openingKind === k ? "on" : ""}
                onClick={() => {
                  onOpeningKind(k);
                  onTool("door");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="note">
            현재: 벽 {wallCount} · 실 {zoneCount} · 개구 {openingCount}
          </p>
        </section>

        <section>
          <h2>라이브러리 저장</h2>
          <label className="ctl">
            <span className="ctlHead">이름</span>
            <input
              className="fullSelect"
              value={saveName}
              placeholder="예: 2BR 표준 A"
              onChange={(e) => onSaveName(e.target.value)}
            />
          </label>
          <label className="ctl">
            <span className="ctlHead">유닛 타입 힌트</span>
            <input
              className="fullSelect"
              value={unitTypeHint}
              placeholder="1BR / 2BR / 3BR"
              onChange={(e) => onUnitTypeHint(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="primary"
            style={{ width: "100%", marginTop: 10 }}
            onClick={onSave}
          >
            저장 (내부 적용에서 사용)
          </button>
          <p className="note">저장본은 브라우저에 남고, 「내부 적용」 탭 목록에 표시됩니다.</p>
        </section>

        <section>
          <h2>저장된 내부 평면 · {userTemplates.length}</h2>
          {userTemplates.length === 0 ? (
            <p className="note">아직 없습니다. 그린 뒤 저장하세요.</p>
          ) : (
            <ul className="tplCards">
              {userTemplates.map((t) => (
                <li key={t.id} className="tplCard static">
                  <strong>{t.name}</strong>
                  <em>
                    {t.bbox.w.toFixed(1)}×{t.bbox.d.toFixed(1)} m
                    {t.unitTypeHint ? ` · ${t.unitTypeHint}` : ""}
                  </em>
                  <span>
                    {t.rooms.length}실 · 문 {t.doors.length}
                  </span>
                  <div className="drawRow" style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        onDeleteTemplate(t.id);
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canGoApply && (
          <div className="actions stickyActions">
            <button type="button" className="primary big" onClick={onGoApply}>
              내부 적용 탭으로 →
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
