/**
 * Room simulation: player sessions, movement validation, the shared action
 * FSM, mob AI, loot, XP, economy, chat, and interest-managed delta snapshots.
 * Networking and IPC stay in roomhost.ts — this module never touches ws.
 */
import { RegistryService, type CharacterSnapshot, type CombatEvent, type ItemStack, type PortalDef, type PortalWire, type RoomDef, type RoomState, type ServerToClient, type SpawnTable } from "@fantasy-mmo/common";
import { type Entity, type ReplicatedState } from "./entities.js";
import { VoxelWorld } from "./voxel.js";
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
    slots: Array<ItemStack | null>;
    held: number;
    /** latest camera pitch from move packets — live aim for releases */
    lastPitch: number;
    xp: number;
    gold: number;
    dirtyStats: boolean;
    dirtyInv: boolean;
    lastSentHp: number;
    lastSentMana: number;
    send: (msg: ServerToClient) => void;
}
/** A prefab loot cache the room keeps stocked (world coords, live state). */
interface CacheState {
    key: string;
    x: number;
    y: number;
    z: number;
    table: string;
    respawnSec: number;
    lastLootedAt: number;
    hadBag: boolean;
}
export declare class RoomSim {
    def: RoomDef;
    private log;
    private consts;
    readonly reg: RegistryService;
    private entities;
    private sessions;
    private byCharacterId;
    private spawners;
    private projectiles;
    private pendingRemovals;
    /** per-mob damage contributions for XP/loot ownership (mob id → char id → dmg) */
    private damageLog;
    private tickNo;
    private startedAt;
    private lastTickAt;
    private clockBase;
    readonly world: VoxelWorld;
    /** pre-encoded chunk payloads (rebuilt lazily after block edits) */
    private chunkCache;
    /** set by the RoomHost: routes '/g' chat up the control channel */
    onGlobalChat: ((from: string, text: string) => void) | null;
    /** set by the RoomHost: sim-initiated transfers (hub-bound respawn, H key)
     *  go through the same requestTransfer machinery as portal use */
    onTransferRequest: ((session: PlayerSession, targetRoomId: string) => void) | null;
    /** set by the RoomHost on lifecycle rooms: admin /expire re-arms the timer */
    onExpireRequest: ((sec: number) => void) | null;
    /** destination-room availability (sealed dungeon portals) */
    private roomStatus;
    /** def spawn tables + prefab bindings/payload tables — mobs use THESE */
    private liveTables;
    /** prefab loot caches the room tick keeps stocked */
    private caches;
    constructor(def: RoomDef, snapshot?: RoomState | null);
    private initSpawners;
    private spawnPack;
    spawnMob(mobId: string, x: number, z: number, spawnerId: string): Entity | null;
    private initNpcs;
    private restoreDrops;
    private spawnLootBag;
    /** Cache table "auto" resolves per room: cache_<roomId> when it exists. */
    private resolveCacheTable;
    /** Keep prefab caches stocked: when a cache has no bag, its respawn window
     *  has elapsed since it was last looted, and nobody is close enough to see
     *  it pop in, roll the cache table into a fresh unowned bag that never
     *  expires. Runs ~1 Hz from tick(). */
    private tickCaches;
    /** Test/tooling access: live cache states. */
    allCaches(): ReadonlyArray<CacheState>;
    /** Test/tooling access: spawn tables after prefab bindings/merges. */
    liveSpawnTables(): ReadonlyArray<SpawnTable>;
    /** Representative bag contents for replication: rarest first, capped at 3. */
    private lootViewOf;
    private waterLevel;
    /** Feet Y standing on the column's top solid block. */
    groundAt(x: number, z: number): number;
    /** Pre-encoded chunk payloads; invalidated by block edits. */
    private chunks;
    private broadcastBlockSet;
    /** Which inventory item places this block (refunds on break). */
    private itemForBlock;
    private blockInRange;
    handleBlockPlace(session: PlayerSession, slot: number, x: number, y: number, z: number): void;
    handleBlockBreak(session: PlayerSession, x: number, y: number, z: number): void;
    /** Admin: revert every player edit to the generated world. */
    private clearBlocks;
    inPvpZone(x: number, z: number): boolean;
    setRoomStatus(roomId: string, open: boolean): void;
    portalsWire(): PortalWire[];
    private randInt;
    /** 0..1, wraps; 0.25 sunrise, 0.5 noon, 0.75 sunset. */
    timeOfDay(): number;
    /** Pin the room clock so timeOfDay() currently reads `value` (admin /time). */
    setTimeOfDay(value: number): void;
    /** Persisted dynamic room state: clock, loot drops, respawn timers. */
    buildRoomState(): RoomState;
    playerCount(): number;
    /** Admit a ticketed character. Returns the session (already welcomed). */
    addPlayer(character: CharacterSnapshot, send: (msg: ServerToClient) => void): PlayerSession;
    removePlayer(session: PlayerSession): void;
    /**
     * Validate a client move. The server is authoritative: bounds, terrain
     * height, speed, solids, action-FSM movement locks, and frost slows are
     * checked; a rejected move keeps the old position and returns a correction.
     */
    handleMove(session: PlayerSession, seq: number, x: number, y: number, z: number, yaw: number, anim: string, pitch?: number): void;
    /**
     * Validate a portal use: the portal must exist and the player must stand
     * inside its trigger radius (plus a little grace). Returns the portal or
     * null; the RoomHost turns a valid use into a transfer request.
     */
    validatePortalUse(session: PlayerSession, portalId: string): PortalDef | null;
    /** Player pressed attack: use the held item's ability, aimed by camera. */
    handleAttack(session: PlayerSession, aimYaw: number, aimPitch: number): void;
    /** Durability tick: at zero the weapon breaks and the slot empties. */
    private wearHeldItem;
    /** Mob brain wants to attack: same FSM, different intent producer. */
    private mobAttack;
    private resolveMeleeHit;
    /** Which entities this attacker can damage. Player-vs-player needs BOTH
     *  inside a PvP zone (room flag or flagged region). */
    private targetsOf;
    private releaseAbility;
    /** All damage funnels through here: crits, interrupts, threat, death. */
    applyDamage(src: Entity, tgt: Entity, base: number): void;
    /** Apply an on-hit debuff: frost-style slow and/or poison-style DoT.
     *  DoT damage is attributed to src (threat/XP credit via applyDotDamage);
     *  reapplication refreshes rate + clock. Only slows go on the wire — DoT
     *  feedback is the damage events its bites broadcast. */
    applyDebuff(tgt: Entity, debuff: {
        slowPct?: number;
        dotTotal?: number;
        durMs: number;
    }, src: Entity): void;
    /** One DoT bite: normal damage path minus crits/interrupts (a poison tick
     *  interrupting every cast for its whole duration would be a stunlock).
     *  Threat + damage-log credit go to the applier when it still exists. */
    private applyDotDamage;
    private kill;
    /** Death drops: the entire inventory becomes a bag at the death spot. */
    private dropPlayerInventory;
    handleRespawn(session: PlayerSession): void;
    /** H key: hub-bound transfer from anywhere. Dead players use R instead;
     *  in the hub it's just a chat line. The RoomHost's requestTransfer
     *  ignores sessions already transferring. */
    handleReturnToHub(session: PlayerSession): void;
    private awardXp;
    xpNext(level: number): number;
    private sendStats;
    private sendInv;
    private markStatsDirty;
    system(session: PlayerSession, text: string): void;
    systemAll(text: string): void;
    handleEquip(session: PlayerSession, slot: number): void;
    handleInvMove(session: PlayerSession, from: number, to: number): void;
    handleConsume(session: PlayerSession, slot: number): void;
    handleDropItem(session: PlayerSession, slot: number, qty: number): void;
    handlePickup(session: PlayerSession, id: number): void;
    private npcDef;
    private nearNpc;
    handleTalk(session: PlayerSession, entityId: number): void;
    handleBuy(session: PlayerSession, npcEntityId: number, itemId: string, qty: number): void;
    handleSell(session: PlayerSession, npcEntityId: number, slot: number, qty: number): void;
    handleChat(session: PlayerSession, text: string): void;
    /** Delivery of a relayed global-chat line (from the master, any room). */
    deliverGlobalChat(from: string, text: string): void;
    private handleCommand;
    private inInterest;
    /** Send to every session within interest radius of (x,z). */
    broadcastNear(x: number, z: number, msg: ServerToClient): void;
    broadcastEvent(e: CombatEvent, x: number, z: number): void;
    /** Simulation tick (10 Hz): FSMs, brains, projectiles, regen, respawns. */
    tick(): void;
    private tickProjectiles;
    private removeEntity;
    /** Snapshot broadcast (12 Hz): per-viewer enter/leave + exact field deltas. */
    snapshot(): void;
    /** Character patches for persistence (batched via shard host → master). */
    buildReport(only?: PlayerSession): Array<{
        id: string;
    } & Record<string, unknown>>;
    /** Eviction persistence: everyone becomes hub-bound at the hub spawn, so
     *  reconnects after an ephemeral-room collapse land straight in the hub. */
    buildEvictionReport(): Array<{
        id: string;
    } & Record<string, unknown>>;
    allSessions(): IterableIterator<PlayerSession>;
    /** Test/tooling access: all live entities. */
    allEntities(): IterableIterator<Entity>;
    getSession(entityId: number): PlayerSession | undefined;
}
export {};
//# sourceMappingURL=room.d.ts.map