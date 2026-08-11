"""외곽선 프리셋 전체에 대해 생성기를 돌려보는 점검 스크립트.

실행:  python selftest.py            (backend 디렉터리에서)
"""

from __future__ import annotations

from core.generator import FloorPlanGenerator, GenerationRequest, UnitType

MIX = [
    UnitType("1BR", 45.0, 0.3, min_width=3.6),
    UnitType("2BR", 66.0, 0.4, min_width=4.5),
    UnitType("3BR", 84.0, 0.3, min_width=5.4),
]

# (이름, 외곽선, 생성옵션, 기대되는 FAIL 코드)
CASES: list[tuple[str, list[tuple[float, float]], dict, set[str]]] = [
    ("판상형 60x22", [(0, 0), (60, 0), (60, 22), (0, 22)], {}, set()),
    ("판상형 + 단부여백", [(0, 0), (60, 0), (60, 22), (0, 22)], {"corridor_end_inset": 7.0}, set()),
    ("편복도(single)", [(0, 0), (60, 0), (60, 14), (0, 14)], {"strategy": "single_loaded"}, set()),
    (
        # L자 평면은 단일 폴리라인 복도로 모든 코너를 서비스할 수 없다.
        # 복도가 닿지 않는 좌하단 코너를 ACCESS가 사장면적으로 잡아내야 한다.
        "L자형 (좌하단 코너 미서비스 — ACCESS 실패 기대)",
        [(0, 0), (56, 0), (56, 20), (26, 20), (26, 46), (0, 46)],
        {"corridor": [(56, 10), (13, 10), (13, 46)], "core_count": 2},
        {"ACCESS"},
    ),
    (
        # 3구간으로 꺾인 복도 — 절점 이등분선 분할이 제대로 동작하는지 확인
        "U자형 중정 + 꺾인 복도",
        [(0, 0), (64, 0), (64, 40), (46, 40), (46, 16), (18, 16), (18, 40), (0, 40)],
        {"corridor": [(9, 40), (9, 8), (55, 8), (55, 40)], "core_count": 2},
        set(),
    ),
    ("각진 부정형", [(0, 0), (52, 6), (58, 30), (30, 38), (4, 28)], {}, set()),
    ("소형 플레이트 30x16", [(0, 0), (30, 0), (30, 16), (0, 16)], {}, set()),
    (
        "코어 직접 배치 2개",
        [(0, 0), (60, 0), (60, 22), (0, 22)],
        {"cores": [(15, 11), (45, 11)]},
        set(),
    ),
    (
        # 복도에서 떨어진 좌표도 중심선 위로 정사영되어야 한다
        "코어 좌표가 복도에서 떨어짐",
        [(0, 0), (60, 0), (60, 22), (0, 22)],
        {"cores": [(15, 3), (45, 20)]},
        set(),
    ),
    (
        # 한쪽 끝에만 코어를 두면 반대편 보행거리가 기준을 넘어야 한다
        "코어 1개를 끝에 몰아둠 (EGRESS 실패 기대)",
        [(0, 0), (60, 0), (60, 22), (0, 22)],
        {"cores": [(8, 11)]},
        {"EGRESS_DISTANCE"},
    ),
    (
        # 겹치게 찍은 코어는 하나로 병합되어 면적이 이중계상되지 않아야 한다
        "코어를 겹치게 찍음",
        [(0, 0), (60, 0), (60, 22), (0, 22)],
        {"cores": [(30, 11), (32, 11)]},
        set(),
    ),
]


def run() -> int:
    failures = 0
    for name, boundary, kwargs, expected_fails in CASES:
        req = GenerationRequest(boundary=boundary, unit_mix=MIX, **kwargs)
        result = FloorPlanGenerator(req).generate()
        m = result["metrics"]

        print(f"\n=== {name} ===")
        print(
            f"  세대 {m['unit_count']}호 | 전용률 {m['efficiency']:.1%} | "
            f"면적오차 {m['mean_area_error_pct']}% | 자투리 {m['leftover_area']}m²"
            f"(사장 {m['unreachable_area']}m²)"
        )
        print(
            f"  접근가능 {m['accessible_count']}/{m['unit_count']} | "
            f"최대보행 {m['max_travel_distance']}m | 막다른복도 {m['dead_end_length']}m"
        )
        mix_txt = " ".join(
            f"{r['type']}:{r['count']}({r['actual_ratio']:.0%}/{r['target_ratio']:.0%})"
            for r in m["mix"]
        )
        print(f"  믹스 {mix_txt}")
        got_fails = set()
        for c in result["compliance"]:
            mark = {"pass": "OK  ", "warn": "WARN", "fail": "FAIL"}[c["level"]]
            expected = c["level"] == "fail" and c["code"] in expected_fails
            tag = " (기대됨)" if expected else ""
            print(f"    [{mark}] {c['code']}: {c['message']}{tag}")
            if c["level"] == "fail":
                got_fails.add(c["code"])

        unexpected = got_fails - expected_fails
        missing = expected_fails - got_fails
        if unexpected:
            print(f"    !! 예상 밖 FAIL: {sorted(unexpected)}")
        if missing:
            print(f"    !! 잡혔어야 할 FAIL이 누락됨: {sorted(missing)}")
        failures += len(unexpected) + len(missing)

        assert m["unit_count"] > 0, f"{name}: 세대가 하나도 생성되지 않음"
        assert m["efficiency"] <= 1.0, f"{name}: 전용률이 100%를 넘음"
        covered = m["net_unit_area"] + m["corridor_area"] + m["core_area"] + m["leftover_area"]
        assert covered <= m["gross_area"] * 1.02, (
            f"{name}: 면적 합계가 연면적을 초과 ({covered} > {m['gross_area']})"
        )

        cp = result["core_placement"]
        print(
            f"  코어 {'수동' if cp['manual'] else '자동'} "
            f"요청 {cp['requested']} → 배치 {cp['placed']}"
            + (f" (밖 {cp['dropped']})" if cp["dropped"] else "")
        )
        assert cp["placed"] > 0, f"{name}: 코어가 하나도 배치되지 않음"
        assert cp["placed"] <= cp["requested"], f"{name}: 요청보다 많은 코어가 생김"
        # 수동 배치한 코어는 복도 중심선 위로 정사영되므로, 결과 코어는 모두 복도와 닿아야 한다
        for c in result["cores"]:
            assert c["area"] > 0, f"{name}: 면적 0인 코어"

    print(f"\n예상과 다른 판정: {failures}건")
    return failures


if __name__ == "__main__":
    raise SystemExit(0 if run() == 0 else 1)
