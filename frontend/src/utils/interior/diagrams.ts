/** 존 · 피난 · Population 다이어그램 유틸. */

import { polygonArea } from "../geom";
import type {
  EgressPath,
  PopulationPoint,
  Pt,
  Room,
  Unit,
  UnitInterior,
  Zone,
} from "../types";

export function countEdges(poly: Pt[]): number {
  return poly.length >= 3 ? poly.length : 0;
}

export function computeEgressPath(unitPoly: Pt[], doorPoint: Pt | null): EgressPath | undefined {
  if (!doorPoint || unitPoly.length < 3) return undefined;
  let maxD = -1;
  let far: Pt = unitPoly[0];
  for (const p of unitPoly) {
    const d = Math.hypot(p[0] - doorPoint[0], p[1] - doorPoint[1]);
    if (d > maxD) {
      maxD = d;
      far = p;
    }
  }
  return {
    startPoint: far,
    exitPoint: doorPoint,
    distanceMeters: Math.round(maxD * 100) / 100,
  };
}

const ROOM_COLORS: Record<string, string> = {
  living: "rgba(66, 133, 244, 0.22)",
  bedroom: "rgba(156, 102, 215, 0.22)",
  kitchen: "rgba(244, 180, 0, 0.22)",
  bathroom: "rgba(15, 157, 88, 0.20)",
  hallway: "rgba(150, 150, 150, 0.18)",
  storage: "rgba(120, 100, 80, 0.18)",
  other: "rgba(100, 100, 100, 0.15)",
};

export function buildApartmentZones(unit: Unit, rooms: Room[]): Zone[] {
  const zones: Zone[] = [
    {
      id: `apt-${unit.id}`,
      label: unit.id,
      category: "apartment",
      polygon: unit.polygon,
      color: "rgba(42, 120, 214, 0.08)",
    },
  ];
  for (const r of rooms) {
    zones.push({
      id: `room-${r.id}`,
      label: r.name,
      category: "room",
      polygon: r.polygon,
      color: ROOM_COLORS[r.kind] ?? ROOM_COLORS.other,
    });
  }
  return zones;
}

export function buildGfaZone(boundary: Pt[]): Zone {
  return {
    id: "gfa",
    label: "GFA",
    category: "gfa",
    polygon: boundary,
    color: "rgba(0, 0, 0, 0.04)",
  };
}

export function populationFromUnits(units: Unit[]): PopulationPoint[] {
  return units.map((u) => ({
    id: u.id,
    areaM2: Math.round(u.area * 10) / 10,
    edges: countEdges(u.polygon),
    type: u.type,
  }));
}

export function populationFromInteriors(
  units: Unit[],
  interiors: Record<string, UnitInterior>,
): PopulationPoint[] {
  return units.map((u) => {
    const it = interiors[u.id];
    return {
      id: u.id,
      areaM2: it?.areaM2 ?? Math.round(polygonArea(u.polygon) * 10) / 10,
      edges: it?.edges ?? countEdges(u.polygon),
      type: u.type,
    };
  });
}

/** 문 일괄 변경 프리셋 (인치 → m). */
export const DOOR_PRESETS = {
  entry36: 0.914,
  entry34: 0.864,
  bath30: 0.762,
  bath28: 0.711,
} as const;
