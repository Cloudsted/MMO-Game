/**
 * THE MAW (E2, world-redesign batch 2) — the crater-arena seed.
 *
 * Covers: def load + the cycling-arena lifecycle shape (no natural expiry,
 * 600s downtime), PRESET gen determinism, the arena floor-walk (spawn →
 * portal → wellmouth; the cap rock is unreachable — the pit walls hold),
 * the Wellhead Crater on the desert side (portal at the pan, the stair lane
 * is the only climb OUT, salt/strand-line dressing), portal pairing both
 * ways, Sarquun's kit/tuning invariants (three mechanically distinct moves,
 * batch-1 xp formula, group-leaning hp), and the event arc (surfacing
 * announce + death → 60s collapse).
 */
import { describe, expect, it } from "vitest";
import { BLOCK, computePortalArrival, gameConstants, loadRoomDef, mobAttacks, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const def = loadRoomDef("maw");
const desert = loadRoomDef("desert");
const world = new VoxelWorld(def);

/** BFS over walkable floor gaps: solid below, 2 of headroom, step-up ≤ 1,
 *  any drop (mirrors client fall rules; same helper as sundered_city.test). */
function floorReach(w: VoxelWorld, sx: number, sz: number): Set<number> {
  const key = (x: number, z: number) => x + z * w.w;
  const feet = new Map<number, number>();
  const start = w.floorY(sx + 0.5, sz + 0.5);
  feet.set(key(sx, sz), start);
  const q: Array<[number, number, number]> = [[sx, sz, start]];
  for (let head = 0; head < q.length; head++) {
    const [x, z, fy] = q[head]!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 1 || nz < 1 || nx >= w.w - 1 || nz >= w.h - 1) continue;
      const k = key(nx, nz);
      if (feet.has(k)) continue;
      let ny = -1;
      for (let cy = Math.min(46, fy + 1); cy >= 1; cy--) {
        if (!w.solidAt(nx, cy - 1, nz)) continue;
        if (w.solidAt(nx, cy, nz) || w.solidAt(nx, cy + 1, nz)) continue;
        ny = cy;
        break;
      }
      if (ny < 0 || ny > fy + 1) continue;
      if (w.liquidAt(nx, ny, nz)) continue;
      feet.set(k, ny);
      q.push([nx, nz, ny]);
    }
  }
  return new Set(feet.keys());
}

describe("maw def", () => {
  it("loads as a cycling arena: ephemeral, no natural expiry, 600s downtime", () => {
    expect(def.persistence).toBe("ephemeral");
    expect(def.lifecycle).toBeDefined();
    expect(def.lifecycle!.lifetimeSec).toBeUndefined(); // stands until the boss dies
    expect(def.lifecycle!.downtimeSec).toBe(600); // the feeding schedule
    expect(def.lifecycle!.warnAtSecLeft).toEqual([30, 10]);
    expect(def.fixedTime).toBeDefined(); // pinned light for the salt basin
  });

  it("carries exactly one spawn table — the boss (a Maw with no society)", () => {
    expect(def.spawnTables).toHaveLength(1);
    const t = def.spawnTables[0]!;
    expect(t.mobs[0]!.mob).toBe("sarquun");
    expect(t.maxAlive).toBe(1);
    expect(t.respawnSec).toBeGreaterThanOrEqual(600); // boss-table economy shape
    expect(t.region.x - t.region.r).toBeGreaterThanOrEqual(0);
    expect(t.region.x + t.region.r).toBeLessThanOrEqual(def.size.w);
    for (const m of t.mobs) expect(reg.mobs[m.mob], m.mob).toBeDefined();
  });
});

describe("maw preset gen", () => {
  it("is byte-identical between boots (a preset arena)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
  });

  it("floor-walks spawn → portal → wellmouth; the cap rock stays unreachable", () => {
    const reach = floorReach(world, 48, 72);
    const key = (x: number, z: number) => x + z * world.w;
    expect(reach.has(key(48, 76)), "return portal").toBe(true);
    expect(reach.has(key(48, 46)), "boss spawn ring").toBe(true);
    expect(reach.has(key(48, 48)), "the wellmouth dish").toBe(true);
    expect(reach.has(key(30, 60)), "keel A site").toBe(true);
    // the pit walls hold: the cap rock above the terraces is out of reach
    expect(reach.has(key(48, 4)), "cap rock north").toBe(false);
    expect(reach.has(key(4, 48)), "cap rock west").toBe(false);
  });

  it("dresses the basin as the dried sea: strand-lines, salt, bone, the obsidian mouth", () => {
    // wellmouth: obsidian dish at the center, sunk below the floor
    expect(world.get(48, 6, 48)).toBe(BLOCK.obsidian!.id);
    // strand-lines ring the walls (bone at y10 on the deepest riser); sample a
    // wall ring column due north (48, 48-31): ring 30-34 tops at 12
    let bone10 = 0;
    let salt = 0;
    for (let a = 0; a < 64; a++) {
      const x = Math.round(48 + Math.cos((a / 64) * Math.PI * 2) * 31.5);
      const z = Math.round(48 + Math.sin((a / 64) * Math.PI * 2) * 31.5);
      if (world.get(x, 10, z) === BLOCK.bone_block!.id) bone10++;
    }
    for (let z = 40; z <= 56; z++) for (let x = 40; x <= 56; x++) if (world.get(x, 8, z) === BLOCK.snow!.id) salt++;
    expect(bone10).toBeGreaterThan(20); // the last tide, readable on the way down
    expect(salt).toBeGreaterThan(0); // salt crust on the feeding-floor
  });
});

describe("the Wellhead Crater (desert side)", () => {
  const dworld = new VoxelWorld(desert);

  it("authors the always-open Maw portal at the crater bottom", () => {
    const p = desert.portals.find((pp) => pp.id === "desert-maw")!;
    expect(p).toBeDefined();
    expect(p.target).toBe("maw");
    expect(p.x).toBe(96);
    expect(p.z).toBe(384);
    // no desert event gates it: the lock is the Maw's downtime countdown
    for (const e of desert.events) {
      for (const a of e.actions) {
        if (a.kind === "openPortal") expect(a.portalId).not.toBe("desert-maw");
      }
    }
  });

  it("sinks a terraced pan 8 below the dunes with a raised rim", () => {
    const G0 = dworld.terrainHeight(desert, 96, 384); // natural datum (12)
    expect(dworld.floorY(96.5, 388.5)).toBe(G0 - 7); // pan feet = surface+1
    // rim stands proud of the natural dunes
    expect(dworld.standY(96, 384 - 25)).toBeGreaterThanOrEqual(G0 + 3);
    // salt crust present on the pan
    let salt = 0;
    for (let z = 378; z <= 390; z++) for (let x = 90; x <= 102; x++) if (dworld.get(x, G0 - 8, z) === BLOCK.snow!.id) salt++;
    expect(salt).toBeGreaterThan(5);
  });

  it("the stair lane is the climb out: pan → over the rim → open dunes", () => {
    const reach = floorReach(dworld, 96, 384); // start AT the portal pan
    const key = (x: number, z: number) => x + z * dworld.w;
    expect(reach.has(key(126, 384)), "open dunes past the rim notch").toBe(true);
  });

  it("pairs both ways with the maw", () => {
    const down = desert.portals.find((p) => p.id === "desert-maw")!;
    const up = def.portals.find((p) => p.id === "maw-desert")!;
    const aMaw = computePortalArrival(def, "desert", down)!;
    // maw arrival: offset from the return portal toward the arena spawn
    expect(Math.hypot(aMaw.x - 48, aMaw.z - 72.8)).toBeLessThan(0.5);
    const aDesert = computePortalArrival(desert, "maw", up)!;
    // desert arrival: at the crater bottom, offset toward the desert spawn
    expect(Math.hypot(aDesert.x - 96, aDesert.z - 384)).toBeLessThan(4);
  });
});

describe("Sarquun, the Undertide — group-leaning L9 event boss", () => {
  const SCALE = gameConstants().mobs.scaling;
  const sarquun = reg.mobs["sarquun"]!;

  it("carries three mechanically distinct moves (chomp / predictive gout / geysers)", () => {
    const kit = mobAttacks(sarquun).map((a) => reg.ability(a.ability).kind);
    expect(kit).toContain("melee");
    expect(kit).toContain("projectile");
    expect(kit).toContain("pillars");
    const gout = reg.abilities["undertide_gout"]!;
    expect(gout.predictive).toBe(true);
    expect(gout.aoeRadius).toBeGreaterThan(0);
    expect(gout.debuff?.slowPct).toBeGreaterThan(0); // the weight of a drowned sea
    expect(gout.maxRange!).toBeGreaterThanOrEqual(sarquun.attackRange); // kit invariant
    expect(reg.abilities["maw_geysers"]!.pillars!.count).toBeGreaterThanOrEqual(4);
  });

  it("pays the batch-1 formula (room boss ×8 at L9) and leans group on hp", () => {
    expect(sarquun.xp).toBe(Math.round(8 * (14 + 2 * Math.pow(9, 2.1)))); // 1726
    const gravelord = reg.mobs["minotaur_boss"]!; // the solo-tuned L9 boss
    expect(sarquun.level).toBe(gravelord.level);
    // sundered_king group ratio ≈ 1.38× the solo boss hp trend, scaled to L9
    expect(sarquun.hp).toBeGreaterThanOrEqual(Math.round(gravelord.hp * 1.3));
    expect(sarquun.hp).toBeLessThanOrEqual(Math.round(gravelord.hp * 1.6));
    // slower than the player: the arena + gout are the anti-kite, not the legs
    expect(resolveMob(sarquun, undefined, SCALE).moveSpeed).toBeLessThan(gameConstants().movement.walkSpeed);
  });

  it("drops the bounty proof: guaranteed undertide_beak_shard on a boss table", () => {
    const table = reg.loot[sarquun.loot]!;
    expect(table.guaranteed?.some((g) => g.item === "undertide_beak_shard")).toBe(true);
    expect(reg.items["undertide_beak_shard"]!.kind).toBe("trophy");
    // tier home ~T2 at L9: the steel pool rides along
    expect(table.guaranteed?.some((g) => g.table === "weapons_steel")).toBe(true);
  });

  it("wires the cycle: surfacing announce + bossDeath → announce + 60s collapse", () => {
    const surfacing = def.events.find((e) => e.id === "maw-surfaces")!;
    expect(surfacing.on).toEqual({ kind: "bossHpBelowPct", mob: "sarquun", pct: 0.85 });
    expect(surfacing.actions[0]).toEqual({ kind: "announce", text: "The sand falls away. You are standing on its lip." });
    const death = def.events.find((e) => e.on.kind === "bossDeath")!;
    expect(death.on.mob).toBe("sarquun");
    const timer = death.actions.find((a) => a.kind === "setRoomTimer");
    expect(timer && timer.kind === "setRoomTimer" ? timer.sec : 0).toBe(60);
    // no event waves: the Maw has no society — its only add is the floor
    for (const e of def.events) for (const a of e.actions) expect(a.kind).not.toBe("spawnMobs");
  });
});
