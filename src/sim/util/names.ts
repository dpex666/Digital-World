import { Rng } from "./rng";

const syllables = ["ar", "en", "li", "dor", "ta", "mi", "sol", "ka", "ven", "ri"];

export function createName(rng: Rng): string {
  const chunks = 2 + rng.int(2);
  let out = "";
  for (let i = 0; i < chunks; i += 1) {
    out += syllables[rng.int(syllables.length)];
  }
  return out[0].toUpperCase() + out.slice(1);
}
