/**
 * Bulk contact-sheet renderer: turns every source sheet we might map from into
 * labelled, readable PNGs under tools/out/sheets/, plus an index.json that says
 * which layout each sheet was rendered with.
 *
 * The layout guess is the interesting part. RPG-Maker sheets are either
 *   - "char8": 8 characters in a 4x2 grid, each 3x4 walk frames, or
 *   - "single": one character, 3x4 frames filling the sheet.
 * Nothing in the PNG says which. We infer: a char8 frame is never narrower
 * than ~24px or shorter than ~30px in this library, and any filename carrying
 * "single"/"_full_" is authoritative. Ambiguous sheets are rendered BOTH ways
 * so the classifier can see which reading is coherent, rather than trusting a
 * heuristic that has no way to be right every time.
 *
 *   node tools/render-sheets.mjs [--only <substr>]
 */
import { PNG } from "pngjs";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "assets", "time-fantasy");
const OUTDIR = resolve(ROOT, "tools", "out", "sheets");
const CS = resolve(ROOT, "tools", "contact-sheet.mjs");

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

function run(args) {
  execFileSync(process.execPath, [CS, ...args], { stdio: "pipe" });
}
function dims(p) {
  const png = PNG.sync.read(readFileSync(p));
  return [png.width, png.height];
}

const index = { sheets: [] };

// ---------- 1. icon sheets (uniform 16px grids) ----------
const ICON_JOBS = [
  { path: "IconSet/tficons_limited_16.png", name: "newicons", band: 8, scale: 5 },
  // the little themed icon strips that came with the drop
  ...[
    "icons_accessoriesA_16", "icons_armorset_16", "icons_cloaks_16", "icons_feet_16",
    "icons_formalclothes_16", "icons_gloves_16", "icons_helm_16", "icons_lightarmor_16",
    "icons_midarmor_16", "icons_misc1_16", "icons_misc2_16", "icons_misc3_16",
    "icons_skillsa_16", "icons_tools_16", "icons_ui_16",
    "marrows_icon16", "mshields_icon16", "mskills_icon16", "mskills2_icon16",
    "mspears_icon16", "mstaffs_icon16", "mswords_icon16",
  ].map((n) => ({ path: `Unsorted/${n}.png`, name: n, band: 8, scale: 6 })),
];
for (const job of ICON_JOBS) {
  if (only && !job.path.includes(only)) continue;
  const src = resolve(SRC, job.path);
  run([src, "--cell", "16", "--scale", String(job.scale), "--band", String(job.band), "--name", job.name]);
  const [w, h] = dims(src);
  index.sheets.push({ src: `assets/time-fantasy/${job.path}`, name: job.name, layout: "grid16", cols: w / 16, rows: h / 16 });
  console.log(`icons: ${job.name}`);
}

// ---------- 2. wide world tilesets (16px grid, split into column halves) ----------
const TILE_JOBS = [
  { path: "Time Fantasy/TILESETS/ruindungeons_sheet_full.png", name: "ruindungeons" },
];
for (const job of TILE_JOBS) {
  if (only && !job.path.includes(only)) continue;
  const src = resolve(SRC, job.path);
  const [w, h] = dims(src);
  const cols = Math.floor(w / 16);
  const mid = Math.floor(cols / 2);
  run([src, "--cell", "16", "--scale", "5", "--band", "8", "--cols", `0-${mid - 1}`, "--name", job.name]);
  run([src, "--cell", "16", "--scale", "5", "--band", "8", "--cols", `${mid}-${cols - 1}`, "--name", job.name]);
  index.sheets.push({ src: `assets/time-fantasy/${job.path}`, name: job.name, layout: "grid16", cols, rows: Math.floor(h / 16) });
  console.log(`tileset: ${job.name} (${cols}x${Math.floor(h / 16)}, split at col ${mid})`);
}

// ---------- 3. character sheets ----------
const UNSORTED = resolve(SRC, "Unsorted");
for (const f of readdirSync(UNSORTED)) {
  if (!f.endsWith(".png")) continue;
  if (/^icons_|_icon16\.png$|^pointersb|^witchtiles/.test(f)) continue; // handled above / not characters
  if (only && !f.includes(only)) continue;
  const src = resolve(UNSORTED, f);
  const [w, h] = dims(src);
  const name = basename(f, ".png").replace(/[^a-zA-Z0-9_-]/g, "_");
  const forcedSingle = /single|_full_|_reg\.png$/.test(f);
  const char8Valid = w % 12 === 0 && h % 8 === 0 && w / 12 >= 24 && h / 8 >= 30;
  const singleValid = w % 3 === 0 && h % 4 === 0;

  const layouts = [];
  if (!forcedSingle && char8Valid) layouts.push("char8");
  if (forcedSingle || !char8Valid) layouts.push("single");
  // genuinely ambiguous (small char8 frames): show both readings
  if (!forcedSingle && !char8Valid && w % 12 === 0 && h % 8 === 0 && w / 12 >= 14 && singleValid) layouts.push("char8");

  for (const layout of layouts) {
    if (layout === "single" && !singleValid) { console.warn(`SKIP ${f}: not divisible for single`); continue; }
    const args = [src, "--mode", "chars", "--scale", layout === "char8" ? "3" : "5", "--name", name];
    if (layout === "single") args.push("--single");
    try { run(args); } catch (e) { console.warn(`FAIL ${f} ${layout}: ${e.message}`); continue; }
  }
  index.sheets.push({
    src: `assets/time-fantasy/Unsorted/${f}`, name, layout: layouts.join("+"),
    px: `${w}x${h}`,
    frame: layouts[0] === "char8" ? `${w / 12}x${h / 8}` : `${w / 3}x${h / 4}`,
  });
}

mkdirSync(OUTDIR, { recursive: true });
writeFileSync(resolve(OUTDIR, "index.json"), JSON.stringify(index, null, 2));
console.log(`\nwrote tools/out/sheets/index.json (${index.sheets.length} sheets)`);
