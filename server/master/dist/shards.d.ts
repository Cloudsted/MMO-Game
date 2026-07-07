import type { Server } from "node:http";
import { type RoomAdminInfo } from "@fantasy-mmo/common";
import type { Collections, CharacterDoc } from "./db.js";
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
export declare class ShardManager {
    private cols;
    private secret;
    private shards;
    private roomDefs;
    /** roomId → shardId for rooms that are open or opening */
    private roomAssignment;
    /** expired ephemeral rooms sit out their downtime before reopening fresh */
    private reopenNotBefore;
    /** population/memory timeline for the admin dashboard (in-memory ring) */
    private history;
    /** latest top-down map render per room (pushed by RoomHosts) */
    private roomMaps;
    constructor(cols: Collections, secret: string);
    attach(httpServer: Server): void;
    /** Sample the live population for the dashboard timeline. */
    private sampleHistory;
    historySamples(): HistorySample[];
    private onConnection;
    private registerShard;
    private handleMessage;
    /**
     * Portal transfer: persist the live character state first (with the target
     * room + position reset), then mint a ticket and route the grant back to
     * the requesting shard → RoomHost → client. Position: portal uses carry
     * viaPortalId and land at the PAIRED portal in the target room (y=0 =
     * ground-snap sentinel; addPlayer snaps to the voxel floor); everything
     * else (respawn, H key, no pair found) nulls x/y/z → target default spawn.
     */
    private handleTransferRequest;
    /** Apply batched character state from a shard to MongoDB without re-simulating. */
    private applyReport;
    /** Ensure every defined room has exactly one live/opening instance
     *  (ephemeral rooms sit out their post-expiry downtime first). */
    private ensureRooms;
    /** Open a room on a shard, passing its last persisted snapshot (if any).
     *  Ephemeral rooms always start fresh. */
    private openRoomOn;
    /** Tell every shard (→ every RoomHost) a destination went up or down. */
    private broadcastRoomStatus;
    private pickShard;
    /** Drop a dead shard: mark its rooms down and reassign them. */
    private dropShard;
    private sweep;
    private send;
    /**
     * Mint a one-time transfer ticket for a character into roomId. Pushes the
     * ticket (with the full character snapshot) to the owning shard so the
     * RoomHost can validate the client's hello locally. Falls back to the hub
     * when the requested room has no live instance.
     */
    mintTicket(character: CharacterDoc, roles: string[], requestedRoomId: string): {
        wsUrl: string;
        roomId: string;
        ticket: string;
    } | null;
    /** Admin: close (→ auto-reopen = restart) a room. Stateful rooms resume
     *  from their last snapshot; ephemeral rooms come back fresh. */
    closeRoomAdmin(roomId: string): boolean;
    /** Admin: kick one player out of their room (client auto-recovers via login). */
    kickPlayer(roomId: string, characterId: string, reason: string): boolean;
    /** Admin: server-wide announcement, delivered as global chat in every room. */
    broadcast(from: string, text: string): void;
    /** Admin: teleport a player — same-room snap or cross-room transfer. */
    adminMove(roomId: string, characterId: string, targetRoomId: string, x?: number, z?: number): boolean;
    /** Latest top-down map render for a room (null until its RoomHost pushes). */
    roomMap(roomId: string): {
        w: number;
        h: number;
        data: string;
        at: number;
    } | null;
    /** Ask a room to (re)send its map — used on cache miss after a master restart. */
    requestMap(roomId: string): boolean;
    /** Live status for the admin/status endpoint. */
    status(): {
        shards: {
            shardId: string;
            gameHost: string;
            capacity: number;
            lastSeen: number;
            rooms: {
                roomId: string;
                port: number;
                players: number;
                status: string;
            }[];
        }[];
        rooms: {
            shardId: string;
            status: "opening" | "open";
            roomId: string;
        }[];
    };
    /** Flattened online-player list across every shard (admin dashboard). */
    livePlayers(): ({
        name: string;
        level: number;
        gold: number;
        x: number;
        y: number;
        z: number;
        hp: number;
        maxHp: number;
        charId: string;
    } & {
        roomId: string;
        shardId: string;
    })[];
    /** Everything the admin dashboard's overview needs in one payload. */
    adminOverview(): {
        shards: {
            shardId: string;
            gameHost: string;
            capacity: number;
            lastSeenMsAgo: number;
            connectedForSec: number;
            info: {
                pid: number;
                memMB: number;
                uptimeSec: number;
            } | null;
            rooms: {
                port: number;
                players: number;
                status: string;
                info?: RoomAdminInfo;
                roomId: string;
            }[];
        }[];
        assignments: {
            shardId: string;
            status: "opening" | "open";
            roomId: string;
        }[];
        reopenAt: {
            roomId: string;
            at: number;
        }[];
        defs: {
            id: string;
            name: string;
            type: "hub" | "wilderness" | "dungeon" | "building";
            biome: string;
            size: {
                w: number;
                h: number;
            };
            persistence: "stateful" | "ephemeral";
            lifecycle: {
                lifetimeSec: number;
                downtimeSec: number;
                warnAtSecLeft: number[];
            } | null;
            fixedTime: number | null;
            wind: number;
            flags: {
                pvp: boolean;
                safeZone: boolean;
                buildingEnabled: boolean;
            };
            portals: {
                id: string;
                label: string;
                target: string;
            }[];
            spawnTables: {
                id: string;
                maxAlive: number;
                respawnSec: number;
                mobs: string[];
            }[];
            prefabs: {
                prefab: string;
                count: number;
            }[];
            npcs: {
                id: string;
                name: string;
                shop: boolean;
            }[];
        }[];
    };
}
//# sourceMappingURL=shards.d.ts.map