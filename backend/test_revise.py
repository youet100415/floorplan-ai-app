"""세대 후편집(삭제/합침/벽 이동) — apply_edit 점검.

/api/revise 가 감싸는 FloorPlanGenerator.for_revision + apply_edit 을 직접
호출한다. 실제 생성 결과에서 시작해 boundary/corridor/cores 를 그대로
되돌려주고, units 목록만 바꿔가며 재계산이 맞는지 확인한다.
"""

import unittest

from core.generator import FloorPlanGenerator, GenerationRequest, UnitType

MIX = [
    UnitType("1BR", 45.0, 0.3, min_width=3.6),
    UnitType("2BR", 66.0, 0.4, min_width=4.5),
    UnitType("3BR", 84.0, 0.3, min_width=5.4),
]
PLATE = [(0.0, 0.0), (60.0, 0.0), (60.0, 22.0), (0.0, 22.0)]


def base_plan() -> dict:
    return FloorPlanGenerator(GenerationRequest(boundary=PLATE, unit_mix=MIX)).generate()


def gen_for(plan: dict) -> FloorPlanGenerator:
    return FloorPlanGenerator.for_revision(
        boundary=[tuple(p) for p in plan["boundary"]],
        corridor_centerlines=[[tuple(p) for p in cl] for cl in plan["corridor"]["centerlines"]],
        corridor_width=plan["corridor"]["width"],
        core_polygons=[[tuple(p) for p in c["polygon"]] for c in plan["cores"]],
        cores_manual=plan["core_placement"]["manual"],
        unit_mix=MIX,
        max_travel_distance=40.0,
        min_facade_width=2.4,
        wall_thickness_external=0.25,
        wall_thickness_internal=0.20,
    )


def as_units(plan: dict) -> list[tuple[str, str, list[tuple[float, float]]]]:
    return [(u["id"], u["type"], [tuple(p) for p in u["polygon"]]) for u in plan["units"]]


def check(result: dict, code: str) -> dict | None:
    return next((c for c in result["compliance"] if c["code"] == code), None)


class ReviseIdentityTest(unittest.TestCase):
    """편집 없이 그대로 되돌리면 원본과 지표가 같아야 한다 — 재계산 경로 자체의 정합성 검증."""

    def test_roundtrip_matches_original_metrics(self) -> None:
        plan = base_plan()
        result = gen_for(plan).apply_edit(as_units(plan), merges=[])
        self.assertEqual(result["metrics"]["unit_count"], plan["metrics"]["unit_count"])
        self.assertAlmostEqual(
            result["metrics"]["net_unit_area"], plan["metrics"]["net_unit_area"], places=1
        )
        self.assertAlmostEqual(
            result["metrics"]["efficiency"], plan["metrics"]["efficiency"], places=3
        )
        self.assertEqual(result["metrics"]["leftover_area"], 0.0)


class ReviseDeleteTest(unittest.TestCase):
    def test_delete_drops_unit_and_leaves_gap(self) -> None:
        plan = base_plan()
        units = as_units(plan)
        removed = units[0]
        kept = units[1:]
        result = gen_for(plan).apply_edit(kept, merges=[])

        self.assertEqual(result["metrics"]["unit_count"], len(kept))
        self.assertNotIn(removed[0], [u["id"] for u in result["units"]])
        # 지워진 자리는 사라지지 않고 '미배정' 잔여 면적으로 남는다.
        self.assertTrue(any(lo["reason"] == "unassigned" for lo in result["leftovers"]))
        self.assertLess(result["metrics"]["efficiency"], plan["metrics"]["efficiency"])

    def test_delete_all_but_one_fails_cleanly(self) -> None:
        plan = base_plan()
        units = as_units(plan)
        with self.assertRaises(ValueError):
            gen_for(plan).apply_edit([], merges=[])


class ReviseMergeTest(unittest.TestCase):
    def test_merge_adjacent_units_combines_area(self) -> None:
        plan = base_plan()
        units = as_units(plan)
        # 인접한(슬라이싱 순서상 이웃) 첫 두 세대를 합친다.
        a, b = units[0], units[1]
        rest = units[2:]
        result = gen_for(plan).apply_edit(rest + [a, b], merges=[([a[0], b[0]], None)])

        self.assertEqual(result["metrics"]["unit_count"], len(rest) + 1)
        merged = next(u for u in result["units"] if u["id"] not in {u2[0] for u2 in rest})
        self.assertAlmostEqual(
            merged["area"],
            next(u["area"] for u in plan["units"] if u["id"] == a[0])
            + next(u["area"] for u in plan["units"] if u["id"] == b[0]),
            places=1,
        )
        self.assertEqual(merged["type"], a[1])  # 타입 생략 시 첫 세대를 따름

    def test_merge_non_adjacent_units_rejected(self) -> None:
        plan = base_plan()
        units = as_units(plan)
        ids = [u["id"] for u in plan["units"]]
        # 면적으로 서로 떨어진 세대 두 개를 고른다 (첫 번째와 마지막).
        far_pair = [units[0], units[-1]]
        if far_pair[0][0] == far_pair[1][0]:
            self.skipTest("표본에 세대가 하나뿐입니다")
        rest = [u for u in units if u[0] not in {far_pair[0][0], far_pair[1][0]}]
        with self.assertRaises(ValueError):
            gen_for(plan).apply_edit(
                rest + far_pair, merges=[([far_pair[0][0], far_pair[1][0]], None)]
            )

    def test_merge_unknown_type_rejected(self) -> None:
        plan = base_plan()
        units = as_units(plan)
        a, b = units[0], units[1]
        rest = units[2:]
        with self.assertRaises(ValueError):
            gen_for(plan).apply_edit(
                rest + [a, b], merges=[([a[0], b[0]], "존재하지않는타입")]
            )


class ReviseWallMoveTest(unittest.TestCase):
    def test_move_shared_wall_shifts_area_between_neighbors(self) -> None:
        """두 세대의 공유 변을 이동한 것을 폴리곤 자체로 흉내낸다: 한쪽에서 깎아 다른 쪽에 붙인다."""
        plan = base_plan()
        units = plan["units"]
        # x축 폭이 가장 비슷한 이웃 쌍을 진짜 옆세대로 간주하기보다, 간단히
        # 두 세대의 경계를 셰이플리로 직접 조작하는 대신 — 실제 이웃을 찾는다.
        from shapely.geometry import Polygon as SPolygon

        polys = {u["id"]: SPolygon(u["polygon"]) for u in units}
        neighbor_pair = None
        for i, u1 in enumerate(units):
            for u2 in units[i + 1 :]:
                p1, p2 = polys[u1["id"]], polys[u2["id"]]
                if p1.buffer(0.05).intersects(p2) and p1.exterior.intersection(
                    p2.exterior.buffer(0.05)
                ).length > 1.0:
                    neighbor_pair = (u1, u2)
                    break
            if neighbor_pair:
                break
        self.assertIsNotNone(neighbor_pair, "이웃한 세대 쌍을 찾지 못했습니다")
        u1, u2 = neighbor_pair

        # u1 -> u2 방향으로 폭 1m 만큼 벽을 밀어본다: u1 면적을 buffer(-eps) 로
        # 흉내내는 대신, 실제로는 프런트가 공유 변 두 점을 옮겨 보내는 것과
        # 동등하게 각 폴리곤을 그 방향으로 살짝 넓히고/좁힌다.
        p1, p2 = polys[u1["id"]], polys[u2["id"]]
        dx = (p2.centroid.x - p1.centroid.x)
        dy = (p2.centroid.y - p1.centroid.y)
        norm = max((dx ** 2 + dy ** 2) ** 0.5, 1e-6)
        shift = (dx / norm, dy / norm)

        new_p1 = p1.union(p1.buffer(1.0).intersection(p2)).simplify(0.01)
        new_p2 = p2.difference(p1.buffer(1.0)).simplify(0.01)
        self.assertGreater(new_p1.area, 0)
        self.assertGreater(new_p2.area, 0)

        edited = [
            (u["id"], u["type"], list(polys[u["id"]].exterior.coords)[:-1])
            for u in units
            if u["id"] not in (u1["id"], u2["id"])
        ]
        edited.append((u1["id"], u1["type"], list(new_p1.exterior.coords)[:-1]))
        edited.append((u2["id"], u2["type"], list(new_p2.exterior.coords)[:-1]))

        result = gen_for(plan).apply_edit(edited, merges=[])
        self.assertEqual(result["metrics"]["unit_count"], len(units))
        # 총 전용면적은 거의 그대로 유지된다(벽 이동은 재배분일 뿐 면적을 만들거나 없애지 않는다).
        self.assertAlmostEqual(
            result["metrics"]["net_unit_area"], plan["metrics"]["net_unit_area"], delta=0.5
        )


class ReviseOverlapTest(unittest.TestCase):
    def test_overlapping_units_rejected(self) -> None:
        plan = base_plan()
        units = as_units(plan)
        a_id, a_type, a_poly = units[0]
        # 두 번째 세대를 첫 번째와 겹치도록 그대로 복제해 넣는다.
        b_id, b_type, _b_poly = units[1]
        rest = units[2:]
        with self.assertRaises(ValueError):
            gen_for(plan).apply_edit(
                rest + [(a_id, a_type, a_poly), (b_id, b_type, a_poly)], merges=[]
            )


class ReviseInvalidGeometryTest(unittest.TestCase):
    def test_degenerate_polygon_rejected(self) -> None:
        """벽을 너무 밀어 세대가 선으로 뭉개진 경우 — 면적이 0에 가까운 폴리곤."""
        plan = base_plan()
        units = as_units(plan)
        bad_id, bad_type, _poly = units[0]
        sliver = [(0.0, 0.0), (0.01, 0.0), (0.01, 0.01), (0.0, 0.01)]
        rest = units[1:]
        with self.assertRaises(ValueError):
            gen_for(plan).apply_edit(rest + [(bad_id, bad_type, sliver)], merges=[])

    def test_self_intersecting_bowtie_is_repaired_not_crashed(self) -> None:
        """자기교차 입력은 (버려지든 한쪽 로브로 정리되든) 예외 없이 처리되어야 한다."""
        plan = base_plan()
        units = as_units(plan)
        bad_id, bad_type, _poly = units[0]
        bowtie = [(20.0, 5.0), (25.0, 10.0), (25.0, 5.0), (20.0, 10.0)]
        rest = units[1:]
        # 결과가 유효하든(정리되어 살아남든) 무효 판정으로 거부되든, 예외 없이
        # 하나의 명확한 결과로 끝나야 한다 — GEOS TopologyException이 새면 안 된다.
        try:
            result = gen_for(plan).apply_edit(rest + [(bad_id, bad_type, bowtie)], merges=[])
            self.assertEqual(result["metrics"]["unit_count"], len(units))
        except ValueError:
            pass


if __name__ == "__main__":
    unittest.main()
