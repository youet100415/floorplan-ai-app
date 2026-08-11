/** 내부 평면 수동 작도 · 점수 갱신 · 라이브러리 저장용 변환. */

import { pointInPolygon, polygonArea } from "../geom";
import type {
  Door,
  DoorCategory,
  DoorType,
  FurnItem,
  Pt,
  Room,
  RoomKind,
  Unit,
  UnitInterior,
  UnitTemplate,
} from "../types";
import { buildApartmentZones, computeEgressPath, countEdges } from "./diagrams";
import { getFurnCatalog } from "./furnitureCatalog";
import { scoreInterior } from "./scoreInterior";

const ROOM_LABELS: Record<RoomKind, string> = {
  living: "거실",
  dining: "식당",
  bedroom: "침실",
  kitchen: "주방",
  bathroom: "욕실",
  hallway: "현관/복도",
  storage: "수납",
  other: "기타",
};

export function roomLabel(kind: RoomKind): string {
  return ROOM_LABELS[kind] ?? kind;
}

export function emptyInterior(unit: Unit): UnitInterior {
  const base: UnitInterior = {
    unitId: unit.id,
    templateId: null,
    linkedGroupId: `hand-${unit.id}`,
    rooms: [],
    doors: [],
    furniture: [],
    areaM2: polygonArea(unit.polygon),
    edges: countEdges(unit.polygon),
    egressPath: computeEgressPath(unit.polygon, unit.door_point),
    handAuthored: true,
  };
  base.zones = buildApartmentZones(unit, []);
  base.score = scoreInterior(base, unit.polygon);
  return base;
}

export function refreshInterior(unit: Unit, it: UnitInterior): UnitInterior {
  const next: UnitInterior = {
    ...it,
    unitId: unit.id,
    areaM2: polygonArea(unit.polygon),
    edges: countEdges(unit.polygon),
    egressPath: computeEgressPath(unit.polygon, unit.door_point),
    zones: buildApartmentZones(unit, it.rooms),
  };
  next.score = scoreInterior(next, unit.polygon);
  return next;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function addRoom(
  unit: Unit,
  it: UnitInterior | null,
  polygon: Pt[],
  kind: RoomKind,
): UnitInterior {
  const base = it ?? emptyInterior(unit);
  if (polygon.length < 3) return base;
  const room: Room = {
    id: uid("room"),
    name: roomLabel(kind),
    kind,
    polygon: polygon.map((p) => [p[0], p[1]] as Pt),
  };
  // 같은 kind 가 여러 개면 번호
  const same = base.rooms.filter((r) => r.kind === kind).length;
  if (same > 0) room.name = `${roomLabel(kind)}${same + 1}`;
  return refreshInterior(unit, {
    ...base,
    rooms: [...base.rooms, room],
    handAuthored: true,
    templateId: base.templateId?.startsWith("hand") ? base.templateId : `hand-${unit.type}`,
  });
}

export function removeRoom(unit: Unit, it: UnitInterior, roomId: string): UnitInterior {
  return refreshInterior(unit, {
    ...it,
    rooms: it.rooms.filter((r) => r.id !== roomId),
    handAuthored: true,
  });
}

/** 점에서 유닛 외곽 최근접 변으로 투영 → 문 위치. */
export function projectToBoundary(p: Pt, poly: Pt[]): { at: Pt; angle: number } | null {
  if (poly.length < 2) return null;
  let bestD = Infinity;
  let best: Pt = p;
  let angle = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) continue;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const q: Pt = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bestD) {
      bestD = d;
      best = q;
      angle = Math.atan2(dy, dx);
    }
  }
  return { at: best, angle };
}

export function addDoor(
  unit: Unit,
  it: UnitInterior | null,
  click: Pt,
  category: DoorCategory,
  width: number,
  type: DoorType = "swing_left",
): UnitInterior {
  const base = it ?? emptyInterior(unit);
  const hit = projectToBoundary(click, unit.polygon);
  if (!hit) return base;
  const door: Door = {
    id: uid("door"),
    unitId: unit.id,
    category,
    position: hit.at,
    width,
    type,
    angle: hit.angle,
  };
  return refreshInterior(unit, {
    ...base,
    doors: [...base.doors, door],
    handAuthored: true,
  });
}

export function removeDoor(unit: Unit, it: UnitInterior, doorId: string): UnitInterior {
  return refreshInterior(unit, {
    ...it,
    doors: it.doors.filter((d) => d.id !== doorId),
    handAuthored: true,
  });
}

export function addFurniture(
  unit: Unit,
  it: UnitInterior | null,
  catalogId: string,
  at: Pt,
): UnitInterior {
  const base = it ?? emptyInterior(unit);
  const cat = getFurnCatalog(catalogId);
  if (!cat) return base;
  if (!pointInPolygon(at, unit.polygon)) return base;
  const item: FurnItem = {
    id: uid("furn"),
    name: cat.name,
    catalogId: cat.id,
    at,
    width: cat.width,
    depth: cat.depth,
    rotation: 0,
  };
  return refreshInterior(unit, {
    ...base,
    furniture: [...(base.furniture ?? []), item],
    handAuthored: true,
  });
}

export function removeFurniture(unit: Unit, it: UnitInterior, furnId: string): UnitInterior {
  return refreshInterior(unit, {
    ...it,
    furniture: (it.furniture ?? []).filter((f) => f.id !== furnId),
    handAuthored: true,
  });
}

export function furnitureCorners(f: FurnItem): Pt[] {
  const hw = f.width / 2;
  const hd = f.depth / 2;
  const c = Math.cos(f.rotation);
  const s = Math.sin(f.rotation);
  const local: Pt[] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return local.map(([x, y]) => [f.at[0] + x * c - y * s, f.at[1] + x * s + y * c] as Pt);
}

/** 월드 내부를 로컬 bbox 템플릿으로 변환 (라이브러리 저장). */
export function interiorToTemplate(
  unit: Unit,
  it: UnitInterior,
  name: string,
): UnitTemplate {
  const xs = unit.polygon.map((p) => p[0]);
  const ys = unit.polygon.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 0.5);
  const d = Math.max(maxY - minY, 0.5);
  const toLocal = (p: Pt): Pt => [p[0] - minX, p[1] - minY];

  const entryDoor = it.doors.find((x) => x.category === "entrance") ?? it.doors[0];
  let entrySide: UnitTemplate["entry"]["side"] = "south";
  let offset = 0.5;
  if (entryDoor) {
    const lp = toLocal(entryDoor.position);
    const dist = [
      { side: "south" as const, v: lp[1] },
      { side: "north" as const, v: d - lp[1] },
      { side: "west" as const, v: lp[0] },
      { side: "east" as const, v: w - lp[0] },
    ].sort((a, b) => a.v - b.v)[0];
    entrySide = dist.side;
    offset = entrySide === "south" || entrySide === "north" ? lp[0] : lp[1];
  }

  return {
    id: `user-${Date.now().toString(36)}`,
    name,
    unitTypeHint: unit.type,
    version: 1,
    bbox: { w, d },
    entry: {
      side: entrySide,
      offset,
      width: entryDoor?.width ?? 0.9,
    },
    rooms: it.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      polygon: r.polygon.map(toLocal),
    })),
    doors: it.doors.map((door) => ({
      id: door.id,
      category: door.category,
      type: door.type,
      width: door.width,
      at: toLocal(door.position),
    })),
  };
}

const LIB_KEY = "floorplan-ai-user-templates-v1";

export function loadUserTemplates(): UnitTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LIB_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    return Array.isArray(j) ? (j as UnitTemplate[]) : [];
  } catch {
    return [];
  }
}

export function saveUserTemplate(tpl: UnitTemplate): UnitTemplate[] {
  const list = loadUserTemplates().filter((t) => t.id !== tpl.id);
  list.unshift(tpl);
  const next = list.slice(0, 40);
  window.localStorage.setItem(LIB_KEY, JSON.stringify(next));
  return next;
}

export function deleteUserTemplate(id: string): UnitTemplate[] {
  const next = loadUserTemplates().filter((t) => t.id !== id);
  window.localStorage.setItem(LIB_KEY, JSON.stringify(next));
  return next;
}
