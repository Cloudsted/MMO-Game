/**
 * THE EMBERFELLS (E3, world-redesign batch 5) — the L8-10 volcanic foothills
 * spliced between the Sunscour and the Cinderrift, killing the old L4-7 →
 * L11-13 cliff. The terraces are POUR-LINES: slag tipped downslope from the
 * rift above; the Old Kiln is the machine that tipped it.
 *
 * Covers: def load (stateful wilderness thoroughfare — no gates, no
 * lifecycle), proc+authored gen determinism, the SUNSCOUR GRADIENT (sand in
 * the south third dying out by mid-room), the bending haul-road (seed 91101
 * was surveyed so the central lava basin sits square between the gates — the
 * direct ray crosses ~52 lava columns, and the spawn→boss ray ~72: the
 * no-straight-lines rule enforced by the terrain), BFS walkability desert
 * gate → rift gate + the Kiln's trough + the terraces, portal pairing on
 * both new edges, the Old Kiln's kit/tuning/economy invariants (batch-1 xp
 * formula, boss-hp trend, boss-table shape, trophy ladder), and the
 * ash_husk / fire_elemental / slagback_troll rebases (cinderrift's overrides
 * resolve within a point of their pre-retune values).
 */
import { describe, expect, it } from "vitest";
import { BLOCK, computePortalArrival, gameConstants, loadRoomDef, mobAttacks, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const SCALE = gameConstants().mobs.scaling;
const def = loadRoomDef("emberfells");
const desert = loadRoomDef("desert");
const cinderrift = loadRoomDef("cinderrift");
const world = new VoxelWorld(def);

/** BFS over walkable floor gaps (same helper as the march/greenhood tests). */
function floorReach(w: VoxelWorld, sx: number, sz: number): Map<number, number> {
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
  return feet;
}

describe("emberfells def", () => {
  it("loads as a stateful volcanic thoroughfare: no lifecycle, no gates", () => {
    expect(def.type).toBe("wilderness");
    expect(def.persistence).toBe("stateful");
    expect(def.lifecycle).toBeUndefined();
    expect(def.size).toEqual({ w: 288, h: 288 });
    expect(def.biome).toBe("volcanic");
    expect(def.terrain.liquid).toBe("lava");
    expect(def.flags).toEqual(desert.flags); // the wilderness shape
    // an always-open border land: no event may seal or collapse anything
    for (const e of def.events) {
      for (const a of e.actions) {
        expect(a.kind, `${e.id}: ${a.kind}`).not.toBe("openPortal");
        expect(a.kind, `${e.id}: ${a.kind}`).not.toBe("setRoomTimer");
      }
    }
    expect(def.npcs).toHaveLength(0); // nobody lives downhill from the Furnace-King
  });

  it("bands L8-10 on the trash tables; the Kiln sits solitary and slow at band-top+1", () => {
    for (const t of def.spawnTables) {
      expect(t.region.x - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.x + t.region.r, t.id).toBeLessThanOrEqual(def.size.w);
      expect(t.region.z - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.z + t.region.r, t.id).toBeLessThanOrEqual(def.size.h);
      for (const m of t.mobs) {
        expect(reg.mobs[m.mob], m.mob).toBeDefined();
        if (m.mob === "old_kiln") continue;
        const lvl = m.level ?? reg.mobs[m.mob]!.level;
        expect(lvl, `${t.id}/${m.mob}`).toBeGreaterThanOrEqual(8);
        expect(lvl, `${t.id}/${m.mob}`).toBeLessThanOrEqual(10);
      }
    }
    const kiln = def.spawnTables.find((t) => t.id === "kiln-adit")!;
    expect(kiln.mobs[0]!.mob).toBe("old_kiln");
    expect(kiln.maxAlive).toBe(1);
    expect(kiln.respawnSec).toBeGreaterThanOrEqual(600); // boss-table economy shape
    // the pickers light the sandpicker r8 Tomb-Breaker rank ON PURPOSE
    const pickers = def.spawnTables.find((t) => t.id === "pickers-slagfield")!;
    expect(pickers.mobs[0]!.level).toBe(8);
    const picked = resolveMob(reg.mobs["sandpicker"]!, 8, SCALE);
    expect(picked.attacks.map((a) => a.ability)).toContain("cleave"); // r8 unlocked
  });

  it("never overlaps two pack tables of different families", () => {
    const solitary = (t: (typeof def.spawnTables)[number]) => t.packSize[0] === 1 && t.packSize[1] === 1;
    const packs = def.spawnTables.filter((t) => !solitary(t));
    for (let i = 0; i < packs.length; i++) {
      for (let j = i + 1; j < packs.length; j++) {
        const a = packs[i]!;
        const b = packs[j]!;
        if (a.mobs.some((m) => b.mobs.some((n) => n.mob === m.mob))) continue;
        const d = Math.hypot(a.region.x - b.region.x, a.region.z - b.region.z);
        expect(d, `${a.id} overlaps ${b.id}`).toBeGreaterThan(a.region.r + b.region.r);
      }
    }
  });

  it("spawns every region on dry, walkable ground (≥60% of its columns)", () => {
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
      expect((ok / n) * 100, `${t.id} dry-walkable`).toBeGreaterThanOrEqual(60);
    }
  }, 60000);
});

describe("emberfells gen — where the sand starts to burn", () => {
  it("is deterministic (grid AND features)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
    expect(JSON.stringify(world.features)).toBe(JSON.stringify(again.features));
  });

  it("carries the Sunscour gradient: sand at the desert gate, none at the rift gate", () => {
    const SAND = BLOCK.sand!.id;
    const SANDSTONE = BLOCK.sandstone!.id;
    const band = (z0: number, z1: number) => {
      let sand = 0;
      let n = 0;
      for (let z = z0; z < z1; z++) {
        for (let x = 0; x < def.size.w; x++) {
          n++;
          const g = world.terrainHeight(def, x, z);
          const s = world.get(x, g, z);
          if (s === SAND || s === SANDSTONE) sand++;
        }
      }
      return sand / n;
    };
    // measured at seed 91101: south 66.6% sand, north 0.0%
    expect(band(236, 276)).toBeGreaterThan(0.4);
    expect(band(40, 80)).toBeLessThan(0.02);
  });

  it("the direct gate→gate ray crosses the lava basin (the haul-road MUST bend)", () => {
    const pd = def.portals.find((p) => p.id === "emberfells-desert")!;
    const pc = def.portals.find((p) => p.id === "emberfells-cinderrift")!;
    const wl = def.terrain.waterLevel ?? 9;
    let lava = 0;
    for (let t = 0; t <= 1; t += 0.005) {
      const x = Math.round(pd.x + (pc.x - pd.x) * t);
      const z = Math.round(pd.z + (pc.z - pd.z) * t);
      if (world.terrainHeight(def, x, z) < wl) lava++;
    }
    expect(lava).toBeGreaterThan(30); // measured 52/201 at seed 91101
    // ...and the spawn→boss ray crosses it too (no straight line to the Kiln)
    let bossRay = 0;
    for (let t = 0; t <= 1; t += 0.005) {
      const x = Math.round(def.spawn.x + (118 - def.spawn.x) * t);
      const z = Math.round(def.spawn.z + (95 - def.spawn.z) * t);
      if (world.terrainHeight(def, x, z) < wl) bossRay++;
    }
    expect(bossRay).toBeGreaterThan(30); // measured 72/201
    // the authored road bends far off the gate→gate ray, and carries surface
    const PATH = BLOCK.path!.id;
    const ASH = BLOCK.ash!.id;
    const CHARRED = BLOCK.charred_log!.id;
    for (const [bx, bz] of [
      [220, 152],
      [96, 110],
    ] as const) {
      const vx = pc.x - pd.x;
      const vz = pc.z - pd.z;
      const tt = Math.max(0, Math.min(1, ((bx - pd.x) * vx + (bz - pd.z) * vz) / (vx * vx + vz * vz)));
      const d = Math.hypot(bx - (pd.x + vx * tt), bz - (pd.z + vz * tt));
      expect(d, `bend (${bx},${bz}) off the direct ray`).toBeGreaterThan(15); // measured 18.3 / 43.9

      const g = world.terrainHeight(def, bx, bz);
      expect([PATH, ASH, CHARRED], `road surface at (${bx},${bz})`).toContain(world.get(bx, g, bz));
    }
  });

  it("floor-walks spawn → both gates, the Kiln's trough, and the pour-terraces", () => {
    const reach = floorReach(world, def.spawn.x, def.spawn.z);
    const key = (x: number, z: number) => x + z * world.w;
    expect(reach.has(key(200, 260)), "the desert gate").toBe(true);
    expect(reach.has(key(72, 31)), "the rift gate").toBe(true);
    expect(reach.has(key(118, 95)), "the Kiln's trough court (the boss arena)").toBe(true);
    expect(reach.has(key(150, 164)), "the lowest pour-bench").toBe(true);
    expect(reach.has(key(182, 164)), "the highest pour-bench (1-block risers)").toBe(true);
    expect(reach.has(key(60, 192)), "the pickers' slag-field").toBe(true);
    expect(reach.has(key(110, 52)), "the spark drifts").toBe(true);
  });

  it("dresses the Kiln's adit: breathing mouth, grate, slag-vomit cones, swept bone", () => {
    const G0 = world.terrainHeight(def, 118, 88); // 13 at seed 91101
    // the cone rises over the natural rim...
    expect(world.standY(118.5, 84.5)).toBeGreaterThan(G0 + 4);
    // ...the mouth is dug through it, grated, and lit from inside
    expect(world.get(118, G0 + 1, 85)).toBe(BLOCK.iron_bars!.id);
    expect(world.get(117, G0 + 1, 86)).toBe(BLOCK.ember_crystal!.id);
    expect(world.get(119, G0 + 1, 86)).toBe(BLOCK.ember_crystal!.id);
    // the trough court is flat swept ash with what feeding leaves
    expect(world.get(118, G0, 95)).toBe(BLOCK.ash!.id);
    expect(world.get(111, G0 + 1, 101)).toBe(BLOCK.skull_pile!.id);
    // slag-vomit cones ring the trough (obsidian-tipped)
    let obsidianTips = 0;
    for (let z = 82; z <= 104; z++)
      for (let x = 106; x <= 130; x++)
        for (let y = G0 + 1; y <= G0 + 4; y++) if (world.get(x, y, z) === BLOCK.obsidian!.id) obsidianTips++;
    expect(obsidianTips).toBeGreaterThanOrEqual(4);
  });

  it("steps the pour-terraces west-down into the basin, mossy at the oldest lip", () => {
    // benches ascend eastward in 1-block risers (jumpable, walkable)
    expect(world.standY(150.5, 164.5)).toBe(13);
    expect(world.standY(182.5, 164.5)).toBe(18);
    // the oldest (lowest) pours have mossed over; the freshest lips carry ash
    let mossy = 0;
    let ash = 0;
    for (let z = 152; z <= 174; z++) {
      for (let x = 148; x <= 156; x++) if (world.get(x, world.standY(x + 0.5, z + 0.5) - 1, z) === BLOCK.mossy_cobblestone!.id) mossy++;
      for (let x = 178; x <= 184; x++) if (world.get(x, world.standY(x + 0.5, z + 0.5) - 1, z) === BLOCK.ash!.id) ash++;
    }
    expect(mossy).toBeGreaterThan(20);
    expect(ash).toBeGreaterThan(20);
  });
});

describe("the splice — portal pairing on both new edges", () => {
  it("desert ⇄ emberfells: twin-gate arrivals both ways (desert's gate kept its spot)", () => {
    const down = desert.portals.find((p) => p.id === "desert-emberfells")!;
    expect(down.target).toBe("emberfells");
    expect(down.x).toBe(144); // the old cinderrift gate's position, retargeted data-only
    expect(down.z).toBe(32);
    const up = def.portals.find((p) => p.id === "emberfells-desert")!;
    expect(up.target).toBe("desert");
    const arriveFells = computePortalArrival(def, "desert", down)!;
    expect(Math.hypot(arriveFells.x - up.x, arriveFells.z - up.z)).toBeLessThanOrEqual(up.r + 1.5);
    const arriveDesert = computePortalArrival(desert, "emberfells", up)!;
    expect(Math.hypot(arriveDesert.x - down.x, arriveDesert.z - down.z)).toBeLessThanOrEqual(down.r + 1.5);
  });

  it("emberfells ⇄ cinderrift: twin-gate arrivals both ways (the rift's gate kept its spot)", () => {
    const down = def.portals.find((p) => p.id === "emberfells-cinderrift")!;
    expect(down.target).toBe("cinderrift");
    const up = cinderrift.portals.find((p) => p.id === "cinderrift-emberfells")!;
    expect(up.target).toBe("emberfells");
    expect(up.x).toBe(144); // the old desert gate's position, retargeted data-only
    expect(up.z).toBe(278);
    const arriveRift = computePortalArrival(cinderrift, "emberfells", down)!;
    expect(Math.hypot(arriveRift.x - up.x, arriveRift.z - up.z)).toBeLessThanOrEqual(up.r + 1.5);
    const arriveFells = computePortalArrival(def, "cinderrift", up)!;
    expect(Math.hypot(arriveFells.x - down.x, arriveFells.z - down.z)).toBeLessThanOrEqual(down.r + 1.5);
  });

  it("the gates do NOT sit on a shared axis (no straight line across the room)", () => {
    const pd = def.portals.find((p) => p.id === "emberfells-desert")!;
    const pc = def.portals.find((p) => p.id === "emberfells-cinderrift")!;
    expect(Math.abs(pd.x - pc.x)).toBeGreaterThan(60);
    expect(Math.abs(pd.z - pc.z)).toBeGreaterThan(60);
  });
});

describe("the Old Kiln — the Furnace-King's oldest servant", () => {
  const kiln = reg.mobs["old_kiln"]!;

  it("defends its adit with slam, sticking spew, marching vents, and the gorge", () => {
    const kinds = mobAttacks(kiln).map((a) => reg.ability(a.ability).kind);
    expect(kinds).toContain("melee"); // golem_slam
    expect(kinds).toContain("projectile"); // slag_spew
    expect(kinds).toContain("pillars"); // magma_vents
    expect(kinds).toContain("self"); // slag_gorge
    const spew = reg.abilities["slag_spew"]!;
    expect(spew.debuff?.slowPct).toBeGreaterThan(0); // cooling slag hardens on you
    expect(spew.maxRange!).toBeGreaterThanOrEqual(kiln.attackRange); // kit invariant
    expect(spew.predictive).toBeFalsy(); // strafing beats the spew
    // the counterplay: the ore-gorge self-heal is gated AND interruptible
    const gorge = reg.abilities["slag_gorge"]!;
    expect(gorge.allyHeal?.includeSelf).toBe(true);
    expect(gorge.allyHeal!.castIfAllyBelowPct).toBeLessThan(1);
    expect(gorge.interruptible).toBe(true);
    // it defends the adit — it does not hunt the fells
    const r = resolveMob(kiln, undefined, SCALE);
    expect(r.moveSpeed).toBeLessThan(2);
    expect(r.leashRadius).toBeLessThanOrEqual(30);
    expect(kiln.sprite).toBe("slagback_troll"); // the eldest of the ore-eater caste
  });

  it("pays the batch-1 formula (room boss ×8 at L11) on the boss hp trend", () => {
    expect(kiln.level).toBe(11); // band-top+1 for L8-10
    expect(kiln.xp).toBe(Math.round(8 * (14 + 2 * Math.pow(11, 2.1)))); // 2573
    // its L11 peer Grelmoss pays the identical formula, on purpose
    expect(kiln.xp).toBe(resolveMob(reg.mobs["grelmoss"]!, undefined, SCALE).xp);
    // boss hp trend from the Gravelord anchor (596 @L9)
    const lo = Math.round(596 * 1.14); // 679
    const hi = Math.round(596 * Math.pow(1.14, 2)); // 775
    expect(kiln.hp).toBeGreaterThanOrEqual(lo);
    expect(kiln.hp).toBeLessThanOrEqual(hi);
  });

  it("drops the bounty proof: guaranteed gallstone + T3 rift at L11", () => {
    const table = reg.loot[kiln.loot]!;
    expect(table.guaranteed?.some((g) => g.item === "kiln_gallstone")).toBe(true);
    expect(table.guaranteed?.some((g) => g.table === "weapons_rift" && g.minRarity === "rare")).toBe(true);
    const stone = reg.items["kiln_gallstone"]!;
    expect(stone.kind).toBe("trophy");
    // the trophy ladder holds: above the L9 event-boss proof, below the prizes
    expect(stone.value).toBeGreaterThan(reg.items["undertide_beak_shard"]!.value);
    expect(stone.value).toBeLessThan(reg.items["spiral_horn"]!.value);
  });

  it("rallies the work-gang at half health and goes cold on the bible's line", () => {
    const rally = def.events.find((e) => e.id === "kiln-rally")!;
    expect(rally.on).toEqual({ kind: "bossHpBelowPct", mob: "old_kiln", pct: 0.5 });
    const wave = rally.actions.find((a) => a.kind === "spawnMobs")!;
    expect(wave).toMatchObject({ mob: "ash_husk", level: 9 }); // band-level adds (new spawnMobs level field)
    const death = def.events.find((e) => e.id === "kiln-cold")!;
    expect(death.on).toEqual({ kind: "bossDeath", mob: "old_kiln" });
    expect(death.actions.some((a) => a.kind === "announce" && a.text.includes("fells aren't smoking"))).toBe(true);
  });
});

describe("the rebases — the rift families join the fells without moving the rift", () => {
  it("ash_husk runs at L8 in the fells; cinderrift's L11 override resolves within a point", () => {
    const husk = reg.mobs["ash_husk"]!;
    expect(husk.level).toBe(8);
    const rift = resolveMob(husk, 11, SCALE);
    expect(rift.hp).toBe(259); // pre-retune: 260 (rebase rounding, documented ±1)
    expect(rift.damage).toBe(25); // pre-retune: 25
    expect(rift.xp).toBe(322); // pre-retune: 322 (rank xpMult re-anchors the curve)
    expect(rift.name).toContain("of the Long Shift");
    // cinderrift's husk fields actually carry the override
    for (const id of ["husk-fields-w", "husk-fields-e", "ember-terrace"]) {
      const t = cinderrift.spawnTables.find((x) => x.id === id)!;
      expect(t.mobs.find((m) => m.mob === "ash_husk")!.level, id).toBe(11);
    }
    // ...and so does the Furnace Golem's rally wave (the new spawnMobs level)
    const rally = cinderrift.events.find((e) => e.id === "furnace-rally")!;
    expect(rally.actions.find((a) => a.kind === "spawnMobs")).toMatchObject({ mob: "ash_husk", level: 11 });
  });

  it("fire_elemental runs at L10 in the fells; cinderrift's L12 override resolves within a point", () => {
    const ele = reg.mobs["fire_elemental"]!;
    expect(ele.level).toBe(10);
    const rift = resolveMob(ele, 12, SCALE);
    expect(rift.hp).toBe(179); // pre-retune: 180
    expect(rift.damage).toBe(28); // pre-retune: 28
    expect(rift.xp).toBe(383); // pre-retune: 383
    for (const id of ["ember-terrace", "forge-approach"]) {
      const t = cinderrift.spawnTables.find((x) => x.id === id)!;
      expect(t.mobs.find((m) => m.mob === "fire_elemental")!.level, id).toBe(12);
    }
  });

  it("slagback_troll runs at L10 in the fells; the L13 rank restores the rift troll EXACTLY", () => {
    const troll = reg.mobs["slagback_troll"]!;
    expect(troll.level).toBe(10);
    // the young fells troll hasn't the gut for the gorge yet
    expect(resolveMob(troll, undefined, SCALE).attacks.map((a) => a.ability)).toEqual(["cleave"]);
    // the rift's Ore-Gorged elder is the pre-retune fight: kit AND numbers
    const rift = resolveMob(troll, 13, SCALE);
    expect(rift.attacks.map((a) => a.ability).sort()).toEqual(["cleave", "slag_gorge"]);
    expect(rift.hp).toBe(379); // pre-retune: 380 (±1)
    expect(rift.damage).toBe(31); // pre-retune: 31
    expect(rift.xp).toBe(902); // pre-retune: 902
    expect(cinderrift.spawnTables.find((t) => t.id === "slag-adits")!.mobs[0]!.level).toBe(13);
    // the L15 Cinderhide resolve survives the rebase too (~1 hp)
    const deep = resolveMob(troll, 15, SCALE);
    expect(deep.hp).toBe(616); // pre-retune: 617
    expect(deep.xp).toBe(1235); // pre-retune: 1235
    expect(deep.attacks.find((a) => a.ability === "ember_burst")!.damage).toBe(32); // pre-retune resolve: 32
  });

  it("nothing in the fells out-earns the Kiln", () => {
    const cap = resolveMob(reg.mobs["old_kiln"]!, undefined, SCALE).xp;
    for (const t of def.spawnTables) {
      for (const m of t.mobs) {
        if (m.mob === "old_kiln") continue;
        const xp = resolveMob(reg.mobs[m.mob]!, m.level, SCALE).xp;
        expect(xp, `${t.id}/${m.mob}`).toBeLessThan(cap);
      }
    }
  });
});
