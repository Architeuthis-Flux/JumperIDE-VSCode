/**
 * Native serial terminal — direct serial <-> terminal passthrough, like the
 * web JumperIDE's pinned "Serial Terminal" tab. Bytes go straight from the
 * port to xterm.js, so nothing gets dropped on the way.
 *
 * The command shows a port picker (port1, the device menu, recommended) with
 * an extra "Use Jumperless App" entry that launches the standalone app
 * instead — it autodetects the port and handles reconnection on its own.
 */

import * as vscode from 'vscode';
import { Transport } from './connection/transport';
import { JumperlessREPL } from './repl/terminal';
import { listSerialPorts, isJumperlessPort, portSuffix } from './connection/portPicker';
import { getConfig, sleep } from './utils';

/** Same init string the web JumperIDE sends right after connecting. */
const CONNECT_INIT_STRING = 'B1 \n';

type Target =
    | { kind: 'port'; path: string; jumperless: boolean; label: string }
    | { kind: 'app' };

async function pickTarget(): Promise<Target | undefined> {
    const all = await listSerialPorts();
    const jl = all.filter(isJumperlessPort).sort((a, b) => portSuffix(a) - portSuffix(b));
    const others = all.filter(p => !isJumperlessPort(p));

    type Item = vscode.QuickPickItem & { target?: Target };
    const items: Item[] = [];

    if (jl.length > 0) {
        items.push({ label: 'Jumperless V5', kind: vscode.QuickPickItemKind.Separator });
        for (let i = 0; i < jl.length; i++) {
            const p = jl[i];
            const suffix = portSuffix(p);
            const label = suffix !== 999 ? `port${suffix}` : p.path;
            const recommended = i === 0;
            items.push({
                label: recommended ? `$(star) ${p.path}` : p.path,
                description: label + (recommended ? ' (device menu — recommended)' : ''),
                target: { kind: 'port', path: p.path, jumperless: true, label },
            });
        }
    }

    if (others.length > 0) {
        items.push({ label: 'Other Ports', kind: vscode.QuickPickItemKind.Separator });
        for (const p of others) {
            items.push({
                label: p.path,
                description: p.manufacturer || p.serialNumber || '',
                target: { kind: 'port', path: p.path, jumperless: false, label: p.path.split('/').pop() || p.path },
            });
        }
    }

    items.push({ label: 'Jumperless App', kind: vscode.QuickPickItemKind.Separator });
    items.push({
        label: '$(rocket) Use Jumperless App',
        description: 'Standalone app — autodetects the port, handles reconnection and port contention',
        target: { kind: 'app' },
    });

    const sel = await vscode.window.showQuickPick(items, {
        title: 'Jumperless: Serial Terminal',
        placeHolder: jl.length > 0
            ? 'Pick a serial port (port1 is the device menu), or use the Jumperless App'
            : 'No Jumperless detected — pick a port or use the Jumperless App',
    });
    return sel?.target;
}

/** Live terminals by port path, so re-picking a port reveals its terminal. */
const active = new Map<string, { terminal: vscode.Terminal; transport: Transport }>();

async function openSerialTerminal(context: vscode.ExtensionContext): Promise<void> {
    const target = await pickTarget();
    if (!target) { return; }

    if (target.kind === 'app') {
        await vscode.commands.executeCommand('jumperless.openAppTerminal');
        return;
    }

    const existing = active.get(target.path);
    if (existing && existing.terminal.exitStatus === undefined && existing.transport.isOpen) {
        existing.terminal.show();
        return;
    }
    active.delete(target.path);

    const transport = new Transport();
    try {
        await transport.open(target.path, getConfig<number>('serial.baud') ?? 115200);
    } catch (err: any) {
        vscode.window.showErrorMessage(
            `Couldn't open ${target.path}: ${err?.message || err}. ` +
            'Is something else (e.g. the Jumperless App) using that port?');
        return;
    }

    const pty = new JumperlessREPL(`*** Connected to ${target.path} ***`);
    pty.attach(transport);
    transport.onDisconnect(() => {
        pty.write('\r\n\x1b[31m*** Serial port disconnected ***\x1b[0m\r\n');
    });

    const terminal = vscode.window.createTerminal({
        name: `Jumperless ${target.label}`,
        pty,
        iconPath: vscode.Uri.joinPath(context.extensionUri, 'icons', 'JumperlessRoundLogo.svg'),
        color: new vscode.ThemeColor('terminal.ansiMagenta'),
    });
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal(t => {
            if (t === terminal) {
                pty.detach();
                void transport.close();
                if (active.get(target.path)?.terminal === terminal) { active.delete(target.path); }
            }
        }),
    );

    terminal.show();
    active.set(target.path, { terminal, transport });
    if (target.jumperless) {
        await transport.write(CONNECT_INIT_STRING);
        // Show the main menu right away (small pause so the device finishes
        // processing the init string first).
        await sleep(150);
        await transport.write('m\n');
    }
}

export function registerSerialTerminal(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.openSerialTerminal', async () => {
            try {
                await openSerialTerminal(context);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Serial terminal: ${err?.message || err}`);
            }
        }),
    );
}
