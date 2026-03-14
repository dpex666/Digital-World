export type ID = string;

export type Sex = "female" | "male";
export type LifeStage = "infant" | "child" | "adult" | "elder";
export type TerrainType = "plains" | "forest" | "water" | "mountain" | "desert";
export type Biome = "temperate" | "arid" | "boreal";
export type ResourceType = "food" | "water" | "wood" | "stone";
export type StructureType = "shelter" | "storage";
export type EventCategory = "birth" | "death" | "resource" | "weather" | "social" | "settlement" | "decision";

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

export interface Needs {
  hunger: number;
  thirst: number;
  energy: number;
  mood: number;
}

export interface Skills {
  foraging: number;
  crafting: number;
  building: number;
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

export interface Goal {
  name: "survive" | "gather" | "rest" | "reproduce" | "build";
  priority: number;
  reason: string;
}

export interface Character {
  id: ID;
  name: string;
  ageDays: number;
  lifeStage: LifeStage;
  sex: Sex;
  genetics: Genetics;
  health: number;
  needs: Needs;
  intelligence: number;
  personality: {
    sociability: number;
    aggression: number;
    curiosity: number;
  };
  skills: Skills;
  memory: MemoryEntry[];
  relationships: Relationship[];
  location: Vec2;
  inventory: Partial<Record<ResourceType, number>>;
  role: "generalist" | "gatherer" | "builder";
  goals: Goal[];
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
  ownerGroupId?: ID;
  durability: number;
  storage?: Partial<Record<ResourceType, number>>;
}

export interface Settlement {
  id: ID;
  name: string;
  center: Vec2;
  members: ID[];
  structures: ID[];
  culture: {
    cooperation: number;
    tradePreference: number;
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

export interface EnvironmentState {
  day: number;
  timeOfDay: number;
  season: "spring" | "summer" | "autumn" | "winter";
  weather: Weather;
}

export interface HistoryEvent {
  id: ID;
  tick: number;
  category: EventCategory;
  message: string;
  actorIds?: ID[];
}

export interface MetricsSnapshot {
  tick: number;
  population: number;
  births: number;
  deaths: number;
  foodTotal: number;
  shelterCount: number;
}

export interface SimulationState {
  tick: number;
  rngSeed: number;
  world: WorldMap;
  environment: EnvironmentState;
  characters: Character[];
  structures: Structure[];
  settlements: Settlement[];
  history: HistoryEvent[];
  metrics: MetricsSnapshot[];
}
