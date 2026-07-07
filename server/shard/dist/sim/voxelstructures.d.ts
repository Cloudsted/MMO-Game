/**
 * Authored block structures, stamped over generated terrain — the block-built
 * replacement for the old prop/map system. Every portal gets a stone archway;
 * each room adds its own set pieces (hub city, forest arena, desert ruins +
 * oasis, the crypt, the grounds pavilion). All deterministic: layout comes
 * from constants + seeded hashes, never Math.random.
 *
 * Convention: G = terrain surface block y (terrainHeight), FL = G+1 = the y
 * a creature's feet occupy standing on the surface. Builders never touch y 0
 * (bedrock).
 */
import { type RoomDef } from "@fantasy-mmo/common";
import { type VoxelWorld } from "./voxel.js";
import { type ScatterResult } from "./prefabs.js";
/** The block surface Builder (and prefabs) write through. VoxelWorld
 *  satisfies it structurally; /prefab's EditRecorder satisfies it too, so
 *  admin stamps route through the persistence overlay instead of gen. */
export interface BlockGrid {
    get(x: number, y: number, z: number): number;
    set(x: number, y: number, z: number, id: number): void;
    setIfAir(x: number, y: number, z: number, id: number): void;
    solidAt(x: number, y: number, z: number): boolean;
    terrainHeight(def: RoomDef, x: number, z: number): number;
}
export declare function stampStructures(world: VoxelWorld, def: RoomDef): ScatterResult;
export declare class Builder {
    readonly world: BlockGrid;
    readonly def: RoomDef;
    constructor(world: BlockGrid, def: RoomDef);
    g(x: number, z: number): number;
    set(x: number, y: number, z: number, block: string | number): void;
    fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string | number): void;
    /** Remove everything above the ground plane (vegetation, tree canopies). */
    clearAbove(x0: number, z0: number, x1: number, z1: number, groundY: number, height?: number): void;
    /** Level a rect: terrain columns forced to groundY (dirt under, surface on top). */
    flatten(x0: number, z0: number, x1: number, z1: number, groundY: number, surface: string): void;
    /** Paint the surface block of existing terrain (roads, plazas). */
    paint(x0: number, z0: number, x1: number, z1: number, surface: string): void;
    paintCircle(cx: number, cz: number, r: number, surface: string): void;
    torch(x: number, y: number, z: number): void;
    /** Crenellated wall run along x or z at a fixed ground level. */
    wallRun(x0: number, z0: number, x1: number, z1: number, baseY: number, height: number, block?: string): void;
    tower(cx: number, cz: number, baseY: number, half: number, height: number, block?: string): void;
    /** Stone portal archway: two pillars + lintel, plus a path apron. */
    portalArch(px: number, pz: number, alongX: boolean): void;
    /** Thatch-roofed plank house with log posts, windows, a torch inside. */
    house(x0: number, z0: number, w: number, d: number, groundY: number, doorSide: "n" | "s" | "e" | "w"): void;
    /** Open market stall: log posts + flat thatch roof. */
    stall(x0: number, z0: number, w: number, d: number, groundY: number): void;
    /** Big landmark tree: thick trunk + layered canopy. */
    giantTree(cx: number, cz: number, groundY: number, trunkH?: number): void;
    /** Palm-ish oasis tree: tall bare trunk, small drooping canopy. */
    palm(x: number, z: number): void;
}
//# sourceMappingURL=voxelstructures.d.ts.map