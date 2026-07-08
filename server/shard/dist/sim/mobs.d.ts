/**
 * Mob AI: the decision layer (brain). A flat FSM per mob —
 * patrol/chase/flee/return — that communicates with the body (action FSM)
 * only through intents: "move toward X", "use ability at Y". That seam is
 * where behavior trees swap in later.
 */
import { type AbilityDef, type ResolvedMob, type SpawnTable } from "@fantasy-mmo/common";
import type { Entity } from "./entities.js";
import type { VoxelWorld } from "./voxel.js";
/** Min center-to-center distance between alive mobs (owner-tuned: 0.9 read
 *  as too spread out — packs may bunch, just not merge into one sprite). */
export declare const MOB_SEPARATION = 0.45;
/** Purposeful movement (chase/flee/return) may drop this many blocks in a
 *  step — a mob that somehow ends up on a tree canopy or ledge can always
 *  get DOWN to its target. Wandering keeps the 1-block limit so idle mobs
 *  don't dive off cliffs. Tallest oak canopy top is ~7 above the floor. */
export declare const PURPOSEFUL_MAX_DROP = 8;
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
/** One resolved entry of a mob's attack kit (registry data + ability def). */
export interface AttackOption {
    id: string;
    ability: AbilityDef;
    damage: number;
    minRange: number;
    weight: number;
}
/** What a mob should do about a target it decided to attack. */
export type AttackChoice = {
    kind: "use";
    option: AttackOption;
} | {
    kind: "wait";
} | {
    kind: "close";
};
/**
 * Pick from a mob's attack kit against a target: options must be inside
 * their range window (minRange..reach — melee reach is ability.range+grace
 * with the vertical gate, projectiles use the mob's attackRange and aim
 * with pitch) and off cooldown; several usable at once → weighted roll.
 * When everything in range is cooling down, mixed kits CLOSE toward melee
 * (a skeleton advances between bow shots) while pure-ranged mobs hold.
 */
export declare function chooseAttack(mob: Entity, target: Entity, options: AttackOption[], now: number, attackRange: number, meleeGrace: number, meleeReachY: number): AttackChoice;
/**
 * One brain tick. Pure decision — the caller applies movement (with terrain)
 * and routes attack intents into the shared action FSM. `attackReachY` is
 * the max |feet-Y delta| at which this mob's attack can land (melee vertical
 * reach; Infinity for projectile mobs, which aim with real pitch) — targets
 * 2D-close but vertically out of reach are CHASED (with drop-down moves),
 * never punched through canopies and floors.
 */
export declare function tickBrain(mob: Entity, 
/** the mob evaluated at its SPAWN level. Ranks may override its disposition
 *  (aggroRadius / fleeAtHpPct / attackRange / leashRadius), so the brain must
 *  never read the raw def — otherwise a rank could change a mob's numbers and
 *  its buttons but never its nerve. */
def: ResolvedMob, players: Entity[], now: number, attackReachY?: number): BrainDecision;
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
 * Per-tick vertical physics for mobs (players run their own client-predicted
 * physics). An entity above the ground under its feet accelerates downward
 * and lands when it reaches it — mobs walking off ledges/canopies FALL like
 * players do instead of snapping instantly. In liquid gravity is off and
 * buoyancy floats the mob up to the swim surface (feet in the top liquid
 * cell) so 1-block banks stay climbable after a plunge.
 * Returns true while airborne — callers skip walking (no air control).
 */
export declare function applyGravity(e: Entity, dt: number, world: VoxelWorld, gravity: number): boolean;
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
/** ~this many ticks of zero progress trigger a path computation */
export declare const STUCK_TICKS_FOR_PATH = 4;
/**
 * Bounded BFS over the walkable floor grid (solid below, 2 of headroom,
 * step up ≤1, drop ≤2.5, liquid only when wading) from the mob toward a
 * goal column. Deflection steering handles the open field; this recovers
 * CONCAVE traps — the throne a boss spawns behind, building shells, wall
 * corners. Returns coarse waypoints (every 2nd cell, cell centers), routed
 * to the goal or, when the goal is unreachable, to the explored cell
 * closest to it. Null when even that is no better than standing still.
 */
export declare function pathfindWaypoints(world: VoxelWorld, from: {
    x: number;
    y: number;
    z: number;
}, to: {
    x: number;
    z: number;
}, wade: boolean): Array<{
    x: number;
    z: number;
}> | null;
/** Find a legal spawn point in a spawn region (dry, unobstructed, ON THE
 *  FLOOR — floorY lands under tree canopies/roofs, never on top of them). */
export declare function findSpawnPoint(table: SpawnTable, world: VoxelWorld, _waterLevel: number | null): {
    x: number;
    z: number;
} | null;
/** Weighted pick from a spawn table: the mob id AND its (optional) level
 *  override — a table reusing a low-level mob deeper in the world spawns it
 *  scaled up, with its level-gated abilities unlocked (registry.resolveMob). */
export declare function pickMobEntry(table: SpawnTable): {
    mob: string;
    level?: number;
};
/** Weighted mob pick from a spawn table (id only). */
export declare function pickMob(table: SpawnTable): string;
//# sourceMappingURL=mobs.d.ts.map