/**
 * Run / Stop / Upload commands.
 * Run executes the current editor's code on the device via raw REPL.
 */

import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/connectionManager';
import { MpRawMode } from '../connection/rawmode';
import { JumperlessREPL } from './terminal';

let running = false;

export function registerRunner(
    context: vscode.ExtensionContext,
    connMgr: ConnectionManager,
    getPty: () => JumperlessREPL | null,
    onRunningChange?: (running: boolean) => void,
): void {
    function setRunning(r: boolean): void {
        running = r;
        vscode.commands.executeCommand('setContext', 'jumperless.running', r);
        onRunningChange?.(r);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.run', async () => {
            if (!connMgr.connected || !connMgr.transport) {
                vscode.window.showWarningMessage('Not connected to Jumperless');
                return;
            }
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const code = editor.document.getText();
            if (!code.trim()) { return; }

            setRunning(true);

            const pty = getPty();
            // Hide cursor while the script runs so live output (rewriting
            // status lines, progress bars, ANSI animations) doesn't have
            // the terminal cursor blinking randomly across the screen.
            pty?.hideCursor();

            try {
                const raw = await MpRawMode.begin(connMgr.transport, false);
                try {
                    await raw.exec(code, -1, true);
                } finally {
                    await raw.end();
                }
            } catch (err: any) {
                if (pty) {
                    pty.write(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`);
                }
            } finally {
                pty?.showCursor();
                setRunning(false);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.stop', async () => {
            if (!connMgr.connected || !connMgr.transport) { return; }
            await connMgr.transport.write('\x03');
            getPty()?.showCursor();
            setRunning(false);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.uploadCurrentFile', async () => {
            if (!connMgr.connected) {
                vscode.window.showWarningMessage('Not connected');
                return;
            }
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            const doc = editor.document;
            const name = await vscode.window.showInputBox({
                prompt: 'Save as (device path)',
                value: `/${doc.fileName.split('/').pop() || 'main.py'}`,
            });
            if (!name) { return; }
            const content = new Uint8Array(Buffer.from(doc.getText(), 'utf-8'));
            await connMgr.withRawMode(raw => raw.writeFile(name, content));
            await connMgr.refreshTree();
            vscode.window.showInformationMessage(`Uploaded to ${name}`);
        }),
    );
}
