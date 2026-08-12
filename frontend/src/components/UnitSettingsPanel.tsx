"use client";

import { useState } from "react";
import type { Underlay } from "@/utils/types";

type Props = {
  canvasW: number;
  canvasD: number;
  wallCount: number;
  zoneCount: number;
  openingCount: number;
  underlay: Underlay | null;
  onCanvasW: (value: number) => void;
  onCanvasD: (value: number) => void;
  onUnderlay: (value: Underlay | null) => void;
  open: boolean;
  onToggleOpen: () => void;
};

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="unitSettingsSection">
      <button type="button" className="unitSettingsHeader" onClick={() => setOpen((value) => !value)}>
        <strong>{title}</strong><span aria-hidden>{open ? "⌃" : "⌄"}</span>
      </button>
      {open && <div className="unitSettingsBody">{children}</div>}
    </section>
  );
}

export default function UnitSettingsPanel({ canvasW, canvasD, wallCount, zoneCount, openingCount, underlay, onCanvasW, onCanvasD, onUnderlay, open, onToggleOpen }: Props) {
  return (
    <aside className={`unitSettings panel${open ? "" : " isClosed"}`} aria-label="유닛 수치 및 설정">
      <button type="button" className="unitSettingsReopen" onClick={onToggleOpen} aria-label={open ? "수치 및 검토 닫기" : "수치 및 검토 열기"}>{open ? "닫기" : "수치·검토 열기"}</button>
      {open && <>
      <div className="unitSettingsTabs"><button type="button" className="unitSettingsTab on">수치</button><button type="button" className="unitSettingsTab">검토</button></div>
      <div className="unitSettingsScroll">
        <div className="unitSettingsTitle"><strong>유닛 설정</strong><span>mm / m</span></div>
        <Section title="도면 크기" defaultOpen>
          <label className="ctl"><span className="ctlHead">가로 <output>{Math.round(canvasW * 1000)} mm</output></span><input type="number" min={3000} max={50000} step={10} value={Math.round(canvasW * 1000)} onChange={(e) => onCanvasW(Number(e.target.value) / 1000)} /></label>
          <label className="ctl"><span className="ctlHead">세로 <output>{Math.round(canvasD * 1000)} mm</output></span><input type="number" min={3000} max={50000} step={10} value={Math.round(canvasD * 1000)} onChange={(e) => onCanvasD(Number(e.target.value) / 1000)} /></label>
        </Section>
        <Section title="배경 도면" defaultOpen>
          {underlay ? <>
            <label className="ctl"><span className="ctlHead">가로 스케일 <output>{Math.round(underlay.widthM * 1000)} mm</output></span><input type="number" min={1} max={500000} step={1} value={Math.round(underlay.widthM * 1000)} onChange={(e) => onUnderlay({ ...underlay, widthM: Number(e.target.value) / 1000 })} /></label>
            <label className="ctl"><span className="ctlHead">세로 스케일 <output>{Math.round((underlay.heightM ?? canvasD) * 1000)} mm</output></span><input type="number" min={1} max={500000} step={1} value={Math.round((underlay.heightM ?? canvasD) * 1000)} onChange={(e) => onUnderlay({ ...underlay, heightM: Number(e.target.value) / 1000 })} /></label>
            <label className="ctl"><span className="ctlHead">투명도 <output>{Math.round(underlay.opacity * 100)}%</output></span><input type="range" min={0.05} max={1} step={0.05} value={underlay.opacity} onChange={(e) => onUnderlay({ ...underlay, opacity: Number(e.target.value) })} /></label>
            <label className="checkRow"><input type="checkbox" checked={underlay.visible} onChange={(e) => onUnderlay({ ...underlay, visible: e.target.checked })} /> 배경 표시</label>
          </> : <p className="note">불러온 배경 도면이 없습니다.</p>}
        </Section>
        <Section title="요소 통계" defaultOpen>
          <div className="unitSettingsStats"><span>벽체 <b>{wallCount}</b></span><span>공간 <b>{zoneCount}</b></span><span>개구부 <b>{openingCount}</b></span></div>
        </Section>
        <Section title="빠른 작업"><p className="note">캔버스에서 우클릭하면 선택 요소의 수치와 빠른 작업을 엽니다.</p></Section>
      </div>
      </>}
    </aside>
  );
}
