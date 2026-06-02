/**
 * TreeDataProvider for the Jumperless on-device file browser sidebar.
 * Fed by ConnectionManager.fsTree (result of walkFs()).
 */

import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/connectionManager';
import { FsEntry } from '../connection/rawmode';
import { openDeviceFile, registerWorkingCopySync } from './workingCopy';

export class DeviceTreeProvider implements vscode.TreeDataProvider<FsEntry> {
    private _onDidChangeTreeData = new vscode.EventEmitter<FsEntry | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private connMgr: ConnectionManager) {
        connMgr.onTreeUpdate(() => this._onDidChangeTreeData.fire(undefined));
        connMgr.onDidDisconnect(() => this._onDidChangeTreeData.fire(undefined));
    }

    getTreeItem(element: FsEntry): vscode.TreeItem {
        const isDir = !!element.content;
        const item = new vscode.TreeItem(
            element.name,
            isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        );
        if (!isDir) {
            item.command = {
                command: 'jumperless.openDeviceFile',
                title: 'Open',
                arguments: [element],
            };
            item.contextValue = 'file';
            item.iconPath = new vscode.ThemeIcon('file');
            if (element.size !== undefined) {
                item.description = `${element.size} B`;
            }
        } else {
            item.contextValue = 'directory';
            item.iconPath = new vscode.ThemeIcon('folder');
        }
        return item;
    }

    getChildren(element?: FsEntry): FsEntry[] {
        if (!this.connMgr.connected) { return []; }
        if (!element) {
            return this.connMgr.fsTree;
        }
        return element.content || [];
    }
}

export function registerDeviceTree(context: vscode.ExtensionContext, connMgr: ConnectionManager): void {
    const treeProvider = new DeviceTreeProvider(connMgr);
    const treeView = vscode.window.createTreeView('jumperlessDevice', {
        treeDataProvider: treeProvider,
    });
    context.subscriptions.push(treeView);

    // Open device files as local working copies so Pylance can analyze them,
    // and push edits back to the device on save.
    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.openDeviceFile', (entry: FsEntry) =>
            openDeviceFile(context, connMgr, entry)),
    );
    registerWorkingCopySync(context, connMgr);

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.refreshTree', async () => {
            await vscode.window.withProgress(
                { location: { viewId: 'jumperlessDevice' } },
                () => connMgr.refreshTree(),
            );
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.newDeviceFile', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'File name (e.g. main.py)',
                placeHolder: 'main.py',
            });
            if (!name) { return; }
            const uri = vscode.Uri.parse(`jumperless:/${name}`);
            await connMgr.withRawMode(raw => raw.touchFile(`/${name}`));
            await connMgr.refreshTree();
            await vscode.commands.executeCommand('vscode.open', uri);
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.newDeviceDir', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Directory name',
                placeHolder: 'lib',
            });
            if (!name) { return; }
            await connMgr.withRawMode(raw => raw.makePath(`/${name}`));
            await connMgr.refreshTree();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.deleteDeviceItem', async (entry: FsEntry) => {
            if (!entry) { return; }
            const confirm = await vscode.window.showWarningMessage(
                `Delete ${entry.path} from device?`, { modal: true }, 'Delete');
            if (confirm !== 'Delete') { return; }
            await connMgr.withRawMode(async raw => {
                if (entry.content) {
                    await raw.removeDir(entry.path);
                } else {
                    await raw.removeFile(entry.path);
                }
            });
            await connMgr.refreshTree();
        }),
    );
}
