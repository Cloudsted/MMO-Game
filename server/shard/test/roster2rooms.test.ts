/**
 * The roster-2 spawn-table pass: 24 new bestiary mobs placed into six rooms,
 * plus the three new entity-linked room events.
 *
 * This file is the guard rail for four classes of silent data bug that a
 * spawn table can carry and nothing else will catch:
 *
 *  1. OUT OF BOUNDS — a region circle that pokes past the room edge spawns
 *     mobs in the wall band (or nowhere).
 *  2. WET/BLOCKED GROUND — `findSpawnPoint` takes 24 shots at a random point
 *     in the circle and gives up; a region over a pond or inside a structure
 *     silently under-populates. We re-run findSpawnPoint's own predicate
 *     (floorY → no liquid above it → a 0.3 × 1.6 AABB fits) over every column
 *     of every NEW region and demand ≥ 60% dry-walkable.
 *     Exempt: tables re-centered onto a prefab (`bindSpawnTable`) — the prefab
 *     flattens its own ground. (The shipped forest bandit-camp reads 45% dry
 *     precisely because it is prefab-bound; that is not a bug.)
 *  3. FAMILY OVERLAP — two different packs sharing a circle read as one
 *     confusing blob. Enforced between PACK tables only; SOLITARY tables
 *     (packSize [1,1] — uniques, bosses, roamers, ambient critters) are the
 *     authored exception, and the shipped data already relies on it
 *     (fen-approach-spiders straddles the bandit fort; camp-livestock sits
 *     inside it).
 *  4. A `level` OVERRIDE THAT UNLOCKS NOTHING — the whole point of reusing a
 *     shipped def deeper in the world is that its ranks fire. Any leveled
 *     entry whose def HAS ranks must cross a rank threshold; a rankless def
 *     (the desert's L5 slime) must at least come out measurably stronger.
 */
import { describe, expect, it } from "vitest";
import {
  gameConstants,
  loadRoomDef,
  RegistryService,
  resolveMob,
  type MobDef,
  type RoomDef,
  type SpawnTable,
} from "@fantasy-mmo/common";
import { VoxelWorld } from "../src/sim/voxel.js";

const reg = new RegistryService();
const SCALING = gameConstants().mobs.scaling;

/** every table this batch added or re-pointed, per room */
const NEW_TABLES: Record<string, string[]> = {
  forest: ["aelthir-range"],
  desert: ["pride-dunes", "red-mane", "sandpicker-diggings", "courtiers-necropolis", "sekhat-tomb"],
  gloomfen: ["glimmer-thicket", "mire-nave", "crowned-mire"],
  dungeon: ["side-galleries", "mourner-drift", "warden-door"],
  crypt_depths: ["drill-field", "workshop", "ossuary-feasters", "wrung-shades", "workshop-threshold"],
  cinderrift: [
    "slag-adits",
    "forge-gate",
    "proto-yard-w",
    "proto-yard-e",
    "proto-yard-s",
    "the-unbound",
    "riderless",
  ],
  sundered_city: ["burned-market-riderless"],
};

const solitary = (t: SpawnTable) => t.packSize[0] === 1 && t.packSize[1] === 1;

/** a table nobody should have to fight alongside another family: passive mobs
 *  (no damage, or no aggro at their spawn level) never join a pull */
function passive(t: SpawnTable): boolean {
  return t.mobs.every((m) => {
    const d = resolveMob(reg.mobs[m.mob]!, m.level, SCALING);
    return d.damage === 0 || d.aggroRadius === 0;
  });
}

/** findSpawnPoint's own acceptance predicate, run over a whole circle */
function dryWalkablePct(world: VoxelWorld, t: SpawnTable): number {
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
  return n === 0 ? 0 : (ok / n) * 100;
}

describe("roster-2 spawn tables", () => {
  for (const [roomId, added] of Object.entries(NEW_TABLES)) {
    describe(roomId, () => {
      const def: RoomDef = loadRoomDef(roomId);
      const byId = new Map(def.spawnTables.map((t) => [t.id, t]));

      it("carries every table this batch authored, in bounds, with registered mobs", () => {
        for (const id of added) {
          const t = byId.get(id);
          expect(t, `${roomId}: missing table ${id}`).toBeDefined();
          expect(t!.region.x - t!.region.r, id).toBeGreaterThanOrEqual(0);
          expect(t!.region.x + t!.region.r, id).toBeLessThanOrEqual(def.size.w);
          expect(t!.region.z - t!.region.r, id).toBeGreaterThanOrEqual(0);
          expect(t!.region.z + t!.region.r, id).toBeLessThanOrEqual(def.size.h);
          for (const m of t!.mobs) expect(reg.mobs[m.mob], `${id}: ${m.mob}`).toBeDefined();
        }
      });

      it("spawns every new region on dry, walkable ground (≥60% of its columns)", () => {
        const world = new VoxelWorld(def);
        const bound = new Set(def.prefabs.map((p) => p.bindSpawnTable).filter(Boolean));
        for (const id of added) {
          if (bound.has(id)) continue; // the prefab flattens its own site
          const pct = dryWalkablePct(world, byId.get(id)!);
          expect(pct, `${roomId}/${id} is only ${pct.toFixed(1)}% dry-walkable`).toBeGreaterThanOrEqual(60);
        }
      }, 60000);

      it("never overlaps two pack tables of different mob families", () => {
        const packs = def.spawnTables.filter((t) => !solitary(t) && !passive(t));
        for (let i = 0; i < packs.length; i++) {
          for (let j = i + 1; j < packs.length; j++) {
            const a = packs[i]!;
            const b = packs[j]!;
            const shared = a.mobs.some((m) => b.mobs.some((n) => n.mob === m.mob));
            if (shared) continue; // one family split across two camps is fine
            const d = Math.hypot(a.region.x - b.region.x, a.region.z - b.region.z);
            expect(d, `${roomId}: ${a.id} overlaps ${b.id}`).toBeGreaterThan(a.region.r + b.region.r);
          }
        }
      });

      it("every `level` override actually buys something", () => {
        for (const t of def.spawnTables) {
          for (const entry of t.mobs) {
            if (entry.level === undefined) continue;
            const mob: MobDef = reg.mobs[entry.mob]!;
            expect(entry.level, `${t.id}/${entry.mob}: level below the def`).toBeGreaterThan(mob.level - 1);
            const base = resolveMob(mob, undefined, SCALING);
            const deep = resolveMob(mob, entry.level, SCALING);
            if ((mob.ranks ?? []).length > 0) {
              // a ranked def MUST cross a threshold — otherwise the level is a
              // silent stat nudge and the design intent (new buttons, new
              // title, new nerve) never fires
              const crossed = (mob.ranks ?? []).some((r) => r.atLevel <= entry.level!);
              expect(crossed, `${t.id}: ${entry.mob} @L${entry.level} crosses no rank`).toBe(true);
              const changed =
                JSON.stringify(base.attacks.map((a) => a.ability).sort()) !==
                  JSON.stringify(deep.attacks.map((a) => a.ability).sort()) ||
                base.name !== deep.name ||
                base.aggroRadius !== deep.aggroRadius ||
                base.hp !== deep.hp;
              expect(changed, `${t.id}: ${entry.mob} @L${entry.level} is a no-op`).toBe(true);
            } else {
              // rankless (the desert's L5 slime): the scale itself is the point
              expect(deep.hp, `${t.id}: ${entry.mob}`).toBeGreaterThan(base.hp);
              expect(deep.xp, `${t.id}: ${entry.mob}`).toBeGreaterThan(base.xp);
            }
          }
        }
      });

      it("every event names a real mob and a real action target", () => {
        for (const ev of def.events) {
          expect(reg.mobs[ev.on.mob], `${ev.id}: trigger mob`).toBeDefined();
          for (const a of ev.actions) {
            if (a.kind === "spawnMobs") expect(reg.mobs[a.mob], `${ev.id}: ${a.mob}`).toBeDefined();
            if (a.kind === "openPortal")
              expect(def.portals.some((p) => p.id === a.portalId), `${ev.id}: ${a.portalId}`).toBe(true);
          }
        }
      });
    });
  }

  it("the crypt's assembly line: a Stitcher is never in the ghouls' galleries", () => {
    // "ghouls are what happens when nobody stitches you" — the two must not
    // share a circle, in either crypt
    for (const roomId of ["dungeon", "crypt_depths"]) {
      const def = loadRoomDef(roomId);
      const ghoulTables = def.spawnTables.filter((t) => t.mobs.some((m) => m.mob === "crypt_ghoul"));
      const stitchTables = def.spawnTables.filter((t) =>
        t.mobs.some((m) => m.mob === "ossuary_stitcher" || m.mob === "grave_harrower")
      );
      expect(ghoulTables.length, roomId).toBeGreaterThan(0);
      for (const g of ghoulTables) {
        for (const s of stitchTables) {
          const d = Math.hypot(g.region.x - s.region.x, g.region.z - s.region.z);
          expect(d, `${roomId}: ${g.id} touches ${s.id}`).toBeGreaterThan(g.region.r + s.region.r);
        }
      }
    }
  });

  it("crypt_depths reuses the shipped bestiary at rank — no new defs needed", () => {
    const def = loadRoomDef("crypt_depths");
    const leveled = def.spawnTables.flatMap((t) => t.mobs.filter((m) => m.level !== undefined));
    // skeleton 14, restless_bones 13, harrower 14, stitcher 14, ghoul 14,
    // mourner 13, warden 14, + bone_bat 12 ×2 (batch 5 rebased bone_bat 12→10
    // for the Ossuary Galleries; the cloisters carry the old level as overrides)
    expect(leveled.length).toBe(9);
    const skel = resolveMob(reg.mobs["skeleton"]!, 14, SCALING);
    expect(skel.name).toContain("Deathless Legionary");
    expect(skel.attacks.map((a) => a.ability)).toContain("reap");
    // THE PAYOFF: the dungeon's harmless drifting ghost turns on you down here
    const mournerUp = resolveMob(reg.mobs["pallid_mourner"]!, undefined, SCALING);
    const mournerDown = resolveMob(reg.mobs["pallid_mourner"]!, 13, SCALING);
    expect(mournerUp.aggroRadius).toBe(0);
    expect(mournerDown.aggroRadius).toBeGreaterThan(0);
    expect(mournerDown.fleeAtHpPct).toBe(0);
  });

  it("cinderrift's slag-adits sit on a stamped mine_adit (the gen is deterministic)", () => {
    const def = loadRoomDef("cinderrift");
    const t = def.spawnTables.find((s) => s.id === "slag-adits")!;
    const world = new VoxelWorld(def);
    const adits = world.features.placements.filter((p) => p.prefab === "mine_adit");
    expect(adits.length).toBeGreaterThan(0);
    const hit = adits.some((a) => Math.hypot(a.x - t.region.x, a.z - t.region.z) <= t.region.r);
    expect(hit, "no mine_adit inside the slag-adits circle — re-point the region").toBe(true);
  }, 60000);

  it("the forest's wandering Unmarred is passive and alone, and answers when it dies", () => {
    const def = loadRoomDef("forest");
    const t = def.spawnTables.find((s) => s.id === "aelthir-range")!;
    expect(t.maxAlive).toBe(1);
    expect(t.packSize).toEqual([1, 1]);
    expect(reg.mobs["aelthir"]!.aggroRadius).toBe(0); // it never opens the fight
    const ev = def.events.find((e) => e.id === "unmarred-answer")!;
    expect(ev.on).toMatchObject({ kind: "bossDeath", mob: "aelthir" });
    expect(ev.actions.some((a) => a.kind === "spawnMobs" && a.mob === "gravehound")).toBe(true);
  });

  it("the desert's Sekhat digs at half health and falls silent at zero", () => {
    const def = loadRoomDef("desert");
    const dig = def.events.find((e) => e.id === "sekhat-dig")!;
    expect(dig.on).toMatchObject({ kind: "bossHpBelowPct", mob: "sekhat", pct: 0.5 });
    expect(dig.actions.some((a) => a.kind === "spawnMobs" && a.mob === "skeleton" && a.count === 3)).toBe(true);
    const fall = def.events.find((e) => e.id === "sekhat-fall")!;
    expect(fall.on).toMatchObject({ kind: "bossDeath", mob: "sekhat" });
  });

  it("gloomfen's Grelmoss boils the mire at half health", () => {
    const ev = loadRoomDef("gloomfen").events.find((e) => e.id === "grelmoss-rally")!;
    expect(ev.on).toMatchObject({ kind: "bossHpBelowPct", mob: "grelmoss", pct: 0.5 });
    expect(ev.actions.some((a) => a.kind === "spawnMobs" && a.mob === "bloatslime" && a.count === 2)).toBe(true);
  });

  it("the Riderless crosses its L17 rank in the city, and is base-level in the rift", () => {
    const city = loadRoomDef("sundered_city").spawnTables.find((t) => t.id === "burned-market-riderless")!;
    expect(city.mobs[0]!.level).toBe(17);
    const base = resolveMob(reg.mobs["cinder_nightmare"]!, undefined, SCALING);
    const risen = resolveMob(reg.mobs["cinder_nightmare"]!, 17, SCALING);
    expect(risen.attacks.map((a) => a.ability)).toContain("sundering_wave");
    expect(base.attacks.map((a) => a.ability)).not.toContain("sundering_wave");
    const rift = loadRoomDef("cinderrift").spawnTables.find((t) => t.id === "riderless")!;
    expect(rift.mobs[0]!.level).toBeUndefined();
  });
});
