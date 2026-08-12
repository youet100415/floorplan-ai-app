from core.space_programs import get_program, list_programs


def test_catalog_contains_all_initial_programs():
    ids = {program["id"] for program in list_programs()}
    assert ids == {"residential", "korean_restaurant", "japanese_restaurant", "office"}


def test_restaurant_program_has_service_flow_rules():
    program = get_program("korean_restaurant")
    relations = {(rule.source, rule.target, rule.relation) for rule in program.relationships}
    assert ("kitchen", "storage", "must_connect") in relations
    assert ("bathroom", "dining", "avoid_visible") in relations
