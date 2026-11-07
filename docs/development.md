# Development guide

Setting up, running tests, the conventions the code follows, and step-by-step recipes for the changes
people make most often.

## 1. Setup

Requirements: **Node 24** (the same major as CI and the Docker build stage) and npm.

```bash
npm install
npm run dev
```

The dev server is at `http://localhost:5173`. Drop a session file onto the page. If you do not have one,
the repository's tests build small synthetic waveforms in code; for manual testing you need a real
`.tss`, `.wfm` or `.isf` file.

| Command | When to use it |
| --- | --- |
| `npm run dev` | day-to-day development with hot reload |
| `npm test` | run the unit tests once (`vitest run`); use `npx vitest` for watch mode |
| `npm run check` | type check (app, tools and tests), lint, tests – **run before pushing** |
| `npm run build` | type check + production build into `dist/` |
| `npm run preview` | serve `dist/` on `http://localhost:4173` – the only way to test the service worker and offline mode |

### Optional local sample files

`SessionSample/` is ignored by git (`.gitignore`) and may hold real sessions for manual testing and for the
tests that need them (see below). The expected names are `SessionSample/Tek000.tss` and
`SessionSample/tek0000CH1.zip`.

## 2. Tests

[Vitest](https://vitest.dev/), plain unit tests next to the code (`foo.ts` → `foo.test.ts`). There are 38
test files and 276 tests, and they run in a few seconds.

**What is tested:** the parts that are pure and where bugs are subtle – parsers, measurements and edge
finding, the expression language, FFT and peak search, window/view geometry (`view.ts`, `draw.ts`), the
workspace (sanitising, defaults), the undo history, the compute engine and core, callout layout and
values, colour handling, formatting, command search, menu normalisation, the measurement rows.

**What is not tested:** React components (there is no DOM environment and no component test library).
That is why logic is pulled out of components into plain modules – `commandSearch.ts`, `wheel.ts`,
`menuContext.ts`, `view.ts` – where it can be tested. When you add behaviour to a component, ask whether
the decision part can be a pure function.

**Patterns worth knowing:**

- **A fake worker.** `engine.test.ts` defines `FakeWorker implements WorkerLike` that runs `ComputeCore`
  in place, copying messages with `structuredClone` and replying asynchronously, as a real worker would.
  The whole scheduling logic (slot replacement, ordering, stale replies, restart after failure) is tested this way.
- **Sample-dependent tests.** `parsers/session.test.ts` and `parsers/tekIsf.test.ts` have blocks guarded
  with `describe.skipIf(!hasSample)` that read real files from `SessionSample/`. They are skipped when
  the files are absent – which is always the case in CI, because `SessionSample/` is not committed.
- **Cross-file consistency tests.** `render/themeSync.test.ts` reads `styles.css` and `index.html` to make
  sure the CSS tokens and the canvas theme agree. If you add a theme colour that also exists in CSS, extend it.
- **Constants as documentation.** `fft.test.ts` checks the documented window properties (ENBW, scalloping
  loss, side lobes) against the coefficients, so the Reference panel text cannot be wrong silently.

## 3. Code conventions

These are observed in the code, not imposed by tooling – follow them so new code looks like the old.

- **Comments explain *why*, in full sentences, above the thing.** Public functions and interface fields
  carry a `/** … */` comment saying what the value means (units included: "seconds", "divisions", "ms
  since 1970"). Algorithms get a paragraph on the reasoning (see `measure()`, `findPeaks()`).
- **Name units in comments, not in types.** Time is seconds, values are in the channel's unit, positions
  are divisions, pixels are CSS pixels.
- **Never trust external data.** Anything from `localStorage`, files or `postMessage` is validated into a
  known-good shape (`sanitizeWorkspace`, `sanitizeCallouts`, `parseStoredSpectra`). Failure falls back to
  defaults – it never throws into the UI.
- **Storage access is wrapped in `try/catch`** and degrades silently (private mode, quota, blocked storage).
- **Errors are values where the user can act on them:** parsers throw `Error` with a message that names the
  file; math channels carry `{ error, errorPos }`; export and file operations show notices.
- **Pure functions first.** Geometry, formatting and decisions are plain functions with tests. Components
  call them.
- **Immutable updates** for anything in React state or the analysis document – spread, `map`, `filter`.
  Helpers return the *same* array when nothing changed (`patchDisplays`, `keepInRecord`) so React and
  `JSON.stringify` comparisons are cheap and renders are skipped.
- **TypeScript:** `import type` for types (`verbatimModuleSyntax`), no `enum`s or parameter properties
  (`erasableSyntaxOnly`), relative imports, `.ts`/`.tsx` extensions are allowed. No unused locals or
  parameters.
- **Lint:** `oxlint` with the `react`, `typescript` and `oxc` plugins; `react/rules-of-hooks` is an error and
  `react/only-export-components` a warning (files that export components should export little else; context
  and hook modules such as `themeContext.ts` are kept apart from `ThemeProvider.tsx`).
- **Hooks that read props through closures** use `// eslint-disable-next-line react-hooks/exhaustive-deps`
  with a comment saying what the effect really depends on.
- **Naming:** types `PascalCase`, constants `UPPER_SNAKE`, files after their main export; modules that only
  hold a React context end in `Context.ts`.

## 4. Recipes

### Add a file format

Example: Rigol `.wfm`/`.csv`. Follow `tekWfm.ts` / `tekIsf.ts`.

1. **Parser** – create `src/parsers/rigolXxx.ts` exporting `isRigolXxx(buf: ArrayBuffer): boolean` (a cheap
   signature check, so detection does not rely on the extension) and `parseRigolXxx(buf, name): Waveform`.
   Convert samples to physical units in a `Float32Array`; set `t0` (time of the first sample relative to the
   trigger), `dt`, `yUnit`, `xUnit`. **Validate** and `throw new Error(\`${name}: …\`)` with a precise message
   for anything unsupported – `loadFiles` turns it into a warning and carries on with other files.
2. **Register it** in the entry loop of `loadFiles` ([`session.ts`](../src/parsers/session.ts)): a branch like
   the `.wfm` / `.isf` ones that calls your parser, assigns the id with `channelIdFromName`, and records the kind.
3. **Session details** – if the format has a setup/metadata file, extend `buildSession` or add a parallel
   reader that fills `ChannelDisplay`, `horizontal`, `trigger`, `cursors`. If it has none, `buildSession` already
   fits unscaled channels sensibly. Choose the `format` display name and colours.
4. **Let the user open it:** add the extension to `ACCEPT` in [`App.tsx`](../src/App.tsx), to `file_handlers` in
   [`vite.config.ts`](../vite.config.ts) (for "Open with…"), to the format list on the start page, and to the
   table in the root README.
5. **Test** with a small synthetic buffer built in the test file (see `tekIsf.test.ts` for how a preamble +
   block is assembled). Add a sample-dependent test only as an extra.

You do not need to touch the pyramid, the workspace or any UI: they consume `Session`.

### Add a measurement

1. In [`dsp/measure.ts`](../src/dsp/measure.ts), add the field to `Measurements`, compute it in `measure()`
   and **set it in both early-return objects** (empty range and no valid sample) as `NaN`.
   `MeasurementKey` is derived from `Measurements`, so it extends automatically.
2. In [`dsp/measureDefs.ts`](../src/dsp/measureDefs.ts), add the entry to `MEASUREMENT_DEFS`: `key`, `label`,
   `unit` (`'y'` = channel unit, `'s'`, `'Hz'`, `'%'`), `group` (`'amplitude'` | `'timing'`; timing values show
   a reason for "—" via `missingReason`), `short`, `method`, optional `formula`.
3. TypeScript will now point at every `Record<MeasurementKey, …>` that needs the key – notably `MEASURE_SHORT`
   in `model/calloutValues.ts` (the short name in region labels). Add `MeasureFigure`'s `case` for the key so
   the explanation diagram highlights something sensible.
4. If the Tektronix setup has a name for it, add it to `TEK_MEAS` in `model/workspace.ts`.
5. Add tests in `dsp/measure.test.ts`. The Reference panel, the table's *add* menu, CSV, report and image
   pick the measurement up automatically.

### Add a math function

In [`math/expr.ts`](../src/math/expr.ts), add an entry to the `FUNCTIONS` record:

```ts
myfn: {
  impl: (c) => {
    arity(c, 'myfn', 2)                                   // argument count
    const a = needSig(c.args[0], 'myfn', c.pos)           // must be a channel/signal
    const k = needNum(c.args[1], 'myfn', 'the factor', c.pos)   // must be a number
    return { ...a, data: /* Float32Array */, unit: a.unit }
  },
  doc: { name: 'myfn', signature: 'myfn(x, k)', description: '…', example: 'myfn(CH1, 2)' },
},
```

If it needs real signal processing, put the algorithm in [`math/signal.ts`](../src/math/signal.ts) (respect the
"invalid samples stay gaps" rule). Errors are `throw new ExprError(message, c.pos)`. `checkSyntax`, the
editor's live feedback and the Reference panel all read the same table, so nothing else needs to change.
Add a test to `expr.test.ts`.

### Add a command or shortcut

1. Add a member to the `ScopeActions` interface in [`scopeCommands.ts`](../src/components/scopeCommands.ts).
2. Define it in the `actions` object in [`Scope.tsx`](../src/components/Scope.tsx): `label`, `icon`, `hint`,
   `disabled`, `checked`, `run`.
3. Offer it:
   - toolbar: `<ActionButton action={actions.myAction} />` in `TopBar`/`Rail`;
   - menus: `menuItem(a.myAction)` in the relevant builder (`plotMenu`, `fileMenu`, …);
   - palette: `command('group:id', 'Group', a.myAction, { keywords: '…' })` in `paletteCommands`.
4. Shortcut: add the key to `KEYS` in [`keymap.ts`](../src/components/keymap.ts), map it in `keyActions` in
   [`useShortcuts.ts`](../src/components/useShortcuts.ts), and add a row to `HELP_ROWS`. Add the key to the
   list in `keymap.test.ts`, which checks that every single-key shortcut has exactly one meaning.

### Add a field to the analysis (something the user changes and expects to keep)

1. Add it to the `Workspace` interface in [`workspace.ts`](../src/model/workspace.ts). `Analysis` includes it
   automatically (it is `Workspace` minus `version`, `window`, `selected`).
2. Give it a value in `defaultWorkspace(session)`.
3. **Validate it in `sanitizeWorkspace(raw, session)`**: accept only a well-formed value, otherwise use the
   default. This is the step people forget, and it is what protects the viewer from old or broken data.
4. Create its setter in `Scope.tsx` with `fieldSetter(setDoc, 'myField')` and use it.
5. That is all for undo, autosave, analysis files, bundles and tab sync – they work on the whole document.
6. Add a case to `workspace.test.ts` (round trip and sanitising of garbage). Bump `WORKSPACE_VERSION` only for
   an *incompatible* change; additive fields are filled from defaults.

If the new state is a *view* concern (where you look, what is open), do **not** put it in `Analysis`; keep it
in component state or `usePersistentState`.

### Add a theme colour

1. Add the field to `Theme` and set it in **both** `DARK_THEME` and `LIGHT_THEME` ([`render/theme.ts`](../src/render/theme.ts)).
2. If the page also needs it, add the CSS custom property under `:root` and `:root[data-theme='light']` in
   [`styles.css`](../src/styles.css) and an `expect` in `themeSync.test.ts`.
3. Use `theme.ink(color)` for channel/callout colours so they are legible in the light theme.

### Add a callout type

This touches the most files, in this order: `CalloutType`, `CALLOUT_TYPES`, `CALLOUT_TYPE_LABEL`,
`DEFAULT_CALLOUT_COLOR` and `sanitizeCallouts` in [`model/callouts.ts`](../src/model/callouts.ts); a geometry type in
the `CalloutGeo` union and its branch in `layoutCallouts`/`calloutShapes` in
[`render/callouts.tsx`](../src/render/callouts.tsx); interaction parts in
[`CalloutLayer.tsx`](../src/components/CalloutLayer.tsx); a `Tool` in `model/view.ts` and `TOOLS` in `keymap.ts`;
creation in `PlotArea`'s pointer handlers; menu entries in `calloutMenu`/`plotMenu`; the Callouts panel; and the
report table. Use `box` or `span` as a template – they are the most recent additions.

### Add a spectrum window

Add the key to `WindowKind` and an entry to `WINDOW_DEFS` ([`math/fft.ts`](../src/math/fft.ts)) with its cosine-sum
coefficients and documented properties; `fft.test.ts` verifies the properties numerically. The window menu,
reference panel, peak search and `isWindowKind` (used when reading saved spectra) all derive from `WINDOW_DEFS`.

## 5. Debugging tips

- **A saved state misbehaves:** DevTools → Application → Local Storage → delete `scope-viewer:ws:<fingerprint>`
  (and its entry in `scope-viewer:index`), or use *Reset to file defaults* in the app.
- **Worker issues:** both workers are module workers shown in DevTools → Sources → Threads. The compute worker
  starts only when needed (a session with no math, spectra or long measurements has none).
- **The service worker serves stale code:** DevTools → Application → Service Workers → *Unregister*, then
  *Clear site data*. It is not active in `npm run dev`.
- **Slow drawing:** check `drawTrace` – if `samplesPerPx` is large it should use the pyramid. A channel whose
  pyramid is missing or rebuilt every render would show up as a CPU spike while panning.
- **Measurements "flicker" or stay empty:** look at the slot names in `engine.measured(…, slot)`; two
  consumers sharing a slot replace each other's requests.
