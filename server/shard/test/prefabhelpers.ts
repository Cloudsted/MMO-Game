/**
 * Shared test harness for the prefab catalog.
 *
 * Four tier test-suites and `prefabs.test.ts` all need the same three things:
 * a world to stamp into, a way to prove a player can physically REACH a loot
 * cache, and a way to prove a prefab wrote nothing outside its own footprint.
 * Those three things used to live inline in `prefabs.test.ts`; they live here
 * now so that all five suites hold prefabs to the same standard.
 *
 * The movement BFS (`canReach`) is deliberately MORE conservative than the
 * real client physics (jump apex 1.28 m, player height <1.8 m, radius 0.3).
 * That asymmetry is the whole point: if this cramped little walker reaches the
 * cache, a real player certainly does. Loosen it only with a reason.
 */
import {
  isLiquidBlock,
  isSolidBlock,
  RoomDefSchema,
  WORLD_HEIGHT,
  type RoomDef,
} from "@fantasy-mmo/common";
import { PREFABS } from "../src/sim/prefabs.js";
import { VoxelWorld } from "../src/sim/voxel.js";
import type { BlockGrid } from "../src/sim/voxelstructures.js";

// ---------------------------------------------------------------------------
// Proving grounds
// ---------------------------------------------------------------------------

export interface ProvingOpts {
  /** room id — only matters if you build a RoomSim on it (cache table lookup) */
  id?: string;
  size?: number;
  base?: number;
  amplitude?: number;
  frequency?: number;
  seed?: number;
  biome?: string;
  /** omit (or null) for a room with no liquid at all */
  waterLevel?: number | null;
  liquid?: "water" | "murk_water" | "lava";
  treeDensity?: number;
  wind?: number;
  spawn?: { x: number; z: number; yaw?: number };
  portals?: unknown[];
  prefabs?: unknown[];
  spawnTables?: unknown[];
  npcs?: unknown[];
}

export interface ProvingGround {
  def: RoomDef;
  world: VoxelWorld;
}

/**
 * A minimal, schema-valid RoomDef. Everything a prefab's `build()` can read
 * off `ctx.def` (biome, terrain.waterLevel, terrain.liquid) is a knob here.
 */
export function provingDef(opts: ProvingOpts = {}): RoomDef {
  const size = opts.size ?? 96;
  const spawn = opts.spawn ?? { x: 10, z: 10 };
  return RoomDefSchema.parse({
    id: opts.id ?? "test-scatter",
    name: "Proving Grounds",
    type: "wilderness",
    biome: opts.biome ?? "grass",
    persistence: "stateful",
    ...(opts.wind === undefined ? {} : { wind: opts.wind }),
    size: { w: size, h: size },
    spawn: { x: spawn.x, z: spawn.z, yaw: spawn.yaw ?? 0 },
    terrain: {
      kind: "blocks",
      seed: opts.seed ?? 777,
      base: opts.base ?? 12,
      amplitude: opts.amplitude ?? 0,
      frequency: opts.frequency ?? 0.02,
      ...(opts.waterLevel === undefined || opts.waterLevel === null ? {} : { waterLevel: opts.waterLevel }),
      ...(opts.liquid ? { liquid: opts.liquid } : {}),
      ...(opts.treeDensity === undefined ? {} : { treeDensity: opts.treeDensity }),
    },
    flags: { safeZone: false, buildingEnabled: false, pvp: false },
    portals: opts.portals ?? [],
    spawnTables: opts.spawnTables ?? [],
    prefabs: opts.prefabs ?? [],
    npcs: opts.npcs ?? [],
  });
}

/**
 * Dead-flat ground at `base`, no water, no portals. The default for stamping a
 * single prefab in isolation and walking to its cache: nothing in the terrain
 * can help or hinder the climb, so a failure is the prefab's fault.
 *
 * (Defaults reproduce the world `prefabs.test.ts` has used since the watchtower
 * stair fix: 96², seed 777, base 12, amplitude 0.)
 */
export function flatProvingGround(size = 96, base = 12, opts: ProvingOpts = {}): ProvingGround {
  const def = provingDef({ size, base, amplitude: 0, ...opts });
  return { def, world: new VoxelWorld(def) };
}

/**
 * Real noisy terrain — the world a `conform` prefab actually lands in, where
 * `ctx.g(lx, lz)` differs per column and a flat-ground assumption produces
 * floating stairs and buried doorways. Defaults approximate the forest
 * (amplitude 7, waterLevel 11) at a size that stamps fast.
 */
export function slopedProvingGround(opts: ProvingOpts = {}): ProvingGround {
  const def = provingDef({
    size: 128,
    base: 13,
    amplitude: 7,
    frequency: 0.02,
    seed: 424242,
    waterLevel: 11,
    ...opts,
  });
  return { def, world: new VoxelWorld(def) };
}

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

export interface ReachOpts {
  /** liquid cells are traversable and can be ascended/descended 1/step */
  allowSwim?: boolean;
  /** conservative free-fall budget per step (client physics survives far more) */
  maxDrop?: number;
  /** override the start feet-Y (default: world.floorY of the start column) */
  startY?: number;
  /** safety valve; a 96² proving ground explores well under this */
  maxNodes?: number;
}

/**
 * Conservative movement BFS over (cell, feetY) states, lifted verbatim from
 * `prefabs.test.ts` and extended with swimming:
 *
 *  - 4-dir level walks;
 *  - 1-block jump mounts, which additionally need a free cell above the head
 *    at BOTH the take-off and the landing column;
 *  - drops up to `maxDrop` (3) with a clear fall corridor;
 *  - SWIMMING: a liquid cell is a valid pose (feet in liquid, head not in
 *    stone) with no solid needed underfoot, and buoyancy lets the player
 *    ascend — or sink — exactly one block per step within the same column.
 *    That is what makes a 1-wide flooded shaft a two-way street: swim down to
 *    a sunken cache, swim back up, climb out onto the bank with an ordinary
 *    jump mount. There is no drowning in this game, so depth costs nothing.
 *
 * Walk/jump/drop stay exactly as they were. If THIS reaches the target, real
 * physics does.
 */
export function canReach(
  world: VoxelWorld,
  sx: number,
  sz: number,
  tx: number,
  tz: number,
  ty: number,
  opts: ReachOpts = {}
): boolean {
  const allowSwim = opts.allowSwim ?? true;
  const maxDrop = opts.maxDrop ?? 3;
  const maxNodes = opts.maxNodes ?? 400_000;

  const free = (x: number, y: number, z: number) => !isSolidBlock(world.get(x, y, z));
  const liquid = (x: number, y: number, z: number) => isLiquidBlock(world.get(x, y, z));
  const standing = (x: number, y: number, z: number) => !free(x, y - 1, z) && free(x, y, z) && free(x, y + 1, z);
  /** feet in the liquid, head out of the rock: buoyancy holds you here */
  const swimming = (x: number, y: number, z: number) => allowSwim && liquid(x, y, z) && free(x, y + 1, z);
  const pose = (x: number, y: number, z: number) => standing(x, y, z) || swimming(x, y, z);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  const start = { x: sx, y: opts.startY ?? world.floorY(sx + 0.5, sz + 0.5), z: sz };
  const seen = new Set([key(start.x, start.y, start.z)]);
  const queue = [start];
  let popped = 0;
  const drops: number[] = [];
  for (let d = 1; d <= maxDrop; d++) drops.push(-d);

  while (queue.length > 0) {
    if (++popped > maxNodes) return false;
    const c = queue.shift()!;
    if (c.x === tx && c.z === tz && c.y === ty) return true;
    const push = (x: number, y: number, z: number) => {
      const k = key(x, y, z);
      if (seen.has(k)) return;
      seen.add(k);
      queue.push({ x, y, z });
    };
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = c.x + dx;
      const nz = c.z + dz;
      for (const dy of [1, 0, ...drops]) {
        const ny = c.y + dy;
        if (ny < 1 || ny >= WORLD_HEIGHT || !pose(nx, ny, nz)) continue;
        if (dy === 1 && (!free(c.x, c.y + 2, c.z) || !free(nx, c.y + 2, nz))) continue; // jump arc headroom
        if (dy < 0) {
          let corridor = true;
          for (let y = ny + 2; y <= c.y + 1 && corridor; y++) corridor = free(nx, y, nz);
          if (!corridor) continue;
        }
        push(nx, ny, nz);
      }
    }
    // buoyancy: one block up or down per step, in the same column, through liquid
    if (allowSwim) {
      if (swimming(c.x, c.y + 1, c.z)) push(c.x, c.y + 1, c.z);
      if (c.y - 1 >= 1 && swimming(c.x, c.y - 1, c.z)) push(c.x, c.y - 1, c.z);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

export interface ProbeWrite {
  x: number;
  y: number;
  z: number;
  id: number;
}

export interface ProbeRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface ViolationOpts {
  /**
   * How far outside the footprint an AIR write is tolerated. `stampPrefab`
   * clears a 1-block margin around the rotated footprint before calling
   * build(), and that clear is air-only — so 1 is correct for every prefab
   * that does not set `noClear`, and 0 is correct for the ones that do.
   */
  clearPad?: number;
  yMin?: number;
  yMax?: number;
}

/**
 * A `BlockGrid` that remembers every write attempt (including the ones the
 * real world silently drops for being out of bounds — those are exactly the
 * bugs we are hunting) and forwards it to the world underneath.
 *
 * Use it as the Builder's grid: `stampPrefab(new Builder(probe, def), ...)`.
 */
export class ContainmentProbe implements BlockGrid {
  readonly writes: ProbeWrite[] = [];

  constructor(private readonly base: VoxelWorld) {}

  get(x: number, y: number, z: number): number {
    return this.base.get(x, y, z);
  }

  set(x: number, y: number, z: number, id: number): void {
    this.writes.push({ x, y, z, id });
    this.base.set(x, y, z, id); // out-of-bounds writes are dropped here, not hidden
  }

  setIfAir(x: number, y: number, z: number, id: number): void {
    if (this.base.get(x, y, z) === 0) this.set(x, y, z, id);
  }

  solidAt(x: number, y: number, z: number): boolean {
    return this.base.solidAt(x, y, z);
  }

  terrainHeight(def: RoomDef, x: number, z: number): number {
    return this.base.terrainHeight(def, x, z);
  }

  /** forget everything recorded so far (e.g. between two stamps) */
  reset(): void {
    this.writes.length = 0;
  }

  /** min/max of every recorded write, or null if nothing was written */
  bounds(): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null {
    if (this.writes.length === 0) return null;
    const b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
    for (const w of this.writes) {
      b.x0 = Math.min(b.x0, w.x);
      b.y0 = Math.min(b.y0, w.y);
      b.z0 = Math.min(b.z0, w.z);
      b.x1 = Math.max(b.x1, w.x);
      b.y1 = Math.max(b.y1, w.y);
      b.z1 = Math.max(b.z1, w.z);
    }
    return b;
  }

  /**
   * Every write that escaped the prefab's footprint. A NON-AIR write outside
   * the rect is always a violation — that is a block landing on whatever the
   * scatter placer put next door, and nothing protected it. An AIR write is
   * tolerated inside `clearPad` blocks of the rect, because `stampPrefab`'s
   * own pre-build clear legitimately reaches one block out.
   */
  violations(rect: ProbeRect, opts: ViolationOpts = {}): ProbeWrite[] {
    const clearPad = opts.clearPad ?? 1;
    const yMin = opts.yMin ?? 1;
    const yMax = opts.yMax ?? WORLD_HEIGHT - 1;
    const outside = (w: ProbeWrite, pad: number) =>
      w.x < rect.x0 - pad || w.x > rect.x1 + pad || w.z < rect.z0 - pad || w.z > rect.z1 + pad;
    return this.writes.filter((w) => {
      if (w.y < yMin || w.y > yMax) return true;
      return outside(w, w.id === 0 ? clearPad : 0);
    });
  }
}

export function containmentProbe(world: VoxelWorld): ContainmentProbe {
  return new ContainmentProbe(world);
}

/** The world-space rect a prefab occupies when stamped at (ox, oz) with `rot`. */
export function footprintRect(prefabId: string, ox: number, oz: number, rot: 0 | 1 | 2 | 3): ProbeRect {
  const pdef = PREFABS[prefabId];
  if (!pdef) throw new Error(`footprintRect: unknown prefab ${prefabId}`);
  const rw = rot % 2 ? pdef.footprint.d : pdef.footprint.w;
  const rd = rot % 2 ? pdef.footprint.w : pdef.footprint.d;
  return { x0: ox, z0: oz, x1: ox + rw - 1, z1: oz + rd - 1 };
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * A cheap, stable hash of the whole voxel array. Two independent 32-bit mixes
 * plus the length: enough to make "stamping twice gave a different grid" a
 * one-line assertion, and enough that an accidental collision is not a thing
 * you will meet.
 */
export function gridHash(world: VoxelWorld | Uint8Array): string {
  const data = world instanceof Uint8Array ? world : world.data;
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0xc2b2ae35 | 0;
  for (let i = 0; i < data.length; i++) {
    const b = data[i]!;
    h1 = Math.imul(h1 ^ b, 0x01000193);
    h2 = Math.imul((h2 + b) ^ (h2 >>> 13), 0x85ebca6b);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(h1)}${hex(h2)}:${data.length}`;
}
