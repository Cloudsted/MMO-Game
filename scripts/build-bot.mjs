/**
 * Block-building verification: travel to the Building Grounds, /give block
 * items (admin), place a small plank platform + pillar + torch through the
 * real blockPlace protocol, then break one block back off (refund). Exits 0
 * when every blockSet replicates and the world bytes match. The build
 * persists in the room state; eyeball it with the client afterwards.
 *
 *   node scripts/make-admin.mjs build_bot   (first time)
 *   node scripts/build-bot.mjs [--x 42 --z 78]
 */
import WebSocket from "ws";
import { loadEnv, makeWorldTracker, sleep, goTo } from "./lib.mjs";

loadEnv();
const MASTER = `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const USER = "build_bot";
const PASS = "devpass1";
const argv = process.argv.slice(2);
const argOf = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 ? parseInt(argv[i + 1], 10) : d;
};
const BX = argOf("--x", 42);
const BZ = argOf("--z", 78);

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

const log = (...a) => console.log("[build]", ...a);
const fail = (m) => {
  console.error("[build] FAIL:", m);
  process.exit(1);
};

function enterRoom(wsUrl, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const state = {
      roomId: null, x: 0, y: 0, z: 0, seq: 0, terrain: null,
      portals: [], transfer: null, inv: null, blockSets: 0, chats: [],
    };
    const tracker = makeWorldTracker();
    state.tracker = tracker;
    const timer = setTimeout(() => reject(new Error("room join timeout")), 10000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome":
          state.roomId = msg.roomId;
          state.x = msg.spawn.x; state.y = msg.spawn.y; state.z = msg.spawn.z;
          break;
        case "world": case "chunks": { const s = tracker.handle(msg); if (s) state.terrain = s; break; }
        case "blockSet": { tracker.handle(msg); state.blockSets++; break; }
        case "portals": state.portals = msg.portals; break;
        case "inv": state.inv = msg; break;
        case "chat": state.chats.push(msg); break;
        case "transfer": state.transfer = msg; break;
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; break;
        case "reject": reject(new Error(`rejected: ${msg.reason}`)); return;
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
  const { token, account } = await api("/api/login", { username: USER, password: PASS });
  if (!account.roles.includes("admin")) fail("build_bot needs admin (run scripts/make-admin.mjs build_bot)");
  let chars = (await api("/api/characters", null, token)).characters;
  if (chars.length === 0) chars = [(await api("/api/characters", { name: "BuildBot" }, token)).character];

  let grant = await api("/api/enter", { characterId: chars[0].id }, token);
  let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
  log(`entered ${state.roomId}`);

  if (state.roomId !== "grounds") {
    if (state.roomId !== "hub") fail(`expected hub, got ${state.roomId}`);
    const portal = state.portals.find((p) => p.target === "grounds");
    if (!portal) fail("no grounds portal");
    if (!(await goTo(ws, state, 64, 93))) fail("never reached the inner gate");
    if (!(await goTo(ws, state, 64, 100))) fail("never passed the gate");
    if (!(await goTo(ws, state, portal.x, portal.z))) fail("never reached the grounds portal");
    ws.send(JSON.stringify({ t: "usePortal", portalId: portal.id }));
    for (let i = 0; i < 100 && !state.transfer; i++) await sleep(100);
    if (!state.transfer) fail("no transfer grant");
    ws.close();
    ({ ws, state } = await enterRoom(state.transfer.wsUrl, state.transfer.ticket));
    if (state.roomId !== "grounds") fail(`landed in ${state.roomId}`);
    log("at the building grounds");
  }

  // stock up (admin) — block items land in the first free hotbar slots
  for (const item of ["block_planks", "block_torch"]) {
    ws.send(JSON.stringify({ t: "chat", text: `/give ${item} 30` }));
    await sleep(150);
  }
  await sleep(500);
  if (!state.inv) fail("no inventory sync");
  const slotOf = (item) => state.inv.slots.findIndex((s) => s && s.item === item);

  // stand near the site and stack a platform + pillar + torch
  if (!(await goTo(ws, state, BX + 3, BZ + 3, 1.0))) fail("never reached the build site");
  const gy = Math.round(state.terrain.heightAt(BX, BZ)); // first air cell of the column
  const place = (item, x, y, z) =>
    ws.send(JSON.stringify({ t: "blockPlace", slot: slotOf(item), x, y, z }));
  const cells = [
    [BX, gy, BZ], [BX + 1, gy, BZ], [BX, gy, BZ + 1], [BX + 1, gy, BZ + 1], // 2x2 platform
    [BX, gy + 1, BZ], // pillar
  ];
  for (const [x, y, z] of cells) {
    place("block_planks", x, y, z);
    await sleep(150);
  }
  place("block_torch", BX, gy + 2, BZ);
  await sleep(700);

  if (state.blockSets < 6) {
    fail(`only ${state.blockSets}/6 block placements replicated: ${state.chats.filter((c) => c.channel === "system").map((c) => c.text).join(" | ")}`);
  }
  const world = state.terrain;
  if (!world.get || world.get(BX, gy, BZ) === 0) fail("placed block missing from the tracked world");

  // break one platform corner back off (refunds the plank)
  ws.send(JSON.stringify({ t: "blockBreak", x: BX + 1, y: gy, z: BZ + 1 }));
  await sleep(500);
  if (state.blockSets < 7) fail("break never replicated");
  if (world.get(BX + 1, gy, BZ + 1) !== 0) fail("broken block still present");

  log(`built a plank platform + pillar + torch at (${BX},${gy},${BZ}) and broke one corner — BUILD OK`);
  ws.close();
  process.exit(0);
};

main().catch((e) => fail(e.message));
