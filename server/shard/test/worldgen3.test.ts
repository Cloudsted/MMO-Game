/**
 * Difficulty-graph completion — the three deep rooms behind the intro zones:
 * Gloomfen Marsh (behind forest), The Cinderrift (behind desert), and the
 * Vaults of Morvane / crypt_depths (behind the Sunken Crypt's boss hall).
 *
 * Covers: def load + registry cross-refs, gen determinism, bidirectional
 * portal pairing (computePortalArrival both ways), spawn tables in bounds,
 * the crypt_depths lifecycle shape, authored features (temple/forge caches
 * + boss-table bindings, wraith cell caches), and a walkability smoke: BFS
 * over the standing-height grid (mirroring scripts/lib.mjs findPath — 4-way,
 * step ≤ 1.05 blocks) from the depths portal to the lich dais and into every
 * prison-cell cache, plus dungeon spawn → the new dungeon-depths portal.
 */
import { describe, expect, it } from "vitest";
import { computePortalArrival, loadRoomDef, RegistryService, type RoomDef } from "@fantasy-mmo/common";
import { RoomSim } from "../src/sim/room.js";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();

/** BFS reachability over the standing grid — the bot-lib findPath rule:
 *  4-way, walkable when standY changes by ≤ 1.05 between adjacent cells. */
function reachable(world: VoxelWorld, sx: number, sz: number, tx: number, tz: number): boolean {
  const w = world.w;
  const h = world.h;
  const sxi = Math.floor(sx);
  const szi = Math.floor(sz);
  const txi = Math.floor(tx);
  const tzi = Math.floor(tz);
  const key = (x: number, z: number) => x + z * w;
  const seen = new Set([key(sxi, szi)]);
  const queue: Array<[number, number]> = [[sxi, szi]];
  for (let head = 0; head < queue.length; head++) {
    const [x, z] = queue[head]!;
    if (x === txi && z === tzi) return true;
    const y = world.standY(x + 0.5, z + 0.5);
    for (const [nx, nz] of [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1],
    ] as const) {
      if (nx < 1 || nx >= w - 1 || nz < 1 || nz >= h - 1) continue;
      const k = key(nx, nz);
      if (seen.has(k)) continue;
      if (Math.abs(world.standY(nx + 0.5, nz + 0.5) - y) > 1.05) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return false;
}

function tablesInBounds(def: RoomDef): void {
  for (const t of def.spawnTables) {
    expect(t.region.x - t.region.r, t.id).toBeGreaterThanOrEqual(0);
    expect(t.region.x + t.region.r, t.id).toBeLessThanOrEqual(def.size.w);
    expect(t.region.z - t.region.r, t.id).toBeGreaterThanOrEqual(0);
    expect(t.region.z + t.region.r, t.id).toBeLessThanOrEqual(def.size.h);
    for (const m of t.mobs) expect(reg.mobs[m.mob], `${t.id}: ${m.mob}`).toBeDefined();
  }
}

describe("gloomfen (L8-12, behind forest)", () => {
  const def = loadRoomDef("gloomfen");

  it("loads per design: swamp, murk_water, perpetual dusk, 10 tables in bounds", () => {
    expect(def.biome).toBe("swamp");
    expect(def.wind).toBeCloseTo(0.45);
    expect(def.fixedTime).toBeCloseTo(0.86);
    expect(def.size).toEqual({ w: 320, h: 320 });
    expect(def.terrain.liquid).toBe("murk_water");
    expect(def.terrain.seed).toBe(91177);
    expect(def.spawnTables).toHaveLength(10); // +drowned-company, +glimmer-thicket, +mire-nave, +crowned-mire
    tablesInBounds(def);
  });

  it("generates deterministically (grid AND features)", () => {
    const a = new VoxelWorld(def);
    const b = new VoxelWorld(def);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(JSON.stringify(a.features)).toBe(JSON.stringify(b.features));
  });

  it("authored Temple of the Tidewardens: caches registered + temple-guard on the nave", () => {
    const sim = new RoomSim(def);
    // The stamped `sunken_temple` prefab was replaced by the authored S2 setpiece
    // (buildTidewardenTemple). Its under-vault cache is registered along with the
    // Drownbell's two and the Lamplighters' Road furniture, and the temple-guard
    // table (the fen's river-folk, in their own church) re-centres onto the nave.
    expect(sim.allCaches().length).toBeGreaterThanOrEqual(3);
    expect(reg.loot["cache_gloomfen"]).toBeDefined();
    const bind = sim.world.features.bindings.find((b) => b.tableId === "temple-guard");
    expect(bind).toMatchObject({ x: 160, z: 50 }); // TEMPLE_GUARD_RECENTER (the nave)
    const live = sim.liveSpawnTables().find((t) => t.id === "temple-guard")!;
    expect(live.region.x).toBe(160);
    expect(live.region.z).toBe(50);
  });
});

describe("cinderrift (L11-14, behind desert)", () => {
  const def = loadRoomDef("cinderrift");

  it("loads per design: volcanic, lava, canyon amplitude, 12 tables in bounds", () => {
    expect(def.biome).toBe("volcanic");
    expect(def.wind).toBeCloseTo(0.3);
    expect(def.fixedTime).toBeUndefined(); // live sky — the lava glow carries the night
    expect(def.size).toEqual({ w: 288, h: 288 });
    expect(def.terrain.liquid).toBe("lava");
    expect(def.terrain.amplitude).toBe(9);
    // +slag-adits, +forge-gate, +proto-yard-{w,e,s}, +the-unbound, +riderless
    expect(def.spawnTables).toHaveLength(12);
    tablesInBounds(def);
    const boss = def.spawnTables.find((t) => t.id === "furnace-arena")!;
    expect(boss.mobs[0]!.mob).toBe("cinder_golem_boss");
    expect(boss.respawnSec).toBe(900); // contested open-world boss
  });

  it("generates deterministically (grid AND features)", () => {
    const a = new VoxelWorld(def);
    const b = new VoxelWorld(def);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(JSON.stringify(a.features)).toBe(JSON.stringify(b.features));
  });

  it("locks the furnace-arena boss table onto the stamped forge ruin", () => {
    const sim = new RoomSim(def);
    const bind = sim.world.features.bindings.find((b) => b.tableId === "furnace-arena");
    expect(bind).toMatchObject({ x: 144, z: 34 });
    const live = sim.liveSpawnTables().find((t) => t.id === "furnace-arena")!;
    expect(live.region.x).toBe(144);
    expect(live.region.z).toBe(34);
    expect(reg.loot["cache_cinderrift"]).toBeDefined();
  });
});

describe("crypt_depths / Vaults of Morvane (L12-15, ephemeral)", () => {
  const def = loadRoomDef("crypt_depths");

  it("loads per design: ephemeral dungeon with the crypt's lifecycle shape", () => {
    expect(def.name).toBe("Vaults of Morvane");
    expect(def.biome).toBe("dungeon");
    expect(def.persistence).toBe("ephemeral");
    expect(def.fixedTime).toBeCloseTo(0.95);
    expect(def.wind).toBe(0);
    expect(def.size).toEqual({ w: 96, h: 96 });
    expect(def.terrain.seed).toBe(50533);
    // exact lifecycle field shapes, copied from dungeon.json
    expect(def.lifecycle).toEqual({ lifetimeSec: 3000, downtimeSec: 240, warnAtSecLeft: [300, 60, 10] });
    // +drill-field, +workshop, +ossuary-feasters, +wrung-shades, +workshop-threshold
    expect(def.spawnTables).toHaveLength(10);
    tablesInBounds(def);
    const lich = def.spawnTables.find((t) => t.id === "lich-vault")!;
    expect(lich.mobs[0]!.mob).toBe("lich_boss");
    expect(lich.respawnSec).toBe(99999); // once per instance, like the minotaur
  });

  it("generates deterministically (grid AND features)", () => {
    const a = new VoxelWorld(def);
    const b = new VoxelWorld(def);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(JSON.stringify(a.features)).toBe(JSON.stringify(b.features));
  });

  it("registers the three wraith-cell caches on cache_crypt", () => {
    const world = new VoxelWorld(def);
    const cells = world.features.caches.filter((c) => c.table === "cache_crypt");
    expect(cells).toHaveLength(3);
    expect(reg.loot["cache_crypt"]).toBeDefined();
  });

  it("is walkable portal → lich dais, and every cell cache is reachable", () => {
    const world = new VoxelWorld(def);
    const portal = def.portals[0]!;
    // start where arrivals actually land: the paired-portal offset toward
    // spawn (the portal CENTER column sits under the arch lintel, which
    // standY reads as the arch top — same property the bot lib has; bots
    // path to the trigger radius, not the center column)
    const dungeon = loadRoomDef("dungeon");
    const via = dungeon.portals.find((p) => p.target === "crypt_depths")!;
    const arrive = computePortalArrival(def, "dungeon", via)!;
    // the dais top is three 1-block steps up — BFS must land ON it
    expect(reachable(world, arrive.x, arrive.z, 48, 16)).toBe(true);
    // the return portal is enterable: a cell inside its trigger radius
    expect(reachable(world, arrive.x, arrive.z, 48, 89)).toBe(true);
    expect(Math.hypot(48.5 - portal.x, 89.5 - portal.z)).toBeLessThanOrEqual(portal.r);
    // no sealed chambers: each iron-barred cell has its ajar doorway
    for (const cache of world.features.caches.filter((c) => c.table === "cache_crypt")) {
      expect(reachable(world, arrive.x, arrive.z, cache.x, cache.z), `cache ${cache.x},${cache.z}`).toBe(true);
    }
    // and the lich actually stands raised: dais standY = floor + 3
    const floorY = world.standY(48.5, 24.5);
    expect(world.standY(48.5, 16.5)).toBe(floorY + 3);
  });
});

describe("portal graph (auto-pairing both ways)", () => {
  const pairs: Array<[string, string]> = [
    ["forest", "gloomfen"],
    ["desert", "cinderrift"],
    ["dungeon", "crypt_depths"],
  ];

  it.each(pairs)("%s ↔ %s arrive at each other's twin gates", (parentId, childId) => {
    const parent = loadRoomDef(parentId);
    const child = loadRoomDef(childId);
    const down = parent.portals.find((p) => p.target === childId)!;
    const up = child.portals.find((p) => p.target === parentId)!;
    expect(down).toBeDefined();
    expect(up).toBeDefined();
    // parent → child lands beside the child's return portal
    const arriveChild = computePortalArrival(child, parentId, down)!;
    expect(arriveChild).not.toBeNull();
    expect(Math.hypot(arriveChild.x - up.x, arriveChild.z - up.z)).toBeLessThanOrEqual(up.r + 1.5);
    expect(arriveChild.x).toBeGreaterThan(0);
    expect(arriveChild.x).toBeLessThan(child.size.w);
    expect(arriveChild.z).toBeGreaterThan(0);
    expect(arriveChild.z).toBeLessThan(child.size.h);
    // child → parent lands beside the parent's gate
    const arriveParent = computePortalArrival(parent, childId, up)!;
    expect(arriveParent).not.toBeNull();
    expect(Math.hypot(arriveParent.x - down.x, arriveParent.z - down.z)).toBeLessThanOrEqual(down.r + 1.5);
  });

  it("dungeon-depths sits on reachable ground behind the boss hall", () => {
    const dungeon = loadRoomDef("dungeon");
    const world = new VoxelWorld(dungeon);
    const portal = dungeon.portals.find((p) => p.id === "dungeon-depths")!;
    expect(portal).toMatchObject({ x: 46, z: 6 });
    // the arch stamp clears the boss hall's back rim across the passage;
    // target a cell inside the trigger radius (the exact center column sits
    // under the arch lintel, which standY reads as the arch top)
    expect(reachable(world, dungeon.spawn.x, dungeon.spawn.z, 46, 7)).toBe(true);
    expect(Math.hypot(46.5 - portal.x, 7.5 - portal.z)).toBeLessThanOrEqual(portal.r);
    // the return arrival (paired-portal offset toward dungeon spawn) is also reachable
    const depths = loadRoomDef("crypt_depths");
    const up = depths.portals[0]!;
    const arrive = computePortalArrival(dungeon, "crypt_depths", up)!;
    expect(reachable(world, dungeon.spawn.x, dungeon.spawn.z, arrive.x, arrive.z)).toBe(true);
  });
});
