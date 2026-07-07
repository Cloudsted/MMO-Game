/**
 * Admin web dashboard API. The page itself lives in adminpage.ts (plain
 * HTML+JS, no build step); this module serves it at /admin and exposes the
 * ADMIN_KEY-gated JSON API under /api/admin/*. Everything is read from live
 * shard telemetry (heartbeats) or MongoDB — character writes are deliberately
 * NOT offered here: a connected client's periodic report would clobber them
 * (see "Known traps" in CLAUDE.md); use the in-game admin commands instead.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ObjectId } from "mongodb";
import { logSink } from "@fantasy-mmo/common";
import type { Collections } from "./db.js";
import type { ShardManager } from "./shards.js";
import { PAGE } from "./adminpage.js";

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

  json(res, 404, { error: "not found" });
  return true;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
