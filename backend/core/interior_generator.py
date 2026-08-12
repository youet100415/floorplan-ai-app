"""Deterministic first-pass interior layout generator.

This is intentionally a conservative MVP: it lays out a residential program
inside the usable bounding box, clips rooms to the supplied polygon, and then
uses the shared program evaluator to reject/score candidates. It is a stable
baseline for later search/optimization, not a building-code engine.
"""

from __future__ import annotations

from random import Random
from typing import Any

from shapely.geometry import Polygon, box

from .space_programs import SpaceProgram, evaluate_program


def _rect_rooms(boundary: Polygon, program: SpaceProgram, seed: int) -> list[dict[str, Any]]:
    min_x, min_y, max_x, max_y = boundary.bounds
    width = max_x - min_x
    height = max_y - min_y
    if width <= 0 or height <= 0:
        return []

    rng = Random(seed)
    # Allocate the required rooms as vertical bands. The remaining area is
    # deliberately assigned to expandable rooms instead of the entrance.
    rules = [r for r in program.rooms if r.required]
    total_target = sum(r.target_area for r in rules)
    scale = min(1.0, (width * height * 0.86) / max(total_target, 1.0))
    areas = {r.kind: max(r.min_area, r.target_area * scale) for r in rules}
    expandable = [r for r in rules if r.can_expand]
    spare = max(0.0, width * height * 0.86 - sum(areas.values()))
    if expandable:
        each = spare / len(expandable)
        for rule in expandable:
            areas[rule.kind] = min(rule.max_area or areas[rule.kind] + each, areas[rule.kind] + each)

    # A horizontal spine leaves the entry and living room in the first band;
    # other rooms fill the remaining bands. Small jitter creates alternatives.
    order = ["entrance", "living", "kitchen", "bedroom", "bathroom"]
    order = [kind for kind in order if kind in areas]
    if seed % 2:
        order = ["entrance", "living", "kitchen", "bathroom", "bedroom"]
    x = min_x
    rooms: list[dict[str, Any]] = []
    for i, kind in enumerate(order):
        rule = next(r for r in rules if r.kind == kind)
        target = areas[kind]
        band_w = max(rule.min_width, target / max(height * 0.75, 1.0))
        # Do not absorb all leftover area into the last room.  This is the
        # key safeguard that prevents a 100-pyeong home from producing a
        # 40-pyeong entrance or an oversized kitchen.
        band_w = min(band_w, max(rule.min_width, (rule.max_area or target) / max(height, 1.0)))
        room_area = min(target, rule.max_area or target)
        room_h = min(height, max(rule.min_width, room_area / max(band_w, 1e-6)))
        raw = box(x, min_y, min(x + band_w, max_x), min_y + room_h)
        clipped = raw.intersection(boundary.buffer(-0.05))
        if clipped.is_empty or clipped.area < rule.min_area:
            continue
        rooms.append({"kind": kind, "area": round(float(clipped.area), 2), "width": round(float(band_w), 2), "polygon": [list(p) for p in clipped.exterior.coords[:-1]]})
        x += band_w
        if x >= max_x - 0.1:
            break
    return rooms


def generate_interior_layouts(
    boundary_coords: list[tuple[float, float]],
    program: SpaceProgram,
    entrance: tuple[float, float] | None = None,
    variants: int = 3,
) -> list[dict[str, Any]]:
    boundary = Polygon(boundary_coords).buffer(0)
    if boundary.is_empty or boundary.area <= 0:
        raise ValueError("unit boundary is invalid")
    outputs: list[dict[str, Any]] = []
    for seed in range(max(1, variants)):
        rooms = _rect_rooms(boundary, program, seed)
        kinds = {room["kind"] for room in rooms}
        adjacency = set()
        for left, right in zip(rooms, rooms[1:]):
            adjacency.add(frozenset((left["kind"], right["kind"])))
        result = evaluate_program(program, float(boundary.area), rooms, adjacency)
        # Interior geometry is useful to the existing canvas, while the
        # evaluator's schedule/checks remain the source of truth.
        result["rooms"] = rooms
        result["entrance"] = list(entrance) if entrance else None
        result["variant"] = seed + 1
        result["valid"] = not any(c["level"] == "fail" for c in result["checks"])
        outputs.append(result)
    outputs.sort(key=lambda item: (item["valid"], item["score"]), reverse=True)
    return outputs
