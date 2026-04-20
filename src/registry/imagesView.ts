/**
 * TreeDataProvider for OLED Images from the JumperNet registry.
 * Clicking an image downloads it and opens it in the OLED bitmap editor.
 */

import * as vscode from 'vscode';
import { listImages, getImage, ImageEntry } from './client';
import { ConnectionManager } from '../connection/connectionManager';
import { cacheRegistryItem } from './cache';

export class ImagesTreeProvider implements vscode.TreeDataProvider<ImageEntry> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ImageEntry | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private items: ImageEntry[] = [];

    constructor(private connMgr: ConnectionManager) {}

    async refresh(): Promise<void> {
        this.items = await listImages();
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ImageEntry): vscode.TreeItem {
        const label = element.name || element.id;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        const dims = element.width && element.height ? `${element.width}x${element.height}` : '';
        item.description = [element.authorName, dims].filter(Boolean).join(' \u00b7 ');
        item.tooltip = element.description ?? label;
        item.iconPath = new vscode.ThemeIcon('file-media');
        item.contextValue = 'registryImage';
        item.command = {
            command: 'jumperless.registryOpenImage',
            title: 'Open',
            arguments: [element],
        };
        return item;
    }

    getChildren(): ImageEntry[] {
        return this.items;
    }
}

export function registerImagesView(
    context: vscode.ExtensionContext,
    connMgr: ConnectionManager,
): ImagesTreeProvider {
    const provider = new ImagesTreeProvider(connMgr);
    const view = vscode.window.createTreeView('jumperlessImages', { treeDataProvider: provider });
    context.subscriptions.push(view);

    view.onDidChangeVisibility(e => { if (e.visible) { provider.refresh(); } });

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.registryOpenImage', async (entry: ImageEntry) => {
            if (!entry?.id) { return; }
            try {
                const full = await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Loading ${entry.name || entry.id}...` },
                    () => getImage(entry.id),
                );
                if (!full.content) {
                    vscode.window.showWarningMessage('Image has no content');
                    return;
                }
                const bytes = Buffer.from(full.content, 'base64');
                const uri = await cacheRegistryItem(
                    context,
                    'images',
                    full.name || full.id,
                    '.bin',
                    new Uint8Array(bytes),
                );
                await vscode.commands.executeCommand('vscode.openWith', uri, 'jumperless.oledBin');
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to open image: ${err.message}`);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.registrySaveToDevice', async (entry: any) => {
            if (!entry?.id) { return; }
            if (!connMgr.connected) {
                vscode.window.showWarningMessage('Not connected to a Jumperless');
                return;
            }
            const isImage = entry.width !== undefined || entry.height !== undefined ||
                (typeof entry.id === 'string' && entry.id.length > 0 && !entry.content);

            const defaultName = isImage
                ? `/images/${entry.name || entry.id}.bin`
                : `/${(entry.name || entry.id).replace(/\s+/g, '_')}.py`;

            const targetPath = await vscode.window.showInputBox({
                prompt: 'Save as (device path)',
                value: defaultName,
            });
            if (!targetPath) { return; }

            try {
                if (isImage) {
                    const full = await getImage(entry.id);
                    if (!full.content) { throw new Error('Empty image content'); }
                    const bytes = Buffer.from(full.content, 'base64');
                    await connMgr.withRawMode(raw => raw.writeFile(targetPath, new Uint8Array(bytes)));
                } else {
                    const { getScript } = await import('./client');
                    const full = await getScript(entry.id);
                    const content = new Uint8Array(Buffer.from(full.content || '', 'utf-8'));
                    await connMgr.withRawMode(raw => raw.writeFile(targetPath, content));
                }
                await connMgr.refreshTree();
                vscode.window.showInformationMessage(`Saved to ${targetPath}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Save failed: ${err.message}`);
            }
        }),
    );

    return provider;
}
