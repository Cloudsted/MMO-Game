/**
 * THE SUNDERING FIELDS (W5, world-redesign batch 7) — the L11-13 approach
 * plain spliced between the Gloomfen and the Fallen Capital: where the
 * king's army made its stand for nine days, and where the two mainlines'
 * western arm meets the capital at level.
 *
 * Covers: def load (stateful wilderness, murk pools, no gates/lifecycle),
 * proc+authored gen determinism, the no-straight-lines net (seed 92001 was
 * SURVEYED: the drowned mere sits on the direct south-gate → city-gate ray,
 * and the two authored trench crescents ditch what the water misses), BFS
 * walkability to all four gates + the arena + the barrow den, the frozen-war
 * dressing (trenches with firing steps, the sledge-furrow, the war-sledge,
 * the mustering stones, the toll arch's chains, the corpse-candle trail),
 * portal pairing on all four edges (gloomfen ×2 + city + foundry), Old
 * Wallbreaker's kit/economy anchors, the Barrow Alpha side boss, and the
 * lizardman re-anchor rank.
 */
import { describe, expect, it } from "vitest";
import { BLOCK, computePortalArrival, gameConstants, loadRoomDef, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const SCALE = gameConstants().mobs.scaling;
const def = loadRoomDef("sundering_fields");
const gloomfen = loadRoomDef("gloomfen");
const city = loadRoomDef("sundered_city");
const foundry = loadRoomDef("foundry");
const world = new VoxelWorld(def);

/** BFS over walkable floor gaps (same helper as the march/emberfells tests). */
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

describe("sundering_fields def", () => {
  it("loads as a stateful war-plain thoroughfare: no lifecycle, no gates", () => {
    expect(def.type).toBe("wilderness");
    expect(def.persistence).toBe("stateful");
    expect(def.lifecycle).toBeUndefined();
    expect(def.size).toEqual({ w: 288, h: 288 });
    expect(def.terrain.liquid).toBe("murk_water");
    // a thoroughfare: no event may seal or collapse anything here
    for (const e of def.events) {
      for (const a of e.actions) {
        expect(a.kind, `${e.id}: ${a.kind}`).not.toBe("openPortal");
        expect(a.kind, `${e.id}: ${a.kind}`).not.toBe("setRoomTimer");
      }
    }
    expect(def.npcs).toHaveLength(0); // none living (the bible's call)
    expect(def.portals).toHaveLength(4); // fen ×2, city, foundry
  });

  it("bands L11-13 with the day-nine line at the capital edge; both bosses solitary and slow", () => {
    for (const t of def.spawnTables) {
      expect(t.region.x - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.x + t.region.r, t.id).toBeLessThanOrEqual(def.size.w);
      expect(t.region.z - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.z + t.region.r, t.id).toBeLessThanOrEqual(def.size.h);
      for (const m of t.mobs) {
        expect(reg.mobs[m.mob], m.mob).toBeDefined();
        if (m.mob === "old_wallbreaker" || m.mob === "barrow_alpha") continue;
        const lvl = m.level ?? reg.mobs[m.mob]!.level;
        expect(lvl, `${t.id}/${m.mob}`).toBeGreaterThanOrEqual(11);
        // the mustering stones run fallen_soldier at its base 14 — the
        // garrison never stopped marching; the band's top edge touches the
        // capital's bottom edge by design (the merge rule, proposal Part 3)
        expect(lvl, `${t.id}/${m.mob}`).toBeLessThanOrEqual(14);
      }
    }
    for (const id of ["wallbreaker-sledge", "the-barrow"]) {
      const t = def.spawnTables.find((s) => s.id === id)!;
      expect(t.maxAlive, id).toBe(1);
      expect(t.respawnSec, id).toBeGreaterThanOrEqual(600);
    }
    // the fen family lights the lizardman r12 re-anchor rank ON PURPOSE
    const creep = def.spawnTables.find((t) => t.id === "fen-creep")!;
    expect(creep.mobs[0]!.level).toBe(12);
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

describe("sundering_fields gen — the war frozen where it stopped", () => {
  it("is deterministic (grid AND features)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
    expect(JSON.stringify(world.features)).toBe(JSON.stringify(again.features));
  });

  it("no straight line: the direct gate→gate ray hits the mere AND both trench ditches", () => {
    const wl = def.terrain.waterLevel ?? 12;
    // flooded columns on the ray (seed 92001 surveyed: the mere sits on it)
    let wet = 0;
    for (let t = 0; t <= 1; t += 0.005) {
      const z = Math.round(262 + (26 - 262) * t);
      if (world.terrainHeight(def, 144, z) <= wl) wet++;
    }
    expect(wet).toBeGreaterThan(40); // measured ~60/201 pre-authoring
    // both trench crescents ditch the ray where the water misses it: the
    // BUILT surface at x=144 sits ≥2 below natural ground on each line
    const dugOnRay = (z0: number, z1: number): boolean => {
      for (let z = z0; z <= z1; z++) {
        const g = world.terrainHeight(def, 144, z);
        if (!world.solidAt(144, g, z) && !world.solidAt(144, g - 1, z)) return true;
      }
      return false;
    };
    expect(dugOnRay(124, 136), "trench A ditches the ray").toBe(true);
    expect(dugOnRay(84, 96), "trench B ditches the ray").toBe(true);
    // and the road's authored bends sit far off the direct ray
    for (const [bx, bz] of [
      [110, 210],
      [126, 128],
    ] as const) {
      expect(Math.abs(bx - 144), `bend (${bx},${bz}) off the x=144 ray`).toBeGreaterThan(10);
    }
  });

  it("the spawn→arena ray crosses the drowned mere (no straight line to the boss)", () => {
    const wl = def.terrain.waterLevel ?? 12;
    let wet = 0;
    for (let t = 0; t <= 1; t += 0.005) {
      const x = Math.round(def.spawn.x + (92 - def.spawn.x) * t);
      const z = Math.round(def.spawn.z + (190 - def.spawn.z) * t);
      if (world.terrainHeight(def, x, z) <= wl) wet++;
    }
    expect(wet).toBeGreaterThan(15);
  });

  it("digs the trench crescents: firing step south, berm north, duckboard gap on the road", () => {
    // sample trench A mid-line at x=100 (between the [96,126]→[114,124] leg)
    const g = world.terrainHeight(def, 100, 126);
    const dugFloor = (x: number, z: number): number => {
      for (let y = 46; y >= 1; y--) if (world.solidAt(x, y, z)) return y;
      return -1;
    };
    const zc = 126 - Math.round(((100 - 96) / 18) * 2); // interpolated line z ≈ 126
    const mid = dugFloor(100, zc);
    const step = dugFloor(100, zc + 1);
    expect(mid, "the ditch floor sits 2 below natural").toBeLessThanOrEqual(g - 2);
    expect(step, "the firing step sits 1 below natural (the way out southward)").toBe(g - 1);
    // the road crossing keeps original ground, planked
    const gGap = world.terrainHeight(def, 126, 124);
    expect(world.get(126, gGap, 124)).toBe(BLOCK.rotting_planks!.id);
  });

  it("gouges the sledge-furrow arrow-straight to the arena, and wrecks the sledge there", () => {
    // the furrow: 2 deep at a sample column, rubble berms alongside
    const g = world.terrainHeight(def, 92, 60);
    let floor = -1;
    for (let y = 46; y >= 1; y--) {
      if (world.solidAt(92, y, 60)) {
        floor = y;
        break;
      }
    }
    expect(floor).toBeLessThanOrEqual(g - 2);
    // the war-sledge at the furrow's end: charred runners + the empty yoke
    const GA = world.terrainHeight(def, 92, 190);
    expect(world.get(89, GA + 1, 195)).toBe(BLOCK.charred_log!.id);
    expect(world.get(95, GA + 1, 195)).toBe(BLOCK.charred_log!.id);
    expect(world.get(89, GA + 3, 190)).toBe(BLOCK.charred_log!.id); // the yoke beam
    expect(world.get(91, GA + 2, 190)).toBe(BLOCK.chain!.id); // the harness it walked out of
  });

  it("plants the mustering stones and hangs the toll-chains over the road", () => {
    // standards: stone plinth + log post on the muster line
    const gm = world.terrainHeight(def, 132, 70);
    expect(world.get(132, gm, 70)).toBe(BLOCK.stone_bricks!.id);
    expect(world.get(132, gm + 1, 70)).toBe(BLOCK.log!.id);
    // the toll arch: chains still up across the opening
    const gt = world.terrainHeight(def, 144, 40);
    expect(world.get(143, gt + 4, 40)).toBe(BLOCK.chain!.id);
    expect(world.get(144, gt + 3, 40)).toBe(BLOCK.chain!.id);
    // its strongbox cache is hooked to the room's own cache table
    expect(world.features.caches.some((c) => c.table === "cache_sundering_fields" && Math.abs(c.x - 151.5) < 0.1)).toBe(
      true
    );
  });

  it("raises the mass barrow with a den, a nest, and the hounds' hoard", () => {
    const GB = world.terrainHeight(def, 232, 206);
    // the mound rises over natural ground
    expect(world.standY(232.5, 206.5)).toBeGreaterThan(GB + 2);
    // the den chamber is hollow under it (a floor gap at natural height —
    // 232 is open floor; 234 holds the nest hay)
    expect(world.solidAt(232, GB + 1, 206)).toBe(false);
    expect(world.solidAt(232, GB + 2, 206)).toBe(false);
    expect(world.get(234, GB + 1, 206)).toBe(BLOCK.hay!.id);
    // the hoard sits at the chamber's rear
    expect(world.features.caches.some((c) => c.table === "cache_sundering_fields" && Math.abs(c.x - 236.5) < 0.1)).toBe(
      true
    );
  });

  it("lights the corpse-candle trail toward the hidden west road", () => {
    const CANDLE = BLOCK.bog_candle!.id;
    let lit = 0;
    for (let z = 216; z <= 240; z++) {
      for (let x = 40; x <= 110; x++) {
        const g = world.terrainHeight(def, x, z);
        if (world.get(x, g + 1, z) === CANDLE) lit++;
      }
    }
    expect(lit).toBeGreaterThanOrEqual(5);
  });

  it("floor-walks spawn → all four gates, the arena, the barrow den, and the muster line", () => {
    const reach = floorReach(world, def.spawn.x, def.spawn.z);
    const key = (x: number, z: number) => x + z * world.w;
    // gate cells sit ONE off each arch line (the lintel/pillar columns read
    // as walls to the floor BFS — the shipped probe trap), inside the trigger
    expect(reach.has(key(144, 260)), "the fen road gate").toBe(true);
    expect(reach.has(key(41, 236)), "the hidden west gate").toBe(true);
    expect(reach.has(key(144, 29)), "the city gate").toBe(true);
    expect(reach.has(key(261, 117)), "the foundry gate").toBe(true);
    expect(reach.has(key(92, 190)), "the war-sledge arena").toBe(true);
    expect(reach.has(key(234, 206)), "inside the barrow den").toBe(true);
    expect(reach.has(key(151, 71)), "the mustering stones (beside a standard)").toBe(true);
    expect(reach.has(key(120, 56)), "the squatted siege camp").toBe(true);
    expect(reach.has(key(151, 37)), "the toll hut strongbox").toBe(true);
  });
});

describe("the splice — portal pairing on all four edges", () => {
  it("gloomfen's two roads land at their own fields gates, both ways", () => {
    const north = gloomfen.portals.find((p) => p.id === "gloomfen-fields-north")!;
    expect(north.target).toBe("sundering_fields");
    const aN = computePortalArrival(def, "gloomfen", north)!;
    const road = def.portals.find((p) => p.id === "fields-gloomfen-road")!;
    expect(Math.hypot(aN.x - road.x, aN.z - road.z)).toBeLessThanOrEqual(road.r + 1.5);

    const west = gloomfen.portals.find((p) => p.id === "gloomfen-fields-west")!;
    const aW = computePortalArrival(def, "gloomfen", west)!;
    const hidden = def.portals.find((p) => p.id === "fields-gloomfen-west")!;
    expect(Math.hypot(aW.x - hidden.x, aW.z - hidden.z)).toBeLessThanOrEqual(hidden.r + 1.5);

    // and back: each fields gate returns to ITS gloomfen road
    const backN = computePortalArrival(gloomfen, "sundering_fields", road)!;
    expect(Math.hypot(backN.x - 160, backN.z - 30)).toBeLessThan(4);
    const backW = computePortalArrival(gloomfen, "sundering_fields", hidden)!;
    expect(Math.hypot(backW.x - 52, backW.z - 92)).toBeLessThan(4);
  });

  it("the city and foundry edges pair at their twin gates", () => {
    const up = def.portals.find((p) => p.id === "fields-city")!;
    const aCity = computePortalArrival(city, "sundering_fields", up)!;
    expect(Math.hypot(aCity.x - 128, aCity.z - 222.8)).toBeLessThan(0.5);
    const down = city.portals.find((p) => p.id === "city-southgate")!;
    const aBack = computePortalArrival(def, "sundered_city", down)!;
    expect(Math.hypot(aBack.x - 144, aBack.z - 26)).toBeLessThan(4);

    const east = def.portals.find((p) => p.id === "fields-foundry")!;
    const aFdy = computePortalArrival(foundry, "sundering_fields", east)!;
    expect(Math.hypot(aFdy.x - 16, aFdy.z - 80)).toBeLessThan(4);
    const ret = foundry.portals.find((p) => p.id === "foundry-fields")!;
    const aRet = computePortalArrival(def, "foundry", ret)!;
    expect(Math.hypot(aRet.x - 262, aRet.z - 116)).toBeLessThan(4);
  });

  it("the west road stays an off-road exploration find (far from the tribute road)", () => {
    const hidden = def.portals.find((p) => p.id === "fields-gloomfen-west")!;
    // nearest tribute-road waypoint is the mere-shore bend at (110,210)
    expect(Math.hypot(hidden.x - 110, hidden.z - 210)).toBeGreaterThan(40);
  });
});

describe("Old Wallbreaker — the siege-beast that broke Valdrenn", () => {
  const def14 = reg.mobs["old_wallbreaker"]!;

  it("re-enacts the siege: slam, charge, and the rubble-shock line", () => {
    const kit = resolveMob(def14, undefined, SCALE).attacks.map((a) => a.ability).sort();
    expect(kit).toEqual(["golem_slam", "rubble_shock", "siege_charge"]);
    expect(reg.abilities["rubble_shock"]!.kind).toBe("pillars");
    expect(reg.abilities["siege_charge"]!.kind).toBe("melee");
    expect(reg.abilities["siege_charge"]!.range!).toBeGreaterThan(3.5); // the gap-closer
    // the charge slows: you do not simply walk away from a wall-breaker
    expect(reg.abilities["siege_charge"]!.debuff!.slowPct!).toBeGreaterThan(0);
  });

  it("pays the batch-1 formula (room boss ×8 at L14) at the Furnace Golem's peer weight", () => {
    const r = resolveMob(def14, undefined, SCALE);
    expect(r.xp).toBe(Math.round(8 * (14 + 2 * Math.pow(14, 2.1)))); // 4195
    expect(r.xp).toBe(resolveMob(reg.mobs["cinder_golem_boss"]!, undefined, SCALE).xp); // its L14 peer, on purpose
    expect(r.hp).toBe(1083); // the L14 boss-hp trend point
    expect(def14.leashRadius).toBeLessThanOrEqual(30); // it defends its furrow-end
  });

  it("drops the bounty proof: guaranteed yoke-clasp + T3 rift with a T4 edge", () => {
    const t = reg.loot["wallbreaker_drops"]!;
    expect(t.guaranteed.some((e) => e.item === "wallbreaker_clasp")).toBe(true);
    expect(t.guaranteed.some((e) => e.table === "weapons_rift" && e.minRarity === "rare")).toBe(true);
    expect(t.entries.some((e) => e.table === "weapons_royal")).toBe(true); // the T4 edge
    // the trophy ladder holds: gallstone 75 < clasp 100 < gauntlet 140
    expect(reg.items["wallbreaker_clasp"]!.value).toBeGreaterThan(reg.items["kiln_gallstone"]!.value);
    expect(reg.items["wallbreaker_clasp"]!.value).toBeLessThan(reg.items["osmunds_gauntlet"]!.value);
  });

  it("rallies the dead at half health and dies on the bible's line", () => {
    const rally = def.events.find((e) => e.id === "wallbreaker-rally")!;
    expect(rally.on).toEqual({ kind: "bossHpBelowPct", mob: "old_wallbreaker", pct: 0.5 });
    const wave = rally.actions.find((a) => a.kind === "spawnMobs")!;
    expect(wave).toMatchObject({ mob: "skeleton", level: 13 }); // the leveled event wave
    const falls = def.events.find((e) => e.id === "wallbreaker-falls")!;
    expect(falls.actions.some((a) => a.kind === "announce" && a.text === "Old Wallbreaker is down. Forty years late, the Fields hold.")).toBe(true);
  });
});

describe("the Barrow Alpha — the pack-mother in the mound", () => {
  const alpha = reg.mobs["barrow_alpha"]!;

  it("is a side boss on the ×5 formula, denned, and it calls the pack", () => {
    const r = resolveMob(alpha, undefined, SCALE);
    expect(r.xp).toBe(Math.round(5 * (14 + 2 * Math.pow(13, 2.1)))); // 2254
    expect(r.xp).toBeLessThan(resolveMob(reg.mobs["old_wallbreaker"]!, undefined, SCALE).xp);
    const kit = r.attacks.map((a) => a.ability).sort();
    expect(kit).toEqual(["barrow_howl", "pounce", "wolf_bite"]);
    const howl = reg.abilities["barrow_howl"]!;
    expect(howl.summon!.mob).toBe("gravehound");
    expect(howl.summon!.grantsXp).toBe(false); // the pack is not a vending machine
    expect(howl.summon!.grantsLoot).toBe(false);
    expect(howl.interruptible).toBe(true); // hit her mid-howl and the mound stays quiet
  });

  it("is fast but gives up: the leash caps an unbreakable chase", () => {
    expect(alpha.moveSpeed).toBeGreaterThan(3.5);
    expect(alpha.leashRadius).toBeLessThanOrEqual(44); // the economy invariant's cap
  });
});

describe("the lizardman re-anchor (the fen family joins the fields)", () => {
  it("resolves 383 xp EXACTLY at L12 (the r12 rank re-anchors deep reuse to the curve)", () => {
    const liz = reg.mobs["lizardman"]!;
    expect(resolveMob(liz, 12, SCALE).xp).toBe(383);
    expect(resolveMob(liz, 12, SCALE).name).toBe("Fenblade Lizardman Carrion-Sworn");
    // gloomfen's base-level lizardmen are untouched by the new rank
    expect(resolveMob(liz, undefined, SCALE).xp).toBe(266);
    expect(resolveMob(liz, undefined, SCALE).name).toBe("Fenblade Lizardman");
  });
});
