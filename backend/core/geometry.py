"""건물 외곽선 및 슬라이싱 기하학 연산.

좌표 단위는 전부 미터(m)로 다룬다. 모든 함수는 순수 함수이며 shapely
지오메트리를 입출력한다.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import split, unary_union

Coord = tuple[float, float]

# 부동소수 오차로 생긴 실오라기 폴리곤을 버리는 기준 면적(m²)
SLIVER_AREA = 0.25


def to_coords(poly: Polygon) -> list[Coord]:
    """폴리곤 외곽 좌표를 (닫힘점 제거된) 리스트로 반환."""
    coords = list(poly.exterior.coords)
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]
    return [(round(x, 4), round(y, 4)) for x, y in coords]


def clean(geom: BaseGeometry) -> BaseGeometry:
    """자기교차/영면적 아티팩트를 정리한다."""
    if geom.is_empty:
        return geom
    if not geom.is_valid:
        geom = geom.buffer(0)
    return geom


def as_polygons(geom: BaseGeometry, min_area: float = SLIVER_AREA) -> list[Polygon]:
    """Polygon/MultiPolygon/GeometryCollection을 유효 폴리곤 리스트로 평탄화."""
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        parts = [geom]
    elif isinstance(geom, MultiPolygon):
        parts = list(geom.geoms)
    else:  # GeometryCollection
        parts = [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]
    return [p for p in parts if p.area > min_area]


def axis_frame(p0: Coord, p1: Coord) -> tuple[Coord, Coord]:
    """선분 p0→p1의 진행방향 단위벡터와 좌측 법선벡터를 반환."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    length = math.hypot(dx, dy)
    if length < 1e-9:
        raise ValueError("길이가 0인 축은 정의할 수 없습니다.")
    u = (dx / length, dy / length)
    n = (-u[1], u[0])
    return u, n


def project_extent(geom: BaseGeometry, origin: Coord, u: Coord) -> tuple[float, float]:
    """geom을 축(origin, u)에 정사영했을 때의 [tmin, tmax] 구간."""
    if isinstance(geom, Polygon):
        pts = list(geom.exterior.coords)
    else:
        pts = list(geom.coords)
    ts = [(x - origin[0]) * u[0] + (y - origin[1]) * u[1] for x, y in pts]
    return min(ts), max(ts)


def project_point(pt: Coord, origin: Coord, u: Coord) -> float:
    return (pt[0] - origin[0]) * u[0] + (pt[1] - origin[1]) * u[1]


def cut_line(origin: Coord, u: Coord, n: Coord, t: float, half_len: float) -> LineString:
    """축 위 파라미터 t 지점에서 축에 직교하는 절단선."""
    cx = origin[0] + u[0] * t
    cy = origin[1] + u[1] * t
    return LineString(
        [
            (cx - n[0] * half_len, cy - n[1] * half_len),
            (cx + n[0] * half_len, cy + n[1] * half_len),
        ]
    )


def slice_along_axis(
    poly: Polygon,
    origin: Coord,
    u: Coord,
    cut_ts: Sequence[float],
) -> list[Polygon]:
    """폴리곤을 축에 직교하는 선들로 잘라 축 방향 순서대로 반환한다."""
    if not cut_ts:
        return [poly]

    minx, miny, maxx, maxy = poly.bounds
    half_len = math.hypot(maxx - minx, maxy - miny) + 10.0
    n = (-u[1], u[0])

    pieces: list[Polygon] = [poly]
    for t in sorted(cut_ts):
        line = cut_line(origin, u, n, t, half_len)
        nxt: list[Polygon] = []
        for piece in pieces:
            if piece.intersects(line):
                nxt.extend(as_polygons(split(piece, line)))
            else:
                nxt.append(piece)
        pieces = nxt

    pieces.sort(key=lambda p: project_point((p.centroid.x, p.centroid.y), origin, u))
    return pieces


def corridor_polygon(centerline: LineString, width: float) -> Polygon:
    """복도 중심선을 폭 width의 띠 폴리곤으로 확장(끝단은 평평하게)."""
    band = centerline.buffer(width / 2.0, cap_style=2, join_style=2)
    return clean(band)


def local_frame(centerline: LineString, t: float) -> tuple[Coord, Coord, Coord]:
    """중심선 거리 t 지점의 (좌표, 진행방향, 좌측법선)."""
    center = centerline.interpolate(t)
    eps = min(0.5, centerline.length / 100.0)
    a = centerline.interpolate(max(0.0, t - eps))
    b = centerline.interpolate(min(centerline.length, t + eps))
    u, n = axis_frame((a.x, a.y), (b.x, b.y))
    return (center.x, center.y), u, n


def ray_depth(boundary: Polygon, origin: Coord, direction: Coord) -> float:
    """origin에서 direction 방향으로 외곽선까지 남은 내부 거리."""
    minx, miny, maxx, maxy = boundary.bounds
    reach = math.hypot(maxx - minx, maxy - miny) + 10.0
    ray = LineString(
        [origin, (origin[0] + direction[0] * reach, origin[1] + direction[1] * reach)]
    )
    inside = ray.intersection(boundary)
    if inside.is_empty:
        return 0.0
    if hasattr(inside, "geoms"):
        return float(max((g.length for g in inside.geoms), default=0.0))
    return float(inside.length)


def core_polygon(
    centerline: LineString,
    t: float,
    length: float,
    reach_pos: float,
    reach_neg: float,
) -> Polygon:
    """중심선 거리 t 지점에서 좌/우 도달거리가 다른 코어 사각형을 만든다."""
    center, u, n = local_frame(centerline, t)
    hl = length / 2.0
    corners = [
        (center[0] - u[0] * hl - n[0] * reach_neg, center[1] - u[1] * hl - n[1] * reach_neg),
        (center[0] + u[0] * hl - n[0] * reach_neg, center[1] + u[1] * hl - n[1] * reach_neg),
        (center[0] + u[0] * hl + n[0] * reach_pos, center[1] + u[1] * hl + n[1] * reach_pos),
        (center[0] - u[0] * hl + n[0] * reach_pos, center[1] - u[1] * hl + n[1] * reach_pos),
    ]
    return Polygon(corners)


def aspect_ratio(poly: Polygon) -> float:
    """최소회전사각형 기준 장변/단변 비. 정방형이면 1.0에 가깝다."""
    rect = poly.minimum_rotated_rectangle
    if not isinstance(rect, Polygon):
        return 999.0
    pts = list(rect.exterior.coords)[:4]
    if len(pts) < 4:
        return 999.0
    e1 = math.dist(pts[0], pts[1])
    e2 = math.dist(pts[1], pts[2])
    short, long = min(e1, e2), max(e1, e2)
    return long / short if short > 1e-6 else 999.0


def facade_length(poly: Polygon, boundary: Polygon, tol: float = 0.15) -> float:
    """폴리곤 변 중 건물 외피(외곽선)에 접한 길이 — 채광/환기 판정용."""
    edge = boundary.exterior.buffer(tol)
    shared = poly.exterior.intersection(edge)
    return float(shared.length)


def polylabel_point(poly: Polygon) -> Coord:
    """폴리곤 내부에 확실히 들어가는 대표점(라벨 위치)."""
    pt: Point = poly.representative_point()
    return (round(pt.x, 4), round(pt.y, 4))


def merge(polys: Iterable[Polygon]) -> BaseGeometry:
    return clean(unary_union(list(polys)))
