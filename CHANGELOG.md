# Changelog

All notable changes to the JumperIDE extension are documented here.

## [0.1.5]

### Added
- **Serial Terminal** — direct raw terminal to any serial port (port1 device menu recommended, auto-shows the main menu), with a "Use Jumperless App" option that launches the standalone app in a terminal, installing it from PyPI automatically (via uv/pipx/pip).
- **New OLED Bitmap** — create a blank 128×32 OLED `.bin` on the device or locally and open it in the bitmap editor (Actions panel button + Device Files toolbar icon).
- **Save to Jumperless / Save Locally** — one save action that pushes device files back to their device path and asks other files for a path once; Save Locally exports a copy via Save As.
- Combined connection button in the Actions panel: shows live status, hover to connect/disconnect.
- Ctrl+Q is passed through to Jumperless terminals (device menus use it to exit) instead of triggering the editor shortcut.
- README: screenshots, demo video, and a feature tour.

### Changed
- **Initialize Jumperless Project** is now **Set Up This Folder for Jumperless Python** — device files get autocomplete automatically (global setup self-heals quietly); the per-folder command is for your own projects.
- Settings writes are JSONC-safe (comments in `settings.json` survive) and cover Pylance, cursorpyright, and basedpyright.

### Fixed
- macOS: serial ports open via `/dev/cu.*` instead of `/dev/tty.*` (no more spurious "Resource busy").
- Extension failed to activate when packaged (jsonc-parser's UMD build leaked dynamic requires into the bundle).
- Hover docs no longer show unrelated parameters scraped into the wrong function.

## [0.1.0]

Initial release.

### Added
- Serial connection to Jumperless V5 (auto-detects the 4 CDC ports, defaults to the MicroPython REPL port).
- On-device file browser — browse, open, edit, and save files directly on the board.
- Integrated MicroPython REPL terminal.
- Run / Stop the current file on the device (F5 / Shift+F5).
- Jumperless syntax highlighting and hover docs/autocomplete sourced from the API reference.
- OLED `.bin` bitmap editor with live push-to-device while drawing.
- JumperNet registry browser for community scripts and OLED images.
- **Initialize Jumperless Project** — one command sets up typed stubs so the whole
  Jumperless API resolves with full autocomplete and types and **no imports**, mirroring
  how the firmware runs scripts after `from jumperless import *`. The stub is synced from
  the canonical JumperlOS source.
- **Set Up Autocomplete Globally** — apply the same setup to every workspace via
  user-level settings.
- Granular `jumperless.setup.*` toggles to control exactly what the setup writes.
