/**
 * "Initialize Jumperless Project" command — drops Jumperless .pyi stubs,
 * optionally installs micropython-rp2-stubs, configures .vscode/settings.json
 * and pyrightconfig.json for Pylance autocomplete.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function registerInitProject(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.initProject', async () => {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) {
                vscode.window.showWarningMessage('Open a workspace folder first');
                return;
            }
            const root = folders[0].uri.fsPath;

            const requiredExtensions = [
                { id: 'ms-python.python', name: 'Python' },
                { id: 'ms-python.vscode-pylance', name: 'Pylance' },
            ];
            for (const ext of requiredExtensions) {
                if (!vscode.extensions.getExtension(ext.id)) {
                    const install = await vscode.window.showInformationMessage(
                        `${ext.name} extension is recommended. Install it?`, 'Install', 'Skip');
                    if (install === 'Install') {
                        await vscode.commands.executeCommand(
                            'workbench.extensions.installExtension', ext.id);
                    }
                }
            }

            const typingsDir = path.join(root, 'typings');
            if (!fs.existsSync(typingsDir)) { fs.mkdirSync(typingsDir, { recursive: true }); }

            const stubSrc = path.join(context.extensionPath, 'stubs', 'jumperless.pyi');
            const stubDst = path.join(typingsDir, 'jumperless.pyi');
            if (fs.existsSync(stubSrc)) {
                fs.copyFileSync(stubSrc, stubDst);
            } else {
                fs.writeFileSync(stubDst, generateStub(context.extensionPath), 'utf-8');
            }

            const installStubs = await vscode.window.showInformationMessage(
                'Install micropython-rp2-stubs for full MicroPython autocomplete?',
                'Install via pip', 'Skip',
            );
            if (installStubs === 'Install via pip') {
                const terminal = vscode.window.createTerminal('Install Stubs');
                terminal.sendText(`pip install --target="${typingsDir}" micropython-rp2-stubs`);
                terminal.show();
            }

            const settingsDir = path.join(root, '.vscode');
            if (!fs.existsSync(settingsDir)) { fs.mkdirSync(settingsDir, { recursive: true }); }
            const settingsPath = path.join(settingsDir, 'settings.json');
            let settings: Record<string, any> = {};
            if (fs.existsSync(settingsPath)) {
                try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
            }
            settings['python.analysis.typeCheckingMode'] = settings['python.analysis.typeCheckingMode'] || 'basic';
            settings['python.analysis.extraPaths'] = settings['python.analysis.extraPaths'] || ['typings'];
            settings['python.analysis.stubPath'] = 'typings';
            settings['python.analysis.diagnosticSeverityOverrides'] = {
                ...(settings['python.analysis.diagnosticSeverityOverrides'] || {}),
                reportMissingModuleSource: 'none',
            };
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), 'utf-8');

            const pyrightPath = path.join(root, 'pyrightconfig.json');
            if (!fs.existsSync(pyrightPath)) {
                const pyright = {
                    typeCheckingMode: 'basic',
                    extraPaths: ['typings'],
                    stubPath: 'typings',
                };
                fs.writeFileSync(pyrightPath, JSON.stringify(pyright, null, 4), 'utf-8');
            }

            vscode.window.showInformationMessage(
                'Jumperless project initialized! Stubs are in typings/');
        }),
    );
}

function generateStub(extensionPath: string): string {
    const dataPath = path.join(extensionPath, 'data', 'api-ref.json');
    let headings: string[] = [];
    try {
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        headings = data.headings || [];
    } catch {}

    const lines = [
        '"""Jumperless MicroPython API stubs (auto-generated)"""',
        '',
    ];

    for (const h of headings) {
        const parenIdx = h.indexOf('(');
        if (parenIdx <= 0) { continue; }
        if (h.startsWith('jfs.') || h.startsWith('file.')) { continue; }
        const name = h.slice(0, parenIdx).trim();
        const args = h.slice(parenIdx);
        lines.push(`def ${name}${args}: ...`);
    }

    lines.push('');
    return lines.join('\n');
}
