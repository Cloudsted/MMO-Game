/**
 * Worldgen-overhaul registries + the poison-DoT mechanic.
 * DoT tests run on vitest fake timers so a 4 s poison resolves instantly:
 * RoomSim reads Date.now() everywhere, which the fake clock controls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { loadRoomDef, mobAttacks, RegistryService } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";
import { rollLoot } from "../src/sim/loot.js";
import { gameConstants } from "@fantasy-mmo/common";

const reg = new RegistryService();
const consts = gameConstants();

const NEW_MOBS = [
  "boar", "giant_spider", "bog_serpent", "mantrap", "lizardman", "marsh_wisp",
  "ash_husk", "fire_elemental", "bone_bat", "wraith", "cinder_golem_boss", "lich_boss",
];
const STEEL_WEAPONS = ["steel_sword", "war_axe", "ranger_crossbow", "wisp_wand", "fen_staff", "venom_dagger"];

function makeCharacter(id: string, name: string, x = 64, z = 64, inventory: Array<ItemStack | null> = []): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory, x, y: 0, z, yaw: 0, roles: ["player"] };
}

describe("worldgen registries", () => {
  it("loads all 12 new mobs with resolvable ability + loot refs", () => {
    for (const id of NEW_MOBS) {
      const mob = reg.mob(id); // throws on missing
      const kit = mobAttacks(mob);
      expect(kit.length, `${id} attack kit`).toBeGreaterThan(0);
      for (const a of kit) expect(reg.abilities[a.ability], `${id} ability ${a.ability}`).toBeDefined();
      expect(reg.loot[mob.loot], `${id} loot`).toBeDefined();
      expect(mob.hp).toBeGreaterThan(0);
    }
    // ranged mobs carry bolt-range attackRange (brains hand to the FSM there)
    expect(reg.mob("marsh_wisp").attackRange).toBe(11);
    expect(reg.mob("fire_elemental").attackRange).toBe(12);
    // the lich keeps a ranged lance in its kit (plus a point-blank scythe now)
    expect(mobAttacks(reg.mob("lich_boss")).some((a) => reg.ability(a.ability).kind === "projectile")).toBe(true);
    // the poison carriers actually carry poison
    expect(reg.ability("spider_bite").debuff?.dotTotal).toBe(10);
    expect(reg.ability("quick_stab").debuff?.dotTotal).toBe(12);
  });

  it("rolls weapons_steel to real mintable items", () => {
    for (let i = 0; i < 200; i++) {
      const r = rollLoot(reg, consts, "weapons_steel");
      expect(r.items).toHaveLength(1);
      const s = r.items[0]!;
      expect(STEEL_WEAPONS).toContain(s.item);
      expect(reg.items[s.item]).toBeDefined();
      expect(reg.rarities[s.rarity]).toBeDefined();
    }
  });

  it("boss tables guarantee an epic rift weapon", () => {
    for (const table of ["golem_boss_drops", "lich_boss_drops"]) {
      const r = rollLoot(reg, consts, table);
      const epicWeapon = r.items.find((s) => reg.items[s.item]!.kind === "weapon" && s.rarity === "epic");
      expect(epicWeapon, `${table} epic slot`).toBeDefined();
      expect(r.gold).toBeGreaterThanOrEqual(150);
    }
  });

  it("trophies are inert stackable trinkets", () => {
    for (const id of ["wolf_pelt", "boar_tusk", "raptor_talon", "slime_gel", "venom_sac", "ember_core", "spirit_essence", "ancient_coin", "bone_charm"]) {
      const def = reg.item(id);
      expect(def.kind).toBe("trophy");
      expect(def.ability).toBeUndefined();
      expect(def.effect).toBeUndefined();
      expect(def.stack).toBeGreaterThan(1);
    }
  });
});

describe("poison DoT", () => {
  let sim: RoomSim;

  interface TestClient {
    session: PlayerSession;
    messages: ServerToClient[];
  }

  function join(id: string, name: string, x = 64, z = 64, inv: Array<ItemStack | null> = []): TestClient {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, x, z, inv), (m) => messages.push(m));
    return { session, messages };
  }

  /** Advance the fake clock in sim-tick-sized steps. */
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

  it("drains dotTotal over the duration through the damage path, then stops", () => {
    const a = join("c1", "Alice");
    // applier parked far outside aggro range so only the DoT touches Alice
    const spider = sim.spawnMob("giant_spider", 8, 8, "")!;
    const bite = reg.ability("spider_bite");
    const hp0 = a.session.entity.health!.hp;
    sim.applyDebuff(a.session.entity, bite.debuff!, spider);

    tickFor(2000);
    const midDrop = hp0 - a.session.entity.health!.hp;
    expect(midDrop).toBeGreaterThan(2); // ticking, not lump-sum
    expect(midDrop).toBeLessThan(bite.debuff!.dotTotal!);

    tickFor(2500); // past durMs 4000
    const totalDrop = hp0 - a.session.entity.health!.hp;
    expect(totalDrop).toBeGreaterThanOrEqual(bite.debuff!.dotTotal! - 1);
    expect(totalDrop).toBeLessThanOrEqual(bite.debuff!.dotTotal! + 1);
    expect(a.session.entity.combat!.dotUntil).toBe(0); // expired + cleared

    // dmg events carried the applier's id (floaters/attribution)
    const dmgEvt = a.messages.find((m) => m.t === "evt" && m.e.kind === "dmg" && m.e.src === spider.id);
    expect(dmgEvt).toBeDefined();
  });

  it("lands on melee hits: the venom dagger poisons its target", () => {
    const a = join("c1", "Alice", 64, 64, [{ item: "venom_dagger", qty: 1, rarity: "common" }]);
    const slime = sim.spawnMob("slime", 64, 65.2, "")!; // 1.2 m ahead (+Z), quick_stab range 1.9
    slime.health!.maxHp = 500; // survive the weapon hit regardless of crits
    slime.health!.hp = 500;
    sim.handleAttack(a.session, 0, 0); // yaw 0 faces +Z
    tickFor(500); // windup 160 ms -> active fires in here
    expect(slime.combat!.dotUntil).toBeGreaterThan(0);
    const hpAfterHit = slime.health!.hp;
    expect(hpAfterHit).toBeLessThan(500); // the stab itself landed
    tickFor(4500); // full poison duration
    const poisonDrop = hpAfterHit - slime.health!.hp;
    const dot = reg.ability("quick_stab").debuff!.dotTotal!;
    expect(poisonDrop).toBeGreaterThanOrEqual(dot - 1);
    expect(poisonDrop).toBeLessThanOrEqual(dot + 1);
  });

  it("antidote (cureDot) clears an active DoT", () => {
    const a = join("c1", "Alice", 64, 64, [{ item: "antidote", qty: 1, rarity: "common" }]);
    const spider = sim.spawnMob("giant_spider", 8, 8, "")!;
    sim.applyDebuff(a.session.entity, { dotTotal: 50, durMs: 10000 }, spider);
    tickFor(1000);
    expect(a.session.entity.health!.hp).toBeLessThan(a.session.entity.health!.maxHp); // poison bit
    sim.handleConsume(a.session, 0);
    expect(a.session.entity.combat!.dotUntil).toBe(0);
    expect(a.session.entity.combat!.dotPerSec).toBe(0);
    expect(a.session.slots[0]).toBeNull(); // consumed
    const hpCured = a.session.entity.health!.hp;
    tickFor(2000);
    expect(a.session.entity.health!.hp).toBeGreaterThanOrEqual(hpCured); // drain stopped
  });

  it("attributes DoT kills to the applier (XP + threat path)", () => {
    const a = join("c1", "Alice");
    const mob = sim.spawnMob("slime", 66, 64, "")!;
    mob.health!.hp = 5;
    sim.applyDebuff(mob, { dotTotal: 20, durMs: 1000 }, a.session.entity);
    tickFor(1500);
    expect(mob.combat!.act).toBe("dead");
    expect(a.session.xp).toBe(reg.mob("slime").xp);
  });
});
