/**
 * Additional status bar items (managed by ConnectionManager for the main one).
 * This module registers the publish-to-registry command.
 */

import * as vscode from 'vscode';
import { ConnectionManager } from './connection/connectionManager';
import { createScript } from './registry/client';

export function registerStatusBarCommands(
    context: vscode.ExtensionContext,
    connMgr: ConnectionManager,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.pushScriptToRegistry', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }
            const content = editor.document.getText();
            const name = await vscode.window.showInputBox({ prompt: 'Script name' });
            if (!name) { return; }
            const description = await vscode.window.showInputBox({ prompt: 'Description (optional)' });
            const authorName = await vscode.window.showInputBox({ prompt: 'Author (optional)' });

            try {
                const entry = await createScript({
                    name,
                    description: description || '',
                    authorName: authorName || '',
                    content,
                });
                vscode.window.showInformationMessage(`Published: ${entry.id}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Publish failed: ${err.message}`);
            }
        }),
    );
}
