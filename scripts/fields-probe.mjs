/**
 * Live probe for THE SUNDERING FIELDS (world-redesign batch 7) — the L11-13
 * splice between the Gloomfen and the Fallen Capital:
 *   1. /room gloomfen, /tp to the Old North Road gate: usePortal
 *      gloomfen-fields-north → the fields, arriving at the TWIN GATE
 *      (beside fields-gloomfen-road, not room spawn).
 *   2. walk the BENDING tribute road south gate → city gate (12 waypoints
 *      following the authored bends around the drowned mere and through the
 *      two trench-crescent duckboard gaps; the direct ray is under the murk
 *      and in the ditches). L11-13 chip along the road — /level 30 + potions.
 *   3. usePortal fields-city → Valdrenn, arriving at the SOUTH GATE
 *      (128,222.8 — the paired-arrival spot the city has always used).
 *   4. the ☆ west leg: /room gloomfen, the Drowned West Road
 *      (gloomfen-fields-west) → the fields' hidden west gate (40,236) —
 *      an off-road exploration find; no road leads to it.
 *   5. sanity: Old Wallbreaker alive at the war-sledge (L14, boss_giant
 *      sprite) and the Barrow Alpha alive at her mound (L13); the
 *      fields-foundry gate replicates open.
 *   6. returnToHub.
 *
 * Needs admin: node scripts/make-admin.mjs fields_probe   (then rerun)
 * Exits 0 on success, 1 on any failed expectation, 2 if not admin.
 *
 *   node scripts/fields-probe.mjs
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

const log = (...a) => console.log("[fields]", ...a);
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

/** Waypoint walk with a potion guard — the fields are a live L11-13 room. */
async function walkRoad(ws, state, points) {
  for (const [wx, wz] of points) {
    if (state.stats && state.stats.hp < 450) {
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
await api("/api/register", { username: "fields_probe", password: "fields123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "fields_probe", password: "fields123" });
if (!account.roles.includes("admin")) {
  console.error("[fields] fields_probe is not admin — run: node scripts/make-admin.mjs fields_probe  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Fieldsprobe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
log(`entered ${state.roomId} at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);
ws.send(JSON.stringify({ t: "chat", text: "/level 30" }));
ws.send(JSON.stringify({ t: "chat", text: "/give greater_health_potion 10" }));

// ---- 1. gloomfen north road → twin-gate arrival in the fields ----
({ ws, state } = await gotoRoom(ws, state, "gloomfen"));
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
const northGate = state.portals.find((p) => p.id === "gloomfen-fields-north");
expect(!!northGate && northGate.target === "sundering_fields", "gloomfen's Old North Road targets the fields now");
expect(!!northGate && northGate.open === true, "the fields edge is always open (a thoroughfare, no gating)");
await tp(ws, state, 160, 35);
await goTo(ws, state, 160, 31.8, 1.2);
state.transfer = null;
let t1 = null;
for (let attempt = 0; attempt < 3 && !t1; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "gloomfen-fields-north" }));
  t1 = await waitTransfer(state, 5000);
}
expect(!!t1, "gloomfen-fields-north grants a transfer");
if (!t1) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(t1.wsUrl, t1.ticket));
expect(state.roomId === "sundering_fields", `arrived in ${state.roomId}`);
const dGate = Math.hypot(state.x - 144, state.z - 262);
expect(dGate < 6, `twin-gate arrival beside fields-gloomfen-road (${state.x.toFixed(1)},${state.z.toFixed(1)}, ${dGate.toFixed(1)}m)`);
for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
expect(state.portals.some((p) => p.id === "fields-foundry" && p.target === "foundry" && p.open), "the fields-foundry junction gate replicates open");

// ---- 2. walk the BENDING tribute road to the city gate ----
const ROAD = [
  [138, 244],
  [122, 228],
  [110, 210],
  [108, 196],
  [116, 172],
  [126, 148],
  [126, 128], // trench A duckboard gap
  [132, 108],
  [140, 92], // trench B duckboard gap
  [144, 76],
  [144, 44],
  [144, 29],
];
const walked = await walkRoad(ws, state, ROAD);
expect(walked, `walked the bending trench route to the city gate (${state.x.toFixed(1)},${state.z.toFixed(1)}; ${state.corrections} corrections)`);

// ---- 3. the city gate → Valdrenn's south gate ----
await goTo(ws, state, 144, 27.4, 0.9); // one row off the arch line, inside the 2.2 m trigger
state.transfer = null;
let t2 = null;
for (let attempt = 0; attempt < 3 && !t2; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "fields-city" }));
  t2 = await waitTransfer(state, 5000);
}
expect(!!t2, "fields-city grants a transfer");
if (!t2) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(t2.wsUrl, t2.ticket));
expect(state.roomId === "sundered_city", `arrived in ${state.roomId}`);
expect(
  Math.hypot(state.x - 128, state.z - 222.8) < 3,
  `paired arrival at Valdrenn's SOUTH GATE (${state.x.toFixed(1)},${state.z.toFixed(1)} vs 128,222.8)`
);

// ---- 4. the ☆ west leg: the Drowned West Road is an off-road find ----
({ ws, state } = await gotoRoom(ws, state, "gloomfen"));
await tp(ws, state, 52, 96);
await goTo(ws, state, 52, 93.8, 1.2);
state.transfer = null;
let t3 = null;
for (let attempt = 0; attempt < 3 && !t3; attempt++) {
  ws.send(JSON.stringify({ t: "usePortal", portalId: "gloomfen-fields-west" }));
  t3 = await waitTransfer(state, 5000);
}
expect(!!t3, "gloomfen-fields-west grants a transfer");
if (!t3) { log("RESULT: FAIL"); process.exit(1); }
ws.close();
({ ws, state } = await enterRoom(t3.wsUrl, t3.ticket));
expect(state.roomId === "sundering_fields", `west road lands in ${state.roomId}`);
const dWest = Math.hypot(state.x - 40, state.z - 236);
expect(dWest < 6, `twin-gate arrival beside the hidden west gate (${state.x.toFixed(1)},${state.z.toFixed(1)}, ${dWest.toFixed(1)}m)`);

// ---- 5. the bosses hold their ground ----
await tp(ws, state, 108, 202); // the road's arena-side bend — the beast is west of it
await sleep(1500);
const beast = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "Old Wallbreaker" && e.act !== "dead");
expect(!!beast, `Old Wallbreaker is alive at the sledge ${beast ? `(${beast.x.toFixed(0)},${beast.z.toFixed(0)}, L${beast.level}, hp ${beast.hp}/${beast.maxHp})` : ""}`);
if (beast) {
  expect(beast.level === 14, `the beast is L14 (band-top+1), got L${beast.level}`);
  expect(beast.maxHp === 1083, `boss-trend hp 1083, got ${beast.maxHp}`);
  expect(Math.hypot(beast.x - 92, beast.z - 190) < 16, `it holds the furrow's end (${Math.hypot(beast.x - 92, beast.z - 190).toFixed(1)}m out)`);
}
await tp(ws, state, 224, 216); // the barrow's south skirt (the den mouth faces west)
await sleep(1500);
const alpha = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "The Barrow Alpha" && e.act !== "dead");
expect(!!alpha, `the Barrow Alpha dens in her mound ${alpha ? `(${alpha.x.toFixed(0)},${alpha.z.toFixed(0)}, L${alpha.level})` : ""}`);
if (alpha) expect(alpha.level === 13, `the Alpha is L13, got L${alpha.level}`);
const hound = [...state.ents.values()].find((e) => e.kind === "mob" && e.name === "Gravehound" && e.act !== "dead");
expect(!!hound && hound.level === 13, `her packs ring the barrow at L13 ${hound ? `(saw L${hound.level})` : "(none in interest)"}`);

// ---- 6. home ----
state.transfer = null;
ws.send(JSON.stringify({ t: "returnToHub" }));
const t4 = await waitTransfer(state);
expect(!!t4, "returnToHub grants a transfer");
if (t4) {
  ws.close();
  ({ ws, state } = await enterRoom(t4.wsUrl, t4.ticket));
  expect(state.roomId === "hub", `home in ${state.roomId}`);
}

ws.close();
log(failed ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(failed ? 1 : 0);
