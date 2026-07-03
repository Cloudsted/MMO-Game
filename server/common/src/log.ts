/** Tiny prefixed logger — one format across master/shard/roomhost processes. */
export function makeLogger(prefix: string) {
  const stamp = () => new Date().toISOString().slice(11, 23);
  return {
    info: (...args: unknown[]) => console.log(`${stamp()} [${prefix}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`${stamp()} [${prefix}] WARN`, ...args),
    error: (...args: unknown[]) => console.error(`${stamp()} [${prefix}] ERROR`, ...args),
  };
}
export type Logger = ReturnType<typeof makeLogger>;
