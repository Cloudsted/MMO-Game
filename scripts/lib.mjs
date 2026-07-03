import { readFileSync, existsSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

/** Decode a `terrain` message into a sampler bots can walk on. */
export function decodeTerrain(msg) {
  const buf = Buffer.from(msg.heightsB64, "base64");
  const vw = msg.w + 1;
  const heights = new Float32Array(vw * (msg.h + 1));
  for (let i = 0; i < heights.length; i++) heights[i] = buf.readInt16LE(i * 2) / 100;
  return {
    w: msg.w,
    h: msg.h,
    heightAt(x, z) {
      const cx = Math.min(Math.max(x, 0), msg.w - 1e-4);
      const cz = Math.min(Math.max(z, 0), msg.h - 1e-4);
      const xi = Math.floor(cx);
      const zi = Math.floor(cz);
      const tx = cx - xi;
      const tz = cz - zi;
      const a = heights[zi * vw + xi];
      const b = heights[zi * vw + xi + 1];
      const c = heights[(zi + 1) * vw + xi];
      const d = heights[(zi + 1) * vw + xi + 1];
      return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    },
  };
}
