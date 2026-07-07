/**
 * The Sundered City (Valdrenn) — preset war-ruined city + castle finale.
 *
 * Covers: def load + the no-natural-expiry lifecycle shape, PRESET gen
 * determinism (byte-identical rebuilds), the doubled Gloomfen⇄city portal
 * pairing (authored exitPortalId both ways — the first real use), spawn
 * tables in bounds, the new block ids (append-only guard), authored loot
 * caches, and a floor-walk BFS (floorY + headroom — standY can't see under
 * the keep ceiling) proving spawn → throne dais / treasury / chapel / both
 * breaches all connect.
 */
import { describe, expect, it } from "vitest";
import { BLOCK, computePortalArrival, loadRoomDef, RegistryService } from "@fantasy-mmo/common";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const def = loadRoomDef("sundered_city");
const gloomfen = loadRoomDef("gloomfen");
const world = new VoxelWorld(def);

/** BFS over walkable floor gaps: solid below, 2 of headroom, step-up ≤ 1,
 *  any drop (mirrors the client fall rules; interiors need floorY). */
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

describe("sundered_city def", () => {
  it("loads with the always-open-until-event lifecycle", () => {
    expect(def.persistence).toBe("ephemeral");
    expect(def.lifecycle).toBeDefined();
    expect(def.lifecycle!.lifetimeSec).toBeUndefined(); // no natural expiry
    expect(def.lifecycle!.downtimeSec).toBe(300); // the reset knob
    expect(def.lifecycle!.warnAtSecLeft).toEqual([30, 10]);
  });

  it("keeps spawn tables in bounds with registered mobs", () => {
    for (const t of def.spawnTables) {
      expect(t.region.x - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.x + t.region.r, t.id).toBeLessThanOrEqual(def.size.w);
      expect(t.region.z - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.z + t.region.r, t.id).toBeLessThanOrEqual(def.size.h);
      for (const m of t.mobs) expect(reg.mobs[m.mob], `${t.id}: ${m.mob}`).toBeDefined();
    }
  });

  it("registers the new city blocks append-only (ids 51-55)", () => {
    expect(BLOCK.cracked_bricks!.id).toBe(51);
    expect(BLOCK.rubble!.id).toBe(52);
    expect(BLOCK.red_carpet!.id).toBe(53);
    expect(BLOCK.gold_block!.id).toBe(54);
    expect(BLOCK.stained_glass!.id).toBe(55);
  });
});

describe("sundered_city preset gen", () => {
  it("is byte-identical between boots (a preset world)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
  });

  it("authored two cache_royal loot caches (treasury + chapel)", () => {
    const royal = world.features.caches.filter((c) => c.table === "cache_royal");
    expect(royal.length).toBe(2);
    expect(reg.loot["cache_royal"]).toBeDefined();
  });

  it("floor-walks from spawn to the throne dais, treasury, chapel, camp, and both gates", () => {
    const reach = floorReach(world, 128, 218);
    const key = (x: number, z: number) => x + z * world.w;
    const targets: Array<[string, number, number]> = [
      ["south portal", 128, 226],
      ["gatehouse", 128, 208],
      ["castle gatehouse", 128, 88],
      ["keep door", 128, 72],
      ["throne dais", 128, 41],
      ["treasury cache", 102, 41],
      ["chapel cache", 179, 109],
      ["marauder camp", 70, 178],
      ["east breach portal", 244, 128],
    ];
    for (const [label, x, z] of targets) {
      expect(reach.has(key(x, z)), label).toBe(true);
    }
  });

  it("walkYNear picks the interior gap, not the keep roof (login-inside fix)", () => {
    // hall column: gaps at feet 17 (interior) and 30 (roof top)
    expect(world.walkYNear(128.5, 62.5, 17)).toBe(17);
    expect(world.walkYNear(128.5, 62.5, 30)).toBe(30);
    // outdoors: single gap = the ground, whatever the ref
    expect(world.walkYNear(128.5, 150.5, 13)).toBe(13);
    expect(world.walkYNear(128.5, 150.5, 40)).toBe(13);
  });

  it("raised the plinth and kept the city ground flat (preset heights)", () => {
    expect(world.floorY(128.5, 218.5)).toBe(13); // city ground feet
    expect(world.floorY(128.5, 80.5)).toBe(17); // courtyard feet (plinth +4)
    expect(world.floorY(128.5, 56.5)).toBe(17); // great hall floor
    // throne is gold on the dais
    expect(world.get(128, 20, 40)).toBe(BLOCK.gold_block!.id);
  });
});

describe("gloomfen ⇄ sundered_city portal pairing (authored exitPortalId)", () => {
  it("routes each gloomfen road to its own city gate", () => {
    const north = gloomfen.portals.find((p) => p.id === "gloomfen-city-north")!;
    const west = gloomfen.portals.find((p) => p.id === "gloomfen-city-west")!;
    const aN = computePortalArrival(def, "gloomfen", north)!;
    // south gate portal (128,226) offsets toward the room spawn (128,218)
    expect(Math.hypot(aN.x - 128, aN.z - 222.8)).toBeLessThan(0.5);
    const aW = computePortalArrival(def, "gloomfen", west)!;
    // breach portal authors exitX/exitZ = (240,128), facing the breach (-x)
    expect(aW.x).toBe(240);
    expect(aW.z).toBe(128);
    expect(Math.abs(aW.yaw - Math.atan2(-1, 0))).toBeLessThan(1e-6);
  });

  it("routes each city gate back to its own gloomfen road", () => {
    const south = def.portals.find((p) => p.id === "city-southgate")!;
    const breach = def.portals.find((p) => p.id === "city-breach")!;
    const aS = computePortalArrival(gloomfen, "sundered_city", south)!;
    expect(Math.hypot(aS.x - 160, aS.z - 30)).toBeLessThan(4); // the north road
    const aB = computePortalArrival(gloomfen, "sundered_city", breach)!;
    expect(Math.hypot(aB.x - 52, aB.z - 92)).toBeLessThan(4); // the west road
  });
});
