/**
 * Loads and exposes the Jumperless API reference data for hover/completion.
 * Bundled from data/api-ref.json, with optional refresh from globalState.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ApiRefData {
    headings: string[];
    descriptions: Record<string, string>;
    argHelp: Record<string, Record<string, string>>;
    hiddenSymbols: string[];
    symbols: string[];
}

export interface SymbolInfo {
    name: string;
    signature: string | null;
    description: string | null;
    argHelp: Record<string, string> | null;
}

let apiData: ApiRefData | null = null;

const JUMPERLESS_CONSTANTS = [
    "TOP_RAIL", "T_RAIL", "BOTTOM_RAIL", "BOT_RAIL", "B_RAIL", "GND",
    "DAC0", "DAC_0", "DAC1", "DAC_1",
    "ADC0", "ADC1", "ADC2", "ADC3", "ADC4", "ADC7",
    "PROBE", "UART_TX", "TX", "UART_RX", "RX",
    "ISENSE_PLUS", "ISENSE_P", "I_P", "CURRENT_SENSE_PLUS", "CURRENT_SENSE_P",
    "ISENSE_MINUS", "ISENSE_N", "I_N", "CURRENT_SENSE_MINUS", "CURRENT_SENSE_N",
    "BUFFER_IN", "BUF_IN", "BUFFER_OUT", "BUF_OUT",
    "GPIO_1", "GPIO_2", "GPIO_3", "GPIO_4", "GPIO_5", "GPIO_6", "GPIO_7", "GPIO_8",
    "GP1", "GP2", "GP3", "GP4", "GP5", "GP6", "GP7", "GP8",
    "GPIO_20", "GPIO_21", "GPIO_22", "GPIO_23", "GPIO_24", "GPIO_25", "GPIO_26", "GPIO_27",
    "HIGH", "LOW", "FLOATING", "INPUT", "OUTPUT",
    "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13",
    "NANO_D0", "NANO_D1", "NANO_D2", "NANO_D3", "NANO_D4", "NANO_D5", "NANO_D6", "NANO_D7",
    "NANO_D8", "NANO_D9", "NANO_D10", "NANO_D11", "NANO_D12", "NANO_D13",
    "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7",
    "NANO_A0", "NANO_A1", "NANO_A2", "NANO_A3", "NANO_A4", "NANO_A5", "NANO_A6", "NANO_A7",
    "NO_PAD", "LOGO_PAD_TOP", "LOGO_PAD_BOTTOM", "GPIO_PAD", "DAC_PAD", "ADC_PAD",
    "BUILDING_PAD_TOP", "BUILDING_PAD_BOTTOM",
    "D0_PAD", "D1_PAD", "D2_PAD", "D3_PAD", "D4_PAD", "D5_PAD", "D6_PAD", "D7_PAD",
    "D8_PAD", "D9_PAD", "D10_PAD", "D11_PAD", "D12_PAD", "D13_PAD", "RESET_PAD", "AREF_PAD",
    "A0_PAD", "A1_PAD", "A2_PAD", "A3_PAD", "A4_PAD", "A5_PAD", "A6_PAD", "A7_PAD",
    "TOP_RAIL_PAD", "BOTTOM_RAIL_PAD", "BOT_RAIL_PAD",
    "TOP_RAIL_GND", "TOP_GND_PAD", "BOTTOM_RAIL_GND", "BOT_RAIL_GND", "BOTTOM_GND_PAD", "BOT_GND_PAD",
    "NANO_VIN", "VIN_PAD", "NANO_RESET_0", "RESET_0_PAD", "NANO_RESET_1", "RESET_1_PAD",
    "NANO_GND_0", "GND_0_PAD", "NANO_GND_1", "GND_1_PAD", "NANO_3V3", "3V3_PAD", "NANO_5V", "5V_PAD",
    "BUTTON_NONE", "BUTTON_CONNECT", "BUTTON_REMOVE", "CONNECT_BUTTON", "REMOVE_BUTTON",
    "SWITCH_MEASURE", "SWITCH_SELECT", "SWITCH_UNKNOWN",
    "CLICKWHEEL_NONE", "CLICKWHEEL_UP", "CLICKWHEEL_DOWN", "CLICKWHEEL_IDLE", "CLICKWHEEL_PRESSED", "CLICKWHEEL_HELD",
    "CLICKWHEEL_RELEASED", "CLICKWHEEL_DOUBLECLICKED",
    "SINE", "TRIANGLE", "SAWTOOTH", "SQUARE", "RAMP", "ARBITRARY",
    "FAKE_GPIO_INPUT", "FAKE_GPIO_OUTPUT", "CURRENT_SLOT",
    "SEEK_SET", "SEEK_CUR", "SEEK_END",
    "jfs", "FatFS", "vfs", "LittleFS", "SDFS",
];

export function getConstants(): string[] {
    return JUMPERLESS_CONSTANTS;
}

export function getApiData(): ApiRefData | null {
    return apiData;
}

export function loadApiData(extensionPath: string, context?: vscode.ExtensionContext): ApiRefData {
    if (apiData) { return apiData; }

    if (context) {
        const cached = context.globalState.get<ApiRefData>('jumperless.apiRef');
        if (cached && cached.symbols?.length > 100) {
            apiData = cached;
            return apiData;
        }
    }

    const jsonPath = path.join(extensionPath, 'data', 'api-ref.json');
    try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        apiData = JSON.parse(raw) as ApiRefData;
    } catch {
        apiData = { headings: [], descriptions: {}, argHelp: {}, hiddenSymbols: [], symbols: [] };
    }
    return apiData;
}

export function updateApiData(data: ApiRefData, context: vscode.ExtensionContext): void {
    apiData = data;
    context.globalState.update('jumperless.apiRef', data);
    context.globalState.update('jumperless.apiRef.fetchedAt', Date.now());
}

function normalize(name: string): string {
    return name.toLowerCase().replace(/-/g, '_');
}

export function getSymbolInfo(name: string): SymbolInfo | null {
    if (!apiData) { return null; }
    const key = normalize(name);

    let signature: string | null = null;
    for (const h of apiData.headings) {
        const hName = h.split('(')[0].trim();
        if (normalize(hName) === key) {
            signature = h;
            break;
        }
    }

    const description = apiData.descriptions[key] ?? null;
    const argHelp = apiData.argHelp[key] ?? null;

    if (!signature && !description && !apiData.symbols.includes(name)) {
        if (!JUMPERLESS_CONSTANTS.includes(name)) { return null; }
        return { name, signature: null, description: 'Jumperless constant', argHelp: null };
    }

    return { name, signature, description, argHelp };
}

export function isJumperlessSymbol(name: string): boolean {
    if (!apiData) { return false; }
    return apiData.symbols.includes(name) || JUMPERLESS_CONSTANTS.includes(name);
}
