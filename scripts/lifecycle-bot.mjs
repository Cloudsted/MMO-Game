/**
 * Temp-dungeon lifecycle verification: enter the dungeon as an admin bot,
 * force expiry with /expire, and confirm the whole arc: collapse warning →
 * eviction → reconnect lands in the HUB → the master holds the dungeon down
 * (portal sealed) → the dungeon reopens fresh after the downtime.
 *
 * Fast run: restart the stack with MMO_DOWNTIME_OVERRIDE_SEC=20 first.
 *
 *   node scripts/make-admin.mjs lifecycle_bot   (first time)
 *   node scripts/lifecycle-bot.mjs
 */
import WebSocket from "ws";
import { loadEnv, makeWorldTracker, sleep, goTo } from "./lib.mjs";

loadEnv();
const MASTER = `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const USER = "lifecycle_bot";
const PASS = "devpass1";

async function api(path, body, token) {
  const res = await fetch(`${MASTER}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error}`);
  return json;
}

const log = (...a) => console.log("[lifecycle]", ...a);
const fail = (m) => {
  console.error("[lifecycle] FAIL:", m);
  process.exit(1);
};

function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const state = {
      roomId: null, x: 0, y: 0, z: 0, seq: 0, terrain: null,
      portals: [], transfer: null, chats: [], evicted: null, closed: false,
    };
    const tracker = makeWorldTracker();
    const timer = setTimeout(() => reject(new Error("room join timeout")), 10000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("close", () => (state.closed = true));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome":
          state.roomId = msg.roomId;
          state.x = msg.spawn.x;
          state.y = msg.spawn.y;
          state.z = msg.spawn.z;
          break;
        case "world":
        case "chunks":
        case "blockSet": {
          const s = tracker.handle(msg);
          if (s) state.terrain = s;
          break;
        }
        case "portals":
          state.portals = msg.portals;
          break;
        case "chat":
          state.chats.push(msg);
          break;
        case "evict":
          state.evicted = msg.reason;
          break;
        case "transfer":
          state.transfer = msg;
          break;
        case "correct":
          state.x = msg.x; state.y = msg.y; state.z = msg.z;
          break;
        case "reject":
          reject(new Error(`rejected: ${msg.reason}`));
          return;
      }
      if (state.roomId && state.terrain && !state.ready) {
        state.ready = true;
        clearTimeout(timer);
        resolve({ ws, state });
      }
    });
  });
}


async function dungeonStatus() {
  const status = await api("/api/status");
  return status.rooms.find((r) => r.roomId === "dungeon");
}

const main = async () => {
  await api("/api/register", { username: USER, password: PASS }).catch(() => {});
  const { token, account } = await api("/api/login", { username: USER, password: PASS });
  if (!account.roles.includes("admin")) fail("lifecycle_bot needs admin (run scripts/make-admin.mjs lifecycle_bot)");
  let chars = (await api("/api/characters", null, token)).characters;
  if (chars.length === 0) chars = [(await api("/api/characters", { name: "LifecycleBot" }, token)).character];
  const character = chars[0];

  // enter world (hub or wherever we were)
  let grant = await api("/api/enter", { characterId: character.id }, token);
  let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
  log(`entered ${state.roomId}`);

  if (state.roomId !== "dungeon") {
    if (state.roomId !== "hub") fail(`expected hub start, got ${state.roomId}`);
    const portal = state.portals.find((p) => p.target === "dungeon");
    if (!portal) fail("hub has no dungeon portal");
    if (portal.open === false) fail("dungeon portal is sealed at test start — wait for it to reopen");
    // Greywatch rebuild: the crypt arch sits INSIDE the walls on the plaza
    // ring — these legacy gate waypoints are harmless (BFS routes anyway)
    // (waypoints keep the straight-line walker off the wall collision band)
    if (!(await goTo(ws, state, 64, 93))) fail("never reached the inner gate");
    if (!(await goTo(ws, state, 64, 100))) fail("never passed the gate");
    if (!(await goTo(ws, state, portal.x, portal.z))) fail("never reached the dungeon portal");
    ws.send(JSON.stringify({ t: "usePortal", portalId: portal.id }));
    for (let i = 0; i < 100 && !state.transfer; i++) await sleep(100);
    if (!state.transfer) fail("no transfer grant into the dungeon");
    ws.close();
    ({ ws, state } = await enterRoom(state.transfer.wsUrl, state.transfer.ticket));
    if (state.roomId !== "dungeon") fail(`transfer landed in ${state.roomId}`);
    log("inside the dungeon");
  }

  // force a fast expiry and watch the arc
  ws.send(JSON.stringify({ t: "chat", text: "/expire 15" }));
  log("requested /expire 15 — waiting for the collapse...");
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !state.evicted) await sleep(200);
  const warned = state.chats.some((c) => c.channel === "system" && /collapses in/.test(c.text));
  if (!warned) fail("no collapse warning arrived");
  log(`warning received: "${state.chats.find((c) => /collapses in/.test(c.text)).text}"`);
  if (!state.evicted) fail("never evicted");
  log(`evicted: "${state.evicted}"`);
  ws.close();

  // master should hold the dungeon down
  await sleep(2500);
  let d = await dungeonStatus();
  if (d) fail(`dungeon still assigned after expiry: ${JSON.stringify(d)}`);
  log("master shows the dungeon down (in downtime)");

  // reconnect lands in the hub (eviction report set roomId=hub)
  grant = await api("/api/enter", { characterId: character.id }, token);
  ({ ws, state } = await enterRoom(grant.wsUrl, grant.ticket));
  if (state.roomId !== "hub") fail(`reconnect landed in ${state.roomId}, expected hub`);
  const dungeonPortal = state.portals.find((p) => p.target === "dungeon");
  log(`reconnected to the hub; dungeon portal open=${dungeonPortal?.open}`);
  if (dungeonPortal?.open !== false) fail("hub portal should show the dungeon sealed during downtime");

  // wait for the reopen (downtime override recommended: 20s)
  log("waiting for the dungeon to reopen...");
  const reopenDeadline = Date.now() + 300000;
  while (Date.now() < reopenDeadline) {
    d = await dungeonStatus();
    if (d && d.status === "open") break;
    await sleep(2000);
  }
  if (!d || d.status !== "open") fail("dungeon never reopened");
  log("dungeon reopened fresh — LIFECYCLE OK");
  ws.close();
  process.exit(0);
};

main().catch((e) => fail(e.message));
