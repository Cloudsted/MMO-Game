/**
 * Regression probe: mobs path THROUGH liquid when chasing (wade shallow,
 * swim deep) — standing across water/lava no longer cheeses melee mobs.
 * Finds a real pond crossing in a wild room, spawns a wolf on the far bank,
 * teleports across, and FAILS unless the wolf reaches the probe by moving
 * over the liquid strip (its path is watched — going around doesn't count).
 * Needs the probe account to be admin once: node scripts/make-admin.mjs wade_probe
 * Exits 0 on success, 1 on any failed expectation.
 *
 *   node scripts/wade-probe.mjs
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, makeWorldTracker, ROOT, sleep } from "./lib.mjs";

loadEnv();
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const ROOMS = ["forest", "gloomfen", "desert"]; // first room with a usable crossing wins

const registry = JSON.parse(readFileSync(resolve(ROOT, "shared", "blocks.json"), "utf8").replace(/^﻿/, ""));
const LIQUID = new Set(registry.blocks.filter((b) => b.cull === "liquid").map((b) => b.id));
const SOLID = new Set(registry.blocks.filter((b) => b.solid).map((b) => b.id));

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

const log = (...a) => console.log("[wade-probe]", ...a);
let failed = false;
function expect(cond, what) {
  if (cond) log(`OK   ${what}`);
  else { failed = true; log(`FAIL ${what}`); }
}

/** Join a room and resolve once the whole voxel world has decoded. */
function enterRoom(wsUrl, ticket) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    const tracker = makeWorldTracker();
    const state = { roomId: null, x: 0, y: 0, z: 0, seq: 0, terrain: null, transfer: null, ents: new Map() };
    const timer = setTimeout(() => reject(new Error("room join timeout")), 25000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome":
          state.roomId = msg.roomId; state.x = msg.spawn.x; state.y = msg.spawn.y; state.z = msg.spawn.z;
          for (const e of msg.ents) state.ents.set(e.id, e);
          break;
        case "world": tracker.handle(msg); break;
        case "chunks": { const s = tracker.handle(msg); if (s) state.terrain = s; break; }
        case "blockSet": tracker.handle(msg); break;
        case "snap":
          for (const e of msg.enter) state.ents.set(e.id, e);
          for (const d of msg.ents) { const e = state.ents.get(d.id); if (e) Object.assign(e, d); }
          for (const id of msg.leave) state.ents.delete(id);
          break;
        case "transfer": state.transfer = msg; break;
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; break;
        case "reject": clearTimeout(timer); reject(new Error(`rejected: ${msg.reason}`)); return;
      }
      if (state.roomId && state.terrain && !state.ready) {
        state.ready = true;
        clearTimeout(timer);
        resolvePromise({ ws, state });
      }
    });
  });
}

async function waitTransfer(state, ms = 10000) {
  for (let i = 0; i < ms / 100; i++) {
    if (state.transfer) return state.transfer;
    await sleep(100);
  }
  return null;
}

/** Admin-chat travel: /room <id>, wait for the grant, reconnect. */
async function gotoRoom(ws, state, roomId) {
  if (state.roomId === roomId) return { ws, state };
  state.transfer = null;
  ws.send(JSON.stringify({ t: "chat", text: `/room ${roomId}` }));
  const t = await waitTransfer(state);
  if (!t) throw new Error(`/room ${roomId}: no transfer granted (admin? run: node scripts/make-admin.mjs wade_probe)`);
  ws.close();
  return enterRoom(t.wsUrl, t.ticket);
}

/** Column summary: top liquid cell OR dry feet level (crosses scanned past). */
function column(t, x, z) {
  for (let y = 47; y >= 1; y--) {
    const id = t.get(x, y, z);
    if (id === 0) continue;
    if (LIQUID.has(id)) return { liquid: true, top: y };
    if (SOLID.has(id)) return { liquid: false, feet: y + 1 };
    // cross decoration — keep scanning below it
  }
  return { liquid: false, feet: 1 };
}

/**
 * Find a south→north pond crossing: 2 dry columns, a liquid run 2..5 long
 * (and ≥7 wide across x so the chase can't sidestep it), then 8 dry columns,
 * with level banks the mob can actually climb out on (bank feet = water
 * surface + 1) and everything within ±1 of the south feet.
 */
function findCrossing(t) {
  for (let x = 8; x < t.w - 8; x++) {
    for (let z = 8; z < t.h - 20; z++) {
      const south1 = column(t, x, z - 1);
      const south2 = column(t, x, z - 2);
      if (south1.liquid || south2.liquid) continue;
      const run = column(t, x, z);
      if (!run.liquid) continue;
      let w = 0;
      while (w < 6 && column(t, x, z + w).liquid) w++;
      if (w < 2 || w > 5) continue;
      // the run must be wide in x, so around-the-pond is not a path
      let wide = true;
      for (let dz = 0; dz < w && wide; dz++) {
        for (let dx = -3; dx <= 3 && wide; dx++) {
          if (!column(t, x + dx, z + dz).liquid) wide = false;
        }
      }
      if (!wide) continue;
      // level, climbable banks + a long dry north shore for the wolf spawn
      const surface = run.top + 1;
      if (south1.feet !== surface) continue;
      const north = [];
      for (let dz = 0; dz < 8; dz++) north.push(column(t, x, z + w + dz));
      if (north.some((c) => c.liquid)) continue;
      if (north[0].feet !== surface) continue;
      if (north.some((c) => Math.abs(c.feet - south1.feet) > 1)) continue;
      if (Math.abs(south2.feet - south1.feet) > 1) continue;
      return { x, z, w, surface };
    }
  }
  return null;
}

await api("/api/register", { username: "wade_probe", password: "devpass1" }).catch(() => {});
const { token } = await api("/api/login", { username: "wade_probe", password: "devpass1" });
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "WadeProbe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);

let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);

let site = null;
for (const roomId of ROOMS) {
  ({ ws, state } = await gotoRoom(ws, state, roomId));
  site = findCrossing(state.terrain);
  if (site) {
    log(`crossing found in ${roomId}: x=${site.x} z=${site.z} run=${site.w} surface=${site.surface}`);
    break;
  }
  log(`no usable crossing in ${roomId}`);
}
expect(site !== null, "found a pond crossing in a wild room");
if (!site) { log("FAIL"); process.exit(1); }

// stage: stand on the NORTH shore, face +z, spawn the wolf 4 m further north
ws.send(JSON.stringify({ t: "chat", text: `/tp ${site.x} ${site.z + site.w + 1}` }));
await sleep(800);
state.seq++; // in-place turn so /spawnmob's "4 m ahead" points away from the water
ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: 0, anim: "idle" }));
await sleep(300);
const before = new Set([...state.ents.keys()]);
ws.send(JSON.stringify({ t: "chat", text: "/spawnmob wolf" }));
await sleep(1200);
let wolf = null;
for (const e of state.ents.values()) {
  if (!before.has(e.id) && e.kind === "mob" && e.sprite === "wolf") wolf = e;
}
expect(wolf !== null, "wolf spawned on the north shore");
if (!wolf) { log("FAIL"); process.exit(1); }
log(`wolf #${wolf.id} at ${wolf.x.toFixed(1)},${wolf.z.toFixed(1)} — teleporting across the water`);

// cross to the SOUTH shore and let it come to us
ws.send(JSON.stringify({ t: "chat", text: `/tp ${site.x} ${site.z - 2}` }));
await sleep(500);
const botX = state.x;
const botZ = state.z;

let overWater = false;
let minD = Infinity;
let minY = Infinity;
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  await sleep(150);
  const w = state.ents.get(wolf.id);
  if (!w) continue;
  const wx = w.x;
  const wz = w.z;
  const wy = w.y;
  if (wx === undefined || wz === undefined) continue;
  const d = Math.hypot(wx - botX, wz - botZ);
  minD = Math.min(minD, d);
  if (wz >= site.z - 0.2 && wz <= site.z + site.w + 0.2 && Math.abs(wx - (site.x + 0.5)) <= 3.5) {
    overWater = true;
    if (wy !== undefined) minY = Math.min(minY, wy);
  }
  if (overWater && d < 2.6) break;
}
expect(overWater, "wolf's chase path went OVER the liquid strip (not around)");
expect(minD < 2.6, `wolf reached the probe across the water (closest ${minD.toFixed(2)} m)`);
if (Number.isFinite(minY)) log(`wolf's lowest feet over the water: y=${minY.toFixed(2)} (bank surface ${site.surface})`);

ws.close();
log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
