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
  /** 우클릭 작도 메뉴 (호스트 기준 px) */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fitted = useRef(false);
  /** 벽 연속 작도 중 추가한 벽 id — 마지막 구간 되돌리기용 */
  const wallChainRef = useRef<string[]>([]);

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

  const addWall = (a: Point, b: Point): string | null => {
    if (dist(a, b) < 0.05) return null;
    const storyId = doc.stories?.[0]?.id ?? "story-1";
    const id = uid("wall");
    const wall: Wall = {
      id,
      a: { ...a },
      b: { ...b },
      thickness: settings.wallThickness,
      align: "center",
      storyId,
    };
    patchDoc((d) => ({ ...d, walls: [...d.walls, wall] }));
    return id;
  };

  const isDrawing =
    tool === "wall" || tool === "line" || tool === "zone"
      ? !!(draftStart || draftPoly.length > 0)
      : false;

  const addZone = useCallback(
    (points: Point[]) => {
      if (points.length < 3) return;
      const z: Zone = {
        id: uid("zone"),
        name: `Room ${doc.zones.length + 1}`,
        points: points.map((p) => ({ ...p })),
        kind: "room",
        storyId: doc.stories?.[0]?.id,
      };
      patchDoc((d) => ({ ...d, zones: [...d.zones, z] }));
    },
    [doc.zones.length, doc.stories, patchDoc],
  );

  /** 작도 확정 — 벽: 체인 종료, 존: 폴리곤 확정 */
  const menuConfirm = useCallback(() => {
    if (tool === "zone" && draftPoly.length >= 3) {
      addZone(draftPoly);
    }
    // 벽은 이미 클릭마다 들어가 있으므로 체인만 종료
    setDraftStart(null);
    setDraftPoly([]);
    wallChainRef.current = [];
    setCtxMenu(null);
  }, [tool, draftPoly, addZone]);

  /** 작도 전체 취소 — 이번 체인에서 올린 벽도 되돌림 */
  const menuCancel = useCallback(() => {
    const chain = wallChainRef.current;
    if (chain.length > 0) {
      const drop = new Set(chain);
      patchDoc((d) => ({
        ...d,
        walls: d.walls.filter((w) => !drop.has(w.id)),
        openings: d.openings.filter((o) => !drop.has(o.wallId)),
      }));
    }
    wallChainRef.current = [];
    setDraftStart(null);
    setDraftPoly([]);
    setCtxMenu(null);
  }, [patchDoc]);

  /** 마지막 점/벽 구간만 취소 */
  const menuUndoLast = useCallback(() => {
    if (tool === "zone" && draftPoly.length > 0) {
      const next = draftPoly.slice(0, -1);
      setDraftPoly(next);
      setDraftStart(next.length ? next[next.length - 1] : null);
      setCtxMenu(null);
      return;
    }
    if ((tool === "wall" || tool === "line") && wallChainRef.current.length > 0) {
      const chain = wallChainRef.current;
      const lastId = chain[chain.length - 1];
      const rest = chain.slice(0, -1);
      wallChainRef.current = rest;
      const lastWall = doc.walls.find((w) => w.id === lastId);
      const prevWall =
        rest.length > 0 ? doc.walls.find((w) => w.id === rest[rest.length - 1]) : null;
      setDraftStart(
        prevWall ? { ...prevWall.b } : lastWall ? { ...lastWall.a } : null,
      );
      patchDoc((d) => ({
        ...d,
        walls: d.walls.filter((w) => w.id !== lastId),
        openings: d.openings.filter((o) => o.wallId !== lastId),
      }));
      setCtxMenu(null);
      return;
    }
    // 벽 첫 점만 찍은 상태
    if (draftStart && wallChainRef.current.length === 0) {
      setDraftStart(null);
      setCtxMenu(null);
    }
  }, [tool, draftPoly, draftStart, doc.walls, patchDoc]);

  const openDrawMenu = (clientX: number, clientY: number) => {
    const host = svgRef.current?.parentElement;
    const rect = host?.getBoundingClientRect() ?? svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCtxMenu({
      x: Math.min(clientX - rect.left, rect.width - 180),
      y: Math.min(clientY - rect.top, rect.height - 120),
    });
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
    // 우클릭: 작도 중이면 확인/취소 메뉴
    if (e.button === 2) {
      e.preventDefault();
      if (isDrawing && !readOnly) {
        openDrawMenu(e.clientX, e.clientY);
      }
      return;
    }
    if (ctxMenu) {
      setCtxMenu(null);
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
        wallChainRef.current = [];
        return;
      }
      const id = addWall(draftStart, world);
      if (id) wallChainRef.current = [...wallChainRef.current, id];
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
        if (isDrawing) {
          menuCancel();
          return;
        }
        setDraftStart(null);
        setDraftPoly([]);
        setCtxMenu(null);
      }
      if (e.key === "Enter") {
        if (isDrawing) {
          e.preventDefault();
          // 존 미달점이면 체인만 종료
          if (tool === "zone" && draftPoly.length < 3) {
            setDraftPoly([]);
            setDraftStart(null);
            setCtxMenu(null);
            return;
          }
          menuConfirm();
          return;
        }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection && !isDrawing) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 도구 바꾸면 드래프트·메뉴 정리 (확정 없이 체인 종료만)
  useEffect(() => {
    setCtxMenu(null);
    setDraftStart(null);
    setDraftPoly([]);
    wallChainRef.current = [];
  }, [tool]);

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

  const canConfirm =
    tool === "zone" ? draftPoly.length >= 3 : tool === "wall" || tool === "line" ? !!draftStart : false;
  const canUndoLast =
    (tool === "zone" && draftPoly.length > 0) ||
    ((tool === "wall" || tool === "line") &&
      (wallChainRef.current.length > 0 || !!draftStart));

  return (
    <div className={`planDocHost ${className ?? ""}`}>
      <svg
        ref={svgRef}
        className="planDocSvg"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={endPan}
        onPointerLeave={endPan}
        onWheel={(e) => {
          if (ctxMenu) setCtxMenu(null);
          onWheel(e);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isDrawing && !readOnly) openDrawMenu(e.clientX, e.clientY);
        }}
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
        {draftStart && (tool === "wall" || tool === "line") && (
          <span>
            {formatMeters(dist(draftStart, cursor))} · {angleDeg(draftStart, cursor).toFixed(0)}°
            {" · "}
            우클릭 확인/취소
          </span>
        )}
        {tool === "zone" && draftPoly.length > 0 && (
          <span>
            실 {draftPoly.length}점 · 우클릭 확인/취소
          </span>
        )}
      </div>

      {isDrawing && !ctxMenu && (
        <div className="drawHint planDrawHint">
          {tool === "zone"
            ? `실 작도 · ${draftPoly.length}점 (최소 3점)`
            : `벽 연속 작도 · 클릭으로 이음 · 구간 ${wallChainRef.current.length}`}
          <em>우클릭 확인/취소 · Enter 완료 · Esc 취소</em>
        </div>
      )}

      {ctxMenu && isDrawing && (
        <div
          className="ctxMenu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="ctxOk"
            disabled={!canConfirm && tool === "zone"}
            onClick={menuConfirm}
          >
            <span className="ctxLabel">
              {tool === "zone" ? "실 확정" : "벽 작도 완료"}
            </span>
            <kbd>Enter</kbd>
          </button>
          <button type="button" onClick={menuCancel}>
            <span className="ctxLabel">
              {tool === "zone" ? "작도 취소" : "이번 벽 체인 취소"}
            </span>
            <kbd>Esc</kbd>
          </button>
          <div className="ctxSep" />
          <button type="button" disabled={!canUndoLast} onClick={menuUndoLast}>
            <span className="ctxLabel">
              {tool === "zone" ? "마지막 점 취소" : "마지막 구간 취소"}
            </span>
            <kbd>⌫</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
