/**
 * HoverProvider for Jumperless API functions and constants.
 */

import * as vscode from 'vscode';
import { getSymbolInfo, getConstants, loadApiData } from './apiData';

export class JumperlessHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.Hover | null {
        const range = document.getWordRangeAtPosition(position, /[\w.]+/);
        if (!range) { return null; }
        const word = document.getText(range);

        let lookupName = word;
        if (word.startsWith('jfs.')) {
            lookupName = word;
        } else if (word.startsWith('file.')) {
            lookupName = word;
        }

        const info = getSymbolInfo(lookupName);
        if (!info) { return null; }

        const parts: string[] = [];

        if (info.signature) {
            parts.push(`\`\`\`python\n${info.signature}\n\`\`\``);
        } else {
            parts.push(`\`\`\`python\n${info.name}\n\`\`\``);
        }

        if (info.description) {
            parts.push(info.description);
        }

        if (info.argHelp) {
            const argLines: string[] = [];
            for (const [arg, desc] of Object.entries(info.argHelp)) {
                argLines.push(`- **\`${arg}\`**: ${desc}`);
            }
            if (argLines.length) {
                parts.push('\n**Parameters:**\n' + argLines.join('\n'));
            }
        }

        const md = new vscode.MarkdownString(parts.join('\n\n'));
        md.isTrusted = true;
        return new vscode.Hover(md, range);
    }
}
