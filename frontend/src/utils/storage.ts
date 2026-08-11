/** 브라우저 자동저장 (localStorage).
 *
 * 목적은 하나 — 실수로 새로고침하거나 탭을 닫아도 작업이 사라지지 않게 하는 것.
 * 정식 보관은 서버 저장이나 .json 파일이 담당한다.
 *
 * localStorage 는 보통 5MB 정도가 한계라, 밑그림 이미지(base64)가 들어가면
 * 한 방에 넘친다. 그래서 넘치면 이미지를 빼고 다시 시도하고, 그것도 안 되면
 * 조용히 포기하되 호출자에게 결과를 알려 준다 — 저장된 줄 알았는데 아닌 상황이
 * 제일 나쁘다.
 */

import { normalizeDoc, type ProjectDoc } from "./project";

const KEY = "floorplan-ai:autosave";

export type AutosaveResult =
  | { ok: true; droppedUnderlay: boolean }
  | { ok: false; reason: string };

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" ||
      e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      e.code === 22)
  );
}

export function saveAutosave(doc: ProjectDoc): AutosaveResult {
  if (typeof window === "undefined") return { ok: false, reason: "브라우저가 아닙니다" };

  try {
    window.localStorage.setItem(KEY, JSON.stringify(doc));
    return { ok: true, droppedUnderlay: false };
  } catch (e) {
    if (!isQuotaError(e)) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  // 용량 초과 — 대개 밑그림 이미지 때문이다. 도면 데이터라도 살린다.
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...doc, underlay: null }));
    return { ok: true, droppedUnderlay: true };
  } catch {
    clearAutosave();
    return {
      ok: false,
      reason: "브라우저 저장 공간이 부족합니다. 서버 저장이나 파일 내보내기를 쓰세요.",
    };
  }
}

export function loadAutosave(): ProjectDoc | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    // 남이 쓴 값이거나 예전 버전일 수 있으므로 반드시 정규화해서 돌려준다.
    return normalizeDoc(JSON.parse(raw));
  } catch {
    // 깨진 값이 남아 계속 실패하지 않도록 치운다.
    clearAutosave();
    return null;
  }
}

export function clearAutosave(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export function hasAutosave(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) !== null;
}
