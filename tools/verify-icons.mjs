/**
 * Machine-check every icon coordinate in shared/items.json against the actual
 * sheet + the written catalog. LESSONS.md: "Agent-cataloged file paths need
 * existence checks, not trust" — the same goes for agent-chosen cells.
 *
 * Checks, in order of how badly they'd bite:
 *   1. in-bounds            a cell outside the sheet renders garbage
 *   2. non-empty            a fully transparent cell = an invisible item icon
 *   3. category agreement   items.json kind/slot vs the catalog's category for
 *                           that cell (weapon->weapon_*, armor+head->armor_head...)
 *   4. duplicates           two items pointing at the same cell
 *   5. ladder monotonicity  a higher-value item in a ladder must not reuse the
 *                           cell of a lower-value one
 *
 * Category disagreement is a WARNING (the catalog is itself agent-written, and a
 * "trophy" is whatever art we say it is); everything else is an ERROR.
 *
 *   node tools/verify-icons.mjs
 */
import { PNG } from "pngjs";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHEET = resolve(ROOT, "assets/time-fantasy/IconSet/tficons_limited_16.png");
const sheet = PNG.sync.read(readFileSync(SHEET));
const COLS = Math.floor(sheet.width / 16);
const ROWS = Math.floor(sheet.height / 16);

const items = JSON.parse(readFileSync(resolve(ROOT, "shared/items.json"), "utf8").replace(/^﻿/, "")).items;

// catalog: cell -> {name, category}
const catalog = new Map();
const CAT_DIR = resolve(ROOT, "docs/asset-catalog");
if (existsSync(CAT_DIR)) {
  for (const f of readdirSync(CAT_DIR)) {
    if (!/^icons-r.*\.json$/.test(f)) continue;
    for (const c of JSON.parse(readFileSync(resolve(CAT_DIR, f), "utf8")).cells ?? []) {
      catalog.set(`${c.c},${c.r}`, c);
    }
  }
}

function cellOpaquePixels(c, r) {
  let n = 0;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      if (sheet.data[((r * 16 + y) * sheet.width + (c * 16 + x)) * 4 + 3] > 8) n++;
  return n;
}

/** what catalog categories are acceptable for an items.json entry */
function expectedCats(def) {
  switch (def.kind) {
    case "weapon":
      return [/^weapon_/, /^shield$/];
    case "armor":
      if (def.slot === "head") return [/^armor_head$/];
      if (def.slot === "chest") return [/^armor_body$/];
      if (def.slot === "legs") return [/^armor_legs$/];
      if (def.slot === "feet") return [/^armor_feet$/];
      if (def.slot === "offhand") return [/^shield$/, /^armor_/];
      return [/^armor_/];
    case "trinket":
      return [/^accessory$/, /^gem$/, /^trophy$/, /^misc$/];
    case "consumable":
      return [/^potion$/, /^food$/, /^herb$/, /^ingredient$/];
    case "trophy":
      return [/^trophy$/, /^material$/, /^misc$/, /^gem$/, /^coin$/, /^ingredient$/, /^accessory$/, /^armor_head$/, /^container$/, /^tool$/, /^effect$/];
    default:
      return [/./];
  }
}

// value-ordered progression ladders that must not collide
const LADDERS = [
  ["rusty_sword", "iron_sword", "steel_sword"],
  ["war_axe", "rift_greataxe", "kingsrend_greataxe"],
  ["hunting_bow", "longbow"],
  ["ranger_crossbow", "dwarven_arbalest"],
  ["emberpike", "oathbreaker_pike"],
  ["gravewind_scythe", "sovereign_scythe"],
  ["leather_cap", "iron_helm"],
  ["leather_jerkin", "iron_cuirass"],
  ["leather_boots", "iron_boots"],
  ["wooden_shield", "iron_shield"],
  ["health_potion", "greater_health_potion"],
  ["mana_potion", "greater_mana_potion"],
  ["fire_staff", "ashen_scepter"],
  ["frost_staff", "tidecaller_staff"],
  ["heal_staff", "fen_staff"],
];

const errors = [];
const warnings = [];
const seen = new Map();

for (const [id, def] of Object.entries(items)) {
  if (def.block) continue; // block items draw their block tile
  const icon = def.icon;
  if (!Array.isArray(icon) || icon.length !== 2) { errors.push(`${id}: icon is not [c,r]`); continue; }
  const [c, r] = icon;
  if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 || c >= COLS || r >= ROWS) {
    errors.push(`${id}: icon [${c},${r}] out of bounds (sheet is ${COLS}x${ROWS})`);
    continue;
  }
  const px = cellOpaquePixels(c, r);
  if (px === 0) { errors.push(`${id}: icon [${c},${r}] is a FULLY TRANSPARENT cell`); continue; }
  if (px < 12) warnings.push(`${id}: icon [${c},${r}] has only ${px} opaque px — is it a stray speck?`);

  const key = `${c},${r}`;
  if (seen.has(key)) errors.push(`${id}: shares cell [${key}] with ${seen.get(key)}`);
  else seen.set(key, id);

  const cat = catalog.get(key);
  if (!cat) warnings.push(`${id}: cell [${key}] absent from the catalog (unverified by eye?)`);
  else if (!expectedCats(def).some((re) => re.test(cat.category)))
    warnings.push(`${id} (${def.kind}${def.slot ? "/" + def.slot : ""}): cell [${key}] is catalogued as "${cat.category}" (${cat.name})`);
}

for (const ladder of LADDERS) {
  const cells = ladder.filter((id) => items[id]).map((id) => [id, items[id].icon.join(",")]);
  const byCell = new Map();
  for (const [id, cell] of cells) {
    if (byCell.has(cell)) errors.push(`ladder collision: ${byCell.get(cell)} and ${id} both use cell [${cell}]`);
    byCell.set(cell, id);
  }
}

// block items must point at the appended block-tile row
const blockItems = Object.entries(items).filter(([, d]) => d.block);
const blockRows = new Set(blockItems.map(([, d]) => d.icon[1]));
if (blockRows.size > 1) errors.push(`block items span multiple icon rows: ${[...blockRows].join(",")}`);
const blockRow = [...blockRows][0];
if (blockRow !== undefined && blockRow !== ROWS)
  errors.push(`block items sit on row ${blockRow}; the appended block row must be ${ROWS} (sheet has ${ROWS} rows)`);
blockItems.forEach(([id, d], i) => {
  if (d.icon[0] !== i) errors.push(`${id}: block-item column ${d.icon[0]} != its position ${i} (BLOCK_ITEM_TILES order is load-bearing)`);
});

for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`\n${Object.keys(items).length} items, ${seen.size} distinct icon cells, ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
