/** Probe: join the hub with a throwaway character and print every player/loot
 *  entity in interest (position + name). For staging/debugging scenes.
 *    node scripts/probe-ents.mjs
 */
import WebSocket from "ws";
import { loadEnv, sleep } from "./lib.mjs";

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

await api("/api/register", { username: "probe_bot", password: "devpass1" }).catch(() => {});
const { token } = await api("/api/login", { username: "probe_bot", password: "devpass1" });
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "ProbeBot" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);

const ws = new WebSocket(grant.wsUrl);
const ents = new Map();
let self = null;
ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket: grant.ticket })));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    self = msg.spawn;
    for (const e of msg.ents) ents.set(e.id, e);
  } else if (msg.t === "snap") {
    for (const e of msg.enter) ents.set(e.id, e);
    for (const d of msg.ents) { const e = ents.get(d.id); if (e) Object.assign(e, d); }
    for (const id of msg.leave) ents.delete(id);
  }
});

await sleep(3000);
console.log(`self at ${self.x.toFixed(2)},${self.z.toFixed(2)}`);
for (const e of ents.values()) {
  if (e.kind === "player" || e.kind === "loot") {
    console.log(`${e.kind} ${e.name ?? "?"} #${e.id}  x=${e.x.toFixed(2)} y=${e.y.toFixed(2)} z=${e.z.toFixed(2)}`);
  }
}
ws.close();
process.exit(0);
