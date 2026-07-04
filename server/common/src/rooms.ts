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

export const SpawnTableSchema = z.object({
  id: z.string(),
  region: z.object({ kind: z.literal("circle"), x: z.number(), z: z.number(), r: z.number() }),
  mobs: z.array(z.object({ mob: z.string(), weight: z.number().positive() })).min(1),
  maxAlive: z.number().int().positive(),
  packSize: z.tuple([z.number().int(), z.number().int()]),
  respawnSec: z.number(),
});
export type SpawnTable = z.infer<typeof SpawnTableSchema>;

export const NpcDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  sprite: z.string(),
  x: z.number(),
  z: z.number(),
  yaw: z.number().default(0),
  wanderRadius: z.number().default(0), // 0 = stands still
  dialog: z.array(z.string()).min(1),
  shop: z
    .object({
      items: z.array(z.string()).min(1), // item ids for sale at registry value
      buys: z.boolean(), // will buy any player item at a fraction of value
    })
    .optional(),
});
export type NpcDef = z.infer<typeof NpcDefSchema>;

/** A flagged sub-area of a room (PvP zones; more flags later). */
export const RegionSchema = z.object({
  kind: z.literal("circle"),
  x: z.number(),
  z: z.number(),
  r: z.number(),
  pvp: z.boolean().default(false),
});
export type RegionDef = z.infer<typeof RegionSchema>;

/** Ephemeral-room lifecycle: live for lifetimeSec, warn, evict, close; the
 *  master reopens it fresh after downtimeSec. */
export const LifecycleSchema = z.object({
  lifetimeSec: z.number().positive(),
  downtimeSec: z.number().nonnegative(),
  warnAtSecLeft: z.array(z.number().positive()),
});
export type LifecycleDef = z.infer<typeof LifecycleSchema>;

export const RoomDefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["hub", "wilderness", "dungeon", "building"]),
  biome: z.string(),
  /** Ambient wind strength for client foliage sway (0 = still, e.g. dungeons).
   *  Purely visual; sent to the client in the `world` message. ~1 = gentle. */
  wind: z.number().min(0).default(0),
  persistence: z.enum(["stateful", "ephemeral"]),
  /** pin the visual clock (dungeon mood); omit for the live day/night cycle */
  fixedTime: z.number().min(0).max(1).optional(),
  lifecycle: LifecycleSchema.optional(),
  regions: z.array(RegionSchema).default([]),
  size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  spawn: z.object({ x: z.number(), z: z.number(), yaw: z.number() }),
  /** Voxel terrain parameters — all vertical units are BLOCK Y levels.
   *  base = mean surface height, amplitude = noise relief in blocks,
   *  waterLevel = water fills terrain below this level (omit for none),
   *  plateauRadius = flatten radius around spawn,
   *  treeDensity = per-column tree chance multiplier (biome default 1). */
  terrain: z.object({
    kind: z.literal("blocks"),
    seed: z.number(),
    base: z.number().int(),
    amplitude: z.number(),
    frequency: z.number(),
    plateauRadius: z.number().optional(),
    waterLevel: z.number().int().optional(),
    treeDensity: z.number().optional(),
  }),
  flags: z.object({
    safeZone: z.boolean(),
    buildingEnabled: z.boolean(),
    pvp: z.boolean(),
  }),
  portals: z.array(PortalDefSchema),
  spawnTables: z.array(SpawnTableSchema),
  npcs: z.array(NpcDefSchema),
});

export type RoomDef = z.infer<typeof RoomDefSchema>;

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
