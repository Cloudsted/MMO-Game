/** Admin-dashboard sim surface: telemetry ents, kick, teleport, map render. */
import { describe, it, expect, beforeEach } from "vitest";
import { inflateRawSync } from "node:zlib";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { loadRoomDef } from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "../src/sim/room.js";

function makeCharacter(id: string, name: string, x = 64, z = 64): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory: [], x, y: 0, z, yaw: 0, roles: ["player"] };
}

describe("admin dashboard hooks", () => {
  let sim: RoomSim;

  beforeEach(() => {
    sim = new RoomSim(loadRoomDef("hub"));
  });

  function join(id: string, name: string, x = 64, z = 64) {
    const messages: ServerToClient[] = [];
    const session = sim.addPlayer(makeCharacter(id, name, x, z), (m) => messages.push(m));
    return {
      session,
      messages,
      last: <T extends ServerToClient["t"]>(t: T) =>
        [...messages].reverse().find((m) => m.t === t) as Extract<ServerToClient, { t: T }> | undefined,
    };
  }

  it("adminInfo reports players and non-player entity positions", () => {
    const a = join("c1", "Alice");
    const info = sim.adminInfo();
    expect(info.players).toHaveLength(1);
    expect(info.players[0]!.name).toBe("Alice");
    // the hub carries authored NPCs; they must appear as map ents with names
    expect(info.npcs).toBeGreaterThan(0);
    const npcEnts = (info.ents ?? []).filter((e) => e.k === "npc");
    expect(npcEnts.length).toBe(info.npcs);
    expect(npcEnts[0]!.n).toBeTruthy();
    void a;
  });

  it("adminMove teleports within the room: ground snap + correction", () => {
    const a = join("c1", "Alice");
    const ok = sim.adminMove("c1", "hub", 30, 40);
    expect(ok).toBe(true);
    const pos = a.session.entity.pos;
    expect(pos.x).toBe(30);
    expect(pos.z).toBe(40);
    expect(pos.y).toBe(sim.world.standY(30, 40));
    const correct = a.last("correct")!;
    expect(correct.x).toBe(30);
    expect(correct.z).toBe(40);
  });

  it("adminMove refuses a same-room teleport without coordinates", () => {
    join("c1", "Alice");
    expect(sim.adminMove("c1", "hub")).toBe(false);
  });

  it("adminMove to another room requests a transfer with the arrival", () => {
    const a = join("c1", "Alice");
    let got: { session: PlayerSession; target: string; arrival?: { x: number; z: number } } | null = null;
    sim.onTransferRequest = (session, target, arrival) => {
      got = { session, target, arrival };
    };
    expect(sim.adminMove("c1", "forest", 100, 120)).toBe(true);
    expect(got).not.toBeNull();
    expect(got!.session).toBe(a.session);
    expect(got!.target).toBe("forest");
    expect(got!.arrival).toEqual({ x: 100, z: 120 });
    // without coordinates: default spawn (no arrival)
    got = null;
    expect(sim.adminMove("c1", "forest")).toBe(true);
    expect(got!.arrival).toBeUndefined();
  });

  it("adminMove returns false for unknown characters", () => {
    expect(sim.adminMove("nope", "hub", 10, 10)).toBe(false);
  });

  it("renderTopDown produces a deterministic w×h×3 RGB map", () => {
    const map = sim.world.renderTopDown();
    expect(map.w).toBe(sim.def.size.w);
    expect(map.h).toBe(sim.def.size.h);
    const rgb = inflateRawSync(Buffer.from(map.data, "base64"));
    expect(rgb.length).toBe(map.w * map.h * 3);
    // nothing should be the magenta "unmapped block" sentinel
    let magenta = 0;
    for (let i = 0; i < rgb.length; i += 3) {
      if (rgb[i] === 255 && rgb[i + 1] === 0 && rgb[i + 2] === 255) magenta++;
    }
    expect(magenta).toBe(0);
    // deterministic: a second sim over the same def renders byte-identical
    const again = new RoomSim(loadRoomDef("hub")).world.renderTopDown();
    expect(again.data).toBe(map.data);
  });

  it("adminInfo reports LIVE portal seal state (dashboard world graph)", () => {
    // hub: no gates, every portal open
    const hubPorts = sim.adminInfo().portals!;
    expect(hubPorts.length).toBe(sim.def.portals.length);
    for (const p of hubPorts) expect(p.open, p.id).toBe(true);

    // dungeon: the Gravelord's border-gate boots SEALED while he lives —
    // adminInfo must mirror the same portalOpen() players see
    const dungeon = new RoomSim(loadRoomDef("dungeon"));
    const ports = dungeon.adminInfo().portals!;
    const gate = ports.find((p) => p.id === "dungeon-depths")!;
    expect(gate.open).toBe(false);
    const home = ports.find((p) => p.id === "dungeon-hub")!;
    expect(home.open).toBe(true);
  });
});
