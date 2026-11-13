/**
 * Atlas inspector drawing. The lightmap canvas stores row 0 at v=0 (the same
 * convention as the studio's UVs and the exported glTF image), so chart
 * triangles are drawn with x = u * width and y = v * height - no vertical
 * flip anywhere.
 */
import type { AppliedBake } from "./lightmap.ts";

export type Rgb = [number, number, number];

/** Stable, well-separated chart colors (golden-ratio hue steps). */
export function chartColor(index: number): Rgb {
  const hue = (index * 0.618033988749895) % 1;
  const h = hue * 6;
  const sector = Math.floor(h);
  const f = h - sector;
  const q = 1 - f;
  switch (sector % 6) {
    case 0:
      return [1, f, 0];
    case 1:
      return [q, 1, 0];
    case 2:
      return [0, 1, f];
    case 3:
      return [0, q, 1];
    case 4:
      return [f, 0, 1];
    default:
      return [1, 0, q];
  }
}

export interface AtlasDrawOptions {
  showCharts?: boolean;
}

export function drawAtlas(
  canvas: HTMLCanvasElement,
  applied: AppliedBake,
  options: AtlasDrawOptions = {}
): void {
  const lightmap = applied.textures.canvas;
  const { scene } = applied;
  canvas.width = lightmap.width;
  canvas.height = lightmap.height;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(lightmap, 0, 0);
  if (options.showCharts === false) return;

  const width = canvas.width;
  const height = canvas.height;
  const paths = new Map<number, Path2D>();
  scene.litObjects.forEach((object, objectIndex) => {
    for (let i = 0; i < object.indices.length; i += 3) {
      const a = object.indices[i]!;
      const b = object.indices[i + 1]!;
      const c = object.indices[i + 2]!;
      // Chart indices are per object, so offset by the object to keep colors
      // distinct across the shared atlas.
      const key = objectIndex * 4096 + (object.charts[a] ?? 0);
      let path = paths.get(key);
      if (!path) {
        path = new Path2D();
        paths.set(key, path);
      }
      path.moveTo(object.uvs[a * 2]! * width, object.uvs[a * 2 + 1]! * height);
      path.lineTo(object.uvs[b * 2]! * width, object.uvs[b * 2 + 1]! * height);
      path.lineTo(object.uvs[c * 2]! * width, object.uvs[c * 2 + 1]! * height);
      path.closePath();
    }
  });

  context.save();
  context.lineWidth = Math.max(1, Math.round(width / 512));
  // Fills are deliberately faint: the AO values stay readable while chart
  // boundaries still show where the unwrap placed each island.
  for (const [key, path] of paths) {
    const [r, g, b] = chartColor(key);
    context.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.12)`;
    context.strokeStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.9)`;
    context.fill(path);
    context.stroke(path);
  }
  context.restore();
}
