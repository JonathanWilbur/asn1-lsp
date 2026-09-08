/**
 * A small VS Code API subset used by the ASN.1 language features.
 *
 * Types and method names match the VS Code extension API so feature modules
 * can be ported with only import-path changes. Values serialize as LSP JSON.
 *
 * @module
 */

export type Thenable<T> = Promise<T>;

export type ProviderResult<T> =
    | T
    | undefined
    | null
    | Thenable<T | undefined | null>;

const ASN1_WORD_PATTERN = /\b[A-Za-z][A-Za-z0-9\-]*[A-Za-z0-9]\b/g;
const FALLBACK_WORD_PATTERN = /[A-Za-z0-9_\-]+/g;

/**
 * A zero-based line/character position in a text document.
 */
export class Position {
    constructor(
        public readonly line: number,
        public readonly character: number,
    ) {}

    isBeforeOrEqual(other: Position): boolean {
        return this.line < other.line
            || (this.line === other.line && this.character <= other.character);
    }

    isAfterOrEqual(other: Position): boolean {
        return this.line > other.line
            || (this.line === other.line && this.character >= other.character);
    }

    isEqual(other: Position): boolean {
        return this.line === other.line && this.character === other.character;
    }
}

/**
 * A half-open range in a text document.
 */
export class Range {
    public readonly start: Position;
    public readonly end: Position;

    constructor(start: Position, end: Position);
    constructor(
        startLine: number,
        startCharacter: number,
        endLine: number,
        endCharacter: number,
    );
    constructor(
        startOrLine: Position | number,
        endOrChar: Position | number,
        endLine?: number,
        endCharacter?: number,
    ) {
        if (typeof startOrLine === "number") {
            this.start = new Position(startOrLine, endOrChar as number);
            this.end = new Position(endLine!, endCharacter!);
        } else {
            this.start = startOrLine;
            this.end = endOrChar as Position;
        }
    }

    get isSingleLine(): boolean {
        return this.start.line === this.end.line;
    }

    contains(positionOrRange: Position | Range): boolean {
        if (positionOrRange instanceof Range) {
            return this.contains(positionOrRange.start) &&
                this.contains(positionOrRange.end);
        }
        return positionOrRange.isAfterOrEqual(this.start) &&
            positionOrRange.isBeforeOrEqual(this.end);
    }

    isEqual(other: Range): boolean {
        return this.start.isEqual(other.start) && this.end.isEqual(other.end);
    }
}

/** VS Code `Selection` is a `Range`; the extension only uses range methods. */
export type Selection = Range;

/**
 * A file or untitled document URI.
 */
export class Uri {
    readonly href: string;

    private constructor(href: string) {
        this.href = href;
    }

    toString(_skipEncoding?: boolean): string {
        return this.href;
    }

    get scheme(): string {
        const idx = this.href.indexOf(":");
        return idx === -1 ? "file" : this.href.slice(0, idx);
    }

    get fsPath(): string {
        try {
            return fromFileUrl(this.href);
        } catch {
            if (this.href.startsWith("file://")) {
                return decodeURIComponent(this.href.slice("file://".length));
            }
            return this.href;
        }
    }

    static parse(value: string, _strict?: boolean): Uri {
        return new Uri(value);
    }

    static file(fsPath: string): Uri {
        return new Uri(pathToFileUrl(fsPath));
    }

    static joinPath(base: Uri, ...pathSegments: string[]): Uri {
        return Uri.file(joinPath(base.fsPath, ...pathSegments));
    }
}

function fromFileUrl(href: string): string {
    const url = new URL(href);
    if (url.protocol !== "file:") {
        throw new TypeError(`Not a file URL: ${href}`);
    }
    let p = decodeURIComponent(url.pathname);
    if (Deno.build.os === "windows") {
        if (p.startsWith("/")) {
            p = p.slice(1);
        }
        return p.replaceAll("/", "\\");
    }
    return p;
}

function pathToFileUrl(fsPath: string): string {
    let abs = fsPath;
    if (!isAbsolute(abs)) {
        abs = joinPath(Deno.cwd(), abs);
    }
    if (Deno.build.os === "windows") {
        const normalized = abs.replaceAll("\\", "/");
        return encodeURI(`file:///${normalized.replace(/^\/+/, "")}`);
    }
    return encodeURI(`file://${abs}`);
}

function isAbsolute(p: string): boolean {
    return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

function joinPath(...parts: string[]): string {
    const sep = Deno.build.os === "windows" ? "\\" : "/";
    const out: string[] = [];
    for (const part of parts) {
        for (const seg of part.replaceAll("\\", "/").split("/")) {
            if (!seg || seg === ".") continue;
            if (seg === "..") {
                out.pop();
            } else {
                out.push(seg);
            }
        }
    }
    if (Deno.build.os === "windows") {
        return out.join(sep);
    }
    return "/" + out.join("/");
}

function basename(p: string): string {
    const norm = p.replaceAll("\\", "/");
    const i = norm.lastIndexOf("/");
    return i === -1 ? p : norm.slice(i + 1);
}

function relativePath(from: string, to: string): string {
    const a = from.replaceAll("\\", "/").split("/").filter(Boolean);
    const b = to.replaceAll("\\", "/").split("/").filter(Boolean);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const up = a.slice(i).map(() => "..");
    return [...up, ...b.slice(i)].join("/") || ".";
}

export { basename, joinPath, relativePath };

/**
 * A location in a document.
 */
export class Location {
    constructor(
        public readonly uri: Uri,
        public readonly range: Range,
    ) {}
}

export type DefinitionLink = Location;

export type Definition = Location | Location[];

/**
 * Markdown content for hovers, completions, and signature help.
 */
export class MarkdownString {
    public value: string;

    constructor(value: string = "") {
        this.value = value;
    }

    appendMarkdown(value: string): MarkdownString {
        this.value += value;
        return this;
    }

    appendCodeblock(code: string, language?: string): MarkdownString {
        const lang = language ?? "";
        this.value += `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
        return this;
    }
}

/**
 * A hover tooltip.
 */
export class Hover {
    public contents: MarkdownString[];
    constructor(
        contents: MarkdownString | MarkdownString[],
        public range?: Range,
    ) {
        this.contents = Array.isArray(contents) ? contents : [contents];
    }
}

/**
 * A cancellation token.
 */
export interface CancellationToken {
    readonly isCancellationRequested: boolean;
}

/**
 * Cancellation token that is never cancelled.
 */
export const CancellationTokenNone: CancellationToken = {
    isCancellationRequested: false,
};

/**
 * A single line of a text document.
 */
export interface TextLine {
    readonly lineNumber: number;
    readonly text: string;
    readonly range: Range;
}

function lineOffsetsOf(text: string): number[] {
    const offsets = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
            offsets.push(i + 1);
        }
    }
    return offsets;
}

/**
 * An in-memory text document with VS Code-like helpers.
 */
export class TextDocument {
    public readonly uri: Uri;
    public languageId: string;
    public version: number;
    #text: string;
    #lineOffsets: number[];

    private constructor(
        uri: Uri,
        languageId: string,
        version: number,
        text: string,
    ) {
        this.uri = uri;
        this.languageId = languageId;
        this.version = version;
        this.#text = text;
        this.#lineOffsets = lineOffsetsOf(text);
    }

    static create(
        uri: Uri | string,
        text: string,
        version: number = 1,
        languageId: string = "asn1",
    ): TextDocument {
        const u = typeof uri === "string" ? Uri.parse(uri) : uri;
        return new TextDocument(u, languageId, version, text);
    }

    get lineCount(): number {
        return this.#lineOffsets.length;
    }

    get eol(): EndOfLine {
        return this.#text.includes("\r\n") ? EndOfLine.CRLF : EndOfLine.LF;
    }

    getText(range?: Range): string {
        if (!range) {
            return this.#text;
        }
        const start = this.offsetAt(range.start);
        const end = this.offsetAt(range.end);
        return this.#text.slice(start, end);
    }

    /**
     * Replace the document text (used for incremental LSP sync).
     */
    update(text: string, version: number): void {
        this.#text = text;
        this.version = version;
        this.#lineOffsets = lineOffsetsOf(text);
    }

    positionAt(offset: number): Position {
        const o = Math.max(0, Math.min(offset, this.#text.length));
        const offsets = this.#lineOffsets;
        let low = 0;
        let high = offsets.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (offsets[mid]! > o) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        const line = low - 1;
        return new Position(line, o - offsets[line]!);
    }

    offsetAt(position: Position): number {
        const line = Math.max(
            0,
            Math.min(position.line, this.#lineOffsets.length - 1),
        );
        const lineStart = this.#lineOffsets[line]!;
        const next = this.#lineOffsets[line + 1] ?? (this.#text.length + 1);
        const hasNl = next <= this.#text.length && this.#text[next - 1] === "\n";
        const maxChar = next - lineStart - (hasNl ? 1 : 0);
        const character = Math.max(
            0,
            Math.min(position.character, Math.max(0, maxChar)),
        );
        return lineStart + character;
    }

    lineAt(line: number): TextLine {
        const start = this.#lineOffsets[line] ?? this.#text.length;
        const next = this.#lineOffsets[line + 1];
        let end = next ?? this.#text.length;
        if (end > start && this.#text[end - 1] === "\n") {
            const linebreak = this.#text[end - 2] === "\r" ? 2 : 1;
            end -= linebreak;
        }
        const text = this.#text.slice(start, end);
        return {
            lineNumber: line,
            text,
            range: new Range(
                new Position(line, 0),
                new Position(line, text.length),
            ),
        };
    }

    getWordRangeAtPosition(
        position: Position,
        regex?: RegExp,
    ): Range | undefined {
        const line = this.lineAt(position.line);
        const source = regex
            ? new RegExp(
                regex.source,
                regex.flags.includes("g") ? regex.flags : regex.flags + "g",
            )
            : new RegExp(ASN1_WORD_PATTERN.source, "g");
        let match: RegExpExecArray | null;
        while ((match = source.exec(line.text)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (position.character >= start && position.character <= end) {
                return new Range(
                    new Position(position.line, start),
                    new Position(position.line, end),
                );
            }
        }
        if (!regex) {
            const fallback = new RegExp(FALLBACK_WORD_PATTERN.source, "g");
            while ((match = fallback.exec(line.text)) !== null) {
                const start = match.index;
                const end = start + match[0].length;
                if (position.character >= start && position.character <= end) {
                    return new Range(
                        new Position(position.line, start),
                        new Position(position.line, end),
                    );
                }
            }
        }
        return undefined;
    }
}

export enum EndOfLine {
    LF = 1,
    CRLF = 2,
}

export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
}

export enum DiagnosticTag {
    Unnecessary = 1,
    Deprecated = 2,
}

/**
 * Related information for a diagnostic.
 */
export class DiagnosticRelatedInformation {
    constructor(
        public location: Location,
        public message: string,
    ) {}
}

/**
 * A diagnostic (error, warning, etc.).
 */
export class Diagnostic {
    public source?: string;
    public code?: string | number;
    public tags?: DiagnosticTag[];
    public relatedInformation?: DiagnosticRelatedInformation[];

    constructor(
        public range: Range,
        public message: string,
        public severity: DiagnosticSeverity = DiagnosticSeverity.Error,
    ) {}
}

/**
 * In-memory diagnostic collection.
 */
export class DiagnosticCollection {
    #map = new Map<string, Diagnostic[]>();
    #listener?: (uri: Uri, diagnostics: Diagnostic[]) => void;

    constructor(public readonly name: string) {}

    set(uri: Uri, diagnostics: Diagnostic[]): void {
        this.#map.set(uri.toString(), diagnostics);
        this.#listener?.(uri, diagnostics);
    }

    get(uri: Uri): Diagnostic[] {
        return this.#map.get(uri.toString()) ?? [];
    }

    delete(uri: Uri): void {
        this.#map.delete(uri.toString());
        this.#listener?.(uri, []);
    }

    clear(): void {
        const uris = [...this.#map.keys()].map((s) => Uri.parse(s));
        this.#map.clear();
        for (const uri of uris) {
            this.#listener?.(uri, []);
        }
    }

    onDidChangeDiagnostics(
        listener: (uri: Uri, diagnostics: Diagnostic[]) => void,
    ): void {
        this.#listener = listener;
    }
}

export enum SymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
}

/**
 * A document outline symbol.
 */
export class DocumentSymbol {
    public children: DocumentSymbol[] = [];
    constructor(
        public name: string,
        public detail: string,
        public kind: SymbolKind,
        public range: Range,
        public selectionRange: Range,
    ) {}
}

/**
 * A workspace symbol search result.
 */
export class SymbolInformation {
    constructor(
        public name: string,
        public kind: SymbolKind,
        public containerName: string,
        public location: Location,
    ) {}
}

export enum CompletionItemKind {
    Text = 1,
    Method = 2,
    Function = 3,
    Constructor = 4,
    Field = 5,
    Variable = 6,
    Class = 7,
    Interface = 8,
    Module = 9,
    Property = 10,
    Unit = 11,
    Value = 12,
    Enum = 13,
    Keyword = 14,
    Snippet = 15,
    Color = 16,
    File = 17,
    Reference = 18,
    Folder = 19,
    EnumMember = 20,
    Constant = 21,
    Struct = 22,
    Event = 23,
    Operator = 24,
    TypeParameter = 25,
}

/**
 * A snippet string.
 */
export class SnippetString {
    constructor(public value: string = "") {}
}

/**
 * A completion suggestion.
 */
export enum CompletionTriggerKind {
    Invoke = 1,
    TriggerCharacter = 2,
    TriggerForIncompleteCompletions = 3,
}

export interface CompletionContext {
    triggerKind: number;
    triggerCharacter?: string;
}

export class CompletionList<T = CompletionItem> {
    constructor(
        public items: T[],
        public isIncomplete?: boolean,
    ) {}
}

export class CompletionItem {
    public detail?: string;
    public documentation?: string | MarkdownString;
    public insertText?: string | SnippetString;
    public filterText?: string;
    public sortText?: string;
    public commitCharacters?: string[];
    public preselect?: boolean;

    constructor(
        public label: string,
        public kind?: CompletionItemKind,
    ) {}
}

export enum DocumentHighlightKind {
    Text = 1,
    Read = 2,
    Write = 3,
}

/**
 * A document highlight.
 */
export class DocumentHighlight {
    constructor(
        public range: Range,
        public kind?: DocumentHighlightKind,
    ) {}
}

/**
 * A folding range (VS Code constructor uses start/end line numbers).
 */
export class FoldingRange {
    constructor(
        public start: number,
        public end: number,
        public kind?: number,
    ) {}
}

export interface FoldingContext {
    maxRanges?: number;
}

/**
 * A nested selection range.
 */
export class SelectionRange {
    public parent?: SelectionRange;
    constructor(
        public range: Range,
        parent?: SelectionRange,
    ) {
        this.parent = parent;
    }
}

/**
 * Parameter information for signature help.
 */
export class ParameterInformation {
    constructor(
        public label: string | [number, number],
        public documentation?: string | MarkdownString,
    ) {}
}

/**
 * A single signature.
 */
export class SignatureInformation {
    public parameters: ParameterInformation[] = [];
    public activeParameter?: number;
    constructor(
        public label: string,
        public documentation?: string | MarkdownString,
    ) {}
}

/**
 * Signature help for parameterized assignments.
 */
export class SignatureHelp {
    public signatures: SignatureInformation[] = [];
    public activeSignature: number = 0;
    public activeParameter: number = 0;
}

/**
 * A textual edit.
 */
export class TextEdit {
    constructor(
        public range: Range,
        public newText: string,
    ) {}
}

/**
 * A set of edits across documents.
 */
export class WorkspaceEdit {
    readonly #changes = new Map<string, TextEdit[]>();

    replace(uri: Uri, range: Range, newText: string): void {
        this.#push(uri, new TextEdit(range, newText));
    }

    delete(uri: Uri, range: Range): void {
        this.#push(uri, new TextEdit(range, ""));
    }

    get(uri: Uri): TextEdit[] {
        return this.#changes.get(uri.toString()) ?? [];
    }

    /**
     * LSP `WorkspaceEdit.changes` map.
     */
    toLspChanges(): Record<string, { range: Range; newText: string }[]> {
        const out: Record<string, { range: Range; newText: string }[]> = {};
        for (const [uri, edits] of this.#changes) {
            out[uri] = edits.map((e) => ({ range: e.range, newText: e.newText }));
        }
        return out;
    }

    #push(uri: Uri, edit: TextEdit): void {
        const key = uri.toString();
        const list = this.#changes.get(key) ?? [];
        list.push(edit);
        this.#changes.set(key, list);
    }
}

/**
 * A command that a client may execute.
 */
export interface Command {
    title: string;
    command: string;
    arguments?: unknown[];
}

export enum CodeActionKind {
    QuickFix = "quickfix",
}

/**
 * A code action / quick fix.
 */
export class CodeAction {
    public diagnostics?: Diagnostic[];
    public isPreferred?: boolean;
    public edit?: WorkspaceEdit;
    public command?: Command;
    constructor(
        public title: string,
        public kind?: CodeActionKind | string,
    ) {}
}

export interface CodeActionContext {
    diagnostics: Diagnostic[];
}

export interface FormattingOptions {
    tabSize: number;
    insertSpaces: boolean;
}

export interface ReferenceContext {
    includeDeclaration: boolean;
}

export interface RenameProvider {
    provideRenameEdits(
        document: TextDocument,
        position: Position,
        newName: string,
        token: CancellationToken,
    ): ProviderResult<WorkspaceEdit>;
}

export interface DefinitionProvider {
    provideDefinition(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
    ): ProviderResult<Definition>;
}

export interface TypeDefinitionProvider {
    provideTypeDefinition(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
    ): ProviderResult<Definition | unknown[]>;
}

export interface HoverProvider {
    provideHover(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
    ): ProviderResult<Hover>;
}

export interface ReferenceProvider {
    provideReferences(
        document: TextDocument,
        position: Position,
        options: { includeDeclaration: boolean },
        token: CancellationToken,
    ): ProviderResult<Location[]>;
}

export interface DocumentSymbolProvider {
    provideDocumentSymbols(
        document: TextDocument,
        token: CancellationToken,
    ): ProviderResult<DocumentSymbol[]>;
}

export interface WorkspaceSymbolProvider {
    provideWorkspaceSymbols(
        query: string,
        token: CancellationToken,
    ): ProviderResult<SymbolInformation[]>;
}

export interface DocumentHighlightProvider {
    provideDocumentHighlights(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
    ): ProviderResult<DocumentHighlight[]>;
}

export interface FoldingRangeProvider {
    provideFoldingRanges(
        document: TextDocument,
        context: FoldingContext,
        token: CancellationToken,
    ): ProviderResult<FoldingRange[]>;
}

export interface CompletionItemProvider {
    provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context?: CompletionContext,
    ): ProviderResult<CompletionItem[] | CompletionList<CompletionItem>>;
}

export interface DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(
        document: TextDocument,
        options: FormattingOptions,
        token: CancellationToken,
    ): ProviderResult<TextEdit[]>;
}

export interface SelectionRangeProvider {
    provideSelectionRanges(
        document: TextDocument,
        positions: readonly Position[],
        token: CancellationToken,
    ): ProviderResult<SelectionRange[]>;
}

export interface SignatureHelpProvider {
    provideSignatureHelp(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context?: unknown,
    ): ProviderResult<SignatureHelp>;
}

export interface CodeActionProvider {
    provideCodeActions(
        document: TextDocument,
        range: Range | Selection,
        context: CodeActionContext,
        token: CancellationToken,
    ): ProviderResult<(CodeAction | Command)[]>;
}
