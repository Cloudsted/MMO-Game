/**
 * Live probe for THE FOUNDRY (world-redesign batch 7) — the L14-16 preset
 * interior behind the Cinderrift's boss gate, and the east branch's
 * reconnect junction:
 *   1. /room cinderrift → the NEW cinderrift-foundry portal (behind the
 *      Forge Ruin) arrives SEALED; usePortal is denied with the guardian
 *      message. Restages the Furnace Golem via /spawnmob if a prior run
 *      left him on his 900 s stateful timer.
 *   2. gears up and kills the Furnace Golem → the bible's announce ("the
 *      Foundry gate stands open") + portalState {foundry, open:true}.
 *   3. walks BEHIND the ruin to the gate (stand ONE row off the arch line)
 *      → transfer → twin-gate arrival at the foundry's rift court.
 *   4. walks the works with its own floor-gap BFS (the hall is beamed —
 *      lib goTo reads the part-roof as walls): south gate court → the long
 *      hall's S crosswalls → THE UNFINISHED KING alive before the empty
 *      throne-sized frame (L17, 1495 hp — forge_prototype elevated by the
 *      boss rank, name override on the wire).
 *   5. the junction gates: usePortal foundry-fields → the Sundering Fields
 *      east gate; back; usePortal foundry-city → Valdrenn's east breach
 *      (the authored 240,128 landing the breach has always used).
 *
 * Needs admin: node scripts/make-admin.mjs foundry_probe   (then rerun)
 * Exits 0 on success, 1 on any failed expectation, 2 if not admin.
 *
 *   node scripts/foundry-probe.mjs
 */
import { readFileSync } from "node:fs";
import WebSocket from "ws";
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

const log = (...a) => console.log("[foundry]", ...a);
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

// ---- floor-aware interior stepping (the greenhood/ossuary helpers):
// lib.mjs goTo/heightAt reads the TOP SOLID — the foundry hall's beamed
// part-roof reads as walls to it; players walk under freely ----
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
  for (let head = 0; head < queue.length && head < 40000; head++) {
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
async function moveToward(ws, state, tx, tz, within = 1.2, timeoutMs = 30000) {
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
  ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
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

/** Face-tank a boss with the greataxe, potioning under 400 hp. */
async function fight(ws, state, bossId, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  const dead = () => state.events.some((ev) => ev.kind === "death" && ev.id === bossId);
  while (Date.now() < deadline && !state.died) {
    if (dead()) return true;
    if (state.stats && state.stats.hp < 400) {
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
await api("/api/register", { username: "foundry_probe", password: "foundry123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "foundry_probe", password: "foundry123" });
if (!account.roles.includes("admin")) {
  console.error("[foundry] foundry_probe is not admin — run: node scripts/make-admin.mjs foundry_probe  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Foundryprobe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);

// ---- 1. the rift gate arrives sealed while the Furnace Golem lives ----
({ ws, state } = await gotoRoom(ws, state, "cinderrift"));
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
let riftGate = state.portals.find((p) => p.id === "cinderrift-foundry");
expect(!!riftGate && riftGate.target === "foundry", "the NEW cinderrift-foundry portal replicates (behind the Forge Ruin)");
await gearUp(ws, state);
if (riftGate?.open !== false) {
  // a prior run killed the golem and his 900 s window is still open — restage
  // (only when the gate is actually OPEN: at room spawn the living golem is
  // simply out of interest, and a blind /spawnmob would mint a second boss)
  log("     (staging: the golem is on his respawn timer — /spawnmob restages him and reseals the gate)");
  await tp(ws, state, 144, 60);
  ws.send(JSON.stringify({ t: "chat", text: "/spawnmob cinder_golem_boss 1" }));
  await sleep(1500);
  const st = state.portalStates.filter((p) => p.target === "foundry").pop();
  riftGate = { ...riftGate, open: st ? st.open : riftGate?.open };
}
let golem = null;
expect(riftGate?.open === false, "cinderrift-foundry boots/reseals SEALED while the Furnace-King burns");
ws.send(JSON.stringify({ t: "usePortal", portalId: "cinderrift-foundry" }));
for (let i = 0; i < 30 && !chatWith(state, "guardian"); i++) await sleep(100);
expect(chatWith(state, "guardian"), "sealed gate denied with the guardian message");

// ---- 2. kill the Furnace Golem: the bible's announce opens the gate ----
await tp(ws, state, 144, 52);
await sleep(800);
golem = findMob(state, "Furnace Golem");
expect(!!golem, `Furnace Golem found at ${golem ? `${golem.x.toFixed(0)},${golem.z.toFixed(0)}` : "?"}`);
if (!golem) { log("RESULT: FAIL"); process.exit(1); }
const golemDead = await fight(ws, state, golem.id);
expect(golemDead, `Furnace Golem killed (bot hp ${state.stats?.hp}, died=${state.died})`);
expect(chatWith(state, "the Foundry gate stands open"), "the bible's gate announce fired");
expect(state.portalStates.some((p) => p.target === "foundry" && p.open === true), "portalState {foundry, open:true} replicated");

// ---- 3. behind the ruin, through the gate ----
const behind = await goTo(ws, state, 144, 18.2, 1.2); // one row off the arch line, inside the trigger
expect(behind, `walked behind the Forge Ruin to the gate (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
state.transfer = null;
let tF = null;
for (let attempt = 0; attempt < 3 && !tF; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "cinderrift-foundry" }));
  tF = await waitTransfer(state, 5000);
}
expect(!!tF, "the event-opened gate grants a transfer");
if (!tF) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tF.wsUrl, tF.ticket));
expect(state.roomId === "foundry", `arrived in ${state.roomId}`);
const dCourt = Math.hypot(state.x - 80, state.z - 148);
expect(dCourt < 6, `twin-gate arrival at the rift court (${state.x.toFixed(1)},${state.z.toFixed(1)}, ${dCourt.toFixed(1)}m)`);

// ---- 4. the works: S-bent hall to the Unfinished King ----
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
expect(state.portals.some((p) => p.id === "foundry-fields" && p.open), "foundry-fields replicates open");
expect(state.portals.some((p) => p.id === "foundry-city" && p.open), "foundry-city replicates open");
const LEGS = [
  [80, 134], // the south gate court
  [80, 118], // through the works door
  [91, 95], // the east crosswall door
  [67, 63], // the west crosswall door
  [80, 44], // the ward doors
];
let inHall = true;
for (const [wx, wz] of LEGS) {
  if (state.stats && state.stats.hp < 450) {
    const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
    if (pot >= 0) ws.send(JSON.stringify({ t: "consume", slot: pot }));
    await sleep(900);
  }
  const ok = await moveToward(ws, state, wx, wz, 1.6);
  if (!ok) {
    log(`     (stalled at ${state.x.toFixed(1)},${state.z.toFixed(1)} heading for ${wx},${wz})`);
    inHall = false;
    break;
  }
}
expect(inHall, `walked the S-bent line to the ward doors (${state.x.toFixed(1)},${state.z.toFixed(1)}; ${state.corrections} corrections)`);
await sleep(1200);
const king = findMob(state, "The Unfinished King");
expect(!!king, `THE UNFINISHED KING stands before the empty frame ${king ? `(${king.x.toFixed(0)},${king.z.toFixed(0)}, L${king.level}, hp ${king.hp}/${king.maxHp})` : ""}`);
if (king) {
  expect(king.level === 17, `the King is L17 (band-top+1), got L${king.level}`);
  expect(king.maxHp === 1495, `boss-trend hp 1495 (Osmund's peer), got ${king.maxHp}`);
}

// ---- 5. the junction gates: fields, then the city breach ----
const westOk = await moveToward(ws, state, 18.5, 80.5, 1.4, 45000);
expect(westOk, `walked out the west gate lane (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
state.transfer = null;
let tW = null;
for (let attempt = 0; attempt < 3 && !tW; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "foundry-fields" }));
  tW = await waitTransfer(state, 5000);
}
expect(!!tW, "foundry-fields grants a transfer");
if (!tW) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tW.wsUrl, tW.ticket));
expect(state.roomId === "sundering_fields", `the west door lands in ${state.roomId}`);
expect(Math.hypot(state.x - 262, state.z - 116) < 6, `beside the fields' foundry gate (${state.x.toFixed(1)},${state.z.toFixed(1)})`);

({ ws, state } = await gotoRoom(ws, state, "foundry"));
const eastOk = await moveToward(ws, state, 141.5, 80.5, 1.4, 45000);
expect(eastOk, `walked out the east gate lane (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
state.transfer = null;
let tC = null;
for (let attempt = 0; attempt < 3 && !tC; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "foundry-city" }));
  tC = await waitTransfer(state, 5000);
}
expect(!!tC, "foundry-city grants a transfer");
if (!tC) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tC.wsUrl, tC.ticket));
expect(state.roomId === "sundered_city", `the east door lands in ${state.roomId}`);
expect(
  Math.hypot(state.x - 240, state.z - 128) < 2,
  `the breach's authored landing held (${state.x.toFixed(1)},${state.z.toFixed(1)} vs 240,128)`
);

ws.close();
log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
