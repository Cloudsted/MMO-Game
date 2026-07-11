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
 *  broken_court grid updated + the NEW white_waste entry added 2026-07-10
 *  for batch 8 (THE WHITE WASTE): the breach's dead-end collapse became the
 *  torn-open portal chamber (sky shaft + the court-waste arch + a regraded
 *  climb); broken_court FEATURES held (its treasury cache is unchanged —
 *  the waste's two cache_royal wings live in the NEW entry). Every other
 *  room held byte-identical.
 *
 *  ═══ 2026-07-10 BATCH 9 — THE ONE LEGITIMATE MASS GOLDEN_UPDATE ═══════════
 *  The NATURAL PORTAL ARCH restyle (owner canon rule 1, deferred since day
 *  one: arches are weathered rock + blue-crystal glints, not masonry —
 *  voxelstructures.ts portalArch) touches the auto-stamped arch at EVERY
 *  portal, so EVERY portal-bearing room's GRID hash moved in one recorded
 *  sweep. The verification that this update hides nothing else:
 *    · atelier (the only room with NO portals) is BYTE-IDENTICAL — grid AND
 *      features — proving the sweep is the arch change and only the arch
 *      change (plus grounds, which also took the batch-9 Freehold dressing:
 *      boundary fence + notice board + claim-stone).
 *    · every room's FEATURES hash HELD (scatter/caches/bindings run before
 *      arches and don't read arch blocks).
 *    · the arch's SOLID volume is cell-identical to the old masonry arch, so
 *      every BFS/pairing/apron/reachability test passed UNMODIFIED.
 *  Do not cite this entry as precedent for updating hashes you can't
 *  explain room-by-room — its legitimacy IS the atelier/features control.
 *  ══════════════════════════════════════════════════════════════════════════
 *
 *  forest grid+features updated 2026-07-11 (owner batch): the `forest-march`
 *  portal moved out of the north pond — (240,30) → (248,22), the dry shelf on
 *  the pond's NE shore. The old arch stood IN the water (its clearAbove cut a
 *  hole in the pond surface and its apron painted the pond floor); the move
 *  restores the pond byte-for-byte from pristine gen. Features moved because
 *  the wayshrine `nearPortals` scatter re-dealt around the new portal. Every
 *  other room held byte-identical.
 *
 *  desert GRID updated 2026-07-11 (owner: "the sunscour temple is far too
 *  dark"): authored light in the Colossus tomb — stair/approach/robbers'-
 *  corridor lantern niches, the landing brazier, two grave-goods braziers in
 *  the Hall, four vigil braziers on the Vessel's canopic pylons
 *  (setpieces_desert.ts PHASE 4). Desert FEATURES held (scatter runs before
 *  the setpieces and reads none of this); every other room held
 *  byte-identical. The same batch's per-cell light OVERRIDES are not part of
 *  either hash — they golden-lock separately in lightoverrides.test.ts.
 *
 *  atelier/dungeon/grounds/hub/maw
 *  share a features hash: it is the hash of the EMPTY ScatterResult — no
 *  prefab scatter. greenhood_run has no scatter either, but its authored
 *  caches ride the features handle, so its hash differs.) */
const GOLDEN: Record<string, { grid: string; features: string }> = {
  atelier: { grid: "a5a2f7b6d3f36a836370c123b136e9db477cda33", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  broken_court: { grid: "11488a7bc783bad4eba322569a31c3408f3dc0e7", features: "35d68df7bb65002ec459140d1219f1548baff40e" },
  cinderrift: { grid: "bd598f680867da26b0de536cb97614a301ef5a15", features: "64fd739a989b4a5014c437d9e235aa6c81726653" },
  crypt_depths: { grid: "e53667d642d3ad6d14815ab2d2a6e5216def3160", features: "2f8b38a89da3d19331960f0781803646b57af960" },
  desert: { grid: "06b5983305775e6c334c4474cc8a5a1981368e2a", features: "f908e575dd8e4b5f1fea511bc7a034d1a02ccb55" },
  dungeon: { grid: "d877dc5637398046bc6f4cf37c3384a366cb09ee", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  emberfells: { grid: "21b8a45d7b87817dd6fda1e849c0dbbd18cbfd31", features: "4608f78baf0ca48c66686e051d638693a41ce3aa" },
  forest: { grid: "c36932511aafaf66411fad21f5f69b1a291f5cf3", features: "a47bee9c0f2ddbd79ada1036eea64dc47869856e" },
  foundry: { grid: "3c97b4804675e8666fd54d9a9223098eef5a0532", features: "6c4725467c0187a91bc129fdddf81b885bc8b3db" },
  gloomfen: { grid: "1030b99171288f0055cce414b32e9f3ccbdb2d7f", features: "986429b8853b04c7dd3a5dc6c6c37572f0201e1f" },
  greenhood_run: { grid: "e9b2f22aeea06e8188a712f7412ccb5339bf1409", features: "3d75f2e784f6244c6660eba46e1709d9b4836f29" },
  grounds: { grid: "b693aefd61e55f4d226e8106ff22f4a90741be62", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  hub: { grid: "9f57c806ca659d139eaf61123e7c0246ce0ad09a", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  maw: { grid: "436940f9ea5cc907647163fc3b29ea1a526b6d3f", features: "133eeb0e39c4eb2c448227e0e45b28ae450ac744" },
  ossuary_galleries: { grid: "f4ebafffc7bb061bd10acc81ae5c391f59652245", features: "5024f7cc83d4530fd86438cdea1fd188a55473b0" },
  stranglers_march: { grid: "713f923b346674b4b5cf67778204f307a039d9d8", features: "e9737c696504c7800346841a71b1a234b1a61134" },
  sundered_city: { grid: "52f369e17fc0db469e8b2c4241ddde7415ad8dc6", features: "bf6a11e455e64f48a5650907e6b6ee9dbba02aca" },
  sundering_fields: { grid: "e887f73bf37cab682198d7ff51eef5d13079dd94", features: "450d747d7d4032586dc92699a8b1bc289ce1be3b" },
  white_waste: { grid: "0c229fcdaabb032ee2e6b947ff212b0606a678d4", features: "ceda4a5d28bc4038b72c26f109d40b1e43b43d79" },
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
