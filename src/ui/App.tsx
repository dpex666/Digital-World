import { useEffect, useMemo, useRef, useState } from "react";
import { SimulationEngine } from "../sim/systems/simulation";
import { Action, Character, Settlement, SimulationState, Tile } from "../sim/core/types";
import { loadPersisted, saveState } from "../sim/storage/persistence";
import "./app.css";

const CONFIG = { width: 48, height: 30, initialPopulation: 2, seed: 7 };
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

// Pixel-art buildings, drawn from a few crisp rects. Their type tells the
// civilisation's story: huts to live in, stores, tilled fields, workshops.
function drawStructure(ctx: CanvasRenderingContext2D, px: number, py: number, type: string, ppt: number): void {
  const u = Math.max(1, ppt * 0.14);
  if (type === "cultivation") {
    ctx.fillStyle = "#6b5235";
    ctx.fillRect(px - 4 * u, py - 2 * u, 8 * u, 4 * u);
    ctx.fillStyle = "#4e6838";
    for (let i = 0; i < 3; i += 1) ctx.fillRect(px - 4 * u, py - 2 * u + i * 1.5 * u, 8 * u, Math.max(1, u * 0.5));
    return;
  }
  const wall = type === "storage" ? "#9a7d52" : type === "workshop" ? "#6f6a72" : "#7a5a37";
  const roof = type === "storage" ? "#6e5734" : type === "workshop" ? "#4f4b54" : "#5b4327";
  ctx.fillStyle = wall;
  ctx.fillRect(px - 3 * u, py - u, 6 * u, 3 * u);
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(px - 4 * u, py - u);
  ctx.lineTo(px, py - 4 * u);
  ctx.lineTo(px + 4 * u, py - u);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#2e2113";
  ctx.fillRect(px - u, py + 0.4 * u, 2 * u, 1.6 * u);
  if (type === "workshop") {
    ctx.fillStyle = roof;
    ctx.fillRect(px + 2 * u, py - 3.4 * u, 1.2 * u, 1.6 * u);
    ctx.fillStyle = "rgba(220,220,225,0.6)";
    ctx.fillRect(px + 2.1 * u, py - 5 * u, u, u);
  } else if (type === "storage") {
    ctx.fillStyle = roof;
    ctx.fillRect(px - 3 * u, py, 6 * u, Math.max(1, u * 0.4));
  }
}

// Draw one being as a pixel-art creature tinted by its genome — body colour,
// outline, eyes, legs and belly marking all derive from inherited genes, so
// each lineage looks distinct and evolves over generations.
function drawCreature(ctx: CanvasRenderingContext2D, px: number, py: number, r: number, c: Character, selected: boolean): void {
  const body = appearanceColor(c);
  const outline = appearanceShade(c, -30);
  const belly = c.appearance.pattern > 0.5 ? appearanceShade(c, 24) : appearanceShade(c, -16);
  const template = creatureTemplate(c.appearance.form);
  const cols = template[0].length;
  const rows = template.length;
  // form gene stretches the creature taller or squatter
  const cs = Math.max(1, (r * 2.6) / rows);
  const spriteW = cols * cs;
  const spriteH = rows * cs;
  const x0 = px - spriteW / 2;
  const y0 = py - spriteH / 2;

  // soft glow
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(px, py, r * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const cell = Math.ceil(cs) + 0.5;
  for (let ry = 0; ry < rows; ry += 1) {
    const line = template[ry];
    for (let cx = 0; cx < cols; cx += 1) {
      const ch = line[cx];
      if (ch === " ") continue;
      let color = body;
      if (ch === "o") color = outline;
      else if (ch === "e") color = "#14161b";
      else if (ch === "l") color = outline;
      else if (ch === "p") color = belly;
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(x0 + cx * cs), Math.floor(y0 + ry * cs), cell, cell);
    }
  }

  if (selected) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(spriteW, spriteH) / 2 + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ---- pixel-art assets, authored in code (CC0) ----
// Terrain is rendered from tiny 8x8 pixel tiles drawn once and cached, then
// scaled up with image smoothing off so the pixels stay crisp. Beings are
// pixel creatures tinted by their own genome (an off-the-shelf sprite couldn't
// show their evolving, inherited appearance).

const TILE = 8;
const PAL: Record<string, { base: string; dark: string; light: string; extra: string }> = {
  water: { base: "#2e5c86", dark: "#244a6e", light: "#3f6f9b", extra: "#9fc4e3" },
  plains: { base: "#5e7a44", dark: "#4e6838", light: "#7a9655", extra: "#86a35e" },
  forest: { base: "#3a6b3f", dark: "#274e30", light: "#4a7a48", extra: "#5b4327" },
  desert: { base: "#c4b074", dark: "#ad9860", light: "#d8c78a", extra: "#b8a468" },
  mountain: { base: "#78747e", dark: "#5d5a64", light: "#9a98a2", extra: "#d9d7df" },
};
const BASE_COLOR: Record<string, string> = {
  water: "#2e5c86",
  plains: "#5e7a44",
  forest: "#3a6b3f",
  desert: "#c4b074",
  mountain: "#78747e",
};

const tileCache = new Map<string, HTMLCanvasElement>();

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildTile(terrain: string, variant: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const x = canvas.getContext("2d")!;
  const p = PAL[terrain] ?? PAL.plains;
  const rnd = lcg(terrain.length * 131 + variant * 977 + 7);
  const px = (cx: number, cy: number, color: string) => {
    x.fillStyle = color;
    x.fillRect(cx, cy, 1, 1);
  };
  x.fillStyle = p.base;
  x.fillRect(0, 0, TILE, TILE);
  // base speckle
  for (let cy = 0; cy < TILE; cy += 1)
    for (let cx = 0; cx < TILE; cx += 1) if (rnd() < 0.16) px(cx, cy, rnd() < 0.5 ? p.dark : p.light);

  if (terrain === "water") {
    for (const ry of [1, 4, 6]) {
      const sx = Math.floor(rnd() * 4);
      px(sx + 1, ry, p.light);
      px(sx + 2, ry, p.extra);
      px(sx + 5, ry, p.light);
    }
  } else if (terrain === "forest") {
    const trees = 1 + Math.floor(rnd() * 2);
    for (let t = 0; t < trees; t += 1) {
      const tx = 1 + Math.floor(rnd() * 5);
      const ty = 2 + Math.floor(rnd() * 4);
      px(tx, ty, p.dark);
      px(tx + 1, ty, p.dark);
      px(tx, ty - 1, p.dark);
      px(tx + 1, ty - 1, p.light);
      px(tx, ty + 1, p.extra); // trunk
    }
  } else if (terrain === "mountain") {
    // a little peak with a snowy tip
    px(4, 1, p.extra);
    px(3, 2, p.light);
    px(4, 2, p.extra);
    px(2, 3, p.light);
    px(3, 3, p.light);
    px(4, 3, p.dark);
    for (let cx = 1; cx < 7; cx += 1) px(cx, 4, rnd() < 0.5 ? p.light : p.dark);
  } else if (terrain === "desert") {
    for (let i = 0; i < 4; i += 1) {
      const dx = Math.floor(rnd() * TILE);
      const dy = Math.floor(rnd() * TILE);
      px(dx, dy, rnd() < 0.5 ? p.dark : p.light);
    }
  } else {
    // plains: grass blades / specks
    for (let i = 0; i < 5; i += 1) {
      const gx = Math.floor(rnd() * TILE);
      const gy = Math.floor(rnd() * TILE);
      px(gx, gy, p.light);
      if (rnd() < 0.4) px(gx, gy - 1, p.extra);
    }
  }
  return canvas;
}

function getTile(terrain: string, variant: number): HTMLCanvasElement {
  const key = `${terrain}:${variant}`;
  let c = tileCache.get(key);
  if (!c) {
    c = buildTile(terrain, variant);
    tileCache.set(key, c);
  }
  return c;
}

// Pixel-creature templates. o=outline, b=body, e=eye, l=leg, p=belly mark.
// Three silhouettes — stout, standard, tall — chosen by the `form` gene so the
// species varies in build, not just colour.
const CREATURE_STANDARD = [
  " oooooo ",
  "obbbbbbo",
  "obebbebo",
  "obbbbbbo",
  " oooooo ",
  "  obbo  ",
  " obbbbo ",
  " obppbo ",
  " obbbbo ",
  " l    l ",
];
const CREATURE_STOUT = [
  " oooooo ",
  "obbbbbbo",
  "obebbebo",
  "obbbbbbo",
  "oobbbboo",
  "obbbbbbo",
  "obbppbbo",
  "obbbbbbo",
  " l    l ",
];
const CREATURE_TALL = [
  "  oooo  ",
  " obbbbo ",
  " obeebo ",
  " obbbbo ",
  "  oooo  ",
  "  obbo  ",
  "  obbo  ",
  "  oppo  ",
  "  obbo  ",
  "  obbo  ",
  "  l  l  ",
];
function creatureTemplate(form: number): string[] {
  return form < 0.34 ? CREATURE_STOUT : form < 0.67 ? CREATURE_STANDARD : CREATURE_TALL;
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
          <MapView sim={sim} selectedCharId={selectedCharId} onSelect={setSelectedCharId} zoom={zoom} speed={speed} />

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
            {selectedChar ? <Inhabitant c={selectedChar} sim={sim} onSelect={setSelectedCharId} /> : <Muted>Tap a being on the map, or a notable life below, to follow it.</Muted>}
          </Panel>

          <Panel title="Notable Lives">
            <NotableLives sim={sim} onSelect={setSelectedCharId} />
          </Panel>

          <Panel title="Faiths">
            <Faiths sim={sim} />
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
  if (cat === "trade") return "#7fd6c0";
  if (cat === "conflict") return "#ef6f6f";
  if (cat === "belief") return "#c79be8";
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
  speed,
}: {
  sim: SimulationState;
  selectedCharId: string | null;
  onSelect: (id: string) => void;
  zoom: number;
  speed: number;
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
    // Keep the camera inside the world so we never show empty off-world void:
    // if the world is wider/taller than the view, clamp the centre to its
    // bounds; otherwise centre the world.
    const halfX = cssW / (2 * ppt);
    const halfY = cssH / (2 * ppt);
    const wW = sim.world.width;
    const wH = sim.world.height;
    cam.current.cx = wW > 2 * halfX ? Math.min(Math.max(cam.current.cx, halfX), wW - halfX) : wW / 2;
    cam.current.cy = wH > 2 * halfY ? Math.min(Math.max(cam.current.cy, halfY), wH - halfY) : wH / 2;
    const offX = cssW / 2 - cam.current.cx * ppt;
    const offY = cssH / 2 - cam.current.cy * ppt;
    params.current = { offX, offY, ppt };

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#06070a";
    ctx.fillRect(0, 0, cssW, cssH);

    const x0 = Math.max(0, Math.floor(-offX / ppt));
    const x1 = Math.min(sim.world.width - 1, Math.ceil((cssW - offX) / ppt));
    const y0 = Math.max(0, Math.floor(-offY / ppt));
    const y1 = Math.min(sim.world.height - 1, Math.ceil((cssH - offY) / ppt));
    const detailed = ppt >= 6;
    // Territory: each settlement projects influence over nearby land, coloured
    // by its faith (neutral grey if faithless), so the map shows the domains of
    // religions and the reach of civilisations.
    const terr = sim.settlements.map((s) => {
      const faith = s.beliefId ? sim.beliefs.find((b) => b.id === s.beliefId) : undefined;
      return { x: s.center.x, y: s.center.y, hue: faith ? faith.hue : -1 };
    });
    const TERR_R = 7;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const tile = sim.world.tiles[y][x];
        const tx = Math.floor(offX + x * ppt);
        const ty = Math.floor(offY + y * ppt);
        const w = Math.ceil(ppt) + 1;
        if (detailed) {
          // Crisp pixel tile (smoothing off), variant chosen from position.
          const variant = ((x * 7 + y * 13) % 3 + 3) % 3;
          ctx.drawImage(getTile(tile.terrain, variant), 0, 0, TILE, TILE, tx, ty, w, w);
        } else {
          ctx.fillStyle = BASE_COLOR[tile.terrain] ?? "#5e7a44";
          ctx.fillRect(tx, ty, w, w);
        }
        if (terr.length && tile.terrain !== "water") {
          let bestD = Infinity;
          let bestHue = -2;
          for (const t of terr) {
            const d = Math.abs(t.x - x) + Math.abs(t.y - y);
            if (d < bestD) {
              bestD = d;
              bestHue = t.hue;
            }
          }
          if (bestD <= TERR_R) {
            const a = 0.26 * (1 - bestD / (TERR_R + 1));
            ctx.fillStyle = bestHue >= 0 ? `hsla(${Math.round(bestHue)},55%,50%,${a.toFixed(3)})` : `rgba(196,190,205,${(a * 0.5).toFixed(3)})`;
            ctx.fillRect(tx, ty, w, w);
          }
        }
      }
    }

    // Climate & season atmosphere: the world reads icy and pale in the deep
    // cold of its ice age, and warms to a clear, lush light as it thaws.
    const warmthNow = sim.environment.warmth;
    const winter = sim.environment.season === "winter";
    const cold = Math.max(0, Math.min(0.55, (0.64 - warmthNow) * 1.7 + (winter ? 0.12 : 0)));
    if (cold > 0.01) {
      ctx.fillStyle = `rgba(214,230,250,${cold.toFixed(3)})`;
      ctx.fillRect(0, 0, cssW, cssH);
    } else if (sim.environment.season === "summer" && warmthNow > 0.7) {
      ctx.fillStyle = "rgba(255,226,150,0.06)";
      ctx.fillRect(0, 0, cssW, cssH);
    }

    // Structures — pixel buildings; clusters of them read as villages.
    for (const s of sim.structures) {
      const px = offX + (s.location.x + 0.5) * ppt;
      const py = offY + (s.location.y + 0.5) * ppt;
      drawStructure(ctx, px, py, s.type, ppt);
    }

    // Settlements — rings + names.
    for (const st of sim.settlements) {
      const px = offX + (st.center.x + 0.5) * ppt;
      const py = offY + (st.center.y + 0.5) * ppt;
      // Ring colour reflects the village's temperament: gold when peaceable,
      // red when warlike.
      const hostile = st.culture.aggression;
      const rr = Math.round(180 + hostile * 70);
      const gg = Math.round(196 - hostile * 130);
      const bb = Math.round(106 - hostile * 60);
      ctx.strokeStyle = `rgba(${rr},${gg},${bb},0.7)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, ppt * 2, 0, Math.PI * 2);
      ctx.stroke();
      if (ppt > 9) {
        ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(st.name, px, py - ppt * 2.1);
      }
      // Faith shrine: a small diamond in the belief's colour marks a devout village.
      if (st.beliefId) {
        const faith = sim.beliefs.find((b) => b.id === st.beliefId);
        if (faith) {
          const sz = Math.max(2.5, ppt * 0.5);
          ctx.fillStyle = `hsl(${faith.hue},70%,${Math.round(45 + st.devotion * 20)}%)`;
          ctx.beginPath();
          ctx.moveTo(px, py - ppt * 1.55 - sz);
          ctx.lineTo(px + sz, py - ppt * 1.55);
          ctx.lineTo(px, py - ppt * 1.55 + sz);
          ctx.lineTo(px - sz, py - ppt * 1.55);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Transient links between settlements: teal caravans for trade, red flashes
    // for raids. TTL scales with view speed so they stay visible ~1s of real
    // time whether we're watching at 1x or 60x.
    const ttl = Math.max(20, speed * 14);
    for (const link of sim.links) {
      const age = sim.tick - link.tick;
      if (age < 0 || age > ttl) continue;
      const op = 1 - age / ttl;
      const fx = offX + (link.from.x + 0.5) * ppt;
      const fy = offY + (link.from.y + 0.5) * ppt;
      const tx = offX + (link.to.x + 0.5) * ppt;
      const ty = offY + (link.to.y + 0.5) * ppt;
      if (link.kind === "trade") {
        ctx.strokeStyle = `rgba(127,214,192,${(op * 0.8).toFixed(3)})`;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        const t = age / ttl; // caravan glides from sender to receiver
        const mx = fx + (tx - fx) * t;
        const my = fy + (ty - fy) * t;
        ctx.fillStyle = `rgba(190,245,225,${op.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(mx, my, Math.max(2, ppt * 0.13), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = `rgba(239,111,111,${(op * 0.85).toFixed(3)})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        // expanding flash at the victim
        ctx.strokeStyle = `rgba(255,120,110,${op.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tx, ty, ppt * (0.4 + (1 - op) * 1.8), 0, Math.PI * 2);
        ctx.stroke();
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
  }, [sim, selectedCharId, zoom, speed]);

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

// The civilisation's standout individuals — gives the viewer named characters
// to follow as lineages rise and fall.
// The world's emergent religions: who follows them and what they preach.
function Faiths({ sim }: { sim: SimulationState }): JSX.Element {
  const followers = new Map<string, number>();
  for (const s of sim.settlements) if (s.beliefId) followers.set(s.beliefId, (followers.get(s.beliefId) ?? 0) + s.memberIds.length);
  const living = sim.beliefs.filter((b) => followers.has(b.id));
  if (!living.length) return <Muted>No faiths yet — the people have not turned to belief.</Muted>;
  const tenetWord = (b: SimulationState["beliefs"][number]): string => {
    const t = b.tenets;
    const traits: string[] = [];
    if (t.aggression > 0.4) traits.push("militant");
    else if (t.cooperation > 0.4) traits.push("communal");
    if (t.innovation > 0.4) traits.push("inquisitive");
    if (t.fertility > 0.5) traits.push("fecund");
    if (t.aggression < -0.3) traits.push("pacifist");
    return traits.length ? traits.join(", ") : "quiet";
  };
  return (
    <div>
      {living
        .sort((a, b) => (followers.get(b.id) ?? 0) - (followers.get(a.id) ?? 0))
        .map((b) => (
          <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 12.5 }}>
            <span style={{ width: 12, height: 12, flex: "0 0 auto", borderRadius: 3, background: `hsl(${b.hue},65%,60%)`, boxShadow: `0 0 6px hsl(${b.hue},65%,60%)` }} />
            <div>
              <div>
                <b>{b.name}</b> <span style={{ color: "#778" }}>· {followers.get(b.id)} faithful</span>
              </div>
              <div style={{ color: "#8a8f98", fontSize: 11 }}>{tenetWord(b)}</div>
            </div>
          </div>
        ))}
    </div>
  );
}

function NotableLives({ sim, onSelect }: { sim: SimulationState; onSelect: (id: string) => void }): JSX.Element {
  const alive = sim.characters.filter((c) => c.alive);
  if (!alive.length) return <Muted>No one is left alive.</Muted>;
  const pick = (f: (c: Character) => number): Character => alive.reduce((a, b) => (f(b) > f(a) ? b : a));
  const eldest = pick((c) => c.ageDays);
  const prolific = pick((c) => c.lineage.children.length);
  const brightest = pick((c) => c.genetics.intelligence);

  const Item = ({ label, c, stat }: { label: string; c: Character; stat: string }): JSX.Element => (
    <div
      onClick={() => onSelect(c.id)}
      style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "3px 0" }}
      title={`Follow ${c.name}`}
    >
      <span
        style={{
          width: 16,
          height: 16,
          flex: "0 0 auto",
          borderRadius: c.appearance.form > 0.5 ? "50%" : 3,
          background: appearanceColor(c),
          boxShadow: `0 0 6px ${appearanceColor(c)}`,
        }}
      />
      <div style={{ fontSize: 12.5, lineHeight: 1.25 }}>
        <div>
          {c.name} <span style={{ color: "#778" }}>{c.sex === "female" ? "♀" : "♂"}</span>
        </div>
        <div style={{ color: "#8a8f98", fontSize: 11 }}>
          {label} · {stat}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <Item label="Eldest" c={eldest} stat={`${Math.floor(eldest.ageDays / 365)} years old`} />
      <Item label="Most children" c={prolific} stat={`${prolific.lineage.children.length} children`} />
      <Item label="Brightest" c={brightest} stat={`intellect ${brightest.genetics.intelligence.toFixed(2)}`} />
    </div>
  );
}

function Inhabitant({ c, sim, onSelect }: { c: Character; sim: SimulationState; onSelect: (id: string) => void }): JSX.Element {
  const settlement = sim.settlements.find((s) => s.id === c.settlementId);
  const byId = new Map(sim.characters.map((p) => [p.id, p] as const));
  const kin = (id: string): Character | undefined => byId.get(id);
  const partner = c.partnerId ? kin(c.partnerId) : undefined;
  const parents = c.lineage.parents.map(kin).filter((p): p is Character => !!p);
  const children = c.lineage.children.map(kin).filter((p): p is Character => !!p);

  const KinChip = ({ p }: { p: Character }): JSX.Element => (
    <span
      onClick={() => onSelect(p.id)}
      title={`Follow ${p.name}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        cursor: "pointer",
        background: "#1a1d26",
        border: "1px solid #2c303c",
        borderRadius: 10,
        padding: "1px 7px 1px 4px",
        margin: "2px 4px 0 0",
        fontSize: 11.5,
        opacity: p.alive ? 1 : 0.55,
      }}
    >
      <span style={{ width: 9, height: 9, borderRadius: p.appearance.form > 0.5 ? "50%" : 2, background: appearanceColor(p) }} />
      {p.name}
      <span style={{ color: "#667" }}>{p.alive ? `${Math.floor(p.ageDays / 365)}` : "†"}</span>
    </span>
  );

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 18, height: 18, borderRadius: c.appearance.form > 0.5 ? "50%" : 3, background: appearanceColor(c), boxShadow: `0 0 6px ${appearanceColor(c)}` }} />
        <b>{c.name}</b>
        <span style={{ color: "#778" }}>
          {c.sex === "female" ? "♀" : "♂"} · gen {c.lineage.generation} · {c.alive ? `${Math.floor(c.ageDays / 365)} yrs` : "deceased"}
        </span>
      </div>
      <Row k="Stage / health" v={`${c.lifeStage} · ${c.health.toFixed(0)} hp`} />
      <Row k="Hunger / thirst" v={`${c.needs.hunger.toFixed(0)} / ${c.needs.thirst.toFixed(0)}`} />
      <Row k="Doing now" v={c.lastAction} />
      <Row k="Learned leaning" v={topActions(c.strategy)} />
      <Row k="Intellect / educ." v={`${c.genetics.intelligence.toFixed(2)} / ${c.education.toFixed(2)}`} />
      <Row k="Settlement" v={settlement?.name ?? "—"} />
      <div style={{ color: "#8a8f98", marginTop: 4, fontStyle: "italic" }}>{c.lastDecisionReason}</div>

      <div style={{ borderTop: "1px solid #23252c", marginTop: 8, paddingTop: 6 }}>
        <div style={{ fontSize: 11, color: "#8a8f98" }}>Lineage — tap to follow a relative</div>
        {partner ? (
          <div style={{ marginTop: 3 }}>
            <span style={{ color: "#8a8f98", fontSize: 11 }}>partner</span> <KinChip p={partner} />
          </div>
        ) : null}
        {parents.length ? (
          <div style={{ marginTop: 3 }}>
            <span style={{ color: "#8a8f98", fontSize: 11 }}>parents</span> {parents.map((p) => <KinChip key={p.id} p={p} />)}
          </div>
        ) : null}
        <div style={{ marginTop: 3 }}>
          <span style={{ color: "#8a8f98", fontSize: 11 }}>children ({children.length})</span>{" "}
          {children.length ? children.slice(0, 16).map((p) => <KinChip key={p.id} p={p} />) : <Muted>none</Muted>}
        </div>
      </div>
    </div>
  );
}

function SettlementView({ s, sim }: { s: Settlement; sim: SimulationState }): JSX.Element {
  const leader = sim.characters.find((c) => c.id === s.leaderId);
  const faith = sim.beliefs.find((b) => b.id === s.beliefId);
  return (
    <div style={{ fontSize: 13 }}>
      <Row k="People" v={String(s.memberIds.length)} />
      <Row k="Households" v={String(s.householdIds.length)} />
      <Row k="Structures" v={String(s.structures.length)} />
      <Row k="Founded (yr)" v={String(Math.floor(s.foundedTick / 365))} />
      <Row k="Elder/leader" v={leader?.name ?? "—"} />
      <Row k="Faith" v={faith ? `${faith.name} (devotion ${s.devotion.toFixed(2)})` : "none"} />
      <Row k="Cooperation" v={s.culture.cooperation.toFixed(2)} />
      <Row k="Aggression" v={s.culture.aggression.toFixed(2)} />
      <Row k="Trade openness" v={s.culture.tradePreference.toFixed(2)} />
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
