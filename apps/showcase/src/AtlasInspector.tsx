import { useEffect, useRef, useState } from "react";
import { drawAtlas } from "./lib/atlas.ts";
import type { AppliedBake } from "./lib/lightmap.ts";

export interface AtlasInspectorProps {
  applied: AppliedBake | null;
}

/**
 * Atlas tab: the baked lightmap with the unwrapped chart outlines on top, so
 * a wrong seam/atlas mapping is visible immediately rather than inferred from
 * the 3D viewport.
 */
export function AtlasInspector({ applied }: AtlasInspectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showCharts, setShowCharts] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !applied) return;
    drawAtlas(canvas, applied, { showCharts });
  }, [applied, showCharts]);

  if (!applied) {
    return (
      <div className="atlas-empty">
        Bake AO to inspect the lightmap atlas and its unwrapped charts.
      </div>
    );
  }

  const atlas = applied.scene.atlas;
  return (
    <div className="atlas-inspector">
      <div className="atlas-canvas-wrap">
        <canvas ref={canvasRef} className="atlas-canvas" />
      </div>
      <div className="atlas-meta">
        <label className="atlas-toggle">
          <input
            type="checkbox"
            checked={showCharts}
            onChange={(event) => setShowCharts(event.target.checked)}
          />
          Chart overlay
        </label>
        <span>{`Atlas ${atlas.width} x ${atlas.height}`}</span>
        <span>{`${atlas.chartCount} charts`}</span>
        <span>{`${(atlas.utilization * 100).toFixed(1)}% utilized`}</span>
        <span className="atlas-origin">UV origin: top-left (v = 0)</span>
      </div>
    </div>
  );
}
