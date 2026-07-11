/**
 * Real pathfinding for bosses / smart mobs (owner: sekhat pulled out of the
 * Colossus tomb couldn't route back inside on leash-reset — the bounded
 * stuck-recovery BFS caps at radius 24 and can't solve "open desert → tomb
 * stair → Vessel Chamber").
 *
 * Covered here:
 *  - planSmartPath (A* over the voxel walk grid, applyMove's exact step
 *    rules): wall-with-door routing, vertical stair routes with goal-level
 *    gating, budget-exhaustion fallback, liquid wade gating, leaf-top refusal
 *  - resolveMob smartPath plumbing (def flag + rank override, `boss` pattern)
 *  - sim: a resolved-boss mob plans a room-scale route while a plain mob
 *    keeps the bounded BFS (zero behavior drift for normal mobs)
 *  - sim: the return FAILSAFE (all mobs) — no net progress toward home for
 *    mobs.returnFailsafeSec in `return` teleports home with the exact
 *    leash-reset semantics (position → spawn, full heal, threat cleared)
 *
 * The Atelier (flat 128² slab, no spawn tables) is the bench, like los.test.
 */
import { describe, it, expect } from "vitest";
import { BLOCK, gameConstants, loadRoomDef, MobDefSchema, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { RoomSim } from "../src/sim/room.js";
import { planSmartPath, pathfindWaypoints, type SmartPathStats } from "../src/sim/mobs.js";

const reg = new RegistryService();
const consts = gameConstants();
void reg;

/** Solid stone wall: column x, z0..z1, from the floor up `height` blocks. */
function buildWall(sim: RoomSim, x: number, z0: number, z1: number, height = 4): void {
  for (let z = z0; z <= z1; z++) {
    const floor = sim.world.standY(x + 0.5, z + 0.5);
    for (let y = floor; y < floor + height; y++) sim.world.set(x, y, z, BLOCK.stone!.id);
  }
}

function buildWallX(sim: RoomSim, z: number, x0: number, x1: number, height = 4): void {
  for (let x = x0; x <= x1; x++) {
    const floor = sim.world.standY(x + 0.5, z + 0.5);
    for (let y = floor; y < floor + height; y++) sim.world.set(x, y, z, BLOCK.stone!.id);
  }
}

/** Busy-wait — tick dt uses wall-clock time. */
function spin(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* spin */
  }
}

describe("planSmartPath — A* over the voxel walk grid", () => {
  it("routes through the only door in a room-spanning wall", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    buildWall(sim, 64, 1, 126); // full-span wall: the door is the ONLY crossing
    const G = sim.world.standY(63.5, 44.5); // floor BESIDE the wall (standY on the wall column reads its top)
    for (const z of [44, 45]) for (const y of [G, G + 1]) sim.world.set(64, y, z, 0); // 2-wide 2-high door
    const sy = sim.world.standY(58.5, 64.5);
    const stats: SmartPathStats = { expanded: 0, found: false };
    const path = planSmartPath(sim.world, { x: 58.5, y: sy, z: 64.5 }, { x: 70.5, z: 64.5 }, false, 30000, stats);
    expect(stats.found, "goal reached").toBe(true);
    expect(path).not.toBeNull();
    const end = path![path!.length - 1]!;
    expect(Math.hypot(end.x - 70.5, end.z - 64.5), "path ends at the goal").toBeLessThan(1.5);
    // the wall can only be crossed at the door: wherever consecutive
    // waypoints straddle the wall line (x=64), both must sit at the door's z
    // (walking ALONGSIDE the wall on x=63/x=65 is fine and expected)
    let crossings = 0;
    for (let i = 1; i < path!.length; i++) {
      const a = path![i - 1]!;
      const b = path![i]!;
      if ((a.x - 64.5) * (b.x - 64.5) < 0) {
        crossings++;
        expect(Math.abs(a.z - 45) < 2.5 && Math.abs(b.z - 45) < 2.5, `crossing at the door (${a.x},${a.z} → ${b.x},${b.z})`).toBe(true);
      }
    }
    expect(crossings, "the route crosses the wall exactly once").toBe(1);
    expect(path!.length, "a real detour, not a straight line").toBeGreaterThan(10);
  });

  it("climbs a 1-block stair route to a raised platform, and goal Y gates the LEVEL", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const G = sim.world.standY(83.5, 63.5);
    // solid 4-high platform x80..86 z60..66 (top feet = G+4)
    for (let x = 80; x <= 86; x++) for (let z = 60; z <= 66; z++) for (let y = G; y < G + 4; y++) sim.world.set(x, y, z, BLOCK.stone!.id);
    // west stair treads ascending to the top: x76 h1, x77 h2, x78 h3, x79 h4
    for (let i = 0; i < 4; i++) for (let y = G; y < G + 1 + i; y++) sim.world.set(76 + i, y, 63, BLOCK.stone!.id);
    const sy = sim.world.standY(70.5, 63.5);
    const up: SmartPathStats = { expanded: 0, found: false };
    const path = planSmartPath(sim.world, { x: 70.5, y: sy, z: 63.5 }, { x: 83.5, z: 63.5, y: G + 4 }, false, 30000, up);
    expect(up.found, "stair route to the platform top found").toBe(true);
    expect(path).not.toBeNull();
    // the same goal column at GROUND level does not exist (the column is
    // solid): the level gate must refuse, not "arrive" on top
    const wrong: SmartPathStats = { expanded: 0, found: false };
    planSmartPath(sim.world, { x: 70.5, y: sy, z: 63.5 }, { x: 83.5, z: 63.5, y: G }, false, 30000, wrong);
    expect(wrong.found, "goal level gating refuses the platform top for a ground goal").toBe(false);
  });

  it("budget exhaustion falls back cleanly (partial-toward or null, never found)", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    buildWall(sim, 64, 1, 126);
    const G = sim.world.standY(63.5, 44.5);
    for (const z of [44, 45]) for (const y of [G, G + 1]) sim.world.set(64, y, z, 0);
    const sy = sim.world.standY(58.5, 64.5);
    const stats: SmartPathStats = { expanded: 0, found: false };
    const path = planSmartPath(sim.world, { x: 58.5, y: sy, z: 64.5 }, { x: 70.5, z: 64.5 }, false, 8, stats);
    expect(stats.found).toBe(false);
    expect(stats.expanded).toBeLessThanOrEqual(8);
    if (path) {
      const end = path[path.length - 1]!;
      expect(Math.hypot(end.x - 70.5, end.z - 64.5), "a partial path may not claim the goal").toBeGreaterThan(1.5);
    }
  });

  it("liquid: refused without wade, crossed (and costed) with wade", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    // 1-deep water channel spanning the whole room at z=70
    for (let x = 0; x < 128; x++) {
      const G = sim.world.standY(x + 0.5, 70.5);
      sim.world.set(x, G - 1, 70, BLOCK.water!.id);
    }
    const sy = sim.world.standY(64.5, 60.5);
    const dry: SmartPathStats = { expanded: 0, found: false };
    planSmartPath(sim.world, { x: 64.5, y: sy, z: 60.5 }, { x: 64.5, z: 80.5 }, false, 40000, dry);
    expect(dry.found, "no dry route exists").toBe(false);
    const wet: SmartPathStats = { expanded: 0, found: false };
    const path = planSmartPath(sim.world, { x: 64.5, y: sy, z: 60.5 }, { x: 64.5, z: 80.5 }, true, 40000, wet);
    expect(wet.found, "wading crosses the channel").toBe(true);
    expect(path).not.toBeNull();
  });

  it("never plans a step ONTO a leaf top (the batch-9 canopy rule)", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    buildWall(sim, 64, 1, 126);
    const G = sim.world.standY(63.5, 64.5); // floor beside the wall
    for (const z of [64, 65] as const) for (const y of [G, G + 1]) sim.world.set(64, y, z, 0); // door on the straight line
    // pave the door floor with leaves: stepping in = standing on a canopy
    sim.world.set(64, G - 1, 64, BLOCK.leaves!.id);
    sim.world.set(64, G - 1, 65, BLOCK.leaves!.id);
    const sy = sim.world.standY(58.5, 64.5);
    const leafy: SmartPathStats = { expanded: 0, found: false };
    planSmartPath(sim.world, { x: 58.5, y: sy, z: 64.5 }, { x: 70.5, z: 64.5 }, false, 40000, leafy);
    expect(leafy.found, "the only door is leaf-floored: no route").toBe(false);
    // control: stone floor in the same door → route exists
    sim.world.set(64, G - 1, 64, BLOCK.stone!.id);
    sim.world.set(64, G - 1, 65, BLOCK.stone!.id);
    const stony: SmartPathStats = { expanded: 0, found: false };
    planSmartPath(sim.world, { x: 58.5, y: sy, z: 64.5 }, { x: 70.5, z: 64.5 }, false, 40000, stony);
    expect(stony.found).toBe(true);
  });
});

describe("smartPath flag plumbing (resolveMob)", () => {
  const scaling = consts.mobs.scaling;
  const base = {
    name: "Testling",
    sprite: "slime",
    level: 1,
    hp: 10,
    damage: 1,
    moveSpeed: 2,
    ability: "punch",
    aggroRadius: 5,
    attackRange: 2,
    leashRadius: 10,
    fleeAtHpPct: 0,
    xp: 1,
    loot: "slime_drops",
  };

  it("def smartPath resolves; rank override demotes/promotes like `boss`", () => {
    const def = MobDefSchema.parse({ ...base, smartPath: true, ranks: [{ atLevel: 5, smartPath: false }] });
    expect(resolveMob(def, undefined, scaling).smartPath).toBe(true);
    expect(resolveMob(def, 5, scaling).smartPath, "explicit false demotes").toBe(false);
    const def2 = MobDefSchema.parse({ ...base, ranks: [{ atLevel: 5, smartPath: true }] });
    expect(resolveMob(def2, undefined, scaling).smartPath).toBe(false);
    expect(resolveMob(def2, 5, scaling).smartPath, "a rank can promote").toBe(true);
  });

  it("resolved bosses are smart without authoring smartPath (room.ts ORs the flags)", () => {
    const sekhat = reg.mobs["sekhat"]!;
    const r = resolveMob(sekhat, undefined, scaling);
    expect(r.boss).toBe(true);
    expect(r.smartPath, "no smartPath authored anywhere yet — the boss flag carries it").toBe(false);
  });
});

describe("smart mobs plan, plain mobs keep the bounded BFS", () => {
  it("a returning boss plans a room-scale route out of a concave trap; a wolf cannot", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    // U-trap around (90,64), opening EAST — home lies WEST, 50 cells away
    buildWall(sim, 86, 60, 68); // west wall (between the mobs and home)
    buildWallX(sim, 60, 86, 94); // north arm
    buildWallX(sim, 68, 86, 94); // south arm
    const boss = sim.spawnMob("sekhat", 90, 63, "")!;
    const wolf = sim.spawnMob("wolf", 90, 66, "")!;
    for (const e of [boss, wolf]) {
      e.brain!.home = { x: 40, z: 64 };
      e.brain!.state = "return";
    }
    for (let i = 0; i < 10; i++) {
      spin(25);
      sim.tick();
    }
    const bossPath = boss.brain!.path;
    expect(bossPath, "the boss planned").toBeDefined();
    const bEnd = bossPath![bossPath!.length - 1]!;
    expect(Math.hypot(bEnd.x - 40, bEnd.z - 64), "the boss's route reaches home").toBeLessThan(2);
    expect(bossPath!.some((wp) => wp.x > 94), "the route leaves through the U's east opening").toBe(true);
    const wolfPath = wolf.brain!.path;
    if (wolfPath && wolfPath.length) {
      const wEnd = wolfPath[wolfPath.length - 1]!;
      expect(Math.hypot(wEnd.x - 40, wEnd.z - 64), "the wolf's bounded BFS cannot reach home").toBeGreaterThan(8);
    }
    // direct check of the plain recovery tool: radius-24 BFS can't span 50 cells
    const bfs = pathfindWaypoints(sim.world, wolf.pos, { x: 40, z: 64 }, true);
    if (bfs) {
      const end = bfs[bfs.length - 1]!;
      expect(Math.hypot(end.x - 40, end.z - 64)).toBeGreaterThan(8);
    }
  });
});

describe("return failsafe (all mobs) — the evade snap", () => {
  const FAILSAFE_MS = consts.mobs.returnFailsafeSec * 1000;

  /** Seal a mob in a 5×5 stone box (roofless) so no walk can escape. */
  function boxIn(sim: RoomSim, cx: number, cz: number): void {
    buildWall(sim, cx - 2, cz - 2, cz + 2);
    buildWall(sim, cx + 2, cz - 2, cz + 2);
    buildWallX(sim, cz - 2, cx - 2, cx + 2);
    buildWallX(sim, cz + 2, cx - 2, cx + 2);
  }

  it("a returning mob with no net progress for returnFailsafeSec snaps home, healed, threat clear", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const wolf = sim.spawnMob("wolf", 100, 100, "")!;
    boxIn(sim, 100, 100);
    const b = wolf.brain!;
    b.home = { x: 60, z: 60 };
    b.state = "return";
    b.threat.set(999, 50);
    wolf.health!.hp = 40;
    spin(2);
    sim.tick(); // tracking starts (returnBestD stamped)
    expect(b.returnProgressAt).toBeDefined();
    b.returnProgressAt = Date.now() - FAILSAFE_MS - 1000; // sustained no-progress window
    spin(2);
    sim.tick();
    expect(wolf.pos.x, "snapped to home x").toBeCloseTo(60, 5);
    expect(wolf.pos.z, "snapped to home z").toBeCloseTo(60, 5);
    expect(wolf.pos.y).toBe(sim.world.floorY(60, 60));
    expect(wolf.health!.hp, "full heal — leash-reset semantics").toBe(wolf.health!.maxHp);
    expect(b.state).toBe("patrol");
    expect(b.threat.size, "threat cleared").toBe(0);
    expect(b.returnBestD).toBeUndefined();
  });

  it("does not fire before the window, and leaving `return` clears the tracking", () => {
    const sim = new RoomSim(loadRoomDef("atelier"));
    const wolf = sim.spawnMob("wolf", 100, 100, "")!;
    boxIn(sim, 100, 100);
    const b = wolf.brain!;
    b.home = { x: 60, z: 60 };
    b.state = "return";
    spin(2);
    sim.tick();
    b.returnProgressAt = Date.now() - FAILSAFE_MS / 2; // only halfway
    spin(2);
    sim.tick();
    expect(Math.hypot(wolf.pos.x - 100, wolf.pos.z - 100), "still in the box").toBeLessThan(3);
    b.state = "patrol";
    spin(2);
    sim.tick();
    expect(b.returnBestD, "tracking cleared outside `return`").toBeUndefined();
    expect(b.returnProgressAt).toBeUndefined();
  });
});
