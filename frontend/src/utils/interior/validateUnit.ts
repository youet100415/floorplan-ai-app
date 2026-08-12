/** 유닛 에디터 저장 시 유효성 검사 (명세 3.1). */

import { polygonArea } from "../geom";
import type { PlanDocument, Point, Wall } from "@/lib/plan/types";
import type { UnitTemplate, UnitValidation, UnitValidationIssue } from "../types";

function wallLen(w: Wall): number {
  return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
}

function segmentsCross(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): boolean {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

/** PlanDocument 기준 검사 — 유닛 에디터 저장 직전 */
export function validatePlanDocument(doc: PlanDocument): UnitValidation {
  const errors: UnitValidationIssue[] = [];
  const warnings: UnitValidationIssue[] = [];

  // 외곽
  const boundary = doc.siteBoundary;
  if (!boundary || boundary.length < 3) {
    errors.push({
      code: "BOUNDARY",
      level: "error",
      message: "외곽선이 없습니다. 「새 외곽 만들기」로 닫힌 외곽을 만드세요.",
    });
  } else {
    const area = polygonArea(boundary.map((p) => [p.x, p.y] as [number, number]));
    if (area < 1) {
      errors.push({
        code: "BOUNDARY_AREA",
        level: "error",
        message: `외곽 면적이 너무 작습니다 (${area.toFixed(2)} m²).`,
      });
    }
  }

  if (doc.walls.length < 3) {
    warnings.push({
      code: "WALLS_FEW",
      level: "warning",
      message: "벽이 3개 미만입니다. 닫힌 외곽 루프인지 확인하세요.",
    });
  }

  // 벽 교차 (공유 끝점 제외 단순 검사)
  for (let i = 0; i < doc.walls.length; i++) {
    for (let j = i + 1; j < doc.walls.length; j++) {
      const a = doc.walls[i];
      const b = doc.walls[j];
      const share =
        (Math.hypot(a.a.x - b.a.x, a.a.y - b.a.y) < 1e-3 ||
          Math.hypot(a.a.x - b.b.x, a.a.y - b.b.y) < 1e-3 ||
          Math.hypot(a.b.x - b.a.x, a.b.y - b.a.y) < 1e-3 ||
          Math.hypot(a.b.x - b.b.x, a.b.y - b.b.y) < 1e-3);
      if (share) continue;
      if (segmentsCross(a.a, a.b, b.a, b.b)) {
        warnings.push({
          code: "WALL_CROSS",
          level: "warning",
          message: `벽이 교차할 수 있습니다 (${a.id} × ${b.id}).`,
        });
      }
    }
  }

  // 문/창이 벽에 연결
  for (const o of doc.openings) {
    const w = doc.walls.find((x) => x.id === o.wallId);
    if (!w) {
      errors.push({
        code: "OPENING_ORPHAN",
        level: "error",
        message: `문/창 ${o.id} 이(가) 유효한 벽에 연결되어 있지 않습니다.`,
      });
      continue;
    }
    const L = wallLen(w);
    if (o.width > L + 1e-6) {
      errors.push({
        code: "OPENING_WIDTH",
        level: "error",
        message: `문/창 폭 ${o.width.toFixed(2)}m 가 벽 길이 ${L.toFixed(2)}m 를 초과합니다.`,
      });
    }
    if (o.offset < 0 || o.offset > L) {
      warnings.push({
        code: "OPENING_OFFSET",
        level: "warning",
        message: `문/창 ${o.id} 위치가 벽 범위를 벗어납니다.`,
      });
    }
  }

  // 존 면적
  for (const z of doc.zones) {
    if (z.points.length < 3) {
      errors.push({
        code: "ZONE_POINTS",
        level: "error",
        message: `존「${z.name}」점 개수가 부족합니다.`,
      });
      continue;
    }
    const a = polygonArea(z.points.map((p) => [p.x, p.y] as [number, number]));
    if (a < 0.05) {
      errors.push({
        code: "ZONE_AREA",
        level: "error",
        message: `존「${z.name}」면적이 0에 가깝습니다.`,
      });
    }
  }

  if (doc.zones.length === 0 && doc.openings.length === 0) {
    errors.push({
      code: "EMPTY",
      level: "error",
      message: "실(존) 또는 문/창이 없습니다. 내부를 구성한 뒤 저장하세요.",
    });
  }

  if (!doc.name?.trim()) {
    warnings.push({
      code: "NAME",
      level: "warning",
      message: "유닛 이름이 비어 있습니다.",
    });
  }

  const placeable = errors.length === 0;
  return {
    is_valid: placeable && warnings.length === 0,
    placeable,
    errors,
    warnings,
    validated_at: new Date().toISOString(),
  };
}

/**
 * 조닝 영역(유닛) ↔ 라이브러리 템플릿 추천 점수 (명세 §5).
 * 용도 40% · 면적 30% · 폭/깊이 15% · 접속 10% · 외곽 5%
 */
export function scoreTemplateMatch(
  zone: { type: string; area: number; width?: number; depth?: number },
  tpl: UnitTemplate,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const hint = (tpl.unitTypeHint ?? "").toUpperCase();
  const zType = zone.type.toUpperCase();
  const cats = (tpl.placement_constraints?.zone_categories ?? []).map((c) => c.toUpperCase());
  const typeHit =
    (hint && (zType.includes(hint) || hint.includes(zType))) ||
    cats.some((c) => c && (zType.includes(c) || c.includes(zType)));
  if (typeHit) {
    score += 40;
    reasons.push("용도 일치");
  } else if (!hint && cats.length === 0) {
    score += 15;
    reasons.push("타입 힌트 없음");
  } else {
    reasons.push("용도 불일치");
  }

  const tplArea = tpl.bbox.w * tpl.bbox.d;
  const minA = tpl.placement_constraints?.min_zone_area_sqm ?? tplArea * 0.5;
  if (zone.area >= minA * 0.85 && zone.area <= tplArea * 1.6) {
    score += 30;
    reasons.push("면적 적합");
  } else if (zone.area >= minA * 0.6) {
    score += 15;
    reasons.push("면적 부분 적합");
  } else {
    reasons.push("면적 부적합");
  }

  const zw = zone.width ?? Math.sqrt(zone.area);
  const zd = zone.depth ?? Math.sqrt(zone.area);
  const fitW = Math.min(zw / tpl.bbox.w, tpl.bbox.w / zw);
  const fitD = Math.min(zd / tpl.bbox.d, tpl.bbox.d / zd);
  if (fitW > 0.75 && fitD > 0.75) {
    score += 15;
    reasons.push("폭·깊이 적합");
  } else if (fitW > 0.55 || fitD > 0.55) {
    score += 8;
    reasons.push("폭·깊이 부분");
  }

  if (tpl.connection_points && tpl.connection_points.length > 0) {
    score += 10;
    reasons.push("접속점 정의됨");
  } else if (tpl.doors.length > 0) {
    score += 6;
    reasons.push("문 있음");
  }

  if (tpl.placement_constraints?.requires_exterior_contact) {
    score += 5;
    reasons.push("외곽 접촉 조건");
  } else {
    score += 5;
  }

  if (tpl.validation?.placeable === false) {
    score = 0;
    reasons.unshift("배치 불가 템플릿");
  }

  return { score: Math.min(100, Math.round(score)), reasons };
}

/** 템플릿 저장 직전 필드 보강용 간단 검사 */
export function validateUnitTemplate(tpl: UnitTemplate): UnitValidation {
  const errors: UnitValidationIssue[] = [];
  const warnings: UnitValidationIssue[] = [];

  if (!tpl.name?.trim()) {
    errors.push({ code: "NAME", level: "error", message: "유닛 이름이 필요합니다." });
  }
  if (tpl.bbox.w < 1 || tpl.bbox.d < 1) {
    errors.push({ code: "BBOX", level: "error", message: "외곽 크기가 너무 작습니다." });
  }
  if (tpl.rooms.length === 0) {
    errors.push({ code: "ROOMS", level: "error", message: "실(존)이 없습니다." });
  }
  for (const r of tpl.rooms) {
    if (r.polygon.length < 3) {
      errors.push({
        code: "ROOM_POLY",
        level: "error",
        message: `실「${r.name}」폴리곤이 유효하지 않습니다.`,
      });
    }
  }
  for (const d of tpl.doors) {
    if (d.width <= 0 || d.width > Math.max(tpl.bbox.w, tpl.bbox.d)) {
      warnings.push({
        code: "DOOR_W",
        level: "warning",
        message: `문 폭 ${d.width}m 를 확인하세요.`,
      });
    }
  }

  const placeable = errors.length === 0;
  return {
    is_valid: placeable && warnings.length === 0,
    placeable,
    errors,
    warnings,
    validated_at: new Date().toISOString(),
  };
}
