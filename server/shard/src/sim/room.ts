/**
 * Room simulation: player sessions, movement validation, the shared action
 * FSM, mob AI, loot, XP, economy, chat, and interest-managed delta snapshots.
 * Networking and IPC stay in roomhost.ts — this module never touches ws.
 */
import {
  abilityDmgClass,
  BLOCK,
  BLOCKS,
  ensureItemInstance,
  EQUIP_SLOTS,
  gameConstants,
  isEquippable,
  loadRoomDefs,
  makeLogger,
  mintItem,
  resolveMob,
  RegistryService,
  WORLD_HEIGHT,
  type AbilityDef,
  type EffectWire,
  type EnchantWire,
  type EquipSlot,
  type MobDef,
  type ResolvedMob,
  type CharacterSnapshot,
  type CombatEvent,
  type DropState,
  type EntityFull,
  type ItemDef,
  type ItemStack,
  type LootView,
  type NpcDef,
  type PortalDef,
  type PortalWire,
  type RoomAdminInfo,
  type RoomDef,
  type RoomEventDef,
  type RoomState,
  type ServerToClient,
  type ShopWire,
  type SpawnTable,
} from "@fantasy-mmo/common";
import {
  allocEntityId,
  diffState,
  freshCombat,
  replicatedState,
  toFull,
  type Entity,
  type ReplicatedState,
} from "./entities.js";
import {
  advanceFsm,
  inMeleeCone,
  interruptIfCasting,
  isMovementLocked,
  makeProjectile,
  projectileHits,
  slowMult,
  startAbility,
  type Projectile,
} from "./combat.js";
import { addItem, HOTBAR_SIZE, INV_SIZE, normalizeEquipment, normalizeInventory, removeFromSlot, rollLoot } from "./loot.js";
import {
  applyGravity,
  applyMove,
  chooseAttack,
  findSpawnPoint,
  pathfindWaypoints,
  pickMobEntry,
  PURPOSEFUL_MAX_DROP,
  separateEntities,
  STUCK_TICKS_FOR_PATH,
  tickBrain,
  type AttackOption,
} from "./mobs.js";
import { EditRecorder, PREFABS, stampPrefab } from "./prefabs.js";
import { VoxelWorld } from "./voxel.js";
import { Builder } from "./voxelstructures.js";

/** Chunks per `chunks` message — a whole room ships in a handful of frames. */
const CHUNKS_PER_MSG = 12;

const SPEED_GRACE = 1.6; // multiplier over walkSpeed before a move is rejected
const CORPSE_LINGER_MS = 1500; // dead mob stays visible before despawn
const PACK_AGGRO_RADIUS = 10;
/** enchant strength tier → roman numeral for system messages (index by tier) */
const ROMAN_TIER = ["", "I", "II", "III", "IV", "V"];

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

const EMPTY_AGG: EffectAgg = { byStat: {}, modTotals: {}, armor: 0, speedMult: 1 };

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
  /** attack click that arrived a timing-sliver early (recover tail /
   *  cooldown drift) — retried from tick() until it fires or expires,
   *  instead of silently whiffing after the client already animated */
  pendingAttack: { aimYaw: number; aimPitch: number; until: number } | null;
  // ---- phase 4 ----
  slots: Array<ItemStack | null>; // INV_SIZE slots; hotbar = first HOTBAR_SIZE
  held: number; // hotbar slot index
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

interface Spawner {
  id: string;
  alive: Set<number>;
  respawnAts: number[];
}

/** A prefab loot cache the room keeps stocked (world coords, live state). */
interface CacheState {
  key: string; // "x,y,z" — persistence key in RoomState.caches
  x: number;
  y: number;
  z: number;
  table: string; // "auto" resolves to cache_<roomId> (cache_forest fallback)
  respawnSec: number;
  lastLootedAt: number;
  hadBag: boolean; // a bag was present last sweep — absence now means looted
}

/** No cache bag spawns while a player is this close (they'd see it pop in). */
const CACHE_PLAYER_EXCLUSION_M = 20;

export class RoomSim {
  private log;
  private consts = gameConstants();
  readonly reg = new RegistryService();
  private entities = new Map<number, Entity>();
  private sessions = new Map<number, PlayerSession>(); // by entity id
  private byCharacterId = new Map<string, PlayerSession>();
  private spawners = new Map<string, Spawner>();
  private projectiles: Projectile[] = [];
  /** live fire-pillar hazards (kind:"pillars" abilities): each ignites at
   *  igniteAt and damages every valid target once during its short window */
  private firePillars: Array<{
    x: number;
    y: number;
    z: number;
    igniteAt: number;
    windowEndsAt: number;
    ownerId: number;
    damage: number;
    radius: number;
    hitIds: Set<number>;
  }> = [];
  private pendingRemovals: Array<{ id: number; at: number }> = [];
  /** per-mob damage contributions for XP/loot ownership (mob id → char id → dmg) */
  private damageLog = new Map<number, Map<string, number>>();
  private tickNo = 0;
  private startedAt = Date.now();
  private lastTickAt = Date.now();
  private clockBase: number;
  readonly world: VoxelWorld;
  /** pre-encoded chunk payloads (rebuilt lazily after block edits) */
  private chunkCache: Array<{ cx: number; cz: number; data: string }> | null = null;
  /** set by the RoomHost: routes '/g' chat up the control channel */
  onGlobalChat: ((from: string, text: string) => void) | null = null;
  /** set by the RoomHost: sim-initiated transfers (hub-bound respawn, H key,
   *  admin teleport) go through the same requestTransfer machinery as portal
   *  use; arrival = admin-teleport landing coordinates in the target room */
  onTransferRequest:
    | ((session: PlayerSession, targetRoomId: string, arrival?: { x: number; z: number }) => void)
    | null = null;
  /** set by the RoomHost on lifecycle rooms: admin /expire re-arms the timer */
  onExpireRequest: ((sec: number) => void) | null = null;

  /** destination-room availability (sealed dungeon portals) */
  private roomStatus = new Map<string, boolean>();
  /** closed destinations on a reset timer: roomId → ms epoch of the reopen
   *  (portals show players the countdown) */
  private roomReopenAt = new Map<string, number>();

  /** portal ids sealed by an event gate (boss still alive); combined with
   *  roomStatus — a portal is open only when BOTH say open */
  private eventSealed = new Set<string>();
  /** one-shot event triggers (bossHpBelowPct) already fired this boss life */
  private firedEvents = new Set<string>();

  /** def spawn tables + prefab bindings/payload tables — mobs use THESE */
  private liveTables: SpawnTable[];
  /** prefab loot caches the room tick keeps stocked */
  private caches: CacheState[];
  /** destination-room suggested level bands (target room def levelBand),
   *  resolved once at boot — portal labels render them client-side */
  private targetBands = new Map<string, { min: number; max: number }>();

  constructor(public def: RoomDef, snapshot: RoomState | null = null) {
    this.log = makeLogger(`room/${def.id}`);
    this.world = new VoxelWorld(def);
    if (snapshot?.blocks?.length) {
      this.world.restoreEdits(snapshot.blocks);
      this.log.info(`restored ${snapshot.blocks.length} block edit(s) from snapshot`);
    }
    // resume the room clock from the last snapshot — survives restarts/moves
    this.clockBase = snapshot ? snapshot.timeOfDay : 0.35;
    if (snapshot) this.log.info(`resumed room clock at ${snapshot.timeOfDay.toFixed(3)}`);
    // live spawn tables: prefab spawnRegion bindings re-center def tables onto
    // their prefab site (bandit fort); prefab-carried tables merge in. All of
    // it is deterministic gen output — same tables every boot.
    this.liveTables = this.def.spawnTables.map((t) => ({ ...t, region: { ...t.region } }));
    for (const bind of this.world.features.bindings) {
      const t = this.liveTables.find((lt) => lt.id === bind.tableId);
      if (t) {
        t.region.x = bind.x;
        t.region.z = bind.z;
        this.log.info(`spawn table '${t.id}' bound to prefab site (${bind.x}, ${bind.z})`);
      } else {
        this.log.warn(`prefab binding references unknown spawn table '${bind.tableId}'`);
      }
    }
    this.liveTables.push(...this.world.features.extraTables);
    // prefab loot caches (+ persisted lastLootedAt so restarts don't refill)
    this.caches = this.world.features.caches.map((c) => ({
      key: `${Math.floor(c.x)},${Math.floor(c.y)},${Math.floor(c.z)}`,
      x: c.x,
      y: c.y,
      z: c.z,
      table: c.table,
      respawnSec: c.respawnSec,
      lastLootedAt: 0,
      hadBag: false,
    }));
    if (snapshot?.caches) {
      for (const c of this.caches) c.lastLootedAt = snapshot.caches[c.key] ?? 0;
    }
    if (this.caches.length > 0) this.log.info(`${this.caches.length} prefab loot cache(s) registered`);
    // destination level bands for portal labels (bands live on ROOM defs;
    // a portal to a band-less room — hub/grounds — simply carries none)
    if (this.def.portals.length > 0) {
      const all = loadRoomDefs();
      for (const p of this.def.portals) {
        const band = all.get(p.target)?.levelBand;
        if (band) this.targetBands.set(p.target, band);
      }
    }
    this.initSpawners(snapshot);
    this.initNpcs();
    this.restoreDrops(snapshot);
    this.initEvents();
  }

  /** Validate event refs (room defs aren't cross-checked against the mob
   *  registry at load) and seal event-gated portals while their trigger
   *  boss lives. A boot with the boss on a persisted respawn timer leaves
   *  the gate open — it reseals the moment the boss respawns. */
  private initEvents(): void {
    for (const ev of this.def.events) {
      if (!this.reg.mobs[ev.on.mob]) this.log.warn(`event ${ev.id}: unknown mob '${ev.on.mob}'`);
      for (const act of ev.actions) {
        if (act.kind === "openPortal") {
          if (!this.def.portals.some((p) => p.id === act.portalId)) {
            this.log.warn(`event ${ev.id}: unknown portal '${act.portalId}'`);
          } else if (this.mobAlive(ev.on.mob)) {
            this.eventSealed.add(act.portalId);
          }
        }
        if (act.kind === "spawnMobs" && !this.reg.mobs[act.mob]) {
          this.log.warn(`event ${ev.id}: unknown wave mob '${act.mob}'`);
        }
        if (act.kind === "setRoomTimer" && !this.def.lifecycle) {
          this.log.warn(`event ${ev.id}: setRoomTimer on a room without a lifecycle`);
        }
      }
    }
    if (this.eventSealed.size > 0) {
      this.log.info(`${this.eventSealed.size} portal(s) sealed behind boss events`);
    }
    // enchanter services: every offered id must be a modifier with an
    // enchant block (room defs aren't registry-cross-checked at load)
    for (const npc of this.def.npcs) {
      for (const id of npc.service?.offers ?? []) {
        if (!this.reg.modifiers[id]?.enchant) {
          this.log.warn(`npc ${npc.id}: enchant offer '${id}' has no enchantable modifier`);
        }
      }
    }
  }

  /** Any live mob of this registry id in the room? */
  private mobAlive(mobId: string): boolean {
    for (const e of this.entities.values()) {
      if (e.kind === "mob" && e.brain?.mobId === mobId && e.combat?.act !== "dead") return true;
    }
    return false;
  }

  // ---------- world population ----------

  private initSpawners(snapshot: RoomState | null): void {
    const now = Date.now();
    for (const table of this.liveTables) {
      const persisted = snapshot?.spawners?.[table.id] ?? [];
      const pending = persisted.filter((t) => t > now);
      const spawner: Spawner = { id: table.id, alive: new Set(), respawnAts: pending };
      this.spawners.set(table.id, spawner);
      // fill to maxAlive minus what's still on a respawn timer
      let toSpawn = Math.max(0, table.maxAlive - pending.length);
      while (toSpawn > 0) {
        const pack = Math.min(toSpawn, this.randInt(table.packSize[0], table.packSize[1]));
        this.spawnPack(table.id, pack);
        toSpawn -= pack;
      }
    }
    const mobCount = [...this.entities.values()].filter((e) => e.kind === "mob").length;
    if (mobCount > 0) this.log.info(`spawned ${mobCount} mobs from ${this.liveTables.length} tables`);
  }

  private spawnPack(spawnerId: string, count: number): void {
    const table = this.liveTables.find((t) => t.id === spawnerId);
    const spawner = this.spawners.get(spawnerId);
    if (!table || !spawner) return;
    const at = findSpawnPoint(table, this.world, this.waterLevel());
    if (!at) return;
    // pack scatter must be validated too — the point findSpawnPoint vetted
    // is clean, but a blind ±1.5 offset can land on a tree column (the treed
    // boar packs). Reject scatters whose floor differs from the pack point's
    // or that clip solids/liquid; stragglers stack on the point and the
    // separation pass fans them out.
    const baseY = this.world.floorY(at.x, at.z);
    for (let i = 0; i < count; i++) {
      let x = at.x;
      let z = at.z;
      for (let attempt = 0; attempt < 6; attempt++) {
        const cx = at.x + (Math.random() - 0.5) * 3;
        const cz = at.z + (Math.random() - 0.5) * 3;
        const cy = this.world.floorY(cx, cz);
        if (Math.abs(cy - baseY) > 2) continue;
        if (this.world.liquidAt(cx, cy + 0.1, cz)) continue;
        if (this.world.collidesAABB(cx, cy, cz, 0.3, 1.6)) continue;
        x = cx;
        z = cz;
        break;
      }
      const pick = pickMobEntry(table);
      const mob = this.spawnMob(pick.mob, x, z, spawnerId, pick.level);
      if (mob) spawner.alive.add(mob.id);
    }
  }

  /** Resolve a live mob's def at the level it spawned with (stats + kit). */
  private resolvedMobOf(e: Entity): ResolvedMob | null {
    const def = this.reg.mobs[e.brain!.mobId];
    if (!def) return null;
    return resolveMob(def, e.brain!.spawnLevel, this.consts.mobs.scaling);
  }

  spawnMob(mobId: string, x: number, z: number, spawnerId: string, level?: number): Entity | null {
    const def = this.reg.mobs[mobId];
    if (!def) return null;
    const r = resolveMob(def, level, this.consts.mobs.scaling);
    const gx = Math.min(Math.max(x, 1), this.def.size.w - 1);
    const gz = Math.min(Math.max(z, 1), this.def.size.h - 1);
    const e: Entity = {
      id: allocEntityId(),
      kind: "mob",
      // floorY, not standY: mobs spawn on the ground UNDER canopies/roofs
      pos: { x: gx, y: this.world.floorY(gx, gz), z: gz, yaw: Math.random() * Math.PI * 2 },
      renderable: { sprite: def.sprite, anim: "idle", name: r.name },
      level: r.level,
      ...(r.boss ? { boss: true } : {}),
      health: { hp: r.hp, maxHp: r.hp },
      combat: freshCombat(),
      brain: {
        mobId,
        spawnLevel: r.level,
        state: "patrol",
        home: { x: gx, z: gz },
        spawnerId,
        targetId: null,
        threat: new Map(),
        nextWanderAt: Date.now() + Math.random() * 4000,
        wanderTarget: null,
      },
    };
    this.entities.set(e.id, e);
    this.onBossSpawned(mobId);
    return e;
  }

  /** A named event boss (re)appearing re-arms its one-shot triggers and
   *  reseals its gates — the way deeper closes when the guardian returns. */
  private onBossSpawned(mobId: string): void {
    for (const ev of this.def.events) {
      if (ev.on.mob !== mobId) continue;
      this.firedEvents.delete(ev.id);
      for (const act of ev.actions) {
        if (act.kind === "openPortal" && !this.eventSealed.has(act.portalId)) {
          this.eventSealed.add(act.portalId);
          this.broadcastPortalState(act.portalId);
        }
      }
    }
  }

  /** Run one event's actions; `boss` anchors wave spawns and flavors logs. */
  private runEventActions(ev: RoomEventDef, boss: Entity): void {
    for (const act of ev.actions) {
      switch (act.kind) {
        case "openPortal":
          if (this.eventSealed.delete(act.portalId)) {
            this.broadcastPortalState(act.portalId);
            this.log.info(`event ${ev.id}: portal ${act.portalId} opened`);
          }
          break;
        case "spawnMobs":
          this.summonWave(boss, act.mob, act.count, act.radius, undefined, { xp: true, loot: true }, act.level);
          this.log.info(`event ${ev.id}: wave of ${act.count}x ${act.mob}${act.level ? ` @L${act.level}` : ""}`);
          break;
        case "setRoomTimer":
          if (this.onExpireRequest) {
            this.onExpireRequest(act.sec);
            this.log.info(`event ${ev.id}: room collapse re-armed to ${act.sec}s`);
          }
          break;
        case "announce":
          this.systemAll(act.text);
          break;
      }
    }
  }

  /** bossHpBelowPct triggers: fire once per boss life as hp crosses the line. */
  private checkHpEvents(tgt: Entity): void {
    if (tgt.kind !== "mob" || !tgt.health || tgt.health.hp <= 0) return;
    const pct = tgt.health.hp / tgt.health.maxHp;
    for (const ev of this.def.events) {
      if (ev.on.kind !== "bossHpBelowPct" || ev.on.mob !== tgt.brain!.mobId) continue;
      if (this.firedEvents.has(ev.id) || pct >= ev.on.pct) continue;
      this.firedEvents.add(ev.id);
      this.runEventActions(ev, tgt);
    }
  }

  /** Live minions summoned by this entity (caps summon abilities). */
  private minionCountOf(summoner: Entity): number {
    let n = 0;
    for (const e of this.entities.values()) {
      if (e.kind === "mob" && e.brain?.summonerId === summoner.id && e.combat?.act !== "dead") n++;
    }
    return n;
  }

  /** Spawn `count` mobs around `around` with validated scatter (same floor
   *  band, dry, unobstructed — stragglers stack on the anchor and the
   *  separation pass fans them out). The wave inherits the anchor's threat
   *  table so mid-fight adds charge straight in; spawner "" = no respawn. */
  private summonWave(
    around: Entity,
    mobId: string,
    count: number,
    radius: number,
    text?: string,
    grants: { xp: boolean; loot: boolean } = { xp: true, loot: true },
    level?: number
  ): void {
    const b = around.brain;
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      let x = around.pos.x;
      let z = around.pos.z;
      for (let attempt = 0; attempt < 8; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const r = 1.5 + Math.random() * Math.max(0.5, radius - 1.5);
        const cx = around.pos.x + Math.sin(ang) * r;
        const cz = around.pos.z + Math.cos(ang) * r;
        const cy = this.world.floorY(cx, cz);
        if (Math.abs(cy - around.pos.y) > 3) continue;
        if (this.world.liquidAt(cx, cy + 0.1, cz)) continue;
        if (this.world.collidesAABB(cx, cy, cz, 0.3, 1.6)) continue;
        x = cx;
        z = cz;
        break;
      }
      const minion = this.spawnMob(mobId, x, z, "", level);
      if (!minion) continue;
      minion.brain!.summonerId = around.id;
      minion.brain!.grantsXp = grants.xp;
      minion.brain!.grantsLoot = grants.loot;
      if (b) {
        minion.brain!.threat = new Map(b.threat);
        minion.brain!.targetId = b.targetId;
      }
      spawned++;
    }
    if (spawned > 0 && text) {
      this.broadcastNear(around.pos.x, around.pos.z, { t: "chat", channel: "system", from: "", text });
    }
  }

  private initNpcs(): void {
    for (const npc of this.def.npcs) {
      let { x, z } = npc;
      // nudge out of structures if the def landed inside solid blocks
      for (let i = 0; i < 8 && this.world.collidesAABB(x, this.world.standY(x, z), z, 0.3, 1.6); i++) {
        x = npc.x + (Math.random() - 0.5) * 3;
        z = npc.z + (Math.random() - 0.5) * 3;
      }
      const e: Entity = {
        id: allocEntityId(),
        kind: "npc",
        pos: { x, y: this.world.standY(x, z), z, yaw: npc.yaw },
        renderable: { sprite: npc.sprite, anim: "idle", name: npc.name },
        npcId: npc.id,
        brain: {
          mobId: "", // NPCs borrow the brain for wandering only — never resolved
          spawnLevel: 0,
          state: "patrol",
          home: { x, z },
          spawnerId: "",
          targetId: null,
          threat: new Map(),
          nextWanderAt: Date.now() + Math.random() * 6000,
          wanderTarget: null,
        },
      };
      this.entities.set(e.id, e);
    }
  }

  private restoreDrops(snapshot: RoomState | null): void {
    if (!snapshot?.drops) return;
    const now = Date.now();
    let restored = 0;
    for (const d of snapshot.drops) {
      if (d.expireAt !== null && d.expireAt < now) continue;
      // restore at the persisted y: cache bags can sit INSIDE structures
      // (mine tunnels) where the column's standY is the hilltop above
      this.spawnLootBag(d.x, d.z, d.items, d.gold, d.owner, d.unlockAt, d.expireAt, d.y);
      restored++;
    }
    if (restored > 0) this.log.info(`restored ${restored} loot drop(s) from snapshot`);
  }

  /** Ground Y for a bag dropped by an entity whose feet are at fromY — the
   *  walkable top under THEM, not the column's standY (which is the canopy/
   *  roof top when the death happens under a tree). */
  private dropY(x: number, z: number, fromY: number): number {
    return this.world.groundBelow(x, fromY + 1.05, z, 0.25);
  }

  private spawnLootBag(
    x: number,
    z: number,
    items: ItemStack[],
    gold: number,
    owner: string | null,
    unlockAt: number,
    expireAt: number | null,
    atY?: number
  ): Entity {
    const e: Entity = {
      id: allocEntityId(),
      kind: "loot",
      pos: { x, y: atY ?? this.world.standY(x, z), z, yaw: 0 },
      renderable: { sprite: "loot_bag", anim: "idle" },
      loot: { items, gold, owner, unlockAt, expireAt },
      lootView: this.lootViewOf(items),
    };
    this.entities.set(e.id, e);
    return e;
  }

  // ---------- prefab loot caches ----------

  /** Cache table "auto" resolves per room: cache_<roomId> when it exists. */
  private resolveCacheTable(table: string): string {
    if (table !== "auto") return table;
    const roomTable = `cache_${this.def.id}`;
    return this.reg.loot[roomTable] ? roomTable : "cache_forest";
  }

  /** Keep prefab caches stocked: when a cache has no bag, its respawn window
   *  has elapsed since it was last looted, and nobody is close enough to see
   *  it pop in, roll the cache table into a fresh unowned bag that never
   *  expires. Runs ~1 Hz from tick(). */
  private tickCaches(now: number): void {
    for (const cache of this.caches) {
      // is the cache's bag still out there? (position match, not identity —
      // survives restarts where bags come back via restoreDrops)
      let present = false;
      for (const e of this.entities.values()) {
        if (e.kind !== "loot") continue;
        if (
          Math.abs(e.pos.x - cache.x) <= 1.5 &&
          Math.abs(e.pos.z - cache.z) <= 1.5 &&
          Math.abs(e.pos.y - cache.y) <= 3
        ) {
          present = true;
          break;
        }
      }
      if (present) {
        cache.hadBag = true;
        continue;
      }
      if (cache.hadBag) {
        // the bag vanished since last sweep — somebody emptied it
        cache.hadBag = false;
        cache.lastLootedAt = now;
        continue;
      }
      if (now - cache.lastLootedAt < cache.respawnSec * 1000) continue;
      let playerNear = false;
      for (const s of this.sessions.values()) {
        if (Math.hypot(s.entity.pos.x - cache.x, s.entity.pos.z - cache.z) < CACHE_PLAYER_EXCLUSION_M) {
          playerNear = true;
          break;
        }
      }
      if (playerNear) continue;
      const rolled = rollLoot(this.reg, this.consts, this.resolveCacheTable(cache.table));
      if (rolled.items.length === 0 && rolled.gold === 0) {
        cache.lastLootedAt = now; // all-nothing roll: try again next window
        continue;
      }
      // snap to the surface when the cache sits on open ground; keep the
      // authored y when it's inside a structure (tunnel, tower top)
      const surface = this.world.standY(cache.x, cache.z);
      const bagY = Math.abs(surface - cache.y) <= 2 ? surface : cache.y;
      this.spawnLootBag(cache.x, cache.z, rolled.items, rolled.gold, null, 0, null, bagY);
      cache.hadBag = true;
    }
  }

  /** Test/tooling access: live cache states. */
  allCaches(): ReadonlyArray<CacheState> {
    return this.caches;
  }

  /** Test/tooling access: spawn tables after prefab bindings/merges. */
  liveSpawnTables(): ReadonlyArray<SpawnTable> {
    return this.liveTables;
  }

  /** Representative bag contents for replication: rarest first, capped at 3. */
  private lootViewOf(items: ItemStack[]): LootView {
    const order = this.reg.rarityOrder();
    return [...items]
      .sort((a, b) => order.indexOf(b.rarity) - order.indexOf(a.rarity))
      .slice(0, 3)
      .map((s) => ({ item: s.item, rarity: s.rarity }));
  }

  private waterLevel(): number | null {
    return this.def.terrain.waterLevel ?? null;
  }

  // ---------- blocks (place / break) ----------

  /** Feet Y standing on the column's top solid block. */
  groundAt(x: number, z: number): number {
    return this.world.standY(x, z);
  }

  /** Pre-encoded chunk payloads; invalidated by block edits. */
  private chunks(): Array<{ cx: number; cz: number; data: string }> {
    if (!this.chunkCache) this.chunkCache = this.world.encodeChunks();
    return this.chunkCache;
  }

  private broadcastBlockSet(x: number, y: number, z: number, id: number): void {
    this.chunkCache = null;
    for (const sess of this.sessions.values()) sess.send({ t: "blockSet", x, y, z, id });
  }

  /** Which inventory item places this block (refunds on break). */
  private itemForBlock(blockId: number): string | null {
    const name = BLOCKS[blockId]?.name;
    if (!name) return null;
    for (const [itemId, def] of Object.entries(this.reg.items)) {
      if (def.block === name) return itemId;
    }
    return null;
  }

  private blockInRange(session: PlayerSession, x: number, y: number, z: number): boolean {
    const p = session.entity.pos;
    const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y + this.consts.movement.eyeHeight), z + 0.5 - p.z);
    return d <= this.consts.building.placeRangeM;
  }

  handleBlockPlace(session: PlayerSession, slot: number, x: number, y: number, z: number): void {
    if (!this.def.flags.buildingEnabled) {
      this.system(session, "Building isn't allowed here — try the Freehold.");
      return;
    }
    if (session.entity.combat!.act === "dead") return;
    const stack = session.slots[slot];
    const def = stack ? this.reg.items[stack.item] : null;
    if (!stack || !def || def.kind !== "building" || !def.block) return;
    const blockDef = BLOCK[def.block];
    if (!blockDef) return;
    if (y < 1 || y >= WORLD_HEIGHT || !this.world.inBounds(x, y, z)) return;
    if (!this.blockInRange(session, x, y, z)) return;
    if (this.world.edits.size >= this.consts.building.maxPlayerBlocksPerRoom) {
      this.system(session, "The grounds can't hold any more construction.");
      return;
    }
    // target cell must be air or a walk-through decoration (grass, flowers)
    const cur = BLOCKS[this.world.get(x, y, z)];
    const replaceable = !cur || cur.cull === "none" || (cur.kind === "cross" && !cur.light);
    if (!replaceable) return;
    // solid blocks can't be placed inside a living creature
    if (blockDef.solid) {
      for (const e of this.entities.values()) {
        if (e.kind === "loot" || e.combat?.act === "dead") continue;
        const r = 0.45;
        if (
          e.pos.x + r > x && e.pos.x - r < x + 1 &&
          e.pos.z + r > z && e.pos.z - r < z + 1 &&
          e.pos.y + 1.8 > y && e.pos.y < y + 1
        ) {
          return;
        }
      }
    }
    removeFromSlot(session.slots, slot, 1);
    this.touchInv(session);
    this.world.applyEdit(x, y, z, blockDef.id, session.character.id);
    this.broadcastBlockSet(x, y, z, blockDef.id);
  }

  handleBlockBreak(session: PlayerSession, x: number, y: number, z: number): void {
    if (!this.def.flags.buildingEnabled) return;
    if (session.entity.combat!.act === "dead") return;
    if (y < 1 || y >= WORLD_HEIGHT || !this.world.inBounds(x, y, z)) return;
    if (!this.blockInRange(session, x, y, z)) return;
    const cur = BLOCKS[this.world.get(x, y, z)];
    if (!cur || cur.cull === "none" || cur.cull === "liquid" || cur.name === "bedrock") return;
    // player-placed blocks refund their item to the breaker
    const edit = this.world.editAt(x, y, z);
    if (edit && edit.id !== 0) {
      const itemId = this.itemForBlock(cur.id);
      if (itemId) {
        const leftover = addItem(this.reg, session.slots, { item: itemId, qty: 1, rarity: "common" });
        if (leftover > 0) {
          this.spawnLootBag(session.entity.pos.x, session.entity.pos.z, [{ item: itemId, qty: 1, rarity: "common" }], 0, session.character.id, Date.now() + 3000, Date.now() + this.consts.combat.mobLootExpireMs, this.dropY(session.entity.pos.x, session.entity.pos.z, session.entity.pos.y));
        }
        this.touchInv(session);
      }
    }
    this.world.applyEdit(x, y, z, 0, session.character.id);
    this.broadcastBlockSet(x, y, z, 0);
  }

  /** Admin: revert every player edit to the generated world. */
  private clearBlocks(): number {
    const reverted = this.world.clearEdits();
    this.chunkCache = null;
    for (const cell of reverted) {
      for (const sess of this.sessions.values()) {
        sess.send({ t: "blockSet", x: cell.x, y: cell.y, z: cell.z, id: cell.id });
      }
    }
    return reverted.length;
  }

  // ---------- regions / pvp ----------

  inPvpZone(x: number, z: number): boolean {
    if (this.def.flags.pvp) return true;
    for (const r of this.def.regions) {
      if (r.pvp && Math.hypot(x - r.x, z - r.z) <= r.r) return true;
    }
    return false;
  }

  // ---------- portal availability ----------

  /** A portal is open only when its destination room is up AND no boss
   *  event holds it sealed. */
  private portalOpen(p: PortalDef): boolean {
    return (this.roomStatus.get(p.target) ?? true) && !this.eventSealed.has(p.id);
  }

  /** Seconds until a closed destination reopens (undefined = no known timer,
   *  e.g. boss-guarded seals). Clients count down locally from receipt. */
  private reopenInSecOf(target: string): number | undefined {
    const at = this.roomReopenAt.get(target);
    if (at === undefined || at <= Date.now()) return undefined;
    return Math.ceil((at - Date.now()) / 1000);
  }

  private broadcastPortalState(portalId: string): void {
    const p = this.def.portals.find((x) => x.id === portalId);
    if (!p) return;
    const open = this.portalOpen(p);
    const reopenInSec = open ? undefined : this.reopenInSecOf(p.target);
    for (const sess of this.sessions.values())
      sess.send({ t: "portalState", target: p.target, open, ...(reopenInSec !== undefined ? { reopenInSec } : {}) });
  }

  setRoomStatus(roomId: string, open: boolean, reopenInSec?: number): void {
    const prev = this.roomStatus.get(roomId);
    const prevReopen = this.roomReopenAt.get(roomId);
    this.roomStatus.set(roomId, open);
    if (open || reopenInSec === undefined) this.roomReopenAt.delete(roomId);
    else this.roomReopenAt.set(roomId, Date.now() + reopenInSec * 1000);
    if (prev === open && this.roomReopenAt.get(roomId) === prevReopen) return;
    for (const p of this.def.portals) {
      if (p.target !== roomId) continue;
      const combined = this.portalOpen(p);
      const remain = combined ? undefined : this.reopenInSecOf(roomId);
      for (const sess of this.sessions.values())
        sess.send({ t: "portalState", target: roomId, open: combined, ...(remain !== undefined ? { reopenInSec: remain } : {}) });
    }
  }

  portalsWire(): PortalWire[] {
    return this.def.portals.map((p) => {
      const open = this.portalOpen(p);
      const reopenInSec = open ? undefined : this.reopenInSecOf(p.target);
      const band = this.targetBands.get(p.target);
      return {
        ...p,
        open,
        ...(reopenInSec !== undefined ? { reopenInSec } : {}),
        ...(band ? { band } : {}),
      };
    });
  }

  private randInt(lo: number, hi: number): number {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  // ---------- clock / persistence ----------

  /** 0..1, wraps; 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  timeOfDay(): number {
    if (this.def.fixedTime !== undefined) return this.def.fixedTime; // dungeon mood
    return ((Date.now() - this.startedAt) / 1000 / this.consts.world.dayLengthSec + this.clockBase) % 1;
  }

  /** Pin the room clock so timeOfDay() currently reads `value` (admin /time). */
  setTimeOfDay(value: number): void {
    const elapsed = (Date.now() - this.startedAt) / 1000 / this.consts.world.dayLengthSec;
    this.clockBase = (((value - elapsed) % 1) + 1) % 1;
  }

  /** Persisted dynamic room state: clock, loot drops, respawn timers. */
  buildRoomState(): RoomState {
    const drops: DropState[] = [];
    for (const e of this.entities.values()) {
      if (e.kind !== "loot" || !e.loot) continue;
      drops.push({
        items: e.loot.items,
        gold: e.loot.gold,
        x: e.pos.x,
        y: e.pos.y,
        z: e.pos.z,
        owner: e.loot.owner,
        unlockAt: e.loot.unlockAt,
        expireAt: e.loot.expireAt,
      });
    }
    const spawners: Record<string, number[]> = {};
    for (const s of this.spawners.values()) {
      if (s.respawnAts.length > 0) spawners[s.id] = s.respawnAts;
    }
    const caches: Record<string, number> = {};
    for (const c of this.caches) {
      if (c.lastLootedAt > 0) caches[c.key] = c.lastLootedAt;
    }
    return { timeOfDay: this.timeOfDay(), savedAt: Date.now(), drops, spawners, blocks: this.world.serializeEdits(), caches };
  }

  playerCount(): number {
    return this.sessions.size;
  }

  /** Sim-side live telemetry for the admin dashboard; the RoomHost stamps the
   *  process-side fields (uptime/tick timings/memory/expiry) on top. */
  adminInfo(): Pick<
    RoomAdminInfo,
    "mobs" | "npcs" | "drops" | "projectiles" | "blockEdits" | "timeOfDay" | "players" | "ents"
  > {
    let mobs = 0;
    let npcs = 0;
    let drops = 0;
    const ents: NonNullable<RoomAdminInfo["ents"]> = [];
    for (const e of this.entities.values()) {
      if (e.kind === "mob") mobs++;
      else if (e.kind === "npc") npcs++;
      else if (e.kind === "loot") drops++;
      if (e.kind !== "player") {
        ents.push({
          k: e.kind,
          x: Math.round(e.pos.x * 10) / 10,
          z: Math.round(e.pos.z * 10) / 10,
          n: e.renderable.name,
        });
      }
    }
    const players = [...this.sessions.values()].map((s) => ({
      charId: s.character.id,
      name: s.character.name,
      level: s.entity.level ?? 1,
      hp: Math.max(0, Math.ceil(s.entity.health?.hp ?? 0)),
      maxHp: s.entity.health?.maxHp ?? 0,
      gold: s.gold,
      x: Math.round(s.entity.pos.x * 10) / 10,
      y: Math.round(s.entity.pos.y * 10) / 10,
      z: Math.round(s.entity.pos.z * 10) / 10,
    }));
    return {
      mobs,
      npcs,
      drops,
      projectiles: this.projectiles.length,
      blockEdits: this.world.edits.size,
      timeOfDay: this.timeOfDay(),
      players,
      ents,
    };
  }

  /** Admin dashboard kick: evict a player by character id (same evict +
   *  immediate-remove sequence as duplicate-login handling). */
  adminKick(characterId: string, reason: string): boolean {
    const session = this.byCharacterId.get(characterId);
    if (!session) return false;
    this.log.info(`admin kick: ${session.character.name} (${reason})`);
    session.send({ t: "evict", reason });
    this.removePlayer(session);
    return true;
  }

  /** Admin dashboard teleport. Same room + coordinates = local snap (the
   *  /tp recipe: set pos, ground-snap, send a correct); another room =
   *  master-mediated transfer, landing at `x/z` if given, else the target's
   *  default spawn. */
  adminMove(characterId: string, targetRoomId: string, x?: number, z?: number): boolean {
    const session = this.byCharacterId.get(characterId);
    if (!session) return false;
    if (targetRoomId === this.def.id) {
      if (x === undefined || z === undefined) return false; // same-room needs a destination
      const tx = Math.min(Math.max(x, 0), this.def.size.w);
      const tz = Math.min(Math.max(z, 0), this.def.size.h);
      const e = session.entity;
      e.pos.x = tx;
      e.pos.z = tz;
      e.pos.y = this.world.standY(tx, tz);
      session.send({ t: "correct", seq: session.lastSeq, x: e.pos.x, y: e.pos.y, z: e.pos.z });
      this.system(session, "An admin moved you.");
      this.log.info(`admin teleport: ${session.character.name} -> (${tx.toFixed(1)}, ${tz.toFixed(1)})`);
      return true;
    }
    if (!this.onTransferRequest) return false;
    this.system(session, `An admin is sending you to ${targetRoomId}...`);
    this.log.info(`admin teleport: ${session.character.name} -> room ${targetRoomId}`);
    this.onTransferRequest(session, targetRoomId, x !== undefined && z !== undefined ? { x, z } : undefined);
    return true;
  }

  // ---------- players ----------

  /** Admit a ticketed character. Returns the session (already welcomed). */
  addPlayer(character: CharacterSnapshot, send: (msg: ServerToClient) => void): PlayerSession {
    const existing = this.byCharacterId.get(character.id);
    if (existing) {
      this.log.warn(`duplicate login for ${character.name}; evicting old session`);
      existing.send({ t: "evict", reason: "logged in elsewhere" });
      this.removePlayer(existing);
    }
    // snap to the voxel ground: persisted y may predate this room's world,
    // and paired-portal arrivals carry y=0 as a ground-snap sentinel.
    // walkYNear (not standY): roofed interiors stack walkable gaps — a
    // logout inside the keep must re-admit INSIDE, not on the ceiling.
    const groundY =
      character.y <= 0
        ? this.world.standY(character.x, character.z)
        : this.world.walkYNear(character.x, character.z, character.y);
    let spawnY =
      character.y <= 0 || Math.abs(character.y - groundY) > 2.5
        ? groundY
        : Math.max(character.y, groundY);
    // never admit embedded in solids (arrival next to a wall/arch whose
    // neighbouring columns overlap the AABB): climb to the first free gap
    const pr = this.consts.movement.playerRadius;
    const ph = this.consts.movement.playerHeight;
    for (let i = 0; i < 8 && this.world.collidesAABB(character.x, spawnY + 0.05, character.z, pr, ph - 0.1); i++) {
      spawnY += 1;
    }
    const level = Math.max(1, character.level);
    const prog = this.consts.progression;
    const maxHp = prog.baseHp + prog.hpPerLevel * (level - 1);
    const maxMana = prog.baseMana + prog.manaPerLevel * (level - 1);
    const entity: Entity = {
      id: allocEntityId(),
      kind: "player",
      pos: { x: character.x, y: spawnY, z: character.z, yaw: character.yaw },
      renderable: { sprite: "player", anim: "idle", name: character.name },
      level,
      health: { hp: maxHp, maxHp },
      mana: { mana: maxMana, maxMana },
      combat: freshCombat(),
    };
    // drop stacks whose item id no longer exists (e.g. retired registry items);
    // backfill stat/durability rolls onto instances minted before they existed
    const slots = normalizeInventory(character.inventory);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s && !this.reg.items[s.item]) slots[i] = null;
      else if (s) slots[i] = ensureItemInstance(this.reg, this.consts, s);
    }
    // equipment gets the same hygiene, plus a slot-validity check (an item
    // whose def changed slots since the logout lands back in the bags)
    const equipment = normalizeEquipment(character.equipment, EQUIP_SLOTS.length);
    for (let i = 0; i < equipment.length; i++) {
      const s = equipment[i];
      if (!s) continue;
      if (!this.reg.items[s.item] || this.slotIndexFor(this.reg.items[s.item]!) !== i) {
        equipment[i] = null;
        if (this.reg.items[s.item]) addItem(this.reg, slots, s);
        continue;
      }
      equipment[i] = ensureItemInstance(this.reg, this.consts, s);
    }
    const session: PlayerSession = {
      entity,
      character,
      lastSeq: 0,
      lastMoveAt: Date.now(),
      known: new Map(),
      snapCount: 0,
      transferring: false,
      pendingAttack: null,
      slots,
      held: 0,
      equipment,
      agg: EMPTY_AGG,
      lastEffectsSig: "",
      lastPitch: 0,
      xp: character.xp,
      gold: character.gold,
      dirtyStats: false,
      dirtyInv: false,
      lastSentHp: -1,
      lastSentMana: -1,
      send,
    };
    this.entities.set(entity.id, entity);
    this.sessions.set(entity.id, session);
    this.byCharacterId.set(character.id, session);
    // gear modifiers apply from the first packet: aggregate, size the vitals
    // to the modded maxes, and admit at full (existing behavior)
    this.recomputeAgg(session);
    this.recomputeVitals(session);
    entity.health!.hp = entity.health!.maxHp;
    entity.mana!.mana = entity.mana!.maxMana;

    const now = Date.now();
    const ents: EntityFull[] = [];
    for (const e of this.entities.values()) {
      if (e === entity) continue;
      if (this.inInterest(session, e)) {
        ents.push(toFull(e, now));
        session.known.set(e.id, replicatedState(e));
      }
    }
    send({
      t: "welcome",
      roomId: this.def.id,
      roomName: this.def.name, // display name — the HUD/minimap show this, never the id
      selfId: entity.id,
      name: character.name,
      sprite: entity.renderable.sprite, // client casts the local player's shadow with it
      spawn: { x: entity.pos.x, y: entity.pos.y, z: entity.pos.z, yaw: entity.pos.yaw },
      timeOfDay: this.timeOfDay(),
      ents,
      safeZone: this.def.flags.safeZone,
      regions: this.def.regions.map((r) => ({ x: r.x, z: r.z, r: r.r, pvp: r.pvp })),
      buildingEnabled: this.def.flags.buildingEnabled,
    });
    // ship the voxel world: header + deflated chunk batches
    const chunks = this.chunks();
    send({
      t: "world",
      w: this.def.size.w,
      h: this.def.size.h,
      height: WORLD_HEIGHT,
      waterLevel: this.waterLevel(),
      chunks: chunks.length,
      wind: this.def.wind,
      nightLight: this.def.nightLight,
    });
    for (let i = 0; i < chunks.length; i += CHUNKS_PER_MSG) {
      send({ t: "chunks", batch: chunks.slice(i, i + CHUNKS_PER_MSG) });
    }
    this.sendStats(session);
    this.sendInv(session);
    this.log.info(`${character.name} entered (${this.sessions.size} online)`);
    return session;
  }

  removePlayer(session: PlayerSession): void {
    if (!this.sessions.has(session.entity.id)) return;
    this.entities.delete(session.entity.id);
    this.sessions.delete(session.entity.id);
    this.byCharacterId.delete(session.character.id);
    this.log.info(`${session.character.name} left (${this.sessions.size} online)`);
  }

  // ---------- movement ----------

  /**
   * Validate a client move. The server is authoritative: bounds, terrain
   * height, speed, solids, action-FSM movement locks, and frost slows are
   * checked; a rejected move keeps the old position and returns a correction.
   */
  handleMove(session: PlayerSession, seq: number, x: number, y: number, z: number, yaw: number, anim: string, pitch = 0): void {
    if (seq <= session.lastSeq) return; // stale/duplicate
    session.lastSeq = seq;
    session.lastPitch = pitch;
    const now = Date.now();
    const dt = Math.min((now - session.lastMoveAt) / 1000, 1.0);
    const p = session.entity.pos;
    const c = session.entity.combat!;

    const reject = () => session.send({ t: "correct", seq, x: p.x, y: p.y, z: p.z });

    // dead players and cast-locked states don't move (yaw may still turn)
    const ability = c.ability ? (this.reg.abilities[c.ability] ?? null) : null;
    const dx = x - p.x;
    const dz = z - p.z;
    const horiz = Math.hypot(dx, dz);
    if (isMovementLocked(c, ability) && horiz > 0.01) {
      reject();
      return;
    }

    // slow (shared helper — mob tick uses the same one) × gear speed mods;
    // agg.speedMult is the SAME capped value the effects message ships, so
    // client prediction and this envelope can never disagree
    let walkSpeed = this.consts.movement.walkSpeed * slowMult(c, now) * session.agg.speedMult;
    const tol = this.consts.net.moveToleranceM;
    const maxDist = walkSpeed * dt * SPEED_GRACE + tol;

    const r = this.consts.movement.playerRadius;
    const inBounds =
      x >= r && x <= this.def.size.w - r && z >= r && z <= this.def.size.h - r && y >= 0 && y <= WORLD_HEIGHT;
    // y must track the ground under the feet: within jump height above it,
    // except while swimming (deep water) or descending (falls of any depth)
    const ground = this.world.groundBelow(x, y + 0.05, z, r);
    const inWater = this.world.liquidAt(x, y + 0.4, z) || this.world.liquidAt(x, y + 1.0, z);
    const descending = y <= p.y + 0.001;
    // climbing out of deep water: while you heave up over a bank you rise ABOVE
    // the surface (no longer `inWater`) but you're still over the pond, so
    // `ground` is the distant pond floor and `y` blows past ground+tolerance —
    // the exact case that rubber-banded a swim climb-out in water 2+ deep. Allow
    // it as long as there's still liquid in the column just under the feet: you
    // are getting OUT of the water, not hovering over dry land. Bounded to ~2
    // blocks above the surface (liquid must be within y-2), and it ends the
    // instant you step forward over the bank, where the normal ground check
    // takes back over.
    const climbingOutOfWater = this.world.liquidAt(x, y - 1.0, z) || this.world.liquidAt(x, y - 2.0, z);
    const terrainOk =
      y >= ground - 0.6 &&
      (y <= ground + this.consts.world.terrainYToleranceM || inWater || climbingOutOfWater || descending);
    // ascent cap: no legit move climbs more than a jump-arc slice per packet
    // (kills single-packet wall hops that would otherwise pass groundBelow)
    const ascentOk = y - p.y <= 1.5;
    const speedOk = horiz <= maxDist;
    // the player AABB must not intersect solid blocks
    const solidOk = !this.world.collidesAABB(x, y + 0.05, z, r, this.consts.movement.playerHeight - 0.1);

    if (!inBounds || !terrainOk || !ascentOk || !speedOk || !solidOk) {
      reject();
      return;
    }
    // smoothed horizontal velocity (predictive boss projectiles lead it) —
    // EMA over accepted packets; decays naturally when packets stop moving
    if (dt > 0.005) {
      const a = 0.5;
      const e = session.entity;
      e.velX = (e.velX ?? 0) * (1 - a) + (dx / dt) * a;
      e.velZ = (e.velZ ?? 0) * (1 - a) + (dz / dt) * a;
      e.lastMoveAt = now;
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
    if (session.entity.combat!.act === "dead") return null;
    if (this.eventSealed.has(portal.id)) {
      this.system(session, `The way to ${portal.label} is sealed while its guardian lives.`);
      return null;
    }
    if (this.roomStatus.get(portal.target) === false) {
      this.system(session, `The ${portal.label} portal is sealed right now.`);
      return null;
    }
    const d = Math.hypot(session.entity.pos.x - portal.x, session.entity.pos.z - portal.z);
    return d <= portal.r + 1.0 ? portal : null;
  }

  // ---------- combat ----------

  /**
   * Player pressed attack: use the held item's ability, aimed by camera.
   * Two layers defend against silent whiffs (client animates, server drops):
   * the body FSM is caught up to the packet's arrival (it otherwise only
   * steps at tick rate, so a click just after recover's end was judged
   * against a stale state), and a still-blocked click is buffered briefly
   * and retried from tick() instead of vanishing.
   */
  handleAttack(session: PlayerSession, aimYaw: number, aimPitch: number): void {
    const e = session.entity;
    if (e.combat!.act === "dead") return;
    const now = Date.now();
    this.advanceCombat(e, now);
    if (this.tryHeldAbility(session, aimYaw, aimPitch, now)) {
      session.pendingAttack = null;
    } else {
      session.pendingAttack = { aimYaw, aimPitch, until: now + this.consts.combat.attackBufferMs };
    }
  }

  /** Start the held item's ability. Returns false only for blocks worth
   *  buffering (body busy / cooldown / mana); no-op inputs return true. */
  private tryHeldAbility(session: PlayerSession, aimYaw: number, aimPitch: number, now: number): boolean {
    const e = session.entity;
    if (e.combat!.act === "dead") return true;
    const held = session.slots[session.held];
    let abilityId = "punch";
    let base = 0;
    let speedMult = 1;
    let heldDef: ItemDef | null = null;
    if (held) {
      const def = this.reg.items[held.item];
      if (!def || def.kind !== "weapon" || !def.ability) return true; // held a non-weapon: no-op
      heldDef = def;
      abilityId = def.ability;
      const rarity = this.reg.rarities[held.rarity]?.mult ?? 1;
      base = (def.damage ?? 0) * rarity * (held.stats?.dmg ?? 1);
      speedMult = held.stats?.spd ?? 1;
    }
    const ability = this.reg.abilities[abilityId];
    if (!ability) return true;
    if (base === 0) base = ability.damage ?? 2;
    // gear modifiers: outgoing damage (Ferocity — trinket dmgPct boosts even
    // bare fists) and attack speed (leaden curses drag every FSM timing)
    base *= 1 + (session.agg.byStat["dmgPct"] ?? 0);
    speedMult *= Math.max(0.25, 1 + (session.agg.byStat["atkSpeedPct"] ?? 0));
    const levelMult = 1 + this.consts.progression.damagePerLevelPct * ((e.level ?? 1) - 1);
    const started = startAbility(e, abilityId, ability, base * levelMult, aimYaw, aimPitch, now, speedMult);
    // weapons wear one durability point per use (bare hands never do)
    if (started && held && heldDef && held.maxDur !== undefined) this.wearHeldItem(session, held, heldDef);
    return started;
  }

  /** Every worn piece with durability loses 1 per physical hit taken; at
   *  zero it shatters (destroyed, not dropped) and the aggregate updates
   *  mid-fight. Trinkets carry no durability and never wear. */
  private wearEquippedArmor(session: PlayerSession): void {
    let broke = false;
    let changed = false;
    for (let i = 0; i < session.equipment.length; i++) {
      const s = session.equipment[i];
      if (!s || s.maxDur === undefined) continue;
      s.dur = (s.dur ?? s.maxDur) - 1;
      changed = true;
      if (s.dur <= 0) {
        const def = this.reg.items[s.item];
        session.equipment[i] = null;
        this.system(session, `Your ${def?.name ?? s.item} shattered!`);
        broke = true;
      }
    }
    if (broke) this.touchInv(session);
    else if (changed) session.dirtyInv = true;
  }

  /** Durability tick: at zero the weapon breaks and the slot empties. */
  private wearHeldItem(session: PlayerSession, stack: ItemStack, def: ItemDef): void {
    stack.dur = (stack.dur ?? stack.maxDur ?? 1) - 1;
    if (stack.dur <= 0) {
      session.slots[session.held] = null;
      this.system(session, `Your ${def.name} broke!`);
    }
    this.touchInv(session);
  }

  /** A mob's attack kit resolved against the ability registry, at the level it
   *  spawned with (level-gated ranks may have added or swapped options). */
  private attackOptionsOf(r: ResolvedMob): AttackOption[] {
    const out: AttackOption[] = [];
    for (const a of r.attacks) {
      const ability = this.reg.abilities[a.ability];
      if (!ability) continue;
      out.push({ id: a.ability, ability, damage: a.damage ?? r.damage, minRange: a.minRange ?? 0, weight: a.weight });
    }
    return out;
  }

  /** Is `e` a packmate of `caster`? Same spawner (the same camp / den / spawn
   *  table), or one summoned the other. Without this an allyHeal mends whatever
   *  happens to be standing nearby — a Forge-Tender healing the ash husks that
   *  wandered past her is not a pack healer, it is two spawn tables becoming one
   *  fight. Command-spawned mobs all share spawnerId "" and so heal each other,
   *  which is what staging scripts want. */
  private samePack(caster: Entity, e: Entity): boolean {
    const a = caster.brain, b = e.brain;
    if (!a || !b) return false;
    if (e.id === caster.id) return true;
    if (b.summonerId === caster.id || a.summonerId === e.id) return true;
    if (a.summonerId !== undefined && a.summonerId === b.summonerId) return true;
    return a.spawnerId === b.spawnerId;
  }

  /** Living packmates an allyHeal from `caster` would touch (caster included per spec). */
  private healableAllies(caster: Entity, spec: NonNullable<AbilityDef["allyHeal"]>): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities.values()) {
      if (e.kind !== "mob" || !e.health || e.combat?.act === "dead") continue;
      if (e.id === caster.id && !spec.includeSelf) continue;
      if (!this.samePack(caster, e)) continue;
      if (Math.hypot(e.pos.x - caster.pos.x, e.pos.z - caster.pos.z) > spec.radius) continue;
      out.push(e);
    }
    return out;
  }

  /** Mob brain wants to attack: pick a usable option from the mob's kit
   *  (range windows, cooldowns, melee vertical gate — weighted when several
   *  qualify) and start it on the shared FSM. "close" tells the caller
   *  nothing connects from this distance (dead band between melee reach and
   *  a bow's minRange, target up a ledge, reloading while a melee option
   *  exists) — the tick advances the mob instead. */
  private mobAttack(mob: Entity, target: Entity, now: number): "started" | "wait" | "close" {
    const def = this.reg.mobs[mob.brain!.mobId];
    if (!def) return "wait";
    const resolved = resolveMob(def, mob.brain!.spawnLevel, this.consts.mobs.scaling);
    let options = this.attackOptionsOf(resolved);
    if (options.some((o) => o.ability.summon)) {
      // summon options drop out of the kit while the summoner sits at cap
      const minions = this.minionCountOf(mob);
      options = options.filter((o) => !o.ability.summon || minions < o.ability.summon.cap);
    }
    if (options.some((o) => o.ability.allyHeal)) {
      // a healer only offers its mend while something nearby is actually hurt —
      // chooseAttack treats every "self" ability as always in range, so without
      // this gate a healer would stand at full health casting into the void
      options = options.filter((o) => {
        const spec = o.ability.allyHeal;
        if (!spec) return true;
        return this.healableAllies(mob, spec).some((a) => a.health!.hp < a.health!.maxHp * spec.castIfAllyBelowPct);
      });
    }
    const choice = chooseAttack(
      mob,
      target,
      options,
      now,
      resolved.attackRange,
      this.consts.combat.meleeRangeGrace,
      this.consts.combat.meleeVerticalReach
    );
    if (choice.kind !== "use") return choice.kind;
    const { option } = choice;
    const dx = target.pos.x - mob.pos.x;
    const dz = target.pos.z - mob.pos.z;
    const aimYaw = Math.atan2(dx, dz);
    // ranged mobs aim the muzzle (~eye 1.45) at the target's chest (~1.0)
    // so bolts connect up and down slopes; melee ignores pitch entirely
    let aimPitch = 0;
    if (option.ability.kind === "projectile") {
      aimPitch = Math.atan2(target.pos.y + 1.0 - (mob.pos.y + 1.45), Math.max(0.1, Math.hypot(dx, dz)));
    }
    mob.combat!.lastTargetId = target.id; // predictive release re-aims here
    return startAbility(mob, option.id, option.ability, option.damage, aimYaw, aimPitch, now) ? "started" : "wait";
  }

  /** Tracked horizontal velocity for prediction — zero once move packets go
   *  quiet, clamped so a burst packet can't fake super-speed. */
  private velocityOf(e: Entity, now: number): { x: number; z: number } {
    if (!e.lastMoveAt || now - e.lastMoveAt > 400) return { x: 0, z: 0 };
    let vx = e.velX ?? 0;
    let vz = e.velZ ?? 0;
    const mag = Math.hypot(vx, vz);
    const cap = this.consts.movement.walkSpeed * 1.2;
    if (mag > cap) {
      vx = (vx / mag) * cap;
      vz = (vz / mag) * cap;
    }
    return { x: vx, z: vz };
  }

  /** Two-pass linear intercept: where to aim so a projectile at `speed`
   *  meets the target's current velocity. */
  private interceptPoint(from: Entity, tgt: Entity, speed: number, now: number): { x: number; z: number } {
    const vel = this.velocityOf(tgt, now);
    let tHit = Math.hypot(tgt.pos.x - from.pos.x, tgt.pos.z - from.pos.z) / Math.max(1, speed);
    for (let i = 0; i < 2; i++) {
      const px = tgt.pos.x + vel.x * tHit;
      const pz = tgt.pos.z + vel.z * tHit;
      tHit = Math.hypot(px - from.pos.x, pz - from.pos.z) / Math.max(1, speed);
    }
    return { x: tgt.pos.x + vel.x * tHit, z: tgt.pos.z + vel.z * tHit };
  }

  private resolveMeleeHit(attacker: Entity, ability: AbilityDef): void {
    const range = ability.range ?? 2;
    const arc = ability.arcDeg ?? 90;
    for (const target of this.targetsOf(attacker)) {
      if (inMeleeCone(attacker, target, range, arc, this.consts.combat.meleeRangeGrace, this.consts.combat.meleeVerticalReach)) {
        this.applyDamage(attacker, target, attacker.combat!.pendingDamage, abilityDmgClass(ability) ?? "melee");
        // melee on-hit debuffs (spider venom, envenomed daggers)
        if (ability.debuff) this.applyDebuff(target, ability.debuff, attacker);
      }
    }
  }

  /** Which entities this attacker can damage. Player-vs-player needs BOTH
   *  inside a PvP zone (room flag or flagged region). */
  private targetsOf(attacker: Entity): Entity[] {
    const out: Entity[] = [];
    const attackerInPvp =
      attacker.kind === "player" ? this.inPvpZone(attacker.pos.x, attacker.pos.z) : false;
    for (const e of this.entities.values()) {
      if (e === attacker || !e.health || e.combat?.act === "dead") continue;
      if (attacker.kind === "player") {
        if (e.kind === "mob") out.push(e);
        else if (e.kind === "player" && attackerInPvp && this.inPvpZone(e.pos.x, e.pos.z)) out.push(e);
      } else if (attacker.kind === "mob" && e.kind === "player") {
        out.push(e);
      }
    }
    return out;
  }

  private releaseAbility(e: Entity, ability: AbilityDef, now: number): void {
    switch (ability.kind) {
      case "projectile": {
        // predictive mob projectiles re-aim at RELEASE toward the intercept
        // point (the telegraph is still dodgeable — juke AFTER the release;
        // running in a straight line is exactly what gets punished)
        if (ability.predictive && e.kind === "mob" && e.combat!.lastTargetId !== undefined) {
          const tgt = this.entities.get(e.combat!.lastTargetId);
          if (tgt && tgt.combat?.act !== "dead") {
            const speed = ability.projSpeed ?? 20;
            const aim = this.interceptPoint(e, tgt, speed, now);
            const dx = aim.x - e.pos.x;
            const dz = aim.z - e.pos.z;
            e.combat!.aimYaw = Math.atan2(dx, dz);
            e.combat!.aimPitch = Math.atan2(
              tgt.pos.y + 1.0 - (e.pos.y + 1.45),
              Math.max(0.1, Math.hypot(dx, dz))
            );
          }
        }
        const proj = makeProjectile(e, ability, e.combat!.pendingDamage, now);
        this.projectiles.push(proj);
        this.broadcastNear(proj.x, proj.z, {
          t: "proj",
          id: proj.id,
          fx: proj.fx,
          x: proj.x,
          y: proj.y,
          z: proj.z,
          vx: proj.vx,
          vy: proj.vy,
          vz: proj.vz,
          ttlMs: proj.dieAt - now,
          ...(proj.scale !== 1 ? { scale: proj.scale } : {}),
          ...(proj.impactFx ? { impactFx: proj.impactFx } : {}),
        });
        break;
      }
      case "pillars": {
        const spec = ability.pillars;
        if (!spec) break;
        // the line marches from just ahead of the caster THROUGH the target's
        // predicted position (mid-march lead) — side-stepping dodges it,
        // straight-line kiting runs INTO the later pillars
        let dirYaw = e.combat!.aimYaw;
        const tgt = e.combat!.lastTargetId !== undefined ? this.entities.get(e.combat!.lastTargetId) : undefined;
        if (tgt && tgt.combat?.act !== "dead") {
          const lead = ((spec.count / 2) * spec.staggerMs) / 1000;
          const vel = this.velocityOf(tgt, now);
          const px = tgt.pos.x + vel.x * lead;
          const pz = tgt.pos.z + vel.z * lead;
          dirYaw = Math.atan2(px - e.pos.x, pz - e.pos.z);
        }
        const dirX = Math.sin(dirYaw);
        const dirZ = Math.cos(dirYaw);
        const list: Array<{ x: number; y: number; z: number; delayMs: number }> = [];
        for (let i = 0; i < spec.count; i++) {
          const x = e.pos.x + dirX * (2 + i * spec.spacing);
          const z = e.pos.z + dirZ * (2 + i * spec.spacing);
          if (x < 1 || x > this.def.size.w - 1 || z < 1 || z > this.def.size.h - 1) continue;
          const y = this.world.floorY(x, z);
          const delayMs = 350 + i * spec.staggerMs; // telegraph before ignite
          list.push({ x, y, z, delayMs });
          this.firePillars.push({
            x,
            y,
            z,
            igniteAt: now + delayMs,
            windowEndsAt: now + delayMs + Math.min(spec.burnMs, 900),
            ownerId: e.id,
            damage: e.combat!.pendingDamage,
            radius: spec.radius,
            hitIds: new Set(),
          });
        }
        if (list.length > 0) {
          this.broadcastNear(e.pos.x, e.pos.z, { t: "pillars", list, burnMs: spec.burnMs, radius: spec.radius });
        }
        break;
      }
      case "self": {
        if (ability.heal && e.health) {
          const amount = Math.min(ability.heal, e.health.maxHp - e.health.hp);
          e.health.hp += amount;
          this.markStatsDirty(e);
          this.broadcastEvent({ kind: "heal", tgt: e.id, amount: Math.round(amount) }, e.pos.x, e.pos.z);
        }
        // pack healer: mend every living mob in the radius. Rides the existing
        // "heal" event, so the client already draws a green floater per target.
        if (ability.allyHeal && e.kind === "mob") {
          const spec = ability.allyHeal;
          for (const ally of this.healableAllies(e, spec)) {
            const amount = Math.min(spec.amount, ally.health!.maxHp - ally.health!.hp);
            if (amount <= 0) continue;
            ally.health!.hp += amount;
            this.markStatsDirty(ally);
            this.broadcastEvent({ kind: "heal", tgt: ally.id, amount: Math.round(amount) }, ally.pos.x, ally.pos.z);
          }
          if (spec.text) this.broadcastNear(e.pos.x, e.pos.z, { t: "chat", channel: "system", from: "", text: spec.text });
        }
        // boss summons: top the summoner's minions up to the cap
        if (ability.summon && e.kind === "mob") {
          const spec = ability.summon;
          const room = Math.max(0, spec.cap - this.minionCountOf(e));
          if (room > 0) {
            this.summonWave(e, spec.mob, Math.min(spec.count, room), spec.radius, spec.text, {
              xp: spec.grantsXp,
              loot: spec.grantsLoot,
            });
            // clients cue the war-horn off this
            this.broadcastEvent({ kind: "summon", id: e.id }, e.pos.x, e.pos.z);
          }
        }
        break;
      }
      case "melee":
        break; // handled by melee-hit fire
    }
  }

  /** All damage funnels through here: crits, defensive modifiers + armor
   *  mitigation (players only), interrupts, threat, death, and on-hit hooks
   *  (armor wear, thorns, lifesteal). cls routes the defenses: melee/ranged
   *  are mitigated by armor, magic only by its taken-modifier, "true"
   *  (thorns reflects, scripted damage) bypasses everything. DoT bites never
   *  enter here (applyDotDamage is its own path — poison ignores armor). */
  applyDamage(
    src: Entity,
    tgt: Entity,
    base: number,
    cls: "melee" | "ranged" | "magic" | "true" = "true",
    opts?: { noReflect?: boolean }
  ): void {
    if (!tgt.health || tgt.combat?.act === "dead") return;
    const now = Date.now();
    const crit = Math.random() < this.consts.combat.critChance;
    let raw = base * (crit ? this.consts.combat.critMult : 1);
    const tgtSession = tgt.kind === "player" ? this.sessions.get(tgt.id) : undefined;
    if (tgtSession && cls !== "true") {
      // taken-modifiers: per-class reduction + takenAll (brittle is negative
      // takenAll = MORE damage). Combined clamp so two stacked stats can't
      // reach immunity together.
      const st = tgtSession.agg.byStat;
      const cap = this.consts.items.mods.caps["takenAllPct"] ?? 0.6;
      const taken = Math.max(-cap, Math.min(cap, (st[`${cls}TakenPct`] ?? 0) + (st["takenAllPct"] ?? 0)));
      raw *= 1 - taken;
      // armor value: diminishing physical mitigation; magic sails through
      if ((cls === "melee" || cls === "ranged") && tgtSession.agg.armor > 0) {
        const a = tgtSession.agg.armor;
        raw *= 1 - a / (a + this.consts.combat.armorK);
      }
    }
    const amount = Math.max(1, Math.round(raw));
    tgt.health.hp -= amount;
    tgt.combat!.lastDamagedAt = now;
    this.broadcastEvent({ kind: "dmg", src: src.id, tgt: tgt.id, amount, crit }, tgt.pos.x, tgt.pos.z);

    // on-hit hooks: armor wears on physical hits taken; thorns reflects
    // melee as "true" damage (noReflect stops recursion at depth 1);
    // lifesteal feeds players on mob damage they deal
    if (tgtSession && (cls === "melee" || cls === "ranged")) this.wearEquippedArmor(tgtSession);
    if (tgtSession && cls === "melee" && !opts?.noReflect) {
      const thorns = tgtSession.agg.byStat["thorns"] ?? 0;
      if (thorns > 0 && src.health && src.combat?.act !== "dead") {
        this.applyDamage(tgt, src, thorns, "true", { noReflect: true });
      }
    }
    if (src.kind === "player" && tgt.kind === "mob" && cls !== "true") {
      const srcSession = this.sessions.get(src.id);
      const lifesteal = srcSession?.agg.byStat["lifesteal"] ?? 0;
      if (srcSession && lifesteal > 0 && src.health && src.combat?.act !== "dead" && src.health.hp < src.health.maxHp) {
        src.health.hp = Math.min(src.health.maxHp, src.health.hp + amount * lifesteal);
        this.markStatsDirty(src);
      }
    }

    // interrupts break interruptible windups/casts into stagger
    const tgtAbility = tgt.combat!.ability ? (this.reg.abilities[tgt.combat!.ability] ?? null) : null;
    if (interruptIfCasting(tgt, tgtAbility, this.consts.combat.staggerMs, now)) {
      this.broadcastEvent({ kind: "stagger", id: tgt.id }, tgt.pos.x, tgt.pos.z);
    }

    if (tgt.kind === "mob") {
      // threat + damage log (XP/loot ownership) + pack aggro
      const srcSession = this.sessions.get(src.id);
      if (srcSession) {
        const log = this.damageLog.get(tgt.id) ?? new Map<string, number>();
        log.set(srcSession.character.id, (log.get(srcSession.character.id) ?? 0) + amount);
        this.damageLog.set(tgt.id, log);
      }
      tgt.brain!.threat.set(src.id, (tgt.brain!.threat.get(src.id) ?? 0) + amount);
      for (const other of this.entities.values()) {
        if (other.kind !== "mob" || other === tgt || other.brain!.spawnerId !== tgt.brain!.spawnerId) continue;
        if (Math.hypot(other.pos.x - tgt.pos.x, other.pos.z - tgt.pos.z) <= PACK_AGGRO_RADIUS) {
          other.brain!.threat.set(src.id, (other.brain!.threat.get(src.id) ?? 0) + 1);
        }
      }
      this.checkHpEvents(tgt);
    }
    this.markStatsDirty(tgt);
    if (tgt.health.hp <= 0) this.kill(tgt, src);
  }

  /** Apply an on-hit debuff: frost-style slow and/or poison-style DoT.
   *  DoT damage is attributed to src (threat/XP credit via applyDotDamage);
   *  reapplication refreshes rate + clock. Only slows go on the wire — DoT
   *  feedback is the damage events its bites broadcast. */
  applyDebuff(tgt: Entity, debuff: { slowPct?: number; dotTotal?: number; durMs: number }, src: Entity): void {
    const c = tgt.combat;
    if (!c || c.act === "dead") return;
    const now = Date.now();
    if (debuff.slowPct !== undefined && debuff.slowPct > 0) {
      c.slowPct = Math.max(c.slowPct > 0 && c.slowUntil > now ? c.slowPct : 0, debuff.slowPct);
      c.slowUntil = now + debuff.durMs;
      this.broadcastNear(tgt.pos.x, tgt.pos.z, { t: "debuff", id: tgt.id, slowPct: debuff.slowPct, durMs: debuff.durMs });
    }
    if (debuff.dotTotal !== undefined && debuff.dotTotal > 0) {
      c.dotPerSec = debuff.dotTotal / (debuff.durMs / 1000);
      c.dotUntil = now + debuff.durMs;
      c.dotSrcId = src.id;
    }
  }

  /** One DoT bite: normal damage path minus crits/interrupts (a poison tick
   *  interrupting every cast for its whole duration would be a stunlock).
   *  Threat + damage-log credit go to the applier when it still exists. */
  private applyDotDamage(tgt: Entity, amount: number): void {
    if (!tgt.health || tgt.combat?.act === "dead") return;
    const now = Date.now();
    const src = this.entities.get(tgt.combat!.dotSrcId) ?? tgt;
    tgt.health.hp -= amount;
    tgt.combat!.lastDamagedAt = now;
    this.broadcastEvent({ kind: "dmg", src: src.id, tgt: tgt.id, amount, crit: false }, tgt.pos.x, tgt.pos.z);
    if (tgt.kind === "mob" && src !== tgt) {
      const srcSession = this.sessions.get(src.id);
      if (srcSession) {
        const log = this.damageLog.get(tgt.id) ?? new Map<string, number>();
        log.set(srcSession.character.id, (log.get(srcSession.character.id) ?? 0) + amount);
        this.damageLog.set(tgt.id, log);
      }
      tgt.brain!.threat.set(src.id, (tgt.brain!.threat.get(src.id) ?? 0) + amount);
    }
    if (tgt.kind === "mob") this.checkHpEvents(tgt);
    this.markStatsDirty(tgt);
    if (tgt.health.hp <= 0) this.kill(tgt, src);
  }

  private kill(tgt: Entity, by: Entity): void {
    const now = Date.now();
    tgt.health!.hp = 0;
    tgt.combat!.act = "dead";
    tgt.combat!.actEndsAt = 0;
    tgt.combat!.ability = null;
    this.broadcastEvent({ kind: "death", id: tgt.id, by: by.id }, tgt.pos.x, tgt.pos.z);

    if (tgt.kind === "mob") {
      const mobDef = this.reg.mobs[tgt.brain!.mobId];
      // XP to the top damage dealer still in the room
      const log = this.damageLog.get(tgt.id);
      if (mobDef && log) {
        let topChar: string | null = null;
        let topDmg = -1;
        for (const [charId, dmg] of log) {
          if (dmg > topDmg) {
            topDmg = dmg;
            topChar = charId;
          }
        }
        const winner = topChar ? this.byCharacterId.get(topChar) : undefined;
        // a mob reused above its base level is worth proportionally more xp;
        // a summoned minion may be worth none at all (splitters)
        if (winner && (tgt.brain?.grantsXp ?? true)) this.awardXp(winner, this.resolvedMobOf(tgt)?.xp ?? mobDef.xp);
        // loot: owner-locked to the top damage dealer for a grace window.
        // Resolved at the SPAWN level — a rank may re-point the table (the
        // Unfinished King's boss bounty never leaks to base-level prototypes).
        const rolled = (tgt.brain?.grantsLoot ?? true)
          ? rollLoot(this.reg, this.consts, this.resolvedMobOf(tgt)?.loot ?? mobDef.loot)
          : { items: [], gold: 0 };
        if (rolled.items.length > 0 || rolled.gold > 0) {
          this.spawnLootBag(
            tgt.pos.x,
            tgt.pos.z,
            rolled.items,
            rolled.gold,
            topChar,
            now + this.consts.combat.lootLockMobMs,
            now + this.consts.combat.mobLootExpireMs,
            this.dropY(tgt.pos.x, tgt.pos.z, tgt.pos.y)
          );
        }
      }
      this.damageLog.delete(tgt.id);
      // schedule respawn + corpse removal
      const table = this.liveTables.find((t) => t.id === tgt.brain!.spawnerId);
      const spawner = this.spawners.get(tgt.brain!.spawnerId);
      if (table && spawner) {
        spawner.alive.delete(tgt.id);
        spawner.respawnAts.push(now + table.respawnSec * 1000);
      }
      this.pendingRemovals.push({ id: tgt.id, at: now + CORPSE_LINGER_MS });
      // entity-linked events (boss gates opening, collapse timers, rallies)
      for (const ev of this.def.events) {
        if (ev.on.kind === "bossDeath" && ev.on.mob === tgt.brain!.mobId) this.runEventActions(ev, tgt);
      }
    } else if (tgt.kind === "player") {
      const session = this.sessions.get(tgt.id);
      if (session) this.dropPlayerInventory(session);
    }
  }

  /** Death drops: the entire inventory (and, by default, worn equipment —
   *  combat.deathDropsEquipment) becomes a bag at the death spot. */
  private dropPlayerInventory(session: PlayerSession): void {
    const now = Date.now();
    const items = session.slots.filter((s): s is ItemStack => s !== null);
    if (this.consts.combat.deathDropsEquipment) {
      items.push(...session.equipment.filter((s): s is ItemStack => s !== null));
      session.equipment = normalizeEquipment([], EQUIP_SLOTS.length);
    }
    if (items.length > 0) {
      // owner-locked corpse-run head start outside PvP zones; FFA inside
      const diedInPvp = this.inPvpZone(session.entity.pos.x, session.entity.pos.z);
      const lockMs = diedInPvp ? 0 : this.consts.combat.lootLockDeathMs;
      this.spawnLootBag(
        session.entity.pos.x,
        session.entity.pos.z,
        items,
        0,
        diedInPvp ? null : session.character.id,
        now + lockMs,
        null, // death bags persist
        this.dropY(session.entity.pos.x, session.entity.pos.z, session.entity.pos.y)
      );
    }
    session.slots = normalizeInventory([]);
    this.touchInv(session);
    session.send({ t: "died", x: session.entity.pos.x, y: session.entity.pos.y, z: session.entity.pos.z });
    this.log.info(`${session.character.name} died (dropped ${items.length} stacks)`);
  }

  handleRespawn(session: PlayerSession): void {
    const e = session.entity;
    if (e.combat!.act !== "dead") return;
    // death away from home sends you back to the hub: same transfer machinery
    // as portals (no viaPortalId → hub default spawn). The patch's inventory
    // is already empty (death dropped it) and hp isn't part of patches —
    // addPlayer always admits at full hp/mana, so arrival revives.
    if (this.def.id !== "hub" && this.onTransferRequest) {
      this.onTransferRequest(session, "hub");
      return;
    }
    const { spawn } = this.def;
    e.pos.x = spawn.x;
    e.pos.z = spawn.z;
    e.pos.y = this.world.standY(spawn.x, spawn.z);
    e.pos.yaw = spawn.yaw;
    e.combat!.act = "idle";
    e.combat!.actEndsAt = 0;
    e.combat!.slowPct = 0;
    e.health!.hp = e.health!.maxHp;
    if (e.mana) e.mana.mana = e.mana.maxMana;
    session.dirtyStats = true;
    // the client reconciles against this like any rejected move
    session.send({ t: "correct", seq: session.lastSeq, x: e.pos.x, y: e.pos.y, z: e.pos.z });
  }

  /** H key: hub-bound transfer from anywhere. Dead players use R instead;
   *  in the hub it's just a chat line. The RoomHost's requestTransfer
   *  ignores sessions already transferring. */
  handleReturnToHub(session: PlayerSession): void {
    if (session.entity.combat!.act === "dead") return;
    if (this.def.id === "hub") {
      this.system(session, "You are already in the hub.");
      return;
    }
    this.onTransferRequest?.(session, "hub");
  }

  private awardXp(session: PlayerSession, amount: number): void {
    const prog = this.consts.progression;
    const e = session.entity;
    session.xp += amount;
    session.send({ t: "evt", e: { kind: "xp", amount } });
    let level = e.level ?? 1;
    while (level < prog.maxLevel && session.xp >= this.xpNext(level)) {
      session.xp -= this.xpNext(level);
      level++;
      e.level = level;
      // one formula home: base + level + gear mods, then the level-up
      // full heal fills to the MODDED max
      this.recomputeVitals(session);
      e.health!.hp = e.health!.maxHp;
      e.mana!.mana = e.mana!.maxMana;
      this.broadcastEvent({ kind: "levelup", id: e.id, level }, e.pos.x, e.pos.z);
      this.log.info(`${session.character.name} reached level ${level}`);
    }
    session.dirtyStats = true;
  }

  xpNext(level: number): number {
    const prog = this.consts.progression;
    return Math.round(prog.xpBase * Math.pow(level, prog.xpExponent));
  }

  // ---------- inventory / items ----------

  private sendStats(session: PlayerSession): void {
    const e = session.entity;
    session.lastSentHp = Math.ceil(e.health!.hp);
    session.lastSentMana = Math.floor(e.mana!.mana);
    session.send({
      t: "stats",
      hp: Math.ceil(e.health!.hp),
      maxHp: e.health!.maxHp,
      mana: Math.floor(e.mana!.mana),
      maxMana: e.mana!.maxMana,
      xp: session.xp,
      xpNext: this.xpNext(e.level ?? 1),
      level: e.level ?? 1,
      gold: session.gold,
    });
    session.dirtyStats = false;
  }

  private sendInv(session: PlayerSession): void {
    session.send({ t: "inv", slots: session.slots, held: session.held, equipment: session.equipment });
    session.dirtyInv = false;
  }

  /** Self status-effect sync: aggregated gear modifiers (persistent) +
   *  timed slow/dot/hot with REMAINING durations. A signature comparison
   *  makes this send-on-change only — a fresh session's "" signature always
   *  differs, so the first tick after welcome ships the initial state.
   *  Duration ends are bucketed (500 ms) so a refreshed debuff re-sends. */
  private tickEffects(session: PlayerSession, now: number): void {
    const c = session.entity.combat!;
    const list: EffectWire[] = [];
    const parts: string[] = [];
    for (const [id, mag] of Object.entries(session.agg.modTotals)) {
      const def = this.reg.modifiers[id];
      if (!def) continue;
      const rounded = Math.round(mag * 1000) / 1000;
      list.push({ kind: "mod", id, mag: rounded, curse: def.curse });
      parts.push(`${id}:${rounded}`);
    }
    if (c.slowUntil > now && c.slowPct > 0) {
      list.push({ kind: "slow", mag: c.slowPct, durMs: c.slowUntil - now });
      parts.push(`slow:${c.slowPct}:${Math.ceil(c.slowUntil / 500)}`);
    }
    if (c.dotUntil > now) {
      list.push({ kind: "dot", mag: c.dotPerSec, durMs: c.dotUntil - now });
      parts.push(`dot:${c.dotPerSec}:${Math.ceil(c.dotUntil / 500)}`);
    }
    if (c.hotUntil > now) {
      list.push({ kind: "hot", item: c.hotItemId ?? "bread", mag: c.hotPerSec, durMs: c.hotUntil - now });
      parts.push(`hot:${c.hotItemId}:${Math.ceil(c.hotUntil / 500)}`);
    }
    const speedMult = Math.round(session.agg.speedMult * 1000) / 1000;
    const sig = `${speedMult}|${parts.join(",")}`;
    if (sig !== session.lastEffectsSig) {
      session.lastEffectsSig = sig;
      session.send({ t: "effects", speedMult, list });
    }
  }

  private markStatsDirty(e: Entity): void {
    const s = this.sessions.get(e.id);
    if (s) s.dirtyStats = true;
  }

  system(session: PlayerSession, text: string): void {
    session.send({ t: "chat", channel: "system", from: "", text });
  }

  systemAll(text: string): void {
    for (const s of this.sessions.values()) this.system(s, text);
  }

  /** Every inventory/equipment mutation funnels through here: replicate,
   *  re-aggregate modifiers, resize vitals. Synchronous on purpose —
   *  handleMove validates against agg.speedMult on packet arrival, so the
   *  aggregate can never lag an equip by a tick. */
  private touchInv(session: PlayerSession): void {
    session.dirtyInv = true;
    this.recomputeAgg(session);
    this.recomputeVitals(session);
  }

  /** Rebuild the modifier aggregate from the 6 live sources: the 5 equipment
   *  slots plus the held hotbar stack iff it's a weapon (a sword's perks work
   *  only in hand; parked in the bags it's inert). Per-stat sums clamp
   *  symmetrically to items.mods.caps. */
  private recomputeAgg(session: PlayerSession): void {
    const byStat: Record<string, number> = {};
    const modTotals: Record<string, number> = {};
    let armor = 0;
    const sources: Array<ItemStack | null> = [...session.equipment];
    const held = session.slots[session.held];
    if (held && this.reg.items[held.item]?.kind === "weapon") sources.push(held);
    for (const s of sources) {
      if (!s) continue;
      const def = this.reg.items[s.item];
      if (!def) continue;
      if (def.kind === "armor" && def.armor !== undefined) {
        armor += def.armor * (this.reg.rarities[s.rarity]?.mult ?? 1) * (s.stats?.["armor"] ?? 1);
      }
      if (s.mods) {
        for (const [id, mag] of Object.entries(s.mods)) {
          const mod = this.reg.modifiers[id];
          if (!mod) continue; // retired modifier id: inert, not fatal
          modTotals[id] = (modTotals[id] ?? 0) + mag;
          byStat[mod.stat] = (byStat[mod.stat] ?? 0) + mag;
        }
      }
    }
    const caps = this.consts.items.mods.caps;
    for (const [stat, v] of Object.entries(byStat)) {
      const cap = caps[stat];
      if (cap !== undefined) byStat[stat] = Math.max(-cap, Math.min(cap, v));
    }
    session.agg = { byStat, modTotals, armor, speedMult: 1 + (byStat["moveSpeedPct"] ?? 0) };
  }

  /** One home for the max-vital formula: progression base + gear. Shrinking
   *  clamps current values (never kills); growing does NOT auto-fill, so
   *  re-equip cycling grants no healing. Level-ups full-heal explicitly. */
  private recomputeVitals(session: PlayerSession): void {
    const e = session.entity;
    const prog = this.consts.progression;
    const level = e.level ?? 1;
    const maxHp = prog.baseHp + prog.hpPerLevel * (level - 1) + Math.round(session.agg.byStat["maxHp"] ?? 0);
    const maxMana = prog.baseMana + prog.manaPerLevel * (level - 1) + Math.round(session.agg.byStat["maxMana"] ?? 0);
    if (maxHp !== e.health!.maxHp || maxMana !== e.mana!.maxMana) {
      e.health!.maxHp = maxHp;
      e.health!.hp = Math.min(e.health!.hp, maxHp);
      e.mana!.maxMana = maxMana;
      e.mana!.mana = Math.min(e.mana!.mana, maxMana);
      session.dirtyStats = true;
    }
  }

  handleEquip(session: PlayerSession, slot: number): void {
    if (slot < 0 || slot >= HOTBAR_SIZE) return;
    session.held = slot;
    this.touchInv(session); // held weapon's mods activate/deactivate
  }

  /** Which equipment slot index an item def occupies, or -1 if not wearable.
   *  Weapons are NEVER wearable — the offhand takes trinkets and shields
   *  (armor with slot "offhand") only. */
  private slotIndexFor(def: ItemDef): number {
    if (def.kind === "armor" && def.slot) return EQUIP_SLOTS.indexOf(def.slot);
    if (def.kind === "trinket") return EQUIP_SLOTS.indexOf("offhand");
    return -1;
  }

  /** Equip from an inventory slot (occupied equipment swaps into the vacated
   *  index — never needs a free slot) or, with invIndex absent, unequip to
   *  the first free inventory slot. */
  handleEquipSlot(session: PlayerSession, slot: EquipSlot, invIndex?: number): void {
    if (session.entity.combat!.act === "dead") return;
    const slotIdx = EQUIP_SLOTS.indexOf(slot);
    if (slotIdx < 0) return;
    if (invIndex === undefined) {
      const worn = session.equipment[slotIdx];
      if (!worn) return;
      const free = session.slots.findIndex((s) => s === null);
      if (free < 0) {
        this.system(session, "Your bags are full.");
        return;
      }
      session.slots[free] = worn;
      session.equipment[slotIdx] = null;
      this.touchInv(session);
      return;
    }
    if (invIndex < 0 || invIndex >= INV_SIZE) return;
    const stack = session.slots[invIndex];
    if (!stack) return;
    const def = this.reg.items[stack.item];
    if (!def || this.slotIndexFor(def) !== slotIdx) return;
    session.slots[invIndex] = session.equipment[slotIdx] ?? null;
    session.equipment[slotIdx] = stack;
    this.touchInv(session);
  }

  handleInvMove(session: PlayerSession, from: number, to: number): void {
    if (from < 0 || from >= INV_SIZE || to < 0 || to >= INV_SIZE || from === to) return;
    const a = session.slots[from] ?? null;
    const b = session.slots[to] ?? null;
    // merge same item+rarity stacks (rolled instances never merge), else swap
    if (a && b && a.item === b.item && a.rarity === b.rarity && a.dur === undefined && b.dur === undefined && a.stats === undefined && b.stats === undefined && a.mods === undefined && b.mods === undefined) {
      const max = this.reg.items[a.item]?.stack ?? 1;
      const take = Math.min(a.qty, max - b.qty);
      if (take > 0) {
        b.qty += take;
        a.qty -= take;
        session.slots[from] = a.qty > 0 ? a : null;
        this.touchInv(session);
        return;
      }
    }
    session.slots[from] = b;
    session.slots[to] = a;
    this.touchInv(session);
  }

  handleConsume(session: PlayerSession, slot: number): void {
    const e = session.entity;
    if (e.combat!.act === "dead") return;
    const s = session.slots[slot];
    if (!s) return;
    const def = this.reg.items[s.item];
    if (!def || def.kind !== "consumable" || !def.effect) return;
    const fx = def.effect;
    if (fx.heal && e.health) {
      const amount = Math.min(fx.heal, e.health.maxHp - e.health.hp);
      e.health.hp += amount;
      this.broadcastEvent({ kind: "heal", tgt: e.id, amount: Math.round(amount) }, e.pos.x, e.pos.z);
    }
    if (fx.mana && e.mana) e.mana.mana = Math.min(e.mana.maxMana, e.mana.mana + fx.mana);
    if (fx.hotTotal && fx.hotDurMs) {
      e.combat!.hotPerSec = fx.hotTotal / (fx.hotDurMs / 1000);
      e.combat!.hotUntil = Date.now() + fx.hotDurMs;
      e.combat!.hotItemId = s.item; // the status bar shows the food's icon
    }
    if (fx.cureDot) {
      e.combat!.dotPerSec = 0;
      e.combat!.dotUntil = 0;
      e.combat!.dotAcc = 0;
    }
    removeFromSlot(session.slots, slot, 1);
    this.touchInv(session);
    session.dirtyStats = true;
  }

  handleDropItem(session: PlayerSession, slot: number, qty: number): void {
    if (session.entity.combat!.act === "dead") return;
    const removed = removeFromSlot(session.slots, slot, qty);
    if (!removed) return;
    const p = session.entity.pos;
    // small toss in facing direction; FFA after a short lock
    const x = p.x + Math.sin(p.yaw) * 1.2;
    const z = p.z + Math.cos(p.yaw) * 1.2;
    this.spawnLootBag(x, z, [removed], 0, session.character.id, Date.now() + 3000, Date.now() + this.consts.combat.mobLootExpireMs, this.dropY(x, z, p.y));
    this.touchInv(session);
  }

  handlePickup(session: PlayerSession, id: number): void {
    const e = session.entity;
    if (e.combat!.act === "dead") return;
    const bag = this.entities.get(id);
    if (!bag || bag.kind !== "loot" || !bag.loot) return;
    // 3D distance — a bag on a tower platform is NOT reachable from under it
    const dist = Math.hypot(bag.pos.x - e.pos.x, bag.pos.y - e.pos.y, bag.pos.z - e.pos.z);
    if (dist > this.consts.combat.pickupRange) return;
    const now = Date.now();
    if (bag.loot.owner && bag.loot.owner !== session.character.id && bag.loot.unlockAt > now) {
      this.system(session, "That loot belongs to someone else for a little longer.");
      return;
    }
    if (bag.loot.gold > 0) {
      // Fortune (goldFind) pays out at pickup — the bag itself holds the
      // rolled amount, so partial-looting can't double-dip
      const goldMult = 1 + Math.max(0, session.agg.byStat["goldFind"] ?? 0);
      session.gold += Math.round(bag.loot.gold * goldMult);
      bag.loot.gold = 0;
      session.dirtyStats = true;
    }
    const kept: ItemStack[] = [];
    for (const stack of bag.loot.items) {
      const leftover = addItem(this.reg, session.slots, stack);
      if (leftover > 0) kept.push({ ...stack, qty: leftover });
    }
    bag.loot.items = kept;
    bag.lootView = this.lootViewOf(kept);
    this.touchInv(session);
    if (kept.length > 0) this.system(session, "Your bags are full — some items remain.");
    if (bag.loot.items.length === 0 && bag.loot.gold === 0) this.removeEntity(bag.id);
  }

  // ---------- npcs / shops ----------

  private npcDef(entityId: number): NpcDef | null {
    const e = this.entities.get(entityId);
    if (!e || e.kind !== "npc" || !e.npcId) return null;
    return this.def.npcs.find((n) => n.id === e.npcId) ?? null;
  }

  private nearNpc(session: PlayerSession, entityId: number): boolean {
    const e = this.entities.get(entityId);
    if (!e) return false;
    const p = session.entity.pos;
    // 3D — no chatting up through floors/platforms
    return Math.hypot(e.pos.x - p.x, e.pos.y - p.y, e.pos.z - p.z) <= this.consts.combat.talkRange + 1.0;
  }

  handleTalk(session: PlayerSession, entityId: number): void {
    const npc = this.npcDef(entityId);
    if (!npc || !this.nearNpc(session, entityId)) return;
    let shop: ShopWire | null = null;
    if (npc.shop) {
      shop = {
        items: npc.shop.items.map((id) => ({ item: id, price: this.reg.items[id]?.value ?? 0 })),
        buys: npc.shop.buys,
      };
    }
    let enchant: EnchantWire | null = null;
    if (npc.service?.kind === "enchant") {
      const offers = npc.service.offers
        .filter((id) => this.reg.modifiers[id]?.enchant)
        .map((id) => {
          const def = this.reg.modifiers[id]!;
          return { id, name: def.name, tiers: def.enchant!.tiers, priceMult: def.enchant!.priceMult };
        });
      if (offers.length > 0) {
        enchant = { offers, maxTier: npc.service.maxTier, remove: npc.service.remove };
      }
    }
    session.send({ t: "dialog", id: entityId, name: npc.name, lines: npc.dialog, shop, enchant });
  }

  /** Weaving capacity for a gear tier: enchant slots + max strength tier
   *  (constants.enchanting.tierCapacity). An unknown/absent tier clamps to the
   *  highest defined rung at or below it, else the lowest rung. */
  private weaveCapacity(gearTier: number): { slots: number; maxTier: number } {
    const table = this.consts.enchanting.tierCapacity;
    const exact = table[String(gearTier)];
    if (exact) return exact;
    const keys = Object.keys(table)
      .map(Number)
      .sort((a, b) => a - b);
    let best = keys[0] ?? 1;
    for (const k of keys) if (k <= gearTier) best = k;
    return table[String(best)] ?? { slots: 1, maxTier: 1 };
  }

  /** The weaver's price to add strength `tier` of `mod` onto `stack`, given
   *  how many enchants it already carries (each prior one surcharges). Value-
   *  and rarity-scaled from shared constants; the client mirrors this exactly
   *  for display, this one is authoritative. */
  enchantPrice(stack: ItemStack, priceMult: number, tier: number, existingMods: number): number {
    const def = this.reg.items[stack.item];
    const rarityMult = this.reg.rarities[stack.rarity]?.mult ?? 1;
    const e = this.consts.enchanting;
    const tierMult = e.tierPriceMult[String(tier)] ?? 1;
    const surcharge = Math.pow(e.slotSurchargeMult, Math.max(0, existingMods));
    return Math.ceil((def?.value ?? 0) * rarityMult * priceMult * tierMult * surcharge * e.priceValueMult + e.priceBase);
  }

  /** The weaver's price to strip one woven enchant off `stack`. */
  removeCost(stack: ItemStack): number {
    const def = this.reg.items[stack.item];
    const rarityMult = this.reg.rarities[stack.rarity]?.mult ?? 1;
    const e = this.consts.enchanting;
    return Math.ceil(e.removeCostBase + (def?.value ?? 0) * rarityMult * e.removeCostValueMult);
  }

  /** Weave enchant `enchantId` at strength `tier` onto the inventory stack at
   *  `slot`. Server re-validates everything at receipt (the menu may be stale:
   *  invMove/sell/drop races just change the target): near + service + offer,
   *  eligible kind via the modifier's appliesTo, the strength within BOTH the
   *  weaver's and the item's tier cap, a FREE enchant slot (capacity counts
   *  every mod — rolled or woven), no duplicate of this modifier (no in-place
   *  upgrade — remove first), gold. */
  handleEnchant(session: PlayerSession, npcEntityId: number, slot: number, enchantId: string, tier: number): void {
    if (session.entity.combat!.act === "dead") return;
    const npc = this.npcDef(npcEntityId);
    if (!npc || npc.service?.kind !== "enchant" || !this.nearNpc(session, npcEntityId)) return;
    if (!npc.service.offers.includes(enchantId)) return;
    const mod = this.reg.modifiers[enchantId];
    if (!mod?.enchant) return;
    if (!Number.isInteger(tier) || tier < 1 || tier > mod.enchant.tiers.length) return;
    if (tier > npc.service.maxTier) {
      this.system(session, "That degree of weaving is beyond my art — seek a greater enchanter.");
      return;
    }
    if (slot < 0 || slot >= INV_SIZE) return;
    const stack = session.slots[slot];
    if (!stack) return;
    const def = this.reg.items[stack.item];
    if (!def || !isEquippable(def.kind)) {
      this.system(session, `${npc.name.split(" ")[0]} shakes her head: that cannot hold an enchantment.`);
      return;
    }
    if (!(mod.appliesTo as readonly string[]).includes(def.kind)) {
      this.system(session, `${mod.name} will not take on a ${def.kind}.`);
      return;
    }
    const cap = this.weaveCapacity(def.tier ?? 1);
    if (tier > cap.maxTier) {
      this.system(session, `This ${def.name} cannot hold so great a weaving.`);
      return;
    }
    const mods = stack.mods ?? {};
    if (mods[enchantId] !== undefined) {
      this.system(session, `It already bears ${mod.name} — I cannot layer it. Have me unpick it first.`);
      return;
    }
    const count = Object.keys(mods).length;
    if (count >= cap.slots) {
      this.system(session, `This ${def.name} has no room for another weaving.`);
      return;
    }
    const price = this.enchantPrice(stack, mod.enchant.priceMult, tier, count);
    if (session.gold < price) {
      this.system(session, "Not enough gold.");
      return;
    }
    session.gold -= price;
    // integer mods (Vitality/Clarity/Thorns) stamp whole numbers even if a
    // future ladder rung were authored fractional (registry also rejects that)
    const rung = mod.integer ? Math.round(mod.enchant.tiers[tier - 1]!) : mod.enchant.tiers[tier - 1]!;
    stack.mods = { ...mods, [enchantId]: rung };
    session.dirtyStats = true;
    this.touchInv(session);
    const roman = ROMAN_TIER[tier] ?? String(tier);
    this.system(session, `${npc.name.split(" ")[0]} whispers over your ${def.name}... ${mod.name} ${roman} settles into it. (-${price}g)`);
    this.log.info(`${session.character.name} enchanted ${stack.item} with ${enchantId} T${tier} for ${price}g`);
  }

  /** Strip a woven modifier off the item at `slot` (frees its enchant slot;
   *  also lifts curses off drop gear). Only weavers with service.remove offer
   *  it; server re-validates near + service + remove + the mod being present. */
  handleUnenchant(session: PlayerSession, npcEntityId: number, slot: number, modId: string): void {
    if (session.entity.combat!.act === "dead") return;
    const npc = this.npcDef(npcEntityId);
    if (!npc || npc.service?.kind !== "enchant" || !npc.service.remove || !this.nearNpc(session, npcEntityId)) return;
    if (slot < 0 || slot >= INV_SIZE) return;
    const stack = session.slots[slot];
    if (!stack || !stack.mods || stack.mods[modId] === undefined) return;
    const def = this.reg.items[stack.item];
    const price = this.removeCost(stack);
    if (session.gold < price) {
      this.system(session, "Not enough gold.");
      return;
    }
    session.gold -= price;
    const rest = { ...stack.mods };
    delete rest[modId];
    if (Object.keys(rest).length === 0) delete stack.mods;
    else stack.mods = rest;
    session.dirtyStats = true;
    this.touchInv(session);
    const modName = this.reg.modifiers[modId]?.name ?? modId;
    this.system(session, `${npc.name.split(" ")[0]} unpicks the ${modName} from your ${def?.name ?? "item"}. (-${price}g)`);
    this.log.info(`${session.character.name} removed ${modId} from ${stack.item} for ${price}g`);
  }

  handleBuy(session: PlayerSession, npcEntityId: number, itemId: string, qty: number): void {
    const npc = this.npcDef(npcEntityId);
    if (!npc?.shop || !this.nearNpc(session, npcEntityId)) return;
    if (!npc.shop.items.includes(itemId)) return;
    const def = this.reg.items[itemId];
    if (!def || qty < 1 || qty > 99) return;
    const cost = def.value * qty;
    if (session.gold < cost) {
      this.system(session, "Not enough gold.");
      return;
    }
    const leftover = addItem(this.reg, session.slots, mintItem(this.reg, this.consts, itemId, qty, "common"));
    if (leftover === qty) {
      this.system(session, "Your bags are full.");
      return;
    }
    const bought = qty - leftover;
    session.gold -= def.value * bought;
    session.dirtyStats = true;
    this.touchInv(session);
  }

  handleSell(session: PlayerSession, npcEntityId: number, slot: number, qty: number): void {
    const npc = this.npcDef(npcEntityId);
    if (!npc?.shop?.buys || !this.nearNpc(session, npcEntityId)) return;
    const s = session.slots[slot];
    if (!s) return;
    const def = this.reg.items[s.item];
    if (!def) return;
    const removed = removeFromSlot(session.slots, slot, qty);
    if (!removed) return;
    const rarityMult = this.reg.rarities[removed.rarity]?.mult ?? 1;
    const price = Math.max(1, Math.floor(def.value * rarityMult * this.modValueMult(removed) * this.consts.combat.sellFraction)) * removed.qty;
    session.gold += price;
    session.dirtyStats = true;
    this.touchInv(session);
  }

  /** Sell-value multiplier from an instance's modifiers: perks add, curses
   *  subtract (knobs in items.mods). Kept well under enchant cost so
   *  enchant-then-sell can never mint gold. */
  private modValueMult(s: ItemStack): number {
    if (!s.mods) return 1;
    const cfg = this.consts.items.mods;
    let mult = 1;
    for (const id of Object.keys(s.mods)) {
      const def = this.reg.modifiers[id];
      if (!def) continue;
      mult += def.curse ? -cfg.sellPenaltyPerCurse : cfg.sellBonusPerPerk;
    }
    return Math.max(0.25, mult);
  }

  // ---------- chat / admin ----------

  handleChat(session: PlayerSession, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("/g ")) {
      const body = trimmed.slice(3).trim();
      if (body && this.onGlobalChat) this.onGlobalChat(session.character.name, body);
      return;
    }
    if (trimmed.startsWith("/")) {
      this.handleCommand(session, trimmed);
      return;
    }
    for (const s of this.sessions.values()) {
      s.send({ t: "chat", channel: "room", from: session.character.name, text: trimmed });
    }
  }

  /** Delivery of a relayed global-chat line (from the master, any room). */
  deliverGlobalChat(from: string, text: string): void {
    for (const s of this.sessions.values()) {
      s.send({ t: "chat", channel: "global", from, text });
    }
  }

  private handleCommand(session: PlayerSession, text: string): void {
    if (!session.character.roles.includes("admin")) {
      this.system(session, "Unknown command.");
      return;
    }
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    switch (cmd) {
      case "give": {
        const itemId = args[0] ?? "";
        if (!this.reg.items[itemId]) {
          this.system(session, `Unknown item '${itemId}'. Try: ${Object.keys(this.reg.items).join(", ")}`);
          return;
        }
        const qty = Math.max(1, parseInt(args[1] ?? "1", 10) || 1);
        const rarity = args[2] && this.reg.rarities[args[2]] ? args[2]! : "common";
        addItem(this.reg, session.slots, mintItem(this.reg, this.consts, itemId, qty, rarity));
        this.touchInv(session);
        this.system(session, `Gave ${qty}x ${rarity} ${itemId}.`);
        break;
      }
      case "gold": {
        session.gold += Math.max(0, parseInt(args[0] ?? "0", 10) || 0);
        session.dirtyStats = true;
        break;
      }
      case "enchant": {
        // staging/testing: stamp a modifier onto the HELD item (stacks
        // freely, any magnitude — the NPC path enforces the real rules)
        const modId = args[0] ?? "";
        const mod = this.reg.modifiers[modId];
        if (!mod) {
          this.system(session, `Unknown modifier '${modId}'. Try: ${Object.keys(this.reg.modifiers).join(", ")}`);
          return;
        }
        const held = session.slots[session.held];
        if (!held || !isEquippable(this.reg.items[held.item]?.kind ?? "")) {
          this.system(session, "Hold an equippable item first.");
          return;
        }
        const parsed = parseFloat(args[1] ?? "");
        const range = mod.rolls[held.rarity] ?? mod.rolls["common"] ?? [0, 0];
        const mag = Number.isFinite(parsed) ? parsed : (range[0]! + range[1]!) / 2;
        held.mods = { ...(held.mods ?? {}), [modId]: mod.integer ? Math.round(mag) : Math.round(mag * 1000) / 1000 };
        this.touchInv(session);
        this.system(session, `Enchanted held ${held.item}: ${modId} ${held.mods[modId]}.`);
        break;
      }
      case "tp": {
        const x = parseFloat(args[0] ?? "");
        const z = parseFloat(args[1] ?? "");
        if (!isFinite(x) || !isFinite(z) || x < 0 || x > this.def.size.w || z < 0 || z > this.def.size.h) {
          this.system(session, "Usage: /tp <x> <z>");
          return;
        }
        const e = session.entity;
        e.pos.x = x;
        e.pos.z = z;
        e.pos.y = this.world.standY(x, z);
        session.send({ t: "correct", seq: session.lastSeq, x: e.pos.x, y: e.pos.y, z: e.pos.z });
        break;
      }
      case "spawnmob": {
        const mobId = args[0] ?? "";
        if (!this.reg.mobs[mobId]) {
          this.system(session, `Unknown mob '${mobId}'. Try: ${Object.keys(this.reg.mobs).join(", ")}`);
          return;
        }
        const n = Math.min(10, Math.max(1, parseInt(args[1] ?? "1", 10) || 1));
        // optional level: the only way to exercise a mob's level-gated ranks
        // in-game (spawn tables carry `level`; this is the staging equivalent)
        const lvlArg = args[2] !== undefined ? parseInt(args[2], 10) : NaN;
        const level = Number.isFinite(lvlArg) ? Math.min(99, Math.max(1, lvlArg)) : undefined;
        const p = session.entity.pos;
        for (let i = 0; i < n; i++) {
          this.spawnMob(mobId, p.x + Math.sin(p.yaw) * 4 + (Math.random() - 0.5) * 2, p.z + Math.cos(p.yaw) * 4 + (Math.random() - 0.5) * 2, "", level);
        }
        const r = resolveMob(this.reg.mobs[mobId]!, level, this.consts.mobs.scaling);
        this.system(session, `Spawned ${n}x ${r.name} (L${r.level}, ${r.hp} hp, kit: ${r.attacks.map((a) => a.ability).join("/")}).`);
        break;
      }
      case "time": {
        const v = parseFloat(args[0] ?? "");
        if (!isFinite(v) || v < 0 || v >= 1) {
          this.system(session, "Usage: /time <0..1> (0.25 sunrise, 0.5 noon, 0.75 sunset)");
          return;
        }
        this.setTimeOfDay(v);
        this.system(session, `Time set to ${v}.`);
        break;
      }
      case "level": {
        const lvl = Math.min(this.consts.progression.maxLevel, Math.max(1, parseInt(args[0] ?? "1", 10) || 1));
        const e = session.entity;
        const prog = this.consts.progression;
        e.level = lvl;
        e.health!.maxHp = prog.baseHp + prog.hpPerLevel * (lvl - 1);
        e.health!.hp = e.health!.maxHp;
        e.mana!.maxMana = prog.baseMana + prog.manaPerLevel * (lvl - 1);
        e.mana!.mana = e.mana!.maxMana;
        session.xp = 0;
        session.dirtyStats = true;
        this.system(session, `Level set to ${lvl}.`);
        break;
      }
      case "reload": {
        try {
          this.reg.reload();
          this.system(session, "Registries reloaded.");
          this.log.info("registries hot-reloaded by admin");
        } catch (err) {
          this.system(session, `Reload failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }
      case "clearblocks": {
        const n = this.clearBlocks();
        this.system(session, `Reverted ${n} block edit(s).`);
        break;
      }
      case "expire": {
        // lifecycle testing: collapse this room in N seconds (default 15)
        if (!this.onExpireRequest) {
          this.system(session, "This room has no lifecycle.");
          return;
        }
        const sec = Math.max(1, parseInt(args[0] ?? "15", 10) || 15);
        this.onExpireRequest(sec);
        this.system(session, `Room will expire in ${sec}s.`);
        break;
      }
      case "room": {
        // admin self-transfer to any open room by id (skips portal proximity);
        // rides the same requestTransfer machinery as portal use / respawns
        const roomId = args[0] ?? "";
        let known: string[];
        try {
          known = [...loadRoomDefs().keys()];
        } catch (err) {
          this.system(session, `Room defs failed to load: ${err instanceof Error ? err.message : err}`);
          return;
        }
        if (!known.includes(roomId)) {
          this.system(session, `Unknown room '${roomId}'. Have: ${known.join(", ")}`);
          return;
        }
        if (roomId === this.def.id) {
          this.system(session, `You are already in ${roomId}.`);
          return;
        }
        if (this.roomStatus.get(roomId) === false) {
          this.system(session, `Room '${roomId}' is closed right now.`);
          return;
        }
        if (!this.onTransferRequest) {
          this.system(session, "Transfers are unavailable in this room.");
          return;
        }
        this.onTransferRequest(session, roomId);
        this.system(session, `Transferring to ${roomId}...`);
        break;
      }
      case "prefab": {
        // stamp a prefab through the EDIT overlay (applyEdit, owner null):
        // /clearblocks wipes it, it persists in RoomState — never gen-time
        // set(). This is the Atelier iteration loop.
        const pid = args[0] ?? "";
        if (!PREFABS[pid]) {
          this.system(session, `Unknown prefab '${pid}'. Have: ${Object.keys(PREFABS).join(", ")}`);
          return;
        }
        const rot = Math.min(3, Math.max(0, parseInt(args[1] ?? "0", 10) || 0)) as 0 | 1 | 2 | 3;
        const ruin = Math.min(2, Math.max(0, parseInt(args[2] ?? "0", 10) || 0)) as 0 | 1 | 2;
        // origin ~3 blocks ahead of the player along their facing, floored
        const p = session.entity.pos;
        const ox = Math.floor(p.x + Math.sin(p.yaw) * 3);
        const oz = Math.floor(p.z + Math.cos(p.yaw) * 3);
        const rec = new EditRecorder(this.world);
        try {
          stampPrefab(new Builder(rec, this.def), pid, ox, oz, rot, ruin);
        } catch (err) {
          this.system(session, `Stamp failed: ${err instanceof Error ? err.message : err}`);
          return;
        }
        const cells = rec.cells();
        for (const c of cells) this.world.applyEdit(c.x, c.y, c.z, c.id, null);
        this.chunkCache = null;
        for (const c of cells) {
          for (const sess of this.sessions.values()) sess.send({ t: "blockSet", x: c.x, y: c.y, z: c.z, id: c.id });
        }
        this.system(session, `Stamped ${pid} (rot ${rot}, ruin ${ruin}) at ${ox},${oz} — ${cells.length} block(s). /clearblocks reverts.`);
        break;
      }
      default:
        this.system(session, `Unknown command /${cmd}. Have: give gold tp spawnmob time level reload clearblocks expire room prefab`);
    }
  }

  // ---------- tick ----------

  private inInterest(viewer: PlayerSession, e: Entity): boolean {
    const r = this.consts.net.interestRadius;
    const dx = e.pos.x - viewer.entity.pos.x;
    const dz = e.pos.z - viewer.entity.pos.z;
    return dx * dx + dz * dz <= r * r;
  }

  /** Send to every session within interest radius of (x,z). */
  broadcastNear(x: number, z: number, msg: ServerToClient): void {
    const r = this.consts.net.interestRadius;
    for (const s of this.sessions.values()) {
      const dx = s.entity.pos.x - x;
      const dz = s.entity.pos.z - z;
      if (dx * dx + dz * dz <= r * r) s.send(msg);
    }
  }

  broadcastEvent(e: CombatEvent, x: number, z: number): void {
    this.broadcastNear(x, z, { t: "evt", e });
  }

  /**
   * Advance one entity's action FSM to `now`, firing due melee hits and
   * releases. tick() runs it at 10 Hz; handleAttack runs it again at packet
   * arrival so a click landing between ticks isn't judged against a stale
   * recover/active state (the silent-whiff bug). Loops because catching up
   * may cross more than one state boundary.
   */
  private advanceCombat(e: Entity, now: number): void {
    for (let guard = 0; guard < 4; guard++) {
      const c = e.combat!;
      const ability = c.ability ? (this.reg.abilities[c.ability] ?? null) : null;
      const before = c.act;
      const fired = advanceFsm(e, ability, now);
      if (fired && e.kind === "player") {
        // players aim WHILE winding up/casting: fire where the mouse points
        // at release, not where it pointed at click. Mobs keep the aim
        // frozen at windup start — their telegraph is the dodge window.
        const s = this.sessions.get(e.id);
        if (s) {
          c.aimYaw = e.pos.yaw;
          c.aimPitch = s.lastPitch;
        }
      }
      if (fired === "melee-hit" && ability) this.resolveMeleeHit(e, ability);
      else if (fired === "release" && ability) this.releaseAbility(e, ability, now);
      if (c.act === before) break;
    }
  }

  /** Simulation tick (10 Hz): FSMs, brains, projectiles, regen, respawns. */
  tick(): void {
    this.tickNo++;
    const now = Date.now();
    const dt = Math.min((now - this.lastTickAt) / 1000, 0.5);
    this.lastTickAt = now;

    // 1. advance action FSMs; fire melee hits and releases
    for (const e of this.entities.values()) {
      if (!e.combat) continue;
      this.advanceCombat(e, now);
      // debuff expiry
      if (e.combat.slowPct > 0 && e.combat.slowUntil <= now) e.combat.slowPct = 0;
      // poison DoT: accrue over the active window, land whole-point bites
      // through applyDotDamage (mirror of the food HoT, inverted)
      if (e.combat.dotUntil > 0) {
        if (e.combat.act === "dead" || !e.health) {
          e.combat.dotPerSec = 0;
          e.combat.dotUntil = 0;
          e.combat.dotAcc = 0;
        } else {
          const sliceStart = now - dt * 1000;
          const activeDt = Math.max(0, Math.min(now, e.combat.dotUntil) - sliceStart) / 1000;
          e.combat.dotAcc += e.combat.dotPerSec * Math.min(activeDt, dt);
          const expired = e.combat.dotUntil <= now;
          const bite = expired ? Math.round(e.combat.dotAcc) : Math.floor(e.combat.dotAcc);
          if (bite > 0) {
            e.combat.dotAcc -= bite;
            this.applyDotDamage(e, bite);
          }
          if (expired) {
            e.combat.dotPerSec = 0;
            e.combat.dotUntil = 0;
            e.combat.dotAcc = 0;
          }
        }
      }
    }

    // 1b. buffered attacks: clicks that arrived a hair early fire now that
    // the FSMs have stepped, instead of silently whiffing
    for (const s of this.sessions.values()) {
      const pa = s.pendingAttack;
      if (!pa) continue;
      if (pa.until <= now) {
        s.pendingAttack = null;
        continue;
      }
      if (this.tryHeldAbility(s, pa.aimYaw, pa.aimPitch, now)) s.pendingAttack = null;
    }

    // 2. mob brains → intents → body
    const players = [...this.sessions.values()].map((s) => s.entity);
    const aliveMobs = [...this.entities.values()].filter((e) => e.kind === "mob" && e.combat!.act !== "dead");
    let pathBudget = 3; // bounded BFS computations per tick (stuck recovery)
    for (const e of aliveMobs) {
      if (!e.brain) continue;
      const def = this.reg.mobs[e.brain.mobId];
      if (!def) continue;
      const resolved = resolveMob(def, e.brain.spawnLevel, this.consts.mobs.scaling);
      // gravity first: an airborne mob (walked off a ledge/canopy) falls with
      // no air control and resumes deciding/walking the tick it lands
      if (applyGravity(e, dt, this.world, this.consts.movement.gravity)) {
        e.renderable.anim = "idle";
        continue;
      }
      // melee attacks only land within the vertical reach; a kit with any
      // projectile aims with real pitch, so height barely matters to it
      const reachY = this.attackOptionsOf(resolved).some((o) => o.ability.kind === "projectile")
        ? Number.POSITIVE_INFINITY
        : this.consts.combat.meleeVerticalReach;
      const decision = tickBrain(e, resolved, players, now, reachY);
      const speed = resolved.moveSpeed * slowMult(e.combat!, now);
      let moved = false;
      if (decision.move) {
        const b = e.brain;
        const goal = decision.move;
        const purposeful = goal.maxDrop !== undefined; // chase/flee/return
        // recovery path bookkeeping: invalid once the goal drifts off its end
        if (b.path && b.path.length) {
          const end = b.path[b.path.length - 1]!;
          if (Math.hypot(goal.x - end.x, goal.z - end.z) > 5) b.path = undefined;
        }
        if (b.path && b.path.length) {
          const wp = b.path[0]!;
          if (Math.hypot(e.pos.x - wp.x, e.pos.z - wp.z) < 0.7) b.path.shift();
        }
        const wp = b.path && b.path.length ? b.path[0]! : null;
        const intent = wp ? { ...goal, x: wp.x, z: wp.z } : goal;
        moved = applyMove(e, intent, speed, dt, this.world, this.def.size, this.waterLevel(), aliveMobs);
        // progress detection: deflection steering can "move" in circles
        // around concave obstacles (the throne!) without closing distance
        if (purposeful) {
          const goalD = Math.hypot(goal.x - e.pos.x, goal.z - e.pos.z);
          if (!moved || goalD >= (b.lastGoalD ?? Number.POSITIVE_INFINITY) - 0.02) {
            b.stuckTicks = (b.stuckTicks ?? 0) + 1;
          } else {
            b.stuckTicks = 0;
          }
          b.lastGoalD = goalD;
          if ((b.stuckTicks ?? 0) >= STUCK_TICKS_FOR_PATH && !wp && pathBudget > 0) {
            pathBudget--;
            const path = pathfindWaypoints(this.world, e.pos, { x: goal.x, z: goal.z }, goal.wade ?? false);
            if (path) {
              b.path = path;
              b.stuckTicks = 0;
            } else {
              b.stuckTicks = -10; // cooldown: don't re-BFS every tick against a wall
            }
          }
          if (wp && !moved && (b.stuckTicks ?? 0) >= STUCK_TICKS_FOR_PATH) {
            b.path = undefined; // the path itself is blocked (mob pile): rebuild later
            b.stuckTicks = 0;
          }
        } else {
          b.stuckTicks = 0;
          b.lastGoalD = undefined;
        }
      }
      if (decision.faceYaw !== null) e.pos.yaw = decision.faceYaw;
      if (decision.attack) {
        const res = this.mobAttack(e, decision.attack, now);
        // nothing in the kit connects from here (bow minRange dead band,
        // reloading with a melee option, target up a ledge): close in
        if (res === "close" && !moved) {
          moved = applyMove(
            e,
            { x: decision.attack.pos.x, z: decision.attack.pos.z, speedMult: 1, maxDrop: PURPOSEFUL_MAX_DROP, wade: true },
            speed,
            dt,
            this.world,
            this.def.size,
            this.waterLevel(),
            aliveMobs
          );
        }
      }
      e.renderable.anim = moved ? "move" : "idle";
    }
    // 2b. overlapping mobs push apart so packs never stack inside each other
    separateEntities(aliveMobs, dt, this.world, this.def.size);

    // 3. npc wandering (flavor)
    for (const e of this.entities.values()) {
      if (e.kind !== "npc" || !e.brain) continue;
      const npc = this.def.npcs.find((n) => n.id === e.npcId);
      if (!npc || npc.wanderRadius <= 0) continue;
      const b = e.brain;
      if (b.wanderTarget) {
        const moved = applyMove(e, { x: b.wanderTarget.x, z: b.wanderTarget.z, speedMult: 0.3 }, this.consts.movement.walkSpeed, dt, this.world, this.def.size, this.waterLevel());
        e.renderable.anim = moved ? "move" : "idle";
        if (!moved || Math.hypot(e.pos.x - b.wanderTarget.x, e.pos.z - b.wanderTarget.z) < 0.6) b.wanderTarget = null;
      } else {
        e.renderable.anim = "idle";
        if (now >= b.nextWanderAt) {
          b.nextWanderAt = now + 4000 + Math.random() * 8000;
          const ang = Math.random() * Math.PI * 2;
          const r = Math.random() * npc.wanderRadius;
          b.wanderTarget = { x: b.home.x + Math.sin(ang) * r, z: b.home.z + Math.cos(ang) * r };
        }
      }
    }

    // 4. projectiles (substepped for hit fidelity)
    this.tickProjectiles(now, dt);
    this.tickFirePillars(now);

    // 5. player regen + food HoT + gear regen modifiers + effects sync
    for (const s of this.sessions.values()) {
      const e = s.entity;
      const c = e.combat!;
      // the status bar must clear on death too — sync before the dead skip
      this.tickEffects(s, now);
      if (c.act === "dead") continue;
      if (e.mana && e.mana.mana < e.mana.maxMana) {
        // gear manaRegen adds (drained curses subtract); floor at 0 — a
        // curse slows recovery to a halt but never drains the pool
        const manaRate = Math.max(0, this.consts.combat.manaRegenPerSec + (s.agg.byStat["manaRegen"] ?? 0));
        e.mana.mana = Math.min(e.mana.maxMana, e.mana.mana + manaRate * dt);
      }
      if (e.health && e.health.hp < e.health.maxHp) {
        // base regen respects the post-damage delay; gear Regeneration works
        // THROUGH combat (an enchant that stops when hit would be pointless)
        let hpRate = Math.max(0, s.agg.byStat["hpRegen"] ?? 0);
        if (now - c.lastDamagedAt > this.consts.combat.regenDelayAfterDamageMs) {
          hpRate += this.consts.combat.hpRegenPerSec;
        }
        if (c.hotUntil > now) hpRate += c.hotPerSec;
        if (hpRate > 0) e.health.hp = Math.min(e.health.maxHp, e.health.hp + hpRate * dt);
      }
      // stats sync when the visible integers move
      if (Math.ceil(e.health!.hp) !== s.lastSentHp || Math.floor(e.mana!.mana) !== s.lastSentMana) s.dirtyStats = true;
    }

    // 6. spawner respawns
    for (const spawner of this.spawners.values()) {
      const due = spawner.respawnAts.filter((t) => t <= now);
      if (due.length === 0) continue;
      spawner.respawnAts = spawner.respawnAts.filter((t) => t > now);
      for (const _ of due) this.spawnPack(spawner.id, 1);
    }

    // 6b. prefab loot caches (~1 Hz is plenty; bags are position-matched)
    if (this.tickNo % 10 === 0) this.tickCaches(now);

    // 7. corpse removal + loot expiry
    for (const pending of this.pendingRemovals.filter((p) => p.at <= now)) this.removeEntity(pending.id);
    this.pendingRemovals = this.pendingRemovals.filter((p) => p.at > now);
    for (const e of [...this.entities.values()]) {
      if (e.kind === "loot" && e.loot?.expireAt !== null && e.loot !== undefined && e.loot.expireAt! <= now) {
        this.removeEntity(e.id);
      }
    }

    // 8. flush dirty self-state
    for (const s of this.sessions.values()) {
      if (s.dirtyStats) this.sendStats(s);
      if (s.dirtyInv) this.sendInv(s);
    }
  }

  private tickProjectiles(now: number, dt: number): void {
    if (this.projectiles.length === 0) return;
    const SUBSTEP = 0.025;
    const survivors: Projectile[] = [];
    for (const p of this.projectiles) {
      let alive = true;
      let t = 0;
      while (t < dt && alive) {
        const step = Math.min(SUBSTEP, dt - t);
        t += step;
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.z += p.vz * step;
        // range/lifetime
        const dx = p.x - p.startX;
        const dz = p.z - p.startZ;
        if (now + t * 1000 >= p.dieAt || dx * dx + dz * dz > p.maxRangeSq) {
          this.endProjectile(p, null);
          alive = false;
          break;
        }
        // world hits: bounds, solid blocks, liquids (cross decos pass through)
        if (
          p.x < 0 || p.x > this.def.size.w || p.z < 0 || p.z > this.def.size.h || p.y < 0 ||
          this.world.solidAt(p.x, p.y, p.z) ||
          this.world.liquidAt(p.x, p.y, p.z)
        ) {
          this.endProjectile(p, null);
          alive = false;
          break;
        }
        // entity hits
        const owner = this.entities.get(p.ownerId);
        const targets = owner ? this.targetsOf(owner) : [];
        for (const tgt of targets) {
          if (!projectileHits(p, tgt, this.consts.combat.projectileHitRadius)) continue;
          this.endProjectile(p, tgt);
          alive = false;
          break;
        }
      }
      if (alive) survivors.push(p);
    }
    this.projectiles = survivors;
  }

  /** Fire pillars: ignited hazards damage every valid target once inside
   *  their radius during the ignite window (walking through mid-burn still
   *  burns — kiters can't thread a marching line for free). */
  private tickFirePillars(now: number): void {
    if (this.firePillars.length === 0) return;
    this.firePillars = this.firePillars.filter((f) => {
      if (now < f.igniteAt) return true;
      if (now > f.windowEndsAt) return false;
      const owner = this.entities.get(f.ownerId);
      if (!owner) return false;
      for (const tgt of this.targetsOf(owner)) {
        if (f.hitIds.has(tgt.id)) continue;
        const d = Math.hypot(tgt.pos.x - f.x, tgt.pos.z - f.z);
        if (d > f.radius) continue;
        if (tgt.pos.y - f.y > 2.5 || f.y - tgt.pos.y > 1.5) continue; // same floor
        f.hitIds.add(tgt.id);
        this.applyDamage(owner, tgt, f.damage, "magic");
      }
      return true;
    });
  }

  /** Projectile impact: direct damage on the struck target, then AoE splash
   *  (70% damage) on every other valid target inside aoeRadius — exploding
   *  boss fireballs punish near-misses instead of whiffing past kiters. */
  private endProjectile(p: Projectile, directHit: Entity | null): void {
    this.broadcastNear(p.x, p.z, { t: "projHit", id: p.id, x: p.x, y: p.y, z: p.z });
    const owner = this.entities.get(p.ownerId);
    if (!owner) return;
    if (directHit) {
      this.applyDamage(owner, directHit, p.damage, p.dmgClass);
      if (p.debuff) this.applyDebuff(directHit, p.debuff, owner);
    }
    if (p.aoeRadius > 0) {
      const splash = Math.max(1, Math.round(p.damage * 0.7));
      for (const tgt of this.targetsOf(owner)) {
        if (tgt === directHit) continue;
        const d = Math.hypot(tgt.pos.x - p.x, tgt.pos.z - p.z);
        if (d > p.aoeRadius) continue;
        if (Math.abs(tgt.pos.y + 0.9 - p.y) > 3) continue; // roughly the same floor
        this.applyDamage(owner, tgt, splash, p.dmgClass);
        if (p.debuff) this.applyDebuff(tgt, p.debuff, owner);
      }
    }
  }

  private removeEntity(id: number): void {
    this.entities.delete(id);
    this.damageLog.delete(id);
  }

  /** Snapshot broadcast (12 Hz): per-viewer enter/leave + exact field deltas. */
  snapshot(): void {
    const now = Date.now();
    const keyframeEvery = this.consts.net.keyframeEveryNSnapshots;
    for (const viewer of this.sessions.values()) {
      viewer.snapCount++;
      const keyframe = viewer.snapCount % keyframeEvery === 0;
      const enter: EntityFull[] = [];
      const deltas = [];
      const seen = new Set<number>();

      for (const e of this.entities.values()) {
        if (e === viewer.entity) continue;
        if (!this.inInterest(viewer, e)) continue;
        seen.add(e.id);
        const curr = replicatedState(e);
        const prev = viewer.known.get(e.id);
        if (!prev || keyframe) {
          enter.push(toFull(e, now));
        } else {
          const d = diffState(e, prev, curr, now);
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

  /** Character patches for persistence (batched via shard host → master).
   *  Sessions with a granted transfer are excluded from batch reports: the
   *  master already persisted their state for the TARGET room, and a report
   *  from here would clobber it with stale source-room data (same rule the
   *  disconnect path applies). */
  buildReport(only?: PlayerSession): Array<{ id: string } & Record<string, unknown>> {
    const sessions = only ? [only] : [...this.sessions.values()].filter((s) => !s.transferring);
    return sessions.map((s) => ({
      id: s.character.id,
      roomId: this.def.id,
      x: s.entity.pos.x,
      y: s.entity.pos.y,
      z: s.entity.pos.z,
      yaw: s.entity.pos.yaw,
      level: s.entity.level ?? 1,
      xp: s.xp,
      gold: s.gold,
      inventory: s.slots,
      equipment: s.equipment,
    }));
  }

  /** Eviction persistence: everyone becomes hub-bound at the hub spawn, so
   *  reconnects after an ephemeral-room collapse land straight in the hub. */
  buildEvictionReport(): Array<{ id: string } & Record<string, unknown>> {
    return [...this.sessions.values()].map((s) => ({
      id: s.character.id,
      roomId: "hub",
      x: null,
      y: null,
      z: null,
      yaw: 0,
      level: s.entity.level ?? 1,
      xp: s.xp,
      gold: s.gold,
      inventory: s.slots,
      equipment: s.equipment,
    }));
  }

  allSessions(): IterableIterator<PlayerSession> {
    return this.sessions.values();
  }

  /** Test/tooling access: all live entities. */
  allEntities(): IterableIterator<Entity> {
    return this.entities.values();
  }

  getSession(entityId: number): PlayerSession | undefined {
    return this.sessions.get(entityId);
  }
}
