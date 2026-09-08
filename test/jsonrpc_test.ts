import { assertEquals } from "jsr:@std/assert@1";
import { Asn1LanguageServer } from "../src/lsp/server.ts";
import {
    encodeMessage,
    readMessages,
    writeAllSync,
    writeMessage,
} from "../src/lsp/jsonrpc.ts";
import { resetAll } from "./helpers.ts";

function concat(chunks: Uint8Array[]): Uint8Array {
    let combined = new Uint8Array(0);
    for (const chunk of chunks) {
        const next = new Uint8Array(combined.byteLength + chunk.byteLength);
        next.set(combined, 0);
        next.set(chunk, combined.byteLength);
        combined = next;
    }
    return combined;
}

function assertFramed(
    bytes: Uint8Array,
    expected: unknown,
): void {
    const text = new TextDecoder().decode(bytes);
    const sep = "\r\n\r\n";
    const i = text.indexOf(sep);
    assertEquals(i !== -1, true);
    const header = text.slice(0, i);
    const body = bytes.slice(i + sep.length);
    assertEquals(header, `Content-Length: ${body.byteLength}`);
    assertEquals(JSON.parse(new TextDecoder().decode(body)), expected);
}

Deno.test("encodeMessage wraps JSON in Content-Length framing", () => {
    const payload = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    assertFramed(encodeMessage(payload), payload);
});

Deno.test("JSON-RPC Content-Length framing round-trips", async () => {
    const chunks: Uint8Array[] = [];
    const writable = new WritableStream<Uint8Array>({
        write(chunk) {
            chunks.push(chunk.slice());
        },
    });
    const writer = writable.getWriter();
    const payload = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    await writeMessage(writer, payload);
    await writer.close();

    const combined = concat(chunks);
    assertEquals(chunks.length, 1);
    assertFramed(combined, payload);

    const readable = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(combined);
            controller.close();
        },
    });
    const messages = [];
    for await (const msg of readMessages(readable)) {
        messages.push(msg);
    }
    assertEquals(messages.length, 1);
    assertEquals((messages[0] as { method: string }).method, "initialize");
    assertEquals((messages[0] as { id: number }).id, 1);
});

Deno.test("writeAllSync writes the full framed message", () => {
    const payload = { jsonrpc: "2.0", method: "exit" };
    const framed = encodeMessage(payload);
    const chunks: Uint8Array[] = [];
    const dest = {
        writeSync(p: Uint8Array): number {
            const n = Math.min(7, p.byteLength);
            chunks.push(p.slice(0, n));
            return n;
        },
    };
    writeAllSync(dest, framed);
    assertFramed(concat(chunks), payload);
});

Deno.test("stdio CLI frames initialize on stdout", async () => {
    const initialize = {
        jsonrpc: "2.0" as const,
        id: 1,
        method: "initialize",
        params: { processId: null, rootUri: null, capabilities: {} },
    };
    const input = concat([
        encodeMessage(initialize),
        encodeMessage({ jsonrpc: "2.0", id: 2, method: "shutdown" }),
        encodeMessage({ jsonrpc: "2.0", method: "exit" }),
    ]);
    const cli = new URL("../cli.ts", import.meta.url);
    const command = new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--quiet", cli.pathname],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
    });
    const child = command.spawn();
    const writer = child.stdin.getWriter();
    await writer.write(input);
    await writer.close();
    const output = await child.output();
    assertEquals(output.code, 0);
    assertEquals(new TextDecoder().decode(output.stderr), "");
    const stdout = new TextDecoder().decode(output.stdout);
    assertEquals(stdout.startsWith("Content-Length:"), true);
    const messages = [];
    const readable = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(output.stdout);
            controller.close();
        },
    });
    for await (const msg of readMessages(readable)) {
        messages.push(msg);
    }
    assertEquals(messages.length >= 1, true);
    const init = messages.find((m) => "id" in m && m.id === 1) as {
        result: { capabilities: { hoverProvider: boolean } };
    };
    assertEquals(init.result.capabilities.hoverProvider, true);
});

Deno.test("LSP initialize / initialized / shutdown / exit", async () => {
    resetAll();
    const sent: unknown[] = [];
    const server = new Asn1LanguageServer(async (msg) => {
        sent.push(msg);
    });
    await server.handle({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            processId: null,
            rootUri: null,
            capabilities: {},
        },
    });
    const init = sent.find((m) =>
        typeof m === "object" && m !== null && "id" in m &&
        (m as { id: unknown }).id === 1
    ) as { result: { capabilities: { hoverProvider: boolean } } };
    assertEquals(init.result.capabilities.hoverProvider, true);
    assertEquals(
        (init.result.capabilities as { executeCommandProvider?: unknown })
            .executeCommandProvider,
        undefined,
    );

    await server.handle({ jsonrpc: "2.0", method: "initialized", params: {} });
    assertEquals(server.initialized, true);

    await server.handle({ jsonrpc: "2.0", id: 2, method: "shutdown" });
    await server.handle({ jsonrpc: "2.0", method: "exit" });
    assertEquals(server.exitRequested, true);
});
