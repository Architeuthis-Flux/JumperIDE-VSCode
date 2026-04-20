/**
 * "Actions" sidebar webview — buttons for Connect, Run, Stop, Save,
 * Upload, Refresh. Buttons enable/disable based on connection
 * and run state.
 *
 * Themed pink + rainbow with the Jumperless bubble logo as the header.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionManager } from './connection/connectionManager';

export class ActionsViewProvider implements vscode.WebviewViewProvider {
    static readonly viewType = 'jumperlessActions';
    private view: vscode.WebviewView | null = null;

    constructor(
        private context: vscode.ExtensionContext,
        private connMgr: ConnectionManager,
    ) {
        connMgr.onDidConnect(() => this.postState());
        connMgr.onDidDisconnect(() => this.postState());
    }

    setRunning(running: boolean): void {
        this.postState(running);
    }

    private _running = false;

    private postState(running?: boolean): void {
        if (running !== undefined) { this._running = running; }
        if (!this.view) { return; }
        this.view.webview.postMessage({
            type: 'state',
            connected: this.connMgr.connected,
            running: this._running,
            deviceLabel: this.connMgr.deviceInfo?.machine || '',
        });
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        const iconsRoot = vscode.Uri.file(path.join(this.context.extensionPath, 'icons'));
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [iconsRoot],
        };
        view.webview.html = this.html(view.webview);

        view.webview.onDidReceiveMessage(msg => {
            switch (msg.command) {
                case 'connect': vscode.commands.executeCommand('jumperless.connect'); break;
                case 'disconnect': vscode.commands.executeCommand('jumperless.disconnect'); break;
                case 'run': vscode.commands.executeCommand('jumperless.run'); break;
                case 'stop': vscode.commands.executeCommand('jumperless.stop'); break;
                case 'save': vscode.commands.executeCommand('workbench.action.files.save'); break;
                case 'upload': vscode.commands.executeCommand('jumperless.uploadCurrentFile'); break;
                case 'refresh': vscode.commands.executeCommand('jumperless.refreshTree'); break;
                case 'openTerminal': vscode.commands.executeCommand('jumperless.showTerminal'); break;
                case 'apiRef': vscode.commands.executeCommand('jumperless.openApiRef'); break;
                case 'initProject': vscode.commands.executeCommand('jumperless.initProject'); break;
                case 'publish': vscode.commands.executeCommand('jumperless.pushScriptToRegistry'); break;
            }
        });

        view.onDidChangeVisibility(() => { if (view.visible) { this.postState(); } });
        this.postState();
    }

    private html(webview: vscode.Webview): string {
        const ext = this.context.extensionUri;
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(ext, 'icons', 'ColorBubbleLogoIDE1x.png'));
        const cspSource = webview.cspSource;

        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
:root {
    --jl-pink: #ff1f8f;
    --jl-pink-bright: #ff5cb0;
    --jl-pink-dim: rgba(255, 31, 143, 0.18);
    --jl-rainbow: linear-gradient(90deg,
        #ff4d6d 0%, #ff9b54 18%, #ffd166 36%,
        #06d6a0 56%, #4cc9f0 76%, #b298dc 100%);
}
body {
    padding: 0;
    margin: 0;
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    font-size: 12px;
}
.header {
    position: relative;
    padding: 10px 10px 12px;
    background: linear-gradient(180deg, rgba(255,31,143,0.10), transparent 80%);
    text-align: center;
}
.header img {
    width: 100%;
    max-width: 220px;
    height: auto;
}
.header::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 2px;
    background: var(--jl-rainbow);
    border-radius: 2px;
    opacity: 0.85;
}
.body { padding: 8px 8px 12px; }
.section { margin-bottom: 12px; }
.section h3 {
    margin: 0 0 6px 0;
    font-size: 10.5px;
    text-transform: uppercase;
    color: var(--jl-pink);
    font-weight: 600;
    letter-spacing: 1px;
}
.btn-row { display: flex; gap: 4px; margin-bottom: 4px; }
button {
    flex: 1;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid transparent;
    padding: 6px 8px;
    cursor: pointer;
    font-size: 12px;
    border-radius: 4px;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: background 120ms ease, border-color 120ms ease, transform 80ms ease;
}
button:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground);
    border-color: var(--jl-pink-dim);
}
button:active:not(:disabled) { transform: translateY(1px); }
button:disabled { opacity: 0.35; cursor: default; }

button.primary {
    background: var(--jl-pink);
    color: #fff;
    font-weight: 600;
    border: 1px solid var(--jl-pink-bright);
    box-shadow: 0 0 0 1px rgba(255,31,143,0.25), 0 1px 6px rgba(255,31,143,0.35);
}
button.primary:hover:not(:disabled) {
    background: var(--jl-pink-bright);
    box-shadow: 0 0 0 1px rgba(255,92,176,0.45), 0 2px 10px rgba(255,31,143,0.55);
}

button.rainbow {
    color: #fff;
    font-weight: 700;
    border: 1px solid transparent;
    background:
        linear-gradient(var(--vscode-editor-background), var(--vscode-editor-background)) padding-box,
        var(--jl-rainbow) border-box;
    border-width: 1.5px;
    background-clip: padding-box, border-box;
    color: var(--vscode-foreground);
    position: relative;
    overflow: hidden;
}
button.rainbow:hover:not(:disabled) {
    background:
        var(--jl-rainbow) padding-box,
        var(--jl-rainbow) border-box;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
}

button.danger {
    background: linear-gradient(135deg, #c2185b, #ff1f8f);
    color: #fff;
    font-weight: 600;
    border: 1px solid #ff5cb0;
    box-shadow: 0 0 8px rgba(255,31,143,0.35);
}
button.danger:hover:not(:disabled) {
    background: linear-gradient(135deg, #ff1f8f, #ff5cb0);
}

.icon { font-family: codicon; font-size: 14px; }
.status {
    padding: 6px 8px;
    margin: 0 0 10px;
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--jl-pink);
    font-size: 11px;
    border-radius: 0 4px 4px 0;
    position: relative;
    overflow: hidden;
}
.status.disconnected { border-left-color: #888; opacity: 0.85; }
.status.connected {
    border-left-color: transparent;
    background:
        linear-gradient(var(--vscode-textBlockQuote-background), var(--vscode-textBlockQuote-background)) padding-box,
        var(--jl-rainbow) border-box;
    border: 1.5px solid transparent;
    border-radius: 4px;
}
.status.running {
    border-left-color: transparent;
    background:
        linear-gradient(var(--vscode-textBlockQuote-background), var(--vscode-textBlockQuote-background)) padding-box,
        var(--jl-rainbow) border-box;
    border: 1.5px solid transparent;
    border-radius: 4px;
    animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255,31,143,0.0); }
    50%      { box-shadow: 0 0 12px 2px rgba(255,31,143,0.45); }
}
</style>
</head>
<body>
<div class="header">
    <img src="${logoUri}" alt="Jumperless"/>
</div>
<div class="body">
<div id="status" class="status disconnected">Disconnected</div>

<div class="section">
    <h3>Connection</h3>
    <div class="btn-row"><button id="btn-connect" class="primary">Connect</button></div>
    <div class="btn-row"><button id="btn-disconnect">Disconnect</button></div>
</div>

<div class="section">
    <h3>Execute</h3>
    <div class="btn-row"><button id="btn-run" class="rainbow">▶ Run Current File</button></div>
    <div class="btn-row"><button id="btn-stop" class="danger">■ Stop</button></div>
</div>

<div class="section">
    <h3>File</h3>
    <div class="btn-row"><button id="btn-save">💾 Save</button></div>
    <div class="btn-row"><button id="btn-upload">⬆ Upload to Device</button></div>
    <div class="btn-row"><button id="btn-refresh">↻ Refresh Files</button></div>
</div>

<div class="section">
    <h3>Tools</h3>
    <div class="btn-row"><button id="btn-api-ref">📖 API Reference</button></div>
    <div class="btn-row"><button id="btn-init">⚙ Initialize Project</button></div>
    <div class="btn-row"><button id="btn-publish">↗ Publish to JumperNet</button></div>
</div>
</div>

<script>
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);
const buttons = {
    connect: $('btn-connect'), disconnect: $('btn-disconnect'),
    run: $('btn-run'), stop: $('btn-stop'),
    save: $('btn-save'), upload: $('btn-upload'),
    refresh: $('btn-refresh'),
    apiRef: $('btn-api-ref'), initProject: $('btn-init'),
    publish: $('btn-publish'),
};

const cmd = {
    connect: 'connect', disconnect: 'disconnect',
    run: 'run', stop: 'stop',
    save: 'save', upload: 'upload',
    refresh: 'refresh',
    apiRef: 'apiRef', initProject: 'initProject',
    publish: 'publish',
};

for (const [key, btn] of Object.entries(buttons)) {
    btn.addEventListener('click', () => vscode.postMessage({ command: cmd[key] }));
}

const statusEl = $('status');

function setState(s) {
    const { connected, running, deviceLabel } = s;
    buttons.connect.disabled = connected;
    buttons.disconnect.disabled = !connected;
    buttons.run.disabled = !connected || running;
    buttons.stop.disabled = !running;
    buttons.upload.disabled = !connected;
    buttons.refresh.disabled = !connected;
    statusEl.classList.remove('connected', 'disconnected', 'running');
    if (running) {
        statusEl.classList.add('running');
        statusEl.textContent = '▶ Running on ' + (deviceLabel || 'device');
    } else if (connected) {
        statusEl.classList.add('connected');
        statusEl.textContent = '● Connected: ' + (deviceLabel || 'Jumperless');
    } else {
        statusEl.classList.add('disconnected');
        statusEl.textContent = '○ Disconnected';
    }
}

window.addEventListener('message', e => {
    if (e.data?.type === 'state') setState(e.data);
});

setState({ connected: false, running: false });
</script>
</body>
</html>`;
    }
}
