/**
 * Room simulation: player sessions, movement validation, the shared action
 * FSM, mob AI, loot, XP, economy, chat, and interest-managed delta snapshots.
 * Networking and IPC stay in roomhost.ts — this module never touches ws.
 */
import {
  BLOCK,
  BLOCKS,
  ensureItemInstance,
  gameConstants,
  loadRoomDefs,
  makeLogger,
  mintItem,
  RegistryService,
  WORLD_HEIGHT,
  type AbilityDef,
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
  startAbility,
  type Projectile,
} from "./combat.js";
import { addItem, HOTBAR_SIZE, INV_SIZE, normalizeInventory, removeFromSlot, rollLoot } from "./loot.js";
import { applyMove, findSpawnPoint, pickMob, separateEntities, tickBrain } from "./mobs.js";
import { EditRecorder, PREFABS, stampPrefab } from "./prefabs.js";
import { VoxelWorld } from "./voxel.js";
import { Builder } from "./voxelstructures.js";

/** Chunks per `chunks` message — a whole room ships in a handful of frames. */
const CHUNKS_PER_MSG = 12;

const SPEED_GRACE = 1.6; // multiplier over walkSpeed before a move is rejected
const CORPSE_LINGER_MS = 1500; // dead mob stays visible before despawn
const PACK_AGGRO_RADIUS = 10;

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
  /** set by the RoomHost: sim-initiated transfers (hub-bound respawn, H key)
   *  go through the same requestTransfer machinery as portal use */
  onTransferRequest: ((session: PlayerSession, targetRoomId: string) => void) | null = null;
  /** set by the RoomHost on lifecycle rooms: admin /expire re-arms the timer */
  onExpireRequest: ((sec: number) => void) | null = null;

  /** destination-room availability (sealed dungeon portals) */
  private roomStatus = new Map<string, boolean>();

  /** def spawn tables + prefab bindings/payload tables — mobs use THESE */
  private liveTables: SpawnTable[];
  /** prefab loot caches the room tick keeps stocked */
  private caches: CacheState[];

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
    this.initSpawners(snapshot);
    this.initNpcs();
    this.restoreDrops(snapshot);
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
      const mob = this.spawnMob(pickMob(table), x, z, spawnerId);
      if (mob) spawner.alive.add(mob.id);
    }
  }

  spawnMob(mobId: string, x: number, z: number, spawnerId: string): Entity | null {
    const def = this.reg.mobs[mobId];
    if (!def) return null;
    const gx = Math.min(Math.max(x, 1), this.def.size.w - 1);
    const gz = Math.min(Math.max(z, 1), this.def.size.h - 1);
    const e: Entity = {
      id: allocEntityId(),
      kind: "mob",
      // floorY, not standY: mobs spawn on the ground UNDER canopies/roofs
      pos: { x: gx, y: this.world.floorY(gx, gz), z: gz, yaw: Math.random() * Math.PI * 2 },
      renderable: { sprite: def.sprite, anim: "idle", name: def.name },
      level: def.level,
      health: { hp: def.hp, maxHp: def.hp },
      combat: freshCombat(),
      brain: {
        mobId,
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
    return e;
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
          mobId: "",
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
      this.system(session, "Building isn't allowed here — try the Building Grounds.");
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
    session.dirtyInv = true;
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
        session.dirtyInv = true;
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

  setRoomStatus(roomId: string, open: boolean): void {
    const prev = this.roomStatus.get(roomId);
    this.roomStatus.set(roomId, open);
    if (prev === open) return;
    if (this.def.portals.some((p) => p.target === roomId)) {
      for (const sess of this.sessions.values()) sess.send({ t: "portalState", target: roomId, open });
    }
  }

  portalsWire(): PortalWire[] {
    return this.def.portals.map((p) => ({ ...p, open: this.roomStatus.get(p.target) ?? true }));
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
    "mobs" | "npcs" | "drops" | "projectiles" | "blockEdits" | "timeOfDay" | "players"
  > {
    let mobs = 0;
    let npcs = 0;
    let drops = 0;
    for (const e of this.entities.values()) {
      if (e.kind === "mob") mobs++;
      else if (e.kind === "npc") npcs++;
      else if (e.kind === "loot") drops++;
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
    // and paired-portal arrivals carry y=0 as a ground-snap sentinel
    const groundY = this.world.standY(character.x, character.z);
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

    let { walkSpeed } = this.consts.movement;
    if (c.slowUntil > now) walkSpeed *= 1 - c.slowPct;
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
    const terrainOk =
      y >= ground - 0.6 && (y <= ground + this.consts.world.terrainYToleranceM || inWater || descending);
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
    const levelMult = 1 + this.consts.progression.damagePerLevelPct * ((e.level ?? 1) - 1);
    const started = startAbility(e, abilityId, ability, base * levelMult, aimYaw, aimPitch, now, speedMult);
    // weapons wear one durability point per use (bare hands never do)
    if (started && held && heldDef && held.maxDur !== undefined) this.wearHeldItem(session, held, heldDef);
    return started;
  }

  /** Durability tick: at zero the weapon breaks and the slot empties. */
  private wearHeldItem(session: PlayerSession, stack: ItemStack, def: ItemDef): void {
    stack.dur = (stack.dur ?? stack.maxDur ?? 1) - 1;
    if (stack.dur <= 0) {
      session.slots[session.held] = null;
      this.system(session, `Your ${def.name} broke!`);
    }
    session.dirtyInv = true;
  }

  /** Mob brain wants to attack: same FSM, different intent producer. */
  private mobAttack(mob: Entity, target: Entity, now: number): void {
    const def = this.reg.mobs[mob.brain!.mobId];
    if (!def) return;
    const ability = this.reg.abilities[def.ability];
    if (!ability) return;
    const dx = target.pos.x - mob.pos.x;
    const dz = target.pos.z - mob.pos.z;
    const aimYaw = Math.atan2(dx, dz);
    // ranged mobs aim the muzzle (~eye 1.45) at the target's chest (~1.0)
    // so bolts connect up and down slopes; melee ignores pitch entirely
    let aimPitch = 0;
    if (ability.kind === "projectile") {
      aimPitch = Math.atan2(target.pos.y + 1.0 - (mob.pos.y + 1.45), Math.max(0.1, Math.hypot(dx, dz)));
    }
    startAbility(mob, def.ability, ability, def.damage, aimYaw, aimPitch, now);
  }

  private resolveMeleeHit(attacker: Entity, ability: AbilityDef): void {
    const range = ability.range ?? 2;
    const arc = ability.arcDeg ?? 90;
    for (const target of this.targetsOf(attacker)) {
      if (inMeleeCone(attacker, target, range, arc, this.consts.combat.meleeRangeGrace, this.consts.combat.meleeVerticalReach)) {
        this.applyDamage(attacker, target, attacker.combat!.pendingDamage);
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
        });
        break;
      }
      case "self": {
        if (ability.heal && e.health) {
          const amount = Math.min(ability.heal, e.health.maxHp - e.health.hp);
          e.health.hp += amount;
          this.markStatsDirty(e);
          this.broadcastEvent({ kind: "heal", tgt: e.id, amount: Math.round(amount) }, e.pos.x, e.pos.z);
        }
        break;
      }
      case "melee":
        break; // handled by melee-hit fire
    }
  }

  /** All damage funnels through here: crits, interrupts, threat, death. */
  applyDamage(src: Entity, tgt: Entity, base: number): void {
    if (!tgt.health || tgt.combat?.act === "dead") return;
    const now = Date.now();
    const crit = Math.random() < this.consts.combat.critChance;
    const amount = Math.max(1, Math.round(base * (crit ? this.consts.combat.critMult : 1)));
    tgt.health.hp -= amount;
    tgt.combat!.lastDamagedAt = now;
    this.broadcastEvent({ kind: "dmg", src: src.id, tgt: tgt.id, amount, crit }, tgt.pos.x, tgt.pos.z);

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
        if (winner) this.awardXp(winner, mobDef.xp);
        // loot: owner-locked to the top damage dealer for a grace window
        const rolled = rollLoot(this.reg, this.consts, mobDef.loot);
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
    } else if (tgt.kind === "player") {
      const session = this.sessions.get(tgt.id);
      if (session) this.dropPlayerInventory(session);
    }
  }

  /** Death drops: the entire inventory becomes a bag at the death spot. */
  private dropPlayerInventory(session: PlayerSession): void {
    const now = Date.now();
    const items = session.slots.filter((s): s is ItemStack => s !== null);
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
    session.dirtyInv = true;
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
      e.health!.maxHp = prog.baseHp + prog.hpPerLevel * (level - 1);
      e.health!.hp = e.health!.maxHp; // level-up full heal
      e.mana!.maxMana = prog.baseMana + prog.manaPerLevel * (level - 1);
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
    session.send({ t: "inv", slots: session.slots, held: session.held });
    session.dirtyInv = false;
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

  handleEquip(session: PlayerSession, slot: number): void {
    if (slot < 0 || slot >= HOTBAR_SIZE) return;
    session.held = slot;
    session.dirtyInv = true;
  }

  handleInvMove(session: PlayerSession, from: number, to: number): void {
    if (from < 0 || from >= INV_SIZE || to < 0 || to >= INV_SIZE || from === to) return;
    const a = session.slots[from] ?? null;
    const b = session.slots[to] ?? null;
    // merge same item+rarity stacks (rolled instances never merge), else swap
    if (a && b && a.item === b.item && a.rarity === b.rarity && a.dur === undefined && b.dur === undefined && a.stats === undefined && b.stats === undefined) {
      const max = this.reg.items[a.item]?.stack ?? 1;
      const take = Math.min(a.qty, max - b.qty);
      if (take > 0) {
        b.qty += take;
        a.qty -= take;
        session.slots[from] = a.qty > 0 ? a : null;
        session.dirtyInv = true;
        return;
      }
    }
    session.slots[from] = b;
    session.slots[to] = a;
    session.dirtyInv = true;
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
    }
    if (fx.cureDot) {
      e.combat!.dotPerSec = 0;
      e.combat!.dotUntil = 0;
      e.combat!.dotAcc = 0;
    }
    removeFromSlot(session.slots, slot, 1);
    session.dirtyInv = true;
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
    session.dirtyInv = true;
  }

  handlePickup(session: PlayerSession, id: number): void {
    const e = session.entity;
    if (e.combat!.act === "dead") return;
    const bag = this.entities.get(id);
    if (!bag || bag.kind !== "loot" || !bag.loot) return;
    const dist = Math.hypot(bag.pos.x - e.pos.x, bag.pos.z - e.pos.z);
    if (dist > this.consts.combat.pickupRange) return;
    const now = Date.now();
    if (bag.loot.owner && bag.loot.owner !== session.character.id && bag.loot.unlockAt > now) {
      this.system(session, "That loot belongs to someone else for a little longer.");
      return;
    }
    if (bag.loot.gold > 0) {
      session.gold += bag.loot.gold;
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
    session.dirtyInv = true;
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
    return (
      Math.hypot(e.pos.x - session.entity.pos.x, e.pos.z - session.entity.pos.z) <= this.consts.combat.talkRange + 1.0
    );
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
    session.send({ t: "dialog", id: entityId, name: npc.name, lines: npc.dialog, shop });
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
    session.dirtyInv = true;
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
    const price = Math.max(1, Math.floor(def.value * rarityMult * this.consts.combat.sellFraction)) * removed.qty;
    session.gold += price;
    session.dirtyStats = true;
    session.dirtyInv = true;
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
        session.dirtyInv = true;
        this.system(session, `Gave ${qty}x ${rarity} ${itemId}.`);
        break;
      }
      case "gold": {
        session.gold += Math.max(0, parseInt(args[0] ?? "0", 10) || 0);
        session.dirtyStats = true;
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
        const p = session.entity.pos;
        for (let i = 0; i < n; i++) {
          this.spawnMob(mobId, p.x + Math.sin(p.yaw) * 4 + (Math.random() - 0.5) * 2, p.z + Math.cos(p.yaw) * 4 + (Math.random() - 0.5) * 2, "");
        }
        this.system(session, `Spawned ${n}x ${mobId}.`);
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
    for (const e of aliveMobs) {
      if (!e.brain) continue;
      const def = this.reg.mobs[e.brain.mobId];
      if (!def) continue;
      // melee mobs can only land blows within the vertical reach; ranged
      // mobs aim with real pitch, so height barely matters to them
      const mobAbility = this.reg.abilities[def.ability];
      const reachY =
        mobAbility?.kind === "projectile" ? Number.POSITIVE_INFINITY : this.consts.combat.meleeVerticalReach;
      const decision = tickBrain(e, def, players, now, reachY);
      let moved = false;
      if (decision.move) {
        let speed = def.moveSpeed;
        if (e.combat!.slowUntil > now) speed *= 1 - e.combat!.slowPct;
        moved = applyMove(e, decision.move, speed, dt, this.world, this.def.size, this.waterLevel(), aliveMobs);
      }
      e.renderable.anim = moved ? "move" : "idle";
      if (decision.faceYaw !== null) e.pos.yaw = decision.faceYaw;
      if (decision.attack) this.mobAttack(e, decision.attack, now);
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

    // 5. player regen + food HoT
    for (const s of this.sessions.values()) {
      const e = s.entity;
      const c = e.combat!;
      if (c.act === "dead") continue;
      if (e.mana && e.mana.mana < e.mana.maxMana) {
        e.mana.mana = Math.min(e.mana.maxMana, e.mana.mana + this.consts.combat.manaRegenPerSec * dt);
      }
      if (e.health && e.health.hp < e.health.maxHp) {
        if (now - c.lastDamagedAt > this.consts.combat.regenDelayAfterDamageMs) {
          e.health.hp = Math.min(e.health.maxHp, e.health.hp + this.consts.combat.hpRegenPerSec * dt);
        }
        if (c.hotUntil > now) {
          e.health.hp = Math.min(e.health.maxHp, e.health.hp + c.hotPerSec * dt);
        }
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
          this.broadcastNear(p.x, p.z, { t: "projHit", id: p.id, x: p.x, y: p.y, z: p.z });
          alive = false;
          break;
        }
        // world hits: bounds, solid blocks, liquids (cross decos pass through)
        if (
          p.x < 0 || p.x > this.def.size.w || p.z < 0 || p.z > this.def.size.h || p.y < 0 ||
          this.world.solidAt(p.x, p.y, p.z) ||
          this.world.liquidAt(p.x, p.y, p.z)
        ) {
          this.broadcastNear(p.x, p.z, { t: "projHit", id: p.id, x: p.x, y: p.y, z: p.z });
          alive = false;
          break;
        }
        // entity hits
        const owner = this.entities.get(p.ownerId);
        const targets = owner ? this.targetsOf(owner) : [];
        for (const tgt of targets) {
          if (!projectileHits(p, tgt, this.consts.combat.projectileHitRadius)) continue;
          this.broadcastNear(p.x, p.z, { t: "projHit", id: p.id, x: p.x, y: p.y, z: p.z });
          if (owner) this.applyDamage(owner, tgt, p.damage);
          if (p.debuff && owner) this.applyDebuff(tgt, p.debuff, owner);
          alive = false;
          break;
        }
      }
      if (alive) survivors.push(p);
    }
    this.projectiles = survivors;
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
      level: s.entity.level ?? 1,
      xp: s.xp,
      gold: s.gold,
      inventory: s.slots,
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
