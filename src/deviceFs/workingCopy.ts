/**
 * Device files as local working copies.
 *
 * Pylance/Pyright only analyze `file://` documents, so files opened straight
 * from the `jumperless:` virtual filesystem get no autocomplete/type-checking.
 * Instead we download a device file to a local cache file (file://), open that,
 * and push it back to the device on save (reusing the same raw read/write paths
 * the FileSystemProvider uses). Combined with the global stub setup, this makes
 * full completion work on device-opened scripts.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnectionManager } from '../connection/connectionManager';
import { FsEntry } from '../connection/rawmode';
import { ensureGlobalStubsForLooseFiles } from '../stubs/initProject';

/** local working-copy fsPath (normalized) -> device path */
const mirrorToDevice = new Map<string, string>();

function norm(p: string): string {
    return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** Device path a local working-copy file maps to, if it is one. */
export function deviceTargetFor(fsPath: string): string | undefined {
    return mirrorToDevice.get(norm(fsPath));
}

function cacheRoot(context: vscode.ExtensionContext): string {
    return path.join(context.globalStorageUri.fsPath, 'device');
}

const HEX_EDITOR_ID = 'ms-vscode.hexeditor';
const HEX_EDITOR_VIEW = 'hexEditor.hexedit';
const OLED_BIN_VIEW = 'jumperless.oledBin';

/**
 * Heuristic: is this file binary (and therefore unsafe to open as text)?
 * A NUL byte is the strongest signal; we also flag files with a high ratio of
 * non-printable control bytes. Empty files are treated as text.
 */
function looksBinary(data: Uint8Array): boolean {
    const n = Math.min(data.length, 4096);
    if (n === 0) { return false; }
    let suspicious = 0;
    for (let i = 0; i < n; i++) {
        const b = data[i];
        if (b === 0) { return true; }
        // Allow tab(9), LF(10), CR(13), FF(12); anything else < 32 is control.
        if (b < 9 || (b > 13 && b < 32)) { suspicious++; }
    }
    return suspicious / n > 0.1;
}

/** Open a (device) URI in the Hex Editor, offering to install it if absent. */
async function openInHexEditor(uri: vscode.Uri): Promise<void> {
    if (!vscode.extensions.getExtension(HEX_EDITOR_ID)) {
        const pick = await vscode.window.showInformationMessage(
            `Opening this binary file needs the Hex Editor extension (${HEX_EDITOR_ID}).`,
            'Install', 'Cancel',
        );
        if (pick !== 'Install') { return; }
        try {
            await vscode.commands.executeCommand(
                'workbench.extensions.installExtension', HEX_EDITOR_ID);
        } catch (err: any) {
            vscode.window.showErrorMessage(
                `Couldn't install ${HEX_EDITOR_ID}: ${err?.message || err}`);
            return;
        }
    }
    // Open the jumperless: virtual URI directly so the FileSystemProvider
    // serves reads and pushes hex edits straight back to the device on save.
    await vscode.commands.executeCommand('vscode.openWith', uri, HEX_EDITOR_VIEW);
}

/** Open a device file as a local working copy and show it in the editor. */
export async function openDeviceFile(
    context: vscode.ExtensionContext,
    connMgr: ConnectionManager,
    entry: FsEntry,
): Promise<void> {
    if (!entry || entry.content) { return; }
    if (!connMgr.connected) {
        vscode.window.showWarningMessage('Connect to the Jumperless first.');
        return;
    }

    const devicePath = entry.path;
    let data: Uint8Array;
    try {
        data = await connMgr.withRawMode(raw => raw.readFile(devicePath));
    } catch (err: any) {
        vscode.window.showErrorMessage(`Couldn't read ${devicePath} from device: ${err?.message || err}`);
        return;
    }

    // Binary files can't be opened as a text document ("File seems to be binary
    // and cannot be opened as text"). Route them to a dedicated editor instead,
    // opening the jumperless: virtual URI so edits round-trip back to the device
    // through the FileSystemProvider on save.
    if (looksBinary(data)) {
        const virtualUri = vscode.Uri.from({ scheme: 'jumperless', path: devicePath });
        const ext = path.extname(devicePath).toLowerCase();
        try {
            if (ext === '.bin') {
                // OLED bitmaps have their own editor; everything else gets hex.
                await vscode.commands.executeCommand('vscode.openWith', virtualUri, OLED_BIN_VIEW);
            } else {
                await openInHexEditor(virtualUri);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(
                `Couldn't open ${devicePath}: ${err?.message || err}`);
        }
        return;
    }

    const local = path.join(cacheRoot(context), devicePath.replace(/^\/+/, ''));
    try {
        fs.mkdirSync(path.dirname(local), { recursive: true });
        fs.writeFileSync(local, Buffer.from(data));
    } catch (err: any) {
        vscode.window.showErrorMessage(`Couldn't cache ${devicePath} locally: ${err?.message || err}`);
        return;
    }
    mirrorToDevice.set(norm(local), devicePath);

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(local));
    await vscode.window.showTextDocument(doc, { preview: false });

    // Loose files only get Jumperless autocomplete from user-level settings.
    if (doc.languageId === 'python' || doc.languageId === 'jython') {
        void ensureGlobalStubsForLooseFiles(context);
    }
}

/** Push saved working copies back to the device. */
export function registerWorkingCopySync(
    context: vscode.ExtensionContext,
    connMgr: ConnectionManager,
    onPushed?: () => void,
): void {
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (doc) => {
            const devicePath = mirrorToDevice.get(norm(doc.uri.fsPath));
            if (!devicePath) { return; }
            if (!connMgr.connected) {
                vscode.window.showWarningMessage(
                    `Not connected — "${devicePath}" was saved locally but not pushed to the device.`);
                return;
            }
            try {
                await connMgr.withRawMode(raw =>
                    raw.writeFile(devicePath, Buffer.from(doc.getText(), 'utf8')));
                vscode.window.setStatusBarMessage(`$(check) Pushed ${devicePath} to Jumperless`, 3000);
                onPushed?.();
            } catch (err: any) {
                vscode.window.showErrorMessage(
                    `Failed to push "${devicePath}" to device: ${err?.message || err}`);
            }
        }),
    );
}
