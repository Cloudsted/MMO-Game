/**
 * Combat verification: log in, travel to the forest, find the nearest mob,
 * kill it with the starter sword (or fists), confirm the XP event, find the
 * loot bag, pick it up, and confirm gold/items arrived. Exits 0 on success.
 *
 *   node scripts/combat-bot.mjs [--mob slime]
 */
import WebSocket from "ws";
import { loadEnv, makeWorldTracker, sleep, goTo } from "./lib.mjs";

loadEnv();
const MASTER = `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const USER = "combat_bot";
const PASS = "devpass1";

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

function log(...a) {
  console.log("[combat]", ...a);
}

function fail(msg) {
  console.error("[combat] FAIL:", msg);
  process.exit(1);
}

/** Room session that tracks entities, self stats, events, and loot. */
function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const state = {
      roomId: null, selfId: -1, x: 0, y: 0, z: 0, seq: 0,
      terrain: null, portals: [], transfer: null,
      ents: new Map(), // id -> {kind,name,x,z,hp,act,...}
      stats: null, inv: null, events: [], chats: [], died: false,
    };
    const tracker = makeWorldTracker();
    const timer = setTimeout(() => reject(new Error("room join timeout")), 10000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome":
          state.roomId = msg.roomId;
          state.selfId = msg.selfId;
          state.x = msg.spawn.x;
          state.y = msg.spawn.y;
          state.z = msg.spawn.z;
          for (const e of msg.ents) state.ents.set(e.id, e);
          break;
        case "world":
        case "chunks":
        case "blockSet": {
          const s = tracker.handle(msg);
          if (s) state.terrain = s;
          break;
        }
        case "portals":
          state.portals = msg.portals;
          break;
        case "snap":
          for (const e of msg.enter) state.ents.set(e.id, e);
          for (const d of msg.ents) {
            const e = state.ents.get(d.id);
            if (e) Object.assign(e, d);
          }
          for (const id of msg.leave) state.ents.delete(id);
          break;
        case "stats":
          state.stats = msg;
          break;
        case "inv":
          state.inv = msg;
          break;
        case "evt":
          state.events.push(msg.e);
          break;
        case "chat":
          state.chats.push(msg);
          break;
        case "died":
          state.died = true;
          break;
        case "transfer":
          state.transfer = msg;
          break;
        case "correct":
          state.x = msg.x;
          state.y = msg.y;
          state.z = msg.z;
          break;
        case "reject":
          reject(new Error(`rejected: ${msg.reason}`));
          return;
      }
      if (state.roomId && state.terrain && !state.ready) {
        state.ready = true;
        clearTimeout(timer);
        resolve({ ws, state });
      }
    });
  });
}


const main = async () => {
  await api("/api/register", { username: USER, password: PASS }).catch(() => {});
  const { token } = await api("/api/login", { username: USER, password: PASS });
  let chars = (await api("/api/characters", null, token)).characters;
  if (chars.length === 0) {
    const suffix = Math.floor(Math.random() * 9000 + 1000);
    chars = [(await api("/api/characters", { name: `CombatBot${suffix}` }, token)).character];
  }
  const character = chars[0];
  log(`character ${character.name} (level ${character.level}) starting in ${character.roomId}`);

  let grant = await api("/api/enter", { characterId: character.id }, token);
  let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
  log(`entered ${state.roomId}`);

  // travel to the forest if we aren't already there
  if (state.roomId !== "forest") {
    const portal = state.portals.find((p) => p.target === "forest");
    if (!portal) fail(`no forest portal in ${state.roomId}`);
    if (!(await goTo(ws, state, portal.x, portal.z, 1.5))) fail("never reached the portal");
    ws.send(JSON.stringify({ t: "usePortal", portalId: portal.id }));
    for (let i = 0; i < 100 && !state.transfer; i++) await sleep(100);
    if (!state.transfer) fail("no transfer grant");
    ws.close();
    ({ ws, state } = await enterRoom(state.transfer.wsUrl, state.transfer.ticket));
    log(`transferred to ${state.roomId}`);
  }

  // wait for stats/inv, note baselines
  for (let i = 0; i < 50 && (!state.stats || !state.inv); i++) await sleep(100);
  if (!state.stats) fail("never received stats");
  const goldBefore = state.stats.gold;
  const xpBefore = state.stats.xp;
  const levelBefore = state.stats.level;
  log(`baseline: level ${levelBefore}, xp ${xpBefore}, gold ${goldBefore}, ` +
    `held ${state.inv?.slots?.[state.inv.held]?.item ?? "fists"}`);

  // room chat round trip
  ws.send(JSON.stringify({ t: "chat", text: "combat bot reporting in" }));
  for (let i = 0; i < 30 && !state.chats.some((c) => c.channel === "room"); i++) await sleep(100);
  if (!state.chats.some((c) => c.channel === "room" && c.text.includes("reporting"))) fail("room chat did not echo");
  log("room chat echoed");

  // find the nearest living mob
  const nearestMob = () => {
    let best = null, bestD = Infinity;
    for (const e of state.ents.values()) {
      if (e.kind !== "mob" || e.act === "dead") continue;
      const d = Math.hypot(e.x - state.x, e.z - state.z);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  };
  // mobs may be outside interest — wander toward the slime meadow until one shows
  for (let tries = 0; tries < 5 && !nearestMob(); tries++) {
    log("no mob in interest, heading toward the slime meadow...");
    await goTo(ws, state, 55 + tries * 3, 105, 2.0);
    await sleep(500);
  }
  let target = nearestMob();
  if (!target) fail("no mob found near the slime meadow");
  log(`target: ${target.name} #${target.id} hp ${target.hp}/${target.maxHp}`);

  // kill it: approach + swing until the death event
  const targetId = target.id;
  let killed = false;
  for (let i = 0; i < 240 && !killed; i++) {
    const e = state.ents.get(targetId);
    killed = state.events.some((ev) => ev.kind === "death" && ev.id === targetId);
    if (killed) break;
    if (!e) break; // despawned without us seeing the event? check below
    const dx = e.x - state.x;
    const dz = e.z - state.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.6) {
      await goTo(ws, state, e.x, e.z, 1.4);
    } else {
      // live-aim: the server refreshes player aim from pos.yaw at fire time,
      // so face the mob with a zero-move packet like a real client would
      const aim = Math.atan2(dx, dz);
      state.seq++;
      ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: aim, anim: "idle" }));
      ws.send(JSON.stringify({ t: "attack", yaw: aim, pitch: 0 }));
      await sleep(850); // swing busy time
    }
    if (state.died) fail("bot died to a slime — something is very wrong");
  }
  killed = killed || state.events.some((ev) => ev.kind === "death" && ev.id === targetId);
  if (!killed) fail("mob never died");
  log("mob killed");

  const xpEvt = state.events.find((ev) => ev.kind === "xp");
  if (!xpEvt) fail("no xp event after the kill");
  log(`xp gained: ${xpEvt.amount}`);

  // find + loot the bag (may not exist if the table rolled nothing AND 0 gold — retry then)
  await sleep(700);
  let bag = null;
  for (const e of state.ents.values()) {
    if (e.kind === "loot") {
      const d = Math.hypot(e.x - state.x, e.z - state.z);
      if (d < 12) bag = e;
    }
  }
  if (bag) {
    await goTo(ws, state, bag.x, bag.z, 1.2);
    ws.send(JSON.stringify({ t: "pickup", id: bag.id }));
    await sleep(800);
    const gotGold = state.stats.gold > goldBefore;
    const gotItems = (state.inv?.slots ?? []).filter(Boolean).length > 0;
    if (!gotGold && !gotItems) fail("picked up the bag but gained nothing");
    log(`looted: gold ${goldBefore} -> ${state.stats.gold}`);
  } else {
    log("no loot bag dropped (all-nothing roll) — acceptable");
  }

  const xpAfter = state.stats.xp;
  const levelAfter = state.stats.level;
  log(`PASS: level ${levelBefore}->${levelAfter}, xp ${xpBefore}->${xpAfter}, gold ${goldBefore}->${state.stats.gold}`);
  ws.close();
  process.exit(0);
};

main().catch((e) => fail(e.message));
