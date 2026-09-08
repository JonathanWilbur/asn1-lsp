import { assertEquals } from "jsr:@std/assert@1";
import { Asn1LanguageServer } from "../src/lsp/server.ts";
import { readMessages, writeMessage } from "../src/lsp/jsonrpc.ts";
import { resetAll } from "./helpers.ts";

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

    let combined = new Uint8Array(0);
    for (const chunk of chunks) {
        const next = new Uint8Array(combined.byteLength + chunk.byteLength);
        next.set(combined, 0);
        next.set(chunk, combined.byteLength);
        combined = next;
    }
    const header = new TextDecoder().decode(combined);
    assertEquals(header.startsWith("Content-Length:"), true);

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

    await server.handle({ jsonrpc: "2.0", method: "initialized", params: {} });
    assertEquals(server.initialized, true);

    await server.handle({ jsonrpc: "2.0", id: 2, method: "shutdown" });
    await server.handle({ jsonrpc: "2.0", method: "exit" });
    assertEquals(server.exitRequested, true);
});
