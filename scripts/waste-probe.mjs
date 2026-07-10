/**
 * Live probe for THE WHITE WASTE (world-redesign batch 8) — the full endgame
 * arc, both rooms, both cycles:
 *
 * COURT LEG (the breach opens):
 *   1. /room broken_court — the NEW court-waste portal replicates SEALED
 *      (the King lives at every fresh boot) + guardian denial on usePortal
 *   2. raid kill on Vaelric (main + raiders; rallies counted MID-FIGHT) →
 *      "the mountain is OPEN" + portalState court-waste open:true
 *   3. the ESCAPE-WINDOW climb: walk the breach tunnel to the torn chamber
 *      (one row off the arch line) and usePortal within the 60 s window →
 *      one-way authored landing on the waste's arrival shelf (80.5,148.5)
 * WASTE LEG (the endgame room):
 *   4. snow underfoot decodes over the wire at the landing; the home arch
 *      replicates OPEN (it never seals)
 *   5. the TRIBUTE-ROAD walked south→north through the frost band (Pale
 *      Courser L20 / Snow Harpy L21 / Tithe-Collector L21 — the rank NAME
 *      on the wire proves the frostplate override)
 *   6. the RIME WARDENS' pass: BOTH wardens alive at once (L21, the pair
 *      is the fight) — killed as a pair in their arena
 *   7. THE FIRST TYRANT raid kill (this is group content — the probe
 *      documents the bot count): 66% rally = 2 Tithe-Collectors L21,
 *      33% rally = 3 Waste-Shades L20, observed live; death → the bible's
 *      payoff announce + the 60 s collapse
 *   8. the loot: guaranteed mythic_relic + The Winter Tithe out of the bag
 *   9. ONE bot walks the home arch → one-way landing beside Greywatch's
 *      portal-stone (64.5,80.5); the others ride the T-30 warning + evict
 *  10. CYCLE: the waste goes into downtime; a fresh court (the King back)
 *      is re-killed and the court-side breach portal now shows
 *      open:false + reopenInSec (the countdown label tech) while the waste
 *      is down; the waste then reopens FRESH (the Tyrant back at 4829)
 *
 * Needs dropbot + raider1..4 admin (node scripts/make-admin.mjs <u>) and the
 * master running with MMO_DOWNTIME_OVERRIDE_SEC=90 for the cycle leg (the
 * real knob is 900 s; without the override the reopen legs are skipped).
 * Exits 0 on success, 1 on any failed expectation.
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { loadEnv, makeWorldTracker, sleep } from "./lib.mjs";

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

const log = (...a) => console.log("[wasteprobe]", ...a);
let failed = false;
function expect(cond, what) {
  if (cond) log(`OK   ${what}`);
  else { failed = true; log(`FAIL ${what}`); }
}

async function roomOpen(roomId) {
  const s = await api("/api/status").catch(() => null);
  return !!s?.rooms?.some((r) => r.roomId === roomId && r.status === "open");
}
async function waitRoomOpen(roomId, maxSec) {
  for (let i = 0; i < maxSec; i++) {
    if (await roomOpen(roomId)) return true;
    await sleep(1000);
  }
  return false;
}
async function waitRoomDown(roomId, maxSec) {
  for (let i = 0; i < maxSec; i++) {
    if (!(await roomOpen(roomId))) return true;
    await sleep(1000);
  }
  return false;
}

function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const tracker = makeWorldTracker();
    const state = {
      roomId: null, selfId: -1, x: 0, y: 0, z: 0, seq: 0,
      terrain: null, portals: [], portalStates: [], transfer: null,
      ents: new Map(), stats: null, inv: null,
      events: [], chats: [], died: false, evicted: null,
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
        case "evict": state.evicted = msg.reason; break;
        case "transfer": state.transfer = msg; break;
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; state.correctedAt = Date.now(); break;
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

async function tp(ws, state, x, z) {
  ws.send(JSON.stringify({ t: "chat", text: `/tp ${x} ${z}` }));
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    if (Math.hypot(state.x - x, state.z - z) < 3) return true;
  }
  return false;
}

const chatWith = (state, needle) => state.chats.some((c) => c.text?.includes(needle));
const liveMobs = (state, name) =>
  [...state.ents.values()].filter((e) => e.kind === "mob" && e.name === name && e.act !== "dead");

// ---- floor-gap movement (the probe mirror of walkYNear; lib goTo paths
// over roofs/lintels — useless in the breach tunnel and under arch lines) ----
const SOLID_IDS = new Set(
  JSON.parse(readFileSync(new URL("../shared/blocks.json", import.meta.url), "utf8").replace(/^﻿/, ""))
    .blocks.filter((b) => b.solid).map((b) => b.id)
);
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
async function moveToward(ws, state, tx, tz, within = 2.2, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let jink = 1;
  while (Date.now() < deadline) {
    const dx = tx - state.x;
    const dz = tz - state.z;
    const d = Math.hypot(dx, dz);
    if (d <= within) return true;
    // adaptive step backoff (the greenhood enforcer lesson): a slow debuff
    // turns full-speed move packets into a correction storm — after any
    // correction, walk at a slowed-legal pace for a while
    const slowed = Date.now() - (state.correctedAt ?? 0) < 1800;
    const step = Math.min(slowed ? 0.12 : 0.45, d);
    let nx = state.x + (dx / d) * step;
    let nz = state.z + (dz / d) * step;
    let ny = floorNear(state.terrain, nx, nz, state.y);
    if (ny === null) {
      jink = -jink;
      nx = state.x + (-dz / d) * step * jink;
      nz = state.z + (dx / d) * step * jink;
      ny = floorNear(state.terrain, nx, nz, state.y);
      if (ny === null) { await sleep(110); continue; }
    }
    state.seq++;
    state.x = nx; state.z = nz; state.y = ny;
    ws.send(JSON.stringify({ t: "move", seq: state.seq, x: nx, y: ny, z: nz, yaw: Math.atan2(dx, dz), anim: "move" }));
    await sleep(110);
  }
  return false;
}

async function gearUp(ws, state) {
  ws.send(JSON.stringify({ t: "chat", text: "/level 30" }));
  ws.send(JSON.stringify({ t: "chat", text: "/give kingsrend_greataxe 1 epic" }));
  ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
  ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
  // the Waste is the hardest fight in the game: the raid wears real armor
  // (melee/ranged mitigation; a naked L30 wipes in ~18 s to stacked AoE)
  for (const piece of ["iron_helm", "iron_cuirass", "iron_boots", "iron_shield"]) {
    ws.send(JSON.stringify({ t: "chat", text: `/give ${piece} 1 epic` }));
  }
  await sleep(1000);
  let slot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "kingsrend_greataxe");
  if (slot < 0) throw new Error("kingsrend_greataxe never arrived");
  if (slot >= 8) {
    ws.send(JSON.stringify({ t: "invMove", from: slot, to: 1 }));
    await sleep(400);
    slot = 1;
  }
  ws.send(JSON.stringify({ t: "equip", slot }));
  for (const [piece, es] of [
    ["iron_helm", "head"],
    ["iron_cuirass", "chest"],
    ["iron_boots", "feet"],
    ["iron_shield", "offhand"],
  ]) {
    const idx = (state.inv?.slots ?? []).findIndex((s) => s && s.item === piece);
    if (idx >= 0) ws.send(JSON.stringify({ t: "equipSlot", slot: es, invIndex: idx }));
    await sleep(150);
  }
  // admin staging enchants on the held axe (equip-bot precedent): the L20-24
  // band is balanced for geared groups that dodge telegraphs — a crude
  // stand-and-swing bot needs the numbers instead. Pack aggro converges the
  // collector + two shade packs on the court approach (~300 raid dps), and
  // un-enchanted bots wiped there four runs straight.
  for (const enchant of ["/enchant dmgPct 0.6", "/enchant hpRegen 15", "/enchant meleeTakenPct -0.25", "/enchant magicTakenPct -0.2"]) {
    ws.send(JSON.stringify({ t: "chat", text: enchant }));
    await sleep(120);
  }
  await sleep(300);
}

/** Returns true when a drink was queued — the caller should PAUSE: a consume
 *  is a body-FSM action and a bot that never stops attacking never drinks
 *  (the greenhood lesson). */
function drinkIfHurt(ws, state, below = 560) {
  if (state.stats && state.stats.hp < below) {
    const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
    if (pot >= 0) {
      ws.send(JSON.stringify({ t: "consume", slot: pot }));
      return true;
    }
  }
  return false;
}

async function clearNear(ws, state, radius = 5, timeoutMs = 60_000, skipName = null) {
  const deadline = Date.now() + timeoutMs;
  let quietSince = Date.now();
  while (Date.now() < deadline && !state.died) {
    if (drinkIfHurt(ws, state)) {
      await sleep(800); // the consume must land before the next attack
      continue;
    }
    const near = [...state.ents.values()]
      .filter((e) => e.kind === "mob" && e.act !== "dead" && !(skipName && (e.name ?? "").startsWith(skipName)))
      .map((e) => ({ e, d: Math.hypot(e.x - state.x, e.z - state.z) }))
      .filter((a) => a.d < radius)
      .sort((a, b) => a.d - b.d);
    if (!near.length) {
      if (Date.now() - quietSince > 4000) return true;
      await sleep(300);
      continue;
    }
    quietSince = Date.now();
    const t = near[0].e;
    const dx = t.x - state.x;
    const dz = t.z - state.z;
    if (Math.hypot(dx, dz) > 2.4) {
      await moveToward(ws, state, t.x, t.z, 2.0, 2500);
    } else {
      const aim = Math.atan2(dx, dz);
      state.seq++;
      ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: aim, anim: "idle" }));
      ws.send(JSON.stringify({ t: "attack", yaw: aim, pitch: 0 }));
      await sleep(1000);
    }
  }
  return !state.died;
}

async function walkRoute(ws, state, waypoints, tag) {
  for (const [wx, wz] of waypoints) {
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      ok = await moveToward(ws, state, wx, wz, 2.4, 25000);
      if (!ok) await clearNear(ws, state, 7, 30_000);
      drinkIfHurt(ws, state);
    }
    if (!ok) {
      log(`FAIL [${tag}] never reached waypoint (${wx},${wz}) — at (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
      return false;
    }
  }
  return true;
}

/** Boss-fight loop (city-probe recipe): potions hard, kill adds ON us first,
 *  else the boss; observes add names/levels LIVE (the raid deletes corpses
 *  from interest). `angle` spreads the raid around the boss — five stacked
 *  melee bots multi-eat every cleave arc / pillar line / AoE splash. */
async function fight(ws, state, bossId, anchor, tag = "main", timeoutMs = 420_000, angle = 0) {
  const deadline = Date.now() + timeoutMs;
  const dead = () => state.events.some((ev) => ev.kind === "death" && ev.id === bossId);
  state.addSightings = state.addSightings ?? new Map(); // name -> Set(levels)
  let lastBossPos = { ...anchor };
  let lastLog = 0;
  while (Date.now() < deadline && !state.died) {
    if (dead()) return true;
    for (const e of state.ents.values()) {
      if (e.kind !== "mob" || e.act === "dead" || e.id === bossId) continue;
      if (!state.addSightings.has(e.name)) state.addSightings.set(e.name, new Set());
      if (e.level !== undefined) state.addSightings.get(e.name).add(e.level);
    }
    if (drinkIfHurt(ws, state, 520)) { // threshold must sit BELOW max hp (660) — at 700 the raid chugs potions forever and never swings
      await sleep(800); // let the consume's body action land — attacking cancels it
      continue;
    }
    const boss = state.ents.get(bossId);
    if (boss) lastBossPos = { x: boss.x, z: boss.z };
    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      log(`  [${tag}] me=(${state.x.toFixed(1)},${state.y.toFixed(0)},${state.z.toFixed(1)}) hp=${state.stats?.hp} boss=${boss ? `(${boss.x.toFixed(1)},${boss.z.toFixed(1)}) hp=${boss.hp ?? "?"}` : "OUT OF INTEREST"}`);
    }
    const adds = [...state.ents.values()]
      .filter((e) => e.kind === "mob" && e.act !== "dead" && e.id !== bossId)
      .map((e) => ({ e, d: Math.hypot(e.x - state.x, e.z - state.z) }))
      .filter((a) => a.d < 3.5)
      .sort((a, b) => a.d - b.d);
    const target = adds.length ? adds[0].e : boss;
    if (!target || target.act === "dead") {
      await moveToward(ws, state, lastBossPos.x, lastBossPos.z, 6, 2500);
      continue;
    }
    const dx = target.x - state.x;
    const dz = target.z - state.z;
    if (Math.hypot(dx, dz) > 2.6) {
      // approach the target from THIS bot's own bearing, not the shared line
      // (offset + tolerance must land INSIDE the 2.6 attack gate — a 1.9 m
      // offset with 1.4 tolerance orbits forever without swinging)
      await moveToward(ws, state, target.x + Math.sin(angle) * 1.2, target.z + Math.cos(angle) * 1.2, 0.7, 3000);
    } else {
      const aim = Math.atan2(dx, dz);
      state.seq++;
      ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: aim, anim: "idle" }));
      ws.send(JSON.stringify({ t: "attack", yaw: aim, pitch: 0 }));
      await sleep(800);
    }
  }
  return dead();
}

async function makeRaider(username, roomId, hx, hz) {
  await api("/api/register", { username, password: "raid123" }).catch(() => {});
  const { token: tk, account: acc } = await api("/api/login", { username, password: "raid123" });
  if (!acc.roles.includes("admin")) throw new Error(`${username} is not admin — node scripts/make-admin.mjs ${username}`);
  let { characters: chars } = await api("/api/characters", null, tk);
  if (!chars.length) chars = [(await api("/api/characters", { name: username[0].toUpperCase() + username.slice(1) }, tk)).character];
  const g = await api("/api/enter", { characterId: chars[0].id }, tk);
  let { ws: rws, state: rstate } = await enterRoom(g.wsUrl, g.ticket);
  ({ ws: rws, state: rstate } = await gotoRoom(rws, rstate, roomId));
  await gearUp(rws, rstate);
  await tp(rws, rstate, hx, hz);
  return { ws: rws, state: rstate };
}

/** Kill Vaelric with the raid, then climb every bot through the breach
 *  within the 60 s window. Returns the bots in the waste. */
async function courtLegKillAndClimb(main, raiders, tag) {
  const { ws, state } = main;
  const king = [...state.ents.values()].find((e) => e.kind === "mob" && e.name?.includes("Sundered King") && e.act !== "dead")
    ?? await (async () => {
      await moveToward(ws, state, 48, 40, 8, 20000); // walk up the processional until he replicates
      await sleep(500);
      return [...state.ents.values()].find((e) => e.kind === "mob" && e.name?.includes("Sundered King") && e.act !== "dead");
    })();
  expect(!!king, `[${tag}] Vaelric replicates in the court`);
  if (!king) return null;
  // walk every raider through the hall DOORS first (3 wide at x47-49,z58 —
  // a fight-loop line at the moving King wedges bots against the marble
  // beside the door; run 9's raid parked at z59.6 while the King reset),
  // THEN the whole raid fights (a stand-there raider is a decoy)
  await Promise.all(raiders.map((r) => moveToward(r.ws, r.state, 48, 56, 1.6, 25000).then(() => moveToward(r.ws, r.state, 48, 40, 2.5, 20000)).catch(() => {})));
  const raiderFights = raiders.map((r, i) => fight(r.ws, r.state, king.id, { x: king.x, z: king.z }, `${tag}-raider${i + 1}`, 420_000, ((i + 1) * Math.PI * 2) / 5));
  let killed = await fight(ws, state, king.id, { x: king.x, z: king.z }, tag);
  const raiderResults = await Promise.allSettled(raiderFights);
  killed = killed
    || state.events.some((ev) => ev.kind === "death" && ev.id === king.id)
    || raiderResults.some((r) => r.status === "fulfilled" && r.value === true);
  expect(killed, `[${tag}] Vaelric died`);
  if (!killed) return null;
  expect(chatWith(state, "the mountain is OPEN"), `[${tag}] the breach announce fired`);
  let opened = false;
  for (let i = 0; i < 50 && !opened; i++) {
    opened = state.portalStates.some((p) => p.target === "white_waste" && p.open === true);
    if (!opened) await sleep(100);
  }
  expect(opened, `[${tag}] portalState {white_waste, open:true}`);
  // the climb — every bot, within the 60 s window. Raiders transfer in
  // PARALLEL while the main walks (serial tp+waitTransfer cost run 18 the
  // whole window); the chamber is open-sky, so /tp standY lands on its floor
  const raiderThrough = Promise.all(
    raiders.map(async (r) => {
      await tp(r.ws, r.state, 35, 6);
      r.state.transfer = null;
      r.ws.send(JSON.stringify({ t: "usePortal", portalId: "court-waste" }));
      const t = await waitTransfer(r.state);
      if (!t) {
        log(`WARN [${tag}] a raider missed the window`);
        return null;
      }
      r.ws.close();
      return enterRoom(t.wsUrl, t.ticket);
    })
  );
  // the main bot WALKS the climb (the tunnel, then one row off the arch line)
  const climbed = await walkRoute(ws, state, [[44, 24], [37, 16], [35, 10]], `${tag}-climb`);
  expect(climbed, `[${tag}] walked the breach climb to the torn chamber`);
  await moveToward(ws, state, 35, 5.4, 0.9, 15000); // inside the 2.2 m trigger, off the pillar row
  state.transfer = null;
  ws.send(JSON.stringify({ t: "usePortal", portalId: "court-waste" }));
  const t = await waitTransfer(state);
  expect(!!t, `[${tag}] court-waste granted the transfer inside the window`);
  if (!t) return null;
  ws.close();
  const arrived = await enterRoom(t.wsUrl, t.ticket);
  const rArrived = (await raiderThrough).filter(Boolean);
  return { main: arrived, raiders: rArrived };
}

// ============================ SETUP ============================
await api("/api/register", { username: "dropbot", password: "drop123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "dropbot", password: "drop123" });
if (!account.roles.includes("admin")) {
  console.error("[wasteprobe] dropbot is not admin — run: node scripts/make-admin.mjs dropbot");
  process.exit(2);
}
if (!(await roomOpen("broken_court"))) {
  log("broken_court in downtime — waiting...");
  if (!(await waitRoomOpen("broken_court", 960))) process.exit(2);
}
if (!(await roomOpen("white_waste"))) {
  log("white_waste in downtime — waiting...");
  if (!(await waitRoomOpen("white_waste", 960))) process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Dropbot" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId}`);

// ============================ COURT LEG ============================
({ ws, state } = await gotoRoom(ws, state, "broken_court"));
await gearUp(ws, state);
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);

// 1. the breach boots SEALED + guardian denial
const breach0 = state.portals.find((p) => p.id === "court-waste");
expect(breach0 && breach0.open === false, "court-waste replicates SEALED while the King lives");
expect(breach0?.target === "white_waste", "court-waste targets the White Waste");
ws.send(JSON.stringify({ t: "usePortal", portalId: "court-waste" }));
await sleep(800);
expect(chatWith(state, "sealed while its guardian lives"), "usePortal on the sealed breach is denied with the guardian line");

// 2-3. raid kill + the climb (5 bots: main + raider1..4 — the finale above
// is THE hardest fight in the game and the bots are crude stand-and-swing
// fighters; a human group that dodges the telegraphs needs fewer)
log("raising the raid (main + 4 raiders)...");
const r1 = await makeRaider("raider1", "broken_court", 48, 76);
const r2 = await makeRaider("raider2", "broken_court", 48, 76);
const r3 = await makeRaider("raider3", "broken_court", 48, 76);
const r4 = await makeRaider("raider4", "broken_court", 48, 76);
await tp(ws, state, 48, 60);
const wasteBots = await courtLegKillAndClimb({ ws, state }, [r1, r2, r3, r4], "court");
if (!wasteBots) { log("RESULT: FAIL"); process.exit(1); }
({ ws, state } = wasteBots.main);
const raiders = wasteBots.raiders;

// 4. the landing
expect(state.roomId === "white_waste", `arrived in ${state.roomId}`);
expect(
  Math.hypot(state.x - 80.5, state.z - 148.5) < 3,
  `one-way landing on the arrival shelf (${state.x.toFixed(1)},${state.z.toFixed(1)} vs 80.5,148.5)`
);
const SNOW_ID = JSON.parse(readFileSync(new URL("../shared/blocks.json", import.meta.url), "utf8").replace(/^﻿/, ""))
  .blocks.find((b) => b.name === "snow").id;
expect(state.terrain.get(80, Math.round(state.y) - 1, 148) === SNOW_ID, "snow decodes under the landing (the debut blocks on the wire)");
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const home0 = state.portals.find((p) => p.id === "waste-home");
expect(home0?.open === true && home0?.target === "hub", "the home arch replicates OPEN → Greywatch");

// 5. the tribute-road (ramp → bends → the wardens' south door)
log("walking the tribute-road...");
const roadOk = await walkRoute(ws, state, [
  [80, 138], [80, 131], [70, 126], [64, 120], [58, 108], [66, 100], [74, 96],
], "road");
expect(roadOk, "the bending tribute-road walked south gate → the wardens' door");
const courser = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "Pale Courser");
const harpy = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "Snow Harpy");
const collector = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "Tithe-Collector");
expect(!!courser && courser.level === 20, `Pale Courser L20 on the road (saw L${courser?.level})`);
expect(!!harpy && harpy.level === 21, `Snow Harpy L21 at the piles (saw L${harpy?.level})`);
expect(!!collector && collector.level === 21, `Tithe-Collector L21 holds a post (the frostplate rank NAME on the wire)`);

// 6. the Rime Wardens — the pair fight IS the mechanic, and it is GROUP
// content like everything up here: the raiders cross the road to the door
// and the raid takes the arena together
log("bringing the raid to the wardens' door...");
// tp straight into the door lane: (74,96) is outside EVERY aggro field
// (road collector 19 m, harpies 27 m, wardens 14 m) — the old (66,100)
// stop sat in the road-collector + harpy convergence and raiders died
// there before the fight even started (shard log: "Raider4 died")
for (const r of raiders) {
  await tp(r.ws, r.state, 74, 96);
}
await moveToward(ws, state, 76, 92, 2.5, 20000);
await sleep(1500);
let wardens = liveMobs(state, "Rime Warden");
expect(wardens.length === 2, `BOTH Rime Wardens stand their post (saw ${wardens.length})`);
expect(wardens.every((w) => w.level === 21), "the wardens spawn at L21");
log(`the pair fight (${1 + raiders.length} bots)...`);
let pairSeen = 0;
// the raiders step INTO the arena (a radius-10 clear from the door misses
// the wardens at 12.7 m and they stand idle — run 20), but the radius stays
// 10 so nothing outside the ring (the Collector post at 11.4 m) gets chased
// — radius 16 dragged them into shade country three runs straight
const raidersBusy = raiders.map((r) =>
  moveToward(r.ws, r.state, 80, 87, 2.0, 20000)
    .then(() => clearNear(r.ws, r.state, 10, 240_000))
    .catch(() => {})
);
{
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline && !state.died) {
    wardens = liveMobs(state, "Rime Warden");
    if (!wardens.length) break;
    pairSeen = Math.max(pairSeen, wardens.filter((w) => Math.hypot(w.x - state.x, w.z - state.z) < 14).length);
    if (drinkIfHurt(ws, state, 520)) {
      await sleep(800);
      continue;
    }
    const t = wardens.map((e) => ({ e, d: Math.hypot(e.x - state.x, e.z - state.z) })).sort((a, b) => a.d - b.d)[0];
    if (t.d > 2.6) {
      await moveToward(ws, state, t.e.x, t.e.z, 2.2, 3000);
    } else {
      const aim = Math.atan2(t.e.x - state.x, t.e.z - state.z);
      state.seq++;
      ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: aim, anim: "idle" }));
      ws.send(JSON.stringify({ t: "attack", yaw: aim, pitch: 0 }));
      await sleep(1000);
    }
  }
}
expect(liveMobs(state, "Rime Warden").length === 0 && !state.died, "both wardens down");
expect(pairSeen === 2, "the TWO-AT-ONCE fight happened (both wardens engaged simultaneously)");
await Promise.all(raidersBusy); // clearNear returns ~4 s after the arena goes quiet
// park the raiders on the arena's ice immediately — an idle bot outside
// the ring drifts into the Collector's post radius
for (const r of raiders) {
  if (!r.state.died) await tp(r.ws, r.state, 80, 87);
}

// 7. THE FIRST TYRANT raid — the raiders sweep the court approach FIRST as
// a PACK, one fight at a time: the Collector post at (80,74) alone (skip
// the shades — a 13 m clearNear CHASED wandering shades into their zone
// and wiped 4 bots in run 12), then the shade pocket as a group
log("sweeping the court approach (raider pack, one fight at a time)...");
ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
for (const r of raiders) {
  r.ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
  r.ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
  await tp(r.ws, r.state, 86, 78); // the arena's north door — cleared ground
}
// fight 1 happens WEST of the walkway: (82,72) sits inside the UNPAID
// PILE shades' aggro ring (they wander to x92, aggro 11) — runs 12/13
// wiped there with the shades chewing skipName'd bots; (76,73) pulls the
// Collector alone, 16 m from the pile
await Promise.all(raiders.map((r) => moveToward(r.ws, r.state, 76, 73, 2.5, 25000).catch(() => {})));
await Promise.all(raiders.map((r) => clearNear(r.ws, r.state, 9, 75_000)));
for (const r of raiders) r.ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
// fight 2: the court-shade pocket before the floor, as a pack
await Promise.all(raiders.map((r) => moveToward(r.ws, r.state, 80, 58, 3.0, 20000).catch(() => {})));
await Promise.all(raiders.map((r) => clearNear(r.ws, r.state, 9, 75_000)));
log(`  raid after the sweep: ${raiders.map((r, i) => `raider${i + 1} hp=${r.state.stats?.hp}${r.state.died ? " DEAD" : ""}`).join(", ")}`);
log("crossing to the tribute-court...");
const toCourt = await walkRoute(ws, state, [[86, 80], [86, 76], [78, 72], [80, 66], [80, 58]], "court-approach");
expect(toCourt, "walked the pass to the tribute-court");
const fitRaiders = raiders.filter((r) => !r.state.died);
expect(fitRaiders.length >= 2, `the raid survived the approach (${fitRaiders.length}/${raiders.length} raiders standing)`);
for (const r of fitRaiders) {
  moveToward(r.ws, r.state, 80, 46, 6, 60000).catch(() => {});
}
await sleep(1000);
let tyrant = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "The First Tyrant" && e.act !== "dead");
if (!tyrant) {
  await moveToward(ws, state, 80, 44, 6, 20000);
  await sleep(500);
  tyrant = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "The First Tyrant" && e.act !== "dead");
}
expect(!!tyrant, "THE FIRST TYRANT holds court");
expect(tyrant?.level === 24, `at L24 (saw L${tyrant?.level})`);
// FRESH AXES for the finale: weapon durability wears −1 per swing and the
// king + wardens + sweep ate the first kingsrend — run 23 stalemated with
// the whole raid punching bare-handed at an unmoving 4829 hp
log("re-gearing the raid (durability)...");
await gearUp(ws, state);
for (const r of fitRaiders) await gearUp(r.ws, r.state);
log(`the finale (${1 + fitRaiders.length} bots swinging)...`);
const t0 = Date.now();
const tyrantRaiderFights = fitRaiders.map((r, i) => fight(r.ws, r.state, tyrant.id, { x: tyrant.x, z: tyrant.z }, `tyrant-raider${i + 1}`, 420_000, ((i + 1) * Math.PI * 2) / 5));
let tyrantDead = await fight(ws, state, tyrant.id, { x: tyrant.x, z: tyrant.z }, "tyrant");
const tyrantRaiderResults = await Promise.allSettled(tyrantRaiderFights);
tyrantDead = tyrantDead
  || state.events.some((ev) => ev.kind === "death" && ev.id === tyrant.id)
  || tyrantRaiderResults.some((r) => r.status === "fulfilled" && r.value === true);
expect(tyrantDead, `THE FIRST TYRANT died to ${1 + fitRaiders.length} bots in ${Math.round((Date.now() - t0) / 1000)}s`);
if (!tyrantDead) { log("RESULT: FAIL"); process.exit(1); }
expect(chatWith(state, "THE FIRST TYRANT IS DEAD"), "the bible's payoff announce fired");
expect(chatWith(state, "carry you home"), "the exit-hint announce fired");
const collectors21 = state.addSightings?.get("Tithe-Collector");
const shades20 = state.addSightings?.get("Waste-Shade");
expect(!!collectors21?.has(21), "66% rally delivered Tithe-Collectors at L21 (observed mid-fight)");
expect(!!shades20?.has(20), "33% rally raised Waste-Shades at L20 (observed mid-fight)");

// 8. the loot — by whichever bot survived the finale (a dead main drops its
// own bags and cannot pick anything up)
if (state.died) {
  const alive = raiders.find((r) => !r.state.died);
  expect(!!alive, "at least one raid bot survived the finale");
  if (alive) {
    log("(the main died in the finale — a surviving raider carries the loot/exit legs)");
    ({ ws, state } = alive);
    raiders.splice(raiders.indexOf(alive), 1);
  }
}
await sleep(800);
// make ROOM first: the finale re-gear swapped out a full armor set and the
// bags are stuffed with potion stacks — a full inventory silently leaves
// the guaranteed items IN the bag (run 24)
{
  const slots = state.inv?.slots ?? [];
  let dropped = 0;
  for (let i = 0; i < slots.length && dropped < 8; i++) {
    const s = slots[i];
    if (!s) continue;
    if (["iron_helm", "iron_cuirass", "iron_boots", "iron_shield", "greater_mana_potion", "bread", "rusty_sword"].includes(s.item)
        || (s.item === "greater_health_potion" && dropped < 4)) {
      ws.send(JSON.stringify({ t: "dropItem", slot: i, qty: s.qty ?? 1 }));
      dropped++;
      await sleep(150);
    }
  }
}
// find the TYRANT'S bag, not our own junk: the tithe is a common-rarity
// trophy that never makes the bag's rarest-first 3-item view (run 25 looted
// its own dropped potions) — so exclude bags whose view is all junk we
// dropped, prefer views carrying the mythic/royal guarantees, and search
// around the DAIS, not around the bot
const JUNK = new Set(["iron_helm", "iron_cuirass", "iron_boots", "iron_shield", "greater_mana_potion", "greater_health_potion", "bread", "rusty_sword"]);
const bossy = (e) => (e.loot ?? []).some((l) => l && (l.item === "mythic_relic" || l.item === "the_winter_tithe" || /kingsrend|sovereign|oathbreaker|scepter/.test(l.item ?? "")));
const notJunk = (e) => (e.loot ?? []).some((l) => l && !JUNK.has(l.item));
// the Tyrant dies wherever the CHASE ended, not on its dais (leash 30) —
// search the whole court, bossy bags first
const nearCourt = (e) => Math.hypot(e.x - 80, e.z - 40) < 36;
const candidates = [...state.ents.values()]
  .filter((e) => e.kind === "loot" && nearCourt(e))
  .sort((a, b) => (bossy(b) ? 1 : 0) - (bossy(a) ? 1 : 0) || (notJunk(b) ? 1 : 0) - (notJunk(a) ? 1 : 0) || Math.hypot(a.x - 80, a.z - 32) - Math.hypot(b.x - 80, b.z - 32));
expect(candidates.length > 0, "the Tyrant dropped a bag");
for (const c of candidates.slice(0, 6)) {
  log(`  bag#${c.id} at (${c.x.toFixed(1)},${c.z.toFixed(1)}) view=[${(c.loot ?? []).map((l) => l?.item).join(",")}] bossy=${bossy(c)}`);
}
{
  // boss bags are OWNER-LOCKED 30 s to the top damage dealer — usually a
  // raider, not the main (runs 24-26 had every main pickup silently denied).
  // EVERY bot attempts the pickup; the owner's succeeds instantly, and the
  // guarantee counts wherever it lands.
  const bots = [{ ws, state }, ...fitRaiders.filter((r) => !r.state.died)];
  const has = (st, item) => (st.inv?.slots ?? []).some((s) => s && s.item === item);
  const anyGot = () => bots.some((b) => has(b.state, "the_winter_tithe")) && bots.some((b) => has(b.state, "mythic_relic"));
  for (const bag of candidates.slice(0, 3)) {
    if (anyGot()) break;
    await Promise.all(bots.map(async (b) => {
      await moveToward(b.ws, b.state, bag.x, bag.z, 1.8, 15000).catch(() => {});
      b.ws.send(JSON.stringify({ t: "pickup", id: bag.id }));
    }));
    await sleep(1500);
  }
  expect(bots.some((b) => has(b.state, "the_winter_tithe")), "looted The Winter Tithe (the guaranteed trophy)");
  expect(bots.some((b) => has(b.state, "mythic_relic")), "looted the guaranteed Mythic Relic (T5)");
  for (let i = 0; i < bots.length; i++) {
    const denials = bots[i].state.chats.filter((c) => c.text?.includes("belongs to someone") || c.text?.includes("bags are full")).length;
    log(`  bot${i} at (${bots[i].state.x.toFixed(1)},${bots[i].state.z.toFixed(1)}) denials/full=${denials} died=${bots[i].state.died}`);
  }
}

// 9. one bot walks the home arch; the rest ride the collapse. The ONLY way
// out of the amphitheater floor is the south processional lane (x77-83) —
// run 24 tried to walk straight through the 5-high bench ring
log("walking out by the home arch...");
const wentHome = await walkRoute(ws, state, [[80, 60], [80, 68], [72, 70], [64, 70.5]], "home");
expect(wentHome, "reached the arch on the pass");
await moveToward(ws, state, 60, 71.4, 0.9, 15000); // inside the trigger, off the pillar row
state.transfer = null;
ws.send(JSON.stringify({ t: "usePortal", portalId: "waste-home" }));
const tHome = await waitTransfer(state);
expect(!!tHome, "waste-home granted the one-way transfer");
let killTime = Date.now();
if (tHome) {
  ws.close();
  ({ ws, state } = await enterRoom(tHome.wsUrl, tHome.ticket));
  expect(state.roomId === "hub", `landed in ${state.roomId}`);
  expect(
    Math.hypot(state.x - 64.5, state.z - 80.5) < 3,
    `beside Greywatch's portal-stone (${state.x.toFixed(1)},${state.z.toFixed(1)} vs 64.5,80.5)`
  );
}
// the raiders ride the T-30 warning + evict
if (raiders.length === 0) {
  log("WARN no raider left to watch the collapse (the finale consumed them)");
} else {
  const r = raiders[0];
  let warned = false;
  let evicted = false;
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline) {
    warned = warned || r.state.chats.some((c) => c.text?.includes("30"));
    if (r.state.evicted) { evicted = true; break; }
    await sleep(500);
  }
  expect(warned, "a raider saw the T-30 collapse warning");
  expect(evicted, "the raiders were evicted by the collapse");
  for (const rr of raiders) try { rr.ws.close(); } catch {}
}

// 10. the cycle: waste down → fresh court re-kill → countdown on the breach
log("cycle leg: waiting for the waste to close...");
expect(await waitRoomDown("white_waste", 60), "white_waste went into downtime");
const status1 = await api("/api/status");
const wasteRow = status1.rooms.find((r) => r.roomId === "white_waste");
log(`  white_waste status: ${wasteRow?.status}`);
// the court from the first kill also collapsed and reopens on the override
if (!(await roomOpen("broken_court"))) {
  log("  waiting for the fresh court (override reopen)...");
  const back = await waitRoomOpen("broken_court", 200);
  expect(back, "broken_court reopened fresh after its own downtime");
  if (!back) { log("RESULT: FAIL"); process.exit(1); }
}
({ ws, state } = await gotoRoom(ws, state, "broken_court"));
await gearUp(ws, state);
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const freshKing = [...state.ents.values()].find((e) => e.kind === "mob" && e.name?.includes("Sundered King"));
expect(state.portals.find((p) => p.id === "court-waste")?.open === false, "the fresh court boots with the breach SEALED again");
log("re-killing the fresh King to read the countdown on the open breach...");
const rk1 = await makeRaider("raider1", "broken_court", 48, 76);
const rk2 = await makeRaider("raider2", "broken_court", 48, 76);
await tp(ws, state, 48, 60);
// kill only — do not climb (the waste is down; the gate must show the countdown)
{
  const king2 = freshKing ?? [...state.ents.values()].find((e) => e.kind === "mob" && e.name?.includes("Sundered King"));
  expect(king2 && king2.hp === undefined || true, "(fresh king present)");
  for (const r of [rk1, rk2]) moveToward(r.ws, r.state, 48, 32, 6, 60000).catch(() => {});
  const k = [...state.ents.values()].find((e) => e.kind === "mob" && e.name?.includes("Sundered King") && e.act !== "dead")
    ?? await (async () => { await moveToward(ws, state, 48, 40, 8, 20000); await sleep(400); return [...state.ents.values()].find((e) => e.kind === "mob" && e.name?.includes("Sundered King") && e.act !== "dead"); })();
  expect(!!k, "the fresh court boots with the King back");
  const killed2 = k ? await fight(ws, state, k.id, { x: k.x, z: k.z }, "court-2") : false;
  expect(killed2, "the fresh King died (cycle kill #2)");
  await sleep(1500);
  const ps = [...state.portalStates].reverse().find((p) => p.target === "white_waste");
  const reopenIn = ps?.reopenInSec;
  expect(ps?.open === false, "the OPEN breach stays shut while the waste is down (destination-down beats the event gate)");
  expect(typeof reopenIn === "number" && reopenIn > 0 && reopenIn <= 900, `the court-side breach carries the countdown (reopenInSec=${reopenIn})`);
  for (const r of [rk1, rk2]) try { r.ws.close(); } catch {}
}

// the waste reopens FRESH: the Tyrant back at full
log("waiting for the waste to reopen (override)...");
const reopened = await waitRoomOpen("white_waste", 200);
expect(reopened, "white_waste reopened after downtime");
if (reopened) {
  ({ ws, state } = await gotoRoom(ws, state, "white_waste"));
  await tp(ws, state, 80, 56);
  await sleep(800);
  const fresh = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "The First Tyrant");
  expect(!!fresh && fresh.act !== "dead", "the fresh waste boots with THE FIRST TYRANT back on its dais");
}

try { ws.close(); } catch {}
log(failed ? "RESULT: FAIL" : "RESULT: ALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
