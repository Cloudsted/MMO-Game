/**
 * Room simulation: player sessions, movement validation, interest-managed
 * delta snapshots, time of day, and character state reporting. Networking
 * and IPC stay in roomhost.ts — this module never touches ws directly.
 */
import { type CharacterSnapshot, type PortalDef, type RoomDef, type RoomState, type ServerToClient } from "@fantasy-mmo/common";
import { type Entity, type ReplicatedState } from "./entities.js";
import { Terrain } from "./terrain.js";
export interface PlayerSession {
    entity: Entity;
    character: CharacterSnapshot;
    lastSeq: number;
    lastMoveAt: number;
    /** what this viewer last saw, per entity id — exact per-viewer deltas */
    known: Map<number, ReplicatedState>;
    snapCount: number;
    /** granted a transfer: the coming disconnect must not clobber the DB */
    transferring: boolean;
    send: (msg: ServerToClient) => void;
}
export declare class RoomSim {
    def: RoomDef;
    private log;
    private consts;
    private sessions;
    private byCharacterId;
    private tickNo;
    private startedAt;
    private clockBase;
    readonly terrain: Terrain;
    constructor(def: RoomDef, snapshot?: RoomState | null);
    /** 0..1, wraps; 0.25 sunrise, 0.5 noon, 0.75 sunset. */
    timeOfDay(): number;
    /** Persisted dynamic room state (grows with drops/buildings later). */
    buildRoomState(): RoomState;
    playerCount(): number;
    /** Admit a ticketed character. Returns the session (already welcomed). */
    addPlayer(character: CharacterSnapshot, send: (msg: ServerToClient) => void): PlayerSession;
    removePlayer(session: PlayerSession): void;
    /**
     * Validate a client move. The server is authoritative: bounds, terrain
     * height, and speed are checked; a rejected move keeps the old position and
     * returns a correction for the client to reconcile against.
     */
    handleMove(session: PlayerSession, seq: number, x: number, y: number, z: number, yaw: number, anim: string): void;
    /**
     * Validate a portal use: the portal must exist and the player must stand
     * inside its trigger radius (plus a little grace). Returns the portal or
     * null; the RoomHost turns a valid use into a transfer request.
     */
    validatePortalUse(session: PlayerSession, portalId: string): PortalDef | null;
    private inInterest;
    /** Simulation tick (10 Hz). Nothing server-driven moves yet in phase 1. */
    tick(): void;
    /** Snapshot broadcast (12 Hz): per-viewer enter/leave + exact field deltas. */
    snapshot(): void;
    /** Character patches for persistence (batched via shard host → master). */
    buildReport(only?: PlayerSession): Array<{
        id: string;
    } & Record<string, unknown>>;
    allSessions(): IterableIterator<PlayerSession>;
}
//# sourceMappingURL=room.d.ts.map