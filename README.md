# Digital World

An **autonomous digital civilisation** that begins as **two beings** and grows, learns, and invents entirely on its own. It is a separate species — not humans — that develops its **own language, its own technologies, its own ages, its own way of living, and even its own evolving appearance**. None of that is scripted: it emerges from the simulation.

You don't play it. You **watch** it.

> Inspired by the Black Mirror premise of a self-contained world of beings who live their own lives while we observe from outside.

## What is and isn't authored

A simulation needs a substrate — laws of physics — for emergence to mean anything. The line this project draws:

- **Coded (the universe's laws):** how needs grow, how aging and mortality curves work, how resources regrow, how genetics blend, the probability scaffolding for reproduction and discovery. These are the *physics*, not the culture.
- **Emergent / self-learning (the civilisation):** what each being chooses to do, who pairs with whom, where settlements form, which technologies get invented and in what order, what the language sounds like and which words exist, how the species looks, and how all of it changes over generations.

So it is **not** literally "zero coded rules" — that's impossible, and we don't claim it. What *is* true is that **none of the culture, behaviour, technology, language, social structure, or appearance is hardcoded** — it is learned and evolved.

## The self-learning core

Every being carries a vector of **action propensities** (`forage`, `cultivate`, `hunt`, `build`, `craft`). Each tick it **collapses those weighted possibilities into one chosen action probabilistically** — biased by what it has learned, never by a fixed `if/else`. Three forces shape those weights:

1. **Reinforcement (within a life):** an action that improved wellbeing gets reinforced; one that didn't decays.
2. **Inheritance (across lives):** children are born with a blend of their parents' learned leanings, plus mutation — cultural transmission, not a blank slate.
3. **Imitation (across society):** beings nudge their strategy toward the most flourishing neighbour they meet.

Division of labour, the "discovery" of cultivation, the rise of builders and crafters — all of it **emerges** from this loop as the invented technologies shift what pays off.

## Emergent technology, ages, and language

- **Technology** is a growing tree of **self-invented techniques**. Each discovery has randomly-generated effects (better yields, medicine, fertility, capacity, faster learning…) and builds on the last, with **exponentially rising cost** so inventions stay rare and meaningful. Every run invents a *different* tech path.
- **Ages (epochs)** are **recognised, not prescribed** — when accumulated complexity crosses an emergent threshold, the people name a new age **in their own language**. Never "Bronze Age."
- **Language** is generated per civilisation: its own phoneme inventory at genesis, a lexicon that grows as it coins words for new things, and slow sound-drift over time. People, settlements, inventions, epochs and elements are all named in it.
- **Elements** are the world's own matter — four procedurally-named substances, each filling a universal role (something to eat, drink, build with, work) but bearing *their* name and colour, not Earth's food/water/wood/stone.
- **Appearance** is a heritable visual genome (hue, luminance, form, size, pattern) that blends, mutates, and drifts under mild climate selection — the species' *look* evolves over generations and differs between worlds.

## The living world

- **Genesis from two.** A single founding pair on the best land; the whole civilisation descends from them. The pair is shielded from random death only until the colony establishes, so the line can reliably take hold.
- **Time runs in days.** Generations turn over in observable time: childhood, adulthood, elderhood, death by starvation, exposure, accident, disease, or old age (a Gompertz curve eased by their own medicine).
- **Families & settlements.** Pair-bonding forms households with shared stores; clusters of households become **persistent settlements** with leaders, evolving culture, knowledge, food-sharing, founding and collapse.
- **A physical civilisation** built from found resources — shelters, stores, cultivation grounds, workshops.
- **Climate epochs.** The world starts frozen and slowly thaws, pushing migration and adaptation.
- **Evolution under selection.** Mortality and reproduction filter genetics, so intelligence, resilience and appearance drift and adapt across generations — differently in every world.

## It never resets, and grows while closed

The world is **persistent**. It is saved continuously and on close, and on reopen it **fast-forwards by the real time that elapsed while you were away** (about two days of its life per real second away, capped so a long absence still loads fast). So it always continues exactly where it left off — plus the life it lived in the background — and never restarts from scratch.

### Two modes of persistence

- **Shared world (when a store is attached):** a single world that *every visitor sees*, advancing by real elapsed time on each request and via an hourly cron — so it grows 24/7, even when no one is watching. Served by `api/world.ts` (a Vercel serverless function) backed by Vercel KV. The header shows a **● shared world** badge.
- **Local world (fallback):** if no store is configured, each browser grows its own world in local storage and catches up on reopen. The header shows **○ local world**. The site always works either way.

### One-time setup for the shared world on Vercel

1. Import the repo at **vercel.com/new** (zero config — it auto-detects Vite; the `api/` folder deploys as serverless functions).
2. In the project: **Storage → Create → KV**, and connect it (Vercel injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`). That single step flips the site from local to shared.
3. The hourly cron in `vercel.json` keeps the world advancing with no traffic (cron frequency depends on your Vercel plan; compute-on-read advances it on every visit regardless).

> Heads up: the serverless + KV path could not be exercised in the build sandbox (no Vercel runtime/KV there). It is written to degrade gracefully — if anything is misconfigured, visitors simply get the local world instead of an error.

## Drives, not scripted responses

A deliberate design choice pushes as much as possible out of "coded behaviour" and into *learning*. Beings are **not** told "eat when hungry → good" or "you have no shelter → build." Instead they have **felt drives** (hunger, thirst, cold) and a single learning rule, and they **discover** what resolves those drives:

- Action value is **not hinted** — the only innate priors are physical feasibility and bodily capability. Whether cultivating or hunting is *worth it* is learned from reward.
- Shelter-building arises from a **felt thermoregulatory drive** (cold urges shelter-seeking) that can override learned habit — a real organism's instinct, not a strategic rule.
- Learning is **advantage-based and regularised**: an action is reinforced only by how much it beat the being's own running average, so the population *specialises* by body and surroundings (an agrarian majority with situational hunters and builders) rather than everyone doing the same thing or maxing out everything.

This is the honest version of "self-learning": a minimal coded substrate (physics + drives + one learning rule) with the behaviour discovered on top — the same shape as biological learning.

## Architecture

```text
src/
  sim/
    core/      types, world generation, character factory, language
    systems/   simulation.ts — the autonomous per-day loop
    storage/   snapshot save/load
    util/      seeded RNG, ids, names
  ui/          App.tsx — the observatory (watch & inspect only)
tests/         regression tests for the emergent behaviour
```

The simulation core is **pure, deterministic TypeScript** (seeded RNG, no wall-clock, no randomness outside the seed) so any run is reproducible and serialisable. The React layer is a **pure observer** — it can inspect beings, settlements, the chronicle, the tech tree and the language, but it can never influence the world.

## Run

```bash
npm install
npm run dev
```

## Test & build

```bash
npm test
npm run build
```

## Honest limits

This is a deep emergent simulation, not a literal recreation of all of life. There is no symbolic language *grammar* yet (only a lexicon), no art/religion modelled explicitly, and the "physics" of needs and mortality are authored constants. Natural next frontiers: emergent grammar and meaning, inter-settlement trade and conflict, belief systems, and a richer material/chemistry layer the beings can synthesise. The foundation is built so these can be added as further emergent systems rather than scripted ones.
