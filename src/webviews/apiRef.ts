/**
 * Opens the Jumperless API Reference in a webview panel,
 * loading docs.jumperless.org. Header strip uses the bubble logo + pink/rainbow accent.
 */

import * as vscode from 'vscode';

const API_REF_URL = 'https://docs.jumperless.org/09.5-micropythonAPIreference/';

export function registerApiRefWebview(context: vscode.ExtensionContext): void {
    let panel: vscode.WebviewPanel | null = null;

    context.subscriptions.push(
        vscode.commands.registerCommand('jumperless.openApiRef', () => {
            if (panel) {
                panel.reveal(vscode.ViewColumn.Beside);
                return;
            }
            const iconsRoot = vscode.Uri.joinPath(context.extensionUri, 'icons');
            panel = vscode.window.createWebviewPanel(
                'jumperless.apiRef',
                'Jumperless API Reference',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [iconsRoot],
                },
            );
            panel.iconPath = vscode.Uri.joinPath(iconsRoot, 'jumperless-device.svg');
            panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);
            panel.onDidDispose(() => { panel = null; });
        }),
    );
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'icons', 'JumperlessBubbleLogo.svg'));
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src 'unsafe-inline'; frame-src https://docs.jumperless.org;">
    <style>
        :root {
            --jl-pink: #ff1f8f;
            --jl-pink-bright: #ff5cb0;
            --jl-rainbow: linear-gradient(90deg,
                #ff4d6d 0%, #ff9b54 18%, #ffd166 36%,
                #06d6a0 56%, #4cc9f0 76%, #b298dc 100%);
        }
        body, html {
            margin: 0; padding: 0;
            width: 100%; height: 100%;
            overflow: hidden;
            background: var(--vscode-editor-background);
        }
        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 14px 10px;
            background: linear-gradient(180deg, rgba(255,31,143,0.10), transparent 90%);
            border-bottom: 2px solid transparent;
            background-image:
                linear-gradient(180deg, rgba(255,31,143,0.10), transparent 90%),
                var(--jl-rainbow);
            background-repeat: no-repeat, no-repeat;
            background-size: 100% 100%, 100% 2px;
            background-position: top, bottom;
            flex: 0 0 auto;
        }
        .header img {
            height: 28px;
        }
        .header .title {
            font-family: var(--vscode-font-family);
            font-weight: 600;
            color: var(--jl-pink-bright);
            font-size: 13px;
            letter-spacing: 0.4px;
        }
        .header .url {
            margin-left: auto;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .frame-wrap {
            position: absolute;
            top: 50px; bottom: 0; left: 0; right: 0;
        }
        iframe { width: 100%; height: 100%; border: none; background: white; }
    </style>
</head>
<body>
    <div class="header">
        <img src="${logoUri}" alt="Jumperless"/>
        <div class="title">Jumperless API Reference</div>
        <div class="url">docs.jumperless.org</div>
    </div>
    <div class="frame-wrap">
        <iframe src="${API_REF_URL}" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>
    </div>
</body>
</html>`;
}
