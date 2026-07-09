/**
 * Deep magic weaving: the enchanter dialog payload, authoritative tiered
 * pricing, the capacity rules (tier cap by item + weaver, enchant slots, no
 * in-place upgrade), removal (strip a woven perk / lift a curse), the master
 * enchanter's higher tier, and the no-gold-mint invariant. Plus the armor loot
 * tables the enchanter shipped with.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { gameConstants, loadRoomDef, RegistryService } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";
import { rollLoot } from "../src/sim/loot.js";

const reg = new RegistryService();
const consts = gameConstants();

/** All 12 perks Selvara/Ysolde weave. */
const WEAVABLE = [
  "hpRegen", "manaRegen", "moveSpeedPct", "magicTakenPct", "maxHp", "maxMana",
  "dmgPct", "meleeTakenPct", "rangedTakenPct", "lifesteal", "goldFind", "thorns",
];

const ARMOR_BASIC = ["leather_cap", "leather_jerkin", "leather_boots", "wooden_shield", "lucky_locket"];
const ARMOR_FINE = ["iron_helm", "iron_cuirass", "iron_boots", "iron_shield", "wisp_talisman"];

/** Mirror of RoomSim.enchantPrice for expectation math. */
function weaveCost(stack: ItemStack, priceMult: number, tier: number, existing: number): number {
  const value = reg.item(stack.item).value;
  const rarityMult = reg.rarities[stack.rarity]!.mult;
  const e = consts.enchanting;
  const tierMult = e.tierPriceMult[String(tier)] ?? 1;
  const surcharge = Math.pow(e.slotSurchargeMult, existing);
  return Math.ceil(value * rarityMult * priceMult * tierMult * surcharge * e.priceValueMult + e.priceBase);
}

describe("armor loot tables (unchanged by the weaving rework)", () => {
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

interface TestClient {
  session: PlayerSession;
  messages: ServerToClient[];
  last<T extends ServerToClient["t"]>(t: T): Extract<ServerToClient, { t: T }> | undefined;
}

// equippables at their authored tiers
const sword = (): ItemStack => ({ item: "iron_sword", qty: 1, rarity: "uncommon", stats: { dmg: 1, spd: 1 }, dur: 450, maxDur: 450 }); // tier 2
const rusty = (): ItemStack => ({ item: "rusty_sword", qty: 1, rarity: "common", stats: { dmg: 1, spd: 1 }, dur: 250, maxDur: 250 }); // tier 1
const amulet = (): ItemStack => ({ item: "greater_amulet", qty: 1, rarity: "rare" }); // tier 3: 2 slots, maxTier 2
const relic = (): ItemStack => ({ item: "mythic_relic", qty: 1, rarity: "epic" }); // tier 5: 3 slots, maxTier 3
const royalAxe = (): ItemStack => ({ item: "kingsrend_greataxe", qty: 1, rarity: "rare", stats: { dmg: 1, spd: 1 }, dur: 950, maxDur: 950 }); // tier 5

describe("Selvara the Enchanter (weaves tier I-II)", () => {
  let sim: RoomSim;
  let npcId: number;

  function makeCharacter(id: string, name: string, inventory: Array<ItemStack | null>, gold = 5000): CharacterSnapshot {
    return { id, name, level: 1, xp: 0, gold, inventory, x: 47, y: 0, z: 54, yaw: 0, roles: ["player"] };
  }
  function join(id: string, name: string, inventory: Array<ItemStack | null> = [], gold = 5000): TestClient {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, inventory, gold), (m) => messages.push(m));
    return { session, messages, last: (t) => [...messages].reverse().find((m) => m.t === t) as never };
  }

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("hub"));
    const npc = [...sim.allEntities()].find((e) => e.kind === "npc" && e.npcId === "enchanter");
    expect(npc).toBeDefined();
    npcId = npc!.id;
  });

  it("offers all 12 perks with strength ladders, maxTier 2, and removal", () => {
    const a = join("c1", "Alice", [sword()]);
    sim.handleTalk(a.session, npcId);
    const wire = a.last("dialog")!.enchant!;
    expect(wire.maxTier).toBe(2);
    expect(wire.remove).toBe(true);
    expect(wire.offers.map((o) => o.id).sort()).toEqual([...WEAVABLE].sort());
    for (const o of wire.offers) {
      expect(o.tiers.length).toBe(3);
      expect(o.tiers[0]! < o.tiers[2]!).toBe(true); // ascending strength
      expect(o.priceMult).toBeGreaterThan(0);
      expect(o.name).not.toContain(" I"); // base name — client renders the tier
    }
  });

  it("weaves a chosen tier at the authoritative price and aggregates it", () => {
    const a = join("c1", "Alice", [sword()], 5000);
    const mod = reg.modifiers["hpRegen"]!;
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 2);
    const s = a.session.slots[0]!;
    expect(s.mods).toEqual({ hpRegen: mod.enchant!.tiers[1] }); // tier 2 magnitude (1.2)
    expect(a.session.gold).toBe(5000 - weaveCost(sword(), mod.enchant!.priceMult, 2, 0));
    expect(a.session.agg.byStat["hpRegen"]).toBeCloseTo(mod.enchant!.tiers[1]!, 3); // held weapon perk
  });

  it("refuses a tier above the ITEM's cap (a tier-1 rusty sword can't hold tier 2)", () => {
    const a = join("c1", "Alice", [rusty()], 5000);
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 2); // rusty = tier 1, cap maxTier 1
    expect(a.session.slots[0]!.mods).toBeUndefined();
    expect(a.session.gold).toBe(5000);
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 1); // tier 1 is fine
    expect(a.session.slots[0]!.mods).toEqual({ hpRegen: reg.modifiers["hpRegen"]!.enchant!.tiers[0] });
  });

  it("refuses a tier above the WEAVER's cap (Selvara can't weave tier 3)", () => {
    const a = join("c1", "Alice", [relic()], 5000); // relic = tier 5, would allow tier 3
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 3);
    expect(a.session.slots[0]!.mods).toBeUndefined();
    expect(a.session.gold).toBe(5000);
  });

  it("fills enchant slots up to capacity, then refuses; no duplicate perk", () => {
    const a = join("c1", "Alice", [amulet()], 20000); // tier 3 = 2 slots
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 2);
    sim.handleEnchant(a.session, npcId, 0, "manaRegen", 2);
    expect(Object.keys(a.session.slots[0]!.mods!).sort()).toEqual(["hpRegen", "manaRegen"]);
    // third distinct perk — no free slot
    const goldBefore = a.session.gold;
    sim.handleEnchant(a.session, npcId, 0, "maxHp", 2);
    expect(Object.keys(a.session.slots[0]!.mods!)).toHaveLength(2);
    // duplicate of an existing perk — refused even though... it's already there
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 1);
    expect(a.session.slots[0]!.mods!["hpRegen"]).toBe(reg.modifiers["hpRegen"]!.enchant!.tiers[1]); // unchanged (still tier 2)
    expect(a.session.gold).toBe(goldBefore); // neither charged
  });

  it("can weave onto DROP-ROLLED gear while a slot remains (the old 'modified = dead' trap is gone)", () => {
    // a rare amulet that dropped with one rolled perk still has 1 of its 2 slots free
    const rolled: ItemStack = { ...amulet(), mods: { goldFind: 0.14 } };
    const a = join("c1", "Alice", [rolled], 20000);
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 2);
    expect(Object.keys(a.session.slots[0]!.mods!).sort()).toEqual(["goldFind", "hpRegen"]);
  });

  it("removes a woven perk (frees the slot) and lifts a drop-rolled curse", () => {
    const a = join("c1", "Alice", [amulet()], 20000);
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 2);
    sim.handleEnchant(a.session, npcId, 0, "manaRegen", 2);
    const goldAfterWeave = a.session.gold;
    sim.handleUnenchant(a.session, npcId, 0, "hpRegen");
    expect(Object.keys(a.session.slots[0]!.mods!)).toEqual(["manaRegen"]);
    expect(a.session.gold).toBe(goldAfterWeave - sim.removeCost(a.session.slots[0]!));
    // now a slot is free again — re-weave a different perk
    sim.handleEnchant(a.session, npcId, 0, "dmgPct", 2);
    expect(Object.keys(a.session.slots[0]!.mods!).sort()).toEqual(["dmgPct", "manaRegen"]);

    // curse strip: a cursed trinket → removed leaves it clean (mods undefined)
    const cursed: ItemStack = { ...amulet(), mods: { brittle: -0.08 } };
    const b = join("c2", "Bob", [cursed], 20000);
    sim.handleUnenchant(b.session, npcId, 0, "brittle");
    expect(b.session.slots[0]!.mods).toBeUndefined();
  });

  it("removal ignores a mod the item doesn't bear (no charge)", () => {
    const a = join("c1", "Alice", [amulet()], 20000);
    sim.handleUnenchant(a.session, npcId, 0, "hpRegen"); // nothing woven
    expect(a.session.gold).toBe(20000);
    expect(a.session.slots[0]!.mods).toBeUndefined();
  });

  it("refuses non-equippables, mismatched kinds, short gold, off-menu ids", () => {
    const a = join("c1", "Alice", [{ item: "bread", qty: 1, rarity: "common" }, sword()], 5000);
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 1); // bread
    expect(a.session.slots[0]!.mods).toBeUndefined();
    sim.handleEnchant(a.session, npcId, 1, "magicTakenPct", 2); // Warding is armor/trinket-only, sword is a weapon
    expect(a.session.slots[1]!.mods).toBeUndefined();
    const b = join("c2", "Bob", [sword()], 5); // short gold
    sim.handleEnchant(b.session, npcId, 0, "hpRegen", 2);
    expect(b.session.slots[0]!.mods).toBeUndefined();
    const c = join("c3", "Cara", [helmT2()], 5000);
    sim.handleEnchant(c.session, npcId, 0, "made_up_mod", 1); // not a real modifier
    expect(c.session.slots[0]!.mods).toBeUndefined();
  });

  it("re-validates the slot at receipt: an invMove race retargets, never dangles", () => {
    const a = join("c1", "Alice", [sword(), { item: "bread", qty: 1, rarity: "common" }], 5000);
    sim.handleInvMove(a.session, 0, 9); // sword moves to slot 9
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 2); // slot 0 now empty
    expect(a.session.slots[0]).toBeNull();
    expect(a.session.gold).toBe(5000);
    sim.handleEnchant(a.session, npcId, 9, "hpRegen", 2);
    expect(a.session.slots[9]!.mods).toEqual({ hpRegen: reg.modifiers["hpRegen"]!.enchant!.tiers[1] });
  });

  it("ignores the dead and the distant", () => {
    const a = join("c1", "Alice", [sword()], 5000);
    a.session.entity.combat!.act = "dead";
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 2);
    expect(a.session.slots[0]!.mods).toBeUndefined();
    a.session.entity.combat!.act = "idle";
    a.session.entity.pos.x = 20; // across the plaza
    sim.handleEnchant(a.session, npcId, 0, "hpRegen", 2);
    expect(a.session.slots[0]!.mods).toBeUndefined();
  });

  it("never mints gold: the cheapest weave costs far more than the sell bump it adds", () => {
    const stack = sword(); // value 40 uncommon
    const value = reg.item(stack.item).value * reg.rarities[stack.rarity]!.mult;
    // one perk raises sell by sellBonusPerPerk × sellFraction × value
    const sellBump = value * consts.items.mods.sellBonusPerPerk * consts.combat.sellFraction;
    for (const id of WEAVABLE) {
      const mod = reg.modifiers[id]!;
      if (!(mod.appliesTo as readonly string[]).includes("weapon")) continue;
      const cost = weaveCost(stack, mod.enchant!.priceMult, 1, 0);
      expect(cost).toBeGreaterThan(sellBump * 5);
    }
  });
});

const helmT2 = (): ItemStack => ({ item: "iron_helm", qty: 1, rarity: "common", stats: { armor: 1 }, dur: 350, maxDur: 350 });

describe("Ysolde the Ember-Witch (master enchanter, weaves tier III)", () => {
  let sim: RoomSim;
  let npcId: number;

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("cinderrift"));
    const npc = [...sim.allEntities()].find((e) => e.kind === "npc" && e.npcId === "ember-witch");
    expect(npc).toBeDefined();
    npcId = npc!.id;
  });

  function joinAt(inv: Array<ItemStack | null>, gold = 40000): PlayerSession {
    const npc = [...sim.allEntities()].find((e) => e.id === npcId)!;
    const char: CharacterSnapshot = {
      id: "m1", name: "Mara", level: 1, xp: 0, gold, inventory: inv,
      x: npc.pos.x, y: 0, z: npc.pos.z, yaw: 0, roles: ["player"],
    };
    return sim.addPlayer(char, () => {});
  }

  it("advertises maxTier 3 and removal", () => {
    const msgs: ServerToClient[] = [];
    const npc = [...sim.allEntities()].find((e) => e.id === npcId)!;
    const s = sim.addPlayer(
      { id: "m0", name: "Nim", level: 1, xp: 0, gold: 1000, inventory: [], x: npc.pos.x, y: 0, z: npc.pos.z, yaw: 0, roles: ["player"] },
      (m) => msgs.push(m),
    );
    sim.handleTalk(s, npcId);
    const wire = [...msgs].reverse().find((m) => m.t === "dialog") as Extract<ServerToClient, { t: "dialog" }>;
    expect(wire.enchant!.maxTier).toBe(3);
    expect(wire.enchant!.remove).toBe(true);
  });

  it("weaves tier III onto a tier-5 relic (which Selvara cannot)", () => {
    const s = joinAt([relic()]);
    sim.handleEnchant(s, npcId, 0, "hpRegen", 3);
    expect(s.slots[0]!.mods).toEqual({ hpRegen: reg.modifiers["hpRegen"]!.enchant!.tiers[2] }); // tier 3 (2.0)
  });

  it("still refuses tier III on a tier-3 item (item cap is maxTier 2)", () => {
    const s = joinAt([amulet()]); // tier 3 gear → maxTier 2
    sim.handleEnchant(s, npcId, 0, "hpRegen", 3);
    expect(s.slots[0]!.mods).toBeUndefined();
    sim.handleEnchant(s, npcId, 0, "hpRegen", 2); // tier 2 ok
    expect(s.slots[0]!.mods).toEqual({ hpRegen: reg.modifiers["hpRegen"]!.enchant!.tiers[1] });
  });

  it("a tier-5 weapon takes 3 tier-III weaves (slots scale with gear tier)", () => {
    const s = joinAt([royalAxe()], 200000); // tier 5 = 3 slots; 3rd slot surcharges hard, so fund it
    sim.handleEnchant(s, npcId, 0, "dmgPct", 3);
    sim.handleEnchant(s, npcId, 0, "lifesteal", 3);
    sim.handleEnchant(s, npcId, 0, "goldFind", 3);
    expect(Object.keys(s.slots[0]!.mods!).sort()).toEqual(["dmgPct", "goldFind", "lifesteal"]);
    sim.handleEnchant(s, npcId, 0, "hpRegen", 3); // 4th — no slot
    expect(Object.keys(s.slots[0]!.mods!)).toHaveLength(3);
  });
});

describe("weaving invariants", () => {
  it("every weavable perk's tiers ascend and stay within its stat cap", () => {
    const caps = consts.items.mods.caps as Record<string, number>;
    for (const [id, mod] of Object.entries(reg.modifiers)) {
      if (!mod.enchant) continue;
      const tiers = mod.enchant.tiers;
      expect(tiers.length, id).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < tiers.length; i++) expect(tiers[i]!, id).toBeGreaterThan(tiers[i - 1]!);
      const cap = caps[mod.stat];
      // a single max-tier weave must not alone blow the aggregate stat ceiling
      if (cap !== undefined) expect(Math.max(...tiers), id).toBeLessThanOrEqual(cap);
      // integer mods weave whole numbers
      if (mod.integer) for (const t of tiers) expect(Number.isInteger(t), id).toBe(true);
    }
  });

  it("Selvara caps at tier 2, the Ember-Witch at tier 3", () => {
    const selvara = loadRoomDef("hub").npcs.find((n) => n.id === "enchanter")!;
    expect(selvara.service!.maxTier).toBe(2);
    const ysolde = loadRoomDef("cinderrift").npcs.find((n) => n.id === "ember-witch")!;
    expect(ysolde.service!.maxTier).toBe(3);
  });
});
