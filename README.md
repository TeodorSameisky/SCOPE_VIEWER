# SCOPE_VIEWER

A web-based viewer for oscilloscope session files. It opens a saved session and lets you inspect
it like on the instrument: stacked waveform views, cursors, automatic measurements and export.

All parsing happens **in the browser** (in a Web Worker). Session files are never uploaded.

## Supported files

| Format | Notes |
| --- | --- |
| Tektronix session `.tss` (4/5/6-Series MSO) | Zip with `chN.wfm`, a zipped SCPI setup (`.set`), a screenshot and `manifest.json`. Channel labels, V/div, offset/position, stacked view layout, trigger, cursors and measurements are restored from the setup. |
| Tektronix waveform `.wfm` (WFM#001–#003) | One or more files; drop a matching `.set` file together with them to restore the setup. FastFrame: only the first frame is shown. |
| Rigol | Planned. |

## Layout

- **Top bar** – open file, mouse tools (Pan, Zoom, Note, Marker, Region), view navigation, cursors, Export menu
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
- Export the visible range as CSV and the plot (including callouts) as PNG

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
with *Go to*. Callouts are stored in the browser per session file (identified by a SHA-256 hash of
its contents) and can be exported/imported as JSON to share them.

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
src/model/     data types and callouts (storage, import/export)
src/render/    canvas drawing of views, time axis and spectrum
src/components React UI (Scope workspace, plot, panels)
```

To add a new format (e.g. Rigol), write a parser that returns `Waveform` objects and add it to
`loadFiles` in `src/parsers/session.ts`.

## Deployment (Coolify)

The repository contains a multi-stage `Dockerfile` (Node build, then static files served by nginx
on port 80). In Coolify, create an application from this repository with the **Dockerfile** build
pack and set the exposed port to `80`.
