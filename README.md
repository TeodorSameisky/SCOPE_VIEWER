# SCOPE_VIEWER

A web-based viewer for oscilloscope session files. It opens a saved session and lets you inspect
it like on the instrument: stacked waveform views, cursors, automatic measurements and export.

Everything happens **in the browser**: files are parsed, and math channels, spectra and the measurements of long
ranges computed, in Web Workers, so long records do not block the page. Session files are never uploaded.

## Supported files

| Format | Notes |
| --- | --- |
| Tektronix session `.tss` (4/5/6-Series MSO) | Zip with `chN.wfm`, a zipped SCPI setup (`.set`), a screenshot and `manifest.json`. Channel labels, V/div, offset/position, stacked view layout, trigger, cursors and measurements are restored from the setup, and each channel's input settings (coupling, termination, bandwidth, probe) are read from it. |
| Tektronix waveform `.wfm` (WFM#001–#003) | One or more files; drop a matching `.set` file together with them to restore the setup. Without it, the channels are fitted as *Autoscale* fits them over the whole record, a band each. FastFrame: only the first frame is shown. |
| Tektronix ISF `.isf` (TDS1000/2000, TPS2000, DPO/MSO2000–4000, MDO3000/4000) | The waveforms saved by the older families ("Save All" writes `tekNNNNCHx.isf`, a `.set` and a screenshot). Open the files together, or a `.zip` of them. Labels, V/div, position, trigger, cursors, measurements and the input settings (with the probe attenuation) come from the `.set`; without it, scale, position and coupling are taken from the waveform files. 8/16-bit, float, ASCII and envelope data are read. |
| Scope Viewer bundle `.scopeview` | A session file together with its analysis (see *Saving*). An analysis file `.scopeview.json` can also be opened together with its session file, or dropped onto an open session. |
| Rigol | Planned. |

## Layout

- **Top bar** – File menu, save status, mouse tools (Pan, Zoom, Note, Marker, Region), view navigation, cursors,
  command palette, Export
- **Plot** – with the optional overview strip above and the measurements table below
- **Right rail** – opens the side panels (Cursor readouts, Callouts, Session info & setup) and shows/hides
  the overview strip and measurements; *Focus* (`\`) hides everything except the plot
- **Channel bar** (bottom) – one badge per channel like on the scope, with its V/div, termination and bandwidth
  (and its label); click a badge for its settings
  (label, colour, V/div, position, offset, view), the eye toggles visibility. The badges stay in one row:
  in a narrow window the row scrolls sideways (mouse wheel or the arrows at its edges), and the selected
  channel is always scrolled into view

Which panels are open is remembered in the browser.

## Features

- Stacked waveform views with the scope's colours, labels, channel handles, trigger point and level. The trigger
  level is an arrow on the right edge in the colour of its source, with the source and slope (`C4 ↗`); when the
  level is outside the view, the arrow stays at the top or bottom edge, pointing towards it
- **View heights**: drag the edge between two stacked views up or down to share their height differently (no view
  gets lower than 40 px); a double-click on it gives all views the same height again. The heights are saved with
  the analysis, a drag is one undo step, and a channel moved to another view takes nothing from the heights the
  others have; a new view gets an average height
- **Grid and scales** as on a Tektronix 4/5/6-Series: each view is 10 divisions high, its time grid follows round
  times from the trigger and its rows round values of the selected channel (else the view's first), so its scale
  labels on the right sit on the rows and the grid moves with its position. Dots on every grid line mark fifths
  of a division. The labels are round values, as many as there is room for (on every 2nd, 5th … row in a short
  view, every 2nd, 5th … time in a narrow window); after a zoom rectangle, whose V/div is not a 1-2-5 value, they
  sit between the rows. They cover the whole view, as on the scope; to read another trace of the view against
  the scale, select it. The *Horizontal* box shows the length of the window next to the time per division
- Min/max decimation pyramid, so long records stay responsive
- Click a trace to select it; Ctrl+wheel changes its V/div, Alt+wheel its position
- **Autoscale** (`A`, or the button next to *Full record*): fits what is on screen of every visible channel into
  its view – V/div in 1-2-5 steps, up to 8 of the 10 divisions. Channels that share a view get a band each, so they
  do not overlap, in the order their traces are on screen (the trace on top keeps the top band); a channel whose
  waveform is not on screen is fitted over its whole record. One
  undo step. Right-click in the plot to autoscale only that view, or a channel's badge for that channel alone (into
  its band); new math channels are fitted over the whole record
- **Moving and scaling traces** with the channel tags on the left edge of the plot, the handles of the
  scope: C1, C2, … at each channel's position, which is its offset level (0 without an offset). A channel
  with an offset shows it in its tag (`C2 3.57 V`), as on the scope:
  - **drag a tag** up or down to move its trace; it snaps to whole divisions (hold Alt to place it freely),
    and a dashed line and a readout show the new position while dragging. Drop it on another view to move
    the channel there
  - **wheel on a tag**, or on a view's scale labels on the right, changes that channel's V/div (1-2-5); the
    trace expands and contracts around its tag, which stays where it is
  - a click on a tag selects the channel, a double-click opens its settings, a right-click its commands
  - tags that would cover each other are moved apart, each joined to its level by a short line; when a
    channel's position is outside the view, its tag stays at the edge with an arrow towards it
  - `↑`/`↓` move the selected channel by 0.1 div (with Shift a whole division), `Page Up`/`Page Down`
    step its V/div
- **Values at the pointer**: next to the pointer, the time and the value of every visible channel, with a
  ring where each trace crosses that time; the trace under the pointer is highlighted. Toggle with the
  crosshair button in the top bar or `V`
- Time cursors A/B with Δt, 1/Δt, Δv and per-channel values
- Measurements on screen, between cursors or over the whole record: max, min, pk-pk, mean, RMS,
  top, base, amplitude, frequency, period, rise/fall time (10–90 %), positive width, duty cycle.
  Click a column header for an explanation with a diagram, drag it to move the column; the **Reference**
  panel (book icon in the rail) documents every measurement and the reference levels used
- **Math channels** and **Spectrum (FFT)** (see below)
- **Input settings** of each channel as set on the scope: coupling, termination, bandwidth, probe attenuation,
  external attenuation and input mode, probe delay, current via shunt, invert and deskew – whatever the files hold.
  They are shown in the channel's settings, as a table in the Session panel and in the report. Its badge shows the
  termination and bandwidth, as on the scope, so a bandwidth limit is seen at a glance; AC or GND coupling, a 50 Ω
  input and an inverted channel are marked on it. Setup files name what is set for a probe, not the
  probe itself (model, serial number)
- Instrument screenshot and searchable instrument setup
- Saving in the browser, analysis files and bundles; exports to image, report and CSV (see below)
- **Undo / redo** (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z, or the arrows next to the save status) for every change
  of the analysis: channel settings and views, math channels, spectra, callouts, cursors, the measurement
  selection and the notes. A drag, a wheel gesture or a burst of typing is one step. Zooming and panning
  are not undo steps – **Back** (Backspace) returns to the previous view. The history lasts while the session
  is open; in text fields Ctrl+Z undoes the typing as usual

### Right-click menus

Right-click (on a Mac also Ctrl+click) opens the commands for what is under the pointer:

| Where | Commands |
| --- | --- |
| Plot | time at the pointer; zoom in / out here, back, full record, autoscale this view or all; put cursor A or B here; add a note or marker here, mark the region between the cursors; copy the values of all visible channels at that time; export image |
| A trace in the plot | additionally that channel's value and commands (see channel badge) |
| Channel badge | settings, hide, show only this channel / show all, autoscale, move to another view, show/remove its spectrum, use it for the cursor Δv, delete (math channels) |
| Callout (plot or Callouts panel) | edit text, colour, shape (box), values or measurements, go to, zoom to box, cursors to the callout, region, box or span ends, duplicate, delete |
| Measurement table | copy a value, a row or the whole table (tab separated, pastes as a table), explanation, move or remove a column, add a measurement, range |
| Spectrum | frequency and levels at the pointer (copy), zoom, full span, level / frequency scale, peak count, range, copy the peak list |
| Overview, horizontal box | centre the view here, back, full record, saved view |
| Stored sessions | open or locate, forget (asks first) |

The menus can be used with the keyboard (↑ ↓ Enter, Esc). Text fields keep the browser's own menu.
The **middle mouse button** pans the plot with any tool.

### Zooming

| How | What it does |
| --- | --- |
| Mouse wheel | Zoom time around the pointer (Shift+wheel or a sideways swipe pans; the same in the overview and the spectrum) |
| Right-click → Zoom in / out here | Zoom 2× around the pointer |
| **Zoom** tool, drag a rectangle | Zoom time *and* vertical range of that view |
| **Zoom** tool, click / Alt+click | Zoom in / out 2× |
| Shift+drag, or drag along the time axis | Zoom to the marked time range |
| Overview strip | Drag to mark a range, drag the box to move it, drag its edges to resize, click to centre |
| **← Back** (Backspace) | Step back through previous views, including vertical zoom |
| Full record (F, double-click) / Saved view | Whole record / the view saved on the scope |

### Callouts

Mark events directly on the waveforms:

- **Note** — text attached to a point on a trace; it follows the trace when zooming or changing V/div, and
  it is drawn in the trace's colour (also after the channel's colour is changed) until you give it another one
- **Marker** — vertical line at an event time across all views
- **Region** — a marked time span with its Δt
- **Box** — a frame around an event in time *and* amplitude (a glitch, ringing, an overshoot), drawn as a
  rectangle or an ellipse. It belongs to the trace that runs through it (the selected one if several do)
  and stays around the event when you change V/div or position. Drag its edges and corners to
  resize it (the time edges snap to edges of its trace; Alt: free), its label to move it. Like a region it
  can show measurements of a channel over its time span. *Zoom to box* (right-click) shows its time span
  with its channel scaled so the box fills the view
- **Span** — the time from a point on one trace to a point on another (a propagation delay, a reaction
  time): drag from the first trace to the second. Both ends snap to edges of their trace (Alt: exactly
  where you press and release) and stay on them; the dimension line shows the signed Δt and can be dragged
  up or down. *Show Δv, 1/Δt* adds the difference between the values at the ends (same unit) and 1/Δt;
  *Set cursors to the ends* puts the cursors there

Pick a type in the toolbar (or press N / M / R / B / D), click (or drag for a region, box or span) in the
plot and type the text. `Esc` while dragging cancels: nothing is created, a dragged callout goes back where it was.
Pressing a tool again goes back to Pan. Drag callouts to move them, double-click to edit. The **Callouts** tab lists all of them
with *Go to*; right-click a callout for its commands. Callouts are saved with the session (see *Saving*).
Callout files from earlier versions can still be opened with *File → Open analysis file*.

**Values in callouts:** a note on a trace can show the trace's value and the time at its anchor (*Show value*
in its editor, the Callouts panel or its right-click menu); it follows when the note is moved. A region can
measure a channel over its time span: choose the channel and the measurements (max, min, pk-pk, mean, RMS,
frequency, rise time, …) and they appear in its label next to Δt, e.g. `Startup  Δt 2.30 ms` /
`Ch 2: rise 120.0 µs · pk-pk 3.20 V`. The values are part of image and report exports.

**Snapping to edges:** markers and the edges of regions snap to the nearest edge of the **selected
channel** (its 50 % crossing, within 8 px of the pointer) when you place or drag them – with the Marker and
Region tools the pointer line already shows where it will land. Only real edges count (from below 10 % to
above 90 % of the amplitude), not noise around the middle. Hold **Alt** to place them freely. *Add marker at
the edge* in the right-click menu does the same.

**More:** right-click a callout to *Duplicate* it; `Shift+←` / `Shift+→` move the selected callout by one pixel;
the Callouts panel has a search box (text, title or type, e.g. "marker").

**Finding callouts:** the overview strip marks every callout along its bottom edge (click one to go there);
counters in the top corners of the plot show how many callouts lie before or after the view (click to go
to the nearest); `,` and `.` step to the previous / next callout.

Labels never get in each other's way: note boxes stay inside the plot, labels of markers that are close
together and labels of overlapping regions are stacked, and the cursor readout moves below the marker labels.
All callout labels look alike: a box in the callout's colour with its title in that colour.

Callout text can contain **TeX math**: `$V(t) = V_0\,e^{-t/\tau}$` inline, `$$\frac{1}{2\pi f_c}$$` in display
style, `\$` for a dollar sign. Formulas are rendered with MathJax (loaded the first time a callout contains
one) and appear the same in image and report exports; a formula with an error is shown as typed.

### Math channels

Click **+ Math** in the channel bar to compute a new waveform from an expression, e.g.

| Expression | Use |
| --- | --- |
| `CH1 - CH2` | differential voltage |
| `CH1 * CH3` | power (V × A = W) |
| `integ(CH1 * CH3)` | energy |
| `deriv(lowpass(CH2, 1M))` | slew rate without switching noise |
| `rms(CH1, 20m)` | moving RMS over one 50 Hz period |

Operators `+ − * / ^`, constants `pi e`, time `t`, SI suffixes (`10k`, `2.5m`, `100u`) and the
functions `abs sqrt exp ln log10 sin cos min max deriv integ avg rms lowpass highpass delay`.
Quick-operation buttons fill in common expressions. Units are derived (and can be overridden).
Math channels can reference each other, are plotted, measured, exported and saved per session file.
The Reference panel lists all functions.

### Spectrum (FFT)

Click **FFT** in the channel bar (or **Show FFT** in a channel's settings) to show the frequency spectrum
of a channel or math channel in a view below the time views, like the FFT math function of the scope.

- Computed over the samples **on screen**, **between the cursors** or of the **whole record**; it
  follows zooming and panning. Each spectrum picks its own window: Rectangular, Hann (default),
  Hamming, Blackman-Harris or Flat-top
- Levels in **dBV** (dB relative to 1 V RMS; dB(A) etc. for other units) or linear **V RMS**, each spectrum in the
  unit of its channel (with channels of different units the level axis is in plain dB / RMS);
  a sine of amplitude A reads A/√2 with every window (Flat-top keeps that between bins too)
- **Log** or **linear** frequency axis; wheel zooms the frequency, Ctrl+wheel the level axis, drag or Shift+wheel pans,
  Shift+drag zooms to a range, double-click shows the full span. Point at the plot to read frequency and level
- **Peak list**: the highest 3/5/10 peaks in view per spectrum, with interpolated frequency and level,
  ignoring noise and the window's own side lobes
- Radix-2 FFT in the browser; ranges are zero-padded to a power of two, up to 2²⁰ points (longer ranges
  are averaged in blocks first). The Reference panel explains the windows (ENBW, scalloping loss, side
  lobes), the dB scale and the resolution bandwidth

Spectra are saved per session file like math channels.

### Saving

Everything you change – channel settings and view layout, math channels, spectra, callouts, cursors,
the time window, the measurement selection and the session **notes** – is saved automatically in the
browser and restored when the same file is opened again. Files are recognised by a SHA-256 hash of
their contents, not by their name. The status next to the file name shows whether changes are saved,
and the Session panel can reset a session to the file defaults.

**Switching sessions:** opened session files are also kept in the browser (IndexedDB), so the Session
panel and the start page list the sessions known to this browser – click one to switch to it, with its
saved analysis. Files up to 300 MB each and 1 GB in total are kept (the least recently opened are dropped
first; their analyses stay and can be reopened with *Locate…*, which asks for the file). Keeping files can
be switched off in the Session panel, which also deletes the kept files. The 50 most recently changed
analyses are kept; should the browser's storage for them be full, the least recently changed analyses of
other sessions are removed so the open session can be saved, and a notice names them.

**Reloading** the page (or *Reload* for a new version) reopens the session that was open in that tab,
from its kept file. A new tab or window starts on the start page with the recent sessions.

To keep or share the work, use the **File** menu:

| File | Contents |
| --- | --- |
| Analysis `.scopeview.json` | Your work only (a few kB). Open it together with the session file, or drop it onto the open session. |
| Session with analysis `.scopeview` | The original session file(s) plus the analysis in one zip – one file to send to a colleague. |

### Export

The **Export** menu opens one dialog for all outputs:

| Output | Options |
| --- | --- |
| Image (PNG) | header (file, time base, trigger, cursors), channel legend, spectrum, measurement table, 1–3× resolution, dark (as on screen) or light appearance; copy to clipboard (HTTPS only) |
| Report (HTML) | title, notes, image, channel and math settings, measurements, cursors, callouts, spectrum peaks – one file, printable to PDF; its image is light by default |
| Waveform data (CSV) | on screen / between cursors / whole record, visible or all channels, every n-th sample |
| Measurements (CSV) | the measurement table, values in base units |
| Spectra (CSV) | the visible spectra, dB or linear as shown |

The light appearance is meant for paper and light documents: white background, grey grid, dark text.
Trace colours that are too pale on white (the yellow of CH1, light cyan, green) are dimmed just enough
for a contrast of 3:1, keeping their hue, so each channel stays recognisable.

CSV files can be written comma separated, **semicolon separated with decimal comma (Excel in DE/EU)**
or tab separated.

### Command palette

`Ctrl+K` (`⌘K` on a Mac, also `Ctrl+Shift+P`) or the search button in the top bar opens a search over every
command: tools, views and panels, autoscale, channels (select, show/hide, show only, autoscale, settings), callouts
(*Go to …* by their text), measurements (add, remove, range), files, exports and the appearance. Type a
few letters of any word (`rise`, `ch2`, `hide pulse`), choose with ↑ ↓ and run with Enter. Recently used
commands are listed first.

### Appearance

The whole app – plots, overview, spectrum, panels and dialogs – comes in a **dark** (default) and a **light**
appearance, or follows the operating system. Switch with the sun/moon button at the bottom of the rail
(or on the start page) or with *Appearance* in the command palette; the choice is remembered in the browser.
In the light appearance pale trace and callout colours are darkened for contrast, as in light exports.
Exports keep their own Dark / Light option.

### Keyboard

`Ctrl+K` command palette · `P` pan · `Z` zoom tool · `N` note · `M` marker · `R` region · `B` box · `D` span (a tool's key
again: back to pan) · `Esc` cancel a drag, back to pan ·
`Ctrl+Z` undo · `Ctrl+Y` redo · `F` full record · `A` autoscale · `+`/`-` zoom · `←`/`→` pan · `Backspace` back to the previous view · `C` cursors ·
`V` values at the pointer · `O` overview · `T` measurements · `\` focus mode ·
`Enter` edit / `Delete` (on a Mac `fn`+`⌫`) delete the selected callout · `,` / `.` previous / next callout ·
`Shift+←`/`→` move the selected callout · `Alt` while placing a marker or region: no snapping ·
`↑`/`↓` position of the selected channel by 0.1 div (Shift: 1 div; also Alt+wheel and the ± buttons) · `Page Up`/`Page Down` its V/div

The **?** button at the bottom of the rail shows all mouse and keyboard controls.

## Install as an app

Scope Viewer is an installable web app (PWA). In Chrome or Edge use **Install Scope Viewer** on the
start page or in the **File** menu (or the install icon in the address bar); on iPhone/iPad use
*Share → Add to Home Screen*. The installed app

- runs in its own window and starts from the Start menu / Dock like a desktop program,
- works **offline** – the app is cached on install; the rarely used MathJax glyph tables are cached
  the first time they are needed,
- opens `.tss`, `.wfm` and `.scopeview` files from the file explorer (*Open with → Scope Viewer*,
  Chromium on Windows/macOS/Linux),
- offers new versions with a *Reload* notice instead of changing under your hands (changes are
  autosaved, so reloading loses nothing).

Installation and offline use need **HTTPS** (or `localhost`); over plain HTTP the app works as a
normal web page. The service worker is built by `vite-plugin-pwa` (Workbox). The icons in `public/`
are generated from `public/favicon.svg` with `npx pwa-assets-generator` (config in
`pwa-assets.config.ts`).

## Development

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests (session tests run only if SessionSample/Tek000.tss exists locally)
npm run check     # type check (app, tools and tests), lint and unit tests – what CI runs before the build
npm run build     # type check + production build into dist/
npm run preview   # serve the build (http://localhost:4173), to test the service worker and offline use
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, tests and the build on every push to `main` and on pull requests.

Code layout:

```
src/parsers/    file formats (tekWfm, tekIsf, tekSetup, session = .tss/.wfm/.isf/.zip loader, worker)
src/dsp/        min/max pyramid, measurements and their documentation, edge detection
src/math/       expression language and signal processing for math channels, FFT and windows
src/compute/    the worker that evaluates math channels and computes spectra and measurements, and its client on the page
src/model/      data types, view state (time window, cursors, ranges), callouts, math, spectra,
                the workspace (autosave, analysis files), undo history and the browser's file store
src/export/     CSV, image composition, HTML report, bundles
src/render/     canvas drawing of views, time axis, spectrum and callouts; TeX; themes and fonts
src/components/ React UI (Scope workspace, plot, panels) and its hooks
src/pwa/        install prompt and files opened from the operating system
src/util/       formatting, names, clipboard, downloads
```

Only `src/components` imports from `src/components`: parsing, analysis, rendering and exports do not
depend on the UI components (exports reach the plot and the spectrum view through the small interfaces
`PlotImageSource` and `SpectrumSource` in `src/export/sessionExport.ts`).

Each command of the workspace is defined once as an *action* (`src/components/scopeCommands.ts`) and offered
by the toolbar, the menus, the command palette and the keyboard alike; the shortcuts and the help text are listed in
`src/components/keymap.ts`. The colours of the plots (`src/render/theme.ts`) and the CSS tokens in `src/styles.css`
are checked against each other by a test.

To add a new format (e.g. Rigol), write a parser that returns `Waveform` objects and add it to
`loadFiles` in `src/parsers/session.ts`.

## Deployment (Coolify)

The repository contains a multi-stage `Dockerfile` (Node build, then static files served by nginx
on port 80). In Coolify, create an application from this repository with the **Dockerfile** build
pack and set the exposed port to `80`.

## License

Scope Viewer is released under the [MIT License](LICENSE), © 2026 Teodor Sameisky.

It uses React, react-dom and scheduler (MIT), fflate (MIT), Lucide icons (ISC, partly MIT via Feather), Workbox (MIT) and
MathJax with its New Computer Modern based font (Apache-2.0; the glyphs derive from New Computer Modern by
Antonis Tsolomitis, GUST Font License / GPL with font exception). `npm run build` writes their license texts
to `third-party-licenses.txt` next to `index.html`; the app links to it on the start page and in the help popover.
