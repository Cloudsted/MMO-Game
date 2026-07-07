import type { Server } from "node:http";
import type { Collections, CharacterDoc } from "./db.js";
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
    constructor(cols: Collections, secret: string);
    attach(httpServer: Server): void;
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
    /** Live status for the admin/status endpoint. */
    status(): {
        shards: {
            shardId: string;
            gameHost: string;
            capacity: number;
            lastSeen: number;
            rooms: {
                port: number;
                players: number;
                status: string;
                roomId: string;
            }[];
        }[];
        rooms: {
            shardId: string;
            status: "opening" | "open";
            roomId: string;
        }[];
    };
}
//# sourceMappingURL=shards.d.ts.map