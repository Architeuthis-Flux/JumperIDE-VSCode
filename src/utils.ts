import * as vscode from 'vscode';

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export class Mutex {
    private _queue: Array<() => void> = [];
    private _locked = false;

    async acquire(): Promise<() => void> {
        return new Promise(resolve => {
            const tryAcquire = () => {
                if (!this._locked) {
                    this._locked = true;
                    resolve(() => {
                        this._locked = false;
                        const next = this._queue.shift();
                        if (next) { next(); }
                    });
                } else {
                    this._queue.push(tryAcquire);
                }
            };
            tryAcquire();
        });
    }

    /** Non-blocking acquire: returns a release fn or null if locked. */
    tryAcquire(): (() => void) | null {
        if (this._locked) { return null; }
        this._locked = true;
        return () => {
            this._locked = false;
            const next = this._queue.shift();
            if (next) { next(); }
        };
    }

    get locked(): boolean { return this._locked; }
}

export function report(label: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[JumperIDE] ${label}: ${msg}`);
}

export function getConfig<T>(key: string): T | undefined {
    return vscode.workspace.getConfiguration('jumperless').get<T>(key);
}
