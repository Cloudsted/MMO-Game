/**
 * Contact-sheet renderer — the "look at the sheet before you map it" tool.
 *
 * LESSONS.md rule: never trust a coordinate you haven't seen. This renders any
 * source sheet as a magnified, grid-lined, coordinate-LABELLED image (written
 * to tools/out/sheets/) so a human or an agent can read cell indices straight
 * off the picture and cite them.
 *
 * Modes
 *   --mode grid   (default)  uniform cell grid; labels are [col,row]
 *   --mode chars             RPG-Maker walk sheet: 8 characters (4 across x 2
 *                            down), each 3x4 frames. Renders each character's
 *                            down-facing idle frame, labelled with its
 *                            char:[cx,cy] — the exact tuple build-assets.mjs
 *                            wants. Off-grid sheets (single: true) are drawn
 *                            whole with --single.
 *
 * Usage
 *   node tools/contact-sheet.mjs <src.png> [--cell 16] [--scale 6] [--band 8]
 *        [--mode grid|chars] [--single] [--name out-prefix] [--checker]
 *
 * Big sheets are emitted in horizontal BANDS of --band rows so each written
 * PNG stays small enough to read at a glance (a 16x64 icon sheet at scale 6
 * would otherwise be 1024x4096).
 */
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTDIR = resolve(ROOT, "tools", "out", "sheets");

// ---------- tiny 3x5 bitmap font (digits, comma, colon, letters we need) ----------
const FONT = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ",": ["000", "000", "000", "010", "100"],
  ":": ["000", "010", "000", "010", "000"],
  "-": ["000", "000", "111", "000", "000"],
  "[": ["011", "010", "010", "010", "011"],
  "]": ["110", "010", "010", "010", "110"],
  "c": ["000", "011", "100", "100", "011"],
  "r": ["000", "110", "101", "100", "100"],
  " ": ["000", "000", "000", "000", "000"],
};

function px(png, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4;
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
}

/** Draw `text` with its top-left at (x,y), each font pixel `s` screen px. */
function text(png, str, x, y, s, rgb = [255, 255, 255]) {
  let cx = x;
  for (const ch of String(str)) {
    const glyph = FONT[ch] ?? FONT[" "];
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy][gx] !== "1") continue;
        for (let sy = 0; sy < s; sy++) {
          for (let sx = 0; sx < s; sx++) px(png, cx + gx * s + sx, y + gy * s + sy, rgb[0], rgb[1], rgb[2]);
        }
      }
    }
    cx += 4 * s;
  }
}
const textW = (str, s) => String(str).length * 4 * s;

/** Nearest-neighbour blit of a source region, magnified by `scale`. */
function blitScaled(src, sx, sy, sw, sh, dst, dx, dy, scale) {
  for (let y = 0; y < sh * scale; y++) {
    for (let x = 0; x < sw * scale; x++) {
      const px0 = sx + Math.floor(x / scale);
      const py0 = sy + Math.floor(y / scale);
      if (px0 < 0 || py0 < 0 || px0 >= src.width || py0 >= src.height) continue;
      const si = (py0 * src.width + px0) * 4;
      const a = src.data[si + 3];
      if (a === 0) continue; // let the checkerboard show through
      const di = ((dy + y) * dst.width + (dx + x)) * 4;
      if (dx + x < 0 || dx + x >= dst.width || dy + y < 0 || dy + y >= dst.height) continue;
      // alpha-over onto the background
      const af = a / 255;
      for (let k = 0; k < 3; k++) dst.data[di + k] = Math.round(src.data[si + k] * af + dst.data[di + k] * (1 - af));
      dst.data[di + 3] = 255;
    }
  }
}

function fillChecker(png, x0, y0, w, h, size) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const on = ((Math.floor((x - x0) / size) + Math.floor((y - y0) / size)) & 1) === 0;
      const v = on ? 58 : 42;
      px(png, x, y, v, v, v);
    }
  }
}

function fillRect(png, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(png, x, y, rgb[0], rgb[1], rgb[2]);
}

function save(png, name) {
  mkdirSync(OUTDIR, { recursive: true });
  const p = resolve(OUTDIR, name);
  writeFileSync(p, PNG.sync.write(png));
  console.log(`wrote tools/out/sheets/${name} (${png.width}x${png.height})`);
}

function cellIsEmpty(src, x0, y0, w, h) {
  for (let y = y0; y < Math.min(y0 + h, src.height); y++)
    for (let x = x0; x < Math.min(x0 + w, src.width); x++)
      if (src.data[(y * src.width + x) * 4 + 3] > 8) return false;
  return true;
}

// ---------- args ----------
const argv = process.argv.slice(2);
if (!argv.length) {
  console.error("usage: node tools/contact-sheet.mjs <src.png> [--cell 16] [--scale 6] [--band 8] [--mode grid|chars] [--single] [--name prefix]");
  process.exit(1);
}
const srcPath = resolve(ROOT, argv[0]);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

const mode = flag("mode", "grid");
const scale = parseInt(flag("scale", "6"), 10);
const band = parseInt(flag("band", "8"), 10);
const name = flag("name", basename(srcPath).replace(/\.png$/i, ""));
const src = PNG.sync.read(readFileSync(srcPath));

const GRIDC = [90, 90, 110];
const HDR = [26, 26, 34];

if (mode === "chars") {
  // ---- RPG-Maker walk sheet: 8 chars (4 across x 2 down), each 3x4 frames ----
  const single = has("single");
  const frameW = Math.floor(src.width / (single ? 3 : 12));
  const frameH = Math.floor(src.height / (single ? 4 : 8));
  let cols = single ? 1 : 4, rows = single ? 1 : 2;
  // --char cx,cy renders ONE character big (the classification zoom)
  const only = flag("char", null);
  let onlyX = 0, onlyY = 0;
  if (only) {
    [onlyX, onlyY] = only.split(",").map(Number);
    cols = 1; rows = 1;
  }
  console.log(`chars mode: frame ${frameW}x${frameH}, ${cols}x${rows} characters`);

  const s = Math.max(2, scale);
  const pad = 6;
  const labelH = 16;
  // draw ALL 12 frames per character so the walk cycle + facings are visible
  const blockW = 3 * frameW * s, blockH = 4 * frameH * s;
  const cw = blockW + pad * 2, chh = blockH + pad * 2 + labelH;
  const out = new PNG({ width: cols * cw, height: rows * chh });
  fillRect(out, 0, 0, out.width, out.height, HDR);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const ox = cx * cw, oy = cy * chh;
      const gx = only ? onlyX : cx, gy = only ? onlyY : cy;
      const bx = gx * 3 * frameW, by = gy * 4 * frameH;
      fillChecker(out, ox + pad, oy + labelH + pad, blockW, blockH, s * 2);
      blitScaled(src, bx, by, 3 * frameW, 4 * frameH, out, ox + pad, oy + labelH + pad, s);
      // frame grid
      for (let i = 0; i <= 3; i++)
        for (let y = 0; y < blockH; y++) px(out, ox + pad + i * frameW * s, oy + labelH + pad + y, ...GRIDC);
      for (let j = 0; j <= 4; j++)
        for (let x = 0; x < blockW; x++) px(out, ox + pad + x, oy + labelH + pad + j * frameH * s, ...GRIDC);
      const lbl = single ? "single" : `${gx},${gy}`;
      text(out, lbl, ox + pad, oy + 4, 2, [255, 220, 120]);
    }
  }
  save(out, only ? `${name}-char${onlyX}${onlyY}.png` : `${name}-chars.png`);
} else {
  // ---- uniform cell grid with [col,row] labels, emitted in row bands ----
  const cellArg = flag("cell", "16");
  const [cwPx, chPx] = cellArg.includes("x") ? cellArg.split("x").map(Number) : [Number(cellArg), Number(cellArg)];
  const totalCols = Math.floor(src.width / cwPx);
  const totalRows = Math.floor(src.height / chPx);
  // --cols A-B renders only that column range (wide tilesets read better split)
  const colRange = flag("cols", null);
  const [c0, c1] = colRange ? colRange.split("-").map(Number) : [0, totalCols - 1];
  const cols = c1 - c0 + 1;
  console.log(`grid mode: ${totalCols}x${totalRows} cells of ${cwPx}x${chPx}; rendering cols ${c0}-${c1}`);

  const lblS = 2;               // font pixel scale
  const gutterL = 4 * 4 * lblS + 8; // room for "r63"
  const gutterT = 5 * lblS + 8;
  const cellW = cwPx * scale, cellH = chPx * scale;
  const labelBelow = 5 * lblS + 4;   // per-cell "c,r" caption under each cell

  for (let b0 = 0; b0 < totalRows; b0 += band) {
    const rowsHere = Math.min(band, totalRows - b0);
    const W = gutterL + cols * (cellW + 2);
    const H = gutterT + rowsHere * (cellH + 2 + labelBelow);
    const out = new PNG({ width: W, height: H });
    fillRect(out, 0, 0, W, H, HDR);

    for (let ci = 0; ci < cols; ci++) {
      const c = c0 + ci;
      const x = gutterL + ci * (cellW + 2) + Math.max(0, (cellW - textW(c, lblS)) >> 1);
      text(out, c, x, 3, lblS, [120, 200, 255]);
    }
    for (let ri = 0; ri < rowsHere; ri++) {
      const r = b0 + ri;
      const y = gutterT + ri * (cellH + 2 + labelBelow);
      text(out, r, 3, y + (cellH >> 1) - 3, lblS, [255, 200, 120]);
      for (let ci = 0; ci < cols; ci++) {
        const c = c0 + ci;
        const x = gutterL + ci * (cellW + 2);
        const empty = cellIsEmpty(src, c * cwPx, r * chPx, cwPx, chPx);
        fillChecker(out, x, y, cellW, cellH, scale * 2);
        if (!empty) blitScaled(src, c * cwPx, r * chPx, cwPx, chPx, out, x, y, scale);
        // border
        for (let i = 0; i < cellW; i++) { px(out, x + i, y - 1, ...GRIDC); px(out, x + i, y + cellH, ...GRIDC); }
        for (let i = 0; i < cellH; i++) { px(out, x - 1, y + i, ...GRIDC); px(out, x + cellW, y + i, ...GRIDC); }
        // caption
        text(out, `${c},${r}`, x, y + cellH + 3, lblS, empty ? [70, 70, 80] : [190, 190, 200]);
      }
    }
    const suffix = colRange ? `-c${c0}-${c1}` : "";
    save(out, `${name}-r${b0}-${b0 + rowsHere - 1}${suffix}.png`);
  }
}
