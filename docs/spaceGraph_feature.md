# 공간 센터 + 문 연결 그래프

유닛 에디터(`PlanDocCanvas`) 전용. 백엔드 없음.

## 파일

| 파일 | 설명 |
|------|------|
| `frontend/src/lib/plan/spaceGraph.ts` | 구현 (벽 페이스 추출 · 문 인접 · 그래프) |
| `frontend/src/utils/interior/spaceGraph.ts` | ZIP 경로 호환 re-export |
| `frontend/src/components/PlanDocCanvas.tsx` | 센터 · 문경유 연결선 · 문 개폐 렌더 |

## 동작

- 각 공간 → 무게중심 파란 포인트 + 이름 / 면적(m²)
- 벽으로 닫힌 방 자동 추출 (T접합 분할 포함)
- 문이 두 공간을 연결 → 센터 → **문** → 센터 폴리라인
- 선택 도구에서 문 클릭 → `Opening.state` `open` ↔ `closed` (스윙 심볼)

## 좌표

앱 내부 단위는 **미터(m)**. 면적 스케일 변환 없음.
