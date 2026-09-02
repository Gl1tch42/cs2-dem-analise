# Developer Guide

This document is for anyone working on the **CS Demo Analyst** codebase. It
covers the stack, how the pieces fit together, and where to look for what.
For a product-level description of features and how the analytics are
computed, see [README.md](README.md) — this doc assumes you've skimmed that
and focuses on *how it's built* rather than *what it does*.

## 1. Stack at a glance

| Layer | Technology |
|---|---|
| Desktop shell | **Electron 30** (main process in Node, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) |
| UI | **Angular 17** (standalone components, no NgModules), **Bulma** for CSS, **SCSS** for component styles |
| Rich text | **Tiptap 3** (notebook editor, Markdown-backed via `tiptap-markdown`) |
| Demo parsing | **Python 3.11** script (`python/parse_demo.py`) built on **`demoparser2`** (a Rust/PyO3 native extension), invoked as a child process from the main process |
| Language | **TypeScript** everywhere except the parser (Python) |
| State/storage | No database — plain JSON files under Electron's `userData` folder |
| AI | HTTP calls to Anthropic / OpenAI / a custom endpoint, made from the **main process only** (never from the renderer) |
| Build | Angular CLI (`ng build`) for the renderer, plain `tsc` for the Electron main process, **electron-builder** for packaging |
| Tests | **Karma/Jasmine** (Angular), **Jest** (`ts-jest`) for `electron/`, **pytest** for the Python parser |

There is **no backend server** and **no database**. Everything the app needs
persists as files on disk; the only network calls are outbound to whichever
AI provider the user configures, made from the Electron main process.

## 2. Process architecture (Electron)

Electron apps have two process types, and this app keeps a hard boundary
between them — the renderer (Angular) never touches Node or the filesystem
directly:

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Renderer process (Angular) │        │  Main process (Node/Electron) │
│  src/app/**                 │        │  electron/**                  │
│                              │  IPC   │                                │
│  ElectronService             │◄──────►│  ipc/handlers.ts               │
│  (window.electronAPI)        │ invoke │  registers ipcMain.handle(...)│
└─────────────────────────────┘        └──────────────────────────────┘
                                                    │
                                     spawns child process for parsing
                                                    ▼
                                        python/parse_demo.py (demoparser2)
```

- **`electron/main.ts`** — creates the `BrowserWindow` (frameless, custom
  titlebar), loads `http://localhost:4200` in dev or the built
  `dist/cs-demo-analyst/browser/index.html` in production, and wires up
  `SlotManager` / `SettingsManager` / `registerIpcHandlers`.
- **`electron/preload.ts`** — the *only* file allowed to bridge the two
  worlds. It uses `contextBridge.exposeInMainWorld('electronAPI', api)` to
  expose a narrow, typed surface (`slots`, `demos`, `assets`, `ai`, `app`,
  `window`) — each method is a thin wrapper around `ipcRenderer.invoke(...)`.
  Nothing else from Node/Electron is reachable from Angular.
- **`electron/ipc/handlers.ts`** — the main-process side of every channel
  declared in `preload.ts`. This is where slot CRUD, demo import (opens a
  native file dialog, then calls the Python parser), AI analysis requests,
  slot export/import (gzip a JSON bundle), and window controls
  (minimize/maximize/close, since the window is frameless) all live.
- **`src/app/core/services/electron.service.ts`** — the Angular-side mirror
  of the preload API. It re-declares `window.electronAPI`'s shape (so
  Angular code gets type-checking) and exposes it via `ElectronService.api`.
  Every Angular component/service that needs Electron functionality injects
  `ElectronService` and calls `this.electron.api.<namespace>.<method>(...)`
  — nothing calls `window.electronAPI` directly outside this file.

Adding a new capability that touches the filesystem, Python, or an external
API always means touching three files in lockstep: `preload.ts` (declare
the channel), `ipc/handlers.ts` (implement it), and
`electron.service.ts` (declare the type on the Angular side).

## 3. Main-process modules (`electron/`)

```
electron/
  main.ts                 window creation, app lifecycle
  preload.ts               contextBridge surface → window.electronAPI
  ipc/
    handlers.ts             all ipcMain.handle(...) registrations
  storage/
    types.ts                 shared types (demo summaries, scores, slots, AI settings)
    slotManager.ts            CRUD for the 21 slots, demos, notebook + history, export/import
    settingsManager.ts        AI provider config, encrypted API keys (safeStorage)
    radarCalibration.ts       per-map pixel↔world calibration for the 2D radar
                                (duplicated verbatim in src/app/features/map2d/
                                radar-calibration.ts — main and renderer can't
                                share a module, so keep both in sync by hand)
  ai/
    demoParserBridge.ts       spawns the Python parser as a child process
    localHeuristics.ts        tactical pattern consolidation (pure computation, no AI/network)
    matchupEngine.ts          own-slot vs. opponent-slot cross-reference (pure computation)
    scoreEngine.ts            Aim/Utility/Positioning/Rating/Overall scoring (pure computation)
    providers.ts              HTTP calls to Anthropic/OpenAI/custom endpoints
    analysisRunner.ts         builds the AI prompt from local stats + notebook, calls providers.ts
    radarExtractor.ts         finds a local CS2 Steam install, downloads/uses
                                Source2Viewer-CLI.exe (ValveResourceFormat) to pull
                                real radar images out of the game's VPK, caches them
                                under userData (falls back to a plain grid if no
                                local CS2 install is found)
  __tests__/                Jest unit tests, one file per ai/* module
```

Everything under `ai/` except `providers.ts` and `analysisRunner.ts` is a
**pure function of already-parsed demo data** — no I/O, no network, no
Electron APIs — which is why they're straightforward to unit test with Jest
(see `electron/ai/__tests__/`).

`types.ts` is the single source of truth for the data shapes (`DemoSummary`,
`RoundSummary`, `PlayerAggregate`, `PlayerAimStats` /
`PlayerUtilityStats` / `PlayerPositioningStats` / `PlayerImpactStats`,
`PlayerScoreAggregate`, `AiSettings`, `SlotMeta`/`SlotDetail`,
`SlotExportBundle`, etc.). `src/app/core/models/slot.model.ts` mirrors the
same shapes for the Angular side — when you change one, update the other.

## 4. Renderer (`src/app/`)

Angular 17, standalone components (no `NgModule`s), routed with
`app.routes.ts`:

```
src/app/
  app.component.ts          root shell (sidebar + titlebar + <router-outlet>)
  app.routes.ts              'slot/:id' and 'config-ia', default redirect → 'slot/own'
  core/
    models/slot.model.ts      TS types mirroring electron/storage/types.ts
    services/
      electron.service.ts     typed window.electronAPI wrapper (see §2)
      translation.service.ts   PT/EN toggle; PT strings are the source text (used
                                 as dict keys directly), EN is a PT→EN lookup table
                                 in core/i18n/en.ts (falls back to the PT string
                                 if a key isn't translated yet)
  shared/
    pipes/                    `translate` pipe used across templates
  features/
    shell/                    sidebar (21 slots + PT/EN toggle) and custom titlebar
    slot-detail/               a slot's screen: tabs for Overview / 2D Map / Heatmap /
                                Demos / Notebook / AI / Consolidated / Matchup (own slot only)
    map2d/                     2D animated replay (canvas), radar-calibration.ts for
                                pixel↔world-coordinate mapping
    heatmap/                   per-player position heatmap
    notebook/                  Tiptap-based Markdown editor, slash-command menu,
                                autosave + version history
    ai-settings/                global AI provider configuration screen
```

There's no NgRx/Akita — state is kept local to components and services,
fetched on demand through `ElectronService.api`, since almost everything is
scoped to "the currently open slot" and re-read from disk rather than kept
in a global store.

## 5. The demo parser (`python/`)

CS2 demos (`.dem`) are parsed **outside** the Node process, in Python, using
[`demoparser2`](https://pypi.org/project/demoparser2/) (a Rust/PyO3 native
extension — this is why it isn't reimplemented in TypeScript).

```
python/
  parse_demo.py           entry point: --input <demo.dem> --output <summary.json>
  requirements.txt         demoparser2, pinned
  requirements-dev.txt      + pytest
  tests/                    pytest unit tests for parse_demo.py
```

`electron/ai/demoParserBridge.ts` spawns it as a child process:

- **Development**: runs the system `python`/`python3` against
  `python/parse_demo.py` directly — you need
  `pip install -r python/requirements.txt` locally.
- **Packaged app**: runs a bundled, self-contained Python interpreter from
  `resources/python-runtime/` against `resources/python/parse_demo.py`
  (see §7 — this is *not* a PyInstaller binary).

The parser writes a JSON file (matching the `DemoSummary` shape in
`electron/storage/types.ts`); `demoParserBridge.ts` reads it back, and
`slotManager.ts` persists it under the slot's `demos/<demo-id>/summary.json`.
Classification logic that has to see the whole demo at once (buy type,
tempo, stance — using per-demo dynamic percentile thresholds) lives in
`parse_demo.py` itself, not in TypeScript; see README's ["How tactical
patterns are computed"](README.md#how-tactical-patterns-are-computed-no-ai)
for the reasoning.

## 6. Data & storage model

No database, no server — everything lives under Electron's per-OS
`userData` folder (`app.getPath('userData')`):

```
<userData>/
  slots/
    <slot-id>/
      meta.json                 name, kind (own|opponent), colorTag, timestamps
      notebook.md                 current notebook content
      notebook-history/            timestamped checkpoints — throttled to at most one
                                     snapshot per 5 minutes of editing, capped at 200
                                     entries, each restorable from the Notebook tab
      demos/
        <demo-id>/
          record.json             DemoRecord: fileName, map, score, roster (myTeamSteamIds)
          summary.json             DemoSummary: full parsed output from parse_demo.py
  ai-settings.json                default provider + non-secret provider config
  keys/*.key                      API keys, encrypted via Electron's safeStorage
  radars/<map>.png                 cached radar images extracted via radarExtractor.ts
  tools/vrf/                       downloaded Source2Viewer-CLI.exe used for extraction
```

`electron/storage/slotManager.ts` owns all reads/writes to this tree
(slot CRUD, demo add/remove, notebook save + history, roster marking,
`.csda-slot` export/import — a gzip'd JSON bundle of a slot's demos +
notebook). `electron/storage/settingsManager.ts` owns `ai-settings.json`
and the encrypted key files. Nothing else touches the filesystem directly.

There are always exactly 21 slots, auto-created on first launch
(`SlotManager.ensureSlotsExist()`): id `own` + `opp-01`..`opp-20`
(`MAX_OPPONENT_SLOTS = 20`), each capped at `MAX_DEMOS_PER_SLOT = 100`
(both constants in `electron/storage/types.ts`).

## 7. Build & packaging

```bash
npm start                # ng serve (4200) + electron, concurrently, hot-reload for Angular only
npm run build             # build:angular (ng build) + build:electron (tsc)
npm run build:prod        # setup:python-runtime + build + electron-builder → release/
```

- **`build:angular`** → `ng build`, output to `dist/cs-demo-analyst/browser/`.
- **`build:electron`** → `tsc -p tsconfig.electron.json`, output to
  `dist-electron/`, then copies `electron/assets/` alongside it. Note
  `tsconfig.electron.json` excludes `electron/**/__tests__/**` and only
  declares `"types": ["node"]` — test files are compiled separately via
  `tsconfig.electron.spec.json` when running Jest, since they need Jest's
  global types.
- **`setup:python-runtime`** (`scripts/setup-python-runtime.ps1`, Windows
  only today) downloads the official Python 3.11 **embeddable** zip,
  re-enables `import site`, bootstraps `pip`, and installs
  `python/requirements.txt` into `python-runtime/`. This is deliberately
  **not** a PyInstaller-compiled binary — PyInstaller has a documented
  history of mishandling `demoparser2`'s compiled Rust extension (missing
  hidden imports / dropped `.pyd`). Shipping a real (if minimal) interpreter
  is more predictable and can be run/debugged by hand.
- **`electron-builder`** (config lives inline in `package.json`'s `"build"`
  key) packages `dist-electron/`, `dist/cs-demo-analyst/`, and
  `extraResources` (`python-runtime/` → `resources/python-runtime`,
  `python/parse_demo.py` → `resources/python/parse_demo.py`) into
  `release/` — currently Windows-only (`nsis` + `portable` targets); macOS/
  Linux packaging is not wired up yet (would need
  `python-build-standalone` instead of the Windows-only embeddable zip).

`patches/` holds a `patch-package` patch for `@angular-devkit/build-angular`
17.3.17 (applied automatically via the `postinstall` script) that fixes a
Sass worker options-spreading bug in the Angular build tooling — check there
before assuming an Angular CLI build quirk is upstream.

There's no ESLint or Prettier configured in this repo — match the existing
style by eye (`.editorconfig` sets 2-space indent, single quotes for `.ts`).

## 8. Testing

```bash
npm test                                                    # Angular — Karma/Jasmine
npm run test:electron                                       # electron/**/__tests__/*.test.ts — Jest (ts-jest)
pip install -r python/requirements-dev.txt && pytest python/tests   # parser — pytest
```

Electron-side tests focus on the pure-computation modules in `electron/ai/`
(`scoreEngine`, `localHeuristics`, `matchupEngine`) since those have no I/O
to mock. There's a `scripts/calibrate-scores.js` (Node, not a test) that
computes real percentile ranges for the scoring model from a folder of
already-parsed demos — see README's ["Recalibrating the
ranges"](README.md#how-scores-are-calculated) for how to use it and why it
prints a report instead of editing `scoreEngine.ts` for you.

## 9. IPC channel reference

Every channel is declared in `preload.ts`, typed in `electron.service.ts`,
and handled in `ipc/handlers.ts`. Namespaces:

- **`slots:*`** — list/get/rename/setColorTag, notebook save + history
  (list/get/restore), removeDemo, setDemoRoster, exportSlot/importSlot.
- **`demos:*`** — `import` (opens a native `.dem` file picker, parses each
  file via Python, persists the summary), `getSummary`.
- **`assets:*`** — `getRadarImage` / `extractRadars` (finds a local CS2
  install and extracts the real radar images for the 2D replay; falls back
  to a plain grid if not found).
- **`ai:*`** — settings CRUD (`getSettings`, `setDefaultProvider`,
  `updateProviderConfig`, `saveApiKey`, `clearApiKey`), `analyzeSlot`
  (sends consolidated stats + notebook to the configured provider),
  `getSlotStats` / `getPlayerScores` (local heuristics/scoring, no AI),
  `matchupMaps` / `generateMatchup` (Matchup Engine, no AI).
- **`app:*`** — `getVersion`.
- **`window:*`** — minimize/toggleMaximize/close/isMaximized +
  `maximizedChanged` event (needed because the window is frameless and the
  titlebar is a custom Angular component).

When adding a channel: name it `<namespace>:<action>`, add it to all three
files, and keep the payload JSON-serializable (it crosses the context
bridge via structured clone).

## 10. Conventions worth knowing

- **No secrets in the renderer.** AI API keys are encrypted with Electron's
  `safeStorage` and only ever decrypted inside the main process
  (`settingsManager.ts` / `providers.ts`); `ai:getSettings` returns
  `hasKey: boolean`, never the key itself.
- **AI calls never see raw demo data.** Only the already-consolidated
  `ConsolidatedSlotStats` (from `localHeuristics.ts`) + per-player scores +
  the notebook text are sent to a provider — never tick-by-tick positions —
  see `analysisRunner.ts`.
- **Local-heuristics vs. AI is a hard split.** Anything that doesn't need a
  network call (tactical pattern consolidation, scoring, the Matchup
  Engine) lives as a pure function in `electron/ai/*.ts` with no dependency
  on `providers.ts`, so it stays instant and free to run.
- **PT/EN strings** go through the `translate` pipe
  (`src/app/shared/pipes/`), which calls `TranslationService.t(key)`. Source
  copy is written in pt-BR directly as the key; in `en` mode it's looked up
  in `core/i18n/en.ts` and falls back to the pt-BR text if untranslated —
  don't hardcode UI copy in components, and don't expect a separate `pt.ts`.
- Two feature folders (`src/app/features/dashboard`,
  `src/app/features/map2d-v2`) currently exist but are empty — leftovers,
  not in active use; don't build on top of them without checking first.
