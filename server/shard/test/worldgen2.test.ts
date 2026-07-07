/**
 * Worldgen overhaul — blocks 26-50, terrain.liquid, swamp/volcanic biome
 * branches, the atelier room, and the /room admin command.
 *
 * The existing grass/desert/dungeon generation branches are test-locked
 * byte-identical elsewhere (phase5: "forest byte-identical between boots");
 * everything here exercises only the NEW paths.
 */
import { describe, it, expect } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, BLOCKS, loadRoomDef, RegistryService, RoomDefSchema } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";
import { VoxelWorld } from "../src/sim/voxel.js";

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

const swampDef = RoomDefSchema.parse({
  id: "test-swamp",
  name: "Test Fen",
  type: "wilderness",
  biome: "swamp",
  persistence: "stateful",
  size: { w: 64, h: 64 },
  spawn: { x: 32, z: 32, yaw: 0 },
  terrain: {
    kind: "blocks",
    seed: 91177,
    base: 12,
    amplitude: 2.5,
    frequency: 0.025,
    waterLevel: 11,
    liquid: "murk_water",
    treeDensity: 1.5,
  },
  flags: { safeZone: false, buildingEnabled: false, pvp: false },
  portals: [],
  spawnTables: [],
  npcs: [],
});

const volcanicDef = RoomDefSchema.parse({
  id: "test-rift",
  name: "Test Rift",
  type: "wilderness",
  biome: "volcanic",
  persistence: "stateful",
  size: { w: 64, h: 64 },
  spawn: { x: 32, z: 32, yaw: 0 },
  terrain: {
    kind: "blocks",
    seed: 66091,
    base: 11,
    amplitude: 4,
    frequency: 0.028,
    waterLevel: 9,
    liquid: "lava",
    treeDensity: 1,
  },
  flags: { safeZone: false, buildingEnabled: false, pvp: false },
  portals: [],
  spawnTables: [],
  npcs: [],
});

function countBlocks(world: VoxelWorld): Map<number, number> {
  const counts = new Map<number, number>();
  for (const id of world.data) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

describe("block registry (ids 26-50)", () => {
  it("loads all 25 new blocks with stable ids", () => {
    const expected: Array<[number, string]> = [
      [26, "mud"], [27, "murk_water"], [28, "pale_log"], [29, "dead_leaves"], [30, "reeds"],
      [31, "vines"], [32, "glow_shroom"], [33, "web"], [34, "dark_stone"], [35, "dark_bricks"],
      [36, "obsidian"], [37, "ash"], [38, "charred_log"], [39, "ember_crystal"], [40, "bone_block"],
      [41, "snow"], [42, "ice"], [43, "blue_crystal"], [44, "marble"], [45, "bookshelf"],
      [46, "hay"], [47, "palisade"], [48, "iron_bars"], [49, "lantern"], [50, "banner"],
    ];
    for (const [id, name] of expected) {
      expect(BLOCKS[id]?.name, `block id ${id}`).toBe(name);
      expect(BLOCK[name]?.id).toBe(id);
    }
    // liquids and emitters carry the right flags
    expect(BLOCK.murk_water!.cull).toBe("liquid");
    expect(BLOCK.murk_water!.solid).toBe(false);
    expect(BLOCK.glow_shroom!.light).toBe(9);
    expect(BLOCK.ember_crystal!.light).toBe(12);
    expect(BLOCK.blue_crystal!.light).toBe(11);
    expect(BLOCK.lantern!.light).toBe(13);
    expect(BLOCK.iron_bars!.cull).toBe("cutout");
  });

  it("cross-refs the new block items against the registry", () => {
    // RegistryService throws on unknown item.block at construction — reg
    // existing proves the whole file cross-checks; spot-check the new seven
    for (const [item, block] of [
      ["block_dark_bricks", "dark_bricks"], ["block_marble", "marble"], ["block_lantern", "lantern"],
      ["block_palisade", "palisade"], ["block_hay", "hay"], ["block_iron_bars", "iron_bars"],
      ["block_bookshelf", "bookshelf"],
    ] as const) {
      expect(reg.items[item]?.block).toBe(block);
      expect(BLOCK[block]).toBeDefined();
    }
  });
});

describe("swamp biome", () => {
  it("generates deterministically (same seed, twice, identical bytes)", () => {
    const a = new VoxelWorld(swampDef);
    const b = new VoxelWorld(swampDef);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it("fills the water level with murk_water and grows pale trees on mud", () => {
    const world = new VoxelWorld(swampDef);
    const counts = countBlocks(world);
    expect(counts.get(BLOCK.murk_water!.id) ?? 0).toBeGreaterThan(0); // configured liquid...
    expect(counts.get(BLOCK.water!.id) ?? 0).toBe(0); // ...not plain water
    expect(counts.get(BLOCK.mud!.id) ?? 0).toBeGreaterThan(500); // mud surface + subsoil
    expect(counts.get(BLOCK.pale_log!.id) ?? 0).toBeGreaterThan(0); // dead trees
    expect(counts.get(BLOCK.dead_leaves!.id) ?? 0).toBeGreaterThan(0); // thin caps
    expect(counts.get(BLOCK.log!.id) ?? 0).toBe(0); // no oak trunks in the fen
    expect(counts.get(BLOCK.leaves!.id) ?? 0).toBe(0);
    // liquid sits exactly at/below waterLevel over flooded columns
    let flooded = 0;
    for (let z = 0; z < 64 && flooded === 0; z++) {
      for (let x = 0; x < 64 && flooded === 0; x++) {
        if (world.terrainHeight(swampDef, x, z) < 11) {
          expect(world.get(x, 11, z)).toBe(BLOCK.murk_water!.id);
          flooded++;
        }
      }
    }
    expect(flooded).toBeGreaterThan(0);
  });

  it("scatters reeds near the murk and glowcaps in the dark", () => {
    const world = new VoxelWorld(swampDef);
    const counts = countBlocks(world);
    expect(counts.get(BLOCK.reeds!.id) ?? 0).toBeGreaterThan(0);
    expect(counts.get(BLOCK.glow_shroom!.id) ?? 0).toBeGreaterThan(0);
    expect(counts.get(BLOCK.vines!.id) ?? 0).toBeGreaterThan(0);
  });
});

describe("volcanic biome", () => {
  it("generates deterministically (same seed, twice, identical bytes)", () => {
    const a = new VoxelWorld(volcanicDef);
    const b = new VoxelWorld(volcanicDef);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it("fills low runs with lava over a dark_stone base", () => {
    const world = new VoxelWorld(volcanicDef);
    const counts = countBlocks(world);
    expect(counts.get(BLOCK.lava!.id) ?? 0).toBeGreaterThan(0); // configured liquid
    expect(counts.get(BLOCK.water!.id) ?? 0).toBe(0);
    expect(counts.get(BLOCK.dark_stone!.id) ?? 0).toBeGreaterThan(counts.get(BLOCK.stone!.id) ?? 0);
    expect(counts.get(BLOCK.obsidian!.id) ?? 0).toBeGreaterThan(0); // outcrops
    expect(counts.get(BLOCK.ash!.id) ?? 0).toBeGreaterThan(0); // drifts
    expect(counts.get(BLOCK.charred_log!.id) ?? 0).toBeGreaterThan(0); // snags
    expect(counts.get(BLOCK.leaves!.id) ?? 0).toBe(0); // snags carry no canopy
    expect(counts.get(BLOCK.dead_leaves!.id) ?? 0).toBe(0);
    expect(counts.get(BLOCK.grass!.id) ?? 0).toBe(0);
  });
});

describe("terrain.liquid default", () => {
  it("leaves existing rooms on plain water", () => {
    expect(loadRoomDef("forest").terrain.liquid).toBe("water");
    expect(loadRoomDef("desert").terrain.liquid).toBe("water");
  });
});

describe("atelier", () => {
  it("loads as a flat portal-less building room", () => {
    const def = loadRoomDef("atelier");
    expect(def.type).toBe("building");
    expect(def.flags.buildingEnabled).toBe(true);
    expect(def.portals).toHaveLength(0);
    expect(def.spawnTables).toHaveLength(0);
    expect(def.npcs).toHaveLength(0);
    const world = new VoxelWorld(def);
    // amplitude 0 = a flat slab at base height everywhere
    const y = world.standY(def.spawn.x, def.spawn.z);
    expect(y).toBe(def.terrain.base + 1);
    for (const [x, z] of [[5, 5], [120, 8], [64, 120], [100, 100]] as const) {
      expect(world.standY(x, z)).toBe(y);
    }
  });
});

describe("/room admin command", () => {
  it("transfers an admin to a known open room", () => {
    const sim = new RoomSim(loadRoomDef("hub"));
    const requests: Array<{ session: PlayerSession; target: string }> = [];
    sim.onTransferRequest = (session, target) => requests.push({ session, target });
    const c = joinRoom(sim, "adm1", "Admin", 64, 64, ["player", "admin"]);
    sim.handleChat(c.session, "/room atelier");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.target).toBe("atelier");
  });

  it("rejects unknown and closed rooms with a system message", () => {
    const sim = new RoomSim(loadRoomDef("hub"));
    const requests: string[] = [];
    sim.onTransferRequest = (_s, target) => requests.push(target);
    const c = joinRoom(sim, "adm2", "Admin", 64, 64, ["player", "admin"]);

    sim.handleChat(c.session, "/room not-a-room");
    let msg = c.last("chat");
    expect(msg?.channel).toBe("system");
    expect(msg?.text).toContain("Unknown room");

    sim.setRoomStatus("atelier", false);
    sim.handleChat(c.session, "/room atelier");
    msg = c.last("chat");
    expect(msg?.text).toContain("closed");
    expect(requests).toHaveLength(0);
  });

  it("stays role-gated like every admin command", () => {
    const sim = new RoomSim(loadRoomDef("hub"));
    const requests: string[] = [];
    sim.onTransferRequest = (_s, target) => requests.push(target);
    const c = joinRoom(sim, "pleb", "Pleb", 64, 64);
    sim.handleChat(c.session, "/room atelier");
    expect(requests).toHaveLength(0);
    expect(c.last("chat")?.text).toBe("Unknown command.");
  });
});
