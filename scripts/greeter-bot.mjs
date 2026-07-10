/**
 * Greeter bot: logs in, finds a player by name in its snapshots, walks up to
 * them (legal speed), and stands nearby. Handy for eyeballing billboards and
 * name tags in the client without a second human.
 *
 *   node scripts/greeter-bot.mjs --target Brian --seconds 120
 */
import WebSocket from "ws";
import { loadEnv, sleep, makeWorldTracker } from "./lib.mjs";

loadEnv();
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const TARGET = flag("target", "Brian");
const SECONDS = Number(flag("seconds", 120));
const MASTER = flag("master", process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`);

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

await api("/api/register", { username: "greeter", password: "greet123" }).catch(() => {});
const { token } = await api("/api/login", { username: "greeter", password: "greet123" });
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Greeter" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);

const ws = new WebSocket(grant.wsUrl);
const me = { x: 0, y: 0, z: 0, seq: 0, terrain: null };
  const tracker = makeWorldTracker();
const others = new Map();

ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket: grant.ticket })));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    me.x = msg.spawn.x;
    me.y = msg.spawn.y;
    me.z = msg.spawn.z;
    for (const e of msg.ents) others.set(e.id, e);
    console.log(`[greeter] in ${msg.roomId} at ${me.x.toFixed(1)},${me.z.toFixed(1)}; ${msg.ents.length} in sight`);
  } else if (msg.t === "snap") {
    for (const e of msg.enter ?? []) others.set(e.id, e);
    for (const id of msg.leave ?? []) others.delete(id);
    for (const d of msg.ents ?? []) {
      const e = others.get(d.id);
      if (e) Object.assign(e, d);
    }
  } else if (msg.t === "world" || msg.t === "chunks" || msg.t === "blockSet") {
    const s = tracker.handle(msg);
    if (s) me.terrain = s;
  } else if (msg.t === "correct") {
    me.x = msg.x;
    me.y = msg.y;
    me.z = msg.z;
  }
});

const HZ = 20;
const SPEED = 4.0; // just under walkSpeed
const timer = setInterval(() => {
  if (ws.readyState !== WebSocket.OPEN) return;
  const target = [...others.values()].find((e) => e.name === TARGET);
  let anim = "idle";
  let yaw = 0;
  if (target) {
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    const dist = Math.hypot(dx, dz);
    yaw = Math.atan2(dx, dz);
    if (dist > 2.5) {
      const step = Math.min((SPEED / HZ), dist - 2.0);
      me.x += (dx / dist) * step;
      me.z += (dz / dist) * step;
      anim = "move";
    }
  }
  if (me.terrain) me.y = me.terrain.heightAt(me.x, me.z);
  me.seq++;
  ws.send(JSON.stringify({ t: "move", seq: me.seq, x: me.x, y: me.y, z: me.z, yaw, anim }));
}, 1000 / HZ);

await sleep(SECONDS * 1000);
clearInterval(timer);
ws.close();
console.log("[greeter] done");
process.exit(0);
