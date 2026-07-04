import { z } from "zod";
export declare const PortalDefSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    target: z.ZodString;
    x: z.ZodNumber;
    z: z.ZodNumber;
    r: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    label: string;
    target: string;
    x: number;
    z: number;
    r: number;
}, {
    id: string;
    label: string;
    target: string;
    x: number;
    z: number;
    r: number;
}>;
export type PortalDef = z.infer<typeof PortalDefSchema>;
export declare const SpawnTableSchema: z.ZodObject<{
    id: z.ZodString;
    region: z.ZodObject<{
        kind: z.ZodLiteral<"circle">;
        x: z.ZodNumber;
        z: z.ZodNumber;
        r: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        kind: "circle";
        x: number;
        z: number;
        r: number;
    }, {
        kind: "circle";
        x: number;
        z: number;
        r: number;
    }>;
    mobs: z.ZodArray<z.ZodObject<{
        mob: z.ZodString;
        weight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        weight: number;
        mob: string;
    }, {
        weight: number;
        mob: string;
    }>, "many">;
    maxAlive: z.ZodNumber;
    packSize: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
    respawnSec: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    region: {
        kind: "circle";
        x: number;
        z: number;
        r: number;
    };
    mobs: {
        weight: number;
        mob: string;
    }[];
    maxAlive: number;
    packSize: [number, number];
    respawnSec: number;
}, {
    id: string;
    region: {
        kind: "circle";
        x: number;
        z: number;
        r: number;
    };
    mobs: {
        weight: number;
        mob: string;
    }[];
    maxAlive: number;
    packSize: [number, number];
    respawnSec: number;
}>;
export type SpawnTable = z.infer<typeof SpawnTableSchema>;
export declare const NpcDefSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    sprite: z.ZodString;
    x: z.ZodNumber;
    z: z.ZodNumber;
    yaw: z.ZodDefault<z.ZodNumber>;
    wanderRadius: z.ZodDefault<z.ZodNumber>;
    dialog: z.ZodArray<z.ZodString, "many">;
    shop: z.ZodOptional<z.ZodObject<{
        items: z.ZodArray<z.ZodString, "many">;
        buys: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        items: string[];
        buys: boolean;
    }, {
        items: string[];
        buys: boolean;
    }>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    sprite: string;
    x: number;
    z: number;
    yaw: number;
    wanderRadius: number;
    dialog: string[];
    shop?: {
        items: string[];
        buys: boolean;
    } | undefined;
}, {
    id: string;
    name: string;
    sprite: string;
    x: number;
    z: number;
    dialog: string[];
    yaw?: number | undefined;
    wanderRadius?: number | undefined;
    shop?: {
        items: string[];
        buys: boolean;
    } | undefined;
}>;
export type NpcDef = z.infer<typeof NpcDefSchema>;
/** A flagged sub-area of a room (PvP zones; more flags later). */
export declare const RegionSchema: z.ZodObject<{
    kind: z.ZodLiteral<"circle">;
    x: z.ZodNumber;
    z: z.ZodNumber;
    r: z.ZodNumber;
    pvp: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    kind: "circle";
    x: number;
    z: number;
    r: number;
    pvp: boolean;
}, {
    kind: "circle";
    x: number;
    z: number;
    r: number;
    pvp?: boolean | undefined;
}>;
export type RegionDef = z.infer<typeof RegionSchema>;
/** Ephemeral-room lifecycle: live for lifetimeSec, warn, evict, close; the
 *  master reopens it fresh after downtimeSec. */
export declare const LifecycleSchema: z.ZodObject<{
    lifetimeSec: z.ZodNumber;
    downtimeSec: z.ZodNumber;
    warnAtSecLeft: z.ZodArray<z.ZodNumber, "many">;
}, "strip", z.ZodTypeAny, {
    lifetimeSec: number;
    downtimeSec: number;
    warnAtSecLeft: number[];
}, {
    lifetimeSec: number;
    downtimeSec: number;
    warnAtSecLeft: number[];
}>;
export type LifecycleDef = z.infer<typeof LifecycleSchema>;
export declare const RoomDefSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<["hub", "wilderness", "dungeon", "building"]>;
    biome: z.ZodString;
    persistence: z.ZodEnum<["stateful", "ephemeral"]>;
    /** pin the visual clock (dungeon mood); omit for the live day/night cycle */
    fixedTime: z.ZodOptional<z.ZodNumber>;
    lifecycle: z.ZodOptional<z.ZodObject<{
        lifetimeSec: z.ZodNumber;
        downtimeSec: z.ZodNumber;
        warnAtSecLeft: z.ZodArray<z.ZodNumber, "many">;
    }, "strip", z.ZodTypeAny, {
        lifetimeSec: number;
        downtimeSec: number;
        warnAtSecLeft: number[];
    }, {
        lifetimeSec: number;
        downtimeSec: number;
        warnAtSecLeft: number[];
    }>>;
    regions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        kind: z.ZodLiteral<"circle">;
        x: z.ZodNumber;
        z: z.ZodNumber;
        r: z.ZodNumber;
        pvp: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        kind: "circle";
        x: number;
        z: number;
        r: number;
        pvp: boolean;
    }, {
        kind: "circle";
        x: number;
        z: number;
        r: number;
        pvp?: boolean | undefined;
    }>, "many">>;
    size: z.ZodObject<{
        w: z.ZodNumber;
        h: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        w: number;
        h: number;
    }, {
        w: number;
        h: number;
    }>;
    spawn: z.ZodObject<{
        x: z.ZodNumber;
        z: z.ZodNumber;
        yaw: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        z: number;
        yaw: number;
    }, {
        x: number;
        z: number;
        yaw: number;
    }>;
    /** Voxel terrain parameters — all vertical units are BLOCK Y levels.
     *  base = mean surface height, amplitude = noise relief in blocks,
     *  waterLevel = water fills terrain below this level (omit for none),
     *  plateauRadius = flatten radius around spawn,
     *  treeDensity = per-column tree chance multiplier (biome default 1). */
    terrain: z.ZodObject<{
        kind: z.ZodLiteral<"blocks">;
        seed: z.ZodNumber;
        base: z.ZodNumber;
        amplitude: z.ZodNumber;
        frequency: z.ZodNumber;
        plateauRadius: z.ZodOptional<z.ZodNumber>;
        waterLevel: z.ZodOptional<z.ZodNumber>;
        treeDensity: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        kind: "blocks";
        seed: number;
        base: number;
        amplitude: number;
        frequency: number;
        plateauRadius?: number | undefined;
        waterLevel?: number | undefined;
        treeDensity?: number | undefined;
    }, {
        kind: "blocks";
        seed: number;
        base: number;
        amplitude: number;
        frequency: number;
        plateauRadius?: number | undefined;
        waterLevel?: number | undefined;
        treeDensity?: number | undefined;
    }>;
    flags: z.ZodObject<{
        safeZone: z.ZodBoolean;
        buildingEnabled: z.ZodBoolean;
        pvp: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        pvp: boolean;
        safeZone: boolean;
        buildingEnabled: boolean;
    }, {
        pvp: boolean;
        safeZone: boolean;
        buildingEnabled: boolean;
    }>;
    portals: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        target: z.ZodString;
        x: z.ZodNumber;
        z: z.ZodNumber;
        r: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        label: string;
        target: string;
        x: number;
        z: number;
        r: number;
    }, {
        id: string;
        label: string;
        target: string;
        x: number;
        z: number;
        r: number;
    }>, "many">;
    spawnTables: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        region: z.ZodObject<{
            kind: z.ZodLiteral<"circle">;
            x: z.ZodNumber;
            z: z.ZodNumber;
            r: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            kind: "circle";
            x: number;
            z: number;
            r: number;
        }, {
            kind: "circle";
            x: number;
            z: number;
            r: number;
        }>;
        mobs: z.ZodArray<z.ZodObject<{
            mob: z.ZodString;
            weight: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            weight: number;
            mob: string;
        }, {
            weight: number;
            mob: string;
        }>, "many">;
        maxAlive: z.ZodNumber;
        packSize: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
        respawnSec: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        region: {
            kind: "circle";
            x: number;
            z: number;
            r: number;
        };
        mobs: {
            weight: number;
            mob: string;
        }[];
        maxAlive: number;
        packSize: [number, number];
        respawnSec: number;
    }, {
        id: string;
        region: {
            kind: "circle";
            x: number;
            z: number;
            r: number;
        };
        mobs: {
            weight: number;
            mob: string;
        }[];
        maxAlive: number;
        packSize: [number, number];
        respawnSec: number;
    }>, "many">;
    npcs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        sprite: z.ZodString;
        x: z.ZodNumber;
        z: z.ZodNumber;
        yaw: z.ZodDefault<z.ZodNumber>;
        wanderRadius: z.ZodDefault<z.ZodNumber>;
        dialog: z.ZodArray<z.ZodString, "many">;
        shop: z.ZodOptional<z.ZodObject<{
            items: z.ZodArray<z.ZodString, "many">;
            buys: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            items: string[];
            buys: boolean;
        }, {
            items: string[];
            buys: boolean;
        }>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        sprite: string;
        x: number;
        z: number;
        yaw: number;
        wanderRadius: number;
        dialog: string[];
        shop?: {
            items: string[];
            buys: boolean;
        } | undefined;
    }, {
        id: string;
        name: string;
        sprite: string;
        x: number;
        z: number;
        dialog: string[];
        yaw?: number | undefined;
        wanderRadius?: number | undefined;
        shop?: {
            items: string[];
            buys: boolean;
        } | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    type: "building" | "hub" | "wilderness" | "dungeon";
    biome: string;
    persistence: "stateful" | "ephemeral";
    regions: {
        kind: "circle";
        x: number;
        z: number;
        r: number;
        pvp: boolean;
    }[];
    size: {
        w: number;
        h: number;
    };
    spawn: {
        x: number;
        z: number;
        yaw: number;
    };
    terrain: {
        kind: "blocks";
        seed: number;
        base: number;
        amplitude: number;
        frequency: number;
        plateauRadius?: number | undefined;
        waterLevel?: number | undefined;
        treeDensity?: number | undefined;
    };
    flags: {
        pvp: boolean;
        safeZone: boolean;
        buildingEnabled: boolean;
    };
    portals: {
        id: string;
        label: string;
        target: string;
        x: number;
        z: number;
        r: number;
    }[];
    spawnTables: {
        id: string;
        region: {
            kind: "circle";
            x: number;
            z: number;
            r: number;
        };
        mobs: {
            weight: number;
            mob: string;
        }[];
        maxAlive: number;
        packSize: [number, number];
        respawnSec: number;
    }[];
    npcs: {
        id: string;
        name: string;
        sprite: string;
        x: number;
        z: number;
        yaw: number;
        wanderRadius: number;
        dialog: string[];
        shop?: {
            items: string[];
            buys: boolean;
        } | undefined;
    }[];
    fixedTime?: number | undefined;
    lifecycle?: {
        lifetimeSec: number;
        downtimeSec: number;
        warnAtSecLeft: number[];
    } | undefined;
}, {
    id: string;
    name: string;
    type: "building" | "hub" | "wilderness" | "dungeon";
    biome: string;
    persistence: "stateful" | "ephemeral";
    size: {
        w: number;
        h: number;
    };
    spawn: {
        x: number;
        z: number;
        yaw: number;
    };
    terrain: {
        kind: "blocks";
        seed: number;
        base: number;
        amplitude: number;
        frequency: number;
        plateauRadius?: number | undefined;
        waterLevel?: number | undefined;
        treeDensity?: number | undefined;
    };
    flags: {
        pvp: boolean;
        safeZone: boolean;
        buildingEnabled: boolean;
    };
    portals: {
        id: string;
        label: string;
        target: string;
        x: number;
        z: number;
        r: number;
    }[];
    spawnTables: {
        id: string;
        region: {
            kind: "circle";
            x: number;
            z: number;
            r: number;
        };
        mobs: {
            weight: number;
            mob: string;
        }[];
        maxAlive: number;
        packSize: [number, number];
        respawnSec: number;
    }[];
    npcs: {
        id: string;
        name: string;
        sprite: string;
        x: number;
        z: number;
        dialog: string[];
        yaw?: number | undefined;
        wanderRadius?: number | undefined;
        shop?: {
            items: string[];
            buys: boolean;
        } | undefined;
    }[];
    fixedTime?: number | undefined;
    lifecycle?: {
        lifetimeSec: number;
        downtimeSec: number;
        warnAtSecLeft: number[];
    } | undefined;
    regions?: {
        kind: "circle";
        x: number;
        z: number;
        r: number;
        pvp?: boolean | undefined;
    }[] | undefined;
}>;
export type RoomDef = z.infer<typeof RoomDefSchema>;
/** Loads and validates every room definition in shared/rooms/. */
export declare function loadRoomDefs(): Map<string, RoomDef>;
export declare function loadRoomDef(roomId: string): RoomDef;
//# sourceMappingURL=rooms.d.ts.map