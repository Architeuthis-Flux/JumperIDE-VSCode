/**
 * Pseudoterminal that bridges the serial transport to a VSCode terminal.
 * Keystrokes go to the device; device output appears in the terminal.
 *
 * Three responsibilities beyond the basic byte pump:
 *   1. Coalesce serial chunks into one webview write per animation frame
 *      using setImmediate, so VSCode's terminal renderer isn't called
 *      hundreds of times per second.
 *   2. Cap the queued buffer size so a runaway loop can't lock the UI.
 *   3. Normalize bare LF (\n) into CRLF (\r\n) on the way out — this is
 *      the equivalent of xterm.js's `convertEol: true`, which we can't set
 *      directly because vscode.Pseudoterminal is a raw byte pipe.
 *      Without it, MicroPython output that ends a line with just \n
 *      "staircases" across the screen.
 *      The CR/LF state is carried across chunk boundaries so a split
 *      \r\n at a packet boundary doesn't get a duplicate CR injected.
 */

import * as vscode from 'vscode';
import { Transport } from '../connection/transport';
import { getConfig } from '../utils';

const FLUSH_BUFFER_BYTES = 64 * 1024;

const CR = 0x0d;
const LF = 0x0a;

let inputDebugChannel: vscode.OutputChannel | null = null;
function getInputDebugChannel(): vscode.OutputChannel {
    if (!inputDebugChannel) {
        inputDebugChannel = vscode.window.createOutputChannel('JumperIDE Terminal IO');
    }
    return inputDebugChannel;
}

/** ASCII-render a small data string for human-readable logs. */
function dbgEscape(s: string): string {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 0x0a) { out += '\\n'; }
        else if (c === 0x0d) { out += '\\r'; }
        else if (c === 0x09) { out += '\\t'; }
        else if (c === 0x1b) { out += '\\e'; }
        else if (c === 0x7f) { out += '\\x7f'; }
        else if (c < 0x20) { out += '\\x' + c.toString(16).padStart(2, '0'); }
        else { out += s[i]; }
    }
    return out;
}

export class JumperlessREPL implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number | void>();
    readonly onDidWrite = this.writeEmitter.event;
    readonly onDidClose = this.closeEmitter.event;

    constructor(private readonly banner: string = 'Jumperless REPL ready') {}

    private transport: Transport | null = null;
    private prevReceive: ((data: string) => void) | null = null;

    private pendingChunks: string[] = [];
    private pendingBytes = 0;
    private flushScheduled = false;

    private convertEol = true;
    private lastByteWasCR = false;
    private debugIo = false;

    attach(transport: Transport): void {
        this.transport = transport;
        this.prevReceive = transport.receiveCallback;
        this.convertEol = getConfig<boolean>('terminal.convertEol') ?? true;
        this.debugIo = getConfig<boolean>('terminal.debugIo') ?? false;
        transport.onReceive(data => this.enqueue(data));
    }

    detach(): void {
        // If a script was hiding the cursor, make sure we put it back before
        // we lose the chance to write to the terminal.
        this.showCursor();
        if (this.transport && this.prevReceive) {
            this.transport.onReceive(this.prevReceive);
        }
        this.flushNow();
        this.transport = null;
        this.prevReceive = null;
        this.lastByteWasCR = false;
    }

    /** Hide the terminal cursor (DECTCEM). Useful while a script with
     *  in-place output (animations, progress bars) is running. */
    hideCursor(): void {
        this.writeEmitter.fire('\x1b[?25l');
    }

    /** Show the terminal cursor again. Always paired with hideCursor in a
     *  try/finally so we can't get stuck cursor-less on errors. */
    showCursor(): void {
        this.writeEmitter.fire('\x1b[?25h');
    }

    /**
     * Convert any \n that is NOT preceded by \r into \r\n. State carries
     * across chunks via lastByteWasCR so a CRLF split at the boundary
     * doesn't get a spurious CR added.
     */
    private normalizeEol(data: string): string {
        if (!this.convertEol || data.length === 0) { return data; }
        let out = '';
        let runStart = 0;
        for (let i = 0; i < data.length; i++) {
            const code = data.charCodeAt(i);
            if (code === LF && !this.lastByteWasCR) {
                if (i > runStart) { out += data.slice(runStart, i); }
                out += '\r\n';
                runStart = i + 1;
            }
            this.lastByteWasCR = (code === CR);
        }
        if (runStart === 0) { return data; }
        if (runStart < data.length) { out += data.slice(runStart); }
        return out;
    }

    private enqueue(data: string): void {
        if (!data) { return; }
        const normalized = this.normalizeEol(data);
        this.pendingChunks.push(normalized);
        this.pendingBytes += normalized.length;
        if (this.pendingBytes >= FLUSH_BUFFER_BYTES) {
            this.flushNow();
            return;
        }
        if (!this.flushScheduled) {
            this.flushScheduled = true;
            setImmediate(() => this.flushNow());
        }
    }

    private flushNow(): void {
        this.flushScheduled = false;
        if (this.pendingChunks.length === 0) { return; }
        const text = this.pendingChunks.join('');
        this.pendingChunks = [];
        this.pendingBytes = 0;
        this.writeEmitter.fire(text);
    }

    open(): void {
        this.writeEmitter.fire(`\x1b[32m${this.banner}\x1b[0m\r\n`);
        this.lastByteWasCR = true;
    }

    close(): void {
        this.detach();
    }

    handleInput(data: string): void {
        if (this.debugIo) {
            getInputDebugChannel().appendLine(`IN  ${dbgEscape(data)}`);
        }
        if (!this.transport) {
            getInputDebugChannel().appendLine('  (drop) handleInput called but no transport attached');
            return;
        }
        if (!this.transport.isOpen) {
            getInputDebugChannel().appendLine('  (drop) handleInput called but transport not open');
            return;
        }
        // Don't await — fire-and-forget so the event loop stays responsive.
        this.transport.write(data).catch(err => {
            getInputDebugChannel().appendLine(`  write error: ${err?.message || err}`);
        });
    }

    /** Write data to the terminal display (from extension side). */
    write(data: string): void {
        this.enqueue(data);
    }

    terminate(): void {
        this.flushNow();
        this.closeEmitter.fire();
    }
}

export function createReplTerminal(
    transport: Transport,
    extensionUri?: vscode.Uri,
): { terminal: vscode.Terminal; pty: JumperlessREPL } {
    const pty = new JumperlessREPL();
    pty.attach(transport);
    const iconPath = extensionUri
        ? vscode.Uri.joinPath(extensionUri, 'icons', 'jumperless-device.svg')
        : new vscode.ThemeIcon('terminal');
    const terminal = vscode.window.createTerminal({
        name: 'Jumperless REPL',
        pty,
        iconPath,
        color: new vscode.ThemeColor('jumperless.pink'),
    });
    return { terminal, pty };
}
