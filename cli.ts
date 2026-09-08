/**
 * Stdio entry point for the ASN.1 language server.
 *
 * @module
 */
import { runStdioServer } from "./src/lsp/server.ts";

await runStdioServer();
