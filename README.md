# Floorplan AI — 평면 · 동선 자동 생성기

건물 외곽선과 복도 중심선을 입력하면 세대를 자동 구획하고, 동선 그래프로
접근성 · 피난 보행거리를 검증하는 인터랙티브 웹 애플리케이션.

```
floorplan-ai-app/
├── backend/                 FastAPI — 공간 분할 & 동선 연산
│   ├── main.py              API 엔드포인트 (/generate, /explore, /presets)
│   ├── selftest.py          외곽선 프리셋 7종 회귀 점검
│   ├── requirements.txt
│   └── core/
│       ├── geometry.py      외곽선 · 슬라이싱 · 코어 기하 연산
│       ├── circulation.py   복도/코어 동선 그래프, 보행거리
│       └── generator.py     Unit Mix 구획 알고리즘 + 법규 채점
└── frontend/                Next.js 15 — 웹 UI 및 Canvas
    └── src/
        ├── app/page.tsx             메인 에디터 페이지
        ├── components/
        │   ├── FloorCanvas.tsx      2D 평면도 · 동선 렌더링
        │   ├── Sidebar.tsx          파라미터 · Unit Mix 조절
        │   └── MetricsPanel.tsx     지표 · 법규 검토 · 대안 비교
        └── utils/{api,types,palette}.ts
```

## 실행

**백엔드** (Python 3.10+)

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt   # macOS/Linux
.venv/Scripts/python -m uvicorn main:app --reload --port 8000
```

API 문서: <http://localhost:8000/docs>

**프론트엔드** (Node 18+)

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

백엔드 주소가 다르면 `NEXT_PUBLIC_API_BASE` 환경변수로 덮어씁니다.

**회귀 점검**

```bash
cd backend && .venv/Scripts/python selftest.py
```

## 생성 파이프라인

1. **외곽선 정리** — 입력 폴리곤을 유효화(self-intersection 제거).
2. **복도 중심선 결정** — 수동 지정이 없으면 최소회전사각형의 장축을 따라
   자동 생성. 편복도(single-loaded)면 중앙이 아니라 한쪽 외피에 붙여 배치한다.
3. **코어 배치** — 좌표를 직접 지정하면 복도 중심선 위로 정사영해 놓고,
   없으면 보행거리 기준으로 개수를 산정해 균등 배치한다. 코어 뒤에 세대가
   될 수 없는 얇은 자투리가 남으면 그 방향은 외피까지 확장해 밴드를 깨끗이
   끊는다. 가까이 찍어 겹친 코어는 하나로 합쳐 면적 이중계상을 막는다.
4. **잔여 밴드 추출** — `외곽선 − 복도 − 코어`. 복도 단부와 절점에서
   직교선/이등분선으로 끊어 구간별로 분리한다.
5. **슬라이싱** — 각 조각을 복도 축(또는 단부 블록이면 법선 축)에 직교하는
   선으로 잘라 세대를 만든다. 세대 개수 `n`은 면적 오차와 최소폭 위반을
   함께 채점해 탐색한다. `unit_count_target`을 주면 탐색 대신 그 목표를
   조각별 몫으로 나눠 쓴다(아래 참조).
6. **접근성 보정** — 복도에 닿지 않는 조각은 인접 세대에 흡수시키고,
   흡수 불가한 것은 **사장 면적**으로 분류해 지표에 그대로 드러낸다.
7. **동선 그래프** — 복도 중심선을 1.5m 간격으로 샘플링해 노드화하고
   코어·세대를 접속시킨 뒤, Dijkstra로 세대별 최근접 코어 보행거리를 구한다.

## 검토 항목

| 코드 | 내용 | 등급 |
|---|---|---|
| `ACCESS` | 복도에서 닿지 않는 사장 면적 | 부적합 |
| `CORE_PLACEMENT` | 코어 배치 결과 (건물 밖·병합 여부) | 부적합/주의 |
| `EGRESS_CONNECT` | 모든 세대가 코어와 그래프상 연결 | 부적합 |
| `EGRESS_DISTANCE` | 최대 보행거리 ≤ 기준값 | 부적합 |
| `DEAD_END` | 막다른 복도 길이 | 주의 |
| `DAYLIGHT` | 세대별 외피 창면 폭 확보 | 주의 |
| `PROPORTION` | 세대 장단변비 ≤ 4 | 주의 |
| `UNIT_MIX` | 목표 구성비 ±12%p 이내 | 주의 |
| `UNIT_COUNT` | 지정한 목표 세대수 달성 (지정했을 때만 표시) | 주의 |

> 기준값은 파라미터로 조절 가능한 **설계 검토용 휴리스틱**입니다. 실제
> 건축법 · 피난규정 심의를 대체하지 않습니다.

## 세대수 조절 (`unit_count_target`)

결과 패널의 **세대수 − / ＋** 는 목표 총 세대수를 바꾸고 곧바로 재생성한다.
목표는 면적 비례로 한 번에 나누지 않는다 — 반올림이 쌓여 합이 어긋나기
때문이다. 대신 한 호씩 *지금 세대가 가장 큰 조각* 에 넣는 최대평균법으로
배분해, 합을 정확히 맞추면서 세대 크기를 조각 간에 고르게 유지한다.

목표를 항상 달성할 수 있는 것은 아니고, 두 방향의 한계가 있다.

- **상한** — 폭은 목표면적에 비례해 나뉘므로 `n ≤ span · min(면적ᵢ/최소폭ᵢ) / 평균면적`.
  비율이 가장 빡빡한 타입 하나가 전체 상한을 결정한다. 더 넣으려면 Unit Mix의
  최소폭을 낮춘다.
- **하한** — 복도·코어로 나뉜 구획 조각마다 최소 1호가 들어간다. 0호로 두면 그
  조각이 통째로 사장 면적이 되어 전용률이 무너지기 때문이다. 조각 수보다 적게
  만들려면 복도를 줄여 조각 수를 줄여야 한다.

어느 쪽이든 `UNIT_COUNT` 검토항목이 실제 배치 수와 원인을 그대로 표시한다.
세대를 줄여도 그 면적은 남은 세대가 흡수하므로 전용률은 유지되고, 대신 목표
전용면적과의 오차(`mean_area_error_pct`)가 커진다.

## 대안 탐색 (`/api/explore`)

시드만 바꾸면 세대 배치 순서만 달라져 점수가 같아집니다. 그래서 결과를 실제로
가르는 변수 — **코어 개수 · 복도 단부 여백 · 복도 폭** — 를 함께 스윕하고
`전용률 − 면적오차 − 위반 페널티`로 점수를 매겨 정렬합니다. 코어를 늘리면
보행거리는 짧아지지만 전용률이 떨어지는 트레이드오프가 표에 그대로 보입니다.

## 알려진 한계

- 복도는 **단일 폴리라인**입니다. 분기(T자·십자) 복도를 지원하지 않으므로,
  L자 평면처럼 한 폴리라인으로 모든 코너를 서비스할 수 없는 형상에서는
  일부 구역이 사장 면적으로 남습니다 (`ACCESS`가 이를 잡아냅니다).
- 세대 **내부** 실 구획(침실/거실/주방)은 생성하지 않습니다. 세대 단위
  구획과 동선까지가 범위입니다. (2단계 로드맵 — 아래 명세서)
- 층 개념이 없는 **단층 평면** 생성기입니다. 코어는 수직 동선의 자리만
  차지하며 층간 연결은 모델링하지 않습니다.
- 세대 타입이 4개를 넘으면 색만으로는 구분이 보장되지 않아, 도면의 모든
  세대에 타입명을 직접 라벨로 표기합니다.

## 로드맵 (1 → 2 → 3단계)

| 단계 | 내용 | 상태 |
|------|------|------|
| **1** | 외곽·복도·코어·유닛 구획, 피난 동선, 건물 레벨 점수 | **현재** |
| **2** | 내부 실/문 작도, 3축 점수, JSON 라이브러리, 링크 유닛, 존·피난 다이어그램 | 목표 |
| **3** | Archie AI 에이전트, Recharts 데이터셋 산점도, (선택) GLB / BIM | 이후 |

**데이터 원칙**: 편집·링크·문 폭의 원본은 **JSON**. GLB는 3D 산출물.

상세 아키텍처·스키마·스코어링·다이어그램·모듈 배치:

→ **[docs/FloorplanAI_System_Specification.md](docs/FloorplanAI_System_Specification.md)**

### 공간 점수 (2단계, 유닛 내부)

```
Total = Compliance×40% + Adaptivity×30% + Daylight×30%
```

- Compliance — 최소 면적, 문 폭, 충돌  
- Adaptivity — 템플릿 변형·고정/가변 제약  
- Daylight — 주요 실 외피 접촉  

내부 도구로 그린 고득점 평면을 `data/library/units/*.unit.json`에 쌓아
“라이브러리 학습”으로 재사용한다.

### 다이어그램 · 분석 (명세 v2)

| 모듈 | 내용 |
|------|------|
| Population & Area Spread | 면적 × 모서리 수 산점도 (Recharts, 예정) |
| Exit Distance | 구석 → 출입문 피난 거리 표시 (Canvas) |
| Zone Mapping | GFA / Apartment / Room 반투명 오버레이 |
| Schedules | GFA·NIA·GIA, 문·벽 수량 집계 |

## 확장 방향 (연구)

구획 알고리즘은 규칙 기반입니다. 학습 기반으로 확장하려면
`core/generator.py`의 `_plan_widths` / `_interleave`가 교체 지점입니다.

- **GNN** (Graph2Plan, House-GAN++) — 외곽선 + 인접 그래프 입력.
- **제약 디퓨전** (HouseDiffusion) — `_compliance`를 가이던스로 사용.
- **LLM + 검증 보상** — `/api/generate` JSON + `score` 보상.
