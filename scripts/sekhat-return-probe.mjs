/**
 * Live probe for SMART-MOB PATHFINDING (owner: "I pulled the sunscour tomb
 * boss all the way out of the tomb... when it leashed it couldn't pathfind
 * back inside"). Bosses (resolved `boss` flag) + `smartPath` opt-ins now
 * plan purposeful moves with a room-scale A* (planSmartPath); every mob also
 * carries a return FAILSAFE (no net progress toward home for
 * mobs.returnFailsafeSec → evade-snap home).
 *
 * The arc:
 *   1. /room desert, /tp to the sand south of the Colossus, walk INTO the
 *      five-room tomb (floor-gap BFS — the tomb is roofed) to the Vessel.
 *   2. hit Sekhat the Ninth ONCE (Wave-1 LOS rules: damage threat is the
 *      reliable pull) and run back out; he chases — which itself exercises
 *      chase-side smart planning out of the tomb.
 *   3. loiter on open sand until he's dragged WELL CLEAR of the doorway,
 *      then sprint past his leash (26) to force the reset.
 *   4. watch him WALK back: dist-to-home shrinking, hp climbing (return
 *      heal), y dropping back to the Vessel floor (7) — i.e. he re-entered
 *      the tomb INTERIOR, not the roof 37 blocks above it.
 *   5. CONTROL: the failsafe never fired — no per-snapshot displacement
 *      jump anywhere in the return (a snap would be a 20-30 m delta), and
 *      the walk took real time.
 *   6. tick health: /api/admin/overview desert tick avg stays sane.
 *
 * Needs admin: node scripts/make-admin.mjs sekhat_probe
 * Exits 0 on success, 1 on any failed expectation, 2 if not admin.
 *
 *   MMO_MASTER_ORIGIN=http://[::1]:4180 node scripts/sekhat-return-probe.mjs
 */
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { loadEnv, makeWorldTracker, sleep } from "./lib.mjs";

loadEnv();
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const ADMIN_KEY = process.env.ADMIN_KEY ?? "";

const HOME = { x: 238.5, z: 246.5 }; // sekhat's spawn disk center (Vessel Chamber)
const VESSEL_Y_MAX = 9; // vessel floor is ~7; the surface above reads ~44
// the Vessel Chamber interior (setpieces_desert carveRoom 231..245 → interior
// x232..244, z240..252): ARRIVAL = standing inside it at floor level. His
// actual brain.home is wherever the spawner ROLLED in the r6 disk — a fixed
// 3 m radius around the disk center missed a legitimate walk-home (run 4).
const VESSEL = { x0: 232, x1: 244, z0: 240, z1: 252 };
const inVessel = (s) => s.x >= VESSEL.x0 && s.x <= VESSEL.x1 && s.z >= VESSEL.z0 && s.z <= VESSEL.z1 && (s.y ?? 99) <= VESSEL_Y_MAX;
const LEASH = 26;

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

const log = (...a) => console.log("[sekhat]", ...a);
let failed = false;
function expect(cond, what) {
  if (cond) log(`OK   ${what}`);
  else {
    failed = true;
    log(`FAIL ${what}`);
  }
}

function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const tracker = makeWorldTracker();
    const state = {
      roomId: null, selfId: -1, x: 0, y: 0, z: 0, seq: 0,
      terrain: null, transfer: null, corrections: 0,
      ents: new Map(), stats: null, inv: null, events: [], chats: [],
      died: false,
    };
    const timer = setTimeout(() => reject(new Error("room join timeout")), 25000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome":
          state.roomId = msg.roomId;
          state.selfId = msg.selfId;
          state.x = msg.spawn.x; state.y = msg.spawn.y; state.z = msg.spawn.z;
          for (const e of msg.ents) state.ents.set(e.id, e);
          break;
        case "world": case "chunks": case "blockSet": {
          const s = tracker.handle(msg);
          if (s) state.terrain = s;
          break;
        }
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
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; state.corrections = (state.corrections ?? 0) + 1; break;
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
    await sleep(100);
  }
  return null;
}

async function gotoRoom(ws, state, roomId) {
  if (state.roomId === roomId) return { ws, state };
  state.transfer = null;
  ws.send(JSON.stringify({ t: "chat", text: `/room ${roomId}` }));
  const t = await waitTransfer(state);
  if (!t) throw new Error(`/room ${roomId}: no transfer granted (admin? room open?)`);
  ws.close();
  return enterRoom(t.wsUrl, t.ticket);
}

// ---- floor-aware interior stepping (the greenhood/ossuary helpers: lib.mjs
// goTo reads the TOP SOLID, and the tomb is roofed — its roof reads as a
// wall to the surface sampler) ----
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
  for (let head = 0; head < queue.length && head < 60000; head++) {
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
function drinkLow(ws, state) {
  if (state.stats && state.stats.hp < 450) {
    const pot = (state.inv?.slots ?? []).findIndex((sl) => sl && sl.item === "greater_health_potion");
    if (pot >= 0) ws.send(JSON.stringify({ t: "consume", slot: pot }));
  }
}
async function moveToward(ws, state, tx, tz, within = 1.2, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let stepSize = 0.45;
  let lastCorrections = state.corrections;
  let path = findPathFloor(state.terrain, state.x, state.z, state.y, tx, tz);
  let wpi = 0;
  let sincePlan = Date.now();
  let sinceDrink = 0;
  while (Date.now() < deadline) {
    if (++sinceDrink >= 20) { sinceDrink = 0; drinkLow(ws, state); } // survive a boss on our heels
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

const findSekhat = (state) =>
  [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "Sekhat the Ninth" && e.act !== "dead");
const distHome = (e) => Math.hypot(e.x - HOME.x, e.z - HOME.z);

async function tickAvg() {
  try {
    const o = await (await fetch(`${MASTER}/api/admin/overview?key=${encodeURIComponent(ADMIN_KEY)}`)).json();
    for (const s of o.shards ?? []) {
      for (const r of s.rooms ?? []) {
        if (r.roomId === "desert") return { avg: r.info?.tickAvgMs ?? null, max: r.info?.tickMaxMs ?? null };
      }
    }
  } catch { /* overview shape drift is non-fatal for the probe */ }
  return { avg: null, max: null };
}

// ---- login ----
await api("/api/register", { username: "sekhat_probe", password: "sek123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "sekhat_probe", password: "sek123" });
if (!account.roles.includes("admin")) {
  console.error("[sekhat] sekhat_probe is not admin — run: node scripts/make-admin.mjs sekhat_probe  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Sekhatprobe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId}`);

// ---- 1. desert: stage south of the tomb, walk in to the Vessel ----
({ ws, state } = await gotoRoom(ws, state, "desert"));
expect(state.roomId === "desert", "in the desert");
ws.send(JSON.stringify({ t: "chat", text: "/level 30" }));
ws.send(JSON.stringify({ t: "chat", text: "/give iron_sword 1" }));
ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 12" }));
await sleep(800);
let slot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "iron_sword");
if (slot >= 8) {
  ws.send(JSON.stringify({ t: "invMove", from: slot, to: 1 }));
  await sleep(400);
  slot = 1;
}
if (slot >= 0) ws.send(JSON.stringify({ t: "equip", slot }));
await sleep(300);

ws.send(JSON.stringify({ t: "chat", text: "/tp 238 280" }));
await sleep(700);
expect(Math.hypot(state.x - 238, state.z - 280) < 3, `staged on the south sand (${state.x.toFixed(1)},${state.z.toFixed(1)} y${state.y.toFixed(1)})`);

const baseTick = await tickAvg();
log(`     desert tick baseline avg=${baseTick.avg} max=${baseTick.max}`);

// The tomb is entered between the Colossus's knees: south sand → porch
// (z258..262) → past the sagging gate (bars at x237 only) → the entrance
// stair at (240..231, z257) descending WEST to the landing at Fp≈7. The
// 2D floor-BFS is level-ambiguous over a roofed tomb (it happily walks the
// ROOF — the first probe run proved it), so the descent is walked cell by
// cell along the stair line, then the interior BFS takes over at depth.
async function hop(x, z, tmo = 9000) {
  return moveToward(ws, state, x, z, 0.5, tmo);
}
await moveToward(ws, state, 238.5, 263.5, 1.0, 30000); // south porch approach
await hop(238.5, 260.5); // onto the porch
await hop(239.5, 258.5); // through the gate line (east of the bars)
await hop(240.5, 257.5); // the stair mouth
for (let x = 239.5; x >= 230.5; x -= 1) await hop(x, 257.5); // down the treads
expect(state.y <= VESSEL_Y_MAX + 2, `descended the entrance stair (${state.x.toFixed(1)},${state.z.toFixed(1)} y${state.y.toFixed(1)})`);
const walkedIn = await moveToward(ws, state, 238.5, 249.5, 2.0, 60000); // interior BFS to the Vessel
expect(walkedIn, `walked the tomb interior to the Vessel (${state.x.toFixed(1)},${state.z.toFixed(1)} y${state.y.toFixed(1)})`);
expect(state.y <= VESSEL_Y_MAX, `standing on the Vessel floor level (y=${state.y.toFixed(1)})`);

let sekhat = findSekhat(state);
expect(!!sekhat, `Sekhat found ${sekhat ? `at ${sekhat.x.toFixed(1)},${sekhat.z.toFixed(1)} (y=${(sekhat.y ?? 0).toFixed(1)}, hp ${sekhat.hp}/${sekhat.maxHp})` : ""}`);
if (!sekhat) { log("RESULT: FAIL"); process.exit(1); }
expect(sekhat.boss === true, "boss flag rides the wire (smart-path eligibility)");
const sekhatId = sekhat.id;
const maxHp = sekhat.maxHp;

// ---- 2. one hit to pull (damage threat bypasses LOS) ----
let hitLanded = false;
for (let i = 0; i < 10 && !hitLanded; i++) {
  const s = state.ents.get(sekhatId);
  if (!s) break;
  if ((s.hp ?? maxHp) < maxHp) { hitLanded = true; break; }
  if (Math.hypot(s.x - state.x, s.z - state.z) > 2.0) {
    await moveToward(ws, state, s.x, s.z, 1.6, 8000);
  }
  const aim = Math.atan2(s.x - state.x, s.z - state.z);
  state.seq++;
  ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: aim, anim: "idle" }));
  ws.send(JSON.stringify({ t: "attack", yaw: aim, pitch: 0 }));
  await sleep(700);
}
sekhat = state.ents.get(sekhatId);
expect((sekhat?.hp ?? maxHp) < maxHp, `hit landed (sekhat hp ${sekhat?.hp}/${maxHp}) — he knows`);

// ---- 3. staged pull-out: walk out ahead of him, WAIT at each stage so his
// chase paths stay valid (a sprinting target invalidates every plan) ----
async function waitForSekhatNear(radius, minY, tmoMs, label) {
  const until = Date.now() + tmoMs;
  while (Date.now() < until) {
    const s = state.ents.get(sekhatId);
    if (s && Math.hypot(s.x - state.x, s.z - state.z) < radius && (s.y ?? 0) >= minY) return true;
    drinkLow(ws, state);
    await sleep(250);
  }
  log(`     (timeout waiting: ${label})`);
  return false;
}
// out of the Vessel and up the stair, cell by cell again
await moveToward(ws, state, 229.5, 257.5, 1.2, 60000); // interior back to the landing
for (let x = 231.5; x <= 240.5; x += 1) await hop(x, 257.5); // up the treads
await hop(239.5, 259.5); // porch
const chasedToPorch = await waitForSekhatNear(9, 0, 60000, "sekhat to the porch");
expect(chasedToPorch, "Sekhat chased through the tomb to the entrance (chase-side planning)");
// onto the open sand, still inside his leash (26) so the chase continues
await moveToward(ws, state, 238.5, 270.5, 1.5, 30000);
const chasedToSand = await waitForSekhatNear(8, 11, 60000, "sekhat onto the sand");
sekhat = state.ents.get(sekhatId);
expect(chasedToSand, `Sekhat chased out onto the open sand (at ${sekhat ? `${sekhat.x.toFixed(1)},${sekhat.z.toFixed(1)} y${(sekhat.y ?? 0).toFixed(1)}, ${distHome(sekhat).toFixed(1)} from home` : "?"})`);

// break the leash: sprint well past 26 and let him cross it chasing
await moveToward(ws, state, 238.5, 284.5, 2.0, 30000);
let clearOfDoor = false;
for (let i = 0; i < 240; i++) {
  const s = state.ents.get(sekhatId);
  if (s && distHome(s) > 20 && (s.y ?? 0) > 11) { clearOfDoor = true; break; }
  drinkLow(ws, state);
  await sleep(250);
}
sekhat = state.ents.get(sekhatId);
expect(clearOfDoor, `dragged well clear of the doorway (${sekhat ? `${distHome(sekhat).toFixed(1)} from home, y${(sekhat.y ?? 0).toFixed(1)}` : "?"})`);

// ---- 4. the leash fires; watch him WALK home ----
// stand still and observe: threat clears on the reset, and `return` ignores
// non-threat players, so watching from 30+ m is safe
const t0 = Date.now();
const trace = [];
let arrived = false;
let maxJump = 0;
let turnaround = false;
let lastD = null;
let shrinkStreak = 0;
let sawInteriorY = false;
let lastPos = null;
let hpAtArrival = 0;
while (Date.now() - t0 < 150000) {
  const s = state.ents.get(sekhatId);
  if (s) {
    const d = distHome(s);
    if (lastPos) {
      const jump = Math.hypot(s.x - lastPos.x, s.z - lastPos.z);
      if (jump > maxJump) maxJump = jump;
    }
    lastPos = { x: s.x, z: s.z };
    if (lastD !== null && d < lastD - 0.05) {
      shrinkStreak++;
      if (shrinkStreak >= 4) turnaround = true;
    } else if (lastD !== null && d > lastD + 0.05) {
      shrinkStreak = 0;
    }
    lastD = d;
    if ((s.y ?? 99) <= VESSEL_Y_MAX && d < 15) sawInteriorY = true;
    trace.push({ t: Date.now() - t0, x: +s.x.toFixed(1), z: +s.z.toFixed(1), y: +(s.y ?? 0).toFixed(1), d: +d.toFixed(1), hp: s.hp });
    if (inVessel(s) && (s.hp ?? 0) >= maxHp) {
      arrived = true;
      hpAtArrival = s.hp ?? 0;
      break;
    }
  }
  await sleep(300);
}
const returnSec = (Date.now() - t0) / 1000;
expect(turnaround, "leash reset: he turned and closed on home over sustained samples");
expect(sawInteriorY, "he re-entered the tomb INTERIOR (y dropped to the Vessel level inside)");
expect(arrived, `he WALKED back to the Vessel (${returnSec.toFixed(0)}s${lastPos ? `, last at ${lastPos.x.toFixed(1)},${lastPos.z.toFixed(1)}` : ""})`);
expect(hpAtArrival >= maxHp, `healed to full at home (hp ${hpAtArrival}/${maxHp} — leash-reset semantics)`);

// ---- 5. CONTROL: the failsafe never fired ----
expect(maxJump < 4, `no teleport anywhere in the return (max per-snapshot displacement ${maxJump.toFixed(2)} m)`);
expect(returnSec > 8, `the walk took real time (${returnSec.toFixed(0)}s — a snap would be instant)`);

// a compact route log for the report
const every = Math.max(1, Math.floor(trace.length / 12));
log("     return trace (t s, x, z, y, distHome, hp):");
for (let i = 0; i < trace.length; i += every) {
  const p = trace[i];
  log(`       ${(p.t / 1000).toFixed(0).padStart(3)}s  ${p.x},${p.z} y${p.y}  d=${p.d}  hp=${p.hp}`);
}

// ---- 6. tick health under smart planning ----
const endTick = await tickAvg();
log(`     desert tick after probe avg=${endTick.avg} max=${endTick.max} (baseline avg=${baseTick.avg} max=${baseTick.max})`);
if (endTick.avg !== null) expect(endTick.avg < 10, `desert tick avg healthy under smart planning (${endTick.avg} ms)`);

ws.close();
log(failed ? "RESULT: FAIL" : "RESULT: ALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
