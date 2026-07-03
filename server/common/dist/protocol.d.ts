/**
 * The ONLY place server code encodes/decodes wire messages. Mirrors
 * shared/protocol.json (the canonical catalog) and client net/Protocol.java.
 * JSON for MVP; a binary encoding swaps in behind encode()/decode*() later.
 */
import { z } from "zod";
export declare const CharacterSnapshotSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    level: z.ZodNumber;
    xp: z.ZodNumber;
    gold: z.ZodNumber;
    inventory: z.ZodArray<z.ZodUnknown, "many">;
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
    yaw: z.ZodNumber;
    roles: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    id: string;
    x: number;
    z: number;
    name: string;
    yaw: number;
    level: number;
    xp: number;
    gold: number;
    inventory: unknown[];
    y: number;
    roles: string[];
}, {
    id: string;
    x: number;
    z: number;
    name: string;
    yaw: number;
    level: number;
    xp: number;
    gold: number;
    inventory: unknown[];
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
}, "strip", z.ZodTypeAny, {
    id: number;
    x: number;
    z: number;
    yaw: number;
    kind: string;
    y: number;
    anim: string;
    name?: string | undefined;
    sprite?: string | undefined;
}, {
    id: number;
    x: number;
    z: number;
    yaw: number;
    kind: string;
    y: number;
    anim: string;
    name?: string | undefined;
    sprite?: string | undefined;
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
}, "strip", z.ZodTypeAny, {
    id: number;
    x?: number | undefined;
    z?: number | undefined;
    yaw?: number | undefined;
    y?: number | undefined;
    anim?: string | undefined;
}, {
    id: number;
    x?: number | undefined;
    z?: number | undefined;
    yaw?: number | undefined;
    y?: number | undefined;
    anim?: string | undefined;
}>;
export type EntityDelta = z.infer<typeof EntityDeltaSchema>;
/** Persisted per-room dynamic state (grows with drops/buildings in later phases). */
export declare const RoomStateSchema: z.ZodObject<{
    timeOfDay: z.ZodNumber;
    savedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    timeOfDay: number;
    savedAt: number;
}, {
    timeOfDay: number;
    savedAt: number;
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
    }, "strip", z.ZodTypeAny, {
        timeOfDay: number;
        savedAt: number;
    }, {
        timeOfDay: number;
        savedAt: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    t: "report";
    roomId: string;
    characters: z.objectOutputType<{
        id: z.ZodString;
    }, z.ZodTypeAny, "passthrough">[];
    roomState?: {
        timeOfDay: number;
        savedAt: number;
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
    }, "strip", z.ZodTypeAny, {
        timeOfDay: number;
        savedAt: number;
    }, {
        timeOfDay: number;
        savedAt: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    t: "openRoom";
    roomId: string;
    snapshot: {
        timeOfDay: number;
        savedAt: number;
    } | null;
}, {
    t: "openRoom";
    roomId: string;
    snapshot: {
        timeOfDay: number;
        savedAt: number;
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
        inventory: z.ZodArray<z.ZodUnknown, "many">;
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
        yaw: z.ZodNumber;
        roles: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        id: string;
        x: number;
        z: number;
        name: string;
        yaw: number;
        level: number;
        xp: number;
        gold: number;
        inventory: unknown[];
        y: number;
        roles: string[];
    }, {
        id: string;
        x: number;
        z: number;
        name: string;
        yaw: number;
        level: number;
        xp: number;
        gold: number;
        inventory: unknown[];
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
        x: number;
        z: number;
        name: string;
        yaw: number;
        level: number;
        xp: number;
        gold: number;
        inventory: unknown[];
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
        x: number;
        z: number;
        name: string;
        yaw: number;
        level: number;
        xp: number;
        gold: number;
        inventory: unknown[];
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
    anim: z.ZodString;
}, "strip", z.ZodTypeAny, {
    x: number;
    z: number;
    yaw: number;
    y: number;
    anim: string;
    t: "move";
    seq: number;
}, {
    x: number;
    z: number;
    yaw: number;
    y: number;
    anim: string;
    t: "move";
    seq: number;
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
}
export interface WallWire {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    type: string;
}
export interface PropWire {
    id: number;
    type: string;
    x: number;
    z: number;
    r: number;
    s: number;
    /** facing in degrees (0 = front faces +Z, 90 = faces +X); flat props only */
    rot: number;
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
} | {
    t: "terrain";
    w: number;
    h: number;
    heightsB64: string;
    typesB64: string;
    waterLevel: number | null;
} | {
    t: "props";
    props: PropWire[];
    walls: WallWire[];
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
};
export declare function encode(msg: object): string;
/** Decode + validate a shard→master control message. Throws on bad input. */
export declare function decodeShardToMaster(raw: unknown): ShardToMaster;
/** Decode + validate a master→shard control message. Throws on bad input. */
export declare function decodeMasterToShard(raw: unknown): MasterToShard;
/** Decode + validate a client→server gameplay message. Throws on bad input. */
export declare function decodeClientToServer(raw: unknown): ClientToServer;
//# sourceMappingURL=protocol.d.ts.map