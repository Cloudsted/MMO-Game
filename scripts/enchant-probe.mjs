/**
 * Enchanter wire probe (weaving era — batch 9 modernized it to the DEEP
 * MAGIC WEAVING rules): walks to Selvara in the hub, checks her 12-offer
 * tiered menu rides the dialog, weaves Regeneration I for the authoritative
 * tiered price, proves the capacity refusal (an iron sword is T2 = ONE
 * enchant slot), and confirms enchanted items sell for more than plain ones.
 *
 *   node scripts/make-admin.mjs enchbot   (once, after first register)
 *   node scripts/enchant-probe.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";
import { goTo, loadEnv, makeWorldTracker, ROOT, sleep } from "./lib.mjs";

loadEnv();
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

const readShared = (name) => JSON.parse(readFileSync(resolve(ROOT, "shared", name), "utf8").replace(/^﻿/, ""));
const constants = readShared("constants.json");
const itemsFile = readShared("items.json");
const modifiers = readShared("modifiers.json");

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

await api("/api/register", { username: "enchbot", password: "ench123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "enchbot", password: "ench123" });
if (!account.roles.includes("admin")) {
  console.log("[enchbot] not admin yet — run: node scripts/make-admin.mjs enchbot  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Enchbot" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);

const ws = new WebSocket(grant.wsUrl);
const state = { x: 0, y: 0, z: 0, seq: 1000, terrain: null };
const tracker = makeWorldTracker();
let slots = [];
let gold = 0;
let dialog = null;
const chats = [];
const npcs = new Map(); // entity id -> name

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  const sampler = tracker.handle(msg);
  if (sampler) state.terrain = sampler;
  if (msg.t === "welcome") {
    state.x = msg.spawn.x;
    state.y = msg.spawn.y;
    state.z = msg.spawn.z;
    for (const e of msg.ents) if (e.kind === "npc") npcs.set(e.id, e.name ?? "");
  } else if (msg.t === "snap") {
    for (const e of msg.enter ?? []) if (e.kind === "npc") npcs.set(e.id, e.name ?? "");
  } else if (msg.t === "inv") {
    slots = msg.slots;
  } else if (msg.t === "stats") {
    gold = msg.gold;
  } else if (msg.t === "dialog") {
    dialog = msg;
  } else if (msg.t === "chat") {
    chats.push(msg.text);
  } else if (msg.t === "correct") {
    state.x = msg.x;
    state.y = msg.y;
    state.z = msg.z;
  }
});

await new Promise((res) => ws.on("open", () => { ws.send(JSON.stringify({ t: "hello", v: 1, ticket: grant.ticket })); res(); }));
while (!state.terrain) await sleep(200);
console.log(`[enchbot] in the hub at ${state.x.toFixed(1)},${state.z.toFixed(1)}`);

const chat = (text) => ws.send(JSON.stringify({ t: "chat", text }));
chat("/gold 1000");
chat("/give iron_sword 1");
await sleep(700);

// walk to Selvara's weaving-shop on Market Row (48,55) and talk
await goTo(ws, state, 47, 55, 2.2);
const selvaraId = [...npcs.entries()].find(([, name]) => name.includes("Selvara"))?.[0];
ok(selvaraId !== undefined, "Selvara replicated in the hub");
ws.send(JSON.stringify({ t: "talk", id: selvaraId }));
await sleep(600);
ok(dialog?.name === "Selvara the Enchanter", "talk opened her dialog");
ok((dialog?.enchant?.offers ?? []).length === 12, "dialog carries the 12 weavable offers");
ok(dialog?.enchant?.maxTier === 2, "Selvara weaves to the second degree");

const swordIdx = slots.findIndex((s) => s && s.item === "iron_sword" && !s.mods);
ok(swordIdx >= 0, "an unmodified iron sword to enchant");
const goldBefore = gold;
ws.send(JSON.stringify({ t: "enchant", npc: selvaraId, slot: swordIdx, enchantId: "hpRegen", tier: 1 }));
await sleep(700);
const sword = slots[swordIdx];
const mod = modifiers.hpRegen;
ok(sword?.mods?.hpRegen === mod.enchant.tiers[0], `Regeneration I applied (${JSON.stringify(sword?.mods)})`);
const rarityMult = itemsFile.rarities[sword?.rarity ?? "common"].mult;
const expectedPrice = Math.ceil(
  itemsFile.items.iron_sword.value * rarityMult * mod.enchant.priceMult * (constants.enchanting.tierPriceMult["1"] ?? 1)
    * constants.enchanting.priceValueMult + constants.enchanting.priceBase
);
ok(goldBefore - gold === expectedPrice, `charged the authoritative price (${goldBefore - gold}g = ${expectedPrice}g)`);

// second enchant on the same item: refused, nothing charged
const goldMid = gold;
ws.send(JSON.stringify({ t: "enchant", npc: selvaraId, slot: swordIdx, enchantId: "manaRegen", tier: 1 }));
await sleep(700);
ok(Object.keys(slots[swordIdx]?.mods ?? {}).length === 1, "second enchant refused (a T2 sword holds ONE weaving)");
ok(gold === goldMid, "no gold taken for the refusal");
ok(chats.some((t) => /no room for another weaving/i.test(t)), "she explains the refusal in chat");

// the perk raises the sell price: enchanted vs plain at the weaponsmith.
// /give runs the mod lottery (4% at common) — retry until a plain one lands
let plainIdx = -1;
for (let tries = 0; tries < 5 && plainIdx < 0; tries++) {
  chat("/give iron_sword 1");
  await sleep(700);
  plainIdx = slots.findIndex((s, i) => s && s.item === "iron_sword" && i !== swordIdx && !s.mods);
}
if (plainIdx < 0) {
  console.log("[enchbot] plain /give sword rolled mods by luck — skipping the sell-delta check");
} else {
  await goTo(ws, state, 44, 55, 2.0); // Gorren the Smith (43,54 — Market Row, batch-1b rebuild)
  const smithId = [...npcs.entries()].find(([, name]) => name.includes("Gorren"))?.[0];
  ok(smithId !== undefined, "found the weaponsmith");
  const g0 = gold;
  ws.send(JSON.stringify({ t: "sell", npc: smithId, slot: plainIdx, qty: 1 }));
  await sleep(600);
  const plainPrice = gold - g0;
  const g1 = gold;
  ws.send(JSON.stringify({ t: "sell", npc: smithId, slot: swordIdx, qty: 1 }));
  await sleep(600);
  const enchantedPrice = gold - g1;
  console.log(`[enchbot] plain sells ${plainPrice}g, enchanted sells ${enchantedPrice}g`);
  ok(enchantedPrice > plainPrice, "the perk raises the sell price");
}

ws.close();
console.log(failures === 0 ? "\n[enchbot] ALL PASS" : `\n[enchbot] ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
