import { assertEquals } from "jsr:@std/assert@1";
import { fuzzyMatch } from "../src/wssymbols.ts";
import {
    inOpenSyntaxRegion,
    nameAndOrNumberToString,
    startsWithCapitalLetter,
} from "../src/utils.ts";

Deno.test("fuzzyMatch matches query characters in order", () => {
    const matches: [string, string][] = [
        ["abc", "a_b_c"],
        ["abc", "alphabetic"],
        ["cmp", "completionitem"],
        ["vsc", "visualstudiocode"],
        ["cat", "cart"],
    ];
    for (const [query, symbol] of matches) {
        assertEquals(fuzzyMatch(query, symbol), true);
    }
});

Deno.test("fuzzyMatch rejects out-of-order or missing characters", () => {
    assertEquals(fuzzyMatch("cta", "cart"), false);
    assertEquals(fuzzyMatch("xyz", "completion"), false);
});

Deno.test("startsWithCapitalLetter", () => {
    assertEquals(startsWithCapitalLetter("Module"), true);
    assertEquals(startsWithCapitalLetter("value"), false);
});

Deno.test("inOpenSyntaxRegion detects comments and strings", () => {
    assertEquals(inOpenSyntaxRegion("foo -- comment"), true);
    assertEquals(inOpenSyntaxRegion('name "hello'), true);
    assertEquals(inOpenSyntaxRegion("foo ::= INTEGER"), false);
});

Deno.test("nameAndOrNumberToString", () => {
    assertEquals(nameAndOrNumberToString({ name: "iso", number: 1 }), "iso(1)");
    assertEquals(nameAndOrNumberToString({ number: 5 }), "5");
    assertEquals(nameAndOrNumberToString({ name: "joint-iso-itu-t" }), "joint-iso-itu-t");
});
