/**
 * Manages the single shared serial connection to a Jumperless device.
 * Exposes connect/disconnect, raw-mode access, and state change events.
 */

import * as vscode from 'vscode';
import { Transport } from './transport';
import { MpRawMode, DeviceInfo, FsEntry } from './rawmode';
import { pickPort } from './portPicker';
import { getConfig } from '../utils';

export class ConnectionManager {
    private _transport: Transport | null = null;
    private _deviceInfo: DeviceInfo | null = null;
    private _fsTree: FsEntry[] = [];
    private _portPath: string | null = null;
    private _connecting = false;
    private _statusBar: vscode.StatusBarItem;
    private _onDidConnect = new vscode.EventEmitter<void>();
    private _onDidDisconnect = new vscode.EventEmitter<void>();
    private _onTreeUpdate = new vscode.EventEmitter<FsEntry[]>();

    readonly onDidConnect = this._onDidConnect.event;
    readonly onDidDisconnect = this._onDidDisconnect.event;
    readonly onTreeUpdate = this._onTreeUpdate.event;

    constructor(private context: vscode.ExtensionContext) {
        this._statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this._statusBar.command = 'jumperless.connect';
        this._statusBar.text = '$(plug) Jumperless';
        this._statusBar.tooltip = 'Click to connect';
        this._statusBar.show();
        context.subscriptions.push(this._statusBar);
    }

    private setStatusBarConnected(label: string, portPath: string): void {
        this._statusBar.text = `$(circuit-board) ${label}`;
        this._statusBar.tooltip = `Connected: ${portPath}\nClick to disconnect`;
        this._statusBar.command = 'jumperless.disconnect';
        this._statusBar.color = new vscode.ThemeColor('jumperless.pink');
    }

    private setStatusBarDisconnected(): void {
        this._statusBar.text = '$(plug) Jumperless';
        this._statusBar.tooltip = 'Click to connect';
        this._statusBar.command = 'jumperless.connect';
        this._statusBar.color = undefined;
    }

    private setStatusBarBusy(label: string): void {
        this._statusBar.text = `$(loading~spin) ${label}`;
        this._statusBar.color = new vscode.ThemeColor('jumperless.pinkBright');
    }

    get transport(): Transport | null { return this._transport; }
    get deviceInfo(): DeviceInfo | null { return this._deviceInfo; }
    get fsTree(): FsEntry[] { return this._fsTree; }
    get connected(): boolean { return !!this._transport && this._transport.isOpen; }

    async connect(): Promise<void> {
        if (this._connecting) { return; }
        this._connecting = true;
        try {
            await this.doConnect();
        } finally {
            this._connecting = false;
        }
    }

    private async doConnect(): Promise<void> {
        if (this.connected) {
            const choice = await vscode.window.showWarningMessage(
                'Already connected. Disconnect first?', 'Disconnect', 'Cancel');
            if (choice !== 'Disconnect') { return; }
            await this.disconnect();
        }

        const portPath = await pickPort();
        if (!portPath) { return; }

        const baud = getConfig<number>('serial.baud') ?? 115200;
        const transport = new Transport();

        try {
            await transport.open(portPath, baud);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open ${portPath}: ${err.message}`);
            return;
        }

        this._transport = transport;
        this._portPath = portPath;

        transport.onDisconnect(() => {
            // Stale event: this transport was already replaced, or torn down
            // by disconnect() (which fires onDidDisconnect itself). Without
            // this guard a manual disconnect would emit the event twice.
            if (this._transport !== transport) { return; }
            this._transport = null;
            this._deviceInfo = null;
            this._fsTree = [];
            vscode.commands.executeCommand('setContext', 'jumperless.connected', false);
            this.setStatusBarDisconnected();
            this._onDidDisconnect.fire();
        });

        this.setStatusBarBusy('Initializing...');

        try {
            const raw = await MpRawMode.begin(transport);
            try {
                try {
                    this._deviceInfo = await raw.getDeviceInfo();
                } catch (err: any) {
                    // Non-fatal: keep going so file tree still loads
                    this._deviceInfo = null;
                }
                try {
                    this._fsTree = await raw.walkFs();
                } catch (err: any) {
                    this._fsTree = [];
                }
            } finally {
                await raw.end();
            }
            await transport.write('\x02');
        } catch (err: any) {
            if (this._transport === transport && transport.isOpen) {
                vscode.window.showWarningMessage(`Device init: ${err.message}. Connected in terminal-only mode.`);
            }
        }

        // The port may have dropped (or been disconnected by the user) while
        // init was in flight — the disconnect handler already cleaned up, so
        // don't report a connection that no longer exists.
        if (this._transport !== transport || !transport.isOpen) { return; }

        vscode.commands.executeCommand('setContext', 'jumperless.connected', true);
        const label = this._deviceInfo?.machine || portPath;
        this.setStatusBarConnected(label, portPath);

        this._onDidConnect.fire();
        this._onTreeUpdate.fire(this._fsTree);
    }

    async disconnect(): Promise<void> {
        const transport = this._transport;
        // Clear state before closing so the transport's close-event handler
        // sees a stale transport and skips — onDidDisconnect fires once, here.
        this._transport = null;
        this._deviceInfo = null;
        this._fsTree = [];
        if (transport) {
            await transport.close();
        }
        vscode.commands.executeCommand('setContext', 'jumperless.connected', false);
        this.setStatusBarDisconnected();
        this._onDidDisconnect.fire();
    }

    async refreshTree(): Promise<void> {
        if (!this.connected) { return; }
        const raw = await MpRawMode.begin(this._transport!);
        try {
            this._fsTree = await raw.walkFs();
        } finally {
            await raw.end();
        }
        this._onTreeUpdate.fire(this._fsTree);
    }

    async withRawMode<T>(fn: (raw: MpRawMode) => Promise<T>): Promise<T> {
        if (!this.connected) { throw new Error('Not connected'); }
        const raw = await MpRawMode.begin(this._transport!);
        try {
            return await fn(raw);
        } finally {
            await raw.end();
        }
    }
}
