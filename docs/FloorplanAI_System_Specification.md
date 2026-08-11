# FloorplanAI 시스템 아키텍처 및 기술 이식 종합 명세서

> 설계 메모 통합본(v2: 다이어그램·분석 포함). 레포 경로 `frontend/`, `backend/` 기준.  
> 구현 상태: **1단계(유닛 구획·동선)** 동작 중 · **2단계 이하** 로드맵.

---

## 1. 프로젝트 개요 및 핵심 기술 스택

본 명세서는 **FloorplanAI** 웹 플랫폼에 다음을 통합하기 위한 시스템 개발 문서입니다.

- 파라메트릭 조닝 (Parametric Zoning)
- 공간 위상 스코어링 (Spatial Scoring)
- 내부 평면 라이브러리 · 링크 유닛
- 자연어 AI 에이전트 (Finch 'Archie' 스타일)
- **실시간 분석 다이어그램 (Diagrams & Analytics)**

### 프론트엔드 & 백엔드 아키텍처

| 영역 | 선택 | 비고 |
|------|------|------|
| 프론트엔드 | **Next.js 15** (App Router, `frontend/src/app/`) | |
| UI / 언어 | **React 19** / **TypeScript** | 순수 CSS (`globals.css`) |
| 시각화 | **HTML5 Canvas 2D** (`FloorCanvas.tsx`) | Three.js / Konva / WebGL 없음 |
| 좌표 | 월드(m) ↔ 화면(px) 직접 변환 | DPI·치수 선 두께 화면 고정 |
| 차트 (예정) | **Recharts** | Population & Area Spread 산점도 |
| 백엔드 | **Python FastAPI** (port **8000**) | Shapely 기하, 동선 그래프 |
| AI (예정) | LLM Tool Calling | Linked Units · 피난/존 분석 파이프라인 |

### 단계 구분

```
[1단계 — 현재]
  외곽 → 복도/코어 → 유닛 폴리곤 → 피난 동선·건물 레벨 점수
  (MetricsPanel 표 형태 지표는 일부 존재)

[2단계 — 직입 목표]
  내부 도구로 실/문 작도 → 공간 점수 → 라이브러리 저장 → 템플릿 피팅·링크
  + 존 오버레이 · 유닛 내 피난선 · (선택) 산점도

[3단계 — 이후]
  AI 에이전트 자연어 수정 · Recharts 데이터셋 비교 · GLB export · BIM
```

**데이터 원본 원칙**: 편집·링크·문 폭의 소스는 **JSON**. GLB는 3D 산출물(export).

---

## 2. Finch 3D 워크플로우 분석 및 조닝(Zoning) 알고리즘

### 2.1 4단계 조닝 워크플로우

1. **매스 및 프로그램 할당 (Massing & Program Assign)**  
   외부 매스 입력 및 층별/영역별 용도(주거, 상가, 오피스 등) 지정.  
   *(현재: 단층 외곽선 + Unit Mix — 매스/다층은 향후)*

2. **코어 및 복도 자동 배치 (Core & Corridor Allocation)**  
   피난 거리(예: 단일 출구 9m, 다중 20m)·코어 크기 기반 복도·코어.  
   *(현재: `generator.py` + 수동 작도 — 구현됨)*

3. **유닛 믹스 및 세대 쪼개기 (Unit Mix & Boundary Split)**  
   목표 평형 비율 가중 다각형 분할.  
   *(현재: 슬라이싱 + `unit_count_target` — 구현됨)*

4. **라이브러리 도면 적합 및 유닛 내부 생성**  
   템플릿 피팅, 내부 실 구획, (장기) Native BIM 변환.  
   *(미구현 — 2단계 목표)*

### 2.2 다각형/삼각형 대지 기하 가이드

- **예각 코너**: 세대 불가 구간 → 코어·EPS/TPS·공용 창고 우선.
- **가변 깊이(Tapered Depth)**: 복도–외벽 거리에 따라 Studio/1BR ↔ 2BR/3BR 가변 할당.

---

## 3. 공간 스코어링(Spatial Scoring) 및 규칙 누적

```
                  ┌─────────────────────────────────────────┐
                  │          Total Score (%)                │
                  └──────────────────┬──────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│ Compliance (40%) │        │ Adaptivity (30%) │        │  Daylight (30%)  │
└────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
         │                           │                           │
  · 최소 면적 검수            · 고정 제약 (Bath, Hall)     · 주요 실 Facade 접촉
  · 가구/벽체 충돌           · 가변 제약 (Bed, Living)    · 향/노이즈 채광 감점
  · 문 폭 규격               · 라이브러리 변형 적응력
```

### 3.1 3대 평가 지표

1. **Compliance (40%)** — 최소 면적(침실 ≥ 10㎡, 욕실 ≥ 6㎡ 등), 문 폭, 충돌.
2. **Adaptivity (30%)** — 템플릿 고정/가변 제약 준수.
3. **Daylight (30%)** — 침실·거실 외벽 접함.

> 건물 레벨 검토는 `generator._compliance`에 있음. 위 3축은 **유닛 내부**용.

### 3.2 위상 그래프 & 가중치

- **Node / Edge**: 방 + 인접·문 → Spell Check.
- 가중치 후보: Size, Daylight, Grid Lines, Shape Aware.

### 3.3 내부 도구 작도 + “학습”

```
유닛 선택 → 실/문/가구 작도 → scoreInterior() → 고득점 시 Save to Library
         → templateId 링크 → 다른 유닛에 피팅·일괄 수정
```

- **라이브러리 학습**: 고득점 평면 → `*.unit.json` 축적.
- **점수 학습**: 규칙 피드백 → (장기) 가중치/모델.

---

## 4. AI 에이전트 ('Archie' 스타일) 및 자연어 도면 제어

```
[사용자 입력] ──> [LLM Tool Calling] ──> [Linked Units Engine] ──> [Canvas 2D]
  "욕실 문 변경"   category, width, type     동일 그룹 일괄 수정      하이라이트 & 문 Arc
```

1. LLM Tool Calling — 실 카테고리·문 타입·폭 파싱.
2. **Linked Units** — `linkedGroupId` / `templateId` 동시 업데이트.
3. Canvas 하이라이트 — 파란 오버레이 + 여닫이 Arc.
4. 요약 카드 — 변경 목록·세대·수량.

**전제**: 내부 평면 JSON(2단계) 이후.

---

## 5. 다이어그램 및 데이터 분석 (Diagrams & Analytics)

설계 적합·법규 준수를 **시각적으로 입증**하기 위한 분석 모듈.  
(신규 통합 명세 v2)

### 5.1 3대 시각 분석 다이어그램

1. **Population & Area Spread Diagram (데이터셋 비교 분포)**  
   - 축: 면적(m²) × 외벽 모서리 수(Edges: 4=직사각, 6=L자 등).  
   - **Recharts ScatterChart**.  
   - 현재 유닛 vs 라이브러리/데이터셋 희소성·형태 위치 표시.

2. **Exit Distance Diagram (피난 동선)**  
   - 가장 먼 구석(또는 실 구석) → 출입문 최단 경로(Polyline) + 거리(m).  
   - Canvas 주황 dashed 선 + 수치 라벨.  
   - *(건물 레벨 동선 그래프는 이미 있음; 유닛 내부 피난선은 2단계 확장)*

3. **Zone Mapping Diagram (BIM 존 구획)**  
   - 반투명 3계층 오버레이:  
     - **GFA Zone** — 전체 층/건물 경계  
     - **Apartment Zone** — 세대 경계  
     - **Room Zone** — 개별 방 경계  

4. **Schedules & Metrics (면적·수량 집계)**  
   - GFA / NIA / GIA 산출.  
   - 층·유닛별 가구·문·벽 수량 스케줄.  
   - *(현재 MetricsPanel: 전용률·보행거리·Unit Mix 표 — 확장 대상)*

### 5.2 다이어그램 모드 UI

오버레이 토글 예 (Canvas tools / Sidebar):

| 토글 | 내용 |
|------|------|
| `zones` | GFA / Apartment / Room 색 오버레이 |
| `egress` | 유닛(또는 건물) 피난 폴리라인 |
| `population` | 우측/하단 Scatter (Recharts) |

### 5.3 백엔드 집계 초안 (`analysis` 요지)

```python
from shapely.geometry import Polygon, Point
from typing import Any


def calculate_diagram_metrics(
    polygon: list[tuple[float, float]],
    doors: list[dict[str, Any]],
) -> dict[str, Any]:
    """유닛 폴리곤 기준 면적·모서리 수·출입문까지 최대 직선 거리."""
    poly = Polygon(polygon)
    area_m2 = float(poly.area)
    num_edges = max(len(poly.exterior.coords) - 1, 0)

    entrance = next((d for d in doors if d.get("category") == "entrance"), None)
    if entrance is None and doors:
        entrance = doors[0]
    exit_xy = tuple(entrance["position"]) if entrance else (0.0, 0.0)
    exit_pt = Point(exit_xy)

    max_dist = 0.0
    farthest = (0.0, 0.0)
    for coord in poly.exterior.coords:
        d = Point(coord).distance(exit_pt)
        if d > max_dist:
            max_dist = d
            farthest = (float(coord[0]), float(coord[1]))

    return {
        "areaM2": round(area_m2, 1),
        "edges": num_edges,
        "egressPath": {
            "startPoint": farthest,
            "exitPoint": exit_xy,
            "distanceMeters": round(max_dist, 2),
        },
    }
```

> 실무 피난은 벽 회피 경로(가시 그래프/동선 네트워크)가 필요. 위는 **MVP 직선 거리** 휴리스틱.

### 5.4 Canvas 다이어그램 렌더 요지 (`drawDiagrams`)

- `drawExitDistance`: dashed `#ff6b00`, 중간 거리 라벨.
- `drawZoneOverlays`: zone.color 반투명 fill (GFA → Apt → Room 순서).

### 5.5 MetricsPanel 차트 확장 요지 (Recharts)

```tsx
// Population: edges vs area
<ScatterChart>
  <XAxis type="number" dataKey="area" name="Area" unit="m²" />
  <YAxis type="number" dataKey="edges" name="Edges" domain={[3, 10]} />
  <Scatter name="Dataset" data={scatterData} fill="#8884d8" opacity={0.5} />
  <Scatter name="Current" data={currentScatterData} fill="#ff0000" />
</ScatterChart>
// + Unit Summary: area, edges, egress m, doors count
```

의존성: `frontend`에 `recharts` 추가 (구현 시).

---

## 6. 모듈 구조 (현재 레포 + 예정)

### 6.1 현재 구조

```
floorplan-ai-app/
├── docs/
│   └── FloorplanAI_System_Specification.md
├── frontend/src/
│   ├── app/page.tsx · layout.tsx · globals.css
│   ├── components/
│   │   ├── FloorCanvas.tsx
│   │   ├── Sidebar.tsx
│   │   └── MetricsPanel.tsx          # 표 기반 지표 (차트 확장 예정)
│   └── utils/
│       ├── api.ts · types.ts · geom.ts · path.ts · unitEdit.ts
│       ├── project.ts · projectFile.ts · storage.ts · palette.ts
└── backend/
    ├── main.py · store.py · selftest.py
    └── core/
        ├── geometry.py · circulation.py · generator.py
```

### 6.2 2~3단계 추가 예정

```
frontend/src/
  components/
    AIAgentPanel.tsx              # Archie 대화
    MetricsPanel.tsx              # Recharts scatter + 스케줄 확장
  utils/
    interior/
      scoreInterior.ts
      fitTemplate.ts
      drawInterior.ts
    canvas/                       # 또는 utils 직하
      drawDiagrams.ts             # 피난선 · 존 오버레이
      drawElements.ts             # 문 Arc · 하이라이트
    library.ts
  types 확장
    Door, Room, Zone, EgressPath, UnitInterior, UnitScore, AIAgentResponse

backend/
  core/ 또는 engine/
    interior_score.py
    linked_units.py
    analysis.py                   # 면적·edges·egressPath·스케줄
  ai_agent/
    agent.py
data/
  library/units/                  # *.unit.json
```

### 6.3 템플릿 JSON (라이브러리 원본)

```json
{
  "id": "2BR_A",
  "name": "2BR Type A",
  "version": 1,
  "units": "m",
  "bbox": { "w": 8.4, "d": 7.2 },
  "entry": { "side": "south", "offset": 0.5, "width": 0.9 },
  "rooms": [
    { "id": "living", "name": "거실", "polygon": [[0, 0], [5, 0], [5, 4], [0, 4]] }
  ],
  "doors": [
    {
      "id": "d_entry",
      "category": "entrance",
      "type": "swing_left",
      "width": 0.9,
      "at": [4.2, 0]
    }
  ]
}
```

인스턴스: `{ "unitId": "U-12", "templateId": "2BR_A", "linkedGroupId": "2BR_A", "mirror": false, "rotation": 90 }`.

### 6.4 TypeScript 스키마 초안

```typescript
export type DoorType = "swing_left" | "swing_right" | "sliding" | "pocket";
export type Pt = [number, number];

export interface Door {
  id: string;
  unitId: string;
  category: "entrance" | "bathroom" | "bedroom" | "other";
  position: Pt;
  width: number;
  type: DoorType;
}

export interface Room {
  id: string;
  name: string;
  polygon: Pt[];
}

export interface Zone {
  id: string;
  label: string;
  category: "gfa" | "apartment" | "room";
  polygon: Pt[];
  color: string; // 예: "rgba(0,120,255,0.12)"
}

export interface EgressPath {
  startPoint: Pt;
  exitPoint: Pt;
  /** 중간 경유점(벽 회피 경로). MVP에선 생략 가능 */
  waypoints?: Pt[];
  distanceMeters: number;
}

export interface UnitScore {
  total: number;
  compliance: number;
  adaptivity: number;
  daylight: number;
}

export interface UnitInterior {
  unitId: string;
  templateId: string | null;
  linkedGroupId?: string;
  rooms: Room[];
  doors: Door[];
  zones?: Zone[];
  egressPath?: EgressPath;
  edges?: number;
  areaM2?: number;
  score?: UnitScore;
}

export interface PopulationPoint {
  id: string;
  areaM2: number;
  edges: number;
}

export interface AIAgentResponse {
  summary: string;
  changesMade: string[];
  updatedUnitIds: string[];
}
```

> 기존 `Unit`(`types.ts`) = 건물 레벨 구획. 내부·분석 필드는 `UnitInterior` 또는 plan 부가 레이어로 분리.

### 6.5 스코어링·링크 동기화 (백엔드 초안)

```python
from typing import Any


def calculate_spatial_score(
    rooms: list[dict[str, Any]],
    doors: list[dict[str, Any]],
) -> dict[str, float]:
    compliance = 100.0
    adaptivity = 100.0
    daylight = 100.0

    for door in doors:
        if door.get("category") == "entrance" and door.get("width", 0) < 0.85:
            compliance -= 15.0
        if door.get("category") == "bathroom" and door.get("width", 0) < 0.7:
            compliance -= 10.0

    total = compliance * 0.4 + adaptivity * 0.3 + daylight * 0.3
    return {
        "total": round(total, 1),
        "compliance": compliance,
        "adaptivity": adaptivity,
        "daylight": daylight,
    }


def batch_update_linked_units(
    interiors: list[dict[str, Any]],
    linked_group_id: str,
    target_category: str,
    new_width_m: float,
    new_type: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    updated: list[dict[str, Any]] = []
    logs: list[str] = []

    for unit in interiors:
        if unit.get("linkedGroupId") != linked_group_id and unit.get("templateId") != linked_group_id:
            continue
        modified = False
        for door in unit.get("doors", []):
            if target_category in ("all", door.get("category")):
                door["width"] = new_width_m
                door["type"] = new_type
                modified = True
        if modified:
            unit["score"] = calculate_spatial_score(unit.get("rooms", []), unit.get("doors", []))
            updated.append(unit)
            inch = int(round(new_width_m * 39.3701))
            logs.append(f"{unit.get('unitId')} · {target_category} 문 → {new_type} {inch}\"")

    return updated, logs
```

### 6.6 Canvas · 패널 요지

| 모듈 | 역할 |
|------|------|
| `drawDoor` / `drawUnitHighlight` | 문 Arc, 링크 수정 하이라이트, 점수 태그 |
| `drawExitDistance` / `drawZoneOverlays` | 피난선, 존 3계층 |
| `AIAgentPanel` | 채팅 → tool call → 하이라이트 ID |
| `MetricsPanel` | 기존 표 + Scatter + Unit Summary + 스케줄 |

---

## 7. JSON ↔ GLB 정책

| 방향 | 지원 |
|------|------|
| JSON 편집 → GLB export | 권장 (3D 미리보기) |
| GLB → glTF JSON 보기 | 가능 (디버그) |
| GLB → unit.json 의미 복원 | extras/이름 규칙 있을 때만 |
| GLB를 라이브러리 원본 | **비권장** |

---

## 8. 구현 우선순위 체크리스트

### MVP (2단계 직입)

- [ ] `UnitInterior` / `Door` / `Room` / `UnitScore` 타입
- [ ] 유닛 선택 후 내부 실·문 작도 모드
- [ ] `scoreInterior` (40 / 30 / 30)
- [ ] `data/library/units/*.unit.json` + 저장·불러오기
- [ ] 템플릿 피팅 (`door_point` / 현관 변)
- [ ] Canvas 내부 평면 + 점수
- [ ] `templateId` / `linkedGroupId` 링크 일괄 갱신
- [ ] `Zone` apartment/room 오버레이 (최소 2계층)
- [ ] 유닛 `egressPath` MVP (직선 최대 거리) + Canvas 표시

### 다음

- [ ] Recharts Population scatter (`recharts` 의존성)
- [ ] GFA / NIA / GIA · 문·벽 스케줄
- [ ] AIAgentPanel + tool calling API
- [ ] 문 Arc · 수정 하이라이트 폴리시
- [ ] 벽 회피 피난 경로 (동선 네트워크)
- [ ] PDF/CSV 리포트
- [ ] (선택) JSON → GLB export

### 장기

- [ ] Revit / ArchiCAD BIM
- [ ] 다층 매스·프로그램 할당
- [ ] 학습 기반 분할 (GNN 등)

---

## 9. 요약

| 축 | 내용 |
|----|------|
| 스택 | Next.js 15 + React 19 + Canvas 2D + FastAPI (+ Recharts 예정) |
| 1단계 | 유닛 구획·동선·건물 점수 — **현재** |
| 2단계 | 내부 작도 · 3축 점수 · JSON 라이브러리 · 링크 · 존/피난 다이어그램 |
| 3단계 | AI 에이전트 · 데이터셋 산점도 · GLB/BIM |
| 분석 | Population scatter · Exit distance · Zone mapping · Schedules |

이 문서를 기준으로 모듈을 배치·연동하면 현재 웹 앱을 전문 평면·분석 SaaS 방향으로 확장할 수 있다.
