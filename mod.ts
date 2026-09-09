/**
 * ASN.1 Language Server Protocol implementation for Deno.
 *
 * Import this module to embed the language server, or run
 * `deno run -A jsr:@wildboar/asn1-lsp/cli` for a stdio LSP server.
 *
 * @module
 */
export { runStdioServer, Asn1LanguageServer } from "./src/lsp/server.ts";
export type { Asn1Config } from "./src/config.ts";
