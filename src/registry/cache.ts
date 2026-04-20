/**
 * Caches fetched registry items as real files in the extension's globalStorage.
 *
 * Real files (vs untitled documents) give us:
 *  - Tab title = the script/image name, not "Untitled-1"
 *  - Custom editors (e.g. OLED bin editor) work, since they need a real URI
 *  - Edits persist across restarts; user can Save As into a workspace
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

function safeName(name: string): string {
    return (name || 'untitled').replace(/[^\w\-. ]+/g, '_').slice(0, 100);
}

async function cacheRoot(context: vscode.ExtensionContext, kind: 'scripts' | 'images'): Promise<string> {
    const dir = path.join(context.globalStorageUri.fsPath, 'registry-cache', kind);
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

/**
 * Writes content to globalStorage/registry-cache/<kind>/<name>.<ext> and
 * returns a Uri suitable for `vscode.workspace.openTextDocument` /
 * `vscode.commands.executeCommand('vscode.openWith', uri, viewType)`.
 *
 * If the same name already exists with the same content, the existing
 * file is returned (so reopening a script doesn't make duplicate tabs).
 */
export async function cacheRegistryItem(
    context: vscode.ExtensionContext,
    kind: 'scripts' | 'images',
    name: string,
    ext: string,
    content: Uint8Array,
): Promise<vscode.Uri> {
    const root = await cacheRoot(context, kind);
    const fileName = `${safeName(name)}${ext.startsWith('.') ? ext : '.' + ext}`;
    const filePath = path.join(root, fileName);

    let needsWrite = true;
    try {
        const existing = await fs.readFile(filePath);
        if (existing.byteLength === content.byteLength &&
            Buffer.compare(existing, Buffer.from(content)) === 0) {
            needsWrite = false;
        }
    } catch {
        // file doesn't exist yet
    }
    if (needsWrite) {
        await fs.writeFile(filePath, content);
    }
    return vscode.Uri.file(filePath);
}
