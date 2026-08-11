import unittest

from core.generator import FloorPlanGenerator, GenerationRequest, UnitType


class WallThicknessTest(unittest.TestCase):
    def test_wall_thickness_reduces_usable_area(self):
        req = GenerationRequest(
            boundary=[(0, 0), (10, 0), (10, 8), (0, 8)],
            unit_mix=[UnitType("1BR", 18.0, 1.0, 3.0)],
            wall_thickness_external=0.25,
            wall_thickness_internal=0.20,
        )
        gen = FloorPlanGenerator(req)
        self.assertLess(gen.usable_boundary.area, gen.boundary.area)


if __name__ == "__main__":
    unittest.main()
