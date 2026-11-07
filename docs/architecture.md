# Architecture

This is the document to read first. It answers four questions: what the app is made of, how the
parts depend on each other, where code runs, and why it was built this way.

## 1. What it is

Scope Viewer is a **single-page application with no backend**. A static bundle (HTML, JavaScript,
CSS) is served by nginx; after that, the browser does all the work. Session files are read from the
user's disk, parsed in a Web Worker, drawn on canvases, and the user's work is saved to browser
storage. The server's Content-Security-Policy forbids connections to any other origin
(`connect-src 'self'`, see [`nginx.conf`](../nginx.conf)), so "your files never leave your computer"
is enforced, not just promised.

| Concern | Choice |
| --- | --- |
| UI | React 19 function components and hooks, TypeScript (strict, `erasableSyntaxOnly`) |
| Build | Vite 8, `vite-plugin-pwa` (Workbox) |
| Drawing | Canvas 2D for waveforms, grid, spectrum; SVG for callouts |
| Background work | Two Web Workers: file parsing, and computation (math, spectra, long measurements) |
| Persistence | `localStorage` (analyses, settings), IndexedDB (kept session files), `BroadcastChannel` (tab sync) |
| Libraries | `fflate` (zip), `lucide-react` (icons), `@mathjax/src` (TeX in callouts, loaded on demand), `workbox-window` |
| Tests | Vitest, plain unit tests (no DOM, no component tests) |
| State management | None added: React state in one composition root, plus plain classes where state outlives React |

There is no router, no state library, no CSS framework and no network code. One global stylesheet
([`src/styles.css`](../src/styles.css)) defines CSS custom properties for the light and dark themes.

## 2. The layers

The code is organised in folders under `src/`. They form layers; arrows below mean "may import from".

```mermaid
flowchart TB
  subgraph UI["UI – React"]
    direction LR
    App["App.tsx<br/>start page, opening files"]
    Scope["components/Scope.tsx<br/>the workspace: state + wiring"]
    Parts["PlotArea · Overview · ChannelBar<br/>MeasurementTable · SpectrumView · panels · dialogs"]
    App --> Scope --> Parts
  end

  subgraph Services["Services"]
    direction LR
    Export["export/<br/>PNG · HTML report · CSV · bundle"]
    Render["render/<br/>canvas + SVG drawing · themes · TeX"]
    Compute["compute/<br/>worker client + worker"]
    Pwa["pwa/<br/>install prompt · launch files"]
  end

  subgraph Core["Core – plain TypeScript, no React, runs in workers and tests"]
    direction LR
    Model["model/<br/>types · workspace · view · callouts<br/>edits · store · undo · storage · tab sync"]
    Dsp["dsp/<br/>min/max pyramid<br/>measurements · edges"]
    Math["math/<br/>expressions · filters · FFT"]
    Parsers["parsers/<br/>format adapters (Tektronix)"]
    Util["util/<br/>formatting · names · hashing"]
  end

  UI --> Services
  UI --> Core
  Services --> Core
  Export --> Render
  Compute --> Dsp
  Compute --> Math
```

### The dependency rules

1. **Only `App.tsx` and `src/components/` import from `src/components/`.** Parsing, analysis, rendering
   and exporting never import UI components. This is true today (checked with a search) and is what
   keeps the core testable without a browser.
2. **Exports reach the plot and the spectrum through two small interfaces**, `PlotImageSource` and
   `SpectrumSource`, declared in [`src/export/sessionExport.ts`](../src/export/sessionExport.ts) and
   implemented by `PlotArea` and `SpectrumView`. The export code does not know those components exist.
3. **React appears outside `components/` in only a few places:** `render/callouts.tsx` (callout
   shapes are React elements, so the screen and the exported SVG share them), `render/tex.ts`,
   `util/usePersistentState.ts` and `pwa/install.ts` (a hook each), `main.tsx`, `App.tsx`.
4. **The layers are conventions, not enforced by tooling.** A few small, deliberate shortcuts exist: the
   parsers import `fitBand` from `model/view` and the constant `DIVS_Y` from `render/draw` to give
   files without a V/div setting a sensible autoscale; `dsp/measureDefs` imports a type from
   `model/view`. Keep such links to constants, types and pure functions.

### What each layer is for

| Folder | Responsibility | Typical file |
| --- | --- | --- |
| `parsers/` | Bytes → `Session`. One `FormatAdapter` per family of scopes (today: Tektronix file layouts and SCPI setup files). | `session.ts`, `tektronix.ts`, `tekWfm.ts` |
| `dsp/` | Numeric analysis of sample arrays: the min/max pyramid, automatic measurements, edge finding. | `measure.ts`, `minmax.ts` |
| `math/` | The math-channel language, filters, and the FFT with windows and peak search. | `expr.ts`, `fft.ts` |
| `model/` | What the app *means*: data types, the workspace document (with its version and migrations) and the store that holds it, the pure edits that change it, view/zoom helpers, callouts, undo history and the rules that cut it into steps, browser storage, tab sync. | `workspace.ts`, `edits.ts`, `view.ts` |
| `compute/` | Moves math, spectra and long measurements off the page into a worker. | `engine.ts`, `core.ts` |
| `render/` | Pure drawing: canvas functions, geometry, themes, callout layout, TeX. | `draw.ts`, `callouts.tsx` |
| `export/` | Turns the current state into files. | `sessionExport.ts` |
| `components/` | React UI and the hooks that connect it to the model. | `Scope.tsx`, `PlotArea.tsx` |
| `pwa/` | Install prompt and "open with" file launches. | `install.ts` |
| `util/` | Small helpers with no domain knowledge (SI formatting, names, SHA-256, caches). | `format.ts` |

## 3. Where code runs

```mermaid
flowchart LR
  subgraph Page["Main thread (the page)"]
    UI["React UI<br/>Scope + children"]
    Engine["ComputeEngine<br/>(scheduler)"]
  end

  PW["Parse worker<br/><code>parsers/worker.ts</code><br/>one per opened file,<br/>terminated when done"]
  CW["Compute worker<br/><code>compute/worker.ts</code><br/>started lazily, lives with<br/>the open session"]

  LS[("localStorage<br/>analyses · layout · theme")]
  IDB[("IndexedDB<br/>kept session files")]
  SS[("sessionStorage<br/>which session is open<br/>in this tab")]
  BC{{"BroadcastChannel<br/>other tabs"}}
  SW["Service worker<br/>offline app cache"]

  UI -- "file bytes" --> PW
  PW -- "Session + pyramids<br/>(transferred, not copied)" --> UI
  UI --> Engine
  Engine <-- "requests / replies" --> CW
  UI --- LS
  UI --- IDB
  UI --- SS
  UI --- BC
  SW -. "serves the app shell" .-> Page
```

Two ideas to hold on to:

- **The page stays light.** Anything that scales with the length of the record (parsing, building the
  pyramid, evaluating math, FFT of a million samples, measuring a whole record) happens in a worker.
  The page only does work that scales with the number of *pixels*.
- **Big arrays cross a boundary at most once.** From the parse worker to the page, the sample buffers
  are *transferred* (moved, not copied). The compute worker is different: it needs the input samples
  while the page keeps its own for drawing, so they are *copied* to it, and a record used for math,
  spectra or long measurements therefore exists in memory twice. Math samples coming back are copied
  for the same reason; their pyramid levels and spectra are transferred. Afterwards both sides refer to
  an array by a short name ("ref"). See [Workers and compute](workers-and-compute.md).

## 4. The life of a file

What happens between dropping a file and seeing a waveform:

```mermaid
sequenceDiagram
  actor U as User
  participant App as App.tsx
  participant L as parsers/load.ts
  participant W as Parse worker
  participant S as components/Scope.tsx

  U->>App: drop .tss / .wfm / .isf / .scopeview
  App->>L: loadSession(files, abortSignal)
  L->>W: ArrayBuffers (transferred)
  W->>W: unpack bundle, if it is one
  W->>W: SHA-256 → fingerprint
  W->>W: loadFiles() → Session
  W->>W: build a min/max pyramid per channel
  W-->>L: Session + pyramid levels (transferred)
  L-->>App: LoadedSession
  App->>App: decide the starting state (stored / defaults / analysis file)
  App->>S: mount with key = generation
  S->>S: loadWorkspace(session) → Workspace (sanitized)
  S->>S: Session + Workspace → LiveChannel[]
  S-->>U: PlotArea draws the canvases
  App-)App: keep the file in IndexedDB (async, optional)
```

Details worth knowing:

- Opening another file while one is loading **aborts** the first (`AbortController` in `App.open`);
  the latest file wins.
- `Scope` is remounted for every new file, imported analysis or reset: `App` bumps `generation`, which is
  the React `key` of the `ErrorBoundary` around `Scope`. The workspace therefore never has to be "reset"
  in place; a fresh component starts from `InitialState`.
- The workspace is *built from two inputs*: the immutable `Session` (what the file says) and the
  saved `Workspace` (what the user changed). See [Data model](data-model.md).

## 5. The life of an edit

What happens when the user changes anything about the analysis – drags a channel tag, adds a note,
edits a math expression:

```mermaid
flowchart LR
  A["User action"] --> B["store.update(a => edits.xxx(a, …))<br/>a pure edit makes the next Analysis"]
  B --> C["undo history (subscriber):<br/>snapshot → undo step, cut by the StepGrouper"]
  B --> D["autosave (subscriber)<br/>workspaceOf(store, window, selected)"]
  D --> E["waits 400 ms"]
  E --> F["saveWorkspace<br/>→ localStorage"]
  F --> G["announce()<br/>→ BroadcastChannel"]
  G --> H["other tabs with this session:<br/>takeOver() → store.adopt()"]
  B --> I["React components (subscribers)<br/>re-render, canvases redraw"]
  B --> J["math defs changed?<br/>ComputeEngine.setMath"]
```

Two properties make this cheap to extend:

- **The analysis lives in a store, and changes are pure functions** (`model/edits.ts`: `(Analysis, args) → Analysis`).
  The logic of a change can be tested without React, and undo, autosave and the components follow the store by
  subscription instead of being threaded through the component that owns the state.
- **One serialisable document** (`Analysis`) drives undo, autosave, analysis files, bundles and multi-tab
  sync. Add a field to it and all five work, with no extra code.

See [State and persistence](state-and-persistence.md).

## 6. Key design decisions

| Decision | Why | Where |
| --- | --- | --- |
| **Samples are `Float32Array` in physical units**, converted once at parse time | Half the memory of `Float64Array` for million-sample records; no per-frame scaling | [`parsers/`](../src/parsers), [`model/types.ts`](../src/model/types.ts) |
| **Min/max pyramid** per channel | One pixel column can span millions of samples; the pyramid answers "min and max of samples i0…i1" with a handful of lookups, so drawing cost depends on the screen, not the record | [`dsp/minmax.ts`](../src/dsp/minmax.ts) |
| **Parsing and pyramid building in a worker** | A 100 MB record would freeze the page for seconds | [`parsers/worker.ts`](../src/parsers/worker.ts) |
| **One compute worker, one request at a time, latest wins** | While panning, hundreds of "measure this range" requests would pile up; only the newest per consumer matters | [`compute/engine.ts`](../src/compute/engine.ts) |
| **A single `Workspace` JSON document, sanitised on load** | Autosave, undo, files, bundles and tab sync all share it; unknown or broken data falls back to file defaults, so a bad file or old save cannot break the viewer | [`model/workspace.ts`](../src/model/workspace.ts) |
| **Sessions are identified by the SHA-256 of their contents**, not their name | Renaming a file keeps your work; two different files with the same name do not collide | [`parsers/worker.ts`](../src/parsers/worker.ts) |
| **Callouts are stored in data coordinates** (time, channel value) | They stay attached to the waveform when you zoom, pan or change V/div | [`model/callouts.ts`](../src/model/callouts.ts) |
| **Canvas for traces, SVG for callouts** | Traces need raw speed; callouts need hit-testing, text layout and crisp vector output in exports | [`render/`](../src/render) |
| **Screen and exports use the same drawing functions** | An exported image is exactly what is on screen, only larger and optionally in the light theme | `PlotArea.renderImage` |
| **The analysis lives in an `AnalysisStore`, changed only by pure `edits`** | A change is testable without a browser (`edits.test.ts`); undo, autosave, tab sync and the plot follow the store themselves instead of being wired through one component; several changes in a row cannot act on stale state | [`model/analysisStore.ts`](../src/model/analysisStore.ts), [`model/edits.ts`](../src/model/edits.ts) |
| **Each command is one `Action`**, offered by the toolbar, menus, palette and keyboard | The four can never disagree on label, icon, shortcut or enabled state; the palette entry and the key are derived from the action, not registered a second time | [`components/ui/action.ts`](../src/components/ui/action.ts) |
| **A file format is a `FormatAdapter`**, tried in a list | A new family of scopes is a new file and one line; the loader, the worker and the interface do not change | [`parsers/formats.ts`](../src/parsers/formats.ts), [`parsers/session.ts`](../src/parsers/session.ts) |
| **What a gesture means, and when an undo step ends, are pure code** (`releaseOutcome`, `StepGrouper`) | The rules that used to be checked only by hand in the browser are unit tests; the components pass events in and carry results out | [`render/plotInteraction.ts`](../src/render/plotInteraction.ts), [`model/stepGrouping.ts`](../src/model/stepGrouping.ts) |
| **The saved format has a version, a list of its fields and migration steps** | Changing it cannot silently lose a user's saved work: a forgotten field fails a test, an incompatible change is a step that converts old data | [`model/workspace.ts`](../src/model/workspace.ts), [`model/migrations.ts`](../src/model/migrations.ts) |
| **Results from the worker are read synchronously** (`measured`, `spectrum` → value or `undefined`, then `useEngineResults`) | One way to wait for the worker for the table, the spectrum, callouts and snapping; no promises threaded through renders | [`compute/engine.ts`](../src/compute/engine.ts), [`components/useEngineResults.ts`](../src/components/useEngineResults.ts) |
| **Theme colours exist twice** (CSS tokens and a TypeScript `Theme`), and a test compares them | Canvases and exports need concrete colours in code; the page needs CSS variables | [`render/themeSync.test.ts`](../src/render/themeSync.test.ts) |
| **The service worker asks before updating** (`registerType: 'prompt'`) | The app never changes under the user's hands; because work is autosaved, reloading loses nothing | [`vite.config.ts`](../vite.config.ts), [`PwaStatus.tsx`](../src/components/PwaStatus.tsx) |
| **MathJax is loaded on demand** and its big glyph tables are kept out of the offline precache | ~1.4 MB core and ~10 MB of rare glyphs would otherwise slow the first load | [`render/mathjax.ts`](../src/render/mathjax.ts), `vite.config.ts` |

## 7. Where complexity lives

A few files hold most of the integration logic; knowing them makes the rest easy to navigate:

- [`components/Scope.tsx`](../src/components/Scope.tsx) (~950 lines) – the **composition root of the
  workspace**. It creates the `AnalysisStore` and connects it to undo, autosave and tab sync (via hooks), owns
  the interface state (tool, selection, layout) and navigation, defines all `Action`s, and passes props down. The
  *rules* of a change to the analysis are not here but in `model/edits.ts`; `Scope` calls them and does the
  interface's part (select the new callout, offer Undo, …).
- [`components/PlotArea.tsx`](../src/components/PlotArea.tsx) (~1080 lines) – the interactive plot:
  pointer events for every tool (what a gesture means is decided in `render/plotInteraction.ts`), drawing
  orchestration, callout layer, image rendering for exports. It reads
  the analysis from the store and changes it there (`AnalysisContext`); its 22 props are the interface state, the
  time window, and the things that need the workspace (menus, creating a callout).
- [`model/workspace.ts`](../src/model/workspace.ts) – defaults from a file, sanitising untrusted
  input, and the storage format.
- [`model/edits.ts`](../src/model/edits.ts) and [`analysisStore.ts`](../src/model/analysisStore.ts) – every
  change a user can make to the analysis, and the store that holds it.

Everything else is small and single-purpose. The [Module map](module-map.md) lists them all.
