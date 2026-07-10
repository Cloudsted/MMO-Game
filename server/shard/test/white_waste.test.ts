/**
 * THE WHITE WASTE (W8, world-redesign batch 8) — the endgame room, the
 * snow/ice debut, and THE FIRST TYRANT (deliberately unnamed — owner canon,
 * mysteries register §10.3).
 *
 * Covers: def load (ephemeral cycling-arena shape, cold daylight), PRESET gen
 * determinism, the endgame walk (breach landing → tribute-road → the Rime
 * Wardens' pass, which is BLOCKED except through their arena → the
 * tribute-court → the far door, visible and impassable — register §10.5),
 * the First Tyrant's anchors (hp from Vaelric's group anchor by the
 * 1.14^Δ trend; xp = finale ×12; tops EVERY boss in the game), the wardens'
 * pair economy (miniboss ×4 each, twins tuned as ONE L21 boss health pool,
 * no guaranteed-slot loot on a maxAlive-2 table), the frost-family rank
 * re-anchors (Waste-Shade wraiths, Tithe-Collector revenants — and their
 * shipped lower-room resolves byte-identical), the breach gate in the
 * Broken Court (boots SEALED, opens on the King's death, escape-window
 * pattern), both one-way landings, and the canon guard: nothing in this
 * room's strings names the First Tyrant.
 */
import { describe, expect, it } from "vitest";
import type { CharacterSnapshot, ServerToClient } from "@fantasy-mmo/common";
import { BLOCK, computePortalArrival, gameConstants, loadRoomDef, RegistryService, resolveMob } from "@fantasy-mmo/common";
import { RoomSim } from "../src/sim/room.js";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const SCALE = gameConstants().mobs.scaling;
const def = loadRoomDef("white_waste");
const court = loadRoomDef("broken_court");
const world = new VoxelWorld(def);

const curve = (role: number, L: number): number => Math.round(role * (14 + 2 * Math.pow(L, 2.1)));

/** BFS over walkable floor gaps (same helper family as broken_court.test):
 *  solid below, 2 of headroom, step-up ≤ 1, any drop. `refuse` lets a test
 *  carve regions OUT of the walkable set (the spatial-gating assert). */
function floorReach(w: VoxelWorld, sx: number, sz: number, refuse?: (x: number, z: number) => boolean): Map<number, number> {
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
      if (refuse && refuse(nx, nz)) continue;
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

describe("white_waste def — the cycling endgame arena", () => {
  it("loads as ephemeral with the stands-until-the-Tyrant-dies lifecycle", () => {
    expect(def.persistence).toBe("ephemeral");
    expect(def.lifecycle).toBeDefined();
    expect(def.lifecycle!.lifetimeSec).toBeUndefined(); // no natural expiry
    expect(def.lifecycle!.downtimeSec).toBe(900); // the reset knob
    expect(def.lifecycle!.warnAtSecLeft).toEqual([30, 10]);
    // cold daylight, off-noon: full skylight for readability (LESSONS —
    // readability > mood) but a raking sun so the snow relief models
    expect(def.fixedTime).toBe(0.36);
    expect(def.npcs).toEqual([]); // nothing lives here that talks
  });

  it("holds ONE Tyrant, the warden pair, and the frost-family band", () => {
    const tyrant = def.spawnTables.find((t) => t.id === "the-first-tyrant")!;
    expect(tyrant.mobs).toEqual([{ mob: "first_tyrant", weight: 1 }]);
    expect(tyrant.maxAlive).toBe(1);
    expect(tyrant.respawnSec).toBeGreaterThan(9000); // once per instance; the cycle resets it
    const wardens = def.spawnTables.find((t) => t.id === "rime-wardens")!;
    expect(wardens.maxAlive).toBe(2);
    expect(wardens.packSize).toEqual([2, 2]); // the two-at-once fight IS the mechanic
    // reused defs never exceed the maxLevelBonus cap (Δ8) — the Collector
    // sits EXACTLY at it
    for (const t of def.spawnTables) {
      for (const m of t.mobs) {
        const base = reg.mobs[m.mob]!.level;
        if (m.level !== undefined) expect(m.level - base, `${t.id}/${m.mob}`).toBeLessThanOrEqual(SCALE.maxLevelBonus);
      }
    }
  });

  it("has ONE portal — the one-way arch home; no portal back to the court", () => {
    expect(def.portals.length).toBe(1);
    const home = def.portals[0]!;
    expect(home.id).toBe("waste-home");
    expect(home.target).toBe("hub");
    expect(home.exitPortalId).toBeUndefined(); // one-way authored landing
    expect(home.exitX).toBeDefined();
    expect(def.portals.some((p) => p.target === "broken_court")).toBe(false); // the court cycles away beneath you
  });
});

describe("white_waste preset gen", () => {
  it("is byte-identical between boots (a preset world)", () => {
    const again = new VoxelWorld(def);
    expect(Buffer.compare(Buffer.from(world.data), Buffer.from(again.data))).toBe(0);
  });

  it("stocks two cache_royal alcoves in the court wings (900 s)", () => {
    const royal = world.features.caches.filter((c) => c.table === "cache_royal");
    expect(royal.length).toBe(2);
    for (const c of royal) expect(c.respawnSec).toBe(900);
    expect(royal.some((c) => c.x < 80)).toBe(true); // one west
    expect(royal.some((c) => c.x > 80)).toBe(true); // one east
  });

  it("wears the Waste's colors: snow underfoot at the landing, ice in the court", () => {
    const under = (x: number, z: number) => world.get(x, world.floorY(x + 0.5, z + 0.5) - 1, z);
    expect(under(80, 148)).toBe(BLOCK.snow!.id); // the arrival shelf
    let ice = 0;
    for (let x = 76; x <= 84; x++) if (under(x, 87) === BLOCK.ice!.id) ice++;
    expect(ice).toBeGreaterThanOrEqual(5); // the wardens' swept arena floor
  });

  it("walks the whole endgame: landing → road → arena → court → dais → wings → home arch", () => {
    const reach = floorReach(world, def.spawn.x, def.spawn.z);
    const key = (x: number, z: number) => x + z * world.w;
    const targets: Array<[string, number, number]> = [
      ["the breach landing (shelf)", 80, 148],
      ["the ramp foot", 80, 130],
      ["the fen-goods pile", 67, 123],
      ["the road's west bend", 58, 108],
      ["the wardens' south door", 74, 94],
      ["the arena floor", 80, 87],
      ["the wardens' north door", 86, 80],
      ["the unpaid pile", 100, 71],
      ["the home arch", 60, 70],
      ["the court processional", 80, 68],
      ["the court floor", 80, 50],
      ["the dais foot", 80, 34],
      ["the west wing cache", 58, 46],
      ["the east wing cache", 102, 46],
      ["behind the dais — the pass continues", 80, 20],
      ["the far door's approach", 80, 12],
    ];
    for (const [label, x, z] of targets) {
      expect(reach.has(key(x, z)), label).toBe(true);
    }
  });

  it("the wardens' pass is BLOCKED except through their arena (spatial gating)", () => {
    // refuse the arena's interior + its two doorways: with the wardens' floor
    // off-limits, NOTHING north of the gate band is reachable
    const A = { cx: 80, cz: 87, rx: 14, rz: 10 };
    const refuse = (x: number, z: number) => {
      const nx = (x - A.cx) / A.rx;
      const nz = (z - A.cz) / A.rz;
      return nx * nx + nz * nz <= 1 || (z >= 76 && z <= 98 && ((x >= 72 && x <= 76) || (x >= 84 && x <= 88)));
    };
    const gated = floorReach(world, def.spawn.x, def.spawn.z, refuse);
    for (let z = 2; z <= 78; z++) {
      for (let x = 2; x < world.w - 2; x++) {
        expect(gated.has(x + z * world.w), `reached (${x},${z}) around the wardens' arena`).toBe(false);
      }
    }
  });

  it("the far door is SHOWN and never opened: a towering ice slab ends the pass", () => {
    const reach = floorReach(world, def.spawn.x, def.spawn.z);
    const key = (x: number, z: number) => x + z * world.w;
    // the approach climbs — you stand IN the notch, above the court floor
    expect(reach.get(key(80, 12))!).toBeGreaterThan(reach.get(key(80, 20))!);
    // nothing beyond the slab is reachable
    for (let x = 2; x < world.w - 2; x++) {
      expect(reach.has(key(x, 4)), `reached (${x},4) past the far door`).toBe(false);
    }
    // and the slab IS ice, full-height — visibly more world, no way to it
    let wall = 0;
    for (let x = 76; x <= 84; x++) {
      let solidRun = 0;
      for (let y = 16; y <= 34; y++) if (world.get(x, y, 9) === BLOCK.ice!.id) solidRun++;
      if (solidRun >= 16) wall++;
    }
    expect(wall).toBeGreaterThanOrEqual(7);
    // cold light leaks from under it (the register keeps the why)
    let glints = 0;
    for (let x = 76; x <= 84; x++) {
      for (let y = 12; y <= 18; y++) {
        for (let z = 9; z <= 12; z++) if (world.get(x, y, z) === BLOCK.blue_crystal!.id) glints++;
      }
    }
    expect(glints).toBeGreaterThanOrEqual(2);
  });
});

describe("THE FIRST TYRANT — the finale, anchored", () => {
  const tyrant = reg.mobs["first_tyrant"]!;

  it("is a TITLE, not a name — in the def and in every room string (register §10.3)", () => {
    expect(tyrant.name).toBe("The First Tyrant");
    // every mention of the tyrant in the room's strings is the title;
    // no string coins a proper name (the canon rule this batch must not break)
    const text = JSON.stringify(def).toLowerCase();
    let i = -1;
    while ((i = text.indexOf("tyrant", i + 1)) >= 0) {
      // "first " in prose, "first-"/"first_" in table/event/mob ids
      expect(["first ", "first-", "first_"]).toContain(text.slice(Math.max(0, i - 6), i));
    }
  });

  it("hp/dmg ride Vaelric's GROUP anchor up the trend; xp is the finale formula", () => {
    const vael = resolveMob(reg.mobs["sundered_king"]!, 19, SCALE);
    expect(tyrant.hp).toBe(Math.round(vael.hp * Math.pow(1.14, 5))); // 4829
    expect(tyrant.damage).toBe(Math.round(vael.damage * Math.pow(1.11, 5))); // 86
    expect(tyrant.xp).toBe(curve(12, 24)); // 19164
  });

  it("tops EVERY boss in the game — this must be the hardest fight there is", () => {
    for (const [id, other] of Object.entries(reg.mobs)) {
      if (id === "first_tyrant") continue;
      const authored = resolveMob(other, undefined, SCALE);
      expect(tyrant.hp, id).toBeGreaterThan(authored.hp);
      expect(tyrant.xp, id).toBeGreaterThan(authored.xp);
    }
    // and specifically over the King at his court level
    const vael = resolveMob(reg.mobs["sundered_king"]!, 19, SCALE);
    expect(tyrant.hp).toBeGreaterThan(vael.hp);
    expect(tyrant.xp).toBeGreaterThan(vael.xp);
  });

  it("controls space: pillars + predictive slowing AoE + a frost cleave", () => {
    const kit = tyrant.attacks!.map((a) => a.ability).sort();
    expect(kit).toEqual(["deep_winter", "rime_cleave", "winters_writ"]);
    expect(reg.abilities["winters_writ"]!.kind).toBe("pillars");
    const dw = reg.abilities["deep_winter"]!;
    expect(dw.kind).toBe("projectile");
    expect(dw.predictive).toBe(true);
    expect(dw.aoeRadius).toBeGreaterThan(0);
    expect(dw.debuff?.slowPct).toBeGreaterThan(0); // a cold court holds you in it
    expect(dw.maxRange).toBeGreaterThanOrEqual(tyrant.attackRange); // projectile covers the kit's reach
  });

  it("its court delivers the tribute LIVING: leveled event waves at 66/33%", () => {
    const r1 = def.events.find((e) => e.id === "first-tyrant-rally-1")!;
    expect(r1.on).toEqual({ kind: "bossHpBelowPct", mob: "first_tyrant", pct: 0.66 });
    const w1 = r1.actions.find((a) => a.kind === "spawnMobs")!;
    expect(w1).toMatchObject({ mob: "frostplate_revenant", count: 2, level: 21 });
    const r2 = def.events.find((e) => e.id === "first-tyrant-rally-2")!;
    const w2 = r2.actions.find((a) => a.kind === "spawnMobs")!;
    expect(w2).toMatchObject({ mob: "wraith", count: 3, level: 20 });
  });

  it("bossDeath → the bible's payoff announce + the 60 s collapse", () => {
    const death = def.events.find((e) => e.on.kind === "bossDeath")!;
    expect(death.on.mob).toBe("first_tyrant");
    expect(death.actions.some((a) => a.kind === "announce" && a.text.includes("THE FIRST TYRANT IS DEAD"))).toBe(true);
    const timer = death.actions.find((a) => a.kind === "setRoomTimer");
    expect(timer && timer.kind === "setRoomTimer" ? timer.sec : 0).toBe(60);
  });

  it("guarantees the mythic + the trophy that tops the bounty ladder", () => {
    const drops = reg.loot["first_tyrant_drops"]!;
    const g = drops.guaranteed!;
    expect(g.some((e) => e.item === "mythic_relic")).toBe(true); // the T5 guarantee
    expect(g.some((e) => e.item === "the_winter_tithe")).toBe(true);
    expect(reg.items["mythic_relic"]!.tier).toBe(5);
    expect(reg.items["the_winter_tithe"]!.value).toBeGreaterThanOrEqual(reg.items["sundered_crown"]!.value);
  });

  it("fires the whole arc live: leveled rallies, then the payoff announce", () => {
    const sim = new RoomSim(def);
    const a = joinRoom(sim, 80, 40);
    const boss = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "first_tyrant")!;
    expect(boss.health!.maxHp).toBe(4829);
    sim.applyDamage(a.session.entity, boss, Math.ceil(boss.health!.maxHp * 0.4));
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("The tribute comes to it"))).toBe(true);
    const wave = [...sim.allEntities()].filter((e) => e.kind === "mob" && e.brain?.mobId === "frostplate_revenant" && e.brain?.spawnerId === "");
    expect(wave.length).toBe(2);
    for (const c of wave) {
      expect(c.brain!.spawnLevel).toBe(21);
    }
    sim.applyDamage(a.session.entity, boss, 999_999);
    expect(boss.combat!.act).toBe("dead");
    expect(a.messages.some((m) => m.t === "chat" && m.text.includes("THE FIRST TYRANT IS DEAD"))).toBe(true);
    // the home portal never seals — the collapse, not a gate, ends the visit
    expect(sim.portalsWire().find((p) => p.id === "waste-home")!.open).toBe(true);
  });
});

describe("the Rime Wardens — the pair IS the fight", () => {
  const warden = reg.mobs["rime_warden"]!;

  it("twins tuned as ONE boss: pair hp ≈ the solo-boss trend at L21", () => {
    const soloTrend = reg.mobs["ser_osmund"]!.hp * Math.pow(1.14, 4); // osmund 1495@17 → L21
    expect(Math.abs(2 * warden.hp - soloTrend)).toBeLessThanOrEqual(2);
  });

  it("pays miniboss ×4 EACH — the pair together earns half the finale, and no single warden approaches it", () => {
    expect(warden.xp).toBe(curve(4, 21)); // 4840
    expect(2 * warden.xp).toBeLessThan(reg.mobs["first_tyrant"]!.xp);
  });

  it("carries NO guaranteed-slot loot (twins on one table must not be a boss-table vending machine)", () => {
    const drops = reg.loot["rime_warden_drops"]!;
    expect(drops.guaranteed ?? []).toEqual([]);
  });

  it("punishes splitting the pair: a kited warden shoots frost", () => {
    const shard = warden.attacks!.find((a) => a.ability === "rime_shard")!;
    expect(shard.minRange).toBeGreaterThan(0);
    expect(reg.abilities["rime_shard"]!.maxRange).toBeGreaterThanOrEqual(warden.attackRange);
  });

  it("boots BOTH wardens live on their post", () => {
    const sim = new RoomSim(def);
    const pair = [...sim.allEntities()].filter((e) => e.kind === "mob" && e.brain?.mobId === "rime_warden");
    expect(pair.length).toBe(2);
    for (const w of pair) expect(w.health!.maxHp).toBe(1262);
  });
});

describe("the frost family — rank re-anchors that leave shipped rooms untouched", () => {
  it("Waste-Shade: the wraith at L20, re-anchored to trash ×1 exactly", () => {
    const r = resolveMob(reg.mobs["wraith"]!, 20, SCALE);
    expect(r.name).toBe("Waste-Shade");
    expect(r.xp).toBe(curve(1, 20)); // 1093
    // the shipped city chapel wraiths (L15) never see the rank
    const city = resolveMob(reg.mobs["wraith"]!, 15, SCALE);
    expect(city.name).toBe("Vault Wraith");
    expect(city.xp).toBe(Math.round(451 * Math.pow(1.17, 2)));
  });

  it("Tithe-Collector: the Revenant at the Δ8 cap, elite ×2 exactly, holding a post", () => {
    const r = resolveMob(reg.mobs["frostplate_revenant"]!, 21, SCALE);
    expect(r.name).toBe("Tithe-Collector");
    expect(r.xp).toBe(curve(2, 21)); // 2420
    expect(r.leashRadius).toBe(26); // it stands a post — the Unbound's 80 leash is overridden
    // the shipped Cinderrift side boss (r15 Unbound) resolves byte-identically
    const unbound = resolveMob(reg.mobs["frostplate_revenant"]!, 15, SCALE);
    expect(unbound.name).toBe("Frostplate Revenant Unbound");
    expect(unbound.hp).toBe(558);
    expect(unbound.leashRadius).toBe(80);
  });

  it("the new trash pays the batch-1 curve at band level", () => {
    expect(reg.mobs["pale_courser"]!.xp).toBe(curve(1, 20));
    expect(reg.mobs["snow_harpy"]!.xp).toBe(curve(1, 21));
  });
});

describe("the breach gate — the Broken Court opens on the King's death", () => {
  it("the court authors the one-way portal into the waste's landing shelf", () => {
    const via = court.portals.find((p) => p.id === "court-waste")!;
    expect(via.target).toBe("white_waste");
    expect(via.exitPortalId).toBeUndefined(); // one-way authored landing
    const a = computePortalArrival(def, "broken_court", via)!;
    expect(Math.hypot(a.x - 80.5, a.z - 148.5)).toBeLessThan(0.5);
    // the landing is the shelf floor under open sky (standY-safe)
    const xi = Math.floor(a.x);
    const zi = Math.floor(a.z);
    let top = -1;
    for (let y = 46; y >= 1; y--) {
      if (world.solidAt(xi, y - 1, zi) && !world.solidAt(xi, y, zi) && !world.solidAt(xi, y + 1, zi)) {
        top = y;
        break;
      }
    }
    expect(top).toBe(15);
  });

  it("the King's death event announces, OPENS the breach, then starts the 60 s window — in that order", () => {
    const death = court.events.find((e) => e.on.kind === "bossDeath" && e.on.mob === "sundered_king")!;
    const kinds = death.actions.map((a) => a.kind);
    expect(kinds.indexOf("announce")).toBeLessThan(kinds.indexOf("openPortal"));
    expect(kinds.indexOf("openPortal")).toBeLessThan(kinds.indexOf("setRoomTimer"));
    const open = death.actions.find((a) => a.kind === "openPortal")!;
    expect(open.kind === "openPortal" ? open.portalId : "").toBe("court-waste");
  });

  it("boots SEALED while the King lives; his death tears it open", () => {
    const sim = new RoomSim(court);
    expect(sim.portalsWire().find((p) => p.id === "court-waste")!.open).toBe(false);
    const a = joinRoom(sim, 48, 30);
    const king = [...sim.allEntities()].find((e) => e.kind === "mob" && e.brain?.mobId === "sundered_king")!;
    sim.applyDamage(a.session.entity, king, 999_999);
    expect(sim.portalsWire().find((p) => p.id === "court-waste")!.open).toBe(true);
  });

  it("the waste's exit lands beside Greywatch's portal-stone (the arches take you home)", () => {
    const hub = loadRoomDef("hub");
    const home = def.portals.find((p) => p.id === "waste-home")!;
    const a = computePortalArrival(hub, "white_waste", home)!;
    expect(Math.hypot(a.x - 64.5, a.z - 80.5)).toBeLessThan(0.5);
    expect(Math.hypot(a.x - hub.spawn.x, a.z - hub.spawn.z)).toBeLessThan(6); // beside the stone, not on it
    // and the plaza floor there is real, walkable, unroofed ground
    const hubWorld = new VoxelWorld(hub);
    const xi = Math.floor(a.x);
    const zi = Math.floor(a.z);
    const fy = hubWorld.floorY(a.x, a.z);
    expect(hubWorld.solidAt(xi, fy - 1, zi)).toBe(true);
    expect(hubWorld.solidAt(xi, fy, zi)).toBe(false);
    expect(hubWorld.solidAt(xi, fy + 1, zi)).toBe(false);
  });
});
