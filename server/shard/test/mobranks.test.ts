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
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { gameConstants, loadRoomDef, resolveMob, mobAllAbilityIds, mobAttacks, RegistryService, type MobDef } from "@fantasy-mmo/common";
import { RoomSim } from "../src/sim/room.js";

/** The shipped audio manifest — mob `sounds` must name groups that exist in it. */
const AUDIO_MANIFEST = resolve(dirname(fileURLToPath(import.meta.url)), "../../../client/assets/audio/manifest.json");

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
    expect(kit("bandit", 10)).toEqual(["quick_stab", "thrust"]); // slash removed: he lunges and you bleed
    expect(kit("greenhood_poacher", 9)).toEqual(["bolt_shot", "quick_stab", "thrust"]); // bow removed
    expect(kit("powder_brigand", 9)).toEqual(["fuse_line", "oil_flask"]); // powder_flask removed
    expect(kit("bandit_enforcer", 10)).toEqual(["cleave", "crown_strike", "iron_bash"]);
    expect(kit("camp_cur", 9)).toEqual(["raptor_bite", "spider_bite"]); // wolf_bite removed
  });

  it("THE HEALER APPEARS at L8, not before, and it is interruptible", () => {
    expect(kit("hollow_cowl", 7)).toEqual(["wisp_bolt"]);
    expect(kit("hollow_cowl", 8)).toEqual(["mend_kin", "wisp_bolt"]);
    expect(kit("hollow_cowl", 9)).toEqual(["mend_kin", "wisp_bolt"]); // what gloomfen spawns

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
    const fen = resolveMob(reg.mobs["bandit"]!, 10, SCALING);
    expect(fen.hp).toBeGreaterThan(forest.hp * 2);
    expect(fen.xp).toBeGreaterThan(forest.xp * 2);
    expect(fen.name).toBe("Thornhollow Cutthroat Bloodletter");
    expect(resolveMob(reg.mobs["hollow_cowl"]!, 9, SCALING).name).toBe("Hollow Cowl Priest");
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

  /** A Cowl at the level gloomfen spawns it (9): mend_kin unlocked. */
  function spawnCowl(x: number, z: number) {
    const c = sim.spawnMob("hollow_cowl", x, z, "", 9)!;
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

  it("a forest Cowl (L4, no override) has no mend at all", () => {
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
        // The child is judged on its BASE kit, exactly as registry.ts does:
        // summonWave() spawns minions with no level override, so a summon
        // sitting behind a rank the minion can never reach is not a chain.
        // (Grelmoss's mire_spawn raises L8 fen_slimes; slime_split is their
        // L14 rank, and nothing in the mire ever spawns one at 14.)
        for (const childAttack of mobAttacks(child)) {
          expect(reg.abilities[childAttack.ability]?.summon, `${id} -> ${spec.mob} -> ${childAttack.ability}`).toBeFalsy();
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

/**
 * The roster-2 bestiary: the crypt assembly line, the Cinderrift foundry, the
 * tomb court, the mire, and the two wanderers. Every mob here is a level-scaled
 * def that a spawn table is expected to REUSE deeper — these pin the ladders the
 * design promised (docs/content-design-2.md, docs/asset-catalog/roster-2.json)
 * so a tuning pass cannot quietly turn a rank into a no-op.
 */
describe("the roster-2 bestiary ladders", () => {
  const reg = new RegistryService();
  const kit = (id: string, level?: number) => resolveMob(reg.mobs[id]!, level, SCALING).attacks.map((a) => a.ability).sort();
  const at = (id: string, level?: number) => resolveMob(reg.mobs[id]!, level, SCALING);

  /** Every mob roster-2 added, plus `skeleton` (re-ranked, not re-authored). */
  const ROSTER = [
    "skeleton", "restless_bones", "ossuary_stitcher", "bone_warden", "grave_harrower", "crypt_ghoul",
    "pallid_mourner", "ember_warplate", "forge_tender", "frostplate_revenant", "slagback_troll",
    "forge_ward", "forge_prototype", "sandpicker", "withered_courtier", "duneshadow_lioness",
    "kaharat", "sekhat", "glimmereye", "fen_slime", "fen_slimeling", "bloatslime", "grelmoss",
    "aelthir", "cinder_nightmare",
  ];

  it("every roster mob exists", () => {
    for (const id of ROSTER) expect(reg.mobs[id], id).toBeTruthy();
  });

  // ---- THE HEADLINE: skeleton's four-rank ladder, zero new abilities ----

  it("the skeleton ladder resolves to the right kit at 6 / 9 / 12 / 14", () => {
    // L6 conscript: a chipped sword he sometimes remembers to swap for a bow
    expect(kit("skeleton", 6)).toEqual(["bone_bow", "skeleton_slash"]);
    expect(at("skeleton", 6).name).toBe("Skeleton");
    // L9 Soldier: he stops flailing and starts sweeping
    expect(kit("skeleton", 9)).toEqual(["bone_bow", "cleave", "skeleton_slash"]);
    expect(at("skeleton", 9).name).toBe("Skeleton Soldier");
    // L12 Legionary: the slash is GONE — a 3.4 m pike jabs from the second rank
    expect(kit("skeleton", 12)).toEqual(["bone_bow", "cleave", "thrust"]);
    expect(at("skeleton", 12).name).toBe("Skeleton Legionary");
    expect(reg.abilities["thrust"]!.range!).toBeGreaterThan(reg.abilities["skeleton_slash"]!.range!);
    // L14 Deathless Legionary: pike + volley + a full sweep. Kiting into the pack punishes.
    expect(kit("skeleton", 14)).toEqual(["bone_bow", "cleave", "reap", "thrust"]);
    expect(at("skeleton", 14).name).toBe("Skeleton Deathless Legionary");
  });

  it("the L14 Legionary is a different fight, not a bigger number (~327 hp / 27 dmg)", () => {
    const base = at("skeleton", 6);
    const deep = at("skeleton", 14);
    expect(deep.hp).toBe(327);
    expect(deep.damage).toBe(27);
    expect(deep.hp).toBeGreaterThan(base.hp * 3);
    expect(deep.moveSpeed).toBeCloseTo(base.moveSpeed * 1.08, 6);
  });

  // ---- the crypt: an assembly line the player walks ----

  it("the Stitcher learns to reanimate at 12 and swaps its mend for a bigger one at 14", () => {
    expect(kit("ossuary_stitcher", 9)).toEqual(["mend_kin", "shadow_lance"]);
    expect(kit("ossuary_stitcher", 12)).toEqual(["mend_kin", "raise_bones", "shadow_lance"]);
    expect(kit("ossuary_stitcher", 14)).toEqual(["mend_kin_greater", "raise_bones", "shadow_lance"]);
    // the fight's counterplay: you can interrupt the mend, and DoT bites cannot
    expect(reg.abilities["mend_kin"]!.interruptible).toBe(true);
    expect(reg.abilities["mend_kin_greater"]!.interruptible).toBe(true);
    expect(reg.abilities["raise_bones"]!.summon!.mob).toBe("restless_bones");
  });

  it("the Harrower trades its raise for a muster at 15, and gains reach", () => {
    expect(kit("grave_harrower", 12)).toEqual(["raise_bones", "reap", "scythe_hook"]);
    expect(kit("grave_harrower", 15)).toEqual(["harvest_muster", "reap", "scythe_hook", "shadow_lance"]);
    // raise_bones conjures the worthless thing; harvest_muster forms ranks of armed ones
    expect(reg.abilities["harvest_muster"]!.summon!.mob).toBe("skeleton");
  });

  it("the Bone Warden's rank widens its own leash and reach — the anti-kite gets worse", () => {
    const base = at("bone_warden", 10);
    const deep = at("bone_warden", 14);
    expect(base.attackRange).toBe(20);
    expect(deep.attackRange).toBe(22); // absolute override, not a multiplier
    expect(deep.leashRadius).toBe(46);
    expect(kit("bone_warden", 14)).toEqual(["bone_shrapnel", "boss_slam", "cleave"]);
    // the mixed melee+ranged kit is what makes chooseAttack CLOSE between shots
    expect(reg.abilities["boss_slam"]!.kind).toBe("melee");
    expect(reg.abilities["bone_shrapnel"]!.kind).toBe("projectile");
  });

  it("THE HARMLESS ONE stops being harmless: pallid_mourner at L13 has aggroRadius 12", () => {
    const base = at("pallid_mourner", 6);
    expect(base.aggroRadius).toBe(0); // it cannot initiate
    expect(base.fleeAtHpPct).toBe(1); // and it runs the instant you touch it
    expect(kit("pallid_mourner", 6)).toEqual(["punch"]);

    const shade = at("pallid_mourner", 13);
    expect(shade.aggroRadius).toBe(12); // it sees you
    expect(shade.fleeAtHpPct).toBe(0); // and it does not run
    expect(kit("pallid_mourner", 13)).toEqual(["wraith_touch"]); // the punch is gone
    expect(shade.name).toBe("Pallid Mourner Wrung Shade");
    expect(shade.damage).toBeGreaterThan(base.damage * 6);
  });

  it("the crypt ghoul's second rank sharpens its nerve, not its buttons", () => {
    expect(kit("crypt_ghoul", 7)).toEqual(["spider_bite"]);
    expect(kit("crypt_ghoul", 11)).toEqual(["quick_stab", "spider_bite"]);
    expect(at("crypt_ghoul", 11).aggroRadius).toBe(8);
    expect(at("crypt_ghoul", 14).aggroRadius).toBe(13); // it smells you from further off
    expect(reg.abilities["spider_bite"]!.debuff!.dotTotal!).toBeGreaterThan(0); // it leaves you bleeding
  });

  // ---- the Cinderrift foundry: a product line, and the woman who repairs it ----

  it("the warplate line ends as a Foundry Captain wielding a king's cleave", () => {
    expect(kit("ember_warplate", 12)).toEqual(["ember_cleave"]);
    expect(kit("ember_warplate", 14)).toEqual(["ember_burst", "ember_cleave"]);
    expect(kit("ember_warplate", 16)).toEqual(["ember_burst", "kings_cleave"]); // cleave swapped out
    expect(at("ember_warplate", 16).name).toBe("Ember Warplate Foundry Captain");
  });

  it("the Forge-Tender is a healer you CANNOT interrupt, and she out-ranges you at 16", () => {
    const mend = reg.abilities["forge_mend"]!;
    expect(mend.kind).toBe("self");
    expect(mend.allyHeal).toBeTruthy();
    // the crypt's Stitcher can be staggered mid-cast; the Forge-Tender cannot.
    // The only counterplay is to kill her, and that is the point of the mob.
    expect(mend.interruptible).toBe(false);
    expect(reg.abilities["mend_kin"]!.interruptible).toBe(true); // the contrast is deliberate
    expect(reg.abilities["slag_gorge"]!.allyHeal!.includeSelf).toBe(true); // the troll heals itself

    expect(kit("forge_tender", 12)).toEqual(["elemental_bolt", "forge_mend"]);
    expect(kit("forge_tender", 14)).toEqual(["elemental_bolt", "forge_mend", "magma_vents"]);
    expect(at("forge_tender", 12).attackRange).toBe(12);
    expect(at("forge_tender", 16).attackRange).toBe(16); // the L16 rank is purely disposition + stats
  });

  it("the roaming Revenant's rank is pure nerve: it sees further and it never lets go", () => {
    expect(kit("frostplate_revenant", 13)).toEqual(kit("frostplate_revenant", 15)); // no new buttons
    expect(at("frostplate_revenant", 15).aggroRadius).toBe(18);
    expect(at("frostplate_revenant", 15).leashRadius).toBe(80); // you do not outwalk it
    expect(at("frostplate_revenant", 15).hp).toBeGreaterThan(at("frostplate_revenant", 13).hp * 1.3);
  });

  it("the Prototype trades a vent line for the throne's flames", () => {
    expect(kit("forge_prototype", 14)).toEqual(["golem_slam", "magma_vents", "slag_lob"]);
    expect(kit("forge_prototype", 16)).toEqual(["golem_slam", "slag_lob", "throne_flames"]);
    expect(reg.abilities["magma_vents"]!.kind).toBe("pillars");
    expect(reg.abilities["throne_flames"]!.kind).toBe("pillars");
  });

  it("the Forge-Ward is a statue until it isn't (aggro 4, speed 1.6 -> 2.4)", () => {
    const statue = at("forge_ward", 13);
    expect(statue.aggroRadius).toBe(4); // walk around it and it never wakes
    expect(statue.leashRadius).toBe(12);
    const awake = at("forge_ward", 15);
    expect(awake.leashRadius).toBe(34);
    expect(awake.moveSpeed).toBeCloseTo(1.6 * 1.5, 6);
    expect(kit("forge_ward", 15)).toEqual(["boss_slam", "pounce", "stone_shard"]);
  });

  // ---- the tomb court ----

  it("the sandpicker graduates from a bone bow to a crossbow, and never keeps both", () => {
    expect(kit("sandpicker", 5)).toEqual(["bone_bow", "quick_stab"]);
    expect(kit("sandpicker", 8)).toEqual(["bone_bow", "cleave", "quick_stab"]);
    expect(kit("sandpicker", 12)).toEqual(["bolt_shot", "cleave", "quick_stab"]);
    expect(at("sandpicker", 5).fleeAtHpPct).toBe(0.3); // he still runs
  });

  it("the Courtier becomes a Tomb-Herald who raises the dead", () => {
    expect(kit("withered_courtier", 6)).toEqual(["grave_rot"]);
    expect(kit("withered_courtier", 9)).toEqual(["binding_wrap", "grave_rot"]);
    expect(kit("withered_courtier", 12)).toEqual(["binding_wrap", "courtiers_grief", "grave_rot", "reap"]);
    expect(at("withered_courtier", 16).name).toBe("Withered Courtier Sekhat's Own");
    expect(reg.abilities["courtiers_grief"]!.summon!.mob).toBe("skeleton");
  });

  it("Kaharat calls the pride he leads — and the pride is a real mob, not an add", () => {
    expect(kit("kaharat")).toEqual(["lion_maul", "pounce", "pride_roar"]);
    expect(reg.abilities["pride_roar"]!.summon!.mob).toBe("duneshadow_lioness");
    expect(reg.mobs["duneshadow_lioness"]).toBeTruthy();
    // the fight teaches "kill the caller": at cap the roar drops out of the kit
    expect(reg.abilities["pride_roar"]!.summon!.cap).toBeGreaterThan(0);
  });

  it("Sekhat is a terminus: no ranks, and the biggest kit in the tomb", () => {
    expect(reg.mobs["sekhat"]!.ranks).toEqual([]);
    expect(kit("sekhat")).toEqual(["binding_wrap", "boss_slam", "courtiers_grief", "grave_rot"]);
    expect(at("sekhat").hp).toBeGreaterThan(at("withered_courtier").hp * 4);
  });

  // ---- the mire ----

  it("the fen slime is the cheapest demonstration of ranks in the game", () => {
    expect(kit("fen_slime", 8)).toEqual(["mire_cling"]); // a puddle that hugs you
    expect(kit("fen_slime", 11)).toEqual(["caustic_gob", "mire_cling"]); // it spits
    expect(kit("fen_slime", 14)).toEqual(["caustic_gob", "mire_cling", "slime_split"]); // it multiplies
    expect(at("fen_slime", 14).name).toBe("Fen Slime Teeming");
  });

  it("Grelmoss's mire_spawn raises BASE-level fen slimes, which cannot split (no summon chain)", () => {
    const spec = reg.abilities["mire_spawn"]!.summon!;
    expect(spec.mob).toBe("fen_slime");
    // summonWave passes no level override, so the wave resolves at the def's own level
    expect(kit(spec.mob)).not.toContain("slime_split");
    // and the registry's own chain guard agrees
    for (const a of reg.mobs[spec.mob]!.attacks!) expect(reg.abilities[a.ability]!.summon).toBeFalsy();
  });

  it("the splitters summon a DISTINCT terminal mob (fen_slimeling has no ranks and no summon)", () => {
    const spec = reg.abilities["slime_split"]!.summon!;
    expect(spec.mob).toBe("fen_slimeling");
    expect(spec.mob).not.toBe("fen_slime"); // a self-summon would be an infinite mire
    expect(reg.mobs["fen_slimeling"]!.ranks).toEqual([]);
    expect(mobAllAbilityIds(reg.mobs["fen_slimeling"]!).every((a) => !reg.abilities[a]!.summon)).toBe(true);
  });

  it("EVERY splitter's summon grants no xp and no loot (waiting next to one is not a job)", () => {
    // raise_bones/pride_roar/slime_split/mire_spawn conjure ordinary spawnable mobs.
    // If their halves paid full xp+loot, standing next to a Bloatslime would be a farm.
    for (const id of ["raise_bones", "pride_roar", "slime_split", "mire_spawn", "harvest_muster", "courtiers_grief"]) {
      const spec = reg.abilities[id]!.summon!;
      expect(spec.grantsXp, `${id}.grantsXp`).toBe(false);
      expect(spec.grantsLoot, `${id}.grantsLoot`).toBe(false);
    }
    // and the two authored boss adds still pay out, by design
    for (const id of ["lich_summon", "oath_summon"]) {
      expect(reg.abilities[id]!.summon!.grantsXp, id).toBe(true);
    }
  });

  it("the Bloatslime is a DPS check: it splits from the base kit, and it is slow", () => {
    expect(kit("bloatslime", 10)).toEqual(["slime_split", "wraith_touch"]);
    expect(kit("bloatslime", 13)).toEqual(["caustic_gob", "slime_split", "wraith_touch"]); // it spits now
    expect(at("bloatslime").moveSpeed).toBeLessThan(2); // slow enough to walk away from...
  });

  // ---- the two wanderers ----

  it("Aelthir cannot initiate — you have to swing first", () => {
    const a = at("aelthir");
    expect(a.aggroRadius).toBe(0);
    // and once you do it follows — but it MUST give up. At 4.6 m/s vs the player's
    // 4.5 there is no outrunning it, so the leash is the only escape hatch (see the
    // "anything that outruns the player must eventually give up" invariant).
    expect(a.leashRadius).toBe(40);
    expect(kit("aelthir")).toEqual(["horn_charge", "radiant_mend"]);
    expect(reg.abilities["radiant_mend"]!.kind).toBe("self");
    expect(reg.mobs["aelthir"]!.loot).toBe("unmarred_drops");
  });

  it("the Cinder Nightmare punishes standing still AND kiting, at every rank", () => {
    expect(kit("cinder_nightmare", 14)).toEqual(["ember_trail", "nightmare_charge"]);
    expect(kit("cinder_nightmare", 17)).toEqual(["ember_trail", "nightmare_charge", "sundering_wave"]);
    expect(reg.abilities["ember_trail"]!.kind).toBe("pillars"); // anti-kite ground hazard
    expect(reg.abilities["nightmare_charge"]!.kind).toBe("melee");
    expect(at("cinder_nightmare").moveSpeed).toBeGreaterThan(4.5); // you do not outrun it
  });

  // ---- invariants across the whole roster ----

  it("every roster mob's whole reachable kit is manaCost 0 (mobs have no mana)", () => {
    // startAbility() refuses a mana ability BEFORE setting a cooldown: the mob
    // would re-pick it every tick and whiff-loop forever.
    for (const id of ROSTER) {
      for (const abilityId of mobAllAbilityIds(reg.mobs[id]!)) {
        expect(reg.abilities[abilityId]!.manaCost, `${id}: ${abilityId}`).toBe(0);
      }
    }
  });

  it("every projectile a roster mob can ever carry outranges its attackRange, at EVERY rank level", () => {
    // A wide attackRange is what makes a rank-unlocked projectile fire the day it
    // unlocks (a melee-only kit standing outside its reach just closes). If a
    // projectile's maxRange were shorter, the mob would fire into the ground.
    for (const id of ROSTER) {
      const def = reg.mobs[id]!;
      for (let lvl = def.level; lvl <= def.level + SCALING.maxLevelBonus; lvl++) {
        const r = resolveMob(def, lvl, SCALING);
        for (const a of r.attacks) {
          const ab = reg.abilities[a.ability]!;
          if (ab.kind !== "projectile") continue;
          expect(ab.maxRange ?? 0, `${id} @L${lvl}: ${a.ability} vs attackRange ${r.attackRange}`).toBeGreaterThanOrEqual(
            r.attackRange
          );
        }
      }
    }
  });

  it("no rank is a no-op: every rank changes a kit, a stat, or a disposition", () => {
    // A rank that unlocks nothing at a level a spawn table uses is a silent lie.
    for (const id of ROSTER) {
      const def = reg.mobs[id]!;
      for (const rank of def.ranks) {
        const changesKit = rank.add.length > 0 || rank.remove.length > 0;
        const changesStats = rank.hpMult !== 1 || rank.damageMult !== 1 || rank.moveSpeedMult !== 1;
        const changesNerve =
          rank.aggroRadius !== undefined ||
          rank.fleeAtHpPct !== undefined ||
          rank.attackRange !== undefined ||
          rank.leashRadius !== undefined;
        expect(changesKit || changesStats || changesNerve, `${id} rank atLevel ${rank.atLevel} does nothing`).toBe(true);
        // and no rank fires at or below the def's own level (it would be free stats)
        expect(rank.atLevel, `${id} rank`).toBeGreaterThan(def.level);
      }
    }
  });

  it("every roster mob's sound groups exist in the shipped audio manifest", () => {
    const manifest = JSON.parse(readFileSync(AUDIO_MANIFEST, "utf8")) as { sfx: Record<string, unknown> };
    for (const id of ROSTER) {
      const sounds = reg.mobs[id]!.sounds;
      if (!sounds) continue; // silent by design (glimmereye, aelthir)
      for (const [slot, group] of Object.entries(sounds)) {
        expect(manifest.sfx[group as string], `${id}.${slot} -> ${group}`).toBeTruthy();
      }
    }
  });

  it("every roster mob names a real loot table and a real sprite key", () => {
    for (const id of ROSTER) {
      const def = reg.mobs[id]!;
      expect(reg.loot[def.loot], `${id}: loot ${def.loot}`).toBeTruthy();
      expect(def.sprite.length, id).toBeGreaterThan(0);
    }
    // the summoned slimeling deliberately re-uses its parent's sprite key
    expect(reg.mobs["fen_slimeling"]!.sprite).toBe("fen_slime");
  });
});

/**
 * Economy invariants. The R&D verifiers found seven blockers here, all of the same
 * shape: a mob handed a table or an xp value from a tier it does not belong to.
 * These are cheap to check and expensive to miss — a 120-second respawn on a boss
 * loot table is a vending machine, and nobody notices until the economy is gone.
 */
describe("economy invariants", () => {
  const reg = new RegistryService();
  const SCALE = gameConstants().mobs.scaling;

  /** A table with a `guaranteed` slot is a BOSS table. */
  const isBossTable = (id: string) => (reg.loot[id]?.guaranteed?.length ?? 0) > 0;

  /** Every mob a spawn table can produce, with the level it produces it at. */
  function shippedSpawns(): Array<{ room: string; table: string; mob: string; level: number; maxAlive: number; respawnSec: number }> {
    const out: Array<{ room: string; table: string; mob: string; level: number; maxAlive: number; respawnSec: number }> = [];
    for (const roomId of ["hub", "forest", "desert", "dungeon", "gloomfen", "cinderrift", "crypt_depths", "sundered_city", "grounds", "atelier"]) {
      const def = loadRoomDef(roomId);
      for (const t of def.spawnTables) {
        for (const m of t.mobs) {
          out.push({ room: roomId, table: t.id, mob: m.mob, level: m.level ?? reg.mobs[m.mob]!.level, maxAlive: t.maxAlive, respawnSec: t.respawnSec });
        }
      }
    }
    return out;
  }

  it("no mob on a fast respawn or a crowded table drops from a boss table", () => {
    for (const s of shippedSpawns()) {
      const loot = reg.mobs[s.mob]!.loot;
      if (!isBossTable(loot)) continue;
      // a boss table is only allowed on a solitary, slow-respawning mob
      expect(s.maxAlive, `${s.room}/${s.table}: ${s.mob} has boss loot (${loot})`).toBe(1);
      expect(s.respawnSec, `${s.room}/${s.table}: ${s.mob} has boss loot (${loot})`).toBeGreaterThanOrEqual(600);
    }
  });

  it("no non-boss mob out-earns the boss of its own room", () => {
    const bossXp: Record<string, number> = {
      forest: resolveMob(reg.mobs["thrace_redcap"]!, undefined, SCALE).xp,
      desert: resolveMob(reg.mobs["kaharat"]!, undefined, SCALE).xp,
      dungeon: resolveMob(reg.mobs["minotaur_boss"]!, undefined, SCALE).xp,
      gloomfen: resolveMob(reg.mobs["grelmoss"]!, undefined, SCALE).xp,
      crypt_depths: resolveMob(reg.mobs["lich_boss"]!, undefined, SCALE).xp,
      cinderrift: resolveMob(reg.mobs["cinder_golem_boss"]!, undefined, SCALE).xp,
      sundered_city: resolveMob(reg.mobs["sundered_king"]!, undefined, SCALE).xp,
    };
    const bosses = new Set(["minotaur_boss", "lich_boss", "cinder_golem_boss", "sundered_king", "thrace_redcap", "kaharat", "sekhat", "grelmoss", "aelthir"]);
    for (const s of shippedSpawns()) {
      const cap = bossXp[s.room];
      if (cap === undefined || bosses.has(s.mob)) continue;
      const xp = resolveMob(reg.mobs[s.mob]!, s.level, SCALE).xp;
      expect(xp, `${s.room}/${s.table}: ${s.mob}@L${s.level} is worth ${xp} xp; the room's boss is worth ${cap}`).toBeLessThan(cap);
    }
  });

  it("anything that outruns the player must eventually give up", () => {
    // There is no sprint, so a mob faster than walkSpeed is an unbreakable chase —
    // until it exceeds its leash from home and resets. That is the escape hatch, and
    // it is why bone_bat (4.6 m/s) has always been fine. A fast mob with a huge leash
    // is a death sentence you cannot decline; cap the leash instead of the speed.
    const walk = gameConstants().movement.walkSpeed;
    const MAX_LEASH_FOR_A_FAST_MOB = 44;
    for (const [id, def] of Object.entries(reg.mobs)) {
      for (let lvl = def.level; lvl <= def.level + SCALE.maxLevelBonus; lvl++) {
        const r = resolveMob(def, lvl, SCALE);
        if (r.moveSpeed <= walk) continue;
        expect(r.leashRadius, `${id}@L${lvl} runs at ${r.moveSpeed} vs the player's ${walk} and leashes at ${r.leashRadius}`)
          .toBeLessThanOrEqual(MAX_LEASH_FOR_A_FAST_MOB);
      }
    }
  });

  it("a mob's self-heal is gated (a raw `heal` self ability would be cast at full health forever)", () => {
    for (const [, def] of Object.entries(reg.mobs)) {
      for (const abilityId of mobAllAbilityIds(def)) {
        const ab = reg.abilities[abilityId]!;
        if (ab.kind !== "self") continue;
        // chooseAttack treats every self ability as always-in-range. Only allyHeal
        // and summon carry their own gate (a hurt ally / a minion cap).
        expect(ab.heal, `mob ability ${abilityId} uses raw heal; use allyHeal(radius 2.5, includeSelf) instead`).toBeUndefined();
      }
    }
  });

  it("the trophy ladder is not inverted", () => {
    const v = (id: string) => reg.items[id]!.value;
    expect(v("sundered_crown"), "the game's prize trophy must be its most valuable").toBeGreaterThanOrEqual(v("spiral_horn"));
  });
});
