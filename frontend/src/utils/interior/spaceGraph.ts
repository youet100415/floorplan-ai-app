/**
 * ZIP 권장 경로 호환 re-export.
 * 실제 구현: lib/plan/spaceGraph.ts (PlanDocument / 벽 페이스 / 문 인접)
 */
export {
  areaCentroid,
  buildSpaceGraph,
  extractFacesFromWalls,
  findSpacesConnectedByOpening,
  getConnectionPath,
  getOpeningWorldCenter,
  splitWallsAtJunctions,
  toggleOpeningState,
  type SpaceEdge,
  type SpaceGraph,
  type SpaceNode,
} from "@/lib/plan/spaceGraph";
