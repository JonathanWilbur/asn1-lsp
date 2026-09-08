/**
 * ASN.1 language server: initialize, document sync, and feature dispatch.
 *
 * @module
 */
import { ASN1HoverProvider } from "../hover.ts";
import { Asn1DefinitionProvider } from "../gotodef.ts";
import { Asn1TypeDefinitionProvider } from "../typedef.ts";
import { Asn1ReferenceProvider } from "../findallref.ts";
import { Asn1RenameProvider } from "../rename.ts";
import { Asn1SymbolProvider } from "../symbols.ts";
import { Asn1WorkspaceSymbolProvider } from "../wssymbols.ts";
import { Asn1HighlightProvider } from "../highlight.ts";
import { Asn1FoldingRangeProvider } from "../folding.ts";
import { Asn1CompletionItemProvider } from "../completion.ts";
import { Asn1DocumentFormattingEditProvider } from "../format.ts";
import { Asn1SelectionRangeProvider } from "../selectrange.ts";
import { Asn1SignatureHelpProvider } from "../sighelp.ts";
import { Asn1CodeActionProvider } from "../codeact.ts";
import {
    updateDiagnostics,
    diagnosticCollection,
} from "../diagnostics.ts";
import {
    indexAsn1Files,
    indexAsn1File,
    reindexAsn1File,
    deindexAsn1File,
    clearAsn1ModuleIndexes,
    clearNamedBitAndIntegerIndexes,
} from "../indexing.ts";
import { clearParserOutputCaches } from "../parsing.ts";
import { log, setLogListener } from "../logging.ts";
import {
    CancellationTokenNone,
    CodeAction,
    CompletionItem,
    CompletionList,
    Diagnostic,
    DocumentHighlight,
    DocumentSymbol,
    FoldingRange,
    Hover,
    Location,
    MarkdownString,
    Position,
    Range,
    SelectionRange,
    SignatureHelp,
    SnippetString,
    SymbolInformation,
    TextDocument,
    TextEdit,
    Uri,
    WorkspaceEdit,
} from "../vscode.ts";
import {
    deleteTextDocument,
    getOpenTextDocument,
    setAsn1Config,
    setTextDocument,
    setWorkspaceFolders,
} from "../workspace.ts";
import { mergeAsn1Config, type Asn1Config } from "../config.ts";
import {
    ErrorCodes,
    type JsonRpcMessage,
    type JsonRpcRequest,
    readMessages,
    writeMessage,
} from "./jsonrpc.ts";

const LANGUAGE_ID = "asn1";

const COMMAND_DIAGNOSE = "asn1.diagnose";
const COMMAND_REINDEX = "asn1.reindex-implicit-symbols";
const COMMAND_TREAT_AS_DEFINED = "asn1.treatAsDefined";

interface InitializeParams {
    processId?: number | null;
    rootUri?: string | null;
    rootPath?: string | null;
    capabilities?: unknown;
    initializationOptions?: Partial<Asn1Config> | Record<string, unknown>;
    workspaceFolders?: { uri: string; name: string }[] | null;
}

interface TextDocumentItem {
    uri: string;
    languageId: string;
    version: number;
    text: string;
}

interface VersionedTextDocumentIdentifier {
    uri: string;
    version: number;
}

interface TextDocumentIdentifier {
    uri: string;
}

interface TextDocumentContentChangeEvent {
    range?: { start: { line: number; character: number }; end: { line: number; character: number } };
    text: string;
}

interface DidChangeTextDocumentParams {
    textDocument: VersionedTextDocumentIdentifier;
    contentChanges: TextDocumentContentChangeEvent[];
}

/**
 * Run the ASN.1 language server over stdio.
 */
export async function runStdioServer(): Promise<void> {
    const stdin = Deno.stdin.readable;
    const stdout = Deno.stdout.writable.getWriter();
    const server = new Asn1LanguageServer(async (msg) => {
        await writeMessage(stdout, msg);
    });
    try {
        for await (const message of readMessages(stdin)) {
            await server.handle(message);
            if (server.exitRequested) {
                break;
            }
        }
    } finally {
        stdout.releaseLock();
    }
}

/**
 * ASN.1 LSP server instance.
 */
export class Asn1LanguageServer {
    initialized = false;
    shutdownRequested = false;
    exitRequested = false;
    #send: (msg: unknown) => Promise<void>;
    #hover = new ASN1HoverProvider();
    #definition = new Asn1DefinitionProvider();
    #typeDefinition = new Asn1TypeDefinitionProvider();
    #references = new Asn1ReferenceProvider();
    #rename = new Asn1RenameProvider();
    #symbols = new Asn1SymbolProvider();
    #workspaceSymbols = new Asn1WorkspaceSymbolProvider();
    #highlights = new Asn1HighlightProvider();
    #folding = new Asn1FoldingRangeProvider();
    #completion = new Asn1CompletionItemProvider();
    #formatting = new Asn1DocumentFormattingEditProvider();
    #selection = new Asn1SelectionRangeProvider();
    #signature = new Asn1SignatureHelpProvider();
    #codeAction = new Asn1CodeActionProvider();

    constructor(send: (msg: unknown) => Promise<void>) {
        this.#send = send;
        setLogListener((message) => {
            this.#notify("window/logMessage", { type: 3, message });
        });
        diagnosticCollection.onDidChangeDiagnostics((uri, diagnostics) => {
            this.#notify("textDocument/publishDiagnostics", {
                uri: uri.toString(),
                diagnostics: diagnostics.map(toLspDiagnostic),
            });
        });
    }

    /**
     * Handle one JSON-RPC message.
     */
    async handle(message: JsonRpcMessage): Promise<void> {
        if (!("method" in message)) {
            return;
        }
        const req = message as JsonRpcRequest;
        const id = req.id;
        const isRequest = id !== undefined && id !== null;
        try {
            const result = await this.#dispatch(req.method, req.params);
            if (isRequest) {
                await this.#send({ jsonrpc: "2.0", id, result: result ?? null });
            }
        } catch (e) {
            if (!isRequest) {
                log.appendLine(`notification ${req.method} failed: ${e}`);
                return;
            }
            const err = e instanceof Error ? e : new Error(String(e));
            await this.#send({
                jsonrpc: "2.0",
                id,
                error: {
                    code: ErrorCodes.InternalError,
                    message: err.message,
                },
            });
        }
    }

    async #notify(method: string, params: unknown): Promise<void> {
        await this.#send({ jsonrpc: "2.0", method, params });
    }

    async #dispatch(method: string, params: unknown): Promise<unknown> {
        switch (method) {
            case "initialize":
                return this.#initialize(params as InitializeParams);
            case "initialized":
                this.initialized = true;
                await indexAsn1Files();
                return;
            case "shutdown":
                this.shutdownRequested = true;
                clearParserOutputCaches();
                clearAsn1ModuleIndexes();
                clearNamedBitAndIntegerIndexes();
                return null;
            case "exit":
                this.exitRequested = true;
                return;
            case "textDocument/didOpen":
                return this.#didOpen(params as { textDocument: TextDocumentItem });
            case "textDocument/didChange":
                return this.#didChange(params as DidChangeTextDocumentParams);
            case "textDocument/didSave":
                return this.#didSave(params as { textDocument: TextDocumentIdentifier });
            case "textDocument/didClose":
                return this.#didClose(params as { textDocument: TextDocumentIdentifier });
            case "workspace/didChangeWatchedFiles":
                return this.#didChangeWatchedFiles(
                    params as { changes: { uri: string; type: number }[] },
                );
            case "workspace/didChangeConfiguration":
                return this.#didChangeConfiguration(
                    params as { settings?: { asn1?: Partial<Asn1Config> } },
                );
            case "textDocument/hover":
                return this.#withDocPos(params, (doc, pos, token) =>
                    this.#hover.provideHover(doc, pos, token)
                ).then(toLspHover);
            case "textDocument/definition":
                return this.#withDocPos(params, (doc, pos, token) =>
                    this.#definition.provideDefinition(doc, pos, token)
                ).then(toLspLocation);
            case "textDocument/typeDefinition":
                return this.#withDocPos(params, (doc, pos, token) =>
                    this.#typeDefinition.provideTypeDefinition(doc, pos, token)
                ).then(toLspLocation);
            case "textDocument/references":
                return this.#withDocPos(params, (doc, pos, token) =>
                    this.#references.provideReferences(
                        doc,
                        pos,
                        { includeDeclaration: true },
                        token,
                    )
                ).then((locs) => Array.isArray(locs) ? locs.map(toLspLocationPlain) : locs);
            case "textDocument/rename":
                return this.#renameAt(params);
            case "textDocument/documentSymbol":
                return this.#withDoc(params, (doc, token) =>
                    this.#symbols.provideDocumentSymbols(doc, token)
                ).then((syms) =>
                    Array.isArray(syms) ? syms.map(toLspDocumentSymbol) : syms
                );
            case "workspace/symbol": {
                const query = (params as { query: string }).query ?? "";
                const syms = await this.#workspaceSymbols.provideWorkspaceSymbols(
                    query,
                    CancellationTokenNone,
                );
                return Array.isArray(syms) ? syms.map(toLspWorkspaceSymbol) : null;
            }
            case "textDocument/documentHighlight":
                return this.#withDocPos(params, (doc, pos, token) =>
                    this.#highlights.provideDocumentHighlights(doc, pos, token)
                ).then((hs) =>
                    Array.isArray(hs) ? hs.map(toLspHighlight) : hs
                );
            case "textDocument/foldingRange":
                return this.#withDoc(params, (doc, token) =>
                    this.#folding.provideFoldingRanges(doc, {}, token)
                ).then((ranges) =>
                    Array.isArray(ranges) ? ranges.map(toLspFoldingRange) : ranges
                );
            case "textDocument/completion":
                return this.#withDocPos(params, (doc, pos, token) =>
                    this.#completion.provideCompletionItems(doc, pos, token, {
                        triggerKind: 1,
                        triggerCharacter: (params as { context?: { triggerCharacter?: string } })
                            .context?.triggerCharacter,
                    })
                ).then(toLspCompletion);
            case "textDocument/formatting":
                return this.#format(params);
            case "textDocument/selectionRange":
                return this.#selectionRange(params);
            case "textDocument/signatureHelp":
                return this.#withDocPos(params, (doc, pos, token) =>
                    this.#signature.provideSignatureHelp(doc, pos, token)
                ).then(toLspSignatureHelp);
            case "textDocument/codeAction":
                return this.#codeActions(params);
            case "workspace/executeCommand":
                return this.#executeCommand(
                    params as { command: string; arguments?: unknown[] },
                );
            default:
                if (method.startsWith("$/") || method.startsWith("telemetry/")) {
                    return;
                }
                throw Object.assign(new Error(`Method not found: ${method}`), {
                    code: ErrorCodes.MethodNotFound,
                });
        }
    }

    #initialize(params: InitializeParams) {
        const folders = params.workspaceFolders?.map((f) => Uri.parse(f.uri))
            ?? (params.rootUri
                ? [Uri.parse(params.rootUri)]
                : (params.rootPath ? [Uri.file(params.rootPath)] : []));
        setWorkspaceFolders(folders);
        if (params.initializationOptions) {
            setAsn1Config(mergeAsn1Config(params.initializationOptions));
        }
        return {
            capabilities: {
                textDocumentSync: 2,
                hoverProvider: true,
                definitionProvider: true,
                typeDefinitionProvider: true,
                referencesProvider: true,
                renameProvider: true,
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                documentHighlightProvider: true,
                foldingRangeProvider: true,
                completionProvider: {
                    triggerCharacters: [".", "&", "{", " ", "\t", "|", ",", "["],
                    resolveProvider: false,
                },
                signatureHelpProvider: {
                    triggerCharacters: ["{", ","],
                },
                documentFormattingProvider: true,
                selectionRangeProvider: true,
                codeActionProvider: {
                    codeActionKinds: ["quickfix"],
                },
                executeCommandProvider: {
                    commands: [
                        COMMAND_DIAGNOSE,
                        COMMAND_REINDEX,
                        COMMAND_TREAT_AS_DEFINED,
                    ],
                },
                workspace: {
                    workspaceFolders: { supported: true },
                },
            },
            serverInfo: {
                name: "@wildboar/asn1-lsp",
                version: "1.0.0",
            },
        };
    }

    async #didOpen(params: { textDocument: TextDocumentItem }): Promise<void> {
        const item = params.textDocument;
        const doc = TextDocument.create(
            Uri.parse(item.uri),
            item.text,
            item.version,
            item.languageId || LANGUAGE_ID,
        );
        setTextDocument(doc);
        if (isAsn1(doc)) {
            await reindexAsn1File(doc.uri);
            await updateDiagnostics(doc, diagnosticCollection);
        }
    }

    async #didChange(params: DidChangeTextDocumentParams): Promise<void> {
        const uri = Uri.parse(params.textDocument.uri);
        const doc = getOpenTextDocument(uri);
        if (!doc) {
            return;
        }
        let text = doc.getText();
        for (const change of params.contentChanges) {
            if (!change.range) {
                text = change.text;
                continue;
            }
            const start = doc.offsetAt(pos(change.range.start));
            const end = doc.offsetAt(pos(change.range.end));
            text = text.slice(0, start) + change.text + text.slice(end);
        }
        doc.update(text, params.textDocument.version);
        if (isAsn1(doc)) {
            await reindexAsn1File(doc.uri);
            await updateDiagnostics(doc, diagnosticCollection);
        }
    }

    async #didSave(params: { textDocument: TextDocumentIdentifier }): Promise<void> {
        const uri = Uri.parse(params.textDocument.uri);
        const doc = getOpenTextDocument(uri);
        if (!doc || !isAsn1(doc)) {
            return;
        }
        await reindexAsn1File(doc.uri);
        await updateDiagnostics(doc, diagnosticCollection);
    }

    async #didClose(params: { textDocument: TextDocumentIdentifier }): Promise<void> {
        const uri = Uri.parse(params.textDocument.uri);
        const doc = getOpenTextDocument(uri);
        if (doc?.uri.scheme === "untitled") {
            deindexAsn1File(uri);
        }
        deleteTextDocument(uri);
        diagnosticCollection.delete(uri);
    }

    async #didChangeWatchedFiles(
        params: { changes: { uri: string; type: number }[] },
    ): Promise<void> {
        for (const change of params.changes) {
            const uri = Uri.parse(change.uri);
            if (change.type === 3) {
                deindexAsn1File(uri);
                continue;
            }
            try {
                await reindexAsn1File(uri);
            } catch (e) {
                log.appendLine(`failed to reindex ${change.uri}: ${e}`);
            }
        }
    }

    #didChangeConfiguration(
        params: { settings?: { asn1?: Partial<Asn1Config> } },
    ): void {
        if (params.settings?.asn1) {
            setAsn1Config(params.settings.asn1);
        }
    }

    async #renameAt(params: unknown): Promise<unknown> {
        const p = params as {
            textDocument: TextDocumentIdentifier;
            position: { line: number; character: number };
            newName: string;
        };
        const doc = requireDoc(p.textDocument.uri);
        const edit = await this.#rename.provideRenameEdits(
            doc,
            pos(p.position),
            p.newName,
            CancellationTokenNone,
        );
        if (!edit) {
            return null;
        }
        return toLspWorkspaceEdit(edit as WorkspaceEdit);
    }

    async #format(params: unknown): Promise<unknown> {
        const p = params as {
            textDocument: TextDocumentIdentifier;
            options: { tabSize: number; insertSpaces: boolean };
        };
        const doc = requireDoc(p.textDocument.uri);
        const edits = await this.#formatting.provideDocumentFormattingEdits(
            doc,
            {
                tabSize: p.options?.tabSize ?? 4,
                insertSpaces: p.options?.insertSpaces ?? true,
            },
            CancellationTokenNone,
        );
        if (!edits) {
            return null;
        }
        return (edits as TextEdit[]).map(toLspTextEdit);
    }

    async #selectionRange(params: unknown): Promise<unknown> {
        const p = params as {
            textDocument: TextDocumentIdentifier;
            positions: { line: number; character: number }[];
        };
        const doc = requireDoc(p.textDocument.uri);
        const ranges = await this.#selection.provideSelectionRanges(
            doc,
            p.positions.map(pos),
            CancellationTokenNone,
        );
        if (!ranges) {
            return null;
        }
        return (ranges as SelectionRange[]).map(toLspSelectionRange);
    }

    async #codeActions(params: unknown): Promise<unknown> {
        const p = params as {
            textDocument: TextDocumentIdentifier;
            range: { start: { line: number; character: number }; end: { line: number; character: number } };
            context: { diagnostics: Record<string, unknown>[] };
        };
        const doc = requireDoc(p.textDocument.uri);
        const diagnostics = diagnosticCollection.get(doc.uri).filter((d) =>
            rangeFromLsp(p.range).contains(d.range)
        );
        const actions = await this.#codeAction.provideCodeActions(
            doc,
            rangeFromLsp(p.range),
            { diagnostics },
            CancellationTokenNone,
        );
        if (!actions) {
            return null;
        }
        return (actions as (CodeAction)[]).map(toLspCodeAction);
    }

    async #executeCommand(
        params: { command: string; arguments?: unknown[] },
    ): Promise<unknown> {
        const args = params.arguments ?? [];
        if (params.command === COMMAND_DIAGNOSE) {
            const uriStr = typeof args[0] === "string"
                ? args[0]
                : (args[0] as { uri?: string } | undefined)?.uri
                    ?? (args[0] as Uri | undefined)?.toString();
            if (!uriStr) {
                return null;
            }
            const uri = typeof uriStr === "string" ? Uri.parse(uriStr) : uriStr as Uri;
            const doc = getOpenTextDocument(uri);
            if (doc) {
                await updateDiagnostics(doc, diagnosticCollection);
            }
            return null;
        }
        if (params.command === COMMAND_REINDEX) {
            clearNamedBitAndIntegerIndexes();
            await indexAsn1Files();
            const { getOpenTextDocuments } = await import("../workspace.ts");
            for (const document of getOpenTextDocuments()) {
                if (isAsn1(document)) {
                    await updateDiagnostics(document, diagnosticCollection);
                }
            }
            log.appendLine(`${new Date()}: named bits, integers, and enumerated variants reindexed`);
            return null;
        }
        if (params.command === COMMAND_TREAT_AS_DEFINED) {
            const identifier = args[0] as string | undefined;
            const uriArg = args[1];
            if (!identifier) {
                return null;
            }
            const { getAsn1Config } = await import("../workspace.ts");
            const current = getAsn1Config().alwaysDefined;
            if (!current.includes(identifier)) {
                setAsn1Config({ alwaysDefined: [...current, identifier] });
            }
            const uri = uriArg instanceof Uri
                ? uriArg
                : typeof uriArg === "string"
                ? Uri.parse(uriArg)
                : undefined;
            if (uri) {
                const doc = getOpenTextDocument(uri);
                if (doc) {
                    await updateDiagnostics(doc, diagnosticCollection);
                }
            }
            return null;
        }
        throw new Error(`Unknown command ${params.command}`);
    }

    async #withDocPos<T>(
        params: unknown,
        fn: (
            doc: TextDocument,
            pos: Position,
            token: typeof CancellationTokenNone,
        ) => T | Promise<T | null | undefined> | null | undefined,
    ): Promise<T | null> {
        const p = params as {
            textDocument: TextDocumentIdentifier;
            position: { line: number; character: number };
        };
        const doc = requireDoc(p.textDocument.uri);
        try {
            const result = await fn(doc, pos(p.position), CancellationTokenNone);
            return (result ?? null) as T | null;
        } catch {
            return null;
        }
    }

    async #withDoc<T>(
        params: unknown,
        fn: (
            doc: TextDocument,
            token: typeof CancellationTokenNone,
        ) => T | Promise<T | null | undefined> | null | undefined,
    ): Promise<T | null> {
        const p = params as { textDocument: TextDocumentIdentifier };
        const doc = requireDoc(p.textDocument.uri);
        try {
            const result = await fn(doc, CancellationTokenNone);
            return (result ?? null) as T | null;
        } catch {
            return null;
        }
    }
}

function isAsn1(doc: TextDocument): boolean {
    return doc.languageId === LANGUAGE_ID
        || /\.asn1?$/i.test(doc.uri.fsPath);
}

function requireDoc(uri: string): TextDocument {
    const doc = getOpenTextDocument(Uri.parse(uri));
    if (!doc) {
        throw new Error(`Document not open: ${uri}`);
    }
    return doc;
}

function pos(p: { line: number; character: number }): Position {
    return new Position(p.line, p.character);
}

function rangeFromLsp(r: {
    start: { line: number; character: number };
    end: { line: number; character: number };
}): Range {
    return new Range(pos(r.start), pos(r.end));
}

function toLspRange(range: Range): object {
    return {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
    };
}

function toLspLocationPlain(loc: Location): object {
    return {
        uri: loc.uri.toString(),
        range: toLspRange(loc.range),
    };
}

function toLspLocation(loc: Location | Location[] | null | undefined): unknown {
    if (!loc) return null;
    if (Array.isArray(loc)) {
        return loc.map(toLspLocationPlain);
    }
    return toLspLocationPlain(loc);
}

function markup(md: MarkdownString | string): object {
    if (typeof md === "string") {
        return { kind: "markdown", value: md };
    }
    return { kind: "markdown", value: md.value };
}

function toLspHover(hover: Hover | null | undefined): unknown {
    if (!hover) return null;
    return {
        contents: hover.contents.map(markup),
        range: hover.range ? toLspRange(hover.range) : undefined,
    };
}

function toLspDiagnostic(d: Diagnostic): object {
    return {
        range: toLspRange(d.range),
        message: d.message,
        severity: (d.severity ?? 0) + 1, // vscode 0=Error, LSP 1=Error
        code: d.code,
        source: d.source ?? "asn1",
        tags: d.tags,
        relatedInformation: d.relatedInformation?.map((ri) => ({
            location: toLspLocationPlain(ri.location),
            message: ri.message,
        })),
    };
}

function toLspDocumentSymbol(sym: DocumentSymbol): object {
    return {
        name: sym.name,
        detail: sym.detail,
        kind: sym.kind,
        range: toLspRange(sym.range),
        selectionRange: toLspRange(sym.selectionRange),
        children: sym.children.map(toLspDocumentSymbol),
    };
}

function toLspWorkspaceSymbol(sym: SymbolInformation): object {
    return {
        name: sym.name,
        kind: sym.kind,
        containerName: sym.containerName,
        location: toLspLocationPlain(sym.location),
    };
}

function toLspHighlight(h: DocumentHighlight): object {
    return { range: toLspRange(h.range), kind: h.kind };
}

function toLspFoldingRange(r: FoldingRange): object {
    return {
        startLine: r.start,
        endLine: r.end,
        kind: r.kind,
    };
}

function toLspTextEdit(e: TextEdit): object {
    return { range: toLspRange(e.range), newText: e.newText };
}

function toLspWorkspaceEdit(edit: WorkspaceEdit): object {
    return { changes: edit.toLspChanges() };
}

function toLspCompletion(
    result:
        | CompletionItem[]
        | CompletionList<CompletionItem>
        | null
        | undefined,
): unknown {
    if (!result) return null;
    const items = Array.isArray(result) ? result : result.items;
    return {
        isIncomplete: Array.isArray(result) ? false : !!result.isIncomplete,
        items: items.map((item) => ({
            label: item.label,
            kind: item.kind,
            detail: item.detail,
            documentation: item.documentation
                ? markup(item.documentation)
                : undefined,
            insertText: typeof item.insertText === "string"
                ? item.insertText
                : item.insertText instanceof SnippetString
                ? item.insertText.value
                : undefined,
            insertTextFormat: item.insertText instanceof SnippetString ? 2 : 1,
            filterText: item.filterText,
            sortText: item.sortText,
            commitCharacters: item.commitCharacters,
            preselect: item.preselect,
        })),
    };
}

function toLspSignatureHelp(help: SignatureHelp | null | undefined): unknown {
    if (!help) return null;
    return {
        signatures: help.signatures.map((s) => ({
            label: s.label,
            documentation: s.documentation ? markup(s.documentation) : undefined,
            parameters: s.parameters.map((p) => ({
                label: p.label,
                documentation: p.documentation ? markup(p.documentation) : undefined,
            })),
            activeParameter: s.activeParameter,
        })),
        activeSignature: help.activeSignature,
        activeParameter: help.activeParameter,
    };
}

function toLspSelectionRange(sr: SelectionRange): object {
    return {
        range: toLspRange(sr.range),
        parent: sr.parent ? toLspSelectionRange(sr.parent) : undefined,
    };
}

function toLspCodeAction(action: CodeAction): object {
    return {
        title: action.title,
        kind: action.kind,
        isPreferred: action.isPreferred,
        diagnostics: action.diagnostics?.map(toLspDiagnostic),
        edit: action.edit ? toLspWorkspaceEdit(action.edit) : undefined,
        command: action.command,
    };
}
