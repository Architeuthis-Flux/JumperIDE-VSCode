/**
 * CustomEditorProvider for Jumperless OLED .bin files.
 * Ported from JumperIDE/src/oled_bin_viewer.js — same binary format,
 * same draw modes, same SSD1306 framebuffer conversion.
 */

import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/connectionManager';

interface OledParsed {
    width: number;
    height: number;
    dataOffset: number;
    hasHeader: boolean;
}

function parseOledBin(bytes: Uint8Array): OledParsed | null {
    const size = bytes.length;
    if (size < 4) { return null; }
    const w = bytes[0] | (bytes[1] << 8);
    const h = bytes[2] | (bytes[3] << 8);
    if (w > 0 && w <= 128 && h > 0 && h <= 64) {
        const expected = Math.floor((w * h + 7) / 8);
        if (expected === size - 4) {
            return { width: w, height: h, dataOffset: 4, hasHeader: true };
        }
    }
    if (size === 512) { return { width: 128, height: 32, dataOffset: 0, hasHeader: false }; }
    if (size === 1024) { return { width: 128, height: 64, dataOffset: 0, hasHeader: false }; }
    if (size === 256) { return { width: 64, height: 32, dataOffset: 0, hasHeader: false }; }
    if (size === 496) { return { width: 128, height: 31, dataOffset: 0, hasHeader: false }; }
    return null;
}

class OledBinDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    private _bytes: Uint8Array;
    private _disposed = false;

    constructor(uri: vscode.Uri, bytes: Uint8Array) {
        this.uri = uri;
        this._bytes = bytes;
    }

    get bytes(): Uint8Array { return this._bytes; }
    set bytes(b: Uint8Array) { this._bytes = b; }

    dispose(): void { this._disposed = true; }
}

export class OledBinEditorProvider implements vscode.CustomEditorProvider<OledBinDocument> {
    private static readonly viewType = 'jumperless.oledBin';
    private _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<OledBinDocument>>();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    constructor(
        private connMgr: ConnectionManager,
        private extensionUri: vscode.Uri,
    ) {}

    static register(context: vscode.ExtensionContext, connMgr: ConnectionManager): vscode.Disposable {
        const provider = new OledBinEditorProvider(connMgr, context.extensionUri);
        return vscode.window.registerCustomEditorProvider(
            OledBinEditorProvider.viewType, provider, {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            },
        );
    }

    async openCustomDocument(uri: vscode.Uri): Promise<OledBinDocument> {
        const data = await vscode.workspace.fs.readFile(uri);
        return new OledBinDocument(uri, new Uint8Array(data));
    }

    async resolveCustomEditor(
        document: OledBinDocument,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        const iconsRoot = vscode.Uri.joinPath(this.extensionUri, 'icons');
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [iconsRoot],
        };
        webviewPanel.iconPath = vscode.Uri.joinPath(iconsRoot, 'jumperless-device.svg');
        webviewPanel.webview.html = this.getHtml(document, webviewPanel.webview);

        const postState = () => webviewPanel.webview.postMessage({
            type: 'state',
            connected: this.connMgr.connected,
        });
        const subA = this.connMgr.onDidConnect(postState);
        const subB = this.connMgr.onDidDisconnect(postState);
        webviewPanel.onDidDispose(() => { subA.dispose(); subB.dispose(); });

        webviewPanel.webview.onDidReceiveMessage(async (msg: any) => {
            // The handler's promise is floating: a throw (e.g. device FS write
            // failing after disconnect) would become an unhandled rejection.
            try {
                switch (msg.type) {
                    case 'save':
                        document.bytes = new Uint8Array(msg.data);
                        await vscode.workspace.fs.writeFile(document.uri, document.bytes);
                        break;
                    case 'dirty':
                        document.bytes = new Uint8Array(msg.data);
                        this._onDidChangeCustomDocument.fire({
                            document,
                            undo: () => {},
                            redo: () => {},
                        });
                        break;
                    case 'pushFramebuffer':
                        if (this.connMgr.connected && this.connMgr.transport) {
                            // Fast path: same as JumperIDE — write directly to the
                            // normal REPL prompt, no raw mode. Returns instantly so
                            // 100ms-debounced pushes don't pile up.
                            await this.connMgr.transport.sendOledFramebufferLive(msg.base64);
                        }
                        break;
                    case 'requestState':
                        webviewPanel.webview.postMessage({
                            type: 'state',
                            connected: this.connMgr.connected,
                        });
                        break;
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`OLED editor: ${err.message}`);
            }
        });
    }

    async saveCustomDocument(document: OledBinDocument): Promise<void> {
        await vscode.workspace.fs.writeFile(document.uri, document.bytes);
    }

    async saveCustomDocumentAs(document: OledBinDocument, destination: vscode.Uri): Promise<void> {
        await vscode.workspace.fs.writeFile(destination, document.bytes);
    }

    async revertCustomDocument(document: OledBinDocument): Promise<void> {
        const data = await vscode.workspace.fs.readFile(document.uri);
        document.bytes = new Uint8Array(data);
    }

    async backupCustomDocument(
        document: OledBinDocument,
        context: vscode.CustomDocumentBackupContext,
    ): Promise<vscode.CustomDocumentBackup> {
        await vscode.workspace.fs.writeFile(context.destination, document.bytes);
        return { id: context.destination.toString(), delete: () => {} };
    }

    private getHtml(document: OledBinDocument, webview: vscode.Webview): string {
        const parsed = parseOledBin(document.bytes);
        const w = parsed?.width ?? 128;
        const h = parsed?.height ?? 32;
        const offset = parsed?.dataOffset ?? 0;
        const hasHeader = parsed?.hasHeader ?? false;
        const bytesBase64 = Buffer.from(document.bytes).toString('base64');
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'icons', 'JumperlessRoundLogo.svg'));
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
    --jl-pink-dim: rgba(255,31,143,0.18);
    --jl-rainbow: linear-gradient(90deg,
        #ff4d6d 0%, #ff9b54 18%, #ffd166 36%,
        #06d6a0 56%, #4cc9f0 76%, #b298dc 100%);
}
body {
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    padding: 0;
    margin: 0;
}
.header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px 12px;
    position: relative;
    background: linear-gradient(180deg, rgba(255,31,143,0.08), transparent 80%);
}
.header::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 2px;
    background: var(--jl-rainbow);
    opacity: 0.85;
}
.header img {
    width: 28px; height: 28px;
}
.header .title {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.4px;
    color: var(--jl-pink-bright);
}
.content { padding: 14px 16px 18px; }
.toolbar { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
.toolbar button {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid transparent;
    padding: 5px 12px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
    transition: background 120ms ease, border-color 120ms ease;
}
.toolbar button:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground);
    border-color: var(--jl-pink-dim);
}
.toolbar button.active {
    background: var(--jl-pink);
    color: #fff;
    border-color: var(--jl-pink-bright);
    box-shadow: 0 0 0 1px rgba(255,31,143,0.35), 0 0 8px rgba(255,31,143,0.45);
}
.toolbar button:disabled { opacity: 0.4; cursor: default; }
.info { font-size: 12px; margin-bottom: 8px; color: var(--vscode-descriptionForeground); }
.live-badge { padding: 2px 10px; border-radius: 10px; font-size: 11px; margin-left: auto; font-weight: 600; }
.live-badge.connected { background: var(--jl-pink); color: #fff; box-shadow: 0 0 8px rgba(255,31,143,0.4); }
.live-badge.disconnected { background: #555; color: #ccc; }
.live-badge.pushing {
    color: #150810;
    background: var(--jl-rainbow);
}
canvas {
    image-rendering: pixelated;
    cursor: crosshair;
    border: 1.5px solid transparent;
    border-radius: 4px;
    background:
        #000 padding-box,
        var(--jl-rainbow) border-box;
    box-shadow: 0 4px 18px rgba(255,31,143,0.18);
}
.canvas-wrap { display: inline-block; padding: 4px; }
.dims { margin-top: 12px; font-size: 12px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dims input {
    width: 60px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 2px 6px;
    border-radius: 3px;
}
.dims input:focus { outline: none; border-color: var(--jl-pink); }
.dims button {
    background: var(--jl-pink);
    color: #fff;
    border: 1px solid var(--jl-pink-bright);
    padding: 3px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}
.dims button:hover { background: var(--jl-pink-bright); }
label { font-size: 12px; margin-left: 8px; display: inline-flex; align-items: center; gap: 4px; }
input[type="checkbox"] { accent-color: var(--jl-pink); }
</style>
</head>
<body>
<div class="header">
    <img src="${logoUri}" alt="Jumperless"/>
    <div class="title">OLED Bitmap Editor</div>
</div>
<div class="content">
<div class="info" id="info"></div>
<div class="toolbar" id="toolbar"></div>
<div class="canvas-wrap"><canvas id="canvas"></canvas></div>
<div class="dims" id="dims"></div>
</div>
<script>
const vscode = acquireVsCodeApi();
const SCALE = 4;
let width = ${w}, height = ${h}, hasHeader = ${hasHeader};
let dataOffset = ${offset};
const raw = Uint8Array.from(atob('${bytesBase64}'), c => c.charCodeAt(0));
const bitmapLen = Math.floor((width * height + 7) / 8);
let bitmap = new Uint8Array(raw.buffer, raw.byteOffset + dataOffset, bitmapLen).slice();
let drawMode = 'toggle', inverted = false, isDrawing = false;
let liveUpdate = true, pushTimeout = 0;
let connected = false;
const toggledThisStroke = new Set();

function getPixel(bm, w, h, x, y) {
    if (x<0||x>=w||y<0||y>=h) return 0;
    const bpr = Math.ceil(w/8);
    return (bm[y*bpr+(x>>3)] >> (7-(x&7))) & 1;
}
function setPixel(bm, w, h, x, y, v) {
    if (x<0||x>=w||y<0||y>=h) return;
    const bpr = Math.ceil(w/8);
    const bi = y*bpr+(x>>3), bit = 7-(x&7);
    if (v) bm[bi] |= 1<<bit; else bm[bi] &= ~(1<<bit);
}
function togglePixel(bm, w, h, x, y) {
    if (x<0||x>=w||y<0||y>=h) return;
    const bpr = Math.ceil(w/8);
    bm[y*bpr+(x>>3)] ^= 1<<(7-(x&7));
}

function buildFile() {
    if (hasHeader) {
        const out = new Uint8Array(4 + bitmap.length);
        out[0]=width&0xff; out[1]=(width>>8)&0xff;
        out[2]=height&0xff; out[3]=(height>>8)&0xff;
        out.set(bitmap, 4);
        return out;
    }
    return new Uint8Array(bitmap);
}

function toSsd1306Fb() {
    const oh = height > 32 ? 64 : 32;
    const fb = new Uint8Array(oh===32 ? 512 : 1024);
    for (let y=0; y<oh; y++) for (let x=0; x<128; x++) {
        if (getPixel(bitmap, width, height, x, y))
            fb[(y>>3)*128+x] |= 1<<(y&7);
    }
    return fb;
}

function pushNow() {
    if (!connected) return;
    const fb = toSsd1306Fb();
    let bin = ''; for (let i=0; i<fb.length; i++) bin += String.fromCharCode(fb[i]);
    vscode.postMessage({ type: 'pushFramebuffer', base64: btoa(bin) });
    setBadge('pushing');
    setTimeout(() => setBadge(connected ? 'connected' : 'disconnected'), 200);
}

function schedulePush() {
    if (!liveUpdate || !connected) return;
    clearTimeout(pushTimeout);
    pushTimeout = setTimeout(pushNow, 100);
}

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function render() {
    canvas.width = width; canvas.height = height;
    canvas.style.width = (width*SCALE)+'px'; canvas.style.height = (height*SCALE)+'px';
    const img = ctx.createImageData(width, height);
    for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
        let v = getPixel(bitmap, width, height, x, y);
        if (inverted) v = 1-v;
        const c = v ? 255 : 0;
        const i = (y*width+x)*4;
        img.data[i]=img.data[i+1]=img.data[i+2]=c; img.data[i+3]=255;
    }
    ctx.putImageData(img, 0, 0);
}

function pixelCoords(e) {
    const r = canvas.getBoundingClientRect();
    return [Math.floor((e.clientX-r.left)/r.width*width), Math.floor((e.clientY-r.top)/r.height*height)];
}

function draw(x, y) {
    const key = x+','+y;
    if (drawMode==='toggle') {
        if (toggledThisStroke.has(key)) return;
        toggledThisStroke.add(key);
        togglePixel(bitmap, width, height, x, y);
    } else {
        setPixel(bitmap, width, height, x, y, drawMode==='white'?1:0);
    }
    render();
    vscode.postMessage({ type: 'dirty', data: Array.from(buildFile()) });
    schedulePush();
}

canvas.addEventListener('pointerdown', e => { isDrawing=true; toggledThisStroke.clear(); const [x,y]=pixelCoords(e); draw(x,y); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (!isDrawing) return; const [x,y]=pixelCoords(e); draw(x,y); });
canvas.addEventListener('pointerup', () => { isDrawing=false; });

const toolbar = document.getElementById('toolbar');
['black','white','toggle'].forEach(mode => {
    const btn = document.createElement('button');
    btn.textContent = mode.charAt(0).toUpperCase()+mode.slice(1);
    btn.className = mode===drawMode ? 'active' : '';
    btn.onclick = () => { drawMode=mode; toolbar.querySelectorAll('button').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); };
    toolbar.appendChild(btn);
});
const invBtn = document.createElement('button');
invBtn.textContent = 'Invert';
invBtn.onclick = () => { inverted=!inverted; render(); };
toolbar.appendChild(invBtn);
const saveBtn = document.createElement('button');
saveBtn.textContent = 'Save';
saveBtn.onclick = () => { vscode.postMessage({ type: 'save', data: Array.from(buildFile()) }); };
toolbar.appendChild(saveBtn);
const pushBtn = document.createElement('button');
pushBtn.textContent = '↗ Push to Device';
pushBtn.title = 'Send the current bitmap to the OLED now';
pushBtn.onclick = pushNow;
toolbar.appendChild(pushBtn);

const liveLabel = document.createElement('label');
const liveCb = document.createElement('input');
liveCb.type = 'checkbox'; liveCb.checked = liveUpdate;
liveCb.onchange = () => {
    liveUpdate = liveCb.checked;
    if (liveUpdate) pushNow();
};
liveLabel.appendChild(liveCb);
liveLabel.appendChild(document.createTextNode(' Live to device'));
toolbar.appendChild(liveLabel);

const badge = document.createElement('span');
badge.className = 'live-badge disconnected';
badge.textContent = '○ Disconnected';
toolbar.appendChild(badge);

function setBadge(kind) {
    badge.classList.remove('connected', 'disconnected', 'pushing');
    badge.classList.add(kind);
    if (kind === 'connected') badge.textContent = '● Connected';
    else if (kind === 'disconnected') badge.textContent = '○ Disconnected';
    else if (kind === 'pushing') badge.textContent = '↗ Pushing...';
    pushBtn.disabled = !connected;
}

window.addEventListener('message', e => {
    if (e.data?.type === 'state') {
        connected = !!e.data.connected;
        setBadge(connected ? 'connected' : 'disconnected');
        if (connected && liveUpdate) pushNow();
    }
});

vscode.postMessage({ type: 'requestState' });

document.getElementById('info').textContent = width+'x'+height+' '+(hasHeader?'with header':'raw');

const dims = document.getElementById('dims');
const wIn = document.createElement('input'); wIn.type='number'; wIn.min='1'; wIn.max='1024'; wIn.value=String(width);
const hIn = document.createElement('input'); hIn.type='number'; hIn.min='1'; hIn.max='1024'; hIn.value=String(height);
const resBtn = document.createElement('button'); resBtn.textContent='Resize';
resBtn.onclick = () => {
    const nw = Math.max(1,Math.min(1024,parseInt(wIn.value)||width));
    const nh = Math.max(1,Math.min(1024,parseInt(hIn.value)||height));
    if (nw===width&&nh===height) return;
    const nl = Math.floor((nw*nh+7)/8);
    const nb = new Uint8Array(nl);
    for (let y=0;y<Math.min(height,nh);y++) for (let x=0;x<Math.min(width,nw);x++)
        setPixel(nb,nw,nh,x,y,getPixel(bitmap,width,height,x,y));
    width=nw; height=nh; bitmap=nb; hasHeader=true;
    wIn.value=String(width); hIn.value=String(height);
    render();
    document.getElementById('info').textContent = width+'x'+height+' with header';
    vscode.postMessage({ type: 'dirty', data: Array.from(buildFile()) });
    schedulePush();
};
dims.appendChild(document.createTextNode('W: ')); dims.appendChild(wIn);
dims.appendChild(document.createTextNode(' H: ')); dims.appendChild(hIn);
dims.appendChild(document.createTextNode(' ')); dims.appendChild(resBtn);

render();
</script>
</div>
</body>
</html>`;
    }
}
