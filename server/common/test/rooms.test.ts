import { describe, it, expect } from "vitest";
import { computePortalArrival, loadRoomDef, RoomDefSchema, type RoomDef } from "../src/rooms.js";

/** Minimal valid room def for synthetic pairing cases. */
function makeDef(id: string, spawn: { x: number; z: number }, portals: unknown[]): RoomDef {
  return RoomDefSchema.parse({
    id,
    name: id,
    type: "wilderness",
    biome: "grass",
    persistence: "stateful",
    size: { w: 64, h: 64 },
    spawn: { x: spawn.x, z: spawn.z, yaw: 0 },
    terrain: { kind: "blocks", seed: 1, base: 10, amplitude: 1, frequency: 0.05 },
    flags: { safeZone: false, buildingEnabled: false, pvp: false },
    portals,
    spawnTables: [],
    npcs: [],
  });
}

describe("computePortalArrival", () => {
  it("pairs the real hub->forest portals: arrival offset toward spawn, facing away", () => {
    const hub = loadRoomDef("hub");
    const forest = loadRoomDef("forest");
    const via = hub.portals.find((p) => p.id === "hub-forest")!;
    const arrival = computePortalArrival(forest, "hub", via)!;
    // 480² retune: paired portal forest-hub at (240,472) r2.2; spawn (240,466) is due -Z
    expect(arrival.x).toBeCloseTo(240);
    expect(arrival.z).toBeCloseTo(472 - (2.2 + 1.0));
    expect(arrival.yaw).toBeCloseTo(Math.atan2(0, -1)); // facing -Z, away from the portal
  });

  it("pairs the return trip: forest->hub lands at the hub's forest portal", () => {
    const hub = loadRoomDef("hub");
    const forest = loadRoomDef("forest");
    const via = forest.portals.find((p) => p.id === "forest-hub")!;
    const arrival = computePortalArrival(hub, "forest", via)!;
    // hub-forest at (64,99); hub spawn (64,64) is due -Z of it
    expect(arrival.x).toBeCloseTo(64);
    expect(arrival.z).toBeCloseTo(99 - 3.2);
    expect(arrival.yaw).toBeCloseTo(Math.PI);
  });

  it("uses the authored exitX/exitZ override when present", () => {
    const target = makeDef("b", { x: 32, z: 32 }, [
      { id: "b-a", label: "A", target: "a", x: 10, z: 10, r: 2, exitX: 14, exitZ: 10 },
    ]);
    const via = makeDef("a", { x: 32, z: 32 }, [
      { id: "a-b", label: "B", target: "b", x: 5, z: 5, r: 2 },
    ]).portals[0]!;
    const arrival = computePortalArrival(target, "a", via)!;
    expect(arrival.x).toBe(14);
    expect(arrival.z).toBe(10);
    expect(arrival.yaw).toBeCloseTo(Math.atan2(4, 0)); // faces from the portal toward the exit point (+X)
  });

  it("honors an explicit exitPortalId pairing over the target scan", () => {
    const target = makeDef("b", { x: 32, z: 32 }, [
      { id: "b-a-north", label: "A", target: "a", x: 10, z: 10, r: 2 },
      { id: "b-a-south", label: "A", target: "a", x: 50, z: 50, r: 2 },
    ]);
    const via = makeDef("a", { x: 32, z: 32 }, [
      { id: "a-b", label: "B", target: "b", x: 5, z: 5, r: 2, exitPortalId: "b-a-south" },
    ]).portals[0]!;
    const arrival = computePortalArrival(target, "a", via)!;
    // offset from (50,50) toward spawn (32,32), not from the first-matching portal
    expect(arrival.x).toBeLessThan(50);
    expect(arrival.z).toBeLessThan(50);
    expect(Math.hypot(arrival.x - 50, arrival.z - 50)).toBeCloseTo(3.0);
  });

  it("returns null when the target has no portal back to the source", () => {
    const target = makeDef("b", { x: 32, z: 32 }, [
      { id: "b-c", label: "C", target: "c", x: 10, z: 10, r: 2 },
    ]);
    const via = makeDef("a", { x: 32, z: 32 }, [
      { id: "a-b", label: "B", target: "b", x: 5, z: 5, r: 2 },
    ]).portals[0]!;
    expect(computePortalArrival(target, "a", via)).toBeNull();
  });

  it("falls back to +Z when the portal sits exactly on the spawn (degenerate direction)", () => {
    const target = makeDef("b", { x: 10, z: 10 }, [
      { id: "b-a", label: "A", target: "a", x: 10, z: 10, r: 2 },
    ]);
    const via = makeDef("a", { x: 0, z: 0 }, [
      { id: "a-b", label: "B", target: "b", x: 5, z: 5, r: 2 },
    ]).portals[0]!;
    const arrival = computePortalArrival(target, "a", via)!;
    expect(arrival.x).toBeCloseTo(10);
    expect(arrival.z).toBeCloseTo(13.0); // +Z offset
    expect(arrival.yaw).toBeCloseTo(0); // the one yaw convention: 0 faces +Z
  });
});
