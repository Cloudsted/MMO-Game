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
export declare function stampStructures(world: VoxelWorld, def: RoomDef): void;
//# sourceMappingURL=voxelstructures.d.ts.map