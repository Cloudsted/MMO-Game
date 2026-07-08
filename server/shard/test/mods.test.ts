/**
 * Dynamic-modifier enforcement: aggregation + caps, armor mitigation by
 * damage class, on-hit hooks (wear/thorns/lifesteal), regen mods, vitals
 * resizing, the movement-speed envelope, and the effects wire message.
 * Crit randomness is stubbed off where exact numbers matter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { gameConstants, loadRoomDef } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";

const consts = gameConstants();

function makeCharacter(
  id: string,
  name: string,
  equipment?: Array<ItemStack | null>,
  inventory: Array<ItemStack | null> = []
): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory, equipment, x: 64, y: 0, z: 64, yaw: 0, roles: ["player"] };
}

/** A fully-rolled armor piece (no backfill randomness): rarity common
 *  (mult 1) + neutral stat roll, so agg.armor === def.armor exactly. */
function armorPiece(item: string, dur: number, mods?: Record<string, number>): ItemStack {
  const s: ItemStack = { item, qty: 1, rarity: "common", stats: { armor: 1 }, dur, maxDur: dur };
  if (mods) s.mods = mods;
  return s;
}

describe("modifier enforcement", () => {
  let sim: RoomSim;

  interface TestClient {
    session: PlayerSession;
    messages: ServerToClient[];
    last<T extends ServerToClient["t"]>(t: T): Extract<ServerToClient, { t: T }> | undefined;
  }

  function join(id: string, name: string, equipment?: Array<ItemStack | null>, inventory: Array<ItemStack | null> = []): TestClient {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, equipment, inventory), (m) => messages.push(m));
    return {
      session,
      messages,
      last: (t) => [...messages].reverse().find((m) => m.t === t) as never,
    };
  }

  function noCrits(): void {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
  }

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("hub"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("aggregation", () => {
    it("sums same-stat mods across items and gates held-weapon mods on selection", () => {
      const a = join(
        "c1", "Alice",
        [armorPiece("iron_helm", 350, { hpRegen: 1.0 }), armorPiece("iron_cuirass", 450, { hpRegen: 1.5 }), null, null, null],
        [{ item: "iron_sword", qty: 1, rarity: "common", stats: { dmg: 1, spd: 1 }, dur: 450, maxDur: 450, mods: { hpRegen: 2.0 } }]
      );
      // held slot 0 = the modded sword → all three sources count
      expect(a.session.agg.byStat["hpRegen"]).toBeCloseTo(4.5, 3);
      expect(a.session.agg.modTotals["hpRegen"]).toBeCloseTo(4.5, 3);
      sim.handleEquip(a.session, 1); // empty hand: the sword's perk goes inert
      expect(a.session.agg.byStat["hpRegen"]).toBeCloseTo(2.5, 3);
    });

    it("clamps per-stat sums symmetrically to items.mods.caps", () => {
      const cap = consts.items.mods.caps["moveSpeedPct"]!;
      const a = join("c1", "Alice", [
        armorPiece("iron_helm", 350, { moveSpeedPct: 0.25 }),
        armorPiece("iron_cuirass", 450, { moveSpeedPct: 0.25 }),
        null, null, null,
      ]);
      expect(a.session.agg.byStat["moveSpeedPct"]).toBeCloseTo(cap, 3);
      expect(a.session.agg.speedMult).toBeCloseTo(1 + cap, 3);
      const b = join("c2", "Bob", [
        armorPiece("iron_helm", 350, { slowness: -0.25 }),
        armorPiece("iron_cuirass", 450, { slowness: -0.25 }),
        null, null, null,
      ]);
      expect(b.session.agg.byStat["moveSpeedPct"]).toBeCloseTo(-cap, 3);
    });

    it("totals armor from worn pieces (def.armor × rarity × roll)", () => {
      const a = join("c1", "Alice", [
        armorPiece("iron_helm", 350), // 8
        armorPiece("iron_cuirass", 450), // 12
        null, null,
        armorPiece("iron_shield", 400), // 9
      ]);
      expect(a.session.agg.armor).toBeCloseTo(29, 3);
    });
  });

  describe("applyDamage pipeline", () => {
    it("mitigates melee/ranged by A/(A+K) but never magic", () => {
      noCrits();
      const attacker = join("c1", "Atk");
      const tank = join("c2", "Tank", [null, armorPiece("iron_cuirass", 450), null, null, null]); // armor 12
      const k = consts.combat.armorK;
      const mit = 1 - 12 / (12 + k);
      // headroom so no hit kills (kill() clamps hp to 0 and skews the drop)
      tank.session.entity.health!.maxHp = 1000;
      tank.session.entity.health!.hp = 1000;

      const hp0 = tank.session.entity.health!.hp;
      sim.applyDamage(attacker.session.entity, tank.session.entity, 100, "melee");
      expect(hp0 - tank.session.entity.health!.hp).toBe(Math.round(100 * mit));

      const hp1 = tank.session.entity.health!.hp;
      sim.applyDamage(attacker.session.entity, tank.session.entity, 100, "ranged");
      expect(hp1 - tank.session.entity.health!.hp).toBe(Math.round(100 * mit));

      const hp2 = tank.session.entity.health!.hp;
      sim.applyDamage(attacker.session.entity, tank.session.entity, 50, "magic");
      expect(hp2 - tank.session.entity.health!.hp).toBe(50); // armor ignored
    });

    it("applies taken-modifiers per class, brittle raises, combined cap holds", () => {
      noCrits();
      const attacker = join("c1", "Atk");
      const warded = join("c2", "Warded", [armorPiece("iron_helm", 350, { magicTakenPct: 0.1 }), null, null, null, null]);
      warded.session.entity.health!.maxHp = 1000;
      warded.session.entity.health!.hp = 1000;
      // helm armor 8 does NOT touch magic; Warding 10% does
      const hp0 = warded.session.entity.health!.hp;
      sim.applyDamage(attacker.session.entity, warded.session.entity, 100, "magic");
      expect(hp0 - warded.session.entity.health!.hp).toBe(90);

      const brittle = join("c3", "Brittle", [armorPiece("iron_helm", 350, { brittle: -0.1 }), null, null, null, null]);
      brittle.session.entity.health!.maxHp = 1000;
      brittle.session.entity.health!.hp = 1000;
      const hp1 = brittle.session.entity.health!.hp;
      sim.applyDamage(attacker.session.entity, brittle.session.entity, 100, "magic");
      expect(hp1 - brittle.session.entity.health!.hp).toBe(110); // +10% taken
    });

    it("wears armor on physical hits (never magic) and shatters at zero", () => {
      noCrits();
      const attacker = join("c1", "Atk");
      const tank = join("c2", "Tank", [armorPiece("iron_helm", 2), null, null, null, null]);
      sim.applyDamage(attacker.session.entity, tank.session.entity, 5, "magic");
      expect(tank.session.equipment[0]!.dur).toBe(2); // magic: no wear
      sim.applyDamage(attacker.session.entity, tank.session.entity, 5, "melee");
      expect(tank.session.equipment[0]!.dur).toBe(1);
      const armorBefore = tank.session.agg.armor;
      expect(armorBefore).toBeGreaterThan(0);
      sim.applyDamage(attacker.session.entity, tank.session.entity, 5, "melee");
      expect(tank.session.equipment[0]).toBeNull(); // shattered
      expect(tank.session.agg.armor).toBe(0); // aggregate updated mid-fight
      const chat = tank.last("chat");
      expect(chat?.text).toMatch(/shattered/i);
    });

    it("thorns reflects melee once (no recursion) and skips ranged", () => {
      noCrits();
      const attacker = join("c1", "Atk");
      const thorny = join("c2", "Thorny", [null, armorPiece("iron_cuirass", 450, { thorns: 5 }), null, null, null]);
      const atkHp0 = attacker.session.entity.health!.hp;
      sim.applyDamage(attacker.session.entity, thorny.session.entity, 10, "melee");
      expect(atkHp0 - attacker.session.entity.health!.hp).toBe(5); // one reflect, flat
      const atkHp1 = attacker.session.entity.health!.hp;
      sim.applyDamage(attacker.session.entity, thorny.session.entity, 10, "ranged");
      expect(attacker.session.entity.health!.hp).toBe(atkHp1); // no reflect at range
    });

    it("lifesteal heals the attacker from mob damage dealt", () => {
      noCrits();
      const a = join("c1", "Alice", undefined, [
        { item: "iron_sword", qty: 1, rarity: "common", stats: { dmg: 1, spd: 1 }, dur: 450, maxDur: 450, mods: { lifesteal: 0.1 } },
      ]);
      const slime = sim.spawnMob("slime", 8, 8, "")!;
      slime.health!.maxHp = 500;
      slime.health!.hp = 500;
      a.session.entity.health!.hp = 50;
      sim.applyDamage(a.session.entity, slime, 40, "melee");
      expect(a.session.entity.health!.hp).toBeCloseTo(54, 3); // 40 × 0.1
    });
  });

  describe("movement speed envelope", () => {
    it("accepts Swiftness-boosted speed within the capped envelope and rejects beyond", () => {
      const gear = [armorPiece("iron_helm", 350, { moveSpeedPct: 0.3 }), null, null, null, null];
      const boosted = join("c1", "Fast", gear);
      const base = join("c2", "Slow");
      const walk = consts.movement.walkSpeed;
      const tol = consts.net.moveToleranceM;
      // dt = 1 s exactly; base envelope = 4.5×1.6 + 0.75 = 7.95, boosted ≈ 10.11
      const dist = 9.0;
      const y = (x: number, z: number) => sim.world.standY(x, z);

      base.session.lastMoveAt = Date.now() - 1000;
      sim.handleMove(base.session, 1, 64 + dist, y(64 + dist, 64), 64, 0, "move");
      expect(base.last("correct")).toBeDefined(); // 9 m > 7.95 unboosted

      boosted.session.lastMoveAt = Date.now() - 1000;
      sim.handleMove(boosted.session, 1, 64 + dist, y(64 + dist, 64), 64, 0, "move");
      expect(boosted.last("correct")).toBeUndefined(); // within 1.3× envelope

      boosted.session.lastMoveAt = Date.now() - 1000;
      sim.handleMove(boosted.session, 2, 64 + dist + 11, y(64 + dist + 11, 64), 64, 0, "move");
      expect(boosted.last("correct")).toBeDefined(); // beyond even the boosted cap
      expect(walk * 1.3 * 1.6 + tol).toBeGreaterThan(dist); // sanity on the envelope math
    });
  });

  describe("vitals", () => {
    it("maxHp gear raises the max; unequip clamps; re-equip never heals", () => {
      const a = join("c1", "Alice", [null, armorPiece("iron_cuirass", 450, { maxHp: 40 }), null, null, null]);
      expect(a.session.entity.health!.maxHp).toBe(consts.progression.baseHp + 40);
      expect(a.session.entity.health!.hp).toBe(consts.progression.baseHp + 40); // full admission

      sim.handleEquipSlot(a.session, "chest"); // unequip
      expect(a.session.entity.health!.maxHp).toBe(consts.progression.baseHp);
      expect(a.session.entity.health!.hp).toBe(consts.progression.baseHp); // clamped, not killed

      const invIdx = a.session.slots.findIndex((s) => s?.item === "iron_cuirass");
      sim.handleEquipSlot(a.session, "chest", invIdx); // re-equip
      expect(a.session.entity.health!.maxHp).toBe(consts.progression.baseHp + 40);
      expect(a.session.entity.health!.hp).toBe(consts.progression.baseHp); // no free heal
    });

    it("level-up full-heals to the MODDED max via the shared formula", () => {
      const a = join("c1", "Alice", [null, armorPiece("iron_cuirass", 450, { maxHp: 40 }), null, null, null]);
      a.session.entity.health!.hp = 30;
      a.session.xp = sim.xpNext(1) - 5; // one slime away from level 2
      const slime = sim.spawnMob("slime", 64, 65, "")!;
      slime.health!.hp = 1;
      sim.applyDamage(a.session.entity, slime, 5, "melee");
      expect(a.session.entity.level).toBe(2);
      const expected = consts.progression.baseHp + consts.progression.hpPerLevel + 40;
      expect(a.session.entity.health!.maxHp).toBe(expected);
      expect(a.session.entity.health!.hp).toBe(expected); // level-up full heal
    });
  });

  describe("gold find", () => {
    it("multiplies gold at pickup", () => {
      const a = join("c1", "Alice", [null, null, null, null, armorPiece("iron_shield", 400, { goldFind: 0.5 })]);
      const p = a.session.entity.pos;
      (sim as unknown as { spawnLootBag(x: number, z: number, items: ItemStack[], gold: number, owner: string | null, unlockAt: number, expireAt: number | null, y: number): void })
        .spawnLootBag(p.x, p.z, [], 100, null, 0, null, p.y);
      const bag = [...sim.allEntities()].find((e) => e.kind === "loot")!;
      sim.handlePickup(a.session, bag.id);
      expect(a.session.gold).toBe(150);
    });
  });
});

describe("regen modifiers + effects wire (fake timers)", () => {
  let sim: RoomSim;

  function join(id: string, name: string, equipment?: Array<ItemStack | null>, inventory: Array<ItemStack | null> = []) {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, equipment, inventory), (m) => messages.push(m));
    return {
      session,
      messages,
      all: <T extends ServerToClient["t"]>(t: T) => messages.filter((m) => m.t === t) as Extract<ServerToClient, { t: T }>[],
      last: <T extends ServerToClient["t"]>(t: T) =>
        [...messages].reverse().find((m) => m.t === t) as Extract<ServerToClient, { t: T }> | undefined,
    };
  }

  function tickFor(ms: number, step = 100): void {
    for (let t = 0; t < ms; t += step) {
      vi.advanceTimersByTime(step);
      sim.tick();
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
    sim = new RoomSim(loadRoomDef("hub"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gear hpRegen heals through the post-damage window; base regen stays gated", () => {
    const geared = join("c1", "Geared", [armorPiece("iron_helm", 350, { hpRegen: 4 }), null, null, null, null]);
    const plain = join("c2", "Plain");
    for (const s of [geared.session, plain.session]) {
      s.entity.health!.hp = 40;
      s.entity.combat!.lastDamagedAt = Date.now(); // freshly hit: delay active
    }
    tickFor(2000);
    expect(geared.session.entity.health!.hp).toBeCloseTo(48, 0); // 4/s through combat
    expect(plain.session.entity.health!.hp).toBeCloseTo(40, 0); // base regen delayed
  });

  it("drained slows mana recovery but the floor is zero", () => {
    const drained = join("c1", "Drained", undefined, [
      { item: "iron_sword", qty: 1, rarity: "common", stats: { dmg: 1, spd: 1 }, dur: 450, maxDur: 450, mods: { drained: -10 } },
    ]);
    drained.session.entity.mana!.mana = 20;
    tickFor(2000);
    expect(drained.session.entity.mana!.mana).toBeCloseTo(20, 1); // 3 - 10 → floored at 0
  });

  it("ships the effects message on join, on debuff, and drops entries on expiry", () => {
    const a = join("c1", "Alice", [armorPiece("iron_helm", 350, { hpRegen: 1.5 }), null, null, null, null]);
    tickFor(200);
    const initial = a.last("effects")!;
    expect(initial).toBeDefined();
    expect(initial.list).toContainEqual({ kind: "mod", id: "hpRegen", mag: 1.5, curse: false });
    expect(initial.speedMult).toBe(1);

    const spider = sim.spawnMob("giant_spider", 8, 8, "")!;
    sim.applyDebuff(a.session.entity, { slowPct: 0.4, dotTotal: 8, durMs: 2000 }, spider);
    tickFor(200);
    const withDebuffs = a.last("effects")!;
    const slow = withDebuffs.list.find((e) => e.kind === "slow");
    const dot = withDebuffs.list.find((e) => e.kind === "dot");
    expect(slow && slow.kind === "slow" && slow.durMs).toBeGreaterThan(0);
    expect(dot).toBeDefined();

    tickFor(2500); // both expire
    const after = a.last("effects")!;
    expect(after.list.some((e) => e.kind === "slow" || e.kind === "dot")).toBe(false);
    expect(after.list.some((e) => e.kind === "mod")).toBe(true); // gear persists
  });

  it("food HoT surfaces with the eaten item's icon id and speedMult mirrors Swiftness", () => {
    const a = join(
      "c1", "Alice",
      [armorPiece("iron_helm", 350, { moveSpeedPct: 0.1 }), null, null, null, null],
      [{ item: "bread", qty: 1, rarity: "common" }]
    );
    a.session.entity.health!.hp = 10;
    sim.handleConsume(a.session, 0);
    tickFor(200);
    const fx = a.last("effects")!;
    const hot = fx.list.find((e) => e.kind === "hot");
    expect(hot && hot.kind === "hot" && hot.item).toBe("bread");
    expect(fx.speedMult).toBeCloseTo(1.1, 3);
  });

  it("poison bites bypass armor and taken-reductions entirely", () => {
    const tank = join("c1", "Tank", [
      armorPiece("iron_helm", 350, { meleeTakenPct: 0.18 }),
      armorPiece("iron_cuirass", 450, { magicTakenPct: 0.18 }),
      null, null,
      armorPiece("iron_shield", 400),
    ]);
    const spider = sim.spawnMob("giant_spider", 8, 8, "")!;
    const hp0 = tank.session.entity.health!.hp;
    sim.applyDebuff(tank.session.entity, { dotTotal: 10, durMs: 2000 }, spider);
    tickFor(2500);
    const drop = hp0 - tank.session.entity.health!.hp;
    expect(drop).toBeGreaterThanOrEqual(9); // full poison landed, unmitigated
  });
});
