import { useEffect, useMemo, useState } from "react";
import { SimulationEngine } from "../sim/systems/simulation";
import { Character, SimulationState, Tile } from "../sim/core/types";
import { loadState, saveState } from "../sim/storage/persistence";

const engineFromSave = loadState();
const engine = new SimulationEngine(
  { width: 40, height: 26, initialPopulation: 36, seed: 42 },
  engineFromSave ?? undefined,
);

type Filter = "none" | "hunger" | "age" | "population" | "resources";

function tileColor(tile: Tile): string {
  const food = tile.resources.food ?? 0;
  if (tile.terrain === "water") return "#3d78d8";
  if (tile.terrain === "mountain") return "#8d8d8d";
  if (tile.terrain === "desert") return "#caaf62";
  if (tile.terrain === "forest") return food > 8 ? "#1f8f3e" : "#2f6f3f";
  return food > 8 ? "#90c56f" : "#6ba04a";
}

export function App(): JSX.Element {
  const [sim, setSim] = useState<SimulationState>(engine.state);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("none");

  useEffect(() => {
    if (!running) return;
    const handle = window.setInterval(() => {
      setSim({ ...engine.step(speed) });
    }, 120);
    return () => window.clearInterval(handle);
  }, [running, speed]);

  useEffect(() => {
    saveState(sim);
  }, [sim]);

  const selectedChar = useMemo(
    () => sim.characters.find((c) => c.id === selectedCharId) ?? null,
    [sim.characters, selectedCharId],
  );

  const selectedSettlement = useMemo(
    () => sim.settlements.find((s) => s.id === selectedSettlementId) ?? null,
    [sim.settlements, selectedSettlementId],
  );

  const recentHistory = sim.history.slice(-25).reverse();
  const latestMetrics = sim.metrics[sim.metrics.length - 1];

  return (
    <div style={{ fontFamily: "Inter, sans-serif", padding: 12, color: "#f5f5f5", background: "#111", minHeight: "100vh" }}>
      <h1>Digital World — Emergent Simulation MVP</h1>
      <p>
        Tick {sim.tick} · Day {sim.environment.day} · {sim.environment.season} · Population {latestMetrics?.population ?? 0}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={() => setRunning((s) => !s)}>{running ? "Pause" : "Play"}</button>
        <button onClick={() => setSpeed(1)}>1x</button>
        <button onClick={() => setSpeed(4)}>4x</button>
        <button onClick={() => setSpeed(16)}>16x</button>
        <button
          onClick={() => {
            setRunning(false);
            setSim({ ...engine.step(1) });
          }}
        >
          Step
        </button>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="none">No Filter</option>
          <option value="hunger">High Hunger</option>
          <option value="age">Elders</option>
          <option value="population">Dense Clusters</option>
          <option value="resources">Low Resource Tiles</option>
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${sim.world.width}, 16px)`,
              gridAutoRows: "16px",
              border: "1px solid #333",
              width: "fit-content",
            }}
          >
            {sim.world.tiles.flatMap((row, y) =>
              row.map((tile, x) => {
                const chars = sim.characters.filter((c) => c.alive && c.location.x === x && c.location.y === y);
                const settlements = sim.settlements.filter(
                  (s) => Math.abs(s.center.x - x) <= 1 && Math.abs(s.center.y - y) <= 1,
                );
                let overlay = "";
                if (chars.length > 0) overlay = chars.length > 1 ? "●" : "•";
                if (settlements.length > 0) overlay = "⌂";

                let opacity = 1;
                if (filter === "resources" && (tile.resources.food ?? 0) > 3) opacity = 0.25;
                if (filter === "population" && chars.length < 2) opacity = 0.25;

                return (
                  <button
                    key={`${x}-${y}`}
                    title={`(${x},${y}) food:${(tile.resources.food ?? 0).toFixed(1)}`}
                    style={{
                      width: 16,
                      height: 16,
                      border: "1px solid rgba(0,0,0,0.2)",
                      color: "#fff",
                      background: tileColor(tile),
                      opacity,
                      padding: 0,
                      fontSize: 10,
                    }}
                    onClick={() => {
                      const first = chars[0];
                      if (first) setSelectedCharId(first.id);
                    }}
                  >
                    {overlay}
                  </button>
                );
              }),
            )}
          </div>

          <h3>Metrics</h3>
          <div style={{ display: "flex", gap: 12 }}>
            <Metric label="Population" value={latestMetrics?.population ?? 0} />
            <Metric label="Births/tick" value={latestMetrics?.births ?? 0} />
            <Metric label="Deaths/tick" value={latestMetrics?.deaths ?? 0} />
            <Metric label="Food world total" value={latestMetrics?.foodTotal ?? 0} />
            <Metric label="Shelters" value={latestMetrics?.shelterCount ?? 0} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Panel title="Character Inspector">
            {selectedChar ? <CharacterInspector c={selectedChar} filter={filter} /> : "Select a tile with an agent."}
          </Panel>
          <Panel title="Settlement Inspector">
            <select value={selectedSettlementId ?? ""} onChange={(e) => setSelectedSettlementId(e.target.value || null)}>
              <option value="">-- none --</option>
              {sim.settlements.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {selectedSettlement ? (
              <div>
                <div>Members: {selectedSettlement.members.length}</div>
                <div>Structures: {selectedSettlement.structures.length}</div>
                <div>Cooperation: {selectedSettlement.culture.cooperation.toFixed(2)}</div>
              </div>
            ) : (
              <div>No settlement selected.</div>
            )}
          </Panel>
          <Panel title="World Event Feed">
            <div style={{ maxHeight: 280, overflow: "auto", fontSize: 12 }}>
              {recentHistory.map((e) => (
                <div key={e.id}>
                  [{e.tick}] ({e.category}) {e.message}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ border: "1px solid #2f2f2f", padding: 8, background: "#1a1a1a" }}>
      <h3>{props.title}</h3>
      {props.children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div style={{ border: "1px solid #444", padding: "4px 8px", minWidth: 90 }}>
      <div style={{ fontSize: 12 }}>{label}</div>
      <strong>{typeof value === "number" ? value.toFixed(1) : value}</strong>
    </div>
  );
}

function CharacterInspector({ c, filter }: { c: Character; filter: Filter }): JSX.Element {
  const highHunger = c.needs.hunger > 65;
  if (filter === "hunger" && !highHunger) return <div>Filtered out (not high hunger).</div>;
  if (filter === "age" && c.lifeStage !== "elder") return <div>Filtered out (not elder).</div>;

  return (
    <div style={{ fontSize: 13 }}>
      <div>
        {c.name} ({c.id}) {c.alive ? "alive" : "dead"}
      </div>
      <div>
        Age {Math.floor(c.ageDays / 365)} years · stage {c.lifeStage} · sex {c.sex}
      </div>
      <div>Health {c.health.toFixed(1)}</div>
      <div>
        Needs: H {c.needs.hunger.toFixed(1)} · T {c.needs.thirst.toFixed(1)} · E {c.needs.energy.toFixed(1)} · M {c.needs.mood.toFixed(1)}
      </div>
      <div>
        Role {c.role} · Foraging {c.skills.foraging.toFixed(2)} · Building {c.skills.building.toFixed(2)}
      </div>
      <div>Children {c.lineage.children.length} · Parents {c.lineage.parents.join(",") || "unknown"}</div>
      <div>Decision reason: {c.lastDecisionReason}</div>
    </div>
  );
}
