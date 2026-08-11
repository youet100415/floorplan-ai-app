"use client";

/**
 * Rayon Builder 스타일 SVG 2D 도면 뷰포트.
 * PlanDocument 를 직접 편집 — 향후 3D 압출 데이터 소스.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  angleDeg,
  dist,
  formatMeters,
  pickWall,
  pointInPolygon,
  polygonCentroid,
  rightAngleConstrain,
  screenToWorld,
  snapToGrid,
  sub,
  uid,
  worldToScreen,
} from "@/lib/plan/geometry";
import {
  buildOpeningSymbol,
  getOpeningPlacement,
  presetOf,
  type OpeningPlacement,
} from "@/lib/plan/openings";
import type {
  Opening,
  OpeningKind,
  PlanDocument,
  Point,
  ToolId,
  ViewTransform,
  Wall,
  Zone,
} from "@/lib/plan/types";
import { defaultSettings } from "@/lib/plan/types";
import { computeWallPolygons } from "@/lib/plan/wall-join";

interface Props {
  doc: PlanDocument;
  onChange: (doc: PlanDocument) => void;
  tool: ToolId;
  openingKind?: OpeningKind;
  className?: string;
  /** 읽기 전용 */
  readOnly?: boolean;
}

export default function PlanDocCanvas({
  doc,
  onChange,
  tool,
  openingKind = "door-single",
  className,
  readOnly = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const settings = defaultSettings();
  const [view, setView] = useState<ViewTransform>({ scale: 40, ox: 40, oy: 40 });
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const [draftStart, setDraftStart] = useState<Point | null>(null);
  const [draftPoly, setDraftPoly] = useState<Point[]>([]);
  const [selection, setSelection] = useState<{ kind: string; id: string } | null>(null);
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fitted = useRef(false);

  const wallJoin = useMemo(() => computeWallPolygons(doc.walls), [doc.walls]);

  // 첫 로드 시 문서에 맞춤
  useEffect(() => {
    if (fitted.current || !svgRef.current || doc.walls.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width < 10) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const w of doc.walls) {
      for (const p of [w.a, w.b]) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const pad = 1.2;
    const w = Math.max(maxX - minX, 1) + pad * 2;
    const h = Math.max(maxY - minY, 1) + pad * 2;
    const scale = Math.min((rect.width - 48) / w, (rect.height - 48) / h, 80);
    setView({
      scale,
      ox: rect.width / 2 - ((minX + maxX) / 2) * scale,
      oy: rect.height / 2 + ((minY + maxY) / 2) * scale,
    });
    fitted.current = true;
  }, [doc.walls]);

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, view);
    },
    [view],
  );

  const S = (p: Point) => worldToScreen(p, view);

  const patchDoc = useCallback(
    (fn: (d: PlanDocument) => PlanDocument) => {
      onChange(fn(structuredClone(doc)));
    },
    [doc, onChange],
  );

  const addWall = (a: Point, b: Point) => {
    if (dist(a, b) < 0.05) return;
    const storyId = doc.stories?.[0]?.id ?? "story-1";
    const wall: Wall = {
      id: uid("wall"),
      a: { ...a },
      b: { ...b },
      thickness: settings.wallThickness,
      align: "center",
      storyId,
    };
    patchDoc((d) => ({ ...d, walls: [...d.walls, wall] }));
  };

  const addZone = (points: Point[]) => {
    if (points.length < 3) return;
    const z: Zone = {
      id: uid("zone"),
      name: `Room ${doc.zones.length + 1}`,
      points: points.map((p) => ({ ...p })),
      kind: "room",
      storyId: doc.stories?.[0]?.id,
    };
    patchDoc((d) => ({ ...d, zones: [...d.zones, z] }));
  };

  const addOpeningAt = (world: Point) => {
    const hit = pickWall(world, doc.walls, 30 / view.scale);
    if (!hit) return;
    const L = dist(hit.wall.a, hit.wall.b);
    const preset = presetOf(openingKind);
    const half = Math.min(preset.width, L) / 2;
    const offset = Math.min(Math.max(hit.t * L, half), L - half);
    const o: Opening = {
      id: uid("op"),
      kind: openingKind,
      wallId: hit.wall.id,
      offset,
      width: preset.width,
      height: preset.height,
      sill: preset.sill,
      frame: preset.frame,
      flip: false,
      state: "open",
    };
    patchDoc((d) => ({ ...d, openings: [...d.openings, o] }));
  };

  const removeSelected = () => {
    if (!selection) return;
    patchDoc((d) => {
      if (selection.kind === "wall")
        return {
          ...d,
          walls: d.walls.filter((w) => w.id !== selection.id),
          openings: d.openings.filter((o) => o.wallId !== selection.id),
        };
      if (selection.kind === "opening")
        return { ...d, openings: d.openings.filter((o) => o.id !== selection.id) };
      if (selection.kind === "zone")
        return { ...d, zones: d.zones.filter((z) => z.id !== selection.id) };
      return d;
    });
    setSelection(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      const p = panRef.current;
      setView((v) => ({
        ...v,
        ox: p.ox + (e.clientX - p.x),
        oy: p.oy + (e.clientY - p.y),
      }));
      return;
    }
    let p = toWorld(e);
    if (draftStart && e.shiftKey) p = rightAngleConstrain(draftStart, p);
    p = snapToGrid(p, settings.snap);
    setCursor(p);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || tool === "pan" || e.altKey) {
      e.currentTarget.setPointerCapture(e.pointerId);
      panRef.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
      return;
    }
    if (e.button !== 0 || readOnly) return;
    const world = snapToGrid(toWorld(e), settings.snap);

    if (tool === "select") {
      const hitO = doc.openings.find((o) => {
        const w = doc.walls.find((x) => x.id === o.wallId);
        if (!w) return false;
        const pl = getOpeningPlacement(o, w);
        if (!pl) return false;
        const rel = sub(world, w.a);
        const along = rel.x * pl.dir.x + rel.y * pl.dir.y;
        const across = Math.abs(rel.x * pl.n.x + rel.y * pl.n.y);
        return Math.abs(along - pl.offset) <= pl.half && across <= Math.max(w.thickness, 0.3);
      });
      if (hitO) {
        setSelection({ kind: "opening", id: hitO.id });
        return;
      }
      const hitW = pickWall(world, doc.walls, 12 / view.scale);
      if (hitW) {
        setSelection({ kind: "wall", id: hitW.wall.id });
        return;
      }
      const hitZ = [...doc.zones].reverse().find((z) => pointInPolygon(world, z.points));
      if (hitZ) {
        setSelection({ kind: "zone", id: hitZ.id });
        return;
      }
      setSelection(null);
      return;
    }

    if (tool === "door") {
      addOpeningAt(world);
      return;
    }

    if (tool === "zone") {
      if (draftPoly.length >= 3 && dist(world, draftPoly[0]) < 0.4) {
        addZone(draftPoly);
        setDraftPoly([]);
        setDraftStart(null);
        return;
      }
      setDraftPoly((p) => [...p, world]);
      setDraftStart(world);
      return;
    }

    if (tool === "wall" || tool === "line") {
      if (!draftStart) {
        setDraftStart(world);
        return;
      }
      addWall(draftStart, world);
      setDraftStart(world);
    }
  };

  const endPan = () => {
    panRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setView((v) => {
      const factor = Math.exp(-e.deltaY * 0.0015);
      const scale = Math.min(600, Math.max(12, v.scale * factor));
      const k = scale / v.scale;
      return { scale, ox: sx - (sx - v.ox) * k, oy: sy - (sy - v.oy) * k };
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key === "Escape") {
        setDraftStart(null);
        setDraftPoly([]);
      }
      if (e.key === "Enter" && tool === "zone" && draftPoly.length >= 3) {
        addZone(draftPoly);
        setDraftPoly([]);
        setDraftStart(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const openingPlacements = doc.openings
    .map((o) => {
      const w = doc.walls.find((x) => x.id === o.wallId);
      const pl = w ? getOpeningPlacement(o, w) : null;
      return pl ? { o, pl } : null;
    })
    .filter((x): x is { o: Opening; pl: OpeningPlacement } => !!x);

  const ghost: OpeningPlacement | null = (() => {
    if (tool !== "door") return null;
    const hit = pickWall(cursor, doc.walls, 30 / view.scale);
    if (!hit) return null;
    const L = dist(hit.wall.a, hit.wall.b);
    const preset = presetOf(openingKind);
    const half = Math.min(preset.width, L) / 2;
    return getOpeningPlacement(
      {
        id: "ghost",
        kind: openingKind,
        wallId: hit.wall.id,
        offset: Math.min(Math.max(hit.t * L, half), L - half),
        width: preset.width,
        frame: preset.frame,
        flip: false,
      },
      hit.wall,
    );
  })();

  const gridPx = Math.max(settings.snap * 10 * view.scale, 8);

  return (
    <div className={`planDocHost ${className ?? ""}`}>
      <svg
        ref={svgRef}
        className="planDocSvg"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={endPan}
        onPointerLeave={endPan}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern
            id="rayon-grid"
            width={gridPx}
            height={gridPx}
            patternUnits="userSpaceOnUse"
            x={view.ox % gridPx}
            y={view.oy % gridPx}
          >
            <path
              d={`M ${gridPx} 0 L 0 0 0 ${gridPx}`}
              fill="none"
              stroke="var(--plan-grid)"
              strokeWidth={1}
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="var(--plan-bg)" />
        {settings.showGrid && <rect width="100%" height="100%" fill="url(#rayon-grid)" />}

        {/* zones */}
        {doc.zones.map((z) => {
          const active = selection?.kind === "zone" && selection.id === z.id;
          const c = S(polygonCentroid(z.points));
          return (
            <g key={z.id}>
              <polygon
                points={z.points.map((p) => {
                  const s = S(p);
                  return `${s.x},${s.y}`;
                }).join(" ")}
                fill={active ? "var(--plan-selection-fill)" : "var(--plan-zone-fill)"}
                stroke={active ? "var(--plan-selection)" : "var(--plan-zone-stroke)"}
                strokeWidth={active ? 2 : 1}
              />
              <text x={c.x} y={c.y} className="planZoneLabel" textAnchor="middle" dominantBaseline="middle">
                {z.name}
              </text>
            </g>
          );
        })}

        {/* walls */}
        {wallJoin.polys.map((wp) => {
          const active = selection?.kind === "wall" && selection.id === wp.wall.id;
          return (
            <polygon
              key={wp.wall.id}
              points={wp.polygon.map((p) => {
                const s = S(p);
                return `${s.x},${s.y}`;
              }).join(" ")}
              fill={active ? "var(--plan-wall-active)" : "var(--plan-wall)"}
              stroke={active ? "var(--plan-selection)" : "var(--plan-wall-stroke)"}
              strokeWidth={1}
            />
          );
        })}

        {/* openings */}
        {openingPlacements.map(({ o, pl }) => {
          const active = selection?.kind === "opening" && selection.id === o.id;
          const sym = buildOpeningSymbol(pl, o.kind, {
            flip: o.flip,
            frame: o.frame,
            state: o.state,
          });
          const polyPts = (pts: Point[]) =>
            pts
              .map((p) => {
                const s = S(p);
                return `${s.x},${s.y}`;
              })
              .join(" ");
          return (
            <g key={o.id} opacity={active ? 1 : 0.95}>
              {sym.fills.map((f, i) => (
                <polygon
                  key={`f-${i}`}
                  points={polyPts(f.pts)}
                  fill={f.role === "frame" ? "var(--plan-wall)" : "var(--plan-bg)"}
                  stroke="var(--plan-wall-stroke)"
                  strokeWidth={1}
                />
              ))}
              {sym.parts.map((part, i) => (
                <polyline
                  key={`p-${i}`}
                  points={polyPts(part.closed ? [...part.pts, part.pts[0]] : part.pts)}
                  fill="none"
                  stroke={active ? "var(--plan-selection)" : "var(--plan-draft)"}
                  strokeWidth={part.weight ?? 1.25}
                />
              ))}
              {sym.jambs.map((j, i) => (
                <line
                  key={`j-${i}`}
                  x1={S(j[0]).x}
                  y1={S(j[0]).y}
                  x2={S(j[1]).x}
                  y2={S(j[1]).y}
                  stroke="var(--plan-wall-stroke)"
                  strokeWidth={1.5}
                />
              ))}
            </g>
          );
        })}

        {ghost &&
          (() => {
            const g = buildOpeningSymbol(ghost, openingKind, { flip: false });
            const polyPts = (pts: Point[]) =>
              pts
                .map((p) => {
                  const s = S(p);
                  return `${s.x},${s.y}`;
                })
                .join(" ");
            return (
              <g opacity={0.4}>
                {g.fills.map((f, i) => (
                  <polygon key={i} points={polyPts(f.pts)} fill="var(--plan-draft)" />
                ))}
                {g.parts.map((part, i) => (
                  <polyline
                    key={i}
                    points={polyPts(part.pts)}
                    fill="none"
                    stroke="var(--plan-draft)"
                    strokeWidth={1.5}
                  />
                ))}
              </g>
            );
          })()}

        {/* draft */}
        {draftStart && tool === "wall" && (
          <line
            x1={S(draftStart).x}
            y1={S(draftStart).y}
            x2={S(cursor).x}
            y2={S(cursor).y}
            stroke="var(--plan-draft)"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}
        {draftPoly.length > 0 && (
          <polyline
            points={[...draftPoly, cursor]
              .map((p) => {
                const s = S(p);
                return `${s.x},${s.y}`;
              })
              .join(" ")}
            fill="none"
            stroke="var(--plan-draft)"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        )}

        {/* site boundary guide */}
        {doc.siteBoundary && doc.siteBoundary.length >= 3 && (
          <polygon
            points={doc.siteBoundary
              .map((p) => {
                const s = S(p);
                return `${s.x},${s.y}`;
              })
              .join(" ")}
            fill="none"
            stroke="var(--plan-site)"
            strokeWidth={1.5}
            strokeDasharray="8 5"
          />
        )}
      </svg>
      <div className="planDocHud">
        <span>
          {tool} · scale {view.scale.toFixed(0)} px/m
        </span>
        {draftStart && tool === "wall" && (
          <span>
            {formatMeters(dist(draftStart, cursor))} · {angleDeg(draftStart, cursor).toFixed(0)}°
          </span>
        )}
      </div>
    </div>
  );
}
