"use client";

/** 내부 평면 그리기 전용 패널 — 만들고 라이브러리에 저장. */

import { useState } from "react";
import type { Underlay, UnitTemplate } from "@/utils/types";
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
  underlay: Underlay | null;
  onUnderlay: (underlay: Underlay | null) => void;
  onLoadUnderlay: (file: File) => void;
  onClearUnderlay: () => void;
  onAutoTraceWalls?: () => void;
  underlayAction: "move" | "calibrate" | null;
  onUnderlayAction: (action: "move" | "calibrate" | null) => void;
  calibrationMm: number;
  onCalibrationMm: (value: number) => void;
  onSaveSample: () => void;
  onLoadSample: () => void;
  underlayNotice?: string | null;
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
  underlay,
  onUnderlay,
  onLoadUnderlay,
  onClearUnderlay,
  onAutoTraceWalls,
  underlayAction,
  onUnderlayAction,
  calibrationMm,
  onCalibrationMm,
  onSaveSample,
  onLoadSample,
  underlayNotice,
}: Props) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ special: true, rooms: true, structure: true, general: true });
  const toggleGroup = (id: string) => setOpenGroups((current) => ({ ...current, [id]: !current[id] }));
  return (
    <aside className="sidebar panel interiorPanel">
      <div className="stageBanner stageDraw">
        <div>
          <strong>유닛 에디터 · 모듈 제작</strong>
          <p>
            침실 Type A, 욕실 등 유닛 모듈을 단독 캔버스에서 그리고 저장합니다. 평면
            완성 → 유닛 배치에서 적용합니다.
          </p>
        </div>
      </div>

      <button type="button" className="panelCollapseButton" onClick={() => setPanelOpen((value) => !value)} aria-expanded={panelOpen}>{panelOpen ? "패널 접기" : "패널 열기"}</button>
      {panelOpen && <div className="panelBody">
        <nav className="editorGroupNav" aria-label="도구 그룹">
          {[['special','특수 기능'],['rooms','방 만들기'],['structure','구조물 그리기'],['general','일반']].map(([id,label]) => <button key={id} type="button" className={openGroups[id] ? "on" : ""} onClick={() => toggleGroup(id)}>{label}<span>{openGroups[id] ? "⌃" : "⌄"}</span></button>)}
        </nav>
        <section className={`editorGroupSection group-${openGroups.special ? "open" : "closed"}`}>
          <h2>기존 도면 깔기</h2>
          <p className="note">기존 평면도 이미지를 배경에 놓고 벽·공간을 따라 그립니다.</p>
          <label className="ghost" style={{ display: "block", textAlign: "center", cursor: "pointer" }}>
            도면 이미지 선택
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onLoadUnderlay(file);
                e.currentTarget.value = "";
              }}
            />
          </label>
          {underlay && (
            <div className="toolOptions">
            <button type="button" className="primary" onClick={onAutoTraceWalls} disabled={!onAutoTraceWalls}>200mm 기준으로 벽체 자동 만들기</button>
            <p className="note">검은 선이 뚜렷한 평면도에서 벽체 후보를 추출합니다. 생성 후 벽·문 위치를 확인해 주세요.</p>
              <label className="ctl"><span className="ctlHead">도면 가로 실제 길이 <output>{Math.round(underlay.widthM * 1000)} mm</output></span><input type="range" min={1000} max={50000} step={100} value={Math.round(underlay.widthM * 1000)} onChange={(e) => { const widthM = Number(e.target.value) / 1000; onUnderlay({ ...underlay, widthM, heightM: underlay.lockAspectRatio !== false && underlay.aspectRatio ? widthM / underlay.aspectRatio : underlay.heightM }); }} /></label>
              <label className="ctl"><span className="ctlHead">도면 세로 실제 길이 <output>{Math.round((underlay.heightM ?? canvasD) * 1000)} mm</output></span><input type="range" min={1000} max={50000} step={100} value={Math.round((underlay.heightM ?? canvasD) * 1000)} onChange={(e) => { const heightM = Number(e.target.value) / 1000; onUnderlay({ ...underlay, heightM, widthM: underlay.lockAspectRatio !== false && underlay.aspectRatio ? heightM * underlay.aspectRatio : underlay.widthM }); }} /></label>
              <label className="checkRow"><input type="checkbox" checked={underlay.lockAspectRatio !== false} onChange={(e) => onUnderlay({ ...underlay, lockAspectRatio: e.target.checked })} /> 원본 이미지 가로·세로 비율 묶기</label>
              <label className="ctl"><span className="ctlHead">도면 투명도 <output>{Math.round(underlay.opacity * 100)}%</output></span><input type="range" min={0.1} max={1} step={0.05} value={underlay.opacity} onChange={(e) => onUnderlay({ ...underlay, opacity: Number(e.target.value) })} /></label>
              <p className="note">도면에 표시된 실제 치수(예: 외벽 8400mm)를 가로 또는 세로 길이에 맞추면 해당 스케일로 작도합니다.</p>
            <button type="button" className={underlayAction === "move" ? "primary" : "ghost"} style={{ marginTop: 8 }} onClick={() => onUnderlayAction(underlayAction === "move" ? null : "move")}>도면 마우스로 이동 {underlayAction === "move" ? "· 활성" : ""}</button>
            <label className="ctl" style={{ marginTop: 8 }}><span className="ctlHead">기준 치수 (mm) <output>{calibrationMm}</output></span><input type="number" min={1} max={500000} step={1} value={calibrationMm} onChange={(e) => onCalibrationMm(Math.max(1, Number(e.target.value) || 1))} /><input type="range" min={100} max={50000} step={50} value={Math.min(50000, calibrationMm)} onChange={(e) => onCalibrationMm(Number(e.target.value))} /></label>
            <button type="button" className={underlayAction === "calibrate" ? "primary" : "ghost"} onClick={() => onUnderlayAction(underlayAction === "calibrate" ? null : "calibrate")}>기준 치수 박스 그리기 {underlayAction === "calibrate" ? "· 드래그 중" : ""}</button>
            <p className="note">박스 드래그는 격자 스냅 없이 원본 좌표로 측정합니다.</p>
            <button type="button" className="ghost" onClick={onSaveSample}>현재 도면 샘플 저장</button>
            <button type="button" className="ghost" onClick={onLoadSample}>저장된 샘플 불러오기</button>
            {underlayNotice && <p className="note" role="status">{underlayNotice}</p>}
            <button type="button" className="ghost danger" style={{ marginTop: 8 }} onClick={onClearUnderlay}>
              배경 도면 제거
            </button>
            </div>
          )}
        </section>

        <section className={`editorGroupSection group-${openGroups.rooms ? "open" : "closed"}`}>
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

        <section className={`editorGroupSection group-${openGroups.structure ? "open" : "closed"}`}>
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
          <h2>유닛 라이브러리 저장</h2>
          <p className="note">
            저장 시 검증합니다. 통과하면 <strong>배치 가능(published/valid)</strong>, 오류가
            있으면 <strong>초안(draft)</strong>으로만 저장되며 배치 단계에서는 쓸 수 없습니다.
            원본 라이브러리와 프로젝트 배치 인스턴스는 분리됩니다.
          </p>
          <label className="ctl">
            <span className="ctlHead">유닛 이름</span>
            <input
              className="fullSelect"
              value={saveName}
              placeholder="예: 84A 침실 Type 01"
              onChange={(e) => onSaveName(e.target.value)}
            />
          </label>
          <label className="ctl">
            <span className="ctlHead">분류 · 추천 타입 힌트</span>
            <input
              className="fullSelect"
              value={unitTypeHint}
              placeholder="1BR / 2BR / bedroom"
              onChange={(e) => onUnitTypeHint(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="primary"
            style={{ width: "100%", marginTop: 10 }}
            onClick={onSave}
          >
            검증 후 라이브러리 저장
          </button>
          <p className="note">
            현재는 브라우저 저장소에 보관됩니다. 평면 완성 → 유닛 배치에서 선택·적용합니다.
          </p>
        </section>

        <section>
          <h2>유닛 라이브러리 · {userTemplates.length}</h2>
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
                    {t.status ? ` · ${t.status}` : ""}
                  </em>
                  <span>
                    {t.rooms.length}실 · 문 {t.doors.length}
                    {t.validation?.placeable === false
                      ? " · 배치 불가"
                      : t.validation?.warnings?.length
                        ? ` · 경고 ${t.validation.warnings.length}`
                        : " · 배치 가능"}
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
              평면 완성 · 유닛 배치 →
            </button>
          </div>
        )}
      </div>}
    </aside>
  );
}
