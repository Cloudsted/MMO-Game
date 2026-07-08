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
 *
 * These seven are the ones the document leans on. Read in decay order across a
 * room, they tell the room's story before an NPC opens their mouth: the ward
 * somebody sabotaged from the inside, the lamps that went out one by one, the
 * soldier nobody ever relieved, the door to a district under forty feet of
 * sand, the hole they dug looking for water and found fire in, the ring where
 * eight of nine seals still hold — and the one man out here who is fine.
 */
import type { PrefabDef } from "./prefabs.js";
export declare const TIER1: PrefabDef[];
//# sourceMappingURL=prefabs.tier1.d.ts.map