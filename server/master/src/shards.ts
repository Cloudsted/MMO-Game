import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import {
  computePortalArrival,
  decodeShardToMaster,
  encode,
  gameConstants,
  loadRoomDefs,
  makeLogger,
  type CharacterSnapshot,
  type MasterToShard,
  type PortalArrival,
  type RoomAdminInfo,
} from "@fantasy-mmo/common";
import type { Collections, CharacterDoc } from "./db.js";
import { ObjectId } from "mongodb";

const log = makeLogger("master/shards");

const HEARTBEAT_TIMEOUT_MS = 15_000;
const SWEEP_INTERVAL_MS = 5_000;
const HISTORY_SAMPLE_MS = 10_000;
const HISTORY_CAP = 1080; // 3 hours at 10 s/sample

interface ShardConn {
  shardId: string;
  gameHost: string;
  capacity: number;
  ws: WebSocket;
  lastSeen: number;
  registeredAt: number;
  /** shard-host process telemetry from the latest heartbeat */
  info: { pid: number; memMB: number; uptimeSec: number } | null;
  /** roomId → port, from the latest heartbeat/roomOpened */
  rooms: Map<string, { port: number; players: number; status: string; info?: RoomAdminInfo }>;
}

/** One point on the dashboard's population/memory timeline. */
export interface HistorySample {
  t: number;
  players: number;
  rooms: Record<string, number>;
  memMB: number;
}

/**
 * Owns the shard control channel, the room registry (each defined room has
 * exactly one live instance globally), and transfer-ticket minting.
 */
export class ShardManager {
  private shards = new Map<string, ShardConn>();
  private roomDefs = loadRoomDefs();
  /** roomId → shardId for rooms that are open or opening */
  private roomAssignment = new Map<string, { shardId: string; status: "opening" | "open" }>();
  /** expired ephemeral rooms sit out their downtime before reopening fresh */
  private reopenNotBefore = new Map<string, number>();
  /** population/memory timeline for the admin dashboard (in-memory ring) */
  private history: HistorySample[] = [];
  /** latest top-down map render per room (pushed by RoomHosts) */
  private roomMaps = new Map<string, { w: number; h: number; data: string; at: number }>();

  constructor(
    private cols: Collections,
    private secret: string
  ) {}

  attach(httpServer: Server): void {
    const wss = new WebSocketServer({ server: httpServer, path: "/control" });
    wss.on("connection", (ws) => this.onConnection(ws));
    setInterval(() => this.sweep(), SWEEP_INTERVAL_MS).unref();
    setInterval(() => this.sampleHistory(), HISTORY_SAMPLE_MS).unref();
  }

  /** Sample the live population for the dashboard timeline. */
  private sampleHistory(): void {
    const rooms: Record<string, number> = {};
    let players = 0;
    for (const shard of this.shards.values()) {
      for (const [roomId, r] of shard.rooms) {
        rooms[roomId] = (rooms[roomId] ?? 0) + r.players;
        players += r.players;
      }
    }
    this.history.push({
      t: Date.now(),
      players,
      rooms,
      memMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    });
    if (this.history.length > HISTORY_CAP) this.history.splice(0, this.history.length - HISTORY_CAP);
  }

  historySamples(): HistorySample[] {
    return this.history;
  }

  private onConnection(ws: WebSocket): void {
    let shard: ShardConn | null = null;
    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = decodeShardToMaster(raw);
      } catch (e) {
        log.warn("bad control message, closing", e);
        ws.close();
        return;
      }
      if (!shard) {
        if (msg.t !== "register" || msg.secret !== this.secret) {
          log.warn("control connection failed to register, closing");
          ws.close();
          return;
        }
        shard = this.registerShard(ws, msg.shardId, msg.gameHost, msg.capacity);
        return;
      }
      shard.lastSeen = Date.now();
      try {
        await this.handleMessage(shard, msg);
      } catch (e) {
        log.error(`handling ${msg.t} from ${shard.shardId}`, e);
      }
    });
    ws.on("close", () => {
      if (shard) {
        log.warn(`shard ${shard.shardId} control channel closed`);
        this.dropShard(shard.shardId);
      }
    });
  }

  private registerShard(ws: WebSocket, shardId: string, gameHost: string, capacity: number): ShardConn {
    const existing = this.shards.get(shardId);
    if (existing) {
      log.warn(`shard ${shardId} re-registered; dropping old connection`);
      existing.ws.close();
      this.dropShard(shardId);
    }
    const shard: ShardConn = {
      shardId,
      gameHost,
      capacity,
      ws,
      lastSeen: Date.now(),
      registeredAt: Date.now(),
      info: null,
      rooms: new Map(),
    };
    this.shards.set(shardId, shard);
    this.send(shard, { t: "registered", ok: true });
    log.info(`shard ${shardId} registered (host ${gameHost}, capacity ${capacity})`);
    // give the newcomer the current availability picture
    for (const def of this.roomDefs.values()) {
      this.send(shard, { t: "roomStatus", roomId: def.id, open: this.roomAssignment.get(def.id)?.status === "open" });
    }
    this.ensureRooms();
    return shard;
  }

  private async handleMessage(shard: ShardConn, msg: Awaited<ReturnType<typeof decodeShardToMaster>>): Promise<void> {
    switch (msg.t) {
      case "register":
        break; // already handled
      case "heartbeat":
        shard.rooms = new Map(
          msg.rooms.map((r) => [r.roomId, { port: r.port, players: r.players, status: r.status, info: r.info }])
        );
        if (msg.shard) shard.info = msg.shard;
        break;
      case "roomOpened": {
        shard.rooms.set(msg.roomId, { port: msg.port, players: 0, status: "open" });
        this.roomAssignment.set(msg.roomId, { shardId: shard.shardId, status: "open" });
        await this.cols.roomRegistry.updateOne(
          { roomId: msg.roomId },
          { $set: { shardId: shard.shardId, status: "open", gameHost: shard.gameHost, port: msg.port, updatedAt: new Date() } },
          { upsert: true }
        );
        log.info(`room ${msg.roomId} open on ${shard.shardId} port ${msg.port}`);
        this.broadcastRoomStatus(msg.roomId, true);
        break;
      }
      case "roomClosed": {
        shard.rooms.delete(msg.roomId);
        this.roomAssignment.delete(msg.roomId);
        await this.cols.roomRegistry.updateOne(
          { roomId: msg.roomId },
          { $set: { shardId: null, status: "down", gameHost: null, port: null, updatedAt: new Date() } }
        );
        log.warn(`room ${msg.roomId} closed on ${shard.shardId}: ${msg.reason}`);
        this.broadcastRoomStatus(msg.roomId, false);
        // lifecycle expiry: sit out the downtime, then reopen fresh
        const def = this.roomDefs.get(msg.roomId);
        if (msg.reason === "expired" && def?.lifecycle) {
          const overrideSec = Number(process.env.MMO_DOWNTIME_OVERRIDE_SEC ?? 0);
          const downtimeSec = overrideSec > 0 ? overrideSec : def.lifecycle.downtimeSec;
          this.reopenNotBefore.set(msg.roomId, Date.now() + downtimeSec * 1000);
          log.info(`room ${msg.roomId} enters downtime for ${downtimeSec}s`);
        }
        this.ensureRooms();
        break;
      }
      case "report":
        await this.applyReport(msg.roomId, msg.characters);
        // ephemeral rooms restart fresh: never persist their state
        if (msg.roomState && this.roomDefs.get(msg.roomId)?.persistence !== "ephemeral") {
          await this.cols.roomStates.updateOne(
            { roomId: msg.roomId },
            { $set: { state: msg.roomState, updatedAt: new Date() } },
            { upsert: true }
          );
        }
        break;
      case "requestTransfer":
        await this.handleTransferRequest(
          shard,
          msg.roomId,
          msg.characterId,
          msg.targetRoomId,
          msg.patch,
          msg.viaPortalId,
          msg.arrival
        );
        break;
      case "globalChat":
        // relay to every shard (including the sender — single delivery path)
        for (const s of this.shards.values()) {
          this.send(s, { t: "globalChat", from: msg.from, text: msg.text });
        }
        break;
      case "mapData":
        this.roomMaps.set(msg.roomId, { w: msg.w, h: msg.h, data: msg.data, at: Date.now() });
        break;
    }
  }

  /**
   * Portal transfer: persist the live character state first (with the target
   * room + position reset), then mint a ticket and route the grant back to
   * the requesting shard → RoomHost → client. Position: portal uses carry
   * viaPortalId and land at the PAIRED portal in the target room (y=0 =
   * ground-snap sentinel; addPlayer snaps to the voxel floor); everything
   * else (respawn, H key, no pair found) nulls x/y/z → target default spawn.
   */
  private async handleTransferRequest(
    shard: ShardConn,
    sourceRoomId: string,
    characterId: string,
    targetRoomId: string,
    patch: { id: string } & Record<string, unknown>,
    viaPortalId?: string,
    adminArrival?: { x: number; z: number }
  ): Promise<void> {
    const deny = (reason: string) => {
      this.send(shard, { t: "transferDeny", roomId: sourceRoomId, characterId, reason });
      log.warn(`transfer ${characterId} -> ${targetRoomId} denied: ${reason}`);
    };
    if (!this.roomDefs.has(targetRoomId)) return deny("unknown destination");
    if (!ObjectId.isValid(characterId)) return deny("bad character id");
    // check availability BEFORE persisting the patch — a denied transfer must
    // leave the character exactly where they stand (hub is always fallback)
    if (targetRoomId !== "hub" && this.roomAssignment.get(targetRoomId)?.status !== "open") {
      return deny("that place is sealed right now");
    }

    // persist live stats, but the position belongs to the target room now
    const { id, roomId: _r, x: _x, y: _y, z: _z, ...stats } = patch;
    const allowed: Record<string, unknown> = {};
    for (const key of ["level", "xp", "gold", "inventory", "yaw"]) {
      if (key in stats) allowed[key] = stats[key];
    }
    // portal use: arrive at the paired portal in the target room, facing away
    // from it. y=0 is the ground-snap sentinel (a null y with non-null x
    // fails the ticket snapshot's zod validation). Admin teleports carry an
    // explicit arrival (clamped into the room). No pair → default spawn.
    let arrival: PortalArrival | null = null;
    if (adminArrival) {
      const size = this.roomDefs.get(targetRoomId)!.size;
      arrival = {
        x: Math.min(Math.max(adminArrival.x, 1), size.w - 1),
        z: Math.min(Math.max(adminArrival.z, 1), size.h - 1),
        yaw: 0,
      };
    } else if (viaPortalId) {
      const via = this.roomDefs.get(sourceRoomId)?.portals.find((p) => p.id === viaPortalId);
      if (via) arrival = computePortalArrival(this.roomDefs.get(targetRoomId)!, sourceRoomId, via);
    }
    const pos = arrival
      ? { x: arrival.x, y: 0, z: arrival.z, yaw: arrival.yaw }
      : { x: null, y: null, z: null };
    await this.cols.characters.updateOne(
      { _id: new ObjectId(characterId) },
      { $set: { ...allowed, roomId: targetRoomId, ...pos } }
    );

    const character = await this.cols.characters.findOne({ _id: new ObjectId(characterId) });
    if (!character) return deny("character not found");
    const account = await this.cols.accounts.findOne({ _id: character.accountId });
    const grant = this.mintTicket(character, account?.roles ?? ["player"], targetRoomId);
    if (!grant) return deny("destination room is not available");
    this.send(shard, {
      t: "transferGrant",
      roomId: sourceRoomId,
      characterId,
      targetRoomId: grant.roomId,
      wsUrl: grant.wsUrl,
      ticket: grant.ticket,
    });
    log.info(`transfer granted: ${character.name} ${sourceRoomId} -> ${grant.roomId}`);
  }

  /** Apply batched character state from a shard to MongoDB without re-simulating. */
  private async applyReport(roomId: string, characters: Array<{ id: string } & Record<string, unknown>>): Promise<void> {
    for (const patch of characters) {
      const { id, ...fields } = patch;
      if (!ObjectId.isValid(id)) continue;
      const allowed: Record<string, unknown> = {};
      for (const key of ["level", "xp", "gold", "inventory", "roomId", "x", "y", "z", "yaw"]) {
        if (key in fields) allowed[key] = fields[key];
      }
      if (Object.keys(allowed).length === 0) continue;
      await this.cols.characters.updateOne({ _id: new ObjectId(id) }, { $set: allowed });
    }
    if (characters.length > 0) log.info(`applied report for ${roomId}: ${characters.length} character(s)`);
  }

  /** Ensure every defined room has exactly one live/opening instance
   *  (ephemeral rooms sit out their post-expiry downtime first). */
  private ensureRooms(): void {
    const now = Date.now();
    for (const def of this.roomDefs.values()) {
      if (this.roomAssignment.has(def.id)) continue;
      const notBefore = this.reopenNotBefore.get(def.id);
      if (notBefore !== undefined) {
        if (now < notBefore) continue;
        this.reopenNotBefore.delete(def.id);
      }
      const shard = this.pickShard();
      if (!shard) {
        log.warn(`no shard available to open room ${def.id}`);
        continue;
      }
      this.roomAssignment.set(def.id, { shardId: shard.shardId, status: "opening" });
      void this.openRoomOn(shard, def.id);
    }
  }

  /** Open a room on a shard, passing its last persisted snapshot (if any).
   *  Ephemeral rooms always start fresh. */
  private async openRoomOn(shard: ShardConn, roomId: string): Promise<void> {
    let snapshot = null;
    if (this.roomDefs.get(roomId)?.persistence !== "ephemeral") {
      try {
        const doc = await this.cols.roomStates.findOne({ roomId });
        if (doc) snapshot = doc.state;
      } catch (e) {
        log.error(`loading snapshot for ${roomId}`, e);
      }
    }
    this.send(shard, { t: "openRoom", roomId, snapshot });
    log.info(`opening room ${roomId} on shard ${shard.shardId}${snapshot ? " (from snapshot)" : ""}`);
  }

  /** Tell every shard (→ every RoomHost) a destination went up or down. */
  private broadcastRoomStatus(roomId: string, open: boolean): void {
    for (const s of this.shards.values()) {
      this.send(s, { t: "roomStatus", roomId, open });
    }
  }

  private pickShard(): ShardConn | null {
    let best: ShardConn | null = null;
    for (const s of this.shards.values()) {
      const assigned = [...this.roomAssignment.values()].filter((a) => a.shardId === s.shardId).length;
      if (assigned >= s.capacity) continue;
      const bestAssigned = best
        ? [...this.roomAssignment.values()].filter((a) => a.shardId === best!.shardId).length
        : Infinity;
      if (!best || assigned < bestAssigned) best = s;
    }
    return best;
  }

  /** Drop a dead shard: mark its rooms down and reassign them. */
  private dropShard(shardId: string): void {
    this.shards.delete(shardId);
    for (const [roomId, a] of [...this.roomAssignment]) {
      if (a.shardId === shardId) {
        this.roomAssignment.delete(roomId);
        void this.cols.roomRegistry.updateOne(
          { roomId },
          { $set: { shardId: null, status: "down", gameHost: null, port: null, updatedAt: new Date() } }
        );
      }
    }
    this.ensureRooms();
  }

  private sweep(): void {
    const now = Date.now();
    for (const shard of [...this.shards.values()]) {
      if (now - shard.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        log.warn(`shard ${shard.shardId} missed heartbeats, dropping`);
        shard.ws.close();
        this.dropShard(shard.shardId);
      }
    }
    // reopen ephemeral rooms whose downtime has passed
    if (this.reopenNotBefore.size > 0) this.ensureRooms();
  }

  private send(shard: ShardConn, msg: MasterToShard): void {
    if (shard.ws.readyState === WebSocket.OPEN) shard.ws.send(encode(msg));
  }

  // ---------- tickets ----------

  /**
   * Mint a one-time transfer ticket for a character into roomId. Pushes the
   * ticket (with the full character snapshot) to the owning shard so the
   * RoomHost can validate the client's hello locally. Falls back to the hub
   * when the requested room has no live instance.
   */
  mintTicket(
    character: CharacterDoc,
    roles: string[],
    requestedRoomId: string
  ): { wsUrl: string; roomId: string; ticket: string } | null {
    let roomId = requestedRoomId;
    let assignment = this.roomAssignment.get(roomId);
    if (!assignment || assignment.status !== "open") {
      roomId = "hub";
      assignment = this.roomAssignment.get(roomId);
      if (!assignment || assignment.status !== "open") return null; // hub not up: nothing we can do
    }
    const shard = this.shards.get(assignment.shardId);
    const room = shard?.rooms.get(roomId);
    if (!shard || !room) return null;

    const roomDefs = this.roomDefs;
    const def = roomDefs.get(roomId)!;
    const usePos = character.roomId === roomId && character.x !== null;
    const snapshot: CharacterSnapshot = {
      id: character._id!.toHexString(),
      name: character.name,
      level: character.level,
      xp: character.xp,
      gold: character.gold,
      inventory: character.inventory,
      x: usePos ? character.x! : def.spawn.x,
      y: usePos ? character.y! : 0,
      z: usePos ? character.z! : def.spawn.z,
      yaw: usePos ? character.yaw : def.spawn.yaw,
      roles,
    };
    const ticket = randomBytes(24).toString("hex");
    const expiresAt = Date.now() + gameConstants().net.ticketTtlMs;
    this.send(shard, { t: "ticket", roomId, ticket, expiresAt, character: snapshot });
    return { wsUrl: `ws://${shard.gameHost}:${room.port}`, roomId, ticket };
  }

  /** Admin: close (→ auto-reopen = restart) a room. Stateful rooms resume
   *  from their last snapshot; ephemeral rooms come back fresh. */
  closeRoomAdmin(roomId: string): boolean {
    const assignment = this.roomAssignment.get(roomId);
    if (!assignment) return false;
    const shard = this.shards.get(assignment.shardId);
    if (!shard) return false;
    this.send(shard, { t: "closeRoom", roomId, reason: "admin restart" });
    log.info(`admin requested restart of ${roomId}`);
    return true;
  }

  /** Admin: kick one player out of their room (client auto-recovers via login). */
  kickPlayer(roomId: string, characterId: string, reason: string): boolean {
    const assignment = this.roomAssignment.get(roomId);
    if (!assignment) return false;
    const shard = this.shards.get(assignment.shardId);
    if (!shard) return false;
    this.send(shard, { t: "kick", roomId, characterId, reason });
    log.info(`admin kick requested: character ${characterId} in ${roomId}`);
    return true;
  }

  /** Admin: server-wide announcement, delivered as global chat in every room. */
  broadcast(from: string, text: string): void {
    for (const s of this.shards.values()) {
      this.send(s, { t: "globalChat", from, text });
    }
    log.info(`admin broadcast: ${text}`);
  }

  /** Admin: teleport a player — same-room snap or cross-room transfer. */
  adminMove(roomId: string, characterId: string, targetRoomId: string, x?: number, z?: number): boolean {
    if (!this.roomDefs.has(targetRoomId)) return false;
    const assignment = this.roomAssignment.get(roomId);
    if (!assignment) return false;
    const shard = this.shards.get(assignment.shardId);
    if (!shard) return false;
    this.send(shard, { t: "adminMove", roomId, characterId, targetRoomId, x, z });
    log.info(`admin teleport requested: ${characterId} ${roomId} -> ${targetRoomId}`);
    return true;
  }

  /** Latest top-down map render for a room (null until its RoomHost pushes). */
  roomMap(roomId: string): { w: number; h: number; data: string; at: number } | null {
    return this.roomMaps.get(roomId) ?? null;
  }

  /** Ask a room to (re)send its map — used on cache miss after a master restart. */
  requestMap(roomId: string): boolean {
    const assignment = this.roomAssignment.get(roomId);
    if (!assignment) return false;
    const shard = this.shards.get(assignment.shardId);
    if (!shard) return false;
    this.send(shard, { t: "requestMap", roomId });
    return true;
  }

  /** Live status for the admin/status endpoint. */
  status() {
    return {
      shards: [...this.shards.values()].map((s) => ({
        shardId: s.shardId,
        gameHost: s.gameHost,
        capacity: s.capacity,
        lastSeen: s.lastSeen,
        rooms: [...s.rooms.entries()].map(([roomId, r]) => ({ roomId, port: r.port, players: r.players, status: r.status })),
      })),
      rooms: [...this.roomAssignment.entries()].map(([roomId, a]) => ({ roomId, ...a })),
    };
  }

  /** Flattened online-player list across every shard (admin dashboard). */
  livePlayers() {
    const out: Array<RoomAdminInfo["players"][number] & { roomId: string; shardId: string }> = [];
    for (const s of this.shards.values()) {
      for (const [roomId, r] of s.rooms) {
        for (const p of r.info?.players ?? []) out.push({ ...p, roomId, shardId: s.shardId });
      }
    }
    return out;
  }

  /** Everything the admin dashboard's overview needs in one payload. */
  adminOverview() {
    const now = Date.now();
    return {
      shards: [...this.shards.values()].map((s) => ({
        shardId: s.shardId,
        gameHost: s.gameHost,
        capacity: s.capacity,
        lastSeenMsAgo: now - s.lastSeen,
        connectedForSec: Math.round((now - s.registeredAt) / 1000),
        info: s.info,
        rooms: [...s.rooms.entries()].map(([roomId, r]) => ({ roomId, ...r })),
      })),
      assignments: [...this.roomAssignment.entries()].map(([roomId, a]) => ({ roomId, ...a })),
      reopenAt: [...this.reopenNotBefore.entries()].map(([roomId, at]) => ({ roomId, at })),
      defs: [...this.roomDefs.values()].map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        biome: d.biome,
        size: d.size,
        persistence: d.persistence,
        lifecycle: d.lifecycle ?? null,
        fixedTime: d.fixedTime ?? null,
        wind: d.wind,
        flags: d.flags,
        portals: d.portals.map((p) => ({ id: p.id, label: p.label, target: p.target })),
        spawnTables: d.spawnTables.map((t) => ({
          id: t.id,
          maxAlive: t.maxAlive,
          respawnSec: t.respawnSec,
          mobs: t.mobs.map((m) => m.mob),
        })),
        prefabs: d.prefabs.map((p) => ({ prefab: p.prefab, count: p.count })),
        npcs: d.npcs.map((n) => ({ id: n.id, name: n.name, shop: !!n.shop })),
      })),
    };
  }
}
