/** 코어 발자국(사각형) 계산 — 백엔드 core_polygon 과 같은 규약.
 *
 * length: 복도 축 방향 길이
 * reach: 복도 양옆(법선) 깊이 (각각)
 */

import { projectOntoPolylines } from "./geom";
import type { Pt } from "./types";

export interface CoreFrame {
  center: Pt;
  /** 진행 방향 단위벡터 */
  u: Pt;
  /** 좌측 법선 단위벡터 */
  n: Pt;
}

/** 여러 복도 중심선 중 p 에 가장 가까운 구간의 프레임. */
export function nearestFrameOnRails(rails: Pt[][], p: Pt): CoreFrame | null {
  let bestD = Infinity;
  let best: CoreFrame | null = null;

  for (const line of rails) {
    if (line.length < 2) continue;
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) continue;
      let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = a[0] + dx * t;
      const cy = a[1] + dy * t;
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      if (d < bestD) {
        bestD = d;
        const len = Math.sqrt(len2);
        const u: Pt = [dx / len, dy / len];
        const n: Pt = [-u[1], u[0]];
        best = { center: [cx, cy], u, n };
      }
    }
  }
  return best;
}

/**
 * 앵커 기준 코어 사각형 꼭짓점 (CCW).
 * 복도가 없으면 축정렬 사각형.
 */
export function coreRectangle(
  anchor: Pt,
  length: number,
  reach: number,
  rails: Pt[][],
): Pt[] {
  const frame =
    rails.length > 0 ? nearestFrameOnRails(rails, anchor) : null;
  const center = rails.length > 0 ? projectOntoPolylines(rails, anchor) : anchor;
  const u: Pt = frame?.u ?? [1, 0];
  const n: Pt = frame?.n ?? [0, 1];
  const hl = length / 2;
  const r = reach;
  return [
    [center[0] - u[0] * hl - n[0] * r, center[1] - u[1] * hl - n[1] * r],
    [center[0] + u[0] * hl - n[0] * r, center[1] + u[1] * hl - n[1] * r],
    [center[0] + u[0] * hl + n[0] * r, center[1] + u[1] * hl + n[1] * r],
    [center[0] - u[0] * hl + n[0] * r, center[1] - u[1] * hl + n[1] * r],
  ];
}

/** 표시용 폴리곤: 외곽선이 있으면 그것, 없으면 사각형. */
export function coreFootprint(
  anchor: Pt,
  length: number,
  reach: number,
  rails: Pt[][],
  outline: Pt[] | null | undefined,
): Pt[] {
  if (outline && outline.length >= 3) return outline;
  return coreRectangle(anchor, length, reach, rails);
}
