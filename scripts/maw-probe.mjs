/**
 * Live probe for THE MAW (world-redesign batch 2) — the crater-arena cycle:
 *   1. /room desert, /tp to the dunes east of the Wellhead Crater, then BFS
 *      DOWN the rim notch + stair lane to the portal at the salt pan (the
 *      only walkable way in/out — terrace risers are 2-block drops).
 *   2. the desert-maw portal is authored always-open; usePortal → the Maw.
 *   3. Sarquun, the Undertide is present in the arena (the room's only mob).
 *   4. gear up (/level 30, epic rift_greataxe, potions) and kill it:
 *      - the surfacing announce fires ("standing on its lip")
 *      - death announces the collapse ("drinks it back down") and re-arms
 *        the room timer to 60s → T-10 warning + evict within ~90s
 *   5. re-enter via the master → eviction persists players HUB-bound (the
 *      shipped collapse behavior, same as crypt_depths/sundered_city).
 *   6. /room desert → the desert-maw portal reads closed WITH a reopenInSec
 *      countdown (the feeding schedule); usePortal is denied.
 *   7. after the downtime the Maw reopens fresh: portalState open=true,
 *      portal down again, Sarquun alive at full.
 *
 * Step 7 waits out the REAL downtime (600s) unless the stack was started
 * with MMO_DOWNTIME_OVERRIDE_SEC=20 (recommended: restart the stack with it
 * before running). Needs admin: node scripts/make-admin.mjs maw_probe
 * Exits 0 on success, 1 on any failed expectation, 2 if not admin.
 *
 *   node scripts/maw-probe.mjs
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

const log = (...a) => console.log("[maw]", ...a);
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
      pillarCasts: 0, gouts: 0,
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
        case "pillars": state.pillarCasts++; break;
        case "proj": if ((msg.scale ?? 1) > 1.5) state.gouts++; break;
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

const chatWith = (state, needle) => state.chats.some((c) => c.text?.includes(needle));
const findMob = (state, mobName) =>
  [...state.ents.values()].find((e) => e.kind === "mob" && e.name === mobName && e.act !== "dead");

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

/** Face-tank a boss, potioning under 350 hp; true on its death event. */
async function fight(ws, state, bossId, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  const dead = () => state.events.some((ev) => ev.kind === "death" && ev.id === bossId);
  let last = { x: null, z: null };
  while (Date.now() < deadline && !state.died) {
    if (dead()) return true;
    if (state.stats && state.stats.hp < 350) {
      const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
      if (pot >= 0) ws.send(JSON.stringify({ t: "consume", slot: pot }));
    }
    const boss = state.ents.get(bossId);
    if (!boss) {
      // out of interest: walk toward the last-known spot to re-acquire
      if (last.x !== null) await goTo(ws, state, last.x, last.z, 2.0);
      await sleep(300);
      continue;
    }
    last = { x: boss.x, z: boss.z };
    const dx = boss.x - state.x;
    const dz = boss.z - state.z;
    if (Math.hypot(dx, dz) > 2.8) {
      await goTo(ws, state, boss.x, boss.z, 2.2);
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
await api("/api/register", { username: "maw_probe", password: "maw123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "maw_probe", password: "maw123" });
if (!account.roles.includes("admin")) {
  console.error("[maw] maw_probe is not admin — run: node scripts/make-admin.mjs maw_probe  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Mawprobe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);

// ---- 1. desert: /tp to the dunes, walk DOWN the crater stair to the portal ----
({ ws, state } = await gotoRoom(ws, state, "desert"));
ws.send(JSON.stringify({ t: "chat", text: "/tp 128 384" }));
await sleep(600); // wait for the correct to land
expect(Math.hypot(state.x - 128, state.z - 384) < 2, `teleported to the dunes east of the crater (${state.x.toFixed(1)},${state.z.toFixed(1)})`);
// target the cell BESIDE the arch line: the lintel over x=96 reads as a wall
// to the bots' top-solid height sampler (they can't path under arches)
const descended = await goTo(ws, state, 97.5, 384.5, 0.7);
expect(descended, `walked down the rim notch + stair lane to the pan (${state.x.toFixed(1)},${state.z.toFixed(1)}, y=${state.y.toFixed(1)})`);
expect(state.y <= 7, `standing on the salt pan, 7+ blocks below the dunes (y=${state.y.toFixed(1)})`);

for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const downPortal = state.portals.find((p) => p.id === "desert-maw");
expect(!!downPortal && downPortal.open === true, `desert-maw portal authored open (open=${downPortal?.open})`);

// ---- 2. portal down into the Maw ----
state.transfer = null;
ws.send(JSON.stringify({ t: "usePortal", portalId: "desert-maw" }));
const tMaw = await waitTransfer(state);
expect(!!tMaw, "crater portal grants a transfer to the Maw");
if (!tMaw) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(tMaw.wsUrl, tMaw.ticket));
expect(state.roomId === "maw", `arrived in ${state.roomId}`);
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
expect(state.portals.some((p) => p.id === "maw-desert" && p.open), "return portal to the crater is open");

// ---- 3. the pit tyrant is home ----
await sleep(500);
const boss = findMob(state, "Sarquun, the Undertide");
expect(!!boss, `Sarquun found at ${boss ? `${boss.x.toFixed(0)},${boss.z.toFixed(0)}` : "?"}`);
if (!boss) { log("RESULT: FAIL"); process.exit(1); }

// ---- 4. kill it: surfacing announce, death announce, 60s collapse ----
await gearUp(ws, state);
const killedAt = Date.now();
const bossDead = await fight(ws, state, boss.id);
expect(bossDead, `Sarquun killed (bot hp ${state.stats?.hp}, died=${state.died})`);
log(`     (big-bolt gouts seen: ${state.gouts}; geyser casts seen: ${state.pillarCasts})`);
expect(chatWith(state, "standing on its lip"), "surfacing announce fired (\"standing on its lip\")");
expect(chatWith(state, "drinks it back down"), "death announce fired (\"drinks it back down\")");

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

// ---- 5. re-enter: eviction persists players hub-bound (shipped behavior) ----
// wait for the maw to actually CLOSE first — re-entering in the ~1s window
// between the evict and the RoomHost exit lands back in the dying room
let mawClosed = false;
for (let i = 0; i < 60 && !mawClosed; i++) {
  const status = await api("/api/status");
  const room = (status.shards ?? []).flatMap((s) => s.rooms ?? []).find((r) => r.roomId === "maw");
  mawClosed = !room || room.status !== "open";
  if (!mawClosed) await sleep(500);
}
expect(mawClosed, "master reports the maw closed after the collapse");
const grant2 = await api("/api/enter", { characterId: characters[0].id }, token);
({ ws, state } = await enterRoom(grant2.wsUrl, grant2.ticket));
expect(state.roomId === "hub", `re-entered after eviction in ${state.roomId} (collapse evicts hub-bound)`);

// ---- 6. the feeding schedule: desert portal closed with a countdown ----
({ ws, state } = await gotoRoom(ws, state, "desert"));
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
let closed = state.portals.find((p) => p.id === "desert-maw");
// the closed state may arrive as a portalState update after the join snapshot
for (let i = 0; i < 50 && closed?.open !== false; i++) {
  await sleep(100);
  const upd = [...state.portalStates].reverse().find((p) => p.target === "maw");
  if (upd) closed = { ...closed, open: upd.open, reopenInSec: upd.reopenInSec ?? closed?.reopenInSec };
}
expect(closed?.open === false, `desert-maw portal reads closed during downtime (open=${closed?.open})`);
expect((closed?.reopenInSec ?? 0) > 0, `countdown rides the wire (reopenInSec=${closed?.reopenInSec})`);

// NOTE: /tp to the OPEN pan, not the pan edge — (96,378) is a cell corner
// whose player AABB overlaps the first terrace riser and embeds the bot
ws.send(JSON.stringify({ t: "chat", text: "/tp 96 380" }));
await sleep(600);
ws.send(JSON.stringify({ t: "usePortal", portalId: "desert-maw" }));
for (let i = 0; i < 30 && !chatWith(state, "sealed right now"); i++) await sleep(100);
expect(chatWith(state, "sealed right now"), "closed portal denied (\"sealed right now\")");

// ---- 7. the Maw reopens fresh after the downtime ----
const reopenWait = (closed?.reopenInSec ?? 600) + 30;
log(`waiting up to ${reopenWait}s for the Maw to reopen (MMO_DOWNTIME_OVERRIDE_SEC shortens this)...`);
let reopened = false;
for (let i = 0; i < reopenWait * 10 && !reopened; i++) {
  reopened = state.portalStates.some((p) => p.target === "maw" && p.open === true);
  await sleep(100);
}
expect(reopened, "portalState {maw, open:true} replicated after downtime");
if (reopened) {
  const walked = await goTo(ws, state, 97.5, 384.5, 0.7); // beside the arch; within r+1.0
  log(`     (walked=${walked}; standing at ${state.x.toFixed(1)},${state.z.toFixed(1)}, ${Math.hypot(state.x - 96, state.z - 384).toFixed(1)}m from the portal)`);
  let tFresh = null;
  for (let attempt = 0; attempt < 3 && !tFresh; attempt++) {
    state.transfer = null;
    ws.send(JSON.stringify({ t: "usePortal", portalId: "desert-maw" }));
    tFresh = await waitTransfer(state, 5000);
  }
  expect(!!tFresh, "reopened portal grants a transfer");
  if (tFresh) {
    ws.close();
    ({ ws, state } = await enterRoom(tFresh.wsUrl, tFresh.ticket));
    expect(state.roomId === "maw", `arrived in fresh ${state.roomId}`);
    await sleep(700);
    const fresh = findMob(state, "Sarquun, the Undertide");
    expect(!!fresh, "Sarquun surfaced again in the fresh room (the cycle holds)");
  }
}

ws.close();
log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
