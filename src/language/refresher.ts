/**
 * Occasional background refresh of API reference data from docs.jumperless.org.
 */

import * as vscode from 'vscode';
import { ApiRefData, updateApiData, loadApiData } from './apiData';
import { getConfig } from '../utils';

const API_REF_URL = 'https://docs.jumperless.org/09.5-micropythonAPIreference/';
const API_REF_MD_URL = 'https://raw.githubusercontent.com/Architeuthis-Flux/Jumperless-docs/main/docs/09.5-micropythonAPIreference.md';

const headingRe = /^#{3,4} `([^`]+)`\s*$/gm;

function symbolFromHeading(h: string): string {
    return h.split('(')[0].trim().toLowerCase().replace(/-/g, '_');
}

function extractHeadings(content: string): string[] {
    const headings: string[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(headingRe.source, 'gm');
    while ((m = re.exec(content)) !== null) { headings.push(m[1]); }
    return headings;
}

function extractDescriptions(content: string): Record<string, string> {
    const descriptions: Record<string, string> = {};
    const matches: { heading: string; start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(headingRe.source, 'gm');
    while ((m = re.exec(content)) !== null) {
        matches.push({ heading: m[1], start: m.index, end: re.lastIndex });
    }
    for (let i = 0; i < matches.length; i++) {
        const bodyEnd = matches[i + 1]?.start ?? content.length;
        const body = content.slice(matches[i].end, bodyEnd)
            .replace(/```[\s\S]*?```/g, '\n');
        for (const raw of body.split('\n')) {
            const line = raw.trim();
            if (!line || /^[-*+#`>|\d]/.test(line) || line.startsWith('<!--')) { continue; }
            descriptions[symbolFromHeading(matches[i].heading)] = line.replace(/\s+/g, ' ');
            break;
        }
    }
    return descriptions;
}

export async function refreshApiRef(context: vscode.ExtensionContext, force = false): Promise<void> {
    if (!force) {
        const lastFetch = context.globalState.get<number>('jumperless.apiRef.fetchedAt') ?? 0;
        const intervalDays = getConfig<number>('apiRef.refreshIntervalDays') ?? 7;
        if (Date.now() - lastFetch < intervalDays * 24 * 60 * 60 * 1000) { return; }
    }

    try {
        const resp = await fetch(API_REF_MD_URL);
        if (!resp.ok) { return; }
        const md = await resp.text();

        const headings = extractHeadings(md);
        if (headings.length < 50) { return; }

        const descriptions = extractDescriptions(md);
        const symbols = [...new Set(headings.map(symbolFromHeading))].sort();

        const existing = loadApiData(context.extensionPath, context);
        const merged: ApiRefData = {
            headings,
            descriptions: { ...existing.descriptions, ...descriptions },
            argHelp: existing.argHelp,
            hiddenSymbols: existing.hiddenSymbols,
            symbols: [...new Set([...existing.symbols, ...symbols])].sort(),
        };

        updateApiData(merged, context);
    } catch {
        // Silently fail on network errors
    }
}

export function registerRefresher(context: vscode.ExtensionContext): void {
    refreshApiRef(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.refreshApiRef', () =>
            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Refreshing API Reference...' },
                () => refreshApiRef(context, true),
            ),
        ),
    );
}
