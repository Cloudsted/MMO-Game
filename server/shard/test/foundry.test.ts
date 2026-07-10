/**
 * THE FOUNDRY (E5, world-redesign batch 7) — the Emberwrights' works: the
 * L14-16 preset interior where the east branch tops out, the reconnect
 * junction (rift ⚿ in, fields + city breach out), and the room that tells
 * the campaign's quietest secret in silhouettes: the assembly line ascends
 * small → large down the long hall and ends in a throne-sized frame, empty.
 * The Unfinished King (forge_prototype ELEVATED to L17 by spawn-table
 * override + boss rank) stands in front of it.
 *
 * Covers: def load (stateful preset dungeon, no lifecycle), gen determinism,
 * the S-bent route (walk/euclid ≥ 1.3 through the offset crosswalls), BFS
 * walkability from all three gates to the King + both caches, the tableau
 * dressing (the frame with no head, the iced tribute crates beside the
 * gold-fitted held-back dock, live lava channels), portal pairing on all
 * three edges, the SEALED rift gate (opens on the Furnace Golem's death,
 * reseals on his respawn — his 900 s cycle is the door-ajar window), the
 * King's rank math (name/loot/hp/xp overrides that never leak to the
 * cinderrift's base-level prototypes), and the economy invariants.
 */
import { describe, expect, it } from "vitest";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, computePortalArrival, gameConstants, loadRoomDef, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { RoomSim } from "../src/sim/room.js";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const SCALE = gameConstants().mobs.scaling;
const def = loadRoomDef("foundry");
const cinderrift = loadRoomDef("cinderrift");
const fields = loadRoomDef("sundering_fields");
const city = loadRoomDef("sundered_city");
const world = new VoxelWorld(def);

/** BFS over walkable floor gaps, tracking step counts (for the bend ratio). */
function floorSteps(w: VoxelWorld, sx: number, sz: number): Map<number, number> {
  const key = (x: number, z: number) => x + z * w.w;
  const feet = new Map<number, number>();
  const steps = new Map<number, number>();
  const start = w.floorY(sx + 0.5, sz + 0.5);
  feet.set(key(sx, sz), start);
  steps.set(key(sx, sz), 0);
  const q: Array<[number, number, number]> = [[sx, sz, start]];
  for (let head = 0; head < q.length; head++) {
    const [x, z, fy] = q[head]!;
    const s = steps.get(key(x, z))!;
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
      steps.set(k, s + 1);
      q.push([nx, nz, ny]);
    }
  }
  return steps;
}

function joinRoom(sim: RoomSim, x: number, z: number) {
  const messages: ServerToClient[] = [];
  const character: CharacterSnapshot = {
    id: `c-${x}-${z}`, name: "Tester", level: 30, xp: 0, gold: 0, inventory: [], x, y: 0, z, yaw: 0, roles: ["player"],
  };
  const session = sim.addPlayer(character, (m) => messages.push(m));
  return { session, messages };
}

describe("foundry def", () => {
  it("loads as a stateful preset interior: no lifecycle, three junction gates", () => {
    expect(def.type).toBe("dungeon");
    expect(def.biome).toBe("ruin"); // preset — the builder owns every block
    expect(def.persistence).toBe("stateful");
    expect(def.lifecycle).toBeUndefined();
    expect(def.size).toEqual({ w: 160, h: 160 });
    expect(def.portals.map((p) => p.target).sort()).toEqual(["cinderrift", "sundered_city", "sundering_fields"]);
    expect(def.npcs).toHaveLength(0); // the workforce doesn't speak — that IS the tableau
  });

  it("bands L14-16 on the trash tables; the King sits solitary and slow at band-top+1", () => {
    for (const t of def.spawnTables) {
      for (const m of t.mobs) {
        expect(reg.mobs[m.mob], m.mob).toBeDefined();
        if (t.id === "the-unfinished-king") continue;
        const lvl = m.level ?? reg.mobs[m.mob]!.level;
        expect(lvl, `${t.id}/${m.mob}`).toBeGreaterThanOrEqual(14);
        expect(lvl, `${t.id}/${m.mob}`).toBeLessThanOrEqual(16);
      }
    }
    const king = def.spawnTables.find((t) => t.id === "the-unfinished-king")!;
    expect(king.mobs[0]!).toMatchObject({ mob: "forge_prototype", level: 17 });
    expect(king.maxAlive).toBe(1);
    expect(king.respawnSec).toBeGreaterThanOrEqual(600);
    // the namesake ranks finally light in their namesake room
    expect(resolveMob(reg.mobs["ember_warplate"]!, 16, SCALE).name).toBe("Ember Warplate Foundry Captain");
    expect(resolveMob(reg.mobs["forge_tender"]!, 16, SCALE).name).toBe("Forge-Tender Foundry Overseer");
  });

  it("spawns every region on dry, walkable ground (≥60% of its columns)", () => {
    for (const t of def.spawnTables) {
      const { x: cx, z: cz, r } = t.region;
      let ok = 0;
      let n = 0;
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
          if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > r) continue;
          if (x < 1 || z < 1 || x >= world.w - 1 || z >= world.h - 1) continue;
          n++;
          const px = x + 0.5;
          const pz = z + 0.5;
          const y = world.floorY(px, pz);
          if (world.liquidAt(px, y + 0.1, pz)) continue;
          if (world.collidesAABB(px, y, pz, 0.3, 1.6)) continue;
          ok++;
        }
      }
      expect((ok / n) * 100, `${t.id} dry-walkable`).toBeGreaterThanOrEqual(60);
    }
  }, 60000);
});

describe("foundry gen — the shift that never stops", () => {
  it("is deterministic (grid AND features)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
    expect(JSON.stringify(world.features)).toBe(JSON.stringify(again.features));
  });

  it("S-bends the route: south gate court → the King walks ≥1.3× the straight line", () => {
    const steps = floorSteps(world, 80, 140);
    const key = (x: number, z: number) => x + z * world.w;
    const walked = steps.get(key(80, 34));
    expect(walked, "the King's arena is reachable").toBeDefined();
    const euclid = Math.hypot(80 - 80, 140 - 34);
    expect(walked! / euclid, `walk ${walked} / euclid ${euclid.toFixed(0)}`).toBeGreaterThanOrEqual(1.3);
  });

  it("floor-walks all three gates to the King and to both caches", () => {
    const key = (x: number, z: number) => x + z * world.w;
    for (const [sx, sz, gate] of [
      [80, 145, "the rift gate court"],
      [18, 80, "the fields gate"],
      [142, 80, "the city-breach gate"],
    ] as const) {
      const steps = floorSteps(world, sx, sz);
      expect(steps.has(key(80, 34)), `${gate} → the King`).toBe(true);
      expect(steps.has(key(120, 60)), `${gate} → the strongroom cache`).toBe(true);
      expect(steps.has(key(36, 55)), `${gate} → the tool locker cache`).toBe(true);
    }
  });

  it("ends the line in a throne-sized frame with NO head, before anvils holding the next one", () => {
    const G = 12;
    const FL = G + 1;
    // legs + torso cage + shoulder beam
    expect(world.get(78, FL + 1, 26)).toBe(BLOCK.dark_bricks!.id);
    expect(world.get(82, FL + 1, 26)).toBe(BLOCK.dark_bricks!.id);
    expect(world.get(78, FL + 3, 26)).toBe(BLOCK.iron_bars!.id);
    expect(world.get(80, FL + 4, 26)).toBe(BLOCK.gold_block!.id); // the heart-socket
    expect(world.get(80, FL + 6, 26)).toBe(BLOCK.charred_log!.id); // the shoulder beam
    expect(world.get(80, FL + 7, 26)).toBe(0); // NO head. That is the point.
    // the anvils behind it: iron ribs under lanterns
    expect(world.get(74, FL + 1, 24)).toBe(BLOCK.iron_bars!.id);
    expect(world.get(74, FL + 4, 24)).toBe(BLOCK.lantern!.id);
  });

  it("stamps the two docks: iced tribute crates beside gold-fitted held-back work", () => {
    const FL = 13;
    let ice = 0;
    let gold = 0;
    for (let z = 56; z <= 104; z++) {
      for (let x = 100; x <= 126; x++) {
        if (world.get(x, FL + 1, z) === BLOCK.ice!.id) ice++;
        if (world.get(x, FL + 1, z) === BLOCK.gold_block!.id) gold++;
      }
    }
    expect(ice, "Revenant rime-stamps on the south dock").toBeGreaterThanOrEqual(4);
    expect(gold, "gold fittings on the held-back dock").toBeGreaterThanOrEqual(2);
  });

  it("runs live lava channels on the casting floor, crossable at cooled obsidian steps", () => {
    const G = 12;
    let lava = 0;
    let obsidian = 0;
    for (const cz of [64, 86]) {
      for (let x = 36; x <= 58; x++) {
        if (world.get(x, G, cz) === BLOCK.lava!.id) lava++;
        if (world.get(x, G, cz) === BLOCK.obsidian!.id) obsidian++;
      }
    }
    expect(lava).toBeGreaterThan(20);
    expect(obsidian).toBeGreaterThanOrEqual(4); // the crossings
  });

  it("wakes the line lane toward the King (lit rune-plates north, dead ones south)", () => {
    expect(world.get(80, 12, 108)).toBe(BLOCK.rune_plate!.id);
    expect(world.get(80, 12, 36)).toBe(BLOCK.rune_plate_lit!.id);
  });
});

describe("the splice — portal pairing on all three edges", () => {
  it("cinderrift ⇄ foundry: the rift gate behind the Forge Ruin pairs both ways", () => {
    const down = cinderrift.portals.find((p) => p.id === "cinderrift-foundry")!;
    expect(down.target).toBe("foundry");
    expect(Math.hypot(down.x - 144, down.z - 34)).toBeLessThan(20); // behind the Forge Ruin (144,34)
    const a = computePortalArrival(def, "cinderrift", down)!;
    const up = def.portals.find((p) => p.id === "foundry-cinderrift")!;
    expect(Math.hypot(a.x - up.x, a.z - up.z)).toBeLessThanOrEqual(up.r + 1.5);
    const back = computePortalArrival(cinderrift, "foundry", up)!;
    expect(Math.hypot(back.x - down.x, back.z - down.z)).toBeLessThanOrEqual(down.r + 1.5);
  });

  it("foundry ⇄ fields and foundry ⇄ city (the breach keeps its authored landing)", () => {
    const west = def.portals.find((p) => p.id === "foundry-fields")!;
    const aF = computePortalArrival(fields, "foundry", west)!;
    expect(Math.hypot(aF.x - 262, aF.z - 116)).toBeLessThan(4);
    const east = def.portals.find((p) => p.id === "foundry-city")!;
    const aC = computePortalArrival(city, "foundry", east)!;
    expect(aC.x).toBe(240); // city-breach exitX/exitZ, preserved
    expect(aC.z).toBe(128);
  });
});

describe("the rift gate — sealed behind the Furnace-King", () => {
  it("wires the event: golem death → the bible's announce + openPortal", () => {
    const gate = cinderrift.events.find((e) => e.id === "furnace-gate")!;
    expect(gate.on).toEqual({ kind: "bossDeath", mob: "cinder_golem_boss" });
    expect(gate.actions.some((a) => a.kind === "openPortal" && a.portalId === "cinderrift-foundry")).toBe(true);
    expect(
      gate.actions.some(
        (a) =>
          a.kind === "announce" &&
          a.text === "The Furnace-King collapses into its own coals. Past the Forge Ruin, the Foundry gate stands open."
      )
    ).toBe(true);
  });

  it("boots sealed while the golem lives; opens on his death; reseals on respawn", () => {
    const sim = new RoomSim(cinderrift);
    const a = joinRoom(sim, 144, 60);
    expect(sim.portalsWire().find((p) => p.id === "cinderrift-foundry")!.open).toBe(false);
    expect(sim.portalsWire().find((p) => p.id === "cinderrift-emberfells")!.open).toBe(true);
    const golem = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "cinder_golem_boss")!;
    expect(golem).toBeDefined();
    sim.applyDamage(a.session.entity, golem, 999_999);
    expect(sim.portalsWire().find((p) => p.id === "cinderrift-foundry")!.open).toBe(true);
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("the Foundry gate stands open"))).toBe(true);
    // his 900 s respawn is the door-ajar window
    sim.spawnMob("cinder_golem_boss", 144, 34, "furnace-arena");
    expect(sim.portalsWire().find((p) => p.id === "cinderrift-foundry")!.open).toBe(false);
  });
});

describe("THE UNFINISHED KING — forge_prototype elevated, nothing leaked", () => {
  const proto = reg.mobs["forge_prototype"]!;

  it("resolves at L17 as a named room boss with its own bounty", () => {
    const king = resolveMob(proto, 17, SCALE);
    expect(king.name).toBe("The Unfinished King"); // the rank's full name override
    expect(king.loot).toBe("unfinished_king_drops"); // the rank's loot override
    expect(king.hp).toBe(1495); // Ser Osmund's L17 peer on the boss-hp trend
    expect(king.damage).toBe(46);
    expect(king.xp).toBe(Math.round(8 * (14 + 2 * Math.pow(17, 2.1)))); // 6251 — room boss ×8
    const kit = king.attacks.map((a) => a.ability).sort();
    expect(kit).toEqual(["foundry_summon", "golem_slam", "slag_lob", "throne_flames"]);
    // waking the dormant frames is a boss-add summon (the lich/oath pattern)
    expect(reg.abilities["foundry_summon"]!.summon!.mob).toBe("forge_ward");
    expect(reg.abilities["foundry_summon"]!.summon!.cap).toBe(3);
  });

  it("the cinderrift's base-level prototypes are untouched by the boss rank", () => {
    const mini = resolveMob(proto, undefined, SCALE);
    expect(mini.name).toBe("Forge Prototype");
    expect(mini.loot).toBe("forge_construct_drops");
    expect(mini.hp).toBe(520);
    expect(mini.xp).toBe(2098);
    // ...and the shipped Rekindled tier keeps its shape below 17
    const rekindled = resolveMob(proto, 16, SCALE);
    expect(rekindled.name).toBe("Forge Prototype Rekindled");
    expect(rekindled.loot).toBe("forge_construct_drops");
    expect(rekindled.attacks.map((a) => a.ability).sort()).toEqual(["golem_slam", "slag_lob", "throne_flames"]);
  });

  it("drops royal-edge loot with the guaranteed sigil, and the trophy ladder holds", () => {
    const t = reg.loot["unfinished_king_drops"]!;
    expect(t.guaranteed.some((e) => e.item === "unfinished_sigil")).toBe(true);
    expect(t.guaranteed.some((e) => e.table === "weapons_royal" && e.minRarity === "rare")).toBe(true);
    // gauntlet 140 < sigil 180 < spiral horn 350
    expect(reg.items["unfinished_sigil"]!.value).toBeGreaterThan(reg.items["osmunds_gauntlet"]!.value);
    expect(reg.items["unfinished_sigil"]!.value).toBeLessThan(reg.items["spiral_horn"]!.value);
  });

  it("rallies the line at half health (a leveled L15 ward wave) and fails on the bible's line", () => {
    const rally = def.events.find((e) => e.id === "king-wakes-line")!;
    expect(rally.on).toEqual({ kind: "bossHpBelowPct", mob: "forge_prototype", pct: 0.5 });
    expect(rally.actions.find((a) => a.kind === "spawnMobs")).toMatchObject({ mob: "forge_ward", level: 15 });
    const fails = def.events.find((e) => e.id === "king-fails")!;
    expect(
      fails.actions.some(
        (a) => a.kind === "announce" && a.text === "The Unfinished King fails. On the anvils behind it: the next one, half-built."
      )
    ).toBe(true);
  });

  it("nothing in the foundry out-earns its King", () => {
    const cap = resolveMob(proto, 17, SCALE).xp;
    for (const t of def.spawnTables) {
      if (t.id === "the-unfinished-king") continue;
      for (const m of t.mobs) {
        const xp = resolveMob(reg.mobs[m.mob]!, m.level, SCALE).xp;
        expect(xp, `${t.id}: ${m.mob}`).toBeLessThan(cap);
      }
    }
  });
});
