# CS Demo Analyst

Desktop app (Electron + Angular + Bulma) for reading Counter-Strike demos,
consolidating tactical patterns across matches, scoring individual player
performance, and keeping a per-team analyst notebook — everything saved
locally, no database, no server.

Built for analysts and coaches — freelance or on amateur/semi-pro teams —
who track more than one opponent at a time and need scrim/scouting data to
stay private, with AI reports running on their own API key instead of a
SaaS subscription.

## Features

- **Slot management** — 1 "own team" slot + 20 opponent slots, each holding
  up to 100 demos.
- **Demo parsing** — real extraction via `demoparser2` (buy type, tempo,
  stance, site, per-round positions, grenades, kills/deaths, and per-player
  aggregates), run through a local Python script.
- **Per-demo roster marking** — mark which 5 steamIDs are "your team" in each
  demo; the app resolves CT/T per round from that (handles the halftime side
  swap) instead of relying on which side started the match.
- **Tactical pattern consolidation** (no AI, instant, local) — win rate by buy
  type / round tempo / round stance, most recurring compra+ritmo+postura+site
  combinations, and a player movement/impact profile (ADR, entry rate, clutch
  rate, favorite map areas). See [How tactical patterns are
  computed](#how-tactical-patterns-are-computed-no-ai).
- **Consolidated Score** — Aim / Utility / Positioning / Rating / Overall
  score (0-100) per player, averaged across every demo where the roster is
  marked, with full per-demo history and CSV export. See [How scores are
  calculated](#how-scores-are-calculated).
- **2D animated replay** ("Mapa 2D" tab) — canvas replay per round with a
  scrub bar, play/pause, speed control, live scoreboard (HP/armor/weapon/
  money), kill/death markers, grenade trajectories and effects (smoke,
  molotov, flash, HE, decoy), bomb plant/defuse/explode HUD, and a per-player
  timeline of that round's events. Uses the real CS2 radar images when it can
  find a local CS2 install (extracted once, reused after); falls back to a
  plain grid otherwise.
- **Heatmap** — per-player, per-map position heatmap (overall / CT side / T
  side), built from the same parsed position samples.
- **Analyst Notebook** — free-form Markdown notes per slot with a `/`
  slash-command menu, autosave, and version history (checkpoints every few
  minutes of editing, restorable).
- **AI analysis** — sends the locally consolidated stats (never raw demo
  data or tick-by-tick positions) plus the analyst's notebook to a
  configurable AI provider, which returns a structured report. Two modes:
  a **development report** for your own team, or a **scouting/matchup prep
  report** for an opponent slot. You can focus the analysis on the whole
  team or on specific players.
- **Pluggable AI providers** — Anthropic, OpenAI, a custom HTTP endpoint, or
  a Mock provider (returns the exact prompt that would be sent, so you can
  check the data without spending real credit). API keys are encrypted
  locally via Electron's `safeStorage` and never leave the main process.
- **Slot export/import** — package a slot's demos + notebook into a single
  `.csda-slot` file to hand to another analyst or move between machines
  (dedupes by file+map+score, merges rosters, keeps your local notebook as
  the source of truth and files the imported one into history instead of
  overwriting).
- **PT/EN UI** — every screen is available in Portuguese and English, toggled
  instantly from the sidebar footer (persisted per device).
- **Fully local** — no backend, no telemetry, no database; everything lives
  under the Electron user-data folder.

## How scores are calculated

Every player gets four **sub-scores** (Aim, Utility, Positioning, Rating) and
one **Overall score**, each on a 0-100 scale, computed per demo
(`electron/ai/scoreEngine.ts`) and then averaged across every demo in the
slot where that player's team roster was marked.

**Normalization.** Every sub-metric is mapped linearly onto 0-100 against a
target range `[targetMin, targetMax]` and clamped:

```
normalized = clamp((value - targetMin) / (targetMax - targetMin) * 100, 0, 100)
```

For "lower is better" metrics (crosshair placement, time to damage/kill,
team-damage penalties, wasted utility, etc.) `targetMin` is simply set higher
than `targetMax`, which flips the direction automatically. Each sub-score is
the weighted average of its normalized sub-metrics.

- **Aim score** — 10 sub-metrics: accuracy, head accuracy, HS kill %, first
  bullet accuracy, spray accuracy, counter-strafing %, crosshair placement
  (degrees), spotted accuracy, time to damage, time to kill. Weights and
  target ranges were seeded from a Leetify-style 0-5 importance matrix
  (normalized to sum to 1.0) and then partially recalibrated against one
  real reference point — a FACEIT Level 10 stat line the user supplied,
  pinned to land at ≈82/100.
- **Utility score** — a **quality** component (70%: effective flash %,
  friendly-flash penalty, average HE/Molotov damage, team-damage penalty,
  wasted-smoke penalty, flash→kill %, unused-utility-on-death penalty) and a
  **quantity** component (30%: grenades thrown per round, targeted at
  0.3-1.2/round). Same seeding approach as Aim — a Leetify-style weight
  matrix plus one FACEIT Level 10 reference point pinned at ≈60/100.
- **Positioning score** — 7 sub-metrics: traded-death %, isolated-death
  penalty, trade-kill %, trade delay (ms, within a 3s window), opening-duel
  win %, overexposure penalty, and average distance to the nearest teammate.
  No real reference point yet for this one — ranges are a competitive-CS
  heuristic to be recalibrated once more demo data is available.
- **Rating (impact) score** — added later to also reward raw production and
  the value of winning a round even at a cost. 4 sub-metrics: KPR (kills per
  round), ADR, clutch win %, and "opening sacrifice %" — how often this
  player is the round's first death *and the team still wins the round*
  (they bought information/space with that death). This last one is
  distinct from Positioning's `openingDuelWinPct`, which tracks who *wins*
  the opening duel, not who dies opening it usefully.
- **Overall score** — a fixed blend: `Aim 50% + Rating 25% + Utility 15% +
  Positioning 10%`.

All of this is a **starting point, not a validated model**: the weights come
from an externally supplied importance matrix and, where available, a single
real reference stat line per category — not a regression fit against a large
labeled dataset. Treat the numbers as directionally useful and tune the
constants in `scoreEngine.ts` once you have enough real games to calibrate
against.

**Confidence badge.** Because the model isn't statistically validated, the
consolidated view also shows a **Low/Medium/High confidence** badge next to
each player's aggregate score, based purely on how many demos went into that
average (`computeScoreConfidence` in `scoreEngine.ts`: <3 demos = low, 3-7 =
medium, 8+ = high). It's not a real confidence interval — no standard
deviation involved — just a visual cue so a 2-demo sample and a 40-demo
sample don't read with the same weight. Same spirit as the
`tempoStanceThresholdSource` flag below.

**Recalibrating the ranges.** `scripts/calibrate-scores.js` computes real
percentiles (default p15/p85) for every sub-metric from a folder of already-
parsed demos (point it at any directory containing `summary.json` files —
including the app's own `slots/` folder under userData — it walks
recursively and uses all 10 players per demo, not just a marked roster, since
calibration wants spread across skill levels, not "your team" filtering):

```bash
node scripts/calibrate-scores.js <path-to-demos-folder>
```

It prints a report (current vs. suggested `targetMin`/`targetMax` per
sub-metric, sample count, and a low-sample warning below `--min-samples`,
default 15) — it does **not** edit `scoreEngine.ts` itself, since each weight
block there carries hand-written provenance comments a script shouldn't
silently overwrite. Apply the suggested ranges manually (keep the `weight`
values as-is — this only recalibrates ranges, not importance), then bump
`SCORING_MODEL_VERSION` in `scoreEngine.ts` to whatever the script suggests
(e.g. `v2-percentile-N84-2026-09-02`) so the version tag shown next to each
player's score in the Consolidated tab changes too — that's what makes a
recalibration visible instead of the number just silently drifting between
sessions. This still isn't a labeled/regression-fit model, but real
percentiles from a real (even if small) distribution are a meaningfully
better foundation than a single reference stat line.

## How tactical patterns are computed (no AI)

`electron/ai/localHeuristics.ts` consolidates every demo in a slot, split
into "your team" vs "opponent" using the marked roster (side is resolved
**per round**, so a halftime swap doesn't corrupt the split):

- **Buy type / tempo / stance** classification happens in the Python parser
  (`classify_buy_type` and friends in `parse_demo.py`) using **per-demo
  dynamic thresholds**: instead of one fixed "rush = moved > 900 units"
  constant for every map, the 33rd/67th percentile of the displacement
  distribution *observed inside that same demo* is used, so the same logic
  adapts to a fast map like de_dust2 and a slower one without a
  map-by-map lookup table. With very few rounds (<6) this is noisy, so each
  demo's summary carries a `calibration.tempoStanceThresholdSource` flag
  (`'demo'` or `'default'`), and the UI/AI prompt warn when a demo fell back
  to the generic default because it didn't have enough rounds to calibrate
  itself.
- Win rate is tracked per buy type, per tempo, per stance, and per
  `buyType/tempo/stance/site` combination (the "recurring patterns" table),
  each with an occurrence count so low-sample noise is visible rather than
  hidden.
- A **player movement/impact profile** is built per player: average ADR,
  entry (opening duel) attempt/success rate, clutch rate, kills/deaths, and
  the top 5 most-visited map areas (from CS2's own `last_place_name` per
  tick — no manual per-map callout polygon mapping needed).
- Demos with no roster marked are excluded and listed in
  `demosPendingRoster` (surfaced in the UI and in the AI prompt) until
  someone marks them.

## Architecture

```
electron/            main process (Node) — never reachable from Angular directly
  main.ts             creates the window, registers the IPC handlers
  preload.ts          safe bridge (contextBridge) exposed as window.electronAPI
  storage/
    types.ts           shared types (same shape as src/app/core/models)
    slotManager.ts      CRUD for the 21 slots (1 own + 20 opponents), demos, notebook
    settingsManager.ts  AI config (default provider + encrypted keys)
  ai/
    demoParserBridge.ts  calls the Python script that does the real demo parsing
    localHeuristics.ts   tactical pattern consolidation (no AI token cost)
    scoreEngine.ts        Aim/Utility/Positioning/Rating/Overall score calculation
    providers.ts           HTTP calls to AI providers (Anthropic/OpenAI/custom)
    analysisRunner.ts      builds the AI prompt from local stats + notebook, calls the provider
  __tests__/            Jest unit tests (`npm run test:electron`)

python/
  parse_demo.py         Real parser built on `demoparser2` (pip install -r python/requirements.txt).
  requirements.txt      Parser dependency (demoparser2, pinned).
  requirements-dev.txt  Adds pytest for `python/tests/`.
  tests/                pytest unit tests for the parser.

src/app/
  core/                 models + ElectronService (window.electronAPI wrapper) + TranslationService
  shared/pipes/          `translate` pipe (PT/EN dictionary lookup)
  features/
    shell/               sidebar (21 slots + PT/EN switch) and titlebar
    slot-detail/          a slot's screen: Overview / 2D Map / Heatmap / Demos / Notebook / AI / Consolidated
    map2d/                2D animated replay
    heatmap/              per-player position heatmap
    notebook/              Markdown editor with autosave + history
    ai-settings/           global AI provider configuration screen
```

## Where data is stored

Everything lives inside Electron's user-data folder
(`app.getPath('userData')`), with no external server or database:

- Windows: `%APPDATA%/cs-demo-analyst/`
- macOS: `~/Library/Application Support/cs-demo-analyst/`
- Linux: `~/.config/cs-demo-analyst/`

Inside it: `slots/<slot-id>/{meta.json, notebook.md, notebook-history/, demos/<demo-id>/{record.json, summary.json}}`
plus `ai-settings.json` and `keys/*.key` (API keys encrypted with `safeStorage`).

## Running in development

```bash
npm install
npm start
```

This starts `ng serve` (port 4200) and, once it's ready, opens the Electron
window pointing at it. Angular hot-reload works as usual; if you change
anything under `electron/`, stop (Ctrl+C) and run `npm start` again.

### Python parser setup

```bash
pip install -r python/requirements.txt
```

`demoParserBridge.ts` calls the system `python`/`python3` in development;
once `app.isPackaged` it switches to the bundled embeddable runtime instead
(`npm run setup:python-runtime` — see "Python packaging" below).

### Tests

```bash
npm test              # Angular (Karma/Jasmine)
npm run test:electron # main-process logic (Jest, electron/__tests__/**/*.test.ts)
pip install -r python/requirements-dev.txt && pytest python/tests  # parser (pytest)
```

`tsconfig.electron.json` (used by `npm run build:electron`, part of
`build:prod`) excludes `electron/**/__tests__/**` — it only has `"types":
["node"]`, so letting it pick up `*.test.ts` files fails on the Jest globals
(`describe`/`it`/`expect`). Test files are type-checked separately by
`ts-jest` via `tsconfig.electron.spec.json` when you run `test:electron`.

## AI providers

Configurable in AI Settings: Anthropic (Claude), OpenAI, or a custom HTTP
endpoint (for whichever other AI you prefer). The key is encrypted locally
via Electron's `safeStorage` and is never sent back to Angular in plain
text — it's only used inside the main process when calling the provider.

Each analysis sends the AI **only** the locally consolidated summary
(`ConsolidatedSlotStats` from `localHeuristics.ts`, plus the per-player
scores from `scoreEngine.ts`) and the analyst's notebook text — never the
raw demo or tick-by-tick positions — to keep token usage low even with
dozens of demos per team.

## What's left (suggested order)

1. **macOS/Linux packaging** — Python packaging is done for Windows (see
   Architecture: an embeddable Python runtime bundled via
   `npm run setup:python-runtime`, instead of a PyInstaller binary, which
   has a history of silently mishandling `demoparser2`, a Rust/PyO3 native
   extension). No `mac`/`linux` target is wired up yet in `package.json`'s
   `build` config — the same approach would need
   `python-build-standalone` instead of the Windows-only embeddable zip.
2. **Finer map callouts** — area labeling currently comes for free from
   CS2's own `last_place_name` per tick, with no manual per-map polygon
   mapping. Splitting broader areas (e.g. distinguishing "A-site" from
   "A-Ramp") is a later nice-to-have if it turns out to matter.
3. **Validate tempo/stance classification against human-labeled rounds** —
   per-demo dynamic percentile thresholds replaced the old fixed constants
   (see [How tactical patterns are
   computed](#how-tactical-patterns-are-computed-no-ai)), but the
   classification itself hasn't been checked against human-labeled rounds,
   only the scale it's measured on.
4. **Recalibrate player scoring against real match data** — Aim / Utility /
   Positioning / Rating / Overall (see [How scores are
   calculated](#how-scores-are-calculated)) is still a heuristic model, not
   a statistically validated one. `scripts/calibrate-scores.js` can compute
   real percentile ranges from a folder of parsed demos, but the sub-metric
   weights still come from an externally supplied importance matrix, not a
   regression fit against labeled outcomes.
