# Rayon 2D Plan Engine 이식 · 3D 연동 가이드

## 출처

`localhost:3001` **Rayon Builder** (`Downloads/Rayon Builder`) 의 plan 코어를  
`frontend/src/lib/plan/` 으로 이식했습니다.

| 파일 | 역할 |
|------|------|
| `types.ts` | `PlanDocument`, Wall, Opening, Zone, Story |
| `geometry.ts` | 월드↔스크린, 스냅, 폴리곤 |
| `openings.ts` | 문/창 심볼·프리셋 |
| `wall-join.ts` | 벽 마이터 폴리곤 (2D=3D 동일 조인) |
| `extrude3d.ts` | 엔진 비의존 압출 스펙 `ExtrudeSolid` |
| `bridge.ts` | Unit/UnitInterior ↔ PlanDocument |

## 데이터 흐름

```
[1단계] FastAPI 구획 → Plan.units
[2단계] 유닛 선택
    → ensurePlanDocForUnit / unitToPlanDocument
    → PlanDocCanvas (SVG Rayon 2D) 편집
    → planDocumentToUnitInterior → 점수·Archie
    → planDocumentToExtrudeSolids → 3D 준비
```

`PlanDocument` 가 유닛별 내부 기하의 **단일 소스**입니다.

## 3D 연동 방법

```ts
import { planDocumentToExtrudeSolids } from "@/lib/plan";

const solids = planDocumentToExtrudeSolids(planDoc);
// solids[i].footprint: {x,y}[]  (m, 월드 XY)
// solids[i].elevation, height
// Three.js: Shape + ExtrudeGeometry 또는 외부 DCC/엔진에 전달
```

디버그: 브라우저 콘솔에서 `window.__FP_DEBUG_3D = true` 후 편집 시 solids 개수 로그.

## UI

- 2단계 + 유닛 선택 → 중앙 **Rayon 2D** (`PlanDocCanvas`)
- 툴: 선택 / 벽 / 실(존) / 문 / 팬
- 유닛 미선택 시 기존 건물 개요 Canvas

## 추후

- [ ] 전체 PlanCanvas 고급 드래그/조인 제스처 이식
- [ ] Three.js 뷰포트 연결
- [ ] PlanDocument 서버 저장
