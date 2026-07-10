/**
 * Screenshot staging: park claude_test2's character anywhere, INCLUDING
 * roofed interiors — login, ensure character, /room <room>, /tp to an
 * open-sky spot, then WALK to the interior mark (a /tp indoors lands on
 * the ROOF — standY), /level 30, optionally /spawnmob a mob at the mark,
 * then disconnect so an MMO_AUTOLOGIN client can log in standing there.
 * Needs admin: node scripts/make-admin.mjs claude_test2
 *
 *   node scripts/stage-walk.mjs <room> <tpX> <tpZ> <walkX> <walkZ> [spawnmob]
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { loadEnv, makeWorldTracker, sleep } from "./lib.mjs";

loadEnv();
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const [room, tpX, tpZ, walkX, walkZ, spawnmob] = process.argv.slice(2);
const log = (...a) => console.log("[stage]", ...a);

const SOLID_IDS = new Set(
  JSON.parse(readFileSync(new URL("../shared/blocks.json", import.meta.url), "utf8").replace(/^﻿/, ""))
    .blocks.filter((b) => b.solid).map((b) => b.id)
);

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

function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const tracker = makeWorldTracker();
    const state = { roomId: null, x: 0, y: 0, z: 0, seq: 0, terrain: null, transfer: null, ents: new Map() };
    const timer = setTimeout(() => reject(new Error("join timeout")), 25000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome": state.roomId = msg.roomId; state.x = msg.spawn.x; state.y = msg.spawn.y; state.z = msg.spawn.z; break;
        case "world": case "chunks": case "blockSet": { const s = tracker.handle(msg); if (s) state.terrain = s; break; }
        case "snap":
          for (const e of msg.enter) state.ents.set(e.id, e);
          for (const d of msg.ents) { const e = state.ents.get(d.id); if (e) Object.assign(e, d); }
          for (const id of msg.leave) state.ents.delete(id);
          break;
        case "transfer": state.transfer = msg; break;
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; break;
        case "reject": clearTimeout(timer); reject(new Error(msg.reason)); return;
      }
      if (state.roomId && state.terrain && !state.ready) { state.ready = true; clearTimeout(timer); resolve({ ws, state }); }
    });
  });
}

function columnGapNear(grid, xi, zi, refY) {
  let best = -1;
  for (let y = 1; y < 46; y++) {
    if (!SOLID_IDS.has(grid.get(xi, y - 1, zi))) continue;
    if (SOLID_IDS.has(grid.get(xi, y, zi)) || SOLID_IDS.has(grid.get(xi, y + 1, zi))) continue;
    if (best < 0 || Math.abs(y - refY) < Math.abs(best - refY)) best = y;
  }
  return best;
}
function floorNear(grid, x, z, refY) {
  const R = 0.31;
  let ny = -1;
  for (const dx of [-R, R]) for (const dz of [-R, R]) {
    const g = columnGapNear(grid, Math.floor(x + dx), Math.floor(z + dz), refY);
    if (g < 0 || g > refY + 1.05) return null;
    if (g > ny) ny = g;
  }
  return ny >= 0 ? ny : refY;
}
async function moveToward(ws, state, tx, tz, within = 1.2, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  let jink = 1;
  while (Date.now() < deadline) {
    const dx = tx - state.x, dz = tz - state.z;
    const d = Math.hypot(dx, dz);
    if (d <= within) return true;
    const step = Math.min(0.45, d);
    let nx = state.x + (dx / d) * step, nz = state.z + (dz / d) * step;
    let ny = floorNear(state.terrain, nx, nz, state.y);
    if (ny === null) {
      jink = -jink;
      nx = state.x + (-dz / d) * step * jink;
      nz = state.z + (dx / d) * step * jink;
      ny = floorNear(state.terrain, nx, nz, state.y);
      if (ny === null) { await sleep(110); continue; }
    }
    state.seq++; state.x = nx; state.z = nz; state.y = ny;
    ws.send(JSON.stringify({ t: "move", seq: state.seq, x: nx, y: ny, z: nz, yaw: Math.atan2(dx, dz), anim: "move" }));
    await sleep(110);
  }
  return false;
}

await api("/api/register", { username: "claude_test2", password: "devpass1" }).catch(() => {});
const { token } = await api("/api/login", { username: "claude_test2", password: "devpass1" });
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Claudia" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId}`);
if (state.roomId !== room) {
  state.transfer = null;
  ws.send(JSON.stringify({ t: "chat", text: `/room ${room}` }));
  for (let i = 0; i < 100 && !state.transfer; i++) await sleep(100);
  if (!state.transfer) throw new Error(`no transfer to ${room}`);
  ws.close();
  ({ ws, state } = await enterRoom(state.transfer.wsUrl, state.transfer.ticket));
}
ws.send(JSON.stringify({ t: "chat", text: "/level 30" }));
ws.send(JSON.stringify({ t: "chat", text: `/tp ${tpX} ${tpZ}` }));
await sleep(1500);
const walked = await moveToward(ws, state, Number(walkX), Number(walkZ));
log(`walked to (${state.x.toFixed(1)},${state.y.toFixed(0)},${state.z.toFixed(1)}) — ${walked ? "OK" : "SHORT"}`);
if (spawnmob) {
  ws.send(JSON.stringify({ t: "chat", text: `/spawnmob ${spawnmob} 1` }));
  await sleep(1200);
  log(`spawned ${spawnmob}`);
}
ws.close();
log("staged; disconnected");
process.exit(0);
