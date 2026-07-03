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
export declare const RoomDefSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    type: z.ZodEnum<["hub", "wilderness", "dungeon", "building"]>;
    biome: z.ZodString;
    persistence: z.ZodEnum<["stateful", "ephemeral"]>;
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
    terrain: z.ZodObject<{
        kind: z.ZodEnum<["flat", "heightmap"]>;
        height: z.ZodOptional<z.ZodNumber>;
        seed: z.ZodOptional<z.ZodNumber>;
        amplitude: z.ZodOptional<z.ZodNumber>;
        frequency: z.ZodOptional<z.ZodNumber>;
        plateauRadius: z.ZodOptional<z.ZodNumber>;
        waterLevel: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        kind: "flat" | "heightmap";
        height?: number | undefined;
        seed?: number | undefined;
        amplitude?: number | undefined;
        frequency?: number | undefined;
        plateauRadius?: number | undefined;
        waterLevel?: number | undefined;
    }, {
        kind: "flat" | "heightmap";
        height?: number | undefined;
        seed?: number | undefined;
        amplitude?: number | undefined;
        frequency?: number | undefined;
        plateauRadius?: number | undefined;
        waterLevel?: number | undefined;
    }>;
    /** authored overlay produced by tools/build-maps.mjs (paints, props, walls) */
    map: z.ZodOptional<z.ZodString>;
    propGen: z.ZodOptional<z.ZodObject<{
        trees: z.ZodNumber;
        rocks: z.ZodNumber;
        clearRadius: z.ZodNumber;
        seed: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        seed: number;
        trees: number;
        rocks: number;
        clearRadius: number;
    }, {
        seed: number;
        trees: number;
        rocks: number;
        clearRadius: number;
    }>>;
    flags: z.ZodObject<{
        safeZone: z.ZodBoolean;
        buildingEnabled: z.ZodBoolean;
        pvp: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        safeZone: boolean;
        buildingEnabled: boolean;
        pvp: boolean;
    }, {
        safeZone: boolean;
        buildingEnabled: boolean;
        pvp: boolean;
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
    spawnTables: z.ZodArray<z.ZodUnknown, "many">;
    npcs: z.ZodArray<z.ZodUnknown, "many">;
}, "strip", z.ZodTypeAny, {
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
        kind: "flat" | "heightmap";
        height?: number | undefined;
        seed?: number | undefined;
        amplitude?: number | undefined;
        frequency?: number | undefined;
        plateauRadius?: number | undefined;
        waterLevel?: number | undefined;
    };
    flags: {
        safeZone: boolean;
        buildingEnabled: boolean;
        pvp: boolean;
    };
    portals: {
        id: string;
        label: string;
        target: string;
        x: number;
        z: number;
        r: number;
    }[];
    spawnTables: unknown[];
    npcs: unknown[];
    map?: string | undefined;
    propGen?: {
        seed: number;
        trees: number;
        rocks: number;
        clearRadius: number;
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
        kind: "flat" | "heightmap";
        height?: number | undefined;
        seed?: number | undefined;
        amplitude?: number | undefined;
        frequency?: number | undefined;
        plateauRadius?: number | undefined;
        waterLevel?: number | undefined;
    };
    flags: {
        safeZone: boolean;
        buildingEnabled: boolean;
        pvp: boolean;
    };
    portals: {
        id: string;
        label: string;
        target: string;
        x: number;
        z: number;
        r: number;
    }[];
    spawnTables: unknown[];
    npcs: unknown[];
    map?: string | undefined;
    propGen?: {
        seed: number;
        trees: number;
        rocks: number;
        clearRadius: number;
    } | undefined;
}>;
export type RoomDef = z.infer<typeof RoomDefSchema>;
export declare const MapPaintSchema: z.ZodDiscriminatedUnion<"shape", [z.ZodObject<{
    shape: z.ZodLiteral<"rect">;
    type: z.ZodNumber;
    x0: z.ZodNumber;
    z0: z.ZodNumber;
    x1: z.ZodNumber;
    z1: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: number;
    shape: "rect";
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}, {
    type: number;
    shape: "rect";
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}>, z.ZodObject<{
    shape: z.ZodLiteral<"circle">;
    type: z.ZodNumber;
    x: z.ZodNumber;
    z: z.ZodNumber;
    r: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    x: number;
    z: number;
    r: number;
    type: number;
    shape: "circle";
}, {
    x: number;
    z: number;
    r: number;
    type: number;
    shape: "circle";
}>, z.ZodObject<{
    shape: z.ZodLiteral<"path">;
    type: z.ZodNumber;
    points: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>, "many">;
    width: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    type: number;
    shape: "path";
    points: [number, number][];
    width: number;
}, {
    type: number;
    shape: "path";
    points: [number, number][];
    width: number;
}>]>;
export declare const MapPropSchema: z.ZodObject<{
    type: z.ZodString;
    x: z.ZodNumber;
    z: z.ZodNumber;
    r: z.ZodNumber;
    s: z.ZodNumber;
    rot: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    x: number;
    z: number;
    r: number;
    type: string;
    s: number;
    rot: number;
}, {
    x: number;
    z: number;
    r: number;
    type: string;
    s: number;
    rot?: number | undefined;
}>;
export declare const MapWallSchema: z.ZodObject<{
    x0: z.ZodNumber;
    z0: z.ZodNumber;
    x1: z.ZodNumber;
    z1: z.ZodNumber;
    type: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: string;
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}, {
    type: string;
    x0: number;
    z0: number;
    x1: number;
    z1: number;
}>;
export declare const RoomMapSchema: z.ZodObject<{
    version: z.ZodNumber;
    flatten: z.ZodDefault<z.ZodArray<z.ZodObject<{
        x0: z.ZodNumber;
        z0: z.ZodNumber;
        x1: z.ZodNumber;
        z1: z.ZodNumber;
        height: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        height: number;
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    }, {
        height: number;
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    }>, "many">>;
    paints: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<"shape", [z.ZodObject<{
        shape: z.ZodLiteral<"rect">;
        type: z.ZodNumber;
        x0: z.ZodNumber;
        z0: z.ZodNumber;
        x1: z.ZodNumber;
        z1: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: number;
        shape: "rect";
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    }, {
        type: number;
        shape: "rect";
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    }>, z.ZodObject<{
        shape: z.ZodLiteral<"circle">;
        type: z.ZodNumber;
        x: z.ZodNumber;
        z: z.ZodNumber;
        r: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        z: number;
        r: number;
        type: number;
        shape: "circle";
    }, {
        x: number;
        z: number;
        r: number;
        type: number;
        shape: "circle";
    }>, z.ZodObject<{
        shape: z.ZodLiteral<"path">;
        type: z.ZodNumber;
        points: z.ZodArray<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>, "many">;
        width: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        type: number;
        shape: "path";
        points: [number, number][];
        width: number;
    }, {
        type: number;
        shape: "path";
        points: [number, number][];
        width: number;
    }>]>, "many">>;
    props: z.ZodDefault<z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        x: z.ZodNumber;
        z: z.ZodNumber;
        r: z.ZodNumber;
        s: z.ZodNumber;
        rot: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        x: number;
        z: number;
        r: number;
        type: string;
        s: number;
        rot: number;
    }, {
        x: number;
        z: number;
        r: number;
        type: string;
        s: number;
        rot?: number | undefined;
    }>, "many">>;
    walls: z.ZodDefault<z.ZodArray<z.ZodObject<{
        x0: z.ZodNumber;
        z0: z.ZodNumber;
        x1: z.ZodNumber;
        z1: z.ZodNumber;
        type: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: string;
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    }, {
        type: string;
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    version: number;
    flatten: {
        height: number;
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    }[];
    paints: ({
        type: number;
        shape: "rect";
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    } | {
        x: number;
        z: number;
        r: number;
        type: number;
        shape: "circle";
    } | {
        type: number;
        shape: "path";
        points: [number, number][];
        width: number;
    })[];
    props: {
        x: number;
        z: number;
        r: number;
        type: string;
        s: number;
        rot: number;
    }[];
    walls: {
        type: string;
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    }[];
}, {
    version: number;
    flatten?: {
        height: number;
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    }[] | undefined;
    paints?: ({
        type: number;
        shape: "rect";
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    } | {
        x: number;
        z: number;
        r: number;
        type: number;
        shape: "circle";
    } | {
        type: number;
        shape: "path";
        points: [number, number][];
        width: number;
    })[] | undefined;
    props?: {
        x: number;
        z: number;
        r: number;
        type: string;
        s: number;
        rot?: number | undefined;
    }[] | undefined;
    walls?: {
        type: string;
        x0: number;
        z0: number;
        x1: number;
        z1: number;
    }[] | undefined;
}>;
export type RoomMap = z.infer<typeof RoomMapSchema>;
/** Loads a room's authored map overlay from shared/rooms/maps/. */
export declare function loadRoomMap(file: string): RoomMap;
/** Loads and validates every room definition in shared/rooms/. */
export declare function loadRoomDefs(): Map<string, RoomDef>;
export declare function loadRoomDef(roomId: string): RoomDef;
//# sourceMappingURL=rooms.d.ts.map