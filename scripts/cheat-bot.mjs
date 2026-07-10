// Proves server authority: a client that teleports gets corrected back.
import WebSocket from "ws";

const MASTER = process.env.MMO_MASTER_ORIGIN ?? "http://127.0.0.1:4000";

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

await api("/api/register", { username: "cheater", password: "cheat123" }).catch(() => {});
const { token } = await api("/api/login", { username: "cheater", password: "cheat123" });
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "Cheater" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);

const ws = new WebSocket(grant.wsUrl);
let spawn = null;
let corrected = null;

ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket: grant.ticket })));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    spawn = msg.spawn;
    // attempt a 50m teleport
    ws.send(JSON.stringify({ t: "move", seq: 1, x: spawn.x + 50, y: 0, z: spawn.z, yaw: 0, anim: "move" }));
  } else if (msg.t === "correct") {
    corrected = msg;
    console.log(`TELEPORT REJECTED: corrected back to (${msg.x}, ${msg.z}) from attempted (${spawn.x + 50}, ${spawn.z})`);
    ws.close();
    process.exit(msg.x === spawn.x ? 0 : 1);
  }
});
setTimeout(() => {
  console.log(corrected ? "ok" : "FAIL: teleport was not corrected");
  process.exit(corrected ? 0 : 1);
}, 5000);
