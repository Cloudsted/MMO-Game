/**
 * Room-crash recovery verification: put a player in the forest, kill -9 the
 * forest RoomHost, and confirm (a) the player re-enters through the master
 * and lands somewhere alive (hub fallback while the room is down, or the
 * reopened room), and (b) the master reopens the forest from its snapshot.
 *
 *   node scripts/kill-test.mjs
 */
import WebSocket from "ws";
import { execSync } from "node:child_process";
import { loadEnv, decodeTerrain, sleep } from "./lib.mjs";

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

const log = (...a) => console.log("[kill-test]", ...a);

function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const state = { roomId: null, x: 0, y: 0, z: 0, seq: 0, terrain: null, portals: [], transfer: null, closed: false };
    const timer = setTimeout(() => reject(new Error("room join timeout")), 10000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", () => {});
    ws.on("close", () => (state.closed = true));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === "welcome") Object.assign(state, { roomId: msg.roomId, x: msg.spawn.x, y: msg.spawn.y, z: msg.spawn.z });
      else if (msg.t === "terrain") state.terrain = decodeTerrain(msg);
      else if (msg.t === "portals") state.portals = msg.portals;
      else if (msg.t === "transfer") state.transfer = msg;
      else if (msg.t === "correct") Object.assign(state, { x: msg.x, y: msg.y, z: msg.z });
      else if (msg.t === "reject") return reject(new Error(`rejected: ${msg.reason}`));
      if (state.roomId && state.terrain && state.portals.length && !state.ready) {
        state.ready = true;
        clearTimeout(timer);
        resolve({ ws, state });
      }
    });
  });
}

async function walkTo(ws, state, tx, tz) {
  const HZ = 20;
  while (Math.hypot(tx - state.x, tz - state.z) > 0.8) {
    const dx = tx - state.x, dz = tz - state.z;
    const dist = Math.hypot(dx, dz);
    const step = Math.min(4.0 / HZ, dist);
    state.x += (dx / dist) * step;
    state.z += (dz / dist) * step;
    state.y = state.terrain.heightAt(state.x, state.z);
    ws.send(JSON.stringify({ t: "move", seq: ++state.seq, x: state.x, y: state.y, z: state.z, yaw: 0, anim: "move" }));
    await sleep(1000 / HZ);
  }
}

// ---- get into the forest ----
await api("/api/register", { username: "traveler", password: "travel123" }).catch(() => {});
const { token } = await api("/api/login", { username: "traveler", password: "travel123" });
const { characters } = await api("/api/characters", null, token);
const characterId = characters[0].id;

let grant = await api("/api/enter", { characterId }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId}`);
if (state.roomId === "hub") {
  const p = state.portals.find((p) => p.target === "forest");
  await walkTo(ws, state, p.x, p.z);
  ws.send(JSON.stringify({ t: "usePortal", portalId: p.id }));
  while (!state.transfer) await sleep(100);
  ws.close();
  ({ ws, state } = await enterRoom(state.transfer.wsUrl, state.transfer.ticket));
  log(`entered ${state.roomId}`);
}
if (state.roomId !== "forest") throw new Error("could not reach the forest");

// ---- find the forest RoomHost PID by its listening port and kill -9 ----
const status = await api("/api/status");
const forest = status.shards.flatMap((s) => s.rooms).find((r) => r.roomId === "forest");
log(`forest is on port ${forest.port}; players: ${forest.players}`);
const netstat = execSync(`netstat -ano | findstr :${forest.port} | findstr LISTENING`).toString();
const pid = netstat.trim().split(/\s+/).pop();
log(`killing forest RoomHost pid ${pid}`);
execSync(`taskkill /F /PID ${pid}`);

// ---- our socket should die; re-enter through the master ----
for (let i = 0; i < 50 && !state.closed; i++) await sleep(100);
log(`socket closed: ${state.closed}`);

let landed = null;
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    grant = await api("/api/enter", { characterId }, token);
    ({ ws, state } = await enterRoom(grant.wsUrl, grant.ticket));
    landed = state.roomId;
    break;
  } catch (e) {
    log(`re-enter attempt ${attempt} failed (${e.message}); retrying`);
    await sleep(1500);
  }
}
if (!landed) throw new Error("player never recovered");
log(`player recovered — landed in ${landed.toUpperCase()}`);
ws.close();

// ---- master must reopen the forest ----
for (let i = 0; i < 30; i++) {
  const s = await api("/api/status");
  const f = s.rooms.find((r) => r.roomId === "forest" && r.status === "open");
  if (f) {
    log("forest room reopened by the master — RECOVERY OK");
    process.exit(0);
  }
  await sleep(1000);
}
throw new Error("forest never reopened");
