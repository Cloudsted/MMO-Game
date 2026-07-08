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
import { ObjectId } from "mongodb";
import { gameConstants, logSink, makeLogger, mintItem, RegistryService } from "@fantasy-mmo/common";
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
      // weapons are per-instance (stat rolls + durability) — never stacked
      const qty = def.kind === "weapon" ? 1 : Math.min(99, Math.max(1, Math.floor(Number(q("qty")) || 1)));
      const stack = mintItem(reg, gameConstants(), itemId, qty, rarity);
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
