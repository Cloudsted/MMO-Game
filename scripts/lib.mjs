import { readFileSync, existsSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** BOM-tolerant .env loader (PowerShell writes UTF-8 BOM). */
export function loadEnv() {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return;
  let text = readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
  }
}

export function isPortOpen(port, host = "127.0.0.1") {
  return new Promise((res) => {
    const sock = connect({ port, host, timeout: 900 });
    sock.on("connect", () => {
      sock.destroy();
      res(true);
    });
    sock.on("error", () => res(false));
    sock.on("timeout", () => {
      sock.destroy();
      res(false);
    });
  });
}

export async function waitForPort(port, label, tries = 60, delayMs = 500) {
  for (let i = 0; i < tries; i++) {
    if (await isPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`${label} never came up on port ${port}`);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// solid flags from the shared block registry (walkability for bots)
const SOLID = (() => {
  const file = JSON.parse(readFileSync(resolve(ROOT, "shared", "blocks.json"), "utf8").replace(/^﻿/, ""));
  const solid = new Uint8Array(256);
  for (const b of file.blocks) solid[b.id] = b.solid ? 1 : 0;
  return solid;
})();

const CHUNK = 16;

/**
 * Grid BFS over the block world: 4-way, a step is walkable when the stand
 * height changes by at most 1 block. Returns cell-center waypoints to the
 * reachable cell nearest the target (bots own the whole world, so real
 * pathfinding beats greedy steering in tree mazes).
 */
export function findPath(terrain, sx, sz, tx, tz) {
  const w = terrain.w, h = terrain.h;
  const sxi = Math.floor(sx), szi = Math.floor(sz);
  const txi = Math.max(0, Math.min(w - 1, Math.floor(tx)));
  const tzi = Math.max(0, Math.min(h - 1, Math.floor(tz)));
  const key = (x, z) => x + z * w;
  const prev = new Map([[key(sxi, szi), -1]]);
  const queue = [[sxi, szi]];
  let best = [sxi, szi];
  let bestD = Math.hypot(sxi - txi, szi - tzi);
  const standAt = (x, z) => terrain.heightAt(x + 0.5, z + 0.5);
  for (let head = 0; head < queue.length && head < 60000; head++) {
    const [x, z] = queue[head];
    const d = Math.hypot(x - txi, z - tzi);
    if (d < bestD) {
      bestD = d;
      best = [x, z];
      if (d === 0) break;
    }
    const y = standAt(x, z);
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      if (nx < 1 || nx >= w - 1 || nz < 1 || nz >= h - 1) continue;
      const k = key(nx, nz);
      if (prev.has(k)) continue;
      if (Math.abs(standAt(nx, nz) - y) > 1.05) continue;
      prev.set(k, key(x, z));
      queue.push([nx, nz]);
    }
  }
  // rebuild the path to the best-reached cell
  const path = [];
  let k = key(best[0], best[1]);
  while (k !== -1) {
    path.push([(k % w) + 0.5, Math.floor(k / w) + 0.5]);
    k = prev.get(k);
  }
  path.reverse();
  return path;
}

/**
 * Path-following travel: BFS a route, then walk it waypoint by waypoint with
 * 20 Hz move packets, y glued to the stand height (adjacent cells differ by
 * ≤1 block, which the server accepts). Falls back near the goal.
 */
export async function goTo(ws, state, tx, tz, stopDist = 0.8, depth = 0) {
  if (depth > 4) return false;
  const HZ = 20;
  const SPEED = 4.0;
  const path = findPath(state.terrain, state.x, state.z, tx, tz);
  // feet must ride the TALLEST column the body overlaps mid-crossing, or the
  // AABB clips the next step block and the server rejects the move (real
  // clients jump; bots pre-raise instead)
  const R = 0.31;
  const footY = (x, z) => Math.max(
    state.terrain.heightAt(x, z),
    state.terrain.heightAt(x - R, z),
    state.terrain.heightAt(x + R, z),
    state.terrain.heightAt(x, z - R),
    state.terrain.heightAt(x, z + R)
  );
  for (const [wx, wz] of path) {
    let guard = 0;
    while (Math.hypot(wx - state.x, wz - state.z) > 0.3) {
      if (Math.hypot(tx - state.x, tz - state.z) <= stopDist) return true;
      const dx = wx - state.x;
      const dz = wz - state.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(SPEED / HZ, d);
      state.x += (dx / d) * step;
      state.z += (dz / d) * step;
      state.y = footY(state.x, state.z);
      state.seq++;
      ws.send(JSON.stringify({ t: "move", seq: state.seq, x: state.x, y: state.y, z: state.z, yaw: Math.atan2(dx, dz), anim: "move" }));
      await sleep(1000 / HZ);
      if (++guard > 80) break; // corrections fighting us — replan
    }
    if (guard > 80) return goTo(ws, state, tx, tz, stopDist, depth + 1);
  }
  return Math.hypot(tx - state.x, tz - state.z) <= stopDist + 1.5;
}


/**
 * Voxel world tracker for bots: feed it `world` + `chunks` messages; once
 * complete it exposes the same `heightAt(x,z)` sampler the old terrain
 * message provided (feet level standing on the top solid block).
 */
export function makeWorldTracker() {
  let w = 0, h = 0, height = 0, total = Infinity, got = 0;
  let data = null;
  const tracker = {
    /** returns the ready sampler when the last chunk lands, else null */
    handle(msg) {
      if (msg.t === "world") {
        w = msg.w;
        h = msg.h;
        height = msg.height;
        total = msg.chunks;
        got = 0;
        data = new Uint8Array(w * h * height);
        return null;
      }
      if (msg.t === "chunks" && data) {
        for (const c of msg.batch) {
          const raw = inflateRawSync(Buffer.from(c.data, "base64"));
          let i = 0;
          for (let y = 0; y < height; y++) {
            for (let lz = 0; lz < CHUNK; lz++) {
              for (let lx = 0; lx < CHUNK; lx++, i++) {
                const x = c.cx * CHUNK + lx, z = c.cz * CHUNK + lz;
                if (x < w && z < h) data[x + z * w + y * w * h] = raw[i];
              }
            }
          }
          got++;
        }
        if (got >= total) return tracker.sampler();
      }
      if (msg.t === "blockSet" && data) {
        const { x, y, z, id } = msg;
        if (x >= 0 && x < w && y >= 0 && y < height && z >= 0 && z < h) data[x + z * w + y * w * h] = id;
      }
      return null;
    },
    sampler() {
      return {
        w,
        h,
        get(x, y, z) {
          if (x < 0 || x >= w || y < 0 || y >= height || z < 0 || z >= h) return 0;
          return data[x + z * w + y * w * h];
        },
        /** feet Y standing on the column's top solid block */
        heightAt(x, z) {
          const xi = Math.min(Math.max(Math.floor(x), 0), w - 1);
          const zi = Math.min(Math.max(Math.floor(z), 0), h - 1);
          for (let y = height - 1; y >= 0; y--) {
            if (SOLID[data[xi + zi * w + y * w * h]]) return y + 1;
          }
          return 1;
        },
      };
    },
  };
  return tracker;
}
