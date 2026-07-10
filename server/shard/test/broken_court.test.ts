/**
 * THE BROKEN COURT (W7, world-redesign batch 6) — the throne room, and what
 * sits on it. Valdrenn's finale split out of the city into its own 96²
 * cycling arena: straight-to-boss by explicit exception, the court exactly
 * as day ten left it, THE BREACH behind the throne as dressing (its White
 * Waste portal is batch 8's), and Vaelric at L19 — the solo-content peak.
 *
 * Covers: def load (ephemeral, no lifetimeSec, 900 s downtime — the cycling
 * arena shape), PRESET gen determinism, the floor-walk (forecourt →
 * processional → dais / wings / the breach mouth), the King's L19 anchors
 * (hp/xp — the rank re-anchors 1.17^Δ drift to the finale formula), the
 * relocated event arc (muster rallies at 66/33% with L18 waves + the 60 s
 * collapse), pairing both ways with the city, and the live collapse wiring.
 */
import { describe, expect, it } from "vitest";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, computePortalArrival, gameConstants, loadRoomDef, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { pathfindWaypoints } from "../src/sim/mobs.js";
import { RoomSim } from "../src/sim/room.js";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const SCALE = gameConstants().mobs.scaling;
const def = loadRoomDef("broken_court");
const city = loadRoomDef("sundered_city");
const world = new VoxelWorld(def);

/** BFS over walkable floor gaps: solid below, 2 of headroom, step-up ≤ 1,
 *  any drop (mirrors the client fall rules; same helper as sundered_city.test). */
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

function joinRoom(sim: RoomSim, x: number, z: number) {
  const messages: ServerToClient[] = [];
  const character: CharacterSnapshot = {
    id: `c-${x}-${z}`, name: "Tester", level: 30, xp: 0, gold: 0, inventory: [], x, y: 0, z, yaw: 0, roles: ["player"],
  };
  const session = sim.addPlayer(character, (m) => messages.push(m));
  return { session, messages };
}

describe("broken_court def — the cycling finale arena", () => {
  it("loads as ephemeral with the stands-until-the-king-dies lifecycle", () => {
    expect(def.persistence).toBe("ephemeral");
    expect(def.lifecycle).toBeDefined();
    expect(def.lifecycle!.lifetimeSec).toBeUndefined(); // no natural expiry
    expect(def.lifecycle!.downtimeSec).toBe(900); // the reset knob (proposal Part 4)
    expect(def.lifecycle!.warnAtSecLeft).toEqual([30, 10]);
    expect(def.fixedTime).toBe(0.74); // the city's perpetual sunset, kept
  });

  it("holds ONE king and nothing else — no side boss, no trash", () => {
    expect(def.spawnTables.length).toBe(1);
    const t = def.spawnTables[0]!;
    expect(t.mobs).toEqual([{ mob: "sundered_king", weight: 1, level: 19 }]);
    expect(t.maxAlive).toBe(1);
    expect(t.respawnSec).toBeGreaterThan(9000); // once per instance; the cycle resets him
    expect(def.npcs).toEqual([]); // nothing lives here that talks
  });

  it("straight-to-boss is the EXPLICIT arena exception: portal → spawn → throne share the axis", () => {
    const portal = def.portals[0]!;
    expect(portal.x).toBe(def.spawn.x);
    expect(Math.abs(portal.z - def.spawn.z)).toBeLessThan(10);
    const throne = def.spawnTables[0]!.region;
    expect(throne.x).toBe(def.spawn.x); // one processional, no detours
  });
});

describe("broken_court preset gen", () => {
  it("is byte-identical between boots (a preset world)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
  });

  it("moved the treasury cache_royal here (900 s, in the west wing)", () => {
    const royal = world.features.caches.filter((c) => c.table === "cache_royal");
    expect(royal.length).toBe(1);
    expect(royal[0]!.respawnSec).toBe(900);
    expect(Math.hypot(royal[0]!.x - 32.5, royal[0]!.z - 52.5)).toBeLessThan(1);
  });

  it("floor-walks the whole set: forecourt → hall → dais → wings → the breach mouth", () => {
    const reach = floorReach(world, def.spawn.x, def.spawn.z);
    const key = (x: number, z: number) => x + z * world.w;
    const targets: Array<[string, number, number]> = [
      ["return portal", 48, 87],
      ["hall doors", 48, 58],
      ["the set table aisle", 46, 40],
      ["dais foot", 48, 24],
      ["dais top, before the throne", 48, 20],
      ["treasury cache", 32, 52],
      ["barracks", 64, 52],
      ["the breach mouth", 35, 12],
      ["inside the breach", 35, 6],
    ];
    for (const [label, x, z] of targets) {
      expect(reach.has(key(x, z)), label).toBe(true);
    }
    // the breach climbs INTO the mountain and ends at the torn-open portal
    // chamber (batch 8 opened it: the White Waste door lives here now)
    expect(reach.get(key(35, 6))!).toBeGreaterThan(reach.get(key(35, 12))!);
    expect(reach.has(key(35, 4)), "the court-waste portal chamber").toBe(true);
    expect(reach.has(key(35, 0))).toBe(false); // the mountain still walls the room
  });

  it("the breach chamber is open to the SKY (the portal's standY must be its floor)", () => {
    // greenhood rule: a roofed portal chamber strands arrivals/glow on the cap.
    // (The exact portal column sits under its own arch LINTEL — every portal
    // does; sample the chamber cells beside the arch line.)
    for (const [x, z] of [
      [34, 3],
      [36, 5],
      [34, 6],
      [36, 2],
    ] as const) {
      let top = -1;
      for (let y = 46; y >= 1; y--) {
        if (world.solidAt(x, y - 1, z) && !world.solidAt(x, y, z) && !world.solidAt(x, y + 1, z)) {
          top = y;
          break;
        }
      }
      expect(top, `top walkable gap at ${x},${z}`).toBe(16); // the chamber floor, not the massif top
    }
  });

  it("staged the throne room: gold throne, rose window, braziers, the stale dinner", () => {
    expect(world.get(48, 16, 19)).toBe(BLOCK.gold_block!.id); // the seat
    expect(world.get(48, 19, 18)).toBe(BLOCK.gold_block!.id); // the tall back
    expect(world.get(48, 19, 14)).toBe(BLOCK.stained_glass!.id); // the rose window
    expect(world.get(44, 16, 19)).toBe(BLOCK.ember_crystal!.id); // dais braziers, still lit
    // the set table: marble boards, gold candlesticks, a lantern still burning
    expect(world.get(42, 13, 40)).toBe(BLOCK.marble!.id);
    expect(world.get(42, 14, 36)).toBe(BLOCK.gold_block!.id);
    expect(world.get(42, 14, 40)).toBe(BLOCK.lantern!.id);
  });

  it("wears the Waste's colors inside the breach (snow/ice, nowhere else in the room's south)", () => {
    // the torn chamber's floor is dusted white outside the arch's path apron
    // — the first cold in the game's south (batch 8: the apron now paves the
    // portal's own circle, so sample the chamber ring around it)
    let white = 0;
    for (let z = 1; z <= 7; z++) {
      for (let x = 31; x <= 39; x++) {
        if (Math.hypot(x - 35, z - 4) <= 3.2) continue; // the arch apron
        const under = world.floorY(x + 0.5, z + 0.5) - 1;
        const b = world.get(x, under, z);
        if (b === BLOCK.snow!.id || b === BLOCK.ice!.id) white++;
      }
    }
    expect(white).toBeGreaterThanOrEqual(6);
  });

  it("the king can pathfind off his dais and around the set table", () => {
    const path = pathfindWaypoints(world, { x: 48.5, y: 14, z: 26.5 }, { x: 48, z: 52 }, false);
    expect(path).not.toBeNull();
    const end = path![path!.length - 1]!;
    expect(Math.hypot(end.x - 48, end.z - 52)).toBeLessThan(4);
  });
});

describe("Vaelric at L19 — the finale, re-anchored", () => {
  const king = reg.mobs["sundered_king"]!;

  it("resolves the L19 spawn to the finale formula exactly (the rank absorbs the 1.17^Δ drift)", () => {
    const r = resolveMob(king, 19, SCALE);
    expect(r.level).toBe(19);
    expect(r.xp).toBe(Math.round(12 * (14 + 2 * Math.pow(19, 2.1)))); // 11798
    expect(r.hp).toBe(Math.round(king.hp * 1.14)); // 2508
    expect(r.damage).toBe(Math.round(king.damage * 1.11)); // 51
    // the rank changes his WORTH, never his kit or his name
    expect(r.name).toBe("Vaelric, the Sundered King");
    expect(r.attacks.map((a) => a.ability).sort()).toEqual(
      ["crown_strike", "kings_cleave", "oath_summon", "sundering_wave", "throne_flames"]
    );
  });

  it("tops every boss below the Waste — the L19 SOLO-content peak", () => {
    // batch 8: the First Tyrant (L24, explicit GROUP content) now sits above
    // him by design — the proposal is explicit that the King stays the solo
    // peak and the White Waste is group content above him.
    const r = resolveMob(king, 19, SCALE);
    for (const [id, other] of Object.entries(reg.mobs)) {
      if (id === "sundered_king" || id === "first_tyrant") continue;
      const authored = resolveMob(other, undefined, SCALE);
      expect(r.hp, id).toBeGreaterThan(authored.hp);
      expect(r.xp, id).toBeGreaterThan(authored.xp);
    }
    // and specifically over the two gates below him
    expect(r.xp).toBeGreaterThan(reg.mobs["ser_osmund"]!.xp);
    expect(r.xp).toBeGreaterThan(resolveMob(reg.mobs["lich_boss"]!, undefined, SCALE).xp);
  });

  it("wires the relocated event arc: muster rallies at 66/33% with L18 waves", () => {
    const r1 = def.events.find((e) => e.id === "king-rally-1")!;
    expect(r1.on).toEqual({ kind: "bossHpBelowPct", mob: "sundered_king", pct: 0.66 });
    expect(r1.actions.some((a) => a.kind === "announce" && a.text.includes("The court answers"))).toBe(true);
    const w1 = r1.actions.find((a) => a.kind === "spawnMobs")!;
    expect(w1).toMatchObject({ mob: "oathbound_sentinel", count: 2, level: 18 });
    const r2 = def.events.find((e) => e.id === "king-rally-2")!;
    expect(r2.on).toEqual({ kind: "bossHpBelowPct", mob: "sundered_king", pct: 0.33 });
    const w2 = r2.actions.find((a) => a.kind === "spawnMobs")!;
    expect(w2).toMatchObject({ mob: "oathbound_sentinel", count: 3, level: 18 });
    // the waves match the court's band, not the sentinel's base city level
    expect(resolveMob(reg.mobs["oathbound_sentinel"]!, 18, SCALE).hp).toBe(520);
  });

  it("bossDeath → the bible's announce + the 60 s collapse", () => {
    const death = def.events.find((e) => e.on.kind === "bossDeath")!;
    expect(death.on.mob).toBe("sundered_king");
    expect(death.actions.some((a) => a.kind === "announce" && a.text.includes("the mountain is OPEN"))).toBe(true);
    const timer = death.actions.find((a) => a.kind === "setRoomTimer");
    expect(timer && timer.kind === "setRoomTimer" ? timer.sec : 0).toBe(60);
  });

  it("boots the court with the king on his carpet and the way home open", () => {
    const sim = new RoomSim(def);
    const king19 = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "sundered_king")!;
    expect(king19).toBeDefined();
    expect(king19.health!.maxHp).toBe(2508);
    expect(king19.brain!.spawnLevel).toBe(19);
    // the return portal never seals — the collapse, not a gate, ends the visit
    expect(sim.portalsWire().find((p) => p.id === "court-city")!.open).toBe(true);
  });

  it("fires the whole arc live: rallies with L18 sentinels, then the collapse announce", () => {
    const sim = new RoomSim(def);
    const a = joinRoom(sim, 48, 30);
    const king19 = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "sundered_king")!;
    const maxHp = king19.health!.maxHp;
    // 66%: the oath answers
    sim.applyDamage(a.session.entity, king19, Math.ceil(maxHp * 0.4));
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("The court answers"))).toBe(true);
    const wave = [...sim.allEntities()].filter((e) => e.kind === "mob" && e.brain?.mobId === "oathbound_sentinel");
    expect(wave.length).toBe(2);
    for (const s of wave) expect(s.brain!.spawnLevel).toBe(18);
    // the kill: the court falls silent
    sim.applyDamage(a.session.entity, king19, 999_999);
    expect(king19.combat!.act).toBe("dead");
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("the mountain is OPEN"))).toBe(true);
  });
});

describe("portal pairing — the court ⇄ the capital", () => {
  it("city → court lands on the forecourt, open sky over the arrival", () => {
    const via = city.portals.find((p) => p.id === "city-court")!;
    const a = computePortalArrival(def, "sundered_city", via)!;
    expect(Math.hypot(a.x - 48, a.z - 84.8)).toBeLessThan(0.5);
    // top walkable gap at the arrival IS the floor (no roof to strand arrivals on)
    const xi = Math.floor(a.x);
    const zi = Math.floor(a.z);
    let topGap = -1;
    for (let y = 46; y >= 1; y--) {
      if (world.solidAt(xi, y - 1, zi) && !world.solidAt(xi, y, zi) && !world.solidAt(xi, y + 1, zi)) {
        topGap = y;
        break;
      }
    }
    expect(topGap).toBe(13);
  });

  it("court → city lands at the keep gatehouse", () => {
    const via = def.portals.find((p) => p.id === "court-city")!;
    expect(via.exitPortalId).toBe("city-court");
    const a = computePortalArrival(city, "broken_court", via)!;
    expect(Math.hypot(a.x - 128, a.z - 45.2)).toBeLessThan(0.5);
  });
});
