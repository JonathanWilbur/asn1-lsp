import { assert, assertEquals } from "jsr:@std/assert@1";
import { Asn1SymbolProvider } from "../src/symbols.ts";
import { Asn1FoldingRangeProvider } from "../src/folding.ts";
import { ASN1HoverProvider } from "../src/hover.ts";
import { Asn1DefinitionProvider } from "../src/gotodef.ts";
import {
    indexAfter,
    neverCancelled,
    openAsn1,
    posAt,
    resetAll,
} from "./helpers.ts";
import { Location } from "../src/vscode.ts";

const ASN1_MODULE_A = `
SymbolsTest DEFINITIONS ::= BEGIN
IMPORTS int1 FROM SymbolsA;

int2 INTEGER ::= int1

ErrorResponse{INTEGER:defaultCode} ::= SEQUENCE {
    code INTEGER DEFAULT defaultCode,
    message UTF8String OPTIONAL
}

BoofyError ::= ErrorResponse{int1}

CoolNumbers INTEGER ::= {int1 | int2, ...}

MESSAGE ::= TYPE-IDENTIFIER

msg1 MESSAGE ::= { PrintableString IDENTIFIED BY int1 }

-- This should NOT match, despite the substring.
blint1 INTEGER ::= 4

int3 INTEGER ::= SymbolsA.int2

END
`;

const FOLDING_MODULE = `
FoldingModule DEFINITIONS ::= BEGIN

Seq1 ::= SEQUENCE {
    asdf INTEGER
}

Seq2 ::= SEQUENCE {
    asdf INTEGER
}

-- This should not get a folding range, because it is a single line.
int INTEGER ::= 6
END
`;

const HOVER_FILE = `
HoverTest1 DEFINITIONS ::= BEGIN
ErrorResponse{INTEGER:defaultCode} ::= SEQUENCE {
    code INTEGER DEFAULT defaultCode,
    message UTF8String OPTIONAL
}
END
HoverTest2 DEFINITIONS ::= BEGIN
IMPORTS ErrorResponse{} FROM HoverTest1;
MyResponse ::= ErrorResponse{5}
END
`;

const GOTODEF_MODULE = `
GoToDefModule DEFINITIONS ::= BEGIN
int1 INTEGER ::= 5
int2 INTEGER ::= int1
END
`;

Deno.test("document symbols: one module with import and assignments", async () => {
    resetAll();
    const document = await openAsn1(ASN1_MODULE_A);
    const symbols = await new Asn1SymbolProvider().provideDocumentSymbols(
        document,
        neverCancelled(),
    );
    assert(Array.isArray(symbols));
    assertEquals(symbols.length, 1);
    assertEquals(symbols[0]!.children.length, 9);
});

Deno.test("folding ranges: module plus multi-line assignments", async () => {
    resetAll();
    const document = await openAsn1(FOLDING_MODULE);
    const ranges = await new Asn1FoldingRangeProvider().provideFoldingRanges(
        document,
        {},
        neverCancelled(),
    );
    assert(Array.isArray(ranges));
    assertEquals(ranges.length, 3);
});

Deno.test("hover shows the definition of a DefinedType", async () => {
    resetAll();
    const document = await openAsn1(HOVER_FILE);
    const offset = document.getText().indexOf("ErrorResponse{5}") + 2;
    const position = document.positionAt(offset);
    const hover = await new ASN1HoverProvider().provideHover(
        document,
        position,
        neverCancelled(),
    );
    assert(hover);
    const texts = hover.contents.map((c) => c.value);
    assert(texts.some((t) => t.includes("UTF8String")));
});

Deno.test("go to definition for a symbol within a single module", async () => {
    resetAll();
    const doc = await openAsn1(GOTODEF_MODULE);
    const offset = indexAfter(doc.getText(), "int2 INTEGER ::= int1") - 2;
    const position = doc.positionAt(offset);
    const loc = await new Asn1DefinitionProvider().provideDefinition(
        doc,
        position,
        neverCancelled(),
    );
    assert(loc instanceof Location);
    assert(loc.range.isEqual(
        new (await import("../src/vscode.ts")).Range(
            new (await import("../src/vscode.ts")).Position(2, 0),
            new (await import("../src/vscode.ts")).Position(2, 18),
        ),
    ));
});
