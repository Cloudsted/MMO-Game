/**
 * Room simulation: player sessions, movement validation, the shared action
 * FSM, mob AI, loot, XP, economy, chat, and interest-managed delta snapshots.
 * Networking and IPC stay in roomhost.ts — this module never touches ws.
 */
import { RegistryService, type EquipSlot, type CharacterSnapshot, type CombatEvent, type ItemStack, type PortalDef, type PortalWire, type RoomAdminInfo, type RoomDef, type RoomState, type ServerToClient, type SpawnTable } from "@fantasy-mmo/common";
import { type Entity, type ReplicatedState } from "./entities.js";
import { VoxelWorld } from "./voxel.js";
/** Aggregated dynamic-modifier state for one player: per-stat capped sums
 *  (enforcement) + per-modifier-id sums (the status bar), from the 6 live
 *  sources — 5 equipment slots + the held hotbar stack iff it's a weapon. */
export interface EffectAgg {
    byStat: Record<string, number>;
    modTotals: Record<string, number>;
    /** total armor value (def.armor × rarity × roll) across worn pieces */
    armor: number;
    /** capped mods-only movement multiplier — the ONE value both handleMove
     *  validation and the effects message use (client prediction mirrors it) */
    speedMult: number;
}
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
    /** attack click that arrived a timing-sliver early (recover tail /
     *  cooldown drift) — retried from tick() until it fires or expires,
     *  instead of silently whiffing after the client already animated */
    pendingAttack: {
        aimYaw: number;
        aimPitch: number;
        until: number;
    } | null;
    slots: Array<ItemStack | null>;
    held: number;
    /** worn gear, indexed by EQUIP_SLOTS order (head/chest/legs/feet/offhand) */
    equipment: Array<ItemStack | null>;
    /** modifier aggregate — recomputed synchronously on every inv/equip change
     *  (touchInv); handleMove reads speedMult on packet arrival */
    agg: EffectAgg;
    /** last effects-message signature — tick sends on change only */
    lastEffectsSig: string;
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
    /** live fire-pillar hazards (kind:"pillars" abilities): each ignites at
     *  igniteAt and damages every valid target once during its short window */
    private firePillars;
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
    /** set by the RoomHost: sim-initiated transfers (hub-bound respawn, H key,
     *  admin teleport) go through the same requestTransfer machinery as portal
     *  use; arrival = admin-teleport landing coordinates in the target room */
    onTransferRequest: ((session: PlayerSession, targetRoomId: string, arrival?: {
        x: number;
        z: number;
    }) => void) | null;
    /** set by the RoomHost on lifecycle rooms: admin /expire re-arms the timer */
    onExpireRequest: ((sec: number) => void) | null;
    /** destination-room availability (sealed dungeon portals) */
    private roomStatus;
    /** closed destinations on a reset timer: roomId → ms epoch of the reopen
     *  (portals show players the countdown) */
    private roomReopenAt;
    /** portal ids sealed by an event gate (boss still alive); combined with
     *  roomStatus — a portal is open only when BOTH say open */
    private eventSealed;
    /** one-shot event triggers (bossHpBelowPct) already fired this boss life */
    private firedEvents;
    /** def spawn tables + prefab bindings/payload tables — mobs use THESE */
    private liveTables;
    /** prefab loot caches the room tick keeps stocked */
    private caches;
    /** destination-room suggested level bands (target room def levelBand),
     *  resolved once at boot — portal labels render them client-side */
    private targetBands;
    constructor(def: RoomDef, snapshot?: RoomState | null);
    /** Validate event refs (room defs aren't cross-checked against the mob
     *  registry at load) and seal event-gated portals while their trigger
     *  boss lives. A boot with the boss on a persisted respawn timer leaves
     *  the gate open — it reseals the moment the boss respawns. */
    private initEvents;
    /** Any live mob of this registry id in the room? */
    private mobAlive;
    private initSpawners;
    private spawnPack;
    /** Resolve a live mob's def at the level it spawned with (stats + kit). */
    private resolvedMobOf;
    spawnMob(mobId: string, x: number, z: number, spawnerId: string, level?: number): Entity | null;
    /** A named event boss (re)appearing re-arms its one-shot triggers and
     *  reseals its gates — the way deeper closes when the guardian returns. */
    private onBossSpawned;
    /** Run one event's actions; `boss` anchors wave spawns and flavors logs. */
    private runEventActions;
    /** bossHpBelowPct triggers: fire once per boss life as hp crosses the line. */
    private checkHpEvents;
    /** Live minions summoned by this entity (caps summon abilities). */
    private minionCountOf;
    /** Spawn `count` mobs around `around` with validated scatter (same floor
     *  band, dry, unobstructed — stragglers stack on the anchor and the
     *  separation pass fans them out). The wave inherits the anchor's threat
     *  table so mid-fight adds charge straight in; spawner "" = no respawn. */
    private summonWave;
    private initNpcs;
    private restoreDrops;
    /** Ground Y for a bag dropped by an entity whose feet are at fromY — the
     *  walkable top under THEM, not the column's standY (which is the canopy/
     *  roof top when the death happens under a tree). */
    private dropY;
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
    /** A portal is open only when its destination room is up AND no boss
     *  event holds it sealed. */
    private portalOpen;
    /** Seconds until a closed destination reopens (undefined = no known timer,
     *  e.g. boss-guarded seals). Clients count down locally from receipt. */
    private reopenInSecOf;
    private broadcastPortalState;
    setRoomStatus(roomId: string, open: boolean, reopenInSec?: number): void;
    portalsWire(): PortalWire[];
    private randInt;
    /** 0..1, wraps; 0.25 sunrise, 0.5 noon, 0.75 sunset. */
    timeOfDay(): number;
    /** Pin the room clock so timeOfDay() currently reads `value` (admin /time). */
    setTimeOfDay(value: number): void;
    /** Persisted dynamic room state: clock, loot drops, respawn timers. */
    buildRoomState(): RoomState;
    playerCount(): number;
    /** Sim-side live telemetry for the admin dashboard; the RoomHost stamps the
     *  process-side fields (uptime/tick timings/memory/expiry) on top. */
    adminInfo(): Pick<RoomAdminInfo, "mobs" | "npcs" | "drops" | "projectiles" | "blockEdits" | "timeOfDay" | "players" | "ents" | "portals">;
    /** Admin dashboard kick: evict a player by character id (same evict +
     *  immediate-remove sequence as duplicate-login handling). */
    adminKick(characterId: string, reason: string): boolean;
    /** Admin dashboard teleport. Same room + coordinates = local snap (the
     *  /tp recipe: set pos, ground-snap, send a correct); another room =
     *  master-mediated transfer, landing at `x/z` if given, else the target's
     *  default spawn. */
    adminMove(characterId: string, targetRoomId: string, x?: number, z?: number): boolean;
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
    /**
     * Player pressed attack: use the held item's ability, aimed by camera.
     * Two layers defend against silent whiffs (client animates, server drops):
     * the body FSM is caught up to the packet's arrival (it otherwise only
     * steps at tick rate, so a click just after recover's end was judged
     * against a stale state), and a still-blocked click is buffered briefly
     * and retried from tick() instead of vanishing.
     */
    handleAttack(session: PlayerSession, aimYaw: number, aimPitch: number): void;
    /** Start the held item's ability. Returns false only for blocks worth
     *  buffering (body busy / cooldown / mana); no-op inputs return true. */
    private tryHeldAbility;
    /** Every worn piece with durability loses 1 per physical hit taken; at
     *  zero it shatters (destroyed, not dropped) and the aggregate updates
     *  mid-fight. Trinkets carry no durability and never wear. */
    private wearEquippedArmor;
    /** Durability tick: at zero the weapon breaks and the slot empties. */
    private wearHeldItem;
    /** A mob's attack kit resolved against the ability registry, at the level it
     *  spawned with (level-gated ranks may have added or swapped options). */
    private attackOptionsOf;
    /** Is `e` a packmate of `caster`? Same spawner (the same camp / den / spawn
     *  table), or one summoned the other. Without this an allyHeal mends whatever
     *  happens to be standing nearby — a Forge-Tender healing the ash husks that
     *  wandered past her is not a pack healer, it is two spawn tables becoming one
     *  fight. Command-spawned mobs all share spawnerId "" and so heal each other,
     *  which is what staging scripts want. */
    private samePack;
    /** Living packmates an allyHeal from `caster` would touch (caster included per spec). */
    private healableAllies;
    /** Mob brain wants to attack: pick a usable option from the mob's kit
     *  (range windows, cooldowns, melee vertical gate — weighted when several
     *  qualify) and start it on the shared FSM. "close" tells the caller
     *  nothing connects from this distance (dead band between melee reach and
     *  a bow's minRange, target up a ledge, reloading while a melee option
     *  exists) — the tick advances the mob instead. */
    private mobAttack;
    /** Tracked horizontal velocity for prediction — zero once move packets go
     *  quiet, clamped so a burst packet can't fake super-speed. */
    private velocityOf;
    /** Two-pass linear intercept: where to aim so a projectile at `speed`
     *  meets the target's current velocity. */
    private interceptPoint;
    private resolveMeleeHit;
    /** Which entities this attacker can damage. Player-vs-player needs BOTH
     *  inside a PvP zone (room flag or flagged region). */
    private targetsOf;
    private releaseAbility;
    /** All damage funnels through here: crits, defensive modifiers + armor
     *  mitigation (players only), interrupts, threat, death, and on-hit hooks
     *  (armor wear, thorns, lifesteal). cls routes the defenses: melee/ranged
     *  are mitigated by armor, magic only by its taken-modifier, "true"
     *  (thorns reflects, scripted damage) bypasses everything. DoT bites never
     *  enter here (applyDotDamage is its own path — poison ignores armor). */
    applyDamage(src: Entity, tgt: Entity, base: number, cls?: "melee" | "ranged" | "magic" | "true", opts?: {
        noReflect?: boolean;
    }): void;
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
    /** Death drops: the entire inventory (and, by default, worn equipment —
     *  combat.deathDropsEquipment) becomes a bag at the death spot. */
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
    /** Self status-effect sync: aggregated gear modifiers (persistent) +
     *  timed slow/dot/hot with REMAINING durations. A signature comparison
     *  makes this send-on-change only — a fresh session's "" signature always
     *  differs, so the first tick after welcome ships the initial state.
     *  Duration ends are bucketed (500 ms) so a refreshed debuff re-sends. */
    private tickEffects;
    private markStatsDirty;
    system(session: PlayerSession, text: string): void;
    systemAll(text: string): void;
    /** Every inventory/equipment mutation funnels through here: replicate,
     *  re-aggregate modifiers, resize vitals. Synchronous on purpose —
     *  handleMove validates against agg.speedMult on packet arrival, so the
     *  aggregate can never lag an equip by a tick. */
    private touchInv;
    /** Rebuild the modifier aggregate from the 6 live sources: the 5 equipment
     *  slots plus the held hotbar stack iff it's a weapon (a sword's perks work
     *  only in hand; parked in the bags it's inert). Per-stat sums clamp
     *  symmetrically to items.mods.caps. */
    private recomputeAgg;
    /** One home for the max-vital formula: progression base + gear. Shrinking
     *  clamps current values (never kills); growing does NOT auto-fill, so
     *  re-equip cycling grants no healing. Level-ups full-heal explicitly. */
    private recomputeVitals;
    handleEquip(session: PlayerSession, slot: number): void;
    /** Which equipment slot index an item def occupies, or -1 if not wearable.
     *  Weapons are NEVER wearable — the offhand takes trinkets and shields
     *  (armor with slot "offhand") only. */
    private slotIndexFor;
    /** Equip from an inventory slot (occupied equipment swaps into the vacated
     *  index — never needs a free slot) or, with invIndex absent, unequip to
     *  the first free inventory slot. */
    handleEquipSlot(session: PlayerSession, slot: EquipSlot, invIndex?: number): void;
    handleInvMove(session: PlayerSession, from: number, to: number): void;
    handleConsume(session: PlayerSession, slot: number): void;
    handleDropItem(session: PlayerSession, slot: number, qty: number): void;
    handlePickup(session: PlayerSession, id: number): void;
    private npcDef;
    private nearNpc;
    handleTalk(session: PlayerSession, entityId: number): void;
    /** Weaving capacity for a gear tier: enchant slots + max strength tier
     *  (constants.enchanting.tierCapacity). An unknown/absent tier clamps to the
     *  highest defined rung at or below it, else the lowest rung. */
    private weaveCapacity;
    /** The weaver's price to add strength `tier` of `mod` onto `stack`, given
     *  how many enchants it already carries (each prior one surcharges). Value-
     *  and rarity-scaled from shared constants; the client mirrors this exactly
     *  for display, this one is authoritative. */
    enchantPrice(stack: ItemStack, priceMult: number, tier: number, existingMods: number): number;
    /** The weaver's price to strip one woven enchant off `stack`. */
    removeCost(stack: ItemStack): number;
    /** Weave enchant `enchantId` at strength `tier` onto the inventory stack at
     *  `slot`. Server re-validates everything at receipt (the menu may be stale:
     *  invMove/sell/drop races just change the target): near + service + offer,
     *  eligible kind via the modifier's appliesTo, the strength within BOTH the
     *  weaver's and the item's tier cap, a FREE enchant slot (capacity counts
     *  every mod — rolled or woven), no duplicate of this modifier (no in-place
     *  upgrade — remove first), gold. */
    handleEnchant(session: PlayerSession, npcEntityId: number, slot: number, enchantId: string, tier: number): void;
    /** Strip a woven modifier off the item at `slot` (frees its enchant slot;
     *  also lifts curses off drop gear). Only weavers with service.remove offer
     *  it; server re-validates near + service + remove + the mod being present. */
    handleUnenchant(session: PlayerSession, npcEntityId: number, slot: number, modId: string): void;
    handleBuy(session: PlayerSession, npcEntityId: number, itemId: string, qty: number): void;
    handleSell(session: PlayerSession, npcEntityId: number, slot: number, qty: number): void;
    /** Sell-value multiplier from an instance's modifiers: perks add, curses
     *  subtract (knobs in items.mods). Kept well under enchant cost so
     *  enchant-then-sell can never mint gold. */
    private modValueMult;
    handleChat(session: PlayerSession, text: string): void;
    /** Delivery of a relayed global-chat line (from the master, any room). */
    deliverGlobalChat(from: string, text: string): void;
    private handleCommand;
    private inInterest;
    /** Send to every session within interest radius of (x,z). */
    broadcastNear(x: number, z: number, msg: ServerToClient): void;
    broadcastEvent(e: CombatEvent, x: number, z: number): void;
    /**
     * Advance one entity's action FSM to `now`, firing due melee hits and
     * releases. tick() runs it at 10 Hz; handleAttack runs it again at packet
     * arrival so a click landing between ticks isn't judged against a stale
     * recover/active state (the silent-whiff bug). Loops because catching up
     * may cross more than one state boundary.
     */
    private advanceCombat;
    /** Simulation tick (10 Hz): FSMs, brains, projectiles, regen, respawns. */
    tick(): void;
    private tickProjectiles;
    /** Fire pillars: ignited hazards damage every valid target once inside
     *  their radius during the ignite window (walking through mid-burn still
     *  burns — kiters can't thread a marching line for free). */
    private tickFirePillars;
    /** Projectile impact: direct damage on the struck target, then AoE splash
     *  (70% damage) on every other valid target inside aoeRadius — exploding
     *  boss fireballs punish near-misses instead of whiffing past kiters. */
    private endProjectile;
    private removeEntity;
    /** Snapshot broadcast (12 Hz): per-viewer enter/leave + exact field deltas. */
    snapshot(): void;
    /** Character patches for persistence (batched via shard host → master).
     *  Sessions with a granted transfer are excluded from batch reports: the
     *  master already persisted their state for the TARGET room, and a report
     *  from here would clobber it with stale source-room data (same rule the
     *  disconnect path applies). */
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