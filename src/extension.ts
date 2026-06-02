/**
 * JumperIDE for VSCode — extension entry point.
 * Registers all providers, commands, and views.
 *
 * Activation philosophy: every registration is wrapped in `step()` so a single
 * failure cannot take down the rest of the extension. The Output channel logs
 * which step succeeded / failed, so "There is no data provider registered…"
 * errors point at exactly the offender.
 */

import * as vscode from 'vscode';
import { ConnectionManager } from './connection/connectionManager';
import { JumperlessFileSystemProvider } from './deviceFs/provider';
import { registerDeviceTree } from './deviceFs/tree';
import { createReplTerminal, JumperlessREPL } from './repl/terminal';
import { registerRunner } from './repl/runner';
import { loadApiData } from './language/apiData';
import { JumperlessHoverProvider } from './language/hover';
import { JumperlessCompletionProvider } from './language/completion';
import { registerRefresher } from './language/refresher';
import { registerInitProject, maybeOfferSetup, autoEnsureGlobalSetup } from './stubs/initProject';
import { registerScriptsView } from './registry/scriptsView';
import { registerImagesView } from './registry/imagesView';
import { registerApiRefWebview } from './webviews/apiRef';
import { registerImage2Oled } from './webviews/image2oled';
import { OledBinEditorProvider } from './webviews/oledBinEditor';
import { registerStatusBarCommands } from './statusBar';
import { ActionsViewProvider } from './actionsView';
import { getConfig } from './utils';

let currentPty: JumperlessREPL | null = null;
let replTerminal: vscode.Terminal | null = null;
let outputChannel: vscode.OutputChannel | null = null;
let actionsView: ActionsViewProvider | null = null;
let activeConnMgr: ConnectionManager | null = null;
let unhandledRejectionHandler: ((reason: any) => void) | null = null;
let uncaughtExceptionHandler: ((err: Error) => void) | null = null;

function step<T>(label: string, fn: () => T): T | undefined {
    try {
        const result = fn();
        outputChannel?.appendLine(`  [ok] ${label}`);
        return result;
    } catch (err: any) {
        outputChannel?.appendLine(`  [FAIL] ${label}: ${err?.stack || err?.message || err}`);
        return undefined;
    }
}

/**
 * Empty TreeDataProvider used as a synchronous fallback so every contributed
 * view ID has *something* registered the moment activate() starts running.
 * This prevents the "There is no data provider registered" error from showing
 * up while the rest of activation is still in flight, which can happen when
 * Cursor renders the sidebar before our extension finishes initializing.
 */
class EmptyTreeProvider implements vscode.TreeDataProvider<never> {
    getTreeItem(): vscode.TreeItem { return new vscode.TreeItem(''); }
    getChildren(): never[] { return []; }
}

/**
 * Same idea for the Actions webview — show a pink "loading…" placeholder
 * if anything goes wrong before the real ActionsViewProvider takes over.
 */
class LoadingWebviewProvider implements vscode.WebviewViewProvider {
    resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.html = `<!DOCTYPE html><html><body style="
            font-family: var(--vscode-font-family);
            color: #ff5cb0;
            padding: 20px;
            text-align: center;">
            JumperIDE loading…
        </body></html>`;
    }
}

/** Disposable for the loading-placeholder Actions webview. We must dispose
 *  this BEFORE the real ActionsViewProvider registers, because unlike
 *  registerTreeDataProvider, registerWebviewViewProvider throws if a provider
 *  for the same view ID is already registered. */
let actionsFallback: vscode.Disposable | null = null;

function registerFallbackProviders(context: vscode.ExtensionContext): void {
    const empty = new EmptyTreeProvider();
    const ids = ['jumperlessDevice', 'jumperlessScripts', 'jumperlessImages'];
    for (const id of ids) {
        try {
            context.subscriptions.push(vscode.window.registerTreeDataProvider(id, empty));
        } catch {
            // Intentionally swallow — better to skip than to break activation.
        }
    }
    try {
        actionsFallback = vscode.window.registerWebviewViewProvider(
            'jumperlessActions',
            new LoadingWebviewProvider(),
        );
        context.subscriptions.push(actionsFallback);
    } catch {
        // ignore
    }
}

/** Drop the placeholder Actions provider so the real one can register cleanly. */
function disposeActionsFallback(): void {
    if (actionsFallback) {
        try { actionsFallback.dispose(); } catch { /* ignore */ }
        actionsFallback = null;
    }
}

export function activate(context: vscode.ExtensionContext): void {
    // STEP -1: install process-level guards FIRST so a stray exception or
    // rejection from any of our async code can never crash the extension host.
    // (When the EH crashes, ALL extensions stop loading, which is what users
    // were experiencing intermittently.)
    installProcessGuards(context);

    // STEP 0: register stub providers immediately so views never lack a provider.
    // Real registrations later replace these — registerTreeDataProvider /
    // registerWebviewViewProvider both allow re-registration.
    try { registerFallbackProviders(context); } catch { /* defensive */ }

    try {
        outputChannel = vscode.window.createOutputChannel('JumperIDE');
        context.subscriptions.push(outputChannel);
        outputChannel.appendLine(`JumperIDE activating (vscode ${vscode.version}, extension ${context.extensionPath})`);
    } catch { /* shouldn't happen but don't let it crash the EH */ }

    try {
        context.subscriptions.push(
            vscode.commands.registerCommand('jumperless.showActivationLog', () => outputChannel?.show()),
        );
    } catch (err: any) {
        // Most likely: command already registered from a previous activation.
        outputChannel?.appendLine(`registerCommand(showActivationLog) failed: ${err?.message || err}`);
    }

    try {
        activateImpl(context);
        outputChannel?.appendLine('JumperIDE activation finished');
    } catch (err: any) {
        outputChannel?.appendLine(`FATAL activation error: ${err?.stack || err?.message || err}`);
        try {
            vscode.window.showErrorMessage(
                `JumperIDE activation failed: ${err?.message || err}. Open Output → JumperIDE for details.`,
            );
        } catch { /* ignore */ }
        // Do not rethrow — VSCode marks the extension as broken if we do, which
        // makes every contributed view show the no-data-provider error forever.
    }
}

/**
 * Catch-all process guards. Without these, ANY uncaught exception in our
 * native serialport callbacks (or rejected promise we forgot to await) takes
 * down the entire VSCode extension host process — which manifests as "all
 * extensions stopped working".
 *
 * We only log via the output channel; we never re-throw. Cursor / VSCode's
 * own listeners stay attached, so non-Jumperless errors continue to be
 * reported normally.
 */
function installProcessGuards(context: vscode.ExtensionContext): void {
    if (unhandledRejectionHandler || uncaughtExceptionHandler) {
        // Belt-and-suspenders: previous activation didn't clean up. Remove first.
        if (unhandledRejectionHandler) {
            try { process.removeListener('unhandledRejection', unhandledRejectionHandler); } catch {}
        }
        if (uncaughtExceptionHandler) {
            try { process.removeListener('uncaughtException', uncaughtExceptionHandler); } catch {}
        }
    }

    unhandledRejectionHandler = (reason: any) => {
        const stack = reason?.stack || reason?.message || String(reason);
        // Only log Jumperless-tagged errors loudly; everything else just gets a one-liner
        // (so we don't spam the user with other extensions' rejections).
        if (typeof stack === 'string' && /jumperless|jumperide/i.test(stack)) {
            outputChannel?.appendLine(`[unhandledRejection] ${stack}`);
        }
    };
    uncaughtExceptionHandler = (err: Error) => {
        const stack = err?.stack || err?.message || String(err);
        if (typeof stack === 'string' && /jumperless|jumperide/i.test(stack)) {
            outputChannel?.appendLine(`[uncaughtException] ${stack}`);
        }
    };

    try {
        process.on('unhandledRejection', unhandledRejectionHandler);
        process.on('uncaughtException', uncaughtExceptionHandler);
    } catch { /* ignore */ }

    // Tear them off on extension dispose so reloads stay clean.
    context.subscriptions.push({
        dispose: () => {
            if (unhandledRejectionHandler) {
                try { process.removeListener('unhandledRejection', unhandledRejectionHandler); } catch {}
                unhandledRejectionHandler = null;
            }
            if (uncaughtExceptionHandler) {
                try { process.removeListener('uncaughtException', uncaughtExceptionHandler); } catch {}
                uncaughtExceptionHandler = null;
            }
        },
    });
}

function activateImpl(context: vscode.ExtensionContext): void {
    step('loadApiData', () => loadApiData(context.extensionPath, context));

    const connMgr = step('new ConnectionManager', () => new ConnectionManager(context));
    if (!connMgr) {
        outputChannel?.appendLine('Aborting: ConnectionManager construction failed');
        return;
    }
    activeConnMgr = connMgr;
    // Make sure the serial port is closed on extension dispose / reload —
    // otherwise the OS keeps the file descriptor open until VSCode quits.
    context.subscriptions.push({
        dispose: () => {
            try { connMgr.disconnect(); } catch { /* ignore */ }
            if (activeConnMgr === connMgr) { activeConnMgr = null; }
        },
    });

    // Sidebar providers FIRST — never let anything else block these.
    step('registerDeviceTree (jumperlessDevice)', () => registerDeviceTree(context, connMgr));
    step('registerScriptsView (jumperlessScripts)', () => registerScriptsView(context));
    step('registerImagesView (jumperlessImages)', () => registerImagesView(context, connMgr));
    step('register ActionsViewProvider (jumperlessActions)', () => {
        // Must drop the loading placeholder first — registerWebviewViewProvider
        // refuses a second registration for the same view ID.
        disposeActionsFallback();
        actionsView = new ActionsViewProvider(context, connMgr);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(ActionsViewProvider.viewType, actionsView),
        );
    });

    step('registerFileSystemProvider (jumperless:/)', () => {
        const fsProvider = new JumperlessFileSystemProvider(connMgr);
        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider('jumperless', fsProvider, {
                isCaseSensitive: true,
            }),
        );
    });

    step('register connect/disconnect commands', () => {
        context.subscriptions.push(
            vscode.commands.registerCommand('jumperless.connect', () => connMgr.connect()),
            vscode.commands.registerCommand('jumperless.disconnect', () => connMgr.disconnect()),
        );
    });

    step('wire connection ↔ REPL terminal', () => {
        // Push event subscriptions to context.subscriptions so they're cleaned
        // up on extension dispose / reload — otherwise stale closures fire on
        // the next activation, referencing disposed terminals, and the resulting
        // throw can take down the extension host.
        context.subscriptions.push(
            connMgr.onDidConnect(() => {
                try {
                    if (!connMgr.transport) { return; }
                    if (replTerminal) {
                        try { currentPty?.detach(); } catch { /* ignore */ }
                        try { replTerminal.dispose(); } catch { /* ignore */ }
                    }
                    const { terminal, pty } = createReplTerminal(connMgr.transport, context.extensionUri);
                    currentPty = pty;
                    replTerminal = terminal;
                    // false = take focus, so keystrokes go to the REPL instead of the editor
                    terminal.show(false);
                    // The MicroPython startup banner is consumed by the raw-mode
                    // handshake during connect (before the terminal attaches).
                    // Now that the terminal is listening, ask the friendly REPL to
                    // reprint it with Ctrl-B (non-destructive — no soft reset).
                    const transport = connMgr.transport;
                    setTimeout(() => { void transport?.write('\x02'); }, 200);
                } catch (err: any) {
                    outputChannel?.appendLine(`onDidConnect handler error: ${err?.stack || err?.message || err}`);
                }
            }),
            connMgr.onDidDisconnect(() => {
                try {
                    currentPty?.detach();
                } catch (err: any) {
                    outputChannel?.appendLine(`onDidDisconnect handler error: ${err?.message || err}`);
                } finally {
                    currentPty = null;
                }
            }),
        );
    });

    step('registerRunner', () =>
        registerRunner(context, connMgr, () => currentPty, (running) => actionsView?.setRunning(running)),
    );

    step('register showTerminal command', () => {
        context.subscriptions.push(
            vscode.commands.registerCommand('jumperless.showTerminal', () => {
                replTerminal?.show(false);
            }),
        );
    });

    step('register language providers', () => {
        const pythonSelector: vscode.DocumentSelector = [
            { language: 'python' },
            { language: 'jython' },
        ];
        context.subscriptions.push(
            vscode.languages.registerHoverProvider(pythonSelector, new JumperlessHoverProvider()),
            vscode.languages.registerCompletionItemProvider(
                pythonSelector,
                new JumperlessCompletionProvider(),
                '.', '_',
            ),
        );
    });

    step('registerRefresher', () => registerRefresher(context));
    step('registerInitProject', () => registerInitProject(context));
    step('autoEnsureGlobalSetup', () => { void autoEnsureGlobalSetup(context); });
    step('maybeOfferSetup', () => { void maybeOfferSetup(context); });
    step('registerApiRefWebview', () => registerApiRefWebview(context));
    step('registerImage2Oled', () => registerImage2Oled(context));
    step('register OledBinEditor', () =>
        context.subscriptions.push(OledBinEditorProvider.register(context, connMgr)),
    );
    step('registerStatusBarCommands', () => registerStatusBarCommands(context, connMgr));

    step('setContext defaults', () => {
        vscode.commands.executeCommand('setContext', 'jumperless.connected', false);
        vscode.commands.executeCommand('setContext', 'jumperless.running', false);
        vscode.commands.executeCommand('setContext', 'jumperless.runnableLanguages', ['python', 'jython']);
    });

    if (getConfig<boolean>('connectOnStartup')) {
        step('connectOnStartup', () => connMgr.connect());
    }
}

export function deactivate(): void {
    try { currentPty?.detach(); } catch { /* ignore */ }
    currentPty = null;
    replTerminal = null;
    actionsView = null;
    if (activeConnMgr) {
        try { activeConnMgr.disconnect(); } catch { /* ignore */ }
        activeConnMgr = null;
    }
    if (unhandledRejectionHandler) {
        try { process.removeListener('unhandledRejection', unhandledRejectionHandler); } catch {}
        unhandledRejectionHandler = null;
    }
    if (uncaughtExceptionHandler) {
        try { process.removeListener('uncaughtException', uncaughtExceptionHandler); } catch {}
        uncaughtExceptionHandler = null;
    }
}
