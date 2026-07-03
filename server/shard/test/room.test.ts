import { describe, it, expect, beforeEach } from "vitest";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { loadRoomDef } from "@fantasy-mmo/common";
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
    const welcomeA = a.last("welcome")!;
    const welcomeB = b.last("welcome")!;
    expect(welcomeA.ents).toHaveLength(0);
    expect(welcomeB.ents).toHaveLength(1);
    expect(welcomeB.ents[0]!.name).toBe("Alice");
  });

  it("accepts a legal terrain-following move and replicates it as a delta", () => {
    const a = join("c1", "Alice");
    const b = join("c2", "Bob");
    const y = sim.terrain.heightAt(64.3, 64);
    sim.handleMove(a.session, 1, 64.3, y, 64, 1.2, "move");
    expect(a.last("correct")).toBeUndefined();
    sim.snapshot();
    const snap = b.last("snap")!;
    expect(snap.ents).toHaveLength(1);
    expect(snap.ents[0]!.x).toBeCloseTo(64.3);
    expect(snap.ents[0]!.anim).toBe("move");
  });

  it("rejects a teleport-speed move with a correction", () => {
    const a = join("c1", "Alice");
    sim.handleMove(a.session, 1, 110, sim.terrain.heightAt(110, 64), 64, 0, "move");
    const correct = a.last("correct")!;
    expect(correct).toBeDefined();
    expect(correct.x).toBe(64);
  });

  it("rejects out-of-bounds, flying, and underground moves", () => {
    const a = join("c1", "Alice");
    sim.handleMove(a.session, 1, -5, 0, 64, 0, "move");
    expect(a.last("correct")).toBeDefined();
    let before = a.messages.length;
    sim.handleMove(a.session, 2, 64, sim.terrain.heightAt(64, 64) + 50, 64, 0, "move");
    expect(a.messages.length).toBeGreaterThan(before); // flying
    before = a.messages.length;
    sim.handleMove(a.session, 3, 64, sim.terrain.heightAt(64, 64) - 2, 64, 0, "move");
    expect(a.messages.length).toBeGreaterThan(before); // underground
  });

  it("ignores stale sequence numbers", () => {
    const a = join("c1", "Alice");
    sim.handleMove(a.session, 5, 64.3, sim.terrain.heightAt(64.3, 64), 64, 0, "move");
    sim.handleMove(a.session, 4, 999, 0, 999, 0, "move"); // stale: silently dropped
    expect(a.last("correct")).toBeUndefined();
  });

  it("rejects standing inside a solid prop", () => {
    const a = join("c1", "Alice");
    const prop = sim.terrain.props.find((p) => p.r > 0);
    expect(prop).toBeDefined();
    // teleport the session next to the prop legally by rebuilding at that spot
    const b = join("c9", "Nearby", prop!.x + 1.5, prop!.z);
    const y = sim.terrain.heightAt(prop!.x, prop!.z);
    sim.handleMove(b.session, 1, prop!.x, y, prop!.z, 0, "move");
    expect(b.last("correct")).toBeDefined();
  });

  it("keeps far players out of interest, with enter on approach", () => {
    const a = join("c1", "Alice", 10, 10);
    const b = join("c2", "Bob", 100, 10); // 90m apart, interest radius 64
    expect(b.last("welcome")!.ents).toHaveLength(0);
    sim.snapshot();
    expect(b.last("snap")).toBeUndefined();

    // walk Alice into range via many legal steps (validation stays on:
    // each step must fit inside walkSpeed*dt*grace + tolerance)
    let seq = 0;
    for (let x = 10.5; x <= 40; x += 0.5) {
      sim.handleMove(a.session, ++seq, x, sim.terrain.heightAt(x, 10), 10, 0, "move");
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
    sim.handleMove(a.session, 1, 64.4, sim.terrain.heightAt(64.4, 64.2), 64.2, 0.7, "move");
    const report = sim.buildReport();
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ id: "c1", roomId: "hub", x: 64.4, z: 64.2 });
  });

  it("generates deterministic terrain (same seed → identical world)", () => {
    const again = new RoomSim(loadRoomDef("hub"));
    expect(again.terrain.heights).toEqual(sim.terrain.heights);
    expect(again.terrain.types).toEqual(sim.terrain.types);
    expect(again.terrain.props).toEqual(sim.terrain.props);
  });

  it("welcomes players snapped onto the terrain surface", () => {
    const a = join("c1", "Alice");
    const w = a.last("welcome")!;
    const ground = sim.terrain.heightAt(w.spawn.x, w.spawn.z);
    expect(Math.abs(w.spawn.y - ground)).toBeLessThan(1.6);
  });

  it("validates portal use by proximity", () => {
    const a = join("c1", "Alice"); // hub spawn (64,64); portal hub-forest at (64,99)
    expect(sim.validatePortalUse(a.session, "hub-forest")).toBeNull(); // too far
    expect(sim.validatePortalUse(a.session, "nope")).toBeNull(); // unknown id
    // walk legally to the portal
    let seq = 0;
    for (let z = 64.5; z <= 98.5; z += 0.5) {
      sim.handleMove(a.session, ++seq, 64, sim.terrain.heightAt(64, z), z, 0, "move");
      const start = Date.now();
      while (Date.now() - start < 1) { /* spin */ }
    }
    expect(a.last("correct")).toBeUndefined();
    const portal = sim.validatePortalUse(a.session, "hub-forest");
    expect(portal?.target).toBe("forest");
  });

  it("resumes the room clock from a snapshot", () => {
    const resumed = new RoomSim(loadRoomDef("hub"), { timeOfDay: 0.777, savedAt: Date.now() });
    expect(Math.abs(resumed.timeOfDay() - 0.777)).toBeLessThan(0.01);
    const state = resumed.buildRoomState();
    expect(Math.abs(state.timeOfDay - 0.777)).toBeLessThan(0.01);
  });

  it("rejects walking through city walls", () => {
    // hub south wall runs (30,96)-(61,96); terrain.collides is the check
    expect(sim.terrain.collides(45, 96)).toBe(true);
    expect(sim.terrain.collides(64, 96)).toBe(false); // the gate gap
    expect(sim.terrain.collides(45, 90)).toBe(false); // inside the city
  });

  it("places a portal archway prop at every portal", () => {
    const arches = sim.terrain.props.filter((p) => p.type === "arch");
    expect(arches.length).toBe(sim.def.portals.length);
    const portal = sim.def.portals[0]!;
    expect(arches.some((a) => Math.hypot(a.x - portal.x, a.z - portal.z) < 0.1)).toBe(true);
  });
});
