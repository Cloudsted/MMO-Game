/**
 * Live probe for THE GREENHOOD RUN (world-redesign batch 3) — owner seed #1,
 * the fort-gated hidden branch:
 *   1. /room forest, /tp beside the fort: the forest-greenhood portal reads
 *      SEALED (Thrace alive) and usePortal is denied with the guardian line.
 *   2. gear up, /tp into the fort, kill Thrace the Redcap through his camp —
 *      the bossDeath event announces ("the Run is lit") and opens the gate
 *      (portalState open=true).
 *   3. walk the authored route: south gate → camp → inner gap → the yard →
 *      usePortal → the Run. Arrival lands in the entrance shaft (underground,
 *      y≈12 — proving the open-to-sky shaft ground-snap).
 *   4. walk the warren waypoints (floor-aware stepping — goTo paths over the
 *      CAP in roofed rooms) to the tally-vault, kill Quartermaster Grole
 *      (50% audit line best-effort, death announce hard), loot the bag and
 *      assert the guaranteed greenhood_ledger_page trophy.
 *   5. continue past the den to the East Door, usePortal greenhood-out →
 *      the ONE-WAY landing at the STRANGLER'S MARCH trapdoor mound
 *      (28.5,148.5, on the crown — no portal exists there; batch 4
 *      re-pointed the climb-out from the forest north into the march west).
 *   6. reseal: /spawnmob thrace_redcap (SHORTCUT for the natural 900 s
 *      respawn — the admin command routes through the same spawnMob →
 *      onBossSpawned path as the spawner timer) → the gate reads sealed.
 *
 * Contamination discipline (LESSONS.md): the probe restarts the forest
 * RoomHost BEFORE (a prior run may have left Thrace dead / strays parked)
 * and AFTER itself (it /spawnmob-ed a Thrace at the mound; command mobs
 * never despawn and stateful rooms resume from snapshot minus strays).
 *
 * Needs admin: node scripts/make-admin.mjs greenhood_probe   (then rerun)
 * Exits 0 on success, 1 on any failed expectation, 2 if not admin.
 *
 *   node scripts/greenhood-probe.mjs
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { loadEnv, makeWorldTracker, sleep, goTo } from "./lib.mjs";

loadEnv();
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const ADMIN_KEY = process.env.ADMIN_KEY ?? "";

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

const log = (...a) => console.log("[greenhood]", ...a);
let failed = false;
function expect(cond, what) {
  if (cond) log(`OK   ${what}`);
  else { failed = true; log(`FAIL ${what}`); }
}

async function restartForest(label) {
  await fetch(`${MASTER}/api/admin/restart-room?key=${ADMIN_KEY}&roomId=forest`, { method: "POST" }).catch(() => {});
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const s = await fetch(`${MASTER}/api/status`).then((r) => r.json()).catch(() => null);
    if (s?.shards?.some((sh) => (sh.rooms ?? []).some((r) => r.roomId === "forest" && r.status === "open"))) {
      await sleep(1500);
      log(`(forest restarted — ${label})`);
      return;
    }
  }
  throw new Error("forest never came back");
}

function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const tracker = makeWorldTracker();
    const state = {
      roomId: null, selfId: -1, x: 0, y: 0, z: 0, seq: 0,
      terrain: null, portals: [], portalStates: [], transfer: null,
      ents: new Map(), stats: null, inv: null,
      events: [], chats: [], died: false, hits: [], corrections: 0,
      lastAttackerId: -1, lastAttackAt: 0,
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
        case "evt":
          state.events.push(msg.e);
          // incoming-damage ledger: on a bot death we want to know WHO won —
          // and who to hunt (a fleeing brigand shells from beyond any radius)
          if (msg.e.kind === "dmg" && msg.e.tgt === state.selfId) {
            const src = state.ents.get(msg.e.src);
            state.hits.push(`${src?.name ?? "?" + msg.e.src} ${msg.e.amount}`);
            if (state.hits.length > 20) state.hits.shift();
            state.lastAttackerId = msg.e.src;
            state.lastAttackAt = Date.now();
          }
          break;
        case "chat": state.chats.push(msg); break;
        case "died": state.died = true; break;
        case "transfer": state.transfer = msg; break;
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; state.corrections++; break;
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
  let t = null;
  for (let attempt = 0; attempt < 3 && !t; attempt++) {
    state.transfer = null;
    ws.send(JSON.stringify({ t: "chat", text: `/room ${roomId}` }));
    t = await waitTransfer(state);
    if (!t) await sleep(2000); // a just-restarted room may still be registering
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
const findMob = (state, mobName) =>
  [...state.ents.values()].find((e) => e.kind === "mob" && e.name === mobName && e.act !== "dead");

/** Drink (or restock — the probe is admin) a potion. Returns true if a
 *  consume was sent; the caller should skip its swing that loop. */
function drinkPotion(ws, state) {
  const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
  if (pot < 0) {
    ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
    return true; // restocking counts as this loop's action
  }
  ws.send(JSON.stringify({ t: "consume", slot: pot }));
  return true;
}

// ---- floor-aware interior stepping (probe mirror of city-probe's helpers;
// goTo/heightAt path over the CAP ROCK in roofed rooms — useless in a warren)
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
    if (g < 0 || g > refY + 1.05) return null; // wall/no-gap cell: blocked
    if (g > ny) ny = g;
  }
  return ny >= 0 ? ny : refY;
}
/** 4-way BFS over walkable FLOOR gaps (solid below, 2 of headroom; step-up
 *  ≤1, drop ≤4) — the roofed-warren analog of lib.mjs findPath, whose
 *  heightAt reads the CAP. Consecutive waypoints are orthogonal cell
 *  centers, so the followed line never clips a shoring-frame post. */
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

/** Floor-aware travel: BFS a route, follow it cell center to cell center.
 *  Correction-aware: a debuff slow (enforcer iron_bash) makes full-speed
 *  steps rejectable — every packet snaps back and progress reads zero. On
 *  corrections, back the step size off and creep; recover when clean. */
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
    // replan if the plan went stale (knocked around, corrected, target moved)
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
    if (ny === null) { wpi = path.length; continue; } // clipped something: replan
    state.seq++;
    state.x = nx; state.z = nz; state.y = ny;
    ws.send(JSON.stringify({ t: "move", seq: state.seq, x: nx, y: ny, z: nz, yaw: Math.atan2(dx, dz), anim: "move" }));
    await sleep(110);
  }
  return false;
}
async function walkWaypoints(ws, state, points, label) {
  for (const [wx, wz] of points) {
    // combat guard: never walk while something is actively landing hits —
    // a chip-damage trail (11/hit) kills a bot that neither fights nor heals
    if (Date.now() - state.lastAttackAt < 2500 || (state.stats && state.stats.hp < 450)) {
      await clearAdds(ws, state, 18);
    }
    // tight tolerance: the waypoints thread 1-cell gaps between shoring-frame
    // posts — a loose "close enough" lets the next leg cut a blocked diagonal
    const ok = await moveToward(ws, state, wx, wz, 0.55);
    if (!ok) { log(`     (stalled at ${state.x.toFixed(1)},${state.z.toFixed(1)} heading for ${wx},${wz} [${label}])`); return false; }
  }
  return true;
}

async function gearUp(ws, state) {
  ws.send(JSON.stringify({ t: "chat", text: "/level 30" }));
  ws.send(JSON.stringify({ t: "chat", text: "/give rift_greataxe 1 epic" }));
  ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 16" }));
  // full iron: Grole's vault piles powder AoE + fuse pillars + guards + curs
  // on top of his swings — an unarmored lone bot loses the attrition race
  for (const [item, slot] of [["iron_helm", "head"], ["iron_cuirass", "chest"], ["iron_boots", "feet"], ["iron_shield", "offhand"]]) {
    ws.send(JSON.stringify({ t: "chat", text: `/give ${item} 1 epic` }));
    await sleep(250);
    const idx = (state.inv?.slots ?? []).findIndex((s) => s && s.item === item);
    if (idx >= 0) ws.send(JSON.stringify({ t: "equipSlot", slot, invIndex: idx }));
    await sleep(200);
  }
  await sleep(600);
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

/** Kill every hostile inside `radius` until the coast stays clear ~2s —
 *  Grole's vault-guard pack must not join the audit. */
async function clearAdds(ws, state, radius = 9, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let quietSince = Date.now();
  let lastPot = 0;
  while (Date.now() < deadline && !state.died) {
    // targets: anything close — plus WHOEVER IS SHOOTING US, at any range
    // (a fled brigand lobs powder from 18m, outside every polite radius)
    const recentAttacker = Date.now() - state.lastAttackAt < 4000 ? state.lastAttackerId : -1;
    const mob = [...state.ents.values()]
      .filter((e) => e.kind === "mob" && e.act !== "dead" && e.name !== "Quartermaster Grole")
      .map((e) => ({ e, d: Math.hypot(e.x - state.x, e.z - state.z) }))
      .filter((m) => m.d < radius || (m.e.id === recentAttacker && m.d < 30))
      .sort((a, b) => a.d - b.d)[0];
    if (!mob) {
      if (Date.now() - quietSince > 2000) return true;
      await sleep(250);
      continue;
    }
    quietSince = Date.now();
    if (state.stats && state.stats.hp < 450 && Date.now() - lastPot > 1300) {
      lastPot = Date.now();
      drinkPotion(ws, state);
      await sleep(800);
      continue;
    }
    if (mob.d > 2.4) {
      await moveToward(ws, state, mob.e.x, mob.e.z, 2.0, 3000);
    } else {
      const aim = Math.atan2(mob.e.x - state.x, mob.e.z - state.z);
      state.seq++;
      ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: aim, anim: "idle" }));
      ws.send(JSON.stringify({ t: "attack", yaw: aim, pitch: 0 }));
      await sleep(800);
    }
  }
  return !state.died;
}

/** Face-tank a boss (floor-aware chase), potioning under 450 hp. Retargets
 *  by NAME each loop (probe staging can race a spawner into two instances),
 *  and treats the room's own bossDeath ANNOUNCE as the kill oracle — it is
 *  emitted by the event system for any instance of the mob id.
 *  `home`: a known-open cell to fall back to when the straight-line chase
 *  jams on a corner — the boss's own server-side pathfinding closes the
 *  distance instead. Returns the boss's last position on a kill, else null. */
async function fight(ws, state, bossName, killText, timeoutMs = 180_000, home = null) {
  const deadline = Date.now() + timeoutMs;
  const killed = () => chatWith(state, killText);
  let last = null;
  let lastPot = 0;
  while (Date.now() < deadline && !state.died) {
    if (killed()) return last ?? { x: state.x, z: state.z };
    if (state.stats && state.stats.hp < 450 && Date.now() - lastPot > 1300) {
      // the potion is a body-FSM action: a bot that never stops attacking
      // never actually drinks. Skip this swing and let the consume run.
      lastPot = Date.now();
      drinkPotion(ws, state);
      await sleep(800);
      continue;
    }
    const boss = findMob(state, bossName);
    if (!boss) {
      if (last) await moveToward(ws, state, last.x, last.z, 2.0, 4000);
      await sleep(300);
      continue;
    }
    last = { x: boss.x, z: boss.z };
    const dx = boss.x - state.x;
    const dz = boss.z - state.z;
    if (Math.hypot(dx, dz) > 2.6) {
      const closed = await moveToward(ws, state, boss.x, boss.z, 2.2, 4000);
      if (!closed && home) {
        // chase jammed on furniture/a corner: hold the door, he comes to us
        await moveToward(ws, state, home[0], home[1], 0.8, 6000);
        await sleep(1200);
      }
    } else {
      const aim = Math.atan2(dx, dz);
      state.seq++;
      ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: aim, anim: "idle" }));
      ws.send(JSON.stringify({ t: "attack", yaw: aim, pitch: 0 }));
      await sleep(900);
    }
  }
  return killed() ? (last ?? { x: state.x, z: state.z }) : null;
}

// ---- login as the admin probe bot ----
await api("/api/register", { username: "greenhood_probe", password: "green123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "greenhood_probe", password: "green123" });
if (!account.roles.includes("admin")) {
  console.error("[greenhood] greenhood_probe is not admin — run: node scripts/make-admin.mjs greenhood_probe  (then rerun)");
  process.exit(2);
}
await restartForest("pre-probe hygiene");
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Greenprobe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);

// ---- 1. the gate is sealed while Thrace lives ----
({ ws, state } = await gotoRoom(ws, state, "forest"));
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
let gate = state.portals.find((p) => p.id === "forest-greenhood");
if (gate?.open) {
  // a prior run killed Thrace ≤900s ago: the room correctly boots with the
  // door ajar (his respawn timer IS the window). Stage him back — /spawnmob
  // routes through the same spawnMob → onBossSpawned reseal as the timer.
  log("(gate found ajar — prior run's Thrace still on his respawn timer; staging him back)");
  await tp(ws, state, 315, 150);
  const before = state.portalStates.length;
  ws.send(JSON.stringify({ t: "chat", text: "/spawnmob thrace_redcap" }));
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    if (state.portalStates.slice(before).some((p) => p.target === "greenhood_run" && p.open === false)) break;
  }
  gate = { ...gate, open: !state.portalStates.some((p) => p.target === "greenhood_run" && p.open === false) };
}
expect(!!gate && gate.open === false, `forest-greenhood sealed while Thrace lives (open=${gate?.open})`);
await tp(ws, state, 313, 146); // inside the yard, at the arch
ws.send(JSON.stringify({ t: "usePortal", portalId: "forest-greenhood" }));
for (let i = 0; i < 30 && !chatWith(state, "guardian lives"); i++) await sleep(100);
expect(chatWith(state, "guardian lives"), 'sealed gate denied ("sealed while its guardian lives")');

// ---- 2. kill Thrace: the camp opens the Run ----
await gearUp(ws, state);
await tp(ws, state, 315, 158); // just inside the south gate
await sleep(700);
const thrace = findMob(state, "Thrace the Redcap");
expect(!!thrace, `Thrace found at ${thrace ? `${thrace.x.toFixed(0)},${thrace.z.toFixed(0)}` : "?"}`);
if (!thrace) { log("RESULT: FAIL"); process.exit(1); }
const thraceDead = await fight(ws, state, "Thrace the Redcap", "the Run is lit");
expect(!!thraceDead, `Thrace killed (bot hp ${state.stats?.hp}, died=${state.died})`);
if (chatWith(state, "red horn")) log("     (50% rally announce seen)");
for (let i = 0; i < 30 && !chatWith(state, "the Run is lit"); i++) await sleep(100);
expect(chatWith(state, "the Run is lit"), 'gate announce fired ("the Run is lit")');
let opened = state.portalStates.some((p) => p.target === "greenhood_run" && p.open === true);
expect(opened, "portalState {greenhood_run, open:true} replicated");

// ---- 3. through the camp into the yard, and down ----
// the authored route: from the gate, around the fire ring, through the inner
// gap (316-317,148 — offset east), double back west to the arch. goTo works
// here (open sky); target the cell beside the arch line (lintel = wall to bots).
const walked = await goTo(ws, state, 313.5, 145.0, 0.9);
log(`     (walked=${walked}; at ${state.x.toFixed(1)},${state.z.toFixed(1)}, ${Math.hypot(state.x - 313, state.z - 143).toFixed(1)}m from the gate)`);
state.transfer = null;
ws.send(JSON.stringify({ t: "usePortal", portalId: "forest-greenhood" }));
const tRun = await waitTransfer(state);
expect(!!tRun, "opened gate grants a transfer into the Run");
if (!tRun) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tRun.wsUrl, tRun.ticket));
expect(state.roomId === "greenhood_run", `arrived in ${state.roomId}`);
expect(Math.hypot(state.x - 18, state.z - 74.8) < 2, `landed in the entrance shaft (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
expect(state.y < 14, `underground — the shaft floor, not the cap (y=${state.y.toFixed(1)})`);
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
expect(state.portals.some((p) => p.id === "greenhood-fort" && p.open), "the fort door back is open");

// ---- 4. walk the warren to the vault; the audit ----
// waypoints are CELL CENTERS (+0.5): the galleries carry shoring frames whose
// posts leave exactly the middle cell free — an edge-riding line clips a post.
// The walk is SEGMENTED: the vault-guard camp sits on the c6/c7 junction, and
// an enforcer's iron_bash slow turns mid-pack walking into a correction storm
// — clear the camp from the junction mouth, then take the door.
// three segments, clearing each pack as it engages — the packs' leashes
// (26-34) overlap the route, so an uncleared kennel/bunkroom train follows
// the bot all the way into the vault and joins Grole's audit
const legs = [
  { pts: [[26.5, 78.5], [30.5, 78.5], [34.5, 78.5], [34.5, 74.5], [34.5, 68.5]], clear: 9 }, // the kennels
  { pts: [[34.5, 62.5], [34.5, 56.5], [34.5, 54.5], [38.5, 54.5], [44.5, 54.5], [50.5, 54.5]], clear: 10 }, // the bunkroom
  { pts: [[56.5, 54.5], [58.5, 54.5], [58.5, 48.5], [58.5, 42.5], [58.5, 38.5], [62.5, 38.5]], clear: 12 }, // the junction + vault guards
];
let reachedJunction = true;
for (const leg of legs) {
  reachedJunction = reachedJunction && (await walkWaypoints(ws, state, leg.pts, "to the vault"));
  await clearAdds(ws, state, leg.clear);
}
const toVaultDoor = [[66.5, 38.5], [66.5, 34.5], [66.5, 31.5], [68.5, 28.5]];
const reachedVault = reachedJunction && (await walkWaypoints(ws, state, toVaultDoor, "to the vault door"));
expect(reachedVault, `walked the galleries to the tally-vault (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
await sleep(600);
await clearAdds(ws, state, 8); // stragglers wandering the vault mouth
let grole = findMob(state, "Quartermaster Grole");
if (!grole) {
  // a prior run's kill left him on the vault spawner's 900s timer (stateful
  // room). Stage him back — /spawnmob resolves the same def the spawner does.
  log("(Grole on his respawn timer from a prior run — staging him back)");
  ws.send(JSON.stringify({ t: "chat", text: "/spawnmob quartermaster_grole" }));
  for (let i = 0; i < 40 && !grole; i++) {
    await sleep(150);
    grole = findMob(state, "Quartermaster Grole");
  }
}
expect(!!grole, `Grole found at ${grole ? `${grole.x.toFixed(0)},${grole.z.toFixed(0)}` : "?"}`);
if (!grole) { log("RESULT: FAIL"); process.exit(1); }
const groleDead = await fight(ws, state, "Quartermaster Grole", "a payment won't arrive", 180_000, [68.5, 28.5]);
expect(!!groleDead, `Grole killed (bot hp ${state.stats?.hp}, died=${state.died})`);
if (state.died) log(`     (last hits: ${state.hits.join(" | ")})`);
if (chatWith(state, "Nobody leaves owing")) log("     (50% audit announce seen)");
for (let i = 0; i < 30 && !chatWith(state, "a payment won't arrive"); i++) await sleep(100);
expect(chatWith(state, "a payment won't arrive"), "death announce fired (the fen hint)");

// ---- the bounty proof: loot the bag. Picked by its REPLICATED CONTENTS
// (bags carry `loot` on the wire) — a stateful room accretes stale bags
// (prior probe deaths, the cellar cache 20m off) that fool a nearest-first
// search. Falls back to nearest-to-the-kill when contents aren't visible.
await sleep(1000);
const at = groleDead ?? { x: state.x, z: state.z };
// the Run's three stocked caches are loot bags too — never Grole's drop
const CACHE_SPOTS = [[47.5, 38.5], [65.5, 48.5], [76.5, 21.5]];
const bags = [...state.ents.values()]
  .filter((e) => e.kind === "loot" && Math.hypot(e.x - at.x, e.z - at.z) < 10)
  .filter((e) => !CACHE_SPOTS.some(([cx, cz]) => Math.hypot(e.x - cx, e.z - cz) < 1.2))
  .sort((a, b) => Math.hypot(a.x - at.x, a.z - at.z) - Math.hypot(b.x - at.x, b.z - at.z));
// the view is the 3 rarest — a common trophy may be cut, so contents-match
// first, then nearest-to-the-kill
const bag = bags.find((e) => (e.loot ?? []).some((l) => l.item === "greenhood_ledger_page")) ?? bags[0];
expect(!!bag, `loot bag dropped ${bag ? `at ${bag.x.toFixed(1)},${bag.z.toFixed(1)}` : ""}`);
if (bag) {
  await moveToward(ws, state, bag.x, bag.z, 1.4, 10000);
  ws.send(JSON.stringify({ t: "pickup", id: bag.id }));
  await sleep(800);
  const page = (state.inv?.slots ?? []).find((s) => s && s.item === "greenhood_ledger_page");
  expect(!!page, "guaranteed greenhood_ledger_page trophy looted");
}

// ---- 5. past the den to the East Door: the one-way climb-out ----
const toDoor = [[72.5, 27.5], [76.5, 27.5], [80.5, 27.5], [80.5, 22.5], [80.5, 16.5], [80.5, 14.5]];
const reachedDoor = await walkWaypoints(ws, state, toDoor, "to the East Door");
log(`     (reachedDoor=${reachedDoor}; at ${state.x.toFixed(1)},${state.z.toFixed(1)})`);
state.transfer = null;
let tOut = null;
for (let attempt = 0; attempt < 3 && !tOut; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "greenhood-out" }));
  tOut = await waitTransfer(state, 5000);
}
expect(!!tOut, "the East Door grants a transfer");
if (!tOut) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tOut.wsUrl, tOut.ticket));
expect(state.roomId === "stranglers_march", `climbed out into ${state.roomId} (batch 4: the March, not the forest)`);
expect(Math.hypot(state.x - 28.5, state.z - 148.5) < 1.5, `landed at the authored mound (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
expect(Math.abs(state.y - 17) < 1.5, `standing ON the mound crown (y=${state.y.toFixed(1)})`);
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
expect(!state.portals.some((p) => Math.hypot(p.x - 28.5, p.z - 148.5) < 30), "no return portal at the mound (one-way by omission)");

// ---- 6. the gate reseals when Thrace returns ----
// The climb-out dropped us in the MARCH; the reseal is a FOREST event —
// /room back first (portals arrive on join and reflect the current seal).
// SHORTCUT: /spawnmob routes through the same spawnMob → onBossSpawned path
// as the redcap-hall spawner's natural 900 s respawn, so the reseal is the
// same code either way. (The stray Thrace is cleaned by the post-probe restart.)
// (if the natural redcap-hall timer fired while we were underground, the
// join-time portals already read sealed — same mechanism, still a pass)
({ ws, state } = await gotoRoom(ws, state, "forest"));
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
let resealed = state.portals.some((p) => p.id === "forest-greenhood" && p.open === false);
if (resealed) {
  log("(gate already resealed by the natural respawn timer while we were underground)");
} else {
  const statesBefore = state.portalStates.length;
  ws.send(JSON.stringify({ t: "chat", text: "/spawnmob thrace_redcap" }));
  for (let i = 0; i < 50 && !resealed; i++) {
    await sleep(100);
    resealed = state.portalStates.slice(statesBefore).some((p) => p.target === "greenhood_run" && p.open === false);
  }
}
expect(resealed, "gate resealed the moment Thrace respawned (portalState open=false)");

ws.close();
await restartForest("post-probe cleanup (stray /spawnmob Thrace)");
log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
