/**
 * THE GREENHOOD RUN (W2, world-redesign batch 3) — owner seed #1: the
 * poacher fort hides a gated portal that opens only over the fort captain's
 * corpse, leading into the company's smuggling warren.
 *
 * Covers: def load (stateful hideout, no lifecycle), PRESET gen determinism,
 * the warren floor-walk (spawn → every chamber, cache and portal; the cap
 * rock stays unreachable), the forest side (fort fixed-anchored at the
 * surveyed shelf, portal INSIDE the palisade yard, the walk goes THROUGH the
 * camp, the climb-out trapdoor mound), the Thrace gate (boots sealed while
 * he lives / opens on his death / reseals on respawn — his 900 s respawnSec
 * is the door-ajar window), portal pairing incl. the one-way climb-out
 * landing, Grole's kit/tuning invariants (batch-1 xp formula, solo-boss hp
 * trend, muster pays no xp/loot), and the bounty-proof loot shape.
 */
import { describe, expect, it } from "vitest";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, computePortalArrival, gameConstants, loadRoomDef, mobAttacks, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { VoxelWorld } from "../src/sim/voxel.js";
import { RoomSim } from "../src/sim/room.js";

const reg = new RegistryService();
const def = loadRoomDef("greenhood_run");
const forest = loadRoomDef("forest");
const world = new VoxelWorld(def);

/** BFS over walkable floor gaps: solid below, 2 of headroom, step-up ≤ 1,
 *  any drop (mirrors client fall rules; same helper as maw.test). */
function floorReach(w: VoxelWorld, sx: number, sz: number): Map<number, number> {
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
  return feet;
}

function makeCharacter(id: string, name: string, x: number, z: number): CharacterSnapshot {
  return { id, name, level: 1, xp: 0, gold: 0, inventory: [], x, y: 0, z, yaw: 0, roles: ["player"] };
}

function joinRoom(sim: RoomSim, x: number, z: number, id = "c1", name = "Probe") {
  const messages: ServerToClient[] = [];
  const session = sim.addPlayer(makeCharacter(id, name, x, z), (m) => messages.push(m));
  return { session, messages };
}

describe("greenhood_run def", () => {
  it("loads as a stateful hideout: no lifecycle, no collapse", () => {
    expect(def.persistence).toBe("stateful");
    expect(def.lifecycle).toBeUndefined(); // a hideout, not an event room
    expect(def.size.w).toBe(96);
  });

  it("bands L4-6 on the poacher family + camp_cur tripwires, boss solitary and slow", () => {
    for (const t of def.spawnTables) {
      for (const m of t.mobs) {
        expect(reg.mobs[m.mob], m.mob).toBeDefined();
        const lvl = m.level ?? reg.mobs[m.mob]!.level;
        expect(lvl, `${t.id}/${m.mob}`).toBeGreaterThanOrEqual(2);
        expect(lvl, `${t.id}/${m.mob}`).toBeLessThanOrEqual(7);
      }
    }
    const grole = def.spawnTables.find((t) => t.id === "grole-vault")!;
    expect(grole.mobs[0]!.mob).toBe("quartermaster_grole");
    expect(grole.maxAlive).toBe(1);
    expect(grole.respawnSec).toBeGreaterThanOrEqual(600); // boss-table economy shape
    const kennels = def.spawnTables.find((t) => t.id === "run-kennels")!;
    expect(kennels.mobs[0]!.mob).toBe("camp_cur"); // the kennel row is the tripwire
  });
});

describe("greenhood_run preset gen", () => {
  it("is byte-identical between boots (a preset warren)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
  });

  it("floor-walks spawn → every chamber, cache and portal; the cap rock holds", () => {
    const reach = floorReach(world, 18, 74); // room spawn, in the entrance shaft
    const key = (x: number, z: number) => x + z * world.w;
    expect(reach.has(key(18, 78)), "entrance portal (shaft center)").toBe(true);
    expect(reach.has(key(34, 68)), "the kennel row").toBe(true);
    expect(reach.has(key(50, 54)), "the bunkroom").toBe(true);
    expect(reach.has(key(47, 38)), "the buried cellar cache").toBe(true);
    expect(reach.has(key(65, 48)), "the bolt-hole stash (past the crawl)").toBe(true);
    expect(reach.has(key(69, 26)), "Grole's tally-vault").toBe(true);
    expect(reach.has(key(76, 21)), "the strongroom cache (through the bars gap)").toBe(true);
    expect(reach.has(key(80, 12)), "the East Door climb-out").toBe(true);
    // the slab holds: undug rock is out of reach
    expect(reach.has(key(10, 10)), "cap rock NW").toBe(false);
    expect(reach.has(key(90, 90)), "cap rock SE").toBe(false);
    // no straight line reaches the vault: the direct ray from the entrance
    // portal to Grole crosses undug rock (bends are load-bearing)
    let solidOnRay = 0;
    for (let t = 0; t <= 1; t += 0.02) {
      const x = Math.round(18 + (69 - 18) * t);
      const z = Math.round(78 + (26 - 78) * t);
      if (!reach.has(key(x, z))) solidOnRay++;
    }
    expect(solidOnRay).toBeGreaterThan(5);
  });

  it("both portal chambers are open-to-sky shafts (paired arrivals land INSIDE)", () => {
    // standY at the ARRIVAL columns must be the shaft floor, not the cap —
    // addPlayer ground-snaps fresh transfers via standY (y=0 sentinel)
    expect(world.standY(18, 74.8)).toBe(12); // greenhood-fort arrival offset
    expect(world.standY(80, 15)).toBe(12); // beside the East Door
    // the tunnels stay roofed: mid-gallery standY reads the cap, floorY the tunnel
    expect(world.floorY(50.5, 54.5)).toBe(12);
    expect(world.standY(50, 54)).toBeGreaterThan(20);
  });

  it("dresses the warren: lanterns lit, iron-bar kennels, the ledger desk, the crest", () => {
    // the Run is LIT — lantern blocks present in the galleries and the vault
    let lanterns = 0;
    for (let z = 8; z < 84; z++) for (let x = 12; x < 86; x++) for (let y = 12; y <= 16; y++) if (world.get(x, y, z) === BLOCK.lantern!.id) lanterns++;
    expect(lanterns).toBeGreaterThanOrEqual(8);
    // kennel pens: iron bars in the kennel row
    let bars = 0;
    for (let z = 64; z <= 72; z++) for (let x = 29; x <= 39; x++) for (let y = 12; y <= 14; y++) if (world.get(x, y, z) === BLOCK.iron_bars!.id) bars++;
    expect(bars).toBeGreaterThanOrEqual(6);
    // the tally-vault is shelved (bookshelves) and floored in planks
    expect(world.get(69, 11, 26)).toBe(BLOCK.planks!.id);
    let shelves = 0;
    for (let z = 20; z <= 32; z++) for (let x = 60; x <= 78; x++) for (let y = 12; y <= 16; y++) if (world.get(x, y, z) === BLOCK.bookshelf!.id) shelves++;
    expect(shelves).toBeGreaterThanOrEqual(20);
    // the buried cellar: pale pre-Dividing stone + the chiseled-off crest
    expect(world.get(44, 11, 41)).toBe(BLOCK.pale_temple_brick!.id);
    expect(world.get(40, 13, 41)).toBe(BLOCK.cracked_bricks!.id); // the missing arms
  });

  it("registers the three stocked caches on the features handle", () => {
    const tables = world.features.caches.map((c) => c.table);
    expect(world.features.caches.length).toBe(3);
    for (const t of tables) expect(t).toBe("cache_greenhood_run");
    expect(reg.loot["cache_greenhood_run"]).toBeDefined();
    // the best stash sits near Grole: the strongroom cache respawns slowest
    const strongroom = world.features.caches.find((c) => c.z < 25)!;
    expect(strongroom.respawnSec).toBe(900);
  });
});

describe("the Greenhood fort (forest side)", () => {
  const fworld = new VoxelWorld(forest);

  it("authors the gated portal INSIDE the palisade yard", () => {
    const p = forest.portals.find((pp) => pp.id === "forest-greenhood")!;
    expect(p).toBeDefined();
    expect(p.target).toBe("greenhood_run");
    expect(p.x).toBe(313);
    expect(p.z).toBe(143);
    expect(p.exitPortalId).toBe("greenhood-fort");
    // the yard's outer perimeter is sealed at head height (palisade ring);
    // the only ways in are the fort's own south gate and the inner gap
    let holes = 0;
    for (let x = 308; x <= 322; x++) if (!fworld.solidAt(x, 14, 138)) holes++;
    for (let z = 139; z <= 147; z++) {
      if (!fworld.solidAt(308, 14, z)) holes++;
      if (!fworld.solidAt(322, 14, z)) holes++;
    }
    expect(holes).toBe(0);
  });

  it("the walk goes THROUGH the camp: south approach → fire ring → inner gap → portal", () => {
    const reach = floorReach(fworld, 315, 165); // on the old hunting road, south of the gate
    const key = (x: number, z: number) => x + z * fworld.w;
    expect(reach.has(key(315, 154)), "the fort fire ring (through the south gate)").toBe(true);
    expect(reach.has(key(316, 148)), "the inner gap (offset east of the gate)").toBe(true);
    expect(reach.has(key(313, 143)), "the portal, inside the yard").toBe(true);
  });

  it("the camp tables moved WITH the fort (bandit-camp, redcap-hall, livestock)", () => {
    for (const id of ["bandit-camp", "redcap-hall", "camp-livestock"]) {
      const t = forest.spawnTables.find((tt) => tt.id === id)!;
      expect(t.region.x, id).toBe(315);
      expect(t.region.z, id).toBe(154);
    }
    // and the scatter entry is gone — no double forts
    expect(forest.prefabs?.some((p) => p.prefab === "bandit_fort")).toBe(false);
  });

  it("the climb-out mound left the forest with batch 4 (it lives in the march now)", () => {
    // batch 4 re-pointed greenhood-out into the Strangler's March and moved
    // the trapdoor-mound dressing with it — the old forest landing is plain
    // terrain again (no rotting-plank trapdoor, no lantern stump)
    expect(fworld.get(168, 15, 118)).not.toBe(BLOCK.rotting_planks!.id);
    expect(fworld.get(164, 16, 116)).not.toBe(BLOCK.lantern!.id);
  });
});

describe("the Thrace gate (bossDeath → openPortal, reseal on respawn)", () => {
  it("wires the fort events: rally at 50%, gate on death", () => {
    const gate = forest.events.find((e) => e.id === "redcap-gate")!;
    expect(gate.on).toEqual({ kind: "bossDeath", mob: "thrace_redcap" });
    expect(gate.actions.some((a) => a.kind === "openPortal" && a.portalId === "forest-greenhood")).toBe(true);
    expect(gate.actions.some((a) => a.kind === "announce" && a.text.includes("the Run is lit"))).toBe(true);
    const rally = forest.events.find((e) => e.id === "redcap-rally")!;
    expect(rally.on).toEqual({ kind: "bossHpBelowPct", mob: "thrace_redcap", pct: 0.5 });
  });

  it("boots the forest with the Run portal sealed behind Thrace; hub/fen gates open", () => {
    const sim = new RoomSim(forest);
    const wire = sim.portalsWire();
    expect(wire.find((p) => p.id === "forest-greenhood")!.open).toBe(false);
    expect(wire.find((p) => p.id === "forest-hub")!.open).toBe(true);
    expect(wire.find((p) => p.id === "forest-march")!.open).toBe(true);
  });

  it("opens on Thrace's death and reseals when he respawns (the door-ajar window)", () => {
    const sim = new RoomSim(forest);
    const a = joinRoom(sim, 315, 160);
    const thrace = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "thrace_redcap")!;
    expect(thrace).toBeDefined();
    sim.applyDamage(a.session.entity, thrace, 999_999);
    expect(thrace.combat!.act).toBe("dead");
    expect(sim.portalsWire().find((p) => p.id === "forest-greenhood")!.open).toBe(true);
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("the Run is lit"))).toBe(true);
    // his respawn closes the door again (900s respawnSec = the ajar window)
    sim.spawnMob("thrace_redcap", 315, 154, "redcap-hall");
    expect(sim.portalsWire().find((p) => p.id === "forest-greenhood")!.open).toBe(false);
  });

  it("the redcap-hall table respawns him on the 900s window", () => {
    expect(forest.spawnTables.find((t) => t.id === "redcap-hall")!.respawnSec).toBe(900);
  });
});

describe("portal pairing", () => {
  it("fort portal → run: lands in the entrance shaft beside the return arch", () => {
    const via = forest.portals.find((p) => p.id === "forest-greenhood")!;
    const a = computePortalArrival(def, "forest", via)!;
    expect(Math.hypot(a.x - 18, a.z - 74.8)).toBeLessThan(0.5);
  });

  it("run entrance → forest: lands inside the fort yard", () => {
    const via = def.portals.find((p) => p.id === "greenhood-fort")!;
    const a = computePortalArrival(forest, "greenhood_run", via)!;
    expect(Math.hypot(a.x - 313, a.z - 143)).toBeLessThan(4);
  });

  it("the climb-out is one-way into the MARCH now: lands at the authored mound there", () => {
    // batch 4 re-pointed the East Door: target stranglers_march, authored
    // exitX/exitZ at the chute-mouth mound in the march's west
    const via = def.portals.find((p) => p.id === "greenhood-out")!;
    expect(via.exitPortalId).toBeUndefined();
    expect(via.target).toBe("stranglers_march");
    const march = loadRoomDef("stranglers_march");
    const a = computePortalArrival(march, "greenhood_run", via)!;
    expect(a.x).toBe(28.5);
    expect(a.z).toBe(148.5);
  });
});

describe("Quartermaster Grole — the company's real brains", () => {
  const SCALE = gameConstants().mobs.scaling;
  const grole = reg.mobs["quartermaster_grole"]!;

  it("fights with powder, fuse-lines and the kennels: three ability techs in the kit", () => {
    const kit = mobAttacks(grole).map((a) => reg.ability(a.ability).kind);
    expect(kit).toContain("melee");
    expect(kit).toContain("projectile"); // powder_flask (AoE lob, NOT predictive — strafing beats it)
    expect(kit).toContain("pillars"); // fuse_line marches at you
    expect(kit).toContain("self"); // grole_muster
    const flask = reg.abilities["powder_flask"]!;
    expect(flask.maxRange!).toBeGreaterThanOrEqual(grole.attackRange); // kit invariant
    expect(flask.predictive).toBeFalsy();
  });

  it("musters the kennels without minting xp or loot (interruptible counterplay)", () => {
    const muster = reg.abilities["grole_muster"]!;
    expect(muster.summon?.mob).toBe("camp_cur");
    expect(muster.summon?.grantsXp).toBe(false);
    expect(muster.summon?.grantsLoot).toBe(false);
    expect(muster.interruptible).toBe(true); // hit him mid-snap and the doors stay shut
  });

  it("pays the batch-1 formula (room boss ×8 at L7) on the solo-boss hp trend", () => {
    expect(grole.level).toBe(7); // band-top+1 for L4-6
    expect(grole.xp).toBe(Math.round(8 * (14 + 2 * Math.pow(7, 2.1)))); // 1064
    // solo trend between Thrace (400 @L5) and the Gravelord (596 @L9): 1.14^Δ
    const lo = Math.round(596 / Math.pow(1.14, 2)); // 459
    const hi = Math.round(400 * Math.pow(1.14, 2)); // 520
    expect(grole.hp).toBeGreaterThanOrEqual(lo);
    expect(grole.hp).toBeLessThanOrEqual(hi);
    expect(resolveMob(grole, undefined, SCALE).moveSpeed).toBeLessThan(gameConstants().movement.walkSpeed);
  });

  it("drops the bounty proof: guaranteed ledger page + a rare on a boss table", () => {
    const table = reg.loot[grole.loot]!;
    expect(table.guaranteed?.some((g) => g.item === "greenhood_ledger_page")).toBe(true);
    expect(table.guaranteed?.some((g) => g.table === "weapons_fine" && g.minRarity === "rare")).toBe(true);
    const page = reg.items["greenhood_ledger_page"]!;
    expect(page.kind).toBe("trophy");
    // trophy ladder holds: above Thrace-band pelts, below the L9 event boss proof
    expect(page.value).toBeGreaterThan(reg.items["wolf_pelt"]!.value);
    expect(page.value).toBeLessThan(reg.items["undertide_beak_shard"]!.value);
  });

  it("announces the audit: 50% strongroom line, death pays the fen hint", () => {
    const audit = def.events.find((e) => e.id === "grole-audit")!;
    expect(audit.on).toEqual({ kind: "bossHpBelowPct", mob: "quartermaster_grole", pct: 0.5 });
    const death = def.events.find((e) => e.id === "grole-ledger")!;
    expect(death.on).toEqual({ kind: "bossDeath", mob: "quartermaster_grole" });
    expect(death.actions.some((a) => a.kind === "announce" && a.text.includes("a payment won't arrive"))).toBe(true);
    // stateful hideout: no collapse timer on any event
    for (const e of def.events) for (const a of e.actions) expect(a.kind).not.toBe("setRoomTimer");
  });
});
