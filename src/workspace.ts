/**
 * Workspace document store, configuration, and file discovery.
 *
 * @module
 */
import {
    type Asn1Config,
    defaultAsn1Config,
    mergeAsn1Config,
} from "./config.ts";
import { expandGlob } from "@std/fs/expand-glob";
import { basename, relative } from "@std/path";
import { log } from "./logging.ts";
import {
    DiagnosticCollection,
    TextDocument,
    Uri,
} from "./types_vscode.ts";

interface ConfigurationAccessor {
    get<T>(section: string, defaultValue?: T): T;
    update(section: string, value: unknown): Promise<void>;
}

const openDocuments = new Map<string, TextDocument>();
let workspaceFolders: Uri[] = [];
let asn1Config: Asn1Config = { ...defaultAsn1Config, alwaysDefined: [] };
let configChangeListener: ((config: Asn1Config) => void) | undefined;

/**
 * Register an in-memory document (LSP didOpen / tests).
 */
export function setTextDocument(document: TextDocument): void {
    openDocuments.set(document.uri.toString(), document);
}

/**
 * Remove a document from the in-memory store.
 */
export function deleteTextDocument(uri: Uri): void {
    openDocuments.delete(uri.toString());
}

/**
 * Get an already-open document, if any.
 */
export function getOpenTextDocument(uri: Uri): TextDocument | undefined {
    return openDocuments.get(uri.toString());
}

/**
 * All currently open documents.
 */
export function getOpenTextDocuments(): TextDocument[] {
    return [...openDocuments.values()];
}

/**
 * Set workspace folders used for file discovery.
 */
export function setWorkspaceFolders(folders: Uri[]): void {
    workspaceFolders = folders;
}

/**
 * Get workspace folders.
 */
export function getWorkspaceFolders(): Uri[] {
    return workspaceFolders;
}

/**
 * Replace ASN.1 configuration (merged with current values).
 */
export function setAsn1Config(
    config: Partial<Asn1Config> | Record<string, unknown>,
): void {
    asn1Config = mergeAsn1Config({ ...asn1Config, ...config });
    configChangeListener?.(asn1Config);
}

/**
 * Current ASN.1 configuration.
 */
export function getAsn1Config(): Asn1Config {
    return asn1Config;
}

/**
 * Subscribe to configuration changes.
 */
export function onAsn1ConfigChange(
    listener: (config: Asn1Config) => void,
): void {
    configChangeListener = listener;
}

/**
 * Reset workspace state (tests).
 */
export function resetWorkspaceState(): void {
    openDocuments.clear();
    workspaceFolders = [];
    asn1Config = mergeAsn1Config({ alwaysDefined: [] });
}

async function findFiles(include: string, exclude?: string): Promise<Uri[]> {
    const results: Uri[] = [];
    const seen = new Set<string>();
    for (const folder of workspaceFolders) {
        const root = folder.fsPath;
        try {
            for await (
                const entry of expandGlob(include, {
                    root,
                    exclude: exclude ? [exclude] : [],
                    includeDirs: false,
                    globstar: true,
                    extended: true,
                })
            ) {
                if (!entry.isFile || seen.has(entry.path)) {
                    continue;
                }
                seen.add(entry.path);
                results.push(Uri.file(entry.path));
            }
        } catch (e) {
            log.appendLine(`failed to walk workspace folder ${root}: ${e}`);
        }
    }
    return results;
}

async function openTextDocumentFromUri(uri: Uri): Promise<TextDocument> {
    const existing = openDocuments.get(uri.toString());
    if (existing) {
        return existing;
    }
    const text = await Deno.readTextFile(uri.fsPath);
    let version = 1;
    try {
        const st = await Deno.stat(uri.fsPath);
        version = Number(st.mtime?.getTime() ?? Date.now());
    } catch {
        version = Date.now();
    }
    const languageId = /\.asn1?$/i.test(uri.fsPath) ? "asn1" : "plaintext";
    return TextDocument.create(uri, text, version, languageId);
}

const configurationAccessor: ConfigurationAccessor = {
    get<T>(section: string, defaultValue?: T): T {
        const value = (asn1Config as unknown as Record<string, unknown>)[section];
        if (value === undefined) {
            return defaultValue as T;
        }
        return value as T;
    },
    async update(section: string, value: unknown): Promise<void> {
        setAsn1Config({ [section]: value });
    },
};

export type Workspace = {
    readonly textDocuments: TextDocument[];
    readonly workspaceFolders: { uri: Uri; name: string }[] | undefined;
    getConfiguration(
        section?: string,
        resource?: unknown
    ): ConfigurationAccessor;
    openTextDocument(uri: Uri): Promise<TextDocument>;
    findFiles(include: string, exclude?: string): Promise<Uri[]>;
    asRelativePath(uriOrPath: Uri | string): string;
};

export const workspace: Workspace = {
    get textDocuments(): TextDocument[] {
        return getOpenTextDocuments();
    },
    get workspaceFolders(): { uri: Uri; name: string }[] | undefined {
        if (!workspaceFolders.length) {
            return undefined;
        }
        return workspaceFolders.map((uri) => ({
            uri,
            name: basename(uri.fsPath),
        }));
    },
    getConfiguration(_section?: string, _resource?: unknown): ConfigurationAccessor {
        if (_section && _section !== "asn1") {
            return {
                get<T>(_key: string, defaultValue?: T): T {
                    return defaultValue as T;
                },
                async update(): Promise<void> {},
            };
        }
        return configurationAccessor;
    },
    openTextDocument(uri: Uri): Promise<TextDocument> {
        return openTextDocumentFromUri(uri);
    },
    findFiles(include: string, exclude?: string): Promise<Uri[]> {
        return findFiles(include, exclude);
    },
    asRelativePath(uriOrPath: Uri | string): string {
        const fsPath = typeof uriOrPath === "string"
            ? uriOrPath
            : uriOrPath.fsPath;
        for (const folder of workspaceFolders) {
            const root = folder.fsPath;
            if (fsPath.startsWith(root)) {
                return relative(root, fsPath);
            }
        }
        return basename(fsPath);
    },
};

export const window = {
    showErrorMessage(message: string): void {
        log.appendLine(message);
    },
    showInformationMessage(message: string): void {
        log.appendLine(message);
    },
    showWarningMessage(message: string): void {
        log.appendLine(message);
    },
};

export const languages: Languages = {
    createDiagnosticCollection(name: string): DiagnosticCollection {
        return new DiagnosticCollection(name);
    }
};

export type Languages = {
    createDiagnosticCollection(name: string): DiagnosticCollection;
};
