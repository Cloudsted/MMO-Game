/**
 * Shard host: registers with the master over the control WS, heartbeats,
 * spawns/kills RoomHost child processes on master command, and forwards
 * batched room reports up to the master. One room per child — a room crash
 * kills only its child; the master reassigns.
 */
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import WebSocket from "ws";
import {
  loadEnv,
  requireEnv,
  makeLogger,
  encode,
  decodeMasterToShard,
  type RoomAdminInfo,
  type ShardToMaster,
} from "@fantasy-mmo/common";
import type { HostToRoom, RoomToHost } from "./ipc.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface RoomProc {
  roomId: string;
  port: number;
  child: ChildProcess;
  ready: boolean;
  players: number;
  /** latest admin telemetry from the RoomHost (forwarded in heartbeats) */
  info: RoomAdminInfo | null;
  /** set when the RoomHost announces a deliberate close (lifecycle expiry) */
  closeReason: string | null;
}

interface Args {
  shardId: string;
  portBase: number;
  capacity: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    shardId: get("--id") ?? process.env.SHARD_ID ?? "shard1",
    portBase: Number(get("--portBase") ?? process.env.SHARD_ROOM_PORT_BASE ?? 4210),
    // default must cover every defined room on a single-shard dev stack
    // (9 rooms since the difficulty-graph batch; headroom for the next few)
    capacity: Number(get("--capacity") ?? process.env.SHARD_CAPACITY ?? 12),
  };
}

class ShardHost {
  private log;
  private ws: WebSocket | null = null;
  private rooms = new Map<string, RoomProc>();
  /** latest availability from the master; closed rooms may carry the ms
   *  epoch they reopen at (forwards recompute the remaining seconds) */
  private roomStatuses = new Map<string, { open: boolean; reopenAtMs?: number }>();
  private nextPortOffset = 0;
  private stopping = false;

  constructor(
    private args: Args,
    private masterUrl: string,
    private secret: string,
    private gameHost: string
  ) {
    this.log = makeLogger(args.shardId);
  }

  start(): void {
    this.connect();
    setInterval(() => this.heartbeat(), 5000).unref();
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());
  }

  private connect(): void {
    if (this.stopping) return;
    this.log.info(`connecting to master at ${this.masterUrl}`);
    const ws = new WebSocket(this.masterUrl);
    this.ws = ws;
    ws.on("open", () => {
      this.send({
        t: "register",
        shardId: this.args.shardId,
        gameHost: this.gameHost,
        capacity: this.args.capacity,
        secret: this.secret,
      });
      // re-announce rooms that are already running (reconnect case)
      for (const room of this.rooms.values()) {
        if (room.ready) this.send({ t: "roomOpened", roomId: room.roomId, port: room.port });
      }
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = decodeMasterToShard(raw);
      } catch (e) {
        this.log.error("bad control message from master", e);
        return;
      }
      this.onMasterMessage(msg);
    });
    ws.on("close", () => {
      this.log.warn("control channel lost; retrying in 3s");
      this.ws = null;
      if (!this.stopping) setTimeout(() => this.connect(), 3000).unref();
    });
    ws.on("error", (e) => this.log.warn(`control ws error: ${(e as Error).message}`));
  }

  private onMasterMessage(msg: ReturnType<typeof decodeMasterToShard>): void {
    switch (msg.t) {
      case "registered":
        this.log.info("registered with master");
        break;
      case "openRoom":
        this.openRoom(msg.roomId, msg.snapshot);
        break;
      case "closeRoom":
        this.closeRoom(msg.roomId, msg.reason);
        break;
      case "ticket": {
        const room = this.rooms.get(msg.roomId);
        if (!room) {
          this.log.warn(`ticket for unknown room ${msg.roomId}`);
          return;
        }
        this.sendToRoom(room, { t: "ticket", ticket: msg.ticket, expiresAt: msg.expiresAt, character: msg.character });
        break;
      }
      case "transferGrant": {
        const room = this.rooms.get(msg.roomId);
        if (room) {
          this.sendToRoom(room, {
            t: "transferGrant",
            characterId: msg.characterId,
            targetRoomId: msg.targetRoomId,
            wsUrl: msg.wsUrl,
            ticket: msg.ticket,
          });
        }
        break;
      }
      case "transferDeny": {
        const room = this.rooms.get(msg.roomId);
        if (room) {
          this.sendToRoom(room, { t: "transferDeny", characterId: msg.characterId, reason: msg.reason });
        }
        break;
      }
      case "globalChat":
        // fan out to every RoomHost on this shard
        for (const room of this.rooms.values()) {
          this.sendToRoom(room, { t: "globalChat", from: msg.from, text: msg.text });
        }
        break;
      case "roomStatus":
        this.roomStatuses.set(msg.roomId, {
          open: msg.open,
          reopenAtMs: msg.reopenInSec !== undefined ? Date.now() + msg.reopenInSec * 1000 : undefined,
        });
        for (const room of this.rooms.values()) {
          this.sendToRoom(room, {
            t: "roomStatus",
            roomId: msg.roomId,
            open: msg.open,
            ...(msg.reopenInSec !== undefined ? { reopenInSec: msg.reopenInSec } : {}),
          });
        }
        break;
      case "kick": {
        const room = this.rooms.get(msg.roomId);
        if (room) this.sendToRoom(room, { t: "kick", characterId: msg.characterId, reason: msg.reason });
        break;
      }
      case "adminMove": {
        const room = this.rooms.get(msg.roomId);
        if (room) {
          this.sendToRoom(room, {
            t: "adminMove",
            characterId: msg.characterId,
            targetRoomId: msg.targetRoomId,
            x: msg.x,
            z: msg.z,
          });
        }
        break;
      }
      case "requestMap": {
        const room = this.rooms.get(msg.roomId);
        if (room) this.sendToRoom(room, { t: "requestMap" });
        break;
      }
    }
  }

  private openRoom(roomId: string, snapshot: import("@fantasy-mmo/common").RoomState | null): void {
    if (this.rooms.has(roomId)) {
      const existing = this.rooms.get(roomId)!;
      if (existing.ready) this.send({ t: "roomOpened", roomId, port: existing.port });
      return;
    }
    const port = this.args.portBase + this.nextPortOffset++;
    this.log.info(`spawning RoomHost for ${roomId} on port ${port}`);
    const child = fork(resolve(HERE, "roomhost.ts"), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    const room: RoomProc = { roomId, port, child, ready: false, players: 0, info: null, closeReason: null };
    this.rooms.set(roomId, room);

    child.on("message", (raw: RoomToHost) => this.onRoomMessage(room, raw));
    child.on("exit", (code) => {
      const reason = room.closeReason ?? `exit code ${code}`;
      this.log.warn(`RoomHost ${roomId} exited (${reason})`);
      this.rooms.delete(roomId);
      this.send({ t: "roomClosed", roomId, reason });
    });
    this.sendToRoom(room, { t: "init", roomId, port, snapshot });
  }

  private closeRoom(roomId: string, reason: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.log.info(`closing room ${roomId}: ${reason}`);
    this.sendToRoom(room, { t: "close", reason });
    setTimeout(() => {
      if (this.rooms.has(roomId)) room.child.kill();
    }, 5000).unref();
  }

  private onRoomMessage(room: RoomProc, msg: RoomToHost): void {
    switch (msg.t) {
      case "ready":
        room.ready = true;
        this.log.info(`room ${room.roomId} ready on port ${msg.port}`);
        this.send({ t: "roomOpened", roomId: room.roomId, port: msg.port });
        // late-opening rooms still need the current availability picture
        for (const [roomId, st] of this.roomStatuses) {
          const remain =
            st.reopenAtMs !== undefined && st.reopenAtMs > Date.now()
              ? Math.ceil((st.reopenAtMs - Date.now()) / 1000)
              : undefined;
          this.sendToRoom(room, {
            t: "roomStatus",
            roomId,
            open: st.open,
            ...(remain !== undefined ? { reopenInSec: remain } : {}),
          });
        }
        break;
      case "stats":
        room.players = msg.players;
        if (msg.info) room.info = msg.info;
        break;
      case "report":
        this.send({ t: "report", roomId: room.roomId, characters: msg.characters, roomState: msg.roomState });
        break;
      case "requestTransfer":
        this.send({
          t: "requestTransfer",
          roomId: room.roomId,
          characterId: msg.characterId,
          targetRoomId: msg.targetRoomId,
          viaPortalId: msg.viaPortalId,
          arrival: msg.arrival,
          patch: msg.patch,
        });
        break;
      case "mapData":
        this.send({ t: "mapData", roomId: room.roomId, w: msg.w, h: msg.h, data: msg.data });
        break;
      case "globalChat":
        this.send({ t: "globalChat", from: msg.from, text: msg.text });
        break;
      case "closing":
        room.closeReason = msg.reason;
        break;
    }
  }

  private heartbeat(): void {
    this.send({
      t: "heartbeat",
      rooms: [...this.rooms.values()]
        .filter((r) => r.ready)
        .map((r) => ({
          roomId: r.roomId,
          port: r.port,
          players: r.players,
          status: "open",
          info: r.info ?? undefined,
        })),
      shard: {
        pid: process.pid,
        memMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        uptimeSec: Math.round(process.uptime()),
      },
    });
  }

  private send(msg: ShardToMaster): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private sendToRoom(room: RoomProc, msg: HostToRoom): void {
    if (room.child.connected) room.child.send(msg);
  }

  private shutdown(): void {
    if (this.stopping) return;
    this.stopping = true;
    this.log.info("shutting down: closing rooms");
    for (const room of this.rooms.values()) {
      this.sendToRoom(room, { t: "close", reason: "shard shutdown" });
    }
    setTimeout(() => process.exit(0), 1500);
  }
}

loadEnv();
const args = parseArgs();
const masterPort = Number(process.env.MASTER_PORT ?? 4000);
new ShardHost(
  args,
  process.env.MASTER_URL ?? `ws://127.0.0.1:${masterPort}/control`,
  requireEnv("SHARD_SECRET"),
  process.env.SHARD_GAME_HOST ?? "127.0.0.1"
).start();
