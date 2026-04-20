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
- **Initialize project** — one command to set up micropython-stubs + Pylance for full autocomplete

## Getting Started

1. Install the extension
2. Plug in your Jumperless V5
3. Open the command palette and run **Jumperless: Connect**
4. Select the 3rd serial port (marked as recommended)
5. The device file tree appears in the sidebar; click a file to edit it

### For full autocomplete

Run **Jumperless: Initialize Jumperless Project** in a workspace folder. This sets up Pylance with MicroPython stubs.

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

Based on [JumperIDE](https://ide.jumperless.org) (web IDE) and [ViperIDE](https://github.com/vshymanskyy/ViperIDE). Uses [micropython-stubs](https://github.com/Josverl/micropython-stubs) for autocomplete.

## License

MIT
