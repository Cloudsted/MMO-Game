/**
 * Live probe for the BROKEN COURT SPLIT (world-redesign batch 6) — the
 * two-stage finale arc: Valdrenn the Fallen Capital (stateful, L14-16,
 * gatekeeper-gated) and the Broken Court (ephemeral cycling arena, the
 * King at L19).
 *
 * CITY LEG:
 *   1. /room sundering_fields, /tp to the tribute-road portal, usePortal →
 *      paired arrival at the city SOUTH GATE (authored exitPortalId pairing)
 *   2. stateful city sanity over the wire: both border portals OPEN, the
 *      NEW city-court portal SEALED (Ser Osmund lives — restaged via
 *      /spawnmob if a prior run left him on his 900 s timer); the keep
 *      gatehouse decodes (portcullis bars, crosswall marble, NO throne —
 *      it moved to the court); Maera at the gate with her bible dialog
 *   3. population sweep (/tp): marauders L14 at the camp, fallen soldiers
 *      L15 on the avenue, oathbound sentinels L16 in the courtyard, the
 *      Riderless L17 in the burned market
 *   4. fight to the gatehouse ON FOOT — the avenue's barricade S-curve,
 *      the castle stair, the keep, the murder-hole passage (no straight
 *      line; anything that closes gets killed) → Ser Osmund:
 *      - 50%: "The door stays shut" stand announce
 *      - death: "released at last" + portalState city-court open:true
 *   5. usePortal city-court → transfer to the Broken Court
 * COURT LEG:
 *   6. paired arrival on the forecourt; preset sanity: gold throne + rose
 *      window + the BREACH's snow/ice dressing decode over the wire
 *   7. the processional walk (straight-to-boss is the explicit arena
 *      exception), Vaelric at L19, raid three-strong:
 *      - 66% rally: "The court answers" + L18 sentinel wave
 *      - 33% rally: "NOT kneel" + more adds
 *      - death: "the mountain is OPEN" → crown loot → T-30 warning →
 *        evict within ~90 s
 *   8. back in the city: city-court shows CLOSED with the downtime
 *      countdown (reopenInSec — the 900 s reset knob, or
 *      MMO_DOWNTIME_OVERRIDE_SEC when the stack runs with it); if the
 *      countdown is short, wait out the reopen and assert the court comes
 *      back FRESH (the King at full health)
 *   9. reseal: /spawnmob ser_osmund → city-court seals again (the
 *      spawnMob → onBossSpawned path), then the probe restarts the city
 *      RoomHost to clear its staged gatekeeper (contamination discipline)
 * Needs the `dropbot` account to be admin (node scripts/make-admin.mjs dropbot).
 * Exits 0 on success, 1 on any failed expectation.
 *
 *   node scripts/city-probe.mjs [--wait-reopen]
 *     --wait-reopen: force the reopen wait even when the countdown is the
 *     real 900 s (slow; the wait runs by default only when ≤ 90 s)
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { goTo, loadEnv, makeWorldTracker, sleep } from "./lib.mjs";

loadEnv();
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const ADMIN_KEY = process.env.ADMIN_KEY ?? "";
const WAIT_REOPEN = process.argv.includes("--wait-reopen");

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

const log = (...a) => console.log("[cityprobe]", ...a);
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

async function restartCity(label) {
  await fetch(`${MASTER}/api/admin/restart-room?key=${ADMIN_KEY}&roomId=sundered_city`, { method: "POST" }).catch(() => {});
  const ok = await waitRoomOpen("sundered_city", 30);
  log(ok ? `(city restarted — ${label})` : `WARN city never came back after restart (${label})`);
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
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; break;
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

/** /tp inside the current room, then wait for the correction to land. */
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

/** Walkable-gap feet Y nearest refY at ONE column (probe mirror of the
 *  server's walkYNear; goTo/heightAt path over ROOFS — useless indoors). */
function columnGapNear(grid, xi, zi, refY) {
  let best = -1;
  for (let y = 1; y < 46; y++) {
    if (!SOLID_IDS.has(grid.get(xi, y - 1, zi))) continue;
    if (SOLID_IDS.has(grid.get(xi, y, zi)) || SOLID_IDS.has(grid.get(xi, y + 1, zi))) continue;
    if (best < 0 || Math.abs(y - refY) < Math.abs(best - refY)) best = y;
  }
  return best;
}

/** AABB-aware feet Y: the player radius (0.3) clips NEIGHBOUR cells, so
 *  climbing a 1-block step needs feet at the HIGHEST gap any touched cell
 *  demands — center-cell-only feet froze the raid on the dais lip while
 *  the server corrected every move. */
function floorNear(grid, x, z, refY) {
  const R = 0.31;
  const cells = new Set();
  for (const dx of [-R, R]) for (const dz of [-R, R]) cells.add(`${Math.floor(x + dx)},${Math.floor(z + dz)}`);
  let ny = -1;
  for (const c of cells) {
    const [xi, zi] = c.split(",").map(Number);
    const g = columnGapNear(grid, xi, zi, refY);
    if (g < 0 || g > refY + 1.05) return null; // wall/no-gap cell: blocked, don't wall-climb
    if (g > ny) ny = g;
  }
  return ny >= 0 ? ny : refY;
}
// solid ids from shared/blocks.json (BOM-tolerant)
const SOLID_IDS = new Set(
  JSON.parse(readFileSync(new URL("../shared/blocks.json", import.meta.url), "utf8").replace(/^﻿/, ""))
    .blocks.filter((b) => b.solid).map((b) => b.id)
);

/** Straight-line floor-aware stepping (interiors; assumes a mostly clear
 *  line; sidesteps when the direct line is blocked by a step/wall). */
async function moveToward(ws, state, tx, tz, within = 2.2, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let jink = 1;
  while (Date.now() < deadline) {
    const dx = tx - state.x;
    const dz = tz - state.z;
    const d = Math.hypot(dx, dz);
    if (d <= within) return true;
    const step = Math.min(0.45, d);
    let nx = state.x + (dx / d) * step;
    let nz = state.z + (dz / d) * step;
    let ny = floorNear(state.terrain, nx, nz, state.y);
    if (ny === null) {
      // blocked: sidestep perpendicular to the line and try again next tick
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
  await sleep(800);
  let slot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "kingsrend_greataxe");
  if (slot < 0) throw new Error("kingsrend_greataxe never arrived");
  if (slot >= 8) {
    ws.send(JSON.stringify({ t: "invMove", from: slot, to: 1 }));
    await sleep(400);
    slot = 1;
  }
  ws.send(JSON.stringify({ t: "equip", slot }));
  await sleep(300);
}

function drinkIfHurt(ws, state, below = 520) {
  if (state.stats && state.stats.hp < below) {
    const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
    if (pot >= 0) ws.send(JSON.stringify({ t: "consume", slot: pot }));
  }
}

/** Kill whatever mob is closest within `radius` until nothing hostile is
 *  near for ~4 s (the city walk drinks through L14-16 packs on the way). */
async function clearNear(ws, state, radius = 5, timeoutMs = 60_000, skipName = null) {
  const deadline = Date.now() + timeoutMs;
  let quietSince = Date.now();
  while (Date.now() < deadline && !state.died) {
    drinkIfHurt(ws, state);
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

/** Walk a waypoint route, fighting through anything that closes. */
async function walkRoute(ws, state, waypoints, tag, skipName = null) {
  for (const [wx, wz] of waypoints) {
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      ok = await moveToward(ws, state, wx, wz, 2.4, 25000);
      if (!ok) await clearNear(ws, state, 6, 30_000, skipName); // something is chewing on us
      drinkIfHurt(ws, state);
    }
    if (!ok) {
      log(`FAIL [${tag}] never reached waypoint (${wx},${wz}) — at (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
      return false;
    }
  }
  return true;
}

/** Boss-fight loop: potions hard, kills adds ON it first, else the boss. */
async function fight(ws, state, bossId, anchor, addName, tag = "main", timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  const dead = () => state.events.some((ev) => ev.kind === "death" && ev.id === bossId);
  state.maxAdds = 0;
  let lastBossPos = { ...anchor };
  let lastLog = 0;
  while (Date.now() < deadline && !state.died) {
    if (dead()) return true;
    state.maxAdds = Math.max(state.maxAdds, liveMobs(state, addName).length);
    // observe wave levels LIVE — the raid deletes dead adds from interest
    for (const e of liveMobs(state, addName)) {
      state.addLevels = state.addLevels ?? new Set();
      if (e.level !== undefined) state.addLevels.add(e.level);
    }
    drinkIfHurt(ws, state);
    const boss = state.ents.get(bossId);
    if (boss) lastBossPos = { x: boss.x, z: boss.z };
    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      log(`  [${tag}] me=(${state.x.toFixed(1)},${state.y.toFixed(0)},${state.z.toFixed(1)}) hp=${state.stats?.hp} boss=${boss ? `(${boss.x.toFixed(1)},${boss.z.toFixed(1)}) hp=${boss.hp ?? "?"}` : "OUT OF INTEREST"}`);
    }
    // target: an add literally on top of us (< 3.5 m), else the boss —
    // peeling every add forever is how a summon loop wins
    const adds = liveMobs(state, addName)
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
      await moveToward(ws, state, target.x, target.z, 2.2, 3000);
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

/** Spin up a geared raider holding on the court forecourt until the raid
 *  moves as one (walking in alone just feeds the King). */
async function makeRaider(username) {
  await api("/api/register", { username, password: "raid123" }).catch(() => {});
  const { token: tk, account: acc } = await api("/api/login", { username, password: "raid123" });
  if (!acc.roles.includes("admin")) throw new Error(`${username} is not admin — node scripts/make-admin.mjs ${username}`);
  let { characters: chars } = await api("/api/characters", null, tk);
  if (!chars.length) chars = [(await api("/api/characters", { name: username[0].toUpperCase() + username.slice(1) }, tk)).character];
  const g = await api("/api/enter", { characterId: chars[0].id }, tk);
  let { ws: rws, state: rstate } = await enterRoom(g.wsUrl, g.ticket);
  ({ ws: rws, state: rstate } = await gotoRoom(rws, rstate, "broken_court"));
  await gearUp(rws, rstate);
  await tp(rws, rstate, 48, 76); // hold on the forecourt, short of the doors
  return { ws: rws, state: rstate };
}

// ---- login as the admin bot ----
await api("/api/register", { username: "dropbot", password: "drop123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "dropbot", password: "drop123" });
if (!account.roles.includes("admin")) {
  console.error("[cityprobe] dropbot is not admin — run: node scripts/make-admin.mjs dropbot  (then rerun)");
  process.exit(2);
}
if (!(await roomOpen("broken_court"))) {
  log("broken_court is in downtime — waiting for the cycle to reopen it...");
  if (!(await waitRoomOpen("broken_court", 960))) {
    console.error("[cityprobe] broken_court never reopened (check the stack / MMO_DOWNTIME_OVERRIDE_SEC)");
    process.exit(2);
  }
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Dropbot" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);

// ============================ CITY LEG ============================

// ---- 1. the fields' tribute road -> paired arrival at the city south gate
// (batch 7 spliced the Sundering Fields between the fen and the capital:
// the city's south-gate neighbour is the fields now) ----
({ ws, state } = await gotoRoom(ws, state, "sundering_fields"));
await tp(ws, state, 144, 31);
const atGate = await goTo(ws, state, 144, 27.4, 0.9); // one row off the arch line, inside the trigger
expect(atGate, `stood at the tribute-road city portal (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
state.transfer = null;
ws.send(JSON.stringify({ t: "usePortal", portalId: "fields-city" }));
const tCity = await waitTransfer(state);
expect(!!tCity, "fields-city portal granted a transfer");
if (!tCity) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tCity.wsUrl, tCity.ticket));
expect(state.roomId === "sundered_city", `arrived in ${state.roomId}`);
expect(
  Math.hypot(state.x - 128, state.z - 222.8) < 3,
  `paired arrival at the SOUTH GATE (${state.x.toFixed(1)},${state.z.toFixed(1)} vs 128,222.8)`
);

// ---- 2. stateful city + the sealed court gate + the reworked keep ----
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const back = state.portals.find((p) => p.id === "city-southgate");
const breach = state.portals.find((p) => p.id === "city-breach");
let court = state.portals.find((p) => p.id === "city-court");
expect(back?.target === "sundering_fields" && back?.open === true, "the south gate targets the fields and replicates OPEN (the city stands — STATEFUL)");
expect(breach?.target === "foundry" && breach?.open === true, "the east breach carries the Foundry road and replicates OPEN");
expect(!!court, "the NEW city-court portal replicates");
await gearUp(ws, state);
let staged = false;
if (court?.open !== false) {
  // a prior run killed Osmund and his 900 s window is still open — restage
  log("     (staging: Osmund on his respawn timer — /spawnmob restages him and reseals the gate)");
  await tp(ws, state, 128, 60);
  ws.send(JSON.stringify({ t: "chat", text: "/spawnmob ser_osmund 1" }));
  staged = true;
  await sleep(1500);
  const st = state.portalStates.filter((p) => p.target === "broken_court").pop();
  court = { ...court, open: st ? st.open : court.open };
  await tp(ws, state, 128, 218);
}
expect(court?.open === false, "city-court boots/reseals SEALED while Ser Osmund keeps the door");
expect(state.terrain.get(126, 17, 52) === SOLID_ID_BY_NAME("iron_bars"), "the forced portcullis decodes at the keep's inner gate");
expect(state.terrain.get(120, 20, 53) === SOLID_ID_BY_NAME("marble"), "the gatehouse crosswall decodes");
expect(state.terrain.get(128, 20, 40) === 0, "the gold throne is GONE from the keep (it moved to the court)");
const maera = [...state.ents.values()].find((e) => e.kind === "npc" && e.name === "Maera the Chronicler");
expect(!!maera, "Maera the Chronicler stands at the gate");

// ---- 3. population sweep at the L14-16 band ----
await tp(ws, state, 70, 172); await sleep(1500);
const marauders = liveMobs(state, "Ashpicker Marauder");
expect(marauders.length > 0 && marauders.every((m) => m.level === 14), `marauders L14 at the war-camp (${marauders.length})`);
const riderless = [...state.ents.values()].filter((e) => e.kind === "mob" && e.level === 17 && e.act !== "dead" && (e.name ?? "").includes("Cinder Nightmare"));
expect(riderless.length > 0, `the Riderless (L17) prowls the burned market (${riderless.length})`);
await tp(ws, state, 128, 132); await sleep(1500);
// interest reaches the L14 gate garrison too — judge only the avenue table's own circle
const soldiers = liveMobs(state, "Fallen Garrison Soldier").filter((m) => Math.hypot(m.x - 128, m.z - 132) < 16);
expect(soldiers.length > 0 && soldiers.every((m) => m.level === 15), `fallen soldiers L15 on the avenue (${soldiers.length})`);
await tp(ws, state, 128, 82); await sleep(1500);
const sentinels = liveMobs(state, "Oathbound Sentinel");
expect(sentinels.length > 0 && sentinels.every((m) => m.level === 16), `oathbound L16 in the courtyard (${sentinels.length})`);

// ---- 4. the gatehouse fight, ON FOOT from the south gate: the barricade
// S-curve, the stair, the keep, the murder-hole passage — no straight line ----
await tp(ws, state, 128, 214);
log("walking the avenue to the gatehouse (fighting through)...");
const route = [
  [128, 196], // the gate garrison
  [128, 172], // mid-avenue (the collapsed house squeeze)
  [122, 163], // west kerb — AROUND the avenue crater at (128,161), between the lantern posts
  [122, 152],
  [131, 145], // barricade 1: gap on the EAST side
  [131, 138],
  [125, 122], // barricade 2: gap on the WEST side (mid-gap, clear of the x123 lantern posts)
  [125, 112],
  [128, 98], // the monumental stair
  [128, 88], // castle gatehouse corridor
  [128, 76], // courtyard, keep door guard
  [128, 70], // through the keep doors
  [128, 60], // the nave
  [128, 56], // the gate-wall mouth
];
expect(await walkRoute(ws, state, route, "avenue", "Ser Osmund"), `walked the S-curve to the inner gate (${state.x.toFixed(1)},${state.y.toFixed(0)},${state.z.toFixed(1)})`);
// re-stock: the walk drinks — the duel must start with a full belt
ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
await sleep(600);
await clearNear(ws, state, 10, 120_000, "Ser Osmund"); // the keep door sentinels join indoors — the duel is HIS

// through the murder-hole passage — Osmund waits on the other side
await moveToward(ws, state, 128, 53.5, 1.2, 15000);
await sleep(800);
const osmund = [...state.ents.values()].find((e) => e.kind === "mob" && (e.name ?? "").startsWith("Ser Osmund") && e.act !== "dead");
expect(!!osmund, `Ser Osmund keeps the king's door (${osmund ? `${osmund.x.toFixed(0)},${osmund.z.toFixed(0)} L${osmund.level}` : "?"})`);
if (!osmund) { log("RESULT: FAIL"); process.exit(1); }
expect(osmund.level === 17, `the Gatekeeper is L17 (${osmund.level})`);

log("the gatekeeper duel...");
const osmundDead = await fight(ws, state, osmund.id, { x: 128, z: 48 }, "Oathbound Sentinel", "osmund", 180_000);
expect(osmundDead, `Ser Osmund put down (bot hp ${state.stats?.hp}, died=${state.died})`);
expect(chatWith(state, "The door stays shut"), "50% stand announce");
expect(chatWith(state, "released at last"), "death announce: released at last, the way stands open");
for (let i = 0; i < 30; i++) {
  if (state.portalStates.some((p) => p.target === "broken_court" && p.open === true)) break;
  await sleep(100);
}
expect(state.portalStates.some((p) => p.target === "broken_court" && p.open === true), "portalState: city-court OPEN over the corpse");

// ---- 5. through the court gate ----
// stand ONE row off the arch line (z43.4), INSIDE the 2.2 m trigger — the
// lintel columns read as walls to the floor stepper (the fells-probe trap)
state.transfer = null;
let tCourt = null;
for (let attempt = 0; attempt < 3 && !tCourt; attempt++) {
  await moveToward(ws, state, 128, 43.4, 1.0, 15000);
  ws.send(JSON.stringify({ t: "usePortal", portalId: "city-court" }));
  tCourt = await waitTransfer(state, 5000);
}
expect(!!tCourt, "city-court granted a transfer");
if (!tCourt) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tCourt.wsUrl, tCourt.ticket));

// ============================ COURT LEG ============================

// ---- 6. forecourt arrival + preset sanity ----
expect(state.roomId === "broken_court", `arrived in ${state.roomId}`);
expect(
  Math.hypot(state.x - 48, state.z - 84.8) < 3,
  `paired arrival on the FORECOURT (${state.x.toFixed(1)},${state.z.toFixed(1)} vs 48,84.8)`
);
expect(state.terrain.get(48, 16, 19) === SOLID_ID_BY_NAME("gold_block"), `gold throne decodes at (48,16,19) [id ${state.terrain.get(48, 16, 19)}]`);
expect(state.terrain.get(48, 19, 14) === SOLID_ID_BY_NAME("stained_glass"), `stained-glass rose window decodes at (48,19,14) [id ${state.terrain.get(48, 19, 14)}]`);
// batch 8 opened the breach: the dead-end became the torn portal chamber and
// the arch's path apron paves the portal's own circle — sample the chamber
// ring around it (same window as broken_court.test)
let white = 0;
for (let z = 1; z <= 7; z++) for (let x = 31; x <= 39; x++) {
  if (Math.hypot(x - 35, z - 4) <= 3.2) continue; // the arch apron
  for (let y = 14; y <= 17; y++) {
    const b = state.terrain.get(x, y, z);
    if (b === SOLID_ID_BY_NAME("snow") || b === SOLID_ID_BY_NAME("ice")) white++;
  }
}
expect(white >= 6, `the BREACH wears the Waste's colors (${white} snow/ice cells in the torn chamber)`);

// ---- 7. the processional + the King, three-strong ----
log("raising the raid (raider1 + raider2)...");
const raiders = [await makeRaider("raider1"), await makeRaider("raider2")];
log("the processional walk...");
const entered = await Promise.all([
  moveToward(ws, state, 48, 58, 2.0, 25000).then(() => moveToward(ws, state, 48, 34, 2.5, 25000)),
  ...raiders.map((r, i) => moveToward(r.ws, r.state, 48, 58, 2.0, 25000).then(() => moveToward(r.ws, r.state, 48, 36 + i * 2, 3.0, 25000))),
]);
expect(entered[0], `walked the processional into the hall (${state.x.toFixed(1)},${state.y.toFixed(0)},${state.z.toFixed(1)})`);
await sleep(1200);
const king = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "Vaelric, the Sundered King" && e.act !== "dead");
expect(!!king, `the Sundered King holds court (${king ? `${king.x.toFixed(0)},${king.z.toFixed(0)}` : "?"})`);
if (!king) { log("RESULT: FAIL"); process.exit(1); }
expect(king.level === 19, `Vaelric is L19 here (${king.level})`);
const sentinelsBefore = liveMobs(state, "Oathbound Sentinel").length;

log("the throne fight...");
const t0 = Date.now();
const raiderFights = raiders.map((r, i) => fight(r.ws, r.state, king.id, { x: 48, z: 26 }, "Oathbound Sentinel", `raider${i + 1}`));
let kingDead = await fight(ws, state, king.id, { x: 48, z: 26 }, "Oathbound Sentinel", "main");
const raiderResults = await Promise.allSettled(raiderFights);
// the raid may land the killing blow after the main bot's loop exits
kingDead = kingDead
  || state.events.some((ev) => ev.kind === "death" && ev.id === king.id)
  || raiderResults.some((r) => r.status === "fulfilled" && r.value === true);
expect(kingDead, `Vaelric killed in ${Math.round((Date.now() - t0) / 1000)}s (bot hp ${state.stats?.hp}, died=${state.died})`);
expect(chatWith(state, "The court answers"), "66% rally announced (the muster-call)");
expect(chatWith(state, "NOT kneel"), "33% rally announced");
expect(state.maxAdds > sentinelsBefore, `rally/summon adds joined the fight (${sentinelsBefore} -> peak ${state.maxAdds})`);
const waveLevels = [...(state.addLevels ?? [])].concat(...raiders.map((r) => [...(r.state.addLevels ?? [])]));
expect(waveLevels.includes(18), `the rally waves answered at L18 (levels seen: ${[...new Set(waveLevels)].join(",") || "none"} — the event's level field)`);
expect(chatWith(state, "the mountain is OPEN"), "death announce: the court falls silent, the mountain is open");
// raiders stay CONNECTED through the loot — the crown bag is often
// owner-locked to one of them (closed after the loot section below)

// loot the king for the crown (SENTINEL bags litter the carpet too — prefer
// the bag whose replicated loot view carries the crown)
await sleep(1200);
const gotCrown = () => (state.inv?.slots ?? []).some((s) => s && s.item === "sundered_crown");
const bagsNearDais = () =>
  [...state.ents.values()]
    .filter((e) => e.kind === "loot" && Math.hypot(e.x - 48, e.z - 26) < 30)
    .sort((a, b) => {
      const hasCrown = (e) => (e.loot ?? []).some((l) => l && l.item === "sundered_crown");
      const ac = hasCrown(a) ? 0 : 1;
      const bc = hasCrown(b) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return Math.hypot(a.x - state.x, a.z - state.z) - Math.hypot(b.x - state.x, b.z - state.z);
    });
let sawBag = bagsNearDais().length > 0;
const lootDeadline = Date.now() + 45_000; // the collapse gives us ~a minute
// boss bags are OWNER-LOCKED 30 s to the top damage dealer — often a RAIDER
// (batch 8 lesson): every raid bot attempts the pickup, and the crown counts
// wherever it lands
const crownAnywhere = () =>
  gotCrown() || raiders.some((r) => (r.state.inv?.slots ?? []).some((s) => s && s.item === "sundered_crown"));
while (!crownAnywhere() && Date.now() < lootDeadline) {
  const bags = bagsNearDais();
  if (!bags.length) { await sleep(1000); continue; }
  sawBag = true;
  const bag = bags[0];
  await Promise.all([
    moveToward(ws, state, bag.x, bag.z, 1.5, 8000).then(() => ws.send(JSON.stringify({ t: "pickup", id: bag.id }))),
    ...raiders.map((r) =>
      moveToward(r.ws, r.state, bag.x, bag.z, 1.8, 8000).then(() => r.ws.send(JSON.stringify({ t: "pickup", id: bag.id }))).catch(() => {})
    ),
  ]);
  await sleep(1500);
}
expect(sawBag, "loot bags dropped near the dais");
expect(crownAnywhere(), "looted The Sundered Crown from the King's bag");
for (const r of raiders) try { r.ws.close(); } catch {}

// the one-minute collapse: warnings then evict
const warned30 = async () => { for (let i = 0; i < 45 * 10; i++) { if (chatWith(state, "collapses in 30 seconds")) return true; await sleep(100); } return false; };
expect(await warned30(), "T-30 collapse warning");
const evicted = async () => { for (let i = 0; i < 60 * 10; i++) { if (state.evicted) return true; await sleep(100); } return false; };
expect(await evicted(), `evicted ~1 min after the kill (reason: ${state.evicted})`);
ws.close();

// ---- 8. back in the city: the countdown gate, then the fresh reopen ----
await sleep(3000);
const status = await api("/api/status");
const courtRoom = status.rooms.find((r) => r.roomId === "broken_court");
expect(!courtRoom || courtRoom.status !== "open", `court no longer open after the collapse (status: ${courtRoom?.status ?? "gone"})`);

const grant2 = await api("/api/enter", { characterId: characters[0].id }, token);
({ ws, state } = await enterRoom(grant2.wsUrl, grant2.ticket));
expect(state.roomId === "hub", `collapse evicted hub-bound (re-entered in ${state.roomId})`);
({ ws, state } = await gotoRoom(ws, state, "sundered_city"));
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const courtGate = state.portals.find((p) => p.id === "city-court");
expect(courtGate?.open === false, "city-court shows CLOSED while the court resets");
expect((courtGate?.reopenInSec ?? 0) > 0, `city-court carries the downtime countdown (reopenInSec ${courtGate?.reopenInSec})`);

const countdown = courtGate?.reopenInSec ?? 0;
if (countdown > 0 && (countdown <= 90 || WAIT_REOPEN)) {
  log(`waiting out the ${countdown}s downtime for the fresh reopen...`);
  const reopened = await waitRoomOpen("broken_court", countdown + 120);
  expect(reopened, "court reopened fresh after downtime");
  if (reopened) {
    // Osmund is still down (his own 900 s window) — the gate should be open
    // both ways again; hop in and confirm the King stands at FULL health
    let probe2 = await gotoRoom(ws, state, "broken_court");
    ws = probe2.ws; state = probe2.state;
    await sleep(1000);
    const freshKing = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "Vaelric, the Sundered King" && e.act !== "dead");
    expect(!!freshKing && freshKing.hp === 2508, `the King stands again at full health (${freshKing?.hp}/2508)`);
    ({ ws, state } = await gotoRoom(ws, state, "sundered_city"));
  }
} else {
  log(`(skipping the reopen wait — countdown ${countdown}s; pass --wait-reopen or run the stack with MMO_DOWNTIME_OVERRIDE_SEC)`);
}

// ---- 9. the reseal: the gatekeeper returns, the door shuts ----
// Restart the city first so the check is deterministic: a fresh boot either
// seals at init (the natural 900 s timer already restored Osmund — the
// boot-seal path) or boots open over his corpse, in which case /spawnmob
// MUST broadcast the reseal (spawnMob → onBossSpawned).
ws.close();
await restartCity("pre-reseal stage");
const grant3 = await api("/api/enter", { characterId: characters[0].id }, token);
({ ws, state } = await enterRoom(grant3.wsUrl, grant3.ticket));
({ ws, state } = await gotoRoom(ws, state, "sundered_city"));
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const gateNow = state.portals.find((p) => p.id === "city-court");
if (gateNow?.open === false && (gateNow?.reopenInSec ?? 0) === 0) {
  expect(true, "city-court boots RESEALED — the Gatekeeper's natural respawn already shut the door");
} else {
  state.portalStates.length = 0;
  ws.send(JSON.stringify({ t: "chat", text: "/spawnmob ser_osmund 1" }));
  staged = true;
  await sleep(1500);
  expect(
    state.portalStates.some((p) => p.target === "broken_court" && p.open === false),
    "city-court RESEALS the moment the Gatekeeper stands again (spawnMob → onBossSpawned)"
  );
}
ws.close();

// contamination discipline: clear the staged Osmund (command-spawned mobs
// never despawn; the stateful city would keep him forever)
if (staged) await restartCity("cleared the staged gatekeeper");

log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);

/** block id by name from shared/blocks.json (probe-side mirror). */
function SOLID_ID_BY_NAME(name) {
  const blocks = JSON.parse(readFileSync(new URL("../shared/blocks.json", import.meta.url), "utf8").replace(/^﻿/, "")).blocks;
  return blocks.find((b) => b.name === name)?.id ?? -1;
}
