/**
 * Live probe for THE OSSUARY GALLERIES (world-redesign batch 5) — the L9-11
 * splice between the Sunken Crypt's Gravelord gate and the Vaults of Morvane:
 *   1. /room dungeon: the depths gate (dungeon-depths) arrives SEALED while
 *      the Gravelord lives (if a prior run left him on his 900s stateful
 *      respawn timer, /spawnmob restages him — the same spawnMob →
 *      onBossSpawned reseal path the greenhood probe proved).
 *   2. kill the Gravelord: the gate opens ("the lower stair stands open" +
 *      portalState {ossuary_galleries, open:true}).
 *   3. usePortal dungeon-depths → the Ossuary Galleries, arriving at the
 *      TWIN GATE beside ossuary-dungeon (64,121).
 *   4. walk the S-route through the galleries (court → spine → grading-hall
 *      shelf rows → stitchery → cull-rows → the platform) to THE Bone
 *      Warden's post: assert he is present, L12, "Bone Warden of the
 *      Galleries".
 *   5. usePortal ossuary-depths → crypt_depths, arriving at ITS twin gate
 *      (depths-ossuary at 48,90) — then straight back, landing beside the
 *      Warden's post.
 *   6. the hidden chapel: /tp to the dead-cart lane, slip the 1-wide crack,
 *      assert the Wrung Shade (pallid_mourner L13) haunts it.
 *   7. returnToHub.
 *
 * Needs admin: node scripts/make-admin.mjs ossuary_probe   (then rerun)
 * NOTE: crypt_depths is still ephemeral — it must be OPEN (not in downtime).
 * Exits 0 on success, 1 on any failed expectation, 2 if not admin.
 *
 *   node scripts/ossuary-probe.mjs
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { loadEnv, makeWorldTracker, sleep, goTo } from "./lib.mjs";

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

const log = (...a) => console.log("[ossuary]", ...a);
let failed = false;
function expect(cond, what) {
  if (cond) log(`OK   ${what}`);
  else { failed = true; log(`FAIL ${what}`); }
}

function enterRoom(wsUrl, ticket) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    const tracker = makeWorldTracker();
    const state = {
      roomId: null, selfId: -1, x: 0, y: 0, z: 0, seq: 0,
      terrain: null, portals: [], portalStates: [], transfer: null,
      ents: new Map(), stats: null, inv: null,
      events: [], chats: [], died: false, corrections: 0,
    };
    const timer = setTimeout(() => reject(new Error("room join timeout")), 25000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome":
          state.roomId = msg.roomId; state.selfId = msg.selfId;
          state.x = msg.spawn.x; state.y = msg.spawn.y; state.z = msg.spawn.z;
          for (const e of msg.ents) state.ents.set(e.id, e);
          break;
        case "world": case "chunks": case "blockSet": {
          const s = tracker.handle(msg);
          if (s) state.terrain = s;
          break;
        }
        case "portals": state.portals = msg.portals; break;
        case "portalState": state.portalStates.push(msg); break;
        case "snap":
          for (const e of msg.enter) state.ents.set(e.id, e);
          for (const d of msg.ents) { const e = state.ents.get(d.id); if (e) Object.assign(e, d); }
          for (const id of msg.leave) state.ents.delete(id);
          break;
        case "stats": state.stats = msg; break;
        case "inv": state.inv = msg; break;
        case "evt": state.events.push(msg.e); break;
        case "chat": state.chats.push(msg); break;
        case "died": state.died = true; break;
        case "transfer": state.transfer = msg; break;
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; state.corrections++; break;
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

async function gotoRoom(ws, state, roomId) {
  if (state.roomId === roomId) return { ws, state };
  let t = null;
  for (let attempt = 0; attempt < 3 && !t; attempt++) {
    state.transfer = null;
    ws.send(JSON.stringify({ t: "chat", text: `/room ${roomId}` }));
    t = await waitTransfer(state);
    if (!t) await sleep(2000);
  }
  if (!t) throw new Error(`/room ${roomId}: no transfer granted (admin? room open?)`);
  ws.close();
  return enterRoom(t.wsUrl, t.ticket);
}

async function tp(ws, state, x, z) {
  ws.send(JSON.stringify({ t: "chat", text: `/tp ${x} ${z}` }));
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    if (Math.hypot(state.x - x, state.z - z) < 3) return true;
  }
  return false;
}

const chatWith = (state, needle) => state.chats.some((c) => c.text?.includes(needle));
const findMob = (state, name) =>
  [...state.ents.values()].find((e) => e.kind === "mob" && e.name === name && e.act !== "dead");

// ---- floor-aware interior stepping (greenhood-probe's helpers): lib.mjs
// goTo/heightAt reads the TOP SOLID — the cull-rows' hook-beams (3 blocks
// overhead, players walk under freely) read as walls to it ----
const SOLID_IDS = new Set(
  JSON.parse(readFileSync(new URL("../shared/blocks.json", import.meta.url), "utf8").replace(/^﻿/, ""))
    .blocks.filter((b) => b.solid).map((b) => b.id)
);
function columnGapNear(grid, xi, zi, refY) {
  let best = -1;
  for (let y = 1; y < 46; y++) {
    const below = SOLID_IDS.has(grid.get(xi, y - 1, zi));
    const here = SOLID_IDS.has(grid.get(xi, y, zi));
    const above = SOLID_IDS.has(grid.get(xi, y + 1, zi));
    if (below && !here && !above) {
      if (best < 0 || Math.abs(y - refY) < Math.abs(best - refY)) best = y;
    }
  }
  return best;
}
function floorNear(grid, x, z, refY) {
  const R = 0.31;
  const cells = new Set();
  for (const dx of [-R, R]) for (const dz of [-R, R]) cells.add(`${Math.floor(x + dx)},${Math.floor(z + dz)}`);
  let ny = -1;
  for (const c of cells) {
    const [xi, zi] = c.split(",").map(Number);
    const g = columnGapNear(grid, xi, zi, refY);
    if (g < 0 || g > refY + 1.05) return null;
    if (g > ny) ny = g;
  }
  return ny >= 0 ? ny : refY;
}
function findPathFloor(grid, sx, sz, sy, tx, tz) {
  const w = grid.w, h = grid.h;
  const key = (x, z) => x + z * w;
  const sxi = Math.floor(sx), szi = Math.floor(sz);
  const txi = Math.max(0, Math.min(w - 1, Math.floor(tx)));
  const tzi = Math.max(0, Math.min(h - 1, Math.floor(tz)));
  const feet = new Map([[key(sxi, szi), Math.round(sy)]]);
  const prev = new Map([[key(sxi, szi), -1]]);
  const queue = [[sxi, szi]];
  let best = [sxi, szi];
  let bestD = Math.hypot(sxi - txi, szi - tzi);
  for (let head = 0; head < queue.length && head < 30000; head++) {
    const [x, z] = queue[head];
    const fy = feet.get(key(x, z));
    const d = Math.hypot(x - txi, z - tzi);
    if (d < bestD) { bestD = d; best = [x, z]; if (d === 0) break; }
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      if (nx < 1 || nx >= w - 1 || nz < 1 || nz >= h - 1) continue;
      const k = key(nx, nz);
      if (prev.has(k)) continue;
      const ny = columnGapNear(grid, nx, nz, fy);
      if (ny < 0 || ny > fy + 1.05 || ny < fy - 4) continue;
      feet.set(k, ny);
      prev.set(k, key(x, z));
      queue.push([nx, nz]);
    }
  }
  const path = [];
  let k = key(best[0], best[1]);
  while (k !== -1) {
    path.push([(k % w) + 0.5, Math.floor(k / w) + 0.5]);
    k = prev.get(k);
  }
  path.reverse();
  return path;
}
async function moveToward(ws, state, tx, tz, within = 1.2, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let stepSize = 0.45;
  let lastCorrections = state.corrections;
  let path = findPathFloor(state.terrain, state.x, state.z, state.y, tx, tz);
  let wpi = 0;
  let sincePlan = Date.now();
  while (Date.now() < deadline) {
    if (Math.hypot(tx - state.x, tz - state.z) <= within) return true;
    if (state.corrections > lastCorrections) stepSize = Math.max(0.08, stepSize * 0.5);
    else stepSize = Math.min(0.45, stepSize * 1.15);
    lastCorrections = state.corrections;
    if (wpi >= path.length || Date.now() - sincePlan > 6000) {
      path = findPathFloor(state.terrain, state.x, state.z, state.y, tx, tz);
      wpi = 0;
      sincePlan = Date.now();
      if (path.length <= 1 && Math.hypot(tx - state.x, tz - state.z) > within) {
        await sleep(150);
        continue;
      }
    }
    const [wx, wz] = path[Math.min(wpi, path.length - 1)];
    const dx = wx - state.x;
    const dz = wz - state.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) { wpi++; continue; }
    const step = Math.min(stepSize, d);
    const nx = state.x + (dx / d) * step;
    const nz = state.z + (dz / d) * step;
    const ny = floorNear(state.terrain, nx, nz, state.y);
    if (ny === null) { wpi = path.length; continue; }
    state.seq++;
    state.x = nx; state.z = nz; state.y = ny;
    ws.send(JSON.stringify({ t: "move", seq: state.seq, x: nx, y: ny, z: nz, yaw: Math.atan2(dx, dz), anim: "move" }));
    await sleep(50);
  }
  return Math.hypot(tx - state.x, tz - state.z) <= within;
}

/** Gear up via admin chat and equip the greataxe (boss-events-probe recipe). */
async function gearUp(ws, state) {
  ws.send(JSON.stringify({ t: "chat", text: "/level 30" }));
  ws.send(JSON.stringify({ t: "chat", text: "/give rift_greataxe 1 epic" }));
  ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 8" }));
  await sleep(800);
  let slot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "rift_greataxe");
  if (slot < 0) throw new Error("greataxe never arrived");
  if (slot >= 8) {
    ws.send(JSON.stringify({ t: "invMove", from: slot, to: 1 }));
    await sleep(400);
    slot = 1;
  }
  ws.send(JSON.stringify({ t: "equip", slot }));
  await sleep(300);
}

/** Face-tank a boss, potioning under 350 hp; true once its death event lands. */
async function fight(ws, state, bossId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const dead = () => state.events.some((ev) => ev.kind === "death" && ev.id === bossId);
  while (Date.now() < deadline && !state.died) {
    if (dead()) return true;
    if (state.stats && state.stats.hp < 350) {
      const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
      if (pot >= 0) ws.send(JSON.stringify({ t: "consume", slot: pot }));
    }
    const boss = state.ents.get(bossId);
    if (!boss) { await sleep(300); continue; }
    const dx = boss.x - state.x;
    const dz = boss.z - state.z;
    if (Math.hypot(dx, dz) > 2.4) {
      await goTo(ws, state, boss.x, boss.z, 2.0);
    } else {
      const aim = Math.atan2(dx, dz);
      state.seq++;
      ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: aim, anim: "idle" }));
      ws.send(JSON.stringify({ t: "attack", yaw: aim, pitch: 0 }));
      await sleep(1000);
    }
  }
  return dead();
}

// ---- login as the admin probe bot ----
await api("/api/register", { username: "ossuary_probe", password: "ossuary123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "ossuary_probe", password: "ossuary123" });
if (!account.roles.includes("admin")) {
  console.error("[ossuary] ossuary_probe is not admin — run: node scripts/make-admin.mjs ossuary_probe  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Ossuaryprobe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);

// ---- 1. the Gravelord gate arrives sealed (restage him if a prior run killed him) ----
({ ws, state } = await gotoRoom(ws, state, "dungeon"));
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
let gate = state.portals.find((p) => p.id === "dungeon-depths");
expect(!!gate && gate.target === "ossuary_galleries", "the Gravelord's gate now targets the Ossuary Galleries");
await gearUp(ws, state);
let mino = findMob(state, "The Gravelord");
if (!mino || gate?.open !== false) {
  // stateful dungeon: a prior kill leaves the boss on his 900s timer and the
  // gate open — restage via /spawnmob (spawnMob → onBossSpawned reseals)
  log("     (staging: Gravelord on his respawn timer — /spawnmob restages him)");
  await tp(ws, state, 46, 16);
  ws.send(JSON.stringify({ t: "chat", text: "/spawnmob minotaur_boss 1" }));
  await sleep(1500);
  mino = findMob(state, "The Gravelord");
}
// portalState carries {target, open} — the /spawnmob restage broadcasts the reseal
const sealedState = [...state.portalStates].reverse().find((p) => p.target === "ossuary_galleries");
const sealedNow = sealedState ? sealedState.open === false : gate?.open === false;
expect(!!mino && sealedNow, `the gate is sealed while the Gravelord lives (open=${sealedState?.open ?? gate?.open})`);
if (!mino) { log("RESULT: FAIL"); process.exit(1); }

// ---- 2. kill him: "the lower stair stands open" ----
await tp(ws, state, 46, 18);
const minoDead = await fight(ws, state, mino.id);
expect(minoDead, `Gravelord killed (bot hp ${state.stats?.hp}, died=${state.died})`);
expect(chatWith(state, "stands open"), "the bible's gate line announced (\"the lower stair stands open\")");
const opened = state.portalStates.find((p) => p.target === "ossuary_galleries" && p.open === true);
expect(!!opened, "portalState {ossuary_galleries, open:true} replicated");

// ---- 3. through the gate: twin-gate arrival in the galleries ----
await goTo(ws, state, 46, 7.5, 1.6);
state.transfer = null;
let t1 = null;
for (let attempt = 0; attempt < 3 && !t1; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "dungeon-depths" }));
  t1 = await waitTransfer(state, 5000);
}
expect(!!t1, "the opened gate grants a transfer");
if (!t1) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(t1.wsUrl, t1.ticket));
expect(state.roomId === "ossuary_galleries", `arrived in ${state.roomId}`);
const dGate = Math.hypot(state.x - 64, state.z - 121);
expect(dGate < 6, `twin-gate arrival beside ossuary-dungeon (${state.x.toFixed(1)},${state.z.toFixed(1)}, ${dGate.toFixed(1)}m)`);

// ---- 4. walk the S-route to the Warden's post ----
const ROUTE = [
  [64, 104], // the spine
  [64, 74], // the grading-hall south door
  [52, 62], // through the shelf-row zigzag
  [44, 46], // the north-west door
  [44, 38], // the stitchery corridor
  [38, 26], // the stitchery floor
  [50, 22], // its east door
  [66, 22], // the north corridor
  [82, 26], // the cull-rows
  [96, 25], // the platform door
  [108, 26], // the Warden's post
];
let routeOk = true;
for (const [wx, wz] of ROUTE) {
  if (state.stats && state.stats.hp < 400) {
    const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
    if (pot >= 0) ws.send(JSON.stringify({ t: "consume", slot: pot }));
    await sleep(900);
  }
  // floor-gap stepping: the cull-rows' hook-beams sit 3 blocks overhead —
  // players walk under them, but lib goTo's top-solid heightAt reads a wall
  const ok = await moveToward(ws, state, wx, wz, 1.8);
  if (!ok) {
    log(`     (stalled at ${state.x.toFixed(1)},${state.z.toFixed(1)} heading for ${wx},${wz})`);
    routeOk = false;
    break;
  }
}
expect(routeOk, `walked the S-route through the galleries (${state.x.toFixed(1)},${state.z.toFixed(1)}; ${state.corrections} corrections)`);
await sleep(800);
const warden = findMob(state, "Bone Warden of the Galleries");
expect(!!warden, `THE Bone Warden stands his post ${warden ? `(${warden.x.toFixed(0)},${warden.z.toFixed(0)}, L${warden.level}, hp ${warden.hp}/${warden.maxHp})` : ""}`);
if (warden) {
  expect(warden.level === 12, `the Warden is L12 (band-top+1), got L${warden.level}`);
  expect(warden.maxHp === 791, `boss-rank hp 791, got ${warden.maxHp}`);
}

// ---- 5. through to crypt_depths and back ----
await tp(ws, state, 111, 25); // beside the arch line (never path UNDER a lintel)
await goTo(ws, state, 112.8, 23.2, 0.9);
state.transfer = null;
let t2 = null;
for (let attempt = 0; attempt < 3 && !t2; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "ossuary-depths" }));
  t2 = await waitTransfer(state, 5000);
}
expect(!!t2, "ossuary-depths grants a transfer (no gate of its own — the Court's door is a door)");
if (!t2) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(t2.wsUrl, t2.ticket));
expect(state.roomId === "crypt_depths", `descended into ${state.roomId}`);
const dDepths = Math.hypot(state.x - 48, state.z - 90);
expect(dDepths < 6, `twin-gate arrival beside depths-ossuary (${state.x.toFixed(1)},${state.z.toFixed(1)}, ${dDepths.toFixed(1)}m)`);
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
expect(state.portals.some((p) => p.id === "depths-ossuary" && p.target === "ossuary_galleries"), "the depths' gate targets the galleries back");
// straight back up (step INSIDE the trigger radius first — arrivals land
// r+1.0 = 3.2m out, just beyond the 2.2m trigger)
await goTo(ws, state, 48, 89.3, 0.7);
state.transfer = null;
let t3 = null;
for (let attempt = 0; attempt < 3 && !t3; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "depths-ossuary" }));
  t3 = await waitTransfer(state, 5000);
}
expect(!!t3, "depths-ossuary grants the return transfer");
if (!t3) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(t3.wsUrl, t3.ticket));
expect(state.roomId === "ossuary_galleries", `back up in ${state.roomId}`);
expect(Math.hypot(state.x - 112, state.z - 26) < 8, `landed beside the Warden's post (${state.x.toFixed(1)},${state.z.toFixed(1)}) — his door, his watch`);

// ---- 6. the hidden chapel: slip the crack, meet the Wrung Shade ----
await tp(ws, state, 96, 92); // the dead-cart lane spur
await goTo(ws, state, 100.5, 86.5, 0.8); // the 1-wide crack in the west wall
await goTo(ws, state, 105, 87, 1.5);
await sleep(800);
const shade = findMob(state, "Pallid Mourner Wrung Shade");
expect(!!shade, `the Wrung Shade haunts the chapel ${shade ? `(${shade.x.toFixed(0)},${shade.z.toFixed(0)}, L${shade.level})` : ""}`);
if (shade) expect(shade.level === 13, `the shade is L13 (the bible's 6/rank-13 call), got L${shade.level}`);

// ---- 7. home ----
state.transfer = null;
ws.send(JSON.stringify({ t: "returnToHub" }));
const t4 = await waitTransfer(state);
expect(!!t4, "returnToHub grants a transfer");
if (t4) {
  ws.close();
  ({ ws, state } = await enterRoom(t4.wsUrl, t4.ticket));
  expect(state.roomId === "hub", `home in ${state.roomId}`);
}

ws.close();
log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
