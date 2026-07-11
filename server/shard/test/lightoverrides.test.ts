/**
 * PER-CELL LIGHT OVERRIDES (owner-feedback wave 3).
 *
 * Builders author per-cell emission overrides (Builder.lightAt /
 * PrefabCtx.lightAt) — deterministic gen output that REPLACES a block's
 * registry light for that one cell when the client seeds its blocklight
 * flood. Lighting itself is client-side; these tests lock the DATA PATH:
 * authoring, clamping, determinism (golden), the edit interaction, and the
 * `world` message wire shape.
 *
 * The desert is the first room to author overrides (the Colossus of Sekhat's
 * tomb — dimmed funeral lamps, the flared ward, invisible fill light in the
 * Vessel Chamber). If you add/change authored overrides, update the GOLDEN
 * constant below the same way goldenhash.test.ts documents: run once, paste
 * the printed hash, explain the delta in the commit.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BLOCK, loadRoomDef, type CharacterSnapshot, type ServerToClient } from "@fantasy-mmo/common";
import { VoxelWorld } from "../src/sim/voxel.js";
import { RoomSim } from "../src/sim/room.js";

/** sha1 over the sorted [x,y,z,level] tuples — the override golden. */
function lightsHash(world: VoxelWorld): string {
  const tuples = [...world.lightOverrides.entries()]
    .map(([k, l]) => [...k.split(",").map(Number), l])
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
  return createHash("sha1").update(JSON.stringify(tuples)).digest("hex");
}

const GOLDEN_DESERT_LIGHTS = "9254070d26b16b1d4de716059ec51d39d6291fde"; // 10 tuples, recorded 2026-07-11

function makeCharacter(id: string, name: string, x: number, z: number): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory: [], x, y: 0, z, yaw: 0, roles: ["player"] };
}

describe("per-cell light overrides", () => {
  const def = loadRoomDef("desert");
  const world = new VoxelWorld(def);

  it("the desert authors the tomb's overrides — deterministic and golden-locked", () => {
    expect(world.lightOverrides.size).toBeGreaterThan(0);
    const again = new VoxelWorld(loadRoomDef("desert"));
    expect([...again.lightOverrides.entries()]).toEqual([...world.lightOverrides.entries()]);
    const got = lightsHash(world);
    if (got !== GOLDEN_DESERT_LIGHTS) {
      // eslint-disable-next-line no-console
      console.log(`desert lights hash: "${got}" (${world.lightOverrides.size} tuples)`);
    }
    expect(got, "desert authored light overrides drifted — intentional? update the golden").toBe(GOLDEN_DESERT_LIGHTS);
  });

  it("the tomb's ward ring is flared to 11 and the fill cells sit on AIR", () => {
    const G = world.terrainHeight(def, 238, 246);
    const Fp = Math.max(2, G - 8); // buildTomb's digFloorY(G, 8)
    // the four rune_plate_lit cells around the inlaid center, base 7 → 11
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const key = `${238 + dx},${Fp - 1},${246 + dz}`;
      expect(world.lightOverrides.get(key), `ward cell ${key}`).toBe(11);
      expect(world.get(238 + dx, Fp - 1, 246 + dz)).toBe(BLOCK.rune_plate_lit!.id);
    }
    // the invisible fill lights are overrides on plain AIR cells
    for (const [x, z] of [[233, 250], [243, 250]] as const) {
      expect(world.lightOverrides.get(`${x},${Fp + 3},${z}`)).toBe(8);
      expect(world.get(x, Fp + 3, z), "fill light must sit on air (no visible source)").toBe(0);
    }
  });

  it("setLightOverride clamps to 0-15 and ignores out-of-bounds", () => {
    const w = new VoxelWorld(loadRoomDef("atelier"));
    w.setLightOverride(10, 10, 10, 99);
    w.setLightOverride(11, 10, 10, -3);
    expect(w.lightOverrides.get("10,10,10")).toBe(15);
    expect(w.lightOverrides.get("11,10,10")).toBe(0);
    const before = w.lightOverrides.size;
    w.setLightOverride(-1, 10, 10, 8);
    w.setLightOverride(10, 999, 10, 8);
    expect(w.lightOverrides.size).toBe(before);
  });

  it("lightsWire skips cells under a live player edit and ships again on revert", () => {
    const all = world.lightsWire();
    expect(all.length).toBe(world.lightOverrides.size);
    const [x, y, z] = all[0]!;
    const genId = world.get(x, y, z);
    world.applyEdit(x, y, z, genId === 0 ? BLOCK.stone!.id : 0, "someone");
    const withEdit = world.lightsWire();
    expect(withEdit.length).toBe(all.length - 1);
    expect(withEdit.find((t) => t[0] === x && t[1] === y && t[2] === z)).toBeUndefined();
    // reverting the edit (back to the generated block) re-ships the override
    world.applyEdit(x, y, z, genId, "someone");
    expect(world.edits.size).toBe(0);
    expect(world.lightsWire().length).toBe(all.length);
  });

  it("the desert's world message carries the lights tuples", () => {
    const sim = new RoomSim(def);
    const messages: ServerToClient[] = [];
    sim.addPlayer(makeCharacter("lc1", "Lumen", def.spawn.x, def.spawn.z), (m) => messages.push(m));
    const worldMsg = messages.find((m) => m.t === "world") as Extract<ServerToClient, { t: "world" }>;
    expect(worldMsg.lights).toBeDefined();
    expect(worldMsg.lights!.length).toBe(sim.world.lightOverrides.size);
    for (const [x, y, z, l] of worldMsg.lights!) {
      expect(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)).toBe(true);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(15);
    }
  });

  it("rooms without authored overrides omit the lights field", () => {
    const hub = loadRoomDef("hub");
    const sim = new RoomSim(hub);
    const messages: ServerToClient[] = [];
    sim.addPlayer(makeCharacter("lc2", "Nolux", hub.spawn.x, hub.spawn.z), (m) => messages.push(m));
    const worldMsg = messages.find((m) => m.t === "world") as Extract<ServerToClient, { t: "world" }>;
    expect(worldMsg.lights).toBeUndefined();
  });
});
