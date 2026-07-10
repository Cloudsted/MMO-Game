/**
 * The ONLY place server code encodes/decodes wire messages. Mirrors
 * shared/protocol.json (the canonical catalog) and client net/Protocol.java.
 * JSON for MVP; a binary encoding swaps in behind encode()/decode*() later.
 */
import { z } from "zod";
/** One inventory slot: per-instance item data. Equippables carry stat rolls
 *  (multipliers around 1, e.g. {dmg:1.04, spd:0.98}), durability, and any
 *  dynamic modifiers minted at creation (see mintItem in items.ts). */
export declare const ItemStackSchema: z.ZodObject<{
    item: z.ZodString;
    qty: z.ZodNumber;
    rarity: z.ZodString;
    /** per-instance stat rolls: stat id → multiplier (absent on non-equippables) */
    stats: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    /** durability remaining (uses); item breaks at 0 */
    dur: z.ZodOptional<z.ZodNumber>;
    /** rolled durability ceiling for this instance */
    maxDur: z.ZodOptional<z.ZodNumber>;
    /** dynamic modifiers: modifier id (shared/modifiers.json) → magnitude in
     *  the modifier's units; curses negative. Absent = unmodified (the state
     *  merge guards and the enchanter's eligibility rule key on). */
    mods: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    item: string;
    qty: number;
    rarity: string;
    stats?: Record<string, number> | undefined;
    dur?: number | undefined;
    maxDur?: number | undefined;
    mods?: Record<string, number> | undefined;
}, {
    item: string;
    qty: number;
    rarity: string;
    stats?: Record<string, number> | undefined;
    dur?: number | undefined;
    maxDur?: number | undefined;
    mods?: Record<string, number> | undefined;
}>;
export type ItemStack = z.infer<typeof ItemStackSchema>;
/** What a dropped loot bag shows the world: its representative contents
 *  (rarest first, capped at 3) so clients can render the actual items. */
export declare const LootViewSchema: z.ZodArray<z.ZodObject<{
    item: z.ZodString;
    rarity: z.ZodString;
}, "strip", z.ZodTypeAny, {
    item: string;
    rarity: string;
}, {
    item: string;
    rarity: string;
}>, "many">;
export type LootView = z.infer<typeof LootViewSchema>;
export declare const CharacterSnapshotSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    level: z.ZodNumber;
    xp: z.ZodNumber;
    gold: z.ZodNumber;
    inventory: z.ZodArray<z.ZodNullable<z.ZodObject<{
        item: z.ZodString;
        qty: z.ZodNumber;
        rarity: z.ZodString;
        /** per-instance stat rolls: stat id → multiplier (absent on non-equippables) */
        stats: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        /** durability remaining (uses); item breaks at 0 */
        dur: z.ZodOptional<z.ZodNumber>;
        /** rolled durability ceiling for this instance */
        maxDur: z.ZodOptional<z.ZodNumber>;
        /** dynamic modifiers: modifier id (shared/modifiers.json) → magnitude in
         *  the modifier's units; curses negative. Absent = unmodified (the state
         *  merge guards and the enchanter's eligibility rule key on). */
        mods: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    }, {
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    }>>, "many">;
    /** worn gear, indexed by EQUIP_SLOTS order (head/chest/legs/feet/offhand).
     *  Optional: rows/tickets minted before equipment existed validate fine. */
    equipment: z.ZodOptional<z.ZodArray<z.ZodNullable<z.ZodObject<{
        item: z.ZodString;
        qty: z.ZodNumber;
        rarity: z.ZodString;
        /** per-instance stat rolls: stat id → multiplier (absent on non-equippables) */
        stats: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        /** durability remaining (uses); item breaks at 0 */
        dur: z.ZodOptional<z.ZodNumber>;
        /** rolled durability ceiling for this instance */
        maxDur: z.ZodOptional<z.ZodNumber>;
        /** dynamic modifiers: modifier id (shared/modifiers.json) → magnitude in
         *  the modifier's units; curses negative. Absent = unmodified (the state
         *  merge guards and the enchanter's eligibility rule key on). */
        mods: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    }, {
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    }>>, "many">>;
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
    yaw: z.ZodNumber;
    roles: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    id: string;
    x: number;
    z: number;
    level: number;
    name: string;
    yaw: number;
    xp: number;
    gold: number;
    inventory: ({
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    } | null)[];
    y: number;
    roles: string[];
    equipment?: ({
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    } | null)[] | undefined;
}, {
    id: string;
    x: number;
    z: number;
    level: number;
    name: string;
    yaw: number;
    xp: number;
    gold: number;
    inventory: ({
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    } | null)[];
    y: number;
    roles: string[];
    equipment?: ({
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    } | null)[] | undefined;
}>;
export type CharacterSnapshot = z.infer<typeof CharacterSnapshotSchema>;
export declare const EntityFullSchema: z.ZodObject<{
    id: z.ZodNumber;
    kind: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    sprite: z.ZodOptional<z.ZodString>;
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
    yaw: z.ZodNumber;
    anim: z.ZodString;
    hp: z.ZodOptional<z.ZodNumber>;
    maxHp: z.ZodOptional<z.ZodNumber>;
    level: z.ZodOptional<z.ZodNumber>;
    /** action FSM state (idle/move/windup/active/recover/cast/stagger/dead) */
    act: z.ZodOptional<z.ZodString>;
    /** ms remaining in act at send time — clients run the telegraph timer */
    actMs: z.ZodOptional<z.ZodNumber>;
    /** loot bags only: visible contents ([] = gold-only bag → sack sprite) */
    loot: z.ZodOptional<z.ZodArray<z.ZodObject<{
        item: z.ZodString;
        rarity: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        item: string;
        rarity: string;
    }, {
        item: string;
        rarity: string;
    }>, "many">>;
    /** mobs only: resolved boss/miniboss flag (mobs.json `boss`, rank-overridable)
     *  — clients keep boss nameplates visible at range. Absent = normal. */
    boss: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    id: number;
    x: number;
    z: number;
    kind: string;
    yaw: number;
    y: number;
    anim: string;
    level?: number | undefined;
    name?: string | undefined;
    sprite?: string | undefined;
    loot?: {
        item: string;
        rarity: string;
    }[] | undefined;
    boss?: boolean | undefined;
    hp?: number | undefined;
    maxHp?: number | undefined;
    act?: string | undefined;
    actMs?: number | undefined;
}, {
    id: number;
    x: number;
    z: number;
    kind: string;
    yaw: number;
    y: number;
    anim: string;
    level?: number | undefined;
    name?: string | undefined;
    sprite?: string | undefined;
    loot?: {
        item: string;
        rarity: string;
    }[] | undefined;
    boss?: boolean | undefined;
    hp?: number | undefined;
    maxHp?: number | undefined;
    act?: string | undefined;
    actMs?: number | undefined;
}>;
export type EntityFull = z.infer<typeof EntityFullSchema>;
/** id + any changed subset of EntityFull's mutable fields. */
export declare const EntityDeltaSchema: z.ZodObject<{
    id: z.ZodNumber;
    x: z.ZodOptional<z.ZodNumber>;
    y: z.ZodOptional<z.ZodNumber>;
    z: z.ZodOptional<z.ZodNumber>;
    yaw: z.ZodOptional<z.ZodNumber>;
    anim: z.ZodOptional<z.ZodString>;
    hp: z.ZodOptional<z.ZodNumber>;
    act: z.ZodOptional<z.ZodString>;
    actMs: z.ZodOptional<z.ZodNumber>;
    /** loot bags: contents changed (partial pickup) */
    loot: z.ZodOptional<z.ZodArray<z.ZodObject<{
        item: z.ZodString;
        rarity: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        item: string;
        rarity: string;
    }, {
        item: string;
        rarity: string;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    id: number;
    x?: number | undefined;
    z?: number | undefined;
    yaw?: number | undefined;
    loot?: {
        item: string;
        rarity: string;
    }[] | undefined;
    hp?: number | undefined;
    y?: number | undefined;
    anim?: string | undefined;
    act?: string | undefined;
    actMs?: number | undefined;
}, {
    id: number;
    x?: number | undefined;
    z?: number | undefined;
    yaw?: number | undefined;
    loot?: {
        item: string;
        rarity: string;
    }[] | undefined;
    hp?: number | undefined;
    y?: number | undefined;
    anim?: string | undefined;
    act?: string | undefined;
    actMs?: number | undefined;
}>;
export type EntityDelta = z.infer<typeof EntityDeltaSchema>;
/** A dropped loot bag persisted with the room (death drops survive restarts). */
export declare const DropStateSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        item: z.ZodString;
        qty: z.ZodNumber;
        rarity: z.ZodString;
        /** per-instance stat rolls: stat id → multiplier (absent on non-equippables) */
        stats: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        /** durability remaining (uses); item breaks at 0 */
        dur: z.ZodOptional<z.ZodNumber>;
        /** rolled durability ceiling for this instance */
        maxDur: z.ZodOptional<z.ZodNumber>;
        /** dynamic modifiers: modifier id (shared/modifiers.json) → magnitude in
         *  the modifier's units; curses negative. Absent = unmodified (the state
         *  merge guards and the enchanter's eligibility rule key on). */
        mods: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    }, {
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    }>, "many">;
    gold: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
    /** character id whose lock applies, or null for free-for-all */
    owner: z.ZodNullable<z.ZodString>;
    unlockAt: z.ZodNumber;
    expireAt: z.ZodNullable<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    x: number;
    z: number;
    items: {
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    }[];
    gold: number;
    y: number;
    owner: string | null;
    unlockAt: number;
    expireAt: number | null;
}, {
    x: number;
    z: number;
    items: {
        item: string;
        qty: number;
        rarity: string;
        stats?: Record<string, number> | undefined;
        dur?: number | undefined;
        maxDur?: number | undefined;
        mods?: Record<string, number> | undefined;
    }[];
    gold: number;
    y: number;
    owner: string | null;
    unlockAt: number;
    expireAt: number | null;
}>;
export type DropState = z.infer<typeof DropStateSchema>;
/** A player block edit (place or break) — the voxel persistence overlay. */
export declare const BlockEditWireSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
    id: z.ZodNumber;
    owner: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: number;
    x: number;
    z: number;
    y: number;
    owner: string | null;
}, {
    id: number;
    x: number;
    z: number;
    y: number;
    owner: string | null;
}>;
export type BlockEditWire = z.infer<typeof BlockEditWireSchema>;
/** Persisted per-room dynamic state. */
export declare const RoomStateSchema: z.ZodObject<{
    timeOfDay: z.ZodNumber;
    savedAt: z.ZodNumber;
    drops: z.ZodDefault<z.ZodArray<z.ZodObject<{
        items: z.ZodArray<z.ZodObject<{
            item: z.ZodString;
            qty: z.ZodNumber;
            rarity: z.ZodString;
            /** per-instance stat rolls: stat id → multiplier (absent on non-equippables) */
            stats: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            /** durability remaining (uses); item breaks at 0 */
            dur: z.ZodOptional<z.ZodNumber>;
            /** rolled durability ceiling for this instance */
            maxDur: z.ZodOptional<z.ZodNumber>;
            /** dynamic modifiers: modifier id (shared/modifiers.json) → magnitude in
             *  the modifier's units; curses negative. Absent = unmodified (the state
             *  merge guards and the enchanter's eligibility rule key on). */
            mods: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        }, {
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        }>, "many">;
        gold: z.ZodNumber;
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
        /** character id whose lock applies, or null for free-for-all */
        owner: z.ZodNullable<z.ZodString>;
        unlockAt: z.ZodNumber;
        expireAt: z.ZodNullable<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        x: number;
        z: number;
        items: {
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        }[];
        gold: number;
        y: number;
        owner: string | null;
        unlockAt: number;
        expireAt: number | null;
    }, {
        x: number;
        z: number;
        items: {
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        }[];
        gold: number;
        y: number;
        owner: string | null;
        unlockAt: number;
        expireAt: number | null;
    }>, "many">>;
    /** per-spawner pending respawn timestamps (ms epoch) */
    spawners: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodNumber, "many">>>;
    /** sparse voxel edits applied over deterministic generation */
    blocks: z.ZodDefault<z.ZodArray<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
        id: z.ZodNumber;
        owner: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: number;
        x: number;
        z: number;
        y: number;
        owner: string | null;
    }, {
        id: number;
        x: number;
        z: number;
        y: number;
        owner: string | null;
    }>, "many">>;
    /** prefab loot caches: "x,y,z" cache key → lastLootedAt ms epoch, so a
     *  restart doesn't refill freshly-looted caches instantly */
    caches: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    blocks: {
        id: number;
        x: number;
        z: number;
        y: number;
        owner: string | null;
    }[];
    timeOfDay: number;
    savedAt: number;
    drops: {
        x: number;
        z: number;
        items: {
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        }[];
        gold: number;
        y: number;
        owner: string | null;
        unlockAt: number;
        expireAt: number | null;
    }[];
    spawners: Record<string, number[]>;
    caches: Record<string, number>;
}, {
    timeOfDay: number;
    savedAt: number;
    blocks?: {
        id: number;
        x: number;
        z: number;
        y: number;
        owner: string | null;
    }[] | undefined;
    drops?: {
        x: number;
        z: number;
        items: {
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        }[];
        gold: number;
        y: number;
        owner: string | null;
        unlockAt: number;
        expireAt: number | null;
    }[] | undefined;
    spawners?: Record<string, number[]> | undefined;
    caches?: Record<string, number> | undefined;
}>;
export type RoomState = z.infer<typeof RoomStateSchema>;
/** Live per-room telemetry piggybacked on the shard heartbeat → admin dashboard.
 *  Sim-side counts come from RoomSim.adminInfo(); process-side numbers
 *  (uptime/tick timings/memory/expiry) are stamped by the RoomHost. */
export declare const RoomAdminInfoSchema: z.ZodObject<{
    mobs: z.ZodNumber;
    npcs: z.ZodNumber;
    drops: z.ZodNumber;
    projectiles: z.ZodNumber;
    /** player block edits in the persistence overlay */
    blockEdits: z.ZodNumber;
    timeOfDay: z.ZodNumber;
    uptimeSec: z.ZodNumber;
    /** avg/max sim tick duration over the last stats window */
    tickAvgMs: z.ZodNumber;
    tickMaxMs: z.ZodNumber;
    memMB: z.ZodNumber;
    /** ephemeral rooms: ms epoch of the scheduled collapse (null = no lifecycle) */
    expiresAt: z.ZodNullable<z.ZodNumber>;
    players: z.ZodArray<z.ZodObject<{
        charId: z.ZodString;
        name: z.ZodString;
        level: z.ZodNumber;
        hp: z.ZodNumber;
        maxHp: z.ZodNumber;
        gold: z.ZodNumber;
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        z: number;
        level: number;
        name: string;
        hp: number;
        gold: number;
        y: number;
        maxHp: number;
        charId: string;
    }, {
        x: number;
        z: number;
        level: number;
        name: string;
        hp: number;
        gold: number;
        y: number;
        maxHp: number;
        charId: string;
    }>, "many">;
    /** non-player entity positions for the dashboard's live room map */
    ents: z.ZodOptional<z.ZodArray<z.ZodObject<{
        k: z.ZodString;
        x: z.ZodNumber;
        z: z.ZodNumber;
        n: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        x: number;
        z: number;
        k: string;
        n?: string | undefined;
    }, {
        x: number;
        z: number;
        k: string;
        n?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    mobs: number;
    npcs: number;
    timeOfDay: number;
    drops: number;
    projectiles: number;
    blockEdits: number;
    uptimeSec: number;
    tickAvgMs: number;
    tickMaxMs: number;
    memMB: number;
    expiresAt: number | null;
    players: {
        x: number;
        z: number;
        level: number;
        name: string;
        hp: number;
        gold: number;
        y: number;
        maxHp: number;
        charId: string;
    }[];
    ents?: {
        x: number;
        z: number;
        k: string;
        n?: string | undefined;
    }[] | undefined;
}, {
    mobs: number;
    npcs: number;
    timeOfDay: number;
    drops: number;
    projectiles: number;
    blockEdits: number;
    uptimeSec: number;
    tickAvgMs: number;
    tickMaxMs: number;
    memMB: number;
    expiresAt: number | null;
    players: {
        x: number;
        z: number;
        level: number;
        name: string;
        hp: number;
        gold: number;
        y: number;
        maxHp: number;
        charId: string;
    }[];
    ents?: {
        x: number;
        z: number;
        k: string;
        n?: string | undefined;
    }[] | undefined;
}>;
export type RoomAdminInfo = z.infer<typeof RoomAdminInfoSchema>;
export declare const ShardToMasterSchema: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
    t: z.ZodLiteral<"register">;
    shardId: z.ZodString;
    gameHost: z.ZodString;
    capacity: z.ZodNumber;
    secret: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "register";
    shardId: string;
    gameHost: string;
    capacity: number;
    secret: string;
}, {
    t: "register";
    shardId: string;
    gameHost: string;
    capacity: number;
    secret: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"heartbeat">;
    rooms: z.ZodArray<z.ZodObject<{
        roomId: z.ZodString;
        port: z.ZodNumber;
        players: z.ZodNumber;
        status: z.ZodString;
        info: z.ZodOptional<z.ZodObject<{
            mobs: z.ZodNumber;
            npcs: z.ZodNumber;
            drops: z.ZodNumber;
            projectiles: z.ZodNumber;
            /** player block edits in the persistence overlay */
            blockEdits: z.ZodNumber;
            timeOfDay: z.ZodNumber;
            uptimeSec: z.ZodNumber;
            /** avg/max sim tick duration over the last stats window */
            tickAvgMs: z.ZodNumber;
            tickMaxMs: z.ZodNumber;
            memMB: z.ZodNumber;
            /** ephemeral rooms: ms epoch of the scheduled collapse (null = no lifecycle) */
            expiresAt: z.ZodNullable<z.ZodNumber>;
            players: z.ZodArray<z.ZodObject<{
                charId: z.ZodString;
                name: z.ZodString;
                level: z.ZodNumber;
                hp: z.ZodNumber;
                maxHp: z.ZodNumber;
                gold: z.ZodNumber;
                x: z.ZodNumber;
                y: z.ZodNumber;
                z: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                x: number;
                z: number;
                level: number;
                name: string;
                hp: number;
                gold: number;
                y: number;
                maxHp: number;
                charId: string;
            }, {
                x: number;
                z: number;
                level: number;
                name: string;
                hp: number;
                gold: number;
                y: number;
                maxHp: number;
                charId: string;
            }>, "many">;
            /** non-player entity positions for the dashboard's live room map */
            ents: z.ZodOptional<z.ZodArray<z.ZodObject<{
                k: z.ZodString;
                x: z.ZodNumber;
                z: z.ZodNumber;
                n: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                x: number;
                z: number;
                k: string;
                n?: string | undefined;
            }, {
                x: number;
                z: number;
                k: string;
                n?: string | undefined;
            }>, "many">>;
        }, "strip", z.ZodTypeAny, {
            mobs: number;
            npcs: number;
            timeOfDay: number;
            drops: number;
            projectiles: number;
            blockEdits: number;
            uptimeSec: number;
            tickAvgMs: number;
            tickMaxMs: number;
            memMB: number;
            expiresAt: number | null;
            players: {
                x: number;
                z: number;
                level: number;
                name: string;
                hp: number;
                gold: number;
                y: number;
                maxHp: number;
                charId: string;
            }[];
            ents?: {
                x: number;
                z: number;
                k: string;
                n?: string | undefined;
            }[] | undefined;
        }, {
            mobs: number;
            npcs: number;
            timeOfDay: number;
            drops: number;
            projectiles: number;
            blockEdits: number;
            uptimeSec: number;
            tickAvgMs: number;
            tickMaxMs: number;
            memMB: number;
            expiresAt: number | null;
            players: {
                x: number;
                z: number;
                level: number;
                name: string;
                hp: number;
                gold: number;
                y: number;
                maxHp: number;
                charId: string;
            }[];
            ents?: {
                x: number;
                z: number;
                k: string;
                n?: string | undefined;
            }[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        status: string;
        players: number;
        roomId: string;
        port: number;
        info?: {
            mobs: number;
            npcs: number;
            timeOfDay: number;
            drops: number;
            projectiles: number;
            blockEdits: number;
            uptimeSec: number;
            tickAvgMs: number;
            tickMaxMs: number;
            memMB: number;
            expiresAt: number | null;
            players: {
                x: number;
                z: number;
                level: number;
                name: string;
                hp: number;
                gold: number;
                y: number;
                maxHp: number;
                charId: string;
            }[];
            ents?: {
                x: number;
                z: number;
                k: string;
                n?: string | undefined;
            }[] | undefined;
        } | undefined;
    }, {
        status: string;
        players: number;
        roomId: string;
        port: number;
        info?: {
            mobs: number;
            npcs: number;
            timeOfDay: number;
            drops: number;
            projectiles: number;
            blockEdits: number;
            uptimeSec: number;
            tickAvgMs: number;
            tickMaxMs: number;
            memMB: number;
            expiresAt: number | null;
            players: {
                x: number;
                z: number;
                level: number;
                name: string;
                hp: number;
                gold: number;
                y: number;
                maxHp: number;
                charId: string;
            }[];
            ents?: {
                x: number;
                z: number;
                k: string;
                n?: string | undefined;
            }[] | undefined;
        } | undefined;
    }>, "many">;
    /** shard-host process telemetry (admin dashboard) */
    shard: z.ZodOptional<z.ZodObject<{
        pid: z.ZodNumber;
        memMB: z.ZodNumber;
        uptimeSec: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        uptimeSec: number;
        memMB: number;
        pid: number;
    }, {
        uptimeSec: number;
        memMB: number;
        pid: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    rooms: {
        status: string;
        players: number;
        roomId: string;
        port: number;
        info?: {
            mobs: number;
            npcs: number;
            timeOfDay: number;
            drops: number;
            projectiles: number;
            blockEdits: number;
            uptimeSec: number;
            tickAvgMs: number;
            tickMaxMs: number;
            memMB: number;
            expiresAt: number | null;
            players: {
                x: number;
                z: number;
                level: number;
                name: string;
                hp: number;
                gold: number;
                y: number;
                maxHp: number;
                charId: string;
            }[];
            ents?: {
                x: number;
                z: number;
                k: string;
                n?: string | undefined;
            }[] | undefined;
        } | undefined;
    }[];
    t: "heartbeat";
    shard?: {
        uptimeSec: number;
        memMB: number;
        pid: number;
    } | undefined;
}, {
    rooms: {
        status: string;
        players: number;
        roomId: string;
        port: number;
        info?: {
            mobs: number;
            npcs: number;
            timeOfDay: number;
            drops: number;
            projectiles: number;
            blockEdits: number;
            uptimeSec: number;
            tickAvgMs: number;
            tickMaxMs: number;
            memMB: number;
            expiresAt: number | null;
            players: {
                x: number;
                z: number;
                level: number;
                name: string;
                hp: number;
                gold: number;
                y: number;
                maxHp: number;
                charId: string;
            }[];
            ents?: {
                x: number;
                z: number;
                k: string;
                n?: string | undefined;
            }[] | undefined;
        } | undefined;
    }[];
    t: "heartbeat";
    shard?: {
        uptimeSec: number;
        memMB: number;
        pid: number;
    } | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"roomOpened">;
    roomId: z.ZodString;
    port: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    t: "roomOpened";
    roomId: string;
    port: number;
}, {
    t: "roomOpened";
    roomId: string;
    port: number;
}>, z.ZodObject<{
    t: z.ZodLiteral<"roomClosed">;
    roomId: z.ZodString;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "roomClosed";
    roomId: string;
    reason: string;
}, {
    t: "roomClosed";
    roomId: string;
    reason: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"report">;
    roomId: z.ZodString;
    characters: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    roomState: z.ZodOptional<z.ZodObject<{
        timeOfDay: z.ZodNumber;
        savedAt: z.ZodNumber;
        drops: z.ZodDefault<z.ZodArray<z.ZodObject<{
            items: z.ZodArray<z.ZodObject<{
                item: z.ZodString;
                qty: z.ZodNumber;
                rarity: z.ZodString;
                /** per-instance stat rolls: stat id → multiplier (absent on non-equippables) */
                stats: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                /** durability remaining (uses); item breaks at 0 */
                dur: z.ZodOptional<z.ZodNumber>;
                /** rolled durability ceiling for this instance */
                maxDur: z.ZodOptional<z.ZodNumber>;
                /** dynamic modifiers: modifier id (shared/modifiers.json) → magnitude in
                 *  the modifier's units; curses negative. Absent = unmodified (the state
                 *  merge guards and the enchanter's eligibility rule key on). */
                mods: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            }, "strip", z.ZodTypeAny, {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }, {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }>, "many">;
            gold: z.ZodNumber;
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
            /** character id whose lock applies, or null for free-for-all */
            owner: z.ZodNullable<z.ZodString>;
            unlockAt: z.ZodNumber;
            expireAt: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }, {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }>, "many">>;
        /** per-spawner pending respawn timestamps (ms epoch) */
        spawners: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodNumber, "many">>>;
        /** sparse voxel edits applied over deterministic generation */
        blocks: z.ZodDefault<z.ZodArray<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
            id: z.ZodNumber;
            owner: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }, {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }>, "many">>;
        /** prefab loot caches: "x,y,z" cache key → lastLootedAt ms epoch, so a
         *  restart doesn't refill freshly-looted caches instantly */
        caches: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        blocks: {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }[];
        timeOfDay: number;
        savedAt: number;
        drops: {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[];
        spawners: Record<string, number[]>;
        caches: Record<string, number>;
    }, {
        timeOfDay: number;
        savedAt: number;
        blocks?: {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }[] | undefined;
        drops?: {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[] | undefined;
        spawners?: Record<string, number[]> | undefined;
        caches?: Record<string, number> | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    t: "report";
    roomId: string;
    characters: z.objectOutputType<{
        id: z.ZodString;
    }, z.ZodTypeAny, "passthrough">[];
    roomState?: {
        blocks: {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }[];
        timeOfDay: number;
        savedAt: number;
        drops: {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[];
        spawners: Record<string, number[]>;
        caches: Record<string, number>;
    } | undefined;
}, {
    t: "report";
    roomId: string;
    characters: z.objectInputType<{
        id: z.ZodString;
    }, z.ZodTypeAny, "passthrough">[];
    roomState?: {
        timeOfDay: number;
        savedAt: number;
        blocks?: {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }[] | undefined;
        drops?: {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[] | undefined;
        spawners?: Record<string, number[]> | undefined;
        caches?: Record<string, number> | undefined;
    } | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"requestTransfer">;
    roomId: z.ZodString;
    characterId: z.ZodString;
    targetRoomId: z.ZodString;
    /** source portal id when the transfer came from a portal use — the master
     *  lands the player at the paired portal in the target room. Unset
     *  (eviction/respawn/H-key/fallback) = target room's default spawn. */
    viaPortalId: z.ZodOptional<z.ZodString>;
    /** admin teleport: land at these coordinates in the target room instead
     *  of the portal pairing / default spawn (y is ground-snapped) */
    arrival: z.ZodOptional<z.ZodObject<{
        x: z.ZodNumber;
        z: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        z: number;
    }, {
        x: number;
        z: number;
    }>>;
    patch: z.ZodObject<{
        id: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
}, "strip", z.ZodTypeAny, {
    t: "requestTransfer";
    roomId: string;
    characterId: string;
    targetRoomId: string;
    patch: {
        id: string;
    } & {
        [k: string]: unknown;
    };
    viaPortalId?: string | undefined;
    arrival?: {
        x: number;
        z: number;
    } | undefined;
}, {
    t: "requestTransfer";
    roomId: string;
    characterId: string;
    targetRoomId: string;
    patch: {
        id: string;
    } & {
        [k: string]: unknown;
    };
    viaPortalId?: string | undefined;
    arrival?: {
        x: number;
        z: number;
    } | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"globalChat">;
    from: z.ZodString;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    text: string;
    t: "globalChat";
    from: string;
}, {
    text: string;
    t: "globalChat";
    from: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"mapData">;
    roomId: z.ZodString;
    w: z.ZodNumber;
    h: z.ZodNumber;
    data: z.ZodString;
}, "strip", z.ZodTypeAny, {
    w: number;
    h: number;
    t: "mapData";
    roomId: string;
    data: string;
}, {
    w: number;
    h: number;
    t: "mapData";
    roomId: string;
    data: string;
}>]>;
export type ShardToMaster = z.infer<typeof ShardToMasterSchema>;
export declare const MasterToShardSchema: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
    t: z.ZodLiteral<"registered">;
    ok: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    t: "registered";
    ok: boolean;
}, {
    t: "registered";
    ok: boolean;
}>, z.ZodObject<{
    t: z.ZodLiteral<"openRoom">;
    roomId: z.ZodString;
    snapshot: z.ZodNullable<z.ZodObject<{
        timeOfDay: z.ZodNumber;
        savedAt: z.ZodNumber;
        drops: z.ZodDefault<z.ZodArray<z.ZodObject<{
            items: z.ZodArray<z.ZodObject<{
                item: z.ZodString;
                qty: z.ZodNumber;
                rarity: z.ZodString;
                /** per-instance stat rolls: stat id → multiplier (absent on non-equippables) */
                stats: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
                /** durability remaining (uses); item breaks at 0 */
                dur: z.ZodOptional<z.ZodNumber>;
                /** rolled durability ceiling for this instance */
                maxDur: z.ZodOptional<z.ZodNumber>;
                /** dynamic modifiers: modifier id (shared/modifiers.json) → magnitude in
                 *  the modifier's units; curses negative. Absent = unmodified (the state
                 *  merge guards and the enchanter's eligibility rule key on). */
                mods: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            }, "strip", z.ZodTypeAny, {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }, {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }>, "many">;
            gold: z.ZodNumber;
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
            /** character id whose lock applies, or null for free-for-all */
            owner: z.ZodNullable<z.ZodString>;
            unlockAt: z.ZodNumber;
            expireAt: z.ZodNullable<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }, {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }>, "many">>;
        /** per-spawner pending respawn timestamps (ms epoch) */
        spawners: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodNumber, "many">>>;
        /** sparse voxel edits applied over deterministic generation */
        blocks: z.ZodDefault<z.ZodArray<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            z: z.ZodNumber;
            id: z.ZodNumber;
            owner: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }, {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }>, "many">>;
        /** prefab loot caches: "x,y,z" cache key → lastLootedAt ms epoch, so a
         *  restart doesn't refill freshly-looted caches instantly */
        caches: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        blocks: {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }[];
        timeOfDay: number;
        savedAt: number;
        drops: {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[];
        spawners: Record<string, number[]>;
        caches: Record<string, number>;
    }, {
        timeOfDay: number;
        savedAt: number;
        blocks?: {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }[] | undefined;
        drops?: {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[] | undefined;
        spawners?: Record<string, number[]> | undefined;
        caches?: Record<string, number> | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    t: "openRoom";
    roomId: string;
    snapshot: {
        blocks: {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }[];
        timeOfDay: number;
        savedAt: number;
        drops: {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[];
        spawners: Record<string, number[]>;
        caches: Record<string, number>;
    } | null;
}, {
    t: "openRoom";
    roomId: string;
    snapshot: {
        timeOfDay: number;
        savedAt: number;
        blocks?: {
            id: number;
            x: number;
            z: number;
            y: number;
            owner: string | null;
        }[] | undefined;
        drops?: {
            x: number;
            z: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
                stats?: Record<string, number> | undefined;
                dur?: number | undefined;
                maxDur?: number | undefined;
                mods?: Record<string, number> | undefined;
            }[];
            gold: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[] | undefined;
        spawners?: Record<string, number[]> | undefined;
        caches?: Record<string, number> | undefined;
    } | null;
}>, z.ZodObject<{
    t: z.ZodLiteral<"closeRoom">;
    roomId: z.ZodString;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "closeRoom";
    roomId: string;
    reason: string;
}, {
    t: "closeRoom";
    roomId: string;
    reason: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"ticket">;
    roomId: z.ZodString;
    ticket: z.ZodString;
    expiresAt: z.ZodNumber;
    character: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        level: z.ZodNumber;
        xp: z.ZodNumber;
        gold: z.ZodNumber;
        inventory: z.ZodArray<z.ZodNullable<z.ZodObject<{
            item: z.ZodString;
            qty: z.ZodNumber;
            rarity: z.ZodString;
            /** per-instance stat rolls: stat id → multiplier (absent on non-equippables) */
            stats: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            /** durability remaining (uses); item breaks at 0 */
            dur: z.ZodOptional<z.ZodNumber>;
            /** rolled durability ceiling for this instance */
            maxDur: z.ZodOptional<z.ZodNumber>;
            /** dynamic modifiers: modifier id (shared/modifiers.json) → magnitude in
             *  the modifier's units; curses negative. Absent = unmodified (the state
             *  merge guards and the enchanter's eligibility rule key on). */
            mods: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        }, {
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        }>>, "many">;
        /** worn gear, indexed by EQUIP_SLOTS order (head/chest/legs/feet/offhand).
         *  Optional: rows/tickets minted before equipment existed validate fine. */
        equipment: z.ZodOptional<z.ZodArray<z.ZodNullable<z.ZodObject<{
            item: z.ZodString;
            qty: z.ZodNumber;
            rarity: z.ZodString;
            /** per-instance stat rolls: stat id → multiplier (absent on non-equippables) */
            stats: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
            /** durability remaining (uses); item breaks at 0 */
            dur: z.ZodOptional<z.ZodNumber>;
            /** rolled durability ceiling for this instance */
            maxDur: z.ZodOptional<z.ZodNumber>;
            /** dynamic modifiers: modifier id (shared/modifiers.json) → magnitude in
             *  the modifier's units; curses negative. Absent = unmodified (the state
             *  merge guards and the enchanter's eligibility rule key on). */
            mods: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        }, "strip", z.ZodTypeAny, {
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        }, {
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        }>>, "many">>;
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
        yaw: z.ZodNumber;
        roles: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        id: string;
        x: number;
        z: number;
        level: number;
        name: string;
        yaw: number;
        xp: number;
        gold: number;
        inventory: ({
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        } | null)[];
        y: number;
        roles: string[];
        equipment?: ({
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        } | null)[] | undefined;
    }, {
        id: string;
        x: number;
        z: number;
        level: number;
        name: string;
        yaw: number;
        xp: number;
        gold: number;
        inventory: ({
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        } | null)[];
        y: number;
        roles: string[];
        equipment?: ({
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        } | null)[] | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    expiresAt: number;
    t: "ticket";
    roomId: string;
    ticket: string;
    character: {
        id: string;
        x: number;
        z: number;
        level: number;
        name: string;
        yaw: number;
        xp: number;
        gold: number;
        inventory: ({
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        } | null)[];
        y: number;
        roles: string[];
        equipment?: ({
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        } | null)[] | undefined;
    };
}, {
    expiresAt: number;
    t: "ticket";
    roomId: string;
    ticket: string;
    character: {
        id: string;
        x: number;
        z: number;
        level: number;
        name: string;
        yaw: number;
        xp: number;
        gold: number;
        inventory: ({
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        } | null)[];
        y: number;
        roles: string[];
        equipment?: ({
            item: string;
            qty: number;
            rarity: string;
            stats?: Record<string, number> | undefined;
            dur?: number | undefined;
            maxDur?: number | undefined;
            mods?: Record<string, number> | undefined;
        } | null)[] | undefined;
    };
}>, z.ZodObject<{
    t: z.ZodLiteral<"transferGrant">;
    roomId: z.ZodString;
    characterId: z.ZodString;
    targetRoomId: z.ZodString;
    wsUrl: z.ZodString;
    ticket: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "transferGrant";
    roomId: string;
    characterId: string;
    targetRoomId: string;
    ticket: string;
    wsUrl: string;
}, {
    t: "transferGrant";
    roomId: string;
    characterId: string;
    targetRoomId: string;
    ticket: string;
    wsUrl: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"transferDeny">;
    roomId: z.ZodString;
    characterId: z.ZodString;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "transferDeny";
    roomId: string;
    reason: string;
    characterId: string;
}, {
    t: "transferDeny";
    roomId: string;
    reason: string;
    characterId: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"globalChat">;
    from: z.ZodString;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    text: string;
    t: "globalChat";
    from: string;
}, {
    text: string;
    t: "globalChat";
    from: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"roomStatus">;
    roomId: z.ZodString;
    open: z.ZodBoolean;
    /** closed rooms on a reset timer: seconds until the reopen (portals
     *  display the countdown) */
    reopenInSec: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    t: "roomStatus";
    roomId: string;
    open: boolean;
    reopenInSec?: number | undefined;
}, {
    t: "roomStatus";
    roomId: string;
    open: boolean;
    reopenInSec?: number | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"kick">;
    roomId: z.ZodString;
    characterId: z.ZodString;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "kick";
    roomId: string;
    reason: string;
    characterId: string;
}, {
    t: "kick";
    roomId: string;
    reason: string;
    characterId: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"adminMove">;
    roomId: z.ZodString;
    characterId: z.ZodString;
    targetRoomId: z.ZodString;
    x: z.ZodOptional<z.ZodNumber>;
    z: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    t: "adminMove";
    roomId: string;
    characterId: string;
    targetRoomId: string;
    x?: number | undefined;
    z?: number | undefined;
}, {
    t: "adminMove";
    roomId: string;
    characterId: string;
    targetRoomId: string;
    x?: number | undefined;
    z?: number | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"requestMap">;
    roomId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "requestMap";
    roomId: string;
}, {
    t: "requestMap";
    roomId: string;
}>]>;
export type MasterToShard = z.infer<typeof MasterToShardSchema>;
export declare const ClientToServerSchema: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
    t: z.ZodLiteral<"hello">;
    v: z.ZodNumber;
    ticket: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "hello";
    ticket: string;
    v: number;
}, {
    t: "hello";
    ticket: string;
    v: number;
}>, z.ZodObject<{
    t: z.ZodLiteral<"move">;
    seq: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
    yaw: z.ZodNumber;
    /** camera pitch — kept fresh so projectiles release where you AIM NOW,
     *  not where you clicked (optional: bots don't send it) */
    pitch: z.ZodOptional<z.ZodNumber>;
    anim: z.ZodString;
}, "strip", z.ZodTypeAny, {
    x: number;
    z: number;
    yaw: number;
    y: number;
    anim: string;
    t: "move";
    seq: number;
    pitch?: number | undefined;
}, {
    x: number;
    z: number;
    yaw: number;
    y: number;
    anim: string;
    t: "move";
    seq: number;
    pitch?: number | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"usePortal">;
    portalId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    portalId: string;
    t: "usePortal";
}, {
    portalId: string;
    t: "usePortal";
}>, z.ZodObject<{
    t: z.ZodLiteral<"attack">;
    yaw: z.ZodNumber;
    pitch: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    yaw: number;
    t: "attack";
    pitch: number;
}, {
    yaw: number;
    t: "attack";
    pitch: number;
}>, z.ZodObject<{
    t: z.ZodLiteral<"equip">;
    slot: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    slot: number;
    t: "equip";
}, {
    slot: number;
    t: "equip";
}>, z.ZodObject<{
    t: z.ZodLiteral<"equipSlot">;
    slot: z.ZodEnum<["head", "chest", "legs", "feet", "offhand"]>;
    invIndex: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    slot: "head" | "chest" | "legs" | "feet" | "offhand";
    t: "equipSlot";
    invIndex?: number | undefined;
}, {
    slot: "head" | "chest" | "legs" | "feet" | "offhand";
    t: "equipSlot";
    invIndex?: number | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"enchant">;
    npc: z.ZodNumber;
    slot: z.ZodNumber;
    enchantId: z.ZodString;
    tier: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    slot: number;
    tier: number;
    t: "enchant";
    npc: number;
    enchantId: string;
}, {
    slot: number;
    tier: number;
    t: "enchant";
    npc: number;
    enchantId: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"unenchant">;
    npc: z.ZodNumber;
    slot: z.ZodNumber;
    modId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    slot: number;
    t: "unenchant";
    npc: number;
    modId: string;
}, {
    slot: number;
    t: "unenchant";
    npc: number;
    modId: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"invMove">;
    from: z.ZodNumber;
    to: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    t: "invMove";
    from: number;
    to: number;
}, {
    t: "invMove";
    from: number;
    to: number;
}>, z.ZodObject<{
    t: z.ZodLiteral<"consume">;
    slot: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    slot: number;
    t: "consume";
}, {
    slot: number;
    t: "consume";
}>, z.ZodObject<{
    t: z.ZodLiteral<"dropItem">;
    slot: z.ZodNumber;
    qty: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    slot: number;
    qty: number;
    t: "dropItem";
}, {
    slot: number;
    qty: number;
    t: "dropItem";
}>, z.ZodObject<{
    t: z.ZodLiteral<"pickup">;
    id: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: number;
    t: "pickup";
}, {
    id: number;
    t: "pickup";
}>, z.ZodObject<{
    t: z.ZodLiteral<"talk">;
    id: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: number;
    t: "talk";
}, {
    id: number;
    t: "talk";
}>, z.ZodObject<{
    t: z.ZodLiteral<"buy">;
    npc: z.ZodNumber;
    item: z.ZodString;
    qty: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    item: string;
    qty: number;
    t: "buy";
    npc: number;
}, {
    item: string;
    qty: number;
    t: "buy";
    npc: number;
}>, z.ZodObject<{
    t: z.ZodLiteral<"sell">;
    npc: z.ZodNumber;
    slot: z.ZodNumber;
    qty: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    slot: number;
    qty: number;
    t: "sell";
    npc: number;
}, {
    slot: number;
    qty: number;
    t: "sell";
    npc: number;
}>, z.ZodObject<{
    t: z.ZodLiteral<"chat">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    text: string;
    t: "chat";
}, {
    text: string;
    t: "chat";
}>, z.ZodObject<{
    t: z.ZodLiteral<"respawn">;
}, "strip", z.ZodTypeAny, {
    t: "respawn";
}, {
    t: "respawn";
}>, z.ZodObject<{
    t: z.ZodLiteral<"returnToHub">;
}, "strip", z.ZodTypeAny, {
    t: "returnToHub";
}, {
    t: "returnToHub";
}>, z.ZodObject<{
    t: z.ZodLiteral<"blockPlace">;
    slot: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    x: number;
    z: number;
    slot: number;
    y: number;
    t: "blockPlace";
}, {
    x: number;
    z: number;
    slot: number;
    y: number;
    t: "blockPlace";
}>, z.ZodObject<{
    t: z.ZodLiteral<"blockBreak">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    x: number;
    z: number;
    y: number;
    t: "blockBreak";
}, {
    x: number;
    z: number;
    y: number;
    t: "blockBreak";
}>, z.ZodObject<{
    t: z.ZodLiteral<"ping">;
    n: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    n: number;
    t: "ping";
}, {
    n: number;
    t: "ping";
}>, z.ZodObject<{
    t: z.ZodLiteral<"leave">;
}, "strip", z.ZodTypeAny, {
    t: "leave";
}, {
    t: "leave";
}>]>;
export type ClientToServer = z.infer<typeof ClientToServerSchema>;
export interface PortalWire {
    id: string;
    label: string;
    target: string;
    x: number;
    z: number;
    r: number;
    /** false = destination room is down (sealed dungeon portal) */
    open: boolean;
    /** closed rooms on a reset timer: seconds until the destination reopens
     *  (clients count down locally from receipt; absent = no known timer,
     *  e.g. boss-guarded seals) */
    reopenInSec?: number;
    /** DESTINATION room's suggested level band (its def's levelBand, resolved
     *  server-side) — labels render "Lv 8-10" colored vs the viewer's level.
     *  Absent for band-less targets (hub/grounds/atelier). */
    band?: {
        min: number;
        max: number;
    };
}
export interface RegionWire {
    x: number;
    z: number;
    r: number;
    pvp: boolean;
}
/** Combat/progression events. Transient — clients render and forget. */
export type CombatEvent = {
    kind: "dmg";
    src: number;
    tgt: number;
    amount: number;
    crit: boolean;
} | {
    kind: "heal";
    tgt: number;
    amount: number;
} | {
    kind: "death";
    id: number;
    by: number | null;
} | {
    kind: "stagger";
    id: number;
} | {
    kind: "xp";
    amount: number;
} | {
    kind: "levelup";
    id: number;
    level: number;
}
/** a summon ability released at entity `id` (clients cue the war-horn) */
 | {
    kind: "summon";
    id: number;
};
export interface ShopWire {
    items: Array<{
        item: string;
        price: number;
    }>;
    buys: boolean;
}
/** An enchanter NPC's weaving menu. Each offer carries the modifier's strength
 *  ladder `tiers` [I,II,III]; the applied strength is min(this weaver's
 *  `maxTier`, the target item's tier capacity). Prices are computed client-side
 *  per target item from shared constants (`enchanting`); the server recomputes
 *  authoritatively at `enchant` receipt. `remove` = this weaver can strip a
 *  woven enchant (and lift curses). */
export interface EnchantWire {
    offers: Array<{
        id: string;
        name: string;
        tiers: number[];
        priceMult: number;
    }>;
    maxTier: number;
    remove: boolean;
}
/** One active effect on the self status bar. `durMs` is REMAINING duration
 *  at send time (client stamps a local end and counts down); `mod` entries
 *  are persistent gear modifiers (one per modifier id, magnitudes summed
 *  across equipped+held items). */
export type EffectWire = {
    kind: "mod";
    id: string;
    mag: number;
    curse: boolean;
} | {
    kind: "slow";
    mag: number;
    durMs: number;
} | {
    kind: "dot";
    mag: number;
    durMs: number;
} | {
    kind: "hot";
    item: string;
    mag: number;
    durMs: number;
};
export type ServerToClient = 
/** roomName = the room's DISPLAY name (def.name — "Greywatch", not "hub"); the HUD/minimap render it */
{
    t: "welcome";
    roomId: string;
    roomName: string;
    selfId: number;
    name: string;
    sprite: string;
    spawn: {
        x: number;
        y: number;
        z: number;
        yaw: number;
    };
    timeOfDay: number;
    ents: EntityFull[];
    safeZone: boolean;
    regions: RegionWire[];
    buildingEnabled: boolean;
}
/** voxel world header: dimensions + how many chunk payloads follow */
 | {
    t: "world";
    w: number;
    h: number;
    height: number;
    waterLevel: number | null;
    chunks: number;
    wind: number;
    nightLight: number;
}
/** deflated 16×16×height block chunks (base64 raw-deflate), batched */
 | {
    t: "chunks";
    batch: Array<{
        cx: number;
        cz: number;
        data: string;
    }>;
}
/** a single live block change (player build/break, admin clears) */
 | {
    t: "blockSet";
    x: number;
    y: number;
    z: number;
    id: number;
} | {
    t: "portals";
    portals: PortalWire[];
} | {
    t: "transferFailed";
    reason: string;
} | {
    t: "reject";
    reason: string;
} | {
    t: "snap";
    tick: number;
    ents: EntityDelta[];
    enter: EntityFull[];
    leave: number[];
} | {
    t: "correct";
    seq: number;
    x: number;
    y: number;
    z: number;
} | {
    t: "pong";
    n: number;
    timeOfDay: number;
} | {
    t: "transfer";
    wsUrl: string;
    roomId: string;
    ticket: string;
} | {
    t: "evict";
    reason: string;
} | {
    t: "stats";
    hp: number;
    maxHp: number;
    mana: number;
    maxMana: number;
    xp: number;
    xpNext: number;
    level: number;
    gold: number;
} | {
    t: "inv";
    slots: Array<ItemStack | null>;
    held: number;
    equipment: Array<ItemStack | null>;
}
/** self status effects: aggregated gear modifiers + timed slow/dot/hot.
 *  speedMult = the capped mods-only movement multiplier — the client
 *  mirrors it in prediction exactly like the `debuff` slow. Sent after
 *  welcome and whenever the set changes. */
 | {
    t: "effects";
    speedMult: number;
    list: EffectWire[];
} | {
    t: "evt";
    e: CombatEvent;
} | {
    t: "proj";
    id: number;
    fx: string;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    ttlMs: number;
    scale?: number;
    impactFx?: string;
} | {
    t: "projHit";
    id: number;
    x: number;
    y: number;
    z: number;
}
/** a marching line of fire pillars: each entry telegraphs for delayMs
 *  after receipt, then ignites and burns for burnMs (visual is client-side;
 *  damage is server-side in the ignite window) */
 | {
    t: "pillars";
    list: Array<{
        x: number;
        y: number;
        z: number;
        delayMs: number;
    }>;
    burnMs: number;
    radius: number;
} | {
    t: "debuff";
    id: number;
    slowPct: number;
    durMs: number;
} | {
    t: "died";
    x: number;
    y: number;
    z: number;
} | {
    t: "chat";
    channel: "room" | "global" | "system";
    from: string;
    text: string;
} | {
    t: "dialog";
    id: number;
    name: string;
    lines: string[];
    shop: ShopWire | null;
    enchant?: EnchantWire | null;
} | {
    t: "portalState";
    target: string;
    open: boolean;
    reopenInSec?: number;
};
export declare function encode(msg: object): string;
/** Decode + validate a shard→master control message. Throws on bad input. */
export declare function decodeShardToMaster(raw: unknown): ShardToMaster;
/** Decode + validate a master→shard control message. Throws on bad input. */
export declare function decodeMasterToShard(raw: unknown): MasterToShard;
/** Decode + validate a client→server gameplay message. Throws on bad input. */
export declare function decodeClientToServer(raw: unknown): ClientToServer;
//# sourceMappingURL=protocol.d.ts.map