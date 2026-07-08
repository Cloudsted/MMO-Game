/**
 * Icon remap helper: tf_icon_16 (old, 16x21) -> tficons_limited_16 (new, 16x64).
 *
 * The two sheets share the SAME line art for most icons — only the palette was
 * revamped (verified: identical alpha masks, every opaque pixel shifted a few
 * units). So the reliable signal is the ALPHA MASK, not the colours. We score
 * every new cell against each old cell by
 *     0.75 * mask-IoU  +  0.25 * colour similarity over the overlap
 * and emit a ranked shortlist. Exact mask matches (IoU 1.0) are near-certain.
 *
 * This produces CANDIDATES, never a final mapping — a human/agent confirms them
 * against the rendered proof sheet (tools/icon-proof.mjs). LESSONS.md: never
 * ship a coordinate nobody looked at.
 *
 *   node tools/icon-remap.mjs            # ranked candidates for every items.json icon
 *   node tools/icon-remap.mjs --all      # ... for every non-empty old cell
 */
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OLD = resolve(ROOT, "assets/time-fantasy/IconSet/tf_icon_16.png");
const NEW = resolve(ROOT, "assets/time-fantasy/IconSet/tficons_limited_16.png");

const oldPng = PNG.sync.read(readFileSync(OLD));
const newPng = PNG.sync.read(readFileSync(NEW));

const N = 16;
function readCell(png, c, r) {
  const mask = new Uint8Array(N * N);
  const rgb = new Int16Array(N * N * 3);
  let count = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = ((r * N + y) * png.width + (c * N + x)) * 4;
      const a = png.data[i + 3];
      const k = y * N + x;
      if (a > 8) {
        mask[k] = 1; count++;
        rgb[k * 3] = png.data[i]; rgb[k * 3 + 1] = png.data[i + 1]; rgb[k * 3 + 2] = png.data[i + 2];
      }
    }
  }
  return { mask, rgb, count };
}

/** IoU of two binary masks + mean colour distance over their intersection. */
function score(a, b) {
  let inter = 0, union = 0, dsum = 0;
  for (let k = 0; k < N * N; k++) {
    const am = a.mask[k], bm = b.mask[k];
    if (am | bm) union++;
    if (am & bm) {
      inter++;
      const dr = a.rgb[k * 3] - b.rgb[k * 3];
      const dg = a.rgb[k * 3 + 1] - b.rgb[k * 3 + 1];
      const db = a.rgb[k * 3 + 2] - b.rgb[k * 3 + 2];
      dsum += Math.sqrt(dr * dr + dg * dg + db * db);
    }
  }
  if (!union) return { iou: 0, colour: 0, total: 0 };
  const iou = inter / union;
  // 441 = max RGB distance
  const colour = inter ? 1 - dsum / inter / 441 : 0;
  return { iou, colour, total: 0.75 * iou + 0.25 * colour };
}

const OLD_ROWS = Math.floor(oldPng.height / N);
const NEW_ROWS = Math.floor(newPng.height / N);

const newCells = [];
for (let r = 0; r < NEW_ROWS; r++) {
  for (let c = 0; c < N; c++) {
    const cell = readCell(newPng, c, r);
    if (cell.count) newCells.push({ c, r, cell });
  }
}

function candidatesFor(c, r, topN = 4) {
  const a = readCell(oldPng, c, r);
  if (!a.count) return null;
  const ranked = newCells
    .map((n) => ({ c: n.c, r: n.r, ...score(a, n.cell) }))
    .sort((x, y) => y.total - x.total)
    .slice(0, topN);
  return { old: [c, r], pixels: a.count, candidates: ranked.map((x) => ({ cell: [x.c, x.r], iou: +x.iou.toFixed(3), colour: +x.colour.toFixed(3), total: +x.total.toFixed(3) })) };
}

const all = process.argv.includes("--all");
const out = { source: "tf_icon_16 -> tficons_limited_16", method: "0.75*maskIoU + 0.25*colourSim", entries: [] };

if (all) {
  for (let r = 0; r < OLD_ROWS; r++) for (let c = 0; c < N; c++) {
    const e = candidatesFor(c, r);
    if (e) out.entries.push(e);
  }
} else {
  const items = JSON.parse(readFileSync(resolve(ROOT, "shared/items.json"), "utf8").replace(/^﻿/, "")).items;
  for (const [id, def] of Object.entries(items)) {
    if (def.block) continue; // block items draw their block tile, not an icon cell
    const [c, r] = def.icon;
    const e = candidatesFor(c, r);
    if (!e) { out.entries.push({ id, old: [c, r], error: "old cell is empty" }); continue; }
    out.entries.push({ id, kind: def.kind, name: def.name, ...e });
  }
}

const dest = resolve(ROOT, "docs/asset-catalog/icon-remap-candidates.json");
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 2));

// terse console table
let exact = 0, strong = 0, weak = 0;
for (const e of out.entries) {
  if (!e.candidates) continue;
  const b = e.candidates[0];
  const tag = b.iou >= 0.999 ? "EXACT" : b.iou >= 0.85 ? "strong" : "WEAK";
  if (tag === "EXACT") exact++; else if (tag === "strong") strong++; else weak++;
  const label = e.id ?? `cell ${e.old}`;
  console.log(
    `${String(label).padEnd(24)} old[${e.old}] -> new[${b.cell}] iou=${b.iou.toFixed(3)} col=${b.colour.toFixed(2)} ${tag}` +
      (tag === "WEAK" ? `   alts: ${e.candidates.slice(1, 4).map((x) => `[${x.cell}] ${x.iou.toFixed(2)}`).join(" ")}` : "")
  );
}
console.log(`\n${exact} exact-mask, ${strong} strong, ${weak} WEAK (need eyes)`);
console.log(`wrote docs/asset-catalog/icon-remap-candidates.json`);
