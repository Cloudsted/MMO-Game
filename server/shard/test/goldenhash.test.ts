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
 *  hub updated 2026-07-09 for the GREYWATCH authored rebuild (batch 1b).
 *  desert grid+features and the NEW maw entry updated 2026-07-09 for
 *  batch 2 (THE MAW). forest grid+features and the NEW greenhood_run entry
 *  updated 2026-07-09 for batch 3 (THE GREENHOOD RUN): the bandit_fort
 *  left the scatter pool for a fixed anchor at (308,148) + portal yard +
 *  climb-out mound, which deterministically re-dealt the forest scatter;
 *  every other room stayed byte-identical. forest grid updated + the NEW
 *  stranglers_march entry added 2026-07-09 for batch 4 (THE STRANGLER'S
 *  MARCH): the climb-out mound left the forest north (it moved into the
 *  march west with the greenhood-out re-point) — forest FEATURES held (no
 *  scatter candidate had ever landed in the dropped exclusion rect), and
 *  gloomfen/greenhood_run held (their portal retargets are data-only).
 *  NEW emberfells + ossuary_galleries entries added 2026-07-09 for batch 5
 *  (the desert⇄cinderrift and crypt⇄depths splices): every other room held
 *  byte-identical — the four spliced rooms' changes are DATA-ONLY (portal
 *  retargets at the same coordinates, level overrides, the dungeon's
 *  persistence flip). sundered_city grid+features updated + the NEW
 *  broken_court entry added 2026-07-09 for batch 6 (THE BROKEN COURT
 *  SPLIT): the keep's throne interior became the court gatehouse (crosswall
 *  + forced portcullis + court-gate arch + roof breach + the mountain
 *  glimpse massif; the treasury cache moved out with the throne room), and
 *  the court is a new 96² preset; every other room held byte-identical.
 *  NEW sundering_fields + foundry entries added 2026-07-10 for batch 7 (the
 *  graph's final reconnections), plus three documented deltas: cinderrift
 *  grid+FEATURES (the new sealed cinderrift-foundry portal behind the Forge
 *  Ruin — the arch + bone-road spur moved the grid, and the nearPortals
 *  wayshrine scatter re-dealt around the new portal, which moves features),
 *  crypt_depths grid (the torn far-gate arch + rope tableau beside the
 *  dais; features held), and sundered_city grid (the collapsed-postern
 *  escape landing in the graveyard quarter; features held). gloomfen held
 *  byte-identical — its re-targets are data-only.
 *  atelier/dungeon/grounds/hub/maw
 *  share a features hash: it is the hash of the EMPTY ScatterResult — no
 *  prefab scatter. greenhood_run has no scatter either, but its authored
 *  caches ride the features handle, so its hash differs.) */
const GOLDEN: Record<string, { grid: string; features: string }> = {
  atelier: { grid: "a5a2f7b6d3f36a836370c123b136e9db477cda33", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  broken_court: { grid: "9ecceac6c38d882d925cca023f230f6c2050ceaa", features: "35d68df7bb65002ec459140d1219f1548baff40e" },
  cinderrift: { grid: "3f559fbb5131ec058becb54bdb2c4ff5fbaf265e", features: "64fd739a989b4a5014c437d9e235aa6c81726653" },
  crypt_depths: { grid: "4ebf6b0f596bb8fba7690bb48aec26cc6f393213", features: "2f8b38a89da3d19331960f0781803646b57af960" },
  desert: { grid: "aff409b0bd4eec1683fd5e8b1163268d045ebe1a", features: "f908e575dd8e4b5f1fea511bc7a034d1a02ccb55" },
  dungeon: { grid: "ca34988c68a1b7720ef8bcaeda7c6f835fd1d9ec", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  emberfells: { grid: "1d958a3c423a87ccfee68c2f0a42f86088ba17fd", features: "4608f78baf0ca48c66686e051d638693a41ce3aa" },
  forest: { grid: "ebadbef57df8650f9f564bcf2632c8190ce8b6dd", features: "4ce7137d3ce38a1e7f0981d8342b2f57b3060ed4" },
  foundry: { grid: "7aff669f1a485d8cb718ddf625581d8ef205f8d1", features: "6c4725467c0187a91bc129fdddf81b885bc8b3db" },
  gloomfen: { grid: "5802ef6c1b976fe379cffee154e0317c8fa1a797", features: "986429b8853b04c7dd3a5dc6c6c37572f0201e1f" },
  greenhood_run: { grid: "6892ee8672400bd3f7f41b11959d9f9ab3165cb4", features: "3d75f2e784f6244c6660eba46e1709d9b4836f29" },
  grounds: { grid: "493920fcf3e0e14da80e2661dca4cf63dbcc7b14", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  hub: { grid: "4064b6b1c8ad30e642ba19a2d150fb5d2174345b", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  maw: { grid: "75b9919c5b5493a24bc0fcd6295950063edc63be", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  ossuary_galleries: { grid: "93449a63b6693ded27ebf70ca746a35fde76a247", features: "5024f7cc83d4530fd86438cdea1fd188a55473b0" },
  stranglers_march: { grid: "0e82fe8cd0cc9cd0d28406e0e0a2aff14d8ec3e7", features: "e9737c696504c7800346841a71b1a234b1a61134" },
  sundered_city: { grid: "cbbb29c3b2ba66a949be8f3cf1e7a1668dd4a953", features: "bf6a11e455e64f48a5650907e6b6ee9dbba02aca" },
  sundering_fields: { grid: "b1056c9c6aeecb85da195bd857e577e6e9b2a711", features: "450d747d7d4032586dc92699a8b1bc289ce1be3b" },
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
