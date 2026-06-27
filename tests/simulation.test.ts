import { describe, expect, it } from "vitest";
import { inheritGenetics, inheritAppearance } from "../src/sim/core/characterFactory";
import { SimulationEngine } from "../src/sim/systems/simulation";
import { Rng } from "../src/sim/util/rng";
import { exportState, importState } from "../src/sim/storage/persistence";

function grow(seed: number, ticks: number) {
  const engine = new SimulationEngine({ width: 40, height: 26, initialPopulation: 2, seed });
  let births = 0;
  let deaths = 0;
  for (let i = 0; i < ticks; i += 1) {
    engine.step(1);
    births += engine.birthsThisTick;
    deaths += engine.deathsThisTick;
  }
  return { engine, births, deaths };
}

describe("genetics & appearance inheritance", () => {
  it("genetics stay near parental means with bounded mutation", () => {
    const rng = new Rng(1);
    const child = inheritGenetics(
      { metabolism: 1, resilience: 1, fertility: 1, intelligence: 1, strength: 1 },
      { metabolism: 1, resilience: 1, fertility: 1, intelligence: 1, strength: 1 },
      rng,
    );
    expect(child.metabolism).toBeGreaterThan(0.9);
    expect(child.metabolism).toBeLessThan(1.1);
  });

  it("appearance is heritable and drifts (evolving look)", () => {
    const rng = new Rng(2);
    const a = { hue: 100, saturation: 0.6, luminance: 0.5, form: 0.5, size: 0.5, pattern: 0.5 };
    const child = inheritAppearance(a, a, rng);
    expect(child.hue).toBeGreaterThan(70);
    expect(child.hue).toBeLessThan(130);
    expect(child.luminance).toBeGreaterThanOrEqual(0);
    expect(child.luminance).toBeLessThanOrEqual(1);
  });
});

describe("a civilisation that grows from two", () => {
  it("multiplies from a founding pair without going extinct", () => {
    const { engine, births } = grow(7, 18000);
    const alive = engine.state.characters.filter((c) => c.alive).length;
    expect(alive).toBeGreaterThan(2); // grew beyond the founders
    expect(births).toBeGreaterThan(5);
  });

  it("has real mortality and multi-generational lineage", () => {
    const { engine, deaths } = grow(7, 18000);
    expect(deaths).toBeGreaterThan(0); // people actually die
    const maxGen = Math.max(...engine.state.characters.map((c) => c.lineage.generation));
    expect(maxGen).toBeGreaterThanOrEqual(2); // grandchildren and beyond
  });

  it("invents its own techniques and names them in its own language", () => {
    const { engine } = grow(7, 18000);
    expect(engine.state.techniques.length).toBeGreaterThan(0);
    expect(Object.keys(engine.state.language.lexicon).length).toBeGreaterThan(0);
    // Elements are the world's own, not Earth's labels.
    expect(engine.state.elements.food.name).not.toBe("food");
  });
});

describe("observability & persistence", () => {
  it("ages characters one day per tick", () => {
    const engine = new SimulationEngine({ width: 10, height: 10, initialPopulation: 2, seed: 3 });
    const before = engine.state.characters[0].ageDays;
    engine.step(24);
    expect(engine.state.characters[0].ageDays).toBeCloseTo(before + 24, 0);
  });

  it("serialises and restores state", () => {
    const { engine } = grow(4, 1500);
    const imported = importState(exportState(engine.state));
    expect(imported.tick).toBe(engine.state.tick);
    expect(imported.characters.length).toBe(engine.state.characters.length);
    expect(imported.epoch.name).toBe(engine.state.epoch.name);
  });
});
