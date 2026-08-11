/** 유닛 내부 평면 3축 점수 (Compliance 40 / Adaptivity 30 / Daylight 30). */

import { pointInPolygon, polygonArea } from "../geom";
import type { DoorType, Pt, Room, UnitInterior, UnitScore } from "../types";

const MIN_AREA: Record<string, number> = {
  bedroom: 10,
  bathroom: 3.5,
  living: 12,
  kitchen: 4,
  hallway: 1.5,
  storage: 1,
  other: 2,
};

function edgeTouchesBoundary(room: Room, unitPoly: Pt[], tol = 0.35): boolean {
  // 방의 변 중점이 유닛 외곽 변 근처에 있으면 외피 접함으로 본다.
  for (let i = 0; i < room.polygon.length; i++) {
    const a = room.polygon[i];
    const b = room.polygon[(i + 1) % room.polygon.length];
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (let j = 0; j < unitPoly.length; j++) {
      const c = unitPoly[j];
      const d = unitPoly[(j + 1) % unitPoly.length];
      if (distPointToSeg(mid, c, d) <= tol) return true;
    }
  }
  return false;
}

function distPointToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = a[0] + t * dx;
  const qy = a[1] + t * dy;
  return Math.hypot(p[0] - qx, p[1] - qy);
}

export function scoreInterior(interior: UnitInterior, unitPoly: Pt[]): UnitScore {
  let compliance = 100;
  let adaptivity = 100;
  let daylight = 100;
  const checks: UnitScore["checks"] = [];

  // ---- Compliance: 실 면적 · 문 폭
  for (const r of interior.rooms) {
    const area = polygonArea(r.polygon);
    const minA = MIN_AREA[r.kind] ?? MIN_AREA.other;
    if (area < minA) {
      const pen = Math.min(20, (1 - area / minA) * 25);
      compliance -= pen;
      checks.push({
        code: "ROOM_AREA",
        level: area < minA * 0.7 ? "fail" : "warn",
        message: `${r.name} 면적 ${area.toFixed(1)}㎡ < 최소 ${minA}㎡`,
      });
    }
  }
  for (const d of interior.doors) {
    if (d.category === "entrance" && d.width < 0.85) {
      compliance -= 15;
      checks.push({
        code: "DOOR_ENTRY",
        level: "fail",
        message: `현관 문 폭 ${d.width.toFixed(2)}m < 0.85m`,
      });
    }
    if (d.category === "bathroom" && d.width < 0.7) {
      compliance -= 10;
      checks.push({
        code: "DOOR_BATH",
        level: "warn",
        message: `욕실 문 폭 ${d.width.toFixed(2)}m < 0.70m`,
      });
    }
  }

  // ---- Adaptivity: 꼭짓점이 유닛 안
  let inside = 0;
  let total = 0;
  for (const r of interior.rooms) {
    for (const p of r.polygon) {
      total += 1;
      if (pointInPolygon(p, unitPoly)) inside += 1;
    }
  }
  const ratio = total === 0 ? 1 : inside / total;
  if (ratio < 0.98) {
    const pen = (1 - ratio) * 80;
    adaptivity -= pen;
    checks.push({
      code: "FIT",
      level: ratio < 0.85 ? "fail" : "warn",
      message: `실 꼭짓점 ${((1 - ratio) * 100).toFixed(0)}% 가 유닛 밖 (템플릿 변형)`,
    });
  }

  // ---- Daylight: living/bedroom 외피 접함
  const needDay = interior.rooms.filter((r) => r.kind === "living" || r.kind === "bedroom");
  if (needDay.length > 0) {
    const lit = needDay.filter((r) => edgeTouchesBoundary(r, unitPoly));
    const dayRatio = lit.length / needDay.length;
    if (dayRatio < 1) {
      daylight -= (1 - dayRatio) * 50;
      checks.push({
        code: "DAYLIGHT",
        level: dayRatio < 0.5 ? "fail" : "warn",
        message: `일조 필요 실 ${needDay.length}개 중 ${lit.length}개만 외피 접촉`,
      });
    }
  }

  compliance = Math.max(0, Math.min(100, compliance));
  adaptivity = Math.max(0, Math.min(100, adaptivity));
  daylight = Math.max(0, Math.min(100, daylight));
  const totalScore = compliance * 0.4 + adaptivity * 0.3 + daylight * 0.3;

  if (checks.length === 0) {
    checks.push({ code: "OK", level: "pass", message: "내부 평면 기본 검토 통과" });
  }

  return {
    total: Math.round(totalScore * 10) / 10,
    compliance: Math.round(compliance * 10) / 10,
    adaptivity: Math.round(adaptivity * 10) / 10,
    daylight: Math.round(daylight * 10) / 10,
    checks,
  };
}

/** 링크 그룹 문 일괄 수정 후 재채점. */
export function batchUpdateDoors(
  interiors: Record<string, UnitInterior>,
  linkedGroupId: string,
  category: "all" | "entrance" | "bathroom" | "bedroom" | "other",
  patch: { width?: number; type?: DoorType },
  unitPolygons: Record<string, Pt[]>,
): { next: Record<string, UnitInterior>; logs: string[]; updatedIds: string[] } {
  const next: Record<string, UnitInterior> = { ...interiors };
  const logs: string[] = [];
  const updatedIds: string[] = [];

  for (const [uid, it] of Object.entries(interiors)) {
    if (it.linkedGroupId !== linkedGroupId && it.templateId !== linkedGroupId) continue;
    let mod = false;
    const doors = it.doors.map((d) => {
      if (category !== "all" && d.category !== category) return d;
      mod = true;
      return {
        ...d,
        width: patch.width ?? d.width,
        type: patch.type ?? d.type,
      };
    });
    if (!mod) continue;
    const poly = unitPolygons[uid] ?? [];
    const updated: UnitInterior = { ...it, doors };
    updated.score = scoreInterior(updated, poly);
    next[uid] = updated;
    updatedIds.push(uid);
    logs.push(
      `${uid}: ${category} 문 → ${patch.type ?? "type유지"} ${
        patch.width != null ? `${patch.width}m` : ""
      }`.trim(),
    );
  }
  return { next, logs, updatedIds };
}
