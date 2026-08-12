/** 템플릿을 유닛 폴리곤에 맞춰 월드 좌표 UnitInterior 생성. */

import { pointInPolygon, polygonArea } from "../geom";
import type { Door, Pt, Room, Unit, UnitInterior, UnitTemplate } from "../types";
import { scoreInterior } from "./scoreInterior";
import { buildApartmentZones, computeEgressPath, countEdges } from "./diagrams";

function bboxOf(poly: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function mapPt(
  p: Pt,
  tpl: UnitTemplate,
  dest: { minX: number; minY: number; w: number; d: number },
  flipX: boolean,
): Pt {
  let u = p[0] / tpl.bbox.w;
  const v = p[1] / tpl.bbox.d;
  if (flipX) u = 1 - u;
  return [dest.minX + u * dest.w, dest.minY + v * dest.d];
}

/** door_point 가 유닛 bbox 어느 쪽에 가까운지 → 템플릿 south 현관을 그쪽으로 맞춤. */
function orientFlip(unit: Unit): { rotate90: boolean; flipX: boolean; flipY: boolean } {
  const b = bboxOf(unit.polygon);
  const door = unit.door_point ?? unit.label_at;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const dx = door[0] - cx;
  const dy = door[1] - cy;
  // 템플릿 entry 는 south(y=0). 도어가 아래( minY 쪽)면 그대로, 위면 flipY
  // 좌우로 치우치면 flipX
  const toSouth = Math.abs(dy) >= Math.abs(dx) && dy < 0;
  const toNorth = Math.abs(dy) >= Math.abs(dx) && dy >= 0;
  const toWest = Math.abs(dx) > Math.abs(dy) && dx < 0;
  // rotate90 은 간단 구현에서 생략(AABB 스케일만). flip 으로 현관 방향 근사.
  return {
    rotate90: false,
    flipX: toWest,
    flipY: toNorth && !toSouth,
  };
}

function mapWithOrients(
  p: Pt,
  tpl: UnitTemplate,
  dest: { minX: number; minY: number; w: number; d: number },
  flipX: boolean,
  flipY: boolean,
): Pt {
  let u = p[0] / tpl.bbox.w;
  let v = p[1] / tpl.bbox.d;
  if (flipX) u = 1 - u;
  if (flipY) v = 1 - v;
  return [dest.minX + u * dest.w, dest.minY + v * dest.d];
}

/**
 * 템플릿을 유닛 AABB 에 균일 스케일로 끼운다.
 * 약간의 여백(2%)을 두고, 유닛 밖으로 나간 꼭짓점은 클리핑하지 않고 점수에서 감점.
 */
export function fitTemplateToUnit(unit: Unit, tpl: UnitTemplate): UnitInterior {
  const b = bboxOf(unit.polygon);
  const pad = 0.02;
  const rawW = Math.max(b.maxX - b.minX, 0.5);
  const rawD = Math.max(b.maxY - b.minY, 0.5);
  const dest = {
    minX: b.minX + rawW * pad,
    minY: b.minY + rawD * pad,
    w: rawW * (1 - 2 * pad),
    d: rawD * (1 - 2 * pad),
  };
  const { flipX, flipY } = orientFlip(unit);
  const map = (p: Pt) => mapWithOrients(p, tpl, dest, flipX, flipY);

  const rooms: Room[] = tpl.rooms.map((r) => ({
    id: `${unit.id}-${r.id}`,
    name: r.name,
    kind: r.kind,
    polygon: r.polygon.map(map),
  }));

  const doors: Door[] = tpl.doors.map((d) => ({
    id: `${unit.id}-${d.id}`,
    unitId: unit.id,
    category: d.category,
    type: d.type,
    width: d.width,
    position: map(d.at),
  }));

  // 현관이 있으면 door_point 근처로 현관 문을 살짝 당긴다
  if (unit.door_point) {
    const entry = doors.find((d) => d.category === "entrance");
    if (entry) entry.position = [...unit.door_point] as Pt;
  }

  const interior: UnitInterior = {
    unitId: unit.id,
    templateId: tpl.id,
    source_unit_id: tpl.id,
    linkedGroupId: tpl.id,
    rooms,
    doors,
    areaM2: polygonArea(unit.polygon),
    edges: countEdges(unit.polygon),
    egressPath: computeEgressPath(unit.polygon, unit.door_point),
    zones: buildApartmentZones(unit, rooms),
    connection_points: doors.map((d) => ({
      connection_id: d.id,
      type: "door" as const,
      at: d.position,
      category: d.category,
    })),
    /** 프로젝트 인스턴스 — 라이브러리 원본과 분리 */
    project_instance: {
      instance_id: `inst-${unit.id}-${Date.now().toString(36)}`,
      source_unit_id: tpl.id,
      library_version: tpl.library_version ?? tpl.version ?? 1,
      rotation_deg: flipY || flipX ? 0 : 0,
      mirrored: flipX,
      scale: dest.w / Math.max(tpl.bbox.w, 1e-6),
      placed_at: new Date().toISOString(),
    },
    handAuthored: false,
  };
  interior.score = scoreInterior(interior, unit.polygon);
  return interior;
}

export function applyTemplateToUnits(
  units: Unit[],
  tpl: UnitTemplate,
  onlyUnitIds?: string[] | null,
): Record<string, UnitInterior> {
  const out: Record<string, UnitInterior> = {};
  for (const u of units) {
    if (onlyUnitIds && onlyUnitIds.length > 0 && !onlyUnitIds.includes(u.id)) continue;
    out[u.id] = fitTemplateToUnit(u, tpl);
  }
  return out;
}

/** 타입별 자동 템플릿 일괄 적용. */
export function autoFitAll(
  units: Unit[],
  pick: (type: string) => UnitTemplate,
): Record<string, UnitInterior> {
  const out: Record<string, UnitInterior> = {};
  for (const u of units) {
    out[u.id] = fitTemplateToUnit(u, pick(u.type));
  }
  return out;
}

export function roomsMostlyInside(rooms: Room[], unitPoly: Pt[]): number {
  if (rooms.length === 0) return 0;
  let ok = 0;
  let n = 0;
  for (const r of rooms) {
    for (const p of r.polygon) {
      n += 1;
      if (pointInPolygon(p, unitPoly)) ok += 1;
    }
  }
  return n === 0 ? 0 : ok / n;
}
