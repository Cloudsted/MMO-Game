import { z } from "zod";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { readJsonFile } from "./json.js";
import { SHARED_DIR } from "./paths.js";

export const PortalDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  target: z.string(), // room id
  x: z.number(),
  z: z.number(),
  r: z.number(), // trigger radius (metres)
});
export type PortalDef = z.infer<typeof PortalDefSchema>;

export const RoomDefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["hub", "wilderness", "dungeon", "building"]),
  biome: z.string(),
  persistence: z.enum(["stateful", "ephemeral"]),
  size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  spawn: z.object({ x: z.number(), z: z.number(), yaw: z.number() }),
  terrain: z.object({
    kind: z.enum(["flat", "heightmap"]),
    height: z.number().optional(),
    seed: z.number().optional(),
    amplitude: z.number().optional(),
    frequency: z.number().optional(),
    plateauRadius: z.number().optional(),
    waterLevel: z.number().optional(),
  }),
  /** authored overlay produced by tools/build-maps.mjs (paints, props, walls) */
  map: z.string().optional(),
  propGen: z
    .object({
      trees: z.number().int(),
      rocks: z.number().int(),
      clearRadius: z.number(),
      seed: z.number(),
    })
    .optional(),
  flags: z.object({
    safeZone: z.boolean(),
    buildingEnabled: z.boolean(),
    pvp: z.boolean(),
  }),
  portals: z.array(PortalDefSchema),
  spawnTables: z.array(z.unknown()),
  npcs: z.array(z.unknown()),
});

export type RoomDef = z.infer<typeof RoomDefSchema>;

// ---------- authored map overlay (output of tools/build-maps.mjs) ----------

export const MapPaintSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("rect"), type: z.number().int(), x0: z.number(), z0: z.number(), x1: z.number(), z1: z.number() }),
  z.object({ shape: z.literal("circle"), type: z.number().int(), x: z.number(), z: z.number(), r: z.number() }),
  z.object({ shape: z.literal("path"), type: z.number().int(), points: z.array(z.tuple([z.number(), z.number()])), width: z.number() }),
]);

export const MapPropSchema = z.object({
  type: z.string(),
  x: z.number(),
  z: z.number(),
  r: z.number(), // collision cylinder radius, 0 = walk-through
  s: z.number(),
  rot: z.number().default(0), // facing in degrees (flat props)
});

export const MapWallSchema = z.object({
  // straight wall run rendered as repeated panels; collision = thick segment
  x0: z.number(),
  z0: z.number(),
  x1: z.number(),
  z1: z.number(),
  type: z.string(), // wall texture key in the prop atlas
});

export const RoomMapSchema = z.object({
  version: z.number().int(),
  flatten: z
    .array(z.object({ x0: z.number(), z0: z.number(), x1: z.number(), z1: z.number(), height: z.number() }))
    .default([]),
  paints: z.array(MapPaintSchema).default([]),
  props: z.array(MapPropSchema).default([]),
  walls: z.array(MapWallSchema).default([]),
});
export type RoomMap = z.infer<typeof RoomMapSchema>;

/** Loads a room's authored map overlay from shared/rooms/maps/. */
export function loadRoomMap(file: string): RoomMap {
  return RoomMapSchema.parse(readJsonFile(resolve(SHARED_DIR, "rooms", "maps", file)));
}

/** Loads and validates every room definition in shared/rooms/. */
export function loadRoomDefs(): Map<string, RoomDef> {
  const dir = resolve(SHARED_DIR, "rooms");
  const rooms = new Map<string, RoomDef>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const def = RoomDefSchema.parse(readJsonFile(resolve(dir, file)));
    if (rooms.has(def.id)) throw new Error(`duplicate room id ${def.id} in ${file}`);
    rooms.set(def.id, def);
  }
  return rooms;
}

export function loadRoomDef(roomId: string): RoomDef {
  const def = loadRoomDefs().get(roomId);
  if (!def) throw new Error(`unknown room id: ${roomId}`);
  return def;
}
