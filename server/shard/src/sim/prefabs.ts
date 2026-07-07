/**
 * Prefab system: a catalog of small authored structures ("everything has a
 * story") + a deterministic scatter placer that stamps them over generated
 * terrain from a room def's `prefabs` config. Layered on the existing
 * Builder primitives (voxelstructures.ts) — nothing here touches gen noise.
 *
 * Story rules (design doc §4a):
 *  - decay gradient: ruinLevel 0 near portals/spawn → 2 deep in the room
 *  - light = language: torch/lantern = inhabited, crystal = danger + loot,
 *    no light = nobody's been here
 *  - one "interrupted action" detail per prefab where sensible
 *
 * ALL randomness is hash2 over the room seed — NEVER Math.random. The same
 * def generates the same grid, placements, caches, and spawn bindings every
 * boot (same determinism contract as trees).
 */
import {
  BLOCK,
  isSolidBlock,
  makeLogger,
  WORLD_HEIGHT,
  type PrefabScatterDef,
  type RoomDef,
  type SpawnTable,
} from "@fantasy-mmo/common";
import { hash2, type VoxelWorld } from "./voxel.js";
import type { BlockGrid, Builder } from "./voxelstructures.js";

const log = makeLogger("prefabs");

const blockId = (name: string | number): number => {
  if (typeof name === "number") return name;
  const def = BLOCK[name];
  if (!def) throw new Error(`prefabs: unknown block ${name}`);
  return def.id;
};

function strHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) | 0;
  return h | 0;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PrefabCtx {
  b: Builder;
  def: RoomDef;
  /** placement origin: min corner of the rotated world footprint */
  ox: number;
  oz: number;
  /** quarter turns; all local coords route through p() */
  rot: 0 | 1 | 2 | 3;
  /** local footprint dims (pre-rotation) */
  w: number;
  d: number;
  /** anchor ground level (flatten: the leveled floor; conform: center col) */
  groundY: number;
  ruinLevel: 0 | 1 | 2;
  /** local → world (rotation-aware) */
  p(lx: number, lz: number): [number, number];
  /** column ground at local coords (flatten anchors return groundY) */
  g(lx: number, lz: number): number;
  /** set a block at local x/z, ABSOLUTE world y */
  set(lx: number, y: number, lz: number, block: string | number): void;
  setIfAir(lx: number, y: number, lz: number, block: string | number): void;
  fill(lx0: number, y0: number, lz0: number, lx1: number, y1: number, lz1: number, block: string | number): void;
  /** deterministic [0,1) — hash2 over room seed ^ prefab salt ^ salt */
  rand(salt: number): number;
}

export interface PrefabDef {
  id: string;
  footprint: { w: number; d: number };
  /** flatten: level the footprint to the anchor ground (Builder.flatten);
   *  conform: builds follow each column's own terrain height */
  anchor: "flatten" | "conform";
  /** height cleared above ground before building (default 12) */
  clearance?: number;
  /** skip the pre-build clear entirely (mine adit digs INTO the hill) */
  noClear?: boolean;
  /** flatten surface block (default: biome surface) */
  floor?: string;
  /** reject sites whose corner/center terrain delta exceeds this (default 3) */
  maxSlope?: number;
  /** require at least this much rise along local +z (mine adit; scatter also
   *  rotates such prefabs so local +z points uphill) */
  minSlope?: number;
  /** groundY reference: footprint center (default) or the local-z=0 edge */
  groundRef?: "center" | "lowEdge";
  nearWater?: boolean;
  avoidWater?: boolean;
  build(ctx: PrefabCtx): void;
  hooks?: {
    /** local [lx, yAboveGround, lz]; table "auto" resolves per room */
    lootCache?: { local: [number, number, number]; table: string; respawnSec: number };
    /** dynamic spawn anchor; `table` payload merges a new spawn table at gen
     *  time, or the scatter entry's bindSpawnTable re-centers a def table */
    spawnRegion?: { local: [number, number]; r: number; table?: SpawnRegionPayload };
  };
}

/** spawnTable-shaped payload a prefab can bind to its site */
export interface SpawnRegionPayload {
  mobs: Array<{ mob: string; weight: number }>;
  maxAlive: number;
  packSize: [number, number];
  respawnSec: number;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface LootCachePoint {
  x: number;
  y: number;
  z: number;
  table: string;
  respawnSec: number;
}

export interface StampedHooks {
  lootCache?: LootCachePoint;
  spawnRegion?: { x: number; z: number; r: number; table?: SpawnRegionPayload };
}

export interface PrefabPlacement {
  prefab: string;
  x: number;
  z: number;
  ox: number;
  oz: number;
  rot: 0 | 1 | 2 | 3;
  ruinLevel: 0 | 1 | 2;
}

export interface ScatterResult {
  placements: PrefabPlacement[];
  caches: LootCachePoint[];
  /** re-center these room spawn tables onto their prefab site */
  bindings: Array<{ tableId: string; x: number; z: number }>;
  /** prefab-carried spawn tables merged into the room at gen time */
  extraTables: SpawnTable[];
  underfill: Array<{ prefab: string; wanted: number; placed: number }>;
}

export function emptyScatterResult(): ScatterResult {
  return { placements: [], caches: [], bindings: [], extraTables: [], underfill: [] };
}

// ---------------------------------------------------------------------------
// Stamping
// ---------------------------------------------------------------------------

function biomeFloor(biome: string): string {
  switch (biome) {
    case "desert":
      return "sand";
    case "swamp":
      return "mud";
    case "volcanic":
      return "dark_stone";
    case "dungeon":
      return "stone";
    default:
      return "grass";
  }
}

/** local→world quarter-turn mapping. Local +z faces world +z / -x / -z / +x
 *  for rot 0/1/2/3. World footprint = w×d for even rots, d×w for odd. */
function makeMapping(ox: number, oz: number, w: number, d: number, rot: 0 | 1 | 2 | 3) {
  return (lx: number, lz: number): [number, number] => {
    switch (rot) {
      case 0:
        return [ox + lx, oz + lz];
      case 1:
        return [ox + (d - 1 - lz), oz + lx];
      case 2:
        return [ox + (w - 1 - lx), oz + (d - 1 - lz)];
      case 3:
        return [ox + lz, oz + (w - 1 - lx)];
    }
  };
}

/**
 * Stamp a prefab with its anchor rule at world min-corner (ox, oz). Used by
 * the scatter placer, authored room builders, and the /prefab admin command
 * (the latter through an EditRecorder so edits persist + /clearblocks wipes).
 * Returns the prefab's hooks resolved to world coordinates.
 */
export function stampPrefab(b: Builder, prefabId: string, ox: number, oz: number, rot: 0 | 1 | 2 | 3, ruinLevel: 0 | 1 | 2): StampedHooks {
  const pdef = PREFABS[prefabId];
  if (!pdef) throw new Error(`unknown prefab ${prefabId}`);
  const { w, d } = pdef.footprint;
  const p = makeMapping(ox, oz, w, d, rot);
  const [gx, gz] = pdef.groundRef === "lowEdge" ? p(Math.floor(w / 2), 0) : p(Math.floor(w / 2), Math.floor(d / 2));
  const groundY = b.g(gx, gz);
  const clearance = pdef.clearance ?? 12;
  const rw = rot % 2 ? d : w;
  const rd = rot % 2 ? w : d;
  if (!pdef.noClear) {
    if (pdef.anchor === "flatten") {
      b.clearAbove(ox - 1, oz - 1, ox + rw, oz + rd, groundY, clearance);
      b.flatten(ox, oz, ox + rw - 1, oz + rd - 1, groundY, pdef.floor ?? biomeFloor(b.def.biome));
    } else {
      for (let wx = ox; wx < ox + rw; wx++) {
        for (let wz = oz; wz < oz + rd; wz++) {
          b.clearAbove(wx, wz, wx, wz, b.g(wx, wz), clearance);
        }
      }
    }
  }
  const seed = b.def.terrain.seed | 0;
  const psalt = strHash(prefabId);
  const ctx: PrefabCtx = {
    b,
    def: b.def,
    ox,
    oz,
    rot,
    w,
    d,
    groundY,
    ruinLevel,
    p,
    g: (lx, lz) => {
      if (pdef.anchor === "flatten") return groundY;
      const [wx, wz] = p(lx, lz);
      return b.g(wx, wz);
    },
    set: (lx, y, lz, block) => {
      const [wx, wz] = p(lx, lz);
      b.set(wx, y, wz, block);
    },
    setIfAir: (lx, y, lz, block) => {
      if (y < 1 || y >= WORLD_HEIGHT) return;
      const [wx, wz] = p(lx, lz);
      b.world.setIfAir(wx, y, wz, blockId(block));
    },
    fill: (lx0, y0, lz0, lx1, y1, lz1, block) => {
      for (let lz = lz0; lz <= lz1; lz++) {
        for (let lx = lx0; lx <= lx1; lx++) {
          const [wx, wz] = p(lx, lz);
          for (let y = Math.max(1, y0); y <= Math.min(WORLD_HEIGHT - 1, y1); y++) {
            b.set(wx, y, wz, block);
          }
        }
      }
    },
    rand: (salt) => hash2(seed ^ psalt ^ Math.imul(salt | 0, 0x85ebca6b), ox, oz),
  };
  pdef.build(ctx);

  const hooks: StampedHooks = {};
  if (pdef.hooks?.lootCache) {
    const lc = pdef.hooks.lootCache;
    const [wx, wz] = p(lc.local[0], lc.local[2]);
    hooks.lootCache = { x: wx + 0.5, y: groundY + lc.local[1], z: wz + 0.5, table: lc.table, respawnSec: lc.respawnSec };
  }
  if (pdef.hooks?.spawnRegion) {
    const sr = pdef.hooks.spawnRegion;
    const [wx, wz] = p(sr.local[0], sr.local[1]);
    hooks.spawnRegion = { x: wx, z: wz, r: sr.r, table: sr.table };
  }
  return hooks;
}

// ---------------------------------------------------------------------------
// Scatter placement (design §4c)
// ---------------------------------------------------------------------------

const SPAWN_PORTAL_EXCLUSION = 12;
const NEAR_PORTAL_RADIUS = 42;

function rectPointDist(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}

function rectsOverlap(a: Rect, b: Rect, pad: number): boolean {
  return a.x0 - pad <= b.x1 && a.x1 + pad >= b.x0 && a.z0 - pad <= b.z1 && a.z1 + pad >= b.z0;
}

/**
 * Deterministic scatter: for each config entry (array order — earlier entries
 * claim ground first) run hash2-driven candidates; the first half of the
 * candidate budget enforces near/nearPrefab/nearPortals (candidates are drawn
 * around the anchor so they can actually hit), the second half relaxes those
 * soft constraints. Hard rules (bounds, spawn/portal exclusion, slope, water,
 * spacing, authored rects) always apply. Under-fill is fine and logged.
 */
export function scatterPrefabs(b: Builder, def: RoomDef, exclusions: Rect[]): ScatterResult {
  const res = emptyScatterResult();
  const entries = def.prefabs ?? [];
  if (entries.length === 0) return res;
  const seed = def.terrain.seed | 0;
  const W = def.size.w;
  const H = def.size.h;
  const wl = def.terrain.waterLevel ?? null;
  const th = (x: number, z: number) => b.g(Math.round(x), Math.round(z));
  const placed: Array<{ prefab: string; cx: number; cz: number; rect: Rect }> = [];

  entries.forEach((entry: PrefabScatterDef, i: number) => {
    const pdef = PREFABS[entry.prefab];
    if (!pdef) {
      log.warn(`${def.id}: scatter references unknown prefab '${entry.prefab}'`);
      return;
    }
    const eseed = seed ^ 0x9ef1 ^ Math.imul(i + 1, 0x9e3779b1);
    const softBudget = entry.count * 12;
    const maxK = entry.count * 24;
    let count = 0;
    for (let k = 0; k < maxK && count < entry.count; k++) {
      const soft = k < softBudget;
      const r0 = hash2(eseed, k, 0);
      const r1 = hash2(eseed, k, 1);
      // --- candidate center: drawn around the soft anchor when one applies ---
      let cx: number;
      let cz: number;
      if (soft && entry.near) {
        cx = entry.near.x + (r0 * 2 - 1) * entry.near.within;
        cz = entry.near.z + (r1 * 2 - 1) * entry.near.within;
        if (Math.hypot(cx - entry.near.x, cz - entry.near.z) > entry.near.within) continue; // box corner
      } else if (soft && entry.nearPrefab) {
        const anchors = placed.filter((q) => q.prefab === entry.nearPrefab!.id);
        if (anchors.length === 0) continue; // anchor under-filled: relaxed pass fills
        const a = anchors[Math.floor(hash2(eseed, k, 5) * anchors.length)]!;
        cx = a.cx + (r0 * 2 - 1) * entry.nearPrefab.within;
        cz = a.cz + (r1 * 2 - 1) * entry.nearPrefab.within;
        if (Math.hypot(cx - a.cx, cz - a.cz) > entry.nearPrefab.within) continue;
      } else if (soft && entry.nearPortals && def.portals.length > 0) {
        const q = def.portals[Math.floor(hash2(eseed, k, 5) * def.portals.length)]!;
        cx = q.x + (r0 * 2 - 1) * NEAR_PORTAL_RADIUS;
        cz = q.z + (r1 * 2 - 1) * NEAR_PORTAL_RADIUS;
      } else {
        cx = r0 * W;
        cz = r1 * H;
      }
      // --- rotation: hash-random; slope prefabs aim local +z uphill ---
      let rot = Math.floor(hash2(eseed, k, 2) * 4) as 0 | 1 | 2 | 3;
      if (pdef.minSlope !== undefined) {
        const hN = th(cx, cz - 5);
        const hS = th(cx, cz + 5);
        const hW = th(cx - 5, cz);
        const hE = th(cx + 5, cz);
        const best = Math.max(hN, hS, hW, hE);
        rot = best === hS ? 0 : best === hW ? 1 : best === hN ? 2 : 3;
      }
      const rw = rot % 2 ? pdef.footprint.d : pdef.footprint.w;
      const rd = rot % 2 ? pdef.footprint.w : pdef.footprint.d;
      const ox = Math.floor(cx - rw / 2);
      const oz = Math.floor(cz - rd / 2);
      const rect: Rect = { x0: ox, z0: oz, x1: ox + rw - 1, z1: oz + rd - 1 };
      // hard rules -----------------------------------------------------------
      if (rect.x0 < 2 || rect.z0 < 2 || rect.x1 > W - 3 || rect.z1 > H - 3) continue;
      if (rectPointDist(rect, def.spawn.x, def.spawn.z) < SPAWN_PORTAL_EXCLUSION) continue;
      if (def.portals.some((q) => rectPointDist(rect, q.x, q.z) < SPAWN_PORTAL_EXCLUSION)) continue;
      if (exclusions.some((e) => rectsOverlap(rect, e, 2))) continue;
      if (placed.some((q) => rectsOverlap(rect, q.rect, 3))) continue;
      if (entry.minSpacing > 0 && placed.some((q) => Math.hypot(q.cx - cx, q.cz - cz) < entry.minSpacing)) continue;
      // slope across corners + center
      const hs = [th(rect.x0, rect.z0), th(rect.x1, rect.z0), th(rect.x0, rect.z1), th(rect.x1, rect.z1), th(cx, cz)];
      const delta = Math.max(...hs) - Math.min(...hs);
      if (delta > (pdef.maxSlope ?? 3)) continue;
      if (pdef.minSlope !== undefined) {
        const map = makeMapping(ox, oz, pdef.footprint.w, pdef.footprint.d, rot);
        const [ex, ez] = map(Math.floor(pdef.footprint.w / 2), 0);
        const [bx, bz] = map(Math.floor(pdef.footprint.w / 2), pdef.footprint.d - 1);
        if (th(bx, bz) - th(ex, ez) < pdef.minSlope) continue;
      }
      // water filters (9-point footprint sample; nearWater also scans a ring)
      if (wl !== null && (pdef.avoidWater || pdef.nearWater)) {
        const mx = Math.round(cx);
        const mz = Math.round(cz);
        const pts: Array<[number, number]> = [
          [rect.x0, rect.z0],
          [rect.x1, rect.z0],
          [rect.x0, rect.z1],
          [rect.x1, rect.z1],
          [mx, rect.z0],
          [mx, rect.z1],
          [rect.x0, mz],
          [rect.x1, mz],
          [mx, mz],
        ];
        const flooded = pts.filter(([x, z]) => th(x, z) < wl).length;
        if (pdef.avoidWater && flooded > 0) continue;
        if (pdef.nearWater && flooded === 0) {
          let ringWater = false;
          for (let a = 0; a < 8 && !ringWater; a++) {
            const ang = (a / 8) * Math.PI * 2;
            const rr = Math.max(rw, rd) / 2 + 4;
            if (th(cx + Math.sin(ang) * rr, cz + Math.cos(ang) * rr) < wl) ringWater = true;
          }
          if (!ringWater) continue;
        }
      } else if (pdef.nearWater && wl === null) {
        continue; // room has no water at all
      }
      // ruin gradient: intact near spawn/portals, ruined deep in the room
      // (0.75 × room span ≈ the far corners when the gate sits on an edge —
      // 0.5 saturated everything past mid-room at ruin 2)
      const refs = [Math.hypot(cx - def.spawn.x, cz - def.spawn.z), ...def.portals.map((q) => Math.hypot(cx - q.x, cz - q.z))];
      const dNorm = Math.min(1, Math.min(...refs) / (Math.max(W, H) * 0.75));
      const score = dNorm * (entry.ruinBias ?? 1);
      const ruinLevel = (score < 0.35 ? 0 : score < 0.7 ? 1 : 2) as 0 | 1 | 2;
      // stamp + record --------------------------------------------------------
      const hooks = stampPrefab(b, entry.prefab, ox, oz, rot, ruinLevel);
      placed.push({ prefab: entry.prefab, cx, cz, rect });
      res.placements.push({ prefab: entry.prefab, x: Math.round(cx), z: Math.round(cz), ox, oz, rot, ruinLevel });
      if (hooks.lootCache) res.caches.push(hooks.lootCache);
      if (hooks.spawnRegion) {
        if (entry.bindSpawnTable) {
          res.bindings.push({ tableId: entry.bindSpawnTable, x: hooks.spawnRegion.x, z: hooks.spawnRegion.z });
        }
        if (hooks.spawnRegion.table) {
          res.extraTables.push({
            id: `${entry.prefab}-${res.placements.length}`,
            region: { kind: "circle", x: hooks.spawnRegion.x, z: hooks.spawnRegion.z, r: hooks.spawnRegion.r },
            mobs: hooks.spawnRegion.table.mobs,
            maxAlive: hooks.spawnRegion.table.maxAlive,
            packSize: hooks.spawnRegion.table.packSize,
            respawnSec: hooks.spawnRegion.table.respawnSec,
          });
        }
      }
      count++;
    }
    if (count < entry.count) {
      res.underfill.push({ prefab: entry.prefab, wanted: entry.count, placed: count });
      log.info(`${def.id}: prefab '${entry.prefab}' under-filled ${count}/${entry.count}`);
    }
  });
  return res;
}

// ---------------------------------------------------------------------------
// /prefab admin support: record block writes and replay them through the
// room's edit overlay (applyEdit, owner null) so /clearblocks reverts them
// and they persist in RoomState — never gen-time set().
// ---------------------------------------------------------------------------

export class EditRecorder implements BlockGrid {
  private pending = new Map<string, { x: number; y: number; z: number; id: number }>();
  constructor(private readonly base: VoxelWorld) {}

  get(x: number, y: number, z: number): number {
    const p = this.pending.get(`${x},${y},${z}`);
    return p ? p.id : this.base.get(x, y, z);
  }

  set(x: number, y: number, z: number, id: number): void {
    if (y < 1 || y >= WORLD_HEIGHT || !this.base.inBounds(x, y, z)) return;
    const key = `${x},${y},${z}`;
    if (this.base.get(x, y, z) === id) {
      this.pending.delete(key); // no-op writes don't become edits
      return;
    }
    this.pending.set(key, { x, y, z, id });
  }

  setIfAir(x: number, y: number, z: number, id: number): void {
    if (this.get(x, y, z) === 0) this.set(x, y, z, id);
  }

  solidAt(x: number, y: number, z: number): boolean {
    return isSolidBlock(this.get(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  terrainHeight(def: RoomDef, x: number, z: number): number {
    return this.base.terrainHeight(def, x, z);
  }

  cells(): Array<{ x: number; y: number; z: number; id: number }> {
    return [...this.pending.values()];
  }
}

// ---------------------------------------------------------------------------
// The catalog (design §4b) — 14 prefabs.
// ---------------------------------------------------------------------------

export const PREFABS: Record<string, PrefabDef> = {};

function register(def: PrefabDef): void {
  PREFABS[def.id] = def;
}

// --- ruined_watchtower: a border garrison the kingdom stopped paying for ---
register({
  id: "ruined_watchtower",
  footprint: { w: 7, d: 7 },
  anchor: "flatten",
  clearance: 14,
  maxSlope: 4,
  avoidWater: true,
  build(ctx) {
    const FL = ctx.groundY + 1;
    for (let lx = 1; lx <= 5; lx++) {
      for (let lz = 1; lz <= 5; lz++) {
        const edge = lx === 1 || lx === 5 || lz === 1 || lz === 5;
        if (!edge) continue;
        // decay gradient: hash bites chew the walls down, harder when ruined
        const bite = Math.floor(ctx.rand(lx * 13 + lz) * (1 + ctx.ruinLevel * 3));
        const h = Math.max(3, 9 - bite);
        ctx.fill(lx, FL, lz, lx, FL + 1, lz, "cobblestone");
        ctx.fill(lx, FL + 2, lz, lx, FL + h - 1, lz, "stone_bricks");
        if (h === 9 && (lx + lz) % 2 === 0) ctx.set(lx, FL + 9, lz, "stone_bricks"); // merlons
      }
    }
    // door-less doorway (someone took the door) + a tipped crate outside
    ctx.fill(3, FL, 5, 3, FL + 1, 5, 0);
    ctx.set(4, FL, 6, "planks");
    // top platform — the east row stays OPEN: that's where the stair pops
    // through (and the headroom the climb needs; see the step math below)
    ctx.fill(2, FL + 7, 2, 3, FL + 7, 4, "planks");
    // interior spiral stair, door cell (3,4) around the wall to the top:
    // 7 plank treads on log posts, each 1 up from the last (jump height).
    // Standing feet on tread i = FL+1+i; the open east platform row keeps
    // 2 blocks of headroom over every tread and over each jump's arc, and
    // from the last tread ((4,4), feet FL+7) one more jump mounts the
    // platform (feet FL+8), where the cache sits at local (3, 9, 3).
    const steps: Array<[number, number]> = [
      [2, 4],
      [2, 3],
      [2, 2],
      [3, 2],
      [4, 2],
      [4, 3],
      [4, 4],
    ];
    steps.forEach(([sx, sz], i) => {
      const top = FL + i;
      if (top > FL) ctx.fill(sx, FL, sz, sx, top - 1, sz, "log");
      ctx.set(sx, top, sz, "planks");
    });
    // light = language: the brazier only burns while someone tends it
    if (ctx.ruinLevel === 0) ctx.set(3, FL + 8, 3, "torch");
  },
  hooks: { lootCache: { local: [3, 9, 3], table: "auto", respawnSec: 420 } },
});

// --- wayshrine: waymarkers of the old road network; pilgrims keep them lit --
register({
  id: "wayshrine",
  footprint: { w: 3, d: 3 },
  anchor: "flatten",
  clearance: 8,
  maxSlope: 3,
  floor: "path",
  avoidWater: true,
  build(ctx) {
    const FL = ctx.groundY + 1;
    for (const [lx, lz] of [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ] as const) {
      ctx.set(lx, FL, lz, "cobblestone");
    }
    ctx.set(1, FL, 1, "stone_bricks");
    ctx.set(1, FL + 1, 1, ctx.def.biome === "swamp" ? "blue_crystal" : "crystal");
  },
  // never has caches — a wayshrine is a promise, not a prize
});

// --- abandoned_camp: somebody left in a hurry -------------------------------
register({
  id: "abandoned_camp",
  footprint: { w: 6, d: 6 },
  anchor: "conform",
  clearance: 8,
  maxSlope: 3,
  avoidWater: true,
  build(ctx) {
    const burnt = ctx.ruinLevel >= 2 || ctx.def.biome === "desert" || ctx.def.biome === "volcanic";
    // fire ring at (3,3): stones on the ground, embers or a cold char center
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const lx = 3 + dx;
        const lz = 3 + dz;
        ctx.set(lx, ctx.g(lx, lz), lz, "cobblestone");
      }
    }
    // light = language: a still-smoldering fire means someone JUST left
    if (burnt) ctx.set(3, ctx.g(3, 3) + 1, 3, "charred_log");
    else ctx.set(3, ctx.g(3, 3) + 1, 3, "torch");
    // two hay bedrolls (one half-dragged toward the fire — interrupted sleep)
    ctx.set(1, ctx.g(1, 1) + 1, 1, "hay");
    ctx.set(1, ctx.g(1, 2) + 1, 2, "hay");
    ctx.set(5, ctx.g(5, 2) + 1, 2, "hay");
    // supply crate + one tipped over beside it
    ctx.set(4, ctx.g(4, 4) + 1, 4, "planks");
    ctx.set(5, ctx.g(5, 4) + 1, 4, "planks");
    // stump seat by the fire
    ctx.set(1, ctx.g(1, 4) + 1, 4, burnt ? "charred_log" : "log");
  },
  hooks: { lootCache: { local: [4, 2, 4], table: "auto", respawnSec: 300 } },
});

// --- graveyard: rows for the people the wilds took --------------------------
register({
  id: "graveyard",
  footprint: { w: 9, d: 7 },
  anchor: "conform",
  clearance: 10,
  maxSlope: 2,
  avoidWater: true,
  build(ctx) {
    // iron fence with a gateless gap on the south side
    for (let lx = 0; lx <= 8; lx++) {
      for (const lz of [0, 6]) {
        if (lz === 6 && (lx === 4 || lx === 5)) continue; // the gap
        ctx.set(lx, ctx.g(lx, lz) + 1, lz, "iron_bars");
      }
    }
    for (let lz = 1; lz <= 5; lz++) {
      for (const lx of [0, 8]) ctx.set(lx, ctx.g(lx, lz) + 1, lz, "iron_bars");
    }
    // mossy path up the middle from the gap
    for (let lz = 1; lz <= 5; lz++) ctx.set(4, ctx.g(4, lz), lz, "mossy_cobblestone");
    // headstone rows: plain stones, some with taller stele
    for (const lx of [2, 6]) {
      for (const lz of [1, 3, 5]) {
        const g = ctx.g(lx, lz);
        ctx.set(lx, g + 1, lz, "stone");
        if (ctx.rand(lx * 17 + lz) < 0.5) ctx.set(lx, g + 2, lz, "stone_bricks");
      }
    }
    // bone scraps where the digging was shallow
    for (let i = 0; i < 3; i++) {
      const lx = 1 + Math.floor(ctx.rand(40 + i) * 7);
      const lz = 1 + Math.floor(ctx.rand(50 + i) * 5);
      ctx.setIfAir(lx, ctx.g(lx, lz) + 1, lz, "bone_block");
    }
    // interrupted action: one grave stands OPEN, spoil heaped beside it
    ctx.set(6, ctx.g(6, 4), 4, 0);
    ctx.set(7, ctx.g(7, 4) + 1, 4, "dirt");
    // a single dead tree leans over the fence corner — and no light at all
    const tg = ctx.g(1, 5);
    ctx.fill(1, tg + 1, 5, 1, tg + 3, 5, "pale_log");
    ctx.setIfAir(1, tg + 4, 5, "dead_leaves");
    ctx.setIfAir(2, tg + 3, 5, "dead_leaves");
  },
});

// --- fallen_giant: a landmark tree that predates the kingdom, now a burrow --
register({
  id: "fallen_giant",
  footprint: { w: 12, d: 4 },
  anchor: "conform",
  clearance: 8,
  maxSlope: 2,
  avoidWater: true,
  build(ctx) {
    const g0 = ctx.groundY;
    // the trunk lies rigid along local x: 2 wide, 2 tall
    ctx.fill(1, g0 + 1, 1, 10, g0 + 2, 2, "pale_log");
    // hollow crawl-through core (something dug it out and lives here)
    ctx.fill(2, g0 + 1, 1, 9, g0 + 1, 1, 0);
    // root flare at the base
    ctx.fill(0, g0 + 1, 0, 0, g0 + 3, 3, "pale_log");
    ctx.set(1, g0 + 3, 1, "pale_log");
    ctx.set(1, g0 + 3, 2, "pale_log");
    // fungus line along the top — glowcaps mark the hollow's mouth
    for (let lx = 2; lx <= 9; lx++) {
      const r = ctx.rand(lx * 7);
      if (r < 0.3) ctx.setIfAir(lx, g0 + 3, r < 0.15 ? 1 : 2, "mushroom_brown");
      else if (r < 0.38) ctx.setIfAir(lx, g0 + 3, 1, "glow_shroom");
    }
    ctx.setIfAir(10, g0 + 1, 3, "mushroom_red");
  },
  hooks: { lootCache: { local: [8, 1, 1], table: "auto", respawnSec: 360 } },
});

// --- stone_circle: older than any road; the stones hum at night -------------
register({
  id: "stone_circle",
  footprint: { w: 9, d: 9 },
  anchor: "conform",
  clearance: 10,
  maxSlope: 2,
  avoidWater: true,
  build(ctx) {
    const mat = ctx.def.biome === "swamp" ? "dark_stone" : "stone";
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      const lx = 4 + Math.round(Math.sin(ang) * 3.5);
      const lz = 4 + Math.round(Math.cos(ang) * 3.5);
      const g = ctx.g(lx, lz);
      const fallen = ctx.rand(k * 11) < ctx.ruinLevel * 0.3;
      ctx.fill(lx, g + 1, lz, lx, g + (fallen ? 1 : 3), lz, mat);
    }
    // crystal = danger + loot: the center stone still holds a charge
    const cg = ctx.g(4, 4);
    ctx.set(4, cg + 1, 4, mat);
    ctx.set(4, cg + 2, 4, ctx.def.biome === "swamp" ? "blue_crystal" : "crystal");
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const lx = 4 + Math.round(Math.sin(ang) * 2);
      const lz = 4 + Math.round(Math.cos(ang) * 2);
      if (ctx.rand(60 + k) < 0.6) ctx.setIfAir(lx, ctx.g(lx, lz) + 1, lz, "tall_grass");
    }
  },
  hooks: { spawnRegion: { local: [4, 4], r: 7 } },
});

// --- mine_adit: the dig that paid for the camp downhill — then stopped ------
register({
  id: "mine_adit",
  footprint: { w: 5, d: 10 },
  anchor: "conform",
  noClear: true,
  // ≥2 blocks of rise along the tunnel: real ≥3 slopes cover only ~2% of a
  // forest room and scatter under-filled; at 2 the timbered plank roof
  // covers the thin-cover stretch, so the adit still reads dug-in
  minSlope: 2,
  maxSlope: 14,
  groundRef: "lowEdge",
  avoidWater: true,
  build(ctx) {
    const G0 = ctx.groundY; // entrance ground; the hill rises along +z
    // carve the corridor + lay the floor
    for (let lz = 0; lz <= 9; lz++) {
      for (let lx = 1; lx <= 3; lx++) {
        ctx.set(lx, G0, lz, "path");
        ctx.fill(lx, G0 + 1, lz, lx, G0 + 3, lz, 0);
      }
      // wall the cut where the hillside hasn't risen over it yet
      for (const lx of [0, 4]) {
        if (ctx.b.g(...ctx.p(lx, lz)) <= G0 + 3) ctx.fill(lx, G0 + 1, lz, lx, G0 + 3, lz, "cobblestone");
      }
      // roof the shallow stretch (skip lz 0 — that's the open mouth)
      if (lz > 0) {
        for (let lx = 1; lx <= 3; lx++) {
          if (ctx.b.g(...ctx.p(lx, lz)) <= G0 + 4) ctx.set(lx, G0 + 4, lz, "planks");
        }
      }
    }
    // timber frames every few metres
    for (const lz of [0, 3, 6, 9]) {
      ctx.fill(1, G0 + 1, lz, 1, G0 + 3, lz, "log");
      ctx.fill(3, G0 + 1, lz, 3, G0 + 3, lz, "log");
      ctx.fill(1, G0 + 4, lz, 3, G0 + 4, lz, "planks");
    }
    // interrupted action: the gate hangs AJAR — barred sides, open middle
    ctx.fill(1, G0 + 1, 1, 1, G0 + 2, 1, "iron_bars");
    ctx.set(3, G0 + 1, 1, "iron_bars");
    // the miners' lanterns still burn (someone means to come back)
    ctx.set(1, G0 + 1, 4, "lantern");
    ctx.set(3, G0 + 1, 7, "lantern");
    // crystal = danger + loot: the seam they hit right before they stopped
    ctx.set(1, G0 + 1, 9, "ember_crystal");
    ctx.set(3, G0 + 1, 9, "ember_crystal");
  },
  hooks: { lootCache: { local: [2, 1, 8], table: "auto", respawnSec: 480 } },
});

// --- hermit_hut: one person who chose the wilds on purpose -------------------
register({
  id: "hermit_hut",
  footprint: { w: 7, d: 6 },
  anchor: "flatten",
  clearance: 10,
  maxSlope: 3,
  avoidWater: true,
  build(ctx) {
    const FL = ctx.groundY + 1;
    // 5×5 hut at lx 0..4: plank walls, log corners, glass windows
    for (let lx = 0; lx <= 4; lx++) {
      for (const lz of [0, 4]) ctx.fill(lx, FL, lz, lx, FL + 1, lz, "planks");
    }
    for (let lz = 1; lz <= 3; lz++) {
      for (const lx of [0, 4]) ctx.fill(lx, FL, lz, lx, FL + 1, lz, "planks");
    }
    for (const [lx, lz] of [
      [0, 0],
      [4, 0],
      [0, 4],
      [4, 4],
    ] as const) {
      ctx.fill(lx, FL, lz, lx, FL + 1, lz, "log");
    }
    ctx.set(0, FL + 1, 2, "glass");
    ctx.set(4, FL + 1, 2, "glass");
    // door gap facing the garden
    ctx.fill(2, FL, 4, 2, FL + 1, 4, 0);
    // thatch roof, two shrinking layers
    ctx.fill(0, FL + 2, 0, 4, FL + 2, 4, "thatch");
    ctx.fill(1, FL + 3, 1, 3, FL + 3, 3, "thatch");
    // a hermit's wealth is books
    ctx.set(1, FL, 1, "bookshelf");
    ctx.set(3, FL, 1, "bookshelf");
    // light = language: the lantern by the door says somebody's home
    ctx.set(3, FL, 5, "lantern");
    // interrupted action: the herb garden is HALF harvested
    for (let lz = 0; lz <= 5; lz++) {
      for (let lx = 5; lx <= 6; lx++) {
        if ((lz + lx) % 2 === 0) ctx.setIfAir(lx, FL, lz, "tall_grass");
        else ctx.set(lx, ctx.groundY, lz, "dirt");
      }
    }
  },
  hooks: { lootCache: { local: [3, 1, 3], table: "auto", respawnSec: 420 } },
});

// --- causeway_bridge: the old road refuses to fully drown -------------------
register({
  id: "causeway_bridge",
  footprint: { w: 3, d: 16 },
  anchor: "conform",
  noClear: true,
  clearance: 6,
  maxSlope: 8,
  nearWater: true,
  build(ctx) {
    const wl = ctx.def.terrain.waterLevel;
    const deckY = (wl ?? ctx.groundY) + 1;
    for (let lz = 0; lz <= 15; lz++) {
      // every ~7th plank is gone — mind the gap
      const missing = ctx.rand(101 + lz) < 0.15;
      if (!missing) {
        for (let lx = 0; lx <= 2; lx++) ctx.set(lx, deckY, lz, "planks");
      }
      if (lz % 4 === 0) {
        for (const lx of [0, 2]) {
          const g = ctx.g(lx, lz);
          if (g + 1 <= deckY - 1) ctx.fill(lx, g + 1, lz, lx, deckY - 1, lz, "log");
        }
      }
    }
  },
});

// --- ruined_aqueduct: the empire that built it is three names ago -----------
register({
  id: "ruined_aqueduct",
  footprint: { w: 3, d: 24 },
  anchor: "conform",
  clearance: 12,
  maxSlope: 4,
  avoidWater: true,
  build(ctx) {
    const mat = ctx.def.biome === "desert" ? "sandstone" : "marble";
    const deckY = ctx.groundY + 6;
    const breakStart = 9 + Math.floor(ctx.rand(3) * 4);
    const breakEnd = breakStart + 3;
    for (let lz = 0; lz <= 23; lz++) {
      const broken = lz >= breakStart && lz <= breakEnd;
      // pillar pairs march every 4th block
      if (lz % 4 === 1) {
        for (const lx of [0, 2]) {
          const g = ctx.g(lx, lz);
          const top = broken ? g + 1 + Math.floor(ctx.rand(lz * 3 + lx) * 2) : deckY - 1;
          if (top >= g + 1) ctx.fill(lx, g + 1, lz, lx, top, lz, mat);
        }
      }
      if (!broken) {
        // channel deck + side rails (rails take ruin bites)
        for (let lx = 0; lx <= 2; lx++) ctx.set(lx, deckY, lz, mat);
        for (const lx of [0, 2]) {
          if (ctx.rand(200 + lz * 5 + lx) > 0.2 * (1 + ctx.ruinLevel)) ctx.set(lx, deckY + 1, lz, mat);
        }
      } else {
        // rubble field under the collapse
        if (ctx.rand(300 + lz) < 0.5) {
          const lx = Math.floor(ctx.rand(310 + lz) * 3);
          ctx.setIfAir(lx, ctx.g(lx, lz) + 1, lz, "cobblestone");
        }
      }
    }
  },
  // the cache sits ON the far deck — you have to climb/parkour the break
  hooks: { lootCache: { local: [1, 7, 20], table: "auto", respawnSec: 480 } },
});

// --- bandit_fort: the reason caravans pay for guards -------------------------
register({
  id: "bandit_fort",
  footprint: { w: 15, d: 12 },
  anchor: "flatten",
  clearance: 12,
  maxSlope: 5,
  floor: "dirt",
  avoidWater: true,
  build(ctx) {
    const FL = ctx.groundY + 1;
    // palisade ring with a south gate
    for (let lx = 0; lx <= 14; lx++) {
      for (const lz of [0, 11]) {
        if (lz === 11 && lx >= 6 && lx <= 8) continue; // gate gap
        ctx.fill(lx, FL, lz, lx, FL + 2, lz, "palisade");
      }
    }
    for (let lz = 1; lz <= 10; lz++) {
      for (const lx of [0, 14]) ctx.fill(lx, FL, lz, lx, FL + 2, lz, "palisade");
    }
    // gate posts fly the band's colors
    ctx.fill(5, FL, 11, 5, FL + 3, 11, "log");
    ctx.fill(9, FL, 11, 9, FL + 3, 11, "log");
    ctx.set(5, FL + 4, 11, "banner");
    ctx.set(9, FL + 4, 11, "banner");
    // corner watchtower: log frame, plank platform, torch (INHABITED — lit)
    for (const [lx, lz] of [
      [1, 1],
      [3, 1],
      [1, 3],
      [3, 3],
    ] as const) {
      ctx.fill(lx, FL, lz, lx, FL + 3, lz, "log");
    }
    ctx.fill(1, FL + 4, 1, 3, FL + 4, 3, "planks");
    ctx.set(2, FL + 5, 2, "torch");
    // two lean-tos against the east wall
    for (const z0 of [1, 8]) {
      for (let lx = 10; lx <= 12; lx++) ctx.fill(lx, FL, z0, lx, FL + 1, z0, "planks");
      ctx.fill(10, FL + 2, z0, 12, FL + 2, z0 + 1, "thatch");
    }
    // fire ring center — the pot's still warm
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        ctx.set(7 + dx, ctx.groundY, 6 + dz, "cobblestone");
      }
    }
    ctx.set(7, FL, 6, "torch");
    // interrupted action: loot crates half-stacked, one knocked over
    ctx.set(11, FL, 4, "planks");
    ctx.set(12, FL, 5, "planks");
    // hay bedrolls in the south lean-to shadow
    ctx.set(11, FL, 9, "hay");
    ctx.set(12, FL, 9, "hay");
  },
  hooks: {
    lootCache: { local: [11, 1, 2], table: "auto", respawnSec: 420 },
    spawnRegion: { local: [7, 6], r: 10 },
  },
});

// --- sunken_temple: a drowned kingdom's high sanctum -------------------------
register({
  id: "sunken_temple",
  footprint: { w: 20, d: 16 },
  anchor: "flatten",
  clearance: 14,
  maxSlope: 6,
  floor: "mossy_cobblestone",
  build(ctx) {
    const G = ctx.groundY;
    const FL = G + 1;
    // marble colonnade around the floor plate, half toppled
    const pillars: Array<[number, number]> = [];
    for (const lx of [2, 5, 8, 11, 14, 17]) {
      pillars.push([lx, 2], [lx, 13]);
    }
    for (const lz of [5, 8, 11]) {
      pillars.push([2, lz], [17, lz]);
    }
    for (const [lx, lz] of pillars) {
      const bite = Math.floor(ctx.rand(lx * 31 + lz) * (2 + ctx.ruinLevel * 2));
      const h = Math.max(1, 4 - bite);
      ctx.fill(lx, FL, lz, lx, FL + h - 1, lz, "marble");
      // vines reclaim the taller drums
      if (h >= 3 && ctx.rand(500 + lx + lz) < 0.6) ctx.setIfAir(lx + 1, FL + 1, lz, "vines");
    }
    // the floor floods in patches — the marsh is winning
    for (let lz = 4; lz <= 11; lz++) {
      for (let lx = 4; lx <= 15; lx++) {
        if (ctx.rand(700 + lx * 17 + lz) < 0.12) ctx.set(lx, G, lz, "water");
      }
    }
    // altar dais at the north end; crystal = danger + loot
    ctx.fill(8, FL, 3, 11, FL, 4, "marble");
    ctx.set(9, FL + 1, 3, "marble");
    ctx.set(9, FL + 2, 3, "blue_crystal");
  },
  hooks: {
    lootCache: { local: [10, 1, 2], table: "auto", respawnSec: 600 },
    spawnRegion: { local: [10, 8], r: 10 },
  },
});

// --- forge_ruin: the dwarven forge that burned its own mountain --------------
register({
  id: "forge_ruin",
  footprint: { w: 22, d: 18 },
  anchor: "flatten",
  clearance: 14,
  maxSlope: 6,
  floor: "obsidian",
  build(ctx) {
    const G = ctx.groundY;
    const FL = G + 1;
    // dark brick shell with collapse bites; 3-wide south gate
    for (let lx = 0; lx <= 21; lx++) {
      for (const lz of [0, 17]) {
        if (lz === 17 && lx >= 10 && lx <= 12) continue;
        const bite = Math.floor(ctx.rand(lx * 7 + lz) * (1 + ctx.ruinLevel));
        ctx.fill(lx, FL, lz, lx, FL + Math.max(2, 4 - bite), lz, "dark_bricks");
      }
    }
    for (let lz = 1; lz <= 16; lz++) {
      for (const lx of [0, 21]) {
        const bite = Math.floor(ctx.rand(lz * 11 + lx) * (1 + ctx.ruinLevel));
        ctx.fill(lx, FL, lz, lx, FL + Math.max(2, 4 - bite), lz, "dark_bricks");
      }
    }
    // banner pair over the gate — the forge clan's mark, soot-black now
    ctx.set(9, FL + 4, 17, "banner");
    ctx.set(13, FL + 4, 17, "banner");
    ctx.fill(9, FL, 17, 9, FL + 3, 17, "dark_bricks");
    ctx.fill(13, FL, 17, 13, FL + 3, 17, "dark_bricks");
    // lava trenches feed the floor from both flanks
    for (let lz = 3; lz <= 14; lz++) {
      ctx.set(5, G, lz, "lava");
      ctx.set(16, G, lz, "lava");
    }
    // the great furnace: work stopped mid-smelt
    ctx.fill(10, FL, 3, 12, FL + 1, 3, "dark_bricks");
    ctx.set(11, FL, 4, "lava");
    ctx.set(10, FL, 5, "charred_log");
    ctx.set(11, FL, 5, "charred_log");
    // ember crystals vein the corners
    for (const [lx, lz] of [
      [2, 2],
      [19, 2],
      [2, 15],
      [19, 15],
    ] as const) {
      ctx.set(lx, FL, lz, "ember_crystal");
    }
  },
  hooks: { spawnRegion: { local: [11, 9], r: 8 } },
});

// --- spider_hollow: the trees died first; then the webs came -----------------
register({
  id: "spider_hollow",
  footprint: { w: 8, d: 8 },
  anchor: "conform",
  clearance: 8,
  maxSlope: 3,
  avoidWater: true,
  build(ctx) {
    // dead snag cluster
    for (const [lx, lz, h] of [
      [2, 2, 4],
      [5, 3, 3],
      [3, 6, 3],
    ] as const) {
      const g = ctx.g(lx, lz);
      ctx.fill(lx, g + 1, lz, lx, g + h, lz, "pale_log");
      ctx.setIfAir(lx, g + h + 1, lz, "web");
    }
    // webs strung across the ground
    for (let i = 0; i < 10; i++) {
      const lx = Math.floor(ctx.rand(i * 3) * 8);
      const lz = Math.floor(ctx.rand(i * 3 + 1) * 8);
      ctx.setIfAir(lx, ctx.g(lx, lz) + 1, lz, "web");
    }
    // what the webs kept
    for (let i = 0; i < 3; i++) {
      const lx = Math.floor(ctx.rand(80 + i) * 8);
      const lz = Math.floor(ctx.rand(90 + i) * 8);
      ctx.setIfAir(lx, ctx.g(lx, lz) + 1, lz, "bone_block");
    }
    // egg mounds — the interrupted action here is YOURS if you linger
    for (const [lx, lz] of [
      [6, 2],
      [1, 5],
    ] as const) {
      const g = ctx.g(lx, lz);
      ctx.set(lx, g + 1, lz, "bone_block");
      ctx.setIfAir(lx, g + 2, lz, "web");
    }
    // the cache is wrapped in silk at the hollow's heart
    const cg = ctx.g(6, 6);
    for (const [lx, lz] of [
      [5, 6],
      [7, 6],
      [6, 5],
      [6, 7],
    ] as const) {
      ctx.setIfAir(lx, cg + 1, lz, "web");
    }
  },
  hooks: {
    lootCache: { local: [6, 1, 6], table: "auto", respawnSec: 420 },
    spawnRegion: { local: [4, 4], r: 7 },
  },
});
