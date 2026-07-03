/**
 * Bot clients: register/login N fake accounts, enter the world, wander the
 * room sending legal moves, and log what they see. Used for topology
 * verification and (later) 50-players-per-room load tests.
 *
 *   npm run bots -- --n 5 --seconds 30
 */
import WebSocket from "ws";
import { loadEnv, sleep, decodeTerrain } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const N = Number(flag("n", 3));
const SECONDS = Number(flag("seconds", 30));
const MASTER = flag("master", `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`);

let constantsText = readFileSync(resolve(ROOT, "shared/constants.json"), "utf8");
if (constantsText.charCodeAt(0) === 0xfeff) constantsText = constantsText.slice(1);
const constants = JSON.parse(constantsText);

async function api(path, body, token) {
  const res = await fetch(`${MASTER}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}

async function runBot(i) {
  const name = `bot_${i}`;
  const password = "botpass1";
  const log = (...a) => console.log(`[${name}]`, ...a);

  await api("/api/register", { username: name, password }).catch((e) => {
    if (!String(e.message).includes("taken")) throw e;
  });
  const { token } = await api("/api/login", { username: name, password });
  let { characters } = await api("/api/characters", null, token);
  if (characters.length === 0) {
    const created = await api("/api/characters", { name: `Bot${i}` }, token);
    characters = [created.character];
  }
  const grant = await api("/api/enter", { characterId: characters[0].id }, token);
  log(`ticket for ${grant.roomId} at ${grant.wsUrl}`);

  const ws = new WebSocket(grant.wsUrl);
  const state = { x: 0, y: 0, z: 0, yaw: 0, seq: 0, others: new Map(), corrections: 0, snaps: 0, terrain: null };

  await new Promise((res, rej) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ t: "hello", v: constants.net.protocolVersion, ticket: grant.ticket }));
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === "welcome") {
        state.x = msg.spawn.x;
        state.y = msg.spawn.y;
        state.z = msg.spawn.z;
        for (const e of msg.ents) state.others.set(e.id, e);
        log(`welcomed to ${msg.roomId} as entity ${msg.selfId}, sees ${msg.ents.length} others`);
        res();
      } else if (msg.t === "snap") {
        state.snaps++;
        for (const e of msg.enter ?? []) state.others.set(e.id, e);
        for (const id of msg.leave ?? []) state.others.delete(id);
        for (const d of msg.ents ?? []) {
          const e = state.others.get(d.id);
          if (e) Object.assign(e, d);
        }
      } else if (msg.t === "terrain") {
        state.terrain = decodeTerrain(msg);
      } else if (msg.t === "correct") {
        state.corrections++;
        state.x = msg.x;
        state.y = msg.y;
        state.z = msg.z;
        state.needTurn = true; // probably walked into a prop — pick a new heading
      } else if (msg.t === "reject") {
        rej(new Error(`rejected: ${msg.reason}`));
      } else if (msg.t === "evict") {
        log(`evicted: ${msg.reason}`);
      }
    });
    ws.on("error", rej);
    setTimeout(() => rej(new Error("welcome timeout")), 8000);
  });

  // wander: random heading changes, legal speed
  const hz = constants.net.clientInputHz;
  const speed = constants.movement.walkSpeed * 0.9;
  let heading = Math.random() * Math.PI * 2;
  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (state.needTurn) {
      heading += Math.PI * (0.6 + Math.random() * 0.8);
      state.needTurn = false;
    }
    if (Math.random() < 0.05) heading += (Math.random() - 0.5) * 2;
    const dt = 1 / hz;
    state.x = Math.min(120, Math.max(8, state.x + Math.sin(heading) * speed * dt));
    state.z = Math.min(120, Math.max(8, state.z + Math.cos(heading) * speed * dt));
    if (state.terrain) state.y = state.terrain.heightAt(state.x, state.z);
    state.yaw = heading;
    state.seq++;
    ws.send(
      JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: state.yaw, anim: "move" })
    );
  }, 1000 / hz);

  await sleep(SECONDS * 1000);
  clearInterval(interval);
  const summary = `done: saw ${state.others.size} others, ${state.snaps} snaps, ${state.corrections} corrections`;
  ws.close();
  log(summary);
  return { name, others: state.others.size, snaps: state.snaps, corrections: state.corrections };
}

const results = await Promise.allSettled(Array.from({ length: N }, (_, i) => runBot(i)));
let failed = 0;
for (const r of results) {
  if (r.status === "rejected") {
    failed++;
    console.error("[bots] FAILED:", r.reason?.message ?? r.reason);
  }
}
console.log(`[bots] ${N - failed}/${N} bots completed`);
process.exit(failed ? 1 : 0);
