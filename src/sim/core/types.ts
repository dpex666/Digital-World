export type ID = string;

export type Sex = "female" | "male";
export type LifeStage = "infant" | "child" | "adult" | "elder";
export type TerrainType = "plains" | "forest" | "water" | "mountain" | "desert";
export type Biome = "temperate" | "arid" | "boreal";
export type ResourceType = "food" | "water" | "wood" | "stone";
export type StructureType = "shelter" | "storage" | "cultivation" | "workshop";

// The five ways an agent can act on the world. These are physical affordances,
// not professions assigned by rule — which one an agent does emerges from what
// it has *learned* pays off. Culture decides how to use them.
export type Action = "forage" | "cultivate" | "hunt" | "build" | "craft";

export type EventCategory =
  | "birth"
  | "death"
  | "resource"
  | "weather"
  | "social"
  | "settlement"
  | "decision"
  | "discovery"
  | "epoch"
  | "trade"
  | "conflict"
  | "belief";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Genetics {
  metabolism: number;
  resilience: number;
  fertility: number;
  intelligence: number;
  strength: number;
}

// A heritable visual genome. These are this species' own morphological genes —
// abstract, not human features — that blend and mutate each generation, so the
// civilisation's *look* drifts and adapts over evolutionary time.
export interface Appearance {
  hue: number; // 0..360 base colour
  saturation: number; // 0..1
  luminance: number; // 0..1
  form: number; // 0..1 body morphology
  size: number; // 0..1 stature
  pattern: number; // 0..1 surface markings
}

export interface Needs {
  hunger: number;
  thirst: number;
  energy: number;
  mood: number;
}

export interface Skills {
  forage: number;
  cultivate: number;
  hunt: number;
  build: number;
  craft: number;
  social: number;
}

export interface MemoryEntry {
  tick: number;
  summary: string;
  valence: number;
  tags: string[];
}

export interface Relationship {
  targetId: ID;
  affinity: number;
  trust: number;
  lastInteractionTick: number;
}

export interface Character {
  id: ID;
  name: string;
  ageDays: number;
  lifeStage: LifeStage;
  sex: Sex;
  genetics: Genetics;
  appearance: Appearance;
  health: number;
  needs: Needs;
  intelligence: number;
  education: number;
  personality: {
    sociability: number;
    aggression: number;
    curiosity: number;
  };
  skills: Skills;
  // Learned propensity for each action — the core of self-learning. Reinforced
  // by lived outcomes, inherited from parents, imitated from successful peers.
  strategy: Record<Action, number>;
  lastAction: Action;
  lastWellbeing: number;
  rewardBaseline: number;
  memory: MemoryEntry[];
  relationships: Relationship[];
  location: Vec2;
  inventory: Partial<Record<ResourceType, number>>;
  partnerId?: ID;
  householdId?: ID;
  settlementId?: ID;
  fertilityCooldown: number;
  pregnantBy?: ID;
  gestationRemaining?: number;
  lineage: {
    parents: ID[];
    children: ID[];
    generation: number;
  };
  alive: boolean;
  lastDecisionReason: string;
}

export interface Structure {
  id: ID;
  type: StructureType;
  location: Vec2;
  ownerHouseholdId?: ID;
  settlementId?: ID;
  durability: number;
  storage?: Partial<Record<ResourceType, number>>;
}

export interface Household {
  id: ID;
  name: string;
  memberIds: ID[];
  founderIds: ID[];
  location: Vec2;
  storage: Partial<Record<ResourceType, number>>;
  toolLevel: number;
  settlementId?: ID;
  foundedTick: number;
}

export interface Settlement {
  id: ID;
  name: string;
  center: Vec2;
  memberIds: ID[];
  householdIds: ID[];
  structures: ID[];
  leaderId?: ID;
  knowledge: number;
  foundedTick: number;
  populationPeak: number;
  beliefId?: ID;
  devotion: number;
  culture: {
    cooperation: number;
    tradePreference: number;
    aggression: number;
    innovation: number;
  };
}

// An emergent faith. Founded by a settlement, named in the people's own tongue,
// with tenets that shape how its followers live. It spreads along trade routes,
// binds co-religionists in peace, and sets rival faiths at war.
export interface Belief {
  id: ID;
  name: string;
  hue: number;
  foundedTick: number;
  founderId?: ID;
  tenets: {
    cooperation: number;
    aggression: number;
    innovation: number;
    fertility: number;
  };
}

export interface Tile {
  terrain: TerrainType;
  biome: Biome;
  resources: Partial<Record<ResourceType, number>>;
  hazard: number;
  fertility: number;
}

export interface WorldMap {
  width: number;
  height: number;
  tiles: Tile[][];
}

export interface Weather {
  precipitation: number;
  temperature: number;
  storm: number;
}

export type ClimateEpoch = "frozen" | "thawing" | "temperate" | "warm";

export interface EnvironmentState {
  day: number;
  timeOfDay: number;
  season: "spring" | "summer" | "autumn" | "winter";
  weather: Weather;
  climateEpoch: ClimateEpoch;
  warmth: number;
}

// A generative language unique to each civilisation. Phonology is fixed at
// genesis; the lexicon grows as the people coin words for new things, and a
// few words drift over time. Nothing here is English or pre-authored.
export interface Language {
  onsets: string[];
  nuclei: string[];
  codas: string[];
  lexicon: Record<string, string>;
}

// The world's own substances. Each fills a universal physical role (something
// to eat, to drink, to build with, to work) but is a procedurally-generated
// element with its own name and colour — not Earth's food/water/wood/stone.
export interface ElementDef {
  name: string;
  hue: number;
  role: string;
}

// Aggregated, dimension-agnostic effects of a discovered technique. The
// civilisation invents these directions itself; we don't name them after
// human inventions.
export interface TechEffects {
  foodYield: number;
  buildYield: number;
  toolYield: number;
  health: number;
  fertility: number;
  knowledgeRate: number;
  capacity: number;
}

export interface Technique {
  id: ID;
  name: string;
  tier: number;
  effects: TechEffects;
  prerequisites: ID[];
  discoveredTick: number;
  discovererId?: ID;
}

// An "age" the civilisation grows into. Recognised when accumulated complexity
// crosses an emergent threshold, and named in their own language — never
// "Bronze Age".
export interface Epoch {
  index: number;
  name: string;
  sinceTick: number;
  techThreshold: number;
}

// A transient link between two settlements, for the observatory to animate
// (a trade caravan or a raid). Carries the tick it happened so the renderer can
// fade it out.
export interface WorldLink {
  from: Vec2;
  to: Vec2;
  kind: "trade" | "raid";
  tick: number;
}

export interface HistoryEvent {
  id: ID;
  tick: number;
  category: EventCategory;
  message: string;
  actorIds?: ID[];
}

// A milestone in the world's epic — append-only and preserved from genesis, so
// the whole arc of history can be read as a story.
export interface Milestone {
  tick: number;
  year: number;
  kind: "genesis" | "settlement" | "epoch" | "faith" | "war" | "growth";
  message: string;
}

export interface MetricsSnapshot {
  tick: number;
  year: number;
  population: number;
  births: number;
  deaths: number;
  foodTotal: number;
  shelterCount: number;
  households: number;
  settlements: number;
  avgAgeYears: number;
  maxGeneration: number;
  avgIntelligence: number;
  knowledge: number;
  techCount: number;
  epochIndex: number;
  warmth: number;
}

export interface SimulationState {
  tick: number;
  rngSeed: number;
  world: WorldMap;
  environment: EnvironmentState;
  language: Language;
  elements: Record<ResourceType, ElementDef>;
  epoch: Epoch;
  epochs: Epoch[];
  techniques: Technique[];
  knowledge: number;
  nextEpochThreshold: number;
  peakPopulation: number;
  characters: Character[];
  structures: Structure[];
  households: Household[];
  settlements: Settlement[];
  nextSettlementNum: number;
  beliefs: Belief[];
  links: WorldLink[];
  epic: Milestone[];
  nextPopMilestone: number;
  history: HistoryEvent[];
  metrics: MetricsSnapshot[];
}
