/**
 * Live probe for the Sundered City arc (the war-ruined preset city finale):
 *   1. /room gloomfen, /tp to the Old North Road portal, usePortal ->
 *      paired arrival at the city SOUTH GATE (authored exitPortalId pairing)
 *   2. preset world sanity over the wire: gold throne + glowing rose window
 *      blocks decode at their authored coordinates; Maera the Chronicler
 *      stands at the gate; both return portals replicate OPEN (no seal —
 *      the city is always open until the King falls)
 *   3. population sweep (/tp): marauders at the camp, fallen soldiers on
 *      the avenue, oathbound sentinels in the courtyard
 *   4. the throne fight: gear up, engage Vaelric —
 *      - 66% rally: "OATHBOUND!" announce + sentinel adds
 *      - 33% rally: "NOT kneel" announce + more adds
 *      - death: "COLLAPSING" announce -> 30s + 10s collapse warnings ->
 *        evict within ~75s (the owner's "closes in one minute")
 *   5. master lifecycle: room leaves "open" after the collapse, and the
 *      admin overview shows NO expiry timer on a fresh boot (always-open)
 * Needs the `dropbot` account to be admin (node scripts/make-admin.mjs dropbot).
 * Exits 0 on success, 1 on any failed expectation.
 *
 *   node scripts/city-probe.mjs [--wait-reopen]
 *     --wait-reopen: additionally wait out the 300s downtime and assert the
 *     city reopens fresh (slow; off by default)
 */
import WebSocket from "ws";
import { loadEnv, makeWorldTracker, sleep } from "./lib.mjs";

loadEnv();
const MASTER = `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
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
import { readFileSync } from "node:fs";
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

/** Group-fight loop: potions hard, kills adds ON it first, else the boss.
 *  The King is deliberately group content (rallies + summons out-damage any
 *  solo healer) — the probe raids him with three bots. */
async function fight(ws, state, bossId, tag = "main", timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  const dead = () => state.events.some((ev) => ev.kind === "death" && ev.id === bossId);
  state.maxSentinels = 0;
  let lastBossPos = { x: 128, z: 42 }; // the dais anchor
  let lastLog = 0;
  while (Date.now() < deadline && !state.died) {
    if (dead()) return true;
    state.maxSentinels = Math.max(state.maxSentinels, liveMobs(state, "Oathbound Sentinel").length);
    if (state.stats && state.stats.hp < 520) {
      const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
      if (pot >= 0) ws.send(JSON.stringify({ t: "consume", slot: pot }));
    }
    const boss = state.ents.get(bossId);
    if (boss) lastBossPos = { x: boss.x, z: boss.z };
    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      log(`  [${tag}] me=(${state.x.toFixed(1)},${state.y.toFixed(0)},${state.z.toFixed(1)}) hp=${state.stats?.hp} boss=${boss ? `(${boss.x.toFixed(1)},${boss.z.toFixed(1)}) hp=${boss.hp ?? "?"}` : "OUT OF INTEREST"}`);
    }
    // target: a sentinel literally on top of us (< 3.5 m), else the King —
    // peeling every add forever is how the summon loop wins
    const adds = liveMobs(state, "Oathbound Sentinel")
      .map((e) => ({ e, d: Math.hypot(e.x - state.x, e.z - state.z) }))
      .filter((a) => a.d < 3.5)
      .sort((a, b) => a.d - b.d);
    const target = adds.length ? adds[0].e : boss;
    if (!target || target.act === "dead") {
      // boss out of interest: walk toward his last known spot to re-acquire
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

/** Clear-adds loop: kill every sentinel that closes on us; returns once no
 *  live sentinel has been within reach for ~5 s. */
async function clearAdds(ws, state, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let quietSince = Date.now();
  while (Date.now() < deadline && !state.died) {
    if (state.stats && state.stats.hp < 520) {
      const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
      if (pot >= 0) ws.send(JSON.stringify({ t: "consume", slot: pot }));
    }
    const adds = liveMobs(state, "Oathbound Sentinel")
      .map((e) => ({ e, d: Math.hypot(e.x - state.x, e.z - state.z) }))
      .filter((a) => a.d < 16)
      .sort((a, b) => a.d - b.d);
    if (!adds.length) {
      if (Date.now() - quietSince > 5000) return true;
      await sleep(400);
      continue;
    }
    quietSince = Date.now();
    const t = adds[0].e;
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

/** Spin up a geared raider holding at the SAFE south gate until the raid
 *  moves as one (walking in alone just feeds the King). */
async function makeRaider(username) {
  await api("/api/register", { username, password: "raid123" }).catch(() => {});
  const { token: tk, account: acc } = await api("/api/login", { username, password: "raid123" });
  if (!acc.roles.includes("admin")) throw new Error(`${username} is not admin — node scripts/make-admin.mjs ${username}`);
  let { characters: chars } = await api("/api/characters", null, tk);
  if (!chars.length) chars = [(await api("/api/characters", { name: username[0].toUpperCase() + username.slice(1) }, tk)).character];
  const g = await api("/api/enter", { characterId: chars[0].id }, tk);
  let { ws: rws, state: rstate } = await enterRoom(g.wsUrl, g.ticket);
  ({ ws: rws, state: rstate } = await gotoRoom(rws, rstate, "sundered_city"));
  await gearUp(rws, rstate);
  await tp(rws, rstate, 128, 214); // hold at the gate, out of everything's aggro
  return { ws: rws, state: rstate };
}

// ---- login as the admin bot ----
await api("/api/register", { username: "dropbot", password: "drop123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "dropbot", password: "drop123" });
if (!account.roles.includes("admin")) {
  console.error("[cityprobe] dropbot is not admin — run: node scripts/make-admin.mjs dropbot  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Dropbot" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);

// ---- 1. gloomfen north road -> paired arrival at the city south gate ----
({ ws, state } = await gotoRoom(ws, state, "gloomfen"));
expect(await tp(ws, state, 160, 31), `stood at the Old North Road portal (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
state.transfer = null;
ws.send(JSON.stringify({ t: "usePortal", portalId: "gloomfen-city-north" }));
const tCity = await waitTransfer(state);
expect(!!tCity, "north-road portal granted a transfer");
if (!tCity) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tCity.wsUrl, tCity.ticket));
expect(state.roomId === "sundered_city", `arrived in ${state.roomId}`);
expect(
  Math.hypot(state.x - 128, state.z - 222.8) < 3,
  `paired arrival at the SOUTH GATE (${state.x.toFixed(1)},${state.z.toFixed(1)} vs 128,222.8)`
);

// ---- 2. preset world + always-open portals + the chronicler ----
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const back = state.portals.find((p) => p.id === "city-southgate");
const breach = state.portals.find((p) => p.id === "city-breach");
expect(back?.open === true && breach?.open === true, "both gloomfen portals replicate OPEN (no seal — city stands until the King falls)");
expect(state.terrain.get(128, 20, 40) === 54, `gold throne decodes at (128,20,40) [id ${state.terrain.get(128, 20, 40)}]`);
expect(state.terrain.get(128, 23, 36) === 55, `stained-glass rose window decodes at (128,23,36) [id ${state.terrain.get(128, 23, 36)}]`);
const maera = [...state.ents.values()].find((e) => e.kind === "npc" && e.name === "Maera the Chronicler");
expect(!!maera, "Maera the Chronicler stands at the gate");

// ---- 3. gear up first (the sweeps stand next to L13-16 packs), then sweep ----
await gearUp(ws, state);
await tp(ws, state, 70, 172); await sleep(1500);
expect(liveMobs(state, "Warband Marauder").length > 0, `marauders at the war-camp (${liveMobs(state, "Warband Marauder").length})`);
await tp(ws, state, 128, 132); await sleep(1500);
expect(liveMobs(state, "Fallen Garrison Soldier").length > 0, `fallen soldiers on the avenue (${liveMobs(state, "Fallen Garrison Soldier").length})`);
await tp(ws, state, 128, 82); await sleep(1500);
expect(liveMobs(state, "Oathbound Sentinel").length > 0, `oathbound in the courtyard (${liveMobs(state, "Oathbound Sentinel").length})`);

// ---- 4. the throne fight: walk in through the keep doors (/tp lands on
// the ROOF — standY; the great hall must be entered on foot), raiding
// three-strong — the King is group content by design ----
log("raising the raid (raider1 + raider2)...");
const raiders = [await makeRaider("raider1"), await makeRaider("raider2")];

// phase A: the raid gathers in the courtyard and cuts down the garrison
log("phase A: clearing the courtyard garrison...");
await tp(ws, state, 128, 76);
for (const r of raiders) await tp(r.ws, r.state, 128, 76);
const cleared = await Promise.all([
  clearAdds(ws, state),
  ...raiders.map((r) => clearAdds(r.ws, r.state)),
]);
expect(cleared.every(Boolean), `courtyard cleared (${cleared.map(String).join(",")})`);

// phase B: walk in through the doors together
log("phase B: entering the great hall...");
const entered = await Promise.all([
  moveToward(ws, state, 128, 58, 2.5),
  ...raiders.map((r) => moveToward(r.ws, r.state, 128, 60, 3.0)),
]);
expect(entered[0], `walked into the great hall (${state.x.toFixed(1)},${state.y.toFixed(0)},${state.z.toFixed(1)})`);
await sleep(1200);
const king = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "Vaelric, the Sundered King" && e.act !== "dead");
expect(!!king, `the Sundered King waits on his dais (${king ? `${king.x.toFixed(0)},${king.z.toFixed(0)}` : "?"})`);
if (!king) { log("RESULT: FAIL"); process.exit(1); }
const sentinelsBefore = liveMobs(state, "Oathbound Sentinel").length;

// phase C: the throne fight, three-strong
log("phase C: the throne fight...");
const t0 = Date.now();
const raiderFights = raiders.map((r, i) => fight(r.ws, r.state, king.id, `raider${i + 1}`));
let kingDead = await fight(ws, state, king.id, "main");
const raiderResults = await Promise.allSettled(raiderFights);
for (const r of raiders) r.ws.close();
// the raid may land the killing blow after the main bot's loop exits
kingDead = kingDead
  || state.events.some((ev) => ev.kind === "death" && ev.id === king.id)
  || raiderResults.some((r) => r.status === "fulfilled" && r.value === true);
expect(kingDead, `Vaelric killed in ${Math.round((Date.now() - t0) / 1000)}s (bot hp ${state.stats?.hp}, died=${state.died})`);
expect(chatWith(state, "OATHBOUND! Your king commands you"), "66% rally announced");
expect(chatWith(state, "NOT kneel"), "33% rally announced");
expect(state.maxSentinels > sentinelsBefore, `rally/summon adds joined the fight (${sentinelsBefore} -> peak ${state.maxSentinels})`);
expect(chatWith(state, "COLLAPSING"), "death announce: the city begins to collapse");

// loot the king for the crown: SENTINEL bags litter the dais too — prefer
// the bag whose replicated loot view carries the crown, else sweep every
// bag until it lands in the inventory (retrying through the 30s owner-lock)
await sleep(1200);
const gotCrown = () => (state.inv?.slots ?? []).some((s) => s && s.item === "sundered_crown");
const bagsNearDais = () =>
  [...state.ents.values()]
    .filter((e) => e.kind === "loot" && Math.hypot(e.x - 128, e.z - 42) < 30)
    .sort((a, b) => {
      const hasCrown = (e) => (e.loot ?? []).some((l) => l && l.item === "sundered_crown");
      const ac = hasCrown(a) ? 0 : 1;
      const bc = hasCrown(b) ? 0 : 1;
      if (ac !== bc) return ac - bc; // the crown bag first
      return Math.hypot(a.x - state.x, a.z - state.z) - Math.hypot(b.x - state.x, b.z - state.z);
    });
let sawBag = bagsNearDais().length > 0;
const lootDeadline = Date.now() + 45_000; // the collapse gives us ~a minute
while (!gotCrown() && Date.now() < lootDeadline) {
  const bags = bagsNearDais();
  if (!bags.length) { await sleep(1000); continue; }
  sawBag = true;
  const bag = bags[0];
  await moveToward(ws, state, bag.x, bag.z, 1.5, 8000);
  ws.send(JSON.stringify({ t: "pickup", id: bag.id }));
  await sleep(1500);
}
expect(sawBag, "loot bags dropped near the dais");
expect(gotCrown(), "looted The Sundered Crown from the King's bag");

// ---- 5. one-minute collapse: warnings then evict ----
const warned30 = async () => { for (let i = 0; i < 45 * 10; i++) { if (chatWith(state, "collapses in 30 seconds")) return true; await sleep(100); } return false; };
expect(await warned30(), "T-30 collapse warning");
const evicted = async () => { for (let i = 0; i < 60 * 10; i++) { if (state.evicted) return true; await sleep(100); } return false; };
expect(await evicted(), `evicted ~1 min after the kill (reason: ${state.evicted})`);
ws.close();

// ---- 6. master lifecycle: leaves "open", then (optionally) reopens fresh ----
await sleep(3000);
const status = await api("/api/status");
const cityRoom = status.rooms.find((r) => r.roomId === "sundered_city");
expect(!cityRoom || cityRoom.status !== "open", `city no longer open after collapse (status: ${cityRoom?.status ?? "gone"})`);

if (WAIT_REOPEN) {
  log("waiting out the 300s downtime for the fresh reopen...");
  let reopened = false;
  for (let i = 0; i < 420; i++) {
    await sleep(1000);
    const s = await api("/api/status");
    const r = s.rooms.find((x) => x.roomId === "sundered_city");
    if (r?.status === "open") { reopened = true; break; }
  }
  expect(reopened, "city reopened fresh after downtime (the King stands again)");
}

log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
