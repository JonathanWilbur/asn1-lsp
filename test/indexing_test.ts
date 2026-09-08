import { assertEquals } from "jsr:@std/assert@1";
import { lex } from "@wildboar/asn1-parser";
import {
    clearNamedBitAndIntegerIndexes,
    getModuleNamesAndImportsFromTokenStream,
    indexNamedBitsAndIntegersFromTokenStream,
    isKnownNamedBit,
    isKnownNamedIntegerOrEnum,
} from "../src/indexing.ts";

Deno.test("indexes ENUMERATED variants and named integers separately from named bits", () => {
    clearNamedBitAndIntegerIndexes();
    const text = `
M DEFINITIONS ::= BEGIN
E ::= ENUMERATED { red (0), green (1) }
I ::= INTEGER { one (1), two (2) }
B ::= BIT STRING { flagA (0), flagB (1) }
plainInt INTEGER ::= 5
plainBits BIT STRING ::= '01'B
END
`;
    const tokens = Array.from(lex(text));
    indexNamedBitsAndIntegersFromTokenStream(tokens, text);
    assertEquals(isKnownNamedIntegerOrEnum("red"), true);
    assertEquals(isKnownNamedIntegerOrEnum("green"), true);
    assertEquals(isKnownNamedIntegerOrEnum("one"), true);
    assertEquals(isKnownNamedIntegerOrEnum("two"), true);
    assertEquals(isKnownNamedBit("flagA"), true);
    assertEquals(isKnownNamedBit("flagB"), true);
    assertEquals(isKnownNamedBit("red"), false);
    assertEquals(isKnownNamedBit("one"), false);
    assertEquals(isKnownNamedIntegerOrEnum("flagA"), false);
    assertEquals(isKnownNamedIntegerOrEnum("plainInt"), false);
});

Deno.test("getModuleNamesAndImportsFromTokenStream finds modules and imports", () => {
    const text = `
ModA DEFINITIONS ::= BEGIN
IMPORTS foo, bar FROM ModB;
x INTEGER ::= 1
END
`;
    const tokens = Array.from(lex(text));
    const mods = [...getModuleNamesAndImportsFromTokenStream(tokens, text)];
    assertEquals(mods.length, 1);
    assertEquals(mods[0]!.name, "ModA");
    assertEquals(mods[0]!.imports.has("ModB:foo"), true);
    assertEquals(mods[0]!.imports.has("ModB:bar"), true);
});
