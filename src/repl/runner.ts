/**
 * Run / Stop / Save commands.
 * Run executes the current editor's code on the device via raw REPL.
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { ConnectionManager } from '../connection/connectionManager';
import { MpRawMode } from '../connection/rawmode';
import { JumperlessREPL } from './terminal';
import { deviceTargetFor } from '../deviceFs/workingCopy';

/** Last device path each (non-working-copy) document was saved to. */
const savedDeviceTargets = new Map<string, string>();

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

    // "Save to Jumperless" — the one save action for device work.
    // - Files opened from the device push straight back to their device path.
    // - Any other file (or untitled buffer) asks for a device path once,
    //   then remembers it as the prefill for next time.
    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.saveToDevice', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('Open a file to save it to the Jumperless.');
                return;
            }
            const doc = editor.document;

            const target = deviceTargetFor(doc.uri.fsPath);
            if (target) {
                if (doc.isDirty) {
                    // The working-copy save hook pushes to the device.
                    await doc.save();
                    return;
                }
                // Not dirty (e.g. a previous save happened while disconnected):
                // push the current content explicitly.
                if (!connMgr.connected) {
                    vscode.window.showWarningMessage('Not connected to Jumperless');
                    return;
                }
                await connMgr.withRawMode(raw =>
                    raw.writeFile(target, Buffer.from(doc.getText(), 'utf8')));
                vscode.window.setStatusBarMessage(`$(check) Pushed ${target} to Jumperless`, 3000);
                return;
            }

            if (!connMgr.connected) {
                vscode.window.showWarningMessage('Not connected to Jumperless');
                return;
            }
            const key = doc.uri.toString();
            const name = await vscode.window.showInputBox({
                prompt: 'Save to Jumperless as (device path)',
                value: savedDeviceTargets.get(key) ?? `/${path.basename(doc.fileName) || 'main.py'}`,
            });
            if (!name) { return; }
            savedDeviceTargets.set(key, name);

            if (!doc.isUntitled) { await doc.save(); }
            const content = new Uint8Array(Buffer.from(doc.getText(), 'utf-8'));
            await connMgr.withRawMode(raw => raw.writeFile(name, content));
            await connMgr.refreshTree();
            vscode.window.setStatusBarMessage(`$(check) Saved ${name} to Jumperless`, 3000);
        }),
    );

    // "Save Locally" — get a copy onto the computer.
    // - Device working copies and untitled buffers export via a Save As dialog
    //   (their backing file lives in hidden extension storage, if anywhere).
    // - Regular files just save in place.
    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.saveLocally', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('Open a file to save it locally.');
                return;
            }
            const doc = editor.document;
            const target = deviceTargetFor(doc.uri.fsPath);

            if (!target && !doc.isUntitled) {
                await doc.save();
                vscode.window.setStatusBarMessage('$(check) Saved locally', 2000);
                return;
            }

            const defaultDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
            const defaultName = target ? path.basename(target) : (path.basename(doc.fileName) || 'script.py');
            const dest = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(defaultDir, defaultName)),
                saveLabel: 'Save Copy',
            });
            if (!dest) { return; }
            try {
                await vscode.workspace.fs.writeFile(dest, Buffer.from(doc.getText(), 'utf8'));
            } catch (err: any) {
                vscode.window.showErrorMessage(`Couldn't save ${dest.fsPath}: ${err?.message || err}`);
                return;
            }
            const choice = await vscode.window.showInformationMessage(`Saved to ${dest.fsPath}`, 'Open');
            if (choice === 'Open') {
                await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(dest));
            }
        }),
    );
}
