/**
 * Staging tool: park an admin bot on the hub plaza and spawn the whole Thornhollow
 * Company in front of it, so a screenshot client can photograph the new sprites.
 *
 *   node scripts/make-admin.mjs bandit_probe     # once
 *   node scripts/stage-bandits.mjs [--x 64] [--z 58] [--no-boss]
 *
 * /spawnmob mobs never despawn, so clean up afterwards with:
 *   curl -X POST "http://127.0.0.1:4000/api/admin/restart-room?key=$ADMIN_KEY&roomId=hub"
 */
import WebSocket from "ws";
import { loadEnv, sleep } from "./lib.mjs";

loadEnv();
const MASTER = `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const X = Number(arg("x", 64));
const Z = Number(arg("z", 58));
const NO_BOSS = process.argv.includes("--no-boss");
const NO_DOG = process.argv.includes("--no-dog"); // camp_cur has aggroRadius 20 and will pull the camera

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

const { token } = await api("/api/login", { username: "bandit_probe", password: "devpass1" });
const { characters } = await api("/api/characters", null, token);
const grant = await api("/api/enter", { characterId: characters[0].id }, token);

const ws = new WebSocket(grant.wsUrl);
let welcomed = false;
ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket: grant.ticket })));
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === "welcome") welcomed = true;
  if (m.t === "chat" && /Spawned/.test(m.text)) console.log("  " + m.text);
});
const cmd = (t) => ws.send(JSON.stringify({ t: "chat", channel: "say", text: t }));

for (let i = 0; i < 50 && !welcomed; i++) await sleep(200);
if (!welcomed) { console.error("join failed"); process.exit(1); }

cmd(`/tp ${X} ${Z}`);
await sleep(900);

// spread them so the billboards don't overlap in a screenshot: each /spawnmob
// drops its mobs ~4 m ahead of the bot, so hop a step between spawns
const LINE = [
  ["bandit", X - 6, Z],
  ["greenhood_poacher", X - 3, Z],
  ["powder_brigand", X, Z],
  ["bandit_enforcer", X + 3, Z],
  ["hollow_cowl", X + 6, Z],
  ["stolen_goat", X + 9, Z + 2],
];
if (!NO_DOG) LINE.push(["camp_cur", X - 8, Z + 2]);
if (!NO_BOSS) LINE.push(["thrace_redcap", X, Z - 4]);

for (const [mob, mx, mz] of LINE) {
  cmd(`/tp ${mx} ${mz + 4}`); // stand behind the slot; mobs spawn ~4 m ahead
  await sleep(500);
  cmd(`/spawnmob ${mob} 1`);
  await sleep(500);
}
cmd(`/tp ${X} ${Z + 40}`); // leave: with no target in aggro range the line just idles
await sleep(800);
console.log(`\nstaged ${LINE.length} mobs around (${X}, ${Z}). Bot parked at (${X}, ${Z + 20}).`);
console.log("remember: /spawnmob mobs never despawn — restart the hub room when done.");
ws.close();
process.exit(0);
