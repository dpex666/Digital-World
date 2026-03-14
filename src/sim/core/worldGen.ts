import { Tile, WorldMap } from "./types";
import { Rng } from "../util/rng";

function createTile(rng: Rng): Tile {
  const r = rng.next();
  const terrain = r < 0.55 ? "plains" : r < 0.78 ? "forest" : r < 0.88 ? "desert" : r < 0.96 ? "mountain" : "water";
  const biome = terrain === "desert" ? "arid" : terrain === "forest" ? "boreal" : "temperate";
  const resources = {
    food: terrain === "forest" || terrain === "plains" ? rng.range(4, 12) : rng.range(0, 3),
    water: terrain === "water" ? rng.range(10, 20) : rng.range(1, 8),
    wood: terrain === "forest" ? rng.range(8, 16) : rng.range(0, 6),
    stone: terrain === "mountain" ? rng.range(8, 16) : rng.range(0, 4),
  };
  return {
    terrain,
    biome,
    resources,
    hazard: terrain === "mountain" ? 0.4 : terrain === "water" ? 0.7 : rng.range(0, 0.15),
    fertility: terrain === "plains" ? 0.8 : terrain === "forest" ? 0.6 : 0.2,
  };
}

export function generateWorld(width: number, height: number, rng: Rng): WorldMap {
  const tiles = Array.from({ length: height }, () => Array.from({ length: width }, () => createTile(rng)));
  return { width, height, tiles };
}
