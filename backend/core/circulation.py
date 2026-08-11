"""코어/복도 동선 네트워크 그래프 연산.

복도 중심선을 일정 간격으로 샘플링해 그래프 노드로 만들고, 코어와 각 세대를
그 그래프에 접속시킨다. 이후 최단경로로 보행거리(travel distance)를 계산해
피난 규정 만족 여부를 검증한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import networkx as nx
from shapely.geometry import LineString, MultiLineString, Point, Polygon

from .geometry import Coord

# 세대 현관문 최소 유효폭(m). 복도와 이만큼 접해야 출입 가능으로 본다.
MIN_DOOR_WIDTH = 0.9
# 세대가 복도에 "닿았다"고 볼 허용 오차(m)
CONTACT_TOL = 0.12
# 서로 다른 복도 경로 끝점이 이 거리 이내면 그래프로 연결
LINK_EPS = 2.0


@dataclass
class UnitAccess:
    unit_id: str
    accessible: bool
    door_width: float
    door_point: Coord | None
    travel_distance: float | None
    nearest_core: str | None


@dataclass
class CirculationNetwork:
    """복도 중심선 기반 보행 동선 그래프.

    centerline 은 LineString 또는 MultiLineString(다중 중심선 중첩)을 받는다.
    """

    centerline: LineString | MultiLineString
    corridor_poly: Polygon
    sample_step: float = 1.5

    graph: nx.Graph = field(default_factory=nx.Graph, init=False)
    node_xy: dict[str, Coord] = field(default_factory=dict, init=False)
    _corridor_nodes: list[tuple[str, float]] = field(default_factory=list, init=False)
    _cores: list[str] = field(default_factory=list, init=False)
    _units: dict[str, UnitAccess] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        self._build_spine()

    def _lines(self) -> list[LineString]:
        cl = self.centerline
        if cl.geom_type == "MultiLineString":
            return list(cl.geoms)
        return [cl]  # type: ignore[list-item]

    # ------------------------------------------------------------------ 구축
    def _build_spine(self) -> None:
        """각 중심선을 샘플링하고, 끝점이 가까운 경로끼리 연결한다."""
        node_i = 0
        path_ends: list[tuple[str, str]] = []  # (start_id, end_id) per line

        for line in self._lines():
            length = float(line.length)
            if length < 1e-6:
                continue
            step = max(0.5, min(self.sample_step, length))
            ts: list[float] = []
            t = 0.0
            while t < length:
                ts.append(t)
                t += step
            if not ts or ts[-1] < length - 1e-6:
                ts.append(length)

            prev_id: str | None = None
            prev_t = 0.0
            first_id = ""
            last_id = ""
            for t in ts:
                pt = line.interpolate(t)
                nid = f"c{node_i}"
                node_i += 1
                self.graph.add_node(nid, kind="corridor", t=t)
                self.node_xy[nid] = (round(pt.x, 4), round(pt.y, 4))
                self._corridor_nodes.append((nid, t))
                if prev_id is not None:
                    self.graph.add_edge(prev_id, nid, weight=t - prev_t, kind="corridor")
                else:
                    first_id = nid
                prev_id, prev_t = nid, t
                last_id = nid
            if first_id and last_id:
                path_ends.append((first_id, last_id))

        # 서로 다른 경로의 끝점이 가까우면 연결 (중복도–편복도 이어짐)
        ends = []
        for s, e in path_ends:
            ends.append(s)
            if e != s:
                ends.append(e)
        for i, a in enumerate(ends):
            ax, ay = self.node_xy[a]
            for b in ends[i + 1 :]:
                bx, by = self.node_xy[b]
                d = ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5
                if d <= LINK_EPS and not self.graph.has_edge(a, b):
                    self.graph.add_edge(a, b, weight=max(d, 0.01), kind="corridor")

    def _nearest_corridor_node(self, xy: Coord) -> tuple[str, float]:
        """좌표에서 가장 가까운 복도 노드와 그 거리."""
        best_id, best_d = self._corridor_nodes[0][0], float("inf")
        for nid, _t in self._corridor_nodes:
            cx, cy = self.node_xy[nid]
            d = (cx - xy[0]) ** 2 + (cy - xy[1]) ** 2
            if d < best_d:
                best_id, best_d = nid, d
        return best_id, best_d**0.5

    # -------------------------------------------------------------- 요소 등록
    def add_core(self, core_id: str, polygon: Polygon) -> None:
        c = polygon.centroid
        xy = (round(c.x, 4), round(c.y, 4))
        self.graph.add_node(core_id, kind="core")
        self.node_xy[core_id] = xy
        anchor, d = self._nearest_corridor_node(xy)
        self.graph.add_edge(core_id, anchor, weight=d, kind="access")
        self._cores.append(core_id)

    def add_unit(self, unit_id: str, polygon: Polygon) -> UnitAccess:
        """세대를 복도에 접속시키고 출입 가능 여부를 판정한다."""
        contact = polygon.exterior.intersection(self.corridor_poly.buffer(CONTACT_TOL))
        door_width = float(contact.length)
        accessible = door_width >= MIN_DOOR_WIDTH

        door_xy: Coord | None = None
        if not contact.is_empty:
            mid: Point = contact.interpolate(contact.length / 2.0)
            door_xy = (round(mid.x, 4), round(mid.y, 4))

        self.graph.add_node(unit_id, kind="unit")
        anchor_xy = door_xy or (polygon.centroid.x, polygon.centroid.y)
        self.node_xy[unit_id] = (round(anchor_xy[0], 4), round(anchor_xy[1], 4))

        if accessible and door_xy is not None:
            anchor, d = self._nearest_corridor_node(door_xy)
            self.graph.add_edge(unit_id, anchor, weight=max(d, 0.1), kind="door")

        access = UnitAccess(
            unit_id=unit_id,
            accessible=accessible,
            door_width=round(door_width, 3),
            door_point=door_xy,
            travel_distance=None,
            nearest_core=None,
        )
        self._units[unit_id] = access
        return access

    # ------------------------------------------------------------------ 평가
    def solve_travel_distances(self) -> dict[str, UnitAccess]:
        """각 세대에서 가장 가까운 코어까지의 보행거리를 계산한다."""
        if not self._cores:
            return self._units

        dist_from_core: dict[str, dict[str, float]] = {
            core: nx.single_source_dijkstra_path_length(self.graph, core, weight="weight")
            for core in self._cores
        }

        for uid, access in self._units.items():
            best_core, best_d = None, float("inf")
            for core, dmap in dist_from_core.items():
                d = dmap.get(uid)
                if d is not None and d < best_d:
                    best_core, best_d = core, d
            if best_core is not None:
                access.nearest_core = best_core
                access.travel_distance = round(best_d, 2)
        return self._units

    def dead_end_length(self) -> float:
        """코어 너머로 뻗은 막다른 복도 중 가장 긴 구간의 길이."""
        if not self._cores:
            return self.centerline.length

        core_ts: list[float] = []
        for core in self._cores:
            anchor = next(
                (
                    n
                    for n in self.graph.neighbors(core)
                    if self.graph.nodes[n].get("kind") == "corridor"
                ),
                None,
            )
            if anchor is not None:
                core_ts.append(self.graph.nodes[anchor]["t"])

        if not core_ts:
            return self.centerline.length
        return round(max(min(core_ts), self.centerline.length - max(core_ts)), 2)

    def is_fully_connected(self) -> bool:
        """모든 세대가 코어와 그래프상 연결되어 있는가."""
        return all(a.travel_distance is not None for a in self._units.values())

    def export(self) -> dict:
        """프론트엔드 렌더링용 그래프 직렬화."""
        return {
            "nodes": [
                {
                    "id": nid,
                    "kind": self.graph.nodes[nid].get("kind", "corridor"),
                    "x": self.node_xy[nid][0],
                    "y": self.node_xy[nid][1],
                }
                for nid in self.graph.nodes
            ],
            "edges": [
                {
                    "source": a,
                    "target": b,
                    "kind": data.get("kind", "corridor"),
                    "weight": round(float(data.get("weight", 0.0)), 3),
                }
                for a, b, data in self.graph.edges(data=True)
            ],
        }
