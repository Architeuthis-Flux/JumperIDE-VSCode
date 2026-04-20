/**
 * CompletionItemProvider for Jumperless API functions and constants.
 */

import * as vscode from 'vscode';
import { getApiData, getConstants, getSymbolInfo } from './apiData';

export class JumperlessCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.CompletionItem[] {
        const data = getApiData();
        if (!data) { return []; }

        const items: vscode.CompletionItem[] = [];
        const hidden = new Set(data.hiddenSymbols.map(s => s.toLowerCase()));

        for (const sym of data.symbols) {
            if (hidden.has(sym.toLowerCase())) { continue; }
            const item = new vscode.CompletionItem(sym, vscode.CompletionItemKind.Function);
            const info = getSymbolInfo(sym);
            if (info?.signature) {
                item.detail = info.signature;
            }
            if (info?.description) {
                item.documentation = new vscode.MarkdownString(info.description);
            }
            item.sortText = `0_${sym}`;
            items.push(item);
        }

        for (const c of getConstants()) {
            const item = new vscode.CompletionItem(c, vscode.CompletionItemKind.Constant);
            item.detail = 'Jumperless constant';
            item.sortText = `1_${c}`;
            items.push(item);
        }

        return items;
    }
}
