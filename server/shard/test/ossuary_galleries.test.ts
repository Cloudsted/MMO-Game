/**
 * THE OSSUARY GALLERIES (N2, world-redesign batch 5) — the Pale Court's
 * sorting-house spliced between the Sunken Crypt's Gravelord gate and the
 * Vaults of Morvane, killing the old L6-8 → L12-14 cliff. The dungeon's
 * persistence flip (ephemeral → stateful) rides this batch.
 *
 * Covers: def load (stateful PRESET dungeon, fixedTime mood, no lifecycle),
 * gen determinism, BFS walkability entrance → every gallery → the Warden's
 * post + both caches + the hidden chapel, the S-BEND (the optimal walk is
 * ≥1.3× the straight line; the east flank is buried), portal pairing on both
 * new edges + the Gravelord gate kept exactly as-is, the Bone Warden's L12
 * boss elevation (rank math reconciled with his L9 dungeon miniboss and L14
 * depths appearances — both resolve unchanged), the Pallid Mourner chapel
 * (the bible's "6/rank 13" Wrung Shade as the room's hidden horror), the
 * bone_bat / grave_harrower rebases, and the economy invariants.
 */
import { describe, expect, it } from "vitest";
import { BLOCK, computePortalArrival, gameConstants, loadRoomDef, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const SCALE = gameConstants().mobs.scaling;
const def = loadRoomDef("ossuary_galleries");
const dungeon = loadRoomDef("dungeon");
const depths = loadRoomDef("crypt_depths");
const world = new VoxelWorld(def);

/** BFS over walkable floor gaps, tracking step distance (bend metric). */
function floorDist(w: VoxelWorld, sx: number, sz: number): Map<number, number> {
  const key = (x: number, z: number) => x + z * w.w;
  const feet = new Map<number, number>(); // floorY per cell
  const dist = new Map<number, number>();
  const start = w.floorY(sx + 0.5, sz + 0.5);
  feet.set(key(sx, sz), start);
  dist.set(key(sx, sz), 0);
  const q: Array<[number, number, number, number]> = [[sx, sz, start, 0]];
  for (let head = 0; head < q.length; head++) {
    const [x, z, fy, d] = q[head]!;
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
      if (dist.has(k)) continue;
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
      dist.set(k, d + 1);
      q.push([nx, nz, ny, d + 1]);
    }
  }
  return dist;
}
const key = (x: number, z: number) => x + z * world.w;

describe("ossuary_galleries def", () => {
  it("loads as a stateful preset dungeon: fixedTime mood, no lifecycle, no gates of its own", () => {
    expect(def.type).toBe("dungeon");
    expect(def.biome).toBe("dungeon");
    expect(def.persistence).toBe("stateful");
    expect(def.lifecycle).toBeUndefined();
    expect(def.fixedTime).toBeCloseTo(0.93);
    expect(def.wind).toBe(0);
    expect(def.size).toEqual({ w: 128, h: 128 });
    expect(def.flags).toEqual(dungeon.flags);
    // the galleries seal nothing themselves — the Gravelord gate lives upstairs
    for (const e of def.events) {
      for (const a of e.actions) {
        expect(a.kind, `${e.id}: ${a.kind}`).not.toBe("openPortal");
        expect(a.kind, `${e.id}: ${a.kind}`).not.toBe("setRoomTimer");
      }
    }
    expect(def.npcs).toHaveLength(0); // the galleries' silence is the dress
  });

  it("bands L9-11 on the workforce tables at the family's existing post-retune ranks", () => {
    for (const t of def.spawnTables) {
      expect(t.region.x - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.x + t.region.r, t.id).toBeLessThanOrEqual(def.size.w);
      expect(t.region.z - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.z + t.region.r, t.id).toBeLessThanOrEqual(def.size.h);
      for (const m of t.mobs) {
        expect(reg.mobs[m.mob], m.mob).toBeDefined();
        if (t.id === "warden-post" || t.id === "mourner-chapel") continue; // boss + hidden horror
        const lvl = m.level ?? reg.mobs[m.mob]!.level;
        expect(lvl, `${t.id}/${m.mob}`).toBeGreaterThanOrEqual(9);
        expect(lvl, `${t.id}/${m.mob}`).toBeLessThanOrEqual(11);
      }
    }
    // the workforce ladder in its home room: skeleton r7 Soldier, ghoul r11
    // Feaster, the stitcher one rung under its r12 Reanimator (that's the
    // depths' trick), the harrower at its rebased base
    const skel = resolveMob(reg.mobs["skeleton"]!, 9, SCALE);
    expect(skel.name).toBe("Skeleton Soldier");
    const feaster = resolveMob(reg.mobs["crypt_ghoul"]!, 11, SCALE);
    expect(feaster.name).toContain("Feaster");
    expect(reg.mobs["grave_harrower"]!.level).toBe(11);
  });

  it("spawns every region on walkable ground (≥60% of its columns)", () => {
    for (const t of def.spawnTables) {
      const { x: cx, z: cz, r } = t.region;
      let ok = 0;
      let n = 0;
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
          if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > r) continue;
          if (x < 1 || z < 1 || x >= world.w - 1 || z >= world.h - 1) continue;
          n++;
          const px = x + 0.5;
          const pz = z + 0.5;
          const y = world.floorY(px, pz);
          if (world.liquidAt(px, y + 0.1, pz)) continue;
          if (world.collidesAABB(px, y, pz, 0.3, 1.6)) continue;
          ok++;
        }
      }
      expect((ok / n) * 100, `${t.id} walkable`).toBeGreaterThanOrEqual(60);
    }
  });
});

describe("ossuary_galleries gen — the sorting-house", () => {
  it("is deterministic (grid AND features)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
    expect(JSON.stringify(world.features)).toBe(JSON.stringify(again.features));
  });

  it("floor-walks the whole S: court → hall → stitchery → cull-rows → the Warden's post", () => {
    const dist = floorDist(world, def.spawn.x, def.spawn.z);
    expect(dist.has(key(64, 119)), "the crypt gate").toBe(true);
    expect(dist.has(key(64, 71)), "the grading-hall south door").toBe(true);
    expect(dist.has(key(44, 45)), "the grading-hall north-west door").toBe(true);
    expect(dist.has(key(38, 26)), "the stitchery floor").toBe(true);
    expect(dist.has(key(82, 30)), "the cull-rows").toBe(true);
    expect(dist.has(key(112, 26)), "the Warden's post").toBe(true);
    expect(dist.has(key(112, 25)), "the Court gate approach").toBe(true);
    expect(dist.has(key(118, 14)), "the Warden's strongshelf cache").toBe(true);
    expect(dist.has(key(96, 90)), "the dead-cart lane spur").toBe(true);
    expect(dist.has(key(108, 87)), "the hidden chapel (through the crack)").toBe(true);
    expect(dist.has(key(116, 87)), "the chapel cache behind the altar").toBe(true);
  });

  it("the route between the two gates BENDS through the galleries (≥1.3× the ray)", () => {
    const dist = floorDist(world, def.spawn.x, def.spawn.z);
    const walk = dist.get(key(112, 25))!;
    const euclid = Math.hypot(112 - def.spawn.x, 25 - def.spawn.z);
    expect(walk / euclid).toBeGreaterThanOrEqual(1.3); // measured 1.35
    // the direct ray is blocked: it crosses the grading-hall's walls
    let solids = 0;
    for (let t = 0; t <= 1; t += 0.005) {
      const x = Math.round(64 + (114 - 64) * t);
      const z = Math.round(121 + (22 - 121) * t);
      if (world.solidAt(x, 14, z)) solids++;
    }
    expect(solids).toBeGreaterThan(2);
    // and the east flank is buried: the collapse spans hall wall → perimeter
    for (const x of [92, 96, 104, 112, 120]) {
      expect(world.solidAt(x, 13, 76) || world.solidAt(x, 13, 77), `collapse at x=${x}`).toBe(true);
    }
  });

  it("dresses the galleries: shelf rows, the stitchery tableau, the down-shaft", () => {
    // grading-hall shelf rows are 2-high bone (jump-proof — the crossing zig-zags)
    let shelf = 0;
    for (let x = 41; x <= 87; x++) for (const z of [50, 55, 60, 65]) if (world.get(x, 14, z) === BLOCK.bone_block!.id) shelf++;
    expect(shelf).toBeGreaterThan(100);
    // the half-finished courtier on the stitchery's master table
    expect(world.get(35, 13, 32)).toBe(BLOCK.marble!.id);
    expect(world.get(35, 14, 32)).toBe(BLOCK.skull_pile!.id);
    expect(world.get(36, 14, 32)).toBe(BLOCK.bone_block!.id);
    // the down-shaft: dug deep, railed jump-proof, the chain still rigged
    // (probe a column clear of the freight beam — standY reads the beam top)
    expect(world.standY(104.5, 17.5)).toBeLessThan(6); // the pit floor, far below
    expect(world.get(101, 13, 15)).toBe(BLOCK.iron_bars!.id);
    expect(world.get(101, 14, 15)).toBe(BLOCK.iron_bars!.id);
    expect(world.get(105, 14, 15)).toBe(BLOCK.chain!.id);
    // the Warden's post: braziers burn beside the Court gate
    expect(world.get(108, 14, 27)).toBe(BLOCK.brazier!.id);
    expect(world.get(118, 14, 27)).toBe(BLOCK.brazier!.id);
  });

  it("hides the chapel: sealed but for a 1-wide crack, one candle, unswept", () => {
    // the crack is the only opening (west wall, screened by rubble)
    for (let y = 13; y <= 15; y++) expect(world.get(100, y, 86)).toBe(0);
    expect(world.get(99, 13, 85)).toBe(BLOCK.rubble!.id);
    // walls otherwise unbroken at head height along the north face
    for (let x = 101; x <= 117; x++) expect(world.solidAt(x, 14, 78), `chapel north wall x=${x}`).toBe(true);
    // one candle on the altar — the only light the Court never sorted
    expect(world.get(114, 13, 86)).toBe(BLOCK.marble!.id);
    expect(world.get(114, 14, 87)).toBe(BLOCK.bog_candle!.id);
    let candles = 0;
    for (let z = 79; z <= 95; z++) for (let x = 101; x <= 117; x++) for (let y = 13; y <= 16; y++) if (world.get(x, y, z) === BLOCK.bog_candle!.id) candles++;
    expect(candles).toBe(1);
  });

  it("stocks both caches on cache_ossuary_galleries (the ½-tier convention)", () => {
    const caches = world.features.caches.filter((c) => c.table === "cache_ossuary_galleries");
    expect(caches).toHaveLength(2);
    expect(caches.some((c) => Math.hypot(c.x - 118.5, c.z - 14.5) < 1)).toBe(true); // the strongshelf
    expect(caches.some((c) => Math.hypot(c.x - 116.5, c.z - 87.5) < 1)).toBe(true); // the chapel
    const table = reg.loot["cache_ossuary_galleries"]!;
    expect(table.entries.some((e) => e.table === "weapons_steel")).toBe(true); // T2 home
    expect(table.entries.some((e) => e.table === "weapons_rift")).toBe(true); // the ½-tier reach up
  });
});

describe("the splice — the crypt branch, re-threaded", () => {
  it("dungeon ⇄ ossuary: twin-gate arrivals both ways; the Gravelord gate is EXACTLY as it was", () => {
    const down = dungeon.portals.find((p) => p.id === "dungeon-depths")!;
    expect(down.target).toBe("ossuary_galleries");
    expect(down).toMatchObject({ x: 46, z: 6 }); // same spot behind the boss hall
    const up = def.portals.find((p) => p.id === "ossuary-dungeon")!;
    expect(up.target).toBe("dungeon");
    const arriveOss = computePortalArrival(def, "dungeon", down)!;
    expect(Math.hypot(arriveOss.x - up.x, arriveOss.z - up.z)).toBeLessThanOrEqual(up.r + 1.5);
    const arriveDun = computePortalArrival(dungeon, "ossuary_galleries", up)!;
    expect(Math.hypot(arriveDun.x - down.x, arriveDun.z - down.z)).toBeLessThanOrEqual(down.r + 1.5);
    // the bossDeath gate rides untouched: sealed behind the minotaur, same portal id
    const gate = dungeon.events.find((e) => e.id === "gravelord-gate")!;
    expect(gate.on).toEqual({ kind: "bossDeath", mob: "minotaur_boss" });
    expect(gate.actions.some((a) => a.kind === "openPortal" && a.portalId === "dungeon-depths")).toBe(true);
  });

  it("ossuary ⇄ crypt_depths: twin-gate arrivals both ways (the depths' gate kept its spot)", () => {
    const down = def.portals.find((p) => p.id === "ossuary-depths")!;
    expect(down.target).toBe("crypt_depths");
    const up = depths.portals.find((p) => p.id === "depths-ossuary")!;
    expect(up.target).toBe("ossuary_galleries");
    expect(up.x).toBe(48); // the old dungeon-return position, retargeted data-only
    expect(up.z).toBe(90);
    const arriveDepths = computePortalArrival(depths, "ossuary_galleries", down)!;
    expect(Math.hypot(arriveDepths.x - up.x, arriveDepths.z - up.z)).toBeLessThanOrEqual(up.r + 1.5);
    const arriveOss = computePortalArrival(def, "crypt_depths", up)!;
    expect(Math.hypot(arriveOss.x - down.x, arriveOss.z - down.z)).toBeLessThanOrEqual(down.r + 1.5);
    // arrivals from the depths step off beside the Warden's post — his door, his watch
    expect(Math.hypot(arriveOss.x - 112, arriveOss.z - 26)).toBeLessThan(6);
  });

  it("the Sunken Crypt is STATEFUL now, its Gravelord on a real (door-ajar) respawn", () => {
    expect(dungeon.persistence).toBe("stateful");
    expect(dungeon.lifecycle).toBeUndefined(); // the persistence flip removed the expiry arc
    // a 99999 respawn in a stateful room would open the gate once, forever —
    // the boss cycle IS the door-ajar window now (the greenhood pattern)
    const boss = dungeon.spawnTables.find((t) => t.id === "warden-door" ? false : t.mobs[0]!.mob === "minotaur_boss")!;
    expect(boss.respawnSec).toBe(900);
    // the warden-door miniboss keeps its L9 shape exactly (no override, base def)
    const wd = dungeon.spawnTables.find((t) => t.id === "warden-door")!;
    expect(wd.mobs[0]!.level).toBeUndefined();
    expect(wd.maxAlive).toBe(1);
    // the rally wave carries the pre-retune level (the new spawnMobs level field)
    const rally = dungeon.events.find((e) => e.id === "gravelord-rally")!;
    expect(rally.actions.find((a) => a.kind === "spawnMobs")).toMatchObject({ mob: "skeleton", level: 6 });
  });

  it("crypt_depths keeps its ephemeral collapse cycle (the NEXT batch's flip, not this one)", () => {
    expect(depths.persistence).toBe("ephemeral");
    expect(depths.lifecycle).toEqual({ lifetimeSec: 3000, downtimeSec: 240, warnAtSecLeft: [300, 60, 10] });
  });
});

describe("THE Bone Warden — foreman of the sorting-house, at his actual post", () => {
  const warden = reg.mobs["bone_warden"]!;

  it("is elevated to a room boss at L12 by the spawn override + the new rank", () => {
    const post = def.spawnTables.find((t) => t.id === "warden-post")!;
    expect(post.mobs[0]).toMatchObject({ mob: "bone_warden", level: 12 });
    expect(post.maxAlive).toBe(1);
    expect(post.respawnSec).toBeGreaterThanOrEqual(600);
    const boss = resolveMob(warden, 12, SCALE);
    expect(boss.name).toBe("Bone Warden of the Galleries");
    expect(boss.hp).toBe(791); // boss trend: Grelmoss 719 @11 < 791 @12 < Furnace tier
    expect(boss.damage).toBe(30);
    expect(boss.aggroRadius).toBe(12); // he guards the door — you don't slip past
    // boss-role xp exactly on the batch-1 formula (room boss ×8 at L12)
    expect(boss.xp).toBe(Math.round(8 * (14 + 2 * Math.pow(12, 2.1)))); // 3066
    // the mixed slam+shrapnel kit is already a boss kit (close between shots)
    expect(boss.attacks.map((a) => a.ability).sort()).toEqual(["bone_shrapnel", "boss_slam"]);
  });

  it("RECONCILIATION: his L9 dungeon miniboss and L14 depths resolves are unchanged", () => {
    // the dungeon's warden-door spawns the base def: untouched by the new rank
    const mini = resolveMob(warden, undefined, SCALE);
    expect(mini.level).toBe(9);
    expect(mini.hp).toBe(368);
    expect(mini.damage).toBe(22);
    expect(mini.xp).toBe(863); // miniboss ×4 at L9
    expect(mini.name).toBe("Bone Warden");
    // the depths' L14 "Ossuary Warden": the r14 multipliers were DIVIDED by the
    // r12 boss bump so the cumulative resolve is byte-identical to pre-batch
    const deep = resolveMob(warden, 14, SCALE);
    expect(deep.hp).toBe(779);
    expect(deep.xp).toBe(2100);
    expect(deep.name).toBe("Bone Warden Ossuary Warden");
    expect(deep.attacks.map((a) => a.ability).sort()).toEqual(["bone_shrapnel", "boss_slam", "cleave"]);
    expect(deep.attackRange).toBe(22);
    expect(deep.leashRadius).toBe(46);
    // and his xp NEVER out-earns the room he stands in
    expect(deep.xp).toBeLessThan(resolveMob(reg.mobs["lich_boss"]!, undefined, SCALE).xp);
  });

  it("rings the shift-bell at half health and breaks on the bible's line", () => {
    const shift = def.events.find((e) => e.id === "warden-shift")!;
    expect(shift.on).toEqual({ kind: "bossHpBelowPct", mob: "bone_warden", pct: 0.5 });
    expect(shift.actions.find((a) => a.kind === "spawnMobs")).toMatchObject({ mob: "restless_bones", level: 10 });
    const death = def.events.find((e) => e.id === "warden-breaks")!;
    expect(death.on).toEqual({ kind: "bossDeath", mob: "bone_warden" });
    expect(death.actions.some((a) => a.kind === "announce" && a.text === "The Bone Warden breaks. The Court's door is unattended.")).toBe(true);
  });
});

describe("the hidden chapel — the grief the Court can't process", () => {
  it("holds ONE Wrung Shade on a long respawn (the bible's 6/rank-13 call)", () => {
    const chapel = def.spawnTables.find((t) => t.id === "mourner-chapel")!;
    expect(chapel.mobs[0]).toMatchObject({ mob: "pallid_mourner", level: 13 });
    expect(chapel.maxAlive).toBe(1);
    expect(chapel.respawnSec).toBeGreaterThanOrEqual(600);
    const shade = resolveMob(reg.mobs["pallid_mourner"]!, 13, SCALE);
    expect(shade.name).toBe("Pallid Mourner Wrung Shade");
    expect(shade.aggroRadius).toBe(12); // in a chapel this size, entering IS the trap
    expect(shade.fleeAtHpPct).toBe(0);
    // the horror is the encounter, not the payout — it never rivals the Warden
    expect(shade.xp).toBeLessThan(resolveMob(reg.mobs["bone_warden"]!, 12, SCALE).xp / 10);
  });
});

describe("the rebases — bat and harrower join the galleries without moving the depths", () => {
  it("bone_bat runs at L10 base; the depths' L12 override is exact", () => {
    const bat = reg.mobs["bone_bat"]!;
    expect(bat.level).toBe(10);
    const deep = resolveMob(bat, 12, SCALE);
    expect(deep.hp).toBe(110); // pre-retune: 110
    expect(deep.damage).toBe(18); // pre-retune: 18
    expect(deep.xp).toBe(383); // pre-retune: 383 (rank xpMult re-anchors)
    for (const id of ["bat-cloister-w", "bat-cloister-e"]) {
      expect(depths.spawnTables.find((t) => t.id === id)!.mobs[0]!.level, id).toBe(12);
    }
  });

  it("grave_harrower runs at L11 base; the depths' L14 Deathless resolve is exact", () => {
    const harrower = reg.mobs["grave_harrower"]!;
    expect(harrower.level).toBe(11);
    const deep = resolveMob(harrower, 14, SCALE);
    expect(deep.hp).toBe(508); // pre-retune: 508
    expect(deep.damage).toBe(34); // pre-retune: 34
    expect(deep.xp).toBe(1049); // pre-retune: 1049 (xpMult folded into the r14)
    expect(deep.attacks.find((a) => a.ability === "shadow_lance")!.damage).toBe(37); // pre-retune resolve: 37
    expect(depths.spawnTables.find((t) => t.id === "workshop")!.mobs[0]!.level).toBe(14);
  });

  it("nothing in the galleries out-earns the Warden", () => {
    const cap = resolveMob(reg.mobs["bone_warden"]!, 12, SCALE).xp;
    for (const t of def.spawnTables) {
      for (const m of t.mobs) {
        if (t.id === "warden-post") continue;
        const xp = resolveMob(reg.mobs[m.mob]!, m.level, SCALE).xp;
        expect(xp, `${t.id}/${m.mob}`).toBeLessThan(cap);
      }
    }
  });
});
