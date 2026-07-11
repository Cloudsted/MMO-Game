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
import { type RoomDef, type SpawnTable } from "@fantasy-mmo/common";
import { type VoxelWorld } from "./voxel.js";
import type { BlockGrid, Builder } from "./voxelstructures.js";
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
    /**
     * Rotation-aware `Builder.plate`: stamp a 2-D character grid in LOCAL space,
     * so a prefab's source reads like the thing it builds and still rotates.
     * `rows[0]` is always the top row as written.
     *   axis "x" — wall in the local x/y plane: columns +lx, rows DOWN from y.
     *   axis "z" — wall in the local z/y plane: columns +lz, rows DOWN from y.
     *   axis "y" — floor plan at constant y: columns +lx, rows +lz.
     * ' ' leaves whatever is there; '.' is air; everything else needs a legend.
     *
     * (Never call `ctx.b.plate` from a prefab — Builder.plate is world-space and
     * would ignore the placement rotation.)
     */
    plate(lx: number, y: number, lz: number, axis: "x" | "y" | "z", rows: string[], legend: Record<string, string | number>): void;
    /** Floor y for a chamber dug `depth` below this prefab's ground, clamped off
     *  bedrock (see Builder.digFloorY). A shaft in low ground gets shallower. */
    digFloorY(depth: number): number;
    /** deterministic [0,1) — hash2 over room seed ^ prefab salt ^ salt */
    rand(salt: number): number;
    /** Per-cell light-emission override (rotation-aware local x/z, ABSOLUTE
     *  world y) — see Builder.lightAt: replaces the block's registry light for
     *  that cell; works on air (invisible fill light) and in both directions. */
    lightAt(lx: number, y: number, lz: number, level: number): void;
}
export interface PrefabDef {
    id: string;
    footprint: {
        w: number;
        d: number;
    };
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
        lootCache?: {
            local: [number, number, number];
            table: string;
            respawnSec: number;
        };
        /** dynamic spawn anchor; `table` payload merges a new spawn table at gen
         *  time, or the scatter entry's bindSpawnTable re-centers a def table */
        spawnRegion?: {
            local: [number, number];
            r: number;
            table?: SpawnRegionPayload;
        };
    };
}
/** spawnTable-shaped payload a prefab can bind to its site. A mob entry may
 *  carry a `level` override, exactly like a room-def spawn table — so a prefab
 *  in a deep room spawns its guards SCALED (a bandit at the site of a Gloomfen
 *  outfall is an L11 bandit, not the L4 one its def authors). Without this the
 *  payload spawns everything at base level, which under-levels a deep-room
 *  guard into weak, farmable trash (the dry_cistern-slime finding). */
export interface SpawnRegionPayload {
    mobs: Array<{
        mob: string;
        weight: number;
        level?: number;
    }>;
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
    spawnRegion?: {
        x: number;
        z: number;
        r: number;
        table?: SpawnRegionPayload;
    };
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
    bindings: Array<{
        tableId: string;
        x: number;
        z: number;
    }>;
    /** prefab-carried spawn tables merged into the room at gen time */
    extraTables: SpawnTable[];
    underfill: Array<{
        prefab: string;
        wanted: number;
        placed: number;
    }>;
}
export declare function emptyScatterResult(): ScatterResult;
/**
 * Stamp a prefab with its anchor rule at world min-corner (ox, oz). Used by
 * the scatter placer, authored room builders, and the /prefab admin command
 * (the latter through an EditRecorder so edits persist + /clearblocks wipes).
 * Returns the prefab's hooks resolved to world coordinates.
 */
export declare function stampPrefab(b: Builder, prefabId: string, ox: number, oz: number, rot: 0 | 1 | 2 | 3, ruinLevel: 0 | 1 | 2): StampedHooks;
/**
 * Deterministic scatter: for each config entry (array order — earlier entries
 * claim ground first) run hash2-driven candidates; the first half of the
 * candidate budget enforces near/nearPrefab/nearPortals (candidates are drawn
 * around the anchor so they can actually hit), the second half relaxes those
 * soft constraints. Hard rules (bounds, spawn/portal exclusion, slope, water,
 * spacing, authored rects) always apply. Under-fill is fine and logged.
 */
export declare function scatterPrefabs(b: Builder, def: RoomDef, exclusions: Rect[]): ScatterResult;
export declare class EditRecorder implements BlockGrid {
    private readonly base;
    private pending;
    constructor(base: VoxelWorld);
    get(x: number, y: number, z: number): number;
    set(x: number, y: number, z: number, id: number): void;
    setIfAir(x: number, y: number, z: number, id: number): void;
    solidAt(x: number, y: number, z: number): boolean;
    terrainHeight(def: RoomDef, x: number, z: number): number;
    cells(): Array<{
        x: number;
        y: number;
        z: number;
        id: number;
    }>;
}
export declare const PREFABS: Record<string, PrefabDef>;
//# sourceMappingURL=prefabs.d.ts.map