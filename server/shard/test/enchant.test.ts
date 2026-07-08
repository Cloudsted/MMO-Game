/**
 * The enchanter: dialog payload, authoritative pricing, application rules
 * (unmodified equippables only, appliesTo gating, gold), race re-validation.
 * Plus the armor loot tables added alongside her.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { gameConstants, loadRoomDef, RegistryService } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";
import { rollLoot } from "../src/sim/loot.js";

const reg = new RegistryService();
const consts = gameConstants();

const ARMOR_BASIC = ["leather_cap", "leather_jerkin", "leather_boots", "wooden_shield", "lucky_locket"];
const ARMOR_FINE = ["iron_helm", "iron_cuirass", "iron_boots", "iron_shield", "wisp_talisman"];

describe("armor loot tables", () => {
  it("armor_basic and armor_fine roll mintable pieces (fine floors at uncommon)", () => {
    for (let i = 0; i < 150; i++) {
      const basic = rollLoot(reg, consts, "armor_basic");
      expect(basic.items).toHaveLength(1);
      expect(ARMOR_BASIC).toContain(basic.items[0]!.item);
      const fine = rollLoot(reg, consts, "armor_fine");
      expect(fine.items).toHaveLength(1);
      expect(ARMOR_FINE).toContain(fine.items[0]!.item);
      expect(fine.items[0]!.rarity).not.toBe("common"); // minRarity uncommon
    }
  });

  it("armor pieces from loot carry armor stat rolls + durability", () => {
    for (let i = 0; i < 50; i++) {
      const s = rollLoot(reg, consts, "armor_fine").items[0]!;
      const def = reg.item(s.item);
      if (def.kind === "armor") {
        expect(s.stats?.["armor"]).toBeGreaterThan(0.8);
        expect(s.dur).toBeGreaterThan(0);
      } else {
        expect(def.kind).toBe("trinket"); // talisman: no stats, no wear
        expect(s.dur).toBeUndefined();
      }
    }
  });
});

describe("Selvara the Enchanter", () => {
  let sim: RoomSim;
  let npcId: number;

  interface TestClient {
    session: PlayerSession;
    messages: ServerToClient[];
    last<T extends ServerToClient["t"]>(t: T): Extract<ServerToClient, { t: T }> | undefined;
  }

  function makeCharacter(id: string, name: string, inventory: Array<ItemStack | null>, gold = 1000): CharacterSnapshot {
    // spawn at her elbow so nearNpc passes
    return { id, name, level: 1, xp: 0, gold, inventory, x: 78, y: 0, z: 55, yaw: 0, roles: ["player"] };
  }

  function join(id: string, name: string, inventory: Array<ItemStack | null> = [], gold = 1000): TestClient {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, inventory, gold), (m) => messages.push(m));
    return {
      session,
      messages,
      last: (t) => [...messages].reverse().find((m) => m.t === t) as never,
    };
  }

  const sword = (): ItemStack => ({ item: "iron_sword", qty: 1, rarity: "uncommon", stats: { dmg: 1, spd: 1 }, dur: 450, maxDur: 450 });
  const helm = (): ItemStack => ({ item: "iron_helm", qty: 1, rarity: "common", stats: { armor: 1 }, dur: 350, maxDur: 350 });

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("hub"));
    const npc = [...sim.allEntities()].find((e) => e.kind === "npc" && e.npcId === "enchanter");
    expect(npc).toBeDefined();
    npcId = npc!.id;
  });

  it("stands on the hub floor with the enchant menu in her dialog", () => {
    const a = join("c1", "Alice", [sword()]);
    sim.handleTalk(a.session, npcId);
    const dialog = a.last("dialog")!;
    expect(dialog.name).toBe("Selvara the Enchanter");
    expect(dialog.enchant).toBeDefined();
    const offers = dialog.enchant!.offers;
    expect(offers.map((o) => o.id).sort()).toEqual(["hpRegen", "magicTakenPct", "manaRegen", "moveSpeedPct"]);
    expect(offers.every((o) => o.name.endsWith(" I") && o.mag > 0 && o.priceMult > 0)).toBe(true);
  });

  it("applies a tier-1 enchant for the authoritative price", () => {
    const a = join("c1", "Alice", [sword()], 1000);
    sim.handleEnchant(a.session, npcId, 0, "hpRegen");
    const s = a.session.slots[0]!;
    const mod = reg.modifiers["hpRegen"]!;
    expect(s.mods).toEqual({ hpRegen: mod.enchant!.mag });
    // price = ceil(value × rarityMult × priceMult × valueMult + base)
    const def = reg.item("iron_sword");
    const expected = Math.ceil(
      def.value * (reg.rarities["uncommon"]!.mult) * mod.enchant!.priceMult * consts.enchanting.priceValueMult + consts.enchanting.priceBase
    );
    expect(a.session.gold).toBe(1000 - expected);
    // the held sword's new perk aggregates immediately
    expect(a.session.agg.byStat["hpRegen"]).toBeCloseTo(mod.enchant!.mag, 3);
  });

  it("refuses modified items (curses count), non-equippables, and mismatched kinds", () => {
    const cursed: ItemStack = { ...sword(), mods: { slowness: -0.05 } };
    const a = join("c1", "Alice", [cursed, { item: "bread", qty: 1, rarity: "common" }, sword()], 1000);
    sim.handleEnchant(a.session, npcId, 0, "hpRegen"); // already cursed
    expect(a.session.slots[0]!.mods).toEqual({ slowness: -0.05 });
    sim.handleEnchant(a.session, npcId, 1, "hpRegen"); // bread
    expect(a.session.slots[1]!.mods).toBeUndefined();
    sim.handleEnchant(a.session, npcId, 2, "magicTakenPct"); // Warding is armor/trinket-only
    expect(a.session.slots[2]!.mods).toBeUndefined();
    expect(a.session.gold).toBe(1000); // nothing charged
  });

  it("refuses when gold is short and when the offer isn't hers", () => {
    const a = join("c1", "Alice", [sword(), helm()], 5);
    sim.handleEnchant(a.session, npcId, 0, "hpRegen");
    expect(a.session.slots[0]!.mods).toBeUndefined();
    expect(a.session.gold).toBe(5);
    const b = join("c2", "Bob", [sword()], 1000);
    sim.handleEnchant(b.session, npcId, 0, "thorns"); // not on her menu
    expect(b.session.slots[0]!.mods).toBeUndefined();
  });

  it("re-validates the slot at receipt: an invMove race retargets, never dangles", () => {
    const a = join("c1", "Alice", [sword(), { item: "bread", qty: 1, rarity: "common" }], 1000);
    // menu was opened against slot 0, but the player shuffles first
    sim.handleInvMove(a.session, 0, 9);
    sim.handleEnchant(a.session, npcId, 0, "hpRegen"); // slot 0 is now bread… no wait, swap put bread at 1, slot 0 empty
    expect(a.session.slots[0]).toBeNull();
    expect(a.session.gold).toBe(1000);
    sim.handleEnchant(a.session, npcId, 9, "hpRegen"); // the sword's real home
    expect(a.session.slots[9]!.mods).toEqual({ hpRegen: reg.modifiers["hpRegen"]!.enchant!.mag });
  });

  it("ignores the dead and the distant", () => {
    const a = join("c1", "Alice", [sword()], 1000);
    a.session.entity.combat!.act = "dead";
    sim.handleEnchant(a.session, npcId, 0, "hpRegen");
    expect(a.session.slots[0]!.mods).toBeUndefined();
    a.session.entity.combat!.act = "idle";
    a.session.entity.pos.x = 20; // across the plaza
    sim.handleEnchant(a.session, npcId, 0, "hpRegen");
    expect(a.session.slots[0]!.mods).toBeUndefined();
  });
});
