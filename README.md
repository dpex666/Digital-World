# Digital World Simulation Prototype

A production-minded TypeScript prototype for a persistent emergent world simulation.

## 1) Architecture summary

- **Simulation core (`src/sim`)** is pure TypeScript and deterministic via seeded RNG.
- **UI (`src/ui`)** is a React observer/inspector that never owns simulation rules.
- **Storage (`src/sim/storage`)** handles save/load snapshot persistence.
- **Simulation loop** updates environment, resources, agents, social state, settlements, and metrics every tick.

## 2) Repo structure

```text
src/
  main.tsx
  ui/
    App.tsx
  sim/
    core/
      types.ts
      worldGen.ts
      characterFactory.ts
    systems/
      simulation.ts
    storage/
      persistence.ts
    util/
      rng.ts
      id.ts
      names.ts
tests/
  simulation.test.ts
```

## 3) Phased plan

- **Phase 1 (done)**: architecture, entities, world model, deterministic loop design.
- **Phase 2 (done MVP)**: world map, resource regen/depletion, autonomous agents, needs, movement, gather, shelter build, reproduction with inheritance/gestation, ageing/death, save/load, metrics, viewer.
- **Phase 3 (next)**: deeper relationships/families, explicit household/tribe entities, cooperative tasks.
- **Phase 4 (next)**: trade/conflict/leadership/social rules, tech progression hooks.
- **Phase 5 (next)**: optimization, chunked worlds, richer renderer/debug tooling.

## 4) Core data model highlights

- `SimulationState`: all persistent world state (tick, world, environment, characters, structures, settlements, history, metrics).
- `Character`: needs, genetics, lineage, memory, skills, relationships, location, inventory, fertility state.
- `WorldMap`: tile resources + fertility/hazard + terrain/biome.
- `HistoryEvent` and `MetricsSnapshot` for observability and diagnostics.

## 5) Simulation loop

Per tick:
1. Advance day/time/season/weather.
2. Regenerate resources.
3. Update each character: needs, decision, move/gather/build/reproduce, learning/memory, age/death.
4. Rebuild lightweight settlement clusters.
5. Append metrics and persistent event history.

## 6) Risks/tradeoffs

- **Current pathing** is local/random (fast and deterministic) but simplistic.
- **Settlement detection** is clustering heuristic, not institution-level governance yet.
- **Save format** is full snapshot JSON (easy now, may need versioning/migrations later).
- **Performance** is tuned for MVP scale (10s–100s of agents), not 10k agents yet.

## 7) Run

```bash
npm install
npm run dev
```

Open the shown localhost URL.

## Testing

```bash
npm test
npm run build
```

## Assumptions made

- Simulation uses a 2D grid with tile-level resources.
- Reproduction uses female gestation state and male/female role for MVP; can evolve to broader configurable reproduction systems.
- LocalStorage snapshot persistence is sufficient for MVP and can be replaced with SQLite/Postgres adapters.
