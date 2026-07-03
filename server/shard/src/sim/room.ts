/**
 * Room simulation: player sessions, movement validation, interest-managed
 * delta snapshots, time of day, and character state reporting. Networking
 * and IPC stay in roomhost.ts — this module never touches ws directly.
 */
import {
  gameConstants,
  makeLogger,
  type CharacterSnapshot,
  type EntityFull,
  type PortalDef,
  type RoomDef,
  type RoomState,
  type ServerToClient,
} from "@fantasy-mmo/common";
import { allocEntityId, diffState, replicatedState, toFull, type Entity, type ReplicatedState } from "./entities.js";
import { Terrain } from "./terrain.js";

const SPEED_GRACE = 1.6; // multiplier over walkSpeed before a move is rejected

export interface PlayerSession {
  entity: Entity;
  character: CharacterSnapshot;
  lastSeq: number;
  lastMoveAt: number; // ms clock of last accepted move
  /** what this viewer last saw, per entity id — exact per-viewer deltas */
  known: Map<number, ReplicatedState>;
  snapCount: number;
  /** granted a transfer: the coming disconnect must not clobber the DB */
  transferring: boolean;
  send: (msg: ServerToClient) => void;
}

export class RoomSim {
  private log;
  private consts = gameConstants();
  private sessions = new Map<number, PlayerSession>(); // by entity id
  private byCharacterId = new Map<string, PlayerSession>();
  private tickNo = 0;
  private startedAt = Date.now();
  private clockBase: number;
  readonly terrain: Terrain;

  constructor(public def: RoomDef, snapshot: RoomState | null = null) {
    this.log = makeLogger(`room/${def.id}`);
    this.terrain = new Terrain(def);
    // resume the room clock from the last snapshot — survives restarts/moves
    this.clockBase = snapshot ? snapshot.timeOfDay : 0.35;
    if (snapshot) this.log.info(`resumed room clock at ${snapshot.timeOfDay.toFixed(3)}`);
  }

  /** 0..1, wraps; 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  timeOfDay(): number {
    return ((Date.now() - this.startedAt) / 1000 / this.consts.world.dayLengthSec + this.clockBase) % 1;
  }

  /** Persisted dynamic room state (grows with drops/buildings later). */
  buildRoomState(): RoomState {
    return { timeOfDay: this.timeOfDay(), savedAt: Date.now() };
  }

  playerCount(): number {
    return this.sessions.size;
  }

  /** Admit a ticketed character. Returns the session (already welcomed). */
  addPlayer(character: CharacterSnapshot, send: (msg: ServerToClient) => void): PlayerSession {
    const existing = this.byCharacterId.get(character.id);
    if (existing) {
      this.log.warn(`duplicate login for ${character.name}; evicting old session`);
      existing.send({ t: "evict", reason: "logged in elsewhere" });
      this.removePlayer(existing);
    }
    // snap to terrain: persisted/spawn y may predate this room's heightmap
    const groundY = this.terrain.heightAt(character.x, character.z);
    const spawnY = Math.abs(character.y - groundY) > 1.5 ? groundY : Math.max(character.y, groundY);
    const entity: Entity = {
      id: allocEntityId(),
      kind: "player",
      pos: { x: character.x, y: spawnY, z: character.z, yaw: character.yaw },
      renderable: { sprite: "player", anim: "idle", name: character.name },
    };
    const session: PlayerSession = {
      entity,
      character,
      lastSeq: 0,
      lastMoveAt: Date.now(),
      known: new Map(),
      snapCount: 0,
      transferring: false,
      send,
    };
    this.sessions.set(entity.id, session);
    this.byCharacterId.set(character.id, session);

    const ents: EntityFull[] = [];
    for (const other of this.sessions.values()) {
      if (other === session) continue;
      if (this.inInterest(session, other.entity)) {
        ents.push(toFull(other.entity));
        session.known.set(other.entity.id, replicatedState(other.entity));
      }
    }
    send({
      t: "welcome",
      roomId: this.def.id,
      selfId: entity.id,
      name: character.name,
      spawn: { x: entity.pos.x, y: entity.pos.y, z: entity.pos.z, yaw: entity.pos.yaw },
      timeOfDay: this.timeOfDay(),
      ents,
    });
    this.log.info(`${character.name} entered (${this.sessions.size} online)`);
    return session;
  }

  removePlayer(session: PlayerSession): void {
    if (!this.sessions.has(session.entity.id)) return;
    this.sessions.delete(session.entity.id);
    this.byCharacterId.delete(session.character.id);
    this.log.info(`${session.character.name} left (${this.sessions.size} online)`);
  }

  /**
   * Validate a client move. The server is authoritative: bounds, terrain
   * height, and speed are checked; a rejected move keeps the old position and
   * returns a correction for the client to reconcile against.
   */
  handleMove(session: PlayerSession, seq: number, x: number, y: number, z: number, yaw: number, anim: string): void {
    if (seq <= session.lastSeq) return; // stale/duplicate
    session.lastSeq = seq;
    const now = Date.now();
    const dt = Math.min((now - session.lastMoveAt) / 1000, 1.0);
    const p = session.entity.pos;

    const { walkSpeed } = this.consts.movement;
    const tol = this.consts.net.moveToleranceM;
    const maxDist = walkSpeed * dt * SPEED_GRACE + tol;
    const dx = x - p.x;
    const dz = z - p.z;
    const horiz = Math.hypot(dx, dz);

    const inBounds = x >= 0 && x <= this.def.size.w && z >= 0 && z <= this.def.size.h;
    // y must track the heightmap (within jump height above, small sink below)
    const ground = this.terrain.heightAt(x, z);
    const terrainOk = y >= ground - 0.5 && y <= ground + this.consts.world.terrainYToleranceM;
    const speedOk = horiz <= maxDist;
    // solid props (cylinders) and walls (segments) cannot be stood inside
    const solidOk = !this.terrain.collides(x, z);

    if (!inBounds || !terrainOk || !speedOk || !solidOk) {
      session.send({ t: "correct", seq, x: p.x, y: p.y, z: p.z });
      return;
    }
    p.x = x;
    p.y = y;
    p.z = z;
    p.yaw = yaw;
    session.lastMoveAt = now;
    if (anim === "idle" || anim === "move") session.entity.renderable.anim = anim;
  }

  /**
   * Validate a portal use: the portal must exist and the player must stand
   * inside its trigger radius (plus a little grace). Returns the portal or
   * null; the RoomHost turns a valid use into a transfer request.
   */
  validatePortalUse(session: PlayerSession, portalId: string): PortalDef | null {
    const portal = this.def.portals.find((p) => p.id === portalId);
    if (!portal) return null;
    const d = Math.hypot(session.entity.pos.x - portal.x, session.entity.pos.z - portal.z);
    return d <= portal.r + 1.0 ? portal : null;
  }

  private inInterest(viewer: PlayerSession, e: Entity): boolean {
    const r = this.consts.net.interestRadius;
    const dx = e.pos.x - viewer.entity.pos.x;
    const dz = e.pos.z - viewer.entity.pos.z;
    return dx * dx + dz * dz <= r * r;
  }

  /** Simulation tick (10 Hz). Nothing server-driven moves yet in phase 1. */
  tick(): void {
    this.tickNo++;
  }

  /** Snapshot broadcast (12 Hz): per-viewer enter/leave + exact field deltas. */
  snapshot(): void {
    const keyframeEvery = this.consts.net.keyframeEveryNSnapshots;
    for (const viewer of this.sessions.values()) {
      viewer.snapCount++;
      const keyframe = viewer.snapCount % keyframeEvery === 0;
      const enter: EntityFull[] = [];
      const deltas = [];
      const seen = new Set<number>();

      for (const other of this.sessions.values()) {
        if (other === viewer) continue;
        const e = other.entity;
        if (!this.inInterest(viewer, e)) continue;
        seen.add(e.id);
        const curr = replicatedState(e);
        const prev = viewer.known.get(e.id);
        if (!prev || keyframe) {
          enter.push(toFull(e));
        } else {
          const d = diffState(e.id, prev, curr);
          if (d) deltas.push(d);
        }
        viewer.known.set(e.id, curr);
      }

      const leave: number[] = [];
      for (const id of viewer.known.keys()) {
        if (!seen.has(id)) {
          leave.push(id);
          viewer.known.delete(id);
        }
      }

      if (enter.length || deltas.length || leave.length) {
        viewer.send({ t: "snap", tick: this.tickNo, ents: deltas, enter, leave });
      }
    }
  }

  /** Character patches for persistence (batched via shard host → master). */
  buildReport(only?: PlayerSession): Array<{ id: string } & Record<string, unknown>> {
    const sessions = only ? [only] : [...this.sessions.values()];
    return sessions.map((s) => ({
      id: s.character.id,
      roomId: this.def.id,
      x: s.entity.pos.x,
      y: s.entity.pos.y,
      z: s.entity.pos.z,
      yaw: s.entity.pos.yaw,
    }));
  }

  allSessions(): IterableIterator<PlayerSession> {
    return this.sessions.values();
  }
}
