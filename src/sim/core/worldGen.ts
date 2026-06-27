import { Tile, WorldMap } from "./types";
import { Rng } from "../util/rng";

// Smooth value noise: a coarse random lattice interpolated with smoothstep, so
// values vary gradually across space instead of per-tile static.
function smoothNoise(width: number, height: number, scale: number, rng: Rng): number[][] {
  const gw = Math.ceil(width / scale) + 2;
  const gh = Math.ceil(height / scale) + 2;
  const grid: number[][] = [];
  for (let j = 0; j < gh; j += 1) {
    const row: number[] = [];
    for (let i = 0; i < gw; i += 1) row.push(rng.next());
    grid.push(row);
  }
  const out: number[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < width; x += 1) {
      const gx = x / scale;
      const gy = y / scale;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const v00 = grid[y0][x0];
      const v10 = grid[y0][x0 + 1];
      const v01 = grid[y0 + 1][x0];
      const v11 = grid[y0 + 1][x0 + 1];
      const top = v00 + (v10 - v00) * sx;
      const bot = v01 + (v11 - v01) * sx;
      row.push(top + (bot - top) * sy);
    }
    out.push(row);
  }
  return out;
}

// Sum a few octaves of noise and normalise to 0..1, giving large landmasses
// with finer detail on top.
function field(width: number, height: number, rng: Rng, octaves: [number, number][]): number[][] {
  const out = Array.from({ length: height }, () => new Array<number>(width).fill(0));
  let amp = 0;
  for (const [scale, a] of octaves) {
    const n = smoothNoise(width, height, scale, rng);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) out[y][x] += n[y][x] * a;
    amp += a;
  }
  let mn = Infinity;
  let mx = -Infinity;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      out[y][x] /= amp;
      mn = Math.min(mn, out[y][x]);
      mx = Math.max(mx, out[y][x]);
    }
  const span = mx - mn || 1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) out[y][x] = (out[y][x] - mn) / span;
  return out;
}

export function generateWorld(width: number, height: number, rng: Rng): WorldMap {
  // Two independent fields — height and moisture — drive a simple biome model,
  // so forests, lakes, deserts and mountains form contiguous regions.
  const elevation = field(width, height, rng, [
    [10, 1],
    [4, 0.4],
  ]);
  const moisture = field(width, height, rng, [
    [12, 1],
    [5, 0.45],
  ]);

  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x += 1) {
      const e = elevation[y][x];
      const mo = moisture[y][x];
      let terrain: Tile["terrain"];
      if (e > 0.82) terrain = "mountain";
      else if (e < 0.28) terrain = "water";
      else if (mo > 0.62) terrain = "forest";
      else if (mo < 0.32) terrain = "desert";
      else terrain = "plains";

      const biome: Tile["biome"] = terrain === "desert" ? "arid" : terrain === "forest" ? "boreal" : "temperate";
      const fertility =
        terrain === "plains" ? 0.7 + mo * 0.3 : terrain === "forest" ? 0.55 + mo * 0.25 : terrain === "water" ? 0.1 : terrain === "desert" ? 0.15 : 0.18;
      const resources = {
        food: terrain === "plains" || terrain === "forest" ? rng.range(5, 12) * (0.6 + mo * 0.6) : rng.range(0, 2.5),
        water: terrain === "water" ? rng.range(12, 22) : rng.range(1, 6) + mo * 4,
        wood: terrain === "forest" ? rng.range(9, 16) : terrain === "plains" ? rng.range(1, 5) : rng.range(0, 2),
        stone: terrain === "mountain" ? rng.range(9, 16) : rng.range(0, 3),
      };
      const hazard = terrain === "mountain" ? 0.35 + (e - 0.82) : terrain === "water" ? 0.6 : rng.range(0, 0.12);

      row.push({ terrain, biome, resources, hazard, fertility });
    }
    tiles.push(row);
  }
  return { width, height, tiles };
}
