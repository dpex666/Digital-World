import { Character, Genetics, Vec2 } from "./types";
import { makeId } from "../util/id";
import { createName } from "../util/names";
import { Rng } from "../util/rng";

export function randomGenetics(rng: Rng): Genetics {
  return {
    metabolism: rng.range(0.8, 1.2),
    resilience: rng.range(0.7, 1.3),
    fertility: rng.range(0.7, 1.3),
    intelligence: rng.range(0.7, 1.3),
    strength: rng.range(0.7, 1.3),
  };
}

export function inheritGenetics(a: Genetics, b: Genetics, rng: Rng): Genetics {
  const mutate = () => rng.range(-0.08, 0.08);
  return {
    metabolism: (a.metabolism + b.metabolism) / 2 + mutate(),
    resilience: (a.resilience + b.resilience) / 2 + mutate(),
    fertility: (a.fertility + b.fertility) / 2 + mutate(),
    intelligence: (a.intelligence + b.intelligence) / 2 + mutate(),
    strength: (a.strength + b.strength) / 2 + mutate(),
  };
}

export function createCharacter(rng: Rng, location: Vec2, generation = 0): Character {
  const genetics = randomGenetics(rng);
  return {
    id: makeId("char"),
    name: createName(rng),
    ageDays: rng.range(16 * 365, 35 * 365),
    lifeStage: "adult",
    sex: rng.next() < 0.5 ? "female" : "male",
    genetics,
    health: 100,
    needs: { hunger: 20, thirst: 20, energy: 70, mood: 65 },
    intelligence: genetics.intelligence,
    personality: {
      sociability: rng.range(0.2, 1),
      aggression: rng.range(0, 0.8),
      curiosity: rng.range(0.2, 1),
    },
    skills: { foraging: 0.2, crafting: 0.1, building: 0.1, social: 0.2 },
    memory: [],
    relationships: [],
    location,
    inventory: {},
    role: "generalist",
    goals: [],
    fertilityCooldown: rng.range(0, 60),
    lineage: { parents: [], children: [], generation },
    alive: true,
    lastDecisionReason: "Initialized",
  };
}
