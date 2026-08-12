"""Reusable space-program definitions and constraint evaluation.

This module intentionally separates a *space program* (what a dwelling or
restaurant needs) from geometry generation (where those rooms are drawn).
It provides a deterministic first step for the interior-layout roadmap:
area budgets, hard size limits, adjacency requirements and explainable
warnings that can be consumed by the Next.js editor.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal


ConstraintLevel = Literal["hard", "soft"]
Relationship = Literal["must_connect", "prefer_adjacent", "avoid_visible"]


@dataclass(frozen=True)
class SpaceRule:
    kind: str
    label: str
    required: bool
    min_area: float
    target_area: float
    max_area: float | None
    min_width: float
    target_ratio: tuple[float, float] | None = None
    can_expand: bool = False


@dataclass(frozen=True)
class RelationshipRule:
    source: str
    target: str
    relation: Relationship
    level: ConstraintLevel = "soft"


@dataclass(frozen=True)
class SpaceProgram:
    id: str
    name: str
    rooms: tuple[SpaceRule, ...]
    relationships: tuple[RelationshipRule, ...]
    expansion_order: tuple[str, ...]

    def public_dict(self) -> dict:
        result = asdict(self)
        # JSON has arrays, not tuples; this also keeps OpenAPI responses simple.
        return result


RESIDENTIAL = SpaceProgram(
    id="residential",
    name="주거 공간",
    rooms=(
        SpaceRule("entrance", "현관", True, 3.0, 5.0, 10.0, 1.2, (0.01, 0.03)),
        SpaceRule("living", "거실", True, 25.0, 45.0, 85.0, 4.0, (0.18, 0.28), True),
        SpaceRule("kitchen", "주방", True, 12.0, 22.0, 45.0, 2.4, (0.08, 0.15), True),
        SpaceRule("bathroom", "욕실", True, 4.0, 7.0, 15.0, 1.5, (0.04, 0.08)),
        SpaceRule("bedroom", "침실", True, 10.0, 16.0, 30.0, 2.7, (0.30, 0.40), True),
        SpaceRule("storage", "수납/팬트리", False, 2.0, 6.0, 20.0, 1.0, None, True),
    ),
    relationships=(
        RelationshipRule("entrance", "living", "must_connect", "hard"),
        RelationshipRule("living", "kitchen", "prefer_adjacent"),
        RelationshipRule("entrance", "bedroom", "avoid_visible"),
        RelationshipRule("bathroom", "living", "avoid_visible"),
    ),
    expansion_order=("living", "bedroom", "storage"),
)


PROGRAMS: dict[str, SpaceProgram] = {RESIDENTIAL.id: RESIDENTIAL}


def list_programs() -> list[dict]:
    return [program.public_dict() for program in PROGRAMS.values()]


def get_program(program_id: str) -> SpaceProgram:
    try:
        return PROGRAMS[program_id]
    except KeyError as exc:
        raise ValueError(f"Unknown space program: {program_id}") from exc


def evaluate_program(
    program: SpaceProgram,
    total_area: float,
    spaces: list[dict],
    adjacencies: set[frozenset[str]],
) -> dict:
    """Evaluate an authored or generated room schedule against a program.

    ``spaces`` has ``kind``, ``area`` and optional ``width`` values. Multiple
    rooms of a kind (for example bedrooms) are aggregated for ratios but each
    individual room is checked for its minimum/maximum size.
    """
    if total_area <= 0:
        raise ValueError("total_area must be greater than zero")

    checks: list[dict] = []
    by_kind: dict[str, list[dict]] = {}
    for space in spaces:
        by_kind.setdefault(space["kind"], []).append(space)

    schedule: list[dict] = []
    for rule in program.rooms:
        items = by_kind.get(rule.kind, [])
        area = sum(float(item["area"]) for item in items)
        ratio = area / total_area
        schedule.append({
            "kind": rule.kind,
            "label": rule.label,
            "count": len(items),
            "area": round(area, 2),
            "ratio": round(ratio, 4),
            "target_ratio": rule.target_ratio,
            "min_area": rule.min_area,
            "target_area": rule.target_area,
            "max_area": rule.max_area,
        })

        if rule.required and not items:
            checks.append({"code": "REQUIRED_SPACE", "level": "fail", "message": f"필수 공간이 없습니다: {rule.label}"})
            continue
        for item in items:
            item_area = float(item["area"])
            if item_area < rule.min_area:
                checks.append({"code": "MIN_AREA", "level": "fail", "message": f"{rule.label} 면적 {item_area:.1f}㎡가 최소 {rule.min_area:.1f}㎡보다 작습니다."})
            if rule.max_area is not None and item_area > rule.max_area:
                checks.append({"code": "MAX_AREA", "level": "fail", "message": f"{rule.label} 면적 {item_area:.1f}㎡가 최대 {rule.max_area:.1f}㎡보다 큽니다."})
            width = item.get("width")
            if width is not None and float(width) < rule.min_width:
                checks.append({"code": "MIN_WIDTH", "level": "fail", "message": f"{rule.label} 폭 {float(width):.1f}m가 최소 {rule.min_width:.1f}m보다 좁습니다."})
        if rule.target_ratio and items:
            low, high = rule.target_ratio
            if not low <= ratio <= high:
                checks.append({"code": "RATIO", "level": "warn", "message": f"{rule.label} 구성비 {ratio:.0%}; 권장 범위는 {low:.0%}~{high:.0%}입니다."})

    present = set(by_kind)
    for rel in program.relationships:
        pair = frozenset((rel.source, rel.target))
        if rel.source not in present or rel.target not in present:
            continue
        connected = pair in adjacencies
        if rel.relation == "must_connect" and not connected:
            checks.append({"code": "MUST_CONNECT", "level": "fail", "message": f"{rel.source}와 {rel.target}은 연결되어야 합니다."})
        elif rel.relation == "prefer_adjacent" and not connected:
            checks.append({"code": "PREFER_ADJACENT", "level": "warn", "message": f"{rel.source}와 {rel.target}의 인접 배치가 권장됩니다."})
        elif rel.relation == "avoid_visible" and connected:
            checks.append({"code": "AVOID_VISIBLE", "level": "warn", "message": f"{rel.source}에서 {rel.target}이 직접 연결되어 있습니다. 시선 차단을 검토하세요."})

    fail_count = sum(check["level"] == "fail" for check in checks)
    warn_count = sum(check["level"] == "warn" for check in checks)
    score = max(0, 100 - fail_count * 20 - warn_count * 5)
    return {"program": program.id, "schedule": schedule, "checks": checks, "score": score}
