/**
 * Tier-3 prefab proofs (design doc §7).
 *
 * Three properties, one suite, for all seven prefabs:
 *   (a) CONTAINMENT — every write lands inside [0,w) x [0,d) x [1,47], at every
 *       rotation x ruin level, on real sloped terrain of the prefab's own room
 *       flavour. A block outside the footprint corrupts whatever the scatter
 *       placer put next door, and nothing protects it.
 *   (b) DETERMINISM — two independent stamps produce byte-identical grids, and
 *       a second stamp over the first changes nothing (idempotent).
 *   (c) REACHABILITY — the conservative walker in `prefabhelpers.canReach`
 *       (walk / 1-block jump / <=3 drop / swim) gets from open ground to every
 *       loot cache, AND back out again. `roadside_gibbet` has no cache, on
 *       purpose, and the suite asserts that too.
 */
import { describe, expect, it } from "vitest";
import { isSolidBlock } from "@fantasy-mmo/common";
import { PREFABS, stampPrefab } from "../src/sim/prefabs.js";
import { VoxelWorld } from "../src/sim/voxel.js";
import { Builder } from "../src/sim/voxelstructures.js";
import {
  canReach,
  containmentProbe,
  flatProvingGround,
  footprintRect,
  gridHash,
  provingDef,
  slopedProvingGround,
  type ProvingOpts,
} from "./prefabhelpers.js";

const TIER3_IDS = [
  "charnel_scaffold",
  "sunken_gaol",
  "sewer_outfall",
  "roadside_gibbet",
  "raft_pyre",
  "barge_wreck",
  "carrion_nest",
] as const;

/** the room flavour each prefab is authored for, as a proving-ground recipe */
const ROOM: Record<string, ProvingOpts> = {
  charnel_scaffold: { biome: "dungeon", base: 14, amplitude: 2, waterLevel: null },
  sunken_gaol: { biome: "swamp", liquid: "murk_water", base: 14, amplitude: 4, waterLevel: 12 },
  sewer_outfall: { biome: "swamp", liquid: "murk_water", base: 14, amplitude: 4, waterLevel: 12 },
  roadside_gibbet: { biome: "grass", waterLevel: null },
  raft_pyre: { biome: "swamp", liquid: "murk_water", base: 12, amplitude: 2.5, waterLevel: 12 },
  barge_wreck: { biome: "swamp", liquid: "murk_water", base: 12, amplitude: 2.5, waterLevel: 12 },
  carrion_nest: { biome: "desert", base: 13, amplitude: 6, waterLevel: null },
};

const ROTS = [0, 1, 2, 3] as const;
const RUINS = [0, 1, 2] as const;

describe("tier 3: registration", () => {
  it("registers all seven, in order, with the documented footprints", () => {
    for (const id of TIER3_IDS) expect(PREFABS[id], id).toBeDefined();
    expect(PREFABS.barge_wreck!.footprint).toEqual({ w: 5, d: 16 });
    // a gibbet is a warning, not a prize
    expect(PREFABS.roadside_gibbet!.hooks?.lootCache).toBeUndefined();
    expect(PREFABS.roadside_gibbet!.hooks?.spawnRegion).toBeUndefined();
    // the nest's price is its position
    expect(PREFABS.carrion_nest!.hooks?.spawnRegion?.table?.mobs[0]?.mob).toBe("duneshadow_lioness");
    // charnel's cache is IN the pit
    expect(PREFABS.charnel_scaffold!.hooks!.lootCache!.local[1]).toBe(-3);
  });
});

describe("tier 3: containment", () => {
  it.each(TIER3_IDS)("%s writes nothing outside its footprint (4 rot x 3 ruin, sloped)", (id) => {
    const noClear = PREFABS[id]!.noClear === true;
    let writes = 0;
    let airStray = 0;
    let solidStray = 0;
    let yLo = 99;
    let yHi = 0;
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const { def, world } = slopedProvingGround({ ...ROOM[id], seed: 424242 + rot * 7 + ruin });
        const probe = containmentProbe(world);
        stampPrefab(new Builder(probe, def), id, 50, 50, rot, ruin);
        writes += probe.writes.length;
        const bad = probe.violations(footprintRect(id, 50, 50, rot), { clearPad: noClear ? 0 : 1 });
        expect(bad.slice(0, 4), `${id} rot ${rot} ruin ${ruin}`).toEqual([]);
        const b = probe.bounds()!;
        expect(b.y0, `${id}: y floor`).toBeGreaterThanOrEqual(1);
        expect(b.y1, `${id}: y ceiling`).toBeLessThanOrEqual(47);
        yLo = Math.min(yLo, b.y0);
        yHi = Math.max(yHi, b.y1);
        // how far anything actually strayed, measured rather than assumed
        const rect = footprintRect(id, 50, 50, rot);
        for (const w of probe.writes) {
          const s = Math.max(rect.x0 - w.x, w.x - rect.x1, rect.z0 - w.z, w.z - rect.z1, 0);
          if (w.id === 0) airStray = Math.max(airStray, s);
          else solidStray = Math.max(solidStray, s);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `  [contain] ${id}: ${writes} writes / 12 stamps · 0 violations · ` +
        `stray air ${airStray} solid ${solidStray} · y ${yLo}..${yHi}`
    );
  });
});

describe("tier 3: real scatter", () => {
  /** the Gloomfen's own terrain numbers — the room five of the seven ship into */
  const fen = (prefabs: unknown[]) =>
    provingDef({
      size: 288,
      base: 12,
      amplitude: 2.5,
      frequency: 0.02,
      seed: 90210,
      biome: "swamp",
      liquid: "murk_water",
      waterLevel: 11,
      spawn: { x: 144, z: 270 },
      prefabs,
    });

  // Each prefab alone: this measures SITEABILITY (do its water/slope filters
  // ever pass?), not bin-packing against its neighbours.
  it.each(TIER3_IDS)("%s sites and stamps through a generated 288² fen", (id) => {
    const world = new VoxelWorld(fen([{ prefab: id, count: 3, minSpacing: 40 }]));
    const n = world.features.placements.length; // throws on a bad block / plate legend
    // eslint-disable-next-line no-console
    console.log(`  [scatter] ${id}: ${n}/3 sited (72 candidates)`);
    expect(n, `${id} never found a legal site in 72 candidates`).toBeGreaterThanOrEqual(1);
  });

  it("all seven together: caches resolve to real tables, the nest brings its pride", () => {
    const world = new VoxelWorld(fen(TIER3_IDS.map((id) => ({ prefab: id, count: 2, minSpacing: 30 }))));
    const placed = world.features.placements.map((p) => p.prefab);
    // eslint-disable-next-line no-console
    console.log(`  [scatter] together: ${placed.length} placements — ${placed.sort().join(", ")}`);
    // under-fill is legal (and logged); silently placing MORE than asked is not
    for (const u of world.features.underfill) expect(u.placed).toBeLessThan(u.wanted);
    // caches ride "auto" verbatim (RoomSim resolves it per room); the two that
    // name a table name one that exists, because "auto" would mis-resolve there
    const named = new Set(world.features.caches.map((c) => c.table));
    for (const t of named) expect(["auto", "cache_crypt", "cache_gloomfen"]).toContain(t);
    expect(named.has("cache_crypt"), "charnel_scaffold pins cache_crypt").toBe(true);
    // carrion_nest carries its own lioness table into the room at gen time
    for (const t of world.features.extraTables) {
      expect(t.mobs[0]?.mob).toBe("duneshadow_lioness");
      expect(t.maxAlive).toBe(2);
    }
    // roadside_gibbet contributes nothing to the economy, ever
    expect(placed).toContain("roadside_gibbet");
  });
});

describe("tier 3: determinism", () => {
  it.each(TIER3_IDS)("%s is byte-identical across independent stamps, and idempotent", (id) => {
    const stamp = (rot: 0 | 1 | 2 | 3, ruin: 0 | 1 | 2, twice = false) => {
      const { def, world } = slopedProvingGround(ROOM[id]);
      stampPrefab(new Builder(world, def), id, 50, 50, rot, ruin);
      if (twice) stampPrefab(new Builder(world, def), id, 50, 50, rot, ruin);
      return gridHash(world);
    };
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const a = stamp(rot, ruin);
        expect(stamp(rot, ruin), `${id} rot ${rot} ruin ${ruin}: not deterministic`).toBe(a);
        expect(stamp(rot, ruin, true), `${id} rot ${rot} ruin ${ruin}: not idempotent`).toBe(a);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (c) reachability. Flat ground on purpose: nothing in the terrain can help or
// hinder the climb, so a failure is the prefab's fault. Every cache is proven
// in BOTH directions — a pit you can fall into and not climb out of is a bug,
// not a feature, and this game has no drowning to end the argument.
// ---------------------------------------------------------------------------

function reachBothWays(
  id: string,
  ground: ReturnType<typeof flatProvingGround>,
  rot: 0 | 1 | 2 | 3,
  ruin: 0 | 1 | 2,
  ox = 40,
  oz = 40,
  sx = 34,
  sz = 34
) {
  const { def, world } = ground;
  const hooks = stampPrefab(new Builder(world, def), id, ox, oz, rot, ruin);
  const c = hooks.lootCache!;
  const cx = Math.floor(c.x);
  const cz = Math.floor(c.z);
  const outY = world.floorY(sx + 0.5, sz + 0.5);
  expect(canReach(world, sx, sz, cx, cz, c.y), `${id} rot ${rot} ruin ${ruin}: no way IN to the cache`).toBe(true);
  expect(
    canReach(world, cx, cz, sx, sz, outY, { startY: c.y }),
    `${id} rot ${rot} ruin ${ruin}: no way OUT from the cache`
  ).toBe(true);
  return c;
}

describe("tier 3: cache reachability", () => {
  it("charnel_scaffold: down the bone ramp into the pit, and back up", () => {
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const g = flatProvingGround(96, 14, { biome: "dungeon" });
        const c = reachBothWays("charnel_scaffold", g, rot, ruin);
        expect(c.y, "the cache is three below the rim, in the bones").toBe(11);
        expect(c.table).toBe("cache_crypt");
      }
    }
  });

  it("sunken_gaol: catwalk, the fallen bar, the one open cell", () => {
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const g = flatProvingGround(96, 12, { biome: "swamp", liquid: "murk_water" });
        reachBothWays("sunken_gaol", g, rot, ruin, 40, 40, 34, 34);
      }
    }
  });

  it("sewer_outfall: only through the hole they cut in their own grate", () => {
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const g = flatProvingGround(96, 12, { biome: "swamp", liquid: "murk_water" });
        reachBothWays("sewer_outfall", g, rot, ruin);
      }
    }
  });

  it("sewer_outfall: sealing the cut hole makes the stash unreachable (the hole IS the door)", () => {
    const { def, world } = flatProvingGround(96, 12, { biome: "swamp", liquid: "murk_water" });
    const hooks = stampPrefab(new Builder(world, def), "sewer_outfall", 40, 40, 0, 0);
    const c = hooks.lootCache!;
    // grate is at local lz=7, cut at local lx=4 → world (44, G..G+1, 47)
    world.set(44, 12, 47, 48); // iron_bars
    world.set(44, 13, 47, 48);
    expect(canReach(world, 34, 34, Math.floor(c.x), Math.floor(c.z), c.y)).toBe(false);
  });

  it("raft_pyre: the cache is on the fen bottom with him, and you can swim back up", () => {
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const g = flatProvingGround(96, 9, { biome: "swamp", liquid: "murk_water", waterLevel: 12 });
        const c = reachBothWays("raft_pyre", g, rot, ruin);
        expect(c.y, "underwater: groundY+1").toBe(10);
        expect(c.table).toBe("cache_gloomfen");
      }
    }
  });

  it("barge_wreck: in through the snapped rib, down into the flooded hold, out again", () => {
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        for (const wl of [12, 10]) {
          // deep fen (deck at the waterline) and a shallow one (deck stands proud)
          const g = flatProvingGround(96, 9, { biome: "swamp", liquid: "murk_water", waterLevel: wl });
          reachBothWays("barge_wreck", g, rot, ruin);
        }
      }
    }
  });

  it("barge_wreck: dry-docked, the cargo crates are still the way out of the hold", () => {
    for (const rot of ROTS) {
      const g = flatProvingGround(96, 12, { biome: "swamp" }); // no water at all
      reachBothWays("barge_wreck", g, rot, 0);
    }
  });

  it("carrion_nest: the cache is inside the nest, under the ribs", () => {
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const g = flatProvingGround(96, 13, { biome: "desert" });
        const c = reachBothWays("carrion_nest", g, rot, ruin);
        expect(c.y, "on the sand, under the spine").toBe(14);
      }
    }
  });

  it("roadside_gibbet: stamps clean and offers nothing", () => {
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const { def, world } = flatProvingGround(96, 12);
        const hooks = stampPrefab(new Builder(world, def), "roadside_gibbet", 40, 40, rot, ruin);
        expect(hooks.lootCache).toBeUndefined();
        expect(hooks.spawnRegion).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (d) the cache is not lootable from OUTSIDE the footprint. Pickup is a 3-D
// distance check with NO wall occlusion (room.ts handlePickup, range
// combat.pickupRange = 2.5 m), so a bag one block behind a one-block-thick wall
// is looted straight through it — making the corridor / catwalk / grate that
// gate it all optional. This asserts, at every rot × ruin on flat ground, that
// the closest STANDABLE pose outside the footprint rect is strictly further
// than pickupRange from the bag center. (sunken_gaol and sewer_outfall both
// failed this at exactly 2.0 m before their caches were moved inward.)
// ---------------------------------------------------------------------------

const PICKUP_RANGE = 2.5; // shared/constants.json combat.pickupRange

/** Closest standable feet-pose (solid below, air at feet+head) OUTSIDE the
 *  footprint rect, as a 3-D distance to the cache bag center. */
function minExternalCacheDist(id: string, ground: ReturnType<typeof flatProvingGround>, rot: 0 | 1 | 2 | 3, ruin: 0 | 1 | 2): number {
  const { def, world } = ground;
  const hooks = stampPrefab(new Builder(world, def), id, 40, 40, rot, ruin);
  const c = hooks.lootCache!;
  const rect = footprintRect(id, 40, 40, rot);
  let best = Infinity;
  for (let x = rect.x0 - 4; x <= rect.x1 + 4; x++) {
    for (let z = rect.z0 - 4; z <= rect.z1 + 4; z++) {
      if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) continue; // inside
      for (let y = 1; y < 46; y++) {
        if (!isSolidBlock(world.get(x, y - 1, z))) continue;
        if (isSolidBlock(world.get(x, y, z)) || isSolidBlock(world.get(x, y + 1, z))) continue;
        best = Math.min(best, Math.hypot(c.x - (x + 0.5), c.y - y, c.z - (z + 0.5)));
      }
    }
  }
  return best;
}

describe("tier 3: caches cannot be looted from outside the footprint", () => {
  // flat ground per prefab flavour (mirrors the reachability suite above)
  const GROUND: Record<string, () => ReturnType<typeof flatProvingGround>> = {
    charnel_scaffold: () => flatProvingGround(96, 14, { biome: "dungeon" }),
    sunken_gaol: () => flatProvingGround(96, 12, { biome: "swamp", liquid: "murk_water" }),
    sewer_outfall: () => flatProvingGround(96, 12, { biome: "swamp", liquid: "murk_water" }),
    raft_pyre: () => flatProvingGround(96, 9, { biome: "swamp", liquid: "murk_water", waterLevel: 12 }),
    barge_wreck: () => flatProvingGround(96, 9, { biome: "swamp", liquid: "murk_water", waterLevel: 12 }),
    carrion_nest: () => flatProvingGround(96, 13, { biome: "desert" }),
  };
  const cached = TIER3_IDS.filter((id) => PREFABS[id]!.hooks?.lootCache);
  it.each(cached)("%s: no external standable pose within pickup range of the bag", (id) => {
    let worst = Infinity;
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const d = minExternalCacheDist(id, GROUND[id]!(), rot, ruin);
        worst = Math.min(worst, d);
        expect(d, `${id} rot ${rot} ruin ${ruin}: bag looted through a wall`).toBeGreaterThan(PICKUP_RANGE);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`  [ext-reach] ${id}: closest external pose ${worst.toFixed(3)} m (pickup ${PICKUP_RANGE})`);
  });
});
