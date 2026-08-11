/**
 * floorplan-ai (Unit / UnitInterior) ↔ Rayon PlanDocument 브리지.
 * PlanDocument 가 2D 편집·향후 3D 압출의 단일 소스.
 */

import { polygonArea } from "@/utils/geom";
import type {
  Door as AppDoor,
  DoorCategory,
  DoorType,
  Pt,
  Room,
  RoomKind,
  Unit,
  UnitInterior,
} from "@/utils/types";
import { buildApartmentZones, computeEgressPath, countEdges } from "@/utils/interior/diagrams";
import { scoreInterior } from "@/utils/interior/scoreInterior";
import { computeWallPolygons } from "./wall-join";
import { extrudePolygonSpec, type ExtrudeSolid } from "./extrude3d";
import type {
  Opening,
  OpeningKind,
  PlanDocument,
  Point,
  Story,
  Wall,
  Zone,
} from "./types";
import { DEFAULT_STORY_HEIGHT, defaultStories, emptyDocument } from "./types";

export const ptToPoint = (p: Pt): Point => ({ x: p[0], y: p[1] });
export const pointToPt = (p: Point): Pt => [p.x, p.y];

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 닫힌 폴리곤 → 벽 루프 (각 변 = Wall) */
export function polygonToWalls(
  poly: Pt[],
  thickness: number,
  storyId: string,
  idPrefix = "w",
): Wall[] {
  if (poly.length < 2) return [];
  const walls: Wall[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
    walls.push({
      id: `${idPrefix}-${i}`,
      a: ptToPoint(a),
      b: ptToPoint(b),
      thickness,
      align: "center",
      storyId,
    });
  }
  return walls;
}

function doorCategoryToKind(cat: DoorCategory, type?: DoorType): OpeningKind {
  if (type === "sliding") return "door-sliding";
  if (cat === "entrance") return "door-single";
  return "door-single";
}

function openingKindToCategory(kind: OpeningKind): DoorCategory {
  if (kind.startsWith("window")) return "other";
  return "entrance"; // refined by zone later if needed
}

function openingKindToDoorType(kind: OpeningKind): DoorType {
  if (kind === "door-sliding" || kind === "window-sliding") return "sliding";
  if (kind === "door-double") return "swing_left";
  return "swing_left";
}

function roomKindFromName(name: string): RoomKind {
  const n = name.toLowerCase();
  if (/거실|living/.test(n)) return "living";
  if (/식당|dining/.test(n)) return "dining";
  if (/침실|bed/.test(n)) return "bedroom";
  if (/주방|kitchen/.test(n)) return "kitchen";
  if (/욕실|bath|toilet/.test(n)) return "bathroom";
  if (/현관|복도|hall|corridor/.test(n)) return "hallway";
  if (/수납|storage/.test(n)) return "storage";
  return "other";
}

/**
 * 유닛 + (선택) 기존 내부 → PlanDocument.
 * 유닛 외곽 = 벽 루프, 실 = zone, 문 = opening (외곽 벽에 투영).
 */
export function unitToPlanDocument(
  unit: Unit,
  interior: UnitInterior | null | undefined,
  opts?: { wallThickness?: number; storyHeight?: number },
): PlanDocument {
  const thickness = opts?.wallThickness ?? 0.2;
  const height = opts?.storyHeight ?? DEFAULT_STORY_HEIGHT;
  const stories: Story[] = [
    { id: "story-1", name: "1층", elevation: 0, height },
  ];
  const storyId = stories[0].id;
  const walls = polygonToWalls(unit.polygon, thickness, storyId, `u-${unit.id}-w`);

  const zones: Zone[] = (interior?.rooms ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    points: r.polygon.map(ptToPoint),
    kind: "room" as const,
    storyId,
  }));

  const openings: Opening[] = [];
  for (const d of interior?.doors ?? []) {
    const host = nearestWall(d.position, walls);
    if (!host) continue;
    openings.push({
      id: d.id,
      kind: doorCategoryToKind(d.category, d.type),
      wallId: host.wall.id,
      offset: host.offset,
      width: d.width,
      height: 2.1,
      frame: 0.08,
      flip: d.type === "swing_right",
      state: "open",
    });
  }

  // 유닛 현관 후보
  if (openings.length === 0 && unit.door_point) {
    const host = nearestWall(unit.door_point, walls);
    if (host) {
      openings.push({
        id: `op-entry-${unit.id}`,
        kind: "door-single",
        wallId: host.wall.id,
        offset: host.offset,
        width: unit.door_width || 0.9,
        height: 2.1,
        frame: 0.08,
        flip: false,
        state: "open",
      });
    }
  }

  return {
    name: unit.id,
    walls,
    openings,
    zones,
    dividers: [],
    lines: [],
    dimensions: [],
    stories,
    siteBoundary: unit.polygon.map(ptToPoint),
  };
}

function nearestWall(
  p: Pt,
  walls: Wall[],
): { wall: Wall; offset: number } | null {
  let best: { wall: Wall; offset: number; d: number } | null = null;
  for (const w of walls) {
    const dx = w.b.x - w.a.x;
    const dy = w.b.y - w.a.y;
    const L = Math.hypot(dx, dy) || 1e-9;
    let t = ((p[0] - w.a.x) * dx + (p[1] - w.a.y) * dy) / (L * L);
    t = Math.max(0, Math.min(1, t));
    const qx = w.a.x + t * dx;
    const qy = w.a.y + t * dy;
    const d = Math.hypot(p[0] - qx, p[1] - qy);
    if (!best || d < best.d) {
      best = { wall: w, offset: t * L, d };
    }
  }
  return best ? { wall: best.wall, offset: best.offset } : null;
}

/** PlanDocument → UnitInterior (점수·기존 UI 연동) */
export function planDocumentToUnitInterior(unit: Unit, doc: PlanDocument): UnitInterior {
  const rooms: Room[] = doc.zones
    .filter((z) => z.kind !== "corridor")
    .map((z) => ({
      id: z.id,
      name: z.name || "실",
      kind: roomKindFromName(z.name || ""),
      polygon: z.points.map(pointToPt),
    }));

  const doors: AppDoor[] = [];
  for (const o of doc.openings) {
    if (o.kind.startsWith("window")) continue;
    const w = doc.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
    const dir = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const cx = w.a.x + dir.x * o.offset;
    const cy = w.a.y + dir.y * o.offset;
    doors.push({
      id: o.id,
      unitId: unit.id,
      category: openingKindToCategory(o.kind),
      position: [cx, cy],
      width: o.width,
      type: openingKindToDoorType(o.kind),
      angle: Math.atan2(dir.y, dir.x),
    });
  }

  const interior: UnitInterior = {
    unitId: unit.id,
    templateId: `plan-doc-${unit.id}`,
    linkedGroupId: unit.type,
    rooms,
    doors,
    furniture: [],
    areaM2: polygonArea(unit.polygon),
    edges: countEdges(unit.polygon),
    egressPath: computeEgressPath(unit.polygon, unit.door_point),
    zones: buildApartmentZones(unit, rooms),
    handAuthored: true,
  };
  interior.score = scoreInterior(interior, unit.polygon);
  return interior;
}

/** 3D 연동용 솔리드 목록 (벽 폴리곤 압출) */
export function planDocumentToExtrudeSolids(
  doc: PlanDocument,
  storyId?: string,
): ExtrudeSolid[] {
  const story =
    doc.stories?.find((s) => s.id === storyId) ?? doc.stories?.[0] ?? defaultStories()[0];
  const walls = doc.walls.filter((w) => !w.storyId || w.storyId === story.id);
  const { polys } = computeWallPolygons(walls);
  const solids: ExtrudeSolid[] = [];
  let i = 0;
  for (const wp of polys) {
    const solid = extrudePolygonSpec(
      wp.polygon,
      story.elevation,
      story.elevation + story.height,
      `wall-${wp.wall.id}`,
      "wall",
    );
    if (solid) {
      solid.meta = { wallId: wp.wall.id, index: i++ };
      solids.push(solid);
    }
  }
  for (const z of doc.zones) {
    if (z.points.length < 3) continue;
    const solid = extrudePolygonSpec(
      z.points,
      story.elevation,
      story.elevation + 0.01,
      `zone-${z.id}`,
      "zone",
    );
    if (solid) {
      solid.meta = { name: z.name, kind: z.kind };
      solids.push(solid);
    }
  }
  return solids;
}

export function ensurePlanDocForUnit(
  unit: Unit,
  existing: PlanDocument | undefined,
  interior: UnitInterior | null | undefined,
  wallThickness: number,
): PlanDocument {
  if (existing && existing.walls.length > 0) return existing;
  return unitToPlanDocument(unit, interior, { wallThickness });
}

export { emptyDocument };
