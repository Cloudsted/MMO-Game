/**
 * Equipment wire probe: equips armor over the wire and proves the plumbing
 * end to end — equipSlot round trips, the inv echo carries equipment, the
 * effects message ships gear modifiers + the capped speedMult, the movement
 * envelope accepts Swiftness-boosted steps (and still rejects cheats), armor
 * wears from real mob hits and mitigates them, and worn gear survives a
 * room transfer AND a full logout/login.
 *
 *   node scripts/make-admin.mjs equipbot   (once, after first register)
 *   node scripts/equip-bot.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";
import { loadEnv, makeWorldTracker, ROOT, sleep } from "./lib.mjs";

loadEnv();
const MODIFIERS = JSON.parse(readFileSync(resolve(ROOT, "shared", "modifiers.json"), "utf8").replace(/^﻿/, ""));
const CAPS = JSON.parse(readFileSync(resolve(ROOT, "shared", "constants.json"), "utf8").replace(/^﻿/, "")).items.mods.caps;
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

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

await api("/api/register", { username: "equipbot", password: "equip123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "equipbot", password: "equip123" });
if (!account.roles.includes("admin")) {
  console.log("[equipbot] not admin yet — run: node scripts/make-admin.mjs equipbot  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Equipbot" }, token)).character];
const charId = characters[0].id;

/** One connected session with message bookkeeping. */
function connect(grant) {
  return new Promise((resolveConn, reject) => {
    const ws = new WebSocket(grant.wsUrl);
    const s = {
      ws,
      me: { x: 0, y: 0, z: 0, seq: 1000 },
      slots: [],
      equipment: [],
      effects: [],
      lastEffects: null,
      corrects: 0,
      chats: [],
      dmgTaken: [], // non-crit amounts against self
      selfId: -1,
      roomId: "",
      terrain: null,
      tracker: makeWorldTracker(),
      send(msg) {
        ws.send(JSON.stringify(msg));
      },
      close() {
        ws.close();
      },
    };
    ws.on("open", () => s.send({ t: "hello", v: 1, ticket: grant.ticket }));
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      const sampler = s.tracker.handle(msg);
      if (sampler) s.terrain = sampler;
      if (msg.t === "welcome") {
        s.selfId = msg.selfId;
        s.roomId = msg.roomId;
        s.me.x = msg.spawn.x;
        s.me.y = msg.spawn.y;
        s.me.z = msg.spawn.z;
        resolveConn(s);
      } else if (msg.t === "inv") {
        s.slots = msg.slots;
        s.equipment = msg.equipment ?? [];
      } else if (msg.t === "effects") {
        s.effects.push(msg);
        s.lastEffects = msg;
      } else if (msg.t === "correct") {
        s.corrects++;
        s.me.x = msg.x;
        s.me.y = msg.y;
        s.me.z = msg.z;
      } else if (msg.t === "chat") {
        s.chats.push(msg.text);
      } else if (msg.t === "evt" && msg.e.kind === "dmg" && msg.e.tgt === s.selfId && !msg.e.crit) {
        s.dmgTaken.push(msg.e.amount);
      }
    });
  });
}

const findSlot = (s, item) => s.slots.findIndex((x) => x && x.item === item);
const chat = (s, text) => s.send({ t: "chat", text });

// ---- session 1: equip flow in the hub ----
let grant = await api("/api/enter", { characterId: charId }, token);
let s = await connect(grant);
console.log(`[equipbot] in ${s.roomId} at ${s.me.x.toFixed(1)},${s.me.z.toFixed(1)}`);

// rerun hygiene: strip anything a previous run left equipped
for (const slot of ["head", "chest", "legs", "feet", "offhand"]) s.send({ t: "equipSlot", slot });
await sleep(500);

chat(s, "/give iron_cuirass 1 rare");
chat(s, "/give iron_shield 1");
await sleep(700);
const bagCount = (item) => s.slots.filter((x) => x && x.item === item).length;
const cuirassIdx = findSlot(s, "iron_cuirass");
const shieldIdx = findSlot(s, "iron_shield");
const cuirassesBefore = bagCount("iron_cuirass");
ok(cuirassIdx >= 0 && shieldIdx >= 0, "/give landed armor in the bags");

s.send({ t: "equipSlot", slot: "chest", invIndex: cuirassIdx });
s.send({ t: "equipSlot", slot: "offhand", invIndex: shieldIdx });
await sleep(700);
ok(s.equipment[1]?.item === "iron_cuirass", "inv echo carries the worn cuirass (chest)");
ok(s.equipment[4]?.item === "iron_shield", "inv echo carries the worn shield (offhand)");
ok(bagCount("iron_cuirass") === cuirassesBefore - 1, "equipping vacated the inventory slot");
ok(s.equipment[1]?.dur > 0 && s.equipment[1]?.stats?.armor !== undefined, "worn armor carries rolls + durability");
ok(s.effects.length >= 1, "effects message arrived");

// weapons never fit the offhand
s.send({ t: "equipSlot", slot: "offhand", invIndex: 0 }); // rusty starter sword
await sleep(400);
ok(s.equipment[4]?.item === "iron_shield", "weapon refused in the offhand");

// Swiftness on the held weapon -> effects speedMult + a wider move envelope.
// Loot-given armor may carry its own rolled mods (a rare cuirass rolls 25%
// of the time), so the expectation sums the ACTUAL worn moveSpeedPct stat.
chat(s, "/enchant moveSpeedPct 0.2");
await sleep(700);
const speedStat = [...s.equipment, s.slots[0]]
  .filter(Boolean)
  .flatMap((x) => Object.entries(x.mods ?? {}))
  .filter(([id]) => MODIFIERS[id]?.stat === "moveSpeedPct")
  .reduce((sum, [, mag]) => sum + mag, 0);
const cap = CAPS.moveSpeedPct;
const expectedSpeed = 1 + Math.max(-cap, Math.min(cap, speedStat));
ok(
  Math.abs((s.lastEffects?.speedMult ?? 1) - Math.round(expectedSpeed * 1000) / 1000) < 0.002,
  `effects speedMult mirrors the worn moveSpeedPct sum (${s.lastEffects?.speedMult} vs ${expectedSpeed.toFixed(3)})`
);
ok((s.lastEffects?.list ?? []).some((e) => e.kind === "mod" && e.id === "moveSpeedPct"), "gear modifier listed in effects");

// envelope: base cap is 4.5*1.6+0.75 = 7.95 m/s-packet; boosted ~10.1.
// An 8.6 m step after a full second passes ONLY with the boost; 12 never.
const step = async (dx) => {
  const before = s.corrects;
  await sleep(1100);
  s.me.seq++;
  const ny = s.terrain ? s.terrain.heightAt(s.me.x + dx, s.me.z) : s.me.y;
  s.send({ t: "move", seq: s.me.seq, x: s.me.x + dx, y: ny, z: s.me.z, yaw: 0, anim: "move" });
  await sleep(500);
  const rejected = s.corrects > before;
  if (!rejected) s.me.x += dx;
  return rejected;
};
// a step just inside the boosted envelope (base cap would reject it),
// then one beyond even the +30% ceiling — the cap must hold against cheats
const boostedCap = 4.5 * expectedSpeed * 1.6 + 0.75;
const probeStep = Math.min(boostedCap - 0.7, 8.6);
ok(probeStep > 7.95, `boosted envelope leaves room above the base cap (${probeStep.toFixed(2)} m probe)`);
ok(!(await step(probeStep)), `${probeStep.toFixed(2)} m step accepted with Swiftness (boosted envelope)`);
ok(await step(12), "12 m step still rejected (cap holds against cheats)");

// ---- mob hits: armor wears + mitigates ----
chat(s, "/level 10");
chat(s, "/room forest");
await sleep(4000); // transfer grant + reconnect handled by a fresh socket
// /room transfers via the same machinery as portals: the server sends a
// `transfer` with a new wsUrl+ticket — reconnect there
// (the old socket got the message before this sleep; re-enter instead)
s.close();
grant = await api("/api/enter", { characterId: charId }, token);
s = await connect(grant);
ok(s.roomId === "forest", `transfer persisted the room (${s.roomId})`);
await sleep(700);
ok(s.equipment[1]?.item === "iron_cuirass", "equipment survived the transfer + relogin");

// stage the fight in open wilderness — leftover command-spawned slimes
// never despawn, and parking them at the arrival spawn ambushes every
// later bot (combat-bot died to exactly that once)
chat(s, "/tp 200 200");
await sleep(800);
const durBefore = s.equipment[1]?.dur ?? -1;
chat(s, "/spawnmob slime 3");
await sleep(500);
const armoredStart = s.dmgTaken.length;
let waited = 0;
while (s.dmgTaken.length - armoredStart < 10 && waited < 45000) {
  await sleep(500);
  waited += 500;
}
const armoredHits = s.dmgTaken.slice(armoredStart);
await sleep(300);
const durAfter = s.equipment[1]?.dur ?? -1;
ok(durAfter < durBefore, `armor wore from hits taken (${durBefore} -> ${durAfter})`);

s.send({ t: "equipSlot", slot: "chest" }); // unequip both mid-fight
s.send({ t: "equipSlot", slot: "offhand" });
await sleep(500);
const bareStart = s.dmgTaken.length;
waited = 0;
while (s.dmgTaken.length - bareStart < 10 && waited < 45000) {
  await sleep(500);
  waited += 500;
}
const bareHits = s.dmgTaken.slice(bareStart);
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
console.log(`[equipbot] armored avg ${avg(armoredHits).toFixed(2)} over ${armoredHits.length}, bare avg ${avg(bareHits).toFixed(2)} over ${bareHits.length}`);
ok(armoredHits.length >= 8 && bareHits.length >= 8, "collected enough hits for the comparison");
ok(avg(armoredHits) < avg(bareHits), "armored hits landed softer than bare ones (mitigation live)");

chat(s, "/room hub");
await sleep(2500);
s.close();

console.log(failures === 0 ? "\n[equipbot] ALL PASS" : `\n[equipbot] ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
