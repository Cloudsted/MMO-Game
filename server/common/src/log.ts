/** Optional in-process sink (the master's admin panel tails its own logs). */
export const logSink: { push: ((line: string) => void) | null } = { push: null };

/** Tiny prefixed logger — one format across master/shard/roomhost processes. */
export function makeLogger(prefix: string) {
  const stamp = () => new Date().toISOString().slice(11, 23);
  const fmt = (level: string, args: unknown[]) =>
    `${stamp()} [${prefix}]${level} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`;
  return {
    info: (...args: unknown[]) => {
      console.log(`${stamp()} [${prefix}]`, ...args);
      logSink.push?.(fmt("", args));
    },
    warn: (...args: unknown[]) => {
      console.warn(`${stamp()} [${prefix}] WARN`, ...args);
      logSink.push?.(fmt(" WARN", args));
    },
    error: (...args: unknown[]) => {
      console.error(`${stamp()} [${prefix}] ERROR`, ...args);
      logSink.push?.(fmt(" ERROR", args));
    },
  };
}
export type Logger = ReturnType<typeof makeLogger>;
