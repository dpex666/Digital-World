// Shared-world server logic for the always-growing civilisation.
//
// This runs as a Vercel serverless function — it is NOT part of the Vite SPA
// bundle. It keeps ONE world that every visitor sees, advancing it by the real
// time that has elapsed since it was last touched (compute-on-read), and
// persisting it to a shared store (Vercel KV). If no store is configured the
// function reports `shared: false` and the browser falls back to its own local
// world, so the site always works.
//
// Note: this path could not be tested in the build sandbox (no Vercel runtime
// or KV). It is written defensively and degrades gracefully.

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

async function getKv(): Promise<{ get: (k: string) => Promise<unknown>; set: (k: string, v: unknown) => Promise<unknown> } | null> {
  // Configured only when a Vercel KV store is attached to the project.
  if (!process.env.KV_REST_API_URL && !process.env.KV_URL) return null;
  try {
    const mod = await import("@vercel/kv");
    return mod.kv as never;
  } catch {
    return null;
  }
}

function trim(state: SimulationState, history: number, metrics: number): SimulationState {
  return { ...state, history: state.history.slice(-history), metrics: state.metrics.slice(-metrics) };
}

// Lighten the payload sent to browsers (drop per-being memory/relationships,
// keep enough to render and inspect).
function forClient(state: SimulationState): SimulationState {
  const trimmed = trim(state, 120, 250);
  return {
    ...trimmed,
    characters: trimmed.characters.map((c) => ({ ...c, memory: [], relationships: [] })),
  };
}

export interface WorldResult {
  shared: boolean;
  ticks: number;
  state: SimulationState | null;
}

export async function advanceShared(): Promise<WorldResult> {
  const kv = await getKv();
  if (!kv) return { shared: false, ticks: 0, state: null };

  const now = Date.now();
  let record = (await kv.get(KEY)) as Record | null;
  let engine: SimulationEngine;
  if (record && record.state) {
    engine = new SimulationEngine(CONFIG, record.state);
  } else {
    engine = new SimulationEngine(CONFIG);
    record = { savedAt: now, state: engine.state };
  }

  const elapsed = Math.max(0, now - (record.savedAt ?? now));
  const ticks = Math.min(MAX_ADVANCE, Math.floor(elapsed / MS_PER_TICK));
  if (ticks > 0) engine.step(ticks);

  await kv.set(KEY, { savedAt: ticks > 0 ? now : record.savedAt ?? now, state: trim(engine.state, 400, 400) });
  return { shared: true, ticks, state: forClient(engine.state) };
}
