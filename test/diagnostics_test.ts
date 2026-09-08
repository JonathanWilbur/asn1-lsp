import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import {
    DIAG_CODE_ASSIGNMENT_DUP,
    DIAG_CODE_CHOICE_ALT_DUP,
    DIAG_CODE_COMPS_OF_NOT_TYPE,
    DIAG_CODE_COMPS_OF_WRONG_TYPE,
    DIAG_CODE_DATETIME_INVALID,
    DIAG_CODE_DATE_DAY_INVALID,
    DIAG_CODE_DATE_INVALID,
    DIAG_CODE_DURATION_NO_P,
    DIAG_CODE_EXPORT_NOT_DEFINED,
    DIAG_CODE_IMPORT_MODULE_DUP,
    DIAG_CODE_IMPORT_MODULE_UNUSED,
    DIAG_CODE_IMPORT_SYMBOL_DUP,
    DIAG_CODE_IMPORT_SYMBOL_UNUSED,
    DIAG_CODE_OID_BIG_SECOND_ARC,
    DIAG_CODE_OID_ROOT_ARC_MISMATCH,
    DIAG_CODE_OID_ROOT_ARC_NAME,
    DIAG_CODE_OID_ROOT_ARC_NUM,
    DIAG_CODE_PARAM_SYMBOL_UNUSED,
    DIAG_CODE_PROHIBITED_CHAR,
    DIAG_CODE_SET_OR_SEQ_COMP_DUP,
    DIAG_CODE_SYMBOL_NOT_DEFINED,
    DIAG_CODE_TIME_OF_DAY_INVALID,
    diagnosticCollection,
    updateDiagnostics,
} from "../src/diagnostics.ts";
import { indexAsn1File } from "../src/indexing.ts";
import { TextDocument, Uri } from "../src/vscode.ts";
import {
    diagnoseAsn1,
    openAsn1,
    resetAll,
    useTestdataWorkspace,
} from "./helpers.ts";
import { setTextDocument } from "../src/workspace.ts";
import { indexAsn1Files } from "../src/indexing.ts";

Deno.test("diagnostics for DiagnosticsTest.asn1 cover expected codes", async () => {
    resetAll();
    const folder = await useTestdataWorkspace();
    await indexAsn1Files();
    const fileUri = Uri.joinPath(folder, "DiagnosticsTest.asn1");
    const text = await Deno.readTextFile(fileUri.fsPath);
    const document = TextDocument.create(fileUri, text, 1, "asn1");
    setTextDocument(document);
    await indexAsn1File(document);
    await updateDiagnostics(document, diagnosticCollection);
    const actual = diagnosticCollection.get(fileUri);
    assert(actual.length > 0);
    const diagCodesExpected = new Map<string, number>([
        [DIAG_CODE_IMPORT_SYMBOL_DUP, 1],
        [DIAG_CODE_IMPORT_SYMBOL_UNUSED, 1],
        [DIAG_CODE_ASSIGNMENT_DUP, 1],
        [DIAG_CODE_COMPS_OF_NOT_TYPE, 1],
        [DIAG_CODE_COMPS_OF_WRONG_TYPE, 2],
        [DIAG_CODE_SET_OR_SEQ_COMP_DUP, 1],
        [DIAG_CODE_CHOICE_ALT_DUP, 1],
        [DIAG_CODE_OID_ROOT_ARC_NUM, 1],
        [DIAG_CODE_OID_ROOT_ARC_NAME, 1],
        [DIAG_CODE_OID_ROOT_ARC_MISMATCH, 2],
        [DIAG_CODE_OID_BIG_SECOND_ARC, 1],
        [DIAG_CODE_DATE_INVALID, 1],
        [DIAG_CODE_DATE_DAY_INVALID, 1],
        [DIAG_CODE_TIME_OF_DAY_INVALID, 1],
        [DIAG_CODE_DATETIME_INVALID, 1],
        [DIAG_CODE_DURATION_NO_P, 1],
        [DIAG_CODE_SYMBOL_NOT_DEFINED, 1],
        [DIAG_CODE_EXPORT_NOT_DEFINED, 1],
        [DIAG_CODE_PROHIBITED_CHAR, 2],
        [DIAG_CODE_PARAM_SYMBOL_UNUSED, 1],
        [DIAG_CODE_IMPORT_MODULE_DUP, 1],
        [DIAG_CODE_IMPORT_MODULE_UNUSED, 1],
    ]);
    for (const diag of actual) {
        assert(typeof diag.code === "string");
        const expectation = diagCodesExpected.get(diag.code);
        if (expectation === undefined) {
            throw new Error(
                `unexpected diagnostic ${diag.code} at ${diag.range.start.line}:${diag.range.start.character}`,
            );
        }
        if (expectation <= 1) {
            diagCodesExpected.delete(diag.code);
        } else {
            diagCodesExpected.set(diag.code, expectation - 1);
        }
    }
    for (const [code, remaining] of diagCodesExpected) {
        if (remaining > 0) {
            throw new Error(`diagnostic missing: ${code}`);
        }
    }
});

Deno.test("does not flag imported objects used in ObjectDefn set settings as unused", async () => {
    resetAll();
    await useTestdataWorkspace();
    await indexAsn1Files();
    const document = await diagnoseAsn1(`
ObjectDefnImportUse
DEFINITIONS ::= BEGIN
IMPORTS
    OBJECT-CLASS, top, commonName, neverUsed
        FROM InformationFramework
        {joint-iso-itu-t ds(5) module(1) informationFramework(1) 9};
thingy OBJECT-CLASS ::= {
    SUBCLASS OF        {top}
    KIND               auxiliary
    MAY CONTAIN        {commonName}
    LDAP-NAME          {"thingy"}
    LDAP-DESC          "testeroo"
    ID                 id-oc-thingy
}
defaulty OBJECT-CLASS ::= {
    &Superclasses {top},
    &id id-oc-defaulty
}
END
`);
    const unused = diagnosticCollection.get(document.uri)
        .filter((d) => d.code === DIAG_CODE_IMPORT_SYMBOL_UNUSED)
        .map((d) => document.getText(d.range));
    assertEquals(unused, ["neverUsed"]);
});

Deno.test("still flags imported symbols used only as BIT STRING named bits as unused", async () => {
    resetAll();
    const document = await diagnoseAsn1(`
BitStringNamedBit
DEFINITIONS ::= BEGIN
IMPORTS unusedBit FROM OtherModule;
Flags ::= BIT STRING { unusedBit (0), otherBit (1) }
flags Flags ::= { unusedBit }
END
`);
    const unused = diagnosticCollection.get(document.uri)
        .filter((d) => d.code === DIAG_CODE_IMPORT_SYMBOL_UNUSED)
        .map((d) => document.getText(d.range));
    assertEquals(unused, ["unusedBit"]);
});

Deno.test("does not flag implicitly imported ENUMERATED variants", async () => {
    resetAll();
    await openAsn1(`
ImplicitEnumDefs
DEFINITIONS ::= BEGIN
CursorTestKind ::= ENUMERATED {
    cursorTestAuxiliary (2)
}
END
`);
    const document = await diagnoseAsn1(`
ImplicitEnumUse
DEFINITIONS ::= BEGIN
TEST-OC ::= CLASS {
    &kind INTEGER OPTIONAL,
    &id OBJECT IDENTIFIER UNIQUE
}
WITH SYNTAX {
    [KIND &kind]
    ID &id
}
thingy TEST-OC ::= {
    KIND cursorTestAuxiliary
    ID totallyBogusIdent
}
END
`);
    const undefinedNames = diagnosticCollection.get(document.uri)
        .filter((d) => d.code === DIAG_CODE_SYMBOL_NOT_DEFINED)
        .map((d) => document.getText(d.range));
    assertFalse(undefinedNames.includes("cursorTestAuxiliary"));
    assert(undefinedNames.includes("totallyBogusIdent"));
});

Deno.test("does not flag implicitly imported named bits used in curly brackets", async () => {
    resetAll();
    await openAsn1(`
ImplicitBitDefs
DEFINITIONS ::= BEGIN
CursorTestBits ::= BIT STRING {
    cursorTestFlag (0)
}
END
`);
    const document = await diagnoseAsn1(`
ImplicitBitUse
DEFINITIONS ::= BEGIN
Holder{INTEGER:x} ::= SEQUENCE { f INTEGER DEFAULT x }
Alias ::= Holder{ cursorTestFlag }
Unknown ::= Holder{ totallyBogusBit }
END
`);
    const undefinedNames = diagnosticCollection.get(document.uri)
        .filter((d) => d.code === DIAG_CODE_SYMBOL_NOT_DEFINED)
        .map((d) => document.getText(d.range));
    assertFalse(undefinedNames.includes("cursorTestFlag"));
    assert(undefinedNames.includes("totallyBogusBit"));
});
