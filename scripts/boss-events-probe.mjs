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
 *      - death announces the collapse ("crumble") and re-arms the room
 *        timer to 60s -> expect the T-10 warning chat and the evict within
 *        ~75s of the kill
 * Needs the `dropbot` account to be admin (node scripts/make-admin.mjs dropbot).
 * Exits 0 on success, 1 on any failed expectation.
 *
 *   node scripts/boss-events-probe.mjs
 */
import WebSocket from "ws";
import { loadEnv, makeWorldTracker, sleep, goTo } from "./lib.mjs";

loadEnv();
const MASTER = `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;

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
const mino = findMob(state, "Gravelord Minotaur");
expect(!!mino, `Gravelord found at ${mino ? `${mino.x.toFixed(0)},${mino.z.toFixed(0)}` : "?"}`);
if (!mino) { log("RESULT: FAIL"); process.exit(1); }

const skeletonsNearBoss = () =>
  [...state.ents.values()].filter(
    (e) => e.kind === "mob" && e.name === "Skeleton" && e.act !== "dead" && Math.hypot(e.x - mino.x, e.z - mino.z) < 9
  ).length;
const skeletonsBefore = skeletonsNearBoss();

const minoDead = await fight(ws, state, mino.id);
expect(minoDead, `Gravelord killed (bot hp ${state.stats?.hp}, died=${state.died})`);
expect(chatWith(state, "bellows"), "half-health rally announced (\"bellows\")");
expect(skeletonsNearBoss() > skeletonsBefore, `rally adds appeared near the boss (${skeletonsBefore} -> ${skeletonsNearBoss()})`);
expect(chatWith(state, "grinds open"), "gate-opening announced (\"grinds open\")");
const opened = state.portalStates.find((p) => p.target === "crypt_depths" && p.open === true);
expect(!!opened, "portalState {crypt_depths, open:true} replicated");

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
expect(state.roomId === "crypt_depths", `arrived in ${state.roomId}`);

// ---- 4. kill Morvane: summons mid-fight, collapse re-armed to 60s ----
await gearUp(ws, state); // fresh potions for the harder fight
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
expect(chatWith(state, "crumble"), "collapse announced (\"crumble\")");

// the timer was re-armed to 60s: expect the T-10 warning, then the evict
let sawEvict = false;
for (let i = 0; i < 900 && !sawEvict; i++) {
  sawEvict = state.evicted !== null;
  await sleep(100);
}
const tookSec = (Date.now() - killedAt) / 1000;
expect(chatWith(state, "collapses in 10 seconds"), "T-10 collapse warning fired");
expect(sawEvict, `evicted by the collapse (${state.evicted}) ${tookSec.toFixed(0)}s after the kill`);
expect(tookSec < 90, `collapse landed within 90s of the kill (${tookSec.toFixed(0)}s)`);

ws.close();
log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
