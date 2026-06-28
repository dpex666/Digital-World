import {
  ACTIONS,
  createCharacter,
  createFoundingPair,
  inheritAppearance,
  inheritGenetics,
  inheritStrategy,
} from "../core/characterFactory";
import { generateWorld } from "../core/worldGen";
import { createLanguage, makeWord, personName, wordFor, driftLanguage } from "../core/language";
import {
  Action,
  Belief,
  Character,
  EnvironmentState,
  EventCategory,
  Household,
  HistoryEvent,
  LifeStage,
  MetricsSnapshot,
  Milestone,
  Realm,
  ResourceType,
  Settlement,
  SimulationState,
  TechEffects,
  Technique,
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

const YEAR = 365;
const ADULT_AGE = 15 * YEAR;
const ELDER_AGE = 60 * YEAR;
const INFANT_AGE = 3 * YEAR;
const GESTATION_DAYS = 280;
const FERTILE_MIN = 16 * YEAR;
const FERTILE_MAX_FEMALE = 45 * YEAR;
const FERTILE_MAX_MALE = 62 * YEAR;

const NEIGHBORS: Vec2[] = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 },
];

function zeroEffects(): TechEffects {
  return { foodYield: 0, buildYield: 0, toolYield: 0, health: 0, fertility: 0, knowledgeRate: 0, capacity: 0 };
}

export class SimulationEngine {
  private rng: Rng;
  state: SimulationState;
  birthsThisTick = 0;
  deathsThisTick = 0;

  private byId = new Map<string, Character>();
  private spatial = new Map<string, Character[]>();
  // Per-tick indexes that collapse hot O(N×households / N×structures / N×settlements)
  // lookups to O(1), so dense worlds stay fast.
  private byHousehold = new Map<string, Household>();
  private bySettlement = new Map<string, Settlement>();
  private structureIndex = new Map<string, Set<string>>();
  private tech: TechEffects = zeroEffects(); // aggregated discovered-technique effects
  private popNow = 2; // living population at the start of the current tick

  constructor(config: SimulationConfig, existingState?: SimulationState) {
    if (existingState) {
      this.state = existingState;
      if (!this.state.links) this.state.links = []; // back-compat with older saves
      if (!this.state.beliefs) this.state.beliefs = [];
      if (!this.state.epic) {
        this.state.epic = [];
        this.state.nextPopMilestone = 50;
      }
      if (!this.state.realms) {
        this.state.realms = [];
        this.state.nextRealmNum = 1;
      }
      this.rng = new Rng(existingState.rngSeed);
      this.reindex();
      this.aggregateTech();
      return;
    }

    this.rng = new Rng(config.seed);
    const world = generateWorld(config.width, config.height, this.rng);
    const language = createLanguage(this.rng);
    // The world's own matter: four procedurally-named elements, each filling a
    // universal physical role but bearing this species' own name and colour —
    // not Earth's food, water, wood or stone.
    const elements: SimulationState["elements"] = {
      food: { name: wordFor(language, this.rng, "element-sustenance"), hue: this.rng.range(60, 140), role: "sustenance" },
      water: { name: wordFor(language, this.rng, "element-flux"), hue: this.rng.range(180, 240), role: "flux" },
      wood: { name: wordFor(language, this.rng, "element-fibre"), hue: this.rng.range(20, 50), role: "structural fibre" },
      stone: { name: wordFor(language, this.rng, "element-core"), hue: this.rng.range(0, 360), role: "dense core" },
    };
    const start = this.findCradle(world.tiles, config.width, config.height);

    const founders = createFoundingPair(this.rng, start);
    for (const c of founders) c.name = personName(language, this.rng);
    const household: Household = {
      id: makeId("home"),
      name: `${founders[0].name} ${wordFor(language, this.rng, "hearth")}`,
      memberIds: founders.map((c) => c.id),
      founderIds: founders.map((c) => c.id),
      location: { ...start },
      storage: { food: 20, water: 20, wood: 8, stone: 2 },
      toolLevel: 1,
      foundedTick: 0,
    };
    for (const c of founders) {
      c.householdId = household.id;
      c.partnerId = c.sex === "female" ? founders[1].id : founders[0].id;
    }

    const firstEpoch = { index: 0, name: wordFor(language, this.rng, "epoch-0"), sinceTick: 0, techThreshold: 0 };

    this.state = {
      tick: 0,
      rngSeed: config.seed,
      world,
      environment: {
        day: 0,
        timeOfDay: 12,
        season: "spring",
        weather: { precipitation: 0.4, temperature: 0.3, storm: 0 },
        climateEpoch: "frozen",
        warmth: 0.4,
      },
      language,
      elements,
      epoch: firstEpoch,
      epochs: [firstEpoch],
      techniques: [],
      knowledge: 0,
      nextEpochThreshold: 3,
      peakPopulation: founders.length,
      characters: [...founders],
      structures: [],
      households: [household],
      settlements: [],
      nextSettlementNum: 1,
      beliefs: [],
      realms: [],
      nextRealmNum: 1,
      links: [],
      epic: [],
      nextPopMilestone: 50,
      history: [],
      metrics: [],
    };
    // The first hearth begins with rough shelter against the cold.
    this.state.structures.push({
      id: makeId("structure"),
      type: "shelter",
      location: { ...start },
      ownerHouseholdId: household.id,
      durability: 100,
    });
    this.reindex();
    this.log(
      "birth",
      `Genesis: ${founders[0].name} and ${founders[1].name} awaken in a frozen world, the first of their kind.`,
      founders.map((c) => c.id),
    );
    this.milestone("genesis", `In the frozen dawn, ${founders[0].name} and ${founders[1].name} awaken — the first of their kind.`);
  }

  // ---------------------------------------------------------------- indexing

  private reindex(): void {
    this.byId.clear();
    for (const c of this.state.characters) this.byId.set(c.id, c);
  }

  private buildSpatial(): void {
    this.spatial.clear();
    for (const c of this.state.characters) {
      if (!c.alive) continue;
      const key = `${c.location.x}:${c.location.y}`;
      const arr = this.spatial.get(key);
      if (arr) arr.push(c);
      else this.spatial.set(key, [c]);
    }
  }

  private nearby(loc: Vec2, radius: number): Character[] {
    const out: Character[] = [];
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const arr = this.spatial.get(`${loc.x + dx}:${loc.y + dy}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  }

  private household(id?: string): Household | undefined {
    if (!id) return undefined;
    return this.byHousehold.get(id) ?? this.state.households.find((h) => h.id === id);
  }

  private settlementById(id?: string): Settlement | undefined {
    if (!id) return undefined;
    return this.bySettlement.get(id) ?? this.state.settlements.find((s) => s.id === id);
  }

  private hasStructure(homeId: string | undefined, type: string): boolean {
    if (!homeId) return false;
    const set = this.structureIndex.get(homeId);
    if (set) return set.has(type);
    return this.state.structures.some((s) => s.type === type && s.ownerHouseholdId === homeId);
  }

  private rebuildIndexes(): void {
    this.byHousehold.clear();
    for (const h of this.state.households) this.byHousehold.set(h.id, h);
    this.bySettlement.clear();
    for (const s of this.state.settlements) this.bySettlement.set(s.id, s);
    this.structureIndex.clear();
    for (const st of this.state.structures) {
      if (!st.ownerHouseholdId) continue;
      let set = this.structureIndex.get(st.ownerHouseholdId);
      if (!set) {
        set = new Set();
        this.structureIndex.set(st.ownerHouseholdId, set);
      }
      set.add(st.type);
    }
  }

  private findCradle(tiles: SimulationState["world"]["tiles"], width: number, height: number): Vec2 {
    let best: Vec2 = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    let bestScore = -Infinity;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const t = tiles[y][x];
        if (t.terrain === "water" || t.terrain === "mountain") continue;
        const score = (t.resources.food ?? 0) + (t.resources.water ?? 0) * 0.5 + (t.resources.wood ?? 0) * 0.3 + t.fertility * 6 - t.hazard * 8;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best;
  }

  private log(category: EventCategory, message: string, actorIds?: string[]): void {
    const event: HistoryEvent = { id: makeId("evt"), tick: this.state.tick, category, message, actorIds };
    this.state.history.push(event);
    if (this.state.history.length > 5000) this.state.history.shift();
  }

  // Record a turning point in the world's epic. Append-only and preserved from
  // genesis (unlike the high-churn chronicle), so the whole arc reads as a story.
  private milestone(kind: Milestone["kind"], message: string): void {
    this.state.epic.push({ tick: this.state.tick, year: Math.floor(this.state.environment.day / YEAR), kind, message });
    if (this.state.epic.length > 600) this.state.epic.shift();
  }

  // ------------------------------------------------------------- environment

  private seasonForDay(day: number): EnvironmentState["season"] {
    const idx = Math.floor((day % YEAR) / 90);
    return (["spring", "summer", "autumn", "winter"] as const)[idx];
  }

  private updateEnvironment(): void {
    const env = this.state.environment;
    env.day += 1;
    env.season = this.seasonForDay(env.day);
    env.warmth = Math.max(0.3, Math.min(0.92, env.warmth + 0.000018 + this.rng.range(-0.0003, 0.0003)));
    // Hysteresis: only step the climate epoch when warmth moves decisively past
    // a boundary, so it doesn't flip-flop every tick around a threshold.
    const order = ["frozen", "thawing", "temperate", "warm"] as const;
    const bounds = [0.42, 0.6, 0.78];
    const margin = 0.035;
    const idx = order.indexOf(env.climateEpoch);
    let next = env.climateEpoch;
    if (idx < 3 && env.warmth > bounds[idx] + margin) next = order[idx + 1];
    else if (idx > 0 && env.warmth < bounds[idx - 1] - margin) next = order[idx - 1];
    if (next !== env.climateEpoch) {
      env.climateEpoch = next;
      this.log("weather", `The long climate turns ${next}.`);
    }

    const seasonalTemp = { spring: 0.5, summer: 0.85, autumn: 0.45, winter: 0.18 }[env.season];
    env.weather.temperature = Math.max(0, Math.min(1, seasonalTemp * (0.6 + 0.6 * env.warmth) + this.rng.range(-0.08, 0.08)));
    env.weather.precipitation = Math.max(0, Math.min(1, 0.4 + this.rng.range(-0.2, 0.2)));
    env.weather.storm = this.rng.next() < 0.02 ? this.rng.range(0.4, 1) : 0;
  }

  private updateResources(): void {
    const env = this.state.environment;
    const regen = env.weather.precipitation * 0.6 * (0.45 + 0.75 * env.warmth);
    const cultivated = new Set(this.state.structures.filter((s) => s.type === "cultivation").map((s) => `${s.location.x}:${s.location.y}`));
    for (let y = 0; y < this.state.world.height; y += 1) {
      for (let x = 0; x < this.state.world.width; x += 1) {
        const tile = this.state.world.tiles[y][x];
        const farmed = cultivated.has(`${x}:${y}`) ? 2.2 : 1;
        const foodCap = tile.terrain === "forest" || tile.terrain === "plains" ? 30 : 8;
        tile.resources.food = Math.min(foodCap, (tile.resources.food ?? 0) + regen * tile.fertility * farmed);
        tile.resources.water = Math.min(40, (tile.resources.water ?? 0) + regen * 1.6);
        tile.resources.wood = Math.min(30, (tile.resources.wood ?? 0) + regen * (tile.terrain === "forest" ? 1 : 0.25));
      }
    }
  }

  private classifyLifeStage(ageDays: number): LifeStage {
    if (ageDays < INFANT_AGE) return "infant";
    if (ageDays < ADULT_AGE) return "child";
    if (ageDays < ELDER_AGE) return "adult";
    return "elder";
  }

  // ---------------------------------------------------- self-learning action

  private settlementKnowledge(c: Character): number {
    if (!c.settlementId) return 0;
    return this.settlementById(c.settlementId)?.knowledge ?? 0;
  }

  // Physical feasibility / bodily capability only — no strategic hints. Whether
  // an action is *worth* doing is for the being to discover through reward.
  private feasibility(c: Character, action: Action, home?: Household, tile?: SimulationState["world"]["tiles"][0][0]): number {
    switch (action) {
      case "cultivate":
        return 1; // working the ground is always physically possible
      case "hunt":
        return 0.5 + c.genetics.strength * 0.6; // bodily capability
      case "build": {
        const wood = (home?.storage.wood ?? 0) + (tile?.resources.wood ?? 0);
        return wood > 3 ? 1 : 0.3; // need material to build with
      }
      case "craft":
        return 0.6;
      default:
        return 1; // forage
    }
  }

  // Innate drives a real organism *feels* — these add urgency that can override
  // learned habit under stress (you will seek warmth when freezing). A felt
  // state, not knowledge of one's possessions.
  private drive(c: Character, action: Action): number {
    if (action === "build") {
      const env = this.state.environment;
      const sheltered = this.hasStructure(c.householdId, "shelter");
      const coldFelt = (1 - env.warmth) * (env.season === "winter" ? 1.3 : 0.8) * (sheltered ? 0.1 : 1);
      return coldFelt * 2;
    }
    return 0;
  }

  // Collapse the agent's weighted possibilities into a single chosen action —
  // probabilistic, not a fixed rule. Learned strategy biases the draw; novelty
  // (curiosity) keeps exploration alive.
  private chooseAction(c: Character, tile: SimulationState["world"]["tiles"][0][0], home?: Household): Action {
    const epsilon = 0.03 + 0.07 * c.personality.curiosity;
    if (this.rng.next() < epsilon) return ACTIONS[this.rng.int(ACTIONS.length)];
    const weights = ACTIONS.map((a) => {
      const skill = (c.skills as unknown as Record<string, number>)[a] ?? 0.2;
      // Learned propensity × competence × physical feasibility, plus any innate
      // drive pushing in additively (so a drive can win even with low habit).
      return Math.pow(Math.max(0.05, c.strategy[a]), 1.5) * (0.6 + skill) * this.feasibility(c, a, home, tile) + this.drive(c, a);
    });
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = this.rng.next() * total;
    for (let i = 0; i < ACTIONS.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) return ACTIONS[i];
    }
    return ACTIONS[0];
  }

  private skillEdu(c: Character, skill: number): number {
    return 0.4 + skill + 0.4 * c.education;
  }

  /** Perform the chosen action; returns the resource value produced (for learning reward). */
  private act(c: Character): number {
    if (c.lifeStage === "infant") return 0;
    const home = this.household(c.householdId);
    if (!home) return 0;
    const tile = this.state.world.tiles[c.location.y][c.location.x];
    const effort = c.lifeStage === "child" ? 0.4 : c.lifeStage === "elder" ? 0.55 : 0.75 + 0.4 * (c.needs.energy / 100);
    const warmth = 0.5 + 0.7 * this.state.environment.warmth;
    const foodMult = 1 + this.tech.foodYield + 0.25 * this.settlementKnowledge(c);
    const action = this.chooseAction(c, tile, home);
    c.lastAction = action;
    const sk = c.skills as unknown as Record<string, number>;
    const add = (kind: ResourceType, amount: number) => {
      home.storage[kind] = (home.storage[kind] ?? 0) + Math.max(0, amount);
    };
    let produced = 0;

    switch (action) {
      case "cultivate": {
        const y = 1.4 * tile.fertility * this.skillEdu(c, sk.cultivate) * warmth * foodMult * home.toolLevel * effort;
        add("food", y);
        produced = y;
        sk.cultivate = Math.min(1, sk.cultivate + 0.0016);
        c.lastDecisionReason = "Coaxed food from worked ground.";
        break;
      }
      case "hunt": {
        const hit = this.rng.next() < 0.5 + 0.1 * c.genetics.strength;
        const y = hit ? c.genetics.strength * 2.2 * this.skillEdu(c, sk.hunt) * foodMult * effort : 0;
        add("food", y);
        produced = y;
        sk.hunt = Math.min(1, sk.hunt + 0.0014);
        c.lastDecisionReason = hit ? "Brought home a kill." : "The hunt came up empty.";
        break;
      }
      case "build": {
        const wood = Math.min(tile.resources.wood ?? 0, 1.6 * this.skillEdu(c, sk.build) * (1 + this.tech.buildYield) * effort);
        tile.resources.wood = (tile.resources.wood ?? 0) - wood;
        add("wood", wood);
        produced = wood * 0.6;
        sk.build = Math.min(1, sk.build + 0.0016);
        c.lastDecisionReason = "Gathered timber to build.";
        break;
      }
      case "craft": {
        const stone = Math.min(tile.resources.stone ?? 0, 0.9 * effort);
        tile.resources.stone = (tile.resources.stone ?? 0) - stone;
        add("stone", stone);
        produced = stone * 0.5;
        if ((home.storage.wood ?? 0) > 2 && this.rng.next() < 0.05 * (1 + c.intelligence + this.tech.toolYield)) {
          home.storage.wood = (home.storage.wood ?? 0) - 2;
          home.toolLevel = Math.min(4, home.toolLevel + 0.05 * (1 + this.tech.toolYield));
          produced += 1.5;
          c.lastDecisionReason = "Crafted finer tools.";
        } else {
          c.lastDecisionReason = "Shaped raw materials.";
        }
        sk.craft = Math.min(1, sk.craft + 0.0018);
        break;
      }
      default: {
        const food = Math.min(tile.resources.food ?? 0, 1.6 * this.skillEdu(c, sk.forage) * warmth * foodMult * effort);
        const water = Math.min(tile.resources.water ?? 0, 1.8 * effort);
        const wood = Math.min(tile.resources.wood ?? 0, 0.5 * effort);
        tile.resources.food = (tile.resources.food ?? 0) - food;
        tile.resources.water = (tile.resources.water ?? 0) - water;
        tile.resources.wood = (tile.resources.wood ?? 0) - wood;
        add("food", food);
        add("water", water);
        add("wood", wood);
        produced = food + water * 0.5;
        sk.forage = Math.min(1, sk.forage + 0.0014);
        c.lastDecisionReason = "Foraged the surrounding land.";
      }
    }
    c.needs.energy = Math.max(0, c.needs.energy - 6);
    return produced;
  }

  private wellbeing(c: Character): number {
    return c.health * 0.5 + (100 - c.needs.hunger) * 0.3 + (100 - c.needs.thirst) * 0.2 + c.needs.mood * 0.1;
  }

  // Reinforcement with competition: nudge the propensity for whatever was just
  // done toward the wellbeing it produced, then renormalise the whole vector to
  // a fixed mean. Because the propensities must share a budget, reinforcing one
  // action suppresses the rest — so beings *specialise* by body and context
  // (the strong drift to hunting, those on fertile land to cultivation) rather
  // than everyone maxing out everything.
  private learn(c: Character, produced: number): void {
    const after = this.wellbeing(c);
    const reward = produced * 1.5 + (after - c.lastWellbeing) * 0.2;
    // Advantage learning: reinforce only by how much this action beat the
    // being's *own running average*. Better-than-usual choices rise, worse fall
    // — so it can't push everything to the ceiling, and beings differentiate by
    // body and surroundings into genuine trades.
    const advantage = reward - c.rewardBaseline;
    const lr = 0.03 * (0.5 + c.personality.curiosity);
    c.strategy[c.lastAction] += lr * Math.max(-3, Math.min(3, advantage));
    c.rewardBaseline += 0.05 * (reward - c.rewardBaseline);
    // Light pull toward the being's mean keeps a mix alive (no trade dies out).
    const mean = ACTIONS.reduce((s, a) => s + c.strategy[a], 0) / ACTIONS.length;
    for (const a of ACTIONS) {
      c.strategy[a] += 0.015 * (mean - c.strategy[a]);
      c.strategy[a] = Math.max(0.1, Math.min(4, c.strategy[a]));
    }
    c.lastWellbeing = after;
  }

  // ------------------------------------------------------------- consumption

  private consume(c: Character): void {
    const m = c.genetics.metabolism;
    c.needs.hunger = Math.min(100, c.needs.hunger + 15 * m);
    c.needs.thirst = Math.min(100, c.needs.thirst + 17 * m);
    c.needs.energy = Math.min(100, c.needs.energy + 10);

    const home = this.household(c.householdId);
    const ration = c.lifeStage === "adult" || c.lifeStage === "elder" ? 1 : c.lifeStage === "child" ? 0.65 : 0.4;

    let ate = false;
    if (home && (home.storage.food ?? 0) >= ration) {
      home.storage.food = (home.storage.food ?? 0) - ration;
      c.needs.hunger = Math.max(0, c.needs.hunger - 55);
      ate = true;
    }
    const env = this.state.environment;
    const tile = this.state.world.tiles[c.location.y][c.location.x];
    if (home && (home.storage.water ?? 0) >= ration) {
      home.storage.water = (home.storage.water ?? 0) - ration;
      c.needs.thirst = Math.max(0, c.needs.thirst - 55);
    } else if ((tile.resources.water ?? 0) > 1 || env.weather.precipitation > 0.35) {
      c.needs.thirst = Math.max(0, c.needs.thirst - 45);
    }

    c.needs.mood = Math.max(0, Math.min(100, c.needs.mood + (ate ? 1 : -2)));

    const sheltered = this.hasStructure(c.householdId, "shelter");
    const coldStress = (1 - env.warmth) * (env.season === "winter" ? 1.4 : 0.8) * (sheltered ? 0.2 : 1);
    const starvation = Math.max(0, c.needs.hunger - 70) * 0.06 + Math.max(0, c.needs.thirst - 70) * 0.06;
    c.health -= starvation + coldStress * 0.45;
    if (c.needs.hunger < 50 && c.needs.thirst < 50) {
      c.health += (0.5 + this.tech.health * 0.5) * c.genetics.resilience + (sheltered ? 0.4 : 0);
    }
    c.health = Math.max(0, Math.min(100, c.health));
  }

  // --------------------------------------------------------------- building

  private tryBuild(home: Household): void {
    const builder = home.memberIds
      .map((id) => this.byId.get(id))
      .find((c) => c && c.alive && c.lastAction === "build" && c.lifeStage !== "infant");
    if (!builder) return;
    const wood = home.storage.wood ?? 0;
    const stone = home.storage.stone ?? 0;
    const has = (t: string) => this.hasStructure(home.id, t);

    if (!has("shelter") && wood >= 8) {
      home.storage.wood = wood - 8;
      this.addStructure(home, "shelter");
      this.log("settlement", `${builder!.name}'s household raised a shelter.`, [builder!.id]);
    } else if (has("shelter") && !has("storage") && wood >= 10) {
      home.storage.wood = wood - 10;
      this.addStructure(home, "storage");
    } else if (this.tech.foodYield > 0.15 && !has("cultivation") && wood >= 6 && stone >= 2) {
      home.storage.wood = wood - 6;
      home.storage.stone = stone - 2;
      this.addStructure(home, "cultivation");
      this.log("settlement", `${builder!.name}'s household broke new ground for cultivation.`, [builder!.id]);
    } else if (this.tech.toolYield > 0.2 && !has("workshop") && wood >= 8 && stone >= 6) {
      home.storage.wood = wood - 8;
      home.storage.stone = stone - 6;
      this.addStructure(home, "workshop");
      home.toolLevel = Math.min(4, home.toolLevel + 0.3);
    }
  }

  private addStructure(home: Household, type: "shelter" | "storage" | "cultivation" | "workshop"): void {
    this.state.structures.push({
      id: makeId("structure"),
      type,
      location: { ...home.location },
      ownerHouseholdId: home.id,
      settlementId: home.settlementId,
      durability: 100,
    });
  }

  // ---------------------------------------------------------------- social

  private socialize(c: Character): void {
    const peers = this.nearby(c.location, 1).filter((o) => o.id !== c.id);
    let exemplar: Character | undefined;
    for (const other of peers.slice(0, 8)) {
      let rel = c.relationships.find((r) => r.targetId === other.id);
      if (!rel) {
        rel = { targetId: other.id, affinity: 0, trust: 0, lastInteractionTick: this.state.tick };
        c.relationships.push(rel);
      }
      rel.affinity = Math.max(-1, Math.min(1, rel.affinity + 0.01 * (c.personality.sociability - 0.5 * c.personality.aggression)));
      rel.trust = Math.max(-1, Math.min(1, rel.trust + 0.006));
      rel.lastInteractionTick = this.state.tick;
      if (!exemplar || this.wellbeing(other) + other.lineage.children.length * 5 > this.wellbeing(exemplar) + exemplar.lineage.children.length * 5) {
        exemplar = other;
      }
    }
    if (c.relationships.length > 24) c.relationships.shift();
    c.skills.social = Math.min(1, c.skills.social + 0.0008 * Math.min(8, c.relationships.length));

    // Social learning: imitate the most flourishing neighbour's leanings.
    if (exemplar && this.rng.next() < 0.03 * (0.5 + c.personality.curiosity)) {
      for (const a of ACTIONS) c.strategy[a] += 0.05 * (exemplar.strategy[a] - c.strategy[a]);
    }
  }

  // -------------------------------------------------------- pairing & homes

  private seekPartner(c: Character): void {
    if (c.partnerId || c.lifeStage !== "adult" || c.ageDays < FERTILE_MIN) return;
    const candidates = this.nearby(c.location, 3).filter(
      (o) =>
        o.id !== c.id && o.alive && !o.partnerId && o.lifeStage === "adult" && o.sex !== c.sex && o.ageDays >= FERTILE_MIN &&
        // Only the parent–child line is forbidden. A civilisation seeded from a
        // single pair must allow sibling/cousin unions at its origin to survive.
        !o.lineage.parents.includes(c.id) && !c.lineage.parents.includes(o.id),
    );
    if (!candidates.length) return;
    let best: Character | undefined;
    let bestScore = -Infinity;
    for (const o of candidates) {
      // Pairing follows *felt* affinity built through shared interaction — a
      // being cannot read another's fertility or health genes, so it doesn't.
      const rel = c.relationships.find((r) => r.targetId === o.id);
      const score = (rel?.affinity ?? 0) * 2 + this.rng.range(0, 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (!best) return;
    if (this.rng.next() > 0.12 + (c.relationships.find((r) => r.targetId === best!.id)?.affinity ?? 0) * 0.3) return;

    c.partnerId = best.id;
    best.partnerId = c.id;
    const female = c.sex === "female" ? c : best;
    // Dispersal: a new couple strikes out to settle their own patch of land
    // rather than piling onto their parents' tile, so the people spread across
    // the world and grow into many settlements instead of one heap.
    const site = this.findDispersalSite(c.location);
    const home: Household = {
      id: makeId("home"),
      name: `${female.name} ${wordFor(this.state.language, this.rng, "hearth")}`,
      memberIds: [c.id, best.id],
      founderIds: [c.id, best.id],
      location: site,
      storage: { food: 3, water: 3, wood: 1, stone: 0 },
      toolLevel: 1,
      foundedTick: this.state.tick,
    };
    for (const partner of [c, best]) {
      const old = this.household(partner.householdId);
      if (old) old.memberIds = old.memberIds.filter((id) => id !== partner.id);
      partner.householdId = home.id;
      partner.location = { ...site };
    }
    this.state.households.push(home);
    this.log("social", `${c.name} and ${best.name} bonded and set out to settle new ground.`, [c.id, best.id]);
  }

  // Pick a habitable tile a few steps away to found a new household on, so the
  // population fans out from the cradle over generations. A new couple seeks
  // fertile *open* land in whatever direction it lies — drawn to good ground and
  // away from crowding — rather than blindly pushing toward a fixed bearing. This
  // keeps the people spreading across the whole world instead of heaping into one
  // corner.
  private findDispersalSite(from: Vec2): Vec2 {
    const w = this.state.world.width;
    const h = this.state.world.height;
    let fallback: Vec2 = { ...from };
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const ang = this.rng.range(0, Math.PI * 2);
      const dist = 3 + this.rng.int(9);
      const nx = Math.round(from.x + Math.cos(ang) * dist);
      const ny = Math.round(from.y + Math.sin(ang) * dist);
      if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
      const t = this.state.world.tiles[ny][nx];
      if (t.terrain === "water" || t.terrain === "mountain") continue;
      fallback = { x: nx, y: ny };
      const crowd = Math.min(8, this.nearby({ x: nx, y: ny }, 2).length);
      const score = t.fertility * 5 + (t.resources.food ?? 0) - t.hazard * 3 - crowd * 0.8;
      if (score > bestScore) {
        bestScore = score;
        best = { x: nx, y: ny };
      }
    }
    return best ?? fallback;
  }

  // ------------------------------------------------------------ reproduction

  private reproduce(c: Character): void {
    if (c.sex !== "female" || c.lifeStage !== "adult") return;
    if (c.ageDays < FERTILE_MIN || c.ageDays > FERTILE_MAX_FEMALE) return;
    if (c.fertilityCooldown > 0 || c.pregnantBy || !c.partnerId) return;
    const mate = this.byId.get(c.partnerId);
    if (!mate || !mate.alive || mate.ageDays > FERTILE_MAX_MALE) return;

    const home = this.household(c.householdId);
    const members = home ? home.memberIds.length : 1;
    const foodPerMember = home ? (home.storage.food ?? 0) / Math.max(1, members) : 0;
    const security = Math.max(0.15, Math.min(1.6, foodPerMember / 3));
    const warmthFert = 0.5 + 0.6 * this.state.environment.warmth;
    const healthMult = (c.health / 100) * (mate.health / 100);
    const capacity = this.state.world.width * this.state.world.height * (0.18 + 0.06 * this.tech.capacity);
    const densityBrake = Math.max(0.08, 1 - this.popNow / capacity);
    // Founder boom: a tiny population breeds fast (r-selection), then growth
    // self-throttles as numbers approach the land's carrying capacity.
    const earlyBoom = 1 + 7 * Math.max(0, 1 - this.popNow / 90);
    // A faith that prizes fertility quickens its followers' families.
    const st = c.settlementId ? this.settlementById(c.settlementId) : undefined;
    const faith = st?.beliefId ? this.beliefById(st.beliefId) : undefined;
    const faithFert = faith ? 1 + faith.tenets.fertility * 0.3 * st!.devotion : 1;

    const chance = 0.03 * c.genetics.fertility * mate.genetics.fertility * security * warmthFert * healthMult *
      densityBrake * earlyBoom * (1 + this.tech.fertility) * faithFert;
    if (this.rng.next() < chance) {
      c.pregnantBy = mate.id;
      c.gestationRemaining = GESTATION_DAYS;
      c.lastDecisionReason = "Conceived a child.";
    }
  }

  private processGestation(c: Character): void {
    if (!c.pregnantBy || c.gestationRemaining === undefined) return;
    c.gestationRemaining -= 1;
    if (c.gestationRemaining > 0) return;
    const father = this.byId.get(c.pregnantBy);
    const home = this.household(c.householdId);
    c.pregnantBy = undefined;
    c.gestationRemaining = undefined;
    c.fertilityCooldown = this.rng.range(220, 420);
    if (!father) return;

    const child = createCharacter(this.rng, { ...c.location }, Math.max(c.lineage.generation, father.lineage.generation) + 1);
    child.ageDays = 0;
    child.lifeStage = "infant";
    child.genetics = inheritGenetics(c.genetics, father.genetics, this.rng);
    child.appearance = inheritAppearance(c.appearance, father.appearance, this.rng);
    // Gentle directional pressure from the climate: colder worlds nudge the
    // lineage's look one way, warmer worlds another — adaptation you can see.
    const climatePush = (0.5 - this.state.environment.warmth) * 0.04;
    child.appearance.luminance = Math.max(0, Math.min(1, child.appearance.luminance + climatePush));
    child.appearance.hue = ((child.appearance.hue + climatePush * 60) % 360 + 360) % 360;
    child.intelligence = child.genetics.intelligence;
    child.strategy = inheritStrategy(c.strategy, father.strategy, this.rng);
    child.name = personName(this.state.language, this.rng);
    child.lineage.parents = [c.id, father.id];
    child.skills.forage = Math.min(0.5, (c.skills.forage + father.skills.forage) * 0.2);
    child.skills.cultivate = Math.min(0.5, (c.skills.cultivate + father.skills.cultivate) * 0.2);
    child.householdId = c.householdId;
    child.settlementId = c.settlementId;
    if (home) home.memberIds.push(child.id);

    c.lineage.children.push(child.id);
    father.lineage.children.push(child.id);
    this.state.characters.push(child);
    this.byId.set(child.id, child);
    this.birthsThisTick += 1;
    this.log("birth", `${child.name} was born to ${c.name} and ${father.name}.`, [child.id, c.id, father.id]);
  }

  // ----------------------------------------------------------- mortality

  private mortality(c: Character): void {
    // The two genesis progenitors are shielded from death until their colony
    // takes hold — without this, a single unlucky tick ends the whole species
    // before it can begin. Once the population establishes, they are mortal.
    if (c.lineage.generation === 0 && this.popNow < 20) {
      c.health = Math.max(c.health, 25);
      return;
    }
    const ageYears = c.ageDays / YEAR;
    const tile = this.state.world.tiles[c.location.y][c.location.x];
    const medicine = 1 / (1 + this.tech.health);
    let cause: string | null = null;

    if (c.health <= 0) {
      cause = c.needs.hunger > 70 ? "starvation" : c.needs.thirst > 70 ? "thirst" : "exposure";
    } else {
      // Founder bootstrap: while the population is still a fragile handful,
      // random death is suppressed so the line has a chance to take hold. As
      // numbers grow past the bottleneck, full mortality phases in.
      const shield = Math.min(1, this.popNow / 15);
      const pAge = 3e-8 * Math.exp(0.107 * ageYears) * medicine * shield;
      const pAccident = (0.00003 + tile.hazard * 0.0005 + this.state.environment.weather.storm * 0.0004) * medicine * shield;
      const home = this.household(c.householdId);
      const hungryHome = home && (home.storage.food ?? 0) < 1;
      const pInfant = c.lifeStage === "infant" ? (hungryHome ? 0.0025 : 0.0004) * medicine * shield : 0;
      const roll = this.rng.next();
      if (roll < pAge) cause = "old age";
      else if (roll < pAge + pAccident) cause = "an accident";
      else if (roll < pAge + pAccident + pInfant) cause = "childhood frailty";
    }
    if (cause) this.kill(c, cause);
  }

  private kill(c: Character, cause: string): void {
    c.alive = false;
    this.deathsThisTick += 1;
    if (c.partnerId) {
      const partner = this.byId.get(c.partnerId);
      if (partner) partner.partnerId = undefined;
    }
    const home = this.household(c.householdId);
    if (home) home.memberIds = home.memberIds.filter((id) => id !== c.id);
    this.log("death", `${c.name} died of ${cause} at age ${Math.floor(c.ageDays / YEAR)}.`, [c.id]);
  }

  // ----------------------------------------------------------- migration

  private maybeMigrate(home: Household): void {
    const occupant = home.memberIds.map((id) => this.byId.get(id)).find((c) => c?.alive && c.lifeStage !== "infant");
    if (!occupant) return;
    if (home.migrateBias === undefined) home.migrateBias = 0.12;
    const tile = this.state.world.tiles[home.location.y][home.location.x];
    const local = (tile.resources.food ?? 0) + (home.storage.food ?? 0);
    const settled = this.hasStructure(home.id, "cultivation");

    // Frontier pull: a crowded home with little spare land nearby feels the urge
    // to strike out for open country far away. Whether a lineage acts on that
    // urge is its learned wanderlust — pioneers breed pioneers, homebodies stay.
    const crowd = this.nearby(home.location, 3).length;
    if (!settled && crowd >= 9 && local < 6 && this.rng.next() < home.migrateBias * 0.5) {
      this.pioneer(home);
      return;
    }

    if (local > 2.5 || settled) return;
    // Learned wanderlust: the propensity to move on is reinforced when moving
    // finds better land and decays when it doesn't, so lineages that benefit
    // from roaming keep roaming and those that don't settle down.
    if (this.rng.next() > home.migrateBias) return;

    const hereScore = (tile.resources.food ?? 0) + tile.fertility * 4;
    let best: Vec2 | null = null;
    let bestScore = hereScore;
    for (const d of NEIGHBORS) {
      const nx = home.location.x + d.x;
      const ny = home.location.y + d.y;
      if (nx < 0 || ny < 0 || nx >= this.state.world.width || ny >= this.state.world.height) continue;
      const nt = this.state.world.tiles[ny][nx];
      if (nt.terrain === "water") continue;
      const score = (nt.resources.food ?? 0) + nt.fertility * 4 - nt.hazard * 3;
      if (score > bestScore) {
        bestScore = score;
        best = { x: nx, y: ny };
      }
    }
    // Reinforce: a worthwhile move strengthens wanderlust; a wasted urge to move
    // (no better land found) weakens it.
    home.migrateBias = best
      ? Math.min(0.6, home.migrateBias + 0.05 * Math.min(1, (bestScore - hereScore) / 4))
      : Math.max(0.03, home.migrateBias - 0.03);
    if (best) {
      home.location = best;
      for (const id of home.memberIds) {
        const mm = this.byId.get(id);
        if (mm && mm.alive) mm.location = { ...best };
      }
    }
  }

  // A great journey: a pioneer family leaves the crowd behind and travels far to
  // settle open, fertile country — the seed of a new frontier settlement. The
  // reach of the journey grows with the lineage's learned wanderlust.
  private pioneer(home: Household): void {
    const w = this.state.world.width;
    const h = this.state.world.height;
    const reach = Math.round(7 + (home.migrateBias ?? 0.12) * 16);
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 26; i += 1) {
      const ang = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(reach * 0.5, reach);
      const nx = Math.round(home.location.x + Math.cos(ang) * dist);
      const ny = Math.round(home.location.y + Math.sin(ang) * dist);
      if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
      const t = this.state.world.tiles[ny][nx];
      if (t.terrain === "water" || t.terrain === "mountain") continue;
      // Prefer fertile, low-hazard, *open* land — the appeal of empty frontier.
      const openness = 8 - Math.min(8, this.nearby({ x: nx, y: ny }, 3).length);
      const score = t.fertility * 5 + (t.resources.food ?? 0) - t.hazard * 4 + openness * 1.4;
      if (score > bestScore) {
        bestScore = score;
        best = { x: nx, y: ny };
      }
    }
    const hereFert = this.state.world.tiles[home.location.y][home.location.x].fertility * 5;
    if (best && bestScore > hereFert) {
      home.location = best;
      for (const id of home.memberIds) {
        const mm = this.byId.get(id);
        if (mm && mm.alive) mm.location = { ...best };
      }
      home.migrateBias = Math.min(0.7, (home.migrateBias ?? 0.12) + 0.04);
    } else {
      home.migrateBias = Math.max(0.03, (home.migrateBias ?? 0.12) - 0.02);
    }
  }

  // ----------------------------------------------- inter-settlement relations

  private settlementHomes(s: Settlement): Household[] {
    return s.householdIds
      .map((id) => this.state.households.find((h) => h.id === id))
      .filter((h): h is Household => !!h);
  }

  private settlementFood(s: Settlement): number {
    return this.settlementHomes(s).reduce((t, h) => t + (h.storage.food ?? 0), 0);
  }

  private settlementFoodPer(s: Settlement): number {
    return this.settlementFood(s) / Math.max(1, s.memberIds.length);
  }

  // Fighting strength: adults count fully, the young and old far less.
  private settlementForce(s: Settlement): number {
    return s.memberIds.reduce((t, id) => {
      const m = this.byId.get(id);
      if (!m || !m.alive) return t;
      const adult = m.lifeStage === "adult" || m.lifeStage === "elder";
      return t + m.genetics.strength * (adult ? 1 : 0.25);
    }, 0);
  }

  private moveFood(from: Settlement, to: Settlement, amount: number): number {
    const fromH = this.settlementHomes(from);
    const total = this.settlementFood(from);
    if (total <= 0 || amount <= 0) return 0;
    const frac = Math.min(1, amount / total);
    let moved = 0;
    for (const h of fromH) {
      const take = (h.storage.food ?? 0) * frac;
      h.storage.food = (h.storage.food ?? 0) - take;
      moved += take;
    }
    const toH = this.settlementHomes(to);
    if (toH.length) {
      const each = moved / toH.length;
      for (const h of toH) h.storage.food = (h.storage.food ?? 0) + each;
    }
    return moved;
  }

  private settlementWellbeing(s: Settlement): number {
    return this.settlementFoodPer(s) + 0.15 * s.memberIds.length;
  }

  private ensurePolicy(s: Settlement): void {
    if (!s.policy) {
      s.policy = { raid: 1, trade: 1, abstain: 1.4 }; // begin disposed to peace, then learn
      s.lastMacroAction = "abstain";
      s.macroBaseline = 0;
      s.lastWellbeing = this.settlementWellbeing(s);
    }
  }

  private nearestSettlement(s: Settlement): Settlement | undefined {
    let best: Settlement | undefined;
    let bestD = 21;
    for (const o of this.state.settlements) {
      if (o === s || o.memberIds.length < 2) continue;
      const d = Math.abs(o.center.x - s.center.x) + Math.abs(o.center.y - s.center.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  // Choose how to treat a neighbour by sampling the learned policy, weighted by
  // what is actually feasible (strength for a raid, surplus for a trade) and by
  // faith kinship as a disposition — but the *propensity* to war or trade is
  // learned, not coded.
  private chooseMacro(s: Settlement, n: Settlement): "raid" | "trade" | "abstain" {
    const p = s.policy!;
    const force = this.settlementForce(s) / (this.settlementForce(n) + 1);
    const sameFaith = !!s.beliefId && s.beliefId === n.beliefId;
    const raidFeas = Math.max(0.04, Math.min(2, force - 0.6)) * (sameFaith ? 0.35 : 1);
    const sPer = this.settlementFoodPer(s);
    const nPer = this.settlementFoodPer(n);
    const tradeFeas = sPer > nPer ? Math.min(1.4, (sPer - nPer) / 3 + 0.2) : 0.15;
    const feas = { raid: raidFeas, trade: tradeFeas, abstain: 0.6 };
    const acts = ["raid", "trade", "abstain"] as const;
    const weights = acts.map((a) => Math.pow(Math.max(0.05, p[a]), 1.5) * feas[a]);
    const total = weights.reduce((t, w) => t + w, 0);
    let roll = this.rng.next() * total;
    for (let i = 0; i < acts.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) return acts[i];
    }
    return "abstain";
  }

  private reinforceMacro(s: Settlement): void {
    const w = this.settlementWellbeing(s);
    const reward = w - (s.lastWellbeing ?? w);
    const adv = reward - (s.macroBaseline ?? 0);
    const lr = 0.06;
    const act = s.lastMacroAction ?? "abstain";
    s.policy![act] = Math.max(0.1, Math.min(5, s.policy![act] + lr * Math.max(-3, Math.min(3, adv))));
    s.macroBaseline = (s.macroBaseline ?? 0) + 0.05 * (reward - (s.macroBaseline ?? 0));
    // light regularisation so no strategy dies out entirely
    const mean = (s.policy!.raid + s.policy!.trade + s.policy!.abstain) / 3;
    for (const a of ["raid", "trade", "abstain"] as const) s.policy![a] += 0.02 * (mean - s.policy![a]);
    s.lastWellbeing = w;
  }

  // Each settlement, now and then, reflects on how it has fared and chooses how
  // to treat its nearest neighbour — its diplomacy emerges from reinforcement,
  // not from a hand-tuned probability of war.
  private interSettlement(): void {
    const food = this.state.elements.food.name;
    for (const s of this.state.settlements) {
      if (s.memberIds.length < 3) continue;
      this.ensurePolicy(s);
      if (this.rng.next() > 0.03) continue; // occasional macro-move
      this.reinforceMacro(s); // judge the last choice's outcome, then decide anew
      const n = this.nearestSettlement(s);
      if (!n) {
        s.lastMacroAction = "abstain";
        continue;
      }
      const action = this.chooseMacro(s, n);
      s.lastMacroAction = action;
      if (action === "raid") {
        const rivalFaith = !!s.beliefId && !!n.beliefId && s.beliefId !== n.beliefId;
        this.raid(s, n, food, rivalFaith);
      } else if (action === "trade") {
        this.tradeBetween(s, n, food);
      }
    }
  }

  private tradeBetween(a: Settlement, b: Settlement, food: string): void {
    const aPer = this.settlementFoodPer(a);
    const bPer = this.settlementFoodPer(b);
    const [rich, poor] = aPer >= bPer ? [a, b] : [b, a];
    const gap = Math.abs(aPer - bPer);
    const amount = this.moveFood(rich, poor, gap * 0.4 * poor.memberIds.length + 1);
    if (amount <= 0.5) return;
    rich.knowledge = Math.min(8, rich.knowledge + 0.02);
    poor.knowledge = Math.min(8, poor.knowledge + 0.03);
    rich.culture.cooperation = Math.min(1, rich.culture.cooperation + 0.02);
    poor.culture.cooperation = Math.min(1, poor.culture.cooperation + 0.02);
    this.state.links.push({ from: { ...rich.center }, to: { ...poor.center }, kind: "trade", tick: this.state.tick });
    // Conversion flows from the devout and prospering to the doubting: the
    // poorer partner's openness is the inverse of its own (fortune-driven)
    // devotion, so the gods of the successful spread to those whose faith has
    // faltered.
    if (rich.beliefId && rich.beliefId !== poor.beliefId && this.rng.next() < 0.06 * rich.devotion * (1 - poor.devotion)) {
      const faith = this.beliefById(rich.beliefId);
      poor.beliefId = rich.beliefId;
      poor.devotion = 0.25;
      this.log("belief", `${poor.name} embraced the faith of ${faith?.name ?? "their neighbours"} through trade with ${rich.name}.`);
    }
    if (this.rng.next() < 0.25) this.log("trade", `${rich.name} sent a caravan of ${amount.toFixed(0)} ${food} to ${poor.name}.`);
  }

  private raid(a: Settlement, b: Settlement, food: string, holy = false): void {
    const [agg, vic] = this.settlementForce(a) >= this.settlementForce(b) ? [a, b] : [b, a];
    const loot = this.moveFood(vic, agg, this.settlementFood(vic) * 0.22);
    let killed = 0;
    for (const id of vic.memberIds) {
      const m = this.byId.get(id);
      if (!m || !m.alive) continue;
      if (this.rng.next() < 0.06) {
        m.health -= this.rng.range(4, 12);
        if (m.health <= 0) {
          this.kill(m, `a raid by ${agg.name}`);
          killed += 1;
        }
      }
    }
    // War is costly to the aggressor too — so raiding only pays against a
    // genuinely weaker foe, and learned diplomacy must weigh that.
    for (const id of agg.memberIds) {
      const m = this.byId.get(id);
      if (m && m.alive && this.rng.next() < 0.08) {
        m.health -= this.rng.range(3, 13);
        if (m.health <= 0) this.kill(m, `the war on ${vic.name}`);
      }
    }
    vic.culture.aggression = Math.min(1, vic.culture.aggression + 0.06); // vengeance hardens them
    agg.culture.cooperation = Math.max(0, agg.culture.cooperation - 0.03);
    vic.devotion = Math.max(0, vic.devotion - 0.04); // defeat shakes the loser's faith
    this.state.links.push({ from: { ...agg.center }, to: { ...vic.center }, kind: "raid", tick: this.state.tick });
    const verb = holy ? "waged holy war on" : "raided";
    this.log(
      "conflict",
      `${agg.name} ${verb} ${vic.name}, seizing ${loot.toFixed(0)} ${food}${killed ? ` and leaving ${killed} dead` : ""}.`,
    );
    if (holy && !this.state.epic.some((e) => e.kind === "war")) {
      this.milestone("war", `The first holy war erupts: ${agg.name} falls upon ${vic.name}.`);
    }

    // Conquest: an overwhelming victor in a war of faith may annex the loser —
    // forcing its conversion, so the realm-grouping absorbs it next tick. Borders
    // shift, and empires rise on the ruins of the conquered.
    if (
      agg.beliefId &&
      agg.beliefId !== vic.beliefId &&
      this.settlementForce(agg) > this.settlementForce(vic) * 1.6 &&
      vic.memberIds.length >= 2 &&
      this.rng.next() < 0.07
    ) {
      const faith = this.beliefById(agg.beliefId);
      vic.beliefId = agg.beliefId;
      vic.devotion = 0.2;
      vic.culture.aggression = Math.max(0, vic.culture.aggression - 0.1);
      this.log("conflict", `${agg.name} conquered ${vic.name}, annexing it under the faith of ${faith?.name ?? "the victors"}.`);
      this.milestone("war", `${agg.name} conquers ${vic.name}.`);
    }
  }

  // -------------------------------------------------------------- beliefs

  private beliefById(id?: string): Belief | undefined {
    if (!id) return undefined;
    return this.state.beliefs.find((b) => b.id === id);
  }

  // A being's standing — the lived success that earns it a hearing. Prophets,
  // leaders and exemplars emerge from this, not from a flat dice roll.
  private standing(c: Character): number {
    const home = this.household(c.householdId);
    const fed = home && (home.storage.food ?? 0) > home.memberIds.length ? 0.6 : 0;
    return (
      Math.min(2, c.ageDays / YEAR / 35) +
      c.lineage.children.length * 0.25 +
      Math.min(1, c.relationships.length * 0.05) +
      c.intelligence * 0.5 +
      c.education * 0.6 +
      c.personality.curiosity * 0.4 +
      fed
    );
  }

  private foundBelief(s: Settlement, founder?: Character): void {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const p = founder?.personality;
    // A faith reflects the soul of its prophet: the sociable preach community,
    // the aggressive a militant creed, the curious an inquisitive one.
    const tenets = p
      ? {
          cooperation: clamp((p.sociability - 0.5) * 2 + this.rng.range(-0.3, 0.3)),
          aggression: clamp((p.aggression - 0.35) * 2.5 + this.rng.range(-0.3, 0.3)),
          innovation: clamp((p.curiosity - 0.5) * 2 + this.rng.range(-0.3, 0.3)),
          fertility: Math.max(0, this.rng.range(-0.4, 1)),
        }
      : {
          cooperation: this.rng.range(-1, 1),
          aggression: this.rng.range(-1, 1),
          innovation: this.rng.range(-1, 1),
          fertility: Math.max(0, this.rng.range(-1, 1)),
        };
    const belief: Belief = {
      id: makeId("faith"),
      name: wordFor(this.state.language, this.rng, `faith-${this.state.beliefs.length}`),
      hue: this.rng.range(0, 360),
      foundedTick: this.state.tick,
      founderId: founder?.id,
      tenets,
    };
    this.state.beliefs.push(belief);
    s.beliefId = belief.id;
    s.devotion = 0.3;
    this.log(
      "belief",
      `${founder ? founder.name : "The elders"} of ${s.name} founded the faith of ${belief.name}.`,
      founder ? [founder.id] : undefined,
    );
    this.milestone("faith", `${founder ? founder.name : "The elders"} of ${s.name} founded the faith of ${belief.name}.`);
  }

  // Disease: crowded settlements may suffer outbreaks that kill and spread to
  // neighbours, eased as the people discover medicine (their health techs).
  private updatePlagues(): void {
    const medicine = 1 / (1 + this.tech.health); // <1, shrinks as health tech grows
    for (const s of this.state.settlements) {
      const members = s.memberIds.map((id) => this.byId.get(id)).filter((m): m is Character => !!m && m.alive);
      const intensity = s.plague ?? 0;
      if (intensity > 0) {
        let dead = 0;
        for (const m of members) {
          if (this.rng.next() < 0.02 * intensity * (1 - m.genetics.resilience * 0.4) * medicine) {
            this.kill(m, "the plague");
            dead += 1;
          }
        }
        s.culture.cooperation = Math.max(0, s.culture.cooperation - 0.01);
        s.plague = Math.max(0, intensity - this.rng.range(0.03, 0.07));
        if (s.plague === 0 && dead >= 0) this.log("death", `The plague in ${s.name} has burned out.`);
        // spread to nearby settlements
        for (const o of this.state.settlements) {
          if (o === s || (o.plague ?? 0) > 0 || o.memberIds.length < 2) continue;
          const d = Math.abs(o.center.x - s.center.x) + Math.abs(o.center.y - s.center.y);
          if (d <= 12 && this.rng.next() < 0.015 * intensity) {
            o.plague = intensity * 0.85;
            this.log("death", `The plague spread from ${s.name} to ${o.name}.`);
          }
        }
      } else if (members.length >= 8) {
        // spontaneous outbreak, likelier when crowded and short on medicine
        if (this.rng.next() < 0.00009 * (members.length / 12) * medicine) {
          s.plague = this.rng.range(0.6, 1);
          this.log("death", `A plague broke out in ${s.name}.`);
          if (!this.state.epic.some((e) => e.kind === "plague")) {
            this.milestone("plague", `A great plague sweeps ${s.name}.`);
          }
        }
      }
    }
  }

  // Faiths are born from charismatic minds, deepen with devotion, and reshape
  // the culture of those who hold them.
  private updateBeliefs(): void {
    for (const s of this.state.settlements) {
      if (s.beliefId) {
        const b = this.beliefById(s.beliefId);
        if (!b) {
          s.beliefId = undefined;
          continue;
        }
        // Faith is adaptive to lived fortune: devotion deepens when the people
        // prosper under it, and erodes through famine and plague — a crisis of
        // faith. Belief is reinforced (or refuted) by outcomes, not assumed.
        const fed = this.settlementFoodPer(s) > 3;
        const plagued = (s.plague ?? 0) > 0;
        s.devotion = Math.max(0, Math.min(1, s.devotion + (fed && !plagued ? 0.0015 : -0.0014)));
        if (s.devotion <= 0.03) {
          // The faith has failed them; the people abandon it.
          this.log("belief", `${s.name} loses its faith in ${b.name}.`);
          s.beliefId = undefined;
          s.devotion = 0;
          continue;
        }
        const d = 0.012 * s.devotion;
        s.culture.cooperation = Math.max(0, Math.min(1, s.culture.cooperation + b.tenets.cooperation * d));
        s.culture.aggression = Math.max(0, Math.min(1, s.culture.aggression + b.tenets.aggression * d));
        s.culture.innovation = Math.max(0, Math.min(1, s.culture.innovation + b.tenets.innovation * d));
      } else if (s.memberIds.length >= 4) {
        // A prophet is not appointed — it emerges. Whoever in the settlement has
        // earned the most standing through their lived success is the one whose
        // vision can take root and spread to others.
        let prophet: Character | undefined;
        let bestStanding = 0;
        for (const id of s.memberIds) {
          const m = this.byId.get(id);
          if (!m || !m.alive || (m.lifeStage !== "adult" && m.lifeStage !== "elder")) continue;
          const st = this.standing(m);
          if (st > bestStanding) {
            bestStanding = st;
            prophet = m;
          }
        }
        // The more a prophet's curiosity drives them, the likelier the spark.
        const spark = prophet ? bestStanding * (0.4 + prophet.personality.curiosity) : 0;
        if (prophet && this.rng.next() < 0.00045 * spark) this.foundBelief(s, prophet);
      }
    }
    // Keep the registry bounded; forgotten faiths fade from the record.
    if (this.state.beliefs.length > 40) {
      const active = new Set(this.state.settlements.map((s) => s.beliefId).filter((x): x is string => !!x));
      this.state.beliefs = this.state.beliefs.filter((b) => active.has(b.id)).slice(-30);
    }
  }

  // Group settlements bound by a shared faith and proximity into persistent
  // realms (peoples/nations), matched to last tick's realms by overlap so a
  // nation keeps its identity as it grows or fragments.
  private updateRealms(): void {
    const sets = this.state.settlements;
    const prev = new Map<string, string>();
    for (const rl of this.state.realms) for (const sid of rl.settlementIds) prev.set(sid, rl.id);

    const R = 12;
    const visited = new Set<string>();
    const components: Settlement[][] = [];
    for (const s of sets) {
      if (visited.has(s.id)) continue;
      const comp: Settlement[] = [];
      const queue = [s];
      visited.add(s.id);
      while (queue.length) {
        const cur = queue.pop()!;
        comp.push(cur);
        for (const o of sets) {
          if (visited.has(o.id)) continue;
          const same = (cur.beliefId ?? "none") === (o.beliefId ?? "none");
          const d = Math.abs(cur.center.x - o.center.x) + Math.abs(cur.center.y - o.center.y);
          if (same && d <= R) {
            visited.add(o.id);
            queue.push(o);
          }
        }
      }
      components.push(comp);
    }

    const claimed = new Set<string>();
    const survivors: Realm[] = [];
    for (const comp of components) {
      const tally = new Map<string, number>();
      for (const s of comp) {
        const pid = prev.get(s.id);
        if (pid) tally.set(pid, (tally.get(pid) ?? 0) + 1);
      }
      let bestId: string | undefined;
      let best = 0;
      for (const [rid, n] of tally) if (n > best && !claimed.has(rid)) {
        best = n;
        bestId = rid;
      }
      let realm = bestId ? this.state.realms.find((r) => r.id === bestId) : undefined;
      if (!realm) {
        const num = this.state.nextRealmNum++;
        realm = {
          id: `realm-${num}`,
          name: makeWord(this.state.language, this.rng, 2, 3),
          hue: this.rng.range(0, 360),
          settlementIds: [],
          foundedTick: this.state.tick,
          populationPeak: 0,
        };
        this.state.realms.push(realm);
      }
      claimed.add(realm.id);
      const prevSize = realm.settlementIds.length;
      realm.settlementIds = comp.map((s) => s.id);
      realm.beliefId = comp.find((s) => s.beliefId)?.beliefId;
      realm.capitalId = comp.slice().sort((a, b) => b.memberIds.length - a.memberIds.length)[0]?.id;
      const pop = comp.reduce((t, s) => t + s.memberIds.length, 0);
      realm.populationPeak = Math.max(realm.populationPeak, pop);
      if (prevSize < 2 && comp.length >= 2 && !this.state.epic.some((e) => e.message.startsWith(`The realm of ${realm!.name}`))) {
        this.milestone("settlement", `The realm of ${realm.name} unites ${comp.length} settlements.`);
      }
      if (prevSize < 4 && comp.length >= 4 && !this.state.epic.some((e) => e.message.startsWith(`The empire of ${realm!.name}`))) {
        this.milestone("settlement", `The empire of ${realm.name} spans ${comp.length} settlements.`);
      }
      survivors.push(realm);
    }
    this.state.realms = survivors;
  }

  // ----------------------------------------------------------- settlements

  private updateSettlements(): void {
    const homes = this.state.households.filter((h) => h.memberIds.some((id) => this.byId.get(id)?.alive));
    for (const s of this.state.settlements) {
      s.householdIds = [];
      s.memberIds = [];
    }
    for (const h of homes) {
      let nearestId: string | undefined;
      let nearestDist = Infinity;
      for (const s of this.state.settlements) {
        const d = Math.abs(s.center.x - h.location.x) + Math.abs(s.center.y - h.location.y);
        if (d <= 3 && d < nearestDist) {
          nearestDist = d;
          nearestId = s.id;
        }
      }
      if (nearestId) {
        const host = this.state.settlements.find((x) => x.id === nearestId)!;
        host.householdIds.push(h.id);
        h.settlementId = nearestId;
        // A family living under a faith comes to carry it, so it travels with
        // them if they later set out to found a colony of their own.
        if (host.beliefId) h.beliefId = host.beliefId;
      } else {
        h.settlementId = undefined;
      }
    }

    const unassigned = homes.filter((h) => !h.settlementId);
    const buckets = new Map<string, Household[]>();
    for (const h of unassigned) {
      const key = `${Math.floor(h.location.x / 4)}:${Math.floor(h.location.y / 4)}`;
      const arr = buckets.get(key) ?? [];
      arr.push(h);
      buckets.set(key, arr);
    }
    for (const [, group] of buckets) {
      // Two neighbouring families anchor a settlement anywhere; a lone pioneer
      // family founds a frontier outpost only when it has struck out far from any
      // existing settlement onto genuinely good ground — so leaps become villages
      // without every wandering household spawning one next door.
      if (group.length < 2) {
        const h0 = group[0];
        const t0 = this.state.world.tiles[h0.location.y][h0.location.x];
        const farFromAll = this.state.settlements.every(
          (s) => Math.abs(s.center.x - h0.location.x) + Math.abs(s.center.y - h0.location.y) >= 8,
        );
        if (!(farFromAll && t0.fertility > 0.45 && h0.memberIds.length >= 2)) continue;
      }
      const cx = Math.round(group.reduce((s, h) => s + h.location.x, 0) / group.length);
      const cy = Math.round(group.reduce((s, h) => s + h.location.y, 0) / group.length);
      const num = this.state.nextSettlementNum++;
      // A colony inherits the faith its founding families carried with them (the
      // most common one), so a people's religion spreads with its frontier and
      // realms grow into multi-settlement nations rather than splintering.
      const faithTally = new Map<string, number>();
      for (const h of group) if (h.beliefId && this.beliefById(h.beliefId)) faithTally.set(h.beliefId, (faithTally.get(h.beliefId) ?? 0) + 1);
      const carried = [...faithTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const settlement: Settlement = {
        id: `set-${num}`,
        name: makeWord(this.state.language, this.rng, 2, 3),
        center: { x: cx, y: cy },
        memberIds: [],
        householdIds: group.map((h) => h.id),
        structures: [],
        knowledge: 0.05,
        foundedTick: this.state.tick,
        populationPeak: 0,
        beliefId: carried,
        devotion: carried ? 0.35 : 0,
        plague: 0,
        policy: { raid: 1, trade: 1, abstain: 1.4 },
        lastMacroAction: "abstain",
        macroBaseline: 0,
        lastWellbeing: 0,
        culture: { cooperation: 0.4, tradePreference: 0.3, aggression: 0.2, innovation: 0.3 },
      };
      for (const h of group) h.settlementId = settlement.id;
      this.state.settlements.push(settlement);
      this.log("settlement", `A settlement, ${settlement.name}, took root.`);
      if (!this.state.epic.some((e) => e.kind === "settlement")) {
        this.milestone("settlement", `${settlement.name} is founded — the people's first settlement.`);
      }
    }

    const survivors: Settlement[] = [];
    for (const s of this.state.settlements) {
      const groupHomes = s.householdIds.map((id) => this.state.households.find((h) => h.id === id)).filter(Boolean) as Household[];
      const members = groupHomes.flatMap((h) => h.memberIds).map((id) => this.byId.get(id)).filter((c): c is Character => !!c && c.alive);
      if (!members.length) {
        this.log("settlement", `${s.name} was abandoned and faded into memory.`);
        continue;
      }
      s.memberIds = members.map((m) => m.id);
      s.center = {
        x: Math.round(groupHomes.reduce((sum, h) => sum + h.location.x, 0) / groupHomes.length),
        y: Math.round(groupHomes.reduce((sum, h) => sum + h.location.y, 0) / groupHomes.length),
      };
      s.structures = this.state.structures
        .filter((st) => Math.abs(st.location.x - s.center.x) <= 3 && Math.abs(st.location.y - s.center.y) <= 3)
        .map((st) => st.id);
      s.populationPeak = Math.max(s.populationPeak, members.length);

      // Leadership emerges from the same lived standing that raises prophets:
      // whoever has earned the most influence holds sway, weighted also by their
      // social pull. An incumbent keeps a small edge, so authority is stable and
      // only passes when a clearly worthier figure rises — succession, not churn.
      const adults = members.filter((m) => m.lifeStage === "adult" || m.lifeStage === "elder");
      const prevLeaderId = s.leaderId;
      let leader: Character | undefined;
      let bestSway = -1;
      for (const m of adults) {
        const sway = this.standing(m) * (0.6 + m.skills.social) * (m.id === s.leaderId ? 1.15 : 1);
        if (sway > bestSway) {
          bestSway = sway;
          leader = m;
        }
      }
      s.leaderId = leader?.id;
      // A peaceful transfer of authority is a moment worth recording — but only
      // once the settlement is established, and not the very first appointment.
      if (leader && prevLeaderId && prevLeaderId !== leader.id && members.length >= 5) {
        const prev = this.byId.get(prevLeaderId);
        if (prev && prev.alive) {
          this.log("social", `${leader.name} rose to lead ${s.name}, succeeding ${prev.name}.`, [leader.id]);
        } else if (!prev || !prev.alive) {
          this.log("social", `${leader.name} took up the mantle of leadership in ${s.name}.`, [leader.id]);
        }
      }
      const avg = (f: (m: Character) => number) => members.reduce((sum, m) => sum + f(m), 0) / members.length;
      s.culture.cooperation = Math.max(0, Math.min(1, s.culture.cooperation * 0.99 + (avg((m) => m.personality.sociability) + members.length / 40) * 0.01));
      s.culture.aggression = Math.max(0, Math.min(1, s.culture.aggression * 0.99 + avg((m) => m.personality.aggression) * 0.01));
      s.culture.innovation = Math.max(0, Math.min(1, s.culture.innovation * 0.99 + avg((m) => m.intelligence * m.personality.curiosity) * 0.01));
      s.culture.tradePreference = Math.max(0, Math.min(1, s.culture.tradePreference * 0.995 + (members.length > 8 ? 0.004 : -0.002)));

      const adultMinds = adults.reduce((sum, m) => sum + m.intelligence * (0.5 + m.education), 0);
      s.knowledge = Math.min(8, s.knowledge + 0.00006 * adultMinds * (1 + s.culture.innovation));
      survivors.push(s);
    }
    this.state.settlements = survivors;

    for (const s of this.state.settlements) {
      for (const id of s.memberIds) {
        const m = this.byId.get(id);
        if (m && (m.lifeStage === "infant" || m.lifeStage === "child")) {
          m.education = Math.min(1, m.education + 0.0004 * (1 + s.knowledge));
        }
      }
      this.redistribute(s);
    }
  }

  private redistribute(s: Settlement): void {
    const homes = s.householdIds.map((id) => this.state.households.find((h) => h.id === id)).filter(Boolean) as Household[];
    if (homes.length < 2) return;
    const share = s.culture.cooperation;
    const perMember = (h: Household) => (h.storage.food ?? 0) / Math.max(1, h.memberIds.length);
    homes.sort((a, b) => perMember(b) - perMember(a));
    const richest = homes[0];
    const poorest = homes[homes.length - 1];
    const gap = perMember(richest) - perMember(poorest);
    if (gap > 2 && (richest.storage.food ?? 0) > 4) {
      const transfer = gap * share * 0.5;
      richest.storage.food = (richest.storage.food ?? 0) - transfer;
      poorest.storage.food = (poorest.storage.food ?? 0) + transfer;
      if (this.rng.next() < 0.005) this.log("settlement", `${s.name} shared food across its households.`);
    }
  }

  // ------------------------------------------------- emergent tech & epochs

  private aggregateTech(): void {
    const acc = zeroEffects();
    for (const t of this.state.techniques) {
      acc.foodYield += t.effects.foodYield;
      acc.buildYield += t.effects.buildYield;
      acc.toolYield += t.effects.toolYield;
      acc.health += t.effects.health;
      acc.fertility += t.effects.fertility;
      acc.knowledgeRate += t.effects.knowledgeRate;
      acc.capacity += t.effects.capacity;
    }
    // Diminishing returns: technology helps, but never trivialises the world.
    // Each axis saturates toward a ceiling so survival stays a real problem.
    const sat = (v: number, ceil: number) => ceil * (1 - Math.exp(-v / ceil));
    this.tech = {
      foodYield: sat(acc.foodYield, 2.2),
      buildYield: sat(acc.buildYield, 2),
      toolYield: sat(acc.toolYield, 2.2),
      health: sat(acc.health, 2.5),
      fertility: sat(acc.fertility, 1.2),
      knowledgeRate: sat(acc.knowledgeRate, 1.5),
      capacity: sat(acc.capacity, 4),
    };
  }

  private randomTechEffects(tier: number): TechEffects {
    const e = zeroEffects();
    const dims: (keyof TechEffects)[] = ["foodYield", "buildYield", "toolYield", "health", "fertility", "knowledgeRate", "capacity"];
    const count = 1 + this.rng.int(2);
    const scale = 0.08 + tier * 0.02;
    for (let i = 0; i < count; i += 1) {
      const dim = dims[this.rng.int(dims.length)];
      e[dim] += this.rng.range(0.04, 0.04 + scale);
    }
    return e;
  }

  private advanceResearch(): void {
    const alive = this.state.characters.filter((c) => c.alive);
    const minds = alive.reduce((sum, c) => sum + c.intelligence * (0.4 + c.education) * (0.5 + c.personality.curiosity), 0);
    const bestInnovation = this.state.settlements.reduce((m, s) => Math.max(m, s.culture.innovation), 0.2);
    this.state.knowledge += 0.0006 * minds * (1 + bestInnovation) * (1 + this.tech.knowledgeRate);

    // A discovery happens once enough collective knowledge has built up. Cost
    // rises exponentially, so each new way of doing things is harder-won than
    // the last — inventions stay rare and meaningful rather than runaway.
    const techCount = this.state.techniques.length;
    const cost = 14 * Math.pow(1.42, techCount);
    if (this.state.knowledge >= cost && minds > 0) {
      const tier = Math.floor(techCount / 4);
      const discoverer = alive
        .filter((c) => c.lifeStage === "adult" || c.lifeStage === "elder")
        .sort((a, b) => b.intelligence * (0.5 + b.education) - a.intelligence * (0.5 + a.education))[0];
      const tech: Technique = {
        id: makeId("tech"),
        name: wordFor(this.state.language, this.rng, `tech-${techCount}`),
        tier,
        effects: this.randomTechEffects(tier),
        prerequisites: this.state.techniques.slice(-2).map((t) => t.id),
        discoveredTick: this.state.tick,
        discovererId: discoverer?.id,
      };
      this.state.techniques.push(tech);
      this.aggregateTech();
      this.log(
        "discovery",
        `${discoverer ? discoverer.name : "Someone"} conceived of "${tech.name}" — a new way of doing things.`,
        discoverer ? [discoverer.id] : undefined,
      );

      if (this.state.techniques.length >= this.state.nextEpochThreshold) {
        const index = this.state.epoch.index + 1;
        const epoch = {
          index,
          name: wordFor(this.state.language, this.rng, `epoch-${index}`),
          sinceTick: this.state.tick,
          techThreshold: this.state.techniques.length,
        };
        this.state.epoch = epoch;
        this.state.epochs.push(epoch);
        this.state.nextEpochThreshold = Math.ceil(this.state.nextEpochThreshold * 1.9) + 2;
        this.log("epoch", `The people name a new age: "${epoch.name}".`);
        this.milestone("epoch", `The age of ${epoch.name} begins.`);
      }
    }

    if (this.rng.next() < 0.002) driftLanguage(this.state.language, this.rng);
  }

  // -------------------------------------------------------------- metrics

  private pushMetrics(): void {
    const alive = this.state.characters.filter((c) => c.alive);
    this.state.peakPopulation = Math.max(this.state.peakPopulation, alive.length);
    if (alive.length >= this.state.nextPopMilestone) {
      this.milestone("growth", `The people grow to ${this.state.nextPopMilestone} souls.`);
      this.state.nextPopMilestone = this.state.nextPopMilestone < 200 ? this.state.nextPopMilestone + 50 : Math.round(this.state.nextPopMilestone * 1.5);
    }
    const foodTotal = this.state.world.tiles.flat().reduce((sum, t) => sum + (t.resources.food ?? 0), 0);
    const avgAgeYears = alive.length ? alive.reduce((sum, c) => sum + c.ageDays / YEAR, 0) / alive.length : 0;
    const maxGeneration = alive.reduce((m, c) => Math.max(m, c.lineage.generation), 0);
    const avgIntelligence = alive.length ? alive.reduce((sum, c) => sum + c.genetics.intelligence, 0) / alive.length : 0;

    this.state.metrics.push({
      tick: this.state.tick,
      year: Math.floor(this.state.environment.day / YEAR),
      population: alive.length,
      births: this.birthsThisTick,
      deaths: this.deathsThisTick,
      foodTotal: Number(foodTotal.toFixed(1)),
      shelterCount: this.state.structures.filter((s) => s.type === "shelter").length,
      households: this.state.households.filter((h) => h.memberIds.some((id) => this.byId.get(id)?.alive)).length,
      settlements: this.state.settlements.length,
      avgAgeYears: Number(avgAgeYears.toFixed(1)),
      maxGeneration,
      avgIntelligence: Number(avgIntelligence.toFixed(3)),
      knowledge: Number(this.state.knowledge.toFixed(1)),
      techCount: this.state.techniques.length,
      epochIndex: this.state.epoch.index,
      warmth: Number(this.state.environment.warmth.toFixed(2)),
    });
    if (this.state.metrics.length > 3000) this.state.metrics.shift();
  }

  private prune(): void {
    if (this.state.characters.length > 1500) {
      this.state.characters = this.state.characters.filter((c) => c.alive || c.lineage.children.length > 0);
      this.reindex();
    }
    this.state.households = this.state.households.filter((h) => h.memberIds.some((id) => this.byId.get(id)?.alive));
  }

  // ------------------------------------------------------------------ step

  private updateLifecycle(c: Character): void {
    if (!c.alive) return;
    c.ageDays += 1;
    c.lifeStage = this.classifyLifeStage(c.ageDays);
    c.fertilityCooldown = Math.max(0, c.fertilityCooldown - 1);
  }

  step(ticks = 1): SimulationState {
    for (let i = 0; i < ticks; i += 1) {
      this.birthsThisTick = 0;
      this.deathsThisTick = 0;
      this.state.tick += 1;

      this.updateEnvironment();
      this.updateResources();
      this.buildSpatial();
      this.rebuildIndexes();

      const snapshot = this.state.characters.filter((c) => c.alive);
      this.popNow = snapshot.length;
      const produced = new Map<string, number>();
      for (const c of snapshot) this.updateLifecycle(c);
      for (const c of snapshot) {
        c.lastWellbeing = this.wellbeing(c);
        produced.set(c.id, this.act(c));
      }
      for (const home of this.state.households) this.tryBuild(home);
      // Stores are finite — surplus beyond what a household (and its storehouse)
      // can keep spoils. This bounds hoarding and keeps scarcity, trade and raid
      // stakes real.
      for (const home of this.state.households) {
        const members = home.memberIds.filter((id) => this.byId.get(id)?.alive).length;
        const cap = 40 + members * 30 + (this.hasStructure(home.id, "storage") ? 150 : 0);
        if ((home.storage.food ?? 0) > cap) home.storage.food = cap;
        if ((home.storage.water ?? 0) > cap) home.storage.water = cap;
        if ((home.storage.wood ?? 0) > 60) home.storage.wood = 60;
        if ((home.storage.stone ?? 0) > 40) home.storage.stone = 40;
      }
      for (const c of snapshot) {
        this.consume(c);
        this.learn(c, produced.get(c.id) ?? 0);
      }
      for (const c of snapshot) {
        if (!c.alive) continue;
        this.socialize(c);
        this.seekPartner(c);
      }
      for (const c of snapshot) {
        if (!c.alive) continue;
        this.reproduce(c);
        this.processGestation(c);
      }
      for (const c of snapshot) this.mortality(c);
      for (const home of this.state.households) this.maybeMigrate(home);

      this.updateSettlements();
      this.updateBeliefs();
      this.updateRealms();
      this.updatePlagues();
      this.interSettlement();
      if (this.state.links.length > 40) this.state.links = this.state.links.slice(-24);
      this.advanceResearch();
      this.pushMetrics();
      this.prune();
      this.state.rngSeed = this.rng.seed;
    }
    return this.state;
  }
}

export function createSimulation(config: SimulationConfig): SimulationEngine {
  return new SimulationEngine(config);
}
