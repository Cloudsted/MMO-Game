/**
 * Tier-2 prefab catalog (design doc §7): containment, determinism, and the
 * thing that actually matters — can a player physically get to the loot cache
 * and back out again, at every rotation and every ruin level.
 *
 * Two caches here are NOT on open ground and get proven in both directions:
 *   • drowned_house — the cache is underwater, in a sealed room whose only
 *     opening is a hole in the roof. In and OUT.
 *   • dry_cistern — the cache is six terraces down a pit. In and OUT.
 */
import { describe, expect, it } from "vitest";
import { isLiquidBlock, isSolidBlock, loadRoomDef } from "@fantasy-mmo/common";
import { PREFABS, stampPrefab } from "../src/sim/prefabs.js";
import { Builder } from "../src/sim/voxelstructures.js";
import { VoxelWorld } from "../src/sim/voxel.js";
import {
  canReach,
  containmentProbe,
  flatProvingGround,
  footprintRect,
  gridHash,
  slopedProvingGround,
  type ProvingOpts,
} from "./prefabhelpers.js";

/**
 * The nearest OUTSIDE-the-shell standable/swim pose to a cache point. A cache
 * you can reach from open ground WITHOUT entering the structure is a cache
 * looted without doing the thing — the drowned_house cache used to sit two
 * cells from the fen through one plank wall (dist 2.0 < the 2.5 pickup range).
 * `insidePad` is how many cells in from the footprint edge count as "inside".
 */
function nearestOutsidePose(world: VoxelWorld, ox: number, oz: number, rw: number, rd: number, c: { x: number; y: number; z: number }, insidePad = 1): number {
  let best = Infinity;
  for (let x = ox - 3; x <= ox + rw + 2; x++) {
    for (let z = oz - 3; z <= oz + rd + 2; z++) {
      const inside = x >= ox + insidePad && x <= ox + rw - 1 - insidePad && z >= oz + insidePad && z <= oz + rd - 1 - insidePad;
      if (inside) continue;
      for (let y = c.y - 4; y <= c.y + 6; y++) {
        const stand = isSolidBlock(world.get(x, y - 1, z)) && !isSolidBlock(world.get(x, y, z)) && !isSolidBlock(world.get(x, y + 1, z));
        const swim = isLiquidBlock(world.get(x, y, z)) && !isSolidBlock(world.get(x, y + 1, z));
        if (!stand && !swim) continue;
        best = Math.min(best, Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z, y - c.y));
      }
    }
  }
  return best;
}

const TIER2_IDS = [
  "causeway_tollhouse",
  "drowned_house",
  "bone_orchard",
  "colossus_fragment",
  "dry_cistern",
  "sunscour_caravanserai",
  "ossuary_barrow",
] as const;

const ROTS = [0, 1, 2, 3] as const;
const RUINS = [0, 1, 2] as const;

/** which biome each prefab is authored for (containment runs on real terrain) */
const BIOME: Record<string, ProvingOpts> = {
  causeway_tollhouse: { biome: "swamp", liquid: "murk_water", waterLevel: 11 },
  drowned_house: { biome: "swamp", liquid: "murk_water", waterLevel: 11 },
  bone_orchard: { biome: "swamp", liquid: "murk_water", waterLevel: 11 },
  colossus_fragment: { biome: "desert", waterLevel: 10 },
  dry_cistern: { biome: "desert", waterLevel: 10 },
  sunscour_caravanserai: { biome: "desert", waterLevel: 10 },
  ossuary_barrow: { biome: "grass", waterLevel: 11 },
};

/** flat bench per prefab: nothing in the terrain can help or hinder the climb */
function bench(id: string) {
  switch (id) {
    // the fen as it ACTUALLY ships: ground one course over the waterline (the
    // Gloomfen's dominant terrain — heights 11–13 over wl 11). The drowned
    // house is a SUNKEN ruin here, not a floating one: its roof rides the mud
    // and its parlour is a flooded pit, so entry is roof-to-ground, not a swim
    // up to the eaves. (The old bench flooded the bed 3 deep, which hid that
    // the house was sealed on the room it lands in — see the review finding.)
    case "drowned_house":
      return flatProvingGround(96, 12, { biome: "swamp", liquid: "murk_water", waterLevel: 11 });
    case "causeway_tollhouse":
    case "bone_orchard":
      return flatProvingGround(96, 12, { biome: "swamp", liquid: "murk_water", waterLevel: 11 });
    case "colossus_fragment":
    case "sunscour_caravanserai":
      return flatProvingGround(96, 13, { biome: "desert", waterLevel: 10 });
    case "dry_cistern":
      return flatProvingGround(96, 13, { biome: "desert", waterLevel: 10 });
    default:
      return flatProvingGround(96, 12, { biome: "grass" });
  }
}

describe("tier 2 catalog", () => {
  it("registers all seven, in order", () => {
    for (const id of TIER2_IDS) expect(PREFABS[id], id).toBeDefined();
  });
});

describe("tier 2 containment", () => {
  it("no write lands outside [0,w) × [0,d) × [1,47], at every rot × ruin, on real terrain", () => {
    for (const id of TIER2_IDS) {
      const pdef = PREFABS[id]!;
      for (const rot of ROTS) {
        for (const ruin of RUINS) {
          const { def, world } = slopedProvingGround({ size: 128, ...BIOME[id] });
          const probe = containmentProbe(world);
          stampPrefab(new Builder(probe, def), id, 50, 50, rot, ruin);
          const bad = probe.violations(footprintRect(id, 50, 50, rot), {
            clearPad: pdef.noClear ? 0 : 1,
          });
          expect(bad, `${id} rot ${rot} ruin ${ruin}: ${bad.length} stray writes`).toEqual([]);
          const b = probe.bounds()!;
          expect(b.y0, `${id}: y below bedrock`).toBeGreaterThanOrEqual(1);
          expect(b.y1, `${id}: y above the world`).toBeLessThanOrEqual(47);
        }
      }
    }
  });
});

describe("tier 2 determinism", () => {
  it("stamping the same prefab twice gives a byte-identical grid", () => {
    for (const id of TIER2_IDS) {
      for (const rot of ROTS) {
        const hash = (): string => {
          const { def, world } = bench(id);
          stampPrefab(new Builder(world, def), id, 40, 40, rot, 1);
          return gridHash(world);
        };
        expect(hash(), `${id} rot ${rot}`).toBe(hash());
      }
    }
  });

  it("re-stamping into the SAME world is idempotent (no hash-order drift)", () => {
    for (const id of TIER2_IDS) {
      const { def, world } = bench(id);
      stampPrefab(new Builder(world, def), id, 40, 40, 2, 0);
      const once = gridHash(world);
      stampPrefab(new Builder(world, def), id, 40, 40, 2, 0);
      expect(gridHash(world), id).toBe(once);
    }
  });
});

describe("tier 2 cache reachability", () => {
  /** every cache-bearing prefab: ground → cache, at every rot × ruin */
  it("walk/jump/swim from outside to the cache at every rot × ruin", () => {
    for (const id of TIER2_IDS) {
      if (id === "colossus_fragment") continue; // variant-dependent; below
      for (const rot of ROTS) {
        for (const ruin of RUINS) {
          const { def, world } = bench(id);
          const hooks = stampPrefab(new Builder(world, def), id, 40, 40, rot, ruin);
          const c = hooks.lootCache;
          if (!c) continue;
          expect(
            canReach(world, 36, 36, Math.floor(c.x), Math.floor(c.z), c.y),
            `${id} rot ${rot} ruin ${ruin}: no path from the ground to the cache`
          ).toBe(true);
        }
      }
    }
  });

  /**
   * The two caches that are not on open ground. There is no drowning in this
   * engine and swimming up a 1-wide shaft works, but a room you can fall into
   * and not climb out of is a bug, so both directions are asserted.
   */
  it("drowned_house: in through the roof hole, down to the floor, and back OUT", () => {
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const { def, world } = bench("drowned_house");
        const hooks = stampPrefab(new Builder(world, def), "drowned_house", 40, 40, rot, ruin);
        const c = hooks.lootCache!;
        const cx = Math.floor(c.x);
        const cz = Math.floor(c.z);
        expect(canReach(world, 36, 36, cx, cz, c.y), `rot ${rot} ruin ${ruin}: cannot get in`).toBe(true);
        expect(
          canReach(world, cx, cz, 36, 36, world.floorY(36.5, 36.5), { startY: c.y }),
          `rot ${rot} ruin ${ruin}: cannot get back out`
        ).toBe(true);
        // and it is NOT looted from the fen through a wall: the cache is three
        // cells in and two below the deck, so every outside pose is well past
        // the 2.5 m pickup range.
        expect(
          nearestOutsidePose(world, 40, 40, 9, 9, c),
          `rot ${rot} ruin ${ruin}: cache lootable from outside the shell`
        ).toBeGreaterThan(2.5);
      }
    }
  });

  it("drowned_house: enterable AND sealed-from-outside on the REAL Gloomfen, not just the bench", () => {
    // The bug this guards was invisible on a deep-water bench and only appeared
    // on the room the prefab ships in (ground at/above the waterline). So prove
    // it on the actual gloomfen terrain, at several legal (low-slope) sites.
    const def = loadRoomDef("gloomfen");
    const probe = new VoxelWorld(def);
    let tested = 0;
    for (let cx = 30; cx < def.size.w - 30 && tested < 8; cx += 37) {
      for (let cz = 30; cz < def.size.h - 30 && tested < 8; cz += 41) {
        const ox = cx - 4;
        const oz = cz - 4;
        const hs = [
          probe.terrainHeight(def, ox, oz),
          probe.terrainHeight(def, ox + 8, oz),
          probe.terrainHeight(def, ox, oz + 8),
          probe.terrainHeight(def, ox + 8, oz + 8),
          probe.terrainHeight(def, cx, cz),
        ];
        if (Math.max(...hs) - Math.min(...hs) > (PREFABS["drowned_house"]!.maxSlope ?? 3)) continue;
        for (const rot of [0, 2] as const) {
          for (const ruin of RUINS) {
            const world = new VoxelWorld(def);
            const hooks = stampPrefab(new Builder(world, def), "drowned_house", ox, oz, rot, ruin);
            const c = hooks.lootCache!;
            const cx2 = Math.floor(c.x);
            const cz2 = Math.floor(c.z);
            expect(canReach(world, ox - 4, oz - 4, cx2, cz2, c.y), `gloomfen (${cx},${cz}) rot ${rot} ruin ${ruin}: sealed`).toBe(true);
            expect(
              nearestOutsidePose(world, ox, oz, 9, 9, c),
              `gloomfen (${cx},${cz}) rot ${rot} ruin ${ruin}: lootable from outside`
            ).toBeGreaterThan(2.5);
          }
        }
        tested++;
      }
    }
    expect(tested, "no legal gloomfen site was found to test").toBeGreaterThan(0);
  });

  it("dry_cistern: down six terraces to the cache and back up to the rim", () => {
    for (const rot of ROTS) {
      for (const ruin of RUINS) {
        const { def, world } = bench("dry_cistern");
        const hooks = stampPrefab(new Builder(world, def), "dry_cistern", 30, 30, rot, ruin);
        const c = hooks.lootCache!;
        const cx = Math.floor(c.x);
        const cz = Math.floor(c.z);
        expect(canReach(world, 26, 26, cx, cz, c.y), `rot ${rot} ruin ${ruin}: cannot get down`).toBe(true);
        expect(
          canReach(world, cx, cz, 26, 26, world.floorY(26.5, 26.5), { startY: c.y }),
          `rot ${rot} ruin ${ruin}: cannot climb back out`
        ).toBe(true);
      }
    }
  });

  it("bone_orchard: the harvest ladder is never buried by a neighbour's canopy", () => {
    // Regression for the exact repro: flat swamp, seed 777, ox=20 oz=30 — the
    // centre trunk's deterministic dead_leaves drop landed in the sole climb
    // column (6, G+5, 5) and sealed the cache. The reserved-column guard must
    // keep the lx=6 / lz 3..6 treads (and their headroom) clear.
    const { def, world } = flatProvingGround(96, 14, { biome: "swamp", liquid: "murk_water", waterLevel: 11 });
    const hooks = stampPrefab(new Builder(world, def), "bone_orchard", 20, 30, 0, 0);
    const c = hooks.lootCache!;
    const G = 14;
    for (const lz of [3, 4, 5, 6]) {
      for (let y = G + 3; y <= G + 8; y++) {
        // above each tread's standing height nothing solid may intrude into the
        // ladder column (treads themselves are the intended solids, at G+1..G+4)
        if (y <= G + 4) continue;
        expect(isSolidBlock(world.get(20 + 6, y, 30 + lz)), `ladder column (6,${y},${lz}) buried`).toBe(false);
      }
    }
    expect(canReach(world, 17, 27, Math.floor(c.x), Math.floor(c.z), c.y), "cannot climb to the harvest cache").toBe(true);
  });

  it("causeway_tollhouse: the road is a clear 3-wide passage through the arch", () => {
    // S3 (the Lamplighters' Road) stamps this astride the causeway. Local
    // x 4..6 must be walkable end to end, at deck height, at every ruin level.
    for (const ruin of RUINS) {
      const { def, world } = bench("causeway_tollhouse");
      stampPrefab(new Builder(world, def), "causeway_tollhouse", 40, 40, 0, ruin);
      const deckFeet = 12 + 2; // groundY 12, deck 13, feet 14
      for (let lz = 0; lz <= 8; lz++) {
        for (let lx = 4; lx <= 6; lx++) {
          expect(
            canReach(world, 44, 39, 40 + lx, 40 + lz, deckFeet, { allowSwim: false }),
            `ruin ${ruin}: carriageway cell (${lx},${lz}) is not walkable`
          ).toBe(true);
        }
      }
    }
  });
});

describe("colossus_fragment variants", () => {
  it("hash2 picks HEAD / HAND / FOOT, and the HAND pays nothing", () => {
    const seen = new Set<string>();
    for (let k = 0; k < 24; k++) {
      const { def, world } = bench("colossus_fragment");
      const hooks = stampPrefab(new Builder(world, def), "colossus_fragment", 20 + k * 2, 40, 0, 0);
      if (!hooks.lootCache) {
        expect(hooks.spawnRegion, "the HAND has no spawn region either").toBeUndefined();
        seen.add("hand");
        continue;
      }
      seen.add(hooks.lootCache.table === "cache_desert_poor" ? "foot" : "head");
      expect(hooks.spawnRegion).toBeDefined();
      expect(
        canReach(world, 20 + k * 2 - 3, 37, Math.floor(hooks.lootCache.x), Math.floor(hooks.lootCache.z), hooks.lootCache.y),
        `site ${k}: cannot crawl in to the cache`
      ).toBe(true);
    }
    expect([...seen].sort()).toEqual(["foot", "hand", "head"]);
  });

  it("the variant is a pure function of (ox, oz) — same site, same fragment", () => {
    for (let k = 0; k < 6; k++) {
      const a = (() => {
        const { def, world } = bench("colossus_fragment");
        return stampPrefab(new Builder(world, def), "colossus_fragment", 20 + k * 3, 40, 0, 0);
      })();
      const b = (() => {
        const { def, world } = bench("colossus_fragment");
        return stampPrefab(new Builder(world, def), "colossus_fragment", 20 + k * 3, 40, 0, 0);
      })();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});
