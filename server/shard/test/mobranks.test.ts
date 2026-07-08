/**
 * Level-scaled mob progression: resolveMob's stat curve + rank-gated ability
 * kits, and the pack-healer (allyHeal) gate.
 *
 * The point of the system: a world-gen mob def is REUSED at higher levels by
 * deeper rooms' spawn tables. Its stats compound and its rank list unlocks
 * extra abilities. These tests pin the math so a tuning pass to
 * constants.mobs.scaling can't silently change what a spawn table means.
 */
import { describe, it, expect } from "vitest";
import { gameConstants, resolveMob, mobAllAbilityIds, RegistryService, type MobDef } from "@fantasy-mmo/common";

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
