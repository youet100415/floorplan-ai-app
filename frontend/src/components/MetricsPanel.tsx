"use client";

/** 우측 결과 패널 — 지표 / 검토 / 대안 / 분석 탭. */

import { useEffect, useMemo, useState } from "react";
import { seriesColor, type Mode } from "@/utils/palette";
import type { Check, Plan, PopulationPoint, UnitInterior } from "@/utils/types";

type MetricsTab = "summary" | "checks" | "options" | "analysis";

const LEVEL_LABEL: Record<Check["level"], string> = {
  pass: "적합",
  warn: "주의",
  fail: "부적합",
};

const LEVEL_ICON: Record<Check["level"], string> = {
  pass: "✓",
  warn: "!",
  fail: "✕",
};

function Stat({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="stat">
      <span className="statLabel">{label}</span>
      <span className="statValue">
        {value}
        {unit && <em>{unit}</em>}
      </span>
      {sub && <span className="statSub">{sub}</span>}
    </div>
  );
}

function UnitCountStepper({
  count,
  target,
  busy,
  onChange,
}: {
  count: number;
  target: number | null;
  busy: boolean;
  onChange: (n: number | null) => void;
}) {
  const base = target ?? count;
  const capped = target !== null && count < target;

  return (
    <div className="stat unitStep">
      <span className="statLabel">세대수</span>
      <div className="stepRow">
        <button
          type="button"
          className="stepBtn"
          disabled={busy || base <= 1}
          title="한 호 줄여 다시 생성"
          onClick={() => onChange(base - 1)}
        >
          −
        </button>
        <span className="statValue">
          {count}
          <em>호</em>
        </span>
        <button
          type="button"
          className="stepBtn"
          disabled={busy || capped}
          title={capped ? "제약에 걸려 더 늘릴 수 없습니다" : "한 호 늘려 다시 생성"}
          onClick={() => onChange(base + 1)}
        >
          ＋
        </button>
      </div>
      {target === null ? (
        <span className="statSub">면적 기준 자동 산정</span>
      ) : (
        <span className={`statSub${count === target ? "" : " warn"}`}>
          목표 {target}호{count === target ? "" : " — 제약으로 미달"}
          <button type="button" className="linkBtn" disabled={busy} onClick={() => onChange(null)}>
            자동으로
          </button>
        </span>
      )}
    </div>
  );
}

export default function MetricsPanel({
  plan,
  mode,
  options,
  activeIndex,
  onPickOption,
  unitCountTarget,
  onUnitCountTarget,
  busy,
  interiors = {},
  selectedId = null,
  population = [],
  stage = 1,
}: {
  plan: Plan | null;
  mode: Mode;
  options: Plan[];
  activeIndex: number;
  onPickOption: (i: number) => void;
  unitCountTarget: number | null;
  onUnitCountTarget: (n: number | null) => void;
  busy: boolean;
  interiors?: Record<string, UnitInterior>;
  selectedId?: string | null;
  population?: PopulationPoint[];
  /** 1=조닝 결과 중심 · 2=내부 분석 중심 */
  stage?: 1 | 2 | 3;
}) {
  const [tab, setTab] = useState<MetricsTab>("summary");
  const hasOptions = options.length > 1;
  const interiorList = useMemo(() => Object.values(interiors), [interiors]);
  const avgInterior =
    interiorList.length === 0
      ? null
      : interiorList.reduce((s, i) => s + (i.score?.total ?? 0), 0) / interiorList.length;

  // 적용(3) 진입 시 분석 탭, 대안 탐색 시 대안 탭
  useEffect(() => {
    if (stage === 2 || stage === 3) setTab("analysis");
  }, [stage]);
  useEffect(() => {
    if (hasOptions && stage === 1) setTab("options");
  }, [hasOptions, options.length, stage]);

  if (!plan) {
    return (
      <aside className="metrics empty panel">
        <nav className="panelTabs" aria-label="결과 탭">
          <button type="button" className="panelTab on" disabled>
            지표
          </button>
          <button type="button" className="panelTab" disabled>
            검토
          </button>
          <button type="button" className="panelTab" disabled>
            대안
          </button>
          <button type="button" className="panelTab" disabled>
            분석
          </button>
        </nav>
        <div className="panelBody emptyHint">
          <p>
            좌측 <strong>조닝</strong> · <strong>Unit Mix</strong>를 설정한 뒤
            <br />
            <strong>평면 생성</strong>을 누르세요.
          </p>
        </div>
      </aside>
    );
  }

  const m = plan.metrics;
  const maxRatio = Math.max(...m.mix.map((r) => Math.max(r.actual_ratio, r.target_ratio)), 0.01);
  const failN = plan.compliance.filter((c) => c.level === "fail").length;
  const warnN = plan.compliance.filter((c) => c.level === "warn").length;

  return (
    <aside className="metrics panel">
      <nav className="panelTabs" aria-label="결과 탭">
        <button
          type="button"
          className={`panelTab${tab === "summary" ? " on" : ""}`}
          onClick={() => setTab("summary")}
        >
          지표
        </button>
        <button
          type="button"
          className={`panelTab${tab === "checks" ? " on" : ""}`}
          onClick={() => setTab("checks")}
        >
          검토
          {(failN > 0 || warnN > 0) && (
            <span className={`tabBadge${failN > 0 ? " bad" : " warn"}`}>
              {failN > 0 ? failN : warnN}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`panelTab${tab === "options" ? " on" : ""}`}
          disabled={!hasOptions}
          title={hasOptions ? "대안 비교" : "대안 탐색 후 사용"}
          onClick={() => hasOptions && setTab("options")}
        >
          대안
          {hasOptions && <span className="tabBadge">{options.length}</span>}
        </button>
        <button
          type="button"
          className={`panelTab${tab === "analysis" ? " on" : ""}`}
          onClick={() => setTab("analysis")}
        >
          분석
          {interiorList.length > 0 && (
            <span className="tabBadge">{interiorList.length}</span>
          )}
        </button>
      </nav>

      <div className="panelBody">
        {tab === "summary" && (
          <>
            <section>
              <h2>결과 지표</h2>
              <div className="statGrid">
                <UnitCountStepper
                  count={m.unit_count}
                  target={unitCountTarget}
                  busy={busy}
                  onChange={onUnitCountTarget}
                />
                <Stat
                  label="전용률"
                  value={(m.efficiency * 100).toFixed(1)}
                  unit="%"
                  sub={`전용 ${m.net_unit_area.toLocaleString()} / 연 ${m.gross_area.toLocaleString()} m²`}
                />
                <Stat
                  label="최대 보행거리"
                  value={m.max_travel_distance?.toFixed(1) ?? "—"}
                  unit="m"
                  sub={
                    m.avg_travel_distance !== null
                      ? `평균 ${m.avg_travel_distance.toFixed(1)} m`
                      : undefined
                  }
                />
                <Stat
                  label="평균 면적오차"
                  value={m.mean_area_error_pct.toFixed(1)}
                  unit="%"
                  sub="목표 전용면적 대비"
                />
              </div>
              <table className="areaTable">
                <tbody>
                  <tr>
                    <th>전용 합계</th>
                    <td>{m.net_unit_area.toLocaleString()} m²</td>
                  </tr>
                  <tr>
                    <th>복도</th>
                    <td>{m.corridor_area.toLocaleString()} m²</td>
                  </tr>
                  <tr>
                    <th>코어</th>
                    <td>{m.core_area.toLocaleString()} m²</td>
                  </tr>
                  <tr className={m.unreachable_area > 0 ? "bad" : ""}>
                    <th>사장 면적</th>
                    <td>{m.unreachable_area.toLocaleString()} m²</td>
                  </tr>
                  <tr>
                    <th>막다른 복도</th>
                    <td>{m.dead_end_length.toLocaleString()} m</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section>
              <h2>Unit Mix — 목표 대비 실적</h2>
              <ul className="mixBars">
                {m.mix.map((r, i) => (
                  <li key={r.type}>
                    <div className="mixHead">
                      <span className="swatch" style={{ background: seriesColor(mode, i) }} />
                      <strong>{r.type}</strong>
                      <span className="mixCount">{r.count}호</span>
                      <span className="mixPct">
                        {(r.actual_ratio * 100).toFixed(0)}%
                        <em> / 목표 {(r.target_ratio * 100).toFixed(0)}%</em>
                      </span>
                    </div>
                    <div className="track">
                      <div
                        className="fill"
                        style={{
                          width: `${(r.actual_ratio / maxRatio) * 100}%`,
                          background: seriesColor(mode, i),
                        }}
                      />
                      <div
                        className="targetMark"
                        style={{ left: `${(r.target_ratio / maxRatio) * 100}%` }}
                      />
                    </div>
                    <small>
                      평균 {r.avg_area.toFixed(1)} m² · 목표 {r.target_area} m²
                    </small>
                  </li>
                ))}
              </ul>
              <p className="legendNote">
                <span className="targetMark inline" /> 세로선 = 목표 비율
              </p>
            </section>
          </>
        )}

        {tab === "checks" && (
          <section>
            <h2>동선 · 법규 검토</h2>
            <ul className="checks">
              {plan.compliance.map((c) => (
                <li key={c.code} className={c.level}>
                  <span className="badge">
                    <i aria-hidden="true">{LEVEL_ICON[c.level]}</i>
                    {LEVEL_LABEL[c.level]}
                  </span>
                  <div>
                    <strong>{c.code}</strong>
                    <p>{c.message}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="note" style={{ padding: "0 0 8px" }}>
              설계 검토용 휴리스틱입니다. 실제 건축법·피난규정 심의를 대체하지 않습니다.
            </p>
          </section>
        )}

        {tab === "options" && hasOptions && (
          <section>
            <h2>대안 비교 ({options.length}개)</h2>
            <table className="optTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>점수</th>
                  <th>코어</th>
                  <th>여백</th>
                  <th>세대</th>
                  <th>전용률</th>
                  <th>보행</th>
                </tr>
              </thead>
              <tbody>
                {options.map((o, i) => (
                  <tr
                    key={i}
                    className={i === activeIndex ? "on" : ""}
                    onClick={() => onPickOption(i)}
                  >
                    <td>{i + 1}</td>
                    <td className="num">{o.score.toFixed(1)}</td>
                    <td className="num">{o.params.core_count ?? "auto"}</td>
                    <td className="num">{o.params.corridor_end_inset}m</td>
                    <td className="num">{o.metrics.unit_count}</td>
                    <td className="num">{(o.metrics.efficiency * 100).toFixed(1)}%</td>
                    <td className="num">{o.metrics.max_travel_distance?.toFixed(0) ?? "—"}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="legendNote">행을 클릭하면 해당 대안이 도면에 표시됩니다.</p>
          </section>
        )}

        {tab === "analysis" && (
          <>
            <section>
              <h2>내부 평면 점수</h2>
              {interiorList.length === 0 ? (
                <p className="note">
                  좌측 <strong>내부</strong> 탭에서 라이브러리 템플릿을 적용하면
                  Compliance / Adaptivity / Daylight 점수가 집계됩니다.
                </p>
              ) : (
                <>
                  <div className="statGrid">
                    <Stat
                      label="적용 유닛"
                      value={String(interiorList.length)}
                      unit="호"
                    />
                    <Stat
                      label="평균 내부점수"
                      value={avgInterior != null ? avgInterior.toFixed(1) : "—"}
                      unit="%"
                    />
                  </div>
                  {selectedId && interiors[selectedId]?.score && (
                    <div className="scoreGrid" style={{ marginTop: 10 }}>
                      <div>
                        <span>선택 종합</span>
                        <strong>{interiors[selectedId].score!.total}%</strong>
                      </div>
                      <div>
                        <span>C</span>
                        <strong>{interiors[selectedId].score!.compliance}</strong>
                      </div>
                      <div>
                        <span>A</span>
                        <strong>{interiors[selectedId].score!.adaptivity}</strong>
                      </div>
                      <div>
                        <span>D</span>
                        <strong>{interiors[selectedId].score!.daylight}</strong>
                      </div>
                    </div>
                  )}
                  {selectedId && interiors[selectedId]?.egressPath && (
                    <p className="note" style={{ marginTop: 8 }}>
                      피난(직선){" "}
                      <strong>
                        {interiors[selectedId].egressPath!.distanceMeters.toFixed(1)} m
                      </strong>
                    </p>
                  )}
                </>
              )}
            </section>

            <section>
              <h2>Population (면적 × 모서리)</h2>
              <PopulationScatter
                points={population}
                currentId={selectedId}
                mode={mode}
              />
              <p className="legendNote">빨간 점 = 선택 유닛 · 회색 = 전체 세대</p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function PopulationScatter({
  points,
  currentId,
  mode,
}: {
  points: PopulationPoint[];
  currentId: string | null;
  mode: Mode;
}) {
  if (points.length === 0) {
    return <p className="note">생성 결과가 없습니다.</p>;
  }
  const maxA = Math.max(...points.map((p) => p.areaM2), 1);
  const maxE = Math.max(...points.map((p) => p.edges), 4);
  const minE = Math.min(...points.map((p) => p.edges), 3);
  const w = 280;
  const h = 160;
  const pad = 28;
  const xOf = (a: number) => pad + (a / maxA) * (w - pad * 1.4);
  const yOf = (e: number) =>
    h - pad - ((e - minE) / Math.max(maxE - minE, 1)) * (h - pad * 1.5);

  return (
    <svg className="popChart" viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
      <line x1={pad} y1={h - pad} x2={w - 8} y2={h - pad} stroke="currentColor" opacity={0.2} />
      <line x1={pad} y1={12} x2={pad} y2={h - pad} stroke="currentColor" opacity={0.2} />
      <text x={w / 2} y={h - 6} textAnchor="middle" fontSize="10" fill="currentColor" opacity={0.55}>
        Area m²
      </text>
      <text
        x={12}
        y={h / 2}
        textAnchor="middle"
        fontSize="10"
        fill="currentColor"
        opacity={0.55}
        transform={`rotate(-90 12 ${h / 2})`}
      >
        Edges
      </text>
      {points.map((p) => {
        const cur = p.id === currentId;
        return (
          <circle
            key={p.id}
            cx={xOf(p.areaM2)}
            cy={yOf(p.edges)}
            r={cur ? 6 : 3.5}
            fill={cur ? "#e53935" : mode === "light" ? "#7c8db5" : "#9aa8c7"}
            opacity={cur ? 1 : 0.55}
          >
            <title>
              {p.id} · {p.areaM2}m² · {p.edges} edges
            </title>
          </circle>
        );
      })}
    </svg>
  );
}
