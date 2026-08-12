"""FastAPI 서버 엔드포인트.

실행:  uvicorn main:app --reload --port 8000
문서:  http://localhost:8000/docs
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import store
from core.generator import FloorPlanGenerator, GenerationRequest, UnitType
from core.space_programs import evaluate_program, get_program, list_programs

app = FastAPI(
    title="Floorplan AI — 평면/동선 자동 생성 API",
    version="0.1.0",
    description="건물 외곽선과 복도 동선으로부터 세대를 자동 구획하고 피난 동선을 검증합니다.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3003",
        "http://127.0.0.1:3003",
        "http://localhost:3010",
        "http://127.0.0.1:3010",
        "http://localhost:3020",
        "http://127.0.0.1:3020",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ 스키마
class UnitTypeIn(BaseModel):
    name: str = Field(..., description="세대 타입명 (예: 1BR)")
    target_area: float = Field(..., gt=5, description="목표 전용면적 m²")
    ratio: float = Field(..., ge=0, description="목표 구성비 (합이 1이 아니어도 자동 정규화)")
    min_width: float = Field(3.0, gt=0, description="최소 세대 폭 m")


class CorridorPathIn(BaseModel):
    """수동 복도 한 줄. strategy 로 중복도/편복도를 경로마다 지정."""

    centerline: list[tuple[float, float]] = Field(..., min_length=2)
    strategy: str = Field("double_loaded", pattern="^(double_loaded|single_loaded)$")
    id: str | None = None  # 프론트 식별용, 서버는 무시


class CoreIn(BaseModel):
    """수동 코어. outline 이 있으면 자유 외곽, 없으면 앵커+크기 사각형."""

    anchor: tuple[float, float]
    length: float | None = Field(None, gt=1.0)
    reach: float | None = Field(None, gt=0.5)
    outline: list[tuple[float, float]] | None = Field(None, min_length=3)
    id: str | None = None


class GenerateIn(BaseModel):
    boundary: list[tuple[float, float]] = Field(..., min_length=3, description="건물 외곽선 좌표(m)")
    unit_mix: list[UnitTypeIn] = Field(..., min_length=1)
    corridor: list[tuple[float, float]] | None = Field(
        None, description="레거시 단일 복도 중심선. corridors 가 있으면 무시"
    )
    corridors: list[CorridorPathIn] | None = Field(
        None, description="다중 복도 중심선(중복도·편복도 중첩). 생략하면 자동 생성"
    )
    corridor_width: float = Field(1.8, gt=0.6, le=6.0)
    corridor_end_inset: float = Field(0.0, ge=0.0)
    strategy: str = Field("double_loaded", pattern="^(double_loaded|single_loaded)$")
    cores: list[CoreIn] | list[tuple[float, float]] | None = Field(
        None, description="수동 코어(객체 또는 좌표). 지정 시 core_count 무시"
    )
    core_count: int | None = Field(None, ge=1, le=12)
    core_length: float = Field(6.0, gt=1.0)
    core_reach: float = Field(6.0, gt=1.0)
    max_travel_distance: float = Field(40.0, gt=5.0)
    min_facade_width: float = Field(2.4, ge=0.0, description="세대별 최소 외피 창면 폭 m")
    unit_count_target: int | None = Field(
        None,
        ge=1,
        le=400,
        description="목표 총 세대수. 생략하면 면적 기준 자동 산정. "
        "최소 세대폭·구획 조각 수가 상한/하한이라 목표에 못 미칠 수 있다.",
    )
    wall_thickness_external: float = Field(0.25, ge=0.0, description="외벽 두께 m (250mm)")
    wall_thickness_internal: float = Field(0.20, ge=0.0, description="내부 벽 두께 m (200mm)")
    seed: int = 0


class ExploreIn(GenerateIn):
    variants: int = Field(6, ge=1, le=24, description="탐색할 대안 개수")


class ProgramSpaceIn(BaseModel):
    """One authored or generated room in a program schedule."""

    kind: str = Field(..., min_length=1, max_length=50)
    area: float = Field(..., gt=0)
    width: float | None = Field(None, gt=0)


class ProgramAdjacencyIn(BaseModel):
    source: str = Field(..., min_length=1, max_length=50)
    target: str = Field(..., min_length=1, max_length=50)


class ProgramEvaluateIn(BaseModel):
    """Program schedule and room graph for hard/soft constraint evaluation."""

    total_area: float = Field(..., gt=0)
    spaces: list[ProgramSpaceIn] = Field(..., min_length=1)
    adjacencies: list[ProgramAdjacencyIn] = Field(default_factory=list)


def _to_domain(body: GenerateIn, **overrides) -> GenerationRequest:
    from core.generator import CoreSpec, CorridorSpec

    params = {
        "corridor_width": body.corridor_width,
        "corridor_end_inset": body.corridor_end_inset,
        "core_count": body.core_count,
        "unit_count_target": body.unit_count_target,
        "wall_thickness_external": body.wall_thickness_external,
        "wall_thickness_internal": body.wall_thickness_internal,
        "seed": body.seed,
    }
    params.update(overrides)

    corridors = None
    if body.corridors:
        corridors = [
            CorridorSpec(
                centerline=[tuple(p) for p in c.centerline],
                strategy=c.strategy,
            )
            for c in body.corridors
            if len(c.centerline) >= 2
        ] or None

    cores = None
    if body.cores:
        cores_list: list[CoreSpec] = []
        for c in body.cores:
            if isinstance(c, CoreIn):
                cores_list.append(
                    CoreSpec(
                        anchor=tuple(c.anchor),
                        length=c.length,
                        reach=c.reach,
                        outline=[tuple(p) for p in c.outline] if c.outline else None,
                    )
                )
            elif isinstance(c, (list, tuple)) and len(c) >= 2:
                cores_list.append(CoreSpec(anchor=(float(c[0]), float(c[1]))))
        cores = cores_list or None

    return GenerationRequest(
        boundary=[tuple(p) for p in body.boundary],
        unit_mix=[
            UnitType(u.name, u.target_area, u.ratio, u.min_width) for u in body.unit_mix
        ],
        corridor=[tuple(p) for p in body.corridor] if body.corridor else None,
        corridors=corridors,
        cores=cores,
        strategy=body.strategy,
        core_length=body.core_length,
        core_reach=body.core_reach,
        max_travel_distance=body.max_travel_distance,
        min_facade_width=body.min_facade_width,
        **params,
    )


class ReviseUnitIn(BaseModel):
    id: str
    type: str
    polygon: list[tuple[float, float]] = Field(..., min_length=3)


class ReviseCoreIn(BaseModel):
    id: str
    polygon: list[tuple[float, float]] = Field(..., min_length=3)


class MergeGroupIn(BaseModel):
    ids: list[str] = Field(..., min_length=2, description="합칠 세대 id 목록 — 서로 붙어 있어야 한다")
    type: str | None = Field(None, description="생략하면 첫 세대의 타입을 따른다")


class ReviseIn(BaseModel):
    """생성된 평면을 후편집(삭제·합침·벽 이동)한 뒤 지표/검토항목을 다시 계산한다.

    슬라이싱을 다시 하지 않는다 — /api/generate 응답을 그대로 되돌려 보낸
    boundary·corridor·cores 위에서, 프런트가 이미 확정한 세대 폴리곤만으로
    동선·법규를 재검증한다. 합치기(merges)만 서버가 실제로 폴리곤을 합집합
    연산하고, 삭제는 units 목록에서 빠진 것만으로 표현한다.
    """

    boundary: list[tuple[float, float]] = Field(..., min_length=3)
    corridor_centerlines: list[list[tuple[float, float]]] = Field(..., min_length=1)
    corridor_width: float = Field(..., gt=0.6, le=6.0)
    cores: list[ReviseCoreIn] = Field(default_factory=list)
    cores_manual: bool = False
    units: list[ReviseUnitIn] = Field(..., min_length=1)
    merges: list[MergeGroupIn] = Field(default_factory=list)
    unit_mix: list[UnitTypeIn] = Field(..., min_length=1)
    max_travel_distance: float = Field(40.0, gt=5.0)
    min_facade_width: float = Field(2.4, ge=0.0)
    wall_thickness_external: float = Field(0.25, ge=0.0)
    wall_thickness_internal: float = Field(0.20, ge=0.0)


def _score(result: dict) -> float:
    """대안 랭킹용 점수 — 전용률↑, 면적오차↓, 위반↓."""
    m = result["metrics"]
    fails = sum(1 for c in result["compliance"] if c["level"] == "fail")
    warns = sum(1 for c in result["compliance"] if c["level"] == "warn")
    return round(
        m["efficiency"] * 100 - m["mean_area_error_pct"] * 0.5 - fails * 25 - warns * 5, 2
    )


# ------------------------------------------------------------- 프로젝트 저장
class ProjectIn(BaseModel):
    name: str = Field("제목 없음", max_length=200)
    """설계 문서. 프론트엔드 스키마이므로 서버는 해석하지 않고 그대로 보관한다."""
    doc: dict[str, Any]


class ProjectPatch(BaseModel):
    name: str | None = Field(None, max_length=200)
    doc: dict[str, Any] | None = None


@app.on_event("startup")
def _startup() -> None:
    store.init_db()


@app.get("/api/projects")
def list_projects() -> dict:
    return {"projects": store.list_projects()}


@app.post("/api/projects", status_code=201)
def create_project(body: ProjectIn) -> dict:
    try:
        return store.create_project(body.name, body.doc)
    except store.ProjectError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict:
    try:
        return store.get_project(project_id)
    except store.ProjectError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put("/api/projects/{project_id}")
def update_project(project_id: str, body: ProjectPatch) -> dict:
    try:
        return store.update_project(project_id, body.name, body.doc)
    except store.ProjectError as exc:
        # 용량 초과는 413, 없는 프로젝트는 404
        code = 404 if "찾을 수 없습니다" in str(exc) else 413
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: str) -> None:
    try:
        store.delete_project(project_id)
    except store.ProjectError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# --------------------------------------------------------------- 엔드포인트
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/space-programs")
def space_programs() -> dict:
    """List available use-type programs and their area/relationship rules."""
    return {"programs": list_programs()}


@app.post("/api/space-programs/{program_id}/evaluate")
def evaluate_space_program(program_id: str, body: ProgramEvaluateIn) -> dict:
    """Evaluate a generated or manually edited room schedule.

    The endpoint is geometry-independent on purpose: a future layout generator
    and the existing canvas editor can both use the same explainable checks.
    """
    try:
        program = get_program(program_id)
        return evaluate_program(
            program,
            body.total_area,
            [space.model_dump(exclude_none=True) for space in body.spaces],
            {
                frozenset((adjacency.source, adjacency.target))
                for adjacency in body.adjacencies
            },
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/presets")
def presets() -> dict:
    """에디터 초기값으로 쓸 대표 외곽선/Unit Mix 프리셋."""
    return {
        "boundaries": [
            {"name": "판상형 슬래브 60×22", "coords": [[0, 0], [60, 0], [60, 22], [0, 22]]},
            {
                "name": "L자형",
                "coords": [[0, 0], [56, 0], [56, 20], [26, 20], [26, 46], [0, 46]],
            },
            {
                "name": "U자형 중정",
                "coords": [
                    [0, 0], [64, 0], [64, 40], [46, 40], [46, 16],
                    [18, 16], [18, 40], [0, 40],
                ],
            },
            {
                "name": "각진 부정형",
                "coords": [[0, 0], [52, 6], [58, 30], [30, 38], [4, 28]],
            },
        ],
        "unit_mix": [
            {"name": "1BR", "target_area": 45, "ratio": 0.3, "min_width": 3.6},
            {"name": "2BR", "target_area": 66, "ratio": 0.4, "min_width": 4.5},
            {"name": "3BR", "target_area": 84, "ratio": 0.3, "min_width": 5.4},
        ],
    }


@app.post("/api/generate")
def generate(body: GenerateIn) -> dict:
    try:
        result = FloorPlanGenerator(_to_domain(body)).generate()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    result["score"] = _score(result)
    result["params"] = {
        "core_count": body.core_count,
        "corridor_end_inset": body.corridor_end_inset,
        "corridor_width": body.corridor_width,
        "unit_count_target": body.unit_count_target,
        "seed": body.seed,
    }
    return result


def _sweep(body: ExploreIn) -> list[dict]:
    """탐색할 설계 변수 조합을 생성한다.

    시드만 바꾸면 세대 배치 순서만 달라져 점수가 같아진다. 결과를 실제로
    가르는 변수 — 코어 개수, 복도 단부 여백, 복도 폭 — 를 함께 스윕한다.
    """
    # 코어를 직접 찍었으면 개수는 사용자가 정한 것이므로 스윕하지 않는다.
    if body.cores:
        cores: list[int | None] = [None]
    elif body.core_count is not None:
        cores = [body.core_count]
    else:
        cores = [None, 1, 2, 3]
    insets = list(dict.fromkeys([body.corridor_end_inset, 0.0, 4.0, 8.0]))
    widths = list(dict.fromkeys([body.corridor_width, round(body.corridor_width + 0.6, 2)]))

    combos: list[dict] = []
    for inset in insets:
        for cc in cores:
            for w in widths:
                combos.append(
                    {"core_count": cc, "corridor_end_inset": inset, "corridor_width": w}
                )
    # 시드는 조합을 다 쓴 뒤 배치 다양성을 위해 추가로 돌린다.
    out: list[dict] = []
    for i in range(body.variants):
        combo = dict(combos[i % len(combos)])
        combo["seed"] = body.seed + i // len(combos)
        out.append(combo)
    return out


@app.post("/api/explore")
def explore(body: ExploreIn) -> dict:
    """설계 변수를 스윕해 여러 대안을 생성하고 점수 순으로 정렬해 반환한다."""
    options: list[dict] = []
    for combo in _sweep(body):
        try:
            result = FloorPlanGenerator(_to_domain(body, **combo)).generate()
        except ValueError:
            continue
        result["score"] = _score(result)
        # 목표 세대수는 스윕 대상이 아니므로 모든 대안에 동일하게 실린다.
        result["params"] = {**combo, "unit_count_target": body.unit_count_target}
        options.append(result)

    if not options:
        raise HTTPException(status_code=422, detail="유효한 대안을 생성하지 못했습니다.")
    options.sort(key=lambda r: r["score"], reverse=True)
    return {"count": len(options), "best": options[0]["params"], "options": options}


@app.post("/api/revise")
def revise(body: ReviseIn) -> dict:
    try:
        gen = FloorPlanGenerator.for_revision(
            boundary=[tuple(p) for p in body.boundary],
            corridor_centerlines=[[tuple(p) for p in cl] for cl in body.corridor_centerlines],
            corridor_width=body.corridor_width,
            core_polygons=[[tuple(p) for p in c.polygon] for c in body.cores],
            cores_manual=body.cores_manual,
            unit_mix=[UnitType(u.name, u.target_area, u.ratio, u.min_width) for u in body.unit_mix],
            max_travel_distance=body.max_travel_distance,
            min_facade_width=body.min_facade_width,
            wall_thickness_external=body.wall_thickness_external,
            wall_thickness_internal=body.wall_thickness_internal,
        )
        result = gen.apply_edit(
            units=[(u.id, u.type, [tuple(p) for p in u.polygon]) for u in body.units],
            merges=[(m.ids, m.type) for m in body.merges],
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    result["score"] = _score(result)
    # 편집 결과에는 스윕 파라미터가 없다 — 응답 스키마를 맞추기 위한 자리표시자.
    result["params"] = {
        "core_count": None,
        "corridor_end_inset": 0.0,
        "corridor_width": body.corridor_width,
        "unit_count_target": None,
        "seed": 0,
    }
    return result
