/**
 * Icon proof sheet — the "look at what you shipped" artifact.
 *
 * Renders one row per non-block item: NAME | its icon, magnified, captioned with
 * the [col,row] it points at and the catalog's name for that cell. Ladders read
 * top-to-bottom in items.json order, so a mis-tiered weapon is obvious at a glance.
 *
 * Pair it with tools/verify-icons.mjs: that one machine-checks bounds, emptiness,
 * duplicates and category agreement; this one is for the judgement calls a machine
 * can't make (does the "rusty" sword actually look rustier than the iron one?).
 *
 *   node tools/icon-proof.mjs [--rows 18]
 */
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { text, px } from "./pixelfont.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTDIR = resolve(ROOT, "tools", "out", "sheets");
const sheet = PNG.sync.read(readFileSync(resolve(ROOT, "assets/time-fantasy/IconSet/tficons_limited_16.png")));

const flag = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const ROWS_PER = parseInt(flag("rows", "18"), 10);

const items = JSON.parse(readFileSync(resolve(ROOT, "shared/items.json"), "utf8").replace(/^﻿/, "")).items;

// cell -> catalog name, so each row can be captioned with what the sheet says it is
const catalog = new Map();
const CAT_DIR = resolve(ROOT, "docs/asset-catalog");
if (existsSync(CAT_DIR)) {
  for (const f of readdirSync(CAT_DIR)) {
    if (!/^icons-r.*\.json$/.test(f)) continue;
    for (const c of JSON.parse(readFileSync(resolve(CAT_DIR, f), "utf8")).cells ?? []) catalog.set(`${c.c},${c.r}`, c.name);
  }
}

const SC = 5;
const CELL = 16 * SC;
const PAD = 8;
const LBL = 2;

function checker(out, x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const on = ((Math.floor((x - x0) / (SC * 2)) + Math.floor((y - y0) / (SC * 2))) & 1) === 0;
    const v = on ? 58 : 42;
    px(out, x, y, v, v, v);
  }
}
function blit(c, r, out, dx, dy) {
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const si = ((r * 16 + Math.floor(y / SC)) * sheet.width + (c * 16 + Math.floor(x / SC))) * 4;
    const a = sheet.data[si + 3];
    if (a === 0) continue;
    const gx = dx + x, gy = dy + y;
    if (gx < 0 || gx >= out.width || gy < 0 || gy >= out.height) continue;
    const di = (gy * out.width + gx) * 4;
    const af = a / 255;
    for (let k = 0; k < 3; k++) out.data[di + k] = Math.round(sheet.data[si + k] * af + out.data[di + k] * (1 - af));
    out.data[di + 3] = 255;
  }
}

const rows = Object.entries(items)
  .filter(([, d]) => !d.block)
  .map(([id, d]) => ({ id, cell: d.icon, kind: d.kind, cat: catalog.get(d.icon.join(",")) ?? "?" }));

const nameW = 4 * LBL * 24 + 10;
const catW = 4 * LBL * 26 + 10;
const W = nameW + PAD + CELL + PAD + catW + PAD;
const rowH = Math.max(CELL, 3 * (5 * LBL + 3)) + 10;

mkdirSync(OUTDIR, { recursive: true });
for (let b = 0; b < rows.length; b += ROWS_PER) {
  const chunk = rows.slice(b, b + ROWS_PER);
  const H = 24 + chunk.length * rowH;
  const out = new PNG({ width: W, height: H });
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 26; out.data[i + 1] = 26; out.data[i + 2] = 34; out.data[i + 3] = 255; }
  text(out, "SHIPPED ITEM ICONS: ID / ICON / CELL + SHEET NAME", PAD, 6, LBL, [255, 220, 120]);

  chunk.forEach((row, i) => {
    const y = 24 + i * rowH;
    text(out, row.id.slice(0, 24), PAD, y + 6, LBL, [210, 210, 220]);
    text(out, row.kind.slice(0, 24), PAD, y + 6 + 5 * LBL + 3, LBL, [120, 130, 150]);
    const x = nameW + PAD;
    checker(out, x, y, CELL, CELL);
    blit(row.cell[0], row.cell[1], out, x, y);
    const cx = x + CELL + PAD;
    text(out, `${row.cell[0]},${row.cell[1]}`, cx, y + 6, LBL, [140, 240, 160]);
    text(out, row.cat.slice(0, 26), cx, y + 6 + 5 * LBL + 3, LBL, [170, 170, 180]);
  });

  const nm = `iconproof-${String(b).padStart(2, "0")}.png`;
  writeFileSync(resolve(OUTDIR, nm), PNG.sync.write(out));
  console.log(`wrote tools/out/sheets/${nm} (${W}x${H})`);
}
