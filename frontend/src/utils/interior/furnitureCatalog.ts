/** 영상 Public Objects 스타일 가구 카탈로그 (m). */

export interface FurnCatalogItem {
  id: string;
  name: string;
  width: number;
  depth: number;
}

export const FURNITURE_CATALOG: FurnCatalogItem[] = [
  { id: "bed_1800", name: "침대 1800×1800", width: 1.8, depth: 1.8 },
  { id: "bed_1200", name: "침대 1200×2000", width: 1.2, depth: 2.0 },
  { id: "sofa_2000", name: "소파 2000×900", width: 2.0, depth: 0.9 },
  { id: "table_1200", name: "테이블 1200×600", width: 1.2, depth: 0.6 },
  { id: "table_1400", name: "식탁 1400×700", width: 1.4, depth: 0.7 },
  { id: "table_1600", name: "식탁 1600×800", width: 1.6, depth: 0.8 },
  { id: "desk_1200", name: "책상 1200×600", width: 1.2, depth: 0.6 },
  { id: "wardrobe_600", name: "옷장 600×600", width: 0.6, depth: 0.6 },
  { id: "bath_tub", name: "욕조 1500×700", width: 1.5, depth: 0.7 },
  { id: "toilet", name: "변기 400×700", width: 0.4, depth: 0.7 },
];

export function getFurnCatalog(id: string): FurnCatalogItem | undefined {
  return FURNITURE_CATALOG.find((c) => c.id === id);
}
