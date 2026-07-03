/**
 * The ONLY place server code encodes/decodes wire messages. Mirrors
 * shared/protocol.json (the canonical catalog) and client net/Protocol.java.
 * JSON for MVP; a binary encoding swaps in behind encode()/decode*() later.
 */
import { z } from "zod";

// ---------- shared value types ----------

export const CharacterSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number().int(),
  xp: z.number(),
  gold: z.number(),
  inventory: z.array(z.unknown()),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  yaw: z.number(),
  roles: z.array(z.string()),
});
export type CharacterSnapshot = z.infer<typeof CharacterSnapshotSchema>;

export const EntityFullSchema = z.object({
  id: z.number().int(),
  kind: z.string(),
  name: z.string().optional(),
  sprite: z.string().optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  yaw: z.number(),
  anim: z.string(),
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
});
export type EntityDelta = z.infer<typeof EntityDeltaSchema>;

// ---------- control channel (shard host <-> master) ----------

/** Persisted per-room dynamic state (grows with drops/buildings in later phases). */
export const RoomStateSchema = z.object({
  timeOfDay: z.number(),
  savedAt: z.number(),
});
export type RoomState = z.infer<typeof RoomStateSchema>;

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
      z.object({ roomId: z.string(), port: z.number().int(), players: z.number().int(), status: z.string() })
    ),
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
    patch: z.object({ id: z.string() }).passthrough(), // live character state to persist first
  }),
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
    anim: z.string(),
  }),
  z.object({ t: z.literal("usePortal"), portalId: z.string() }),
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

export type ServerToClient =
  | { t: "welcome"; roomId: string; selfId: number; name: string; spawn: { x: number; y: number; z: number; yaw: number }; timeOfDay: number; ents: EntityFull[] }
  | { t: "terrain"; w: number; h: number; heightsB64: string; typesB64: string; waterLevel: number | null }
  | { t: "props"; props: PropWire[]; walls: WallWire[] }
  | { t: "portals"; portals: PortalWire[] }
  | { t: "transferFailed"; reason: string }
  | { t: "reject"; reason: string }
  | { t: "snap"; tick: number; ents: EntityDelta[]; enter: EntityFull[]; leave: number[] }
  | { t: "correct"; seq: number; x: number; y: number; z: number }
  | { t: "pong"; n: number; timeOfDay: number }
  | { t: "transfer"; wsUrl: string; roomId: string; ticket: string }
  | { t: "evict"; reason: string };

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
