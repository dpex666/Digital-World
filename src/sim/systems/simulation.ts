import { createCharacter, inheritGenetics } from "../core/characterFactory";
import { generateWorld } from "../core/worldGen";
import {
  Character,
  EventCategory,
  HistoryEvent,
  LifeStage,
  MetricsSnapshot,
  ResourceType,
  SimulationState,
  Vec2,
} from "../core/types";
import { makeId } from "../util/id";
import { Rng } from "../util/rng";

export interface SimulationConfig {
  width: number;
  height: number;
  initialPopulation: number;
  seed: number;
}

const NEIGHBORS: Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export class SimulationEngine {
  private rng: Rng;
  state: SimulationState;
  birthsThisTick = 0;
  deathsThisTick = 0;

  constructor(config: SimulationConfig, existingState?: SimulationState) {
    if (existingState) {
      this.state = existingState;
      this.rng = new Rng(existingState.rngSeed);
      return;
    }

    this.rng = new Rng(config.seed);
    const world = generateWorld(config.width, config.height, this.rng);
    const chars = Array.from({ length: config.initialPopulation }, () =>
      createCharacter(this.rng, { x: this.rng.int(config.width), y: this.rng.int(config.height) }),
    );

    this.state = {
      tick: 0,
      rngSeed: config.seed,
      world,
      environment: {
        day: 0,
        timeOfDay: 0,
        season: "spring",
        weather: { precipitation: 0.3, temperature: 0.5, storm: 0 },
      },
      characters: chars,
      structures: [],
      settlements: [],
      history: [],
      metrics: [],
    };
  }

  private log(category: EventCategory, message: string, actorIds?: string[]): void {
    const event: HistoryEvent = { id: makeId("evt"), tick: this.state.tick, category, message, actorIds };
    this.state.history.push(event);
    if (this.state.history.length > 5000) this.state.history.shift();
  }

  private seasonForDay(day: number): "spring" | "summer" | "autumn" | "winter" {
    const idx = Math.floor((day % 360) / 90);
    return ["spring", "summer", "autumn", "winter"][idx] as "spring" | "summer" | "autumn" | "winter";
  }

  private updateEnvironment(): void {
    const env = this.state.environment;
    env.timeOfDay = (env.timeOfDay + 1) % 24;
    if (env.timeOfDay === 0) env.day += 1;
    env.season = this.seasonForDay(env.day);
    const seasonalTemp = { spring: 0.5, summer: 0.8, autumn: 0.45, winter: 0.2 }[env.season];
    env.weather.temperature = Math.max(0, Math.min(1, seasonalTemp + this.rng.range(-0.1, 0.1)));
    env.weather.precipitation = Math.max(0, Math.min(1, 0.4 + this.rng.range(-0.2, 0.2)));
    env.weather.storm = this.rng.next() < 0.03 ? this.rng.range(0.4, 1) : 0;
    if (env.weather.storm > 0.6) {
      this.log("weather", `Storm pressure increased to ${env.weather.storm.toFixed(2)}.`);
    }
  }

  private updateResources(): void {
    const regen = this.state.environment.weather.precipitation * 0.2;
    for (const row of this.state.world.tiles) {
      for (const tile of row) {
        tile.resources.food = Math.min(30, (tile.resources.food ?? 0) + regen * tile.fertility);
        tile.resources.water = Math.min(30, (tile.resources.water ?? 0) + regen * 1.5);
        tile.resources.wood = Math.min(30, (tile.resources.wood ?? 0) + regen * (tile.terrain === "forest" ? 1 : 0.2));
      }
    }
  }

  private classifyLifeStage(ageDays: number): LifeStage {
    if (ageDays < 365 * 3) return "infant";
    if (ageDays < 365 * 15) return "child";
    if (ageDays < 365 * 55) return "adult";
    return "elder";
  }

  private move(c: Character): void {
    const options = NEIGHBORS.map((d) => ({ x: c.location.x + d.x, y: c.location.y + d.y })).filter(
      (p) => p.x >= 0 && p.y >= 0 && p.x < this.state.world.width && p.y < this.state.world.height,
    );
    const target = this.rng.pick(options);
    c.location = target;
    c.needs.energy = Math.max(0, c.needs.energy - 1);
  }

  private gather(c: Character): void {
    const tile = this.state.world.tiles[c.location.y][c.location.x];
    const pickOrder: ResourceType[] = ["food", "water", "wood", "stone"];
    for (const kind of pickOrder) {
      const available = tile.resources[kind] ?? 0;
      if (available <= 0.2) continue;
      const gatherAmount = Math.min(available, 1 + c.skills.foraging * 2);
      tile.resources[kind] = available - gatherAmount;
      c.inventory[kind] = (c.inventory[kind] ?? 0) + gatherAmount;
      c.skills.foraging = Math.min(1, c.skills.foraging + 0.002);
      c.lastDecisionReason = `Gathered ${kind} due to resource need and local abundance.`;
      this.log("resource", `${c.name} gathered ${gatherAmount.toFixed(1)} ${kind}.`, [c.id]);
      return;
    }
    c.lastDecisionReason = "No nearby resources; moved to explore.";
    this.move(c);
  }

  private consumeNeeds(c: Character): void {
    const metabolism = c.genetics.metabolism;
    c.needs.hunger = Math.min(100, c.needs.hunger + 0.6 * metabolism);
    c.needs.thirst = Math.min(100, c.needs.thirst + 0.8 * metabolism);
    c.needs.energy = Math.max(0, c.needs.energy - 0.35);

    const food = c.inventory.food ?? 0;
    const water = c.inventory.water ?? 0;

    if (c.needs.hunger > 55 && food > 0.5) {
      c.inventory.food = food - 0.5;
      c.needs.hunger = Math.max(0, c.needs.hunger - 24);
      c.needs.mood = Math.min(100, c.needs.mood + 1);
    }
    if (c.needs.thirst > 50 && water > 0.5) {
      c.inventory.water = water - 0.5;
      c.needs.thirst = Math.max(0, c.needs.thirst - 28);
      c.needs.mood = Math.min(100, c.needs.mood + 1);
    }

    if (c.needs.energy < 20) {
      c.needs.energy = Math.min(100, c.needs.energy + 3.5);
      c.lastDecisionReason = "Resting to recover energy.";
    }

    const strain = (c.needs.hunger + c.needs.thirst) / 2;
    if (strain > 70) c.health -= (strain - 70) * 0.03;
    c.health += 0.03 * c.genetics.resilience;
    c.health = Math.max(0, Math.min(100, c.health));
  }

  private maybeBuildShelter(c: Character): void {
    const wood = c.inventory.wood ?? 0;
    if (wood >= 10 && c.lifeStage === "adult" && this.rng.next() < 0.015) {
      c.inventory.wood = wood - 10;
      this.state.structures.push({
        id: makeId("structure"),
        type: "shelter",
        location: { ...c.location },
        durability: 100,
      });
      c.skills.building = Math.min(1, c.skills.building + 0.01);
      this.log("settlement", `${c.name} built a shelter.`, [c.id]);
      c.lastDecisionReason = "Built shelter as survival investment.";
    }
  }

  private findMates(female: Character): Character[] {
    if (female.sex !== "female" || female.lifeStage !== "adult" || female.fertilityCooldown > 0 || female.pregnantBy) return [];
    return this.state.characters.filter(
      (other) =>
        other.alive &&
        other.sex === "male" &&
        other.lifeStage === "adult" &&
        other.fertilityCooldown <= 0 &&
        Math.abs(other.location.x - female.location.x) <= 1 &&
        Math.abs(other.location.y - female.location.y) <= 1,
    );
  }

  private maybeReproduce(c: Character): void {
    if (c.sex !== "female") return;
    const pressure = this.state.characters.filter((a) => a.alive).length / (this.state.world.width * this.state.world.height);
    if (pressure > 0.45) return;

    const mates = this.findMates(c);
    if (!mates.length) return;
    const mate = this.rng.pick(mates);
    const baseChance = 0.004 * c.genetics.fertility * mate.genetics.fertility;
    const conditionMod = c.health > 70 && c.needs.hunger < 55 && c.needs.thirst < 55 ? 1.5 : 0.5;
    if (this.rng.next() < baseChance * conditionMod) {
      c.pregnantBy = mate.id;
      c.gestationRemaining = 36;
      c.fertilityCooldown = 150;
      mate.fertilityCooldown = 50;
      this.log("social", `${c.name} and ${mate.name} formed a reproductive bond.`, [c.id, mate.id]);
      c.lastDecisionReason = "Selected mate by proximity and fitness compatibility.";
    }
  }

  private processGestation(c: Character): void {
    if (!c.pregnantBy || c.gestationRemaining === undefined) return;
    c.gestationRemaining -= 1;
    if (c.gestationRemaining > 0) return;
    const father = this.state.characters.find((a) => a.id === c.pregnantBy);
    if (!father) {
      c.pregnantBy = undefined;
      return;
    }
    const child = createCharacter(this.rng, { ...c.location }, Math.max(c.lineage.generation, father.lineage.generation) + 1);
    child.ageDays = 0;
    child.lifeStage = "infant";
    child.genetics = inheritGenetics(c.genetics, father.genetics, this.rng);
    child.intelligence = child.genetics.intelligence;
    child.name = `${c.name.slice(0, 2)}${father.name.slice(-2)}${this.rng.int(90)}`;
    child.lineage.parents = [c.id, father.id];

    c.lineage.children.push(child.id);
    father.lineage.children.push(child.id);

    c.pregnantBy = undefined;
    c.gestationRemaining = undefined;
    this.state.characters.push(child);
    this.birthsThisTick += 1;
    this.log("birth", `${child.name} was born to ${c.name} and ${father.name}.`, [child.id, c.id, father.id]);
  }

  private updateSocial(c: Character): void {
    const nearby = this.state.characters.filter(
      (other) =>
        other.id !== c.id &&
        other.alive &&
        Math.abs(other.location.x - c.location.x) <= 1 &&
        Math.abs(other.location.y - c.location.y) <= 1,
    );
    for (const other of nearby) {
      let rel = c.relationships.find((r) => r.targetId === other.id);
      if (!rel) {
        rel = { targetId: other.id, affinity: 0, trust: 0, lastInteractionTick: this.state.tick };
        c.relationships.push(rel);
      }
      rel.affinity = Math.max(-1, Math.min(1, rel.affinity + 0.005 * (c.personality.sociability - c.personality.aggression)));
      rel.trust = Math.max(-1, Math.min(1, rel.trust + 0.004));
      rel.lastInteractionTick = this.state.tick;
    }

    if (c.relationships.length > 6) {
      c.role = "gatherer";
    } else if ((c.inventory.wood ?? 0) > 8) {
      c.role = "builder";
    } else {
      c.role = "generalist";
    }
  }

  private updateCharacter(c: Character): void {
    if (!c.alive) return;
    c.ageDays += 1 / 24;
    c.lifeStage = this.classifyLifeStage(c.ageDays);
    c.fertilityCooldown = Math.max(0, c.fertilityCooldown - 1 / 24);

    this.consumeNeeds(c);
    if (!c.alive) return;

    if (c.needs.energy < 20) {
      c.lastDecisionReason = "Low energy forced rest instinct.";
    } else if (c.needs.hunger > 60 || c.needs.thirst > 60 || (c.inventory.food ?? 0) < 1) {
      this.gather(c);
    } else if (c.role === "builder") {
      this.maybeBuildShelter(c);
      this.move(c);
    } else {
      this.move(c);
      c.lastDecisionReason = "Exploring to improve opportunity map.";
    }

    this.updateSocial(c);
    this.maybeReproduce(c);
    this.processGestation(c);

    c.memory.push({ tick: this.state.tick, summary: c.lastDecisionReason, valence: c.needs.mood / 100, tags: [c.role] });
    if (c.memory.length > 100) c.memory.shift();
    c.skills.social = Math.min(1, c.skills.social + 0.001 * c.relationships.length);

    const deathByAge = c.ageDays > 365 * 82 && this.rng.next() < 0.01;
    if (c.health <= 0 || deathByAge) {
      c.alive = false;
      this.deathsThisTick += 1;
      this.log("death", `${c.name} died${deathByAge ? " of old age" : " from systemic strain"}.`, [c.id]);
    }
  }

  private updateSettlements(): void {
    const alive = this.state.characters.filter((c) => c.alive);
    const clusters = new Map<string, Character[]>();
    for (const char of alive) {
      const key = `${Math.floor(char.location.x / 4)}:${Math.floor(char.location.y / 4)}`;
      const arr = clusters.get(key) ?? [];
      arr.push(char);
      clusters.set(key, arr);
    }

    this.state.settlements = Array.from(clusters.entries())
      .filter(([, members]) => members.length >= 4)
      .map(([key, members]) => {
        const [gx, gy] = key.split(":").map(Number);
        return {
          id: `set-${key}`,
          name: `Cluster ${gx},${gy}`,
          center: { x: gx * 4 + 2, y: gy * 4 + 2 },
          members: members.map((m) => m.id),
          structures: this.state.structures
            .filter((s) => Math.abs(s.location.x - (gx * 4 + 2)) <= 2 && Math.abs(s.location.y - (gy * 4 + 2)) <= 2)
            .map((s) => s.id),
          culture: {
            cooperation: members.reduce((sum, m) => sum + m.personality.sociability, 0) / members.length,
            tradePreference: members.reduce((sum, m) => sum + m.intelligence, 0) / members.length,
          },
        };
      });
  }

  private pushMetrics(): void {
    const alive = this.state.characters.filter((c) => c.alive);
    const foodTotal = this.state.world.tiles.flat().reduce((sum, t) => sum + (t.resources.food ?? 0), 0);
    const snapshot: MetricsSnapshot = {
      tick: this.state.tick,
      population: alive.length,
      births: this.birthsThisTick,
      deaths: this.deathsThisTick,
      foodTotal: Number(foodTotal.toFixed(1)),
      shelterCount: this.state.structures.filter((s) => s.type === "shelter").length,
    };
    this.state.metrics.push(snapshot);
    if (this.state.metrics.length > 3000) this.state.metrics.shift();
  }

  step(ticks = 1): SimulationState {
    for (let i = 0; i < ticks; i += 1) {
      this.birthsThisTick = 0;
      this.deathsThisTick = 0;
      this.state.tick += 1;
      this.updateEnvironment();
      this.updateResources();
      for (const c of this.state.characters) this.updateCharacter(c);
      this.updateSettlements();
      this.pushMetrics();
      this.state.rngSeed = this.rng.seed;
    }
    return this.state;
  }
}
