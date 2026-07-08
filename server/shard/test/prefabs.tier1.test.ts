/**
 * Tier-1 prefab proofs (docs/content-design-2.md §7).
 *
 * Three mechanical claims per prefab, at every rotation × every ruinLevel:
 *   (a) CONTAINMENT — no write lands outside [0,w) × [0,d) × [1,47]. A prefab
 *       that writes next door corrupts whatever the scatter placer put there,
 *       and nothing in the spacing/exclusion logic protects it.
 *   (b) DETERMINISM — two fresh worlds hash identically, and a second stamp
 *       over the first changes nothing.
 *   (c) REACHABILITY — a player can physically walk/jump/drop/swim from outside
 *       the footprint to every loot cache, and back out again.
 *
 * `canReach` is deliberately more cramped than the real client physics, so a
 * pass here is a pass in the game.
 */
import { describe, expect, it } from "vitest";
import { PREFABS, stampPrefab } from "../src/sim/prefabs.js";
import { Builder } from "../src/sim/voxelstructures.js";
import {
  canReach,
  containmentProbe,
  flatProvingGround,
  footprintRect,
  gridHash,
  slopedProvingGround,
  type ProvingOpts,
} from "./prefabhelpers.js";

const TIER1_IDS = [
  "tidewarden_ward",
  "lamplighter_post",
  "deathwatch_post",
  "buried_pylon",
  "digger_shaft",
  "warding_ring",
  "stilt_fisher_camp",
] as const;

const ROTS = [0, 1, 2, 3] as const;
const RUINS = [0, 1, 2] as const;

/** the terrain each prefab is actually meant to land in */
const GROUND: Record<string, ProvingOpts> = {
  tidewarden_ward: { biome: "swamp", base: 10, waterLevel: 11, liquid: "murk_water" },
  lamplighter_post: { biome: "swamp", base: 9, waterLevel: 11, liquid: "murk_water" },
  deathwatch_post: { biome: "desert", base: 13 },
  buried_pylon: { biome: "desert", base: 13 },
  digger_shaft: { biome: "desert", base: 13 },
  warding_ring: { biome: "swamp", base: 12, waterLevel: 11, liquid: "murk_water" },
  stilt_fisher_camp: { biome: "swamp", base: 9, waterLevel: 11, liquid: "murk_water" },
};

const flat = (id: string) => flatProvingGround(96, GROUND[id]!.base ?? 12, GROUND[id]!);

describe("tier 1 — registered", () => {
  it("all seven are in the catalog, in order, with the hooks the doc promises", () => {
    for (const id of TIER1_IDS) expect(PREFABS[id], id).toBeDefined();
    // wayshrine-class + fight-payload prefabs must never grow a cache
    expect(PREFABS.lamplighter_post!.hooks?.lootCache).toBeUndefined();
    expect(PREFABS.warding_ring!.hooks?.lootCache).toBeUndefined();
    expect(PREFABS.warding_ring!.hooks?.spawnRegion?.table).toBeUndefined(); // bindSpawnTable owns it
    expect(PREFABS.stilt_fisher_camp!.hooks?.spawnRegion).toBeUndefined();
    expect(PREFABS.digger_shaft!.hooks?.spawnRegion).toBeUndefined();
  });
});

describe("tier 1 — (a) containment", () => {
  for (const id of TIER1_IDS) {
    it(`${id}: writes nothing outside its own footprint, at any rot × ruin`, () => {
      const pdef = PREFABS[id]!;
      for (const rot of ROTS) {
        for (const ruin of RUINS) {
          // sloped, noisy ground: flat ground hides floating masonry and
          // buried doorways, which is exactly what a `conform` bug looks like
          const { def, world } = slopedProvingGround(GROUND[id]!);
          const probe = containmentProbe(world);
          stampPrefab(new Builder(probe, def), id, 50, 50, rot, ruin);
          const bad = probe.violations(footprintRect(id, 50, 50, rot), { clearPad: pdef.noClear ? 0 : 1 });
          expect(bad.slice(0, 4), `${id} rot ${rot} ruin ${ruin}`).toEqual([]);
          const b = probe.bounds()!;
          expect(b.y0, `${id}: wrote bedrock`).toBeGreaterThanOrEqual(1);
          expect(b.y1, `${id}: wrote the sky`).toBeLessThanOrEqual(47);
        }
      }
    });
  }
});

describe("tier 1 — (b) determinism", () => {
  for (const id of TIER1_IDS) {
    it(`${id}: two fresh worlds hash the same, and a re-stamp is a no-op`, () => {
      for (const rot of ROTS) {
        for (const ruin of RUINS) {
          const a = slopedProvingGround(GROUND[id]!);
          stampPrefab(new Builder(a.world, a.def), id, 50, 50, rot, ruin);
          const b = slopedProvingGround(GROUND[id]!);
          stampPrefab(new Builder(b.world, b.def), id, 50, 50, rot, ruin);
          expect(gridHash(a.world), `${id} rot ${rot} ruin ${ruin}`).toBe(gridHash(b.world));
          const once = gridHash(a.world);
          stampPrefab(new Builder(a.world, a.def), id, 50, 50, rot, ruin);
          expect(gridHash(a.world), `${id}: second stamp changed the grid`).toBe(once);
        }
      }
    });
  }
});

describe("tier 1 — (c) cache reachability", () => {
  /** stamp at (40,40) on the prefab's own terrain and walk in from (34,34) */
  function reachAt(id: string, rot: 0 | 1 | 2 | 3, ruin: 0 | 1 | 2) {
    const { def, world } = flat(id);
    const hooks = stampPrefab(new Builder(world, def), id, 40, 40, rot, ruin);
    return { def, world, hooks };
  }

  for (const id of ["tidewarden_ward", "deathwatch_post", "buried_pylon", "digger_shaft", "stilt_fisher_camp"]) {
    it(`${id}: ground → cache → ground, at any rot × ruin`, () => {
      for (const rot of ROTS) {
        for (const ruin of RUINS) {
          const { world, hooks } = reachAt(id, rot, ruin);
          const c = hooks.lootCache!;
          const cx = Math.floor(c.x);
          const cz = Math.floor(c.z);
          const label = `${id} rot ${rot} ruin ${ruin} cache (${cx},${c.y},${cz})`;
          expect(canReach(world, 34, 34, cx, cz, c.y), `${label}: unreachable`).toBe(true);
          // and back out — an underwater or pit cache must not be a one-way trip
          const outY = world.floorY(34.5, 34.5);
          expect(canReach(world, cx, cz, 34, 34, outY, { startY: c.y }), `${label}: no way back`).toBe(true);
        }
      }
    });
  }

  it("digger_shaft: the deep cache really is 6 below the surface, and the cave-in relocates it", () => {
    const deep = reachAt("digger_shaft", 0, 0);
    const G = deep.world.terrainHeight(deep.def, 44, 44);
    expect(deep.hooks.lootCache!.y).toBe(G - 6);
    const caved = reachAt("digger_shaft", 0, 2);
    expect(caved.hooks.lootCache!.y).toBe(G + 1); // up in the surface basket
  });

  it("digger_shaft: the ruin-2 cave-in seals the shaft and the ember glow is gone", () => {
    const { def, world } = flat("digger_shaft");
    stampPrefab(new Builder(world, def), "digger_shaft", 40, 40, 0, 2);
    const G = world.terrainHeight(def, 44, 44);
    const EMBER = 39; // ember_crystal
    let ember = 0;
    let air = 0;
    for (let y = G - 7; y <= G; y++) {
      for (let x = 42; x <= 46; x++) {
        for (let z = 42; z <= 46; z++) {
          if (world.get(x, y, z) === EMBER) ember++;
          if (world.get(x, y, z) === 0) air++;
        }
      }
    }
    expect(ember, "an ember seam nobody ever saw").toBe(0);
    expect(air, "the shaft is not sealed").toBe(0);
  });

  it("tidewarden_ward: the drowned cache is under the murk, and swimming both ways works", () => {
    const { def, world } = flat("tidewarden_ward");
    const hooks = stampPrefab(new Builder(world, def), "tidewarden_ward", 40, 40, 0, 2);
    const c = hooks.lootCache!;
    const MURK = 27;
    // the whole disk is gone; the satchel sits on the drowned floor with murk
    // in the cell that holds it. It is DELIBERATELY submerged.
    expect(c.y, "below the water line").toBeLessThanOrEqual(11);
    expect(world.get(Math.floor(c.x), c.y, Math.floor(c.z)), "the cell is liquid").toBe(MURK);
    // the fen is one block deep here, so this is a wade, not a dive — and it
    // works with swimming turned off, which is the strongest form of the claim
    expect(canReach(world, 34, 34, Math.floor(c.x), Math.floor(c.z), c.y, { allowSwim: false })).toBe(true);
    expect(canReach(world, 34, 34, Math.floor(c.x), Math.floor(c.z), c.y)).toBe(true);
  });

  it("tidewarden_ward: the pried plate lies loose INSIDE the ring, at ruinLevel 1 only", () => {
    const RUNE_PLATE = 60;
    for (const ruin of RUINS) {
      const { def, world } = flat("tidewarden_ward");
      stampPrefab(new Builder(world, def), "tidewarden_ward", 40, 40, 0, ruin);
      const deck = 11; // waterLevel: the dry disk sits level with the murk
      // ring plates are FLUSH at `deck`; the loose one sits proud at deck+1,
      // two blocks inside the ring, and the ring has a hole where it came from
      const loose = world.get(43, deck + 1, 45) === RUNE_PLATE;
      const ringWest = world.get(41, deck, 45) === RUNE_PLATE;
      expect(loose, `ruin ${ruin}: loose plate`).toBe(ruin === 1);
      if (ruin === 0) expect(ringWest, "ruin 0: the ring is whole").toBe(true);
      if (ruin === 1) expect(ringWest, "ruin 1: the west plate is the one that was pried out").toBe(false);
    }
  });

  it("lamplighter_post: light state is a pure function of ruinLevel, and it never has loot", () => {
    const LANTERN = 49;
    const BOG_CANDLE = 73;
    const seen: number[] = [];
    for (const ruin of RUINS) {
      const { def, world } = flat("lamplighter_post");
      const hooks = stampPrefab(new Builder(world, def), "lamplighter_post", 40, 40, 0, ruin);
      expect(hooks.lootCache, "wayshrine-class").toBeUndefined();
      expect(!!hooks.spawnRegion, `ruin ${ruin}: wisp`).toBe(ruin >= 1);
      const deck = 12; // waterLevel 11 + 1
      seen.push(world.get(41, deck + 4, 41));
    }
    expect(seen[0]).toBe(LANTERN); // warm
    expect(seen[1]).toBe(BOG_CANDLE); // something else lit it
    expect(seen[2]).toBe(0); // dark
    // ...and at ruin 2 the lamp he dropped is still burning on the bottom
    const { def, world } = flat("lamplighter_post");
    stampPrefab(new Builder(world, def), "lamplighter_post", 40, 40, 0, 2);
    expect(world.get(42, 10, 41)).toBe(LANTERN);
  });

  it("warding_ring: no cache, eight surviving sigils, no warm light at all", () => {
    const { def, world } = flat("warding_ring");
    const hooks = stampPrefab(new Builder(world, def), "warding_ring", 40, 40, 0, 1);
    expect(hooks.lootCache).toBeUndefined();
    expect(hooks.spawnRegion).toMatchObject({ r: 7 });
    const LIT = 61; // rune_plate_lit
    const WARM = new Set([17, 49, 67]); // torch, lantern, brazier
    let lit = 0;
    let warm = 0;
    for (let x = 40; x <= 50; x++) {
      for (let z = 40; z <= 50; z++) {
        for (let y = 10; y <= 20; y++) {
          const b = world.get(x, y, z);
          if (b === LIT) lit++;
          if (WARM.has(b)) warm++;
        }
      }
    }
    expect(lit, "7 compass sigils + the 3×3 centre").toBe(7 + 9);
    expect(warm, "no torch, no lantern, no brazier").toBe(0);
  });
});
