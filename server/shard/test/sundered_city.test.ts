/**
 * Valdrenn, the Fallen Capital (sundered_city) — reworked by the BROKEN
 * COURT SPLIT (world-redesign batch 6): the city is STATEFUL now (no
 * lifecycle — the collapse moved to the court with the King), the keep's
 * throne interior is the castle gatehouse where Ser Osmund holds the
 * court gate, and the tables live in the L14-16 band.
 *
 * Covers: def load (stateful, no lifecycle, no dangling king events),
 * PRESET gen determinism, the gatehouse geometry (crosswall + forced
 * portcullis + the court-gate arch under an open roof breach — arrivals
 * ground-snap to the FLOOR), the Osmund gate (boots sealed while he
 * lives / opens on his death / reseals on his 900 s respawn), the
 * L14-16 table band, Osmund's kit/economy anchors, and the tripled
 * portal pairing (the fields + the foundry breach + the court).
 */
import { describe, expect, it } from "vitest";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, computePortalArrival, gameConstants, loadRoomDef, mobAttacks, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { pathfindWaypoints } from "../src/sim/mobs.js";
import { RoomSim } from "../src/sim/room.js";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const SCALE = gameConstants().mobs.scaling;
const def = loadRoomDef("sundered_city");
const court = loadRoomDef("broken_court");
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

function joinRoom(sim: RoomSim, x: number, z: number) {
  const messages: ServerToClient[] = [];
  const character: CharacterSnapshot = {
    id: `c-${x}-${z}`, name: "Tester", level: 30, xp: 0, gold: 0, inventory: [], x, y: 0, z, yaw: 0, roles: ["player"],
  };
  const session = sim.addPlayer(character, (m) => messages.push(m));
  return { session, messages };
}

describe("sundered_city def — the stateful Fallen Capital", () => {
  it("is stateful with no lifecycle (the collapse moved to the Broken Court)", () => {
    expect(def.persistence).toBe("stateful");
    expect(def.lifecycle).toBeUndefined();
    expect(def.name).toBe("Valdrenn, the Fallen Capital");
  });

  it("carries no king events — they moved out with him", () => {
    for (const ev of def.events) {
      expect(ev.on.mob).not.toBe("sundered_king");
      for (const a of ev.actions) expect(a.kind).not.toBe("setRoomTimer"); // no lifecycle to arm
    }
    expect(def.spawnTables.some((t) => t.mobs.some((m) => m.mob === "sundered_king"))).toBe(false);
  });

  it("has zero dangling event refs (what RoomSim would warn about at boot)", () => {
    for (const ev of def.events) {
      expect(reg.mobs[ev.on.mob], `event ${ev.id}: mob ${ev.on.mob}`).toBeDefined();
      for (const a of ev.actions) {
        if (a.kind === "openPortal") expect(def.portals.some((p) => p.id === a.portalId), `event ${ev.id}: portal ${a.portalId}`).toBe(true);
        if (a.kind === "spawnMobs") expect(reg.mobs[a.mob], `event ${ev.id}: wave mob ${a.mob}`).toBeDefined();
      }
    }
  });

  it("keeps spawn tables in bounds with registered mobs, banded L14-16", () => {
    for (const t of def.spawnTables) {
      expect(t.region.x - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.x + t.region.r, t.id).toBeLessThanOrEqual(def.size.w);
      expect(t.region.z - t.region.r, t.id).toBeGreaterThanOrEqual(0);
      expect(t.region.z + t.region.r, t.id).toBeLessThanOrEqual(def.size.h);
      for (const m of t.mobs) {
        expect(reg.mobs[m.mob], `${t.id}: ${m.mob}`).toBeDefined();
        const lvl = m.level ?? reg.mobs[m.mob]!.level;
        // band L14-16; the two 17s are the bosses' band-top+1 (Osmund, the Riderless)
        const cap = m.mob === "ser_osmund" || m.mob === "cinder_nightmare" ? 17 : 16;
        expect(lvl, `${t.id}: ${m.mob}@${lvl}`).toBeGreaterThanOrEqual(14);
        expect(lvl, `${t.id}: ${m.mob}@${lvl}`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("registers the city blocks append-only (ids 51-55)", () => {
    expect(BLOCK.cracked_bricks!.id).toBe(51);
    expect(BLOCK.rubble!.id).toBe(52);
    expect(BLOCK.red_carpet!.id).toBe(53);
    expect(BLOCK.gold_block!.id).toBe(54);
    expect(BLOCK.stained_glass!.id).toBe(55);
  });
});

describe("sundered_city preset gen — the court gate rework", () => {
  it("is byte-identical between boots (a preset world)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
  });

  it("keeps ONE cache_royal (the chapel) — the treasury moved to the court", () => {
    const royal = world.features.caches.filter((c) => c.table === "cache_royal");
    expect(royal.length).toBe(1);
    expect(Math.hypot(royal[0]!.x - 179.5, royal[0]!.z - 109.5)).toBeLessThan(1);
    expect(reg.loot["cache_royal"]).toBeDefined();
  });

  it("floor-walks from spawn to the gatehouse, Osmund's post, the court gate, chapel, camp, and both border gates", () => {
    const reach = floorReach(world, 128, 218);
    const key = (x: number, z: number) => x + z * world.w;
    const targets: Array<[string, number, number]> = [
      ["south portal", 128, 226],
      ["gatehouse", 128, 208],
      ["castle gatehouse", 128, 88],
      ["keep door", 128, 72],
      ["inner gate passage", 128, 53],
      ["Osmund's post", 128, 48],
      ["court portal cell", 128, 43],
      ["chapel cache", 179, 109],
      ["marauder camp", 70, 178],
      ["east breach portal", 244, 128],
    ];
    for (const [label, x, z] of targets) {
      expect(reach.has(key(x, z)), label).toBe(true);
    }
  });

  it("tore the roof over the court gate: arrivals ground-snap to the FLOOR, not the keep cap", () => {
    // the court→city paired arrival lands at (128, 45.2); its TOP walkable
    // gap must be the interior floor (a roofed portal chamber puts paired
    // arrivals on the cap — the greenhood open-shaft rule)
    const a = computePortalArrival(def, "broken_court", court.portals.find((p) => p.id === "court-city")!)!;
    expect(Math.hypot(a.x - 128, a.z - 45.2)).toBeLessThan(0.5);
    const xi = Math.floor(a.x);
    const zi = Math.floor(a.z);
    let topGap = -1;
    for (let y = 46; y >= 1; y--) {
      if (world.solidAt(xi, y - 1, zi) && !world.solidAt(xi, y, zi) && !world.solidAt(xi, y + 1, zi)) {
        topGap = y;
        break;
      }
    }
    expect(topGap).toBe(17); // plinth interior feet level = the floor
  });

  it("built the gatehouse: crosswall, forced portcullis, no throne, the mountain glimpse", () => {
    // the inner gate crosswall is solid marble beside the passage
    expect(world.get(120, 20, 53)).toBe(BLOCK.marble!.id);
    // the portcullis at the passage mouth: outer columns barred, center bent open
    expect(world.get(126, 17, 52)).toBe(BLOCK.iron_bars!.id);
    expect(world.get(128, 17, 52)).toBe(0);
    expect(world.get(128, 20, 52)).toBe(BLOCK.iron_bars!.id);
    // the gold throne is GONE from the city (it moved to the Broken Court)
    expect(world.get(128, 20, 40)).toBe(0);
    // the mountain the Tyrant came down rises behind the castle, wearing the
    // Waste's colors in its notch (the breach glimpse, two rooms early)
    const notchTop = (() => {
      for (let y = 47; y >= 1; y--) if (world.solidAt(128, y, 8)) return y;
      return -1;
    })();
    expect(notchTop).toBeGreaterThanOrEqual(24);
    const cap = world.get(128, notchTop, 8);
    expect([BLOCK.snow!.id, BLOCK.ice!.id]).toContain(cap);
  });

  it("walkYNear picks the interior gap, not the keep roof (login-inside fix)", () => {
    // hall column south of the crosswall: gaps at feet 17 (interior) and 30 (roof top)
    expect(world.walkYNear(128.5, 62.5, 17)).toBe(17);
    expect(world.walkYNear(128.5, 62.5, 30)).toBe(30);
    // outdoors: single gap = the ground, whatever the ref
    expect(world.walkYNear(128.5, 150.5, 13)).toBe(13);
    expect(world.walkYNear(128.5, 150.5, 40)).toBe(13);
  });

  it("kept the plinth terracing and city ground (preset heights)", () => {
    expect(world.floorY(128.5, 218.5)).toBe(13); // city ground feet
    expect(world.floorY(128.5, 80.5)).toBe(17); // courtyard feet (plinth +4)
    expect(world.floorY(128.5, 56.5)).toBe(17); // keep interior floor
  });

  it("pathfinds through the gate passage (mobs can walk the gatehouse)", () => {
    const path = pathfindWaypoints(world, { x: 128.5, y: 18, z: 46.5 }, { x: 128, z: 60 }, false);
    expect(path).not.toBeNull();
    const end = path![path!.length - 1]!;
    expect(Math.hypot(end.x - 128, end.z - 60)).toBeLessThan(3);
  });
});

describe("Ser Osmund, the Gatekeeper — the city's ruling power", () => {
  const osmund = reg.mobs["ser_osmund"]!;

  it("anchors the batch-1 formula: room boss ×8 at L17, on the solo hp trend", () => {
    expect(osmund.level).toBe(17);
    expect(osmund.xp).toBe(Math.round(8 * (14 + 2 * Math.pow(17, 2.1)))); // 6251
    // solo-boss hp trend: 1.14^Δ from Morvane (1150 @ L15) → ~1495 @ 17
    expect(osmund.hp).toBe(Math.round(reg.mobs["lich_boss"]!.hp * Math.pow(1.14, 2)));
    // under the King in every respect: Osmund is the door, not the finale
    expect(osmund.hp).toBeLessThan(reg.mobs["sundered_king"]!.hp);
    expect(osmund.xp).toBeLessThan(resolveMob(reg.mobs["sundered_king"]!, 19, SCALE).xp);
  });

  it("fights as a pure-melee duelist: blade, slowing bash, gap-closing lunge", () => {
    const kit = mobAttacks(osmund);
    expect(kit.map((a) => a.ability).sort()).toEqual(["iron_bash", "pounce", "sentinel_blade"]);
    for (const a of kit) expect(reg.abilities[a.ability]!.kind).toBe("melee");
    // iron_bash slows — the gatekeeper's answer to kiting inside his hall
    expect(reg.abilities["iron_bash"]!.debuff?.slowPct).toBeGreaterThan(0);
    // he holds his post: short aggro, gatehouse-sized leash, slower than the player
    expect(osmund.aggroRadius).toBeLessThanOrEqual(10);
    expect(osmund.leashRadius).toBeLessThanOrEqual(26);
    expect(osmund.moveSpeed).toBeLessThan(gameConstants().movement.walkSpeed);
  });

  it("sits on a solitary 900 s table — the respawn IS the door-ajar window", () => {
    const t = def.spawnTables.find((tt) => tt.id === "gate-osmund")!;
    expect(t.mobs).toEqual([{ mob: "ser_osmund", weight: 1 }]);
    expect(t.maxAlive).toBe(1);
    expect(t.packSize).toEqual([1, 1]);
    expect(t.respawnSec).toBe(900);
    // his post is inside the keep, north of the portcullis, before the gate
    expect(Math.hypot(t.region.x - 128, t.region.z - 48)).toBeLessThan(1);
  });

  it("drops the bounty proof: guaranteed osmunds_gauntlet + a rare royal weapon", () => {
    const table = reg.loot[osmund.loot]!;
    expect(table.guaranteed?.some((g) => g.item === "osmunds_gauntlet")).toBe(true);
    expect(table.guaranteed?.some((g) => g.table === "weapons_royal" && g.minRarity === "rare")).toBe(true);
    const trophy = reg.items["osmunds_gauntlet"]!;
    expect(trophy.kind).toBe("trophy");
    // the trophy ladder: L11 kiln gallstone < Osmund < Aelthir's horn < the crown
    expect(trophy.value).toBeGreaterThan(reg.items["kiln_gallstone"]!.value);
    expect(trophy.value).toBeLessThan(reg.items["spiral_horn"]!.value);
  });

  it("out-earns everything else in his city", () => {
    for (const t of def.spawnTables) {
      for (const m of t.mobs) {
        if (m.mob === "ser_osmund") continue;
        const xp = resolveMob(reg.mobs[m.mob]!, m.level, SCALE).xp;
        expect(xp, `${t.id}: ${m.mob}`).toBeLessThan(osmund.xp);
      }
    }
  });
});

describe("the court gate — sealed behind Osmund", () => {
  it("wires the events: 50% stand announce, death → announce + openPortal", () => {
    const stand = def.events.find((e) => e.id === "osmund-stand")!;
    expect(stand.on).toEqual({ kind: "bossHpBelowPct", mob: "ser_osmund", pct: 0.5 });
    const gate = def.events.find((e) => e.id === "osmund-gate")!;
    expect(gate.on).toEqual({ kind: "bossDeath", mob: "ser_osmund" });
    expect(gate.actions.some((a) => a.kind === "openPortal" && a.portalId === "city-court")).toBe(true);
    expect(gate.actions.some((a) => a.kind === "announce" && a.text.includes("released at last"))).toBe(true);
  });

  it("boots the city with the court gate sealed; the border gates open", () => {
    const sim = new RoomSim(def);
    const wire = sim.portalsWire();
    expect(wire.find((p) => p.id === "city-court")!.open).toBe(false);
    expect(wire.find((p) => p.id === "city-southgate")!.open).toBe(true);
    expect(wire.find((p) => p.id === "city-breach")!.open).toBe(true);
  });

  it("opens on Osmund's death and reseals when he respawns (the door-ajar window)", () => {
    const sim = new RoomSim(def);
    const a = joinRoom(sim, 128, 60);
    const osmund = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "ser_osmund")!;
    expect(osmund).toBeDefined();
    sim.applyDamage(a.session.entity, osmund, 999_999);
    expect(osmund.combat!.act).toBe("dead");
    expect(sim.portalsWire().find((p) => p.id === "city-court")!.open).toBe(true);
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("released at last"))).toBe(true);
    // his respawn shuts the king's door again
    sim.spawnMob("ser_osmund", 128, 48, "gate-osmund");
    expect(sim.portalsWire().find((p) => p.id === "city-court")!.open).toBe(false);
  });
});

describe("portal pairing — the fields, the foundry breach, and the court", () => {
  // batch 7 re-pointed the city's border gates: the south gate now opens on
  // the Sundering Fields (the gloomfen edge moved south a room) and the east
  // breach carries the Foundry road. The exitX/exitZ convention on the breach
  // is PRESERVED — arrivals into the city still land at (240,128).
  const fields = loadRoomDef("sundering_fields");
  const foundry = loadRoomDef("foundry");

  it("routes the fields' road to the south gate, both ways", () => {
    const up = fields.portals.find((p) => p.id === "fields-city")!;
    const aCity = computePortalArrival(def, "sundering_fields", up)!;
    expect(Math.hypot(aCity.x - 128, aCity.z - 222.8)).toBeLessThan(0.5);
    const south = def.portals.find((p) => p.id === "city-southgate")!;
    expect(south.target).toBe("sundering_fields");
    const aFields = computePortalArrival(fields, "sundered_city", south)!;
    expect(Math.hypot(aFields.x - 144, aFields.z - 26)).toBeLessThan(4); // beside fields-city
  });

  it("routes the foundry road through the east breach with the authored landing", () => {
    const up = foundry.portals.find((p) => p.id === "foundry-city")!;
    const aCity = computePortalArrival(def, "foundry", up)!;
    expect(aCity.x).toBe(240); // the breach's authored exitX/exitZ, kept
    expect(aCity.z).toBe(128);
    const breach = def.portals.find((p) => p.id === "city-breach")!;
    expect(breach.target).toBe("foundry");
    const aFdy = computePortalArrival(foundry, "sundered_city", breach)!;
    expect(Math.hypot(aFdy.x - 144, aFdy.z - 80)).toBeLessThan(4); // beside foundry-city
  });

  it("routes the court gate to the court's forecourt, both ways at the gatehouses", () => {
    const down = def.portals.find((p) => p.id === "city-court")!;
    const aCourt = computePortalArrival(court, "sundered_city", down)!;
    expect(Math.hypot(aCourt.x - 48, aCourt.z - 84.8)).toBeLessThan(0.5);
    const up = court.portals.find((p) => p.id === "court-city")!;
    const aCity = computePortalArrival(def, "broken_court", up)!;
    expect(Math.hypot(aCity.x - 128, aCity.z - 45.2)).toBeLessThan(0.5);
  });

  it("nothing in the city pairs back to crypt_depths (the escape gate is one-way)", () => {
    expect(def.portals.some((p) => p.target === "crypt_depths")).toBe(false);
  });
});
