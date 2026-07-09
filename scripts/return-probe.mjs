/**
 * Regression probe for portal exit nodes + returnToHub (H key wire path):
 *   1. hub -> forest via portal, then forest -> hub via portal: the hub
 *      arrival must be AT THE HUB'S FOREST GATE (paired-portal exit node),
 *      not the plaza spawn.
 *   2. returnToHub in the hub -> system chat, no transfer.
 *   3. returnToHub in the forest -> transfer to hub, arrival at DEFAULT spawn.
 * Exits 0 on success, 1 on any failed expectation.
 *
 *   node scripts/return-probe.mjs
 */
import WebSocket from "ws";
import { loadEnv, makeWorldTracker, goTo } from "./lib.mjs";

loadEnv();
const MASTER = `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;

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

const log = (...a) => console.log("[return-probe]", ...a);
let failed = false;
function expect(cond, what) {
  if (cond) log(`OK   ${what}`);
  else { failed = true; log(`FAIL ${what}`); }
}

function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const state = { roomId: null, x: 0, y: 0, z: 0, seq: 0, terrain: null, portals: [], transfer: null, chats: [] };
    const tracker = makeWorldTracker();
    const timer = setTimeout(() => reject(new Error("room join timeout")), 10000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome": state.roomId = msg.roomId; state.x = msg.spawn.x; state.y = msg.spawn.y; state.z = msg.spawn.z; break;
        case "world": case "chunks": case "blockSet": { const s = tracker.handle(msg); if (s) state.terrain = s; break; }
        case "portals": state.portals = msg.portals; break;
        case "transfer": state.transfer = msg; break;
        case "chat": state.chats.push(msg); break;
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; break;
        case "reject": reject(new Error(`rejected: ${msg.reason}`)); return;
      }
      if (state.roomId && state.terrain && state.portals && !state.ready && (state.portals.length || state.roomId === "grounds")) {
        state.ready = true; clearTimeout(timer); resolve({ ws, state });
      }
    });
  });
}

async function waitTransfer(state, ms = 8000) {
  for (let i = 0; i < ms / 100; i++) {
    if (state.transfer) return state.transfer;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// ---- login / enter ----
await api("/api/register", { username: "returnprobe", password: "probe123" }).catch(() => {});
const { token } = await api("/api/login", { username: "returnprobe", password: "probe123" });
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Returnprobe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);

// stranded from a previous run? go home via returnToHub itself (simplest path)
if (state.roomId !== "hub") {
  ws.send(JSON.stringify({ t: "returnToHub" }));
  const t = await waitTransfer(state);
  if (!t) throw new Error("stranded outside hub and returnToHub gave no transfer");
  ws.close();
  ({ ws, state } = await enterRoom(t.wsUrl, t.ticket));
  log(`walked home first; now in ${state.roomId}`);
}

// ---- 1. exit-node arrival on the return trip ----
const toForest = state.portals.find((p) => p.target === "forest");
const hubGate = { x: toForest.x, z: toForest.z };
await goTo(ws, state, toForest.x, toForest.z);
state.transfer = null;
ws.send(JSON.stringify({ t: "usePortal", portalId: toForest.id }));
let t1 = await waitTransfer(state);
if (!t1) throw new Error("hub->forest transfer not granted");
ws.close();
({ ws, state } = await enterRoom(t1.wsUrl, t1.ticket));
const fPortal = state.portals.find((p) => p.target === "hub");
const dArr = Math.hypot(state.x - fPortal.x, state.z - fPortal.z);
expect(state.roomId === "forest", `arrived in forest`);
expect(dArr < 6, `forest arrival ${state.x.toFixed(1)},${state.z.toFixed(1)} is at the return gate (${dArr.toFixed(1)} blocks from portal, want <6)`);

await goTo(ws, state, fPortal.x, fPortal.z);
state.transfer = null;
ws.send(JSON.stringify({ t: "usePortal", portalId: fPortal.id }));
let t2 = await waitTransfer(state);
if (!t2) throw new Error("forest->hub transfer not granted");
ws.close();
({ ws, state } = await enterRoom(t2.wsUrl, t2.ticket));
const dGate = Math.hypot(state.x - hubGate.x, state.z - hubGate.z);
expect(state.roomId === "hub", `back in hub`);
expect(dGate < 6, `hub arrival ${state.x.toFixed(1)},${state.z.toFixed(1)} is at the forest gate (${dGate.toFixed(1)} blocks from portal at ${hubGate.x},${hubGate.z}, want <6 — NOT plaza spawn)`);

// ---- 2. returnToHub while already in the hub: chat, no transfer ----
state.transfer = null;
const chatsBefore = state.chats.length;
ws.send(JSON.stringify({ t: "returnToHub" }));
await new Promise((r) => setTimeout(r, 1500));
expect(!state.transfer, "returnToHub in hub does not transfer");
expect(state.chats.length > chatsBefore, "returnToHub in hub answers with a chat line");

// ---- 3. returnToHub from the forest: transfer, default spawn arrival ----
const toForest2 = state.portals.find((p) => p.target === "forest");
await goTo(ws, state, toForest2.x, toForest2.z);
state.transfer = null;
ws.send(JSON.stringify({ t: "usePortal", portalId: toForest2.id }));
let t3 = await waitTransfer(state);
ws.close();
({ ws, state } = await enterRoom(t3.wsUrl, t3.ticket));
state.transfer = null;
ws.send(JSON.stringify({ t: "returnToHub" }));
let t4 = await waitTransfer(state);
expect(!!t4, "returnToHub from forest grants a transfer");
ws.close();
({ ws, state } = await enterRoom(t4.wsUrl, t4.ticket));
expect(state.roomId === "hub", "returnToHub lands in hub");
// Greywatch rebuild: hub spawn is the portal-stone at (64,78)
const dSpawn = Math.hypot(state.x - 64, state.z - 78);
expect(dSpawn < 4, `returnToHub arrival ${state.x.toFixed(1)},${state.z.toFixed(1)} is the portal-stone spawn (${dSpawn.toFixed(1)} from 64,78)`);
ws.close();

log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
