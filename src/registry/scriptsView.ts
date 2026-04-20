/**
 * TreeDataProvider for the JumperNet Registry (community scripts) sidebar.
 * Clicking a script downloads it into the extension cache and opens it
 * as a real file (tab shows the script's name, not "Untitled-1").
 */

import * as vscode from 'vscode';
import { listScripts, getScript, ScriptEntry } from './client';
import { cacheRegistryItem } from './cache';

export class ScriptsTreeProvider implements vscode.TreeDataProvider<ScriptEntry> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ScriptEntry | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private items: ScriptEntry[] = [];

    async refresh(): Promise<void> {
        this.items = await listScripts();
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ScriptEntry): vscode.TreeItem {
        const label = element.name || element.id;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.description = element.authorName ?? '';
        item.tooltip = element.description ?? label;
        item.iconPath = new vscode.ThemeIcon('file-code');
        item.contextValue = 'registryScript';
        item.command = {
            command: 'jumperless.registryOpen',
            title: 'Open',
            arguments: [element],
        };
        return item;
    }

    getChildren(): ScriptEntry[] {
        return this.items;
    }
}

export function registerScriptsView(context: vscode.ExtensionContext): ScriptsTreeProvider {
    const provider = new ScriptsTreeProvider();
    const view = vscode.window.createTreeView('jumperlessScripts', { treeDataProvider: provider });
    context.subscriptions.push(view);

    view.onDidChangeVisibility(e => { if (e.visible) { provider.refresh(); } });

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.registryOpen', async (entry: ScriptEntry) => {
            if (!entry?.id) { return; }
            try {
                const full = await getScript(entry.id);
                const text = full.content || `# ${full.name}\n# ${full.description || ''}\n`;
                const uri = await cacheRegistryItem(
                    context,
                    'scripts',
                    full.name || full.id,
                    '.py',
                    new Uint8Array(Buffer.from(text, 'utf-8')),
                );
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to open script: ${err.message}`);
            }
        }),
    );

    return provider;
}
