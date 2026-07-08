import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { ObjectId } from "mongodb";
import { makeLogger } from "@fantasy-mmo/common";
import type { Collections, AccountDoc, CharacterDoc } from "./db.js";
import { register, login, authenticate, AuthError } from "./auth.js";
import { handleAdmin } from "./admin.js";
import type { ShardManager } from "./shards.js";

const log = makeLogger("master/http");

const CHARNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,15}$/;
const MAX_CHARACTERS_PER_ACCOUNT = 8;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 64 * 1024) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function characterView(c: CharacterDoc) {
  return { id: c._id!.toHexString(), name: c.name, level: c.level, xp: c.xp, gold: c.gold, roomId: c.roomId };
}

export function createHttpServer(cols: Collections, shards: ShardManager): Server {
  return createServer(async (req, res) => {
    try {
      await route(req, res, cols, shards);
    } catch (e) {
      if (e instanceof AuthError) return json(res, 400, { error: e.message });
      log.error(`${req.method} ${req.url}`, e);
      json(res, 500, { error: "internal error" });
    }
  });
}

async function route(req: IncomingMessage, res: ServerResponse, cols: Collections, shards: ShardManager): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/api/status") {
    return json(res, 200, { ok: true, ...shards.status() });
  }

  // admin panel + admin API (ADMIN_KEY-gated inside)
  if (await handleAdmin(req, res, url, shards, cols, process.env.ADMIN_KEY ?? "")) return;

  if (method === "POST" && path === "/api/register") {
    const body = JSON.parse(await readBody(req));
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return json(res, 400, { error: "username and password required" });
    }
    await register(cols, body.username, body.password);
    log.info(`registered account ${body.username}`);
    return json(res, 200, { ok: true });
  }

  if (method === "POST" && path === "/api/login") {
    const body = JSON.parse(await readBody(req));
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return json(res, 400, { error: "username and password required" });
    }
    const { token, account } = await login(cols, body.username, body.password);
    log.info(`login ${account.username}`);
    return json(res, 200, {
      token,
      account: { id: account._id!.toHexString(), username: account.username, roles: account.roles },
    });
  }

  // ---- authenticated routes ----
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const account = await authenticate(cols, token);
  if (!account) return json(res, 401, { error: "not authenticated" });

  if (method === "GET" && path === "/api/characters") {
    const list = await cols.characters.find({ accountId: account._id! }).toArray();
    return json(res, 200, { characters: list.map(characterView) });
  }

  if (method === "POST" && path === "/api/characters") {
    const body = JSON.parse(await readBody(req));
    if (typeof body.name !== "string" || !CHARNAME_RE.test(body.name)) {
      return json(res, 400, { error: "name must be 3-16 chars, start with a letter (letters/digits/underscore)" });
    }
    const count = await cols.characters.countDocuments({ accountId: account._id! });
    if (count >= MAX_CHARACTERS_PER_ACCOUNT) return json(res, 400, { error: "character limit reached" });
    const doc: CharacterDoc = {
      accountId: account._id!,
      name: body.name,
      level: 1,
      xp: 0,
      gold: 25,
      // starter kit: a blade and a meal — enough to tag your first slime
      inventory: [
        { item: "rusty_sword", qty: 1, rarity: "common" },
        { item: "bread", qty: 3, rarity: "common" },
      ],
      equipment: [],
      roomId: "hub",
      x: null,
      y: null,
      z: null,
      yaw: 0,
      createdAt: new Date(),
    };
    try {
      const r = await cols.characters.insertOne(doc);
      doc._id = r.insertedId;
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && (e as { code?: number }).code === 11000) {
        return json(res, 400, { error: "character name already taken" });
      }
      throw e;
    }
    log.info(`character created: ${doc.name} (${account.username})`);
    return json(res, 200, { character: characterView(doc) });
  }

  if (method === "POST" && path === "/api/enter") {
    const body = JSON.parse(await readBody(req));
    if (typeof body.characterId !== "string" || !ObjectId.isValid(body.characterId)) {
      return json(res, 400, { error: "characterId required" });
    }
    const character = await cols.characters.findOne({ _id: new ObjectId(body.characterId), accountId: account._id! });
    if (!character) return json(res, 404, { error: "character not found" });
    const grant = shards.mintTicket(character, account.roles, character.roomId);
    if (!grant) return json(res, 503, { error: "world is not available yet (no live rooms)" });
    log.info(`enter-world: ${character.name} -> ${grant.roomId}`);
    return json(res, 200, grant);
  }

  json(res, 404, { error: "not found" });
}
