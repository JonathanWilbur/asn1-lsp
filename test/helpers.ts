/**
 * Shared helpers for Deno unit tests.
 */
import {
    CancellationTokenNone,
    Position,
    Range,
    TextDocument,
    TextEdit,
    Uri,
} from "../src/vscode.ts";
import {
    resetWorkspaceState,
    setTextDocument,
    setWorkspaceFolders,
} from "../src/workspace.ts";
import {
    clearParserOutputCaches,
} from "../src/parsing.ts";
import {
    clearAsn1ModuleIndexes,
    clearNamedBitAndIntegerIndexes,
    indexAsn1File,
} from "../src/indexing.ts";
import {
    diagnosticCollection,
    updateDiagnostics,
} from "../src/diagnostics.ts";

let untitledSeq = 0;

/**
 * Reset parser, index, and workspace state between tests.
 */
export function resetAll(): void {
    clearParserOutputCaches();
    clearAsn1ModuleIndexes();
    clearNamedBitAndIntegerIndexes();
    diagnosticCollection.clear();
    resetWorkspaceState();
}

/**
 * Create an in-memory ASN.1 document and index it.
 */
export async function openAsn1(
    text: string,
    uri?: Uri,
): Promise<TextDocument> {
    const docUri = uri ?? Uri.parse(`untitled:asn1-test-${++untitledSeq}.asn1`);
    const doc = TextDocument.create(docUri, text, 1, "asn1");
    setTextDocument(doc);
    await indexAsn1File(doc);
    return doc;
}

/**
 * Open, index, and compute diagnostics.
 */
export async function diagnoseAsn1(
    text: string,
    uri?: Uri,
): Promise<TextDocument> {
    const doc = await openAsn1(text, uri);
    await updateDiagnostics(doc, diagnosticCollection);
    return doc;
}

/**
 * Point the workspace at `testdata/` and index those files.
 */
export async function useTestdataWorkspace(): Promise<Uri> {
    const folder = Uri.file(`${Deno.cwd()}/testdata`);
    setWorkspaceFolders([folder]);
    return folder;
}

export function neverCancelled(): typeof CancellationTokenNone {
    return CancellationTokenNone;
}

export function posAt(doc: TextDocument, needle: string, extra = 0): Position {
    const offset = doc.getText().indexOf(needle);
    if (offset < 0) {
        throw new Error(`needle not found: ${needle}`);
    }
    return doc.positionAt(offset + extra);
}

export function indexAfter(haystack: string, needle: string): number {
    const i = haystack.indexOf(needle);
    if (i < 0) {
        return i;
    }
    return i + needle.length;
}

/**
 * Apply text edits to a document (later edits first so offsets stay valid).
 */
export function applyEdits(doc: TextDocument, edits: TextEdit[]): string {
    const sorted = [...edits].sort((a, b) =>
        doc.offsetAt(b.range.start) - doc.offsetAt(a.range.start)
    );
    let text = doc.getText();
    for (const edit of sorted) {
        const start = doc.offsetAt(edit.range.start);
        const end = doc.offsetAt(edit.range.end);
        text = text.slice(0, start) + edit.newText + text.slice(end);
    }
    return text;
}

export function applyWorkspaceEdits(
    doc: TextDocument,
    edits: TextEdit[],
): string {
    return applyEdits(doc, edits);
}

export { Range, Uri, Position, TextDocument };
