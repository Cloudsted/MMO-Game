/**
 * Mob-separation verification: enter the forest, stand in the slime meadow so
 * the pack converges on us, and sample pairwise distances between nearby alive
 * mobs for ~25 s. Fails if any pair sits inside personal space (mobs stacking
 * inside each other — the thing separation exists to prevent).
 *
 *   node scripts/separation-check.mjs
 */
import WebSocket from "ws";
import { loadEnv, makeWorldTracker, sleep, goTo } from "./lib.mjs";

loadEnv();
const MASTER = `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const USER = "separation_bot";
const PASS = "devpass1";
const SEPARATION = 0.45; // mirrors MOB_SEPARATION in sim/mobs.ts
const Y_TOLERANCE = 1.5; // pairs on different ledges are exempt, like the sim
const SOAK_MS = 25000;
const SAMPLE_MS = 200;

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

const log = (...a) => console.log("[separation]", ...a);
function fail(msg) {
  console.error("[separation] FAIL:", msg);
  process.exit(1);
}

function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const state = {
      roomId: null, selfId: -1, x: 0, y: 0, z: 0, seq: 0,
      terrain: null, portals: [], transfer: null,
      ents: new Map(), died: false,
    };
    const tracker = makeWorldTracker();
    const timer = setTimeout(() => reject(new Error("room join timeout")), 10000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome":
          state.roomId = msg.roomId;
          state.selfId = msg.selfId;
          state.x = msg.spawn.x;
          state.y = msg.spawn.y;
          state.z = msg.spawn.z;
          for (const e of msg.ents) state.ents.set(e.id, e);
          break;
        case "world":
        case "chunks":
        case "blockSet": {
          const s = tracker.handle(msg);
          if (s) state.terrain = s;
          break;
        }
        case "portals":
          state.portals = msg.portals;
          break;
        case "snap":
          for (const e of msg.enter) state.ents.set(e.id, e);
          for (const d of msg.ents) {
            const e = state.ents.get(d.id);
            if (e) Object.assign(e, d);
          }
          for (const id of msg.leave) state.ents.delete(id);
          break;
        case "died":
          state.died = true;
          break;
        case "transfer":
          state.transfer = msg;
          break;
        case "correct":
          state.x = msg.x;
          state.y = msg.y;
          state.z = msg.z;
          break;
        case "reject":
          reject(new Error(`rejected: ${msg.reason}`));
          return;
      }
      if (state.roomId && state.terrain && !state.ready) {
        state.ready = true;
        clearTimeout(timer);
        resolve({ ws, state });
      }
    });
  });
}

const main = async () => {
  await api("/api/register", { username: USER, password: PASS }).catch(() => {});
  const { token } = await api("/api/login", { username: USER, password: PASS });
  let chars = (await api("/api/characters", null, token)).characters;
  if (chars.length === 0) {
    const suffix = Math.floor(Math.random() * 9000 + 1000);
    chars = [(await api("/api/characters", { name: `SepBot${suffix}` }, token)).character];
  }
  const character = chars[0];

  let grant = await api("/api/enter", { characterId: character.id }, token);
  let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
  log(`entered ${state.roomId}`);

  if (state.roomId !== "forest") {
    for (let i = 0; i < 30 && state.portals.length === 0; i++) await sleep(100);
    const portal = state.portals.find((p) => p.target === "forest");
    if (!portal) fail(`no forest portal in ${state.roomId}`);
    if (!(await goTo(ws, state, portal.x, portal.z, 1.5))) fail("never reached the portal");
    ws.send(JSON.stringify({ t: "usePortal", portalId: portal.id }));
    for (let i = 0; i < 100 && !state.transfer; i++) await sleep(100);
    if (!state.transfer) fail("no transfer grant");
    ws.close();
    ({ ws, state } = await enterRoom(state.transfer.wsUrl, state.transfer.ticket));
    log(`transferred to ${state.roomId}`);
  }

  // walk into the slime meadow so the pack aggros and converges on us
  // (480² retune: slime-meadow-e at 318,348 is the closest meadow to spawn)
  await goTo(ws, state, 318, 348, 2.0);
  log(`standing at ${state.x.toFixed(1)}, ${state.z.toFixed(1)} — soaking ${SOAK_MS / 1000}s`);

  let samples = 0;
  let worst = Infinity;
  let worstPair = null;
  let violationSamples = 0; // samples with any pair inside personal space
  let maxNearby = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < SOAK_MS) {
    await sleep(SAMPLE_MS);
    const mobs = [...state.ents.values()].filter(
      (e) => e.kind === "mob" && e.act !== "dead" && Math.hypot(e.x - state.x, e.z - state.z) < 20
    );
    maxNearby = Math.max(maxNearby, mobs.length);
    samples++;
    let violated = false;
    for (let i = 0; i < mobs.length; i++)
      for (let j = i + 1; j < mobs.length; j++) {
        const a = mobs[i], b = mobs[j];
        if (Math.abs(a.y - b.y) > Y_TOLERANCE) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < worst) {
          worst = d;
          worstPair = `${a.name}#${a.id} vs ${b.name}#${b.id}`;
        }
        if (d < SEPARATION - 0.15) violated = true; // grace for interp/in-flight pushes
      }
    if (violated) violationSamples++;
  }
  if (state.died) log("note: bot died during the soak (mobs did their job) — samples still valid");
  log(`samples ${samples}, max nearby mobs ${maxNearby}, closest pair ${worst === Infinity ? "n/a" : worst.toFixed(3)}m (${worstPair ?? "-"})`);
  log(`samples with a pair inside personal space: ${violationSamples}/${samples}`);

  if (maxNearby < 3) fail("fewer than 3 mobs ever nearby — test didn't exercise a pack");
  if (worst === Infinity) fail("never saw two mobs at once");
  // transient dips happen while a push is in flight; sustained stacking must not
  if (violationSamples > samples * 0.1) fail(`mobs stacked inside each other in ${violationSamples}/${samples} samples`);
  log("PASS: no sustained mob overlap");
  ws.close();
  process.exit(0);
};

main().catch((e) => fail(e.message));
