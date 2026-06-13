/**
 * Serial transport layer — wraps the `serialport` npm package with the
 * same transaction / readUntil / readExactly / write API that JumperIDE
 * uses in its browser-side Transport class.
 */

import type { SerialPort as SerialPortType } from 'serialport';
import { StringDecoder } from 'node:string_decoder';
import { Mutex, sleep, report } from '../utils';

export class Transport {
    private port: SerialPortType | null = null;
    private mutex = new Mutex();
    inTransaction = false;
    private _disconnected = false;
    receivedData = '';
    private activityCb: () => void = () => {};
    receiveCallback: (data: string) => void = () => {};
    prevRecvCbk: ((data: string) => void) | null = null;
    private disconnectCb: () => void = () => {};
    emit = false;
    // Larger write chunk = fewer round-trips for big files (kept compatible)
    private writeChunk = 256;
    // Buffers partial UTF-8 byte sequences across `data` events so multi-byte
    // glyphs (box drawing, emoji, etc.) never get rendered as � replacement chars.
    private decoder = new StringDecoder('utf8');

    async open(path: string, baudRate: number): Promise<void> {
        // macOS exposes each port as /dev/tty.* (callin: blocks on carrier
        // detect, EBUSY whenever the cu.* twin is open) and /dev/cu.* (callout:
        // the right node for us). serialport's list() only reports tty.*, so
        // rewrite to cu.* here.
        if (process.platform === 'darwin' && path.startsWith('/dev/tty.')) {
            path = '/dev/cu.' + path.slice('/dev/tty.'.length);
        }
        const { SerialPort } = await import('serialport');
        return new Promise((resolve, reject) => {
            const port = new SerialPort({ path, baudRate, autoOpen: false });
            this.port = port;
            port.open(err => {
                if (err) { return reject(err); }
                this._disconnected = false;
                this.decoder = new StringDecoder('utf8');
                // CRITICAL: every handler is wrapped in try/catch.
                // Node's EventEmitter does NOT catch synchronous throws inside
                // listeners — they propagate as `uncaughtException` and crash
                // the entire VSCode extension host process. Anything that can
                // call into our user-supplied callbacks must be defensive.
                port.on('data', (buf: Buffer) => {
                    try {
                        // StringDecoder.write() holds onto the trailing bytes of a
                        // partial UTF-8 sequence and prepends them to the next chunk,
                        // so we never emit replacement chars mid-glyph.
                        const text = this.decoder.write(buf);
                        if (text.length === 0) { return; }
                        this.receiveCallback(text);
                        this.activityCb();
                    } catch (handlerErr) {
                        report('serial data handler', handlerErr);
                    }
                });
                port.on('close', () => {
                    try {
                        const trailing = this.decoder.end();
                        if (trailing.length) { this.receiveCallback(trailing); }
                        this._disconnected = true;
                        this.disconnectCb();
                    } catch (handlerErr) {
                        report('serial close handler', handlerErr);
                    }
                });
                port.on('error', e => {
                    try { report('Serial error', e); } catch { /* ignore */ }
                });
                resolve();
            });
        });
    }

    get isOpen(): boolean {
        return !!this.port && this.port.isOpen;
    }

    async close(): Promise<void> {
        const port = this.port;
        if (!port) { return; }
        return new Promise(resolve => {
            port.close(() => {
                this.port = null;
                resolve();
            });
        });
    }

    onActivity(cb: () => void): void { this.activityCb = cb; }
    onReceive(cb: (data: string) => void): void { this.receiveCallback = cb; }
    onDisconnect(cb: () => void): void {
        this.disconnectCb = () => { this._disconnected = true; cb(); };
    }

    async write(data: string): Promise<void> {
        if (!this.port || !this.port.isOpen) { return; }
        const buf = Buffer.from(data, 'utf-8');
        let offset = 0;
        while (offset < buf.length) {
            const chunk = buf.subarray(offset, offset + this.writeChunk);
            await this.writeBytes(chunk);
            this.activityCb();
            offset += this.writeChunk;
        }
    }

    async writeBytes(data: Buffer | Uint8Array): Promise<void> {
        const port = this.port;
        if (!port || !port.isOpen) { return; }
        return new Promise((resolve, reject) => {
            port.write(data, err => {
                if (err) { return reject(err); }
                port.drain(err2 => {
                    if (err2) { return reject(err2); }
                    resolve();
                });
            });
        });
    }

    /**
     * Fire-and-forget OLED framebuffer push, equivalent to JumperIDE's
     * execReplNoFollow: writes Ctrl-C Ctrl-C + a one-line `oled_set_framebuffer`
     * call directly to the normal REPL prompt. No raw mode, no read-back.
     *
     * Skipped if the transport is mid-transaction (e.g. file save in progress)
     * so we never corrupt a raw-REPL session. The next debounce cycle will
     * catch up once the transaction releases.
     */
    async sendOledFramebufferLive(b64: string): Promise<boolean> {
        if (!this.port || !this.port.isOpen) { return false; }
        if (this.inTransaction) { return false; }
        const release = this.mutex.tryAcquire();
        if (!release) { return false; }
        try {
            const cmd = `\r\x03\x03import binascii;oled_set_framebuffer(binascii.a2b_base64('${b64}'));oled_show()\r\n`;
            await this.writeBytes(Buffer.from(cmd, 'utf-8'));
            this.activityCb();
            return true;
        } catch (err) {
            report('OLED live push', err);
            return false;
        } finally {
            release();
        }
    }

    async startTransaction(): Promise<() => void> {
        const release = await this.mutex.acquire();
        this.prevRecvCbk = this.receiveCallback;
        this.inTransaction = true;
        this.receivedData = '';
        this.receiveCallback = (data: string) => {
            this.receivedData += data;
            if (this.emit && this.prevRecvCbk) { this.prevRecvCbk(data); }
        };

        return () => {
            if (this.prevRecvCbk) {
                this.receiveCallback = this.prevRecvCbk;
                this.receiveCallback(this.receivedData);
            }
            this.receivedData = '';
            this.inTransaction = false;
            release();
        };
    }

    async flushInput(): Promise<void> {
        if (!this.inTransaction) { throw new Error('Not in transaction'); }
        this.receivedData = '';
    }

    async readExactly(n: number, timeout = 5000): Promise<string> {
        if (!this.inTransaction) { throw new Error('Not in transaction'); }
        let endTime = Date.now() + timeout;
        while (timeout <= 0 || Date.now() < endTime) {
            if (this._disconnected) { throw new Error('Disconnected'); }
            if (this.receivedData.length >= n) {
                const res = this.receivedData.substring(0, n);
                this.receivedData = this.receivedData.substring(n);
                return res;
            }
            const prev = this.receivedData.length;
            await sleep(10);
            if (this.receivedData.length > prev) {
                endTime = Date.now() + timeout;
            }
        }
        throw new Error('Timeout');
    }

    async readUntil(endings: string | string[], timeout = 5000): Promise<string> {
        if (!Array.isArray(endings)) { endings = [endings]; }
        if (!this.inTransaction) { throw new Error('Not in transaction'); }
        let endTime = Date.now() + timeout;
        while (timeout <= 0 || Date.now() < endTime) {
            if (this._disconnected) { throw new Error('Disconnected'); }
            for (const ending of endings) {
                const idx = this.receivedData.indexOf(ending);
                if (idx >= 0) {
                    const end = idx + ending.length;
                    const res = this.receivedData.substring(0, end);
                    this.receivedData = this.receivedData.substring(end);
                    return res;
                }
            }
            const prev = this.receivedData.length;
            await sleep(10);
            if (this.receivedData.length > prev) {
                endTime = Date.now() + timeout;
            }
        }
        throw new Error('Timeout reached before finding ending sequence');
    }
}
