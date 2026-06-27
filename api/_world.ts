// Shared-world server logic for the always-growing civilisation.
//
// This runs as a Vercel serverless function — it is NOT part of the Vite SPA
// bundle. It keeps ONE world that every visitor sees, advancing it by the real
// time that has elapsed since it was last touched (compute-on-read), and
// persisting it to a shared Redis store (Upstash — what "Vercel KV" became). If
// no store is configured the function reports `shared: false` and the browser
// falls back to its own local world, so the site always works.
//
// Note: this path could not be tested in the build sandbox (no Vercel runtime
// or Redis there). It is written defensively and degrades gracefully.

import { Redis } from "@upstash/redis";
import { SimulationEngine } from "../src/sim/systems/simulation";
import type { SimulationState } from "../src/sim/core/types";

const CONFIG = { width: 48, height: 30, initialPopulation: 2, seed: 42 };
const KEY = "digital-world:shared";

// The shared world lives about one day per 250ms of real time. Each refresh
// advances at most MAX_ADVANCE ticks so a single request stays cheap; a long
// gap is caught up over subsequent refreshes.
const MS_PER_TICK = 250;
const MAX_ADVANCE = 6000;

interface Record {
  savedAt: number;
  state: SimulationState;
}

// Works with whatever a Redis/Upstash integration injects — the env var names
// have changed across Vercel's "KV" → "Upstash Redis" rename.
function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

function trim(state: SimulationState, history: number, metrics: number): SimulationState {
  return { ...state, history: state.history.slice(-history), metrics: state.metrics.slice(-metrics) };
}

// Keep the stored snapshot small (Redis values are size-limited): drop the
// heavy per-being memory/relationship arrays. Pairing still works from the
// baseline chance; affinity simply doesn't persist across server refreshes.
function forStore(state: SimulationState): SimulationState {
  const t = trim(state, 300, 300);
  return { ...t, characters: t.characters.map((c) => ({ ...c, memory: [], relationships: [] })) };
}

// Lighten the payload sent to browsers too.
function forClient(state: SimulationState): SimulationState {
  const t = trim(state, 120, 250);
  return { ...t, characters: t.characters.map((c) => ({ ...c, memory: [], relationships: [] })) };
}

export interface WorldResult {
  shared: boolean;
  ticks: number;
  state: SimulationState | null;
}

export async function advanceShared(): Promise<WorldResult> {
  const redis = getRedis();
  if (!redis) return { shared: false, ticks: 0, state: null };

  const now = Date.now();
  const record = (await redis.get<Record>(KEY)) ?? null;
  let engine: SimulationEngine;
  let savedAt = now;
  if (record && record.state) {
    engine = new SimulationEngine(CONFIG, record.state);
    savedAt = record.savedAt ?? now;
  } else {
    engine = new SimulationEngine(CONFIG);
  }

  const elapsed = Math.max(0, now - savedAt);
  const ticks = Math.min(MAX_ADVANCE, Math.floor(elapsed / MS_PER_TICK));
  if (ticks > 0) engine.step(ticks);

  await redis.set(KEY, { savedAt: ticks > 0 || !record ? now : savedAt, state: forStore(engine.state) });
  return { shared: true, ticks, state: forClient(engine.state) };
}
