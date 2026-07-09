/**
 * GOLDEN-HASH WORLDGEN DETERMINISM NET (world-redesign batch 0).
 *
 * Every room def in shared/rooms/*.json is generated cold — a fresh
 * `new VoxelWorld(def)` is the pristine world: seeded fbm terrain + biome
 * branches + authored builders/setpieces (voxelstructures.ts) + prefab
 * scatter (prefabs.ts), with zero player edits — and its content hash is
 * locked against the GOLDEN table below. Any drift in the noise fns, biome
 * branches, authored structures, prefab catalog/scatter, block registry ids,
 * or the room JSON itself trips this file room-by-room, so an accidental
 * worldgen change is caught the moment it lands, not three retunes later.
 *
 * Two hashes per room (sha1, native crypto — the full 480² rooms hash in
 * milliseconds; generation dominates):
 *   grid:     sha1 over "<w>x<WORLD_HEIGHT>x<h>:" + the raw block bytes.
 *             Catches every block-level change, prefab stamps included.
 *   features: sha1 over JSON.stringify(world.features) (ScatterResult:
 *             placements / caches / bindings / extraTables / underfill).
 *             Catches gameplay drift that never moves a block (a cache
 *             table swap, a binding recenter, a scatter-count change).
 *
 * ── UPDATE PROCEDURE (only when a room is INTENTIONALLY changed) ─────────
 *  1. Make the intended worldgen/content change.
 *  2. Run this file in update mode — it prints a ready-to-paste GOLDEN
 *     table and skips the assertions:
 *       bash:        GOLDEN_UPDATE=1 npx vitest run server/shard/test/goldenhash.test.ts
 *       PowerShell:  $env:GOLDEN_UPDATE="1"; npx vitest run server/shard/test/goldenhash.test.ts; Remove-Item Env:\GOLDEN_UPDATE
 *  3. Paste the printed table over the GOLDEN constant below. Only the
 *     rooms you touched should have changed — if an unrelated room's hash
 *     moved, that is a BUG you just caught, not a hash to update.
 *  4. Re-run without the flag (must be green) and commit the new hashes in
 *     the SAME commit as the worldgen change, saying why in the message.
 *  Never update a hash you can't explain.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadRoomDefs, WORLD_HEIGHT } from "@fantasy-mmo/common";
import { VoxelWorld } from "../src/sim/voxel.js";

const UPDATE = process.env.GOLDEN_UPDATE === "1";

/** Golden content hashes per room — see the update procedure above.
 *  (Recorded 2026-07-09 on branch world-redesign, pre-retune baseline.
 *  atelier/dungeon/grounds/hub share a features hash: it is the hash of
 *  the EMPTY ScatterResult — those rooms have no prefab scatter.) */
const GOLDEN: Record<string, { grid: string; features: string }> = {
  atelier: { grid: "a5a2f7b6d3f36a836370c123b136e9db477cda33", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  cinderrift: { grid: "2b4c4d47c3b429445b7a6f8933414a435255e14c", features: "dc3d9ec84ab63088664776590ba7adf44645df85" },
  crypt_depths: { grid: "4ebd017459a67adce7a64d2a4470bf377353f290", features: "2f8b38a89da3d19331960f0781803646b57af960" },
  desert: { grid: "419659cde8bca7d34a0ad9f17107936702b70418", features: "ff2765cd53d266b5947d97e3b7a7870478b4ffe5" },
  dungeon: { grid: "ca34988c68a1b7720ef8bcaeda7c6f835fd1d9ec", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  forest: { grid: "f7af9d8a1d07fc8fe8e553f7b1b64ce6e313577b", features: "6beee38ddb6103982547f057200e8aaed0c11bd4" },
  gloomfen: { grid: "5802ef6c1b976fe379cffee154e0317c8fa1a797", features: "986429b8853b04c7dd3a5dc6c6c37572f0201e1f" },
  grounds: { grid: "493920fcf3e0e14da80e2661dca4cf63dbcc7b14", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  hub: { grid: "0c0e507495eb48b4bf31e8b2e5f4513379f3e9e3", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  sundered_city: { grid: "f9aa6be274d3df42ec21b9d6c82e8874f785399f", features: "67b6fc85e01e5fd79bd0760c5934500893c40ac2" },
};

function hashRoom(world: VoxelWorld): { grid: string; features: string } {
  const grid = createHash("sha1")
    .update(`${world.w}x${WORLD_HEIGHT}x${world.h}:`)
    .update(world.data)
    .digest("hex");
  const features = createHash("sha1").update(JSON.stringify(world.features)).digest("hex");
  return { grid, features };
}

const rooms = [...loadRoomDefs().values()].sort((a, b) => a.id.localeCompare(b.id));

describe("golden-hash worldgen determinism", () => {
  const computed = new Map<string, { grid: string; features: string }>();

  it("has a golden entry for every room def, and no stale entries", () => {
    if (UPDATE) return; // a brand-new room has no golden yet — let the print run
    expect(rooms.map((r) => r.id)).toEqual(Object.keys(GOLDEN).sort());
  });

  for (const def of rooms) {
    it(`${def.id} (${def.size.w}x${def.size.h}) generates its golden world`, () => {
      const got = hashRoom(new VoxelWorld(def));
      computed.set(def.id, got);
      if (UPDATE) return;
      const want = GOLDEN[def.id];
      expect(want, `${def.id}: no golden recorded — run the update procedure`).toBeDefined();
      expect(got.grid, `${def.id}: BLOCK GRID drifted from golden`).toBe(want!.grid);
      expect(got.features, `${def.id}: gen FEATURES drifted from golden`).toBe(want!.features);
    });
  }

  afterAll(() => {
    if (!UPDATE) return;
    const lines = [...computed.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, h]) => `  ${id}: { grid: "${h.grid}", features: "${h.features}" },`);
    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "GOLDEN_UPDATE — paste this over the GOLDEN constant in goldenhash.test.ts:",
        "",
        "const GOLDEN: Record<string, { grid: string; features: string }> = {",
        ...lines,
        "};",
        "",
      ].join("\n"),
    );
  });
});
