import { SimulationState } from "../core/types";

const KEY = "digital-world-save-v2";

export function saveState(state: SimulationState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function loadState(): SimulationState | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SimulationState;
  } catch {
    return null;
  }
}

export function exportState(state: SimulationState): string {
  return JSON.stringify(state, null, 2);
}

export function importState(raw: string): SimulationState {
  return JSON.parse(raw) as SimulationState;
}
