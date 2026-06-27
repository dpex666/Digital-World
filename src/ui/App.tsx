import { useEffect, useMemo, useRef, useState } from "react";
import { SimulationEngine } from "../sim/systems/simulation";
import { Action, Character, Settlement, SimulationState, Tile } from "../sim/core/types";
import { loadPersisted, saveState } from "../sim/storage/persistence";

const persisted = loadPersisted();
const engine = new SimulationEngine({ width: 48, height: 30, initialPopulation: 2, seed: 42 }, persisted?.state ?? undefined);

// The world never resets. While the page is closed it keeps living: on reopen
// we advance it by the real time that elapsed (about two days of its life per
// real second away), capped so a long absence still loads quickly.
const BG_TICKS_PER_SECOND = 2;
const MAX_CATCHUP_TICKS = 12000;
let caughtUpTicks = 0;
if (persisted) {
  const elapsedSec = Math.max(0, (Date.now() - persisted.savedAt) / 1000);
  caughtUpTicks = Math.min(MAX_CATCHUP_TICKS, Math.floor(elapsedSec * BG_TICKS_PER_SECOND));
  if (caughtUpTicks > 0) engine.step(caughtUpTicks);
}

// Viewing speeds — how fast we fast-forward through the world's time. The world
// itself is autonomous; these only change how quickly we watch it unfold.
const SPEEDS = [1, 4, 16, 60];

function tileColor(tile: Tile): string {
  const food = tile.resources.food ?? 0;
  if (tile.terrain === "water") return "#21508f";
  if (tile.terrain === "mountain") return "#6c6c74";
  if (tile.terrain === "desert") return "#b8a05a";
  if (tile.terrain === "forest") return food > 8 ? "#1c7a37" : "#27532f";
  return food > 8 ? "#5f8f48" : "#46603a";
}

function appearanceColor(c: Character): string {
  const a = c.appearance;
  return `hsl(${Math.round(a.hue)}, ${Math.round(a.saturation * 100)}%, ${Math.round(35 + a.luminance * 45)}%)`;
}

function topActions(strategy: Record<Action, number>): string {
  return (Object.entries(strategy) as [Action, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k} ${v.toFixed(1)}`)
    .join(", ");
}

export function App(): JSX.Element {
  const [sim, setSim] = useState<SimulationState>(engine.state);
  const [observing, setObserving] = useState(true);
  const [speed, setSpeed] = useState(16);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [caughtUp, setCaughtUp] = useState(caughtUpTicks);
  const saveCounter = useRef(0);
  const latest = useRef(sim);
  latest.current = sim;

  useEffect(() => {
    if (!observing) return;
    const handle = window.setInterval(() => setSim({ ...engine.step(speed) }), 100);
    return () => window.clearInterval(handle);
  }, [observing, speed]);

  useEffect(() => {
    saveCounter.current += 1;
    if (saveCounter.current % 10 === 0) saveState(sim);
  }, [sim]);

  // Persist on close so the world resumes — and keeps growing — next time.
  useEffect(() => {
    const onLeave = () => saveState(latest.current);
    window.addEventListener("beforeunload", onLeave);
    document.addEventListener("visibilitychange", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      document.removeEventListener("visibilitychange", onLeave);
    };
  }, []);

  const selectedChar = useMemo(
    () => sim.characters.find((c) => c.id === selectedCharId && c.alive) ?? null,
    [sim, selectedCharId],
  );
  const selectedSettlement = useMemo(
    () => sim.settlements.find((s) => s.id === selectedSettlementId) ?? null,
    [sim, selectedSettlementId],
  );

  const aliveByTile = useMemo(() => {
    const map = new Map<string, Character[]>();
    for (const c of sim.characters) {
      if (!c.alive) continue;
      const key = `${c.location.x}:${c.location.y}`;
      const arr = map.get(key);
      if (arr) arr.push(c);
      else map.set(key, [c]);
    }
    return map;
  }, [sim]);

  const structuresByTile = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sim.structures) map.set(`${s.location.x}:${s.location.y}`, (map.get(`${s.location.x}:${s.location.y}`) ?? 0) + 1);
    return map;
  }, [sim]);

  const m = sim.metrics[sim.metrics.length - 1];
  const recent = sim.history.slice(-40).reverse();
  const lexicon = Object.entries(sim.language.lexicon);

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 14, color: "#e8e8ea", background: "#0b0c10", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Digital World</h1>
        <span style={{ color: "#8a8f98", fontSize: 13 }}>
          An autonomous civilisation that begins as two and grows, learns, and invents on its own. You are watching — not playing.
        </span>
      </div>

      {caughtUp > 0 ? (
        <div
          onClick={() => setCaughtUp(0)}
          style={{ marginTop: 8, padding: "6px 10px", background: "#1a2230", border: "1px solid #2c3a52", borderRadius: 6, fontSize: 12.5, color: "#bcd", cursor: "pointer" }}
          title="dismiss"
        >
          ⏳ The world kept living while you were away — it advanced <b>{caughtUp}</b> days ({(caughtUp / 365).toFixed(1)} years) and never reset. (click to dismiss)
        </div>
      ) : null}

      <p style={{ color: "#aab", fontSize: 13, marginTop: 8 }}>
        Year <b>{m?.year ?? 0}</b> · Tick {sim.tick} · {sim.environment.season} · Climate <b>{sim.environment.climateEpoch}</b> (warmth{" "}
        {sim.environment.warmth.toFixed(2)}) · Age: <b style={{ color: "#d8c46a" }}>{sim.epoch.name}</b> (epoch {sim.epoch.index}) · Population{" "}
        <b>{m?.population ?? 0}</b> · Generation {m?.maxGeneration ?? 0}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setObserving((s) => !s)}>{observing ? "❚❚ Hold" : "▶ Observe"}</button>
        <span style={{ color: "#777", fontSize: 12 }}>view speed</span>
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)} style={{ fontWeight: speed === s ? 700 : 400, opacity: speed === s ? 1 : 0.6 }}>
            {s}×
          </button>
        ))}
        <span style={{ color: "#555", fontSize: 12, marginLeft: 8 }}>the world runs on its own; speed only changes how fast you watch</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)", gap: 14 }}>
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${sim.world.width}, 15px)`,
              gridAutoRows: "15px",
              border: "1px solid #23252c",
              width: "fit-content",
              background: "#000",
            }}
          >
            {sim.world.tiles.flatMap((row, y) =>
              row.map((tile, x) => {
                const key = `${x}:${y}`;
                const here = aliveByTile.get(key);
                const struct = structuresByTile.get(key);
                const inSettlement = sim.settlements.some((s) => Math.abs(s.center.x - x) <= 1 && Math.abs(s.center.y - y) <= 1);
                const lead = here && here[0];
                return (
                  <div
                    key={key}
                    title={`(${x},${y}) ${tile.terrain} · ${sim.elements.food.name} ${(tile.resources.food ?? 0).toFixed(1)}${here ? ` · ${here.length} here` : ""}`}
                    onClick={() => lead && setSelectedCharId(lead.id)}
                    style={{
                      width: 15,
                      height: 15,
                      background: tileColor(tile),
                      boxShadow: inSettlement ? "inset 0 0 0 1px #d8c46a" : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "relative",
                      cursor: lead ? "pointer" : "default",
                    }}
                  >
                    {struct ? (
                      <span style={{ position: "absolute", left: 1, top: -2, fontSize: 9, color: "#e9dca0" }}>⌂</span>
                    ) : null}
                    {lead ? (
                      <span
                        style={{
                          width: here!.length > 1 ? 9 : 7,
                          height: here!.length > 1 ? 9 : 7,
                          borderRadius: lead.appearance.form > 0.5 ? "50%" : 2,
                          background: appearanceColor(lead),
                          border: here!.length > 1 ? "1px solid #fff" : "none",
                        }}
                      />
                    ) : null}
                  </div>
                );
              }),
            )}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <Metric label="Population" value={m?.population ?? 0} />
            <Metric label="Births (yr-tick)" value={m?.births ?? 0} />
            <Metric label="Deaths (yr-tick)" value={m?.deaths ?? 0} />
            <Metric label="Avg age (yrs)" value={m?.avgAgeYears ?? 0} />
            <Metric label="Households" value={m?.households ?? 0} />
            <Metric label="Settlements" value={m?.settlements ?? 0} />
            <Metric label="Inventions" value={m?.techCount ?? 0} />
            <Metric label="Avg intellect" value={m?.avgIntelligence ?? 0} />
          </div>

          <PopGraph sim={sim} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Panel title="Inhabitant">
            {selectedChar ? <Inhabitant c={selectedChar} sim={sim} /> : <Muted>Click a being on the map to follow its life.</Muted>}
          </Panel>

          <Panel title="Civilisation">
            <Row k="Age (epoch)" v={`${sim.epoch.name} · #${sim.epoch.index}`} />
            <Row k="Knowledge" v={sim.knowledge.toFixed(0)} />
            <Row k="Inventions" v={String(sim.techniques.length)} />
            <div style={{ fontSize: 12, color: "#9aa", marginTop: 6 }}>Their inventions (named in their own tongue):</div>
            <div style={{ fontSize: 12, maxHeight: 90, overflow: "auto" }}>
              {sim.techniques.length === 0 ? (
                <Muted>No inventions yet — they are still learning to survive.</Muted>
              ) : (
                sim.techniques
                  .slice(-8)
                  .reverse()
                  .map((t) => (
                    <div key={t.id}>
                      <b style={{ color: "#cdb6f0" }}>{t.name}</b> <span style={{ color: "#667" }}>· tier {t.tier}</span>
                    </div>
                  ))
              )}
            </div>
            <div style={{ fontSize: 12, color: "#9aa", marginTop: 8 }}>Their world's elements:</div>
            <div style={{ fontSize: 12 }}>
              {(Object.values(sim.elements)).map((el) => (
                <span key={el.name} style={{ marginRight: 8, color: `hsl(${el.hue},60%,70%)` }}>
                  {el.name} <span style={{ color: "#667" }}>({el.role})</span>
                </span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "#9aa", marginTop: 8 }}>Their language ({lexicon.length} words coined):</div>
            <div style={{ fontSize: 12, color: "#bcd" }}>
              {lexicon.slice(-10).map(([, w]) => w).join(" · ") || <Muted>—</Muted>}
            </div>
          </Panel>

          <Panel title="Settlement">
            <select
              value={selectedSettlementId ?? ""}
              onChange={(e) => setSelectedSettlementId(e.target.value || null)}
              style={{ width: "100%", marginBottom: 6 }}
            >
              <option value="">— select a settlement —</option>
              {sim.settlements.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.memberIds.length})
                </option>
              ))}
            </select>
            {selectedSettlement ? <SettlementView s={selectedSettlement} sim={sim} /> : <Muted>None selected.</Muted>}
          </Panel>

          <Panel title="Chronicle">
            <div style={{ maxHeight: 260, overflow: "auto", fontSize: 12 }}>
              {recent.map((e) => (
                <div key={e.id} style={{ color: chronicleColor(e.category), marginBottom: 2 }}>
                  <span style={{ color: "#556" }}>[{e.tick}]</span> {e.message}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function chronicleColor(cat: string): string {
  if (cat === "birth") return "#7fd1a3";
  if (cat === "death") return "#d98c8c";
  if (cat === "discovery") return "#cdb6f0";
  if (cat === "epoch") return "#e9d27a";
  if (cat === "settlement") return "#9ec7e8";
  if (cat === "social") return "#ccd";
  return "#99a";
}

function Inhabitant({ c, sim }: { c: Character; sim: SimulationState }): JSX.Element {
  const settlement = sim.settlements.find((s) => s.id === c.settlementId);
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: c.appearance.form > 0.5 ? "50%" : 3,
            background: appearanceColor(c),
            display: "inline-block",
          }}
        />
        <b>{c.name}</b>
        <span style={{ color: "#778" }}>
          {c.sex === "female" ? "♀" : "♂"} · gen {c.lineage.generation}
        </span>
      </div>
      <Row k="Age / stage" v={`${Math.floor(c.ageDays / 365)} yrs · ${c.lifeStage}`} />
      <Row k="Health" v={c.health.toFixed(0)} />
      <Row k="Hunger / thirst" v={`${c.needs.hunger.toFixed(0)} / ${c.needs.thirst.toFixed(0)}`} />
      <Row k="Doing now" v={c.lastAction} />
      <Row k="Learned leaning" v={topActions(c.strategy)} />
      <Row k="Intellect / educ." v={`${c.genetics.intelligence.toFixed(2)} / ${c.education.toFixed(2)}`} />
      <Row k="Children" v={String(c.lineage.children.length)} />
      <Row k="Settlement" v={settlement?.name ?? "—"} />
      <div style={{ color: "#8a8f98", marginTop: 4, fontStyle: "italic" }}>{c.lastDecisionReason}</div>
    </div>
  );
}

function SettlementView({ s, sim }: { s: Settlement; sim: SimulationState }): JSX.Element {
  const leader = sim.characters.find((c) => c.id === s.leaderId);
  return (
    <div style={{ fontSize: 13 }}>
      <Row k="People" v={String(s.memberIds.length)} />
      <Row k="Households" v={String(s.householdIds.length)} />
      <Row k="Structures" v={String(s.structures.length)} />
      <Row k="Founded (yr)" v={String(Math.floor(s.foundedTick / 365))} />
      <Row k="Elder/leader" v={leader?.name ?? "—"} />
      <Row k="Cooperation" v={s.culture.cooperation.toFixed(2)} />
      <Row k="Innovation" v={s.culture.innovation.toFixed(2)} />
      <Row k="Knowledge" v={s.knowledge.toFixed(2)} />
    </div>
  );
}

function PopGraph({ sim }: { sim: SimulationState }): JSX.Element {
  const data = sim.metrics.slice(-160);
  const max = Math.max(4, ...data.map((d) => d.population));
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "#9aa", marginBottom: 4 }}>Population over time</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 60, background: "#101218", padding: 4, border: "1px solid #23252c" }}>
        {data.map((d, i) => (
          <div
            key={i}
            title={`yr ${d.year}: ${d.population}`}
            style={{ width: 3, height: `${(d.population / max) * 100}%`, background: d.deaths > d.births ? "#9c5a5a" : "#4f8f6a" }}
          />
        ))}
      </div>
    </div>
  );
}

function Panel(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ border: "1px solid #23252c", borderRadius: 6, padding: 10, background: "#111319" }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 13, letterSpacing: 0.4, color: "#c7cad1", textTransform: "uppercase" }}>{props.title}</h3>
      {props.children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div style={{ border: "1px solid #23252c", borderRadius: 6, padding: "6px 10px", minWidth: 96, background: "#111319" }}>
      <div style={{ fontSize: 11, color: "#8a8f98" }}>{label}</div>
      <strong style={{ fontSize: 16 }}>{value}</strong>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "1px 0" }}>
      <span style={{ color: "#8a8f98" }}>{k}</span>
      <span style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }): JSX.Element {
  return <span style={{ color: "#667", fontSize: 12 }}>{children}</span>;
}
