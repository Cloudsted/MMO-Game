/**
 * Occlusion stager: parks Dropbot at a fixed spot on the hub plaza, faces +Z,
 * and tosses a longbow so the loot bag lands exactly 1.2 m BEHIND him as seen
 * from a camera staged south of him — for verifying that dropped 3D item
 * meshes are properly occluded by entity billboards (they used to render
 * straight through sprites). Prints the exact positions to stage the camera
 * character against, then holds so the scene stays fresh.
 *
 *   node scripts/stage-occlusion.mjs [--seconds 300] [--x 61] [--z 44]
 */
import WebSocket from "ws";
import { loadEnv, sleep } from "./lib.mjs";

loadEnv();
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const SECONDS = arg("seconds", 300);
const TX = arg("x", 61);
const TZ = arg("z", 44);

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
const { token } = await api("/api/login", { username: "dropbot", password: "drop123" });
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
    console.log(`[occl] in ${msg.roomId} at ${me.x.toFixed(2)},${me.z.toFixed(2)}`);
  } else if (msg.t === "inv") {
    slots = msg.slots;
  } else if (msg.t === "correct") {
    me.x = msg.x;
    me.y = msg.y;
    me.z = msg.z;
  } else if (msg.t === "chat" && msg.channel === "system") {
    console.log(`[occl] system: ${msg.text}`);
  }
});

const send = (o) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(o));
const move = (yaw, anim = "idle") => send({ t: "move", seq: ++me.seq, x: me.x, y: me.y, z: me.z, yaw, anim });

await new Promise((res) => {
  const t = setInterval(() => { if (welcomed && slots.length >= 0) { clearInterval(t); res(); } }, 100);
});
await sleep(500);
send({ t: "chat", text: "/give longbow 1 epic" });
await sleep(600);

// crude flat-plaza walk to the target spot (small legal steps)
for (let i = 0; i < 400 && Math.hypot(TX - me.x, TZ - me.z) > 0.15; i++) {
  const d = Math.hypot(TX - me.x, TZ - me.z);
  const step = Math.min(0.18, d);
  me.x += ((TX - me.x) / d) * step;
  me.z += ((TZ - me.z) / d) * step;
  move(Math.atan2(TX - me.x, TZ - me.z), "move");
  await sleep(50);
}
console.log(`[occl] standing at ${me.x.toFixed(2)},${me.z.toFixed(2)}`);

// face +Z (yaw 0) and toss: the bag lands 1.2 m ahead
move(0);
await sleep(200);
const slot = slots.findIndex((s) => s && s.item === "longbow");
if (slot < 0) { console.error("[occl] no longbow in inventory"); process.exit(1); }
send({ t: "dropItem", slot, qty: 1 });
await sleep(400);
const bagX = me.x, bagZ = me.z + 1.2;
console.log(`[occl] STAGED  sprite=${me.x.toFixed(2)},${me.z.toFixed(2)}  bag=${bagX.toFixed(2)},${bagZ.toFixed(2)}`);
console.log(`[occl] camera: stage character at ${(me.x - 1.6).toFixed(2)}, ${(me.z - 2.6).toFixed(2)}  MMO_LOOK_AT=${bagX.toFixed(2)},${bagZ.toFixed(2)}`);

const keepalive = setInterval(() => move(0), 1000);
await sleep(SECONDS * 1000);
clearInterval(keepalive);
ws.close();
process.exit(0);
