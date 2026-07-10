/**
 * Suggested level bands (room def `levelBand` → portal labels) and the
 * boss/miniboss replication flag (mobs.json `boss`, rank-overridable →
 * EntityFull.boss → client nameplates stay visible at range).
 *
 * The band table below IS the proposal's final node table — a room retune
 * that moves a band must move it here deliberately.
 */
import { describe, it, expect } from "vitest";
import { loadRoomDefs, RoomDefSchema } from "../src/rooms.js";
import { EntityFullSchema } from "../src/protocol.js";
import { gameConstants } from "../src/constants.js";
import { RegistryService, resolveMob } from "../src/registry.js";

const SCALING = gameConstants().mobs.scaling;

/** proposal final node table (docs/world-redesign-proposal.md) */
const NODE_BANDS: Record<string, [number, number]> = {
  forest: [1, 4],
  greenhood_run: [4, 6],
  stranglers_march: [5, 7],
  gloomfen: [8, 10],
  sundering_fields: [11, 13],
  sundered_city: [14, 16],
  broken_court: [17, 19],
  white_waste: [20, 24],
  desert: [4, 7],
  maw: [9, 10],
  emberfells: [8, 10],
  cinderrift: [11, 13],
  foundry: [14, 16],
  dungeon: [6, 8],
  ossuary_galleries: [9, 11],
  crypt_depths: [12, 14],
};

describe("room levelBand", () => {
  it("every combat room carries its node-table band", () => {
    const rooms = loadRoomDefs();
    for (const [id, [min, max]] of Object.entries(NODE_BANDS)) {
      expect(rooms.get(id)?.levelBand, `room ${id}`).toEqual({ min, max });
    }
  });

  it("safe rooms (hub/grounds/atelier) carry none", () => {
    const rooms = loadRoomDefs();
    for (const id of ["hub", "grounds", "atelier"]) {
      expect(rooms.get(id)?.levelBand, `room ${id}`).toBeUndefined();
    }
  });

  it("schema rejects an inverted band (max < min)", () => {
    const base = {
      id: "x",
      name: "x",
      type: "wilderness",
      biome: "grass",
      persistence: "stateful",
      size: { w: 64, h: 64 },
      spawn: { x: 32, z: 32, yaw: 0 },
      terrain: { kind: "blocks", seed: 1, base: 10, amplitude: 1, frequency: 0.05 },
      flags: { safeZone: false, buildingEnabled: false, pvp: false },
      portals: [],
      spawnTables: [],
      npcs: [],
    };
    expect(() => RoomDefSchema.parse({ ...base, levelBand: { min: 5, max: 3 } })).toThrow();
    expect(RoomDefSchema.parse({ ...base, levelBand: { min: 3, max: 5 } }).levelBand).toEqual({ min: 3, max: 5 });
    expect(RoomDefSchema.parse(base).levelBand).toBeUndefined();
  });
});

describe("EntityFull boss flag", () => {
  const base = { id: 1, kind: "mob", x: 0, y: 0, z: 0, yaw: 0, anim: "idle" };

  it("accepts boss:true and stays absent-by-default", () => {
    expect(EntityFullSchema.parse({ ...base, boss: true }).boss).toBe(true);
    expect(EntityFullSchema.parse(base).boss).toBeUndefined();
  });

  it("rejects a non-boolean boss", () => {
    expect(() => EntityFullSchema.parse({ ...base, boss: "yes" })).toThrow();
  });
});

describe("resolveMob boss flag", () => {
  const reg = new RegistryService();

  it("def-level bosses resolve boss=true; trash resolves false", () => {
    for (const id of ["thrace_redcap", "minotaur_boss", "sundered_king", "first_tyrant", "rime_warden", "sarquun"]) {
      expect(resolveMob(reg.mobs[id]!, undefined, SCALING).boss, id).toBe(true);
    }
    for (const id of ["slime", "wolf", "bandit", "skeleton", "wraith", "pale_courser"]) {
      expect(resolveMob(reg.mobs[id]!, undefined, SCALING).boss, id).toBe(false);
    }
  });

  it("rank elevation: THE Bone Warden is a boss at L12, not at his L9 dungeon post", () => {
    const def = reg.mobs["bone_warden"]!;
    expect(resolveMob(def, undefined, SCALING).boss).toBe(false);
    expect(resolveMob(def, 12, SCALING).boss).toBe(true);
  });

  it("rank elevation: forge_prototype only becomes a boss as The Unfinished King (L17)", () => {
    const def = reg.mobs["forge_prototype"]!;
    expect(resolveMob(def, undefined, SCALING).boss).toBe(false); // proto-yard L14
    expect(resolveMob(def, 16, SCALING).boss).toBe(false); // Rekindled tier
    const king = resolveMob(def, 17, SCALING);
    expect(king.name).toBe("The Unfinished King");
    expect(king.boss).toBe(true);
  });

  it("rank demotion: the revenant is a side boss Unbound (r15) but an elite Tithe-Collector (r21)", () => {
    const def = reg.mobs["frostplate_revenant"]!;
    expect(resolveMob(def, undefined, SCALING).boss).toBe(false); // base L13
    expect(resolveMob(def, 15, SCALING).boss).toBe(true); // Unbound
    const collector = resolveMob(def, 21, SCALING);
    expect(collector.name).toBe("Tithe-Collector");
    expect(collector.boss).toBe(false); // explicit rank false demotes
  });

  it("the Wrung Shade (pallid_mourner r13) and the Riderless (cinder_nightmare r17) are side bosses", () => {
    expect(resolveMob(reg.mobs["pallid_mourner"]!, 13, SCALING).boss).toBe(true);
    expect(resolveMob(reg.mobs["pallid_mourner"]!, undefined, SCALING).boss).toBe(false);
    expect(resolveMob(reg.mobs["cinder_nightmare"]!, 17, SCALING).boss).toBe(true);
    expect(resolveMob(reg.mobs["cinder_nightmare"]!, undefined, SCALING).boss).toBe(false);
  });
});
