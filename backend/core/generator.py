"""Unit Mix 및 공간 자동 구획 알고리즘.

파이프라인
    1) 외곽선 정리 → 2) 복도 중심선 결정(자동/수동)
    3) 복도·코어 폴리곤을 외곽선에서 차감 → 잔여 밴드(band) 추출
    4) 밴드를 복도 축에 직교하는 선으로 슬라이싱해 세대 구획
    5) 동선 그래프 구축 → 접근성/보행거리 검증
    6) 면적 비율(Unit Mix) 및 법규 제약 조건 채점
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import split as shapely_split, unary_union

from .circulation import CONTACT_TOL, MIN_DOOR_WIDTH, CirculationNetwork
from .geometry import (
    Coord,
    aspect_ratio,
    as_polygons,
    axis_frame,
    clean,
    core_polygon,
    corridor_polygon,
    facade_length,
    local_frame,
    polylabel_point,
    ray_depth,
    project_extent,
    slice_along_axis,
    to_coords,
)

# 슬라이싱 결과가 이 면적보다 작으면 세대가 아닌 잔여공간으로 처리(m²)
MIN_VIABLE_AREA = 8.0
# 세대가 성립하기 위한 최소 안깊이(m). 이보다 얇은 띠는 자투리로 본다.
MIN_BAND_DEPTH = 4.5


@dataclass
class UnitType:
    name: str
    target_area: float
    ratio: float
    min_width: float = 3.0


@dataclass
class CorridorSpec:
    """수동 복도 한 줄. strategy 는 경로별(중복도/편복도 중첩)."""

    centerline: list[Coord]
    strategy: str = "double_loaded"  # double_loaded | single_loaded


@dataclass
class CoreSpec:
    """수동 코어. outline 이 있으면 자유 외곽, 없으면 앵커+length/reach 사각형."""

    anchor: Coord
    length: float | None = None
    reach: float | None = None
    outline: list[Coord] | None = None


@dataclass
class GenerationRequest:
    boundary: list[Coord]
    unit_mix: list[UnitType]
    corridor: list[Coord] | None = None  # 레거시 단일 중심선
    corridors: list[CorridorSpec] | None = None  # 다중 중심선(권장)
    corridor_width: float = 1.8
    corridor_end_inset: float = 0.0
    strategy: str = "double_loaded"  # 자동/레거시 기본 전략
    # 수동 코어. Coord 레거시 또는 CoreSpec. 지정하면 core_count 무시.
    cores: list[Coord] | list[CoreSpec] | None = None
    core_count: int | None = None
    core_length: float = 6.0
    core_reach: float = 6.0
    max_travel_distance: float = 40.0
    min_facade_width: float = 2.4  # 세대별 최소 외피(창면) 접촉 폭 m
    # 목표 총 세대수. None 이면 지금까지처럼 면적 기준으로 자동 산정한다.
    # 값을 주면 조각별 개수를 이 합에 맞춰 배분하되, 최소 세대폭·최소 면적이
    # 상한이므로 목표에 못 미칠 수 있다(UNIT_COUNT 검토항목이 알려준다).
    unit_count_target: int | None = None
    wall_thickness_external: float = 0.25  # 외벽/외곽선 두께 m (250mm)
    wall_thickness_internal: float = 0.20  # 내부 벽 두께 m (200mm)
    seed: int = 0
    _rng: random.Random = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)
        if self.wall_thickness_external < 0 or self.wall_thickness_internal < 0:
            raise ValueError("벽 두께는 0보다 커야 합니다.")
        # 레거시 (x,y) 튜플 → CoreSpec
        if self.cores:
            norm: list[CoreSpec] = []
            for c in self.cores:
                if isinstance(c, CoreSpec):
                    norm.append(c)
                elif isinstance(c, (list, tuple)) and len(c) >= 2:
                    norm.append(CoreSpec(anchor=(float(c[0]), float(c[1]))))
                elif isinstance(c, dict):
                    anc = c.get("anchor") or (c.get("x"), c.get("y"))
                    if anc and anc[0] is not None:
                        norm.append(
                            CoreSpec(
                                anchor=(float(anc[0]), float(anc[1])),
                                length=c.get("length"),
                                reach=c.get("reach"),
                                outline=[tuple(p) for p in c["outline"]]
                                if c.get("outline")
                                else None,
                            )
                        )
            self.cores = norm or None


def _apportion(total: int, ratios: list[float]) -> list[int]:
    """최대잉여법(largest remainder)으로 정수 개수를 배분."""
    raw = [total * r for r in ratios]
    counts = [int(math.floor(v)) for v in raw]
    short = total - sum(counts)
    order = sorted(range(len(ratios)), key=lambda i: raw[i] - counts[i], reverse=True)
    for i in range(short):
        counts[order[i % len(order)]] += 1
    return counts


def _interleave(counts: list[int], rng: random.Random) -> list[int]:
    """타입별 개수를 받아 한쪽에 몰리지 않게 분산 배치한 타입 인덱스 시퀀스.

    각 타입을 [0,1] 구간에 균등 분포시킨 뒤 정렬한다(stride scheduling). 흔들림
    폭은 전체 슬롯 간격에 비례시켜, 시드에 따라 인접 세대 순서가 실제로 바뀌되
    분포 자체는 무너지지 않게 한다.
    """
    total = sum(counts)
    if total == 0:
        return []
    amp = 0.8 / total
    keyed: list[tuple[float, int]] = []
    for ti, c in enumerate(counts):
        for j in range(c):
            keyed.append(((j + 0.5) / c + rng.uniform(-amp, amp), ti))
    keyed.sort(key=lambda kv: kv[0])
    return [ti for _k, ti in keyed]


class FloorPlanGenerator:
    """건물 외곽선 + 복도 동선 → 세대 구획 + 동선 검증."""

    def __init__(self, req: GenerationRequest) -> None:
        self.req = req
        self.boundary: Polygon = clean(Polygon(req.boundary))
        if self.boundary.is_empty or self.boundary.area <= 0:
            raise ValueError("유효한 건물 외곽선이 아닙니다.")

        self.usable_boundary = clean(self.boundary.buffer(-self.req.wall_thickness_external))
        if self.usable_boundary.is_empty or self.usable_boundary.area <= 0:
            raise ValueError(
                "외벽 두께를 반영한 사용 가능 면적이 비어 있습니다. 외벽 두께를 줄이거나 외곽선을 다시 조정하세요."
            )

        total_ratio = sum(u.ratio for u in req.unit_mix)
        if total_ratio <= 0:
            raise ValueError("Unit Mix 비율의 합이 0입니다.")
        self.ratios = [u.ratio / total_ratio for u in req.unit_mix]
        # 믹스 가중 평균 전용면적 — 세대 개수 산정의 기준 단위.
        self.avg_target_area = max(
            sum(r * ut.target_area for r, ut in zip(self.ratios, req.unit_mix)), 1e-6
        )

        # (LineString, strategy) 목록 — 중복도·편복도 중첩
        self.corridor_specs = self._resolve_corridor_specs()
        self.lines = [ls for ls, _s in self.corridor_specs]
        if len(self.lines) == 1:
            self.centerline: LineString | MultiLineString = self.lines[0]
        else:
            self.centerline = MultiLineString(self.lines)

        # corridor_poly: 접근성 판정용 (모든 경로 버퍼 합집합)
        polys = [
            corridor_polygon(ls, req.corridor_width).intersection(self.boundary)
            for ls in self.lines
        ]
        self.corridor_poly = clean(unary_union(polys)) if polys else Polygon()
        self.core_polys = self._place_cores()
        # corridor_net: 면적 집계·도면 표기용 (코어 footprint 제외 → 이중계상 방지)
        self.corridor_net = (
            clean(self.corridor_poly.difference(unary_union(self.core_polys)))
            if self.core_polys
            else self.corridor_poly
        )
        self._manual_cores = req.cores is not None

    # -------------------------------------------------------------- 복도 축
    def _apply_inset(self, line: LineString) -> LineString:
        inset = min(self.req.corridor_end_inset, line.length * 0.25)
        if inset <= 0.05:
            return line
        pts = [line.interpolate(inset)]
        for t in self._interior_vertex_ts(line):
            if inset < t < line.length - inset:
                pts.append(line.interpolate(t))
        pts.append(line.interpolate(line.length - inset))
        return LineString([(p.x, p.y) for p in pts])

    def _resolve_corridor_specs(self) -> list[tuple[LineString, str]]:
        """수동 다중 경로 또는 레거시 단일 / 자동 중심선."""
        req = self.req
        specs: list[tuple[LineString, str]] = []

        if req.corridors:
            for c in req.corridors:
                if c.centerline and len(c.centerline) >= 2:
                    strat = c.strategy if c.strategy in ("double_loaded", "single_loaded") else req.strategy
                    specs.append((self._apply_inset(LineString(c.centerline)), strat))
        elif req.corridor and len(req.corridor) >= 2:
            specs.append((self._apply_inset(LineString(req.corridor)), req.strategy))

        if not specs:
            specs.append((self._apply_inset(self._auto_centerline()), req.strategy))
        return specs

    def _iter_lines(self) -> list[LineString]:
        return list(self.lines)

    @staticmethod
    def _interior_vertex_ts(line: LineString) -> list[float]:
        ts, acc = [], 0.0
        coords = list(line.coords)
        for a, b in zip(coords, coords[1:]):
            acc += math.dist(a, b)
            ts.append(acc)
        return ts[:-1]

    def _auto_centerline(self) -> LineString:
        """외곽선 최소회전사각형의 장축을 따라 중심선을 자동 생성.

        편복도(single_loaded)일 때는 중심이 아니라 한쪽 외피에 붙여 배치해야
        반대편이 통째로 사장되지 않는다.
        """
        rect = self.usable_boundary.minimum_rotated_rectangle
        pts = list(rect.exterior.coords)[:4]
        e1, e2 = math.dist(pts[0], pts[1]), math.dist(pts[1], pts[2])
        if e1 >= e2:
            u, n = axis_frame(pts[0], pts[1])
        else:
            u, n = axis_frame(pts[1], pts[2])

        c = self.usable_boundary.centroid
        cx, cy = c.x, c.y
        if self.req.strategy == "single_loaded":
            to_facade = ray_depth(self.usable_boundary, (cx, cy), n)
            shift = max(0.0, to_facade - self.req.corridor_width / 2.0 - 0.05)
            cx, cy = cx + n[0] * shift, cy + n[1] * shift

        minx, miny, maxx, maxy = self.usable_boundary.bounds
        reach = math.hypot(maxx - minx, maxy - miny) + 10.0
        probe = LineString(
            [
                (cx - u[0] * reach, cy - u[1] * reach),
                (cx + u[0] * reach, cy + u[1] * reach),
            ]
        )
        inside = probe.intersection(self.usable_boundary)
        if inside.is_empty:
            raise ValueError("중심선을 외곽선 안에서 찾지 못했습니다.")
        if inside.geom_type == "MultiLineString":
            inside = max(inside.geoms, key=lambda g: g.length)
        return LineString([inside.coords[0], inside.coords[-1]])

    # ------------------------------------------------------------------ 코어
    def _normalized_cores(self) -> list[CoreSpec] | None:
        req = self.req
        if not req.cores:
            return None
        out: list[CoreSpec] = []
        for c in req.cores:
            if isinstance(c, CoreSpec):
                out.append(c)
            else:
                out.append(CoreSpec(anchor=(float(c[0]), float(c[1]))))
        return out

    def _core_stations(self) -> list[float]:
        """자동 배치용 거리 목록 (수동 코어가 없을 때만)."""
        L = self.centerline.length
        req = self.req
        count = req.core_count
        if count is None:
            count = max(1, math.ceil(L / (2.0 * max(req.max_travel_distance, 5.0))))
        return [L * (2 * i + 1) / (2 * count) for i in range(count)]

    def _place_one_rect_core(
        self, t: float, length: float, reach: float
    ) -> list[Polygon]:
        """중심선 거리 t 에 사각형 코어 1개."""
        req = self.req
        half_w = req.corridor_width / 2.0
        center, _u, n = local_frame(self.centerline, t)
        reaches: list[float] = []
        for sign in (1.0, -1.0):
            d = (n[0] * sign, n[1] * sign)
            to_facade = ray_depth(self.usable_boundary, center, d)
            want = half_w + reach
            if to_facade - want < MIN_BAND_DEPTH:
                want = to_facade + 1.0
            reaches.append(want)
        poly = core_polygon(self.centerline, t, length, reaches[0], reaches[1])
        return as_polygons(clean(poly.intersection(self.usable_boundary)))

    def _place_cores(self) -> list[Polygon]:
        """코어를 복도를 따라 배치한다.

        수동: 외곽선 폴리곤 또는 앵커+크기 사각형.
        자동: 보행거리 기준 균등 배치.
        """
        req = self.req
        manual = self._normalized_cores()
        parts: list[Polygon] = []
        self.dropped_cores = 0

        if manual:
            self.requested_cores = len(manual)
            for spec in manual:
                if spec.outline and len(spec.outline) >= 3:
                    poly = clean(Polygon(spec.outline).intersection(self.boundary))
                    placed = as_polygons(poly)
                    if not placed:
                        self.dropped_cores += 1
                    parts.extend(placed)
                    continue
                t = self.centerline.project(Point(spec.anchor))
                length = spec.length if spec.length is not None else req.core_length
                reach = spec.reach if spec.reach is not None else req.core_reach
                placed = self._place_one_rect_core(t, length, reach)
                if not placed:
                    self.dropped_cores += 1
                parts.extend(placed)
        else:
            stations = self._core_stations()
            self.requested_cores = len(stations)
            for t in stations:
                placed = self._place_one_rect_core(t, req.core_length, req.core_reach)
                if not placed:
                    self.dropped_cores += 1
                parts.extend(placed)

        if not parts:
            return []
        return as_polygons(clean(unary_union(parts)))

    # ------------------------------------------------------------- 밴드 분할
    def _residual_bands(self) -> list[Polygon]:
        obstacles = [self.corridor_poly, *self.core_polys]
        residual = clean(self.usable_boundary.difference(unary_union(obstacles)))
        bands = as_polygons(residual, min_area=MIN_VIABLE_AREA / 2.0)

        # 단일 편복도일 때만 한쪽 밴드 폐기. 다중(중복도+편복도 중첩)은 모두 유지
        # — 접근 불가 쪽은 나중에 leftover 로 분류된다.
        if (
            len(self.corridor_specs) == 1
            and self.corridor_specs[0][1] == "single_loaded"
            and bands
        ):
            line = self.corridor_specs[0][0]
            coords = list(line.coords)
            u, n = axis_frame(coords[0], coords[-1])
            o = coords[0]

            def side(p: Polygon) -> float:
                c = p.centroid
                return (c.x - o[0]) * n[0] + (c.y - o[1]) * n[1]

            pos = [b for b in bands if side(b) >= 0]
            neg = [b for b in bands if side(b) < 0]
            bands = pos if sum(b.area for b in pos) >= sum(b.area for b in neg) else neg
        return bands

    def _segment_frames(self) -> list[tuple[Coord, Coord, Coord]]:
        """복도 각 구간의 (시작점, 진행방향, 법선) 목록 — 모든 경로 합침."""
        frames: list[tuple[Coord, Coord, Coord]] = []
        for line in self._iter_lines():
            coords = list(line.coords)
            frames.extend([(a, *axis_frame(a, b)) for a, b in zip(coords, coords[1:])])
        return frames

    def _band_cutters(self) -> list[LineString]:
        """밴드를 구간별로 끊는 절단선 목록.

        - 복도 양 단부: 복도에 직교하는 선. 복도가 외피까지 닿지 않을 때
          단부 블록이 측면 밴드와 한 덩어리로 붙는 것을 막는다.
        - 복도 절점: 인접 두 구간의 이등분선. 꺾인 복도의 코너를 분리한다.
        """
        minx, miny, maxx, maxy = self.usable_boundary.bounds
        half = math.hypot(maxx - minx, maxy - miny) + 10.0
        cutters: list[LineString] = []

        def add(v: Coord, d: Coord) -> None:
            cutters.append(
                LineString(
                    [
                        (v[0] - d[0] * half, v[1] - d[1] * half),
                        (v[0] + d[0] * half, v[1] + d[1] * half),
                    ]
                )
            )

        for line in self._iter_lines():
            coords = list(line.coords)
            if len(coords) < 2:
                continue
            _u0, n0 = axis_frame(coords[0], coords[1])
            add(coords[0], n0)
            _u1, n1 = axis_frame(coords[-2], coords[-1])
            add(coords[-1], n1)

            for j in range(1, len(coords) - 1):
                u_in, _ = axis_frame(coords[j - 1], coords[j])
                u_out, _ = axis_frame(coords[j], coords[j + 1])
                bx, by = u_in[0] + u_out[0], u_in[1] + u_out[1]
                norm = math.hypot(bx, by)
                if norm < 1e-6:
                    bx, by, norm = u_in[0], u_in[1], 1.0
                add(coords[j], (-by / norm, bx / norm))
        return cutters

    def _partition_band(self, band: Polygon) -> list[tuple[Polygon, Coord, Coord]]:
        """밴드를 절단선으로 나누고, 각 조각에 가장 가까운 복도 구간의 축을 부여."""
        frames = self._segment_frames()
        pieces = [band]
        for cutter in self._band_cutters():
            nxt: list[Polygon] = []
            for p in pieces:
                if p.intersects(cutter):
                    nxt.extend(
                        as_polygons(shapely_split(p, cutter), min_area=MIN_VIABLE_AREA / 2.0)
                    )
                else:
                    nxt.append(p)
            pieces = nxt

        out: list[tuple[Polygon, Coord, Coord]] = []
        for p in pieces:
            c = (p.centroid.x, p.centroid.y)
            o, u, _n = min(frames, key=lambda f: self._segment_distance(f, c))
            out.append((p, o, u))
        return out

    @staticmethod
    def _segment_distance(frame: tuple[Coord, Coord, Coord], pt: Coord) -> float:
        o, u, _n = frame
        t = (pt[0] - o[0]) * u[0] + (pt[1] - o[1]) * u[1]
        px, py = o[0] + u[0] * t, o[1] + u[1] * t
        return math.hypot(pt[0] - px, pt[1] - py)

    # --------------------------------------------------------------- 세대 생성
    def _slicing_axis(self, band: Polygon, origin: Coord, u: Coord) -> tuple[Coord, Coord, float]:
        """조각을 자를 축을 고른다.

        복도와 나란한 측면 밴드는 복도 축으로, 복도 단부에 생긴 블록처럼 복도
        직각 방향이 더 긴 조각은 법선 축으로 자른다. 대각선 축은 후보에서
        제외해 세대가 비스듬히 잘리는 것을 막는다.
        """
        n = (-u[1], u[0])
        su = project_extent(band, origin, u)
        sn = project_extent(band, origin, n)
        if (su[1] - su[0]) >= (sn[1] - sn[0]):
            return origin, u, su[1] - su[0]
        return origin, n, sn[1] - sn[0]

    def _widths_for(self, n: int, span: float, depth: float) -> tuple[list[float], list[int]]:
        """세대 개수 n 을 확정했을 때의 폭 배열과 타입 시퀀스.

        span 을 목표 전용면적에 비례해 나눈다 — 큰 타입일수록 넓은 폭을 받는다.
        """
        req = self.req
        counts = _apportion(n, self.ratios)
        seq = _interleave(counts, req._rng)
        if not seq:
            return [], []
        raw = [req.unit_mix[ti].target_area / depth for ti in seq]
        scale = span / sum(raw)
        return [w * scale for w in raw], seq

    def _plan_widths(
        self, area: float, span: float, depth: float, force_n: int | None = None
    ) -> tuple[list[float], list[int]]:
        """면적/폭 제약을 함께 만족하는 세대 개수와 폭 배열을 탐색한다.

        force_n 이 주어지면 탐색하지 않고 그 개수를 그대로 쓴다 — 사용자가 목표
        세대수를 지정했을 때 조각별로 배분된 몫이 들어온다.
        """
        req = self.req
        if force_n is not None:
            widths, seq = self._widths_for(max(1, force_n), span, depth)
            if seq:
                return widths, seq

        n0 = max(1, round(area / self.avg_target_area))

        best: tuple[float, list[float], list[int]] | None = None
        for n in range(max(1, n0 - 3), n0 + 4):
            widths, seq = self._widths_for(n, span, depth)
            if not seq:
                continue

            # 면적 오차 + 최소폭 위반 페널티로 채점
            cost = sum(
                abs(w * depth - req.unit_mix[ti].target_area) / req.unit_mix[ti].target_area
                for w, ti in zip(widths, seq)
            ) / len(seq)
            violations = sum(
                1 for w, ti in zip(widths, seq) if w < req.unit_mix[ti].min_width
            )
            cost += violations * 2.0
            if best is None or cost < best[0]:
                best = (cost, widths, seq)

        if best is None:
            return [span], [0]
        return best[1], best[2]

    def _piece_capacity(self, band: Polygon, origin: Coord, u: Coord) -> int:
        """조각 하나에 물리적으로 들어갈 수 있는 최대 세대수.

        두 가지가 상한을 만든다.
          - 면적: 세대 하나가 MIN_VIABLE_AREA 보다 작아지면 세대가 아니다.
          - 폭: 폭은 목표면적에 비례해 나뉘므로, n 세대일 때 타입 i 의 폭은
            대략 `span · target_i / (n · avg)` 이다. 이것이 모든 타입에서
            min_width 이상이려면 n ≤ span · min(target_i/min_width_i) / avg.
            비율이 가장 빡빡한 타입 하나가 전체 상한을 결정한다.
        """
        if band.area < MIN_VIABLE_AREA:
            return 0
        _o, _axis, span = self._slicing_axis(band, origin, u)
        if span < 1e-3:
            return 0
        tightest = min(
            ut.target_area / max(ut.min_width, 1e-6) for ut in self.req.unit_mix
        )
        by_area = int(band.area // MIN_VIABLE_AREA)
        by_width = int(span * tightest / self.avg_target_area)
        return max(1, min(by_area, by_width))

    def _target_counts(
        self, pieces: list[tuple[Polygon, Coord, Coord]]
    ) -> list[int | None]:
        """목표 총 세대수를 조각별 몫으로 나눈다 (unit_count_target 이 있을 때만).

        면적 비례로 한 번에 나누면 반올림이 쌓여 합이 어긋난다. 대신 한 호씩
        '지금 세대가 가장 큰 조각'에 넣는 최대평균법으로 배분한다 — 합이 정확히
        목표가 되고, 세대 크기도 조각 간에 고르게 유지된다.

        세대가 될 수 있는 조각은 최소 1호를 받는다. 0호가 되면 그 조각이 통째로
        사장 면적이 되어 전용률이 무너지기 때문이다. 따라서 조각 수보다 적은
        목표는 달성할 수 없고, 상한(_piece_capacity)이 목표보다 작으면 목표에
        못 미친다. 둘 다 UNIT_COUNT 검토항목이 그대로 알려준다.
        """
        target = self.req.unit_count_target
        if target is None:
            return [None] * len(pieces)

        caps = [self._piece_capacity(p, o, u) for p, o, u in pieces]
        counts = [1 if c > 0 else 0 for c in caps]

        for _ in range(max(0, target - sum(counts))):
            best_i, best_share = -1, 0.0
            for i, (poly, _o, _u) in enumerate(pieces):
                if counts[i] >= caps[i]:
                    continue
                share = poly.area / (counts[i] + 1)
                if share > best_share:
                    best_i, best_share = i, share
            if best_i < 0:
                break  # 모든 조각이 상한 — 더 쪼개면 최소 세대폭을 깬다
            counts[best_i] += 1

        return [c if c > 0 else None for c in counts]

    def _slice_band(
        self, band: Polygon, origin: Coord, u: Coord, force_n: int | None = None
    ) -> list[tuple[Polygon, int]]:
        """밴드 하나를 Unit Mix에 따라 슬라이싱. (폴리곤, 타입인덱스) 리스트 반환."""
        req = self.req
        if band.area < MIN_VIABLE_AREA:
            return []

        origin, axis, span = self._slicing_axis(band, origin, u)
        if span < 1e-3:
            return []
        t0, _t1 = project_extent(band, origin, axis)
        depth = band.area / span

        widths, seq = self._plan_widths(band.area, span, depth, force_n)

        # 최소 폭 미달 세대는 앞 세대에 흡수시키되, 한 세대가 무한정 커지지 않도록
        # 흡수 상한(최소폭의 1.8배)을 둔다.
        merged_w: list[float] = []
        merged_t: list[int] = []
        for w, ti in zip(widths, seq):
            too_thin = w < req.unit_mix[ti].min_width
            room = merged_w and merged_w[-1] + w <= req.unit_mix[merged_t[-1]].min_width * 1.8
            if too_thin and room:
                merged_w[-1] += w
            else:
                merged_w.append(w)
                merged_t.append(ti)

        cuts, acc = [], t0
        for w in merged_w[:-1]:
            acc += w
            cuts.append(acc)

        pieces = slice_along_axis(band, origin, axis, cuts)
        if len(pieces) != len(merged_t):
            # 오목한 밴드에서 조각 수가 어긋나면 타입을 면적 근사로 재배정한다.
            merged_t = [
                min(
                    range(len(req.unit_mix)),
                    key=lambda ti: abs(p.area - req.unit_mix[ti].target_area),
                )
                for p in pieces
            ]
        return [(p, ti) for p, ti in zip(pieces, merged_t) if p.area >= MIN_VIABLE_AREA]

    # -------------------------------------------------------------- 접근성 보정
    def _has_door(self, poly: Polygon) -> bool:
        contact = poly.exterior.intersection(self.corridor_poly.buffer(CONTACT_TOL))
        return contact.length >= MIN_DOOR_WIDTH

    def _repair_access(
        self, pieces: list[tuple[Polygon, int]]
    ) -> tuple[list[tuple[Polygon, int]], list[Polygon]]:
        """복도에 닿지 않는 조각을 인접 세대에 흡수시킨다.

        흡수할 이웃이 없거나 흡수 시 세대가 지나치게 커지는 조각은 세대가 아니라
        '사장 면적'으로 분류해 지표에 그대로 드러낸다.
        """
        pieces = list(pieces)
        for _ in range(len(pieces) + 1):
            good = [i for i, (p, _t) in enumerate(pieces) if self._has_door(p)]
            bad = [i for i, (p, _t) in enumerate(pieces) if i not in set(good)]
            if not bad or not good:
                break

            merge_done = False
            for bi in bad:
                bp, _bt = pieces[bi]
                best: tuple[float, int, Polygon] | None = None
                for gi in good:
                    gp, gt = pieces[gi]
                    if not bp.buffer(0.05).intersects(gp):
                        continue
                    if bp.exterior.intersection(gp.exterior.buffer(0.05)).length < 1.0:
                        continue
                    merged = clean(unary_union([bp, gp]))
                    if not isinstance(merged, Polygon):
                        continue
                    if merged.area > self.req.unit_mix[gt].target_area * 1.8:
                        continue
                    if best is None or merged.area < best[0]:
                        best = (merged.area, gi, merged)
                if best is not None:
                    _a, gi, merged = best
                    pieces[gi] = (merged, pieces[gi][1])
                    pieces.pop(bi)
                    merge_done = True
                    break
            if not merge_done:
                break

        keep = [(p, t) for p, t in pieces if self._has_door(p)]
        orphan = [p for p, _t in pieces if not self._has_door(p)]
        return keep, orphan

    # ------------------------------------------------------------------ 실행
    def generate(self) -> dict:
        req = self.req
        network = CirculationNetwork(self.centerline, self.corridor_poly)
        for i, cp in enumerate(self.core_polys):
            network.add_core(f"core{i}", cp)

        sliced_all: list[tuple[Polygon, int]] = []
        leftovers: list[tuple[Polygon, str]] = []

        pieces: list[tuple[Polygon, Coord, Coord]] = []
        for band in self._residual_bands():
            pieces.extend(self._partition_band(band))

        # 목표 세대수가 있으면 조각별 몫을 먼저 확정한다. 없으면 전부 None —
        # 조각마다 면적 기준으로 알아서 개수를 찾는 기존 동작 그대로다.
        forced = self._target_counts(pieces)

        for (piece, origin, u), force_n in zip(pieces, forced):
            sliced = self._slice_band(piece, origin, u, force_n)
            if not sliced:
                if piece.area >= MIN_VIABLE_AREA / 2.0:
                    leftovers.append((piece, "too_small"))
                continue
            sliced_all.extend(sliced)

        sliced_all, orphans = self._repair_access(sliced_all)
        leftovers.extend((p, "no_access") for p in orphans)

        # id 는 순번으로 새로 매긴다 — 최초 생성은 항상 처음부터 다시 배치하므로
        # 앞 회차의 id와 이어질 이유가 없다. (편집 후 재계산인 _finalize 직접
        # 호출 쪽은 기존 id를 넘겨 유지한다.)
        return self._finalize([(p, t, None) for p, t in sliced_all], leftovers)

    # -------------------------------------------------------- 통계·검토 마무리
    def _finalize(
        self,
        entries: list[tuple[Polygon, int, str | None]],
        leftovers: list[tuple[Polygon, str]],
    ) -> dict:
        """확정된 세대 폴리곤들로부터 동선·지표·검토항목을 계산해 응답을 만든다.

        최초 생성(generate)과 편집 후 재계산(apply_edit) 둘 다 여기로 모인다 —
        세대가 어떻게 만들어졌든 이 지점부터는 동일한 계산이기 때문이다.
        """
        req = self.req
        network = CirculationNetwork(self.centerline, self.corridor_poly)
        for i, cp in enumerate(self.core_polys):
            network.add_core(f"core{i}", cp)

        units: list[dict] = []
        for idx, (poly, ti, id_hint) in enumerate(entries):
            uid = id_hint or f"u{idx}"
            ut = req.unit_mix[ti]
            access = network.add_unit(uid, poly)
            fac = facade_length(poly, self.boundary)
            units.append(
                {
                    "id": uid,
                    "type": ut.name,
                    "type_index": ti,
                    "polygon": to_coords(poly),
                    "label_at": polylabel_point(poly),
                    "area": round(poly.area, 2),
                    "target_area": ut.target_area,
                    "area_error": round(poly.area - ut.target_area, 2),
                    "aspect_ratio": round(aspect_ratio(poly), 2),
                    "facade_length": round(fac, 2),
                    "facade_ratio": round(fac / max(poly.length, 1e-6), 3),
                    "accessible": access.accessible,
                    "door_width": access.door_width,
                    "door_point": access.door_point,
                }
            )

        access_map = network.solve_travel_distances()
        for unit in units:
            a = access_map[unit["id"]]
            unit["travel_distance"] = a.travel_distance
            unit["nearest_core"] = a.nearest_core

        metrics = self._metrics(units, network, leftovers)
        centerlines_out = [
            [(round(x, 4), round(y, 4)) for x, y in ls.coords] for ls in self.lines
        ]
        # 레거시 호환: centerline 은 첫 줄 (또는 Multi 합쳐진 좌표가 아닌 첫 경로)
        primary = centerlines_out[0] if centerlines_out else []
        return {
            "boundary": to_coords(self.boundary),
            "corridor": {
                "centerline": primary,
                "centerlines": centerlines_out,
                # 코어를 관통하는 부분을 제외하고 남은 실제 복도 면적(여러 조각일 수 있음)
                "polygons": [to_coords(p) for p in as_polygons(self.corridor_net)],
                "width": req.corridor_width,
                "length": round(float(self.centerline.length), 2),
            },
            "cores": [
                {
                    "id": f"core{i}",
                    "polygon": to_coords(p),
                    "area": round(p.area, 2),
                    # 편집 핸들이 붙을 지점 — 중심선상의 코어 중심
                    "anchor": polylabel_point(p),
                }
                for i, p in enumerate(self.core_polys)
            ],
            "core_placement": {
                "manual": self._manual_cores,
                "requested": self.requested_cores,
                "placed": len(self.core_polys),
                "dropped": self.dropped_cores,
            },
            "units": units,
            "leftovers": [
                {"polygon": to_coords(p), "area": round(p.area, 2), "reason": why}
                for p, why in leftovers
            ],
            "graph": network.export(),
            "metrics": metrics,
            "compliance": self._compliance(units, network, metrics),
        }

    # ---------------------------------------------------------- 후편집(revise)
    @classmethod
    def for_revision(
        cls,
        *,
        boundary: list[Coord],
        corridor_centerlines: list[list[Coord]],
        corridor_width: float,
        core_polygons: list[list[Coord]],
        cores_manual: bool,
        unit_mix: list[UnitType],
        max_travel_distance: float,
        min_facade_width: float,
        wall_thickness_external: float,
        wall_thickness_internal: float,
    ) -> "FloorPlanGenerator":
        """편집(삭제·합침·벽 이동) 이후 지표만 다시 계산할 때 쓰는 경량 생성자.

        슬라이싱 파이프라인(__init__)을 돌리지 않는다 — 세대 폴리곤은 이미
        프런트에서 확정되어 있고, 여기서는 그것으로부터 동선을 다시 접속하고
        지표·검토항목만 재계산한다. 입력은 항상 기존 /api/generate 결과
        (boundary·corridor·cores)를 그대로 되돌려 보낸 것이어야 한다.
        """
        self = cls.__new__(cls)
        self.req = GenerationRequest(
            boundary=boundary,
            unit_mix=unit_mix,
            corridor_width=corridor_width,
            max_travel_distance=max_travel_distance,
            min_facade_width=min_facade_width,
            wall_thickness_external=wall_thickness_external,
            wall_thickness_internal=wall_thickness_internal,
        )

        self.boundary = clean(Polygon(boundary))
        if not isinstance(self.boundary, Polygon) or self.boundary.area <= 0:
            raise ValueError("유효한 건물 외곽선이 아닙니다.")
        self.usable_boundary = clean(self.boundary.buffer(-wall_thickness_external))
        if self.usable_boundary.is_empty or self.usable_boundary.area <= 0:
            raise ValueError("외벽 두께를 반영한 사용 가능 면적이 비어 있습니다.")

        total_ratio = sum(u.ratio for u in unit_mix)
        if total_ratio <= 0:
            raise ValueError("Unit Mix 비율의 합이 0입니다.")
        self.ratios = [u.ratio / total_ratio for u in unit_mix]
        self.avg_target_area = max(
            sum(r * u.target_area for r, u in zip(self.ratios, unit_mix)), 1e-6
        )

        self.lines = [LineString(cl) for cl in corridor_centerlines if len(cl) >= 2]
        if not self.lines:
            raise ValueError("복도 중심선이 없습니다.")
        self.centerline = self.lines[0] if len(self.lines) == 1 else MultiLineString(self.lines)

        polys = [
            corridor_polygon(ls, corridor_width).intersection(self.boundary) for ls in self.lines
        ]
        self.corridor_poly = clean(unary_union(polys)) if polys else Polygon()

        self.core_polys = []
        for ring in core_polygons:
            self.core_polys.extend(as_polygons(clean(Polygon(ring).intersection(self.boundary))))
        self.corridor_net = (
            clean(self.corridor_poly.difference(unary_union(self.core_polys)))
            if self.core_polys
            else self.corridor_poly
        )
        self._manual_cores = cores_manual
        self.dropped_cores = 0
        self.requested_cores = len(core_polygons)
        return self

    def apply_edit(
        self,
        units: list[tuple[str, str, list[Coord]]],
        merges: list[tuple[list[str], str | None]],
    ) -> dict:
        """세대 삭제·합침·벽 이동을 반영해 지표를 다시 계산한다.

        units 는 편집 후 살아남은 세대 전체(폴리곤은 이미 프런트에서 벽 이동을
        반영해 확정된 상태) — 삭제는 여기서 빠진 것만으로 표현된다. merges 는
        서버가 실제로 shapely 합집합을 수행할 그룹이다.
        """
        name_to_idx = {u.name: i for i, u in enumerate(self.req.unit_mix)}

        by_id: dict[str, tuple[str, Polygon]] = {}
        for uid, type_name, coords in units:
            # 자기교차 등으로 무효한 입력은 intersection 이전에 먼저 정리한다 —
            # 무효 지오메트리를 그대로 shapely 불리언 연산에 넣으면 예외가 난다.
            raw = clean(Polygon(coords))
            placed = as_polygons(clean(raw.intersection(self.boundary)))
            if not placed:
                raise ValueError(f"세대 {uid} 의 도형이 유효하지 않습니다.")
            if len(placed) > 1:
                raise ValueError(
                    f"세대 {uid} 가 벽 이동으로 여러 조각으로 쪼개졌습니다 — 이동을 되돌리세요."
                )
            by_id[uid] = (type_name, placed[0])

        merged_ids: set[str] = set()
        entries: list[tuple[Polygon, int, str]] = []

        for ids, forced_type in merges:
            missing = [i for i in ids if i not in by_id]
            if missing:
                raise ValueError(f"합칠 세대를 찾을 수 없습니다: {', '.join(missing)}")
            unioned = clean(unary_union([by_id[i][1] for i in ids]))
            if not isinstance(unioned, Polygon):
                raise ValueError("선택한 세대가 서로 붙어있지 않아 합칠 수 없습니다.")
            type_name = forced_type or by_id[ids[0]][0]
            if type_name not in name_to_idx:
                raise ValueError(f"알 수 없는 세대 타입입니다: {type_name}")
            merged_ids.update(ids)
            entries.append((unioned, name_to_idx[type_name], f"{ids[0]}+{len(ids) - 1}"))

        for uid, (type_name, poly) in by_id.items():
            if uid in merged_ids:
                continue
            if type_name not in name_to_idx:
                raise ValueError(f"알 수 없는 세대 타입입니다: {type_name}")
            entries.append((poly, name_to_idx[type_name], uid))

        if not entries:
            raise ValueError("남은 세대가 없습니다.")

        # 겹침 방지 — 벽을 이웃 쪽으로 너무 밀면 두 세대가 서로 침범할 수 있다.
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                inter = entries[i][0].intersection(entries[j][0])
                if inter.area > 0.05:
                    raise ValueError(
                        f"세대 {entries[i][2]} 와 {entries[j][2]} 가 겹칩니다"
                        f"({inter.area:.2f}m²) — 벽 위치를 다시 조정하세요."
                    )

        # 편집으로 비워진 자리(삭제된 세대의 자리 등)는 사라지지 않고
        # '미배정' 잔여 면적으로 그대로 드러낸다 — 전용률이 조용히 뻥튀기되지
        # 않게 하기 위해서다.
        covered = [poly for poly, _ti, _uid in entries]
        covered.append(self.corridor_net if not self.corridor_net.is_empty else self.corridor_poly)
        covered.extend(self.core_polys)
        gap = clean(self.usable_boundary.difference(unary_union(covered)))
        leftovers = [(p, "unassigned") for p in as_polygons(gap, min_area=0.5)]

        return self._finalize(entries, leftovers)

    # ------------------------------------------------------------------ 지표
    def _metrics(self, units: list[dict], network: CirculationNetwork, leftovers) -> dict:
        req = self.req
        gross = self.usable_boundary.area
        net = sum(u["area"] for u in units)
        corridor_area = self.corridor_net.area
        core_area = sum(p.area for p in self.core_polys)

        by_type: dict[str, dict] = {}
        for ut in req.unit_mix:
            by_type[ut.name] = {
                "type": ut.name,
                "target_ratio": 0.0,
                "count": 0,
                "area": 0.0,
                "target_area": ut.target_area,
                "avg_area": 0.0,
            }
        for r, ut in zip(self.ratios, req.unit_mix):
            by_type[ut.name]["target_ratio"] = round(r, 4)
        for u in units:
            row = by_type[u["type"]]
            row["count"] += 1
            row["area"] += u["area"]

        total_count = max(len(units), 1)
        for row in by_type.values():
            row["area"] = round(row["area"], 2)
            row["avg_area"] = round(row["area"] / row["count"], 2) if row["count"] else 0.0
            row["actual_ratio"] = round(row["count"] / total_count, 4)
            row["ratio_error"] = round(row["actual_ratio"] - row["target_ratio"], 4)

        travels = [u["travel_distance"] for u in units if u["travel_distance"] is not None]
        area_errs = [abs(u["area_error"]) / max(u["target_area"], 1e-6) for u in units]

        return {
            "gross_area": round(gross, 2),
            "net_unit_area": round(net, 2),
            "corridor_area": round(corridor_area, 2),
            "core_area": round(core_area, 2),
            "leftover_area": round(sum(p.area for p, _w in leftovers), 2),
            "unreachable_area": round(
                sum(p.area for p, why in leftovers if why == "no_access"), 2
            ),
            "efficiency": round(net / gross, 4) if gross else 0.0,
            "unit_count": len(units),
            "accessible_count": sum(1 for u in units if u["accessible"]),
            "connected_count": len(travels),
            "max_travel_distance": round(max(travels), 2) if travels else None,
            "avg_travel_distance": round(sum(travels) / len(travels), 2) if travels else None,
            "dead_end_length": network.dead_end_length(),
            "mean_area_error_pct": round(100 * sum(area_errs) / len(area_errs), 2)
            if area_errs
            else 0.0,
            "mix": list(by_type.values()),
        }

    def _compliance(self, units: list[dict], network: CirculationNetwork, metrics: dict) -> list[dict]:
        req = self.req
        checks: list[dict] = []

        def add(code: str, ok: bool, msg: str, level_fail: str = "fail") -> None:
            checks.append({"code": code, "level": "pass" if ok else level_fail, "message": msg})

        unreachable = metrics["unreachable_area"]
        add(
            "ACCESS",
            unreachable <= 0.5,
            "모든 구획이 복도에서 직접 출입 가능합니다."
            if unreachable <= 0.5
            else f"복도에서 닿지 않아 사장된 면적 {unreachable}m² "
            f"(연면적의 {unreachable / metrics['gross_area']:.1%}) — 복도를 연장하거나 "
            f"단부 여백을 줄이세요.",
        )

        add(
            "EGRESS_CONNECT",
            network.is_fully_connected(),
            "모든 세대가 코어와 동선상 연결되어 있습니다."
            if network.is_fully_connected()
            else "코어까지 경로가 없는 세대가 있습니다.",
        )

        mt = metrics["max_travel_distance"]
        add(
            "EGRESS_DISTANCE",
            mt is not None and mt <= req.max_travel_distance,
            f"최대 보행거리 {mt}m ≤ 기준 {req.max_travel_distance}m"
            if mt is not None and mt <= req.max_travel_distance
            else f"최대 보행거리 {mt}m 가 기준 {req.max_travel_distance}m 를 초과합니다.",
        )

        de = metrics["dead_end_length"]
        add(
            "DEAD_END",
            de <= req.max_travel_distance / 2.0,
            f"막다른 복도 {de}m",
            level_fail="warn",
        )

        dark = [u["id"] for u in units if u["facade_length"] < req.min_facade_width]
        add(
            "DAYLIGHT",
            not dark,
            f"모든 세대가 외피 창면 {req.min_facade_width}m 이상을 확보했습니다."
            if not dark
            else f"창면 폭이 {req.min_facade_width}m 미만인 세대 {len(dark)}개",
            level_fail="warn",
        )

        bad_shape = [u["id"] for u in units if u["aspect_ratio"] > 4.0]
        add(
            "PROPORTION",
            not bad_shape,
            "세대 형상비 양호(장단변비 ≤ 4)."
            if not bad_shape
            else f"세장비가 과도한 세대 {len(bad_shape)}개",
            level_fail="warn",
        )

        if not self.core_polys:
            add("CORE_PLACEMENT", False, "배치된 코어가 없습니다 — 피난 검토가 불가능합니다.")
        elif self.dropped_cores:
            add(
                "CORE_PLACEMENT",
                False,
                f"건물 외곽선 밖에 찍힌 코어 {self.dropped_cores}개가 무시되었습니다.",
                level_fail="warn",
            )
        else:
            merged = self.requested_cores - len(self.core_polys)
            add(
                "CORE_PLACEMENT",
                True,
                f"코어 {len(self.core_polys)}개 배치"
                + (f" (겹친 {merged}개는 병합)" if merged > 0 else ""),
            )

        target = req.unit_count_target
        if target is not None:
            got = metrics["unit_count"]
            if got == target:
                msg = f"목표 세대수 {target}호를 그대로 배치했습니다."
            elif got < target:
                why = [
                    f"최소 세대폭({min(u.min_width for u in req.unit_mix)}m)·"
                    f"최소 면적({MIN_VIABLE_AREA}m²) 상한"
                ]
                if metrics["unreachable_area"] > 0.5:
                    why.append("복도에서 닿지 않아 흡수·사장된 조각")
                msg = (
                    f"목표 {target}호 중 {got}호를 배치했습니다 — "
                    + ", ".join(why)
                    + "이 원인입니다. 최소폭을 낮추거나 복도·외곽선을 조정하세요."
                )
            else:
                msg = (
                    f"목표 {target}호보다 {got - target}호 많습니다 — 복도·코어로 나뉜 "
                    f"구획 조각마다 최소 1호가 들어가므로 조각 수보다 적게는 만들 수 "
                    f"없습니다. 복도를 줄여 조각 수를 줄이세요."
                )
            add("UNIT_COUNT", got == target, msg, level_fail="warn")

        mix_ok = all(abs(r["ratio_error"]) <= 0.12 for r in metrics["mix"])
        add(
            "UNIT_MIX",
            mix_ok,
            "Unit Mix 목표 비율을 ±12%p 이내로 만족합니다."
            if mix_ok
            else "Unit Mix 목표 비율에서 벗어난 타입이 있습니다.",
            level_fail="warn",
        )
        return checks


# ---------------------------------------------------------------- 사용 예시
if __name__ == "__main__":
    req = GenerationRequest(
        boundary=[(0, 0), (60, 0), (60, 22), (0, 22)],
        corridor=None,
        corridor_width=2.0,
        unit_mix=[
            UnitType("1BR", 45.0, 0.3),
            UnitType("2BR", 66.0, 0.4),
            UnitType("3BR", 84.0, 0.3),
        ],
    )
    result = FloorPlanGenerator(req).generate()
    m = result["metrics"]
    print(f"세대수 {m['unit_count']} / 전용률 {m['efficiency']:.1%} / 최대보행 {m['max_travel_distance']}m")
    for c in result["compliance"]:
        print(f"  [{c['level'].upper():4}] {c['code']}: {c['message']}")
