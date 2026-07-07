import { type RoomDef } from "@fantasy-mmo/common";
import type { ScatterResult } from "./prefabs.js";
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
    /** Set only if the cell is currently air (tree canopies, decorations). */
    setIfAir(x: number, y: number, z: number, id: number): void;
    solidAt(x: number, y: number, z: number): boolean;
    liquidAt(x: number, y: number, z: number): boolean;
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