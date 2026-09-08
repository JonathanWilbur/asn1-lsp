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
 * Write a JSON-RPC message with an LSP Content-Length header.
 */
export async function writeMessage(
    writer: WritableStreamDefaultWriter<Uint8Array>,
    message: unknown,
): Promise<void> {
    const json = JSON.stringify(message);
    const body = encoder.encode(json);
    const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
    await writer.write(header);
    await writer.write(body);
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
