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
import { log } from "./logging.ts";
import {
    basename,
    DiagnosticCollection,
    joinPath,
    relativePath,
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

function braceExpand(segment: string): string[] {
    const m = segment.match(/^\{([^}]+)\}$/);
    if (!m) {
        return [segment];
    }
    return m[1]!.split(",");
}

function globToRegExp(glob: string): RegExp {
    const parts: string[] = [];
    let i = 0;
    while (i < glob.length) {
        if (glob.startsWith("**/", i)) {
            parts.push("(?:.*/)?");
            i += 3;
            continue;
        }
        if (glob.startsWith("**", i)) {
            parts.push(".*");
            i += 2;
            continue;
        }
        if (glob[i] === "*" && glob[i + 1] !== "*") {
            parts.push("[^/]*");
            i++;
            continue;
        }
        if (glob[i] === "?") {
            parts.push("[^/]");
            i++;
            continue;
        }
        if (glob[i] === "{") {
            const end = glob.indexOf("}", i);
            if (end !== -1) {
                const alts = glob.slice(i + 1, end).split(",").map((a) =>
                    a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                );
                parts.push(`(?:${alts.join("|")})`);
                i = end + 1;
                continue;
            }
        }
        const ch = glob[i]!;
        if ("\\^$+?.()|[]".includes(ch)) {
            parts.push("\\" + ch);
        } else {
            parts.push(ch);
        }
        i++;
    }
    return new RegExp(`^${parts.join("")}$`);
}

function matchesGlob(relPath: string, glob: string): boolean {
    const normalized = relPath.replaceAll("\\", "/");
    if (glob.includes("{")) {
        const start = glob.indexOf("{");
        const end = glob.indexOf("}", start);
        if (start !== -1 && end !== -1) {
            for (const alt of braceExpand(glob.slice(start, end + 1))) {
                const expanded = glob.slice(0, start) + alt + glob.slice(end + 1);
                if (globToRegExp(expanded).test(normalized)) {
                    return true;
                }
            }
            return false;
        }
    }
    return globToRegExp(glob).test(normalized);
}

function pathSegmentsExcluded(rel: string, excludeGlob: string): boolean {
    const inner = excludeGlob.match(/\{([^}]+)\}/)?.[1];
    if (inner) {
        const names = new Set(inner.split(","));
        return rel.split("/").some((seg) => names.has(seg));
    }
    return false;
}

async function* walkFiles(root: string): AsyncGenerator<{ path: string; name: string }> {
    try {
        for await (const entry of Deno.readDir(root)) {
            const full = joinPath(root, entry.name);
            if (entry.isDirectory) {
                yield* walkFiles(full);
            } else if (entry.isFile) {
                yield { path: full, name: entry.name };
            }
        }
    } catch {
        // Unreadable directory.
    }
}

async function findFiles(include: string, exclude?: string): Promise<Uri[]> {
    const results: Uri[] = [];
    for (const folder of workspaceFolders) {
        const root = folder.fsPath;
        try {
            const st = await Deno.stat(root);
            if (!st.isDirectory) {
                continue;
            }
        } catch {
            continue;
        }
        try {
            for await (const entry of walkFiles(root)) {
                const rel = relativePath(root, entry.path).replaceAll("\\", "/");
                const includeHit = matchesGlob(rel, include) ||
                    matchesGlob(entry.name, include) ||
                    matchesGlob(
                        rel,
                        include.startsWith("**/") ? include : `**/${include}`,
                    );
                if (!includeHit) {
                    continue;
                }
                if (
                    exclude &&
                    (matchesGlob(rel, exclude) ||
                        pathSegmentsExcluded(rel, exclude))
                ) {
                    continue;
                }
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

export const workspace = {
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
                return relativePath(root, fsPath);
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

export const languages = {
    createDiagnosticCollection(name: string): DiagnosticCollection {
        return new DiagnosticCollection(name);
    },
};

export { joinPath };
