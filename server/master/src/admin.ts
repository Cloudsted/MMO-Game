/**
 * Admin web dashboard API. The page itself lives in adminpage.ts (plain
 * HTML+JS, no build step); this module serves it at /admin and exposes the
 * ADMIN_KEY-gated JSON API under /api/admin/*. Data comes from live shard
 * telemetry (heartbeats) or MongoDB. Character WRITES are allowed only while
 * the character is OFFLINE — a connected client's periodic report would
 * clobber them (see "Known traps" in CLAUDE.md); online players are managed
 * through the in-game admin commands or the teleport/kick controls here.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import {
  gameConstants,
  loadRoomDefs,
  logSink,
  makeLogger,
  mintItemFlat,
  mobAllAbilityIds,
  mobAttacks,
  readJsonFile,
  RegistryService,
  resolveMob,
  REPO_ROOT,
  type LootTable,
  type RoomDef,
} from "@fantasy-mmo/common";
import type { Collections } from "./db.js";
import type { ShardManager } from "./shards.js";
import { PAGE } from "./adminpage.js";

const log = makeLogger("master/admin");

/** Item registry for offline-character edits + economy analytics (the same
 *  shared JSON both runtimes load; the master only reads it). */
const reg = new RegistryService();

/** Mirrors INV_SIZE in server/shard/src/sim/loot.ts — inventory slot count. */
const INV_SIZE = 24;
const RARITIES = ["common", "uncommon", "rare", "epic"];

const LOG_LINES = 500;
const logBuffer: string[] = [];
logSink.push = (line) => {
  logBuffer.push(line);
  if (logBuffer.length > LOG_LINES) logBuffer.shift();
};

const masterStartedAt = Date.now();

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

// ====================================================================
// REGISTRY / WORLD-GRAPH DUMP — the dashboard's "one source of truth"
// view over shared/*.json + shared/rooms/*.json. Everything below is
// STATIC game data (defs, lore, computed reverse indexes); live status
// is layered on client-side from /api/admin/overview telemetry. Built
// once per process and rebuilt by POST /api/admin/registry/refresh
// (which also hot-reloads the registries, like in-game /reload).
// ====================================================================

const CLIENT_ASSETS = resolve(REPO_ROOT, "client", "assets");

interface DropLine {
  item: string;
  /** expected drops per table execution (weighted rolls + nested tables) */
  expected: number;
  /** minimum count per execution (comes from `guaranteed` slots only) */
  guaranteed: number;
  minRarity?: string;
}

interface TableExpectation {
  items: Map<string, { expected: number; guaranteed: number; minRarity?: string }>;
  goldMin: number;
  goldMax: number;
}

/** Expected item drops of a loot table, nested tables included — mirrors
 *  rollLoot() in the shard sim (weighted rolls + guaranteed slots, depth
 *  capped at 6 so authored cycles can't hang the dashboard). */
function tableExpectation(tableId: string, depth = 0): TableExpectation {
  const out: TableExpectation = { items: new Map(), goldMin: 0, goldMax: 0 };
  const table = reg.loot[tableId];
  if (!table || depth > 6) return out;
  out.goldMin += table.gold[0];
  out.goldMax += table.gold[1];
  const add = (item: string, expected: number, guaranteed: number, minRarity?: string) => {
    const cur = out.items.get(item) ?? { expected: 0, guaranteed: 0 };
    cur.expected += expected;
    cur.guaranteed += guaranteed;
    if (minRarity && !cur.minRarity) cur.minRarity = minRarity;
    out.items.set(item, cur);
  };
  const avgRolls = (table.rolls[0] + table.rolls[1]) / 2;
  const totalWeight = table.entries.reduce((a, e) => a + e.weight, 0) || 1;
  for (const e of table.entries) {
    const p = (e.weight / totalWeight) * avgRolls;
    if (e.item) {
      const avgQty = e.qty ? (e.qty[0] + e.qty[1]) / 2 : 1;
      add(e.item, p * avgQty, 0, e.minRarity);
    } else if (e.table) {
      const sub = tableExpectation(e.table, depth + 1);
      for (const [item, v] of sub.items) add(item, p * (v.expected + v.guaranteed), 0, e.minRarity ?? v.minRarity);
    }
  }
  for (const g of table.guaranteed) {
    if (g.item) {
      const avgQty = g.qty ? (g.qty[0] + g.qty[1]) / 2 : 1;
      add(g.item, 0, avgQty, g.minRarity);
    } else if (g.table) {
      const sub = tableExpectation(g.table, depth + 1);
      for (const [item, v] of sub.items) add(item, v.expected, v.guaranteed, g.minRarity ?? v.minRarity);
    }
  }
  return out;
}

function dropLines(tableId: string): DropLine[] {
  const exp = tableExpectation(tableId);
  return [...exp.items.entries()]
    .map(([item, v]) => ({ item, expected: Math.round(v.expected * 1000) / 1000, guaranteed: Math.round(v.guaranteed * 100) / 100, ...(v.minRarity ? { minRarity: v.minRarity } : {}) }))
    .sort((a, b) => b.guaranteed - a.guaranteed || b.expected - a.expected);
}

/** One compact ability summary line for kit displays. */
function abilityInfo(id: string) {
  const a = reg.abilities[id];
  if (!a) return { id, kind: "?", summary: "unknown ability" };
  const bits: string[] = [];
  if (a.kind === "melee") bits.push(`melee ${a.range ?? "?"}m${a.arcDeg ? ` ${a.arcDeg}°` : ""}`);
  if (a.kind === "projectile") bits.push(`projectile ${a.projSpeed ?? "?"}m/s → ${a.maxRange ?? "?"}m${a.predictive ? " predictive" : ""}${a.aoeRadius ? ` aoe ${a.aoeRadius}m` : ""}`);
  if (a.kind === "pillars" && a.pillars) bits.push(`${a.pillars.count} pillars × ${a.pillars.spacing}m`);
  if (a.kind === "self") bits.push("self");
  if (a.damage !== undefined) bits.push(`dmg ${a.damage}`);
  if (a.heal !== undefined) bits.push(`heal ${a.heal}`);
  if (a.debuff?.slowPct) bits.push(`slow ${Math.round(a.debuff.slowPct * 100)}%/${(a.debuff.durMs / 1000).toFixed(1)}s`);
  if (a.debuff?.dotTotal) bits.push(`dot ${a.debuff.dotTotal}/${(a.debuff.durMs / 1000).toFixed(1)}s`);
  if (a.summon) bits.push(`summons ${a.summon.count}× ${a.summon.mob} (cap ${a.summon.cap})`);
  if (a.allyHeal) bits.push(`heals allies ${a.allyHeal.amount} r${a.allyHeal.radius}`);
  if (a.cooldownMs) bits.push(`cd ${(a.cooldownMs / 1000).toFixed(1)}s`);
  return { id, kind: a.kind, summary: bits.join(" · ") };
}

interface RegistryDump {
  builtAt: number;
  mobs: unknown[];
  items: unknown[];
  loot: unknown[];
  abilities: unknown[];
  rooms: unknown[];
  graph: { nodes: unknown[]; edges: unknown[] };
  spriteMeta: unknown;
  iconMeta: unknown;
  rarities: unknown;
}

let dumpCache: RegistryDump | null = null;

function registryDump(): RegistryDump {
  if (!dumpCache) dumpCache = buildRegistryDump();
  return dumpCache;
}

/** exported for tests (registrydump.test.ts) — production goes through the cache */
export function buildRegistryDump(): RegistryDump {
  const rooms = loadRoomDefs();
  const scaling = gameConstants().mobs.scaling;

  // sprite sheet meta (frame grids) straight from the BUILT game assets —
  // the same client/assets/sprites/sprites.json SpriteLibrary reads, so the
  // bestiary crops frames with the game's own conventions. Absent when the
  // asset pipeline hasn't run (the page falls back to placeholders).
  let spriteMeta: unknown = null;
  try {
    spriteMeta = readJsonFile(resolve(CLIENT_ASSETS, "sprites", "sprites.json"));
  } catch {
    /* assets not built */
  }
  let iconMeta: unknown = null;
  try {
    iconMeta = readJsonFile(resolve(CLIENT_ASSETS, "ui", "icons.json"));
  } catch {
    /* assets not built */
  }

  // ---- per-mob: found-in (spawn tables incl. level overrides, resolved), event waves, summons ----
  type FoundIn = {
    roomId: string;
    roomName: string;
    table: string;
    weight: number;
    maxAlive: number;
    respawnSec: number;
    level: number;
    resolved: { name: string; level: number; hp: number; damage: number; xp: number; boss: boolean; loot: string; attacks: string[] };
  };
  const foundInByMob = new Map<string, FoundIn[]>();
  const eventWavesByMob = new Map<string, { roomId: string; roomName: string; eventId: string; count: number; level?: number }[]>();
  for (const def of rooms.values()) {
    for (const t of def.spawnTables) {
      for (const m of t.mobs) {
        const mobDef = reg.mobs[m.mob];
        if (!mobDef) continue;
        const r = resolveMob(mobDef, m.level, scaling);
        const list = foundInByMob.get(m.mob) ?? [];
        list.push({
          roomId: def.id,
          roomName: def.name,
          table: t.id,
          weight: m.weight,
          maxAlive: t.maxAlive,
          respawnSec: t.respawnSec,
          level: r.level,
          resolved: {
            name: r.name,
            level: r.level,
            hp: r.hp,
            damage: r.damage,
            xp: r.xp,
            boss: r.boss,
            loot: r.loot,
            attacks: r.attacks.map((a) => a.ability),
          },
        });
        foundInByMob.set(m.mob, list);
      }
    }
    for (const ev of def.events) {
      for (const a of ev.actions) {
        if (a.kind === "spawnMobs") {
          const list = eventWavesByMob.get(a.mob) ?? [];
          list.push({ roomId: def.id, roomName: def.name, eventId: ev.id, count: a.count, ...(a.level !== undefined ? { level: a.level } : {}) });
          eventWavesByMob.set(a.mob, list);
        }
      }
    }
  }
  // abilities that summon a mob → the mobs that can cast them
  const summonedBy = new Map<string, string[]>();
  for (const [mobId, def] of Object.entries(reg.mobs)) {
    for (const abilityId of mobAllAbilityIds(def)) {
      const spec = reg.abilities[abilityId]?.summon;
      if (!spec) continue;
      const list = summonedBy.get(spec.mob) ?? [];
      if (!list.includes(mobId)) list.push(mobId);
      summonedBy.set(spec.mob, list);
    }
  }

  const mobs = Object.entries(reg.mobs).map(([id, def]) => {
    // every loot table this def can pay out (base + rank overrides)
    const lootTables = [...new Set([def.loot, ...def.ranks.filter((r) => r.loot).map((r) => r.loot!)])];
    return {
      id,
      name: def.name,
      lore: def.lore ?? null,
      sprite: def.sprite,
      level: def.level,
      hp: def.hp,
      damage: def.damage,
      moveSpeed: def.moveSpeed,
      xp: def.xp,
      boss: def.boss ?? false,
      aggroRadius: def.aggroRadius,
      attackRange: def.attackRange,
      leashRadius: def.leashRadius,
      fleeAtHpPct: def.fleeAtHpPct,
      loot: def.loot,
      kit: mobAttacks(def).map((a) => ({ ...abilityInfo(a.ability), ...(a.damage !== undefined ? { damage: a.damage } : {}), ...(a.minRange !== undefined ? { minRange: a.minRange } : {}) })),
      ranks: def.ranks.map((r) => ({
        atLevel: r.atLevel,
        name: r.name ?? null,
        titleSuffix: r.titleSuffix ?? null,
        lore: r.lore ?? null,
        boss: r.boss ?? null,
        hpMult: r.hpMult,
        damageMult: r.damageMult,
        xpMult: r.xpMult,
        moveSpeedMult: r.moveSpeedMult,
        add: r.add.map((a) => a.ability),
        remove: r.remove,
        loot: r.loot ?? null,
        disposition: {
          ...(r.aggroRadius !== undefined ? { aggroRadius: r.aggroRadius } : {}),
          ...(r.leashRadius !== undefined ? { leashRadius: r.leashRadius } : {}),
          ...(r.attackRange !== undefined ? { attackRange: r.attackRange } : {}),
          ...(r.fleeAtHpPct !== undefined ? { fleeAtHpPct: r.fleeAtHpPct } : {}),
        },
      })),
      foundIn: foundInByMob.get(id) ?? [],
      eventWaves: eventWavesByMob.get(id) ?? [],
      summonedBy: summonedBy.get(id) ?? [],
      drops: lootTables.map((t) => ({ table: t, gold: reg.loot[t]?.gold ?? [0, 0], lines: dropLines(t) })),
    };
  });

  // ---- items: reverse indexes (dropped-by, sold-by, table refs) ----
  const tableContents = new Map<string, Set<string>>(); // table → transitively reachable items
  for (const tableId of Object.keys(reg.loot)) {
    tableContents.set(tableId, new Set(tableExpectation(tableId).items.keys()));
  }
  const directTablesByItem = new Map<string, string[]>();
  for (const [tableId, table] of Object.entries(reg.loot)) {
    for (const e of [...table.entries, ...table.guaranteed]) {
      if (!e.item) continue;
      const list = directTablesByItem.get(e.item) ?? [];
      if (!list.includes(tableId)) list.push(tableId);
      directTablesByItem.set(e.item, list);
    }
  }
  const soldByItem = new Map<string, { roomId: string; npc: string }[]>();
  const enchanters: { roomId: string; npc: string; maxTier: number }[] = [];
  for (const def of rooms.values()) {
    for (const npc of def.npcs) {
      if (npc.service?.kind === "enchant") enchanters.push({ roomId: def.id, npc: npc.name, maxTier: npc.service.maxTier });
      if (!npc.shop) continue;
      for (const itemId of npc.shop.items) {
        const list = soldByItem.get(itemId) ?? [];
        list.push({ roomId: def.id, npc: npc.name });
        soldByItem.set(itemId, list);
      }
    }
  }
  const items = Object.entries(reg.items).map(([id, def]) => {
    const droppedBy: { mob: string; name: string; guaranteed: boolean }[] = [];
    for (const m of mobs as { id: string; name: string; drops: { table: string; lines: DropLine[] }[] }[]) {
      let guaranteed = false;
      let drops = false;
      for (const d of m.drops) {
        const line = d.lines.find((l) => l.item === id);
        if (line) {
          drops = true;
          if (line.guaranteed >= 1) guaranteed = true;
        }
      }
      if (drops) droppedBy.push({ mob: m.id, name: m.name, guaranteed });
    }
    const caches = [...tableContents.entries()].filter(([t, set]) => t.startsWith("cache_") && set.has(id)).map(([t]) => t);
    return {
      id,
      name: def.name,
      desc: def.desc ?? null,
      kind: def.kind,
      tier: def.tier ?? (def.kind === "weapon" || def.kind === "armor" || def.kind === "trinket" ? 1 : null),
      value: def.value,
      stack: def.stack,
      icon: def.icon,
      damage: def.damage ?? null,
      armor: def.armor ?? null,
      slot: def.slot ?? null,
      durability: def.durability ?? null,
      block: def.block ?? null,
      ability: def.ability ? abilityInfo(def.ability) : null,
      effect: def.effect ?? null,
      droppedBy,
      inTables: directTablesByItem.get(id) ?? [],
      inCaches: caches,
      soldBy: soldByItem.get(id) ?? [],
    };
  });

  // ---- loot tables: full tree + used-by ----
  const usedByTable = new Map<string, { mobs: string[]; tables: string[] }>();
  const useOf = (t: string) => {
    const u = usedByTable.get(t) ?? { mobs: [], tables: [] };
    usedByTable.set(t, u);
    return u;
  };
  for (const [mobId, def] of Object.entries(reg.mobs)) {
    if (!useOf(def.loot).mobs.includes(mobId)) useOf(def.loot).mobs.push(mobId);
    for (const r of def.ranks) {
      if (r.loot && !useOf(r.loot).mobs.includes(mobId)) useOf(r.loot).mobs.push(`${mobId}@${r.atLevel}`);
    }
  }
  for (const [tableId, table] of Object.entries(reg.loot)) {
    for (const e of [...table.entries, ...table.guaranteed]) {
      if (e.table && !useOf(e.table).tables.includes(tableId)) useOf(e.table).tables.push(tableId);
    }
  }
  const lootDump = Object.entries(reg.loot).map(([id, table]: [string, LootTable]) => ({
    id,
    gold: table.gold,
    rolls: table.rolls,
    entries: table.entries.map((e) => ({ ...e })),
    guaranteed: table.guaranteed.map((e) => ({ ...e })),
    totalWeight: table.entries.reduce((a, e) => a + e.weight, 0),
    lines: dropLines(id),
    usedBy: usedByTable.get(id) ?? { mobs: [], tables: [] },
  }));

  // ---- abilities: reference table + used-by ----
  const abilityUsers = new Map<string, { mobs: string[]; items: string[] }>();
  const usersOf = (a: string) => {
    const u = abilityUsers.get(a) ?? { mobs: [], items: [] };
    abilityUsers.set(a, u);
    return u;
  };
  for (const [mobId, def] of Object.entries(reg.mobs)) {
    for (const a of mobAllAbilityIds(def)) if (!usersOf(a).mobs.includes(mobId)) usersOf(a).mobs.push(mobId);
  }
  for (const [itemId, def] of Object.entries(reg.items)) {
    if (def.ability && !usersOf(def.ability).items.includes(itemId)) usersOf(def.ability).items.push(itemId);
  }
  const abilities = Object.entries(reg.abilities).map(([id, a]) => ({
    id,
    kind: a.kind,
    dmgClass: a.dmgClass ?? (a.kind === "melee" ? "melee" : a.kind === "projectile" || a.kind === "pillars" ? "magic" : null),
    summary: abilityInfo(id).summary,
    windupMs: a.windupMs ?? null,
    castTimeMs: a.castTimeMs ?? null,
    recoverMs: a.recoverMs,
    cooldownMs: a.cooldownMs,
    manaCost: a.manaCost,
    range: a.range ?? a.maxRange ?? null,
    damage: a.damage ?? null,
    heal: a.heal ?? null,
    interruptible: a.interruptible,
    canMoveWhile: a.canMoveWhile,
    fx: a.fx,
    usedBy: abilityUsers.get(id) ?? { mobs: [], items: [] },
  }));

  // ---- rooms: everything the detail panel needs (static side) ----
  const roomsDump = [...rooms.values()].map((d: RoomDef) => ({
    id: d.id,
    name: d.name,
    lore: d.lore ?? null,
    type: d.type,
    biome: d.biome,
    levelBand: d.levelBand ?? null,
    persistence: d.persistence,
    size: d.size,
    spawn: d.spawn,
    wind: d.wind,
    nightLight: d.nightLight,
    fixedTime: d.fixedTime ?? null,
    lifecycle: d.lifecycle ?? null,
    flags: d.flags,
    regions: d.regions,
    portals: d.portals.map((p) => {
      const gateEvent = d.events.find((ev) => ev.actions.some((a) => a.kind === "openPortal" && a.portalId === p.id));
      const gateMob = gateEvent && gateEvent.on.kind === "bossDeath" ? gateEvent.on.mob : gateEvent?.on.mob;
      return {
        id: p.id,
        label: p.label,
        target: p.target,
        x: p.x,
        z: p.z,
        oneWay: !p.exitPortalId && p.exitX !== undefined && p.exitZ !== undefined,
        exitPortalId: p.exitPortalId ?? null,
        gate: gateEvent ? { eventId: gateEvent.id, mob: gateMob, mobName: reg.mobs[gateMob ?? ""]?.name ?? gateMob } : null,
      };
    }),
    spawnTables: d.spawnTables.map((t) => ({
      id: t.id,
      region: t.region,
      maxAlive: t.maxAlive,
      packSize: t.packSize,
      respawnSec: t.respawnSec,
      mobs: t.mobs.map((m) => {
        const def = reg.mobs[m.mob];
        const r = def ? resolveMob(def, m.level, scaling) : null;
        return {
          mob: m.mob,
          weight: m.weight,
          level: m.level ?? def?.level ?? 0,
          resolved: r ? { name: r.name, level: r.level, hp: r.hp, damage: r.damage, xp: r.xp, boss: r.boss } : null,
        };
      }),
    })),
    events: d.events.map((ev) => ({
      id: ev.id,
      on: ev.on,
      onMobName: reg.mobs[ev.on.mob]?.name ?? ev.on.mob,
      actions: ev.actions,
    })),
    npcs: d.npcs.map((n) => ({
      id: n.id,
      name: n.name,
      sprite: n.sprite,
      x: n.x,
      z: n.z,
      dialog: n.dialog,
      shop: n.shop ? { items: n.shop.items, buys: n.shop.buys } : null,
      service: n.service ?? null,
    })),
    prefabs: d.prefabs.map((p) => ({ prefab: p.prefab, count: p.count, bindSpawnTable: p.bindSpawnTable ?? null })),
    enchanters: d.npcs.filter((n) => n.service?.kind === "enchant").map((n) => n.name),
  }));

  // ---- world graph: nodes + edges from portal defs (static; live overlay page-side) ----
  const nodes = roomsDump.map((r) => ({
    id: r.id,
    name: r.name,
    levelBand: r.levelBand,
    type: r.type,
    persistence: r.persistence,
    safe: r.flags.safeZone,
    building: r.flags.buildingEnabled,
    cycling: r.lifecycle ? { downtimeSec: r.lifecycle.downtimeSec } : null,
    bosses: [
      ...new Set(
        r.spawnTables
          .flatMap((t) => t.mobs)
          .filter((m) => m.resolved?.boss)
          .map((m) => m.resolved!.name)
      ),
    ],
  }));
  const edges = roomsDump.flatMap((r) =>
    r.portals.map((p) => ({
      from: r.id,
      to: p.target,
      portalId: p.id,
      label: p.label,
      oneWay: p.oneWay,
      gate: p.gate,
    }))
  );

  return {
    builtAt: Date.now(),
    mobs,
    items,
    loot: lootDump,
    abilities,
    rooms: roomsDump,
    graph: { nodes, edges },
    spriteMeta,
    iconMeta,
    rarities: reg.rarities,
  };
}

/** ADMIN_KEY-gated static asset serving for the dashboard (sprite sheets +
 *  the icon atlas) straight from the BUILT game assets. Names are sanitized
 *  against an allowlist derived from the registries — no path traversal. */
function serveAsset(res: ServerResponse, url: URL): boolean {
  const path = url.pathname;
  let file: string | null = null;
  if (path === "/api/admin/asset/icons") {
    file = resolve(CLIENT_ASSETS, "ui", "icons.png");
  } else if (path === "/api/admin/asset/sprite") {
    const sheet = url.searchParams.get("sheet") ?? "";
    // allowlist: strict token shape AND known to the registries/asset meta
    const known =
      /^[a-z0-9_]{1,64}$/.test(sheet) &&
      (Object.values(reg.mobs).some((m) => m.sprite === sheet) ||
        [...loadRoomDefs().values()].some((r) => r.npcs.some((n) => n.sprite === sheet)) ||
        sheet === "player");
    if (!known) {
      json(res, 400, { error: "unknown sprite sheet" });
      return true;
    }
    file = resolve(CLIENT_ASSETS, "sprites", `${sheet}.png`);
  } else {
    return false;
  }
  if (!existsSync(file)) {
    json(res, 404, { error: "asset not built (run tools/build-assets.mjs)" });
    return true;
  }
  const bytes = readFileSync(file);
  res.writeHead(200, { "content-type": "image/png", "content-length": bytes.length, "cache-control": "private, max-age=60" });
  res.end(bytes);
  return true;
}

/** Handles /admin* routes. Returns true when the request was handled. */
export async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  shards: ShardManager,
  cols: Collections,
  adminKey: string
): Promise<boolean> {
  const path = url.pathname;
  if (!path.startsWith("/admin") && !path.startsWith("/api/admin")) return false;

  if (path === "/admin") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return true;
  }

  // API routes below require the key (an unset ADMIN_KEY locks the API out
  // entirely — an empty string must never act as a valid key)
  if (!adminKey || url.searchParams.get("key") !== adminKey) {
    json(res, 401, { error: "bad admin key" });
    return true;
  }
  const method = req.method ?? "GET";
  const q = (name: string) => url.searchParams.get(name) ?? "";

  if (path === "/api/admin/logs") {
    json(res, 200, { lines: logBuffer });
    return true;
  }

  if (path === "/api/admin/overview") {
    const [accounts, characters, sessions, roomStates] = await Promise.all([
      cols.accounts.estimatedDocumentCount(),
      cols.characters.estimatedDocumentCount(),
      cols.sessions.estimatedDocumentCount(),
      cols.roomStates.estimatedDocumentCount(),
    ]);
    json(res, 200, {
      master: {
        pid: process.pid,
        memMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        uptimeSec: Math.round(process.uptime()),
        startedAt: masterStartedAt,
        node: process.version,
      },
      db: { accounts, characters, sessions, roomStates },
      ...shards.adminOverview(),
    });
    return true;
  }

  if (path === "/api/admin/history") {
    json(res, 200, { samples: shards.historySamples() });
    return true;
  }

  if (path === "/api/admin/players") {
    json(res, 200, { players: shards.livePlayers() });
    return true;
  }

  if (path === "/api/admin/characters") {
    const query = q("q") ? { name: { $regex: escapeRegex(q("q")), $options: "i" } } : {};
    const limit = Math.min(200, Number(q("limit")) || 50);
    const list = await cols.characters
      .find(query)
      .sort({ level: -1, name: 1 })
      .limit(limit)
      .toArray();
    const accountIds = [...new Set(list.map((c) => c.accountId.toHexString()))].map((id) => new ObjectId(id));
    const accounts = await cols.accounts.find({ _id: { $in: accountIds } }).toArray();
    const nameByAccount = new Map(accounts.map((a) => [a._id!.toHexString(), a.username]));
    const online = new Set(shards.livePlayers().map((p) => p.charId));
    json(res, 200, {
      characters: list.map((c) => ({
        id: c._id!.toHexString(),
        name: c.name,
        level: c.level,
        xp: c.xp,
        gold: c.gold,
        roomId: c.roomId,
        x: c.x,
        y: c.y,
        z: c.z,
        account: nameByAccount.get(c.accountId.toHexString()) ?? "?",
        createdAt: c.createdAt,
        online: online.has(c._id!.toHexString()),
        items: c.inventory.filter(Boolean).length,
      })),
    });
    return true;
  }

  if (path === "/api/admin/character") {
    if (!ObjectId.isValid(q("id"))) {
      json(res, 400, { error: "bad character id" });
      return true;
    }
    const c = await cols.characters.findOne({ _id: new ObjectId(q("id")) });
    if (!c) {
      json(res, 404, { error: "character not found" });
      return true;
    }
    const account = await cols.accounts.findOne({ _id: c.accountId });
    const online = shards.livePlayers().find((p) => p.charId === c._id!.toHexString()) ?? null;
    json(res, 200, {
      character: {
        id: c._id!.toHexString(),
        name: c.name,
        level: c.level,
        xp: c.xp,
        gold: c.gold,
        roomId: c.roomId,
        x: c.x,
        y: c.y,
        z: c.z,
        yaw: c.yaw,
        inventory: c.inventory,
        equipment: c.equipment ?? [],
        account: account?.username ?? "?",
        roles: account?.roles ?? [],
        createdAt: c.createdAt,
        online,
      },
    });
    return true;
  }

  if (path === "/api/admin/accounts") {
    const query = q("q") ? { username: { $regex: escapeRegex(q("q")), $options: "i" } } : {};
    const list = await cols.accounts.find(query).sort({ createdAt: -1 }).limit(100).toArray();
    const ids = list.map((a) => a._id!);
    const chars = await cols.characters.find({ accountId: { $in: ids } }).toArray();
    const byAccount = new Map<string, string[]>();
    for (const c of chars) {
      const key = c.accountId.toHexString();
      (byAccount.get(key) ?? byAccount.set(key, []).get(key)!).push(c.name);
    }
    json(res, 200, {
      accounts: list.map((a) => ({
        id: a._id!.toHexString(),
        username: a.username,
        roles: a.roles,
        createdAt: a.createdAt,
        characters: byAccount.get(a._id!.toHexString()) ?? [],
      })),
    });
    return true;
  }

  if (path === "/api/admin/set-role" && method === "POST") {
    const accountId = q("accountId");
    const grant = q("grant") === "1";
    // only the admin role exists today; refuse arbitrary role strings
    if (q("role") !== "admin" || !ObjectId.isValid(accountId)) {
      json(res, 400, { error: "bad role or account id" });
      return true;
    }
    const update = grant ? { $addToSet: { roles: "admin" } } : { $pull: { roles: "admin" } };
    const r = await cols.accounts.updateOne({ _id: new ObjectId(accountId) }, update as never);
    json(res, r.matchedCount ? 200 : 404, r.matchedCount ? { ok: true } : { error: "account not found" });
    return true;
  }

  if (path === "/api/admin/roomstate") {
    const doc = await cols.roomStates.findOne({ roomId: q("roomId") });
    if (!doc) {
      json(res, 404, { error: "no persisted state for that room" });
      return true;
    }
    const st = doc.state;
    json(res, 200, {
      roomId: q("roomId"),
      savedAt: st.savedAt,
      updatedAt: doc.updatedAt,
      timeOfDay: st.timeOfDay,
      blockEdits: st.blocks.length,
      spawnersPending: Object.fromEntries(Object.entries(st.spawners).map(([id, ats]) => [id, ats.length])),
      caches: st.caches,
      drops: st.drops.slice(0, 50).map((d) => ({
        x: Math.round(d.x * 10) / 10,
        y: Math.round(d.y * 10) / 10,
        z: Math.round(d.z * 10) / 10,
        gold: d.gold,
        items: d.items.map((i) => (i.qty > 1 ? `${i.item} x${i.qty}` : i.item)),
        owner: d.owner,
        expireAt: d.expireAt,
      })),
      dropsTotal: st.drops.length,
    });
    return true;
  }

  if (path === "/api/admin/broadcast" && method === "POST") {
    const text = q("text").trim().slice(0, 300);
    if (!text) {
      json(res, 400, { error: "text required" });
      return true;
    }
    shards.broadcast("[SERVER]", text);
    json(res, 200, { ok: true });
    return true;
  }

  if (path === "/api/admin/kick" && method === "POST") {
    const ok = shards.kickPlayer(q("roomId"), q("characterId"), q("reason") || "kicked by an admin");
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "room not assigned" });
    return true;
  }

  if (path === "/api/admin/restart-room" && method === "POST") {
    const ok = shards.closeRoomAdmin(q("roomId"));
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "room not assigned" });
    return true;
  }

  if (path === "/api/admin/map") {
    const roomId = q("roomId");
    const map = shards.roomMap(roomId);
    if (map) {
      json(res, 200, map);
    } else {
      // cache miss (master restarted after the room opened): ask for a push
      // and let the page retry in a moment
      const asked = shards.requestMap(roomId);
      json(res, asked ? 202 : 404, asked ? { pending: true } : { error: "room not assigned" });
    }
    return true;
  }

  if (path === "/api/admin/teleport" && method === "POST") {
    const roomId = q("roomId"); // room the player is in NOW
    const targetRoomId = q("targetRoomId") || roomId;
    const x = q("x") === "" ? undefined : Number(q("x"));
    const z = q("z") === "" ? undefined : Number(q("z"));
    if ((x !== undefined && !isFinite(x)) || (z !== undefined && !isFinite(z))) {
      json(res, 400, { error: "bad coordinates" });
      return true;
    }
    if (roomId === targetRoomId && (x === undefined || z === undefined)) {
      json(res, 400, { error: "same-room teleport needs x and z" });
      return true;
    }
    const ok = shards.adminMove(roomId, q("characterId"), targetRoomId, x, z);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "room not assigned or unknown target" });
    return true;
  }

  if (path === "/api/admin/items") {
    json(res, 200, {
      items: Object.entries(reg.items).map(([id, def]) => ({
        id,
        label: def.name,
        kind: def.kind,
        value: def.value,
      })),
    });
    return true;
  }

  // ---- registry / world-graph / lore (static game data; see buildRegistryDump) ----

  if (path.startsWith("/api/admin/asset/")) {
    if (serveAsset(res, url)) return true;
  }

  if (path === "/api/admin/registry/mobs") {
    const d = registryDump();
    json(res, 200, { builtAt: d.builtAt, mobs: d.mobs, spriteMeta: d.spriteMeta });
    return true;
  }
  if (path === "/api/admin/registry/items") {
    const d = registryDump();
    json(res, 200, { builtAt: d.builtAt, items: d.items, iconMeta: d.iconMeta, rarities: d.rarities });
    return true;
  }
  if (path === "/api/admin/registry/loot") {
    const d = registryDump();
    json(res, 200, { builtAt: d.builtAt, tables: d.loot });
    return true;
  }
  if (path === "/api/admin/registry/abilities") {
    const d = registryDump();
    json(res, 200, { builtAt: d.builtAt, abilities: d.abilities });
    return true;
  }
  if (path === "/api/admin/registry/rooms") {
    const d = registryDump();
    json(res, 200, { builtAt: d.builtAt, rooms: d.rooms });
    return true;
  }
  if (path === "/api/admin/registry/lore") {
    json(res, 200, { lore: reg.lore });
    return true;
  }
  if (path === "/api/admin/graph") {
    const d = registryDump();
    json(res, 200, { builtAt: d.builtAt, ...d.graph });
    return true;
  }
  if (path === "/api/admin/registry/refresh" && method === "POST") {
    try {
      reg.reload();
      dumpCache = null;
      log.info("admin dashboard: registries reloaded + dump rebuilt");
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  // ---- offline-character editing (online = 409: live reports would clobber it) ----

  if (path.startsWith("/api/admin/character-") && method === "POST") {
    if (!ObjectId.isValid(q("id"))) {
      json(res, 400, { error: "bad character id" });
      return true;
    }
    const _id = new ObjectId(q("id"));
    const character = await cols.characters.findOne({ _id });
    if (!character) {
      json(res, 404, { error: "character not found" });
      return true;
    }
    if (shards.livePlayers().some((p) => p.charId === q("id"))) {
      json(res, 409, { error: "character is online — edits would be overwritten by live reports" });
      return true;
    }

    if (path === "/api/admin/character-edit") {
      const set: Record<string, unknown> = {};
      const fields: Array<[string, number, number]> = [
        ["gold", 0, 1_000_000_000],
        ["level", 1, 99],
        ["xp", 0, 1_000_000_000],
      ];
      for (const [name, min, max] of fields) {
        if (q(name) === "") continue;
        const v = Math.floor(Number(q(name)));
        if (!isFinite(v) || v < min || v > max) {
          json(res, 400, { error: `bad ${name}` });
          return true;
        }
        set[name] = v;
      }
      if (Object.keys(set).length === 0) {
        json(res, 400, { error: "nothing to change" });
        return true;
      }
      await cols.characters.updateOne({ _id }, { $set: set });
      log.info(`admin edited ${character.name}: ${JSON.stringify(set)}`);
      json(res, 200, { ok: true });
      return true;
    }

    if (path === "/api/admin/character-item-add") {
      const itemId = q("item");
      const def = reg.items[itemId];
      if (!def) {
        json(res, 400, { error: `unknown item '${itemId}'` });
        return true;
      }
      const rarity = q("rarity") || "common";
      if (!RARITIES.includes(rarity)) {
        json(res, 400, { error: "bad rarity" });
        return true;
      }
      // weapons are per-instance (durability) — never stacked. FLAT mint
      // (owner 2026-07-11): admin-granted items carry exact base stats, no
      // rolls, no mod lottery — same as the shop and /give.
      const qty = def.kind === "weapon" ? 1 : Math.min(99, Math.max(1, Math.floor(Number(q("qty")) || 1)));
      const stack = mintItemFlat(reg, gameConstants(), itemId, qty, rarity);
      const inventory = [...character.inventory];
      let slot = inventory.findIndex((s) => s === null);
      if (slot < 0 && inventory.length < INV_SIZE) {
        slot = inventory.length;
        inventory.push(null);
      }
      if (slot < 0) {
        json(res, 400, { error: "inventory full" });
        return true;
      }
      inventory[slot] = stack;
      await cols.characters.updateOne({ _id }, { $set: { inventory } });
      log.info(`admin gave ${character.name}: ${qty}x ${rarity} ${itemId}`);
      json(res, 200, { ok: true });
      return true;
    }

    if (path === "/api/admin/character-item-remove") {
      const slot = Math.floor(Number(q("slot")));
      if (!isFinite(slot) || slot < 0 || slot >= character.inventory.length || !character.inventory[slot]) {
        json(res, 400, { error: "bad slot" });
        return true;
      }
      const removed = character.inventory[slot]!;
      const inventory = [...character.inventory];
      inventory[slot] = null;
      await cols.characters.updateOne({ _id }, { $set: { inventory } });
      log.info(`admin removed from ${character.name}: slot ${slot} (${removed.item})`);
      json(res, 200, { ok: true });
      return true;
    }
  }

  if (path === "/api/admin/economy") {
    const [goldAgg, topWealth, itemsAgg, rarityAgg, levelAgg, states] = await Promise.all([
      cols.characters
        .aggregate<{ _id: null; total: number; avg: number; max: number; count: number }>([
          { $group: { _id: null, total: { $sum: "$gold" }, avg: { $avg: "$gold" }, max: { $max: "$gold" }, count: { $sum: 1 } } },
        ])
        .toArray(),
      cols.characters.find().sort({ gold: -1 }).limit(10).project({ name: 1, gold: 1, level: 1 }).toArray(),
      cols.characters
        .aggregate<{ _id: string; qty: number; stacks: number }>([
          { $unwind: "$inventory" },
          { $match: { inventory: { $ne: null } } },
          { $group: { _id: "$inventory.item", qty: { $sum: "$inventory.qty" }, stacks: { $sum: 1 } } },
          { $sort: { qty: -1 } },
        ])
        .toArray(),
      cols.characters
        .aggregate<{ _id: string; qty: number }>([
          { $unwind: "$inventory" },
          { $match: { inventory: { $ne: null } } },
          { $group: { _id: "$inventory.rarity", qty: { $sum: "$inventory.qty" } } },
        ])
        .toArray(),
      cols.characters
        .aggregate<{ _id: number; count: number }>([{ $group: { _id: "$level", count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
        .toArray(),
      cols.roomStates.find().toArray(),
    ]);
    // gold + items sitting in dropped bags (persisted room state)
    let floorGold = 0;
    let floorBags = 0;
    let floorItems = 0;
    for (const st of states) {
      for (const d of st.state.drops) {
        floorBags++;
        floorGold += d.gold;
        for (const i of d.items) floorItems += i.qty;
      }
    }
    const gold = goldAgg[0] ?? { total: 0, avg: 0, max: 0, count: 0 };
    json(res, 200, {
      gold: { total: gold.total, avg: Math.round(gold.avg ?? 0), max: gold.max, characters: gold.count },
      floor: { gold: floorGold, bags: floorBags, items: floorItems },
      topWealth: topWealth.map((c) => ({ name: c.name, gold: c.gold, level: c.level })),
      items: itemsAgg.map((i) => ({
        item: i._id,
        qty: i.qty,
        stacks: i.stacks,
        label: reg.items[i._id]?.name ?? i._id,
        kind: reg.items[i._id]?.kind ?? "?",
        value: reg.items[i._id]?.value ?? 0,
      })),
      rarities: Object.fromEntries(rarityAgg.map((r) => [r._id, r.qty])),
      levels: levelAgg.map((l) => ({ level: l._id, count: l.count })),
    });
    return true;
  }

  json(res, 404, { error: "not found" });
  return true;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
