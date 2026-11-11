import type { UnwrappedScene } from "../types.js";

export interface AtlasStats {
  litObjectCount: number;
  emissiveObjectCount: number;
  vertexCount: number;
  triangleCount: number;
  chartCount: number;
}

export function computeAtlasStats(scene: UnwrappedScene): AtlasStats {
  let vertexCount = 0;
  let triangleCount = 0;
  for (const object of scene.litObjects) {
    vertexCount += object.positions.length / 3;
    triangleCount += object.triangleCount;
  }
  return {
    litObjectCount: scene.litObjects.length,
    emissiveObjectCount: scene.emissiveObjects.length,
    vertexCount,
    triangleCount,
    chartCount: scene.atlas.chartCount
  };
}
