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

  it("accepts a swim climb-out over deep water (no rubber-band), but not flying over dry land", () => {
    // Buoyancy caps a swimmer's feet ~0.4 below the surface, so climbing onto a
    // bank means rising ABOVE the surface while still over the pond — where
    // `ground` is the distant floor. handleMove must permit that ascent while
    // there's liquid below the feet, or the climb-out rubber-bands (bug the
    // owner hit in the fen: "you jitter and can only go back down").
    const MURK = BLOCK.murk_water!.id;
    const STONE = BLOCK.stone!.id;
    const w = sim.world;
    // carve a 3-deep pond at (30,30): floor y9, murk 10..12, surface at 13;
    // and a bank ONE block above the water at (31,30): solid to y13, top 14.
    for (let y = 1; y < 20; y++) w.set(30, y, 30, y <= 9 ? STONE : y <= 12 ? MURK : 0);
    for (let y = 1; y < 20; y++) w.set(31, y, 30, y <= 13 ? STONE : 0);

    const a = join("swim", "Swimmer", 30, 30);
    let seq = 0;
    const mv = (x: number, y: number, z: number) => sim.handleMove(a.session, ++seq, x, y, z, 0, "move");
    // float up to the surface over the pond (each hop small + still in water)
    for (let y = a.session.entity.pos.y; y <= 12.6; y += 0.4) mv(30.5, y, 30.5);
    // THE CLIMB: rise above the surface, still over the pond. Must not reject.
    for (let y = 12.6; y <= 14.6; y += 0.3) mv(30.5, y, 30.5);
    expect(a.session.entity.pos.y, "should have risen out of the water, not rubber-banded").toBeGreaterThan(14);
    // step forward onto the one-block-high bank (hops under moveTolerance)
    for (let f = 0.3; f <= 1.0; f += 0.3) mv(30.5 + f, 14, 30.5);
    expect(a.session.entity.pos.x, "should be standing on the bank").toBeGreaterThan(30.9);

    // the exemption is bounded to liquid-below: flying that high over DRY land
    // (no water beneath) is still rejected.
    const c = join("cheat", "Cheater", 40, 40);
    sim.handleMove(c.session, 1, 40, feetY(40, 40) + 5, 40, 0, "move");
    expect(c.last("correct")).toBeDefined();
  });

  it("rejects moving into the city wall but allows the gate", () => {
    // Greywatch: south-west wall at z=94 (x 26..46; the bow-shoulder tower
    // occupies 45..47, so probe at 40); the Hunters' Gate opens the bow
    // front at z=104, x 60..68
    const a = join("c1", "Alice", 40, 93.5);
    sim.handleMove(a.session, 1, 40, feetY(40, 93.5), 94.0, 0, "move");
    expect(a.last("correct")).toBeDefined(); // AABB clips the wall blocks

    const b = join("c2", "Bob", 64, 103.7);
    sim.handleMove(b.session, 1, 64, feetY(64, 104.2), 104.2, 0, "move");
    expect(b.last("correct")).toBeUndefined(); // straight through the gate
  });

  it("keeps far players out of interest, with enter on approach", () => {
    // Alice outside the Hunters' Gate, Bob on the back lane: 69m apart,
    // interest radius 64 — the walk north through the gate brings her into
    // range along the vegetation-cleared gate road.
    const a = join("c1", "Alice", 64, 105);
    const b = join("c2", "Bob", 64, 36);
    expect(b.last("welcome")!.ents.filter((e) => e.kind === "player")).toHaveLength(0);
    sim.snapshot();
    expect(b.last("snap")).toBeUndefined();

    // walk Alice into range via many legal steps (validation stays on)
    let seq = 0;
    for (let z = 104.5; z >= 94; z -= 0.5) {
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
    const a = join("c1", "Alice", 64, 80.5); // on the plaza; forest arch at (50,81)
    expect(sim.validatePortalUse(a.session, "hub-forest")).toBeNull(); // too far
    expect(sim.validatePortalUse(a.session, "nope")).toBeNull(); // unknown id
    // walk legally west across the plaza to the arch ring
    let seq = 0;
    for (let x = 63.5; x >= 51.5; x -= 0.5) {
      sim.handleMove(a.session, ++seq, x, feetY(x, 80.5), 80.5, 0, "move");
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
    expect(sim.world.get(45, 13, 94)).toBe(bricks); // south-west wall
    expect(sim.world.get(50, 13, 104)).toBe(bricks); // the bow front around the arches
    expect(sim.world.solidAt(64, 13, 104)).toBe(false); // the Hunters' Gate gap
    expect(sim.world.solidAt(64, 13, 94)).toBe(false); // the bow interior is open ground
    expect(sim.world.solidAt(64, 13, 80)).toBe(false); // the plaza inside
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

  it("keeps generated trees off every NPC standing column", () => {
    // regression: a generated tree at (77,54) used to canopy over the
    // arcanist at (76,52), lifting her spawn onto the treetop
    for (const npc of sim.def.npcs) {
      const feet = sim.world.terrainHeight(sim.def, Math.floor(npc.x), Math.floor(npc.z)) + 1;
      expect(sim.world.standY(npc.x, npc.z)).toBe(feet);
    }
  });
});

describe("hub-bound transfers (respawn away from home + H key)", () => {
  function makeClient(sim: RoomSim, id: string, name: string, x: number, z: number): TestClient {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, x, z), (m) => messages.push(m));
    return { session, messages, last: (t) => [...messages].reverse().find((m) => m.t === t) as never };
  }

  function kill(sim: RoomSim, c: TestClient): void {
    sim.applyDamage(c.session.entity, c.session.entity, 99999);
    expect(c.session.entity.combat!.act).toBe("dead");
  }

  it("respawn in a non-hub room requests a hub transfer instead of a local snap", () => {
    const sim = new RoomSim(loadRoomDef("forest"));
    const requests: Array<{ id: string; target: string }> = [];
    sim.onTransferRequest = (s, target) => requests.push({ id: s.character.id, target });
    const a = makeClient(sim, "c1", "Alice", 80, 146);
    kill(sim, a);
    const deathPos = { ...a.session.entity.pos };
    const corrections = a.messages.filter((m) => m.t === "correct").length;
    sim.handleRespawn(a.session);
    expect(requests).toEqual([{ id: "c1", target: "hub" }]);
    // no local snap: still dead at the death spot, no correction sent —
    // the hub's addPlayer revives at full hp when the transfer lands
    expect(a.session.entity.combat!.act).toBe("dead");
    expect(a.session.entity.pos.x).toBe(deathPos.x);
    expect(a.messages.filter((m) => m.t === "correct").length).toBe(corrections);
  });

  it("respawn in the hub keeps the local spawn snap + full heal", () => {
    const sim = new RoomSim(loadRoomDef("hub"));
    const requests: string[] = [];
    sim.onTransferRequest = (_s, target) => requests.push(target);
    const a = makeClient(sim, "c1", "Alice", 64, 64);
    kill(sim, a);
    sim.handleRespawn(a.session);
    expect(requests).toHaveLength(0);
    expect(a.session.entity.combat!.act).toBe("idle");
    expect(a.session.entity.health!.hp).toBe(a.session.entity.health!.maxHp);
    expect(a.session.entity.pos.x).toBe(sim.def.spawn.x);
    expect(a.last("correct")).toBeDefined();
  });

  it("returnToHub transfers from a wild room, no-ops when dead, chats in the hub", () => {
    const forest = new RoomSim(loadRoomDef("forest"));
    const requests: string[] = [];
    forest.onTransferRequest = (_s, target) => requests.push(target);
    const a = makeClient(forest, "c1", "Alice", 80, 146);
    forest.handleReturnToHub(a.session);
    expect(requests).toEqual(["hub"]);

    kill(forest, a);
    forest.handleReturnToHub(a.session);
    expect(requests).toEqual(["hub"]); // dead: ignored

    const hub = new RoomSim(loadRoomDef("hub"));
    const hubRequests: string[] = [];
    hub.onTransferRequest = (_s, target) => hubRequests.push(target);
    const b = makeClient(hub, "c2", "Bob", 64, 64);
    hub.handleReturnToHub(b.session);
    expect(hubRequests).toHaveLength(0);
    const chatMsg = b.last("chat");
    expect(chatMsg?.channel).toBe("system");
    expect(chatMsg?.text).toContain("already in the hub");
  });
});
