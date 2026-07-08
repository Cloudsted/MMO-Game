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
import type { PrefabCtx, PrefabDef, SpawnRegionPayload } from "./prefabs.js";

// ---------------------------------------------------------------------------
// Hooks that move with ruinLevel
// ---------------------------------------------------------------------------
//
// `stampPrefab` calls `pdef.build(ctx)` and reads `pdef.hooks` on the very next
// line, synchronously, inside the same stamp. That — and only that — is why a
// build() below can decide where its cache sits, or whether it has a spawn
// region at all, as a function of `ctx.ruinLevel`.
//
// Two prefabs NEED this; they are not being clever for its own sake:
//   * `digger_shaft`'s cache lives six blocks underground until the shaft caves
//     in, at which point the chamber that held it does not exist. A static hook
//     would bury the loot inside solid rubble.
//   * `tidewarden_ward` and `lamplighter_post` post their dead only once the
//     thing has failed. An intact ward has nothing to haunt it.
//
// The rule this creates: NEVER read a tier-1 prefab's `hooks` without stamping
// it first. What you find there is whatever the last stamp left behind.

type Hooks = NonNullable<PrefabDef["hooks"]>;
type SpawnHook = NonNullable<Hooks["spawnRegion"]>;

/** Move this stamp's loot cache. Local x/z; `dy` is relative to groundY. */
function cacheAt(p: PrefabDef, lx: number, dy: number, lz: number): void {
  const lc = (p.hooks as Hooks).lootCache;
  if (lc) lc.local = [lx, dy, lz];
}

/** Re-table this stamp's loot cache (a hook value read synchronously by
 *  `stampPrefab` right after build — so, like `cacheAt`, it is per-stamp and
 *  MUST be set in every branch or a prior stamp's value leaks). */
function cacheLoot(p: PrefabDef, table: string, respawnSec: number): void {
  const lc = (p.hooks as Hooks).lootCache;
  if (lc) {
    lc.table = table;
    lc.respawnSec = respawnSec;
  }
}

/** Arm — or disarm — this stamp's spawn region. */
function spawnIf(p: PrefabDef, on: boolean, sr: SpawnHook): void {
  (p.hooks as Hooks).spawnRegion = on ? sr : undefined;
}

// ---------------------------------------------------------------------------
// Shared geometry helpers
// ---------------------------------------------------------------------------

/**
 * Strip the footprint's columns back to bare terrain, then put the room's
 * liquid back exactly where generation had it.
 *
 * Everything that stands in water sets `noClear` and calls this instead of
 * letting the engine clear for it. `stampPrefab`'s conform clear writes AIR
 * from each column's ground upward, which in a flooded room punches a dry
 * rectangular pit down through the fen — and it reaches one block OUTSIDE the
 * footprint, where a prefab has no right to repair it. This clears the same
 * things (trees, reeds, vines), restores the murk, and never writes outside.
 */
function drainAndReflood(ctx: PrefabCtx, top: number): void {
  const wl = ctx.def.terrain.waterLevel;
  const liquid = ctx.def.terrain.liquid;
  for (let lz = 0; lz < ctx.d; lz++) {
    for (let lx = 0; lx < ctx.w; lx++) {
      const g = ctx.g(lx, lz);
      ctx.fill(lx, g + 1, lz, lx, top, lz, 0);
      if (wl !== undefined && wl > g) ctx.fill(lx, g + 1, lz, lx, wl, lz, liquid);
    }
  }
}

/** Pack a column from its own terrain height up to `top`, so a `conform`
 *  prefab's masonry never floats over a dip it happened to straddle.
 *  (`ctx.fill` no-ops when y0 > y1, so this is free on level ground.) */
function footing(ctx: PrefabCtx, lx: number, lz: number, top: number, block: string): void {
  ctx.fill(lx, ctx.g(lx, lz) + 1, lz, lx, top, lz, block);
}

const dist = (lx: number, lz: number, cx: number, cz: number): number => Math.hypot(lx - cx, lz - cz);

// ===========================================================================
// tidewarden_ward — the room's thesis object
// ===========================================================================
//
// WHO MADE IT. The Tidewardens, a priesthood of hydrologists. They sank rings
// of sealed sluice-stones across the fen and the marsh stayed out of Ysmere for
// four hundred years.
// WHAT HAPPENED. The seals failed together, in one night, because somebody
// broke the master seal on the temple altar.
// WHAT'S LEFT. A warden's satchel at the foot of the cracked cylinder.
//
// THE INTERRUPTED ACTION is one block. At ruinLevel 1 a rune_plate has been
// pried out of the ring and dragged INWARD: it lies loose and proud on the dry
// disk, on moss that has had time to grow under it, while the fen licks in
// through the gap it left. It did not fall out. Nobody sabotages a seal from
// outside. That block is the entire plot of the Gloomfen.

const WARD_GUARD: SpawnRegionPayload = {
  mobs: [
    { mob: "marsh_wisp", weight: 2 },
    { mob: "bog_serpent", weight: 1 },
  ],
  maxAlive: 3,
  packSize: [1, 2],
  respawnSec: 70,
};

const tidewardenWard: PrefabDef = {
  id: "tidewarden_ward",
  footprint: { w: 11, d: 11 },
  anchor: "conform",
  // it stands IN the fen, not on a scraped pad, and the fen is still there when
  // we are done — see drainAndReflood
  noClear: true,
  maxSlope: 3,
  build(ctx) {
    const C = 5;
    const wl = ctx.def.terrain.waterLevel;
    const G = ctx.groundY;
    const swamp = ctx.def.biome === "swamp";
    const packed = swamp ? "mud" : "dirt";
    const turf = swamp ? "mud" : "grass";
    const charge = swamp ? "blue_crystal" : "crystal";
    const sunk = ctx.ruinLevel === 2;
    // the disk's surface sits level with the murk, so the marsh laps at its
    // edge instead of drowning it or being towered over by it
    const deck = wl === undefined ? G : Math.max(G, wl);

    drainAndReflood(ctx, deck + 8);

    // --- the ring: eight sluice-stones, laid FLUSH in the ground -----------
    const ring: Array<[number, number]> = [
      [1, 5], // west — the one that goes missing
      [9, 5],
      [5, 1],
      [5, 9],
      [2, 2],
      [8, 2],
      [2, 8],
      [8, 8],
    ];
    const gap = ctx.ruinLevel === 1 ? ring[0]! : null;

    if (!sunk) {
      // a circle of dry ground in a marsh that wants it back
      for (let lz = 0; lz <= 10; lz++) {
        for (let lx = 0; lx <= 10; lx++) {
          const d = dist(lx, lz, C, C);
          if (d > 4.35) continue;
          ctx.fill(lx, ctx.g(lx, lz) + 1, lz, lx, deck - 1, lz, packed);
          ctx.set(lx, deck, lz, d >= 3.6 ? "moss_carpet" : turf); // moss in the interstices
        }
      }
    }
    for (const [lx, lz] of ring) {
      if (gap && lx === gap[0] && lz === gap[1]) continue;
      ctx.set(lx, sunk ? ctx.g(lx, lz) : deck, lz, "rune_plate");
    }

    // --- the cylinder ------------------------------------------------------
    if (sunk) {
      // shattered: a 3×3 stump under two feet of murk, the charge a cinder
      for (let lz = 4; lz <= 6; lz++) for (let lx = 4; lx <= 6; lx++) footing(ctx, lx, lz, G, packed);
      ctx.fill(4, G + 1, 4, 6, G + 1, 6, "rubble");
      ctx.set(5, G + 2, 5, "obsidian");
    } else {
      ctx.fill(4, deck + 1, 4, 6, deck + 3, 6, "pale_temple_brick");
      ctx.fill(4, deck + 4, 4, 6, deck + 4, 6, "rune_plate"); // the slab cap
      ctx.set(5, deck + 5, 5, charge);
      if (ctx.ruinLevel === 1) {
        // cracked, not broken: two bites out of the top course
        const wall: Array<[number, number]> = [
          [4, 4],
          [5, 4],
          [6, 4],
          [6, 5],
          [6, 6],
          [5, 6],
          [4, 6],
          [4, 5],
        ];
        for (let i = 0; i < 2; i++) {
          const c = wall[Math.floor(ctx.rand(11 + i) * wall.length)]!;
          ctx.set(c[0], deck + 3, c[1], "rubble");
        }
      }
    }

    // --- the wardens' lantern posts ----------------------------------------
    // light = language: a lit ward is a tended ward. Two go dark when it
    // cracks — the two nearest the break. A drowned ward is dark entirely.
    for (const [lx, lz] of [
      [3, 3],
      [7, 3],
      [3, 7],
      [7, 7],
    ] as const) {
      if (sunk) {
        footing(ctx, lx, lz, ctx.g(lx, lz), packed);
        ctx.set(lx, ctx.g(lx, lz) + 1, lz, "rubble");
        continue;
      }
      ctx.set(lx, deck + 1, lz, "pale_ruin_stone");
      const nearBreak = lx === 3;
      if (ctx.ruinLevel === 0 || !nearBreak) ctx.set(lx, deck + 2, lz, "lantern");
    }

    // --- the plot of the Gloomfen, in one block -----------------------------
    if (ctx.ruinLevel === 1) {
      if (wl !== undefined) {
        // a tongue of murk reaches in through the gap the plate left
        ctx.set(1, deck, 5, ctx.def.terrain.liquid);
        ctx.set(2, deck, 5, ctx.def.terrain.liquid);
      }
      // and there the plate lies: two blocks inside the ring (three would be
      // the cylinder wall), on its own moss, SITTING ON the disk rather than
      // set into it. Every other plate in this prefab is flush at `deck`.
      ctx.set(3, deck, 5, "moss_carpet");
      ctx.set(3, deck + 1, 5, "rune_plate");
    }

    // the satchel, at the foot of the cylinder's south face
    cacheAt(tidewardenWard, 5, (sunk ? ctx.g(5, 7) + 1 : deck + 1) - G, 7);
    // the wardens are still on station at the posts they failed to hold
    spawnIf(tidewardenWard, ctx.ruinLevel >= 1, { local: [5, 5], r: 8, table: WARD_GUARD });
  },
  hooks: {
    lootCache: { local: [5, 1, 7], table: "cache_gloomfen", respawnSec: 420 },
    spawnRegion: { local: [5, 5], r: 8, table: WARD_GUARD },
  },
};

// ===========================================================================
// lamplighter_post — a promise, not a prize
// ===========================================================================
//
// WHO MADE IT. The kingdom. Ysmere paid a corps of lamplighters to walk the
// causeway at dusk so the temple's pilgrims could find their way home.
// WHAT HAPPENED. They walked it the night the marsh came up. The lamps went
// out, one by one, from the temple end back toward the gate.
// WHAT'S LEFT. Nothing. Wayshrine-class: NO loot cache, ever.
//
// Setpiece S3 stamps these at fixed anchors down the causeway and hands each
// one the ruinLevel it wants for that z. That is the whole trick — here,
// ruinLevel is not decay. It is distance from anything that loves you.
//   0 → lantern (warm)  ·  1 → bog_candle (something ELSE lit it)  ·  2 → dark

const WISP_POST: SpawnRegionPayload = {
  mobs: [{ mob: "marsh_wisp", weight: 1 }],
  maxAlive: 1,
  packSize: [1, 1],
  respawnSec: 90,
};

const lamplighterPost: PrefabDef = {
  id: "lamplighter_post",
  footprint: { w: 3, d: 3 },
  anchor: "conform",
  noClear: true,
  maxSlope: 3,
  build(ctx) {
    const wl = ctx.def.terrain.waterLevel;
    const deck = (wl === undefined ? ctx.groundY : wl) + 1;
    drainAndReflood(ctx, deck + 7);

    // four piles driven through the murk to the deck line, mossy at the cap
    for (const [lx, lz] of [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ] as const) {
      footing(ctx, lx, lz, deck - 1, "pale_log");
      ctx.set(lx, deck, lz, "moss_carpet");
    }
    // plinth, shaft, cage
    footing(ctx, 1, 1, deck - 1, "pale_log");
    ctx.set(1, deck, 1, "pale_ruin_stone");
    ctx.fill(1, deck + 1, 1, 1, deck + 3, 1, "pale_fluted_column");
    const cage: Array<[number, number]> = [
      [0, 1],
      [2, 1],
      [1, 0],
      [1, 2],
    ];
    const lost = ctx.ruinLevel === 2 ? Math.floor(ctx.rand(3) * 4) : -1;
    cage.forEach(([lx, lz], i) => {
      if (i !== lost) ctx.set(lx, deck + 4, lz, "iron_bars");
    });
    ctx.set(1, deck + 5, 1, "iron_bars");

    // the light, or its absence
    if (ctx.ruinLevel === 0) ctx.set(1, deck + 4, 1, "lantern");
    else if (ctx.ruinLevel === 1) ctx.set(1, deck + 4, 1, "bog_candle");
    else {
      // he dropped it. It is still lit, on the bottom, glowing up at you
      // through the murk, and he never came back for it.
      ctx.set(2, ctx.g(2, 1) + 1, 1, "lantern");
    }

    // the marsh_wisp IS the lamplighter, still walking his stretch of road,
    // still carrying his light — which is why it is the colour of a bog_candle
    spawnIf(lamplighterPost, ctx.ruinLevel >= 1, { local: [1, 1], r: 6, table: WISP_POST });
  },
  hooks: { spawnRegion: { local: [1, 1], r: 6, table: WISP_POST } },
};

// ===========================================================================
// deathwatch_post — five blocks, two bones, a banner
// ===========================================================================
//
// WHO MADE IT. A soldier of Ashkaal.
// WHAT HAPPENED. He was told to hold this stretch of road. Nobody ever told
// him to stop.
// WHAT'S LEFT. Last month's pay, never spent, sitting in the stones of a cold
// fire.
//
// THE INTERRUPTED ACTION is posture. He is still standing, inside his own
// breastwork, facing outward.
//
// Light-is-language, inverted: at ruinLevel 0 — near the gate, near help — the
// torch on his pole is BURNING. The post is still manned. That is worse.

const DEATHWATCH_RELIEF: SpawnRegionPayload = {
  mobs: [{ mob: "skeleton", weight: 1 }],
  maxAlive: 2,
  packSize: [1, 1],
  respawnSec: 90,
};

const deathwatchPost: PrefabDef = {
  id: "deathwatch_post",
  footprint: { w: 5, d: 5 },
  anchor: "conform",
  clearance: 8,
  maxSlope: 2,
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const base = ctx.def.biome === "desert" ? "sand" : "dirt";

    // the breastwork: a five-block arc, two courses, opening behind him
    for (const [lx, lz] of [
      [0, 1],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 1],
    ] as const) {
      footing(ctx, lx, lz, G, base);
      const bite = ctx.ruinLevel === 2 && ctx.rand(lx * 13 + lz) < 0.4 ? 1 : 0;
      ctx.fill(lx, G + 1, lz, lx, G + 2 - bite, lz, "sandstone");
    }

    // the soldier, upright behind the wall's centre, looking out over it
    footing(ctx, 2, 1, G, base);
    ctx.fill(2, G + 1, 1, 2, G + 2, 1, "bone_block");

    // his two spears, crossed, butts jammed into the sand behind him
    for (const lx of [1, 2, 3]) footing(ctx, lx, 2, G, base);
    ctx.plate(1, G + 3, 2, "x", ["L L", " L ", "L L"], { L: "log" });

    // the pole, and the colours of a kingdom three names ago
    footing(ctx, 0, 3, G, base);
    ctx.fill(0, G + 1, 3, 0, G + 4, 3, "log");
    if (ctx.ruinLevel < 2 || ctx.rand(7) < 0.5) ctx.set(0, G + 5, 3, "banner");
    if (ctx.ruinLevel === 0) ctx.set(1, G + 4, 3, "torch");

    // the fire ring, long cold. His pay is sitting in it.
    for (const [lx, lz] of [
      [2, 3],
      [4, 3],
      [3, 2],
      [3, 4],
    ] as const) {
      footing(ctx, lx, lz, G - 1, base);
      ctx.set(lx, G, lz, "cobblestone");
    }
    footing(ctx, 3, 3, G, base);
    ctx.set(3, G + 1, 3, "ash");
  },
  hooks: {
    lootCache: { local: [2, 1, 3], table: "cache_desert_poor", respawnSec: 900 },
    spawnRegion: { local: [2, 3], r: 4, table: DEATHWATCH_RELIEF }, // he gets up
  },
};

// ===========================================================================
// buried_pylon — a monumental door to nothing
// ===========================================================================
//
// WHO MADE IT. The god-kings. This is a temple gate.
// WHAT HAPPENED. The district it opened onto is under forty feet of sand.
// WHAT'S LEFT. Whatever a robber wedged into the lintel void and never came
// back for.
//
// NO interrupted action, deliberately. A perfect gold sun disc eight blocks
// above a doorway you have to crawl through on your belly is the whole sentence.
//
// `noClear` IS the prefab: it must emerge from the dune, not stand on a scraped
// pad. One outer tower corner has crumbled into a staircase — at every ruin
// level, because the void is only reachable by climbing it, and a cache you
// cannot reach is not a design statement, it is a bug.

const buriedPylon: PrefabDef = {
  id: "buried_pylon",
  footprint: { w: 11, d: 5 },
  anchor: "flatten",
  maxSlope: 2,
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const BRICK = "sandstone_tomb_brick";
    const stairEast = ctx.rand(1) < 0.5; // which tower lost its corner

    /**
     * Top solid y of a tower column. The whole climb is in this function, and
     * it is a strict ±1 chain in BOTH directions, because a cache you can drop
     * into and not climb out of is worse than no cache:
     *   ground(G+1) → crumbled corner lz 0..4 (feet G+2..G+6) → across the back
     *   row (feet G+7, G+7) → the shoulder (feet G+6) → down into the void
     *   (feet G+5). Every step is one block. Walk it backwards and it still is.
     */
    const topOf = (lx: number, lz: number): number => {
      const out = lx <= 3 ? 3 - lx : lx - 7; // 0 at the passage, 3 at the outside
      const stair = lx <= 3 ? !stairEast : stairEast;
      let t: number;
      if (out === 3) t = stair ? G + 1 + lz : G + 4; // the crumbled corner: one step per lz
      else if (out === 2) t = G + 6;
      else if (out === 1) t = stair && lz === 4 ? G + 6 : G + 7; // the collapse runs down the back
      else t = lz === 0 || lz === 4 ? G + 5 : G + 7; // shoulders, open to the void
      // ruin bites chew the front face only — never the climb, never the shoulders
      if (ctx.ruinLevel > 0 && lz <= 2 && out >= 1 && out <= 2) {
        t -= Math.floor(ctx.rand(lx * 31 + lz) * (ctx.ruinLevel + 1));
      }
      return Math.max(G + 1, t);
    };

    // --- the two towers, buried four below ---------------------------------
    for (const lx of [0, 1, 2, 3, 7, 8, 9, 10]) {
      for (let lz = 0; lz <= 4; lz++) {
        const top = topOf(lx, lz);
        ctx.fill(lx, G - 4, lz, lx, top, lz, BRICK);
        if (lz === 0 || lz === 4) {
          // the two outward faces carry a god-king's name
          const faceTop = Math.min(G + 4, top);
          ctx.fill(lx, G + 1, lz, lx, faceTop, lz, "hieroglyph_wall");
          if (ctx.ruinLevel === 2 && ctx.rand(200 + lx * 7 + lz) < 0.25) ctx.set(lx, faceTop, lz, "rubble");
        }
      }
    }

    // --- the passage, the lintel, the void, the disc -------------------------
    ctx.fill(4, G + 1, 0, 6, G + 3, 4, 0); // the way through
    ctx.fill(4, G + 5, 0, 6, G + 7, 4, 0); // the void over its head
    if (ctx.ruinLevel < 2) {
      ctx.fill(4, G + 4, 0, 6, G + 4, 4, BRICK); // the door lintel
      ctx.fill(4, G + 1, 1, 6, G + 1, 3, "sand"); // choked: exactly two blocks of headroom
    } else {
      // the lintel came down. You climb over instead of under — and the
      // robber's stash came down with it.
      for (let lx = 4; lx <= 6; lx++) {
        ctx.set(lx, G + 1, 1, "rubble");
        ctx.fill(lx, G + 1, 2, lx, G + 2, 2, ctx.rand(lx) < 0.5 ? "rubble" : BRICK);
        ctx.set(lx, G + 1, 3, "rubble");
      }
    }
    // the upper lintel bridges the towers' shoulders; the sun disc is set in
    // its face, eight blocks above the doorway
    ctx.fill(3, G + 8, 1, 7, G + 8, 3, BRICK);
    ctx.set(5, G + 8, 1, "gold_block");

    // two snapped columns before the gate. You squeeze between them.
    ctx.fill(4, G + 1, 0, 4, G + 2, 0, "pale_fluted_column");
    ctx.set(6, G + 1, 0, "pale_fluted_column");

    // the void's floor is the door lintel's back — until the lintel is gone
    cacheAt(buriedPylon, 5, ctx.ruinLevel < 2 ? 5 : 3, 2);
  },
  hooks: { lootCache: { local: [5, 5, 2], table: "cache_desert", respawnSec: 600 } },
};

// ===========================================================================
// digger_shaft — the setpiece, in miniature
// ===========================================================================
//
// WHO MADE IT. The diggers, conscripted when the spring failed.
// WHAT HAPPENED. Sekhat ordered them to dig until they found water. Look at the
// corner of the bottom chamber: they were two swings from the fire that killed
// the world.
// WHAT'S LEFT. The last basket, still full, still on its hook.
//
// THE INTERRUPTED ACTION is that basket. Somebody was coming back up for it.
//
// The treads climb the shaft wall +1 at a time (the ruined_watchtower step math,
// already BFS-tested); the shaft's south column stays open the whole way, and
// that hole IS the jump-arc headroom. NO spawn region — the shaft is silent,
// which is the point. The ember glow leaking up it at night is the whole
// advertisement.

const diggerShaft: PrefabDef = {
  id: "digger_shaft",
  footprint: { w: 9, d: 9 },
  anchor: "conform",
  clearance: 8,
  maxSlope: 3,
  avoidWater: true,
  build(ctx) {
    const G = ctx.groundY;
    const floor = ctx.digFloorY(7);
    const depth = G - floor;
    // A shaft that never got deep is a shaft that caved in — and so is ruin 2.
    // (digFloorY clamps off bedrock, so a dig started in low ground goes
    // SHALLOWER rather than punching through the underside of the world.)
    const caved = ctx.ruinLevel === 2 || depth < 5;

    // --- the spoil heap: what came out of the hole, ringing the hole --------
    for (let lz = 0; lz <= 8; lz++) {
      for (let lx = 0; lx <= 8; lx++) {
        const d = dist(lx, lz, 4, 4);
        if (d < 3.5 || d > 4.3) continue;
        const r = ctx.rand(lx * 19 + lz);
        if (r < 0.55) ctx.setIfAir(lx, ctx.g(lx, lz) + 1, lz, r < 0.2 ? "rubble" : "sand");
      }
    }

    if (!caved) {
      // --- the chamber ------------------------------------------------------
      ctx.fill(2, floor, 2, 6, floor, 6, "stone");
      ctx.fill(2, floor + 1, 2, 6, floor + 3, 6, 0);
      ctx.fill(2, floor + 4, 2, 6, floor + 4, 6, "stone");
      // a cut stone wall with dungeon_masonry ribs, so the chamber reads MADE
      // rather than merely absent
      for (let lz = 1; lz <= 7; lz++) {
        for (let lx = 1; lx <= 7; lx++) {
          if (lx > 1 && lx < 7 && lz > 1 && lz < 7) continue;
          const rib =
            ((lx === 1 || lx === 7) && (lz === 3 || lz === 5)) || ((lz === 1 || lz === 7) && (lx === 3 || lx === 5));
          ctx.fill(lx, floor + 1, lz, lx, floor + 3, lz, rib ? "dungeon_masonry" : "stone");
        }
      }
      // --- the shaft, and the spiral that climbs it --------------------------
      ctx.fill(3, floor + 1, 3, 5, G, 5, 0);
      const spiral: Array<[number, number]> = [
        [3, 5],
        [3, 4],
        [3, 3],
        [4, 3],
        [5, 3],
        [5, 4],
        [5, 5],
      ];
      for (let i = 0; i < depth && i < spiral.length; i++) {
        const [lx, lz] = spiral[i]!;
        const y = floor + 1 + i;
        if (y > floor + 1) ctx.fill(lx, floor + 1, lz, lx, y - 1, lz, "log"); // the post
        ctx.set(lx, y, lz, "planks"); // the tread
      }
      // --- the corner they never got to finish -------------------------------
      // three ember_crystal set into the stone, and the haft of his pick still
      // leaning on that wall. Crystal light means danger, and it means loot.
      ctx.set(6, floor + 1, 6, "ember_crystal");
      ctx.set(6, floor + 2, 6, "ember_crystal");
      ctx.set(6, floor + 1, 5, "ember_crystal");
      ctx.set(5, floor + 1, 6, "log");
      // opposite him, under a rubble fall, the digger who did not get out
      ctx.set(2, floor + 1, 2, "bone_block");
      ctx.set(2, floor + 2, 2, "rubble");
      ctx.set(3, floor + 1, 2, "rubble");
    } else {
      // the shaft caved. Nobody ever saw the ember seam, so in this variant it
      // does not exist.
      ctx.fill(3, Math.max(1, G - 4), 3, 5, G, 5, "rubble");
    }

    // --- the windlass, straddling the mouth's north lip ----------------------
    for (const lx of [3, 5]) {
      footing(ctx, lx, 1, G, "sand");
      ctx.fill(lx, G + 1, 1, lx, G + 2, 1, "log");
    }
    ctx.fill(3, G + 3, 1, 5, G + 3, 1, "log");
    ctx.set(4, G + 2, 1, "planks"); // the basket, one below the crossbeam

    cacheAt(diggerShaft, 4, caved ? 1 : floor + 1 - G, caved ? 2 : 4);
    // Priced for the descent, NOT the mouth. The intact shaft is a 7-block
    // climb down a spiral (400 s, cache_desert). When it caves, the loot
    // relocates to a bag on open sand at head height, unguarded — so it drops
    // to the unguarded-poor pacing of deathwatch_post (cache_desert_poor,
    // 900 s). The fiction agrees: nobody ever saw the ember seam in this
    // variant, so nobody hauled anything good up out of it.
    cacheLoot(diggerShaft, caved ? "cache_desert_poor" : "cache_desert", caved ? 900 : 400);
  },
  hooks: { lootCache: { local: [4, -6, 4], table: "cache_desert", respawnSec: 400 } },
};

// ===========================================================================
// warding_ring — the only prefab whose payload is the fight
// ===========================================================================
//
// WHO MADE IT. Nine wards, set in a ring, holding something in the ground.
// WHAT HAPPENED. Eight of them still burn.
// WHAT'S LEFT. Nothing. NO LOOT CACHE, deliberately. Cold rune light means
// danger, and that is all it means. The payload is the fight.
//
// THE INTERRUPTED ACTION is a direction. From the broken menhir a trail of
// rubble and one skull_pile runs out through the gap. Every other prefab in
// this batch is a container that failed. This is the one where you can see
// which way the contents went.
//
// No torch. No lantern. No brazier. The only light is the surviving
// rune_plate_lit (7 each), and it is cold and blue.

const wardingRing: PrefabDef = {
  id: "warding_ring",
  footprint: { w: 11, d: 11 },
  anchor: "flatten",
  clearance: 10,
  maxSlope: 3,
  build(ctx) {
    const C = 5;
    const G = ctx.groundY;
    const FL = G + 1;

    // rasterise the ring, then walk it by angle so the eight ward-points come
    // out evenly spaced whatever cell count the rasteriser hands us
    const ring: Array<[number, number]> = [];
    for (let lz = 0; lz <= 10; lz++) {
      for (let lx = 0; lx <= 10; lx++) {
        const d = dist(lx, lz, C, C);
        if (Math.abs(d - 5) < 0.5) ring.push([lx, lz]);
        else if (d < 5) ctx.set(lx, G, lz, "crypt_slate");
      }
    }
    ring.sort((a, b) => Math.atan2(a[1] - C, a[0] - C) - Math.atan2(b[1] - C, b[0] - C));
    for (const [lx, lz] of ring) ctx.set(lx, G, lz, "rune_plate");

    const wards = Array.from({ length: 8 }, (_, k) => ring[Math.round((k * ring.length) / 8) % ring.length]!);
    const broken = Math.floor(ctx.rand(5) * 8);

    wards.forEach(([lx, lz], k) => {
      if (k === broken) return;
      // The ward-stone stands on its (plain) rune_plate — set by the ring loop
      // above — and its CROWN still burns. The lit rune has to keep a face to
      // the air: a rune_plate_lit buried under three courses of menhir has all
      // six neighbours opaque, so VoxelLighting leaks nothing (7 − 15 < 0) and
      // the mesher never draws it. "Eight of them still burn" has to be visible.
      ctx.fill(lx, FL, lz, lx, FL + 1, lz, "pale_ruin_stone"); // the menhir
      ctx.set(lx, FL + 2, lz, "rune_plate_lit"); // its crown, cold and blue
      // a chain hangs from its crown, toward the centre
      ctx.setIfAir(lx + Math.sign(C - lx), FL + 2, lz + Math.sign(C - lz), "chain");
    });

    // the ninth ward: a 3×3 of lit plate at dead centre, and the thing that was
    // standing on it
    ctx.fill(4, G, 4, 6, G, 6, "rune_plate_lit");
    ctx.set(5, FL, 5, "obsidian");

    // --- the break ----------------------------------------------------------
    const [bx, bz] = wards[broken]!;
    ctx.set(bx, G, bz, "rubble"); // the plate, split
    ctx.set(bx, FL, bz, "rubble"); // the menhir, a stump
    // the crater takes the room's own flavour
    const ux = (bx - C) / 5;
    const uz = (bz - C) / 5;
    const tx = Math.round(-uz);
    const tz = Math.round(ux);
    const volcanic = ctx.def.biome === "volcanic";
    const crypt = ctx.def.biome === "dungeon";
    for (const s of [1, -1]) {
      const nx = bx + tx * s;
      const nz = bz + tz * s;
      if (nx < 0 || nx > 10 || nz < 0 || nz > 10) continue;
      if (volcanic) ctx.set(nx, G, nz, s > 0 ? "lava" : "ash");
      else if (crypt) ctx.set(nx, FL, nz, "skull_pile");
      else if (s > 0) ctx.set(nx, FL, nz, "roots");
      else ctx.set(nx, G, nz, "mud");
    }
    if (crypt) ctx.setIfAir(bx, FL + 1, bz, "web");

    // the trail: three blocks of rubble and a skull, running from the dais out
    // through the gap. Whatever was bound here left in that direction.
    for (let t = 2; t <= 4; t++) {
      const lx = C + Math.round(ux * t);
      const lz = C + Math.round(uz * t);
      if (lx < 0 || lx > 10 || lz < 0 || lz > 10) continue;
      ctx.setIfAir(lx, FL, lz, "rubble");
      if (t === 4) ctx.setIfAir(lx, FL + 1, lz, "skull_pile");
    }
  },
  // no cache — the payload IS the fight, and the room supplies it. A scatter
  // entry `bindSpawnTable`s a DEDICATED danger table onto this site (its region
  // re-centered here). Two contracts the original comment got wrong:
  //   * bind an ELITE-TRASH table, never the room's "nastiest table" — in
  //     cinderrift/crypt_depths/gloomfen the nastiest table is a solitary,
  //     slow-respawn *_boss that belongs in its own arena; relocating it here
  //     strands it on a random scatter site.
  //   * `bindSpawnTable` only re-CENTERS a region; it cannot bump maxAlive, so
  //     the old "one over that table's usual maxAlive" was never expressible.
  // And because a bind re-centers ONE table object, scatter count must stay 1
  // per bound table (two rings binding the same table = last-write-wins; give
  // the second ring its own table if you want two).
  hooks: { spawnRegion: { local: [5, 5], r: 7 } },
};

// ===========================================================================
// stilt_fisher_camp — the control experiment
// ===========================================================================
//
// WHO MADE IT. A fen-fisher. This decade, not this century.
// WHAT HAPPENED. Nothing yet.
// WHAT'S LEFT. His supper, his tackle, and his lantern, which is lit.
//
// This is the only light in the Gloomfen a LIVING hand still tends — set it
// against the tidewarden_ward's lamps (institutional, and failing) and the cold
// blue crystal-and-rune light everywhere else. Not "the only warm thing" (the
// intact ward near the gate is warm too, by design); the only warm thing that
// means someone is HERE, now. It also answers "why does anyone come out here"
// with the least heroic, most convincing answer available: there are still
// fish, and someone has to eat.
//
// THE INTERRUPTED ACTION is the net. Five web blocks lie flat on the murk,
// spreading away from the platform: a cast net that has not been hauled in. One
// existing block, one wrong context — and now you hesitate before you swim
// through it, and there is no spider.

const stiltFisherCamp: PrefabDef = {
  id: "stilt_fisher_camp",
  footprint: { w: 9, d: 9 },
  anchor: "conform",
  noClear: true,
  maxSlope: 3,
  nearWater: true,
  build(ctx) {
    const wl = ctx.def.terrain.waterLevel;
    const surface = wl === undefined ? ctx.groundY : wl;
    const D = surface + 2; // the platform's planks
    drainAndReflood(ctx, D + 6);

    // nine stilts, a five-by-five deck
    for (const lx of [2, 4, 6]) for (const lz of [2, 4, 6]) footing(ctx, lx, lz, D - 1, "pale_log");
    ctx.fill(2, D, 2, 6, D, 6, "planks");

    // the lean-to: a rotting back wall, thatch over the bed
    ctx.fill(2, D + 1, 2, 6, D + 2, 2, "rotting_planks");
    ctx.fill(2, D + 3, 2, 6, D + 3, 4, "thatch");
    ctx.set(4, D + 4, 3, "lantern"); // on the ridge, and it is LIT, at every ruinLevel

    // his bed, his one book, his cooking ring. The lz=6 row stays clear: that
    // is where the treads land, and a cooking stone there is a locked door.
    ctx.set(3, D + 1, 3, "hay");
    ctx.set(5, D + 1, 3, "bookshelf");
    ctx.set(3, D + 1, 5, "cobblestone");
    ctx.set(5, D + 1, 5, "cobblestone");
    ctx.set(4, D + 1, 5, "torch");

    // the drying rack: two posts, a beam, and reeds hung in the air beneath it
    for (const lz of [2, 6]) ctx.fill(6, D + 1, lz, 6, D + 2, lz, "log");
    for (let lz = 3; lz <= 5; lz++) {
      ctx.set(6, D + 2, lz, "log");
      ctx.set(6, D + 1, lz, "reeds");
    }

    // a mud shelf and a plank tread, stepping up out of the water
    footing(ctx, 4, 8, surface - 1, "mud");
    ctx.set(4, surface, 8, "mud");
    footing(ctx, 4, 7, surface, "pale_log");
    ctx.set(4, surface + 1, 7, "planks");

    // the net, still in the water
    if (wl !== undefined) {
      for (const [lx, lz] of [
        [1, 3],
        [1, 4],
        [0, 4],
        [1, 5],
        [0, 6],
      ] as const) {
        ctx.set(lx, surface, lz, "web");
      }
    }

    cacheAt(stiltFisherCamp, 4, D + 1 - ctx.groundY, 4);
  },
  // no spawn region. This camp is safe, and it is the only safe thing out here.
  //
  // It rolls the full cache_gloomfen (T2 steel included), UNGUARDED. The doc
  // asked for 300 s "(bias consumables)" — but a consumables-only table lives
  // in shared/loot.json, out of this file's reach. Until that table exists the
  // safe camp must NOT out-cycle the guarded tidewarden_ward (420 s) on the
  // very same table, or it is a risk-free steel faucet. So it cycles slower
  // than the guarded ward, not faster: an unguarded rich cache pays in patience.
  hooks: { lootCache: { local: [4, 2, 4], table: "cache_gloomfen", respawnSec: 600 } },
};

export const TIER1: PrefabDef[] = [
  tidewardenWard,
  lamplighterPost,
  deathwatchPost,
  buriedPylon,
  diggerShaft,
  wardingRing,
  stiltFisherCamp,
];
