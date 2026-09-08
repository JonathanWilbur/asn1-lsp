/**
 * ASN.1 language-server configuration.
 */
export interface Asn1Config {
    /**
     * Glob matching ASN.1 files in this workspace.
     */
    includeFiles: string;
    /**
     * Glob matching files to exclude from indexing.
     */
    excludeFiles: string;
    /**
     * Enable diagnostics for ASN.1 files.
     */
    enableDiagnostics: boolean;
    /**
     * Match modules strictly by OID, respecting WITH SUCCESSORS and WITH DESCENDANTS.
     */
    strictModuleOidMatch: boolean;
    /**
     * Maximum preferred line length, used in formatting.
     */
    maxLineLength?: number;
    /**
     * Identifiers to always treat as defined.
     */
    alwaysDefined: string[];
}

/**
 * Default ASN.1 language-server configuration.
 */
export const defaultAsn1Config: Asn1Config = {
    includeFiles: "**/*.{asn,asn1}",
    excludeFiles: "**/{node_modules,dist,out,build,.git}/**",
    enableDiagnostics: true,
    strictModuleOidMatch: true,
    alwaysDefined: [],
};

/**
 * Merge a partial configuration over the defaults.
 */
export function mergeAsn1Config(
    partial?: Partial<Asn1Config> | Record<string, unknown>,
): Asn1Config {
    const src = partial ?? {};
    const alwaysDefined = Array.isArray((src as Asn1Config).alwaysDefined)
        ? [...(src as Asn1Config).alwaysDefined]
        : [...defaultAsn1Config.alwaysDefined];
    return {
        includeFiles: typeof src.includeFiles === "string"
            ? src.includeFiles
            : defaultAsn1Config.includeFiles,
        excludeFiles: typeof src.excludeFiles === "string"
            ? src.excludeFiles
            : defaultAsn1Config.excludeFiles,
        enableDiagnostics: typeof src.enableDiagnostics === "boolean"
            ? src.enableDiagnostics
            : defaultAsn1Config.enableDiagnostics,
        strictModuleOidMatch: typeof src.strictModuleOidMatch === "boolean"
            ? src.strictModuleOidMatch
            : defaultAsn1Config.strictModuleOidMatch,
        maxLineLength: typeof src.maxLineLength === "number"
            ? src.maxLineLength
            : defaultAsn1Config.maxLineLength,
        alwaysDefined,
    };
}
