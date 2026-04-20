/**
 * FileSystemProvider for the jumperless:/ scheme.
 * readFile fetches from the device on first access; writeFile pushes back.
 * The directory structure comes from walkFs() cached in ConnectionManager.
 */

import * as vscode from 'vscode';
import { ConnectionManager } from '../connection/connectionManager';
import { FsEntry } from '../connection/rawmode';

export class JumperlessFileSystemProvider implements vscode.FileSystemProvider {
    private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._onDidChangeFile.event;

    constructor(private connMgr: ConnectionManager) {}

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => {});
    }

    stat(uri: vscode.Uri): vscode.FileStat {
        const path = uri.path;
        const entry = this.findEntry(path);
        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const isDir = !!entry.content;
        return {
            type: isDir ? vscode.FileType.Directory : vscode.FileType.File,
            ctime: 0,
            mtime: Date.now(),
            size: entry.size ?? 0,
        };
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
        const path = uri.path === '/' ? '' : uri.path;
        const entries = path === '' ? this.connMgr.fsTree : this.findEntry(path)?.content;
        if (!entries) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return entries.map(e => [
            e.name,
            e.content ? vscode.FileType.Directory : vscode.FileType.File,
        ]);
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (!this.connMgr.connected) {
            throw vscode.FileSystemError.Unavailable('Not connected');
        }
        return this.connMgr.withRawMode(raw => raw.readFile(uri.path));
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array,
        options: { create: boolean; overwrite: boolean }): Promise<void> {
        if (!this.connMgr.connected) {
            throw vscode.FileSystemError.Unavailable('Not connected');
        }
        await this.connMgr.withRawMode(async raw => {
            if (options.create) {
                const dir = uri.path.substring(0, uri.path.lastIndexOf('/'));
                if (dir) { await raw.makePath(dir); }
            }
            await raw.writeFile(uri.path, content);
        });
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    async createDirectory(uri: vscode.Uri): Promise<void> {
        if (!this.connMgr.connected) {
            throw vscode.FileSystemError.Unavailable('Not connected');
        }
        await this.connMgr.withRawMode(raw => raw.makePath(uri.path));
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Created, uri }]);
    }

    async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
        if (!this.connMgr.connected) {
            throw vscode.FileSystemError.Unavailable('Not connected');
        }
        const entry = this.findEntry(uri.path);
        await this.connMgr.withRawMode(async raw => {
            if (entry?.content) {
                await raw.removeDir(uri.path);
            } else {
                await raw.removeFile(uri.path);
            }
        });
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
        throw vscode.FileSystemError.NoPermissions('Rename not yet supported');
    }

    private findEntry(path: string): FsEntry | undefined {
        const parts = path.split('/').filter(Boolean);
        let entries = this.connMgr.fsTree;
        for (let i = 0; i < parts.length; i++) {
            const e = entries.find(x => x.name === parts[i]);
            if (!e) { return undefined; }
            if (i === parts.length - 1) { return e; }
            if (!e.content) { return undefined; }
            entries = e.content;
        }
        if (parts.length === 0) {
            return { name: '', path: '/', content: entries };
        }
        return undefined;
    }
}
