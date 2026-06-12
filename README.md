# JumperIDE for VSCode

A MicroPython IDE extension for the [Jumperless](https://jumperless.org) programmable breadboard.

## Features

- **Serial connection** to Jumperless V5 (auto-detects the 4 CDC ports, defaults to the 3rd for MicroPython REPL)
- **On-device file browser** — browse, open, edit, and save files directly on the Jumperless
- **Integrated REPL terminal** — interactive MicroPython prompt
- **Run / Stop** — execute the current editor on the device with F5, stop with Shift+F5
- **Jumperless syntax highlighting** — functions like `connect()`, `dac_set()`, `oled_print()` and constants like `TOP_RAIL`, `GPIO_1`, `D0` are highlighted in Python files
- **Hover docs & autocomplete** — hover any Jumperless function for signature + description from the [API reference](https://docs.jumperless.org/09.5-micropythonAPIreference/)
- **OLED .bin editor** — visual pixel editor for monochrome OLED bitmaps with live-push to the device while drawing
- **JumperNet registry** — browse and download community scripts and OLED images
- **Initialize project** — one command sets up typed stubs so the whole Jumperless API (`dac_set`, `read_probe`, `TOP_RAIL`, …) autocompletes and type-checks **with no imports**, exactly like it runs on the device

## Screenshots

<!--
Add screenshots/GIFs before publishing. Put image files in images/ and reference
them with relative paths (vsce rewrites these to the repo's raw URLs on the
Marketplace). Suggested shots:

![Device file browser and REPL](images/device-browser.png)
![Autocomplete with no imports](images/autocomplete.png)
![OLED bitmap editor](images/oled-editor.png)
-->

_Screenshots coming soon._

## Installation

**From the Marketplace** — search for "JumperIDE" in the Extensions view (VS Code) or on [Open VSX](https://open-vsx.org) (Cursor / VSCodium).

**From a GitHub release** — download the `.vsix` from the [latest release](https://github.com/Architeuthis-Flux/JumperIDE-VSCode/releases/latest), then in the Extensions view open the `...` menu and choose **Install from VSIX...**, or install from the command line:

```sh
code --install-extension jumperide-<version>.vsix     # VS Code
cursor --install-extension jumperide-<version>.vsix   # Cursor
```

## Getting Started

1. Install the extension
2. Plug in your Jumperless V5
3. Open the command palette and run **Jumperless: Connect**
4. Select the 3rd serial port (marked as recommended)
5. The device file tree appears in the sidebar; click a file to edit it

Opening a device file downloads it to a local working copy so you get full
autocomplete and type-checking; **saving pushes your edits back to the board**.

### For full autocomplete

Run **Jumperless: Initialize Jumperless Project** in a workspace folder (the extension also offers this the first time you open a Python file). It writes a `typings/` folder and `pyrightconfig.json` so Pylance/Pyright recognizes the Jumperless API **globally — no `import` needed**, matching how the firmware runs your scripts after `from jumperless import *`.

It creates:

- `typings/jumperless.pyi` — typed stub generated from the bundled API reference
- `typings/builtins.pyi` — your language server's standard-library builtins with the Jumperless globals layered on top (this is how Pyright exposes "always available" names; the standard library is preserved and typo detection still works)
- `typings/time.pyi` — MicroPython `time` extras (`ticks_ms`, `sleep_ms`, …)

These files are auto-generated; re-run the command to refresh them. Requires the Python + Pylance extensions (VS Code) or the built-in Python language server (Cursor).

#### Set it up once for everything

Prefer not to init every project? Run **Jumperless: Set Up Autocomplete Globally (all workspaces)**. It writes the stubs to `~/.jumperless/typings` and points your *user-level* `python.analysis.stubPath` / `extraPaths` there, so the Jumperless API resolves with no imports in every workspace. Projects that ship their own `pyrightconfig.json` override it locally. (The same `jumperless.setup.*` toggles apply.)

#### Customizing what gets set up

Each piece is an individual toggle (Settings → Jumperless, or `settings.json`), so you can keep "just the Python stubs" and skip everything else:

| Setting | Default | Effect |
|---------|---------|--------|
| `jumperless.setup.offerOnFirstOpen` | `true` | Offer setup the first time you open a Python file |
| `jumperless.setup.jumperlessStub` | `true` | Write `typings/jumperless.pyi` (the typed API stub) |
| `jumperless.setup.globalRecognition` | `true` | Resolve the API globally with no imports (`typings/builtins.pyi`) |
| `jumperless.setup.includeTimeStub` | `true` | Write the MicroPython `time` stub |
| `jumperless.setup.writeProjectConfig` | `true` | Write `pyrightconfig.json` / `.vscode/settings.json` |
| `jumperless.setup.recommendExtensions` | `true` | Offer to install Python + Pylance |

For example, set `jumperless.setup.globalRecognition` and `jumperless.setup.writeProjectConfig` to `false` to get only the module stub (then use `from jumperless import *` in your scripts).

#### Maintainers: keeping the stub in sync

`stubs/jumperless.pyi` is the canonical typed stub from [JumperlOS](https://github.com/Architeuthis-Flux/JumperlOS) (`scripts/jumperless.pyi`). `npm run package` refreshes it automatically via `npm run sync-stubs`, which copies from a sibling `../JumperlOS` checkout (or `--from <path>` / `$JUMPERLESS_REPO`), falling back to GitHub raw. If no source is reachable it keeps the committed copy.

## Requirements

- VS Code 1.84+
- A Jumperless V5 board connected via USB
- (Optional) Python + Pylance extensions for full autocomplete

## Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| Jumperless: Connect | | Connect to a Jumperless board |
| Jumperless: Disconnect | | Disconnect |
| Jumperless: Run Current File | F5 | Execute current file on device |
| Jumperless: Stop Execution | Shift+F5 | Send Ctrl-C to stop |
| Jumperless: Refresh Device Files | | Re-scan the device filesystem |
| Jumperless: Open API Reference | | Open docs in a webview |
| Jumperless: Initialize Jumperless Project | | Set up stubs + Pylance config |
| Jumperless: Publish Script to Registry | | Share your script on JumperNet |

## Acknowledgments

Based on [JumperIDE](https://ide.jumperless.org) (web IDE) and [ViperIDE](https://github.com/vshymanskyy/ViperIDE). Autocomplete stubs are synced from [JumperlOS](https://github.com/Architeuthis-Flux/JumperlOS).

## License

[The Unlicense](LICENSE) — public domain. Do whatever you want with it, no attribution required.
