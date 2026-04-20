/**
 * Enumerate serial ports, identify Jumperless V5 by VID:PID,
 * group the 4-port set, and present a QuickPick defaulting to the 3rd port.
 */

import * as vscode from 'vscode';
import { getConfig } from '../utils';

async function listSerialPorts(): Promise<PortInfo[]> {
    const { SerialPort } = await import('serialport');
    return SerialPort.list();
}

const JUMPERLESS_VID = '1D50';
const JUMPERLESS_PID = 'ACAB';
const JLV5_SERIAL_PREFIX = 'JLV5port';

interface PortInfo {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    vendorId?: string;
    productId?: string;
}

function isJumperlessPort(p: PortInfo): boolean {
    const vid = (p.vendorId || '').toUpperCase();
    const pid = (p.productId || '').toUpperCase();
    if (vid === JUMPERLESS_VID && pid === JUMPERLESS_PID) { return true; }
    if (p.serialNumber?.startsWith(JLV5_SERIAL_PREFIX)) { return true; }
    return false;
}

function portSuffix(p: PortInfo): number {
    const m = p.path.match(/port(\d+)/i) || p.serialNumber?.match(/port(\d+)/i);
    return m ? parseInt(m[1], 10) : 999;
}

export async function pickPort(): Promise<string | undefined> {
    const allPorts = await listSerialPorts();
    const jlPorts = allPorts.filter(isJumperlessPort).sort((a, b) => portSuffix(a) - portSuffix(b));
    const otherPorts = allPorts.filter(p => !isJumperlessPort(p));

    const preferredIdx = getConfig<number>('serial.preferredPortIndex') ?? 2;

    const items: vscode.QuickPickItem[] = [];

    if (jlPorts.length > 0) {
        items.push({ label: 'Jumperless V5', kind: vscode.QuickPickItemKind.Separator });
        for (let i = 0; i < jlPorts.length; i++) {
            const p = jlPorts[i];
            const suffix = portSuffix(p);
            const label = `${p.path}`;
            const desc = suffix !== 999 ? `port${suffix}` : (p.serialNumber || '');
            const picked = i === preferredIdx;
            items.push({
                label: picked ? `$(star) ${label}` : label,
                description: desc + (picked ? ' (MicroPython REPL — recommended)' : ''),
                detail: `VID:PID ${p.vendorId}:${p.productId}`,
            });
        }
    }

    if (otherPorts.length > 0) {
        items.push({ label: 'Other Ports', kind: vscode.QuickPickItemKind.Separator });
        for (const p of otherPorts) {
            items.push({
                label: p.path,
                description: p.manufacturer || p.serialNumber || '',
                detail: p.vendorId ? `VID:PID ${p.vendorId}:${p.productId}` : undefined,
            });
        }
    }

    if (items.length === 0) {
        vscode.window.showWarningMessage('No serial ports found. Is your Jumperless connected?');
        return undefined;
    }

    const preselect = jlPorts.length > preferredIdx ? preferredIdx : 0;
    const separatorCount = items.filter(i => i.kind === vscode.QuickPickItemKind.Separator).length;
    const activeIndex = preselect + (jlPorts.length > 0 ? 1 : 0);

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select serial port (Jumperless uses the 3rd port for MicroPython REPL)',
        title: 'Jumperless: Connect',
    });

    if (!selected) { return undefined; }
    return selected.label.replace(/^\$\(star\)\s*/, '');
}
