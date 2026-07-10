/**
 * Live probe for the entity-linked event arc (boss gates / rallies / collapse):
 *   1. /room dungeon -> the Vaults portal arrives SEALED (open:false) while
 *      the Gravelord lives; usePortal is denied with the guardian message
 *   2. gear up (/level 30, epic rift_greataxe, potions) and kill the boss:
 *      - at 50% hp the room rallies skeleton adds + announces ("bellows")
 *      - on death the gate opens: announce ("grinds open") + portalState
 *        {target:crypt_depths, open:true}
 *   3. walk through the event-opened portal -> arrive in crypt_depths
 *   4. kill Morvane the lich (he summons bone bats mid-fight):
 *      - death announces the collapse (the bible's "the far gate TEARS"
 *        line), re-arms the room timer to 60s, AND tears open the one-way
 *        ESCAPE GATE (batch 7: depths-escape, sealed until this moment)
 *   5. RUN: walk to the far gate inside the collapse window, transfer
 *      through -> land at Valdrenn's collapsed postern (210.5,110.5 — the
 *      authored one-way landing; no return portal anywhere near it), then
 *      watch /api/status close crypt_depths behind you
 * Needs the `dropbot` account to be admin (node scripts/make-admin.mjs dropbot).
 * Exits 0 on success, 1 on any failed expectation.
 *
 *   node scripts/boss-events-probe.mjs
 */
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

const log = (...a) => console.log("[bossevents]", ...a);
let failed = false;
function expect(cond, what) {
  if (cond) log(`OK   ${what}`);
  else { failed = true; log(`FAIL ${what}`); }
}

/** Join a room; resolves once the voxel world decodes. Tracks everything the
 *  probe asserts on: portals, portalState updates, ents, chats, evts, evict. */
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

/** Admin-chat travel: /room <id>, wait for the grant, reconnect. */
async function gotoRoom(ws, state, roomId) {
  if (state.roomId === roomId) return { ws, state };
  state.transfer = null;
  ws.send(JSON.stringify({ t: "chat", text: `/room ${roomId}` }));
  const t = await waitTransfer(state);
  if (!t) throw new Error(`/room ${roomId}: no transfer granted (admin? room open?)`);
  ws.close();
  return enterRoom(t.wsUrl, t.ticket);
}

const chatWith = (state, needle) => state.chats.some((c) => c.text?.includes(needle));
const findMob = (state, mobName) =>
  [...state.ents.values()].find((e) => e.kind === "mob" && e.name === mobName && e.act !== "dead");

/** Gear up via admin chat and equip the greataxe into the hotbar. */
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

/** Face-tank a boss with the greataxe, potioning under 350 hp.
 *  Resolves true when the boss's death event arrives. */
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
      // live-aim convention: refresh yaw with a zero-move, then attack
      const aim = Math.atan2(dx, dz);
      state.seq++;
      ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: aim, anim: "idle" }));
      ws.send(JSON.stringify({ t: "attack", yaw: aim, pitch: 0 }));
      await sleep(1000); // cleave busy ~950ms
    }
  }
  return dead();
}

// ---- login as the admin bot ----
await api("/api/register", { username: "dropbot", password: "drop123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "dropbot", password: "drop123" });
if (!account.roles.includes("admin")) {
  console.error("[bossevents] dropbot is not admin — run: node scripts/make-admin.mjs dropbot  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Dropbot" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);

// ---- 1. the depths gate arrives sealed while the Gravelord lives ----
({ ws, state } = await gotoRoom(ws, state, "dungeon"));
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const depthsGate = state.portals.find((p) => p.id === "dungeon-depths");
expect(!!depthsGate && depthsGate.open === false, `depths portal arrives sealed (open=${depthsGate?.open})`);
expect(state.portals.find((p) => p.id === "dungeon-hub")?.open === true, "hub portal arrives open");

ws.send(JSON.stringify({ t: "usePortal", portalId: "dungeon-depths" }));
for (let i = 0; i < 30 && !chatWith(state, "guardian"); i++) await sleep(100);
expect(chatWith(state, "guardian"), "sealed portal denied with the guardian message");

// ---- 2. kill the Gravelord: rally at 50%, gate opens on death ----
await gearUp(ws, state);
const mino = findMob(state, "The Gravelord");
expect(!!mino, `Gravelord found at ${mino ? `${mino.x.toFixed(0)},${mino.z.toFixed(0)}` : "?"}`);
if (!mino) { log("RESULT: FAIL"); process.exit(1); }

const skeletonsNearBoss = () =>
  [...state.ents.values()].filter(
    (e) => e.kind === "mob" && e.name === "Skeleton" && e.act !== "dead" && Math.hypot(e.x - mino.x, e.z - mino.z) < 9
  ).length;
const skeletonsBefore = skeletonsNearBoss();

// rally adds must be observed DURING the fight — the bot's cleave arc mows
// the L6 wave down beside the boss, and a post-fight count sees 0 -> 0
// (the same trap city-probe documents for the court raid)
let skeletonsPeak = skeletonsBefore;
const rallyWatch = setInterval(() => {
  skeletonsPeak = Math.max(skeletonsPeak, skeletonsNearBoss());
}, 250);
const minoDead = await fight(ws, state, mino.id);
clearInterval(rallyWatch);
expect(minoDead, `Gravelord killed (bot hp ${state.stats?.hp}, died=${state.died})`);
expect(chatWith(state, "bellows"), "half-health rally announced (\"bellows\")");
expect(skeletonsPeak > skeletonsBefore, `rally adds appeared near the boss mid-fight (${skeletonsBefore} -> peak ${skeletonsPeak})`);
expect(chatWith(state, "stands open"), "gate-opening announced (\"the lower stair stands open\")");
const opened = state.portalStates.find((p) => p.target === "ossuary_galleries" && p.open === true);
expect(!!opened, "portalState {ossuary_galleries, open:true} replicated");

// ---- 3. walk through the event-opened gate ----
state.transfer = null;
const walked = await goTo(ws, state, depthsGate.x, depthsGate.z, 1.6);
expect(walked, `walked to the depths gate (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
ws.send(JSON.stringify({ t: "usePortal", portalId: "dungeon-depths" }));
const tDepths = await waitTransfer(state);
expect(!!tDepths, "event-opened portal grants a transfer");
if (!tDepths) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tDepths.wsUrl, tDepths.ticket));
// batch 5: the Gravelord's gate now opens into the Ossuary Galleries — the
// full crypt→ossuary→depths through-walk is ossuary-probe's job; this probe
// hops on by admin /room to keep its subject the EVENT ARC (gate + collapse)
expect(state.roomId === "ossuary_galleries", `arrived in ${state.roomId} (the spliced sorting-house)`);
// a prior run's collapse may still hold crypt_depths down — wait for the
// master to reopen it (MMO_DOWNTIME_OVERRIDE_SEC keeps this short)
for (let i = 0; i < 240; i++) {
  const status = await api("/api/status").catch(() => null);
  const room = status ? (status.shards ?? []).flatMap((s) => s.rooms ?? []).find((r) => r.roomId === "crypt_depths") : null;
  if (room && room.status === "open") break;
  if (i === 0) log("     (crypt_depths in downtime — waiting for the reopen)");
  await sleep(1000);
}
({ ws, state } = await gotoRoom(ws, state, "crypt_depths"));
expect(state.roomId === "crypt_depths", `hopped on to ${state.roomId}`);

// ---- 4. kill Morvane: summons mid-fight, the far gate TEARS, 60s window ----
await gearUp(ws, state); // fresh potions for the harder fight
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const escGate = state.portals.find((p) => p.id === "depths-escape");
expect(!!escGate && escGate.target === "sundered_city", "the far gate replicates (targets Valdrenn)");
expect(escGate?.open === false, "the far gate boots SEALED while the Pale King holds court");
// approach the lich vault (48,16) so the boss enters interest
await goTo(ws, state, 48, 30, 2.5);
await sleep(500);
const lich = findMob(state, "Morvane the Hollow");
expect(!!lich, `Morvane found at ${lich ? `${lich.x.toFixed(0)},${lich.z.toFixed(0)}` : "?"}`);
if (!lich) { log("RESULT: FAIL"); process.exit(1); }

const killedAt = Date.now();
const lichDead = await fight(ws, state, lich.id);
expect(lichDead, `Morvane killed (bot hp ${state.stats?.hp}, died=${state.died})`);
const bats = [...state.ents.values()].filter((e) => e.kind === "mob" && e.name === "Crypt Shrieker");
log(`     (bone bats seen in the fight: ${bats.length}; summon line: ${chatWith(state, "Rise and feast")})`);
expect(chatWith(state, "the far gate TEARS"), "collapse announced with the bible's line");
expect(state.portalStates.some((p) => p.target === "sundered_city" && p.open === true), "portalState {sundered_city, open:true} — the gate tore");

// ---- 5. RUN: through the far gate inside the collapse window ----
const ranUp = await goTo(ws, state, 66, 14.2, 1.2); // one row off the arch line, inside the trigger
expect(ranUp, `ran to the far gate (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
state.transfer = null;
let tEsc = null;
for (let attempt = 0; attempt < 3 && !tEsc; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "depths-escape" }));
  tEsc = await waitTransfer(state, 5000);
}
expect(!!tEsc, "the torn gate grants a transfer");
if (!tEsc) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tEsc.wsUrl, tEsc.ticket));
const escSec = (Date.now() - killedAt) / 1000;
expect(state.roomId === "sundered_city", `escaped into ${state.roomId} ${escSec.toFixed(0)}s after the kill`);
expect(
  Math.hypot(state.x - 210.5, state.z - 110.5) < 1.5,
  `landed at the collapsed postern (${state.x.toFixed(1)},${state.z.toFixed(1)} vs 210.5,110.5)`
);
expect(Math.abs(state.y - 13) < 1.5, `standing on the graveyard-quarter ground (y=${state.y.toFixed(1)})`);
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
expect(!state.portals.some((p) => Math.hypot(p.x - 210.5, p.z - 110.5) < 30), "no return portal at the postern (one-way by omission)");

// ---- 6. the vaults come down behind you ----
let depthsClosed = false;
for (let i = 0; i < 120 && !depthsClosed; i++) {
  await sleep(1000);
  try {
    const status = await api("/api/status");
    const room = (status.shards ?? []).flatMap((s) => s.rooms ?? []).find((r) => r.roomId === "crypt_depths");
    depthsClosed = !room || room.status !== "open";
  } catch {
    /* master briefly busy — keep polling */
  }
}
const tookSec = (Date.now() - killedAt) / 1000;
expect(depthsClosed, `crypt_depths collapsed behind the escape (${tookSec.toFixed(0)}s after the kill)`);

ws.close();
log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
