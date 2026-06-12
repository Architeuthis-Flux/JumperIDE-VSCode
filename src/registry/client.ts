/**
 * REST client for the JumperNet script/image registry (Cloudflare worker).
 * Worker returns: GET /scripts -> {scripts: [...]}, GET /images -> {images: [...]}
 * Single items have fields: id, name, description, authorName, content, updatedAt
 */

import { getConfig } from '../utils';

function baseUrl(): string {
    return getConfig<string>('registry.baseUrl') || 'https://jumperscripts.kevinc-af9.workers.dev';
}

const STATIC_INDEX_URL = 'https://docs.jumperless.org/scripts/index.json';

export interface RegistryEntry {
    id: string;
    name: string;
    description?: string;
    authorName?: string;
    content?: string;
    width?: number;
    height?: number;
    updatedAt?: string;
    /** Which registry collection this came from — set by listScripts/listImages. */
    kind?: 'script' | 'image';
}

export type ScriptEntry = RegistryEntry;
export type ImageEntry = RegistryEntry;

async function fetchJson<T>(url: string): Promise<T> {
    const resp = await fetch(url);
    if (!resp.ok) { throw new Error(`HTTP ${resp.status}`); }
    return resp.json() as Promise<T>;
}

async function postJson<T>(url: string, body: object): Promise<T> {
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) { throw new Error(`HTTP ${resp.status}`); }
    return resp.json() as Promise<T>;
}

async function putJson<T>(url: string, body: object): Promise<T> {
    const resp = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) { throw new Error(`HTTP ${resp.status}`); }
    return resp.json() as Promise<T>;
}

/** Tolerant unwrap: accepts bare arrays or {scripts:[]}/{images:[]}/{items:[]} envelopes. */
function asArray<T>(data: any, key?: string): T[] {
    if (Array.isArray(data)) { return data; }
    if (data && typeof data === 'object') {
        if (key && Array.isArray(data[key])) { return data[key]; }
        for (const k of ['scripts', 'images', 'items', 'results', 'data']) {
            if (Array.isArray(data[k])) { return data[k]; }
        }
    }
    return [];
}

function tagged<T extends RegistryEntry>(entries: T[], kind: 'script' | 'image'): T[] {
    return entries.map(e => ({ ...e, kind }));
}

export async function listScripts(): Promise<ScriptEntry[]> {
    try {
        return tagged(asArray<ScriptEntry>(await fetchJson<any>(`${baseUrl()}/scripts`), 'scripts'), 'script');
    } catch {
        try {
            return tagged(asArray<ScriptEntry>(await fetchJson<any>(STATIC_INDEX_URL), 'scripts'), 'script');
        } catch {
            return [];
        }
    }
}

export async function getScript(id: string): Promise<ScriptEntry> {
    return fetchJson<ScriptEntry>(`${baseUrl()}/scripts/${id}`);
}

export async function createScript(script: Partial<ScriptEntry>): Promise<ScriptEntry> {
    return postJson<ScriptEntry>(`${baseUrl()}/scripts`, script);
}

export async function updateScript(id: string, script: Partial<ScriptEntry>): Promise<ScriptEntry> {
    return putJson<ScriptEntry>(`${baseUrl()}/scripts/${id}`, script);
}

export async function listImages(): Promise<ImageEntry[]> {
    try {
        return tagged(asArray<ImageEntry>(await fetchJson<any>(`${baseUrl()}/images`), 'images'), 'image');
    } catch {
        return [];
    }
}

export async function getImage(id: string): Promise<ImageEntry> {
    return fetchJson<ImageEntry>(`${baseUrl()}/images/${id}`);
}

export async function createImage(image: Partial<ImageEntry>): Promise<ImageEntry> {
    return postJson<ImageEntry>(`${baseUrl()}/images`, image);
}

export async function updateImage(id: string, image: Partial<ImageEntry>): Promise<ImageEntry> {
    return putJson<ImageEntry>(`${baseUrl()}/images/${id}`, image);
}
