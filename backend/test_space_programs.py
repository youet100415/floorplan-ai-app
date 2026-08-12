from core.space_programs import evaluate_program, get_program


def test_residential_program_flags_an_oversized_entrance_and_missing_connection():
    result = evaluate_program(
        get_program("residential"),
        total_area=330,
        spaces=[
            {"kind": "entrance", "area": 66, "width": 5},
            {"kind": "living", "area": 80, "width": 8},
            {"kind": "kitchen", "area": 30, "width": 4},
            {"kind": "bathroom", "area": 8, "width": 2},
            {"kind": "bedroom", "area": 18, "width": 3},
        ],
        adjacencies={frozenset(("living", "kitchen"))},
    )

    codes = {check["code"] for check in result["checks"]}
    assert "MAX_AREA" in codes
    assert "MUST_CONNECT" in codes


def test_residential_program_accepts_entrance_living_connection():
    result = evaluate_program(
        get_program("residential"),
        total_area=160,
        spaces=[
            {"kind": "entrance", "area": 4, "width": 1.4},
            {"kind": "living", "area": 38, "width": 5},
            {"kind": "kitchen", "area": 20, "width": 3},
            {"kind": "bathroom", "area": 6, "width": 2},
            {"kind": "bedroom", "area": 16, "width": 3},
        ],
        adjacencies={frozenset(("entrance", "living")), frozenset(("living", "kitchen"))},
    )

    assert not any(check["code"] == "MUST_CONNECT" for check in result["checks"])
