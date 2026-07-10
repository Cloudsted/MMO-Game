/**
 * Regression probe for the content-update room graph + admin world commands:
 *   1. /room atelier   -> admin self-transfer works (no portal proximity)
 *   2. /prefab ruined_watchtower -> stamps through the edit overlay and
 *      replicates >50 blockSet edits to the session
 *   3. /room gloomfen / cinderrift / crypt_depths -> each world decodes and
 *      contains its signature block ids:
 *        gloomfen:     mud 26, murk_water 27
 *        cinderrift:   dark_stone 34, lava 24
 *        crypt_depths: dark_bricks 35, snow 41, ice 42
 *   4. {t:"returnToHub"} from crypt_depths -> transfer lands in the hub
 * Needs the `dropbot` account to be admin (node scripts/make-admin.mjs dropbot).
 * Exits 0 on success, 1 on any failed expectation.
 *
 *   node scripts/roomgraph-probe.mjs
 */
import WebSocket from "ws";
import { loadEnv, makeWorldTracker, sleep } from "./lib.mjs";

loadEnv();
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;

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

const log = (...a) => console.log("[roomgraph]", ...a);
let failed = false;
function expect(cond, what) {
  if (cond) log(`OK   ${what}`);
  else { failed = true; log(`FAIL ${what}`); }
}

/** Join a room and resolve once the whole voxel world has decoded. */
function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const tracker = makeWorldTracker();
    const state = {
      roomId: null, x: 0, y: 0, z: 0, seq: 0,
      terrain: null, transfer: null, chats: [], blockSets: 0,
    };
    const timer = setTimeout(() => reject(new Error("room join timeout")), 25000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome": state.roomId = msg.roomId; state.x = msg.spawn.x; state.y = msg.spawn.y; state.z = msg.spawn.z; break;
        case "world": case "chunks": { const s = tracker.handle(msg); if (s) state.terrain = s; break; }
        case "blockSet": state.blockSets++; tracker.handle(msg); break;
        case "chat": state.chats.push(msg); break;
        case "transfer": state.transfer = msg; break;
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; break;
        case "reject": clearTimeout(timer); reject(new Error(`rejected: ${msg.reason}`)); return;
      }
      if (state.roomId && state.terrain && !state.ready) {
        state.ready = true;
        clearTimeout(timer);
        resolve({ ws, state });
      }
    });
  });
}

async function waitTransfer(state, ms = 10000) {
  for (let i = 0; i < ms / 100; i++) {
    if (state.transfer) return state.transfer;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** Admin-chat travel: /room <id>, wait for the grant, reconnect. */
async function gotoRoom(ws, state, roomId) {
  if (state.roomId === roomId) return { ws, state };
  state.transfer = null;
  ws.send(JSON.stringify({ t: "chat", text: `/room ${roomId}` }));
  const t = await waitTransfer(state);
  if (!t) throw new Error(`/room ${roomId}: no transfer granted (admin? room open?)`);
  ws.close();
  const next = await enterRoom(t.wsUrl, t.ticket);
  return next;
}

/** Count occurrences of each block id in the decoded grid (scans y 0..63). */
function countIds(terrain, ids) {
  const counts = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let z = 0; z < terrain.h; z++) {
    for (let x = 0; x < terrain.w; x++) {
      for (let y = 0; y < 64; y++) {
        const id = terrain.get(x, y, z);
        if (id in counts) counts[id]++;
      }
    }
  }
  return counts;
}

// ---- login as the admin bot ----
await api("/api/register", { username: "dropbot", password: "drop123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "dropbot", password: "drop123" });
if (!account.roles.includes("admin")) {
  console.error("[roomgraph] dropbot is not admin — run: node scripts/make-admin.mjs dropbot  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Dropbot" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} (${state.terrain.w}x${state.terrain.h}) at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);

// ---- 1. /room atelier ----
({ ws, state } = await gotoRoom(ws, state, "atelier"));
expect(state.roomId === "atelier", `/room atelier transferred (now in ${state.roomId}, world ${state.terrain.w}x${state.terrain.h})`);

// ---- 2. /prefab ruined_watchtower stamps + replicates blockSets ----
// wipe any stamp a previous run persisted - re-stamping identical blocks
// produces ZERO edits (applyEdit drops same-as-current), failing the count
ws.send(JSON.stringify({ t: "chat", text: "/clearblocks" }));
await sleep(1200);
await sleep(500); // let any join-time traffic settle
const editsBefore = state.blockSets;
const chatsBefore = state.chats.length;
ws.send(JSON.stringify({ t: "chat", text: "/prefab ruined_watchtower" }));
for (let i = 0; i < 60 && !state.chats.slice(chatsBefore).some((c) => c.text?.includes("Stamped")); i++) await sleep(100);
await sleep(700); // let the blockSet burst finish
const stampChat = state.chats.slice(chatsBefore).find((c) => c.text?.includes("Stamped"));
const edits = state.blockSets - editsBefore;
expect(!!stampChat, `/prefab acknowledged: ${stampChat ? stampChat.text : "(no Stamped chat line)"}`);
expect(edits > 50, `prefab stamp replicated ${edits} blockSet edit(s) (want >50)`);

// ---- 3. the three new rooms decode with their signature blocks ----
const SIGNATURES = [
  ["gloomfen", { mud: 26, murk_water: 27 }],
  ["cinderrift", { dark_stone: 34, lava: 24 }],
  ["crypt_depths", { dark_bricks: 35, snow: 41, ice: 42 }],
];
for (const [roomId, sig] of SIGNATURES) {
  ({ ws, state } = await gotoRoom(ws, state, roomId));
  expect(state.roomId === roomId, `/room ${roomId} transferred, world decoded ${state.terrain.w}x${state.terrain.h}`);
  const counts = countIds(state.terrain, Object.values(sig));
  for (const [name, id] of Object.entries(sig)) {
    expect(counts[id] > 0, `${roomId} contains ${name} (id ${id}): ${counts[id]} block(s)`);
  }
}

// ---- 4. returnToHub from crypt_depths ----
state.transfer = null;
ws.send(JSON.stringify({ t: "returnToHub" }));
const tHome = await waitTransfer(state);
expect(!!tHome, "returnToHub from crypt_depths grants a transfer");
if (tHome) {
  ws.close();
  ({ ws, state } = await enterRoom(tHome.wsUrl, tHome.ticket));
  expect(state.roomId === "hub", `returnToHub lands in hub (arrived ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)})`);
}
ws.close();

log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
