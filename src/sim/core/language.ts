import { Language } from "./types";
import { Rng } from "../util/rng";

// Phoneme pools the world draws from. Each civilisation samples its own subset
// at genesis, giving it a distinctive sound. No real-world language is encoded.
const ONSET_POOL = [
  "k", "t", "p", "m", "n", "s", "r", "l", "v", "d", "th", "sh", "z", "g", "b",
  "h", "y", "w", "kr", "tr", "dr", "br", "sk", "vr", "ng",
];
const NUCLEUS_POOL = ["a", "e", "i", "o", "u", "ae", "ai", "ou", "ei", "ia", "uo"];
const CODA_POOL = ["", "", "n", "r", "s", "l", "m", "k", "th", "sh"];

function sample<T>(pool: T[], count: number, rng: Rng): T[] {
  const copy = [...pool];
  const out: T[] = [];
  for (let i = 0; i < count && copy.length; i += 1) {
    out.push(copy.splice(rng.int(copy.length), 1)[0]);
  }
  return out;
}

export function createLanguage(rng: Rng): Language {
  return {
    onsets: sample(ONSET_POOL, 7 + rng.int(7), rng),
    nuclei: sample(NUCLEUS_POOL, 4 + rng.int(3), rng),
    codas: sample(CODA_POOL, 4 + rng.int(4), rng),
    lexicon: {},
  };
}

export function makeWord(lang: Language, rng: Rng, minSyllables = 1, maxSyllables = 3): string {
  const syllables = minSyllables + rng.int(maxSyllables - minSyllables + 1);
  let out = "";
  for (let i = 0; i < syllables; i += 1) {
    out += lang.onsets[rng.int(lang.onsets.length)];
    out += lang.nuclei[rng.int(lang.nuclei.length)];
    if (rng.next() < 0.45) out += lang.codas[rng.int(lang.codas.length)];
  }
  if (!out) out = lang.onsets[0] + lang.nuclei[0];
  return out[0].toUpperCase() + out.slice(1);
}

// Coin (and remember) a word for an abstract concept. Once coined it is reused,
// so the civilisation builds a stable, growing vocabulary of its own.
export function wordFor(lang: Language, rng: Rng, concept: string): string {
  const existing = lang.lexicon[concept];
  if (existing) return existing;
  const word = makeWord(lang, rng, 1, 3);
  lang.lexicon[concept] = word;
  return word;
}

export function personName(lang: Language, rng: Rng): string {
  return makeWord(lang, rng, 2, 3);
}

// Occasional sound change: a stored word mutates, modelling language drift.
export function driftLanguage(lang: Language, rng: Rng): void {
  const keys = Object.keys(lang.lexicon);
  if (!keys.length) return;
  const key = keys[rng.int(keys.length)];
  lang.lexicon[key] = makeWord(lang, rng, 1, 3);
}
