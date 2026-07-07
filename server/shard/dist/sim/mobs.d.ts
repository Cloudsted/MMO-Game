/**
 * Mob AI: the decision layer (brain). A flat FSM per mob —
 * patrol/chase/flee/return — that communicates with the body (action FSM)
 * only through intents: "move toward X", "use ability at Y". That seam is
 * where behavior trees swap in later.
 */
import type { MobDef, SpawnTable } from "@fantasy-mmo/common";
import type { Entity } from "./entities.js";
import type { VoxelWorld } from "./voxel.js";
/** Min center-to-center distance between alive mobs (billboards ~1 m wide). */
export declare const MOB_SEPARATION = 0.9;
export interface MoveIntent {
    x: number;
    z: number;
    speedMult: number;
}
export interface BrainDecision {
    move: MoveIntent | null;
    attack: Entity | null;
    faceYaw: number | null;
}
/**
 * One brain tick. Pure decision — the caller applies movement (with terrain)
 * and routes attack intents into the shared action FSM.
 */
export declare function tickBrain(mob: Entity, def: MobDef, players: Entity[], now: number): BrainDecision;
/**
 * Apply a move intent with voxel rules: walk at speed, deflect around
 * blockers, step up/down at most one block, never into water or lava,
 * keep headroom. `others` are packmates whose personal space deflects the
 * path too (mobs fan out instead of stacking). Sets yaw + walk anim.
 * Returns whether the mob moved.
 */
export declare function applyMove(e: Entity, intent: MoveIntent, baseSpeed: number, dt: number, world: VoxelWorld, bounds: {
    w: number;
    h: number;
}, _waterLevel: number | null, others?: Entity[]): boolean;
/**
 * Soft-separate overlapping mobs: every pair closer than MOB_SEPARATION
 * pushes apart at SEPARATION_PUSH_SPEED (handles spawn stacks and mobs
 * knocked together — applyMove's crowding check prevents the rest). Pushes
 * accumulate symmetrically first, then each result is validated with the
 * same voxel rules as walking so nobody gets shoved into a wall, off a
 * cliff, or into liquid. Yaw is untouched — mobs keep facing their target.
 */
export declare function separateEntities(list: Entity[], dt: number, world: VoxelWorld, bounds: {
    w: number;
    h: number;
}): void;
/** Find a legal spawn point in a spawn region (dry, unobstructed). */
export declare function findSpawnPoint(table: SpawnTable, world: VoxelWorld, _waterLevel: number | null): {
    x: number;
    z: number;
} | null;
/** Weighted mob pick from a spawn table. */
export declare function pickMob(table: SpawnTable): string;
//# sourceMappingURL=mobs.d.ts.map