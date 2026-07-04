import { describe, it, expect, beforeEach } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, loadRoomDef, RegistryService } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";
import { rollLoot } from "../src/sim/loot.js";

const reg = new RegistryService();

function makeCharacter(id: string, name: string, x: number, z: number, inventory: Array<ItemStack | null> = []): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory, x, y: 0, z, yaw: 0, roles: ["player"] };
}

interface TestClient {
  session: PlayerSession;
  messages: ServerToClient[];
  last<T extends ServerToClient["t"]>(t: T): Extract<ServerToClient, { t: T }> | undefined;
  all<T extends ServerToClient["t"]>(t: T): Array<Extract<ServerToClient, { t: T }>>;
}

function joinRoom(sim: RoomSim, id: string, name: string, x: number, z: number, inv: Array<ItemStack | null> = []): TestClient {
  const messages: ServerToClient[] = [];
  const session = sim.addPlayer(makeCharacter(id, name, x, z, inv), (m) => messages.push(m));
  return {
    session,
    messages,
    last: (t) => [...messages].reverse().find((m) => m.t === t) as never,
    all: (t) => messages.filter((m) => m.t === t) as never,
  };
}

function spin(ms: number) {
  const start = Date.now();
  while (Date.now() - start < ms) { /* wall-clock FSM timers */ }
}

describe("desert biome", () => {
  it("generates a sand-dominant block world with desert mobs", () => {
    const sim = new RoomSim(loadRoomDef("desert"));
    const counts = new Map<number, number>();
    for (let z = 0; z < sim.def.size.h; z++) {
      for (let x = 0; x < sim.def.size.w; x++) {
        const id = sim.world.get(x, sim.world.surfaceY(x, z), z);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    const total = sim.def.size.w * sim.def.size.h;
    const sand = (counts.get(BLOCK.sand!.id) ?? 0) + (counts.get(BLOCK.sandstone!.id) ?? 0);
    expect(sand / total).toBeGreaterThan(0.5); // mostly sand
    expect((counts.get(BLOCK.grass!.id) ?? 0) / total).toBeLessThan(0.01); // no grass
    expect(counts.get(BLOCK.log!.id) ?? 0).toBeGreaterThan(0); // dead trees stand in the sand
    const mobIds = new Set([...sim.allEntities()].filter((e) => e.kind === "mob").map((e) => e.brain!.mobId));
    expect(mobIds.has("skeleton")).toBe(true);
    expect(mobIds.has("cacto")).toBe(true);
    expect(mobIds.has("raptor")).toBe(true);
  });

  it("keeps the forest byte-identical between boots (generate-once by determinism)", () => {
    const a = new RoomSim(loadRoomDef("forest"));
    const b = new RoomSim(loadRoomDef("forest"));
    expect(Buffer.from(a.world.data).equals(Buffer.from(b.world.data))).toBe(true);
  });
});

describe("dungeon", () => {
  it("pins the clock, spawns the boss, and raises the crypt walls", () => {
    const sim = new RoomSim(loadRoomDef("dungeon"));
    expect(sim.timeOfDay()).toBeCloseTo(0.92);
    const boss = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain!.mobId === "minotaur_boss");
    expect(boss).toBeDefined();
    expect(boss!.health!.hp).toBe(reg.mob("minotaur_boss").hp);
    // perimeter wall bases (stone bricks at z=2 / z=61) and crystal glow
    const bricks = BLOCK.stone_bricks!.id;
    expect(sim.world.get(10, 13, 2)).toBe(bricks);
    expect(sim.world.get(40, 13, 61)).toBe(bricks);
    let crystals = 0;
    for (const id of sim.world.data) if (id === BLOCK.crystal!.id) crystals++;
    expect(crystals).toBeGreaterThan(10);
  });

  it("rolls a guaranteed epic from the boss table", () => {
    for (let i = 0; i < 30; i++) {
      const r = rollLoot(reg, "boss_drops");
      expect(r.gold).toBeGreaterThanOrEqual(80);
      const hasEpic = r.items.some((s) => s.rarity === "epic" && reg.item(s.item).kind === "weapon");
      expect(hasEpic).toBe(true);
    }
  });

  it("builds an eviction report that sends everyone to the hub", () => {
    const sim = new RoomSim(loadRoomDef("dungeon"));
    joinRoom(sim, "c1", "Alice", 32, 56);
    const report = sim.buildEvictionReport();
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ id: "c1", roomId: "hub", x: null });
  });

  it("seals portals when the destination room is down", () => {
    const hub = new RoomSim(loadRoomDef("hub"));
    hub.setRoomStatus("dungeon", false);
    const wire = hub.portalsWire();
    expect(wire.find((p) => p.target === "dungeon")!.open).toBe(false);
    expect(wire.find((p) => p.target === "forest")!.open).toBe(true);
    // standing at the dungeon portal, use is refused with a system message
    const a = joinRoom(hub, "c1", "Alice", 74, 100);
    expect(hub.validatePortalUse(a.session, "hub-dungeon")).toBeNull();
    expect(a.last("chat")?.text).toContain("sealed");
    hub.setRoomStatus("dungeon", true);
    expect(a.last("portalState")).toMatchObject({ target: "dungeon", open: true });
    expect(hub.validatePortalUse(a.session, "hub-dungeon")).toBeTruthy();
  });
});

describe("pvp regions", () => {
  let forest: RoomSim;
  beforeEach(() => {
    forest = new RoomSim(loadRoomDef("forest"));
  });

  it("flags the clearing and nowhere else", () => {
    expect(forest.inPvpZone(28, 118)).toBe(true);
    expect(forest.inPvpZone(80, 146)).toBe(false);
  });

  it("lets players hit each other only inside the zone", () => {
    // both inside the clearing
    const a = joinRoom(forest, "c1", "Alice", 28, 118);
    const b = joinRoom(forest, "c2", "Bob", 28, 119.2);
    forest.handleAttack(a.session, 0, 0); // punch, facing +Z toward Bob
    spin(260); // windup 200 + margin
    forest.tick();
    const hit = b.all("evt").some((m) => m.e.kind === "dmg" && m.e.tgt === b.session.entity.id);
    expect(hit).toBe(true);

    // outside the zone the same swing is a whiff
    const c = joinRoom(forest, "c3", "Cara", 80, 140);
    const d = joinRoom(forest, "c4", "Dane", 80, 141.2);
    forest.handleAttack(c.session, 0, 0);
    spin(260);
    forest.tick();
    const hitOutside = d.all("evt").some((m) => m.e.kind === "dmg" && m.e.tgt === d.session.entity.id);
    expect(hitOutside).toBe(false);
  });

  it("drops free-for-all bags on deaths inside the zone", () => {
    const inv: Array<ItemStack | null> = [{ item: "iron_sword", qty: 1, rarity: "rare" }];
    const a = joinRoom(forest, "c1", "Alice", 28, 118, inv);
    const b = joinRoom(forest, "c2", "Bob", 28, 119, inv);
    forest.applyDamage(b.session.entity, a.session.entity, 9999);
    const bag = [...forest.allEntities()].find((e) => e.kind === "loot")!;
    expect(bag.loot!.owner).toBeNull(); // FFA immediately
  });
});

describe("block building", () => {
  let sim: RoomSim;
  const kit = (): Array<ItemStack | null> => [
    { item: "block_planks", qty: 10, rarity: "common" },
    { item: "block_torch", qty: 5, rarity: "common" },
  ];

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("grounds"));
  });

  it("places and breaks blocks, consuming and refunding items", () => {
    const a = joinRoom(sim, "c1", "Alice", 48, 86, kit());
    const planks = BLOCK.planks!.id;
    const y = sim.world.standY(50, 86); // the air cell on the ground nearby
    sim.handleBlockPlace(a.session, 0, 50, y, 86);
    expect(a.all("blockSet")).toHaveLength(1);
    expect(sim.world.get(50, y, 86)).toBe(planks);
    expect(a.session.slots[0]!.qty).toBe(9);

    sim.handleBlockPlace(a.session, 0, 50, y + 1, 86); // stack a second
    expect(a.session.slots[0]!.qty).toBe(8);
    // can't place into an occupied cell
    sim.handleBlockPlace(a.session, 0, 50, y, 86);
    expect(a.session.slots[0]!.qty).toBe(8);

    sim.handleBlockBreak(a.session, 50, y + 1, 86); // break refunds the item
    expect(sim.world.get(50, y + 1, 86)).toBe(0);
    expect(a.session.slots[0]!.qty).toBe(9);
    // reverting the cell to generated air drops it from the edit overlay
    expect(sim.world.serializeEdits()).toHaveLength(1);
  });

  it("enforces range, ground occupancy, and bedrock protection", () => {
    const a = joinRoom(sim, "c1", "Alice", 48, 86, kit());
    sim.handleBlockPlace(a.session, 0, 5, 13, 5); // far out of reach
    expect(a.all("blockSet")).toHaveLength(0);
    const gy = sim.world.standY(50, 86) - 1; // the ground block itself
    sim.handleBlockPlace(a.session, 0, 50, gy, 86); // occupied cell
    expect(a.all("blockSet")).toHaveLength(0);
    sim.handleBlockBreak(a.session, 48, 0, 85); // bedrock floor is sacred
    expect(a.all("blockSet")).toHaveLength(0);
    // breaking a natural block is allowed here but refunds nothing
    const items = a.session.slots.filter(Boolean).length;
    sim.handleBlockBreak(a.session, 50, gy, 86);
    expect(sim.world.get(50, gy, 86)).toBe(0);
    expect(a.session.slots.filter(Boolean).length).toBe(items);
    expect(sim.world.serializeEdits().some((e) => e.id === 0)).toBe(true);
  });

  it("blocks movement until you jump onto the placed block", () => {
    const a = joinRoom(sim, "c1", "Alice", 48, 86, kit());
    const y = sim.world.standY(49, 86);
    sim.handleBlockPlace(a.session, 0, 49, y, 86);
    sim.handleMove(a.session, 1, 49.5, y, 86, 0, "move"); // walk into it
    expect(a.last("correct")).toBeDefined();
    spin(300); // let the speed budget accumulate (rejects don't reset it)
    sim.handleMove(a.session, 2, 49.5, y + 1, 86, 0, "move"); // jump on top
    expect(a.messages.filter((m) => m.t === "correct")).toHaveLength(1);
  });

  it("persists block edits through a room-state round trip", () => {
    const a = joinRoom(sim, "c1", "Alice", 48, 86, kit());
    const y = sim.world.standY(50, 86);
    sim.handleBlockPlace(a.session, 0, 50, y, 86);
    sim.handleBlockPlace(a.session, 0, 50, y + 1, 86);
    const state = sim.buildRoomState();
    expect(state.blocks).toHaveLength(2);
    const resumed = new RoomSim(loadRoomDef("grounds"), state);
    expect(resumed.world.get(50, y, 86)).toBe(BLOCK.planks!.id);
    expect(resumed.world.get(50, y + 1, 86)).toBe(BLOCK.planks!.id);
  });

  it("refuses building outside building-enabled rooms and admin-reverts", () => {
    const hub = new RoomSim(loadRoomDef("hub"));
    const h = joinRoom(hub, "c9", "Hubber", 64, 64, kit());
    hub.handleBlockPlace(h.session, 0, 65, hub.world.standY(65, 64), 64);
    expect(h.all("blockSet")).toHaveLength(0);

    const a = joinRoom(sim, "c1", "Alice", 48, 86, kit());
    a.session.character.roles.push("admin");
    const y = sim.world.standY(50, 86);
    sim.handleBlockPlace(a.session, 0, 50, y, 86);
    expect(sim.world.get(50, y, 86)).toBe(BLOCK.planks!.id);
    sim.handleChat(a.session, "/clearblocks");
    expect(sim.world.serializeEdits()).toHaveLength(0);
    expect(sim.world.get(50, y, 86)).toBe(0); // back to generated air
  });
});
