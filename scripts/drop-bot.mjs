/**
 * Drop-stager bot: logs in as an admin bot, gives itself a few items, and
 * scatters them on the ground near the hub spawn — so a client can eyeball
 * the 3D dropped-item meshes (extruded sprites spinning/hovering, mini block
 * cubes, shadows). Stays connected so the drops persist visibly.
 *
 *   node scripts/make-admin.mjs dropbot   (once, after first register)
 *   node scripts/drop-bot.mjs --seconds 300
 */
import WebSocket from "ws";
import { loadEnv, sleep } from "./lib.mjs";

loadEnv();
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const SECONDS = Number(flag("seconds", 300));
const MASTER = flag("master", `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`);

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

await api("/api/register", { username: "dropbot", password: "drop123" }).catch(() => {});
const { token, account } = await api("/api/login", { username: "dropbot", password: "drop123" });
if (!account.roles.includes("admin")) {
  console.log("[dropbot] not admin yet — run: node scripts/make-admin.mjs dropbot  (then rerun)");
  process.exit(2);
}
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Dropbot" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);

const ws = new WebSocket(grant.wsUrl);
const me = { x: 0, y: 0, z: 0, seq: 0 };
let slots = [];
let welcomed = false;

ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket: grant.ticket })));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    welcomed = true;
    me.x = msg.spawn.x;
    me.y = msg.spawn.y;
    me.z = msg.spawn.z;
    console.log(`[dropbot] in ${msg.roomId} at ${me.x.toFixed(1)},${me.z.toFixed(1)}`);
  } else if (msg.t === "inv") {
    slots = msg.slots;
  } else if (msg.t === "correct") {
    me.x = msg.x;
    me.y = msg.y;
    me.z = msg.z;
  } else if (msg.t === "chat" && msg.channel === "system") {
    console.log(`[dropbot] system: ${msg.text}`);
  }
});

const send = (o) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o));
const move = (yaw) => send({ t: "move", seq: ++me.seq, x: me.x, y: me.y, z: me.z, yaw, anim: "idle" });
const slotOf = (item) => slots.findIndex((s) => s && s.item === item);

await new Promise((res) => {
  const t = setInterval(() => { if (welcomed && slots.length) { clearInterval(t); res(); } }, 100);
});
await sleep(500);

// step a few meters off the spawn point (flat plaza) so the drops sit in
// front of a freshly-spawned onlooker instead of underfoot
const startZ = me.z;
while (me.z > startZ - 5) {
  me.z -= 0.18;
  send({ t: "move", seq: ++me.seq, x: me.x, y: me.y, z: me.z, yaw: Math.PI, anim: "move" });
  await sleep(50);
}
await sleep(300);

send({ t: "chat", text: "/give longbow 1 epic" });
send({ t: "chat", text: "/give fire_staff 1 rare" });
send({ t: "chat", text: "/give block_torch 5" });
await sleep(800);

// scatter: face a different way before each toss (drops land 1.2 m ahead)
const plan = [
  ["longbow", 1, 0.4],
  ["fire_staff", 1, 1.8],
  ["block_torch", 5, 3.2],
  ["rusty_sword", 1, 4.6],
];
for (const [item, qty, yaw] of plan) {
  const slot = slotOf(item);
  if (slot < 0) { console.log(`[dropbot] no ${item} in inventory?`); continue; }
  move(yaw);
  await sleep(150);
  send({ t: "dropItem", slot, qty });
  await sleep(300);
  console.log(`[dropbot] dropped ${qty}x ${item}`);
}

console.log(`[dropbot] holding position for ${SECONDS}s so the drops stay fresh`);
const keepalive = setInterval(() => move(0), 1000);
await sleep(SECONDS * 1000);
clearInterval(keepalive);
ws.close();
process.exit(0);
