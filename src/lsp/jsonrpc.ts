/**
 * Content-Length framed JSON-RPC 2.0 over stdio.
 *
 * @module
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id?: number | string | null;
    method: string;
    params?: unknown;
}

export interface JsonRpcSuccess {
    jsonrpc: "2.0";
    id: number | string | null;
    result: unknown;
}

export interface JsonRpcError {
    jsonrpc: "2.0";
    id: number | string | null;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcSuccess | JsonRpcError;

export const ErrorCodes = {
    ParseError: -32700,
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InvalidParams: -32602,
    InternalError: -32603,
    RequestCancelled: -32800,
    ServerNotInitialized: -32002,
    UnknownErrorCode: -32001,
} as const;

/**
 * Encode a JSON-RPC message with LSP / HTTP-like `Content-Length` framing.
 *
 * The LSP base protocol requires each JSON body to be preceded by a header
 * block ending in `\r\n\r\n`. `Content-Length` is a UTF-8 byte count.
 */
export function encodeMessage(message: unknown): Uint8Array {
    const body = encoder.encode(JSON.stringify(message));
    const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
    const framed = new Uint8Array(header.byteLength + body.byteLength);
    framed.set(header, 0);
    framed.set(body, header.byteLength);
    return framed;
}

/**
 * Write a fully framed JSON-RPC message as a single chunk.
 */
export async function writeMessage(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    message: unknown,
): Promise<void> {
    await writer.write(encodeMessage(message));
}

/**
 * Write every byte of `data`, looping on partial `writeSync` results.
 */
export function writeAllSync(
    dest: { writeSync(p: Uint8Array): number },
    data: Uint8Array,
): void {
    let offset = 0;
    while (offset < data.byteLength) {
        const n = dest.writeSync(data.subarray(offset));
        if (n <= 0) {
            throw new Error("failed to write JSON-RPC framed message");
        }
        offset += n;
    }
}

/**
 * Write a framed JSON-RPC message to stdout. Synchronous so a notification
 * cannot interleave with another message's header or body.
 */
export function writeMessageToStdout(message: unknown): void {
    writeAllSync(Deno.stdout, encodeMessage(message));
}

/**
 * Read JSON-RPC messages from a byte stream.
 */
export async function* readMessages(
    reader: ReadableStream<Uint8Array>,
): AsyncGenerator<JsonRpcMessage> {
    const streamReader = reader.getReader();
    let buffer: Uint8Array = new Uint8Array(0);
    try {
        while (true) {
            while (true) {
                const headerEnd = indexOfHeaderEnd(buffer);
                if (headerEnd === -1) {
                    break;
                }
                const headerText = decoder.decode(buffer.slice(0, headerEnd));
                const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
                if (!lengthMatch) {
                    throw new Error("JSON-RPC message missing Content-Length");
                }
                const length = Number(lengthMatch[1]);
                const bodyStart = headerEnd + 4;
                if (buffer.byteLength < bodyStart + length) {
                    break;
                }
                const bodyBytes = buffer.slice(bodyStart, bodyStart + length);
                buffer = buffer.slice(bodyStart + length);
                const text = decoder.decode(bodyBytes);
                yield JSON.parse(text) as JsonRpcMessage;
            }
            const { value, done } = await streamReader.read();
            if (done) {
                return;
            }
            buffer = concat(buffer, new Uint8Array(value));
        }
    } finally {
        streamReader.releaseLock();
    }
}

function indexOfHeaderEnd(buf: Uint8Array): number {
    for (let i = 0; i < buf.length - 3; i++) {
        if (
            buf[i] === 13 && buf[i + 1] === 10 &&
            buf[i + 2] === 13 && buf[i + 3] === 10
        ) {
            return i;
        }
    }
    return -1;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.byteLength + b.byteLength);
    out.set(a, 0);
    out.set(b, a.byteLength);
    return out as Uint8Array;
}
