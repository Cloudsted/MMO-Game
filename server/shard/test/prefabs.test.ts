/**
 * Prefab/scatter system + 480² wild-room retune: deterministic placement,
 * spacing/exclusion rules, loot-cache lifecycle (spawn/claim/respawn with
 * fake timers), spawn-table bindings, and the /prefab admin command.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { isSolidBlock, loadRoomDef, RegistryService, RoomDefSchema } from "@fantasy-mmo/common";
import { PREFABS, stampPrefab } from "../src/sim/prefabs.js";
import { RoomSim } from "../src/sim/room.js";
import { VoxelWorld } from "../src/sim/voxel.js";
import { Builder } from "../src/sim/voxelstructures.js";

const reg = new RegistryService();

function makeCharacter(
  id: string,
  name: string,
  x: number,
  z: number,
  roles: string[] = ["player"],
  inventory: Array<ItemStack | null> = []
): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory, x, y: 0, z, yaw: 0, roles };
}

function joinRoom(sim: RoomSim, id: string, name: string, x: number, z: number, roles?: string[]) {
  const messages: ServerToClient[] = [];
  const session = sim.addPlayer(makeCharacter(id, name, x, z, roles), (m) => messages.push(m));
  return {
    session,
    messages,
    last: <T extends ServerToClient["t"]>(t: T) =>
      [...messages].reverse().find((m) => m.t === t) as Extract<ServerToClient, { t: T }> | undefined,
  };
}

/** Seeded scatter test room: flat enough that every catalog prefab can site. */
function scatterDef(prefabs: unknown[], overrides: Record<string, unknown> = {}) {
  return RoomDefSchema.parse({
    id: "test-scatter",
    name: "Scatter Proving Grounds",
    type: "wilderness",
    biome: "grass",
    persistence: "stateful",
    size: { w: 200, h: 200 },
    spawn: { x: 100, z: 180, yaw: 0 },
    terrain: { kind: "blocks", seed: 424242, base: 12, amplitude: 3, frequency: 0.02, waterLevel: 10 },
    flags: { safeZone: false, buildingEnabled: false, pvp: false },
    portals: [{ id: "test-portal", label: "Out", target: "hub", x: 100, z: 20, r: 2.2 }],
    spawnTables: [],
    prefabs,
    npcs: [],
    ...overrides,
  });
}

describe("prefab scatter", () => {
  it("generates deterministically: same def twice → identical grid AND features", () => {
    const def = scatterDef([
      { prefab: "ruined_watchtower", count: 2, minSpacing: 40 },
      { prefab: "abandoned_camp", count: 3, minSpacing: 30 },
      { prefab: "wayshrine", count: 2, minSpacing: 50, nearPortals: true },
      { prefab: "fallen_giant", count: 2, minSpacing: 40 },
    ]);
    const a = new VoxelWorld(def);
    const b = new VoxelWorld(def);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(JSON.stringify(a.features)).toBe(JSON.stringify(b.features));
    expect(a.features.placements.length).toBeGreaterThan(0);
  });

  it("respects minSpacing and the 12-block spawn/portal exclusion", () => {
    const def = scatterDef([{ prefab: "ruined_watchtower", count: 4, minSpacing: 50 }]);
    const world = new VoxelWorld(def);
    const placed = world.features.placements;
    expect(placed.length).toBeGreaterThanOrEqual(2); // seeded: room has space for 2+
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const d = Math.hypot(placed[i]!.x - placed[j]!.x, placed[i]!.z - placed[j]!.z);
        expect(d, `pair ${i}/${j}`).toBeGreaterThanOrEqual(50);
      }
    }
    // footprint rect (not just center) must be ≥12 from spawn and portals
    for (const p of placed) {
      const fp = PREFABS[p.prefab]!.footprint;
      const rw = p.rot % 2 ? fp.d : fp.w;
      const rd = p.rot % 2 ? fp.w : fp.d;
      const rectDist = (px: number, pz: number) => {
        const dx = Math.max(p.ox - px, 0, px - (p.ox + rw - 1));
        const dz = Math.max(p.oz - pz, 0, pz - (p.oz + rd - 1));
        return Math.hypot(dx, dz);
      };
      expect(rectDist(def.spawn.x, def.spawn.z)).toBeGreaterThanOrEqual(12);
      for (const portal of def.portals) {
        expect(rectDist(portal.x, portal.z)).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("every cataloged prefab stamps without throwing (all 14)", () => {
    expect(Object.keys(PREFABS)).toHaveLength(14);
    const entries = Object.keys(PREFABS).map((id) => ({ prefab: id, count: 1, minSpacing: 0 }));
    const def = scatterDef(entries, { size: { w: 320, h: 320 }, spawn: { x: 160, z: 300, yaw: 0 } });
    const world = new VoxelWorld(def); // throws on any bad block name / oob math
    // slope/water-dependent prefabs may under-fill on this terrain; the rest place
    expect(world.features.placements.length).toBeGreaterThanOrEqual(10);
    for (const u of world.features.underfill) {
      expect(u.placed).toBeLessThan(u.wanted); // under-fill is reported, not silent
    }
  });
});

describe("prefab loot caches", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Flat room with exactly one watchtower → exactly one cache. */
  function cacheSim() {
    const def = scatterDef([{ prefab: "ruined_watchtower", count: 1, minSpacing: 0 }], {
      size: { w: 96, h: 96 },
      spawn: { x: 10, z: 10, yaw: 0 },
      terrain: { kind: "blocks", seed: 777, base: 12, amplitude: 0, frequency: 0.02 },
      portals: [],
    });
    const sim = new RoomSim(def);
    expect(sim.allCaches()).toHaveLength(1);
    return sim;
  }

  function bagNear(sim: RoomSim, x: number, z: number) {
    for (const e of sim.allEntities()) {
      if (e.kind === "loot" && Math.abs(e.pos.x - x) <= 1.5 && Math.abs(e.pos.z - z) <= 1.5) return e;
    }
    return null;
  }

  function ticks(sim: RoomSim, n: number) {
    for (let i = 0; i < n; i++) sim.tick();
  }

  it("spawns an unowned never-expiring bag, respawns after loot + delay + no player near", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
    const sim = cacheSim();
    const cache = sim.allCaches()[0]!;

    // 1. stocked on boot (cache sweep runs every 10th tick)
    ticks(sim, 10);
    const bag = bagNear(sim, cache.x, cache.z);
    expect(bag).not.toBeNull();
    expect(bag!.loot!.owner).toBeNull(); // unowned
    expect(bag!.loot!.expireAt).toBeNull(); // cache bags never expire

    // 2. loot it empty — pickup range is 3D, so the looter must actually
    // stand at platform height (the climb path is proven separately below)
    const c = joinRoom(sim, "c1", "Looter", cache.x, cache.z);
    c.session.entity.pos.y = bag!.pos.y;
    sim.handlePickup(c.session, bag!.id);
    expect(bagNear(sim, cache.x, cache.z)).toBeNull();
    ticks(sim, 10); // sweep notices the bag vanished → lastLootedAt = now
    expect(sim.allCaches()[0]!.lastLootedAt).toBeGreaterThan(0);

    // 3. respawn window elapsed but the looter is still standing there → no bag
    vi.advanceTimersByTime((cache.respawnSec + 30) * 1000);
    ticks(sim, 10);
    expect(bagNear(sim, cache.x, cache.z)).toBeNull();

    // 4. player walks away → the cache restocks
    c.session.entity.pos.x = cache.x + 60;
    ticks(sim, 10);
    const again = bagNear(sim, cache.x, cache.z);
    expect(again).not.toBeNull();
    expect(again!.loot!.owner).toBeNull();
  });

  it("persists lastLootedAt in RoomState so restarts don't refill instantly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000_000);
    const sim = cacheSim();
    const cache = sim.allCaches()[0]!;
    ticks(sim, 10);
    const bag = bagNear(sim, cache.x, cache.z)!;
    const c = joinRoom(sim, "c1", "Looter", cache.x, cache.z);
    c.session.entity.pos.y = bag.pos.y;
    sim.handlePickup(c.session, bag.id);
    ticks(sim, 10);
    const state = sim.buildRoomState();
    expect(state.caches[cache.key]).toBe(sim.allCaches()[0]!.lastLootedAt);

    // reboot from the snapshot: cache must NOT restock before its window
    const sim2 = new RoomSim(sim.def, state);
    expect(sim2.allCaches()[0]!.lastLootedAt).toBe(state.caches[cache.key]);
    for (let i = 0; i < 20; i++) sim2.tick();
    expect(bagNear(sim2, cache.x, cache.z)).toBeNull();
  });
});

describe("watchtower climb path", () => {
  /** Flat empty proving ground; the tower is stamped manually per case. */
  function flatWorld() {
    const def = scatterDef([], {
      size: { w: 96, h: 96 },
      spawn: { x: 10, z: 10, yaw: 0 },
      terrain: { kind: "blocks", seed: 777, base: 12, amplitude: 0, frequency: 0.02 },
      portals: [],
    });
    return { def, world: new VoxelWorld(def) };
  }

  /**
   * Conservative movement BFS over (cell, feetY) states: 4-dir level walks,
   * 1-block jump mounts (which additionally need a free cell above the head
   * at BOTH the take-off and landing columns), drops up to 3 with a clear
   * fall corridor. If THIS reaches the target, real physics (jump apex
   * 1.28 m, height <1.8) certainly does.
   */
  function canClimb(world: VoxelWorld, sx: number, sz: number, tx: number, tz: number, ty: number): boolean {
    const free = (x: number, y: number, z: number) => !isSolidBlock(world.get(x, y, z));
    const standing = (x: number, y: number, z: number) => !free(x, y - 1, z) && free(x, y, z) && free(x, y + 1, z);
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const start = { x: sx, y: world.floorY(sx + 0.5, sz + 0.5), z: sz };
    const seen = new Set([key(start.x, start.y, start.z)]);
    const queue = [start];
    while (queue.length > 0) {
      const c = queue.shift()!;
      if (c.x === tx && c.z === tz && c.y === ty) return true;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = c.x + dx;
        const nz = c.z + dz;
        for (const ny of [c.y + 1, c.y, c.y - 1, c.y - 2, c.y - 3]) {
          if (ny < 1 || !standing(nx, ny, nz)) continue;
          if (ny === c.y + 1 && (!free(c.x, c.y + 2, c.z) || !free(nx, c.y + 2, nz))) continue; // jump arc headroom
          if (ny < c.y) {
            let corridor = true;
            for (let y = ny + 2; y <= c.y + 1 && corridor; y++) corridor = free(nx, y, nz);
            if (!corridor) continue;
          }
          const k = key(nx, ny, nz);
          if (!seen.has(k)) {
            seen.add(k);
            queue.push({ x: nx, y: ny, z: nz });
          }
        }
      }
    }
    return false;
  }

  it("has a jumpable ground → cache path at every rotation × ruin level", () => {
    for (const rot of [0, 1, 2, 3] as const) {
      for (const ruin of [0, 1, 2] as const) {
        const { def, world } = flatWorld();
        const hooks = stampPrefab(new Builder(world, def), "ruined_watchtower", 40, 40, rot, ruin);
        const cache = hooks.lootCache!;
        expect(
          canClimb(world, 36, 36, Math.floor(cache.x), Math.floor(cache.z), cache.y),
          `rot ${rot} ruin ${ruin}: no path from the ground to the cache`
        ).toBe(true);
      }
    }
  });
});

describe("480² retune", () => {
  it("forest: size, spawn, arena, and all 11 spawn tables in bounds with known mobs", () => {
    const def = loadRoomDef("forest");
    expect(def.size).toEqual({ w: 480, h: 480 });
    expect(def.spawn.x).toBe(240);
    expect(def.spawn.z).toBe(466);
    expect(def.regions[0]).toMatchObject({ x: 84, z: 354, r: 12, pvp: true });
    expect(def.portals[0]).toMatchObject({ x: 240, z: 472 });
    expect(def.spawnTables).toHaveLength(11); // +redcap-hall, +camp-livestock (Thornhollow Company)
    const ids = def.spawnTables.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "boar-meadow-s", "boar-meadow-e", "wolf-den-n", "fen-approach-spiders",
        "bandit-camp", "redcap-hall", "camp-livestock",
      ])
    );
    for (const t of def.spawnTables) {
      expect(t.region.x - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.x + t.region.r, t.id).toBeLessThanOrEqual(480);
      expect(t.region.z - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.z + t.region.r, t.id).toBeLessThanOrEqual(480);
      for (const m of t.mobs) expect(reg.mobs[m.mob], `${t.id}: ${m.mob}`).toBeDefined();
    }
  });

  it("desert: size, spawn, and 6 tables in bounds with known mobs", () => {
    const def = loadRoomDef("desert");
    expect(def.size).toEqual({ w: 480, h: 480 });
    expect(def.spawn.x).toBe(240);
    expect(def.spawn.z).toBe(466);
    expect(def.spawnTables).toHaveLength(6);
    for (const t of def.spawnTables) {
      expect(t.region.x - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.x + t.region.r, t.id).toBeLessThanOrEqual(480);
      expect(t.region.z - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.z + t.region.r, t.id).toBeLessThanOrEqual(480);
      for (const m of t.mobs) expect(reg.mobs[m.mob], `${t.id}: ${m.mob}`).toBeDefined();
    }
  });

  it("forest generates with full scatter and binds bandit/spider tables to their prefab sites", () => {
    const sim = new RoomSim(loadRoomDef("forest"));
    const f = sim.world.features;
    expect(f.underfill).toEqual([]); // every configured prefab placed
    const boundIds = f.bindings.map((b) => b.tableId);
    expect(boundIds).toEqual(expect.arrayContaining(["bandit-camp", "fen-approach-spiders"]));
    // live tables reflect the binding (region re-centered onto the prefab)
    const banditDef = loadRoomDef("forest").spawnTables.find((t) => t.id === "bandit-camp")!;
    const banditLive = sim.liveSpawnTables().find((t) => t.id === "bandit-camp")!;
    const bind = f.bindings.find((b) => b.tableId === "bandit-camp")!;
    expect(banditLive.region.x).toBe(bind.x);
    expect(banditLive.region.z).toBe(bind.z);
    // the fort anchors the camp *near* its authored center, not across the map
    expect(Math.hypot(bind.x - banditDef.region.x, bind.z - banditDef.region.z)).toBeLessThanOrEqual(45);
    expect(sim.allCaches().length).toBeGreaterThan(5);
  });

  it("desert generates with its scatter config placed", () => {
    const sim = new RoomSim(loadRoomDef("desert"));
    expect(sim.world.features.underfill).toEqual([]);
    expect(sim.world.features.placements.length).toBe(10); // 2+1+1+3+3
    expect(sim.allCaches().length).toBeGreaterThan(3);
  });
});

describe("/prefab admin command", () => {
  it("is role-gated like every admin command", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const c = joinRoom(sim, "pleb", "Pleb", 64, 64);
    sim.handleChat(c.session, "/prefab wayshrine");
    expect(c.last("chat")?.text).toBe("Unknown command.");
    expect(sim.world.edits.size).toBe(0);
  });

  it("rejects unknown ids with the prefab list", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const c = joinRoom(sim, "adm", "Admin", 64, 64, ["player", "admin"]);
    sim.handleChat(c.session, "/prefab not_a_prefab");
    const msg = c.last("chat");
    expect(msg?.text).toContain("Unknown prefab");
    expect(msg?.text).toContain("ruined_watchtower");
    expect(sim.world.edits.size).toBe(0);
  });

  it("stamps through the edit overlay: persists in RoomState, /clearblocks reverts", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const c = joinRoom(sim, "adm", "Admin", 64, 64, ["player", "admin"]);
    sim.handleChat(c.session, "/prefab ruined_watchtower 1");
    expect(sim.world.edits.size).toBeGreaterThan(0);
    // every edit is ownerless (admin stamp, not player building)
    for (const e of sim.world.edits.values()) expect(e.owner).toBeNull();
    // persists like any block edit
    const state = sim.buildRoomState();
    expect(state.blocks.length).toBe(sim.world.edits.size);
    // /clearblocks wipes the canvas
    sim.handleChat(c.session, "/clearblocks");
    expect(sim.world.edits.size).toBe(0);
  });
});
