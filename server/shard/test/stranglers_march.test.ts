/**
 * THE STRANGLER'S MARCH (W3, world-redesign batch 4) — the L5-7 border land
 * spliced between the Kingless Wood and the Gloomfen, killing the old
 * L1-4 → L8-10 cliff. It also receives the Greenhood Run's one-way climb-out.
 *
 * Covers: def load (stateful wilderness thoroughfare — NO gates, NO
 * lifecycle), proc+authored gen determinism, the drowning-wood GRADIENT (the
 * room's whole reason: oaks and grass south, mud and pale snags north), the
 * bending road (the direct gate→gate ray crosses the merged murk basin — the
 * owner's no-straight-lines rule enforced by hydrology), BFS walkability
 * forest gate → fen gate + the smuggler landing + the Elder's lair, portal
 * pairing on all three edges (forest⇄march, march⇄gloomfen, run ─▶ march),
 * the chute-mouth mound tell, the Elder Strangler's kit/tuning/economy
 * invariants (batch-1 xp formula, solo-boss hp trend, boss-table shape), and
 * the mantrap/bog_serpent rebases (gloomfen resolves stay within a point of
 * their pre-retune values via the L9 table overrides).
 */
import { describe, expect, it } from "vitest";
import { BLOCK, computePortalArrival, gameConstants, loadRoomDef, mobAttacks, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const SCALE = gameConstants().mobs.scaling;
const def = loadRoomDef("stranglers_march");
const forest = loadRoomDef("forest");
const gloomfen = loadRoomDef("gloomfen");
const run = loadRoomDef("greenhood_run");
const world = new VoxelWorld(def);

/** BFS over walkable floor gaps (same helper as greenhood/maw tests). */
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

describe("stranglers_march def", () => {
  it("loads as a stateful wilderness thoroughfare: no lifecycle, no gates", () => {
    expect(def.type).toBe("wilderness");
    expect(def.persistence).toBe("stateful");
    expect(def.lifecycle).toBeUndefined();
    expect(def.size).toEqual({ w: 240, h: 240 });
    expect(def.biome).toBe("swamp");
    expect(def.terrain.liquid).toBe("murk_water");
    // flags match the wilderness shape (forest/gloomfen)
    expect(def.flags).toEqual(forest.flags);
    // an always-open border land: no event may seal or collapse anything
    for (const e of def.events) {
      for (const a of e.actions) {
        expect(a.kind, `${e.id}: ${a.kind}`).not.toBe("openPortal");
        expect(a.kind, `${e.id}: ${a.kind}`).not.toBe("setRoomTimer");
      }
    }
    expect(def.npcs).toHaveLength(0); // none living — that's the point of the march
  });

  it("bands L5-7 on the trash tables; the Elder sits solitary and slow at band-top+1", () => {
    for (const t of def.spawnTables) {
      expect(t.region.x - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.x + t.region.r, t.id).toBeLessThanOrEqual(def.size.w);
      expect(t.region.z - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.z + t.region.r, t.id).toBeLessThanOrEqual(def.size.h);
      for (const m of t.mobs) {
        expect(reg.mobs[m.mob], m.mob).toBeDefined();
        if (m.mob === "elder_strangler") continue;
        const lvl = m.level ?? reg.mobs[m.mob]!.level;
        expect(lvl, `${t.id}/${m.mob}`).toBeGreaterThanOrEqual(5);
        expect(lvl, `${t.id}/${m.mob}`).toBeLessThanOrEqual(7);
      }
    }
    const elder = def.spawnTables.find((t) => t.id === "elder-farmstead")!;
    expect(elder.mobs[0]!.mob).toBe("elder_strangler");
    expect(elder.maxAlive).toBe(1);
    expect(elder.respawnSec).toBeGreaterThanOrEqual(600); // boss-table economy shape
    // the poacher picket lights the r6 family ranks ON PURPOSE (the task of
    // the march: forest defs at L5-7 ranks)
    const picket = def.spawnTables.find((t) => t.id === "chute-watch")!;
    for (const m of picket.mobs) expect(m.level, `${picket.id}/${m.mob}`).toBe(6);
    // spiders run L5-7 with the r8 fen-face rank deliberately NOT lit here
    const weavers = def.spawnTables.find((t) => t.id === "weaver-thicket")!;
    expect(weavers.mobs[0]!.mob).toBe("giant_spider");
    expect(weavers.mobs[0]!.level).toBeLessThan(8);
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

describe("stranglers_march gen — the wood drowning by degrees", () => {
  it("is deterministic (grid AND features)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
    expect(JSON.stringify(world.features)).toBe(JSON.stringify(again.features));
  });

  it("carries the gradient: grass+oaks south, mud+pale snags north", () => {
    const GRASS = BLOCK.grass!.id;
    const MUD = BLOCK.mud!.id;
    const LOG = BLOCK.log!.id;
    const PALE = BLOCK.pale_log!.id;
    const band = (z0: number, z1: number) => {
      let grass = 0;
      let mud = 0;
      let oaks = 0;
      let pale = 0;
      let n = 0;
      for (let z = z0; z < z1; z++) {
        for (let x = 0; x < def.size.w; x++) {
          n++;
          const g = world.terrainHeight(def, x, z);
          const s = world.get(x, g, z);
          if (s === GRASS) grass++;
          else if (s === MUD) mud++;
          for (let y = g + 1; y < g + 8; y++) {
            const b = world.get(x, y, z);
            if (b === LOG) {
              oaks++;
              break;
            }
            if (b === PALE) {
              pale++;
              break;
            }
          }
        }
      }
      return { grass: grass / n, mud: mud / n, oaks, pale };
    };
    const south = band(200, 235);
    const north = band(20, 60);
    // measured at seed 90031: south 56% grass / 82 oaks; north 81% mud / 6 oaks
    expect(south.grass).toBeGreaterThan(north.grass * 2);
    expect(north.mud).toBeGreaterThan(south.mud * 1.5);
    expect(south.oaks).toBeGreaterThan(40);
    expect(north.oaks).toBeLessThan(south.oaks / 4);
    expect(north.pale).toBeGreaterThan(10); // the fen's dead trees carry the north
  });

  it("the direct gate→gate ray crosses the merged murk basin (the road MUST bend)", () => {
    const pf = def.portals.find((p) => p.id === "march-forest")!;
    const pg = def.portals.find((p) => p.id === "march-gloomfen")!;
    let flooded = 0;
    for (let t = 0; t <= 1; t += 0.005) {
      const x = Math.round(pf.x + (pg.x - pf.x) * t);
      const z = Math.round(pf.z + (pg.z - pf.z) * t);
      if (world.terrainHeight(def, x, z) < (def.terrain.waterLevel ?? 12)) flooded++;
    }
    expect(flooded).toBeGreaterThan(20); // measured 40/201 at seed 90031
    // and the road actually bends: authored bend points sit far off the ray
    for (const [bx, bz] of [
      [132, 176],
      [104, 64],
    ] as const) {
      const vx = pg.x - pf.x;
      const vz = pg.z - pf.z;
      const tt = Math.max(0, Math.min(1, ((bx - pf.x) * vx + (bz - pf.z) * vz) / (vx * vx + vz * vz)));
      const d = Math.hypot(bx - (pf.x + vx * tt), bz - (pf.z + vz * tt));
      expect(d, `bend (${bx},${bz}) off the direct ray`).toBeGreaterThan(10);
    }
    // bend points carry road surface (path paint at the bend elbows)
    const PATH = BLOCK.path!.id;
    const DIRT = BLOCK.dirt!.id;
    for (const [bx, bz] of [
      [132, 176],
      [104, 64],
    ] as const) {
      const g = world.terrainHeight(def, bx, bz);
      expect([PATH, DIRT], `road surface at (${bx},${bz})`).toContain(world.get(bx, g, bz));
    }
  });

  it("floor-walks spawn → both gates, the smuggler landing, the picket, and the Elder's lair", () => {
    const reach = floorReach(world, 120, 222);
    const key = (x: number, z: number) => x + z * world.w;
    expect(reach.has(key(120, 226)), "the forest gate").toBe(true);
    expect(reach.has(key(84, 27)), "the fen gate").toBe(true);
    expect(reach.has(key(28, 148)), "the chute-mouth mound crown").toBe(true);
    expect(reach.has(key(40, 160)), "the Greenhood picket").toBe(true);
    expect(reach.has(key(153, 113)), "the farmstead south door").toBe(true);
    expect(reach.has(key(153, 104)), "the heart of the garden (the Elder's lair)").toBe(true);
    expect(reach.has(key(120, 147)), "the causeway stub deck (a walkable dead end)").toBe(true);
  });

  it("dresses the farmstead as the Elder's arena: roofless shell, rootstock, glow", () => {
    // fieldstone walls with the full-height south door
    expect(world.solidAt(146, 14, 98)).toBe(true); // a wall cell stands
    for (let y = 14; y <= 17; y++) expect(world.get(153, y, 112)).toBe(0); // the south door is open sky-high
    // the heartroot + the glow-shroom ring (night readability)
    expect(world.get(153, 15, 105)).toBe(BLOCK.roots!.id);
    expect(world.get(151, 14, 103)).toBe(BLOCK.glow_shroom!.id);
    // drowned drystone field walls poke out of the sedge around the house
    let walls = 0;
    for (let z = 88; z <= 128; z++) for (let x = 138; x <= 178; x++) for (let y = 12; y <= 15; y++) if (world.get(x, y, z) === BLOCK.mossy_cobblestone!.id) walls++;
    expect(walls).toBeGreaterThan(80);
    // and the west paddocks actually drowned (authored murk inside the grid)
    let murk = 0;
    for (let z = 88; z <= 128; z++) for (let x = 138; x <= 148; x++) if (world.get(x, 12, z) === BLOCK.murk_water!.id) murk++;
    expect(murk).toBeGreaterThan(15);
  });

  it("snaps the old tithe-road: a raised causeway dying into the flood", () => {
    // deck blocks survive on the south half...
    let deck = 0;
    for (let z = 130; z <= 148; z++) for (const x of [119, 120, 121]) {
      const id = world.get(x, 15, z);
      if (id === BLOCK.stone_bricks!.id || id === BLOCK.cracked_bricks!.id) deck++;
    }
    expect(deck).toBeGreaterThan(30);
    // ...and the north end is bitten to fragments over the murk
    let northDeck = 0;
    for (let z = 104; z <= 112; z++) for (const x of [119, 120, 121]) {
      const id = world.get(x, 15, z);
      if (id === BLOCK.stone_bricks!.id || id === BLOCK.cracked_bricks!.id) northDeck++;
    }
    expect(northDeck).toBeLessThan(deck / 2);
  });

  it("builds the chute-mouth mound: trapdoor crown, lantern stump, no portal near it", () => {
    expect(world.get(28, 16, 148)).toBe(BLOCK.rotting_planks!.id);
    expect(world.standY(28.5, 148.5)).toBe(17); // arrivals stand ON the crown
    expect(world.get(24, 17, 146)).toBe(BLOCK.lantern!.id); // the smuggler's mark
    for (const p of def.portals) {
      expect(Math.hypot(p.x - 28.5, p.z - 148.5), p.id).toBeGreaterThan(30); // one-way by omission
    }
  });
});

describe("the splice — portal pairing on all three edges", () => {
  it("forest ⇄ march: twin-gate arrivals both ways", () => {
    const down = forest.portals.find((p) => p.id === "forest-march")!;
    expect(down.target).toBe("stranglers_march");
    const up = def.portals.find((p) => p.id === "march-forest")!;
    expect(up.target).toBe("forest");
    const arriveMarch = computePortalArrival(def, "forest", down)!;
    expect(Math.hypot(arriveMarch.x - up.x, arriveMarch.z - up.z)).toBeLessThanOrEqual(up.r + 1.5);
    const arriveForest = computePortalArrival(forest, "stranglers_march", up)!;
    expect(Math.hypot(arriveForest.x - down.x, arriveForest.z - down.z)).toBeLessThanOrEqual(down.r + 1.5);
  });

  it("march ⇄ gloomfen: twin-gate arrivals both ways (gloomfen's gate kept its spot)", () => {
    const down = def.portals.find((p) => p.id === "march-gloomfen")!;
    expect(down.target).toBe("gloomfen");
    const up = gloomfen.portals.find((p) => p.id === "gloomfen-march")!;
    expect(up.target).toBe("stranglers_march");
    expect(up.x).toBe(160); // the old forest gate's position, retargeted data-only
    expect(up.z).toBe(308);
    const arriveGloom = computePortalArrival(gloomfen, "stranglers_march", down)!;
    expect(Math.hypot(arriveGloom.x - up.x, arriveGloom.z - up.z)).toBeLessThanOrEqual(up.r + 1.5);
    const arriveMarch = computePortalArrival(def, "gloomfen", up)!;
    expect(Math.hypot(arriveMarch.x - down.x, arriveMarch.z - down.z)).toBeLessThanOrEqual(down.r + 1.5);
  });

  it("run ─▶ march: the one-way climb-out lands on the mound crown", () => {
    const via = run.portals.find((p) => p.id === "greenhood-out")!;
    expect(via.target).toBe("stranglers_march");
    expect(via.exitPortalId).toBeUndefined();
    const a = computePortalArrival(def, "greenhood_run", via)!;
    expect(a.x).toBe(28.5);
    expect(a.z).toBe(148.5);
  });

  it("no portal in the march targets greenhood_run (goods out, not people back)", () => {
    expect(def.portals.some((p) => p.target === "greenhood_run")).toBe(false);
  });
});

describe("the Elder Strangler — the gardener at the heart of the garden", () => {
  const elder = reg.mobs["elder_strangler"]!;

  it("is rooted area denial: slow grip, spore lob, marching root line", () => {
    const kinds = mobAttacks(elder).map((a) => reg.ability(a.ability).kind);
    expect(kinds).toContain("melee"); // strangle_lash
    expect(kinds).toContain("projectile"); // choking_spores
    expect(kinds).toContain("pillars"); // root_burst
    const lash = reg.abilities["strangle_lash"]!;
    expect(lash.debuff?.slowPct).toBeGreaterThan(0); // the grip slows
    const spores = reg.abilities["choking_spores"]!;
    expect(spores.debuff?.slowPct).toBeGreaterThan(0);
    expect(spores.debuff?.dotTotal).toBeGreaterThan(0); // choke + poison
    expect(spores.maxRange!).toBeGreaterThanOrEqual(elder.attackRange); // kit invariant
    expect(spores.predictive).toBeFalsy(); // strafing beats the lob
    // it doesn't chase: the fight is walking INTO the garden
    const r = resolveMob(elder, undefined, SCALE);
    expect(r.moveSpeed).toBeLessThan(1);
    expect(r.leashRadius).toBeLessThanOrEqual(20);
  });

  it("pays the batch-1 formula (room boss ×8 at L8) on the solo-boss hp trend", () => {
    expect(elder.level).toBe(8); // band-top+1 for L5-7
    expect(elder.xp).toBe(Math.round(8 * (14 + 2 * Math.pow(8, 2.1)))); // 1373
    // solo trend between Thrace (400 @L5) and the Gravelord (596 @L9)
    const lo = Math.round(596 / Math.pow(1.14, 1)); // 523
    const hi = Math.round(400 * Math.pow(1.14, 3)); // 593
    expect(elder.hp).toBeGreaterThanOrEqual(lo);
    expect(elder.hp).toBeLessThanOrEqual(hi);
  });

  it("drops the bounty proof: guaranteed heartroot + T2 steel at L8", () => {
    const table = reg.loot[elder.loot]!;
    expect(table.guaranteed?.some((g) => g.item === "strangler_heartroot")).toBe(true);
    expect(table.guaranteed?.some((g) => g.table === "weapons_steel" && g.minRarity === "rare")).toBe(true);
    const root = reg.items["strangler_heartroot"]!;
    expect(root.kind).toBe("trophy");
    // trophy ladder holds: above Grole's ledger page, below the L9 event boss proof
    expect(root.value).toBeGreaterThan(reg.items["greenhood_ledger_page"]!.value);
    expect(root.value).toBeLessThan(reg.items["undertide_beak_shard"]!.value);
  });

  it("rallies the garden at half health and withers on the bible's line", () => {
    const rally = def.events.find((e) => e.id === "elder-rally")!;
    expect(rally.on).toEqual({ kind: "bossHpBelowPct", mob: "elder_strangler", pct: 0.5 });
    expect(rally.actions.some((a) => a.kind === "spawnMobs" && a.mob === "mantrap")).toBe(true);
    const death = def.events.find((e) => e.id === "elder-withers")!;
    expect(death.on).toEqual({ kind: "bossDeath", mob: "elder_strangler" });
    expect(death.actions.some((a) => a.kind === "announce" && a.text.includes("gardens go quiet"))).toBe(true);
  });
});

describe("the rebases — mantrap and bog_serpent join the march without moving the fen", () => {
  it("mantrap runs at L6 in the march; gloomfen's L9 override resolves within a point of pre-retune", () => {
    const mantrap = reg.mobs["mantrap"]!;
    expect(mantrap.level).toBe(6);
    const fen = resolveMob(mantrap, 9, SCALE);
    expect(fen.hp).toBe(230); // pre-retune: 230
    expect(fen.damage).toBe(25); // pre-retune: 24 (rebase rounding, documented ±1)
    expect(fen.xp).toBe(216); // pre-retune: 216 (rank xpMult re-anchors the curve)
    expect(fen.name).toContain("of the Mire");
    // gloomfen's thicket actually carries the override
    const thicket = gloomfen.spawnTables.find((t) => t.id === "strangler-thicket")!;
    expect(thicket.mobs[0]!.level).toBe(9);
  });

  it("bog_serpent runs at L6 in the march; gloomfen's L9 override is exact", () => {
    const serpent = reg.mobs["bog_serpent"]!;
    expect(serpent.level).toBe(6);
    const fen = resolveMob(serpent, 9, SCALE);
    expect(fen.hp).toBe(170); // pre-retune: 170
    expect(fen.damage).toBe(19); // pre-retune: 19
    expect(fen.xp).toBe(216); // pre-retune: 216
    const shallows = gloomfen.spawnTables.find((t) => t.id === "serpent-shallows")!;
    expect(shallows.mobs.find((m) => m.mob === "bog_serpent")!.level).toBe(9);
  });

  it("nothing in the march out-earns the Elder", () => {
    const cap = resolveMob(reg.mobs["elder_strangler"]!, undefined, SCALE).xp;
    for (const t of def.spawnTables) {
      for (const m of t.mobs) {
        if (m.mob === "elder_strangler") continue;
        const xp = resolveMob(reg.mobs[m.mob]!, m.level, SCALE).xp;
        expect(xp, `${t.id}/${m.mob}`).toBeLessThan(cap);
      }
    }
  });
});
