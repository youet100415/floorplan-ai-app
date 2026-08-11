/** Archie 스타일 로컬 에이전트 — 자연어 → 도구 호출 (LLM 없이 규칙 파서).
 *
 * 영상 예시:
 *  "모든 욕실·현관 문을 스윙으로, 폭 34″ / 36″"
 *  "change all bathroom doors to swing 34 inch"
 */

import type { DoorCategory, DoorType, Pt, UnitInterior } from "../types";
import { scoreInterior } from "./scoreInterior";

export type AgentRole = "user" | "agent";

export interface AgentMessage {
  id: string;
  role: AgentRole;
  text: string;
  details?: string[];
  /** 요약 카드용 */
  summaryCard?: {
    title: string;
    changes: string[];
    unitIds: string[];
    doorCounts?: { bathroom?: number; entrance?: number; total?: number };
  };
}

export type DoorCategoryFilter = DoorCategory | "all";

export interface AgentToolResult {
  ok: boolean;
  summary: string;
  details: string[];
  updatedUnitIds: string[];
  nextInteriors: Record<string, UnitInterior>;
  doorCounts: { bathroom: number; entrance: number; bedroom: number; total: number };
}

export interface ParsedAgentCommand {
  kind: "update_doors" | "apply_auto" | "score_report" | "help" | "unknown";
  categories: DoorCategoryFilter[];
  type?: DoorType;
  /** 카테고리별 폭(m). 없으면 widthM 공통 */
  widthByCategory?: Partial<Record<DoorCategory, number>>;
  widthM?: number;
  raw: string;
}

const INCH = 0.0254;

function inchToM(inch: number): number {
  return Math.round(inch * INCH * 1000) / 1000;
}

/** 텍스트에서 인치/미터 폭 추출 (여러 개면 등장 순). */
function extractWidths(text: string): number[] {
  const out: number[] = [];
  const inchRe = /(\d+(?:\.\d+)?)\s*(?:″|"|''|in(?:ch(?:es)?)?|인치)/gi;
  let m: RegExpExecArray | null;
  while ((m = inchRe.exec(text))) {
    out.push(inchToM(Number(m[1])));
  }
  const mRe = /(\d+(?:\.\d+)?)\s*(?:m|미터|미)(?![a-z가-힣])/gi;
  while ((m = mRe.exec(text))) {
    const v = Number(m[1]);
    if (v > 0.3 && v < 2.5) out.push(v);
  }
  // bare 34 / 36 near door words
  if (out.length === 0) {
    const bare = text.match(/\b(28|30|32|34|36|42)\b/g);
    if (bare) for (const b of bare) out.push(inchToM(Number(b)));
  }
  return out;
}

function detectDoorType(text: string): DoorType | undefined {
  const t = text.toLowerCase();
  if (/pocket|포켓/.test(t)) return "pocket";
  if (/slid|미서기|슬라이드/.test(t)) return "sliding";
  if (/swing|여닫|스윙|hinge|경첩/.test(t)) return "swing_left";
  if (/바꿔|변경|change|update|convert/.test(t) && /문|door/.test(t)) return "swing_left";
  return undefined;
}

function detectCategories(text: string): DoorCategoryFilter[] {
  const t = text.toLowerCase();
  const cats: DoorCategoryFilter[] = [];
  if (/욕실|bathroom|bath\b|toilet|화장실/.test(t)) cats.push("bathroom");
  if (/현관|entrance|entry|main\s*door|입구/.test(t)) cats.push("entrance");
  if (/침실|bedroom|bed\s*room/.test(t)) cats.push("bedroom");
  if (/모든\s*문|all\s*doors|전체\s*문|every\s*door/.test(t) && cats.length === 0) {
    cats.push("all");
  }
  // "bathroom and entrance"
  if (cats.length === 0 && /문|door/.test(t)) {
    if (/전부|모두|all|전체/.test(t)) cats.push("all");
  }
  return cats;
}

export function parseAgentCommand(raw: string): ParsedAgentCommand {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (!text || /^(help|도움|도움말|\?)$/i.test(text)) {
    return { kind: "help", categories: [], raw: text };
  }
  if (/자동\s*배치|auto\s*fit|타입별\s*자동|템플릿\s*적용/.test(lower)) {
    return { kind: "apply_auto", categories: [], raw: text };
  }
  if (/점수|score|검토\s*보고|리포트|요약/.test(lower) && !/문|door/.test(lower)) {
    return { kind: "score_report", categories: [], raw: text };
  }

  const categories = detectCategories(text);
  const type = detectDoorType(text);
  const widths = extractWidths(text);

  const doorIntent =
    categories.length > 0 ||
    type !== undefined ||
    widths.length > 0 ||
    /문|door|스윙|swing|여닫/.test(lower);

  if (!doorIntent) {
    return { kind: "unknown", categories: [], raw: text };
  }

  // 기본: 욕실+현관 (영상 시나리오)
  const cats: DoorCategoryFilter[] =
    categories.length > 0 ? categories : (["bathroom", "entrance"] as DoorCategoryFilter[]);

  const widthByCategory: Partial<Record<DoorCategory, number>> = {};
  if (widths.length >= 2 && cats.includes("bathroom") && cats.includes("entrance")) {
    // 등장 순: 보통 욕실 먼저 또는 34 bath / 36 entry
    const sorted = [...widths].sort((a, b) => a - b);
    widthByCategory.bathroom = sorted[0];
    widthByCategory.entrance = sorted[sorted.length - 1];
  } else if (widths.length === 1) {
    // 단일 폭
  } else if (widths.length >= 2) {
    cats.forEach((c, i) => {
      if (c !== "all") widthByCategory[c] = widths[Math.min(i, widths.length - 1)];
    });
  }

  // 명시적 매핑: "욕실 34" "현관 36"
  const bathW = text.match(/욕실[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(?:″|"|인치|in)?/i);
  const entW = text.match(/현관[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(?:″|"|인치|in)?/i);
  const bathWe = text.match(/bathroom[^0-9]{0,12}(\d+(?:\.\d+)?)/i);
  const entWe = text.match(/entrance[^0-9]{0,12}(\d+(?:\.\d+)?)/i);
  if (bathW) widthByCategory.bathroom = Number(bathW[1]) > 3 ? inchToM(Number(bathW[1])) : Number(bathW[1]);
  if (entW) widthByCategory.entrance = Number(entW[1]) > 3 ? inchToM(Number(entW[1])) : Number(entW[1]);
  if (bathWe) widthByCategory.bathroom = Number(bathWe[1]) > 3 ? inchToM(Number(bathWe[1])) : Number(bathWe[1]);
  if (entWe) widthByCategory.entrance = Number(entWe[1]) > 3 ? inchToM(Number(entWe[1])) : Number(entWe[1]);

  return {
    kind: "update_doors",
    categories: cats,
    type: type ?? "swing_left",
    widthM: widths.length === 1 ? widths[0] : undefined,
    widthByCategory: Object.keys(widthByCategory).length ? widthByCategory : undefined,
    raw: text,
  };
}

function categoryMatch(cat: DoorCategory, filters: DoorCategoryFilter[]): boolean {
  if (filters.includes("all")) return true;
  return filters.includes(cat);
}

function widthFor(
  cat: DoorCategory,
  cmd: ParsedAgentCommand,
): number | undefined {
  if (cmd.widthByCategory?.[cat] != null) return cmd.widthByCategory[cat];
  return cmd.widthM;
}

/** 전 유닛 대상 문 업데이트 (링크 그룹 무관 — 영상처럼 해당 스토리 전 유닛). */
export function executeDoorUpdate(
  interiors: Record<string, UnitInterior>,
  cmd: ParsedAgentCommand,
  unitPolygons: Record<string, Pt[]>,
): AgentToolResult {
  if (Object.keys(interiors).length === 0) {
    return {
      ok: false,
      summary: "내부 평면이 없습니다. 먼저 라이브러리 템플릿을 적용하세요.",
      details: ["타입별 자동 배치 또는 템플릿 카드를 사용하세요."],
      updatedUnitIds: [],
      nextInteriors: interiors,
      doorCounts: { bathroom: 0, entrance: 0, bedroom: 0, total: 0 },
    };
  }

  const next: Record<string, UnitInterior> = { ...interiors };
  const updatedUnitIds: string[] = [];
  const details: string[] = [];
  const counts = { bathroom: 0, entrance: 0, bedroom: 0, total: 0 };

  for (const [uid, it] of Object.entries(interiors)) {
    let mod = false;
    const doors = it.doors.map((d) => {
      if (!categoryMatch(d.category, cmd.categories)) return d;
      const w = widthFor(d.category, cmd);
      const newType = cmd.type ?? d.type;
      const newW = w ?? d.width;
      if (newType === d.type && Math.abs(newW - d.width) < 1e-6) return d;
      mod = true;
      if (d.category === "bathroom") counts.bathroom += 1;
      if (d.category === "entrance") counts.entrance += 1;
      if (d.category === "bedroom") counts.bedroom += 1;
      counts.total += 1;
      return { ...d, type: newType, width: newW };
    });
    if (!mod) continue;
    const poly = unitPolygons[uid] ?? [];
    const updated: UnitInterior = { ...it, doors };
    updated.score = scoreInterior(updated, poly);
    next[uid] = updated;
    updatedUnitIds.push(uid);
    const inch = (m: number) => Math.round(m / INCH);
    details.push(
      `${uid}: 문 갱신 (${doors
        .filter((d) => categoryMatch(d.category, cmd.categories))
        .map((d) => `${d.category} ${inch(d.width)}″ ${d.type}`)
        .join(", ")})`,
    );
  }

  if (updatedUnitIds.length === 0) {
    return {
      ok: false,
      summary: "조건에 맞는 문을 찾지 못했습니다.",
      details: [
        `필터: ${cmd.categories.join(", ")}`,
        "유닛에 내부 평면이 적용돼 있는지 확인하세요.",
      ],
      updatedUnitIds: [],
      nextInteriors: interiors,
      doorCounts: counts,
    };
  }

  const typeLabel = cmd.type ?? "기존 타입";
  const summary =
    `완료: ${updatedUnitIds.length}개 유닛 · 문 ${counts.total}개 수정 ` +
    `(${typeLabel}` +
    (cmd.widthByCategory
      ? `, 욕실 ${fmtW(cmd.widthByCategory.bathroom)} / 현관 ${fmtW(cmd.widthByCategory.entrance)}`
      : cmd.widthM
        ? `, 폭 ${fmtW(cmd.widthM)}`
        : "") +
    ").";

  return {
    ok: true,
    summary,
    details,
    updatedUnitIds,
    nextInteriors: next,
    doorCounts: counts,
  };
}

function fmtW(m?: number): string {
  if (m == null) return "—";
  return `${Math.round(m / INCH)}″(${m.toFixed(2)}m)`;
}

export function buildScoreReport(interiors: Record<string, UnitInterior>): AgentToolResult {
  const list = Object.values(interiors);
  if (list.length === 0) {
    return {
      ok: false,
      summary: "채점할 내부 평면이 없습니다.",
      details: [],
      updatedUnitIds: [],
      nextInteriors: interiors,
      doorCounts: { bathroom: 0, entrance: 0, bedroom: 0, total: 0 },
    };
  }
  const avg =
    list.reduce((s, i) => s + (i.score?.total ?? 0), 0) / list.length;
  const worst = [...list].sort(
    (a, b) => (a.score?.total ?? 0) - (b.score?.total ?? 0),
  )[0];
  const details = list
    .slice(0, 12)
    .map((i) => `${i.unitId}: ${i.score?.total ?? "—"}% (C${i.score?.compliance}/A${i.score?.adaptivity}/D${i.score?.daylight})`);
  return {
    ok: true,
    summary: `내부 점수 평균 ${avg.toFixed(1)}% · ${list.length}호. 최저 ${worst.unitId} ${worst.score?.total ?? "—"}%.`,
    details,
    updatedUnitIds: list.map((i) => i.unitId),
    nextInteriors: interiors,
    doorCounts: { bathroom: 0, entrance: 0, bedroom: 0, total: 0 },
  };
}

export const AGENT_HELP = [
  "예: 모든 욕실 문을 34인치 여닫이문으로 바꿔줘",
  "예: 현관은 36인치, 욕실은 34인치 스윙으로",
  "예: change all bathroom and entrance doors to swing 34 and 36 inch",
  "예: 점수 요약 / 타입별 자동 배치",
].join("\n");

export function runAgentLocal(
  raw: string,
  interiors: Record<string, UnitInterior>,
  unitPolygons: Record<string, Pt[]>,
  hooks?: { onApplyAuto?: () => Record<string, UnitInterior> },
): AgentToolResult & { parsed: ParsedAgentCommand } {
  const parsed = parseAgentCommand(raw);

  if (parsed.kind === "help") {
    return {
      ok: true,
      summary: "Archie 도움말",
      details: AGENT_HELP.split("\n"),
      updatedUnitIds: [],
      nextInteriors: interiors,
      doorCounts: { bathroom: 0, entrance: 0, bedroom: 0, total: 0 },
      parsed,
    };
  }

  if (parsed.kind === "apply_auto") {
    if (!hooks?.onApplyAuto) {
      return {
        ok: false,
        summary: "자동 배치를 실행할 수 없습니다.",
        details: [],
        updatedUnitIds: [],
        nextInteriors: interiors,
        doorCounts: { bathroom: 0, entrance: 0, bedroom: 0, total: 0 },
        parsed,
      };
    }
    const next = hooks.onApplyAuto();
    return {
      ok: true,
      summary: `타입별 템플릿 자동 적용 · ${Object.keys(next).length}호`,
      details: Object.keys(next).map((id) => `${id} ← ${next[id].templateId}`),
      updatedUnitIds: Object.keys(next),
      nextInteriors: next,
      doorCounts: { bathroom: 0, entrance: 0, bedroom: 0, total: 0 },
      parsed,
    };
  }

  if (parsed.kind === "score_report") {
    return { ...buildScoreReport(interiors), parsed };
  }

  if (parsed.kind === "update_doors") {
    // 기본 폭: 영상처럼 bath 34 / entry 36
    if (!parsed.widthM && !parsed.widthByCategory) {
      const cats = parsed.categories;
      const wmap: Partial<Record<import("../types").DoorCategory, number>> = {};
      if (cats.includes("bathroom") || cats.includes("all")) wmap.bathroom = inchToM(34);
      if (cats.includes("entrance") || cats.includes("all")) wmap.entrance = inchToM(36);
      if (cats.includes("bedroom")) wmap.bedroom = inchToM(32);
      parsed.widthByCategory = wmap;
      if (cats.includes("all") && !parsed.widthM) parsed.widthM = inchToM(34);
    }
    return { ...executeDoorUpdate(interiors, parsed, unitPolygons), parsed };
  }

  return {
    ok: false,
    summary: "명령을 이해하지 못했습니다.",
    details: ["문 변경·점수·자동 배치를 요청해 보세요.", ...AGENT_HELP.split("\n")],
    updatedUnitIds: [],
    nextInteriors: interiors,
    doorCounts: { bathroom: 0, entrance: 0, bedroom: 0, total: 0 },
    parsed,
  };
}
