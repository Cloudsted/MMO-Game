import { describe, it, expect, beforeEach } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { gameConstants, loadRoomDef } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";

function makeCharacter(
  id: string,
  name: string,
  equipment?: Array<ItemStack | null>,
  inventory: Array<ItemStack | null> = []
): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory, equipment, x: 64, y: 0, z: 64, yaw: 0, roles: ["player"] };
}

describe("equipment slots", () => {
  let sim: RoomSim;

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("hub"));
  });

  function join(id: string, name: string, equipment?: Array<ItemStack | null>, inventory: Array<ItemStack | null> = []) {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, equipment, inventory), (m) => messages.push(m));
    return {
      session,
      messages,
      last: <T extends ServerToClient["t"]>(t: T) =>
        [...messages].reverse().find((m) => m.t === t) as Extract<ServerToClient, { t: T }> | undefined,
    };
  }

  const cap = (): ItemStack => ({ item: "leather_cap", qty: 1, rarity: "common" });
  const helm = (): ItemStack => ({ item: "iron_helm", qty: 1, rarity: "rare" });
  const charm = (): ItemStack => ({ item: "lucky_locket", qty: 1, rarity: "common" });
  const sword = (): ItemStack => ({ item: "iron_sword", qty: 1, rarity: "common" });

  it("hydrates persisted equipment with stat/durability backfill", () => {
    const a = join("c1", "Alice", [cap(), null, null, null, null]);
    const worn = a.session.equipment[0]!;
    expect(worn.item).toBe("leather_cap");
    expect(worn.stats?.["armor"]).toBeDefined(); // ensureItemInstance backfilled
    expect(worn.dur).toBeGreaterThan(0);
    expect(worn.mods).toBeUndefined(); // never a retroactive mod lottery
    const inv = a.last("inv");
    expect(inv?.equipment[0]?.item).toBe("leather_cap");
  });

  it("returns slot-mismatched persisted gear to the bags", () => {
    // a helm persisted in the chest slot (def changed / bad data) → inventory
    const a = join("c1", "Alice", [null, helm(), null, null, null]);
    expect(a.session.equipment[1]).toBeNull();
    expect(a.session.slots.some((s) => s?.item === "iron_helm")).toBe(true);
  });

  it("joins fine with no equipment field at all (legacy row)", () => {
    const a = join("c1", "Alice", undefined);
    expect(a.session.equipment).toHaveLength(5);
    expect(a.session.equipment.every((s) => s === null)).toBe(true);
  });

  it("equips from inventory, swaps in place, and unequips to a free slot", () => {
    const a = join("c1", "Alice", undefined, [cap(), helm()]);
    sim.handleEquipSlot(a.session, "head", 0);
    expect(a.session.equipment[0]?.item).toBe("leather_cap");
    expect(a.session.slots[0]).toBeNull();

    // swap: helm in, cap lands in the vacated inventory index
    sim.handleEquipSlot(a.session, "head", 1);
    expect(a.session.equipment[0]?.item).toBe("iron_helm");
    expect(a.session.slots[1]?.item).toBe("leather_cap");

    sim.handleEquipSlot(a.session, "head"); // unequip
    expect(a.session.equipment[0]).toBeNull();
    expect(a.session.slots.filter((s) => s !== null).map((s) => s!.item).sort()).toEqual([
      "iron_helm",
      "leather_cap",
    ]);
  });

  it("refuses unequip into a full inventory", () => {
    const a = join("c1", "Alice", [cap(), null, null, null, null]);
    for (let i = 0; i < a.session.slots.length; i++) {
      a.session.slots[i] = { item: "bread", qty: 1, rarity: "common" };
    }
    sim.handleEquipSlot(a.session, "head");
    expect(a.session.equipment[0]?.item).toBe("leather_cap"); // still worn
    const chat = a.last("chat");
    expect(chat?.text).toMatch(/bags are full/i);
  });

  it("refuses weapons in every slot and mismatched armor slots", () => {
    const a = join("c1", "Alice", undefined, [sword(), helm()]);
    sim.handleEquipSlot(a.session, "offhand", 0); // weapon → offhand: never
    expect(a.session.equipment[4]).toBeNull();
    sim.handleEquipSlot(a.session, "chest", 1); // helm → chest: slot mismatch
    expect(a.session.equipment[1]).toBeNull();
    expect(a.session.slots[0]?.item).toBe("iron_sword");
    expect(a.session.slots[1]?.item).toBe("iron_helm");
  });

  it("equips trinkets to the offhand only", () => {
    const a = join("c1", "Alice", undefined, [charm()]);
    sim.handleEquipSlot(a.session, "head", 0);
    expect(a.session.equipment[0]).toBeNull();
    sim.handleEquipSlot(a.session, "offhand", 0);
    expect(a.session.equipment[4]?.item).toBe("lucky_locket");
  });

  it("ignores equip requests from the dead", () => {
    const a = join("c1", "Alice", undefined, [cap()]);
    a.session.entity.combat!.act = "dead";
    sim.handleEquipSlot(a.session, "head", 0);
    expect(a.session.equipment[0]).toBeNull();
  });

  it("death drops worn equipment into the bag alongside the inventory (keep-inventory OFF)", () => {
    // the drop path is parked behind combat.keepInventoryOnDeath — flip it
    // off so the deathDropsEquipment branch stays covered
    gameConstants().combat.keepInventoryOnDeath = false;
    try {
      const a = join("c1", "Alice", [cap(), null, null, null, charm()], [sword()]);
      const b = join("c2", "Bob");
      sim.applyDamage(b.session.entity, a.session.entity, 99999);
      expect(a.last("died")).toBeDefined();
      expect(a.session.equipment.every((s) => s === null)).toBe(true);
      expect(a.session.slots.every((s) => s === null)).toBe(true);
      const bag = [...sim.allEntities()].find((e) => e.kind === "loot");
      expect(bag).toBeDefined();
      const items = bag!.loot!.items.map((s) => s.item).sort();
      expect(items).toEqual(["iron_sword", "leather_cap", "lucky_locket"]);
    } finally {
      gameConstants().combat.keepInventoryOnDeath = true;
    }
  });

  it("keep-inventory (the shipped default) leaves worn equipment on the corpse's owner", () => {
    const a = join("c1", "Alice", [cap(), null, null, null, charm()], [sword()]);
    const b = join("c2", "Bob");
    sim.applyDamage(b.session.entity, a.session.entity, 99999);
    expect(a.last("died")).toBeDefined();
    expect(a.session.equipment[0]?.item).toBe("leather_cap"); // still worn
    expect(a.session.slots.some((s) => s?.item === "iron_sword")).toBe(true);
    expect([...sim.allEntities()].find((e) => e.kind === "loot")).toBeUndefined();
  });

  it("persistence reports carry equipment", () => {
    const a = join("c1", "Alice", [cap(), null, null, null, null]);
    const report = sim.buildReport(a.session);
    expect((report[0] as { equipment?: Array<ItemStack | null> }).equipment?.[0]?.item).toBe("leather_cap");
    const eviction = sim.buildEvictionReport();
    expect((eviction[0] as { equipment?: Array<ItemStack | null> }).equipment?.[0]?.item).toBe("leather_cap");
  });
});
