import { useEffect, useMemo, useRef, useState } from "react";
import { SimulationEngine } from "../sim/systems/simulation";
import { Action, Character, Settlement, SimulationState, Tile } from "../sim/core/types";
import { loadPersisted, saveState } from "../sim/storage/persistence";
import "./app.css";

const CONFIG = { width: 48, height: 30, initialPopulation: 2, seed: 42 };
const persisted = loadPersisted();
const engine = new SimulationEngine(CONFIG, persisted?.state ?? undefined);

// The world never resets. It lives in this browser, and while the page is closed
// it keeps living: on reopen we advance it by the real time that elapsed (about
// two days of its life per real second away), capped so a long absence still
// loads quickly.
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

function appearanceColor(c: Character): string {
  const a = c.appearance;
  return `hsl(${Math.round(a.hue)}, ${Math.round(40 + a.saturation * 55)}%, ${Math.round(45 + a.luminance * 35)}%)`;
}

function appearanceShade(c: Character, dl: number): string {
  const a = c.appearance;
  const l = Math.max(8, Math.min(92, 45 + a.luminance * 35 + dl));
  return `hsl(${Math.round(a.hue)}, ${Math.round(40 + a.saturation * 55)}%, ${Math.round(l)}%)`;
}

// Draw one being as a small glowing creature — a body, a head with eyes, little
// legs, and genome-driven markings. Not human: an organism of their own species
// whose colour, build and pattern come from its inherited appearance genes.
function drawCreature(ctx: CanvasRenderingContext2D, px: number, py: number, r: number, c: Character, selected: boolean): void {
  const color = appearanceColor(c);
  const dark = appearanceShade(c, -26);
  const light = appearanceShade(c, 26);
  const form = c.appearance.form;
  const bw = r * (1.15 - form * 0.4);
  const bh = r * (0.85 + form * 0.6);

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = r > 3 ? Math.min(12, r * 1.3) : 0;
  ctx.strokeStyle = selected ? "#ffffff" : "rgba(0,0,0,0.5)";
  ctx.lineWidth = selected ? 2 : Math.max(1, r * 0.12);

  // legs (behind body)
  if (r > 4) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath();
    ctx.moveTo(px - bw * 0.4, py + bh * 0.9);
    ctx.lineTo(px - bw * 0.45, py + bh * 1.5);
    ctx.moveTo(px + bw * 0.4, py + bh * 0.9);
    ctx.lineTo(px + bw * 0.45, py + bh * 1.5);
    ctx.stroke();
    ctx.strokeStyle = selected ? "#ffffff" : "rgba(0,0,0,0.5)";
    ctx.lineWidth = selected ? 2 : Math.max(1, r * 0.12);
  }

  // body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(px, py + r * 0.15, bw, bh, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // head
  const hr = r * 0.62;
  const hy = py - bh * 0.7;
  ctx.shadowBlur = 0;
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(px, hy, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (r > 4) {
    // markings from the pattern gene
    const ptn = c.appearance.pattern;
    if (ptn > 0.6) {
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(px, py + r * 0.3, bw * 0.45, bh * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (ptn < 0.35) {
      ctx.fillStyle = dark;
      for (let k = 0; k < 3; k += 1) {
        const a = k * 2.1;
        ctx.beginPath();
        ctx.arc(px + Math.cos(a) * bw * 0.4, py + r * 0.15 + Math.sin(a) * bh * 0.4, Math.max(0.8, r * 0.13), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // eyes
    ctx.fillStyle = "#14161b";
    const ex = hr * 0.42;
    const ey = hy - hr * 0.05;
    const er = Math.max(0.9, hr * 0.22);
    ctx.beginPath();
    ctx.arc(px - ex, ey, er, 0, Math.PI * 2);
    ctx.arc(px + ex, ey, er, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (selected) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, r + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function terrainBase(tile: Tile): [number, number, number] {
  switch (tile.terrain) {
    case "water":
      return [46, 92, 134];
    case "mountain":
      return [120, 116, 126];
    case "desert":
      return [196, 176, 116];
    case "forest":
      return [52, 102, 60];
    default:
      return [98, 126, 78]; // plains
  }
}

// Deterministic per-tile lightness jitter so terrain reads as textured ground
// rather than flat blocks of colour.
function tileFill(tile: Tile, x: number, y: number): string {
  const [r, g, b] = terrainBase(tile);
  const h = (x * 73856093) ^ (y * 19349663);
  const j = (((h % 17) + 17) % 17) - 8; // -8..8
  const fertLift = (tile.fertility - 0.4) * 12;
  const d = j + fertLift;
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v + d)));
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
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
  const [zoom, setZoom] = useState(1);
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
          ⏳ The world kept living while you were away — it advanced <b>{caughtUp}</b> {caughtUp === 1 ? "day" : "days"}
          {caughtUp >= 365 ? ` (${(caughtUp / 365).toFixed(1)} years)` : ""} and never reset. (tap to dismiss)
        </div>
      ) : null}

      <p style={{ color: "#aab", fontSize: 13, marginTop: 8 }}>
        Year <b>{m?.year ?? 0}</b> · Tick {sim.tick} · {sim.environment.season} · Climate <b>{sim.environment.climateEpoch}</b> (warmth{" "}
        {sim.environment.warmth.toFixed(2)}) · Age: <b style={{ color: "#d8c46a" }}>{sim.epoch.name}</b> (epoch {sim.epoch.index}) · Population{" "}
        <b>{m?.population ?? 0}</b> · Generation {m?.maxGeneration ?? 0}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setObserving((s) => !s)}>{observing ? "❚❚ Hold" : "▶ Observe"}</button>
        <span style={{ color: "#777", fontSize: 12 }}>speed</span>
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)} style={{ fontWeight: speed === s ? 700 : 400, opacity: speed === s ? 1 : 0.6 }}>
            {s}×
          </button>
        ))}
        <span style={{ color: "#777", fontSize: 12, marginLeft: 6 }}>zoom</span>
        <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.5).toFixed(1)))}>−</button>
        <button onClick={() => setZoom((z) => Math.min(6, +(z + 0.5).toFixed(1)))}>+</button>
        <span style={{ color: "#555", fontSize: 12 }}>{zoom.toFixed(1)}×</span>
        <span style={{ color: "#555", fontSize: 12, marginLeft: 6 }}>the view follows the living — they glow; click one to follow its life</span>
      </div>

      <div className="dw-layout">
        <div style={{ minWidth: 0 }}>
          <MapView sim={sim} selectedCharId={selectedCharId} onSelect={setSelectedCharId} zoom={zoom} />

          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center", fontSize: 11, color: "#8a8f98" }}>
            <Swatch c="rgb(46,92,134)" label="water" />
            <Swatch c="rgb(120,116,126)" label="mountain" />
            <Swatch c="rgb(196,176,116)" label="desert" />
            <Swatch c="rgb(52,102,60)" label="forest" />
            <Swatch c="rgb(98,126,78)" label="plains" />
            <span style={{ marginLeft: 6 }}>beings are little creatures coloured by their evolving genome · ⌂ structures · ◯ settlements</span>
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

interface DrawParams {
  offX: number;
  offY: number;
  ppt: number;
}

// Canvas map with a camera that auto-frames the living, so a handful of beings
// fill the view instead of vanishing into a thousand terrain tiles.
function MapView({
  sim,
  selectedCharId,
  onSelect,
  zoom,
}: {
  sim: SimulationState;
  selectedCharId: string | null;
  onSelect: (id: string) => void;
  zoom: number;
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cam = useRef({ cx: sim.world.width / 2, cy: sim.world.height / 2, scale: 16 });
  const params = useRef<DrawParams>({ offX: 0, offY: 0, ppt: 16 });

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(240, wrap.clientWidth);
    const cssH = Math.max(280, Math.min(560, Math.round(cssW * 0.62)));
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const alive = sim.characters.filter((c) => c.alive);
    let minX = sim.world.width;
    let minY = sim.world.height;
    let maxX = 0;
    let maxY = 0;
    if (alive.length) {
      for (const c of alive) {
        minX = Math.min(minX, c.location.x);
        maxX = Math.max(maxX, c.location.x);
        minY = Math.min(minY, c.location.y);
        maxY = Math.max(maxY, c.location.y);
      }
    } else {
      minX = 0;
      minY = 0;
      maxX = sim.world.width - 1;
      maxY = sim.world.height - 1;
    }
    const pad = 5;
    const boxW = Math.max(8, maxX - minX + pad * 2);
    const boxH = Math.max(8, maxY - minY + pad * 2);
    const fit = Math.min(cssW / boxW, cssH / boxH);
    const targetScale = Math.max(5, Math.min(54, fit)) * zoom;
    const targetCx = (minX + maxX) / 2 + 0.5;
    const targetCy = (minY + maxY) / 2 + 0.5;
    const k = 0.2;
    cam.current.scale += (targetScale - cam.current.scale) * k;
    cam.current.cx += (targetCx - cam.current.cx) * k;
    cam.current.cy += (targetCy - cam.current.cy) * k;

    const ppt = cam.current.scale;
    const offX = cssW / 2 - cam.current.cx * ppt;
    const offY = cssH / 2 - cam.current.cy * ppt;
    params.current = { offX, offY, ppt };

    ctx.fillStyle = "#06070a";
    ctx.fillRect(0, 0, cssW, cssH);

    const x0 = Math.max(0, Math.floor(-offX / ppt));
    const x1 = Math.min(sim.world.width - 1, Math.ceil((cssW - offX) / ppt));
    const y0 = Math.max(0, Math.floor(-offY / ppt));
    const y1 = Math.min(sim.world.height - 1, Math.ceil((cssH - offY) / ppt));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const tile = sim.world.tiles[y][x];
        const tx = offX + x * ppt;
        const ty = offY + y * ppt;
        ctx.fillStyle = tileFill(tile, x, y);
        ctx.fillRect(tx, ty, ppt + 1, ppt + 1);
        // Light terrain texture when zoomed in enough to see it.
        if (ppt >= 16) {
          const cx = tx + ppt / 2;
          const cy = ty + ppt / 2;
          if (tile.terrain === "forest") {
            ctx.fillStyle = "rgba(20,46,26,0.55)";
            for (let k = 0; k < 3; k += 1) {
              const ox = ((x * 31 + y * 17 + k * 53) % 10) / 10 - 0.5;
              const oy = ((x * 13 + y * 41 + k * 29) % 10) / 10 - 0.5;
              const px = cx + ox * ppt * 0.7;
              const py = cy + oy * ppt * 0.7;
              const s = ppt * 0.14;
              ctx.beginPath();
              ctx.moveTo(px, py - s);
              ctx.lineTo(px + s, py + s);
              ctx.lineTo(px - s, py + s);
              ctx.closePath();
              ctx.fill();
            }
          } else if (tile.terrain === "water") {
            ctx.strokeStyle = "rgba(150,190,225,0.3)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(tx + ppt * 0.2, cy);
            ctx.lineTo(tx + ppt * 0.8, cy);
            ctx.stroke();
          } else if (tile.terrain === "mountain") {
            ctx.fillStyle = "rgba(190,188,196,0.5)";
            const s = ppt * 0.22;
            ctx.beginPath();
            ctx.moveTo(cx, cy - s);
            ctx.lineTo(cx + s, cy + s * 0.6);
            ctx.lineTo(cx - s, cy + s * 0.6);
            ctx.closePath();
            ctx.fill();
          } else if (tile.terrain === "desert") {
            ctx.fillStyle = "rgba(150,132,84,0.5)";
            for (let k = 0; k < 3; k += 1) {
              const ox = ((x * 19 + y * 7 + k * 37) % 10) / 10 - 0.5;
              const oy = ((x * 23 + y * 11 + k * 17) % 10) / 10 - 0.5;
              ctx.fillRect(cx + ox * ppt * 0.6, cy + oy * ppt * 0.6, Math.max(1, ppt * 0.07), Math.max(1, ppt * 0.07));
            }
          }
        }
      }
    }

    // Structures — little houses.
    for (const s of sim.structures) {
      const px = offX + (s.location.x + 0.5) * ppt;
      const py = offY + (s.location.y + 0.5) * ppt;
      const r = Math.max(2, ppt * 0.3);
      ctx.fillStyle = s.type === "shelter" ? "#e7d6a0" : s.type === "cultivation" ? "#9cc06a" : "#b9c8d8";
      ctx.fillRect(px - r, py - r * 0.4, r * 2, r * 1.2);
      ctx.beginPath();
      ctx.moveTo(px - r * 1.1, py - r * 0.4);
      ctx.lineTo(px, py - r * 1.3);
      ctx.lineTo(px + r * 1.1, py - r * 0.4);
      ctx.closePath();
      ctx.fill();
    }

    // Settlements — rings + names.
    for (const st of sim.settlements) {
      const px = offX + (st.center.x + 0.5) * ppt;
      const py = offY + (st.center.y + 0.5) * ppt;
      ctx.strokeStyle = "rgba(216,196,106,0.65)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, ppt * 2, 0, Math.PI * 2);
      ctx.stroke();
      if (ppt > 9) {
        ctx.fillStyle = "#d8c46a";
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(st.name, px, py - ppt * 2.1);
      }
    }

    // Beings — little glowing creatures coloured by their genome (their own
    // species, not human), fanned out when several share a tile.
    const stacked = new Map<string, number>();
    for (const c of alive) {
      const key = `${c.location.x}:${c.location.y}`;
      const i = stacked.get(key) ?? 0;
      stacked.set(key, i + 1);
      const ang = i * 2.39996;
      const spread = i ? Math.min(ppt * 0.4, 3 + i * 1.4) : 0;
      const px = offX + (c.location.x + 0.5) * ppt + Math.cos(ang) * spread;
      const py = offY + (c.location.y + 0.5) * ppt + Math.sin(ang) * spread;
      const stageScale = c.lifeStage === "infant" ? 0.5 : c.lifeStage === "child" ? 0.72 : c.lifeStage === "elder" ? 0.9 : 1;
      const r = Math.max(2.5, ppt * 0.26 * (0.75 + c.appearance.size) * stageScale);
      drawCreature(ctx, px, py, r, c, c.id === selectedCharId);
    }
  }, [sim, selectedCharId, zoom]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { offX, offY, ppt } = params.current;
    const wx = (x - offX) / ppt - 0.5;
    const wy = (y - offY) / ppt - 0.5;
    let best: string | null = null;
    let bestD = 0.9 * 0.9;
    for (const c of sim.characters) {
      if (!c.alive) continue;
      const dx = c.location.x - wx;
      const dy = c.location.y - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c.id;
      }
    }
    if (best) onSelect(best);
  };

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <canvas ref={canvasRef} onClick={onClick} style={{ width: "100%", borderRadius: 8, border: "1px solid #23252c", cursor: "pointer", display: "block" }} />
    </div>
  );
}

function Swatch({ c, label }: { c: string; label: string }): JSX.Element {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 10, height: 10, background: c, borderRadius: 2, display: "inline-block" }} />
      {label}
    </span>
  );
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
      <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 60, width: "100%", overflow: "hidden", background: "#101218", padding: 4, border: "1px solid #23252c" }}>
        {data.map((d, i) => (
          <div
            key={i}
            title={`yr ${d.year}: ${d.population}`}
            style={{ flex: "1 1 0", minWidth: 0, height: `${(d.population / max) * 100}%`, background: d.deaths > d.births ? "#9c5a5a" : "#4f8f6a" }}
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
