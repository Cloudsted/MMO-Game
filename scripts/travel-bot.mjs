/**
 * Portal round-trip verification: log in, walk from the hub spawn to the
 * forest portal, use it, confirm arrival in the forest, walk to the return
 * portal, use it, confirm arrival back in the hub. Exits 0 on success.
 *
 *   node scripts/travel-bot.mjs
 */
import WebSocket from "ws";
import { loadEnv, decodeTerrain } from "./lib.mjs";

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

function log(...a) {
  console.log("[travel]", ...a);
}

/** Connect to a room; resolves {ws, state} once welcomed + terrain + portals arrive. */
function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const state = { roomId: null, x: 0, y: 0, z: 0, seq: 0, terrain: null, portals: [], transfer: null };
    const timer = setTimeout(() => reject(new Error("room join timeout")), 10000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome":
          state.roomId = msg.roomId;
          state.x = msg.spawn.x;
          state.y = msg.spawn.y;
          state.z = msg.spawn.z;
          break;
        case "terrain":
          state.terrain = decodeTerrain(msg);
          break;
        case "portals":
          state.portals = msg.portals;
          break;
        case "transfer":
          state.transfer = msg;
          break;
        case "transferFailed":
          state.transferFailed = msg.reason;
          break;
        case "correct":
          state.x = msg.x;
          state.y = msg.y;
          state.z = msg.z;
          state.corrected = true;
          break;
        case "reject":
          reject(new Error(`rejected: ${msg.reason}`));
          return;
      }
      if (state.roomId && state.terrain && state.portals.length && !state.ready) {
        state.ready = true;
        clearTimeout(timer);
        resolve({ ws, state });
      }
    });
  });
}

/** Walk in legal steps toward (tx,tz), then wait a beat. */
async function walkTo(ws, state, tx, tz) {
  const HZ = 20;
  const SPEED = 4.0;
  while (Math.hypot(tx - state.x, tz - state.z) > 0.8) {
    const dx = tx - state.x;
    const dz = tz - state.z;
    const dist = Math.hypot(dx, dz);
    const step = Math.min(SPEED / HZ, dist);
    state.x += (dx / dist) * step;
    state.z += (dz / dist) * step;
    state.y = state.terrain.heightAt(state.x, state.z);
    state.seq++;
    ws.send(JSON.stringify({
      t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z,
      yaw: Math.atan2(dx, dz), anim: "move",
    }));
    await new Promise((r) => setTimeout(r, 1000 / HZ));
  }
}

/** Use a portal and wait for the transfer grant. */
async function usePortal(ws, state, portalId) {
  state.transfer = null;
  ws.send(JSON.stringify({ t: "usePortal", portalId }));
  for (let i = 0; i < 100; i++) {
    if (state.transfer) return state.transfer;
    if (state.transferFailed) throw new Error(`transfer failed: ${state.transferFailed}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no transfer grant received");
}

// ---------------- the round trip ----------------

await api("/api/register", { username: "traveler", password: "travel123" }).catch(() => {});
const { token } = await api("/api/login", { username: "traveler", password: "travel123" });
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Traveler" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);

let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);
if (state.roomId !== "hub") {
  // character may have been left in the forest by a previous run — go home first
  const back = state.portals.find((p) => p.target === "hub");
  await walkTo(ws, state, back.x, back.z);
  const t0 = await usePortal(ws, state, back.id);
  ws.close();
  ({ ws, state } = await enterRoom(t0.wsUrl, t0.ticket));
  log(`walked home first; now in ${state.roomId}`);
}

// hub -> forest
const toForest = state.portals.find((p) => p.target === "forest");
if (!toForest) throw new Error("no forest portal in hub");
log(`walking to portal '${toForest.label}' at ${toForest.x},${toForest.z}`);
await walkTo(ws, state, toForest.x, toForest.z);
const t1 = await usePortal(ws, state, toForest.id);
log(`transfer granted -> ${t1.roomId} at ${t1.wsUrl}`);
ws.close();

({ ws, state } = await enterRoom(t1.wsUrl, t1.ticket));
if (state.roomId !== "forest") throw new Error(`expected forest, got ${state.roomId}`);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)} — terrain ${state.terrain.w}x${state.terrain.h}`);

// forest -> hub
const toHub = state.portals.find((p) => p.target === "hub");
await walkTo(ws, state, toHub.x, toHub.z);
const t2 = await usePortal(ws, state, toHub.id);
log(`transfer granted -> ${t2.roomId}`);
ws.close();

({ ws, state } = await enterRoom(t2.wsUrl, t2.ticket));
if (state.roomId !== "hub") throw new Error(`expected hub, got ${state.roomId}`);
log(`back in ${state.roomId} — ROUND TRIP OK`);
ws.close();
process.exit(0);
