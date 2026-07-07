import { z } from "zod";
export declare const PortalDefSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    target: z.ZodString;
    x: z.ZodNumber;
    z: z.ZodNumber;
    r: z.ZodNumber;
    /** authored arrival point for players coming IN through this portal
     *  (omit to auto-offset from the portal toward the room spawn) */
    exitX: z.ZodOptional<z.ZodNumber>;
    exitZ: z.ZodOptional<z.ZodNumber>;
    /** explicit pairing: the portal id in `target` to arrive at (for rooms
     *  with multiple portals back to the same source room) */
    exitPortalId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    label: string;
    target: string;
    x: number;
    z: number;
    r: number;
    exitX?: number | undefined;
    exitZ?: number | undefined;
    exitPortalId?: string | undefined;
}, {
    id: string;
    label: string;
    target: string;
    x: number;
    z: number;
    r: number;
    exitX?: number | undefined;
    exitZ?: number | undefined;
    exitPortalId?: string | undefined;
}>;
export type PortalDef = z.infer<typeof PortalDefSchema>;
/** Where a paired-portal transfer lands (y is ground-snapped on arrival). */
export interface PortalArrival {
    x: number;
    z: number;
    yaw: number;
}
/**
 * Arrival point in `targetDef` for a player transferring from `sourceRoomId`
 * through portal `via` (via.target === targetDef.id). The paired portal Q is
 * via.exitPortalId when authored, else the first portal in the target whose
 * target points back at the source room. Position = (Q.exitX, Q.exitZ) when
 * authored, else a point offset (Q.r + 1.0) from Q toward the target's spawn;
 * yaw faces away from the portal (the one yaw convention: 0 faces +Z).
 * Returns null when no paired portal exists (caller falls back to def.spawn).
 */
export declare function computePortalArrival(targetDef: RoomDef, sourceRoomId: string, via: PortalDef): PortalArrival | null;
export declare const SpawnTableSchema: z.ZodObject<{
    id: z.ZodString;
    region: z.ZodObject<{
        kind: z.ZodLiteral<"circle">;
        x: z.ZodNumber;
        z: z.ZodNumber;
        r: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        z: number;
        r: number;
        kind: "circle";
    }, {
        x: number;
        z: number;
        r: number;
        kind: "circle";
    }>;
    mobs: z.ZodArray<z.ZodObject<{
        mob: z.ZodString;
        weight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        mob: string;
        weight: number;
    }, {
        mob: string;
        weight: number;
    }>, "many">;
    maxAlive: z.ZodNumber;
    packSize: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
    respawnSec: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    region: {
        x: number;
        z: number;
        r: number;
        kind: "circle";
    };
    mobs: {
        mob: string;
        weight: number;
    }[];
    maxAlive: number;
    packSize: [number, number];
    respawnSec: number;
}, {
    id: string;
    region: {
        x: number;
        z: number;
        r: number;
        kind: "circle";
    };
    mobs: {
        mob: string;
        weight: number;
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
    x: number;
    z: number;
    name: string;
    sprite: string;
    yaw: number;
    wanderRadius: number;
    dialog: string[];
    shop?: {
        items: string[];
        buys: boolean;
    } | undefined;
}, {
    id: string;
    x: number;
    z: number;
    name: string;
    sprite: string;
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
    x: number;
    z: number;
    r: number;
    kind: "circle";
    pvp: boolean;
}, {
    x: number;
    z: number;
    r: number;
    kind: "circle";
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
    /** Ambient wind strength for client foliage sway (0 = still, e.g. dungeons).
     *  Purely visual; sent to the client in the `world` message. ~1 = gentle. */
    wind: z.ZodDefault<z.ZodNumber>;
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
        x: number;
        z: number;
        r: number;
        kind: "circle";
        pvp: boolean;
    }, {
        x: number;
        z: number;
        r: number;
        kind: "circle";
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
     *  waterLevel = liquid fills terrain below this level (omit for none),
     *  liquid = which block fills up to waterLevel (murk_water for swamps,
     *  lava for volcanic rooms; existing rooms keep the default water),
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
        liquid: z.ZodDefault<z.ZodEnum<["water", "murk_water", "lava"]>>;
        treeDensity: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        kind: "blocks";
        seed: number;
        base: number;
        amplitude: number;
        frequency: number;
        liquid: "water" | "murk_water" | "lava";
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
        liquid?: "water" | "murk_water" | "lava" | undefined;
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
        /** authored arrival point for players coming IN through this portal
         *  (omit to auto-offset from the portal toward the room spawn) */
        exitX: z.ZodOptional<z.ZodNumber>;
        exitZ: z.ZodOptional<z.ZodNumber>;
        /** explicit pairing: the portal id in `target` to arrive at (for rooms
         *  with multiple portals back to the same source room) */
        exitPortalId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        label: string;
        target: string;
        x: number;
        z: number;
        r: number;
        exitX?: number | undefined;
        exitZ?: number | undefined;
        exitPortalId?: string | undefined;
    }, {
        id: string;
        label: string;
        target: string;
        x: number;
        z: number;
        r: number;
        exitX?: number | undefined;
        exitZ?: number | undefined;
        exitPortalId?: string | undefined;
    }>, "many">;
    spawnTables: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        region: z.ZodObject<{
            kind: z.ZodLiteral<"circle">;
            x: z.ZodNumber;
            z: z.ZodNumber;
            r: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            z: number;
            r: number;
            kind: "circle";
        }, {
            x: number;
            z: number;
            r: number;
            kind: "circle";
        }>;
        mobs: z.ZodArray<z.ZodObject<{
            mob: z.ZodString;
            weight: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            mob: string;
            weight: number;
        }, {
            mob: string;
            weight: number;
        }>, "many">;
        maxAlive: z.ZodNumber;
        packSize: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
        respawnSec: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        region: {
            x: number;
            z: number;
            r: number;
            kind: "circle";
        };
        mobs: {
            mob: string;
            weight: number;
        }[];
        maxAlive: number;
        packSize: [number, number];
        respawnSec: number;
    }, {
        id: string;
        region: {
            x: number;
            z: number;
            r: number;
            kind: "circle";
        };
        mobs: {
            mob: string;
            weight: number;
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
        x: number;
        z: number;
        name: string;
        sprite: string;
        yaw: number;
        wanderRadius: number;
        dialog: string[];
        shop?: {
            items: string[];
            buys: boolean;
        } | undefined;
    }, {
        id: string;
        x: number;
        z: number;
        name: string;
        sprite: string;
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
    type: "hub" | "wilderness" | "dungeon" | "building";
    name: string;
    biome: string;
    wind: number;
    persistence: "stateful" | "ephemeral";
    regions: {
        x: number;
        z: number;
        r: number;
        kind: "circle";
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
        liquid: "water" | "murk_water" | "lava";
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
        exitX?: number | undefined;
        exitZ?: number | undefined;
        exitPortalId?: string | undefined;
    }[];
    spawnTables: {
        id: string;
        region: {
            x: number;
            z: number;
            r: number;
            kind: "circle";
        };
        mobs: {
            mob: string;
            weight: number;
        }[];
        maxAlive: number;
        packSize: [number, number];
        respawnSec: number;
    }[];
    npcs: {
        id: string;
        x: number;
        z: number;
        name: string;
        sprite: string;
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
    type: "hub" | "wilderness" | "dungeon" | "building";
    name: string;
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
        liquid?: "water" | "murk_water" | "lava" | undefined;
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
        exitX?: number | undefined;
        exitZ?: number | undefined;
        exitPortalId?: string | undefined;
    }[];
    spawnTables: {
        id: string;
        region: {
            x: number;
            z: number;
            r: number;
            kind: "circle";
        };
        mobs: {
            mob: string;
            weight: number;
        }[];
        maxAlive: number;
        packSize: [number, number];
        respawnSec: number;
    }[];
    npcs: {
        id: string;
        x: number;
        z: number;
        name: string;
        sprite: string;
        dialog: string[];
        yaw?: number | undefined;
        wanderRadius?: number | undefined;
        shop?: {
            items: string[];
            buys: boolean;
        } | undefined;
    }[];
    wind?: number | undefined;
    fixedTime?: number | undefined;
    lifecycle?: {
        lifetimeSec: number;
        downtimeSec: number;
        warnAtSecLeft: number[];
    } | undefined;
    regions?: {
        x: number;
        z: number;
        r: number;
        kind: "circle";
        pvp?: boolean | undefined;
    }[] | undefined;
}>;
export type RoomDef = z.infer<typeof RoomDefSchema>;
/** Loads and validates every room definition in shared/rooms/. */
export declare function loadRoomDefs(): Map<string, RoomDef>;
export declare function loadRoomDef(roomId: string): RoomDef;
//# sourceMappingURL=rooms.d.ts.map