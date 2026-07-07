/**
 * Mob AI: the decision layer (brain). A flat FSM per mob —
 * patrol/chase/flee/return — that communicates with the body (action FSM)
 * only through intents: "move toward X", "use ability at Y". That seam is
 * where behavior trees swap in later.
 */
import type { MobDef, SpawnTable } from "@fantasy-mmo/common";
import type { Entity } from "./entities.js";
import type { VoxelWorld } from "./voxel.js";
/** Min center-to-center distance between alive mobs (owner-tuned: 0.9 read
 *  as too spread out — packs may bunch, just not merge into one sprite). */
export declare const MOB_SEPARATION = 0.45;
export interface MoveIntent {
    x: number;
    z: number;
    speedMult: number;
    /** max blocks this move may step DOWN (default ~1; chase/flee/return
     *  pass PURPOSEFUL_MAX_DROP so treed/ledged mobs can drop to targets) */
    maxDrop?: number;
    /** purposeful moves may cross liquid: wade shallow runs on the flooded
     *  floor, swim deep water at the surface. Wander never wades — idle mobs
     *  don't stroll into ponds, and standing across a lava trench no longer
     *  cheeses melee mobs that want to reach you. */
    wade?: boolean;
}
export interface BrainDecision {
    move: MoveIntent | null;
    attack: Entity | null;
    faceYaw: number | null;
}
/**
 * One brain tick. Pure decision — the caller applies movement (with terrain)
 * and routes attack intents into the shared action FSM. `attackReachY` is
 * the max |feet-Y delta| at which this mob's attack can land (melee vertical
 * reach; Infinity for projectile mobs, which aim with real pitch) — targets
 * 2D-close but vertically out of reach are CHASED (with drop-down moves),
 * never punched through canopies and floors.
 */
export declare function tickBrain(mob: Entity, def: MobDef, players: Entity[], now: number, attackReachY?: number): BrainDecision;
/**
 * Apply a move intent with voxel rules: walk at speed, deflect around
 * blockers, step up/down at most one block, keep headroom. Liquid blocks
 * the way UNLESS the intent wades (purposeful moves): shallow runs are
 * crossed on the flooded floor, deep water is swum at the surface.
 * `others` are packmates whose personal space deflects the path too (mobs
 * fan out instead of stacking). Sets yaw + walk anim.
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
/** Find a legal spawn point in a spawn region (dry, unobstructed, ON THE
 *  FLOOR — floorY lands under tree canopies/roofs, never on top of them). */
export declare function findSpawnPoint(table: SpawnTable, world: VoxelWorld, _waterLevel: number | null): {
    x: number;
    z: number;
} | null;
/** Weighted mob pick from a spawn table. */
export declare function pickMob(table: SpawnTable): string;
//# sourceMappingURL=mobs.d.ts.map