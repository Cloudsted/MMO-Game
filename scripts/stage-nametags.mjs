/**
 * Staging only: dresses a hub scene for nametag-declutter screenshots.
 * An admin bot spawns an idle mob pack at (--pack-x, --pack-z), then moves to
 * (--hold-x, --hold-z); with --wound it also spawns a slime there, wounds it
 * once (hp < max ⇒ the bar shows), and tanks it so the fight stays put.
 * Holds --seconds so an MMO_SHOT client can photograph the scene, then exits.
 * The pack is idle by design — place it beyond aggro range (12 m+) of both
 * the hold spot and the camera character. Restart the hub room afterwards
 * (/spawnmob mobs never despawn).
 *
 *   node scripts/make-admin.mjs nametag_bot   # once
 *   node scripts/stage-nametags.mjs [--pack-x 43 --pack-z 50] [--mob bandit]
 *       [--n 8] [--no-pack] [--hold-x 66 --hold-z 59] [--wound] [--seconds 240]
 *
 * The wound target spawns level-scaled (slime@9) so an L30 admin swing wounds
 * without one-shotting; its chip vs the L30 bot still ends the tank in ~2.5
 * minutes — start the camera client FIRST, then this with a short --seconds.
 */
import WebSocket from "ws";
import { loadEnv, sleep } from "./lib.mjs";

loadEnv();
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const USER = "nametag_bot";
const PASS = "devpass1";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
};
const PACK_X = Number(arg("pack-x", 43));
const PACK_Z = Number(arg("pack-z", 50));
const MOB = arg("mob", "bandit");
const N = Number(arg("n", 8));
const HOLD_X = Number(arg("hold-x", 66));
const HOLD_Z = Number(arg("hold-z", 59));
const WOUND = process.argv.includes("--wound");
const NO_PACK = process.argv.includes("--no-pack");
const SECONDS = Number(arg("seconds", 240));

const log = (...a) => console.log("[stage-nametags]", ...a);

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

await api("/api/register", { username: USER, password: PASS }).catch(() => {});
const { token } = await api("/api/login", { username: USER, password: PASS });
let { characters } = await api("/api/characters", undefined, token);
if (characters.length === 0) {
  characters = [(await api("/api/characters", { name: "NametagBot" }, token)).character];
}
const grant = await api("/api/enter", { characterId: characters[0].id }, token);
if (grant.roomId && grant.roomId !== "hub") throw new Error(`character is in ${grant.roomId}; stage from the hub`);

const ws = new WebSocket(grant.wsUrl);
const state = { x: 0, y: 0, z: 0, seq: 0, welcomed: false, ents: new Map() };
ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket: grant.ticket })));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  switch (msg.t) {
    case "welcome":
      state.welcomed = true;
      state.x = msg.spawn.x;
      state.y = msg.spawn.y;
      state.z = msg.spawn.z;
      for (const e of msg.ents) state.ents.set(e.id, e);
      break;
    case "snap":
      for (const e of msg.enter ?? []) state.ents.set(e.id, e);
      for (const d of msg.ents ?? []) {
        const e = state.ents.get(d.id);
        if (e) Object.assign(e, d);
      }
      for (const id of msg.leave ?? []) state.ents.delete(id);
      break;
    case "correct":
      state.x = msg.x;
      state.y = msg.y;
      state.z = msg.z;
      break;
    case "reject":
      console.error("rejected:", msg.reason);
      process.exit(1);
  }
});

const until = async (fn, ms, what) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(120);
  }
};
const chat = (text) => ws.send(JSON.stringify({ t: "chat", text }));

await until(() => state.welcomed, 10000, "welcome");
chat("/level 30"); // tank the wound target's chip for the whole hold
if (!NO_PACK) {
  log("staging the pack at", PACK_X, PACK_Z);
  chat(`/tp ${PACK_X} ${PACK_Z}`);
  await sleep(600);
  chat(`/spawnmob ${MOB} ${N}`);
  await sleep(1500);
}
chat(`/tp ${HOLD_X} ${HOLD_Z}`);
await sleep(600);

if (WOUND) {
  // a wounded (hp < max) mob shows its bar without a name — spawn a slime at
  // the hold spot and hit it until it is visibly hurt but alive; re-spawn if
  // a crit kills it. It keeps biting the bot, so the scene holds itself.
  let wounded = null;
  for (let attempt = 0; attempt < 4 && !wounded; attempt++) {
    chat("/spawnmob slime 1 9"); // level-scaled: an L30 swing wounds, not kills
    await sleep(1200);
    const slime = [...state.ents.values()]
      .filter((e) => e.kind === "mob" && e.act !== "dead" && (e.name ?? "").includes("Slime"))
      .sort((a, b) => Math.hypot(a.x - state.x, a.z - state.z) - Math.hypot(b.x - state.x, b.z - state.z))[0];
    if (!slime) continue;
    for (let i = 0; i < 6; i++) {
      const e = state.ents.get(slime.id);
      if (!e || e.act === "dead") break;
      if (e.hp !== undefined && e.hp < e.maxHp) {
        wounded = e;
        break;
      }
      const aim = Math.atan2(e.x - state.x, e.z - state.z);
      state.seq++;
      ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: aim, anim: "idle" }));
      ws.send(JSON.stringify({ t: "attack", yaw: aim, pitch: 0 }));
      await sleep(950);
    }
  }
  if (!wounded) throw new Error("could not stage a wounded slime");
  log(`wounded slime #${wounded.id} at ${wounded.hp}/${wounded.maxHp} hp — tanking it`);
}

log(`holding ${SECONDS}s for the camera (pack at ${PACK_X},${PACK_Z}; bot at ${HOLD_X},${HOLD_Z})`);
const end = Date.now() + SECONDS * 1000;
while (Date.now() < end) {
  ws.send(JSON.stringify({ t: "ping", n: Date.now() }));
  await sleep(5000);
}
ws.close();
log("done — restart the hub room to clear the staged mobs");
process.exit(0);
