/**
 * Entity model: id + component bag. Systems iterate entities and read/write
 * components — no inheritance. Players, mobs, NPCs, and loot bags are all
 * the same shape with different bags.
 */
import type { EntityFull, EntityDelta, ItemStack, LootView } from "@fantasy-mmo/common";
export interface Position {
    x: number;
    y: number;
    z: number;
    yaw: number;
}
export interface Renderable {
    sprite: string;
    anim: string;
    name?: string;
}
/** Action FSM states — the body, shared by players and mobs alike. */
export type ActState = "idle" | "move" | "windup" | "active" | "cast" | "recover" | "stagger" | "dead";
export interface Combat {
    act: ActState;
    actEndsAt: number;
    /** ability id being executed (windup/active/cast/recover) */
    ability: string | null;
    /** damage the pending ability will deal (item/mob/level/rarity resolved at use time) */
    pendingDamage: number;
    aimYaw: number;
    aimPitch: number;
    /** held item's speed roll scaling the current ability's timings (1 = base) */
    speedMult: number;
    cooldowns: Map<string, number>;
    lastDamagedAt: number;
    slowPct: number;
    slowUntil: number;
    /** heal-over-time from food: hpPerSec until hotUntil */
    hotPerSec: number;
    hotUntil: number;
    /** damage-over-time (poison): hp/sec until dotUntil, mirror of the food
     *  HoT. Fractions accumulate in dotAcc and land as whole-point bites
     *  through the room's damage path, attributed to dotSrcId (the applier). */
    dotPerSec: number;
    dotUntil: number;
    dotAcc: number;
    dotSrcId: number;
}
export declare function freshCombat(): Combat;
export interface Health {
    hp: number;
    maxHp: number;
}
export interface ManaPool {
    mana: number;
    maxMana: number;
}
/** Mob-only decision layer (the brain). Talks to the body via intents only. */
export interface MobBrain {
    mobId: string;
    state: "patrol" | "chase" | "flee" | "return";
    home: {
        x: number;
        z: number;
    };
    spawnerId: string;
    targetId: number | null;
    threat: Map<number, number>;
    nextWanderAt: number;
    wanderTarget: {
        x: number;
        z: number;
    } | null;
}
/** A dropped loot bag in the world. */
export interface LootBag {
    items: ItemStack[];
    gold: number;
    owner: string | null;
    unlockAt: number;
    expireAt: number | null;
}
export interface Entity {
    id: number;
    kind: "player" | "mob" | "npc" | "loot";
    pos: Position;
    /** vertical velocity while airborne (mob gravity — see applyGravity) */
    vy?: number;
    renderable: Renderable;
    level?: number;
    health?: Health;
    mana?: ManaPool;
    combat?: Combat;
    brain?: MobBrain;
    loot?: LootBag;
    /** replicated bag contents (rarest first, ≤3) — RoomSim keeps it in sync
     *  with loot.items so clients can render the actual dropped items */
    lootView?: LootView;
    /** npc registry id (dialog/shop lookup) */
    npcId?: string;
}
export declare function allocEntityId(): number;
export declare function toFull(e: Entity, now: number): EntityFull;
/** Replicated mutable fields, used for per-viewer delta computation. */
export interface ReplicatedState {
    x: number;
    y: number;
    z: number;
    yaw: number;
    anim: string;
    hp: number | undefined;
    act: string | undefined;
    /** compact loot-contents signature so partial pickups delta out */
    lootSig: string | undefined;
}
export declare function replicatedState(e: Entity): ReplicatedState;
/** Delta of changed fields vs. what a viewer last saw; null when unchanged.
 *  act changes carry actMs so clients can run the telegraph timer. */
export declare function diffState(e: Entity, prev: ReplicatedState, curr: ReplicatedState, now: number): EntityDelta | null;
//# sourceMappingURL=entities.d.ts.map