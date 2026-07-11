/**
 * Regression probe: mobs stand on real ground, never on tree canopies.
 * Admin-hops (/room) through the wild rooms, /tp's across a coarse grid so
 * the interest radius sweeps every spawn table, and FAILS if any mob's feet
 * rest on leaves/dead_leaves — the treed-boar-pack signature (mobs can't
 * climb, so foliage underfoot always means a bad spawn). Also asserts the
 * `world` header carries the room's nightLight.
 * Needs the probe account to be admin once: node scripts/make-admin.mjs floor_probe
 * Exits 0 on success, 1 on any failed expectation.
 *
 *   node scripts/mob-floor-probe.mjs
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, makeWorldTracker, ROOT, sleep } from "./lib.mjs";

loadEnv();
const MASTER = process.env.MMO_MASTER_ORIGIN ?? `http://127.0.0.1:${process.env.MASTER_PORT ?? 4000}`;
const ROOMS = ["forest", "desert", "gloomfen", "cinderrift"];

const registry = JSON.parse(readFileSync(resolve(ROOT, "shared", "blocks.json"), "utf8").replace(/^﻿/, ""));
const LEAFY = new Set(registry.blocks.filter((b) => b.name === "leaves" || b.name === "dead_leaves").map((b) => b.id));
const SOLID = new Set(registry.blocks.filter((b) => b.solid).map((b) => b.id));

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

const log = (...a) => console.log("[floor-probe]", ...a);
let failed = false;
function expect(cond, what) {
  if (cond) log(`OK   ${what}`);
  else { failed = true; log(`FAIL ${what}`); }
}

/** Join a room and resolve once the whole voxel world has decoded. */
function enterRoom(wsUrl, ticket) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    const tracker = makeWorldTracker();
    const state = {
      roomId: null, x: 0, y: 0, z: 0,
      terrain: null, transfer: null, nightLight: null, ents: new Map(),
    };
    const timer = setTimeout(() => reject(new Error("room join timeout")), 25000);
    ws.on("open", () => ws.send(JSON.stringify({ t: "hello", v: 1, ticket })));
    ws.on("error", (e) => reject(e));
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case "welcome":
          state.roomId = msg.roomId; state.x = msg.spawn.x; state.y = msg.spawn.y; state.z = msg.spawn.z;
          for (const e of msg.ents) state.ents.set(e.id, e);
          break;
        case "world": state.nightLight = msg.nightLight ?? null; tracker.handle(msg); break;
        case "chunks": { const s = tracker.handle(msg); if (s) state.terrain = s; break; }
        case "blockSet": tracker.handle(msg); break;
        case "snap":
          for (const e of msg.enter) state.ents.set(e.id, e);
          for (const d of msg.ents) { const e = state.ents.get(d.id); if (e) Object.assign(e, d); }
          for (const id of msg.leave) state.ents.delete(id);
          break;
        case "transfer": state.transfer = msg; break;
        case "correct": state.x = msg.x; state.y = msg.y; state.z = msg.z; break;
        case "reject": clearTimeout(timer); reject(new Error(`rejected: ${msg.reason}`)); return;
      }
      if (state.roomId && state.terrain && !state.ready) {
        state.ready = true;
        clearTimeout(timer);
        resolvePromise({ ws, state });
      }
    });
  });
}

async function waitTransfer(state, ms = 10000) {
  for (let i = 0; i < ms / 100; i++) {
    if (state.transfer) return state.transfer;
    await sleep(100);
  }
  return null;
}

/** Admin-chat travel: /room <id>, wait for the grant, reconnect. */
async function gotoRoom(ws, state, roomId) {
  if (state.roomId === roomId) return { ws, state };
  state.transfer = null;
  ws.send(JSON.stringify({ t: "chat", text: `/room ${roomId}` }));
  const t = await waitTransfer(state);
  if (!t) throw new Error(`/room ${roomId}: no transfer granted (admin? run: node scripts/make-admin.mjs floor_probe)`);
  ws.close();
  return enterRoom(t.wsUrl, t.ticket);
}

await api("/api/register", { username: "floor_probe", password: "devpass1" }).catch(() => {});
const { token } = await api("/api/login", { username: "floor_probe", password: "devpass1" });
let { characters } = await api("/api/characters", null, token);
if (!characters.length) characters = [(await api("/api/characters", { name: "FloorProbe" }, token)).character];
const grant = await api("/api/enter", { characterId: characters[0].id }, token);

let { ws, state } = await enterRoom(grant.wsUrl, grant.ticket);
let checkedTotal = 0;

for (const roomId of ROOMS) {
  ({ ws, state } = await gotoRoom(ws, state, roomId));
  expect(typeof state.nightLight === "number" && state.nightLight > 0, `${roomId}: world header carries nightLight (${state.nightLight})`);

  // sweep a coarse grid so interest (r=64) covers every spawn table
  const seen = new Map(); // mob id → last snapshot
  for (let z = 45; z < state.terrain.h; z += 90) {
    for (let x = 45; x < state.terrain.w; x += 90) {
      ws.send(JSON.stringify({ t: "chat", text: `/tp ${x} ${z}` }));
      await sleep(600); // a few snapshot intervals at the new spot
      for (const e of state.ents.values()) if (e.kind === "mob") seen.set(e.id, { ...e });
    }
  }

  // TREED = standing on leaf-family blocks with a real walkable floor well
  // BELOW — a canopy always has ground underneath. Leaf blocks AT floor
  // level are legitimate: the tier-3 lion-den prefab authors a dead_leaves
  // LITTER FLOOR and binds a lioness guard table, so its cats stand on
  // their own bedding (a probabilistic false positive this probe used to
  // flag — pre-existing, caught 2026-07-11).
  const floorAt = (xi, zi) => {
    for (let y = 1; y < 46; y++) {
      if (!SOLID.has(state.terrain.get(xi, y - 1, zi))) continue;
      if (SOLID.has(state.terrain.get(xi, y, zi)) || SOLID.has(state.terrain.get(xi, y + 1, zi))) continue;
      return y;
    }
    return -1;
  };
  let onLeaves = 0;
  for (const m of seen.values()) {
    const underY = Math.round(m.y) - 1;
    for (const [ox, oz] of [[0, 0], [0.25, 0.25], [0.25, -0.25], [-0.25, 0.25], [-0.25, -0.25]]) {
      const xi = Math.floor(m.x + ox);
      const zi = Math.floor(m.z + oz);
      if (LEAFY.has(state.terrain.get(xi, underY, zi))) {
        const fl = floorAt(xi, zi);
        if (fl >= 0 && fl >= Math.round(m.y) - 2) break; // leaf-floored den litter, not a canopy
        onLeaves++;
        log(`     ${m.name ?? "mob"} #${m.id} ON leaves at ${m.x.toFixed(1)},${m.y.toFixed(1)},${m.z.toFixed(1)}`);
        break;
      }
    }
  }
  expect(onLeaves === 0, `${roomId}: 0/${seen.size} mobs standing on canopies`);
  checkedTotal += seen.size;
}

expect(checkedTotal >= 30, `swept a meaningful population (${checkedTotal} mobs total)`);
ws.close();
log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
