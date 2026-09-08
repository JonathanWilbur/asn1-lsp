/**
 * Language-server log sink.
 *
 * Messages go to stderr by default. The LSP server can attach a listener to
 * forward them as `window/logMessage`.
 *
 * @module
 */

type LogListener = (message: string) => void;

let listener: LogListener | undefined;

/**
 * Attach a listener that receives every log line.
 */
export function setLogListener(fn: LogListener | undefined): void {
    listener = fn;
}

/**
 * The log for this language server.
 */
export const log = {
    /**
     * Append a line to the log.
     */
    appendLine(message: string): void {
        const line = String(message);
        console.error(line);
        listener?.(line);
    },
};

export default log;
