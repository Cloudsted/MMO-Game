/**
 * Level-scaled mob progression: resolveMob's stat curve + rank-gated ability
 * kits, and the pack-healer (allyHeal) gate.
 *
 * The point of the system: a world-gen mob def is REUSED at higher levels by
 * deeper rooms' spawn tables. Its stats compound and its rank list unlocks
 * extra abilities. These tests pin the math so a tuning pass to
 * constants.mobs.scaling can't silently change what a spawn table means.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { gameConstants, loadRoomDef, resolveMob, mobAllAbilityIds, RegistryService, type MobDef } from "@fantasy-mmo/common";
import { RoomSim } from "../src/sim/room.js";

const consts = gameConstants();
const SCALING = consts.mobs.scaling;

function baseDef(over: Partial<MobDef> = {}): MobDef {
  return {
    name: "Test Mob",
    sprite: "slime",
    level: 5,
    hp: 100,
    damage: 10,
    moveSpeed: 2,
    ability: "swing",
    attacks: undefined,
    ranks: [],
    aggroRadius: 8,
    attackRange: 2,
    leashRadius: 30,
    fleeAtHpPct: 0,
    xp: 20,
    loot: "slime_drops",
    ...over,
  } as MobDef;
}

describe("resolveMob — stat curve", () => {
  it("leaves a mob spawned at its own level untouched", () => {
    const r = resolveMob(baseDef(), undefined, SCALING);
    expect(r.level).toBe(5);
    expect(r.hp).toBe(100);
    expect(r.damage).toBe(10);
    expect(r.xp).toBe(20);
    expect(r.moveSpeed).toBe(2);
  });

  it("compounds hp/damage/xp per level above the def's base level", () => {
    const r = resolveMob(baseDef(), 8, SCALING); // delta 3
    expect(r.level).toBe(8);
    expect(r.hp).toBe(Math.round(100 * Math.pow(1 + SCALING.hpPerLevel, 3)));
    expect(r.damage).toBe(Math.round(10 * Math.pow(1 + SCALING.damagePerLevel, 3)));
    expect(r.xp).toBe(Math.round(20 * Math.pow(1 + SCALING.xpPerLevel, 3)));
  });

  it("never scales a mob DOWN below its authored stats", () => {
    const r = resolveMob(baseDef(), 1, SCALING);
    expect(r.level).toBe(1); // display level obeys the spawn table...
    expect(r.hp).toBe(100); // ...but stats floor at the authored values
    expect(r.damage).toBe(10);
  });

  it("caps the level bonus so a typo cannot mint a boss", () => {
    const huge = resolveMob(baseDef(), 5 + SCALING.maxLevelBonus + 50, SCALING);
    const capped = resolveMob(baseDef(), 5 + SCALING.maxLevelBonus, SCALING);
    expect(huge.hp).toBe(capped.hp);
    expect(huge.damage).toBe(capped.damage);
  });
});

describe("resolveMob — rank-gated kits", () => {
  const ranked = baseDef({
    ability: undefined,
    attacks: [{ ability: "swing", weight: 1 }],
    ranks: [
      { atLevel: 9, add: [{ ability: "bow_shot", weight: 2 }], remove: [], hpMult: 1, damageMult: 1, moveSpeedMult: 1 },
      {
        atLevel: 13,
        add: [{ ability: "firebolt", weight: 3 }],
        remove: ["swing"],
        hpMult: 1.2,
        damageMult: 1.1,
        moveSpeedMult: 1.05,
        titleSuffix: "Veteran",
      },
    ],
  });

  it("keeps the base kit below the first rank", () => {
    const r = resolveMob(ranked, 6, SCALING);
    expect(r.attacks.map((a) => a.ability)).toEqual(["swing"]);
    expect(r.name).toBe("Test Mob");
  });

  it("adds an ability once the level reaches a rank", () => {
    const r = resolveMob(ranked, 9, SCALING);
    expect(r.attacks.map((a) => a.ability)).toEqual(["swing", "bow_shot"]);
  });

  it("applies every rank at or below the level, removing before adding", () => {
    const r = resolveMob(ranked, 14, SCALING);
    expect(r.attacks.map((a) => a.ability)).toEqual(["bow_shot", "firebolt"]);
    expect(r.name).toBe("Test Mob Veteran");
  });

  it("stacks rank multipliers on top of the global per-level curve", () => {
    const r = resolveMob(ranked, 13, SCALING);
    const globalHp = 100 * Math.pow(1 + SCALING.hpPerLevel, 8);
    expect(r.hp).toBe(Math.round(globalHp * 1.2));
    expect(r.moveSpeed).toBeCloseTo(2 * 1.05, 6);
  });

  it("applies ranks in ascending atLevel order regardless of authoring order", () => {
    const shuffled = baseDef({
      ability: undefined,
      attacks: [{ ability: "swing", weight: 1 }],
      ranks: [
        { atLevel: 13, add: [{ ability: "firebolt", weight: 1 }], remove: ["bow_shot"], hpMult: 1, damageMult: 1, moveSpeedMult: 1 },
        { atLevel: 9, add: [{ ability: "bow_shot", weight: 1 }], remove: [], hpMult: 1, damageMult: 1, moveSpeedMult: 1 },
      ],
    });
    // rank 13 removes bow_shot, which only rank 9 adds — order matters
    const r = resolveMob(shuffled, 14, SCALING);
    expect(r.attacks.map((a) => a.ability)).toEqual(["swing", "firebolt"]);
  });

  it("mobAllAbilityIds reports every reachable ability, not just the base kit", () => {
    expect(mobAllAbilityIds(ranked).sort()).toEqual(["bow_shot", "firebolt", "swing"]);
  });

  it("scales per-attack damage overrides so a rank's new ability never hits weaker than the base attack", () => {
    const def = baseDef({
      ability: undefined,
      damage: 10,
      attacks: [{ ability: "swing", weight: 1 }],
      ranks: [{ atLevel: 9, add: [{ ability: "bow_shot", damage: 8, weight: 1 }], remove: [], hpMult: 1, damageMult: 1, moveSpeedMult: 1 }],
    });
    const base = resolveMob(def, 5, SCALING);
    expect(base.attacks.find((a) => a.ability === "swing")!.damage).toBeUndefined(); // no override => uses mob damage

    const deep = resolveMob(def, 12, SCALING); // delta 7
    const mult = Math.pow(1 + SCALING.damagePerLevel, 7);
    expect(deep.damage).toBe(Math.round(10 * mult));
    // the authored 8-vs-10 ratio survives; the override is not left at a literal 8
    expect(deep.attacks.find((a) => a.ability === "bow_shot")!.damage).toBe(Math.round(8 * mult));
    expect(deep.attacks.find((a) => a.ability === "bow_shot")!.damage).toBeGreaterThan(8);
  });

  it("leaves per-attack damage untouched at the def's own level (no behaviour change for shipped mobs)", () => {
    const reg2 = new RegistryService();
    for (const [, def] of Object.entries(reg2.mobs)) {
      const r = resolveMob(def, undefined, SCALING);
      for (const a of r.attacks) {
        const authored = (def.attacks ?? []).find((x) => x.ability === a.ability);
        if (authored?.damage !== undefined) expect(a.damage).toBe(authored.damage);
      }
      expect(r.hp).toBe(def.hp);
      expect(r.damage).toBe(def.damage);
    }
  });
});

describe("registry cross-checks", () => {
  const reg = new RegistryService();

  it("every shipped mob's whole reachable kit resolves to a real ability", () => {
    for (const [id, def] of Object.entries(reg.mobs)) {
      for (const abilityId of mobAllAbilityIds(def)) {
        expect(reg.abilities[abilityId], `mob ${id}: ability ${abilityId}`).toBeTruthy();
      }
    }
  });

  it("every rank-added projectile's maxRange covers its mob's attackRange", () => {
    for (const [id, def] of Object.entries(reg.mobs)) {
      const top = resolveMob(def, def.level + SCALING.maxLevelBonus, SCALING);
      for (const a of top.attacks) {
        const ab = reg.abilities[a.ability]!;
        if (ab.kind !== "projectile") continue;
        expect(ab.maxRange ?? 0, `mob ${id}: ${a.ability} maxRange must cover attackRange`).toBeGreaterThanOrEqual(
          def.attackRange
        );
      }
    }
  });

  it("every allyHeal ability is a self-kind cast (the FSM releases it there)", () => {
    for (const [id, ab] of Object.entries(reg.abilities)) {
      if (!ab.allyHeal) continue;
      expect(ab.kind, `ability ${id}`).toBe("self");
    }
  });

  it("scaling a shipped mob up preserves its identity but raises its numbers", () => {
    const wolf = reg.mobs["wolf"]!;
    const deep = resolveMob(wolf, wolf.level + 8, SCALING);
    expect(deep.hp).toBeGreaterThan(wolf.hp);
    expect(deep.damage).toBeGreaterThan(wolf.damage);
    expect(deep.xp).toBeGreaterThan(wolf.xp);
    expect(deep.attacks.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * The Thornhollow Company is the whole point of the rank system: gloomfen's
 * `drowned-company` table reuses the FOREST defs at level 11-12, and the fight
 * has to actually change. These pin the ladder the design promised.
 */
describe("the Thornhollow Company ladder", () => {
  const reg = new RegistryService();
  const kit = (id: string, level?: number) => resolveMob(reg.mobs[id]!, level, SCALING).attacks.map((a) => a.ability).sort();

  it("the forest crew only has its honest opener", () => {
    expect(kit("bandit")).toEqual(["bandit_slash"]);
    expect(kit("bandit_enforcer")).toEqual(["cleave"]);
    expect(kit("hollow_cowl")).toEqual(["wisp_bolt"]);
    expect(kit("powder_brigand")).toEqual(["powder_flask"]);
    expect(kit("camp_cur")).toEqual(["wolf_bite"]);
  });

  it("the fen crew (the levels gloomfen actually spawns) has learned things", () => {
    // levels here mirror shared/rooms/gloomfen.json's drowned-company table
    expect(kit("bandit", 12)).toEqual(["quick_stab", "thrust"]); // slash removed: he lunges and you bleed
    expect(kit("greenhood_poacher", 11)).toEqual(["bolt_shot", "quick_stab", "thrust"]); // bow removed
    expect(kit("powder_brigand", 11)).toEqual(["fuse_line", "oil_flask"]); // powder_flask removed
    expect(kit("bandit_enforcer", 12)).toEqual(["cleave", "crown_strike", "iron_bash"]);
    expect(kit("camp_cur", 12)).toEqual(["raptor_bite", "spider_bite"]); // wolf_bite removed
  });

  it("THE HEALER APPEARS at L10, not before, and it is interruptible", () => {
    expect(kit("hollow_cowl", 9)).toEqual(["wisp_bolt"]);
    expect(kit("hollow_cowl", 10)).toEqual(["mend_kin", "wisp_bolt"]);
    expect(kit("hollow_cowl", 11)).toEqual(["mend_kin", "wisp_bolt"]); // what gloomfen spawns

    const mend = reg.abilities["mend_kin"]!;
    expect(mend.kind).toBe("self");
    expect(mend.allyHeal).toBeTruthy();
    // the fight's central mechanic: you can stop the heal
    expect(mend.interruptible).toBe(true);
  });

  it("a deeper Cowl swaps its mend for a bigger one (ranks cannot scale a payload)", () => {
    expect(kit("hollow_cowl", 13)).toEqual(["mend_kin_greater", "wisp_bolt"]);
    expect(reg.abilities["mend_kin_greater"]!.allyHeal!.amount).toBeGreaterThan(
      reg.abilities["mend_kin"]!.allyHeal!.amount
    );
  });

  it("gives the fen crew real numbers, and names them", () => {
    const forest = resolveMob(reg.mobs["bandit"]!, undefined, SCALING);
    const fen = resolveMob(reg.mobs["bandit"]!, 12, SCALING);
    expect(fen.hp).toBeGreaterThan(forest.hp * 2);
    expect(fen.xp).toBeGreaterThan(forest.xp * 2);
    expect(fen.name).toBe("Thornhollow Cutthroat Bloodletter");
    expect(resolveMob(reg.mobs["hollow_cowl"]!, 11, SCALING).name).toBe("Hollow Cowl Priest");
  });

  it("the goat never fights: it cannot initiate, and it flees the moment it is touched", () => {
    const goat = reg.mobs["stolen_goat"]!;
    expect(goat.aggroRadius).toBe(0); // the brain skips targets outside aggroRadius while threat is 0
    expect(goat.fleeAtHpPct).toBe(1.0); // hp/maxHp < 1.0 is false at full health, true after any damage
    expect(goat.ranks).toEqual([]); // a goat is a goat at every level
  });

  it("every gloomfen drowned-company level actually crosses a rank threshold", () => {
    // a `level` in a spawn table that unlocks nothing is a silent no-op — catch it
    const table = loadRoomDef("gloomfen").spawnTables.find((t) => t.id === "drowned-company")!;
    expect(table.mobs.length).toBeGreaterThan(0);
    for (const entry of table.mobs) {
      const def = reg.mobs[entry.mob]!;
      expect(entry.level, `${entry.mob} needs a level override`).toBeDefined();
      const base = resolveMob(def, undefined, SCALING).attacks.map((a) => a.ability).sort();
      const deep = resolveMob(def, entry.level, SCALING).attacks.map((a) => a.ability).sort();
      expect(deep, `${entry.mob} @L${entry.level} learned nothing`).not.toEqual(base);
    }
  });

  it("every projectile in every reachable kit can reach as far as its mob attacks from", () => {
    for (const id of ["bandit", "greenhood_poacher", "powder_brigand", "hollow_cowl", "bandit_enforcer", "camp_cur", "thrace_redcap"]) {
      const def = reg.mobs[id]!;
      for (let lvl = def.level; lvl <= def.level + SCALING.maxLevelBonus; lvl++) {
        for (const a of resolveMob(def, lvl, SCALING).attacks) {
          const ab = reg.abilities[a.ability]!;
          if (ab.kind !== "projectile") continue;
          expect(ab.maxRange ?? 0, `${id} @L${lvl}: ${a.ability}`).toBeGreaterThanOrEqual(def.attackRange);
        }
      }
    }
  });
});

/**
 * The pack healer, end to end in a live RoomSim: the gate (no cast while everyone
 * is healthy), the heal itself (allies mended on release), and the counterplay
 * (the cast is interruptible, unlike every other mob ability in the game).
 */
describe("Hollow Cowl: the pack healer in a live room", () => {
  let sim: RoomSim;

  function join(id: string, name: string, x = 64, z = 64) {
    const messages: ServerToClient[] = [];
    const character: CharacterSnapshot = {
      id, name, level: 1, xp: 0, gold: 0, inventory: [], x, y: 0, z, yaw: 0, roles: ["player"],
    };
    const session = sim.addPlayer(character, (m) => messages.push(m));
    return { session, messages };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sim = new RoomSim(loadRoomDef("hub"));
  });
  afterEach(() => vi.useRealTimers());

  /** A Cowl at the level gloomfen spawns it (11): mend_kin unlocked. */
  function spawnCowl(x: number, z: number) {
    const c = sim.spawnMob("hollow_cowl", x, z, "", 11)!;
    return c;
  }

  it("does NOT cast the mend while every ally is healthy", () => {
    const a = join("c1", "Alice");
    const p = a.session.entity.pos;
    const cowl = spawnCowl(p.x + 10, p.z);
    cowl.pos.y = p.y;
    // a healthy packmate in radius
    const mate = sim.spawnMob("bandit", p.x + 11, p.z, "")!;
    mate.pos.y = p.y;
    vi.setSystemTime(Date.now() + 100);
    sim.tick();
    // wisp_bolt is the only option it will offer
    expect(cowl.combat!.ability).toBe("wisp_bolt");
  });

  it("mends a wounded packmate on release, and says so", () => {
    const a = join("c1", "Alice");
    const p = a.session.entity.pos;
    const cowl = spawnCowl(p.x + 10, p.z);
    cowl.pos.y = p.y;
    const mate = sim.spawnMob("bandit", p.x + 11, p.z, "")!;
    mate.pos.y = p.y;
    mate.health!.hp = Math.floor(mate.health!.maxHp * 0.3); // clearly below 70%
    const before = mate.health!.hp;
    // keep the bolt out of the running so the mend is the only usable option
    cowl.combat!.cooldowns.set("wisp_bolt", Date.now() + 300_000);

    vi.setSystemTime(Date.now() + 100);
    sim.tick();
    expect(cowl.combat!.act).toBe("cast");
    expect(cowl.combat!.ability).toBe("mend_kin");

    vi.setSystemTime(Date.now() + 1600); // castTimeMs 1500 elapses
    sim.tick();
    expect(mate.health!.hp).toBeGreaterThan(before);
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("the wounds close"))).toBe(true);
  });

  it("heals every wounded mob in radius, and not the player", () => {
    const a = join("c1", "Alice");
    const p = a.session.entity.pos;
    a.session.entity.health!.hp = 10; // the player is the most wounded thing here
    const cowl = spawnCowl(p.x + 10, p.z);
    cowl.pos.y = p.y;
    const near = sim.spawnMob("bandit", p.x + 11, p.z, "")!;
    const far = sim.spawnMob("bandit", p.x + 40, p.z, "")!; // outside radius 9
    for (const m of [near, far]) { m.pos.y = p.y; m.health!.hp = 20; }
    cowl.combat!.cooldowns.set("wisp_bolt", Date.now() + 300_000);

    vi.setSystemTime(Date.now() + 100);
    sim.tick();
    vi.setSystemTime(Date.now() + 1600);
    sim.tick();

    const mend = new RegistryService().abilities["mend_kin"]!.allyHeal!;
    expect(near.health!.hp).toBe(Math.min(near.health!.maxHp, 20 + mend.amount));
    expect(far.health!.hp).toBe(20); // outside radius 9
    // allyHeal is for mobs only. The player creeps up from ordinary hp regen
    // (2/s, off the 5 s post-damage gate) — never by the mend's 55.
    expect(a.session.entity.health!.hp).toBeGreaterThanOrEqual(10);
    expect(a.session.entity.health!.hp).toBeLessThan(10 + mend.amount / 2);
  });

  it("the mend can be INTERRUPTED — the counterplay the fight is built on", () => {
    const a = join("c1", "Alice");
    const p = a.session.entity.pos;
    const cowl = spawnCowl(p.x + 10, p.z);
    cowl.pos.y = p.y;
    const mate = sim.spawnMob("bandit", p.x + 11, p.z, "")!;
    mate.pos.y = p.y;
    mate.health!.hp = 20;
    cowl.combat!.cooldowns.set("wisp_bolt", Date.now() + 300_000);

    vi.setSystemTime(Date.now() + 100);
    sim.tick();
    expect(cowl.combat!.act).toBe("cast");

    // hit the caster mid-cast
    sim.applyDamage(a.session.entity, cowl, 5, "melee");
    expect(cowl.combat!.act).toBe("stagger");
    expect(cowl.combat!.ability).toBeNull();

    vi.setSystemTime(Date.now() + 1600);
    sim.tick();
    expect(mate.health!.hp).toBe(20); // the heal never landed
  });

  it("a forest Cowl (L7) has no mend at all", () => {
    const a = join("c1", "Alice");
    const p = a.session.entity.pos;
    const cowl = sim.spawnMob("hollow_cowl", p.x + 10, p.z, "")!; // no level override
    cowl.pos.y = p.y;
    const mate = sim.spawnMob("bandit", p.x + 11, p.z, "")!;
    mate.pos.y = p.y;
    mate.health!.hp = 10;
    cowl.combat!.cooldowns.set("wisp_bolt", Date.now() + 300_000);
    vi.setSystemTime(Date.now() + 100);
    sim.tick();
    expect(cowl.combat!.act).not.toBe("cast");
    vi.setSystemTime(Date.now() + 1600);
    sim.tick();
    expect(mate.health!.hp).toBe(10);
  });
});

/**
 * Two traps the R&D judges found by reading combat.ts, both now impossible to
 * author. Neither is tripped by any shipped mob; these tests keep it that way.
 */
describe("registry guards against latent mob traps", () => {
  const reg = new RegistryService();

  it("no mob can carry a mana ability (it would whiff-loop forever)", () => {
    // startAbility() refuses a mana ability on a mana-less entity and returns
    // BEFORE setting a cooldown, so chooseAttack re-picks it every single tick.
    for (const [id, def] of Object.entries(reg.mobs)) {
      for (const abilityId of mobAllAbilityIds(def)) {
        expect(reg.abilities[abilityId]!.manaCost, `mob ${id}: ${abilityId}`).toBe(0);
      }
    }
  });

  it("no summon summons itself, and nothing summoned can summon", () => {
    for (const [id, def] of Object.entries(reg.mobs)) {
      for (const abilityId of mobAllAbilityIds(def)) {
        const spec = reg.abilities[abilityId]!.summon;
        if (!spec) continue;
        expect(spec.mob, `mob ${id}: ${abilityId} summons itself`).not.toBe(id);
        const child = reg.mobs[spec.mob]!;
        for (const childAbility of mobAllAbilityIds(child)) {
          expect(reg.abilities[childAbility]?.summon, `${id} -> ${spec.mob} -> ${childAbility}`).toBeFalsy();
        }
      }
    }
  });
});

/**
 * E1: ranks may change a mob's NERVE, not just its numbers and its buttons.
 * All three R&D judges converged on this independently — without it, "the same
 * mob is genuinely different deep" only ever means "the same mob has more hp".
 */
describe("rank disposition overrides", () => {
  const timid = baseDef({
    aggroRadius: 0,
    fleeAtHpPct: 1.0,
    attackRange: 1.5,
    leashRadius: 8,
    ranks: [
      { atLevel: 10, add: [], remove: [], hpMult: 1, damageMult: 1, moveSpeedMult: 1,
        aggroRadius: 12, fleeAtHpPct: 0, titleSuffix: "Wrung" },
      { atLevel: 14, add: [], remove: [], hpMult: 1, damageMult: 1, moveSpeedMult: 1,
        attackRange: 18, leashRadius: 40 },
    ],
  });

  it("carries the def's disposition when no rank applies", () => {
    const r = resolveMob(timid, 5, SCALING);
    expect(r.aggroRadius).toBe(0);
    expect(r.fleeAtHpPct).toBe(1.0);
    expect(r.attackRange).toBe(1.5);
    expect(r.leashRadius).toBe(8);
  });

  it("the harmless thing stops running", () => {
    const r = resolveMob(timid, 10, SCALING);
    expect(r.aggroRadius).toBe(12); // it sees you now
    expect(r.fleeAtHpPct).toBe(0); // and it does not run
    expect(r.name).toBe("Test Mob Wrung");
    expect(r.attackRange).toBe(1.5); // untouched by this rank
  });

  it("later ranks override earlier ones; absolute, not multiplicative", () => {
    const r = resolveMob(timid, 14, SCALING);
    expect(r.aggroRadius).toBe(12);
    expect(r.attackRange).toBe(18);
    expect(r.leashRadius).toBe(40);
  });

  it("every shipped mob resolves to its own disposition at its own level", () => {
    const reg = new RegistryService();
    for (const [id, def] of Object.entries(reg.mobs)) {
      const r = resolveMob(def, undefined, SCALING);
      expect(r.aggroRadius, id).toBe(def.aggroRadius);
      expect(r.attackRange, id).toBe(def.attackRange);
      expect(r.leashRadius, id).toBe(def.leashRadius);
      expect(r.fleeAtHpPct, id).toBe(def.fleeAtHpPct);
    }
  });
});

/** E2: summon grants. A splitter's halves must not each pay full xp and loot. */
describe("summon xp/loot hygiene", () => {
  const reg = new RegistryService();

  it("shipped boss adds still grant xp and loot (an intentional risk/reward)", () => {
    for (const id of ["lich_summon", "oath_summon"]) {
      const spec = reg.abilities[id]!.summon!;
      expect(spec.grantsXp, id).toBe(true);
      expect(spec.grantsLoot, id).toBe(true);
    }
  });

  it("the chain guard looks at the child's BASE kit, not its rank-gated kit", () => {
    // summonWave() spawns minions with no level override, so an ability behind a
    // rank the minion can never reach is not a chain. If summonWave learns to pass
    // a level, this test and the registry guard must widen together.
    for (const [id, def] of Object.entries(reg.mobs)) {
      for (const abilityId of mobAllAbilityIds(def)) {
        const spec = reg.abilities[abilityId]!.summon;
        if (!spec) continue;
        const child = reg.mobs[spec.mob]!;
        const baseKit = (child.attacks ?? (child.ability ? [{ ability: child.ability, weight: 1 }] : []));
        for (const a of baseKit) expect(reg.abilities[a.ability]?.summon, `${id} -> ${spec.mob}`).toBeFalsy();
      }
    }
  });
});
