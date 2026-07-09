/**
 * Multi-attack mob kits + boss mechanics: attack selection (range windows,
 * cooldowns, vertical gates, weighted rolls), boss data invariants, and the
 * RoomSim integration that picks/aims/advances between shots.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { gameConstants, loadRoomDef, mobAttacks, RegistryService } from "@fantasy-mmo/common";
import { RoomSim } from "../src/sim/room.js";
import { chooseAttack, type AttackOption } from "../src/sim/mobs.js";
import { freshCombat, type Entity } from "../src/sim/entities.js";

const reg = new RegistryService();
const consts = gameConstants();
const GRACE = consts.combat.meleeRangeGrace;
const REACH_Y = consts.combat.meleeVerticalReach;

function makeCharacter(id: string, name: string, x = 64, z = 64): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory: [], x, y: 0, z, yaw: 0, roles: ["player"] };
}

function testEntity(x = 0, z = 0, kind: Entity["kind"] = "player"): Entity {
  return {
    id: 9000 + Math.floor(Math.random() * 100000),
    kind,
    pos: { x, y: 0, z, yaw: 0 },
    renderable: { sprite: "player", anim: "idle" },
    level: 1,
    health: { hp: 100, maxHp: 100 },
    combat: freshCombat(),
  };
}

/** A mob's kit resolved the same way RoomSim resolves it. */
function optionsOf(mobId: string): AttackOption[] {
  const def = reg.mob(mobId);
  return mobAttacks(def).map((a) => ({
    id: a.ability,
    ability: reg.ability(a.ability),
    damage: a.damage ?? def.damage,
    minRange: a.minRange ?? 0,
    weight: a.weight,
  }));
}

function choose(mobId: string, d: number, dy = 0, cooldowns: string[] = []) {
  const def = reg.mob(mobId);
  const mob = testEntity(0, 0, "mob");
  const target = testEntity(0, d);
  target.pos.y = dy;
  for (const id of cooldowns) mob.combat!.cooldowns.set(id, Date.now() + 60_000);
  return chooseAttack(mob, target, optionsOf(mobId), Date.now(), def.attackRange, GRACE, REACH_Y);
}

describe("attack kit data invariants", () => {
  it("every boss carries at least two attack types", () => {
    for (const id of ["minotaur_boss", "cinder_golem_boss", "lich_boss"]) {
      expect(mobAttacks(reg.mob(id)).length, id).toBeGreaterThanOrEqual(2);
    }
  });

  it("legacy single-ability mobs normalize to a kit of one", () => {
    const kit = mobAttacks(reg.mob("wolf"));
    expect(kit).toHaveLength(1);
    expect(kit[0]!.ability).toBe("wolf_bite");
  });

  it("every projectile option can reach the mob's attackRange", () => {
    for (const [id, def] of Object.entries(reg.mobs)) {
      for (const a of mobAttacks(def)) {
        const ability = reg.ability(a.ability);
        if (ability.kind === "projectile") {
          expect(ability.maxRange ?? 40, `${id}:${a.ability}`).toBeGreaterThanOrEqual(def.attackRange);
        }
      }
    }
  });
});

describe("chooseAttack", () => {
  it("skeleton: bow at range, sword point-blank, dead band closes in", () => {
    expect(choose("skeleton", 8)).toMatchObject({ kind: "use", option: { id: "bone_bow" } });
    expect(choose("skeleton", 1.5)).toMatchObject({ kind: "use", option: { id: "skeleton_slash" } });
    // between slash reach (2.2+0.6) and the bow's minRange (3.5): advance
    expect(choose("skeleton", 3.1)).toMatchObject({ kind: "close" });
  });

  it("gates melee vertically but keeps the bow live against high targets", () => {
    // target on a ledge 6 up, 2D point-blank: nothing connects → close
    expect(choose("skeleton", 1.5, 6)).toMatchObject({ kind: "close" });
    // same ledge at bow distance: the bow doesn't care about height
    expect(choose("skeleton", 8, 6)).toMatchObject({ kind: "use", option: { id: "bone_bow" } });
  });

  it("a mixed kit advances while reloading; pure-ranged mobs hold ground", () => {
    expect(choose("skeleton", 8, 0, ["bone_bow"])).toMatchObject({ kind: "close" });
    expect(choose("marsh_wisp", 8, 0, ["wisp_bolt"])).toMatchObject({ kind: "wait" });
    // melee cooling down at melee range: stand and glare, don't shuffle
    expect(choose("wolf", 1.2, 0, ["wolf_bite"])).toMatchObject({ kind: "wait" });
  });

  it("lich: scythe point-blank (lance minRange), lance at range", () => {
    // summon on cooldown so the weapon choice is deterministic here
    expect(choose("lich_boss", 1.8, 0, ["lich_summon"])).toMatchObject({ kind: "use", option: { id: "lich_scythe" } });
    expect(choose("lich_boss", 9, 0, ["lich_summon"])).toMatchObject({ kind: "use", option: { id: "shadow_lance" } });
  });

  it("golem: slam in melee (ember minRange), ember burst at range", () => {
    expect(choose("cinder_golem_boss", 2)).toMatchObject({ kind: "use", option: { id: "golem_slam" } });
    expect(choose("cinder_golem_boss", 10)).toMatchObject({ kind: "use", option: { id: "ember_burst" } });
  });
});

describe("RoomSim multi-attack integration", () => {
  let sim: RoomSim;

  function join(id: string, name: string, x = 64, z = 64) {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, x, z), (m) => messages.push(m));
    return { session, messages };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sim = new RoomSim(loadRoomDef("hub"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a skeleton opens with the bow at range and aims flat on level ground", () => {
    const a = join("c1", "Alice");
    const p = a.session.entity.pos;
    const skel = sim.spawnMob("skeleton", p.x + 8, p.z, "")!;
    skel.pos.y = p.y; // same floor: pitch should be ~flat
    vi.setSystemTime(Date.now() + 100);
    sim.tick();
    expect(skel.combat!.act).toBe("windup");
    expect(skel.combat!.ability).toBe("bone_bow");
    expect(Math.abs(skel.combat!.aimPitch)).toBeLessThan(0.15);
  });

  it("a skeleton slashes when the player is in its face", () => {
    const a = join("c1", "Alice");
    const p = a.session.entity.pos;
    const skel = sim.spawnMob("skeleton", p.x + 1.5, p.z, "")!;
    skel.pos.y = p.y;
    vi.setSystemTime(Date.now() + 100);
    sim.tick();
    expect(skel.combat!.act).toBe("windup");
    expect(skel.combat!.ability).toBe("skeleton_slash");
  });

  it("shoots UP at a ledge target with real pitch", () => {
    const a = join("c1", "Alice");
    const p = a.session.entity.pos;
    const skel = sim.spawnMob("skeleton", p.x + 8, p.z, "")!;
    p.y = skel.pos.y + 6; // player up a tower
    vi.setSystemTime(Date.now() + 100);
    sim.tick();
    expect(skel.combat!.ability).toBe("bone_bow");
    expect(skel.combat!.aimPitch).toBeGreaterThan(0.3);
  });

  it("summons minions on release: threat inherited, capped, flavored", () => {
    const a = join("c1", "Alice");
    a.session.entity.health!.maxHp = 1_000_000; // bats must not kill the anchor mid-test
    a.session.entity.health!.hp = 1_000_000;
    const p = a.session.entity.pos;
    const lich = sim.spawnMob("lich_boss", p.x + 8, p.z, "")!;
    lich.pos.y = p.y;
    lich.brain!.threat.set(a.session.entity.id, 50);
    // force the summon: put the lance and scythe on long cooldowns
    lich.combat!.cooldowns.set("shadow_lance", Date.now() + 300_000);
    lich.combat!.cooldowns.set("lich_scythe", Date.now() + 300_000);
    vi.setSystemTime(Date.now() + 100);
    sim.tick();
    expect(lich.combat!.act).toBe("cast");
    expect(lich.combat!.ability).toBe("lich_summon");
    vi.setSystemTime(Date.now() + 1500); // cast 1400 elapses
    sim.tick();
    const bats = () =>
      [...sim.allEntities()].filter((e) => e.kind === "mob" && e.brain?.mobId === "bone_bat" && e.combat!.act !== "dead");
    expect(bats()).toHaveLength(3);
    for (const bat of bats()) {
      expect(bat.brain!.summonerId).toBe(lich.id);
      expect(bat.brain!.threat.get(a.session.entity.id)).toBe(50); // inherits the fight
    }
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("Rise and feast"))).toBe(true);
    // second cast after the cooldown tops up to the cap (5), not past it
    vi.setSystemTime(Date.now() + 15_000);
    sim.tick();
    vi.setSystemTime(Date.now() + 1500);
    sim.tick();
    expect(bats().length).toBe(5);
    // at cap: the option drops out of the kit — no third wave
    vi.setSystemTime(Date.now() + 15_000);
    sim.tick();
    vi.setSystemTime(Date.now() + 1500);
    sim.tick();
    expect(bats().length).toBe(5);
  });

  it("advances toward the player while the bow reloads", () => {
    const a = join("c1", "Alice");
    const p = a.session.entity.pos;
    const skel = sim.spawnMob("skeleton", p.x + 9, p.z, "")!;
    skel.pos.y = p.y;
    // first tick: opens with the bow
    vi.setSystemTime(Date.now() + 100);
    sim.tick();
    expect(skel.combat!.ability).toBe("bone_bow");
    // let the whole shot play out (windup 650 + active 80 + recover 400)
    vi.setSystemTime(Date.now() + 1200);
    sim.tick();
    const dBefore = Math.hypot(skel.pos.x - p.x, skel.pos.z - p.z);
    // bow still cooling down (2500ms): the skeleton should close the gap
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(Date.now() + 100);
      sim.tick();
    }
    const dAfter = Math.hypot(skel.pos.x - p.x, skel.pos.z - p.z);
    expect(dAfter).toBeLessThan(dBefore - 0.5);
  });
});

describe("entity-linked room events", () => {
  function joinRoom(sim: RoomSim, id = "c1", name = "Alice") {
    const messages: ServerToClient[] = [];
    const def = sim.def;
    const session = sim.addPlayer(makeCharacter(id, name, def.spawn.x, def.spawn.z), (m) => messages.push(m));
    return { session, messages };
  }

  it("boots the dungeon with the depths portal sealed behind the Gravelord", () => {
    const sim = new RoomSim(loadRoomDef("dungeon"));
    const wire = sim.portalsWire();
    expect(wire.find((p) => p.id === "dungeon-depths")!.open).toBe(false);
    expect(wire.find((p) => p.id === "dungeon-hub")!.open).toBe(true);
  });

  it("denies the sealed portal with a guardian message", () => {
    const sim = new RoomSim(loadRoomDef("dungeon"));
    const a = joinRoom(sim);
    a.session.entity.pos.x = 46;
    a.session.entity.pos.z = 6.5; // standing right at the depths gate
    expect(sim.validatePortalUse(a.session, "dungeon-depths")).toBeNull();
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("guardian"))).toBe(true);
  });

  it("rallies skeletal adds at half health, once per boss life", () => {
    const sim = new RoomSim(loadRoomDef("dungeon"));
    const a = joinRoom(sim);
    const mino = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "minotaur_boss")!;
    const wave = () =>
      [...sim.allEntities()].filter((e) => e.kind === "mob" && e.brain?.summonerId === mino.id).length;
    expect(wave()).toBe(0);
    sim.applyDamage(a.session.entity, mino, 350); // 596 → ≤246: crosses 50% (crit-safe: 525 < 596)
    expect(mino.combat!.act).not.toBe("dead");
    expect(wave()).toBe(3);
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("bellows"))).toBe(true);
    sim.applyDamage(a.session.entity, mino, 20); // still below the line: no refire
    expect(wave()).toBe(3);
  });

  it("opens the depths gate on the Gravelord's death and reseals on respawn", () => {
    const sim = new RoomSim(loadRoomDef("dungeon"));
    const a = joinRoom(sim);
    const mino = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "minotaur_boss")!;
    sim.applyDamage(a.session.entity, mino, 999_999);
    expect(mino.combat!.act).toBe("dead");
    expect(sim.portalsWire().find((p) => p.id === "dungeon-depths")!.open).toBe(true);
    expect(a.messages.some((m) => m.t === "portalState" && m.target === "crypt_depths" && m.open)).toBe(true);
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("grinds open"))).toBe(true);
    // the gate is usable now
    a.session.entity.pos.x = 46;
    a.session.entity.pos.z = 6.5;
    expect(sim.validatePortalUse(a.session, "dungeon-depths")).not.toBeNull();
    // the guardian stirring anew seals the way again
    sim.spawnMob("minotaur_boss", 46, 12, "boss-hall");
    expect(sim.portalsWire().find((p) => p.id === "dungeon-depths")!.open).toBe(false);
    expect(sim.validatePortalUse(a.session, "dungeon-depths")).toBeNull();
    const lastState = [...a.messages].reverse().find((m) => m.t === "portalState");
    expect(lastState).toMatchObject({ target: "crypt_depths", open: false });
  });

  it("keeps an event-opened gate sealed while the destination room is down", () => {
    const sim = new RoomSim(loadRoomDef("dungeon"));
    const a = joinRoom(sim);
    const mino = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "minotaur_boss")!;
    sim.applyDamage(a.session.entity, mino, 999_999); // event says open...
    sim.setRoomStatus("crypt_depths", false); // ...but the room is collapsed
    expect(sim.portalsWire().find((p) => p.id === "dungeon-depths")!.open).toBe(false);
    sim.setRoomStatus("crypt_depths", true);
    expect(sim.portalsWire().find((p) => p.id === "dungeon-depths")!.open).toBe(true);
  });

  it("re-arms the collapse timer to 60s when the lich falls", () => {
    const sim = new RoomSim(loadRoomDef("crypt_depths"));
    const armed: number[] = [];
    sim.onExpireRequest = (sec) => armed.push(sec);
    const a = joinRoom(sim);
    const lich = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "lich_boss")!;
    sim.applyDamage(a.session.entity, lich, 999_999);
    expect(armed).toEqual([60]);
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("crumble"))).toBe(true);
  });

  it("hp-threshold triggers re-arm when the boss respawns", () => {
    const sim = new RoomSim(loadRoomDef("dungeon"));
    const a = joinRoom(sim);
    const mino = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "minotaur_boss")!;
    sim.applyDamage(a.session.entity, mino, 350); // rally #1
    sim.applyDamage(a.session.entity, mino, 999_999); // dead
    const fresh = sim.spawnMob("minotaur_boss", 46, 12, "boss-hall")!;
    const freshWave = () =>
      [...sim.allEntities()].filter((e) => e.kind === "mob" && e.brain?.summonerId === fresh.id).length;
    sim.applyDamage(a.session.entity, fresh, 350); // rally #2 fires for the new life (crit-safe: 525 < 596)
    expect(freshWave()).toBe(3);
  });
});
