import { assertEquals } from "jsr:@std/assert@1";
import { DATE_REGEX, TIME_REGEX } from "../src/time.ts";

Deno.test("DATE_REGEX accepts valid months", () => {
    const valid = [
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
        "2026-05-01",
        "2026-06-01",
        "2026-07-01",
        "2026-08-01",
        "2026-09-01",
        "2026-10-01",
        "2026-11-01",
        "2026-12-01",
    ];
    for (const d of valid) {
        assertEquals(DATE_REGEX.test(d), true, d);
    }
});

Deno.test("DATE_REGEX rejects invalid months", () => {
    assertEquals(DATE_REGEX.test("2026-13-01"), false);
    assertEquals(DATE_REGEX.test("2026-00-01"), false);
});

Deno.test("TIME_REGEX accepts valid times", () => {
    const valid = [
        "00:00:00",
        "13:00:59",
        "23:59:59",
        "13:00:48",
        "13:00:32",
        "13:00:12",
    ];
    for (const d of valid) {
        assertEquals(TIME_REGEX.test(d), true, d);
    }
});

Deno.test("TIME_REGEX rejects invalid times", () => {
    assertEquals(TIME_REGEX.test("24:00:00"), false);
    assertEquals(TIME_REGEX.test("23:60:60"), false);
});
