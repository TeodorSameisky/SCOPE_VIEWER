# Module map

Every source file with one line on what it does. Test files (`*.test.ts`) sit next to the module they test
and are not listed. Counts are from the time of writing; the descriptions come from reading the code.

## Repository root

| File | Purpose |
| --- | --- |
| [`index.html`](../index.html) | Entry page; loads `theme-init.js`, sets the first-paint background, mounts `src/main.tsx` |
| [`package.json`](../package.json) | Scripts and dependencies (`private`, MIT, version 0.1.0) |
| [`vite.config.ts`](../vite.config.ts) | Vite config: React, licence plugin, PWA manifest + Workbox, chunking, build constants, test exclusions |
| [`tsconfig*.json`](../tsconfig.json) | Three TypeScript projects: app, tests, node tooling |
| [`.oxlintrc.json`](../.oxlintrc.json) | Lint rules |
| [`pwa-assets.config.ts`](../pwa-assets.config.ts) | Icon generation (`npx pwa-assets-generator`) |
| [`Dockerfile`](../Dockerfile), [`nginx.conf`](../nginx.conf), [`.dockerignore`](../.dockerignore) | Production image and web server config |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | CI: lint, test, build |
| [`public/`](../public) | Static files: icons (`favicon.*`, PWA PNGs) and `theme-init.js` |
| [`tools/thirdPartyLicenses.ts`](../tools/thirdPartyLicenses.ts) | Vite plugin that writes `third-party-licenses.txt` |

## `src/` – entry points

| File | Purpose |
| --- | --- |
| `main.tsx` | Starts listening for the install prompt, renders `<App />` in `StrictMode` |
| `App.tsx` | Providers; start page; opening files (drop, picker, OS launch, restore after reload); `Current` session state; aborts superseded loads |
| `styles.css` | The one stylesheet: theme tokens and all component styles |
| `globals.d.ts` | Types for `__APP_VERSION__`, `__BUILD_TIME__` and the PWA virtual module |

## `src/parsers/` – bytes → `Session`

| File | Purpose |
| --- | --- |
| `load.ts` | `loadSession(files, signal)`: reads files, runs the parse worker, wraps pyramid levels |
| `worker.ts` | Parse worker: unpack bundle → fingerprint → `loadFiles` → pyramid levels → transfer |
| `session.ts` | `loadFiles`: unzip, dispatch by type, `buildSession` (channels, views, time base, trigger, cursors, measurements), channel colours and ids |
| `tekWfm.ts` | Tektronix `.wfm` (WFM#001–003) binary parser |
| `tekIsf.ts` | Tektronix `.isf` (preamble + curve block, binary or ASCII, envelope) parser |
| `tekSetup.ts` | SCPI "learn" setup parser; `readChannelInput` for coupling, termination, probe, … |

## `src/dsp/` – sample-array analysis

| File | Purpose |
| --- | --- |
| `minmax.ts` | `MinMaxPyramid`: min/max of any sample range in a few lookups |
| `measure.ts` | `measure()`: all automatic measurements of a range; `Measurements`, `MeasurementKey` |
| `measureDefs.ts` | Names, units, groups, explanation text of measurements; `formatMeasurement`, `missingReason` |
| `edges.ts` | 10/50/90 % levels and `nearestEdge` for snapping |

## `src/math/` – math channels and FFT

| File | Purpose |
| --- | --- |
| `expr.ts` | Tokenizer, parser, evaluator, units, function table, dependency order, result cache, `checkSyntax` |
| `signal.ts` | Derivative, integral, moving average/RMS, Butterworth filter, interpolation, resampling |
| `fft.ts` | Radix-2 FFT, windows, `computeSpectrum`, dB conversion, leakage model, `findPeaks` |

## `src/compute/` – the compute worker

| File | Purpose |
| --- | --- |
| `protocol.ts` | Message types between page and worker; ref naming |
| `core.ts` | `ComputeCore`: the worker's logic (math, spectrum, measure) without the worker |
| `worker.ts` | Thin shell: `self.onmessage` → `ComputeCore` |
| `engine.ts` | `ComputeEngine`: page-side scheduler (queueing, slots, caching, restart), `WorkerLike` |

## `src/model/` – what the app means

| File | Purpose |
| --- | --- |
| `types.ts` | `Waveform`, `ChannelDisplay`, `ChannelInput`, `Channel`, `Session` |
| `workspace.ts` | `Workspace`/`Analysis`; defaults from a file; `sanitizeWorkspace`; autosave storage; analysis files; zoom limits |
| `view.ts` | Time window, cursors, measurement range, tools; zoom/pan/autoscale/view-size helpers; `LiveChannel` |
| `callouts.ts` | `Callout` and `NewCallout` types, colours, `sanitizeCallouts`; navigation helpers (`adjacentCallout`, `calloutWindow`, `isOffRecord`, `boxZoomPatch`, `calloutsOn`) |
| `edits.ts` | The changes a user can make to the analysis, as pure functions `(Analysis, args) → Analysis` (channels, views, math, callouts, cursors, measurements, spectra, notes) |
| `analysisStore.ts` | `AnalysisStore`: the analysis in an external store with `update`, `subscribe`, `changedAt` and `adopt` (tab sync) |
| `calloutValues.ts` | Text of values shown in callout labels (note value, region/box measurements) |
| `math.ts` | `MathDef`, ids, colours, quick-operation presets |
| `spectrum.ts` | `SpectrumDef`, options, new-spectrum rules, level units, stored-spectra parsing |
| `input.ts` | `ChannelInput` → display strings (settings table, badge flags, one-line summary) |
| `undoHistory.ts` | `UndoHistory<T, V>`: snapshot steps with optional view movement |
| `tabSync.ts` | `BroadcastChannel` news between tabs with the same session |
| `fileStore.ts` | IndexedDB store for kept session files, eviction planning |
| `recent.ts` | Merge saved analyses and kept files into the "recent sessions" list |
| `legacy.ts` | Migration of data stored by older versions |

## `src/render/` – drawing

| File | Purpose |
| --- | --- |
| `draw.ts` | View geometry (`viewBoxes`, `gridRows`, `layoutTags`), `drawView`, `drawTrace`, `drawHover`, `drawTimeAxis`, value↔division |
| `callouts.tsx` | `layoutCallouts` (geometry), `calloutShapes` (React elements), `calloutsSvg` (string for export) |
| `spectrum.ts` | Frequency/level mapping, ticks, `drawSpectrum`, level reading |
| `theme.ts` | `Theme` type, `DARK_THEME`, `LIGHT_THEME` |
| `color.ts` | Colour parsing, WCAG contrast, `printColor` (darken pale colours for light backgrounds), `textOn` |
| `pageColors.ts` | Page and title-bar colours shared by CSS, HTML and the PWA manifest |
| `fonts.ts` | `SANS`, `MONO`, `PLOT_FONT`, `font()` |
| `tex.ts` | `$…$` splitting, formula cache, `texSvg`, `loadTex`, `texHtml`, `useTexVersion` |
| `mathjax.ts` | Lazy MathJax (TeX → SVG paths) with on-demand glyph tables |

## `src/export/` – outputs

| File | Purpose |
| --- | --- |
| `sessionExport.ts` | `ExportContext`, `PlotImageSource`/`SpectrumSource`, `runExport`, report tables, image info lines |
| `image.ts` | `composeImage`: header, legend, plots, table, footer on one canvas; `canvasToBlob` |
| `report.ts` | `buildReport`: self-contained HTML report |
| `csv.ts` | CSV dialects and the three CSV builders |
| `measureRows.ts` | Which channels the measurement table lists; `measureChannels`; table rows for image/report |
| `bundle.ts` | `.scopeview` zip: `buildBundle`, `unpackBundle`, `isBundleName` |

## `src/components/` – React UI

| File | Purpose |
| --- | --- |
| `Scope.tsx` | The workspace: creates the analysis store and calls its edits, navigation, undo, autosave and tab sync wiring, interface state, actions, layout of all parts |
| `analysisContext.ts` | `AnalysisContext` and the hooks `useAnalysisStore`, `useAnalysis`, `useStoreAnalysis` |
| `scopeCommands.ts` | `ScopeActions`/`ScopeApi`; all menus; palette commands |
| `keymap.ts` | `KEYS`, `TOOLS`, `HELP_ROWS` |
| `PlotArea.tsx` | Interactive plot: canvases, pointer tools, wheel, snapping, callout layer, `renderImage`; reads and changes the analysis through the store |
| `CalloutLayer.tsx` | SVG layer: drag/resize/edit callouts, inline editor |
| `CalloutPanel.tsx`, `CalloutValueEditor.tsx` | Callout list with search; measurements/values editor |
| `ColorSwatches.tsx` | Callout colour choice |
| `Overview.tsx` | Whole-record navigator strip |
| `SpectrumView.tsx` | FFT plot, peaks, per-spectrum controls |
| `MeasurementTable.tsx` | Measurement table (columns, channels, range, resize) |
| `MeasureInfo.tsx`, `MeasureFigure.tsx`, `WindowFigure.tsx` | Explanation cards and diagrams for measurements and FFT windows |
| `ChannelBar.tsx` | Channel badges, drag between views, + Math, FFT |
| `ChannelSettings.tsx`, `MathEditor.tsx` | Per-channel and per-math-channel editors (popovers) |
| `TopBar.tsx`, `Rail.tsx` | Toolbars; side-panel switch, help, theme |
| `CursorPanel.tsx`, `InfoPanel.tsx`, `StorageSection.tsx`, `ReferencePanel.tsx` | Side panels |
| `RecentSessions.tsx` | Stored-session list |
| `CommandPalette.tsx` | Modal command search |
| `ExportDialog.tsx` | Export options and preview sizes |
| `PwaStatus.tsx` | Service worker registration and update/offline toasts |
| `ErrorBoundary.tsx` | Render-error fallback |
| `useAutosave.ts` | Debounced saving that follows the store (and the view), flush on hide, status |
| `useNavigation.ts` | Time window, Back history, zoom helpers |
| `useUndoHistory.ts` | Subscribes `UndoHistory` to the store and cuts steps by gestures |
| `useMathResults.ts` | Subscribes to the engine's math state |
| `useShortcuts.ts` | Global keyboard handling |

### `src/components/ui/` – shared UI toolkit

| File | Purpose |
| --- | --- |
| `action.ts` | `Action`, `menuItem`, `command` |
| `ContextMenu.tsx`, `Menu.tsx`, `menuContext.ts` | Menus (right-click and drop-down) |
| `Feedback.tsx`, `feedbackContext.ts` | Notices and confirm dialogs |
| `ThemeProvider.tsx`, `themeContext.ts` | Appearance preference and canvas theme |
| `IconButton.tsx`, `Logo.tsx` | Buttons and logo |
| `ResizeHandle.tsx`, `placement.ts`, `useDismiss.ts` | Resizing, popover placement, outside-click/Esc |
| `commandSearch.ts` | Palette ranking |
| `wheel.ts` | Wheel/trackpad normalisation |

## `src/pwa/`, `src/util/`

| File | Purpose |
| --- | --- |
| `pwa/install.ts` | Captures `beforeinstallprompt`; `installApp`, `useCanInstall` |
| `pwa/launch.ts` | File Handling API: files opened from the OS |
| `util/format.ts` | SI formatting and parsing, 1-2-5 `niceStep`, tick generation, counts, bytes |
| `util/names.ts` | Display names (`CH1` → "Ch 1"), per-div text, trigger text, units |
| `util/sampleCache.ts` | Per-sample-array LRU cache with slots |
| `util/sha256.ts` | SHA-256 with a fallback for insecure contexts |
| `util/usePersistentState.ts` | `useState` mirrored to `localStorage` |
| `util/clipboard.ts`, `util/download.ts`, `util/html.ts` | Copy text, download a Blob, escape HTML |
