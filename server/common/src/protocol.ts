/**
 * The ONLY place server code encodes/decodes wire messages. Mirrors
 * shared/protocol.json (the canonical catalog) and client net/Protocol.java.
 * JSON for MVP; a binary encoding swaps in behind encode()/decode*() later.
 */
import { z } from "zod";

// ---------- shared value types ----------

/** One inventory slot: per-instance item data. Weapons carry stat rolls
 *  (multipliers around 1, e.g. {dmg:1.04, spd:0.98}) and durability minted
 *  at creation (see mintItem in items.ts). */
export const ItemStackSchema = z.object({
  item: z.string(),
  qty: z.number().int().positive(),
  rarity: z.string(),
  /** per-instance stat rolls: stat id → multiplier (absent on non-weapons) */
  stats: z.record(z.string(), z.number()).optional(),
  /** durability remaining (uses); item breaks at 0 */
  dur: z.number().int().optional(),
  /** rolled durability ceiling for this instance */
  maxDur: z.number().int().optional(),
});
export type ItemStack = z.infer<typeof ItemStackSchema>;

/** What a dropped loot bag shows the world: its representative contents
 *  (rarest first, capped at 3) so clients can render the actual items. */
export const LootViewSchema = z.array(z.object({ item: z.string(), rarity: z.string() }));
export type LootView = z.infer<typeof LootViewSchema>;

export const CharacterSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number().int(),
  xp: z.number(),
  gold: z.number(),
  inventory: z.array(ItemStackSchema.nullable()),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  yaw: z.number(),
  roles: z.array(z.string()),
});
export type CharacterSnapshot = z.infer<typeof CharacterSnapshotSchema>;

export const EntityFullSchema = z.object({
  id: z.number().int(),
  kind: z.string(), // player | mob | npc | loot
  name: z.string().optional(),
  sprite: z.string().optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  yaw: z.number(),
  anim: z.string(),
  // combat surface (players + mobs)
  hp: z.number().optional(),
  maxHp: z.number().optional(),
  level: z.number().int().optional(),
  /** action FSM state (idle/move/windup/active/recover/cast/stagger/dead) */
  act: z.string().optional(),
  /** ms remaining in act at send time — clients run the telegraph timer */
  actMs: z.number().optional(),
  /** loot bags only: visible contents ([] = gold-only bag → sack sprite) */
  loot: LootViewSchema.optional(),
});
export type EntityFull = z.infer<typeof EntityFullSchema>;

/** id + any changed subset of EntityFull's mutable fields. */
export const EntityDeltaSchema = z.object({
  id: z.number().int(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
  yaw: z.number().optional(),
  anim: z.string().optional(),
  hp: z.number().optional(),
  act: z.string().optional(),
  actMs: z.number().optional(),
  /** loot bags: contents changed (partial pickup) */
  loot: LootViewSchema.optional(),
});
export type EntityDelta = z.infer<typeof EntityDeltaSchema>;

// ---------- control channel (shard host <-> master) ----------

/** A dropped loot bag persisted with the room (death drops survive restarts). */
export const DropStateSchema = z.object({
  items: z.array(ItemStackSchema),
  gold: z.number().int(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  /** character id whose lock applies, or null for free-for-all */
  owner: z.string().nullable(),
  unlockAt: z.number(), // ms epoch when the owner lock lifts
  expireAt: z.number().nullable(), // ms epoch when the bag vanishes (null = never)
});
export type DropState = z.infer<typeof DropStateSchema>;

/** A player block edit (place or break) — the voxel persistence overlay. */
export const BlockEditWireSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
  id: z.number().int(),
  owner: z.string().nullable(),
});
export type BlockEditWire = z.infer<typeof BlockEditWireSchema>;

/** Persisted per-room dynamic state. */
export const RoomStateSchema = z.object({
  timeOfDay: z.number(),
  savedAt: z.number(),
  drops: z.array(DropStateSchema).default([]),
  /** per-spawner pending respawn timestamps (ms epoch) */
  spawners: z.record(z.string(), z.array(z.number())).default({}),
  /** sparse voxel edits applied over deterministic generation */
  blocks: z.array(BlockEditWireSchema).default([]),
  /** prefab loot caches: "x,y,z" cache key → lastLootedAt ms epoch, so a
   *  restart doesn't refill freshly-looted caches instantly */
  caches: z.record(z.string(), z.number()).default({}),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

/** Live per-room telemetry piggybacked on the shard heartbeat → admin dashboard.
 *  Sim-side counts come from RoomSim.adminInfo(); process-side numbers
 *  (uptime/tick timings/memory/expiry) are stamped by the RoomHost. */
export const RoomAdminInfoSchema = z.object({
  mobs: z.number().int(),
  npcs: z.number().int(),
  drops: z.number().int(),
  projectiles: z.number().int(),
  /** player block edits in the persistence overlay */
  blockEdits: z.number().int(),
  timeOfDay: z.number(),
  uptimeSec: z.number(),
  /** avg/max sim tick duration over the last stats window */
  tickAvgMs: z.number(),
  tickMaxMs: z.number(),
  memMB: z.number(),
  /** ephemeral rooms: ms epoch of the scheduled collapse (null = no lifecycle) */
  expiresAt: z.number().nullable(),
  players: z.array(
    z.object({
      charId: z.string(),
      name: z.string(),
      level: z.number().int(),
      hp: z.number(),
      maxHp: z.number(),
      gold: z.number(),
      x: z.number(),
      y: z.number(),
      z: z.number(),
    })
  ),
});
export type RoomAdminInfo = z.infer<typeof RoomAdminInfoSchema>;

export const ShardToMasterSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("register"),
    shardId: z.string(),
    gameHost: z.string(),
    capacity: z.number().int(),
    secret: z.string(),
  }),
  z.object({
    t: z.literal("heartbeat"),
    rooms: z.array(
      z.object({
        roomId: z.string(),
        port: z.number().int(),
        players: z.number().int(),
        status: z.string(),
        info: RoomAdminInfoSchema.optional(),
      })
    ),
    /** shard-host process telemetry (admin dashboard) */
    shard: z.object({ pid: z.number().int(), memMB: z.number(), uptimeSec: z.number() }).optional(),
  }),
  z.object({ t: z.literal("roomOpened"), roomId: z.string(), port: z.number().int() }),
  z.object({ t: z.literal("roomClosed"), roomId: z.string(), reason: z.string() }),
  z.object({
    t: z.literal("report"),
    roomId: z.string(),
    characters: z.array(z.object({ id: z.string() }).passthrough()),
    roomState: RoomStateSchema.optional(),
  }),
  z.object({
    t: z.literal("requestTransfer"),
    roomId: z.string(), // source room (routing key for the reply)
    characterId: z.string(),
    targetRoomId: z.string(),
    /** source portal id when the transfer came from a portal use — the master
     *  lands the player at the paired portal in the target room. Unset
     *  (eviction/respawn/H-key/fallback) = target room's default spawn. */
    viaPortalId: z.string().optional(),
    patch: z.object({ id: z.string() }).passthrough(), // live character state to persist first
  }),
  z.object({ t: z.literal("globalChat"), from: z.string(), text: z.string() }),
]);
export type ShardToMaster = z.infer<typeof ShardToMasterSchema>;

export const MasterToShardSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("registered"), ok: z.boolean() }),
  z.object({ t: z.literal("openRoom"), roomId: z.string(), snapshot: RoomStateSchema.nullable() }),
  z.object({ t: z.literal("closeRoom"), roomId: z.string(), reason: z.string() }),
  z.object({
    t: z.literal("ticket"),
    roomId: z.string(),
    ticket: z.string(),
    expiresAt: z.number(),
    character: CharacterSnapshotSchema,
  }),
  z.object({
    t: z.literal("transferGrant"),
    roomId: z.string(), // source room the request came from
    characterId: z.string(),
    targetRoomId: z.string(),
    wsUrl: z.string(),
    ticket: z.string(),
  }),
  z.object({
    t: z.literal("transferDeny"),
    roomId: z.string(),
    characterId: z.string(),
    reason: z.string(),
  }),
  z.object({ t: z.literal("globalChat"), from: z.string(), text: z.string() }),
  /** live room availability — RoomHosts surface it as portal open/sealed */
  z.object({ t: z.literal("roomStatus"), roomId: z.string(), open: z.boolean() }),
  /** admin dashboard: evict one player from a room */
  z.object({ t: z.literal("kick"), roomId: z.string(), characterId: z.string(), reason: z.string() }),
]);
export type MasterToShard = z.infer<typeof MasterToShardSchema>;

// ---------- gameplay channel (client <-> RoomHost) ----------

export const ClientToServerSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), v: z.number().int(), ticket: z.string() }),
  z.object({
    t: z.literal("move"),
    seq: z.number().int(),
    x: z.number(),
    y: z.number(),
    z: z.number(),
    yaw: z.number(),
    /** camera pitch — kept fresh so projectiles release where you AIM NOW,
     *  not where you clicked (optional: bots don't send it) */
    pitch: z.number().optional(),
    anim: z.string(),
  }),
  z.object({ t: z.literal("usePortal"), portalId: z.string() }),
  /** Use the held item's ability, aimed by camera yaw/pitch. */
  z.object({ t: z.literal("attack"), yaw: z.number(), pitch: z.number() }),
  /** Select a hotbar slot (0..7) as the held item. */
  z.object({ t: z.literal("equip"), slot: z.number().int() }),
  z.object({ t: z.literal("invMove"), from: z.number().int(), to: z.number().int() }),
  z.object({ t: z.literal("consume"), slot: z.number().int() }),
  z.object({ t: z.literal("dropItem"), slot: z.number().int(), qty: z.number().int().positive() }),
  z.object({ t: z.literal("pickup"), id: z.number().int() }), // loot entity id
  z.object({ t: z.literal("talk"), id: z.number().int() }), // npc entity id
  z.object({ t: z.literal("buy"), npc: z.number().int(), item: z.string(), qty: z.number().int().positive() }),
  z.object({ t: z.literal("sell"), npc: z.number().int(), slot: z.number().int(), qty: z.number().int().positive() }),
  z.object({ t: z.literal("chat"), text: z.string().max(300) }),
  z.object({ t: z.literal("respawn") }),
  /** H key: hub-bound transfer from anywhere (no-op when dead or in the hub) */
  z.object({ t: z.literal("returnToHub") }),
  /** place the held block item into a world cell (building rooms) */
  z.object({
    t: z.literal("blockPlace"),
    slot: z.number().int(),
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
  }),
  /** break a block (building rooms; player blocks refund their item) */
  z.object({
    t: z.literal("blockBreak"),
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
  }),
  z.object({ t: z.literal("ping"), n: z.number() }),
  z.object({ t: z.literal("leave") }),
]);
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
export type CombatEvent =
  | { kind: "dmg"; src: number; tgt: number; amount: number; crit: boolean }
  | { kind: "heal"; tgt: number; amount: number }
  | { kind: "death"; id: number; by: number | null }
  | { kind: "stagger"; id: number }
  | { kind: "xp"; amount: number } // self only
  | { kind: "levelup"; id: number; level: number };

export interface ShopWire {
  items: Array<{ item: string; price: number }>;
  buys: boolean;
}

export type ServerToClient =
  | { t: "welcome"; roomId: string; selfId: number; name: string; sprite: string; spawn: { x: number; y: number; z: number; yaw: number }; timeOfDay: number; ents: EntityFull[]; safeZone: boolean; regions: RegionWire[]; buildingEnabled: boolean }
  /** voxel world header: dimensions + how many chunk payloads follow */
  | { t: "world"; w: number; h: number; height: number; waterLevel: number | null; chunks: number; wind: number }
  /** deflated 16×16×height block chunks (base64 raw-deflate), batched */
  | { t: "chunks"; batch: Array<{ cx: number; cz: number; data: string }> }
  /** a single live block change (player build/break, admin clears) */
  | { t: "blockSet"; x: number; y: number; z: number; id: number }
  | { t: "portals"; portals: PortalWire[] }
  | { t: "transferFailed"; reason: string }
  | { t: "reject"; reason: string }
  | { t: "snap"; tick: number; ents: EntityDelta[]; enter: EntityFull[]; leave: number[] }
  | { t: "correct"; seq: number; x: number; y: number; z: number }
  | { t: "pong"; n: number; timeOfDay: number }
  | { t: "transfer"; wsUrl: string; roomId: string; ticket: string }
  | { t: "evict"; reason: string }
  // ---- phase 4: combat / inventory / economy / chat ----
  | { t: "stats"; hp: number; maxHp: number; mana: number; maxMana: number; xp: number; xpNext: number; level: number; gold: number }
  | { t: "inv"; slots: Array<ItemStack | null>; held: number }
  | { t: "evt"; e: CombatEvent }
  | { t: "proj"; id: number; fx: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; ttlMs: number }
  | { t: "projHit"; id: number; x: number; y: number; z: number }
  | { t: "debuff"; id: number; slowPct: number; durMs: number }
  | { t: "died"; x: number; y: number; z: number } // self death → death screen
  | { t: "chat"; channel: "room" | "global" | "system"; from: string; text: string }
  | { t: "dialog"; id: number; name: string; lines: string[]; shop: ShopWire | null }
  | { t: "portalState"; target: string; open: boolean };

// ---------- encode / decode ----------

export function encode(msg: object): string {
  return JSON.stringify(msg);
}

function parseRaw(raw: unknown): unknown {
  const text = typeof raw === "string" ? raw : (raw as Buffer).toString("utf8");
  return JSON.parse(text);
}

/** Decode + validate a shard→master control message. Throws on bad input. */
export function decodeShardToMaster(raw: unknown): ShardToMaster {
  return ShardToMasterSchema.parse(parseRaw(raw));
}

/** Decode + validate a master→shard control message. Throws on bad input. */
export function decodeMasterToShard(raw: unknown): MasterToShard {
  return MasterToShardSchema.parse(parseRaw(raw));
}

/** Decode + validate a client→server gameplay message. Throws on bad input. */
export function decodeClientToServer(raw: unknown): ClientToServer {
  return ClientToServerSchema.parse(parseRaw(raw));
}
