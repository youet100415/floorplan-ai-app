"""목표 세대수(unit_count_target) 배분 점검."""

import unittest

from core.generator import FloorPlanGenerator, GenerationRequest, UnitType

MIX = [
    UnitType("1BR", 45.0, 0.3, min_width=3.6),
    UnitType("2BR", 66.0, 0.4, min_width=4.5),
    UnitType("3BR", 84.0, 0.3, min_width=5.4),
]
PLATE = [(0.0, 0.0), (60.0, 0.0), (60.0, 22.0), (0.0, 22.0)]


def plan(**kwargs) -> dict:
    return FloorPlanGenerator(
        GenerationRequest(boundary=PLATE, unit_mix=MIX, **kwargs)
    ).generate()


def check(result: dict, code: str) -> dict | None:
    return next((c for c in result["compliance"] if c["code"] == code), None)


class UnitCountTargetTest(unittest.TestCase):
    def setUp(self) -> None:
        self.natural = plan()["metrics"]["unit_count"]

    def test_absent_by_default(self) -> None:
        """목표를 주지 않으면 검토항목 자체가 나오지 않는다."""
        self.assertIsNone(check(plan(), "UNIT_COUNT"))

    def test_fewer_units(self) -> None:
        target = self.natural - 4
        m = plan(unit_count_target=target)["metrics"]
        self.assertEqual(m["unit_count"], target)

    def test_more_units(self) -> None:
        target = self.natural + 3
        m = plan(unit_count_target=target)["metrics"]
        self.assertEqual(m["unit_count"], target)

    def test_area_is_not_lost_when_reducing(self) -> None:
        """세대를 줄여도 그 면적은 남은 세대가 흡수해야 한다 — 자투리로 새면 안 된다."""
        base = plan()["metrics"]
        few = plan(unit_count_target=self.natural - 5)["metrics"]
        self.assertAlmostEqual(few["efficiency"], base["efficiency"], delta=0.01)
        self.assertLessEqual(few["leftover_area"], base["leftover_area"] + 0.5)

    def test_mix_ratio_survives(self) -> None:
        """개수를 바꿔도 Unit Mix 목표 비율은 유지된다."""
        for row in plan(unit_count_target=self.natural - 4)["metrics"]["mix"]:
            self.assertLessEqual(abs(row["ratio_error"]), 0.12, row["type"])

    def test_capped_by_min_width(self) -> None:
        """물리적으로 불가능한 목표는 상한에서 멈추고 그 사실을 알린다."""
        result = plan(unit_count_target=200)
        got = result["metrics"]["unit_count"]
        self.assertLess(got, 200)
        self.assertGreater(got, self.natural)
        c = check(result, "UNIT_COUNT")
        self.assertIsNotNone(c)
        self.assertEqual(c["level"], "warn")

    def test_min_width_lowered_allows_more(self) -> None:
        """상한은 최소 세대폭이 만든다 — 폭을 낮추면 같은 목표가 달성된다."""
        capped = plan(unit_count_target=200)["metrics"]["unit_count"]
        narrow = FloorPlanGenerator(
            GenerationRequest(
                boundary=PLATE,
                unit_mix=[UnitType(u.name, u.target_area, u.ratio, 2.0) for u in MIX],
                unit_count_target=capped + 4,
            )
        ).generate()
        self.assertGreater(narrow["metrics"]["unit_count"], capped)

    def test_floor_is_piece_count(self) -> None:
        """구획 조각마다 최소 1호 — 그보다 적게는 못 만들고, 경고로 알린다."""
        result = plan(unit_count_target=1)
        self.assertGreater(result["metrics"]["unit_count"], 1)
        self.assertEqual(check(result, "UNIT_COUNT")["level"], "warn")

    def test_deterministic(self) -> None:
        a = plan(unit_count_target=self.natural - 2)["metrics"]["unit_count"]
        b = plan(unit_count_target=self.natural - 2)["metrics"]["unit_count"]
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
