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
  // sim-tick timings over the current stats window (admin telemetry)
  private tickDurSum = 0;
  private tickDurMax = 0;
  private tickCount = 0;
  /** ephemeral rooms: ms epoch of the scheduled collapse */
  private expiresAtMs: number | null = null;
  /** edit-overlay size at the last map push (map re-sent on change) */
  private lastMapEdits = -1;

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
      case "globalChat":
        this.sim?.deliverGlobalChat(msg.from, msg.text);
        break;
      case "roomStatus":
        this.sim?.setRoomStatus(msg.roomId, msg.open, msg.reopenInSec);
        break;
      case "kick":
        this.sim?.adminKick(msg.characterId, msg.reason);
        break;
      case "adminMove":
        this.sim?.adminMove(msg.characterId, msg.targetRoomId, msg.x, msg.z);
        break;
      case "requestMap":
        this.sendMap();
        break;
      case "close":
        this.close(msg.reason);
        break;
    }
  }

  /** Render + push the top-down map for the admin dashboard. */
  private sendMap(): void {
    if (!this.sim) return;
    this.lastMapEdits = this.sim.world.edits.size;
    this.sendHost({ t: "mapData", ...this.sim.world.renderTopDown() });
  }

  private init(roomId: string, port: number, snapshot: import("@fantasy-mmo/common").RoomState | null): void {
    const def = loadRoomDef(roomId);
    this.sim = new RoomSim(def, snapshot);
    this.sim.onGlobalChat = (from, text) => this.sendHost({ t: "globalChat", from, text });
    // sim-initiated transfers: hub-bound respawn/H key, admin teleports
    this.sim.onTransferRequest = (session, targetRoomId, arrival) =>
      this.requestTransfer(session, targetRoomId, undefined, arrival);
    this.log = makeLogger(`roomhost/${roomId}`);
    const consts = gameConstants();

    this.wss = new WebSocketServer({ port, host: "0.0.0.0" });
    this.wss.on("connection", (ws) => this.onConnection(ws));
    this.wss.on("listening", () => {
      this.log.info(`gameplay WS listening on :${port}`);
      this.sendHost({ t: "ready", port });
      this.sendMap(); // dashboard map (re-sent when the edit overlay changes)
    });

    setInterval(() => {
      const t0 = performance.now();
      this.sim!.tick();
      const d = performance.now() - t0;
      this.tickDurSum += d;
      this.tickCount++;
      if (d > this.tickDurMax) this.tickDurMax = d;
    }, 1000 / consts.net.simTickHz);
    setInterval(() => this.sim!.snapshot(), 1000 / consts.net.snapshotHz);
    setInterval(() => this.reportAll(), REPORT_INTERVAL_MS).unref();
    setInterval(() => this.sweepTickets(), 10_000).unref();
    setInterval(() => this.sendStats(), 5000).unref();

    // ephemeral lifecycle: warn, evict everyone to the hub, close; the master
    // reopens the room fresh after its downtime
    if (def.lifecycle) {
      const overrideSec = Number(process.env.MMO_LIFETIME_OVERRIDE_SEC ?? 0);
      const lifeSec = overrideSec > 0 ? overrideSec : def.lifecycle.lifetimeSec;
      // no lifetimeSec authored = no natural expiry: only an event action
      // (setRoomTimer) or admin /expire arms the collapse
      if (lifeSec) this.scheduleExpiry(lifeSec);
      this.sim.onExpireRequest = (sec) => this.scheduleExpiry(sec); // admin /expire
    }
  }

  /** Stats heartbeat up to the shard host: player count + admin telemetry. */
  private sendStats(): void {
    if (!this.sim) return;
    const info = {
      ...this.sim.adminInfo(),
      uptimeSec: Math.round(process.uptime()),
      tickAvgMs: this.tickCount > 0 ? Math.round((this.tickDurSum / this.tickCount) * 100) / 100 : 0,
      tickMaxMs: Math.round(this.tickDurMax * 100) / 100,
      memMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      expiresAt: this.expiresAtMs,
    };
    this.tickDurSum = 0;
    this.tickDurMax = 0;
    this.tickCount = 0;
    this.sendHost({ t: "stats", players: this.sim.playerCount(), info });
    // block edits changed (build/break/clearblocks): refresh the dashboard map
    if (this.sim.world.edits.size !== this.lastMapEdits) this.sendMap();
  }

  private expiryTimers: NodeJS.Timeout[] = [];

  /** (Re)schedule the room's collapse `lifetimeSec` from now, with warnings. */
  private scheduleExpiry(lifetimeSec: number): void {
    const def = this.sim!.def;
    if (!def.lifecycle) return;
    for (const t of this.expiryTimers) clearTimeout(t);
    this.expiryTimers = [];
    const lifeMs = lifetimeSec * 1000;
    for (const warnSec of def.lifecycle.warnAtSecLeft) {
      const at = lifeMs - warnSec * 1000;
      if (at <= 0) continue;
      const label = warnSec >= 60 ? `${Math.round(warnSec / 60)} minute(s)` : `${warnSec} seconds`;
      this.expiryTimers.push(
        setTimeout(() => this.sim!.systemAll(`The ${def.name} collapses in ${label}!`), at)
      );
    }
    this.expiryTimers.push(setTimeout(() => this.expire(), lifeMs));
    this.expiresAtMs = Date.now() + lifeMs;
    this.log.info(`lifecycle armed: expires in ${lifetimeSec}s`);
  }

  /** Lifetime over: evict everyone toward the hub and shut down. */
  private expire(): void {
    if (this.closing) return;
    this.closing = true;
    this.log.info("lifetime expired: evicting players and closing");
    // persist everyone as hub-bound so reconnects go straight there
    this.sendHost({ t: "report", characters: this.sim!.buildEvictionReport() });
    for (const s of this.sim!.allSessions()) s.send({ t: "evict", reason: "the dungeon has collapsed" });
    this.sendHost({ t: "closing", reason: "expired" });
    setTimeout(() => process.exit(0), 800);
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
        // addPlayer ships welcome + the voxel world (header + chunk batches)
        session = this.sim!.addPlayer(pending.character, send);
        send({ t: "portals", portals: this.sim!.portalsWire() });
        return;
      }

      switch (msg.t) {
        case "move":
          this.sim!.handleMove(session, msg.seq, msg.x, msg.y, msg.z, msg.yaw, msg.anim, msg.pitch ?? 0);
          break;
        case "usePortal": {
          const portal = this.sim!.validatePortalUse(session, msg.portalId);
          if (!portal) {
            send({ t: "transferFailed", reason: "not at a portal" });
            break;
          }
          // viaPortalId lands the player at the paired portal in the target
          this.requestTransfer(session, portal.target, portal.id);
          break;
        }
        case "returnToHub":
          this.sim!.handleReturnToHub(session);
          break;
        case "attack":
          this.sim!.handleAttack(session, msg.yaw, msg.pitch);
          break;
        case "equip":
          this.sim!.handleEquip(session, msg.slot);
          break;
        case "equipSlot":
          this.sim!.handleEquipSlot(session, msg.slot, msg.invIndex);
          break;
        case "enchant":
          this.sim!.handleEnchant(session, msg.npc, msg.slot, msg.enchantId);
          break;
        case "invMove":
          this.sim!.handleInvMove(session, msg.from, msg.to);
          break;
        case "consume":
          this.sim!.handleConsume(session, msg.slot);
          break;
        case "dropItem":
          this.sim!.handleDropItem(session, msg.slot, msg.qty);
          break;
        case "pickup":
          this.sim!.handlePickup(session, msg.id);
          break;
        case "talk":
          this.sim!.handleTalk(session, msg.id);
          break;
        case "buy":
          this.sim!.handleBuy(session, msg.npc, msg.item, msg.qty);
          break;
        case "sell":
          this.sim!.handleSell(session, msg.npc, msg.slot, msg.qty);
          break;
        case "chat":
          this.sim!.handleChat(session, msg.text);
          break;
        case "respawn":
          this.sim!.handleRespawn(session);
          break;
        case "blockPlace":
          this.sim!.handleBlockPlace(session, msg.slot, msg.x, msg.y, msg.z);
          break;
        case "blockBreak":
          this.sim!.handleBlockBreak(session, msg.x, msg.y, msg.z);
          break;
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

  /**
   * Start a master-mediated transfer for a session (portal use, hub-bound
   * respawn, H key). No-op when a transfer is already in flight or granted —
   * the grant path sets session.transferring so the coming disconnect report
   * can't clobber the transfer patch.
   */
  private requestTransfer(
    session: PlayerSession,
    targetRoomId: string,
    viaPortalId?: string,
    arrival?: { x: number; z: number }
  ): void {
    if (session.transferring || this.pendingTransfers.has(session.character.id)) return;
    this.pendingTransfers.set(session.character.id, session);
    this.sendHost({
      t: "requestTransfer",
      characterId: session.character.id,
      targetRoomId,
      viaPortalId,
      arrival,
      patch: this.sim!.buildReport(session)[0]!,
    });
  }

  private reportAll(): void {
    if (!this.sim) return;
    // room state (clock, drops, buildings) persists even when empty —
    // except ephemeral rooms, which restart fresh by design
    this.sendHost({
      t: "report",
      characters: this.sim.playerCount() > 0 ? this.sim.buildReport() : [],
      roomState: this.sim.def.persistence === "ephemeral" ? undefined : this.sim.buildRoomState(),
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
