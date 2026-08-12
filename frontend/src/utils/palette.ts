/** 도면/지표 공용 색상 슬롯.
 *
 * 세대 타입은 고정 순서로 슬롯을 배정한다(순환 금지). 슬롯 1~3은 전 조합
 * 검증을 통과했고, 4번째부터는 색만으로 구분이 보장되지 않으므로 도면의 모든
 * 세대에 타입명을 직접 라벨로 찍어 2차 인코딩을 함께 제공한다.
 */

export type Mode = "light" | "dark";

export const SERIES: Record<Mode, string[]> = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

/** 보행거리(연속량) 표현용 단일 색상 램프 — 밝음(가까움) → 어두움(멂). */
export const SEQ_BLUE = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec",
  "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95",
];

export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

export interface Chrome {
  surface: string;
  plane: string;
  ink: string;
  inkSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  border: string;
}

export const CHROME: Record<Mode, Chrome> = {
  light: {
    surface: "#fcfcfb",
    plane: "#f9f9f7",
    ink: "#0b0b0b",
    inkSecondary: "#52514e",
    muted: "#898781",
    grid: "#e1e0d9",
    axis: "#c3c2b7",
    border: "rgba(11,11,11,0.10)",
  },
  dark: {
    surface: "#1a1a19",
    plane: "#0d0d0d",
    ink: "#ffffff",
    inkSecondary: "#c3c2b7",
    muted: "#898781",
    grid: "#2c2c2a",
    axis: "#383835",
    border: "rgba(255,255,255,0.10)",
  },
};

/**
 * 건축 도면용 벽체 저톤 (참고 녹화: ~#989898 중회색 포셰).
 * 고대비 검정/원색 스트로크 대신 차분한 그레이 매스.
 */
export const WALL: Record<
  Mode,
  { fill: string; stroke: string; active: string; exterior: string }
> = {
  light: {
    fill: "#8f8f8b",
    stroke: "#6a6a66",
    active: "#5a7aaa",
    exterior: "#6e6e6a",
  },
  dark: {
    fill: "#7a7a74",
    stroke: "#a0a098",
    active: "#7a9ec8",
    exterior: "#9a9a92",
  },
};

export function seriesColor(mode: Mode, index: number): string {
  const slots = SERIES[mode];
  return slots[Math.min(index, slots.length - 1)];
}

/** 0~1 정규화 값을 순차 램프의 한 단계로 매핑. */
export function rampColor(t: number): string {
  const i = Math.round(Math.max(0, Math.min(1, t)) * (SEQ_BLUE.length - 1));
  return SEQ_BLUE[i];
}

/** #rrggbb + 알파 → rgba() 문자열. 캔버스 채움용. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
