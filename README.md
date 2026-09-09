# ASN.1 Language Server Protocol (LSP) Server

[![JSR](https://jsr.io/badges/@wildboar/asn1-lsp)](https://jsr.io/@wildboar/asn1-lsp)

A [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
implementation for ASN.1, written in TypeScript and intended to run on
[Deno](https://deno.com/). Parsing uses
[`@wildboar/asn1-parser`](https://jsr.io/@wildboar/asn1-parser).

This package ports the language intelligence from the
[wildboar.asn1](https://marketplace.visualstudio.com/items?itemName=wildboar.asn1)
VS Code extension into a stdio LSP server that any editor can host. The
GitHub repository is [here](https://github.com/JonathanWilbur/vscode-asn1).

This was mostly done by AI. I wrote almost all of the VS Code extension without
AI. I basically just dropped the code for it into this repo and told the agent
to implement the VS Code extensions API, but make it speak LSP. That is to say
that this isn't fully AI slop: a real person lovingly created most of this code,
and AI just adapted it.

It seems to work, but it was not a one-shot. There were show-stopping bugs I had
to fix at the outset. I manually tested all of the major features in Neovim.

## Install

```sh
deno add jsr:@wildboar/asn1-lsp
```

Or run the server without installing:

```sh
deno run -A jsr:@wildboar/asn1-lsp/cli
```

Point your editor's ASN.1 language client at that program (stdio transport).

Compiled binaries are attached to GitHub Releases (`asn1-lsp-linux-x86_64`,
`asn1-lsp-darwin-aarch64`, `asn1-lsp-windows-x86_64.exe`, and other targets).

## Features

- Hover (keywords, OIDs, literals, resolved assignments)
- Go to definition and go to type definition
- Find all references and rename
- Document symbols and workspace symbols
- Document highlights and folding ranges
- Completions and signature help for parameterized assignments
- Conservative document formatting
- Selection ranges
- Diagnostics (duplicate / unused / undefined symbols, malformed OIDs, times,
  strings, `COMPONENTS OF`, …)
- Code actions: remove unused or duplicate imports

Syntax highlighting, snippets, and language configuration remain editor-client
concerns.

## Configuration

Pass these as `initializationOptions` and/or `asn1.*` settings via
`workspace/didChangeConfiguration`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `includeFiles` | `**/*.{asn,asn1}` | Glob of ASN.1 files to index |
| `excludeFiles` | `**/{node_modules,dist,out,build,.git}/**` | Glob to skip while indexing |
| `enableDiagnostics` | `true` | Master diagnostics switch |
| `strictModuleOidMatch` | `true` | Match imported modules by OID (WITH SUCCESSORS / DESCENDANTS) |
| `maxLineLength` | unset (formatter uses 80) | Preferred wrap length for formatting |
| `alwaysDefined` | `[]` | Identifiers to treat as defined |

A first line containing `no_diagnose` (for example `-- no_diagnose`) disables
diagnostics for that file except a reminder warning.

## Development

```sh
deno task check
deno task test
deno task compile
```

## Publishing

CI runs `deno task check` and `deno task test` on every push to `master` and on
pull requests.

Creating a GitHub Release compiles platform binaries, uploads them as release
assets, and runs `deno publish` to [JSR](https://jsr.io/@wildboar/asn1-lsp).

The `version` field in `deno.json` **must match the GitHub Release tag** (for
example tag `1.0.0` with `"version": "1.0.0"`). JSR does not use a `v` prefix, so
prefer tags without one.

Before the first publish, link this GitHub repository to the JSR package on
[jsr.io](https://jsr.io) so OIDC (`id-token`) publishing succeeds.
