/**
 * MORVANE'S ESCAPE GATE (world-redesign batch 7; story bible §6 N3 / proposal
 * reconnection #3) — the most dramatic door in the game: a torn arch beside
 * the Pale King's dais, roped off by no one alive, that boots SEALED, TEARS
 * open on his death, and drops its travellers one-way into a collapsed
 * postern in Valdrenn's graveyard quarter while the vaults come down behind
 * them. The 60 s window is natural: the same event that opens the gate arms
 * the collapse, and the fresh room boots sealed again.
 *
 * Covers: the one-way wiring (authored exitX/exitZ, no exitPortalId, nothing
 * in the city pairs back), the boot-sealed / opens-on-death / denial arc in
 * a live RoomSim, the collapse re-arm riding the same event, the depths-side
 * torn-arch dressing, the city-side undercroft landing (walkable, dressed,
 * connected to the city), and the announce line verbatim.
 */
import { describe, expect, it } from "vitest";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, computePortalArrival, loadRoomDef } from "@fantasy-mmo/common";
import { RoomSim } from "../src/sim/room.js";
import { VoxelWorld } from "../src/sim/voxel.js";

const depths = loadRoomDef("crypt_depths");
const city = loadRoomDef("sundered_city");
const cityWorld = new VoxelWorld(city);
const depthsWorld = new VoxelWorld(depths);

/** BFS over walkable floor gaps (the shared test helper shape). */
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

function joinRoom(sim: RoomSim, x: number, z: number) {
  const messages: ServerToClient[] = [];
  const character: CharacterSnapshot = {
    id: `c-${x}-${z}`, name: "Runner", level: 30, xp: 0, gold: 0, inventory: [], x, y: 0, z, yaw: 0, roles: ["player"],
  };
  const session = sim.addPlayer(character, (m) => messages.push(m));
  return { session, messages };
}

describe("the wiring — one-way by omission", () => {
  const gate = depths.portals.find((p) => p.id === "depths-escape")!;

  it("authors exitX/exitZ with NO exitPortalId, near the dais, targeting Valdrenn", () => {
    expect(gate.target).toBe("sundered_city");
    expect(gate.exitPortalId).toBeUndefined(); // the one-way branch
    expect(gate.exitX).toBe(210.5);
    expect(gate.exitZ).toBe(110.5);
    // legible from the fight: the arch stands in the frozen vault, off the dais
    expect(Math.hypot(gate.x - 48, gate.z - 16)).toBeLessThan(22);
  });

  it("computePortalArrival takes the one-way branch to the authored landing", () => {
    const a = computePortalArrival(city, "crypt_depths", gate)!;
    expect(a.x).toBe(210.5);
    expect(a.z).toBe(110.5);
  });

  it("nothing in the city pairs back (no return portal, no reverse edge)", () => {
    expect(city.portals.some((p) => p.target === "crypt_depths")).toBe(false);
  });

  it("rides Morvane's death event: announce verbatim, gate open, collapse armed — in that order", () => {
    const ev = depths.events.find((e) => e.id === "morvane-collapse")!;
    expect(ev.on).toEqual({ kind: "bossDeath", mob: "lich_boss" });
    const kinds = ev.actions.map((a) => a.kind);
    expect(kinds).toEqual(["announce", "openPortal", "setRoomTimer"]);
    expect(ev.actions[0]).toMatchObject({
      text: "The Pale King is unmade. The Court forgets its poses — and the far gate TEARS. Sixty seconds. GO.",
    });
    expect(ev.actions[1]).toMatchObject({ portalId: "depths-escape" });
    expect(ev.actions[2]).toMatchObject({ sec: 60 });
  });
});

describe("the arc — sealed, torn open, and gone behind you", () => {
  it("boots sealed while Morvane lives; denies use; opens on his death; re-arms the collapse", () => {
    const sim = new RoomSim(depths);
    const armed: number[] = [];
    sim.onExpireRequest = (sec) => armed.push(sec);
    const a = joinRoom(sim, 48, 40);
    expect(sim.portalsWire().find((p) => p.id === "depths-escape")!.open).toBe(false);
    expect(sim.portalsWire().find((p) => p.id === "depths-ossuary")!.open).toBe(true);
    expect(sim.validatePortalUse(a.session, "depths-escape")).toBeNull(); // sealed = denied

    const lich = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "lich_boss")!;
    sim.applyDamage(a.session.entity, lich, 999_999);
    expect(sim.portalsWire().find((p) => p.id === "depths-escape")!.open).toBe(true);
    expect(armed).toEqual([60]); // the window is the collapse itself
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("the far gate TEARS"))).toBe(true);
    // a fresh boot (the next cycle) is sealed again — no reseal wiring needed
    const fresh = new RoomSim(depths);
    expect(fresh.portalsWire().find((p) => p.id === "depths-escape")!.open).toBe(false);
  });

  it("the torn arch is dressed and REACHABLE from the dais (legible before the fight)", () => {
    const G = depthsWorld.terrainHeight(depths, 48, 86);
    const FL = G + 1;
    // the rope line: chain strung on posts across the approach, hung by nobody
    expect(depthsWorld.get(63, FL, 16)).toBe(BLOCK.chain!.id);
    expect(depthsWorld.get(62, FL, 16)).toBe(BLOCK.dark_bricks!.id);
    // the standing jamb + the fallen one
    expect([BLOCK.cracked_bricks!.id, BLOCK.dark_bricks!.id]).toContain(depthsWorld.get(61, FL, 12));
    expect(depthsWorld.get(70, FL, 11)).toBe(BLOCK.cracked_bricks!.id);
    // walkable from the vault mouth to the gate's trigger radius
    const reach = floorReach(depthsWorld, 48, 32);
    const key = (x: number, z: number) => x + z * depthsWorld.w;
    expect(reach.has(key(66, 14)), "one row off the arch line, inside the trigger").toBe(true);
  });
});

describe("the landing — a collapsed postern in the graveyard quarter", () => {
  it("lands on walkable dressed ground beside the undercroft mouth", () => {
    // the landing cell itself: flat, dry, open to sky (arrivals ground-snap)
    const y = cityWorld.standY(210.5, 110.5);
    expect(y).toBe(13); // G 12 + 1 — the city slab
    expect(cityWorld.collidesAABB(210.5, y, 110.5, 0.3, 1.6)).toBe(false);
    // the mouth: a stair down, choked with rubble two steps in, lit cold
    expect(cityWorld.get(208, 11, 109)).toBe(BLOCK.dark_bricks!.id); // the first step
    expect(cityWorld.get(208, 10, 107)).toBe(BLOCK.rubble!.id); // the collapse floor
    expect(cityWorld.get(208, 12, 106)).toBe(BLOCK.rubble!.id); // the choke — no way back down
    expect(cityWorld.get(208, 11, 107)).toBe(BLOCK.blue_crystal!.id); // the Court's light, under the fall
    // the torn arch stub + what it dropped
    expect(cityWorld.get(206, 15, 109)).not.toBe(0); // the leaning jamb (13+2)
    expect(cityWorld.get(206, 16, 110)).toBe(BLOCK.chain!.id);
  });

  it("connects to the city: the runner can walk from the landing to the south gate", () => {
    const reach = floorReach(cityWorld, 210, 110);
    const key = (x: number, z: number) => x + z * cityWorld.w;
    expect(reach.has(key(187, 150)), "the east lane").toBe(true);
    expect(reach.has(key(128, 218)), "the city spawn outside the south gate").toBe(true);
  });
});
