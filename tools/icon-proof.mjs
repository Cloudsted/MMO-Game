/**
 * Icon proof sheets — the verification artifact for the icon remap.
 *
 * Two modes:
 *   candidates  (default) one row per item: name | OLD icon | the top-N ranked
 *               new-sheet candidates, each captioned with its [c,r] and IoU.
 *               This is what a reviewer looks at to CHOOSE.
 *   final       one row per item: name | OLD icon | the icon that shared/items.json
 *               currently points at, in the NEW sheet. This is what proves the
 *               shipped mapping is right — every row must read "same thing, nicer".
 *
 *   node tools/icon-proof.mjs [--mode candidates|final] [--rows 13]
 */
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { text, textW, px } from "./pixelfont.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTDIR = resolve(ROOT, "tools", "out", "sheets");
const oldPng = PNG.sync.read(readFileSync(resolve(ROOT, "assets/time-fantasy/IconSet/tf_icon_16.png")));
const newPng = PNG.sync.read(readFileSync(resolve(ROOT, "assets/time-fantasy/IconSet/tficons_limited_16.png")));

const flag = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const mode = flag("mode", "candidates");
const ROWS_PER = parseInt(flag("rows", "13"), 10);

const SC = 4; // icon magnification
const CELL = 16 * SC;
const PAD = 8;
const NAMEW = 4 * 4 * 26; // room for a 26-char id at scale 4... trimmed below
const LBL = 2;

function checker(out, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const on = ((Math.floor((x - x0) / (SC * 2)) + Math.floor((y - y0) / (SC * 2))) & 1) === 0;
    const v = on ? 58 : 42;
    px(out, x, y, v, v, v);
  }
}
function blit(src, c, r, out, dx, dy) {
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const sx = c * 16 + Math.floor(x / SC), sy = r * 16 + Math.floor(y / SC);
    const si = (sy * src.width + sx) * 4;
    const a = src.data[si + 3];
    if (a === 0) continue;
    const di = ((dy + y) * out.width + (dx + x)) * 4;
    if (dx + x < 0 || dx + x >= out.width || dy + y < 0 || dy + y >= out.height) continue;
    const af = a / 255;
    for (let k = 0; k < 3; k++) out.data[di + k] = Math.round(src.data[si + k] * af + out.data[di + k] * (1 - af));
    out.data[di + 3] = 255;
  }
}

// ---------- build rows ----------
const rows = [];
if (mode === "final") {
  const items = JSON.parse(readFileSync(resolve(ROOT, "shared/items.json"), "utf8").replace(/^﻿/, "")).items;
  const prev = JSON.parse(readFileSync(resolve(ROOT, "docs/asset-catalog/icon-remap-candidates.json"), "utf8"));
  const oldOf = Object.fromEntries(prev.entries.filter((e) => e.id).map((e) => [e.id, e.old]));
  for (const [id, def] of Object.entries(items)) {
    if (def.block) continue;
    rows.push({ label: id, old: oldOf[id] ?? null, cells: [{ cell: def.icon, tag: "shipped" }] });
  }
} else {
  const cand = JSON.parse(readFileSync(resolve(ROOT, "docs/asset-catalog/icon-remap-candidates.json"), "utf8"));
  for (const e of cand.entries) {
    if (!e.candidates) continue;
    rows.push({
      label: e.id ?? `${e.old[0]},${e.old[1]}`,
      old: e.old,
      cells: e.candidates.map((c) => ({ cell: c.cell, tag: `${c.iou.toFixed(2)}` })),
    });
  }
}

const maxCells = Math.max(...rows.map((r) => r.cells.length));
const nameW = 4 * LBL * 24 + 10;
const W = nameW + PAD + (CELL + PAD) + 30 + maxCells * (CELL + PAD + 6) + PAD;
const rowH = CELL + 8 + 5 * LBL + 6;

mkdirSync(OUTDIR, { recursive: true });
for (let b = 0; b < rows.length; b += ROWS_PER) {
  const chunk = rows.slice(b, b + ROWS_PER);
  const H = 24 + chunk.length * rowH;
  const out = new PNG({ width: W, height: H });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 26; out.data[i + 1] = 26; out.data[i + 2] = 34; out.data[i + 3] = 255; }
  text(out, mode === "final" ? "SHIPPED MAPPING: OLD > NEW" : "CANDIDATES: OLD > RANKED NEW (IOU)", PAD, 6, LBL, [255, 220, 120]);

  chunk.forEach((row, i) => {
    const y = 24 + i * rowH;
    text(out, row.label.slice(0, 24), PAD, y + (CELL >> 1) - 3, LBL, [200, 200, 210]);
    let x = nameW + PAD;
    if (row.old) {
      checker(out, x, y, CELL, CELL);
      blit(oldPng, row.old[0], row.old[1], out, x, y);
      text(out, `${row.old[0]},${row.old[1]}`, x, y + CELL + 3, LBL, [130, 130, 140]);
    }
    x += CELL + PAD;
    text(out, ">", x + 4, y + (CELL >> 1) - 3, LBL, [255, 220, 120]);
    x += 30;
    row.cells.forEach((c, ci) => {
      checker(out, x, y, CELL, CELL);
      blit(newPng, c.cell[0], c.cell[1], out, x, y);
      const best = ci === 0;
      text(out, `${c.cell[0]},${c.cell[1]}`, x, y + CELL + 3, LBL, best ? [140, 240, 160] : [170, 170, 180]);
      text(out, c.tag, x, y + CELL + 3 + 5 * LBL + 2, LBL, best ? [140, 240, 160] : [130, 130, 140]);
      x += CELL + PAD + 6;
    });
  });

  const nm = `iconproof-${mode}-${String(b).padStart(2, "0")}.png`;
  writeFileSync(resolve(OUTDIR, nm), PNG.sync.write(out));
  console.log(`wrote tools/out/sheets/${nm} (${W}x${H})`);
}
