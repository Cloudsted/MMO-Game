/** Optional in-process sink (the master's admin panel tails its own logs). */
export declare const logSink: {
    push: ((line: string) => void) | null;
};
/** Tiny prefixed logger — one format across master/shard/roomhost processes. */
export declare function makeLogger(prefix: string): {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};
export type Logger = ReturnType<typeof makeLogger>;
//# sourceMappingURL=log.d.ts.map