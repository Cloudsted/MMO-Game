/**
 * Prefab catalog, tier 1 (design doc `docs/content-design-2.md` §7).
 *
 * These modules exist so that the catalog can grow without `prefabs.ts` — the
 * engine (types, stampPrefab, the scatter placer) — growing with it. They
 * import `PrefabDef` as a TYPE ONLY, so there is no runtime module cycle:
 * prefabs.ts imports these at runtime, and nothing here imports it back.
 *
 * Every build() is deterministic: `ctx.rand(salt)` (hash2 over the room seed),
 * never Math.random. Use `ctx.plate` / `ctx.fill` / `ctx.set` — never
 * `ctx.b.*` for geometry, because Builder is world-space and would ignore the
 * placement rotation.
 */
import type { PrefabDef } from "./prefabs.js";
export declare const TIER1: PrefabDef[];
//# sourceMappingURL=prefabs.tier1.d.ts.map