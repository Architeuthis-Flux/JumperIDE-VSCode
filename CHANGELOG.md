# Changelog

All notable changes to the JumperIDE extension are documented here.

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
