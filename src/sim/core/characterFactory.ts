import { Action, Appearance, Character, Genetics, Sex, Vec2 } from "./types";
import { makeId } from "../util/id";
import { Rng } from "../util/rng";

const YEAR = 365;

export const ACTIONS: Action[] = ["forage", "cultivate", "hunt", "build", "craft"];

export function randomGenetics(rng: Rng): Genetics {
  return {
    metabolism: rng.range(0.8, 1.2),
    resilience: rng.range(0.7, 1.3),
    fertility: rng.range(0.8, 1.3),
    intelligence: rng.range(0.7, 1.3),
    strength: rng.range(0.7, 1.3),
  };
}

export function inheritGenetics(a: Genetics, b: Genetics, rng: Rng): Genetics {
  const mutate = () => rng.range(-0.06, 0.06);
  const clamp = (v: number) => Math.max(0.4, Math.min(2, v));
  return {
    metabolism: clamp((a.metabolism + b.metabolism) / 2 + mutate()),
    resilience: clamp((a.resilience + b.resilience) / 2 + mutate()),
    fertility: clamp((a.fertility + b.fertility) / 2 + mutate()),
    intelligence: clamp((a.intelligence + b.intelligence) / 2 + mutate()),
    strength: clamp((a.strength + b.strength) / 2 + mutate()),
  };
}

export function randomAppearance(rng: Rng): Appearance {
  return {
    hue: rng.range(0, 360),
    saturation: rng.range(0.4, 0.9),
    luminance: rng.range(0.35, 0.7),
    form: rng.range(0, 1),
    size: rng.range(0.35, 0.7),
    pattern: rng.range(0, 1),
  };
}

// The look is inherited and mutated like any other genome: offspring resemble
// their parents but drift, so the species' appearance evolves over generations.
export function inheritAppearance(a: Appearance, b: Appearance, rng: Rng): Appearance {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  // Hue blends on a circle so colour lineages shift smoothly.
  let hue = (a.hue + b.hue) / 2 + rng.range(-12, 12);
  if (Math.abs(a.hue - b.hue) > 180) hue += 180;
  hue = ((hue % 360) + 360) % 360;
  return {
    hue,
    saturation: clamp01((a.saturation + b.saturation) / 2 + rng.range(-0.06, 0.06)),
    luminance: clamp01((a.luminance + b.luminance) / 2 + rng.range(-0.06, 0.06)),
    form: clamp01((a.form + b.form) / 2 + rng.range(-0.07, 0.07)),
    size: clamp01((a.size + b.size) / 2 + rng.range(-0.06, 0.06)),
    pattern: clamp01((a.pattern + b.pattern) / 2 + rng.range(-0.08, 0.08)),
  };
}

function freshStrategy(rng: Rng): Record<Action, number> {
  const s = {} as Record<Action, number>;
  for (const a of ACTIONS) s[a] = 1 + rng.range(-0.2, 0.2);
  return s;
}

// Children inherit their parents' learned leanings (blended, with mutation):
// cultural transmission, not a blank slate each generation.
export function inheritStrategy(a: Record<Action, number>, b: Record<Action, number>, rng: Rng): Record<Action, number> {
  const s = {} as Record<Action, number>;
  for (const act of ACTIONS) {
    s[act] = Math.max(0.1, (a[act] + b[act]) / 2 + rng.range(-0.25, 0.25));
  }
  return s;
}

export function createCharacter(rng: Rng, location: Vec2, generation = 0, sex?: Sex): Character {
  const genetics = randomGenetics(rng);
  return {
    id: makeId("char"),
    name: "",
    ageDays: rng.range(16 * YEAR, 32 * YEAR),
    lifeStage: "adult",
    sex: sex ?? (rng.next() < 0.5 ? "female" : "male"),
    genetics,
    appearance: randomAppearance(rng),
    health: 100,
    needs: { hunger: 20, thirst: 20, energy: 80, mood: 70 },
    intelligence: genetics.intelligence,
    education: 0,
    personality: {
      sociability: rng.range(0.2, 1),
      aggression: rng.range(0, 0.7),
      curiosity: rng.range(0.2, 1),
    },
    skills: { forage: 0.2, cultivate: 0.1, hunt: 0.15, build: 0.1, craft: 0.1, social: 0.2 },
    strategy: freshStrategy(rng),
    lastAction: "forage",
    lastWellbeing: 60,
    rewardBaseline: 2,
    memory: [],
    relationships: [],
    location,
    inventory: {},
    fertilityCooldown: 0,
    lineage: { parents: [], children: [], generation },
    alive: true,
    lastDecisionReason: "Came into being.",
  };
}

/**
 * The genesis pair: one female, one male, healthy young adults from whom the
 * entire civilisation descends.
 */
export function createFoundingPair(rng: Rng, location: Vec2): [Character, Character] {
  const eve = createCharacter(rng, { ...location }, 0, "female");
  const adam = createCharacter(rng, { ...location }, 0, "male");
  for (const c of [eve, adam]) {
    c.ageDays = rng.range(18 * YEAR, 22 * YEAR);
    c.genetics.fertility = Math.max(c.genetics.fertility, 1.15);
    c.genetics.resilience = Math.max(c.genetics.resilience, 1.05);
    c.health = 100;
    c.personality.sociability = Math.max(c.personality.sociability, 0.6);
    c.personality.curiosity = Math.max(c.personality.curiosity, 0.5);
  }
  return [eve, adam];
}
