# SCOPE_VIEWER

A web-based viewer for oscilloscope session files. It opens a saved session and lets you inspect
it like on the instrument: stacked waveform views, cursors, automatic measurements and export.

All parsing happens **in the browser** (in a Web Worker). Session files are never uploaded.

## Supported files

| Format | Notes |
| --- | --- |
| Tektronix session `.tss` (4/5/6-Series MSO) | Zip with `chN.wfm`, a zipped SCPI setup (`.set`), a screenshot and `manifest.json`. Channel labels, V/div, offset/position, stacked view layout, trigger, cursors and measurements are restored from the setup. |
| Tektronix waveform `.wfm` (WFM#001–#003) | One or more files; drop a matching `.set` file together with them to restore the setup. FastFrame: only the first frame is shown. |
| Scope Viewer bundle `.scopeview` | A session file together with its analysis (see *Saving*). An analysis file `.scopeview.json` can also be opened together with its session file, or dropped onto an open session. |
| Rigol | Planned. |

## Layout

- **Top bar** – File menu, save status, mouse tools (Pan, Zoom, Note, Marker, Region), view navigation, cursors, Export
- **Plot** – with the optional overview strip above and the measurements table below
- **Right rail** – opens the side panels (Cursor readouts, Callouts, Session info & setup) and shows/hides
  the overview strip and measurements; *Focus* (`\`) hides everything except the plot
- **Channel bar** (bottom) – one badge per channel like on the scope; click a badge for its settings
  (label, colour, V/div, position, offset, view), the eye toggles visibility

Which panels are open is remembered in the browser.

## Features

- Stacked waveform views with the scope's colours, labels, ground markers, trigger point and level
- Min/max decimation pyramid, so long records stay responsive
- Click a trace to select it; Ctrl+wheel changes its V/div, Alt+wheel its position
- Time cursors A/B with Δt, 1/Δt, Δv and per-channel values
- Measurements on screen, between cursors or over the whole record: max, min, pk-pk, mean, RMS,
  top, base, amplitude, frequency, period, rise/fall time (10–90 %), positive width, duty cycle.
  Click a column header for an explanation with a diagram; the **Reference** panel (book icon in the
  rail) documents every measurement and the reference levels used
- **Math channels** and **Spectrum (FFT)** (see below)
- Instrument screenshot and searchable instrument setup
- Saving in the browser, analysis files and bundles; exports to image, report and CSV (see below)

### Zooming

| How | What it does |
| --- | --- |
| Mouse wheel | Zoom time around the pointer (Shift+wheel pans) |
| **Zoom** tool, drag a rectangle | Zoom time *and* vertical range of that view |
| **Zoom** tool, click / Alt+click | Zoom in / out 2× |
| Shift+drag, or drag along the time axis | Zoom to the marked time range |
| Overview strip | Drag to mark a range, drag the box to move it, drag its edges to resize, click to centre |
| **↶ Back** (Backspace) | Step back through previous views, including vertical zoom |
| Full record (F, double-click) / Saved view | Whole record / the view saved on the scope |

### Callouts

Mark events directly on the waveforms:

- **Note** — text attached to a point on a trace; it follows the trace when zooming or changing V/div
- **Marker** — vertical line at an event time across all views
- **Region** — a marked time span with its Δt

Pick a type in the toolbar (or press N / M / R), click (or drag for a region) in the plot and type
the text. Drag callouts to move them, double-click to edit. The **Callouts** tab lists all of them
with *Go to*. Callouts are saved with the session (see *Saving*); the Callouts panel can also export/import
just the callouts as JSON.

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
- Levels in **dBV** (dB relative to 1 V RMS; dB(A) etc. for other units) or linear **V RMS**;
  a sine of amplitude A reads A/√2 with every window (Flat-top keeps that between bins too)
- **Log** or **linear** frequency axis; wheel zooms the frequency, Ctrl+wheel the level axis, drag pans,
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
their contents, not by their name. The status next to the file name shows whether changes are saved;
the Session panel lists stored sessions (the 50 most recent are kept) and can reset a session to the
file defaults.

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

### Keyboard

`P` pan · `Z` zoom tool · `N` note · `M` marker · `R` region · `Esc` back to pan ·
`F` full record · `+`/`-` zoom · `←`/`→` pan · `Backspace` zoom back · `C` cursors ·
`O` overview · `T` measurements · `\` focus mode ·
`Enter` edit / `Delete` delete the selected callout

The **?** button at the bottom of the rail shows all mouse and keyboard controls.

## Development

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests (session tests run only if SessionSample/Tek000.tss exists locally)
npm run build     # type check + production build into dist/
```

Code layout:

```
src/parsers/   file formats (tekWfm, tekSetup, session = .tss/.wfm loader, worker)
src/dsp/       min/max pyramid, measurements and their documentation
src/math/      expression language and signal processing for math channels, FFT and windows
src/model/     data types, callouts, math, spectra and the workspace (autosave, analysis files)
src/export/    CSV, image composition, HTML report, bundles
src/render/    canvas drawing of views, time axis and spectrum
src/components React UI (Scope workspace, plot, panels)
```

To add a new format (e.g. Rigol), write a parser that returns `Waveform` objects and add it to
`loadFiles` in `src/parsers/session.ts`.

## Deployment (Coolify)

The repository contains a multi-stage `Dockerfile` (Node build, then static files served by nginx
on port 80). In Coolify, create an application from this repository with the **Dockerfile** build
pack and set the exposed port to `80`.
