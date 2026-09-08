import { assert, assertEquals } from "jsr:@std/assert@1";
import { getParserOutputs } from "../src/parsing.ts";
import { Asn1CompletionItemProvider } from "../src/completion.ts";
import { Asn1RenameProvider } from "../src/rename.ts";
import { Asn1WorkspaceSymbolProvider } from "../src/wssymbols.ts";
import { Asn1HighlightProvider } from "../src/highlight.ts";
import { Asn1SelectionRangeProvider } from "../src/selectrange.ts";
import { Asn1SignatureHelpProvider } from "../src/sighelp.ts";
import { Asn1TypeDefinitionProvider } from "../src/typedef.ts";
import { Asn1ReferenceProvider } from "../src/findallref.ts";
import { Asn1CodeActionProvider, resolveCodeAction } from "../src/codeact.ts";
import { CompletionTriggerKind, Range } from "../src/vscode.ts";
import {
    applyEdits,
    diagnoseAsn1,
    neverCancelled,
    openAsn1,
    posAt,
    resetAll,
} from "./helpers.ts";
import { diagnosticCollection } from "../src/diagnostics.ts";
import { Location } from "../src/vscode.ts";
import { getAsn1Config } from "../src/workspace.ts";

Deno.test("completions after TYPE-IDENTIFIER. suggest class fields", async () => {
    resetAll();
    const doc = await openAsn1(`
CompMod DEFINITIONS ::= BEGIN
x TYPE-IDENTIFIER.
END
`);
    const afterDot = doc.positionAt(
        indexAfterSafe(doc.getText(), "TYPE-IDENTIFIER."),
    );
    const result = await new Asn1CompletionItemProvider().provideCompletionItems(
        doc,
        afterDot,
        neverCancelled(),
        { triggerKind: CompletionTriggerKind.TriggerCharacter, triggerCharacter: "." },
    );
    assert(result);
    const items = Array.isArray(result) ? result : result.items;
    const labels = items.map((i) => i.label);
    assert(labels.includes("&Type"));
    assert(labels.includes("&id"));
});

Deno.test("rename updates all references of a local assignment", async () => {
    resetAll();
    const doc = await openAsn1(`
RenameMod DEFINITIONS ::= BEGIN
int1 INTEGER ::= 5
int2 INTEGER ::= int1
END
`);
    const position = posAt(doc, "int2 INTEGER ::= int1");
    position; // first int2
    const atInt1Use = doc.positionAt(
        indexAfterSafe(doc.getText(), "int2 INTEGER ::= int1") - 2,
    );
    const edit = await new Asn1RenameProvider().provideRenameEdits(
        doc,
        atInt1Use,
        "renamed",
        neverCancelled(),
    );
    assert(edit);
    const text = applyEdits(doc, edit.get(doc.uri));
    assert(text.includes("renamed"));
    assert(!text.includes("int1"));
});

function indexAfterSafe(haystack: string, needle: string): number {
    const i = haystack.indexOf(needle);
    if (i < 0) throw new Error(needle);
    return i + needle.length;
}

Deno.test("workspace symbols fuzzy-match boo", async () => {
    resetAll();
    const a = await openAsn1(`
WsSymbolsTest1 DEFINITIONS ::= BEGIN
BoofyError ::= INTEGER
END
`);
    const b = await openAsn1(`
WsSymbolsTest2 DEFINITIONS ::= BEGIN
boop BOOLEAN ::= FALSE
END
`);
    await getParserOutputs(a);
    await getParserOutputs(b);
    const symbols = await new Asn1WorkspaceSymbolProvider().provideWorkspaceSymbols(
        "boo",
        neverCancelled(),
    );
    assert(Array.isArray(symbols));
    assertEquals(symbols.length, 2);
    const names = symbols.map((s) => s.name).sort();
    assertEquals(names, ["BoofyError", "boop"]);
});

Deno.test("document highlights find identifier occurrences", async () => {
    resetAll();
    const doc = await openAsn1(`
HL DEFINITIONS ::= BEGIN
int1 INTEGER ::= 5
int2 INTEGER ::= int1
END
`);
    const position = doc.positionAt(
        indexAfterSafe(doc.getText(), "int2 INTEGER ::= int1") - 2,
    );
    const highlights = await new Asn1HighlightProvider().provideDocumentHighlights(
        doc,
        position,
        neverCancelled(),
    );
    assert(Array.isArray(highlights));
    assert(highlights.length >= 2);
});

Deno.test("selection ranges nest from identifier to assignment", async () => {
    resetAll();
    const doc = await openAsn1(`
SR DEFINITIONS ::= BEGIN
Seq1 ::= SEQUENCE { a INTEGER }
END
`);
    const position = posAt(doc, "INTEGER");
    const ranges = await new Asn1SelectionRangeProvider().provideSelectionRanges(
        doc,
        [position],
        neverCancelled(),
    );
    assert(Array.isArray(ranges));
    assertEquals(ranges.length, 1);
    assert(ranges[0]!.range.contains(position));
});

Deno.test("signature help for parameterized type", async () => {
    resetAll();
    const valid = await openAsn1(`
SH DEFINITIONS ::= BEGIN
Holder{INTEGER:x} ::= SEQUENCE { f INTEGER DEFAULT x }
Alias ::= Holder{5}
END
`);
    await getParserOutputs(valid);
    const incomplete = valid.getText().replace("Holder{5}", "Holder{");
    valid.update(incomplete, valid.version + 1);
    const afterBrace = valid.positionAt(
        indexAfterSafe(valid.getText(), "Alias ::= Holder{"),
    );
    const help = await new Asn1SignatureHelpProvider().provideSignatureHelp(
        valid,
        afterBrace,
        neverCancelled(),
    );
    assert(help);
    assert(help.signatures.length >= 1);
});

Deno.test("type definition for a value assignment goes to the type", async () => {
    resetAll();
    const doc = await openAsn1(`
TD DEFINITIONS ::= BEGIN
MyType ::= INTEGER
val MyType ::= 5
END
`);
    const position = posAt(doc, "val MyType ::= 5");
    const loc = await new Asn1TypeDefinitionProvider().provideTypeDefinition(
        doc,
        position,
        neverCancelled(),
    );
    assert(loc instanceof Location);
    assert(doc.getText(loc.range).includes("MyType ::= INTEGER"));
});

Deno.test("find all references for a local assignment", async () => {
    resetAll();
    const doc = await openAsn1(`
RefMod DEFINITIONS ::= BEGIN
int1 INTEGER ::= 5
int2 INTEGER ::= int1
END
`);
    await getParserOutputs(doc);
    const position = doc.positionAt(
        indexAfterSafe(doc.getText(), "int2 INTEGER ::= int1") - 2,
    );
    const refs = await new Asn1ReferenceProvider().provideReferences(
        doc,
        position,
        { includeDeclaration: true },
        neverCancelled(),
    );
    assert(Array.isArray(refs));
    assert(refs.length >= 2);
});

Deno.test("code action removes unused import symbol", async () => {
    resetAll();
    const doc = await diagnoseAsn1(`
ModuleName DEFINITIONS ::= BEGIN
IMPORTS
    first, used
    FROM OtherModule;
usedAlias TYPE-IDENTIFIER ::= used
END
`);
    const offset = doc.getText().indexOf("first");
    const start = doc.positionAt(offset);
    const end = doc.positionAt(offset + "first".length);
    const range = new Range(start, end);
    const actions = await new Asn1CodeActionProvider().provideCodeActions(
        doc,
        range,
        { diagnostics: diagnosticCollection.get(doc.uri) },
        neverCancelled(),
    );
    assert(Array.isArray(actions));
    const action = actions.find((a) =>
        "title" in a && a.title.toLowerCase() === "remove this symbol"
    );
    assert(action && "edit" in action && action.edit);
    const text = applyEdits(doc, action.edit.get(doc.uri));
    assert(!text.includes("first"));
    assert(text.includes("used"));
});

Deno.test("code action treats an undefined identifier as defined", async () => {
    resetAll();
    const doc = await diagnoseAsn1(`
UndefMod DEFINITIONS ::= BEGIN
x INTEGER ::= missingIdent
END
`);
    const offset = doc.getText().indexOf("missingIdent");
    const start = doc.positionAt(offset);
    const end = doc.positionAt(offset + "missingIdent".length);
    const range = new Range(start, end);
    const actions = await new Asn1CodeActionProvider().provideCodeActions(
        doc,
        range,
        { diagnostics: diagnosticCollection.get(doc.uri) },
        neverCancelled(),
    );
    assert(Array.isArray(actions));
    const action = actions.find((a) =>
        a.title.includes("missingIdent") && a.title.toLowerCase().includes("treat")
    );
    assert(action);
    assertEquals(action.edit, undefined);
    await resolveCodeAction(action);
    assert(getAsn1Config().alwaysDefined.includes("missingIdent"));
});
