import { describe, it, expect, beforeEach } from "vitest";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, loadRoomDef } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";

function makeCharacter(id: string, name: string, x = 64, z = 64): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory: [], x, y: 0, z, yaw: 0, roles: ["player"] };
}

interface TestClient {
  session: PlayerSession;
  messages: ServerToClient[];
  last<T extends ServerToClient["t"]>(t: T): Extract<ServerToClient, { t: T }> | undefined;
}

describe("RoomSim", () => {
  let sim: RoomSim;

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("hub"));
  });

  /** Feet Y standing on the voxel ground at (x,z). */
  const feetY = (x: number, z: number) => sim.world.standY(x, z);

  function join(id: string, name: string, x = 64, z = 64): TestClient {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, x, z), (m) => messages.push(m));
    return {
      session,
      messages,
      last: (t) => [...messages].reverse().find((m) => m.t === t) as never,
    };
  }

  it("welcomes players with existing entities in interest", () => {
    const a = join("c1", "Alice");
    const b = join("c2", "Bob");
    // the hub carries NPCs now — assert on the player subset
    const playersA = a.last("welcome")!.ents.filter((e) => e.kind === "player");
    const playersB = b.last("welcome")!.ents.filter((e) => e.kind === "player");
    expect(playersA).toHaveLength(0);
    expect(playersB).toHaveLength(1);
    expect(playersB[0]!.name).toBe("Alice");
  });

  it("ships the whole voxel world after welcome", () => {
    const a = join("c1", "Alice");
    const world = a.last("world")!;
    expect(world.w).toBe(sim.def.size.w);
    expect(world.height).toBeGreaterThan(0);
    const received = a.messages
      .filter((m): m is Extract<ServerToClient, { t: "chunks" }> => m.t === "chunks")
      .reduce((n, m) => n + m.batch.length, 0);
    expect(received).toBe(world.chunks);
  });

  it("accepts a legal ground move and replicates it as a delta", () => {
    const a = join("c1", "Alice");
    const b = join("c2", "Bob");
    sim.handleMove(a.session, 1, 64.3, feetY(64.3, 64), 64, 1.2, "move");
    expect(a.last("correct")).toBeUndefined();
    sim.snapshot();
    const snap = b.last("snap")!;
    expect(snap.ents).toHaveLength(1);
    expect(snap.ents[0]!.x).toBeCloseTo(64.3);
    expect(snap.ents[0]!.anim).toBe("move");
  });

  it("rejects a teleport-speed move with a correction", () => {
    const a = join("c1", "Alice");
    sim.handleMove(a.session, 1, 110, feetY(110, 64), 64, 0, "move");
    const correct = a.last("correct")!;
    expect(correct).toBeDefined();
    expect(correct.x).toBe(64);
  });

  it("rejects out-of-bounds, flying, and underground moves", () => {
    const a = join("c1", "Alice");
    sim.handleMove(a.session, 1, -5, 13, 64, 0, "move");
    expect(a.last("correct")).toBeDefined();
    let before = a.messages.length;
    sim.handleMove(a.session, 2, 64, feetY(64, 64) + 50, 64, 0, "move");
    expect(a.messages.length).toBeGreaterThan(before); // flying
    before = a.messages.length;
    sim.handleMove(a.session, 3, 64, feetY(64, 64) - 2, 64, 0, "move");
    expect(a.messages.length).toBeGreaterThan(before); // underground
  });

  it("ignores stale sequence numbers", () => {
    const a = join("c1", "Alice");
    sim.handleMove(a.session, 5, 64.3, feetY(64.3, 64), 64, 0, "move");
    sim.handleMove(a.session, 4, 999, 0, 999, 0, "move"); // stale: silently dropped
    expect(a.last("correct")).toBeUndefined();
  });

  it("rejects moving into the city wall but allows the gate", () => {
    // south wall along z=94 (blocks span z 94..95); the gate spans x 60..68
    const a = join("c1", "Alice", 45, 93.5);
    sim.handleMove(a.session, 1, 45, feetY(45, 93.5), 94.0, 0, "move");
    expect(a.last("correct")).toBeDefined(); // AABB clips the wall blocks

    const b = join("c2", "Bob", 64, 93.7);
    sim.handleMove(b.session, 1, 64, feetY(64, 94.2), 94.2, 0, "move");
    expect(b.last("correct")).toBeUndefined(); // straight through the gate
  });

  it("keeps far players out of interest, with enter on approach", () => {
    // Alice at the portal apron, Bob at the north road end: 65.5m apart,
    // interest radius 64 — the walk north brings her into range along the
    // vegetation-cleared gate road.
    const a = join("c1", "Alice", 64, 99.5);
    const b = join("c2", "Bob", 64, 34);
    expect(b.last("welcome")!.ents.filter((e) => e.kind === "player")).toHaveLength(0);
    sim.snapshot();
    expect(b.last("snap")).toBeUndefined();

    // walk Alice into range via many legal steps (validation stays on)
    let seq = 0;
    for (let z = 99; z >= 90; z -= 0.5) {
      sim.handleMove(a.session, ++seq, 64, feetY(64, z), z, 0, "move");
      const start = Date.now();
      while (Date.now() - start < 1) { /* spin 1ms — sim dt uses wall time */ }
    }
    expect(a.last("correct")).toBeUndefined();
    sim.snapshot();
    const snap = b.last("snap");
    expect(snap?.enter.some((e) => e.name === "Alice")).toBe(true);
  });

  it("sends nothing when nothing changed", () => {
    const a = join("c1", "Alice");
    const b = join("c2", "Bob");
    sim.snapshot();
    const countA = a.messages.length;
    const countB = b.messages.length;
    sim.snapshot();
    expect(a.messages.length).toBe(countA);
    expect(b.messages.length).toBe(countB);
  });

  it("evicts the old session on duplicate character login", () => {
    const a1 = join("c1", "Alice");
    const a2 = join("c1", "Alice");
    expect(a1.last("evict")).toBeDefined();
    expect(sim.playerCount()).toBe(1);
    expect(a2.last("welcome")).toBeDefined();
  });

  it("reports character state for persistence", () => {
    const a = join("c1", "Alice");
    sim.handleMove(a.session, 1, 64.4, feetY(64.4, 64.2), 64.2, 0.7, "move");
    const report = sim.buildReport();
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ id: "c1", roomId: "hub", x: 64.4, z: 64.2 });
  });

  it("generates a deterministic world (same seed → identical blocks)", () => {
    const again = new RoomSim(loadRoomDef("hub"));
    expect(Buffer.from(again.world.data).equals(Buffer.from(sim.world.data))).toBe(true);
  });

  it("welcomes players snapped onto the voxel ground", () => {
    const a = join("c1", "Alice");
    const w = a.last("welcome")!;
    expect(w.spawn.y).toBeCloseTo(sim.world.standY(w.spawn.x, w.spawn.z));
  });

  it("validates portal use by proximity", () => {
    const a = join("c1", "Alice"); // hub spawn (64,64); portal hub-forest at (64,99)
    expect(sim.validatePortalUse(a.session, "hub-forest")).toBeNull(); // too far
    expect(sim.validatePortalUse(a.session, "nope")).toBeNull(); // unknown id
    // walk legally down the plaza road, through the gate, to the portal
    let seq = 0;
    for (let z = 64.5; z <= 98.5; z += 0.5) {
      sim.handleMove(a.session, ++seq, 64, feetY(64, z), z, 0, "move");
      const start = Date.now();
      while (Date.now() - start < 1) { /* spin */ }
    }
    expect(a.last("correct")).toBeUndefined();
    const portal = sim.validatePortalUse(a.session, "hub-forest");
    expect(portal?.target).toBe("forest");
  });

  it("resumes the room clock from a snapshot", () => {
    const resumed = new RoomSim(loadRoomDef("hub"), {
      timeOfDay: 0.777,
      savedAt: Date.now(),
      drops: [],
      spawners: {},
      blocks: [],
    });
    expect(Math.abs(resumed.timeOfDay() - 0.777)).toBeLessThan(0.01);
    const state = resumed.buildRoomState();
    expect(Math.abs(state.timeOfDay - 0.777)).toBeLessThan(0.01);
  });

  it("raises solid city walls with a gate gap", () => {
    const bricks = BLOCK.stone_bricks!.id;
    expect(sim.world.get(45, 13, 94)).toBe(bricks); // south wall
    expect(sim.world.solidAt(64, 13, 94)).toBe(false); // the gate gap
    expect(sim.world.solidAt(64, 13, 80)).toBe(false); // the road inside
  });

  it("builds a stone archway at every portal", () => {
    const bricks = BLOCK.stone_bricks!.id;
    for (const p of sim.def.portals) {
      const fl = sim.world.terrainHeight(sim.def, Math.round(p.x), Math.round(p.z)) + 1;
      const alongX = Math.abs(sim.def.spawn.x - p.x) > Math.abs(sim.def.spawn.z - p.z);
      const [dx, dz] = alongX ? [0, 2] : [2, 0];
      expect(sim.world.get(Math.round(p.x) - dx, fl, Math.round(p.z) - dz)).toBe(bricks);
      expect(sim.world.get(Math.round(p.x) + dx, fl, Math.round(p.z) + dz)).toBe(bricks);
    }
  });
});
