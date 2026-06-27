import { SimulationState } from "../core/types";

const KEY = "digital-world-save-v5";

export interface Persisted {
  savedAt: number; // wall-clock ms when last saved — used to keep the world growing while closed
  state: SimulationState;
}

export function saveState(state: SimulationState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), state }));
  } catch {
    /* storage full or unavailable — the world simply continues in memory */
  }
}

export function loadPersisted(): Persisted | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed && parsed.state && typeof parsed.savedAt === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function loadState(): SimulationState | null {
  return loadPersisted()?.state ?? null;
}

export function exportState(state: SimulationState): string {
  return JSON.stringify(state, null, 2);
}

export function importState(raw: string): SimulationState {
  return JSON.parse(raw) as SimulationState;
}
