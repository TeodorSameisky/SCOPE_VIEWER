# Glossary

Words used in the code, the UI and these documents. Oscilloscope terms first, then Scope Viewer terms.

## Oscilloscope terms

| Term | Meaning |
| --- | --- |
| **Acquisition / record** | The samples the scope captured. The *record* is the whole captured time span. |
| **Autoscale** | Here: fit the vertical settings of channels so their traces fill their view (not the instrument's own Autoset). |
| **Bandwidth limit** | Input filter setting of a channel (e.g. 20 MHz), shown on its badge. |
| **Channel (CH1…)** | One input of the scope and its waveform. |
| **Coupling** | How a channel input is connected: DC, AC, GND, DC reject. |
| **Cursor (A/B)** | Two vertical lines for time and value readouts and Δt, 1/Δt, Δv. |
| **dBV** | Level in dB relative to 1 V RMS: `20·log10(Vrms / 1 V)`. |
| **Division (div)** | One grid square. A view is 10 divisions high; the time axis is labelled per division. |
| **Duty cycle** | Positive pulse width divided by the period, in %. |
| **ENBW** | Equivalent noise bandwidth of an FFT window, in bins. |
| **FastFrame** | Tektronix mode that stores many short acquisitions; only the first frame is read. |
| **FFT** | Fast Fourier transform: the frequency spectrum of a signal. |
| **ISF** | Tektronix "Internal Save Format" waveform file from older scopes. |
| **Offset** | Value shown at the channel's position marker. |
| **Position** | Vertical placement of a channel in divisions from the centre of its view. |
| **Probe attenuation** | Factor of the probe (10× → the scope displays 10× the voltage at the input). |
| **Rise time / fall time** | Time for an edge to go from 10 % to 90 % (or back) of the amplitude. |
| **Sample interval (dt)** | Time between samples; the reciprocal of the sample rate. |
| **SCPI** | Command language of instruments; a `.set` setup file is a list of SCPI commands. |
| **Scalloping loss** | Amplitude error of an FFT when a tone falls between two bins. |
| **Trigger** | The event that defines time 0 in a record. |
| **TSS** | Tektronix session file of 4/5/6-Series MSOs: a zip of waveforms, setup, screenshot. |
| **V/div** | Vertical scale: channel units per division. |
| **WFM** | Tektronix binary waveform file (WFM#001–003). |

## Scope Viewer terms

| Term | Meaning |
| --- | --- |
| **Action** | A command defined once (`Action`) and offered by the toolbar, menus, command palette and keyboard; its palette entry (`palette`) and its one-key shortcut (`hint`) are part of its definition. |
| **Analysis** | The undoable, saveable, shareable part of the workspace – everything but the time window and the selected channel. Also the name of the `.scopeview.json` file. |
| **Analysis store** | `AnalysisStore`: the analysis in one place outside React. Components, undo and autosave subscribe to it; changes are made with `update`. |
| **Autosave** | Writing the workspace to `localStorage` 400 ms after a change. |
| **Badge** | A channel's chip in the channel bar. |
| **Bundle** | A `.scopeview` file: the session file(s) plus the analysis in one zip. |
| **Callout** | An annotation: note, marker, region, box or span. |
| **Channel tag** | The handle at the left edge of a view, at the channel's position; drag to move the trace. |
| **Compute engine / worker** | `ComputeEngine` (page) and the worker it controls, which evaluates math channels and computes spectra and long measurements. |
| **Edit** | A pure function `(Analysis, args) → Analysis` in `model/edits.ts` that makes one change a user can make; it returns the same object when nothing changes. |
| **Format adapter** | `FormatAdapter`: what a family of scopes provides to be read (which files are waveforms, how to make a `Session` of them). `loadFiles` uses the first adapter that finds a waveform. |
| **Fingerprint** | SHA-256 of a session's file contents; identifies a session across visits, renames and tabs. |
| **Focus mode** | Hides all panels; remembers what was open. |
| **Generation** | A counter in `App` used as the React `key` of `Scope`, so a new file or replaced analysis remounts the workspace. |
| **Gutter** | The 64 px strip right of each plot for the scale labels (`AXIS_GUTTER`). |
| **Kept files** | Session files stored in IndexedDB so a stored session can be reopened without choosing the file again. |
| **LiveChannel** | A channel with a waveform and its pyramid, ready to draw: input channels plus successfully computed math channels. |
| **Math channel** | A waveform computed from an expression (`CH1 - CH2`), ids `MATH1`…`MATH8`. |
| **Migration (step)** | A function that turns saved data of one format version into the next (`WORKSPACE_MIGRATIONS`); `sanitizeWorkspace` runs the steps before it checks the data. |
| **Min/max pyramid** | Precomputed minima and maxima at several resolutions for fast drawing and range queries. |
| **Overview** | The strip above the plot showing the whole record. |
| **Palette** | The command palette (`Ctrl+K`). |
| **Pending** | A measurement or spectrum that is being computed in the worker; the old value is shown dimmed meanwhile. |
| **Rail** | The icon column at the right edge that opens side panels. |
| **Ref** | A short name for a sample array that crossed to the worker: `src:CH1` (input) or `m:3` (math result). |
| **Sanitise** | Rebuild a value from untrusted data into a valid shape, using defaults for anything wrong. |
| **Session** | What a file says (`Session`): waveforms and the scope's settings. Read-only. |
| **Slot** | A name for "who is asking" a worker job (`table:CH1`, `spectrum:FFT1`, `edges:CH1`); a newer job of the same slot replaces an older waiting one. |
| **Snapping** | Placing markers, region edges, boxes and span ends exactly on an edge of the selected trace. |
| **Stale** | A worker reply for a sample array that no longer exists; treated as "not computed". |
| **Step (undo)** | A group of changes undone together, e.g. a whole drag. Where one ends is decided by the `StepGrouper`. |
| **Take over** | Adopting an analysis another tab saved (`takeOver`). |
| **View** | One stacked plot area with its own 10-division grid, holding one or more channels. Numbered from the top. (Not to be confused with the *view state*: the time window.) |
| **View state** | Where you are looking: the time window and the selected channel. Not undoable. |
| **Workspace** | Everything about the user's work on a session: `Analysis` + view state. |
