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

export const TIER3: PrefabDef[] = [];

/** Rooms that flood in murk; everything else drowns in plain water. Never lava
 *  — none of these prefabs survives being filled with it, and a scatter entry
 *  in the Cinderrift should not be able to make one silently. */
const floodBlock = (biome: string): string => (biome === "swamp" ? "murk_water" : "water");

// ---------------------------------------------------------------------------
// charnel_scaffold — crypt_depths, the Sundered City chapel quarter
// ---------------------------------------------------------------------------
// CACHE TIER: this prefab hardcodes `cache_crypt` (T3 — rift weapons, EV ~282),
// so it may ONLY go in rooms whose own loot tier is T3+. crypt_depths (L12-15)
// and sundered_city (L13-18, slightly under-tier but the same rift pool) both
// qualify. It was originally authored for the `dungeon` room too — DON'T:
// dungeon is L1-10 (its own cache is `cache_dungeon`, weapons_fine ceiling), so
// cache_crypt there injects T3 gear into a level-2 room. That is the exact
// "copied a loot table, copied its tier" trap in LESSONS.md.
// WHO. Whoever the vaults belonged to had more dead than ground.
// WHAT HAPPENED. They dug a pit, built a deck over it, and lowered the dead
//   through a hole in the deck on two chains.
// WHAT'S LEFT. The chains. The hole. The heap. And the fact that the pit is
//   NOT FULL — they stopped, mid-work, with room to spare.
//
// The cache lies at the bottom of the pit under the hole (local y = -3). This
// session's pickup range is 3-D, which means the only way to take it is to go
// down the bone ramp and stand among them. The story and the mechanic are the
// same object. The ladder up to the deck is gone; somebody took it.
TIER3.push({
  id: "charnel_scaffold",
  footprint: { w: 7, d: 7 },
  anchor: "flatten",
  clearance: 12,
  maxSlope: 3,
  floor: "crypt_slate",
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    // Pit floor. digFloorY clamps off bedrock; every room this prefab is
    // authored for sits at groundY >= 12, so PF is always exactly G-4 and the
    // cache hook's local y = -3 lands one block above it.
    const PF = ctx.digFloorY(4);

    // --- the pit: 5x5, four deep, walls left as the flattened ground -------
    ctx.fill(1, PF + 1, 1, 5, G, 5, 0);
    ctx.fill(1, PF, 1, 5, PF, 5, "crypt_slate");

    // --- the heap. Bone layers above the pit floor, per cell (lz rows, lx
    // cols, both 1..5). It is a mound shovelled against the walls, and one
    // arm of it happens to make a stair: (5,5) -> (5,4) -> (4,4) -> (4,3) ->
    // the cache at (3,3). Each tread is exactly one block, which is one jump.
    const HEAP: number[][] = [
      [3, 3, 2, 3, 3],
      [3, 2, 1, 2, 3],
      [2, 1, 0, 0, 3],
      [3, 2, 1, 1, 2],
      [3, 3, 2, 2, 3],
    ];
    const RAMP = new Set(["5,5", "5,4", "4,4", "4,3", "3,3"]);
    for (let lz = 1; lz <= 5; lz++) {
      for (let lx = 1; lx <= 5; lx++) {
        const k = HEAP[lz - 1]![lx - 1]!;
        if (k > 0) ctx.fill(lx, PF + 1, lz, lx, PF + k, lz, "bone_block");
        // skulls ride the high heaps; never on the ramp, never on the cache
        if (k >= 2 && !RAMP.has(`${lx},${lz}`) && ctx.rand(lx * 19 + lz) < 0.45) {
          ctx.set(lx, PF + k + 1, lz, "skull_pile");
        }
      }
    }

    // --- the scaffold: pale_log posts, a temple_boards deck, one 1x1 hole --
    for (const [lx, lz] of [
      [0, 0],
      [6, 0],
      [0, 6],
      [6, 6],
      [3, 0],
      [3, 6],
      [0, 3],
      [6, 3],
    ] as const) {
      ctx.fill(lx, G + 1, lz, lx, G + 3, lz, "pale_log");
    }
    ctx.fill(0, G + 4, 0, 6, G + 4, 6, "temple_boards");
    ctx.set(3, G + 4, 3, 0); // the hole they lowered them through

    // --- two chains, three blocks long, ending in air over the heap --------
    for (const lx of [2, 4]) ctx.fill(lx, G + 1, 3, lx, G + 3, 3, "chain");

    // --- decay: the deck goes first, then a post ---------------------------
    if (ctx.ruinLevel >= 1) {
      for (let lz = 0; lz <= 6; lz++) {
        for (let lx = 0; lx <= 6; lx++) {
          if (ctx.rand(300 + lx * 7 + lz) < 0.12 * ctx.ruinLevel) ctx.set(lx, G + 4, lz, 0);
        }
      }
    }
    if (ctx.ruinLevel === 2) {
      ctx.fill(0, G + 1, 6, 0, G + 3, 6, 0); // the corner post let go
      ctx.set(0, G + 1, 5, "pale_log"); // and lies where it fell
      ctx.set(0, G + 1, 4, "pale_log");
      ctx.set(1, G, 1, "temple_boards"); // a deck board in the bones
    }
    // No light. Nobody has been down here since they stopped counting.
  },
  // "auto" would resolve to cache_forest in crypt_depths (no cache_crypt_depths
  // table exists) — a level-2 payout in a level-15 room. Named explicitly.
  hooks: { lootCache: { local: [3, -3, 3], table: "cache_crypt", respawnSec: 540 } },
});

// ---------------------------------------------------------------------------
// sunken_gaol — gloomfen, dungeon
// ---------------------------------------------------------------------------
// CACHE TIER: `table: "auto"` resolves to cache_<roomId>, so this is in-tier
// wherever such a table exists: gloomfen → cache_gloomfen (T2), dungeon →
// cache_dungeon (T1.5). It was authored for crypt_depths too — DON'T place it
// there until a `cache_crypt_depths` table exists: crypt_depths has no
// cache_<roomId>, so resolveCacheTable() silently falls back to cache_forest,
// dropping a rusty-sword (EV ~52) payout at the bottom of a level-15 crypt.
// (charnel_scaffold covers the crypt with its own T3 cache_crypt.)
// WHO. Somebody with the authority to keep six people in the dark.
// WHAT HAPPENED. The water came up one block and stayed.
// WHAT'S LEFT. Five prisoners you can look at and cannot reach, one cell that
//   is open, and a brazier burning behind a locked door with nobody under it.
//
// GEOMETRY REWRITTEN (the doc's proposal contradicted itself and overran its
// own 13-wide footprint). Chosen shape: 13 x 17.
//   lx  0 wall | 1-3 west cells | 4 wall+doors | 5-7 corridor | 8 wall+doors |
//       9-11 east cells | 12 wall
//   lz  0 wall+entrance | 1 · 2-4 cells · 5 · 6-8 cells · 9 · 10-12 cells ·
//       13 wall + the locked guard door | 14-15 guardroom | 16 wall
// The corridor and every cell are dug ONE block down and flooded: the player
// walks dry on the temple_boards catwalk at lx=6 while anything chasing them
// wades at knee height beside it (the shipped purposeful-wade behaviour, used
// as level design). Cell 3 — west, lz 6-8 — is the open one: its bar lies in
// the corridor where you step on it, and its chain is one block short and ends
// in nothing.
TIER3.push({
  id: "sunken_gaol",
  footprint: { w: 13, d: 17 },
  anchor: "flatten",
  clearance: 12,
  maxSlope: 3,
  floor: "dungeon_masonry",
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const LIQ = floodBlock(ctx.def.biome);
    const WALL = "dungeon_masonry";

    // solid mass, then carve — nothing can leak outside a fill we already own
    ctx.fill(0, G + 1, 0, 12, G + 4, 16, WALL);
    ctx.fill(0, G + 5, 0, 12, G + 5, 16, "crypt_slate");

    // corridor + guardroom voids
    ctx.fill(5, G + 1, 1, 7, G + 4, 12, 0);
    ctx.fill(1, G + 1, 14, 11, G + 4, 15, 0);
    ctx.fill(6, G + 1, 0, 6, G + 3, 0, 0); // the way in

    // flood the corridor one block deep, then lay the catwalk down its spine
    ctx.fill(5, G - 1, 1, 7, G - 1, 12, WALL);
    ctx.fill(5, G, 1, 7, G, 12, LIQ);
    ctx.fill(6, G, 0, 6, G, 12, "temple_boards");

    // six cells: [back column, doorway column, z0]. Cell 3 (index 2) is open.
    const CELLS: Array<[number, number, number]> = [
      [1, 4, 2],
      [11, 8, 2],
      [1, 4, 6], // cell 3 — the empty one
      [11, 8, 6],
      [1, 4, 10],
      [11, 8, 10],
    ];
    CELLS.forEach(([back, door, z0], i) => {
      const x0 = back === 1 ? 1 : 9;
      const x1 = back === 1 ? 3 : 11;
      const cz = z0 + 1;
      const open = i === 2;
      ctx.fill(x0, G + 1, z0, x1, G + 4, z0 + 2, 0);
      ctx.fill(x0, G - 1, z0, x1, G - 1, z0 + 2, WALL);
      ctx.fill(x0, G, z0, x1, G, z0 + 2, LIQ);
      // the straw is the only dry thing in the cell. In the barred cells it is
      // heaped at the back, under the prisoner. In the ONE open cell it is at
      // the doorway end (the interior column nearest the corridor) — that is
      // where the freed prisoner slept and where the cache now sits, a full
      // cell-depth in from the exterior wall so it can't be looted through it.
      const hayX = open ? (door > back ? x1 : x0) : back;
      ctx.fill(hayX, G, z0, hayX, G, z0 + 2, "hay");
      // door: barred, unless this is the cell that opened
      ctx.fill(door, G + 1, cz, door, G + 3, cz, open ? 0 : "iron_bars");
      // chain from the ceiling. Three blocks — except cell 3, whose chain is
      // one block short and ends in nothing at all.
      ctx.fill(back, open ? G + 3 : G + 2, cz, back, G + 4, cz, "chain");
      if (!open) ctx.set(back, G + 1, cz, "skull_pile"); // and the prisoner
    });

    // the bar itself, lying in the corridor water where they dropped it. You
    // step on it to cross. It is the only reason the open cell is reachable.
    ctx.set(5, G, 7, "iron_bars");

    // the guardroom: locked from the corridor, lit, and empty
    ctx.fill(6, G + 1, 13, 6, G + 3, 13, "iron_bars");
    ctx.set(6, G + 1, 15, "brazier");
    ctx.set(3, G + 1, 14, "planks");
    ctx.set(9, G + 1, 14, "planks");
    ctx.set(2, G + 1, 15, "hay");

    // decay opens the roof over the corridor and drops masonry into the water
    if (ctx.ruinLevel >= 1) {
      for (let lz = 1; lz <= 12; lz++) {
        for (let lx = 5; lx <= 7; lx++) {
          if (ctx.rand(400 + lx * 13 + lz) < 0.09 * ctx.ruinLevel) ctx.set(lx, G + 5, lz, 0);
        }
      }
    }
    if (ctx.ruinLevel === 2) {
      for (let lz = 1; lz <= 12; lz++) {
        if (lz === 7) continue; // never bury the bar
        for (const lx of [5, 7]) {
          if (ctx.rand(500 + lx * 11 + lz) < 0.22) ctx.set(lx, G, lz, "rubble");
        }
      }
    }
  },
  hooks: {
    // the only cell you can walk into is the only one with nothing in it —
    // whatever cell 3 held, it left this behind. The bag sits at the DOORWAY
    // end of the cell (lx 3, against the corridor), not the back column (lx 1):
    // lx 1 is one block off the exterior wall, so the bag sat exactly 2.0 m
    // from a standing pose OUTSIDE the footprint and looted straight through
    // the wall (pickup is 3-D distance, no occlusion). lx 3 is 4.0 m in — the
    // catwalk, the fallen bar and the open cell are the only way to it.
    lootCache: { local: [3, 1, 7], table: "auto", respawnSec: 480 },
    spawnRegion: { local: [6, 6], r: 8 },
  },
});

// ---------------------------------------------------------------------------
// sewer_outfall — gloomfen
// ---------------------------------------------------------------------------
// CACHE TIER: `table: "auto"` → cache_gloomfen (T2) in the Gloomfen, in-tier.
// It was authored for the Sundered City outskirts too — DON'T place it there
// until a `cache_sundered_city` table exists: sundered_city has no
// cache_<roomId>, so resolveCacheTable() silently falls back to cache_forest
// (EV ~52) in a level-13-to-18 room whose own cache is cache_royal (EV ~403).
// WHO. An engineer, a long time ago, who wanted the city's filth to go into
//   the fen and not into the city.
// WHAT HAPPENED. It worked. Then it collapsed, forty feet upstream.
// WHAT'S LEFT. A barrel vault half full of sludge, a grate with a hole in it,
//   and — behind the hole, on the wrong side, out of the rain — a lit lantern.
//
// GEOMETRY REWRITTEN (the doc's proposal lost track of its own coordinates).
// Chosen shape: 9 x 13, local +z runs INTO the bank.
//   lz 0-4  the outfall apron: a five-wide sludge pool, sunk one block
//   lz 5    the arch face, moss on its lip, roots hanging from the lintel
//   lz 5-11 the vault: sewer_brick barrel, temple_boards catwalks at lx 2 / 6
//   lz 12   the cave-in that ended the sewer's career
// The grate stands at lz=7 and is intact except for a single person-sized hole
// at lx=4: they cut it, they pushed the pieces AWAY from themselves, and the
// pieces are lying in the apron pool downstream. That is the whole argument for
// who is inside. Everything downstream of the grate is sewer_sludge and
// everything upstream of the outfall is fen — the sludge is a compass.
TIER3.push({
  id: "sewer_outfall",
  footprint: { w: 9, d: 13 },
  anchor: "flatten",
  clearance: 12,
  maxSlope: 3,
  // dry footprint, wet ring: that is what "a bank" means
  nearWater: true,
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;

    // --- the channel, sunk one block, running the whole length ------------
    ctx.fill(2, G - 1, 0, 6, G - 1, 12, "sewer_brick");
    ctx.fill(2, G, 0, 6, G, 11, "sewer_sludge");

    // --- the bank, then the vault carved out of it ------------------------
    ctx.fill(0, G + 1, 5, 8, G + 6, 12, "dirt");
    ctx.fill(2, G + 1, 5, 6, G + 3, 11, 0);
    for (const lx of [1, 7]) ctx.fill(lx, G, 5, lx, G + 3, 12, "sewer_brick");
    ctx.fill(1, G + 4, 5, 7, G + 4, 12, "sewer_brick");
    ctx.fill(1, G, 12, 7, G + 3, 12, "rubble"); // the cave-in, upstream

    // moss on the lip, roots through the lintel, moss over the whole bank
    ctx.fill(0, G + 6, 5, 8, G + 6, 12, "moss_carpet");
    ctx.fill(1, G + 5, 5, 7, G + 5, 5, "moss_carpet");
    for (let lx = 2; lx <= 6; lx++) {
      if (ctx.rand(lx * 23) < 0.7) ctx.set(lx, G + 3, 5, "roots");
    }

    // --- the catwalks, with planks missing --------------------------------
    for (const lx of [2, 6]) {
      for (let lz = 3; lz <= 11; lz++) {
        // the last two boards of both walks always hold: that is where they
        // sleep, and where they put the things they took
        const keep = lz >= 10;
        if (keep || ctx.rand(lx * 31 + lz) > 0.14 + 0.06 * ctx.ruinLevel) {
          ctx.set(lx, G, lz, "temple_boards");
        }
      }
    }

    // --- the grate. Read it top-down; the hole is at the sludge line. -----
    ctx.plate(2, G + 3, 7, "x", ["BBBBB", "BBBBB", "BB.BB", "BBSBB"], {
      B: "iron_bars",
      S: "sewer_sludge",
    });
    // and the two bars they cut out, lying downstream, on the outside. You do
    // not push a cut grate towards yourself.
    ctx.set(3, G, 3, "iron_bars");
    ctx.set(5, G, 4, "iron_bars");

    // --- theirs: a chain off the vault ceiling, a lantern, a bed, a crate --
    ctx.fill(4, G + 2, 9, 4, G + 3, 9, "chain");
    ctx.set(6, G + 2, 9, "lantern"); // lit, and on the far side of the hole
    ctx.set(6, G + 1, 10, "hay");
    if (ctx.ruinLevel < 2) ctx.set(6, G + 1, 11, "planks");
  },
  hooks: {
    // the stash, three blocks past the grate, on the boards that still hold
    // (the `keep = lz >= 10` rule preserves lz 10-11). It was at lz 11 — one
    // block off the upstream cave-in — which put it exactly 2.0 m from a
    // standing pose OUTSIDE the footprint, level with the ground behind the
    // one-block-thick rubble, and looted straight through it (pickup is 3-D
    // distance, no occlusion). lz 10 is 3.0 m from the nearest external pose,
    // so the cut grate is the only way to it.
    lootCache: { local: [2, 1, 10], table: "auto", respawnSec: 420 },
    // the apron, not the vault: they post a watch outside their own door
    spawnRegion: { local: [4, 2], r: 9 },
  },
});

// ---------------------------------------------------------------------------
// roadside_gibbet — deep forest, the Gloomfen, the approach to Valdrenn
// ---------------------------------------------------------------------------
// WHO. Two men, and the authority that hanged them at the roadside so that
//   everybody walking to market would have to look.
// WHAT HAPPENED. One cage was taken down, carefully, by somebody who wanted
//   the man in it. The other cage's chain was cut from below.
// WHAT'S LEFT. Rust frays and tapers; a blade leaves a clean gap. There are
//   two clear blocks between the chain's end and the top of the fallen cage.
//   It was done at night, by somebody who did not have a ladder.
//
// NO LOOT. A gibbet is a warning, not a prize — the same rule as wayshrine.
TIER3.push({
  id: "roadside_gibbet",
  footprint: { w: 7, d: 3 },
  anchor: "conform",
  clearance: 10,
  maxSlope: 2,
  avoidWater: true,
  build(ctx) {
    // --- the standing gibbet, lx 0..2 -------------------------------------
    const gA = ctx.g(1, 1);
    for (const lx of [0, 2]) ctx.fill(lx, ctx.g(lx, 1) + 1, 1, lx, gA + 5, 1, "pale_log");
    ctx.fill(0, gA + 6, 1, 2, gA + 6, 1, "pale_log");
    ctx.set(1, gA + 5, 1, "chain"); // one link left, and then nothing
    // ...two empty blocks (gA+4, gA+3): the cut...
    ctx.set(1, gA + 2, 1, "iron_bars"); // the cage's lid, where it landed
    ctx.set(1, gA + 1, 0, "iron_bars");
    ctx.set(1, gA + 1, 2, "iron_bars");
    ctx.set(1, gA + 1, 1, "skull_pile"); // still inside it

    // --- the taken-down gibbet, lx 4..6 -----------------------------------
    const gB = ctx.g(5, 1);
    ctx.fill(4, ctx.g(4, 1) + 1, 1, 4, gB + 5, 1, "pale_log");
    ctx.fill(6, ctx.g(6, 1) + 1, 1, 6, gB + 2, 1, "pale_log"); // snapped short
    ctx.fill(4, gB + 6, 1, 5, gB + 6, 1, "pale_log"); // the beam, snapped mid-span
    ctx.set(5, ctx.g(5, 2) + 1, 2, "pale_log"); // and the length of it, down
    ctx.set(6, ctx.g(6, 2) + 1, 2, "pale_log");
    // the chain lies coiled flat. Coiled. Somebody wound it up afterwards.
    for (const lx of [4, 5, 6]) ctx.set(lx, ctx.g(lx, 0) + 1, 0, "chain");

    // the verge of the road they wanted you to be walking on
    for (let lx = 0; lx <= 6; lx++) ctx.set(lx, ctx.g(lx, 2), 2, "path");
    if (ctx.ruinLevel >= 1) ctx.setIfAir(3, ctx.g(3, 1) + 1, 1, "tall_grass");
  },
  // no cache, no spawn region — see above
});

// ---------------------------------------------------------------------------
// raft_pyre — gloomfen, always in open murk
// ---------------------------------------------------------------------------
// WHO. Three people, and the people who loved them enough to build boats.
// WHAT HAPPENED. They were pushed out through the reeds, and the reeds closed.
// WHAT'S LEFT. Two rafts still riding, their candles still lit. The third has
//   drifted back into the reeds and gone over, and its occupant is on the
//   bottom of the fen three blocks outside his own boat. Nothing in the
//   Gloomfen stays where it was put.
//
// The cache is down there with him — the room's own cache_gloomfen: the grave
// goods and the steel blade he was sent off with, a coin for the ferryman
// among them. You are robbing a funeral. (There is no trophy-biased funeral
// table in shared/loot.json; if one is ever added — heavy on ancient_coin /
// spirit_essence / royal_seal, light on gold — point this hook at it.)
TIER3.push({
  id: "raft_pyre",
  footprint: { w: 13, d: 13 },
  anchor: "conform",
  // clearing would delete the murk this thing floats on
  noClear: true,
  // everything that matters here rides the water surface, so the fen bottom
  // underneath is allowed to be as uneven as fen bottoms are
  maxSlope: 6,
  nearWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const wl = ctx.def.terrain.waterLevel;
    const LIQ = floodBlock(ctx.def.biome);
    const surf = wl ?? G;
    const deckY = Math.max(surf, G + 1);

    const raft = (cx: number, cz: number, salt: number) => {
      ctx.fill(cx - 1, deckY, cz - 1, cx + 1, deckY, cz + 1, "rotting_planks");
      ctx.fill(cx, deckY + 1, cz - 1, cx, deckY + 3, cz - 1, "pale_log");
      ctx.set(cx, deckY + 4, cz - 1, "banner");
      ctx.set(cx, deckY + 1, cz, "bone_block");
      ctx.set(cx + (ctx.rand(salt) < 0.5 ? 1 : -1), deckY + 1, cz + 1, "bog_candle");
    };
    raft(4, 4, 1);
    raft(8, 5, 2);

    // --- the third raft: tipped, half under, one edge still in the air -----
    ctx.fill(4, deckY - 1, 9, 6, deckY - 1, 9, "rotting_planks");
    ctx.fill(4, deckY, 10, 6, deckY, 10, "rotting_planks");
    ctx.fill(4, deckY + 1, 11, 6, deckY + 1, 11, "rotting_planks");
    ctx.fill(5, deckY + 1, 12, 6, deckY + 1, 12, "pale_log"); // its mast, adrift
    ctx.set(7, deckY + 1, 12, "banner"); // tangled at the end of it
    // no bog_candle on this one; it went out when she went over

    // --- the fen bottom, three blocks off her stern ------------------------
    // Levelled deliberately: the cache hook's y is groundY-relative, so the
    // bottom under it has to BE groundY or the bag hangs inside the mud.
    ctx.fill(8, G, 9, 10, G, 11, "mud");
    ctx.fill(8, G + 1, 9, 10, deckY + 3, 11, 0);
    if (surf >= G + 1) ctx.fill(8, G + 1, 9, 10, surf, 11, LIQ);
    ctx.set(9, G + 1, 11, "bone_block"); // him

    // --- the reeds they were pushed through, closed behind them ------------
    for (let lz = 0; lz <= 12; lz++) {
      for (let lx = 0; lx <= 12; lx++) {
        const r = Math.hypot(lx - 6, lz - 6);
        if (r < 4.6 || r > 6.2) continue;
        if (ctx.rand(700 + lx * 17 + lz) < 0.62) ctx.setIfAir(lx, surf + 1, lz, "reeds");
      }
    }
  },
  hooks: { lootCache: { local: [9, 1, 10], table: "cache_gloomfen", respawnSec: 480 } },
});

// ---------------------------------------------------------------------------
// barge_wreck — gloomfen (one beached across the Drowned West Road spur)
// ---------------------------------------------------------------------------
// WHO. A bargeman, hauling something up the fen that nobody remembers.
// WHAT HAPPENED. Three ribs went amidships and the deck opened. Everything on
//   this boat went into the water.
// WHAT'S LEFT. A bone_block at the tiller, and only there. He is still
//   steering. The mast went out over the bow with the banner tangled at its
//   end, and the three snapped ribs are the only way aboard — which is also
//   the only way down into the hold, because the deck over lz 7-9 is gone and
//   you can see straight through it to the cargo.
//
// 5 x 16: the long low horizontal that the Drownbell's vertical is measured
// against. It must therefore stamp identically at rot 1 and rot 3.
TIER3.push({
  id: "barge_wreck",
  footprint: { w: 5, d: 16 },
  anchor: "conform",
  noClear: true,
  // the hull is rebuilt from the fen bottom up, so the bottom's relief is free
  maxSlope: 6,
  nearWater: true,
  build(ctx) {
    const G = ctx.groundY; // the fen bottom the hull is resting on
    const wl = ctx.def.terrain.waterLevel;
    const LIQ = floodBlock(ctx.def.biome);
    const surf = wl ?? G;
    // three clear blocks of hold, always: the cache lives at G+1 and needs a
    // free cell over its head whether the hold is flooded or dry
    const deckY = Math.max(surf, G + 3);
    // the waterline, which is where the middle rib parted and where you board
    const boardY = Math.max(surf, G + 1);

    // hollow the hull volume out of terrain and murk alike, then rebuild it
    ctx.fill(0, G + 1, 0, 4, Math.min(deckY + 4, 46), 15, 0);
    ctx.fill(0, G, 0, 4, G, 15, "pale_log"); // the bottom boards
    for (const lx of [0, 4]) ctx.fill(lx, G + 1, 0, lx, deckY + 1, 15, "pale_log");
    ctx.fill(1, G + 1, 0, 3, deckY, 0, "pale_log"); // bow transom
    ctx.fill(1, G + 1, 15, 3, deckY, 15, "pale_log"); // stern transom

    // Three ribs snapped amidships. The outer two cracked and held; the middle
    // one parted all the way down to the waterline. That notch is the only way
    // aboard — you swim up to it and step through the hull.
    for (const lx of [0, 4]) {
      for (const lz of [7, 9]) ctx.set(lx, deckY + 1, lz, 0);
      ctx.fill(lx, boardY, 8, lx, deckY + 1, 8, 0);
    }

    // deck: rotting_planks, with lz 7-9 gone
    for (let lz = 1; lz <= 14; lz++) {
      if (lz >= 7 && lz <= 9) continue;
      ctx.fill(1, deckY, lz, 3, deckY, lz, "rotting_planks");
    }

    // flood the hold to whatever the fen is at
    const holdTop = Math.min(surf, deckY - 1);
    if (holdTop >= G + 1) ctx.fill(1, G + 1, 1, 3, holdTop, 14, LIQ);
    if (surf >= deckY) ctx.fill(1, deckY, 7, 3, deckY, 9, LIQ);

    // the cargo he did not save, stacked under the open deck — and the only
    // way back out of the hold when the fen is running low
    ctx.set(1, G + 1, 8, "rotting_planks");
    ctx.set(1, G + 2, 9, "rotting_planks");

    // the mast, out over the bow, banner tangled at the end
    ctx.fill(2, deckY + 1, 1, 2, deckY + 1, 6, "pale_log");
    ctx.set(2, deckY + 1, 0, "banner");

    // the tiller, and the man at it
    ctx.set(2, deckY + 1, 15, "pale_log");
    ctx.set(2, deckY + 1, 14, "bone_block");

    if (ctx.ruinLevel >= 1) {
      for (let lz = 1; lz <= 14; lz++) {
        if (ctx.rand(900 + lz) < 0.10 * ctx.ruinLevel) ctx.set(2, deckY, lz, 0);
      }
    }
  },
  hooks: { lootCache: { local: [2, 1, 13], table: "auto", respawnSec: 480 } },
});

// ---------------------------------------------------------------------------
// carrion_nest — the Sunscour
// ---------------------------------------------------------------------------
// WHO. Nobody. This is the only prefab in the catalog that nobody made.
// WHAT HAPPENED. Something enormous died on its side. Something smaller moved
//   into the ribcage and has been raising young there ever since.
// WHAT'S LEFT. Hay, dead leaves, and a caravan strongbox that a lioness
//   dragged home. The cart is outside; its wheels are six blocks apart and the
//   sand between them is smooth. It was dragged.
//
// The cache sits under the ribs at the centre of the nest. The cache position
// IS the price. No light: nobody has been here and lived.
TIER3.push({
  id: "carrion_nest",
  footprint: { w: 15, d: 9 },
  anchor: "flatten",
  clearance: 10,
  maxSlope: 3,
  floor: "sand",
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const FL = G + 1;

    // --- the ribcage: five stations, each a full arch, two arcs of five ----
    const ARCH: Array<[number, number]> = [
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 2],
      [6, 1],
      [7, 0],
    ];
    const STATIONS = [4, 6, 8, 10, 12];
    for (const lx of STATIONS) {
      for (const [lz, dy] of ARCH) ctx.set(lx, FL + dy, lz, "bone_block");
    }
    ctx.fill(4, FL + 3, 4, 12, FL + 3, 4, "bone_block"); // the spine, along the ridge

    // --- the skull, lying on its side at the head of the spine ------------
    for (let lx = 0; lx <= 2; lx++) {
      for (let lz = 3; lz <= 5; lz++) {
        for (let y = FL; y <= FL + 2; y++) {
          const shell = lx === 0 || lx === 2 || lz === 3 || lz === 5 || y === FL || y === FL + 2;
          ctx.set(lx, y, lz, shell ? "bone_block" : 0);
        }
      }
    }
    ctx.set(0, FL + 1, 3, "web"); // across the eye void
    ctx.set(0, FL + 1, 5, "web");
    ctx.set(3, FL + 2, 4, "bone_block"); // one vertebra between skull and ribs

    // --- the nest: hay and dead leaves heaped on the flanks, never in the
    // centre line — the lioness keeps her own road open, and so do you ----
    for (let lx = 5; lx <= 11; lx++) {
      for (const lz of [3, 5]) {
        ctx.set(lx, FL, lz, ctx.rand(lx * 5 + lz) < 0.55 ? "hay" : "dead_leaves");
      }
    }
    ctx.set(8, FL, 3, "planks"); // the strongbox lid, splintered off

    // --- the cart, outside, dragged ---------------------------------------
    ctx.set(13, FL, 1, "log"); // one wheel
    ctx.set(13, FL, 7, "log"); // and the other, six blocks away
    for (const lz of [2, 3, 5, 6]) ctx.set(14, FL, lz, "planks");
    ctx.set(12, FL, 5, "rubble"); // what spilled on the way in
    ctx.set(11, FL, 6, "rubble");

    // --- the dune keeps trying to take it ---------------------------------
    for (let lx = 0; lx <= 14; lx++) {
      for (const lz of [0, 8]) {
        if (ctx.rand(600 + lx * 3 + lz) < 0.25 + 0.15 * ctx.ruinLevel) ctx.setIfAir(lx, FL, lz, "sand");
      }
    }
    if (ctx.ruinLevel === 2) {
      // one station's north arc has come down; the spine holds without it
      const lx = STATIONS[Math.floor(ctx.rand(77) * STATIONS.length)]!;
      ctx.set(lx, FL + 2, 3, 0);
      ctx.set(lx, FL + 1, 2, 0);
      ctx.setIfAir(lx, FL, 2, "bone_block"); // a rib, down in the sand
    }
    // No light. None.
  },
  hooks: {
    lootCache: { local: [8, 1, 4], table: "auto", respawnSec: 540 },
    spawnRegion: {
      local: [8, 4],
      r: 9,
      table: {
        mobs: [{ mob: "duneshadow_lioness", weight: 1 }],
        maxAlive: 2,
        packSize: [1, 2],
        respawnSec: 300,
      },
    },
  },
});
