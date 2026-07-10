import { describe, it, expect } from "vitest";
import { gameConstants } from "../src/constants.js";
import { RegistryService, isEquippable, abilityDmgClass, EQUIP_SLOTS } from "../src/registry.js";
import { mintItem, ensureItemInstance } from "../src/items.js";
import { encode, decodeClientToServer, decodeMasterToShard, RoomStateSchema } from "../src/protocol.js";

const reg = new RegistryService();
const consts = gameConstants();

/** rand() stub that plays a queued script, then repeats the last value. */
function scripted(...vals: number[]): () => number {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)]!;
}

describe("registry equipment data", () => {
  it("loads modifiers with sane cross-validation", () => {
    expect(Object.keys(reg.modifiers).length).toBeGreaterThanOrEqual(16);
    expect(reg.modifiers["hpRegen"]!.curse).toBe(false);
    expect(reg.modifiers["slowness"]!.curse).toBe(true);
    // curse pools exist for every equippable kind that can roll one
    expect(reg.modifiersFor("armor", true).length).toBeGreaterThan(0);
    expect(reg.modifiersFor("weapon", true).length).toBeGreaterThan(0);
  });

  it("ships armor for head/chest/feet/offhand and trinkets, all stack-1", () => {
    const bySlot = new Map<string, number>();
    for (const def of Object.values(reg.items)) {
      if (def.kind === "armor") bySlot.set(def.slot!, (bySlot.get(def.slot!) ?? 0) + 1);
      if (isEquippable(def.kind)) expect(def.stack).toBe(1);
    }
    for (const slot of ["head", "chest", "feet", "offhand"]) {
      expect(bySlot.get(slot) ?? 0).toBeGreaterThanOrEqual(2);
    }
    // legs deliberately item-less (no TF icon) but the slot exists
    expect(EQUIP_SLOTS).toContain("legs");
    expect(Object.values(reg.items).some((d) => d.kind === "trinket")).toBe(true);
  });

  it("classifies ability damage: melee, authored ranged bows, default magic spells", () => {
    expect(abilityDmgClass(reg.abilities["swing"]!)).toBe("melee");
    expect(abilityDmgClass(reg.abilities["bow_shot"]!)).toBe("ranged");
    expect(abilityDmgClass(reg.abilities["bone_bow"]!)).toBe("ranged");
    expect(abilityDmgClass(reg.abilities["firebolt"]!)).toBe("magic");
    expect(abilityDmgClass(reg.abilities["throne_flames"]!)).toBe("magic");
    expect(abilityDmgClass(reg.abilities["heal"]!)).toBeNull();
  });
});

describe("mintItem equipment rolls", () => {
  it("weapons roll dmg/spd, armor rolls armor only, trinkets roll no stats", () => {
    const sword = mintItem(reg, consts, "iron_sword", 1, "common", scripted(0.5, 0.5, 0.5, 0.99));
    expect(Object.keys(sword.stats!).sort()).toEqual(["dmg", "spd"]);
    const helm = mintItem(reg, consts, "iron_helm", 1, "rare", scripted(0.5, 0.5, 0.99));
    expect(Object.keys(helm.stats!)).toEqual(["armor"]);
    expect(helm.maxDur).toBeGreaterThan(0);
    expect(helm.dur).toBe(helm.maxDur);
    const charm = mintItem(reg, consts, "lucky_locket", 1, "common", scripted(0.99));
    expect(charm.stats).toBeUndefined();
    expect(charm.dur).toBeUndefined(); // trinkets never wear
  });

  it("armor stat spread scales with rarity", () => {
    // rand=1 → max roll: 1 + spread
    const common = mintItem(reg, consts, "iron_helm", 1, "common", scripted(1, 0.5, 0.99));
    const epic = mintItem(reg, consts, "iron_helm", 1, "epic", scripted(1, 0.5, 0.99));
    expect(common.stats!["armor"]).toBeCloseTo(1 + consts.items.statSpread["armor"]!["common"]!, 3);
    expect(epic.stats!["armor"]).toBeCloseTo(1 + consts.items.statSpread["armor"]!["epic"]!, 3);
    expect(epic.stats!["armor"]!).toBeGreaterThan(common.stats!["armor"]!);
  });

  it("rolls a perk mod when the chance hits (and none when it misses)", () => {
    // trinket rand order: [modChance, curse?, poolPick, magnitude, secondChance]
    const hit = mintItem(reg, consts, "lucky_locket", 1, "epic", scripted(0.0, 0.99, 0.0, 0.5, 0.99));
    expect(hit.mods).toBeDefined();
    const [id, mag] = Object.entries(hit.mods!)[0]!;
    const def = reg.modifiers[id]!;
    expect(def.curse).toBe(false);
    const [lo, hi] = def.rolls["epic"]!;
    expect(mag).toBeGreaterThanOrEqual(lo);
    expect(mag).toBeLessThanOrEqual(hi);

    const miss = mintItem(reg, consts, "lucky_locket", 1, "epic", scripted(0.99));
    expect(miss.mods).toBeUndefined();
  });

  it("rolls a negative curse when the curse split hits", () => {
    // armor: [statRoll, durRoll, modChance, curse=yes, poolPick, magnitude, second]
    const cursed = mintItem(reg, consts, "iron_helm", 1, "epic", scripted(0.5, 0.5, 0.0, 0.0, 0.0, 0.5, 0.99));
    expect(cursed.mods).toBeDefined();
    const [id, mag] = Object.entries(cursed.mods!)[0]!;
    expect(reg.modifiers[id]!.curse).toBe(true);
    expect(mag).toBeLessThan(0);
  });

  it("can roll a second distinct mod at the second-mod chance", () => {
    const twice = mintItem(
      reg,
      consts,
      "wisp_talisman",
      1,
      "epic",
      scripted(0.0, 0.99, 0.0, 0.5, 0.0, 0.99, 0.3, 0.5, 0.99)
    );
    expect(Object.keys(twice.mods!).length).toBe(2);
  });

  it("never rolls mods on stackables", () => {
    for (let i = 0; i < 20; i++) {
      const bread = mintItem(reg, consts, "bread", 3, "common", scripted(0.0, 0.0, 0.0, 0.0, 0.0));
      expect(bread.mods).toBeUndefined();
      expect(bread.stats).toBeUndefined();
    }
  });

  it("integer mods round to whole numbers", () => {
    // force-pick until we land an integer-flagged mod (maxHp/maxMana/thorns on armor)
    const pool = reg.modifiersFor("armor", false);
    const intIdx = pool.findIndex((id) => reg.modifiers[id]!.integer);
    expect(intIdx).toBeGreaterThanOrEqual(0);
    const pick = (intIdx + 0.5) / pool.length;
    const minted = mintItem(reg, consts, "iron_cuirass", 1, "rare", scripted(0.5, 0.5, 0.0, 0.99, pick, 0.37, 0.99));
    const mag = Object.values(minted.mods!)[0]!;
    expect(Number.isInteger(mag)).toBe(true);
  });
});

describe("ensureItemInstance backfill", () => {
  it("backfills armor stats/durability but NEVER mods", () => {
    const legacy = { item: "iron_cuirass", qty: 1, rarity: "rare" };
    const filled = ensureItemInstance(reg, consts, legacy);
    expect(filled.stats?.["armor"]).toBeDefined();
    expect(filled.dur).toBeGreaterThan(0);
    expect(filled.mods).toBeUndefined();
  });

  it("passes complete instances through untouched", () => {
    const full = mintItem(reg, consts, "iron_helm", 1, "epic", scripted(0.5, 0.5, 0.99));
    expect(ensureItemInstance(reg, consts, full)).toBe(full);
  });

  it("leaves trinkets alone (no stats, no durability to fill)", () => {
    const t = { item: "lucky_locket", qty: 1, rarity: "common" };
    expect(ensureItemInstance(reg, consts, t)).toBe(t);
  });
});

describe("equipment wire schemas", () => {
  it("round-trips equipSlot equip/unequip and rejects bad slots", () => {
    expect(decodeClientToServer(encode({ t: "equipSlot", slot: "head", invIndex: 5 }))).toEqual({
      t: "equipSlot",
      slot: "head",
      invIndex: 5,
    });
    expect(decodeClientToServer(encode({ t: "equipSlot", slot: "offhand" }))).toEqual({
      t: "equipSlot",
      slot: "offhand",
    });
    expect(() => decodeClientToServer(encode({ t: "equipSlot", slot: "hat" }))).toThrow();
  });

  it("round-trips enchant + unenchant", () => {
    expect(decodeClientToServer(encode({ t: "enchant", npc: 3, slot: 9, enchantId: "hpRegen", tier: 2 }))).toEqual({
      t: "enchant",
      npc: 3,
      slot: 9,
      enchantId: "hpRegen",
      tier: 2,
    });
    expect(decodeClientToServer(encode({ t: "unenchant", npc: 3, slot: 9, modId: "hpRegen" }))).toEqual({
      t: "unenchant",
      npc: 3,
      slot: 9,
      modId: "hpRegen",
    });
  });

  it("mods survive a persisted RoomState round-trip (zod must not strip them)", () => {
    const state = RoomStateSchema.parse({
      timeOfDay: 0.5,
      savedAt: 1,
      drops: [
        {
          items: [{ item: "iron_helm", qty: 1, rarity: "epic", stats: { armor: 1.05 }, dur: 10, maxDur: 20, mods: { hpRegen: 2.1 } }],
          gold: 5,
          x: 1,
          y: 2,
          z: 3,
          owner: null,
          unlockAt: 0,
          expireAt: null,
        },
      ],
    });
    expect(state.drops[0]!.items[0]!.mods).toEqual({ hpRegen: 2.1 });
  });

  it("tickets accept snapshots with equipment and legacy snapshots without", () => {
    const base = {
      t: "ticket",
      roomId: "hub",
      ticket: "abc",
      expiresAt: 123,
      character: {
        id: "c1",
        name: "Bob",
        level: 1,
        xp: 0,
        gold: 0,
        inventory: [],
        x: 1,
        y: 0,
        z: 2,
        yaw: 0,
        roles: ["player"],
      },
    };
    expect(decodeMasterToShard(encode(base)).t).toBe("ticket"); // legacy: no equipment
    const withEquip = decodeMasterToShard(
      encode({
        ...base,
        character: {
          ...base.character,
          equipment: [null, { item: "iron_cuirass", qty: 1, rarity: "rare", mods: { thorns: 3 } }, null, null, null],
        },
      })
    );
    expect(withEquip.t === "ticket" && withEquip.character.equipment![1]!.mods).toEqual({ thorns: 3 });
  });
});

/**
 * STORY-DRESS CANON GUARD (world-redesign batch 9 — the flavor-text pass).
 * Item flavor lines are trophies-as-receipts: each one must TEACH a world
 * fact, and none may violate the Deliberate Mysteries register
 * (story bible §10): no line names the First Tyrant (a title, never a
 * proper name — the batch-8 white_waste guard, extended to item text),
 * no line explains a portal, and no line opens the far door.
 */
describe("item flavor text — bible §9 bounty-proof lines + mysteries register", () => {
  const BOUNTY_PROOFS = [
    "slime_gel", "wolf_pelt", "boar_tusk", "raptor_talon", "venom_sac",
    "ancient_coin", "ember_core", "spirit_essence", "bone_charm", "war_medal",
    "royal_seal", "sundered_crown", "spiral_horn", "greenhood_ledger_page",
    "strangler_heartroot", "undertide_beak_shard", "kiln_gallstone",
    "wallbreaker_clasp", "osmunds_gauntlet", "unfinished_sigil", "the_winter_tithe",
  ];

  it("every trophy is a legible bounty receipt (nonempty desc)", () => {
    for (const id of BOUNTY_PROOFS) {
      const def = reg.items[id];
      expect(def, id).toBeDefined();
      expect(def!.kind, id).toBe("trophy");
      expect(def!.desc && def!.desc.length > 10, `${id} needs a flavor line`).toBe(true);
    }
    // and nothing tagged trophy shipped without one
    for (const [id, def] of Object.entries(reg.items)) {
      if (def.kind === "trophy") expect(def.desc, `trophy ${id} has no desc`).toBeTruthy();
    }
  });

  it("no desc breaks the mysteries register (§10.1 portals, §10.3 the First, §10.5 the far door)", () => {
    for (const [id, def] of Object.entries(reg.items)) {
      if (!def.desc) continue;
      const text = def.desc.toLowerCase();
      // §10.3: the First Tyrant is a TITLE — "tyrant" only ever follows "first"
      let i = -1;
      while ((i = text.indexOf("tyrant", i + 1)) >= 0) {
        expect(["first ", "first-", "first_"], `${id}: names the tyrant`).toContain(text.slice(Math.max(0, i - 6), i));
      }
      // §10.1: nobody explains a portal, ever — item text doesn't even mention them
      expect(text, `${id}: item text must not touch the portal mystery`).not.toMatch(/portal|the arches|arch-stone/);
      // §10.5: the far door is shown, never opened — and never written about
      expect(text, `${id}: the far door stays shut`).not.toMatch(/far door|past the waste|beyond the waste|north of the waste/);
    }
  });
});
