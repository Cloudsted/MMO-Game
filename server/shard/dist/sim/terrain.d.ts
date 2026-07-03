/**
 * Room terrain: deterministic seeded heightmap + ground-type map + prop
 * scatter, plus an optional authored map overlay (flattened areas, painted
 * ground, hand-placed props, walls) produced by tools/build-maps.mjs.
 * "Generate-once-then-persist" is currently satisfied by determinism (same
 * seed → identical terrain every boot); mutable room state persists via room
 * snapshots. The client receives this exact data over the wire — both sides
 * sample the SAME arrays, nothing is generated client-side.
 *
 * NEVER change the noise functions once rooms ship — they are the world.
 */
import { type RoomDef } from "@fantasy-mmo/common";
export declare const GROUND_GRASS = 0;
export declare const GROUND_DIRT = 1;
export declare const GROUND_STONE = 2;
export declare const GROUND_SAND = 3;
export interface PropInstance {
    id: number;
    type: string;
    x: number;
    z: number;
    /** collision cylinder radius in metres; 0 = walk-through */
    r: number;
    /** visual scale multiplier */
    s: number;
    /** facing in degrees (0 = front faces +Z); flat props only */
    rot: number;
}
export interface WallSegment {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    type: string;
}
export declare class Terrain {
    /** cells */
    readonly w: number;
    readonly h: number;
    /** vertex grid, (w+1)*(h+1), row-major, metres */
    readonly heights: Float32Array;
    /** vertex grid ground types (GROUND_*) */
    readonly types: Uint8Array;
    readonly props: PropInstance[];
    readonly walls: WallSegment[];
    readonly waterLevel: number | null;
    constructor(def: RoomDef);
    private applyFlatten;
    private applyPaints;
    private authoredProps;
    private slopeAtVertex;
    /** Bilinear height sample; clamps to bounds. THE ground truth for movement. */
    heightAt(x: number, z: number): number;
    /** True when (x,z) is inside a solid prop cylinder or wall segment. */
    collides(x: number, z: number): boolean;
    private scatterProps;
    private slopeAt;
    /** Wire form: heights as int16 centimetres LE, types as bytes, both base64. */
    encode(): {
        w: number;
        h: number;
        heightsB64: string;
        typesB64: string;
        waterLevel: number | null;
    };
}
/** Distance from point (px,pz) to segment (x0,z0)-(x1,z1). */
export declare function distToSegment(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number;
//# sourceMappingURL=terrain.d.ts.map