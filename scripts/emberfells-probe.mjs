/**
 * Live probe for THE EMBERFELLS (world-redesign batch 5) — the L8-10 splice
 * between the Sunscour and the Cinderrift:
 *   1. hub → /room desert, /tp to the north gate: usePortal desert-emberfells
 *      → the fells, arriving at the TWIN GATE (beside emberfells-desert, not
 *      room spawn).
 *   2. walk the BENDING haul-road south gate → rift gate (waypoints follow
 *      the authored bends: up the basin's east shoulder, the long west
 *      crossing behind it, then north past the Kiln's spur — the direct ray
 *      crosses the lava basin). Husks/raptors/trolls along the road are
 *      L8-10; the probe is /level 30 and drinks through chip.
 *   3. usePortal emberfells-cinderrift → the Cinderrift, arriving at ITS
 *      twin gate (cinderrift-emberfells, the old desert gate spot, 144,278).
 *   4. returnToHub (H-key wire path) → hub.
 *   5. sanity: the Old Kiln is alive at its adit (L11, slagback sprite) and
 *      the slag-bench trolls resolve at L10 (the rebased base).
 *
 * Needs admin: node scripts/make-admin.mjs fells_probe   (then rerun)
 * Exits 0 on success, 1 on any failed expectation, 2 if not admin.
 *
 *   node scripts/emberfells-probe.mjs
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

const log = (...a) => console.log("[fells]", ...a);
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

/** Waypoint walk with a potion guard — the fells are a live L8-10 room and
 *  the haul-road passes its husk gangs; a probe that never drinks bleeds out. */
async function walkRoad(ws, state, points) {
  for (const [wx, wz] of points) {
    if (state.stats && state.stats.hp < 400) {
      const pot = (state.inv?.slots ?? []).findIndex((s) => s && s.item === "greater_health_potion");
      if (pot < 0) ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));
      else ws.send(JSON.stringify({ t: "consume", slot: pot }));
      await sleep(900);
    }
    const ok = await goTo(ws, state, wx, wz, 1.6);
    if (!ok) {
      log(`     (stalled at ${state.x.toFixed(1)},${state.z.toFixed(1)} heading for ${wx},${wz})`);
      return false;
    }
  }
  return true;
}

// ---- login as the admin probe bot ----
await api("/api/register", { username: "fells_probe", password: "fells123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "fells_probe", password: "fells123" });
if (!account.roles.includes("admin")) {
  console.error("[fells] fells_probe is not admin — run: node scripts/make-admin.mjs fells_probe  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Fellsprobe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);
ws.send(JSON.stringify({ t: "chat", text: "/level 30" }));
ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));

// ---- 1. hub → desert → the fells, twin-gate arrival ----
({ ws, state } = await gotoRoom(ws, state, "desert"));
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const northGate = state.portals.find((p) => p.id === "desert-emberfells");
expect(!!northGate && northGate.target === "emberfells", "desert north gate targets the fells");
expect(!!northGate && northGate.open === true, "the fells gate is always open (a thoroughfare, no gating)");
await tp(ws, state, 144, 37);
await goTo(ws, state, 144, 33.5, 1.2);
state.transfer = null;
ws.send(JSON.stringify({ t: "usePortal", portalId: "desert-emberfells" }));
const t1 = await waitTransfer(state);
expect(!!t1, "desert-emberfells grants a transfer");
if (!t1) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(t1.wsUrl, t1.ticket));
expect(state.roomId === "emberfells", `arrived in ${state.roomId}`);
const dGate = Math.hypot(state.x - 200, state.z - 262);
expect(dGate < 6, `twin-gate arrival beside emberfells-desert (${state.x.toFixed(1)},${state.z.toFixed(1)}, ${dGate.toFixed(1)}m from the gate)`);

// ---- 2. walk the bending haul-road (the direct ray crosses the lava basin) ----
const ROAD = [
  [204, 224],
  [214, 192],
  [220, 152],
  [186, 149],
  [150, 149],
  [100, 148],
  [96, 110],
  [80, 64],
  [72, 34],
];
const walked = await walkRoad(ws, state, ROAD);
expect(walked, `walked the bending haul-road to the rift gate (${state.x.toFixed(1)},${state.z.toFixed(1)}; ${state.corrections} corrections)`);

// ---- 3. the rift gate → cinderrift twin-gate arrival ----
await goTo(ws, state, 72, 29.4, 0.9); // one row off the arch line, INSIDE r=2.2
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
expect(state.portals.some((p) => p.id === "emberfells-cinderrift" && p.open), "emberfells-cinderrift is open");
state.transfer = null;
let t2 = null;
for (let attempt = 0; attempt < 3 && !t2; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "emberfells-cinderrift" }));
  t2 = await waitTransfer(state, 5000);
}
expect(!!t2, "emberfells-cinderrift grants a transfer");
if (!t2) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(t2.wsUrl, t2.ticket));
expect(state.roomId === "cinderrift", `arrived in ${state.roomId}`);
const dRift = Math.hypot(state.x - 144, state.z - 278);
expect(dRift < 6, `twin-gate arrival beside cinderrift-emberfells (${state.x.toFixed(1)},${state.z.toFixed(1)}, ${dRift.toFixed(1)}m from the gate)`);
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
expect(state.portals.some((p) => p.id === "cinderrift-emberfells" && p.target === "emberfells"), "the rift's south gate targets the fells back");

// ---- 4. returnToHub (the H-key wire path) ----
state.transfer = null;
ws.send(JSON.stringify({ t: "returnToHub" }));
const t3 = await waitTransfer(state);
expect(!!t3, "returnToHub grants a transfer");
if (!t3) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(t3.wsUrl, t3.ticket));
expect(state.roomId === "hub", `home in ${state.roomId}`);

// ---- 5. the Old Kiln holds its adit ----
({ ws, state } = await gotoRoom(ws, state, "emberfells"));
await tp(ws, state, 126, 104);
await sleep(1200);
const kiln = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "The Old Kiln" && e.act !== "dead");
expect(!!kiln, `the Old Kiln is alive at its adit ${kiln ? `(${kiln.x.toFixed(0)},${kiln.z.toFixed(0)}, L${kiln.level}, hp ${kiln.hp}/${kiln.maxHp})` : ""}`);
if (kiln) {
  expect(kiln.level === 11, `the Kiln is L11 (band-top+1), got L${kiln.level}`);
  expect(kiln.sprite === "slagback_troll", `the eldest ore-eater wears the slagback sprite (${kiln.sprite})`);
  expect(Math.hypot(kiln.x - 118, kiln.z - 95) < 12, `it holds the trough (${Math.hypot(kiln.x - 118, kiln.z - 95).toFixed(1)}m from the mouth)`);
}
const troll = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "Slagback Troll" && e.act !== "dead");
log(`     (slag-bench troll in interest: ${troll ? `L${troll.level}` : "none — benches are 50m east"})`);

ws.close();
log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
