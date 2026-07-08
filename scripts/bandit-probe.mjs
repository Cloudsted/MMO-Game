/**
 * Live probe: the Thornhollow Company + the level-scaled rank system, over the wire.
 *
 * Unit tests prove resolveMob's math. This proves the whole PATH: the RoomHost boots
 * with the new registry, /spawnmob resolves ranks server-side, scaled mobs replicate
 * with the right name/level/hp/sprite, and the Hollow Cowl's mend_kin fires through
 * the real tick loop and emits a heal EVENT on the wire.
 *
 * Why the heal EVENT and not just "hp went up": a leash reset heals a mob to full.
 * `{t:"evt", e:{kind:"heal"}}` only ever comes from an ability release.
 *
 * Staging notes paid for the hard way:
 *  - /spawnmob mobs have spawner "" and NEVER despawn (LESSONS.md). This probe
 *    restarts the hub RoomHost before and after itself, or run N leaves N pileups
 *    for run N+1 — which is how the first version died: eight mobs plus a boss beat
 *    the bot to death before it could wound anything.
 *  - The healer test runs FIRST, on a clean room with exactly two mobs in it.
 *
 *   node scripts/make-admin.mjs bandit_probe    # once (applies at next login)
 *   node scripts/bandit-probe.mjs
 */
import WebSocket from "ws";
import { loadEnv, sleep } from "./lib.mjs";

loadEnv();
const MASTER = `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const USER = "bandit_probe";
const ADMIN_KEY = process.env.ADMIN_KEY ?? "";

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

/** Wipe every command-spawned mob by restarting the room's host. */
async function restartHub(label) {
  await fetch(`${MASTER}/api/admin/restart-room?key=${ADMIN_KEY}&roomId=hub`, { method: "POST" }).catch(() => {});
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const s = await fetch(`${MASTER}/api/status`).then((r) => r.json()).catch(() => null);
    if (s?.shards?.some((sh) => (sh.rooms ?? []).some((r) => r.roomId === "hub"))) {
      await sleep(1200);
      console.log(`(hub restarted — ${label})`);
      return;
    }
  }
  throw new Error("hub never came back");
}

const fails = [];
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) fails.push(label);
};

await restartHub("clean slate");

await api("/api/register", { username: USER, password: "devpass1" }).catch(() => {});
const { token } = await api("/api/login", { username: USER, password: "devpass1" });
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "BanditProbe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);

const ws = new WebSocket(grant.wsUrl);
const ents = new Map();
const chat = [];
const healEvents = [];
const me = { x: 0, y: 0, z: 0, seq: 0 };
let selfId = -1;
let stats = null;
let welcomed = false;

ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket: grant.ticket })));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    selfId = msg.selfId;
    Object.assign(me, msg.spawn);
    for (const e of msg.ents) ents.set(e.id, e);
    welcomed = true;
  } else if (msg.t === "correct") {
    me.x = msg.x; me.y = msg.y; me.z = msg.z;
  } else if (msg.t === "snap") {
    for (const e of msg.enter) ents.set(e.id, e);
    for (const d of msg.ents) { const e = ents.get(d.id); if (e) Object.assign(e, d); }
    for (const id of msg.leave) ents.delete(id);
  } else if (msg.t === "stats") {
    stats = msg;
  } else if (msg.t === "chat") {
    chat.push(msg.text);
  } else if (msg.t === "evt" && msg.e?.kind === "heal") {
    healEvents.push(msg.e);
  }
});

const cmd = (text) => ws.send(JSON.stringify({ t: "chat", channel: "say", text }));
/** Face a target without moving — the server refreshes aim from pos.yaw at fire time. */
function face(t) {
  const aim = Math.atan2(t.x - me.x, t.z - me.z);
  me.seq++;
  ws.send(JSON.stringify({ t: "move", seq: me.seq, x: me.x, y: me.y, z: me.z, yaw: aim, anim: "idle" }));
  return aim;
}
const swing = (t) => ws.send(JSON.stringify({ t: "attack", yaw: face(t), pitch: 0 }));
const liveMobs = () => [...ents.values()].filter((e) => e.kind === "mob" && e.anim !== "dead");
const byName = (frag) => liveMobs().filter((m) => (m.name ?? "").includes(frag));

for (let i = 0; i < 60 && !welcomed; i++) await sleep(200);
if (!welcomed) { console.error("never welcomed"); process.exit(1); }
console.log(`joined as ${characters[0].name} (entity ${selfId})\n`);

chat.length = 0;
cmd("/level 25"); // survive the staged fight; also proves the bot is admin
await sleep(900);
if (chat.some((t) => /not an admin|Unknown command/i.test(t)) || chat.length === 0) {
  console.error(`${USER} is not admin. Run:  node scripts/make-admin.mjs ${USER}   (then re-run)`);
  process.exit(1);
}

// ---------------------------------------------------------------- 1  (clean room)
console.log("1. the Hollow Cowl mends a wounded packmate (heal EVENT, not a leash reset)");
cmd("/spawnmob bandit 1");
await sleep(600);
cmd("/spawnmob hollow_cowl 1 11");
await sleep(1600);
const victim = byName("Thornhollow Cutthroat")[0];
const priest = byName("Priest")[0];

if (!victim || !priest) {
  check(false, "staged a victim + a Priest", `victim=${!!victim} priest=${!!priest}`);
} else {
  const hurtTo = Math.floor(victim.maxHp * 0.5);
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const v = ents.get(victim.id);
    if (!v || v.anim === "dead" || v.hp <= hurtTo) break;
    if (stats && stats.hp <= 0) break;
    swing(v); // it closes to melee on its own; we aim and swing
    await sleep(650);
  }
  const wounded = ents.get(victim.id);
  check(!!wounded && wounded.anim !== "dead" && wounded.hp <= hurtTo,
    "victim wounded below the Cowl's 70% gate", `hp ${wounded?.hp}/${wounded?.maxHp}`);

  // Stop swinging. Stay put — a leash reset needs the mob to walk home, and a heal
  // event only ever comes from an ability release anyway.
  healEvents.length = 0;
  chat.length = 0;
  const low = ents.get(victim.id)?.hp ?? 0;
  const t1 = Date.now();
  let mended = null;
  while (Date.now() - t1 < 25000) {
    await sleep(300);
    const v = ents.get(victim.id);
    if (!v || v.anim === "dead") break;
    face(v);
    mended = healEvents.find((h) => h.tgt === victim.id);
    if (mended) break;
  }
  check(!!mended, "a heal EVENT targeted the wounded ally", mended ? `+${mended.amount} hp` : "none in 25 s");
  const after = ents.get(victim.id);
  check(!!after && after.hp > low, "the ally's hp actually rose", `${low} -> ${after?.hp}`);
  check(chat.some((t) => /wounds close/i.test(t)), "the mend announced itself",
    chat.find((t) => /wounds close/i.test(t)) ?? "(no line)");
}

// ---------------------------------------------------------------- 2
console.log("\n2. every new mob spawns, replicates, and carries its new sprite");
const ROSTER = [
  ["bandit", "Thornhollow Cutthroat", "bandit"],
  ["greenhood_poacher", "Greenhood Poacher", "bandit_poacher"],
  ["powder_brigand", "Powder Brigand", "bandit_bombardier"],
  ["bandit_enforcer", "Bandit Enforcer", "bandit_enforcer"],
  ["hollow_cowl", "Hollow Cowl", "bandit_mystic"],
  ["thrace_redcap", "Thrace the Redcap", "bandit_chief"],
  ["camp_cur", "Camp Cur", "camp_cur"],
  ["stolen_goat", "Stolen Goat", "stolen_goat"],
];
for (const [id] of ROSTER) { cmd(`/spawnmob ${id} 1`); await sleep(200); }
await sleep(1600);
for (const [id, name, sprite] of ROSTER) {
  const m = byName(name)[0];
  check(!!m, `${id} replicated`, m ? `"${m.name}" L${m.level}` : "not in interest");
  if (m) check(m.sprite === sprite, `${id} sprite`, m.sprite);
}

// ---------------------------------------------------------------- 3
console.log("\n3. /spawnmob <mob> <n> <level> resolves ranks server-side");
chat.length = 0;
cmd("/spawnmob hollow_cowl 1 13");
await sleep(1000);
const e1 = chat.find((t) => t.includes("Spawned")) ?? "";
check(/Hollow Cowl Oracle/.test(e1), "L13 Cowl is an Oracle", e1);
check(/mend_kin_greater/.test(e1), "L13 Cowl swapped up to the greater mend", e1);

chat.length = 0;
cmd("/spawnmob bandit 1 12");
await sleep(1000);
const e2 = chat.find((t) => t.includes("Spawned")) ?? "";
check(/Bloodletter/.test(e2), "L12 cutthroat is a Bloodletter", e2);
check(/thrust/.test(e2) && !/bandit_slash/.test(e2), "L12 cutthroat swapped slash for thrust", e2);

const blood = byName("Bloodletter")[0];
const baseCut = byName("Thornhollow Cutthroat").find((m) => m.level === 4);
check(blood?.level === 12, "scaled cutthroat replicates L12", `level=${blood?.level}`);
check(!!baseCut && !!blood && blood.maxHp > baseCut.maxHp * 2,
  "scaled cutthroat has >2x base hp", `${baseCut?.maxHp} -> ${blood?.maxHp}`);

// ---------------------------------------------------------------- 4
console.log("\n4. gloomfen boots its drowned-company table (levels survive the RoomHost)");
const status = await fetch(`${MASTER}/api/status`).then((r) => r.json()).catch(() => null);
const gf = status?.shards?.flatMap((s) => s.rooms ?? []).find((r) => r.roomId === "gloomfen");
check(!!gf, "gloomfen RoomHost is open");

ws.close();
await sleep(600);
await restartHub("cleaning up the staged mobs");

console.log(`\n${fails.length === 0 ? "ALL CHECKS PASSED" : `${fails.length} FAILED: ${fails.join(", ")}`}`);
process.exit(fails.length ? 1 : 0);
