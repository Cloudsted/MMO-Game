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
  /** authored arrival point for players coming IN through this portal
   *  (omit to auto-offset from the portal toward the room spawn) */
  exitX: z.number().optional(),
  exitZ: z.number().optional(),
  /** explicit pairing: the portal id in `target` to arrive at (for rooms
   *  with multiple portals back to the same source room) */
  exitPortalId: z.string().optional(),
});
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
export function computePortalArrival(
  targetDef: RoomDef,
  sourceRoomId: string,
  via: PortalDef
): PortalArrival | null {
  const q = via.exitPortalId
    ? targetDef.portals.find((p) => p.id === via.exitPortalId)
    : targetDef.portals.find((p) => p.target === sourceRoomId);
  if (!q) return null;
  if (q.exitX !== undefined && q.exitZ !== undefined) {
    let dx = q.exitX - q.x;
    let dz = q.exitZ - q.z;
    if (Math.hypot(dx, dz) < 1e-6) [dx, dz] = [0, 1]; // degenerate: face +Z
    return { x: q.exitX, z: q.exitZ, yaw: Math.atan2(dx, dz) };
  }
  let dx = targetDef.spawn.x - q.x;
  let dz = targetDef.spawn.z - q.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) [dx, dz] = [0, 1];
  else [dx, dz] = [dx / len, dz / len];
  const dist = q.r + 1.0;
  return { x: q.x + dx * dist, z: q.z + dz * dist, yaw: Math.atan2(dx, dz) };
}

export const SpawnTableSchema = z.object({
  id: z.string(),
  region: z.object({ kind: z.literal("circle"), x: z.number(), z: z.number(), r: z.number() }),
  /** `level` reuses a mob def at a higher level: stats scale by
   *  constants.mobs.scaling and level-gated ranks unlock extra abilities
   *  (see registry.resolveMob). Omit to spawn at the def's own level. */
  mobs: z
    .array(z.object({ mob: z.string(), weight: z.number().positive(), level: z.number().int().optional() }))
    .min(1),
  maxAlive: z.number().int().positive(),
  packSize: z.tuple([z.number().int(), z.number().int()]),
  respawnSec: z.number(),
});
export type SpawnTable = z.infer<typeof SpawnTableSchema>;

/** Deterministic prefab scatter config (worldgen prefab system). Entries
 *  place in array order — earlier entries claim ground first. near/nearPrefab/
 *  nearPortals are SOFT constraints: if the constrained candidate pass
 *  under-fills, remaining candidates fall back to unconstrained placement. */
export const PrefabScatterSchema = z.object({
  prefab: z.string(),
  count: z.number().int().positive(),
  minSpacing: z.number().nonnegative().default(0),
  /** scales the distance-based ruin gradient (higher = more ruined) */
  ruinBias: z.number().optional(),
  /** prefer sites near the room's portals */
  nearPortals: z.boolean().optional(),
  /** prefer sites within `within` of an already-placed prefab of `id` */
  nearPrefab: z.object({ id: z.string(), within: z.number() }).optional(),
  /** prefer sites within `within` of a fixed point (authored anchor) */
  near: z.object({ x: z.number(), z: z.number(), within: z.number() }).optional(),
  /** re-center this room spawn table onto the prefab's spawnRegion hook */
  bindSpawnTable: z.string().optional(),
});
export type PrefabScatterDef = z.infer<typeof PrefabScatterSchema>;

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
  /** enchanter service: fixed tier-1 enchant menu (modifier ids that carry
   *  an `enchant` block in shared/modifiers.json). RoomSim warns on
   *  dangling/offer-less ids at boot. */
  service: z
    .object({
      kind: z.literal("enchant"),
      offers: z.array(z.string()).min(1),
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

/** Entity-linked room events: a named boss mob fires room-level actions.
 *  bossDeath fires on every death of that mob id; bossHpBelowPct fires once
 *  per boss life (re-arms when the boss respawns). */
export const RoomEventTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bossDeath"), mob: z.string() }),
  z.object({ kind: z.literal("bossHpBelowPct"), mob: z.string(), pct: z.number().gt(0).lt(1) }),
]);
export type RoomEventTrigger = z.infer<typeof RoomEventTriggerSchema>;

export const RoomEventActionSchema = z.discriminatedUnion("kind", [
  /** unseal this room's portal; it RESEALS when the trigger mob respawns
   *  (kill the guardian → the way deeper opens until the guardian returns) */
  z.object({ kind: z.literal("openPortal"), portalId: z.string() }),
  /** the room summons a wave around the trigger mob (mid-fight adds) */
  z.object({
    kind: z.literal("spawnMobs"),
    mob: z.string(),
    count: z.number().int().positive(),
    radius: z.number().positive().default(6),
  }),
  /** lifecycle rooms: re-arm the collapse timer so the room closes in `sec`
   *  seconds — extends a shorter remainder, cuts a longer one (boss kill →
   *  grab the loot and get out) */
  z.object({ kind: z.literal("setRoomTimer"), sec: z.number().positive() }),
  z.object({ kind: z.literal("announce"), text: z.string() }),
]);
export type RoomEventAction = z.infer<typeof RoomEventActionSchema>;

export const RoomEventSchema = z.object({
  id: z.string(),
  on: RoomEventTriggerSchema,
  actions: z.array(RoomEventActionSchema).min(1),
});
export type RoomEventDef = z.infer<typeof RoomEventSchema>;

/** Ephemeral-room lifecycle: live for lifetimeSec, warn, evict, close; the
 *  master reopens it fresh after downtimeSec. lifetimeSec OMITTED = no
 *  natural expiry — the room stays open until an event (or admin /expire)
 *  arms the collapse timer (the Sundered City stands until its King falls). */
export const LifecycleSchema = z.object({
  lifetimeSec: z.number().positive().optional(),
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
  /** Night minimum-light multiplier on the client's tuned night skylight
   *  floor (1 = the original endpoint; default raised — owner: nights read
   *  too dark). Purely visual; ships in the `world` message. */
  nightLight: z.number().min(0).max(4).default(1.35),
  persistence: z.enum(["stateful", "ephemeral"]),
  /** pin the visual clock (dungeon mood); omit for the live day/night cycle */
  fixedTime: z.number().min(0).max(1).optional(),
  lifecycle: LifecycleSchema.optional(),
  regions: z.array(RegionSchema).default([]),
  size: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  spawn: z.object({ x: z.number(), z: z.number(), yaw: z.number() }),
  /** Voxel terrain parameters — all vertical units are BLOCK Y levels.
   *  base = mean surface height, amplitude = noise relief in blocks,
   *  waterLevel = liquid fills terrain below this level (omit for none),
   *  liquid = which block fills up to waterLevel (murk_water for swamps,
   *  lava for volcanic rooms; existing rooms keep the default water),
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
    liquid: z.enum(["water", "murk_water", "lava"]).default("water"),
    treeDensity: z.number().optional(),
  }),
  flags: z.object({
    safeZone: z.boolean(),
    buildingEnabled: z.boolean(),
    pvp: z.boolean(),
  }),
  portals: z.array(PortalDefSchema),
  spawnTables: z.array(SpawnTableSchema),
  /** deterministic prefab scatter (ruins, camps, shrines...) — optional */
  prefabs: z.array(PrefabScatterSchema).default([]),
  /** entity-linked events (boss-gated portals, mid-fight waves, collapse
   *  timers) — optional */
  events: z.array(RoomEventSchema).default([]),
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
