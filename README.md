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

## Features

- Stacked waveform views with the scope's colours, labels, ground markers, trigger point and level
- Min/max decimation pyramid, so long records stay responsive
- Click a trace to select it; Ctrl+wheel changes its V/div, Alt+wheel its position
- Time cursors A/B with Δt, 1/Δt, Δv and per-channel values
- Measurements on screen, between cursors or over the whole record: max, min, pk-pk, mean, RMS,
  top, base, amplitude, frequency, period, rise/fall time (10–90 %), positive width, duty cycle
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

### Keyboard

`P` pan · `Z` zoom tool · `N` note · `M` marker · `R` region · `Esc` back to pan ·
`F` full record · `+`/`-` zoom · `←`/`→` pan · `Backspace` zoom back ·
`Enter` edit / `Delete` delete the selected callout

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
src/dsp/       min/max pyramid and measurements
src/model/     data types and callouts (storage, import/export)
src/render/    canvas drawing of views and time axis
src/components React UI (Scope workspace, plot, panels)
```

To add a new format (e.g. Rigol), write a parser that returns `Waveform` objects and add it to
`loadFiles` in `src/parsers/session.ts`.

## Deployment (Coolify)

The repository contains a multi-stage `Dockerfile` (Node build, then static files served by nginx
on port 80). In Coolify, create an application from this repository with the **Dockerfile** build
pack and set the exposed port to `80`.
