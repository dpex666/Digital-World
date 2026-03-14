import { describe, expect, it } from "vitest";
import { inheritGenetics } from "../src/sim/core/characterFactory";
import { SimulationEngine } from "../src/sim/systems/simulation";
import { Rng } from "../src/sim/util/rng";
import { exportState, importState } from "../src/sim/storage/persistence";

describe("genetics inheritance", () => {
  it("stays near parental means with bounded mutation", () => {
    const rng = new Rng(1);
    const child = inheritGenetics(
      { metabolism: 1, resilience: 1, fertility: 1, intelligence: 1, strength: 1 },
      { metabolism: 1, resilience: 1, fertility: 1, intelligence: 1, strength: 1 },
      rng,
    );
    expect(child.metabolism).toBeGreaterThan(0.9);
    expect(child.metabolism).toBeLessThan(1.1);
  });
});

describe("simulation lifecycle", () => {
  it("ages characters as ticks progress", () => {
    const engine = new SimulationEngine({ width: 8, height: 8, initialPopulation: 4, seed: 7 });
    const ageBefore = engine.state.characters[0].ageDays;
    engine.step(24);
    expect(engine.state.characters[0].ageDays).toBeGreaterThan(ageBefore + 0.9);
  });

  it("generates metrics and resource pressure", () => {
    const engine = new SimulationEngine({ width: 8, height: 8, initialPopulation: 10, seed: 12 });
    engine.step(50);
    expect(engine.state.metrics.length).toBeGreaterThan(0);
    const latest = engine.state.metrics[engine.state.metrics.length - 1];
    expect(latest.foodTotal).toBeGreaterThan(0);
  });

  it("supports save and load serialization", () => {
    const engine = new SimulationEngine({ width: 8, height: 8, initialPopulation: 5, seed: 4 });
    engine.step(8);
    const exported = exportState(engine.state);
    const imported = importState(exported);
    expect(imported.tick).toBe(engine.state.tick);
    expect(imported.characters.length).toBe(engine.state.characters.length);
  });

  it("produces decision reasons for observability", () => {
    const engine = new SimulationEngine({ width: 8, height: 8, initialPopulation: 5, seed: 3 });
    engine.step(6);
    expect(engine.state.characters.some((c) => c.lastDecisionReason.length > 8)).toBe(true);
  });
});
