/** .json 파일로 내보내기 / 불러오기 — "다른 이름으로 저장"의 실체.
 *
 * 파일 하나에 도면 전체(외곽선·복도·코어·Unit Mix·밑그림)가 들어가므로
 * USB 로 옮기거나 남에게 보내면 그대로 열린다.
 */

import { normalizeDoc, safeFileName, type ProjectDoc } from "./project";

export const FILE_EXT = ".floorplan.json";

/** 문서를 파일로 내려받는다. */
export function downloadDoc(doc: ProjectDoc): string {
  const fileName = `${safeFileName(doc.name)}${FILE_EXT}`;
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 즉시 해제하면 브라우저가 다운로드를 시작하기 전에 사라질 수 있다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return fileName;
}

/** 파일에서 문서를 읽는다. 내용이 깨져 있어도 normalizeDoc 이 안전하게 만든다. */
export async function readDocFile(file: File): Promise<ProjectDoc> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("JSON 파일이 아니거나 내용이 손상되었습니다.");
  }
  // 파일명에서 확장자를 떼어 기본 이름으로 쓴다.
  const fallbackName = file.name.replace(/\.floorplan\.json$|\.json$/i, "") || "불러온 프로젝트";
  return normalizeDoc(raw, fallbackName);
}
