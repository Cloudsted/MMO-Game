/**
 * The ONLY place server code encodes/decodes wire messages. Mirrors
 * shared/protocol.json (the canonical catalog) and client net/Protocol.java.
 * JSON for MVP; a binary encoding swaps in behind encode()/decode*() later.
 */
import { z } from "zod";
/** One inventory slot: per-instance item data from day one (rarity now;
 *  affixes/durability later slot into the same shape). */
export declare const ItemStackSchema: z.ZodObject<{
    item: z.ZodString;
    qty: z.ZodNumber;
    rarity: z.ZodString;
}, "strip", z.ZodTypeAny, {
    item: string;
    qty: number;
    rarity: string;
}, {
    item: string;
    qty: number;
    rarity: string;
}>;
export type ItemStack = z.infer<typeof ItemStackSchema>;
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
    }, "strip", z.ZodTypeAny, {
        item: string;
        qty: number;
        rarity: string;
    }, {
        item: string;
        qty: number;
        rarity: string;
    }>>, "many">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
    yaw: z.ZodNumber;
    roles: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    level: number;
    xp: number;
    gold: number;
    x: number;
    z: number;
    yaw: number;
    inventory: ({
        item: string;
        qty: number;
        rarity: string;
    } | null)[];
    y: number;
    roles: string[];
}, {
    id: string;
    name: string;
    level: number;
    xp: number;
    gold: number;
    x: number;
    z: number;
    yaw: number;
    inventory: ({
        item: string;
        qty: number;
        rarity: string;
    } | null)[];
    y: number;
    roles: string[];
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
}, "strip", z.ZodTypeAny, {
    id: number;
    kind: string;
    x: number;
    z: number;
    yaw: number;
    y: number;
    anim: string;
    name?: string | undefined;
    sprite?: string | undefined;
    level?: number | undefined;
    hp?: number | undefined;
    maxHp?: number | undefined;
    act?: string | undefined;
    actMs?: number | undefined;
}, {
    id: number;
    kind: string;
    x: number;
    z: number;
    yaw: number;
    y: number;
    anim: string;
    name?: string | undefined;
    sprite?: string | undefined;
    level?: number | undefined;
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
}, "strip", z.ZodTypeAny, {
    id: number;
    hp?: number | undefined;
    x?: number | undefined;
    z?: number | undefined;
    yaw?: number | undefined;
    y?: number | undefined;
    anim?: string | undefined;
    act?: string | undefined;
    actMs?: number | undefined;
}, {
    id: number;
    hp?: number | undefined;
    x?: number | undefined;
    z?: number | undefined;
    yaw?: number | undefined;
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
    }, "strip", z.ZodTypeAny, {
        item: string;
        qty: number;
        rarity: string;
    }, {
        item: string;
        qty: number;
        rarity: string;
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
    gold: number;
    items: {
        item: string;
        qty: number;
        rarity: string;
    }[];
    x: number;
    z: number;
    y: number;
    owner: string | null;
    unlockAt: number;
    expireAt: number | null;
}, {
    gold: number;
    items: {
        item: string;
        qty: number;
        rarity: string;
    }[];
    x: number;
    z: number;
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
        }, "strip", z.ZodTypeAny, {
            item: string;
            qty: number;
            rarity: string;
        }, {
            item: string;
            qty: number;
            rarity: string;
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
        gold: number;
        items: {
            item: string;
            qty: number;
            rarity: string;
        }[];
        x: number;
        z: number;
        y: number;
        owner: string | null;
        unlockAt: number;
        expireAt: number | null;
    }, {
        gold: number;
        items: {
            item: string;
            qty: number;
            rarity: string;
        }[];
        x: number;
        z: number;
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
        gold: number;
        items: {
            item: string;
            qty: number;
            rarity: string;
        }[];
        x: number;
        z: number;
        y: number;
        owner: string | null;
        unlockAt: number;
        expireAt: number | null;
    }[];
    spawners: Record<string, number[]>;
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
        gold: number;
        items: {
            item: string;
            qty: number;
            rarity: string;
        }[];
        x: number;
        z: number;
        y: number;
        owner: string | null;
        unlockAt: number;
        expireAt: number | null;
    }[] | undefined;
    spawners?: Record<string, number[]> | undefined;
}>;
export type RoomState = z.infer<typeof RoomStateSchema>;
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
    }, "strip", z.ZodTypeAny, {
        status: string;
        roomId: string;
        port: number;
        players: number;
    }, {
        status: string;
        roomId: string;
        port: number;
        players: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    rooms: {
        status: string;
        roomId: string;
        port: number;
        players: number;
    }[];
    t: "heartbeat";
}, {
    rooms: {
        status: string;
        roomId: string;
        port: number;
        players: number;
    }[];
    t: "heartbeat";
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
            }, "strip", z.ZodTypeAny, {
                item: string;
                qty: number;
                rarity: string;
            }, {
                item: string;
                qty: number;
                rarity: string;
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
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }, {
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
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
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[];
        spawners: Record<string, number[]>;
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
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[] | undefined;
        spawners?: Record<string, number[]> | undefined;
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
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[];
        spawners: Record<string, number[]>;
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
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[] | undefined;
        spawners?: Record<string, number[]> | undefined;
    } | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"requestTransfer">;
    roomId: z.ZodString;
    characterId: z.ZodString;
    targetRoomId: z.ZodString;
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
}>, z.ZodObject<{
    t: z.ZodLiteral<"globalChat">;
    from: z.ZodString;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "globalChat";
    from: string;
    text: string;
}, {
    t: "globalChat";
    from: string;
    text: string;
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
            }, "strip", z.ZodTypeAny, {
                item: string;
                qty: number;
                rarity: string;
            }, {
                item: string;
                qty: number;
                rarity: string;
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
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }, {
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
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
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[];
        spawners: Record<string, number[]>;
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
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[] | undefined;
        spawners?: Record<string, number[]> | undefined;
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
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[];
        spawners: Record<string, number[]>;
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
            gold: number;
            items: {
                item: string;
                qty: number;
                rarity: string;
            }[];
            x: number;
            z: number;
            y: number;
            owner: string | null;
            unlockAt: number;
            expireAt: number | null;
        }[] | undefined;
        spawners?: Record<string, number[]> | undefined;
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
        }, "strip", z.ZodTypeAny, {
            item: string;
            qty: number;
            rarity: string;
        }, {
            item: string;
            qty: number;
            rarity: string;
        }>>, "many">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
        yaw: z.ZodNumber;
        roles: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        level: number;
        xp: number;
        gold: number;
        x: number;
        z: number;
        yaw: number;
        inventory: ({
            item: string;
            qty: number;
            rarity: string;
        } | null)[];
        y: number;
        roles: string[];
    }, {
        id: string;
        name: string;
        level: number;
        xp: number;
        gold: number;
        x: number;
        z: number;
        yaw: number;
        inventory: ({
            item: string;
            qty: number;
            rarity: string;
        } | null)[];
        y: number;
        roles: string[];
    }>;
}, "strip", z.ZodTypeAny, {
    t: "ticket";
    roomId: string;
    ticket: string;
    expiresAt: number;
    character: {
        id: string;
        name: string;
        level: number;
        xp: number;
        gold: number;
        x: number;
        z: number;
        yaw: number;
        inventory: ({
            item: string;
            qty: number;
            rarity: string;
        } | null)[];
        y: number;
        roles: string[];
    };
}, {
    t: "ticket";
    roomId: string;
    ticket: string;
    expiresAt: number;
    character: {
        id: string;
        name: string;
        level: number;
        xp: number;
        gold: number;
        x: number;
        z: number;
        yaw: number;
        inventory: ({
            item: string;
            qty: number;
            rarity: string;
        } | null)[];
        y: number;
        roles: string[];
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
    t: "globalChat";
    from: string;
    text: string;
}, {
    t: "globalChat";
    from: string;
    text: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"roomStatus">;
    roomId: z.ZodString;
    open: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    t: "roomStatus";
    roomId: string;
    open: boolean;
}, {
    t: "roomStatus";
    roomId: string;
    open: boolean;
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
    t: "usePortal";
    portalId: string;
}, {
    t: "usePortal";
    portalId: string;
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
    t: "equip";
    slot: number;
}, {
    t: "equip";
    slot: number;
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
    t: "consume";
    slot: number;
}, {
    t: "consume";
    slot: number;
}>, z.ZodObject<{
    t: z.ZodLiteral<"dropItem">;
    slot: z.ZodNumber;
    qty: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    qty: number;
    t: "dropItem";
    slot: number;
}, {
    qty: number;
    t: "dropItem";
    slot: number;
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
    qty: number;
    t: "sell";
    slot: number;
    npc: number;
}, {
    qty: number;
    t: "sell";
    slot: number;
    npc: number;
}>, z.ZodObject<{
    t: z.ZodLiteral<"chat">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "chat";
    text: string;
}, {
    t: "chat";
    text: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"respawn">;
}, "strip", z.ZodTypeAny, {
    t: "respawn";
}, {
    t: "respawn";
}>, z.ZodObject<{
    t: z.ZodLiteral<"blockPlace">;
    slot: z.ZodNumber;
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    x: number;
    z: number;
    y: number;
    t: "blockPlace";
    slot: number;
}, {
    x: number;
    z: number;
    y: number;
    t: "blockPlace";
    slot: number;
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
    t: "ping";
    n: number;
}, {
    t: "ping";
    n: number;
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
};
export interface ShopWire {
    items: Array<{
        item: string;
        price: number;
    }>;
    buys: boolean;
}
export type ServerToClient = {
    t: "welcome";
    roomId: string;
    selfId: number;
    name: string;
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
} | {
    t: "projHit";
    id: number;
    x: number;
    y: number;
    z: number;
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
} | {
    t: "portalState";
    target: string;
    open: boolean;
};
export declare function encode(msg: object): string;
/** Decode + validate a shard→master control message. Throws on bad input. */
export declare function decodeShardToMaster(raw: unknown): ShardToMaster;
/** Decode + validate a master→shard control message. Throws on bad input. */
export declare function decodeMasterToShard(raw: unknown): MasterToShard;
/** Decode + validate a client→server gameplay message. Throws on bad input. */
export declare function decodeClientToServer(raw: unknown): ClientToServer;
//# sourceMappingURL=protocol.d.ts.map