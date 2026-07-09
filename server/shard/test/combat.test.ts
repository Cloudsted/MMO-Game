import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, gameConstants, loadRoomDef, mintItem, RegistryService } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";
import { advanceFsm, inMeleeCone, interruptIfCasting, startAbility } from "../src/sim/combat.js";
import { addItem, rollLoot, normalizeInventory, INV_SIZE } from "../src/sim/loot.js";
import { applyGravity, applyMove, MOB_SEPARATION, separateEntities, tickBrain } from "../src/sim/mobs.js";
import { freshCombat, type Entity } from "../src/sim/entities.js";

const reg = new RegistryService();
const consts = gameConstants();

function makeCharacter(id: string, name: string, x = 64, z = 64, inventory: Array<ItemStack | null> = []): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory, x, y: 0, z, yaw: 0, roles: ["player"] };
}

function testEntity(x = 0, z = 0): Entity {
  return {
    id: 9000 + Math.floor(Math.random() * 1000),
    kind: "player",
    pos: { x, y: 0, z, yaw: 0 },
    renderable: { sprite: "player", anim: "idle" },
    level: 1,
    health: { hp: 100, maxHp: 100 },
    mana: { mana: 50, maxMana: 50 },
    combat: freshCombat(),
  };
}

describe("action FSM", () => {
  it("runs melee windup → active (hit fires) → recover → idle", () => {
    const e = testEntity();
    const swing = reg.ability("swing");
    expect(startAbility(e, "swing", swing, 10, 0, 0, 1000)).toBe(true);
    expect(e.combat!.act).toBe("windup");
    expect(advanceFsm(e, swing, 1000 + swing.windupMs! - 1)).toBeNull(); // not yet
    expect(advanceFsm(e, swing, 1000 + swing.windupMs!)).toBe("melee-hit");
    expect(e.combat!.act).toBe("active");
    expect(advanceFsm(e, swing, 1000 + swing.windupMs! + swing.activeMs!)).toBeNull();
    expect(e.combat!.act).toBe("recover");
    advanceFsm(e, swing, 1000 + swing.windupMs! + swing.activeMs! + swing.recoverMs);
    expect(e.combat!.act).toBe("idle");
  });

  it("runs spell cast → release → recover, charging mana up front", () => {
    const e = testEntity();
    const firebolt = reg.ability("firebolt");
    expect(startAbility(e, "firebolt", firebolt, 12, 0, 0, 1000)).toBe(true);
    expect(e.combat!.act).toBe("cast");
    expect(e.mana!.mana).toBe(50 - firebolt.manaCost);
    expect(advanceFsm(e, firebolt, 1000 + firebolt.castTimeMs!)).toBe("release");
    expect(e.combat!.act).toBe("recover");
  });

  it("refuses to act mid-ability, without mana, or on cooldown", () => {
    const e = testEntity();
    const firebolt = reg.ability("firebolt");
    startAbility(e, "firebolt", firebolt, 12, 0, 0, 1000);
    expect(startAbility(e, "firebolt", firebolt, 12, 0, 0, 1100)).toBe(false); // mid-cast
    // drain to idle, then cooldown still blocks
    advanceFsm(e, firebolt, 1000 + firebolt.castTimeMs!);
    advanceFsm(e, firebolt, 1000 + firebolt.castTimeMs! + firebolt.recoverMs);
    expect(e.combat!.act).toBe("idle");
    expect(startAbility(e, "firebolt", firebolt, 12, 0, 0, 1000 + 200)).toBe(false); // cooldown
    expect(startAbility(e, "firebolt", firebolt, 12, 0, 0, 1000 + firebolt.cooldownMs + firebolt.castTimeMs! + firebolt.recoverMs + 1)).toBe(true);
    e.mana!.mana = 0;
    expect(startAbility(e, "heal", reg.ability("heal"), 0, 0, 0, 99999)).toBe(false); // no mana
  });

  it("interrupts an interruptible cast into stagger and refunds mana", () => {
    const e = testEntity();
    const firebolt = reg.ability("firebolt");
    startAbility(e, "firebolt", firebolt, 12, 0, 0, 1000);
    const manaAfterCast = e.mana!.mana;
    expect(interruptIfCasting(e, firebolt, 400, 1200)).toBe(true);
    expect(e.combat!.act).toBe("stagger");
    expect(e.mana!.mana).toBe(manaAfterCast + firebolt.manaCost);
    // non-interruptible melee shrugs it off
    const e2 = testEntity();
    const swing = reg.ability("swing");
    startAbility(e2, "swing", swing, 10, 0, 0, 1000);
    expect(interruptIfCasting(e2, swing, 400, 1100)).toBe(false);
    expect(e2.combat!.act).toBe("windup");
  });

  it("checks melee cones with the shared yaw convention (yaw 0 = +Z)", () => {
    const attacker = testEntity(0, 0);
    attacker.combat!.aimYaw = 0; // facing +Z
    const ahead = testEntity(0, 2);
    const behind = testEntity(0, -2);
    const farAhead = testEntity(0, 9);
    expect(inMeleeCone(attacker, ahead, 2.3, 95, 0.6, 2)).toBe(true);
    expect(inMeleeCone(attacker, behind, 2.3, 95, 0.6, 2)).toBe(false);
    expect(inMeleeCone(attacker, farAhead, 2.3, 95, 0.6, 2)).toBe(false);
    attacker.combat!.aimYaw = Math.PI; // now facing -Z
    expect(inMeleeCone(attacker, behind, 2.3, 95, 0.6, 2)).toBe(true);
  });

  it("gates melee hits on vertical reach (no goring through canopies)", () => {
    const attacker = testEntity(0, 0);
    attacker.combat!.aimYaw = 0;
    const overhead = testEntity(0, 1); // 2D dead ahead...
    overhead.pos.y = 5; // ...but 5 blocks up a tree
    expect(inMeleeCone(attacker, overhead, 2.3, 95, 0.6, 2)).toBe(false);
    const onStep = testEntity(0, 1);
    onStep.pos.y = 1; // one block up stays hittable
    expect(inMeleeCone(attacker, onStep, 2.3, 95, 0.6, 2)).toBe(true);
  });
});

describe("loot", () => {
  it("rolls nested tables with gold ranges and rarity floors", () => {
    for (let i = 0; i < 200; i++) {
      const r = rollLoot(reg, consts, "bandit_drops");
      expect(r.gold).toBeGreaterThanOrEqual(5 - 5); // nested tables may add 0
      for (const s of r.items) {
        expect(reg.items[s.item]).toBeDefined();
        expect(s.qty).toBeGreaterThanOrEqual(1);
        expect(reg.rarities[s.rarity]).toBeDefined();
      }
    }
  });

  it("clamps weapon rarity up to minRarity", () => {
    for (let i = 0; i < 100; i++) {
      const r = rollLoot(reg, consts, "weapons_fine");
      for (const s of r.items) {
        expect(["uncommon", "rare", "epic"]).toContain(s.rarity);
      }
    }
  });

  it("stacks items and reports overflow", () => {
    const slots = normalizeInventory([]);
    expect(addItem(reg, slots, { item: "bread", qty: 7, rarity: "common" })).toBe(0);
    expect(addItem(reg, slots, { item: "bread", qty: 5, rarity: "common" })).toBe(0);
    // 12 bread = one full stack of 10 + one of 2
    expect(slots.filter((s) => s?.item === "bread")).toHaveLength(2);
    // weapons don't stack
    addItem(reg, slots, { item: "rusty_sword", qty: 1, rarity: "common" });
    addItem(reg, slots, { item: "rusty_sword", qty: 1, rarity: "common" });
    expect(slots.filter((s) => s?.item === "rusty_sword")).toHaveLength(2);
    // fill everything, then overflow
    for (let i = 0; i < INV_SIZE; i++) {
      if (!slots[i]) slots[i] = { item: "iron_sword", qty: 1, rarity: "common" };
    }
    expect(addItem(reg, slots, { item: "longbow", qty: 1, rarity: "common" })).toBe(1);
  });
});

describe("mob brain", () => {
  function makeMob(x: number, z: number): Entity {
    const e = testEntity(x, z);
    e.kind = "mob";
    e.brain = {
      mobId: "wolf",
      state: "patrol",
      home: { x, z },
      spawnerId: "t",
      targetId: null,
      threat: new Map(),
      nextWanderAt: 0,
      wanderTarget: null,
    };
    return e;
  }

  it("aggros players inside aggroRadius and chases", () => {
    const wolf = makeMob(0, 0);
    const player = testEntity(5, 0); // wolf aggroRadius 11
    const d = tickBrain(wolf, reg.mob("wolf"), [player], 1000);
    expect(d.move).toBeTruthy();
    expect(d.move!.x).toBe(5);
    expect(wolf.brain!.targetId).toBe(player.id);
  });

  it("ignores players outside aggro range with no threat", () => {
    const wolf = makeMob(0, 0);
    const player = testEntity(30, 0);
    const d = tickBrain(wolf, reg.mob("wolf"), [player], 1000);
    expect(d.attack).toBeNull();
    expect(wolf.brain!.targetId).toBeNull();
  });

  it("prefers the attacker over a closer bystander (threat + stickiness)", () => {
    const wolf = makeMob(0, 0);
    const attacker = testEntity(9, 0);
    const bystander = testEntity(3, 0);
    wolf.brain!.threat.set(attacker.id, 25);
    wolf.brain!.targetId = attacker.id;
    tickBrain(wolf, reg.mob("wolf"), [attacker, bystander], 1000);
    expect(wolf.brain!.targetId).toBe(attacker.id);
  });

  it("attacks in range and leashes when dragged from home", () => {
    const wolf = makeMob(0, 0);
    const prey = testEntity(1.2, 0); // inside attackRange 1.7
    wolf.brain!.threat.set(prey.id, 5);
    const d = tickBrain(wolf, reg.mob("wolf"), [prey], 1000);
    expect(d.attack).toBe(prey);
    // kited: BOTH wolf and prey beyond leashRadius 36 → reset
    wolf.pos.x = 45;
    prey.pos.x = 42;
    const d2 = tickBrain(wolf, reg.mob("wolf"), [prey], 2000);
    expect(wolf.brain!.state).toBe("return");
    expect(d2.move).toBeTruthy();
    expect(wolf.brain!.threat.size).toBe(0);
  });

  it("stays engaged past the leash while its target fights inside the circle", () => {
    const wolf = makeMob(0, 0);
    const archer = testEntity(10, 0); // shooting from inside the leash circle
    wolf.brain!.threat.set(archer.id, 20);
    wolf.brain!.targetId = archer.id;
    wolf.pos.x = 45; // wolf itself crossed leashRadius 36 while charging
    const d = tickBrain(wolf, reg.mob("wolf"), [archer], 1000);
    expect(wolf.brain!.state).toBe("chase");
    expect(d.move).toBeTruthy();
    expect(d.move!.x).toBe(10); // heading for the archer, not home
  });

  it("re-engages during return when shot from inside the leash circle", () => {
    const wolf = makeMob(0, 0);
    wolf.brain!.state = "return";
    wolf.pos.x = 20;
    const archer = testEntity(10, 0);
    wolf.brain!.threat.set(archer.id, 12); // arrow landed mid-runback
    const d = tickBrain(wolf, reg.mob("wolf"), [archer], 1000);
    expect(wolf.brain!.state).toBe("chase");
    expect(wolf.brain!.targetId).toBe(archer.id);
    expect(d.move!.x).toBe(10); // no more invincible runback
  });

  it("chases (with drop allowance) instead of attacking beyond vertical reach", () => {
    const wolf = makeMob(0, 0);
    wolf.pos.y = 6; // stranded on a canopy
    const prey = testEntity(0.5, 0); // 2D inside attackRange 1.7, 6 below
    wolf.brain!.threat.set(prey.id, 5);
    const d = tickBrain(wolf, reg.mob("wolf"), [prey], 1000, 2.0);
    expect(d.attack).toBeNull();
    expect(d.move).toBeTruthy();
    expect(d.move!.maxDrop ?? 0).toBeGreaterThanOrEqual(6); // may hop down
    // a projectile-style reach (Infinity) attacks as before
    const d2 = tickBrain(wolf, reg.mob("wolf"), [prey], 1000);
    expect(d2.attack).toBe(prey);
  });

  it("flees below its fleeAtHpPct threshold", () => {
    const wolf = makeMob(0, 0);
    const prey = testEntity(2, 0);
    wolf.brain!.threat.set(prey.id, 5);
    wolf.health!.hp = 5; // wolf flees below 15%
    wolf.health!.maxHp = 100;
    const d = tickBrain(wolf, reg.mob("wolf"), [prey], 1000);
    expect(wolf.brain!.state).toBe("flee");
    expect(d.attack).toBeNull();
    expect(d.move).toBeTruthy();
    // fleeing away: target x should be on the far side of the wolf from prey
    expect(d.move!.x).toBeLessThan(wolf.pos.x);
  });
});

describe("mob separation", () => {
  const sim = new RoomSim(loadRoomDef("hub"));
  const world = sim.world;
  const bounds = sim.def.size;

  /** A flat, unobstructed, dry 9×9 patch — terrain must not skew the assertions. */
  function findFlatSpot(): { x: number; z: number; y: number } {
    for (let z = 8; z < bounds.h - 8; z += 4) {
      for (let x = 8; x < bounds.w - 8; x += 4) {
        const y = world.standY(x, z);
        let ok = true;
        for (let dx = -4; dx <= 4 && ok; dx++)
          for (let dz = -4; dz <= 4 && ok; dz++) {
            const yy = world.standY(x + dx, z + dz);
            if (yy !== y || world.collidesAABB(x + dx, yy, z + dz, 0.3, 1.6) || world.liquidAt(x + dx, yy + 0.1, z + dz)) ok = false;
          }
        if (ok) return { x, z, y };
      }
    }
    throw new Error("no flat spot in hub");
  }
  const flat = findFlatSpot();

  function mobAt(id: number, x: number, z: number): Entity {
    const e = testEntity(x, z);
    e.id = id;
    e.kind = "mob";
    e.pos.y = world.standY(x, z);
    return e;
  }

  it("deflects a chasing mob around a packmate instead of walking through it", () => {
    const a = mobAt(1, flat.x, flat.z - 2);
    const blocker = mobAt(2, flat.x, flat.z - 1);
    const target = { x: flat.x, z: flat.z + 2, speedMult: 1 };
    let minD = Infinity;
    for (let i = 0; i < 120; i++) {
      applyMove(a, target, 3, 0.1, world, bounds, null, [a, blocker]);
      minD = Math.min(minD, Math.hypot(a.pos.x - blocker.pos.x, a.pos.z - blocker.pos.z));
    }
    expect(minD).toBeGreaterThanOrEqual(MOB_SEPARATION - 1e-6); // never entered its personal space
    expect(Math.hypot(a.pos.x - target.x, a.pos.z - target.z)).toBeLessThan(0.5); // still got there
  });

  it("pushes a stacked pack apart to personal-space distance, staying on the ground", () => {
    const pack = [mobAt(1, flat.x, flat.z), mobAt(2, flat.x, flat.z), mobAt(3, flat.x, flat.z)];
    for (let i = 0; i < 40; i++) separateEntities(pack, 0.1, world, bounds);
    for (let i = 0; i < pack.length; i++)
      for (let j = i + 1; j < pack.length; j++) {
        const d = Math.hypot(pack[i]!.pos.x - pack[j]!.pos.x, pack[i]!.pos.z - pack[j]!.pos.z);
        expect(d).toBeGreaterThanOrEqual(MOB_SEPARATION - 0.05);
      }
    for (const m of pack) expect(m.pos.y).toBe(world.standY(m.pos.x, m.pos.z));
  });

  it("ignores mobs separated vertically (different ledges)", () => {
    const a = mobAt(1, flat.x, flat.z);
    const b = mobAt(2, flat.x, flat.z);
    b.pos.y += 3; // pretend b stands on a ledge overhead
    separateEntities([a, b], 0.1, world, bounds);
    expect(a.pos.x).toBe(flat.x);
    expect(a.pos.z).toBe(flat.z);
  });
});

describe("floor spawns + canopy drop-down", () => {
  const sim = new RoomSim(loadRoomDef("hub"));
  const world = sim.world;
  const bounds = sim.def.size;

  /** A flat, unobstructed, dry 7×7 patch away from structures. */
  function findFlatSpot(): { x: number; z: number; y: number } {
    for (let z = 8; z < bounds.h - 8; z += 4) {
      for (let x = 8; x < bounds.w - 8; x += 4) {
        const y = world.standY(x, z);
        let ok = true;
        for (let dx = -3; dx <= 3 && ok; dx++)
          for (let dz = -3; dz <= 3 && ok; dz++) {
            const yy = world.standY(x + dx, z + dz);
            if (yy !== y || world.collidesAABB(x + dx, yy, z + dz, 0.3, 1.6) || world.liquidAt(x + dx, yy + 0.1, z + dz)) ok = false;
          }
        if (ok) return { x, z, y };
      }
    }
    throw new Error("no flat spot in hub");
  }
  const flat = findFlatSpot();
  // fake tree canopy: a 3×3 leaf slab 4 blocks over the ground
  const LEAVES = BLOCK.leaves!.id;
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) world.set(Math.floor(flat.x) + dx, flat.y + 4, Math.floor(flat.z) + dz, LEAVES);

  it("floorY lands under the canopy where standY lands on top of it", () => {
    expect(world.standY(flat.x, flat.z)).toBe(flat.y + 5);
    expect(world.floorY(flat.x, flat.z)).toBe(flat.y);
  });

  it("spawnMob places mobs on the floor, never the canopy", () => {
    const mob = sim.spawnMob("slime", flat.x, flat.z, "")!;
    expect(mob.pos.y).toBe(flat.y);
  });

  it("a canopy-stranded mob can drop down only with a purposeful move", () => {
    const e = testEntity(Math.floor(flat.x) + 0.5, Math.floor(flat.z) + 0.5);
    e.kind = "mob";
    e.pos.y = flat.y + 5; // stranded on the canopy top
    const tx = Math.floor(flat.x) + 3.5;
    // wander-style intent (default 1-block drop): stuck pacing the edge
    for (let i = 0; i < 60; i++) applyMove(e, { x: tx, z: e.pos.z, speedMult: 1 }, 3, 0.1, world, bounds, null);
    expect(e.pos.y).toBe(flat.y + 5);
    // chase-style intent walks OFF the edge; gravity (interleaved exactly
    // like the room tick) lands it over several steps, never instantly
    let airborneTicks = 0;
    for (let i = 0; i < 80; i++) {
      if (applyGravity(e, 0.1, world, -22)) {
        airborneTicks++;
        continue; // no air control, same as the room tick
      }
      applyMove(e, { x: tx, z: e.pos.z, speedMult: 1, maxDrop: 8 }, 3, 0.1, world, bounds, null);
    }
    expect(airborneTicks).toBeGreaterThan(2); // a real fall, not a teleport
    expect(e.pos.y).toBe(flat.y);
    expect(Math.abs(e.pos.x - tx)).toBeLessThan(0.5);
  });
});

describe("mob gravity", () => {
  const sim = new RoomSim(loadRoomDef("hub"));
  const world = sim.world;
  const bounds = sim.def.size;

  /** A flat, unobstructed, dry 7×7 patch away from structures. */
  function findFlatSpot(): { x: number; z: number; y: number } {
    for (let z = 8; z < bounds.h - 8; z += 4) {
      for (let x = 8; x < bounds.w - 8; x += 4) {
        const y = world.standY(x, z);
        let ok = true;
        for (let dx = -3; dx <= 3 && ok; dx++)
          for (let dz = -3; dz <= 3 && ok; dz++) {
            const yy = world.standY(x + dx, z + dz);
            if (yy !== y || world.collidesAABB(x + dx, yy, z + dz, 0.3, 1.6) || world.liquidAt(x + dx, yy + 0.1, z + dz)) ok = false;
          }
        if (ok) return { x, z, y };
      }
    }
    throw new Error("no flat spot in hub");
  }
  const flat = findFlatSpot();

  it("accelerates an airborne mob down and lands it on the floor", () => {
    const e = testEntity(flat.x, flat.z);
    e.kind = "mob";
    e.pos.y = flat.y + 6;
    const ys: number[] = [];
    let ticks = 0;
    while (applyGravity(e, 0.1, world, -22) && ticks < 50) {
      ys.push(e.pos.y);
      ticks++;
    }
    expect(e.pos.y).toBe(flat.y);
    expect(e.vy).toBe(0);
    expect(ticks).toBeGreaterThan(3); // 6 blocks take ~0.74 s at g=-22, not one tick
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeLessThan(ys[i - 1]!);
      // accelerating: each step at least as large as the previous
      if (i >= 2) expect(ys[i - 1]! - ys[i]!).toBeGreaterThanOrEqual(ys[i - 2]! - ys[i - 1]! - 1e-9);
    }
  });

  it("is inert on the ground", () => {
    const e = testEntity(flat.x, flat.z);
    e.kind = "mob";
    e.pos.y = flat.y;
    expect(applyGravity(e, 0.1, world, -22)).toBe(false);
    expect(e.pos.y).toBe(flat.y);
  });

  it("floats a submerged mob up to the swim surface instead of sinking", () => {
    // 3-deep pool: water cells replace the top 3 solid blocks of one column
    const px = Math.floor(flat.x) - 2;
    const pz = Math.floor(flat.z);
    const WATER = BLOCK.water!.id;
    const top = world.standY(px, pz) - 1;
    for (let d = 0; d < 3; d++) world.set(px, top - d, pz, WATER);
    const e = testEntity(px + 0.5, pz + 0.5);
    e.kind = "mob";
    e.pos.y = top - 2; // dumped at the pool floor
    for (let i = 0; i < 30; i++) applyGravity(e, 0.1, world, -22);
    expect(e.pos.y).toBe(top); // feet in the top liquid cell = swim surface
  });

  it("RoomSim ticks a hoisted mob down gradually (integration)", () => {
    vi.useFakeTimers();
    try {
      const sim2 = new RoomSim(loadRoomDef("hub"));
      const mob = sim2.spawnMob("slime", flat.x, flat.z, "")!;
      const ground = mob.pos.y;
      mob.pos.y = ground + 6;
      const ys: number[] = [];
      for (let i = 0; i < 20; i++) {
        vi.setSystemTime(Date.now() + 100);
        sim2.tick();
        ys.push(mob.pos.y);
      }
      const landedAt = ys.findIndex((y) => y <= ground + 1e-6);
      expect(landedAt).toBeGreaterThan(2); // several ticks in the air
      for (let i = 1; i <= landedAt; i++) expect(ys[i]!).toBeLessThan(ys[i - 1]! + 1e-9);
      expect(ys[ys.length - 1]).toBe(ground);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("liquid pathing (wade/swim)", () => {
  const sim = new RoomSim(loadRoomDef("hub"));
  const world = sim.world;
  const bounds = sim.def.size;
  const WATER = BLOCK.water!.id;

  /** A flat, unobstructed, dry 10×7 patch (extra west margin: the swim pool
   *  and its far bank live at dx -6..-2) away from structures. */
  function findFlatSpot(): { x: number; z: number; y: number } {
    for (let z = 8; z < bounds.h - 8; z += 4) {
      for (let x = 10; x < bounds.w - 8; x += 4) {
        const y = world.standY(x, z);
        let ok = true;
        for (let dx = -6; dx <= 3 && ok; dx++)
          for (let dz = -3; dz <= 3 && ok; dz++) {
            const yy = world.standY(x + dx, z + dz);
            if (yy !== y || world.collidesAABB(x + dx, yy, z + dz, 0.3, 1.6) || world.liquidAt(x + dx, yy + 0.1, z + dz)) ok = false;
          }
        if (ok) return { x, z, y };
      }
    }
    throw new Error("no flat spot in hub");
  }
  const flat = findFlatSpot();
  const fx = Math.floor(flat.x);
  const fz = Math.floor(flat.z);

  it("a wading intent crosses a shallow trench that blocks a wander intent", () => {
    // 2-wide, 1-deep water run at fx+1..fx+2 (2 wide so a 0.25-radius
    // footprint can't straddle it), long enough that deflection can't round it
    for (let ox = 1; ox <= 2; ox++) {
      for (let dz = -12; dz <= 12; dz++) {
        const wy = world.standY(fx + ox, fz + dz) - 1;
        world.set(fx + ox, wy, fz + dz, WATER);
      }
    }
    const tx = fx + 3.5;
    const wander = testEntity(fx - 1.5, fz + 0.5);
    wander.kind = "mob";
    wander.pos.y = flat.y;
    for (let i = 0; i < 60; i++) applyMove(wander, { x: tx, z: fz + 0.5, speedMult: 1 }, 3, 0.1, world, bounds, null);
    expect(wander.pos.x).toBeLessThan(fx + 1.5); // stuck at the lip, never crossed

    const chaser = testEntity(fx - 1.5, fz + 0.5);
    chaser.kind = "mob";
    chaser.pos.y = flat.y;
    for (let i = 0; i < 80; i++) applyMove(chaser, { x: tx, z: fz + 0.5, speedMult: 1, maxDrop: 8, wade: true }, 3, 0.1, world, bounds, null);
    expect(Math.abs(chaser.pos.x - tx)).toBeLessThan(0.5); // waded across
    expect(chaser.pos.y).toBe(flat.y); // and climbed back out
  });

  it("swims deep water at the surface, not along the drowned floor", () => {
    // 3-wide, 3-deep pool at fx-4..fx-2 (west of the trench test's line)
    for (let ox = -4; ox <= -2; ox++) {
      for (let dz = -12; dz <= 12; dz++) {
        const top = world.standY(fx + ox, fz + dz) - 1;
        for (let d = 0; d < 3; d++) world.set(fx + ox, top - d, fz + dz, WATER);
      }
    }
    const e = testEntity(fx - 0.5, fz + 0.5);
    e.kind = "mob";
    e.pos.y = flat.y;
    const tx = fx - 5.5;
    let minY = e.pos.y;
    for (let i = 0; i < 80; i++) {
      applyMove(e, { x: tx, z: fz + 0.5, speedMult: 1, maxDrop: 8, wade: true }, 3, 0.1, world, bounds, null);
      minY = Math.min(minY, e.pos.y);
    }
    expect(Math.abs(e.pos.x - tx)).toBeLessThan(0.5); // crossed the pool
    expect(minY).toBe(flat.y - 1); // swam one below the bank (surface), never the floor 3 down
  });
});

describe("attack timing (whiff-proofing)", () => {
  let sim: RoomSim;

  function join(id: string, name: string, inv: Array<ItemStack | null> = []) {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, 64, 64, inv), (m) => messages.push(m));
    return { session, messages };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sim = new RoomSim(loadRoomDef("hub"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** swing with a neutral speed roll: windup 260 + active 140 + recover 320. */
  function joinWithSword() {
    const a = join("c1", "Alice", [{ item: "rusty_sword", qty: 1, rarity: "common" }]);
    a.session.slots[0]!.stats = { dmg: 1, spd: 1 };
    return a;
  }

  it("keeps stage timings exact across late ticks (no per-tick stretch)", () => {
    const a = joinWithSword();
    const t0 = Date.now();
    sim.handleAttack(a.session, 0, 0);
    vi.setSystemTime(t0 + 350); // tick arrives 90ms after windup(260) ended
    sim.tick();
    // active must end at 260+140=400, not 350+140
    expect(a.session.entity.combat!.actEndsAt).toBe(t0 + 400);
  });

  it("accepts a click landing between ticks after the body finished", () => {
    const a = joinWithSword();
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.entity.combat!.act).toBe("windup");
    // the whole swing (720ms) elapsed but NO tick has run — the click must
    // catch the FSM up instead of being judged against the stale state
    vi.setSystemTime(Date.now() + 730);
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.entity.combat!.act).toBe("windup");
    expect(a.session.pendingAttack).toBeNull();
  });

  it("buffers a click that lands a hair early and fires it on the next tick", () => {
    const a = joinWithSword();
    const t0 = Date.now();
    sim.handleAttack(a.session, 0, 0);
    vi.setSystemTime(t0 + 650); // still recovering (busy until 720)
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.entity.combat!.act).toBe("recover"); // not started...
    expect(a.session.pendingAttack).not.toBeNull(); // ...but not dropped
    vi.setSystemTime(t0 + 800); // recover over; buffer (until 850) still live
    sim.tick();
    expect(a.session.entity.combat!.act).toBe("windup"); // fired from buffer
    expect(a.session.pendingAttack).toBeNull();
  });

  it("expires a buffered click that stays blocked past the window", () => {
    const a = joinWithSword();
    const t0 = Date.now();
    sim.handleAttack(a.session, 0, 0);
    vi.setSystemTime(t0 + 300); // mid-active — way too early
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.pendingAttack).not.toBeNull();
    vi.setSystemTime(t0 + 550); // buffer (until 500) expired, still in recover
    sim.tick();
    expect(a.session.entity.combat!.act).toBe("recover");
    expect(a.session.pendingAttack).toBeNull(); // dropped, not fired late
  });
});

describe("RoomSim gameplay", () => {
  let sim: RoomSim;

  interface TestClient {
    session: PlayerSession;
    messages: ServerToClient[];
    last<T extends ServerToClient["t"]>(t: T): Extract<ServerToClient, { t: T }> | undefined;
    all<T extends ServerToClient["t"]>(t: T): Array<Extract<ServerToClient, { t: T }>>;
  }

  function join(id: string, name: string, x = 64, z = 64, inv: Array<ItemStack | null> = []): TestClient {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, x, z, inv), (m) => messages.push(m));
    return {
      session,
      messages,
      last: (t) => [...messages].reverse().find((m) => m.t === t) as never,
      all: (t) => messages.filter((m) => m.t === t) as never,
    };
  }

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("hub"));
  });

  it("spawns forest mobs from its spawn tables", () => {
    const forest = new RoomSim(loadRoomDef("forest"));
    const mobs = [...forest.allEntities()].filter((e) => e.kind === "mob");
    // 480² retune: 9 tables (slimes ×2, wolves ×3, bandits, boars ×2, spiders)
    expect(mobs.length).toBeGreaterThan(10);
    for (const m of mobs) {
      expect(m.health!.hp).toBeGreaterThan(0);
      expect(m.brain).toBeDefined();
    }
  });

  it("kills a mob: XP to top damage dealer, loot bag, scheduled respawn", () => {
    const a = join("c1", "Alice");
    const mob = sim.spawnMob("slime", 66, 64, "")!;
    sim.applyDamage(a.session.entity, mob, 500);
    expect(mob.combat!.act).toBe("dead");
    const xpEvt = a.all("evt").find((m) => m.e.kind === "xp");
    expect(xpEvt).toBeDefined();
    expect(a.session.xp).toBe(reg.mob("slime").xp);
    const death = a.all("evt").find((m) => m.e.kind === "death");
    expect(death).toBeDefined();
  });

  it("levels up with a full heal at the XP threshold", () => {
    const a = join("c1", "Alice");
    a.session.entity.health!.hp = 40;
    // 5 slimes x 16 xp = 80 >= 60 (level 1 → 2)
    for (let i = 0; i < 5; i++) {
      const mob = sim.spawnMob("slime", 66, 64, "")!;
      sim.applyDamage(a.session.entity, mob, 500);
    }
    expect(a.session.entity.level).toBe(2);
    expect(a.session.entity.health!.hp).toBe(a.session.entity.health!.maxHp);
    const lvl = a.all("evt").find((m) => m.e.kind === "levelup");
    expect(lvl).toBeDefined();
  });

  it("drops the whole inventory on player death and restores on pickup after respawn", () => {
    const inv: Array<ItemStack | null> = [{ item: "iron_sword", qty: 1, rarity: "rare" }, { item: "bread", qty: 3, rarity: "common" }];
    const a = join("c1", "Alice", 64, 64, inv);
    const mob = sim.spawnMob("wolf", 66, 64, "")!;
    sim.applyDamage(mob, a.session.entity, 9999);
    expect(a.session.entity.combat!.act).toBe("dead");
    expect(a.last("died")).toBeDefined();
    expect(a.session.slots.every((s) => s === null)).toBe(true);
    const bag = [...sim.allEntities()].find((e) => e.kind === "loot")!;
    expect(bag).toBeDefined();
    expect(bag.loot!.items).toHaveLength(2);
    expect(bag.loot!.owner).toBe("c1"); // safe zone: owner-locked
    expect(bag.loot!.expireAt).toBeNull(); // death bags persist

    sim.handleRespawn(a.session);
    expect(a.session.entity.combat!.act).toBe("idle");
    expect(a.session.entity.health!.hp).toBe(a.session.entity.health!.maxHp);
    // walk of shame skipped: teleport the entity to the bag for the pickup test
    a.session.entity.pos.x = bag.pos.x;
    a.session.entity.pos.z = bag.pos.z;
    sim.handlePickup(a.session, bag.id);
    expect(a.session.slots.filter(Boolean)).toHaveLength(2);
  });

  it("enforces loot ownership locks against other players", () => {
    const a = join("c1", "Alice");
    const b = join("c2", "Bob", 65, 64);
    const mob = sim.spawnMob("slime", 66, 64, "")!;
    // force a drop by making Alice the top damage dealer
    let bag;
    for (let i = 0; i < 40 && !bag; i++) {
      const m = sim.spawnMob("slime", 66, 64, "")!;
      sim.applyDamage(a.session.entity, m, 500);
      bag = [...sim.allEntities()].find((e) => e.kind === "loot");
    }
    sim.applyDamage(a.session.entity, mob, 500);
    bag = [...sim.allEntities()].find((e) => e.kind === "loot");
    if (!bag) return; // loot table rolled all "nothing" 40 times — vanishingly unlikely
    b.session.entity.pos.x = bag.pos.x;
    b.session.entity.pos.z = bag.pos.z;
    const bobInvBefore = b.session.slots.filter(Boolean).length;
    sim.handlePickup(b.session, bag.id);
    expect(b.session.slots.filter(Boolean).length).toBe(bobInvBefore); // denied
    expect(b.last("chat")?.channel).toBe("system");
  });

  it("rejects pickup from directly under an elevated bag (3D range)", () => {
    const a = join("c1", "Alice", 64, 64, [{ item: "bread", qty: 2, rarity: "common" }]);
    sim.handleDropItem(a.session, 0, 2);
    const bag = [...sim.allEntities()].find((e) => e.kind === "loot")!;
    expect(bag).toBeDefined();
    // hoist the bag onto a "tower platform" 8 blocks up
    bag.pos.y += 8;
    a.session.entity.pos.x = bag.pos.x;
    a.session.entity.pos.z = bag.pos.z;
    sim.handlePickup(a.session, bag.id);
    expect(a.session.slots.filter(Boolean)).toHaveLength(0); // standing underneath: denied
    // at platform height on the same column: allowed
    a.session.entity.pos.y = bag.pos.y;
    sim.handlePickup(a.session, bag.id);
    expect(a.session.slots.some((s) => s?.item === "bread")).toBe(true);
  });

  it("buys and sells at the shop with gold checks", () => {
    const a = join("c1", "Alice", 52, 53); // next to Gorren the Smith
    const smith = [...sim.allEntities()].find((e) => e.kind === "npc" && e.npcId === "weaponsmith")!;
    sim.handleTalk(a.session, smith.id);
    const dialog = a.last("dialog")!;
    expect(dialog.shop).toBeTruthy();
    expect(dialog.shop!.items.some((i) => i.item === "iron_sword")).toBe(true);

    sim.handleBuy(a.session, smith.id, "iron_sword", 1); // 0 gold
    expect(a.last("chat")?.text).toContain("gold");
    a.session.gold = 100;

    // handleBuy MINTS the sword, and minting rolls the modifier lottery. A common
    // item takes a mod 4% of the time and that mod is a curse 15% of the time — and
    // a curse cuts the sell price by 15% (16 -> 13). That is a ~0.6% chance for this
    // assertion to fail on correct code, which it duly did. Pin the roll instead of
    // widening the assertion: the sell FORMULA is what this test is about.
    const rand = vi.spyOn(Math, "random").mockReturnValue(0.99); // above every mod chance
    sim.handleBuy(a.session, smith.id, "iron_sword", 1);
    rand.mockRestore();
    expect(a.session.gold).toBe(60);
    const bought = a.session.slots.find((s) => s?.item === "iron_sword")!;
    expect(bought.mods, "the pinned roll must produce an unmodified sword").toBeUndefined();

    const slot = a.session.slots.findIndex((s) => s?.item === "iron_sword");
    sim.handleSell(a.session, smith.id, slot, 1);
    expect(a.session.gold).toBe(76); // 60 + floor(40 * 0.4)
    expect(a.session.slots.some((s) => s?.item === "iron_sword")).toBe(false);
  });

  it("routes chat: room broadcast, /g to master, admin gate", () => {
    const a = join("c1", "Alice");
    const b = join("c2", "Bob", 66, 64);
    sim.handleChat(a.session, "hello room");
    expect(b.last("chat")).toMatchObject({ channel: "room", from: "Alice", text: "hello room" });

    let globalSent: string | null = null;
    sim.onGlobalChat = (from, text) => (globalSent = `${from}:${text}`);
    sim.handleChat(a.session, "/g hi world");
    expect(globalSent).toBe("Alice:hi world");
    sim.deliverGlobalChat("Zed", "sup");
    expect(a.last("chat")).toMatchObject({ channel: "global", from: "Zed" });

    sim.handleChat(a.session, "/give iron_sword"); // not admin
    expect(a.last("chat")?.text).toContain("Unknown command");
    a.session.character.roles.push("admin");
    sim.handleChat(a.session, "/give iron_sword 1 epic");
    expect(a.session.slots.some((s) => s?.item === "iron_sword" && s.rarity === "epic")).toBe(true);
    sim.handleChat(a.session, "/time 0.5");
    expect(Math.abs(sim.timeOfDay() - 0.5)).toBeLessThan(0.01);
  });

  it("persists drops and respawn timers in the room state round trip", () => {
    const a = join("c1", "Alice", 64, 64, [{ item: "longbow", qty: 1, rarity: "epic" }]);
    const mob = sim.spawnMob("wolf", 66, 64, "")!;
    sim.applyDamage(mob, a.session.entity, 9999); // death bag
    const state = sim.buildRoomState();
    expect(state.drops.length).toBeGreaterThanOrEqual(1);
    expect(state.drops[0]!.items[0]!.item).toBe("longbow");

    const resumed = new RoomSim(loadRoomDef("hub"), state);
    const bags = [...resumed.allEntities()].filter((e) => e.kind === "loot");
    expect(bags).toHaveLength(state.drops.length);
    expect(bags[0]!.loot!.items[0]!.rarity).toBe("epic");
  });

  it("locks movement while casting and rejects dead-player moves", () => {
    const a = join("c1", "Alice", 64, 64, [{ item: "fire_staff", qty: 1, rarity: "common" }]);
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.entity.combat!.act).toBe("cast");
    const p = { ...a.session.entity.pos };
    sim.handleMove(a.session, 1, p.x + 0.4, p.y, p.z, 0, "move");
    expect(a.last("correct")).toBeDefined(); // firebolt: canMoveWhile false
  });

  it("fires where the mouse points at release, not where it pointed at click", () => {
    const a = join("c1", "Alice", 64, 64);
    const mob = sim.spawnMob("slime", 62.5, 64, "")!; // due -X of Alice
    const hpBefore = mob.health!.hp;
    // click aiming +Z (yaw 0) — nothing there
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.entity.combat!.act).toBe("windup");
    // turn toward the slime mid-windup (move packet with same position)
    const yawToMob = Math.atan2(62.5 - 64, 64 - 64); // -PI/2
    sim.handleMove(a.session, 1, 64, sim.world.standY(64, 64), 64, yawToMob, "idle", 0);
    // let the punch windup elapse, then resolve
    const start = Date.now();
    while (Date.now() - start < 260) { /* punch windup 200ms + margin */ }
    sim.tick();
    expect(mob.health!.hp).toBeLessThan(hpBefore); // hit landed at the NEW aim
  });

  it("rejects attacks with a non-weapon held and uses punch barehanded", () => {
    const a = join("c1", "Alice", 64, 64, [{ item: "bread", qty: 1, rarity: "common" }]);
    sim.handleAttack(a.session, 0, 0); // holding bread
    expect(a.session.entity.combat!.act).toBe("idle");
    sim.handleEquip(a.session, 1); // empty slot → barehanded
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.entity.combat!.act).toBe("windup"); // punch
  });
});

describe("item instances (stat variance + durability)", () => {
  let sim: RoomSim;

  function join(id: string, name: string, inv: Array<ItemStack | null> = []) {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, 64, 64, inv), (m) => messages.push(m));
    return {
      session,
      messages,
      last: <T extends ServerToClient["t"]>(t: T) =>
        [...messages].reverse().find((m) => m.t === t) as Extract<ServerToClient, { t: T }> | undefined,
    };
  }

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("hub"));
  });

  it("mints weapons with rarity-bounded stat rolls and rolled durability", () => {
    for (const rarity of ["common", "epic"]) {
      const dmgSpread = consts.items.statSpread.dmg![rarity]!;
      const durMult = consts.items.durability.rarityMult[rarity]!;
      const base = reg.item("iron_sword").durability!;
      for (let i = 0; i < 100; i++) {
        const s = mintItem(reg, consts, "iron_sword", 1, rarity);
        expect(s.stats!.dmg!).toBeGreaterThanOrEqual(1 - dmgSpread - 1e-9);
        expect(s.stats!.dmg!).toBeLessThanOrEqual(1 + dmgSpread + 1e-9);
        expect(s.maxDur!).toBeGreaterThanOrEqual(Math.floor(base * durMult * (1 - consts.items.durability.spread)));
        expect(s.maxDur!).toBeLessThanOrEqual(Math.ceil(base * durMult * (1 + consts.items.durability.spread)));
        expect(s.dur).toBe(s.maxDur);
      }
    }
    // stackables stay uniform so they can merge
    const bread = mintItem(reg, consts, "bread", 3, "common");
    expect(bread.stats).toBeUndefined();
    expect(bread.dur).toBeUndefined();
  });

  it("backfills rolls onto legacy inventory items at join", () => {
    const a = join("c1", "Alice", [{ item: "rusty_sword", qty: 1, rarity: "common" }, { item: "bread", qty: 2, rarity: "common" }]);
    const sword = a.session.slots[0]!;
    expect(sword.stats?.dmg).toBeDefined();
    expect(sword.dur).toBeGreaterThan(0);
    expect(sword.maxDur).toBeGreaterThan(0);
    expect(a.session.slots[1]!.dur).toBeUndefined(); // bread untouched
  });

  it("wears one durability per weapon use and breaks the weapon at zero", () => {
    const a = join("c1", "Alice", [{ item: "rusty_sword", qty: 1, rarity: "common" }]);
    const sword = a.session.slots[0]!;
    const before = sword.dur!;
    sim.handleAttack(a.session, 0, 0);
    expect(sword.dur).toBe(before - 1);
    expect(a.session.slots[0]).not.toBeNull();
    // force the last use → the sword breaks and the slot empties
    a.session.entity.combat!.act = "idle";
    a.session.entity.combat!.cooldowns.clear();
    sword.dur = 1;
    sim.handleAttack(a.session, 0, 0);
    expect(a.session.slots[0]).toBeNull();
    expect(a.last("chat")?.text).toContain("broke");
  });

  it("never wears durability barehanded, and rejected attacks don't wear", () => {
    const a = join("c1", "Alice", [{ item: "rusty_sword", qty: 1, rarity: "common" }]);
    const sword = a.session.slots[0]!;
    sim.handleAttack(a.session, 0, 0);
    const afterFirst = sword.dur!;
    sim.handleAttack(a.session, 0, 0); // mid-windup: FSM rejects → no wear
    expect(sword.dur).toBe(afterFirst);
  });

  it("scales ability timings by the instance speed roll", () => {
    const e = testEntity();
    const swing = reg.ability("swing");
    startAbility(e, "swing", swing, 10, 0, 0, 1000, 2);
    expect(e.combat!.actEndsAt).toBe(1000 + Math.round(swing.windupMs! / 2));
    expect(advanceFsm(e, swing, e.combat!.actEndsAt)).toBe("melee-hit");
    expect(e.combat!.actEndsAt).toBeLessThanOrEqual(1000 + Math.round(swing.windupMs! / 2) + Math.round(swing.activeMs! / 2));
  });

  it("replicates loot bag contents rarest-first for 3D drop rendering", () => {
    const inv: Array<ItemStack | null> = [
      { item: "bread", qty: 3, rarity: "common" },
      { item: "iron_sword", qty: 1, rarity: "rare" },
    ];
    const a = join("c1", "Alice", inv);
    const mob = sim.spawnMob("wolf", 66, 64, "")!;
    sim.applyDamage(mob, a.session.entity, 9999); // death drop
    const bag = [...sim.allEntities()].find((e) => e.kind === "loot")!;
    expect(bag.lootView).toBeDefined();
    expect(bag.lootView!.length).toBe(2);
    expect(bag.lootView![0]).toMatchObject({ item: "iron_sword", rarity: "rare" });
    // rolled instance fields survive the drop → pickup round trip
    expect(bag.loot!.items.find((s) => s.item === "iron_sword")!.dur).toBeGreaterThan(0);
  });
});
