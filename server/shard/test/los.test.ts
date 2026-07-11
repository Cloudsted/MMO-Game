/**
 * Line-of-sight gating + mob idle full-heal (owner batch 2026-07-11).
 *
 * LOS: mobs used to aggro and shoot THROUGH solid walls — a proximity pull in
 * the Sunscour temple could "start" a fight from an unentered room, ranged
 * mobs emptied bows into masonry, and AoE splash built threat through walls.
 * Now: proximity acquisition, ranged attack choice, and AoE splash all require
 * a voxel sight line; damage-based threat and pack assist deliberately bypass
 * it (if you actually hit a mob, it knows).
 *
 * Idle full-heal: a wounded mob that neither dealt nor took damage for
 * `mobs.idleResetSec` and has no live target gets the SAME reset treatment as
 * breaking its leash (walk home healing, full heal at home, threat cleared).
 *
 * The Atelier (flat 128² slab, no spawn tables) is the test bench: walls are
 * placed straight into the voxel grid.
 */
import { describe, it, expect } from "vitest";
import type { CharacterSnapshot, ItemStack, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, gameConstants, loadRoomDef, RegistryService } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";
import type { Projectile } from "../src/sim/combat.js";

const reg = new RegistryService();
const consts = gameConstants();

function makeCharacter(id: string, name: string, x: number, z: number, inventory: Array<ItemStack | null> = []): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory, x, y: 0, z, yaw: 0, roles: ["player"] };
}

interface TestClient {
  session: PlayerSession;
  messages: ServerToClient[];
  all<T extends ServerToClient["t"]>(t: T): Array<Extract<ServerToClient, { t: T }>>;
}

function join(sim: RoomSim, id: string, name: string, x: number, z: number): TestClient {
  const messages: ServerToClient[] = [];
  const session = sim.addPlayer(makeCharacter(id, name, x, z), (m) => messages.push(m));
  return { session, messages, all: (t) => messages.filter((m) => m.t === t) as never };
}

/** Solid stone wall: columns x, z0..z1, from the floor up `height` blocks. */
function buildWall(sim: RoomSim, x: number, z0: number, z1: number, height = 6): void {
  for (let z = z0; z <= z1; z++) {
    const floor = sim.world.standY(x + 0.5, z + 0.5);
    for (let y = floor; y < floor + height; y++) sim.world.set(x, y, z, BLOCK.stone!.id);
  }
}

function clearWall(sim: RoomSim, x: number, z0: number, z1: number, height = 6): void {
  for (let z = z0; z <= z1; z++) {
    const floor = sim.world.standY(x + 0.5, z + 0.5) - height; // standY now sits on the wall top
    for (let y = floor; y < floor + height; y++) sim.world.set(x, y, z, 0);
  }
}

/** Busy-wait — movement validation and tick dt use wall-clock time. */
function spin(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* spin */
  }
}

describe("VoxelWorld.lineOfSight", () => {
  const sim = new RoomSim(loadRoomDef("atelier"));
  const y = sim.world.standY(64.5, 64.5) + 1.2; // chest-ish height over the slab

  it("sees across open ground, is blocked by a wall, and tolerates its own end cells", () => {
    expect(sim.world.lineOfSight(60, y, 64, 68, y, 64)).toBe(true);
    buildWall(sim, 64, 60, 68);
    expect(sim.world.lineOfSight(60, y, 64, 68, y, 64)).toBe(false);
    // over the wall top there is open sky
    const over = sim.world.standY(64.5, 64.5) + 8;
    expect(sim.world.lineOfSight(60, over, 64, 68, over, 64)).toBe(true);
    clearWall(sim, 64, 60, 68);
    expect(sim.world.lineOfSight(60, y, 64, 68, y, 64)).toBe(true);
    // an endpoint hugging a solid block does not occlude itself (end skip)
    buildWall(sim, 64, 63, 65);
    expect(sim.world.lineOfSight(64.5 - 0.6, y, 64.5, 64.5 - 1.2, y, 64.5)).toBe(true);
    clearWall(sim, 64, 63, 65);
  });
});

describe("mob aggro requires line-of-sight (proximity only)", () => {
  it("does not proximity-aggro through a wall; damage threat bypasses it", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    buildWall(sim, 64, 56, 72); // long wall so deflection can't peek around mid-test
    const a = join(sim, "c1", "Alice", 60, 64);
    const wolf = sim.spawnMob("wolf", 68, 64, "")!; // 8 apart — inside aggro 11
    spin(2);
    sim.tick();
    sim.tick();
    expect(wolf.brain!.targetId, "wall between: the wolf must not notice").toBeNull();
    expect(wolf.brain!.state).toBe("patrol");
    // hit it through the wall (scripted damage): it knows immediately
    sim.applyDamage(a.session.entity, wolf, 3);
    sim.tick();
    expect(wolf.brain!.targetId).toBe(a.session.entity.id);
    expect(wolf.brain!.state).toBe("chase");
  });

  it("proximity-aggros normally with a clear sight line (control)", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const a = join(sim, "c1", "Alice", 60, 64);
    const wolf = sim.spawnMob("wolf", 68, 64, "")!;
    spin(2);
    sim.tick();
    expect(wolf.brain!.targetId).toBe(a.session.entity.id);
  });
});

describe("ranged mobs advance instead of shooting walls", () => {
  it("a pure-ranged mob with threat but no LOS closes distance and fires nothing", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    buildWall(sim, 64, 48, 80); // long wall: rounding it takes longer than the test
    const a = join(sim, "c1", "Alice", 60, 64);
    const wisp = sim.spawnMob("marsh_wisp", 68, 64, "")!; // pure-ranged, attackRange 11
    sim.applyDamage(a.session.entity, wisp, 3); // threat through the wall — it knows
    const startD = Math.hypot(wisp.pos.x - 60, wisp.pos.z - 64);
    for (let i = 0; i < 8; i++) {
      spin(60);
      sim.tick();
    }
    expect(a.all("proj"), "no bolt may be loosed without a sight line").toHaveLength(0);
    const endD = Math.hypot(wisp.pos.x - 60, wisp.pos.z - 64);
    expect(endD, "the dead-band behavior closes the distance instead").toBeLessThan(startD - 0.5);
  });

  it("the same mob fires with a clear sight line (control)", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const a = join(sim, "c1", "Alice", 60, 64);
    const wisp = sim.spawnMob("marsh_wisp", 68, 64, "")!;
    sim.applyDamage(a.session.entity, wisp, 3);
    let shots = 0;
    for (let i = 0; i < 30 && shots === 0; i++) {
      spin(60);
      sim.tick();
      shots = a.all("proj").length;
    }
    expect(shots).toBeGreaterThan(0);
    expect(wisp.combat!.act === "cast" || wisp.combat!.act === "recover" || shots > 0).toBe(true);
  });
});

describe("AoE damage requires LOS from the impact point", () => {
  function fakeProjectile(sim: RoomSim, ownerId: number, x: number, y: number, z: number, vx: number): Projectile {
    return {
      id: 999,
      fx: "firebolt",
      ownerId,
      x,
      y,
      z,
      vx,
      vy: 0,
      vz: 0,
      damage: 20,
      debuff: null,
      startX: x - 5,
      startZ: z,
      maxRangeSq: 10000,
      dieAt: Date.now() + 1000,
      aoeRadius: 3,
      impactFx: null,
      scale: 1,
      dmgClass: "magic",
    };
  }

  it("splash does not leak through a wall (and no threat builds)", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    buildWall(sim, 64, 56, 72);
    const a = join(sim, "c1", "Alice", 60, 64);
    const mob = sim.spawnMob("wolf", 65.6, 64, "")!; // hugging the wall's far side, well inside aoe 3
    const hpBefore = mob.health!.hp;
    const y = sim.world.standY(60.5, 64.5) + 1.2; // floor + chest height (sampled off the wall column)
    // impact ON the near face of the wall (projectile buried just inside it)
    (sim as never as { endProjectile(p: Projectile, hit: null): void }).endProjectile(
      fakeProjectile(sim, a.session.entity.id, 64.1, y, 64, 20),
      null
    );
    expect(mob.health!.hp, "no splash through the wall").toBe(hpBefore);
    expect(mob.brain!.threat.size, "no threat through the wall").toBe(0);
  });

  it("splash still hits exposed targets near an impact (control)", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const a = join(sim, "c1", "Alice", 60, 64);
    const mob = sim.spawnMob("wolf", 65.6, 64, "")!;
    const hpBefore = mob.health!.hp;
    const y = sim.world.standY(64.5, 64.5) + 1.2;
    (sim as never as { endProjectile(p: Projectile, hit: null): void }).endProjectile(
      fakeProjectile(sim, a.session.entity.id, 64.1, y, 64, 20),
      null
    );
    expect(mob.health!.hp).toBeLessThan(hpBefore);
  });

  it("fire pillars burn only targets they can see", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    buildWall(sim, 64, 56, 72);
    const a = join(sim, "c1", "Alice", 62.5, 64); // near side of the wall
    const mob = sim.spawnMob("wolf", 70, 64, "")!; // owner far side
    const floor = sim.world.standY(66.5, 64.5);
    const now = Date.now();
    // NB: tickFirePillars REASSIGNS the firePillars field (filter) — re-read
    // it before every push, never hold the array across a tick
    const s = sim as never as { firePillars: Array<Record<string, unknown>>; tickFirePillars(now: number): void };
    s.firePillars.push({
      x: 66.5, // far side of the wall, 4.0 from Alice — inside radius 4.5
      y: floor,
      z: 64,
      igniteAt: now - 10,
      windowEndsAt: now + 500,
      ownerId: mob.id,
      damage: 10,
      radius: 4.5,
      hitIds: new Set<number>(),
    });
    const hpBefore = a.session.entity.health!.hp;
    s.tickFirePillars(now);
    expect(a.session.entity.health!.hp, "the wall shields the pillar burn").toBe(hpBefore);
    // same pillar on Alice's side of the wall: burns
    s.firePillars.push({
      x: 61.5,
      y: sim.world.standY(61.5, 64.5),
      z: 64,
      igniteAt: now - 10,
      windowEndsAt: now + 500,
      ownerId: mob.id,
      damage: 10,
      radius: 4.5,
      hitIds: new Set<number>(),
    });
    s.tickFirePillars(now);
    expect(a.session.entity.health!.hp).toBeLessThan(hpBefore);
  });
});

describe("mob idle full-heal (mobs.idleResetSec)", () => {
  const IDLE_MS = consts.mobs.idleResetSec * 1000;

  it("a wounded mob with no live target resets after the idle window (leash-reset semantics)", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const a = join(sim, "c1", "Alice", 60, 64);
    const wolf = sim.spawnMob("wolf", 68, 64, "")!;
    sim.applyDamage(a.session.entity, wolf, 10);
    expect(wolf.health!.hp).toBeLessThan(wolf.health!.maxHp);
    expect(wolf.brain!.lastCombatAt).toBeDefined(); // the clock started
    sim.removePlayer(a.session); // the attacker leaves — no live target
    wolf.brain!.lastCombatAt = Date.now() - IDLE_MS - 1000; // backdate past the window
    spin(2);
    sim.tick(); // reset fires; the wolf stands at home → return branch heals to full
    expect(wolf.health!.hp).toBe(wolf.health!.maxHp);
    expect(wolf.brain!.threat.size).toBe(0); // same clear as the leash reset
  });

  it("does not fire before the window elapses", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const a = join(sim, "c1", "Alice", 60, 64);
    const wolf = sim.spawnMob("wolf", 68, 64, "")!;
    sim.applyDamage(a.session.entity, wolf, 10);
    sim.removePlayer(a.session);
    wolf.brain!.lastCombatAt = Date.now() - IDLE_MS / 2; // only halfway
    spin(2);
    sim.tick();
    expect(wolf.health!.hp).toBeLessThan(wolf.health!.maxHp); // still wounded (mobs have no regen)
  });

  it("does not fire while a live target exists (kiting a mob can't heal it mid-fight)", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const a = join(sim, "c1", "Alice", 60, 64);
    const wolf = sim.spawnMob("wolf", 68, 64, "")!;
    sim.applyDamage(a.session.entity, wolf, 10);
    spin(2);
    sim.tick(); // acquires Alice (threat)
    expect(wolf.brain!.targetId).toBe(a.session.entity.id);
    wolf.brain!.lastCombatAt = Date.now() - IDLE_MS - 1000; // a long stalemate...
    spin(2);
    sim.tick();
    expect(wolf.health!.hp, "...but the target is alive and hostile — no free heal").toBeLessThan(wolf.health!.maxHp);
    expect(wolf.brain!.targetId).toBe(a.session.entity.id);
  });
});
