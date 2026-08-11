/** 내장 유닛 평면 라이브러리 (로컬 m 좌표 템플릿). */

import type { UnitTemplate } from "../types";

/** 1BR — 현관 남측, 거실·침실·욕실 */
export const TPL_1BR_A: UnitTemplate = {
  id: "1BR_A",
  name: "1BR Type A",
  unitTypeHint: "1BR",
  version: 1,
  bbox: { w: 7.2, d: 6.0 },
  entry: { side: "south", offset: 0.9, width: 0.9 },
  rooms: [
    {
      id: "hall",
      name: "현관",
      kind: "hallway",
      polygon: [
        [0.0, 0.0],
        [2.0, 0.0],
        [2.0, 1.4],
        [0.0, 1.4],
      ],
    },
    {
      id: "living",
      name: "거실",
      kind: "living",
      polygon: [
        [0.0, 1.4],
        [4.4, 1.4],
        [4.4, 6.0],
        [0.0, 6.0],
      ],
    },
    {
      id: "bed1",
      name: "침실",
      kind: "bedroom",
      polygon: [
        [4.4, 2.6],
        [7.2, 2.6],
        [7.2, 6.0],
        [4.4, 6.0],
      ],
    },
    {
      id: "bath",
      name: "욕실",
      kind: "bathroom",
      polygon: [
        [4.4, 0.0],
        [7.2, 0.0],
        [7.2, 2.6],
        [4.4, 2.6],
      ],
    },
    {
      id: "kit",
      name: "주방",
      kind: "kitchen",
      polygon: [
        [2.0, 0.0],
        [4.4, 0.0],
        [4.4, 1.4],
        [2.0, 1.4],
      ],
    },
  ],
  doors: [
    { id: "d_entry", category: "entrance", type: "swing_left", width: 0.9, at: [1.0, 0.0] },
    { id: "d_bath", category: "bathroom", type: "swing_right", width: 0.75, at: [4.4, 1.3] },
    { id: "d_bed", category: "bedroom", type: "swing_left", width: 0.8, at: [4.4, 4.0] },
  ],
};

/** 2BR */
export const TPL_2BR_A: UnitTemplate = {
  id: "2BR_A",
  name: "2BR Type A",
  unitTypeHint: "2BR",
  version: 1,
  bbox: { w: 9.0, d: 7.2 },
  entry: { side: "south", offset: 1.2, width: 0.9 },
  rooms: [
    {
      id: "hall",
      name: "현관",
      kind: "hallway",
      polygon: [
        [0, 0],
        [2.4, 0],
        [2.4, 1.5],
        [0, 1.5],
      ],
    },
    {
      id: "living",
      name: "거실",
      kind: "living",
      polygon: [
        [0, 1.5],
        [5.2, 1.5],
        [5.2, 7.2],
        [0, 7.2],
      ],
    },
    {
      id: "kit",
      name: "주방",
      kind: "kitchen",
      polygon: [
        [2.4, 0],
        [5.2, 0],
        [5.2, 1.5],
        [2.4, 1.5],
      ],
    },
    {
      id: "bed1",
      name: "침실1",
      kind: "bedroom",
      polygon: [
        [5.2, 3.6],
        [9.0, 3.6],
        [9.0, 7.2],
        [5.2, 7.2],
      ],
    },
    {
      id: "bed2",
      name: "침실2",
      kind: "bedroom",
      polygon: [
        [5.2, 0],
        [7.0, 0],
        [7.0, 3.6],
        [5.2, 3.6],
      ],
    },
    {
      id: "bath",
      name: "욕실",
      kind: "bathroom",
      polygon: [
        [7.0, 0],
        [9.0, 0],
        [9.0, 3.6],
        [7.0, 3.6],
      ],
    },
  ],
  doors: [
    { id: "d_entry", category: "entrance", type: "swing_left", width: 0.9, at: [1.2, 0] },
    { id: "d_bath", category: "bathroom", type: "swing_right", width: 0.75, at: [7.0, 1.8] },
    { id: "d_bed1", category: "bedroom", type: "swing_left", width: 0.8, at: [5.2, 5.0] },
    { id: "d_bed2", category: "bedroom", type: "swing_left", width: 0.8, at: [5.2, 1.8] },
  ],
};

/** 3BR */
export const TPL_3BR_A: UnitTemplate = {
  id: "3BR_A",
  name: "3BR Type A",
  unitTypeHint: "3BR",
  version: 1,
  bbox: { w: 11.0, d: 8.0 },
  entry: { side: "south", offset: 1.4, width: 0.95 },
  rooms: [
    {
      id: "hall",
      name: "현관",
      kind: "hallway",
      polygon: [
        [0, 0],
        [2.6, 0],
        [2.6, 1.6],
        [0, 1.6],
      ],
    },
    {
      id: "living",
      name: "거실",
      kind: "living",
      polygon: [
        [0, 1.6],
        [6.0, 1.6],
        [6.0, 8.0],
        [0, 8.0],
      ],
    },
    {
      id: "kit",
      name: "주방",
      kind: "kitchen",
      polygon: [
        [2.6, 0],
        [6.0, 0],
        [6.0, 1.6],
        [2.6, 1.6],
      ],
    },
    {
      id: "bed1",
      name: "침실1",
      kind: "bedroom",
      polygon: [
        [6.0, 4.2],
        [11.0, 4.2],
        [11.0, 8.0],
        [6.0, 8.0],
      ],
    },
    {
      id: "bed2",
      name: "침실2",
      kind: "bedroom",
      polygon: [
        [6.0, 0],
        [8.4, 0],
        [8.4, 4.2],
        [6.0, 4.2],
      ],
    },
    {
      id: "bed3",
      name: "침실3",
      kind: "bedroom",
      polygon: [
        [8.4, 2.0],
        [11.0, 2.0],
        [11.0, 4.2],
        [8.4, 4.2],
      ],
    },
    {
      id: "bath",
      name: "욕실",
      kind: "bathroom",
      polygon: [
        [8.4, 0],
        [11.0, 0],
        [11.0, 2.0],
        [8.4, 2.0],
      ],
    },
  ],
  doors: [
    { id: "d_entry", category: "entrance", type: "swing_left", width: 0.95, at: [1.4, 0] },
    { id: "d_bath", category: "bathroom", type: "swing_right", width: 0.75, at: [8.4, 1.0] },
    { id: "d_bed1", category: "bedroom", type: "swing_left", width: 0.8, at: [6.0, 5.5] },
    { id: "d_bed2", category: "bedroom", type: "swing_left", width: 0.8, at: [6.0, 2.0] },
    { id: "d_bed3", category: "bedroom", type: "swing_left", width: 0.8, at: [8.4, 3.0] },
  ],
};

export const BUILTIN_TEMPLATES: UnitTemplate[] = [TPL_1BR_A, TPL_2BR_A, TPL_3BR_A];

export function listTemplates(): UnitTemplate[] {
  return BUILTIN_TEMPLATES;
}

export function getTemplate(id: string): UnitTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

/** 유닛 타입 이름에 가장 가까운 템플릿. */
export function pickTemplateForType(typeName: string): UnitTemplate {
  const n = typeName.toUpperCase();
  const hit = BUILTIN_TEMPLATES.find(
    (t) => t.unitTypeHint && n.includes(t.unitTypeHint.toUpperCase()),
  );
  return hit ?? TPL_1BR_A;
}
