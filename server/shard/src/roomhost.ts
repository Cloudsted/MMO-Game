/**
 * RoomHost child process: the actual game server for one room. Receives its
 * config and transfer tickets over IPC from the shard host, runs the gameplay
 * WS server, and ticks the simulation. Crashing kills only this room.
 */
import { WebSocketServer, WebSocket } from "ws";
import {
  loadEnv,
  gameConstants,
  loadRoomDef,
  makeLogger,
  encode,
  decodeClientToServer,
  type CharacterSnapshot,
  type ServerToClient,
} from "@fantasy-mmo/common";
import { RoomSim, type PlayerSession } from "./sim/room.js";
import type { HostToRoom, RoomToHost } from "./ipc.js";

const REPORT_INTERVAL_MS = 30_000;

interface PendingTicket {
  character: CharacterSnapshot;
  expiresAt: number;
}

class RoomHost {
  private log = makeLogger("roomhost");
  private sim: RoomSim | null = null;
  private wss: WebSocketServer | null = null;
  private tickets = new Map<string, PendingTicket>();
  private pendingTransfers = new Map<string, PlayerSession>(); // characterId → session
  private closing = false;

  start(): void {
    if (!process.send) {
      console.error("roomhost must be forked with an IPC channel");
      process.exit(1);
    }
    process.on("message", (msg: HostToRoom) => this.onIpc(msg));
  }

  private sendHost(msg: RoomToHost): void {
    process.send?.(msg);
  }

  private onIpc(msg: HostToRoom): void {
    switch (msg.t) {
      case "init":
        this.init(msg.roomId, msg.port, msg.snapshot);
        break;
      case "ticket":
        this.tickets.set(msg.ticket, { character: msg.character, expiresAt: msg.expiresAt });
        break;
      case "transferGrant": {
        const session = this.pendingTransfers.get(msg.characterId);
        this.pendingTransfers.delete(msg.characterId);
        if (session) {
          session.transferring = true;
          session.send({ t: "transfer", wsUrl: msg.wsUrl, roomId: msg.targetRoomId, ticket: msg.ticket });
          this.log.info(`${session.character.name} transferring to ${msg.targetRoomId}`);
        }
        break;
      }
      case "transferDeny": {
        const session = this.pendingTransfers.get(msg.characterId);
        this.pendingTransfers.delete(msg.characterId);
        session?.send({ t: "transferFailed", reason: msg.reason });
        break;
      }
      case "close":
        this.close(msg.reason);
        break;
    }
  }

  private init(roomId: string, port: number, snapshot: import("@fantasy-mmo/common").RoomState | null): void {
    const def = loadRoomDef(roomId);
    this.sim = new RoomSim(def, snapshot);
    this.log = makeLogger(`roomhost/${roomId}`);
    const consts = gameConstants();

    this.wss = new WebSocketServer({ port, host: "0.0.0.0" });
    this.wss.on("connection", (ws) => this.onConnection(ws));
    this.wss.on("listening", () => {
      this.log.info(`gameplay WS listening on :${port}`);
      this.sendHost({ t: "ready", port });
    });

    setInterval(() => this.sim!.tick(), 1000 / consts.net.simTickHz);
    setInterval(() => this.sim!.snapshot(), 1000 / consts.net.snapshotHz);
    setInterval(() => this.reportAll(), REPORT_INTERVAL_MS).unref();
    setInterval(() => this.sweepTickets(), 10_000).unref();
    setInterval(() => this.sendHost({ t: "stats", players: this.sim!.playerCount() }), 5000).unref();
  }

  private onConnection(ws: WebSocket): void {
    let session: PlayerSession | null = null;
    const send = (msg: ServerToClient) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
    };

    const helloTimeout = setTimeout(() => {
      if (!session) ws.close();
    }, 5000);

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = decodeClientToServer(raw);
      } catch {
        send({ t: "reject", reason: "bad message" });
        ws.close();
        return;
      }

      if (!session) {
        if (msg.t !== "hello") return;
        const consts = gameConstants();
        if (msg.v !== consts.net.protocolVersion) {
          send({ t: "reject", reason: `protocol version mismatch (server ${consts.net.protocolVersion})` });
          ws.close();
          return;
        }
        const pending = this.tickets.get(msg.ticket);
        if (!pending || pending.expiresAt < Date.now()) {
          send({ t: "reject", reason: "invalid or expired ticket" });
          ws.close();
          return;
        }
        this.tickets.delete(msg.ticket); // single use
        clearTimeout(helloTimeout);
        session = this.sim!.addPlayer(pending.character, send);
        send({ t: "terrain", ...this.sim!.terrain.encode() });
        send({ t: "props", props: this.sim!.terrain.props, walls: this.sim!.terrain.walls });
        send({ t: "portals", portals: this.sim!.def.portals });
        return;
      }

      switch (msg.t) {
        case "move":
          this.sim!.handleMove(session, msg.seq, msg.x, msg.y, msg.z, msg.yaw, msg.anim);
          break;
        case "usePortal": {
          const portal = this.sim!.validatePortalUse(session, msg.portalId);
          if (!portal) {
            send({ t: "transferFailed", reason: "not at a portal" });
            break;
          }
          if (this.pendingTransfers.has(session.character.id)) break; // already in flight
          this.pendingTransfers.set(session.character.id, session);
          this.sendHost({
            t: "requestTransfer",
            characterId: session.character.id,
            targetRoomId: portal.target,
            patch: this.sim!.buildReport(session)[0]!,
          });
          break;
        }
        case "ping":
          send({ t: "pong", n: msg.n, timeOfDay: this.sim!.timeOfDay() });
          break;
        case "leave":
          ws.close();
          break;
        case "hello":
          break; // already admitted
      }
    });

    ws.on("close", () => {
      clearTimeout(helloTimeout);
      if (session) {
        if (session.transferring) {
          // the master already persisted the transfer patch with the target
          // room — reporting here would clobber it with stale source-room data
          this.sim!.removePlayer(session);
        } else {
          // immediate (not batched) persistence on logout, per spec
          this.sendHost({ t: "report", characters: this.sim!.buildReport(session) });
          this.sim!.removePlayer(session);
        }
        this.pendingTransfers.delete(session.character.id);
        session = null;
      }
    });
  }

  private reportAll(): void {
    if (!this.sim) return;
    // room state (clock, later drops/buildings) persists even when empty
    this.sendHost({
      t: "report",
      characters: this.sim.playerCount() > 0 ? this.sim.buildReport() : [],
      roomState: this.sim.buildRoomState(),
    });
  }

  private sweepTickets(): void {
    const now = Date.now();
    for (const [ticket, pending] of this.tickets) {
      if (pending.expiresAt < now) this.tickets.delete(ticket);
    }
  }

  private close(reason: string): void {
    if (this.closing) return;
    this.closing = true;
    this.log.info(`closing: ${reason}`);
    if (this.sim) {
      this.sendHost({ t: "report", characters: this.sim.buildReport(), roomState: this.sim.buildRoomState() });
      for (const s of this.sim.allSessions()) s.send({ t: "evict", reason });
    }
    setTimeout(() => process.exit(0), 500);
  }
}

loadEnv();
new RoomHost().start();
