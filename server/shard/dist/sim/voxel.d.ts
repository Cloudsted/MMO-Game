import { type RoomDef } from "@fantasy-mmo/common";
import type { ScatterResult } from "./prefabs.js";
/** The lowest y a dug chamber's FLOOR may occupy. y0 is bedrock and every
 *  Builder.set refuses y<1, so leaving y1 solid means no excavation can ever
 *  open onto the void under the world. Lives here — not in voxelstructures —
 *  so prefabs.ts can import it without closing a module cycle. */
export declare const MIN_DIG_FLOOR = 2;
export declare function hash2(seed: number, x: number, y: number): number;
export interface BlockEdit {
    x: number;
    y: number;
    z: number;
    id: number;
    /** character id that placed it (breaking refunds only player blocks) */
    owner: string | null;
}
export declare class VoxelWorld {
    readonly w: number;
    readonly h: number;
    readonly data: Uint8Array;
    readonly waterLevel: number | null;
    /** player edits keyed "x,y,z" — the persistence overlay */
    readonly edits: Map<string, BlockEdit>;
    /**
     * Authored per-cell light-emission overrides keyed "x,y,z" (0-15), written
     * by builders via Builder.lightAt / PrefabCtx.lightAt during generation —
     * deterministic gen output, like the blocks themselves. An override
     * REPLACES the block's registry `light` for that one cell when the client
     * seeds its blocklight flood: a lantern can burn low (13→9), a ward can
     * flare (7→11), and an override on a non-emissive cell (even AIR) becomes
     * an invisible fill light — the owner's "light the boss room without
     * ruining the atmosphere" tool. Glow-pass meshing still keys off the
     * block's registry glow flag, so an overridden crystal keeps its
     * full-bright faces and an air fill-light shows no source at all.
     */
    readonly lightOverrides: Map<string, number>;
    /** prefab-scatter output: placements, loot caches, spawn bindings —
     *  deterministic per def, so RoomSim can consume it every boot */
    readonly features: ScatterResult;
    /** pristine post-generation snapshot — edits that restore it are dropped */
    private genData;
    constructor(def: RoomDef);
    idx(x: number, y: number, z: number): number;
    inBounds(x: number, y: number, z: number): boolean;
    /** Block id at integer coords; out-of-bounds reads as air. */
    get(x: number, y: number, z: number): number;
    set(x: number, y: number, z: number, id: number): void;
    /** Author a per-cell light override (0-15; clamped, out-of-bounds ignored).
     *  Gen-time only — see the lightOverrides field doc. */
    setLightOverride(x: number, y: number, z: number, level: number): void;
    /** Light overrides for the wire, skipping cells a player edit currently
     *  covers (the override was authored for the GENERATED block; if the edit
     *  is later reverted the override ships again on the next join). Compact
     *  [x, y, z, level] tuples — tens of cells, not thousands. */
    lightsWire(): Array<[number, number, number, number]>;
    /** Set only if the cell is currently air (tree canopies, decorations). */
    setIfAir(x: number, y: number, z: number, id: number): void;
    solidAt(x: number, y: number, z: number): boolean;
    liquidAt(x: number, y: number, z: number): boolean;
    /**
     * Voxel line-of-sight: marches the segment at ~0.5 m steps and fails on any
     * solid block (liquids and cross decorations don't occlude — same rules as
     * projectile flight). `endSkip` metres are skipped at BOTH ends so an
     * endpoint's own cell never occludes it (the AudioEngine occlusion
     * precedent; entity eye/chest points sit in open cells anyway, but corner
     * rounding at the very ends would otherwise produce false walls).
     * Used by mob proximity aggro (eye ~1.4 → chest ~1.0), ranged attack
     * choice, and AoE splash gating — damage-based threat deliberately
     * bypasses it (if you hit a mob, it knows).
     */
    lineOfSight(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, endSkip?: number): boolean;
    /** Highest non-air block y at a column (-1 if the column is empty). */
    surfaceY(x: number, z: number): number;
    /** Feet Y for standing on top of the column's highest SOLID block. */
    standY(x: number, z: number): number;
    /**
     * Feet Y for the LOWEST walkable gap in a column: solid below, two
     * non-solid cells of headroom above. This is the FLOOR — the ground under
     * a tree canopy or a structure roof, where standY would return the top of
     * the canopy/roof itself. Falls back to standY when no gap exists.
     */
    floorY(x: number, z: number): number;
    /**
     * Feet Y of the walkable gap NEAREST refY in this column (solid below,
     * two non-solid cells above). Roofed interiors stack several gaps —
     * logging out in the great hall must not respawn you on its roof, and
     * logging out on a rampart must not drop you into the room below.
     * Falls back to standY when the column has no gap at all.
     */
    walkYNear(x: number, z: number, refY: number): number;
    /**
     * The ground level under an entity at (x, feetY, z): top of the highest
     * solid block at or below feetY across the entity's footprint. Overhang-
     * safe (a roof above doesn't count). Feet exactly on a block top belong
     * to the block below.
     */
    groundBelow(x: number, feetY: number, z: number, radius: number): number;
    /** True when a player-shaped AABB (feet at y) intersects any solid block. */
    collidesAABB(x: number, y: number, z: number, radius: number, height: number): boolean;
    editKey(x: number, y: number, z: number): string;
    /** Apply a player edit and remember it for room snapshots. An edit that
     *  restores the generated block (e.g. breaking a placed block over natural
     *  air) drops out of the overlay entirely. */
    applyEdit(x: number, y: number, z: number, id: number, owner: string | null): void;
    /** The edit record at a cell, if a player placed the current block. */
    editAt(x: number, y: number, z: number): BlockEdit | null;
    restoreEdits(edits: BlockEdit[]): void;
    serializeEdits(): BlockEdit[];
    /** Revert every player edit to the generated block. Returns reverted cells. */
    clearEdits(): Array<{
        x: number;
        y: number;
        z: number;
        id: number;
    }>;
    /** Full grid as deflated per-chunk payloads (base64). Chunk data is
     *  x-fastest, then z, then y — matching idx() within the chunk. */
    encodeChunks(): Array<{
        cx: number;
        cz: number;
        data: string;
    }>;
    /** Top-down map render for the admin dashboard: per-column color of the
     *  top-visible block, height-shaded (higher = brighter), as base64
     *  raw-deflate RGB bytes, row-major, x-fastest. ~w×h×3 bytes pre-deflate. */
    renderTopDown(): {
        w: number;
        h: number;
        data: string;
    };
    /** Terrain surface height (block y of the top solid terrain block). */
    terrainHeight(def: RoomDef, x: number, z: number): number;
    /** Trunk height at a column (0 = no tree here). Deterministic per column.
     *  Grass grows oaks; swamp grows pale dead trees; volcanic grows charred
     *  snags (same column/height rolls — the branch only opens for NEW biomes,
     *  so existing grass rooms stay byte-identical). */
    private treeAt;
    private generate;
}
//# sourceMappingURL=voxel.d.ts.map