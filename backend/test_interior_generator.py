from core.interior_generator import generate_interior_layouts
from core.space_programs import get_program


def test_generator_returns_ranked_variants_and_room_polygons():
    results = generate_interior_layouts(
        [(0, 0), (20, 0), (20, 12), (0, 12)],
        get_program("residential"),
        entrance=(0.5, 0.5),
        variants=3,
    )
    assert len(results) == 3
    assert all(result["rooms"] for result in results)
    assert all("schedule" in result and "checks" in result for result in results)
    assert results[0]["score"] >= results[-1]["score"]
