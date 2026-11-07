# Scope Viewer – developer documentation

Scope Viewer is a browser-only viewer for oscilloscope session files. You open a saved Tektronix
session, and inspect it the way you would on the instrument: stacked waveform views, cursors,
automatic measurements, math channels, FFT, annotations, and exports. Everything – parsing, math,
measurements, storage – happens in the browser. Nothing is uploaded.

This folder explains **how the code works**. The user-facing manual (features, shortcuts, file
formats) is the [root README](../README.md); read it first if you have never used the app.

> **Snapshot:** version 0.1.0 · React 19 + TypeScript 6 + Vite 8 · about 23,000 lines of TypeScript
> including tests · 48 test files, 475 tests.

---

## Where to start

If you read only one document, read **[Architecture](architecture.md)**. It has the big picture, the
three diagrams that matter (layers, runtime, life of a file) and the reasoning behind the main design
decisions. Then read **[Data model](data-model.md)**, because every other document uses its words.

After that, pick what you need:

| I want to… | Read |
| --- | --- |
| Understand how a file turns into pixels | [Architecture](architecture.md) → [File loading](file-loading.md) → [Rendering](rendering.md) |
| Add support for a new file format (e.g. Rigol) | [File loading](file-loading.md), then the recipe in [Development](development.md#add-a-file-format) |
| Add or change a measurement | [Analysis](analysis.md#measurements), then [Development](development.md#add-a-measurement) |
| Add a math function | [Analysis](analysis.md#the-math-channel-language), then [Development](development.md#add-a-math-function) |
| Change what a user action does to the analysis (add/remove a channel, callout, …) | [State and persistence](state-and-persistence.md#the-analysis-store-and-its-edits), then [Development](development.md#add-an-edit-a-change-a-user-can-make-to-the-analysis) |
| Change how saving, undo, or multi-tab sync works | [State and persistence](state-and-persistence.md) |
| Add a command, a menu item or a shortcut | [User interface](ui.md#3-actions-one-definition-four-places), then [Development](development.md#add-a-command-or-shortcut) |
| Change colours, fonts or the light/dark theme | [Rendering](rendering.md#6-themes) |
| Understand why the UI stays responsive on huge records | [Workers and compute](workers-and-compute.md) |
| Change an export (PNG, HTML report, CSV, bundle) | [Exports](exports.md) |
| Build, deploy, or debug the installable app (PWA) | [Build and deploy](build-and-deploy.md) |
| Find which file does what | [Module map](module-map.md) |
| Look up a term | [Glossary](glossary.md) |

## The documents

| Document | What is in it |
| --- | --- |
| [Architecture](architecture.md) | Goals, layers and their dependency rules, runtime topology (page, workers, storage), the life of a file and of an edit, key design decisions |
| [Data model](data-model.md) | `Session`, `Workspace`, `Analysis`, `LiveChannel`; coordinates and units; identifiers; limits |
| [File loading](file-loading.md) | The parse worker, `loadFiles` and the format adapters, the Tektronix `.wfm`/`.isf`/`.set` parsers, bundles and analysis files |
| [Workers and compute](workers-and-compute.md) | The compute worker protocol, `ComputeEngine` scheduling, the min/max pyramid, result caching |
| [Analysis](analysis.md) | How measurements, edge detection, the math-channel language and the FFT work |
| [State and persistence](state-and-persistence.md) | Where state lives, undo/redo, navigation history, autosave, multi-tab sync, kept files |
| [Rendering](rendering.md) | Canvas and SVG layers, the plot geometry, themes, callouts, TeX |
| [User interface](ui.md) | Component tree, the action system, menus, command palette, keyboard, panels |
| [Exports](exports.md) | Image, report, CSV and bundle generation |
| [Build and deploy](build-and-deploy.md) | Vite, PWA and service worker, CI, Docker/nginx, licences |
| [Development](development.md) | Setup, tests, conventions, and step-by-step recipes for common changes |
| [Module map](module-map.md) | Every source file with a one-line description |
| [Glossary](glossary.md) | Scope, app and code vocabulary |

## Conventions used in these documents

- Paths are relative to the repository root. Links such as [`src/model/workspace.ts`](../src/model/workspace.ts)
  open the file.
- Diagrams are [Mermaid](https://mermaid.js.org/). GitHub renders them. In VS Code, install a Mermaid
  Markdown preview extension; in a plain text viewer you will see the diagram source, which is still
  readable.
- "The page" means the main browser thread. "A worker" means a Web Worker.
- Function and type names are real; if a name in these documents does not exist in the code, the
  document is out of date – please fix it.
