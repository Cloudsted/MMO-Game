/**
 * Sprite proof sheet — Layer-4 verification for the mob/NPC billboard pipeline.
 *
 * build-assets.mjs extracts each entity sheet from a source cell and trims it to
 * the union bbox of its 12 frames. That's exactly the step where a wrong char
 * cell, an off-grid sheet half, or a baked-in drop shadow silently ships. This
 * renders EVERY extracted sheet in client/assets/sprites/ as one labelled grid —
 * name, frame size, all 12 frames — so a single look clears the whole roster.
 *
 * Baked drop shadows are the sneaky one: they look fine on a contact sheet and
 * then float a dark ellipse in mid-air on a billboard. Look at the bottom of
 * each sprite's frames.
 *
 *   node tools/sprite-proof.mjs [--filter substr] [--per 8]
 */
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { text } from "./pixelfont.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPRITES = resolve(ROOT, "client", "assets", "sprites");
const OUTDIR = resolve(ROOT, "tools", "out", "sheets");

const flag = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const filter = flag("filter", null);
const PER = parseInt(flag("per", "8"), 10);

const manifestPath = resolve(SPRITES, "sprites.json");
if (!existsSync(manifestPath)) {
  console.error("no client/assets/sprites/sprites.json — run: node tools/build-assets.mjs");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let keys = Object.keys(manifest.sheets);
if (filter) keys = keys.filter((k) => k.includes(filter));
if (!keys.length) { console.error(`no sprites match "${filter}"`); process.exit(1); }

const SC = 2;
const PAD = 6;
const LBL = 2;
const HDR = 18;

function px(out, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
  const i = (y * out.width + x) * 4;
  out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255;
}
function checker(out, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const on = ((Math.floor((x - x0) / 8) + Math.floor((y - y0) / 8)) & 1) === 0;
    const v = on ? 58 : 42;
    px(out, x, y, v, v, v);
  }
}

for (let b = 0; b < keys.length; b += PER) {
  const chunk = keys.slice(b, b + PER);
  const metas = chunk.map((k) => {
    const m = manifest.sheets[k];
    const png = PNG.sync.read(readFileSync(resolve(SPRITES, `${k}.png`)));
    return { k, m, png, bw: m.frameW * 3 * SC, bh: m.frameH * 4 * SC };
  });
  const colW = Math.max(...metas.map((x) => x.bw)) + PAD * 2;
  const rowH = Math.max(...metas.map((x) => x.bh)) + PAD * 2 + HDR;
  const cols = Math.min(4, metas.length);
  const rows = Math.ceil(metas.length / cols);
  const out = new PNG({ width: cols * colW, height: rows * rowH });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 26; out.data[i + 1] = 26; out.data[i + 2] = 34; out.data[i + 3] = 255; }

  metas.forEach((e, i) => {
    const ox = (i % cols) * colW, oy = Math.floor(i / cols) * rowH;
    text(out, e.k.slice(0, 20), ox + PAD, oy + 3, LBL, [255, 220, 120]);
    text(out, `${e.m.frameW}x${e.m.frameH}`, ox + PAD, oy + 3 + 5 * LBL + 1, LBL, [120, 160, 200]);
    const gx = ox + PAD, gy = oy + HDR + PAD;
    checker(out, gx, gy, e.bw, e.bh);
    for (let y = 0; y < e.bh; y++) {
      for (let x = 0; x < e.bw; x++) {
        const sx = Math.floor(x / SC), sy = Math.floor(y / SC);
        if (sx >= e.png.width || sy >= e.png.height) continue;
        const si = (sy * e.png.width + sx) * 4;
        const a = e.png.data[si + 3];
        if (a === 0) continue;
        const di = ((gy + y) * out.width + (gx + x)) * 4;
        if (gx + x >= out.width || gy + y >= out.height) continue;
        const af = a / 255;
        for (let k = 0; k < 3; k++) out.data[di + k] = Math.round(e.png.data[si + k] * af + out.data[di + k] * (1 - af));
        out.data[di + 3] = 255;
      }
    }
    // frame gridlines: makes a misaligned extraction obvious immediately
    for (let c = 0; c <= 3; c++) for (let y = 0; y < e.bh; y++) px(out, gx + c * e.m.frameW * SC, gy + y, 90, 90, 110);
    for (let r = 0; r <= 4; r++) for (let x = 0; x < e.bw; x++) px(out, gx + x, gy + r * e.m.frameH * SC, 90, 90, 110);
  });

  mkdirSync(OUTDIR, { recursive: true });
  const nm = `spriteproof-${String(b).padStart(2, "0")}.png`;
  writeFileSync(resolve(OUTDIR, nm), PNG.sync.write(out));
  console.log(`wrote tools/out/sheets/${nm} (${out.width}x${out.height}) — ${chunk.join(", ")}`);
}
