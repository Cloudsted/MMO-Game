/**
 * Prefab catalog, tier 3 (design doc `docs/content-design-2.md` §7).
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
 *
 * Tier 3 is the tier about CONTAINERS THAT FAILED. A charnel pit that was
 * never filled. A gaol with one empty cell. A grate cut from the inside. A
 * gibbet whose cage came down. A funeral that drifted. A barge that sank with
 * one hand still on the tiller. A strongbox that ended up inside a nest.
 * Six of the seven can be looted; the seventh is a warning, and warnings are
 * not paid for.
 */
import type { PrefabDef } from "./prefabs.js";
export declare const TIER3: PrefabDef[];
//# sourceMappingURL=prefabs.tier3.d.ts.map