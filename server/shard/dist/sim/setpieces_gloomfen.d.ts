/**
 * Gloomfen setpieces (design doc `docs/content-design-2.md` §8, S1/S2/S3).
 *
 * The owner said the Gloomfen "feels empty and soulless." It is a flat grey
 * plate under thirty wasted blocks of sky, threaded by a causeway that was a
 * missing-plank mechanic pretending to be a story. These three functions give
 * the marsh a skyline, a church, and a road that tells you in light how far you
 * are from anything that loves you.
 *
 *   S1  buildDrownbell           — the Leaning Campanile of Ysmere
 *   S2  buildTidewardenTemple    — the Temple of the Tidewardens
 *   S3  buildLamplightersRoad    — the causeway, rematerialised
 *
 * The integrator wires these into `buildGloomfen` (replacing the old causeway
 * loop and the prefab-stamped `sunken_temple`), adds the exclusion rects each
 * one hands back, and binds `stampFixed` to `stampPrefab`. Caches and spawn
 * anchors these functions cannot push themselves (no `features` handle) are
 * exported below as data for the integrator to fold into the ScatterResult.
 *
 * DETERMINISM CONTRACT: every non-authored choice is `hash2(seed ^ salt, x, z)`;
 * never Math.random / Date.now. Same seed → byte-identical marsh every boot.
 */
import { type RoomDef } from "@fantasy-mmo/common";
import type { Rect } from "./prefabs.js";
import type { Builder } from "./voxelstructures.js";
export interface SetpieceCache {
    x: number;
    y: number;
    z: number;
    table: string;
    respawnSec: number;
    note: string;
}
export interface SetpieceSpawn {
    x: number;
    z: number;
    r: number;
    mobs: Array<{
        mob: string;
        weight: number;
        level?: number;
    }>;
    maxAlive: number;
    packSize: [number, number];
    respawnSec: number;
    note: string;
}
export declare const DROWNBELL_EXCLUSION: Rect;
export declare const TEMPLE_EXCLUSION: Rect;
export declare const GLOOMFEN_SETPIECE_CACHES: SetpieceCache[];
export declare const GLOOMFEN_SETPIECE_SPAWNS: SetpieceSpawn[];
export declare const TEMPLE_GUARD_RECENTER: {
    tableId: string;
    x: number;
    z: number;
};
export declare const TEMPLE_DAIS_RESERVED: {
    x: number;
    z: number;
    r: number;
};
export declare const LAMPLIGHTERS_ROAD_EXCLUSIONS: Rect[];
export declare function buildDrownbell(b: Builder, def: RoomDef): Rect;
export declare function buildTidewardenTemple(b: Builder, def: RoomDef): Rect;
export declare function buildLamplightersRoad(b: Builder, def: RoomDef, stampFixed: (id: string, ox: number, oz: number, rot: 0 | 1 | 2 | 3, ruin: 0 | 1 | 2) => void): void;
//# sourceMappingURL=setpieces_gloomfen.d.ts.map