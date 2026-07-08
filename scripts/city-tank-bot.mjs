/**
 * Screenshot-staging tank: a geared admin bot walks into the throne room,
 * aggros Vaelric, and just SURVIVES (potions, strafing circles, never
 * attacks) so a spectating MMO_SHOT client can photograph the fire pillars,
 * predictive fireballs, and explosions mid-flight.
 *
 *   node scripts/city-tank-bot.mjs [--seconds 75]
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { loadEnv, makeWorldTracker, sleep } from "./lib.mjs";

loadEnv();
const MASTER = `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const SECONDS = Number(process.argv[process.argv.indexOf("--seconds") + 1] || 75);
const log = (...a) => console.log("[tank]", ...a);

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
    const state = { roomId: null, x: 0, y: 0, z: 0, seq: 0, terrain: null, transfer: null, stats: null, inv: null, died: false, ents: new Map() };
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
        case "stats": state.stats = msg; break;
        case "inv": state.inv = msg; break;
        case "pillars":
          log(`PILLARS incoming: ${msg.list.length} pillars, burn ${msg.burnMs}ms, radius ${msg.radius}`);
          break;
        case "proj":
          if (msg.scale) log(`BIG FIREBALL: scale ${msg.scale}, impactFx ${msg.impactFx}, speed ${Math.round(Math.hypot(msg.vx, msg.vy, msg.vz))}`);
          break;
        case "died": state.died = true; break;
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
async function moveToward(ws, state, tx, tz, within = 1.5, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dx = tx - state.x, dz = tz - state.z;
    const d = Math.hypot(dx, dz);
    if (d <= within) return true;
    const step = Math.min(0.45, d);
    const nx = state.x + (dx / d) * step, nz = state.z + (dz / d) * step;
    const ny = floorNear(state.terrain, nx, nz, state.y);
    if (ny === null) { await sleep(110); continue; }
    state.seq++; state.x = nx; state.z = nz; state.y = ny;
    ws.send(JSON.stringify({ t: "move", seq: state.seq, x: nx, y: ny, z: nz, yaw: Math.atan2(dx, dz), anim: "move" }));
    await sleep(110);
  }
  return false;
}

await api("/api/register", { username: "dropbot", password: "drop123" }).catch(() => {});
const { token } = await api("/api/login", { username: "dropbot", password: "drop123" });
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Dropbot" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
if (state.roomId !== "sundered_city") {
  state.transfer = null;
  ws.send(JSON.stringify({ t: "chat", text: "/room sundered_city" }));
  for (let i = 0; i < 100 && !state.transfer; i++) await sleep(100);
  if (!state.transfer) throw new Error("no transfer to the city");
  ws.close();
  ({ ws, state } = await enterRoom(state.transfer.wsUrl, state.transfer.ticket));
}
ws.send(JSON.stringify({ t: "chat", text: "/level 30" }));
ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
ws.send(JSON.stringify({ t: "chat", text: "/tp 128 76" }));
await sleep(1500);
log("walking into the hall...");
await moveToward(ws, state, 128, 52, 1.5);
log(`tanking for ${SECONDS}s at (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
const until = Date.now() + SECONDS * 1000;
let ang = 0;
while (Date.now() < until && !state.died) {
  if (state.stats && state.stats.hp < 620) {
    const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
    if (pot >= 0) ws.send(JSON.stringify({ t: "consume", slot: pot }));
  }
  // strafe a slow circle in front of the dais — moving target for the
  // predictive fireball + marching pillars
  ang += 0.5;
  const tx = 128 + Math.sin(ang) * 3.2;
  const tz = 51 + Math.cos(ang) * 2.4;
  await moveToward(ws, state, tx, tz, 0.6, 900);
}
log(state.died ? "tank died (frames should still have the fireworks)" : "tank survived");
ws.close();
process.exit(0);
