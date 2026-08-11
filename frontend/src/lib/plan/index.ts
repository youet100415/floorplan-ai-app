/** Rayon Builder 2D plan engine (ported) + floorplan-ai bridge. */

export * from "./types";
export {
  worldToScreen,
  screenToWorld,
  sub,
  add,
  mul,
  len,
  dist,
  normalize,
  normal,
  angleDeg,
  snapToGrid,
  orthoConstrain,
  rightAngleConstrain,
  softAngleConstrain,
  snapLength,
  snapToEndpoints,
  projectOnSegment,
  pickWall,
  formatMeters,
  uid,
  pointInPolygon,
  polygonCentroid,
} from "./geometry";
// geometry.polygonArea 와 extrude3d.polygonArea 충돌 방지 — extrude3d 쪽 사용 권장
export {
  signedArea,
  polygonArea,
  polygonProjectionRange,
  clipPolygonAlong,
  extrudePolygonSpec,
  type ExtrudeSolid,
} from "./extrude3d";
export * from "./openings";
export * from "./wall-join";
export * from "./bridge";
