/**
 * "Jumperless App" terminal — launches the standalone Jumperless CLI app
 * (https://github.com/Architeuthis-Flux/Jumperless-App, `jumperless` on PyPI)
 * in an integrated terminal, installing it first if it isn't on PATH.
 */

import * as vscode from 'vscode';
import * as cp from 'child_process';

const TERMINAL_NAME = 'Jumperless App';

function onPath(cmd: string): Promise<boolean> {
    const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    return new Promise(resolve => cp.exec(probe, err => resolve(!err)));
}

/**
 * Pick the launch (and, if needed, install) command. Preference order:
 * already installed > uv > pipx > plain pip. uv/pipx handle PEP 668
 * (externally-managed Python, e.g. Homebrew) where bare pip refuses.
 */
async function launchCommand(): Promise<string> {
    if (await onPath('jumperless')) { return 'jumperless'; }
    if (await onPath('uv')) { return 'uv tool install jumperless && uv tool run jumperless'; }
    if (await onPath('pipx')) { return 'pipx install jumperless && pipx run jumperless'; }
    const py = process.platform === 'win32' ? 'python' : 'python3';
    return `${py} -m pip install jumperless && jumperless`;
}

export function registerAppTerminal(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.openAppTerminal', async () => {
            const existing = vscode.window.terminals.find(t => t.name === TERMINAL_NAME);
            if (existing && existing.exitStatus === undefined) {
                existing.show();
                return;
            }
            const cmd = await launchCommand();
            const term = vscode.window.createTerminal({
                name: TERMINAL_NAME,
                iconPath: vscode.Uri.joinPath(context.extensionUri, 'icons', 'JumperlessRoundLogo.svg'),
                color: new vscode.ThemeColor('terminal.ansiMagenta'),
                // The app draws a full-color TUI (curses-style menus, ANSI art,
                // truecolor). Make sure it detects a capable terminal even when
                // the default shell profile sets a conservative TERM.
                env: {
                    TERM: 'xterm-256color',
                    COLORTERM: 'truecolor',
                    FORCE_COLOR: '3',
                    PYTHONUNBUFFERED: '1',
                },
            });
            term.show();
            term.sendText(cmd, true);
        }),
    );
}
