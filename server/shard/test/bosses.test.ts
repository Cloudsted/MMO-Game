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
    expect(choose("lich_boss", 1.8)).toMatchObject({ kind: "use", option: { id: "lich_scythe" } });
    expect(choose("lich_boss", 9)).toMatchObject({ kind: "use", option: { id: "shadow_lance" } });
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
