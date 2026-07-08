/**
 * Action FSM mechanics + combat math. Pure-ish helpers: state legality,
 * timing advance, melee cones, projectile stepping. Damage application,
 * death, XP, and broadcasting stay in RoomSim (they touch sessions/loot).
 *
 * The FSM (idle/move/windup/active/cast/recover/stagger/dead) is shared by
 * players and mobs — input and AI are just two intent producers.
 */
import { type AbilityDef } from "@fantasy-mmo/common";
import type { Combat, Entity } from "./entities.js";
/** States from which a new ability may be started. */
export declare function canAct(c: Combat): boolean;
/** Movement multiplier from an active slow (1 = none). Shared by player
 *  move validation and the mob tick so the two paths can never drift. */
export declare function slowMult(c: Combat, now: number): number;
/** True while the entity may not move (per-ability canMoveWhile flag). */
export declare function isMovementLocked(c: Combat, ability: AbilityDef | null): boolean;
/**
 * Begin an ability: melee/bow enter windup, spells enter cast. Returns false
 * when the FSM state, cooldown, or mana forbids it. Mana/cooldown are charged
 * up front (interrupts refund mana — see interrupt()).
 */
export declare function startAbility(e: Entity, abilityId: string, ability: AbilityDef, damage: number, aimYaw: number, aimPitch: number, now: number, speedMult?: number): boolean;
/** What advancing the FSM produced this step. */
export type FsmFire = "melee-hit" | "release" | null;
/**
 * Advance the FSM when the current state's timer elapses.
 * windup → active (melee hit window opens / bow releases), active → recover,
 * cast → release → recover, recover/stagger → idle.
 *
 * Each next stage is timed from the PREVIOUS stage's end (not from `now`):
 * ticks run at 10 Hz, and restarting every stage's timer at the tick that
 * noticed it stretched a 3-stage ability by up to ~300 ms over what clients
 * predict — the drift behind "the swing animated but nothing happened".
 */
export declare function advanceFsm(e: Entity, ability: AbilityDef | null, now: number): FsmFire;
/**
 * Damage taken during an interruptible windup/cast breaks the ability into
 * stagger. Mana is refunded (the spell never released). Returns true when
 * an interrupt happened.
 */
export declare function interruptIfCasting(e: Entity, ability: AbilityDef | null, staggerMs: number, now: number): boolean;
/** Is target inside attacker's melee cone (range + half-arc around aimYaw)?
 *  maxDy gates the VERTICAL reach — feet more than that apart can't trade
 *  melee blows (no more canopy boars goring players 5 blocks below). */
export declare function inMeleeCone(attacker: Entity, target: Entity, range: number, arcDeg: number, rangeGrace: number, maxDy: number): boolean;
export interface Projectile {
    id: number;
    fx: string;
    ownerId: number;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    damage: number;
    debuff: {
        slowPct?: number;
        dotTotal?: number;
        durMs: number;
    } | null;
    startX: number;
    startZ: number;
    maxRangeSq: number;
    dieAt: number;
    /** splash radius at the impact point (0 = direct hit only) */
    aoeRadius: number;
    /** impact flipbook for the wire (explosion) */
    impactFx: string | null;
    /** render scale for the wire (big boss fireball) */
    scale: number;
    /** damage class at impact (arrows=ranged, spells=magic) — taken-modifier
     *  and armor-mitigation routing in applyDamage */
    dmgClass: "melee" | "ranged" | "magic";
}
export declare function allocProjId(): number;
export declare function makeProjectile(owner: Entity, ability: AbilityDef, damage: number, now: number): Projectile;
/** Cylinder hit test at the projectile's current position. */
export declare function projectileHits(p: Projectile, e: Entity, hitRadius: number): boolean;
//# sourceMappingURL=combat.d.ts.map