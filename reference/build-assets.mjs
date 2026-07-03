// Builds game-ready texture atlases from the Time Fantasy asset library.
//   assets/time-fantasy/**  ->  public/textures/tiles.png + tiles.json
//                                public/textures/icons.png + icons.json
// The client overlays these onto its procedural atlas at load time; any tile
// or icon not mapped here keeps its procedural (painter) art.
//
// Run: node scripts/build-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const TF = 'assets/time-fantasy';
const SRC = {
  terrain: `${TF}/Time Fantasy/TILESETS/terrain.png`,
  outside: `${TF}/Time Fantasy/TILESETS/outside.png`,
  dungeon: `${TF}/Time Fantasy/TILESETS/dungeon.png`,
  castle: `${TF}/Time Fantasy/TILESETS/castle.png`,
  desert: `${TF}/Time Fantasy/TILESETS/desert.png`,
  house: `${TF}/Time Fantasy/TILESETS/house.png`,
  water: `${TF}/Time Fantasy/TILESETS/water.png`,
  winter: `${TF}/Winter Tileset/tiles/tf_winter_terrain.png`,
  ff: `${TF}/Farm and Fort Tileset/ff_master_tile_sheet.png`,
  icons: `${TF}/IconSet/tf_icon_16.png`,
};

const sheets = {};
for (const [k, p] of Object.entries(SRC)) sheets[k] = PNG.sync.read(fs.readFileSync(p));

// --- pixel helpers ----------------------------------------------------------
function getPx(png, x, y) {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

// Copy a 16x16 tile into a flat RGBA buffer (Uint8Array 16*16*4).
function grab(sheet, sx, sy) {
  const png = sheets[sheet];
  const out = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const [r, g, b, a] = getPx(png, sx + x, sy + y);
      const o = (y * 16 + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return out;
}

// Remove background pixels close to a set of key colors (e.g. the sand the
// plants were drawn on) so plants can render as transparent cross-tiles.
function chromaKey(tile, keyColors, tol = 34) {
  for (let i = 0; i < tile.length; i += 4) {
    if (tile[i + 3] === 0) continue;
    for (const [kr, kg, kb] of keyColors) {
      if (Math.abs(tile[i] - kr) < tol && Math.abs(tile[i + 1] - kg) < tol && Math.abs(tile[i + 2] - kb) < tol) {
        tile[i + 3] = 0;
        break;
      }
    }
  }
  return tile;
}

// Paint src over dst (respecting alpha).
function over(dst, src) {
  for (let i = 0; i < dst.length; i += 4) {
    const a = src[i + 3] / 255;
    if (a === 0) continue;
    dst[i] = Math.round(src[i] * a + dst[i] * (1 - a));
    dst[i + 1] = Math.round(src[i + 1] * a + dst[i + 1] * (1 - a));
    dst[i + 2] = Math.round(src[i + 2] * a + dst[i + 2] * (1 - a));
    dst[i + 3] = Math.max(dst[i + 3], src[i + 3]);
  }
  return dst;
}

// Recolor: luminance of the source drives the tint color.
function tint(tile, [tr, tg, tb], strength = 1) {
  const out = new Uint8Array(tile);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const l = (out[i] * 0.35 + out[i + 1] * 0.5 + out[i + 2] * 0.15) / 255;
    out[i] = Math.min(255, Math.round((tr * l * 1.35) * strength + out[i] * (1 - strength)));
    out[i + 1] = Math.min(255, Math.round((tg * l * 1.35) * strength + out[i + 1] * (1 - strength)));
    out[i + 2] = Math.min(255, Math.round((tb * l * 1.35) * strength + out[i + 2] * (1 - strength)));
  }
  return out;
}

// Take the top `rows` of src and lay them over dst's top (grass/snow lips).
function topStrip(dst, src, rows = 5) {
  const out = new Uint8Array(dst);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < 16; x++) {
      // ragged bottom edge on the strip
      if (y === rows - 1 && (x * 7 + 3) % 3 === 0) continue;
      const i = (y * 16 + x) * 4;
      out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; out[i + 3] = 255;
    }
  }
  return out;
}

// Squash a 16x32 region (two stacked tiles) into one 16x16 tile — used for
// tall furniture sprites (beds) that should read top-down on a block face.
function grabSquashed(sheet, sx, sy) {
  const png = sheets[sheet];
  const out = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // sample the more opaque of each vertical pixel pair so thin outlines survive
      const a = getPx(png, sx + x, sy + y * 2), b = getPx(png, sx + x, sy + y * 2 + 1);
      const p = b[3] > a[3] ? b : a;
      const o = (y * 16 + x) * 4;
      out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = p[3];
    }
  }
  return out;
}

const SAND_KEY = [[222, 206, 148], [231, 217, 166], [207, 190, 135], [237, 226, 182], [214, 198, 141]];
const DIRT_KEY = [[168, 120, 72], [185, 140, 88], [152, 105, 60], [196, 155, 100], [140, 95, 55], [205, 165, 110]];

// --- tile recipes ------------------------------------------------------------
const stoneTile = () => grab('dungeon', 96, 16);
const oreTile = (tintColor) => {
  const gems = tint(chromaKey(grab('dungeon', 480, 240), [[0, 0, 0]], 0), tintColor);
  return over(stoneTile(), gems);
};

const TILE_RECIPES = {
  grass_top: () => grab('terrain', 80, 16),
  dirt: () => grab('terrain', 32, 96),
  sand: () => grab('terrain', 32, 144),
  stone: stoneTile,
  cobblestone: () => grab('castle', 144, 16),
  mossy_cobblestone: () => grab('castle', 160, 32),
  stone_bricks: () => grab('castle', 272, 32),
  bedrock: () => grab('dungeon', 432, 224),
  water: () => grab('water', 32, 64),
  lava: () => grab('water', 528, 64),
  snow: () => grab('winter', 240, 16),
  leaves: () => grab('outside', 576, 48),
  log: () => grab('house', 176, 144),
  planks: () => grab('ff', 528, 624),
  thatch: () => grab('ff', 400, 256),
  sandstone: () => grab('desert', 128, 336),
  sandstone_top: () => grab('desert', 128, 304),
  crystal: () => grab('dungeon', 496, 224),
  grass_side: () => topStrip(grab('terrain', 32, 96), grab('terrain', 80, 16)),
  snow_grass_side: () => topStrip(grab('terrain', 32, 96), grab('winter', 224, 16)),
  tall_grass: () => chromaKey(grab('terrain', 96, 160), SAND_KEY),
  wheat_sprout: () => chromaKey(grab('terrain', 128, 160), SAND_KEY),
  wheat_crop: () => chromaKey(grab('terrain', 16, 160), SAND_KEY),
  flower_yellow: () => chromaKey(grab('terrain', 144, 160), SAND_KEY),
  flower_red: () => chromaKey(grab('terrain', 176, 160), SAND_KEY),
  mushroom_red: () => tint(grab('icons', 12 * 16, 15 * 16), [225, 70, 60], 0.55),
  mushroom_brown: () => tint(grab('icons', 13 * 16, 15 * 16), [195, 145, 85], 0.5),
  torch: () => grab('icons', 6 * 16, 12 * 16),
  coal_ore: () => oreTile([50, 50, 55]),
  iron_ore: () => oreTile([225, 180, 150]),
  gold_ore: () => oreTile([250, 215, 70]),
  diamond_ore: () => oreTile([110, 230, 230]),
  // civilization blocks
  path: () => grab('terrain', 16, 128),          // packed gravel road
  roof: () => grab('house', 475, 156),           // red shingles (solid area probed programmatically)
  fence: () => grab('outside', 64, 64),          // post + top rail, tiles horizontally
  // red bed from the ff sheet (16x32 pillow+blanket squashed to one top tile,
  // laid over planks so the rounded corners stay opaque)
  bed_top: () => over(grab('ff', 528, 624), grabSquashed('ff', 528, 368)),
  bed_side: () => over(grab('ff', 528, 624), grab('ff', 528, 384)),
};

// --- icon recipes (tf_icon_16 is a 16-col grid of 16px icons) ---------------
const icon = (col, row) => () => grab('icons', col * 16, row * 16);
const iconTint = (col, row, color, s = 1) => () => tint(grab('icons', col * 16, row * 16), color, s);

const WOOD = [176, 141, 85], STONE_C = [150, 150, 150], DIAMOND_C = [108, 224, 224];
const tieredTool = (col, row, out, name) => {
  out[`wooden_${name}`] = iconTint(col, row, WOOD, 0.6);
  out[`stone_${name}`] = iconTint(col, row, STONE_C, 0.55);
  out[`iron_${name}`] = icon(col, row);
  out[`diamond_${name}`] = iconTint(col, row, DIAMOND_C, 0.55);
};

const ICON_RECIPES = {
  apple: icon(0, 4),
  golden_apple: iconTint(0, 4, [255, 200, 50], 0.65),
  bread: icon(4, 4),
  porkchop: iconTint(6, 4, [240, 130, 130], 0.5),
  cooked_porkchop: icon(6, 4),
  beef: iconTint(6, 4, [200, 70, 60], 0.55),
  steak: iconTint(6, 4, [165, 100, 55], 0.45),
  rotten_flesh: iconTint(6, 4, [130, 150, 60], 0.6),
  chicken: iconTint(5, 4, [245, 195, 175], 0.4),
  cooked_chicken: icon(5, 4),
  grain: icon(11, 5),
  feather: icon(2, 15),
  feather_charm: icon(1, 15),
  string: icon(7, 12),
  leather: icon(6, 1),
  coal: iconTint(3, 17, [75, 75, 82], 0.6),
  iron_ingot: icon(14, 17),
  gold_ingot: icon(15, 17),
  diamond: icon(6, 18),
  essence: icon(13, 18),
  slimeball: icon(11, 16),
  arrow: icon(14, 7),
  bow: icon(10, 7),
  health_potion: icon(5, 3),
  mana_potion: icon(6, 3),
  fire_wand: icon(4, 7),
  frost_wand: icon(7, 7),
  blink_staff: icon(3, 7),
  lightning_scepter: icon(8, 7),
  heal_amulet: iconTint(8, 13, [255, 120, 120], 0.4),
  recall_amulet: icon(9, 13),
  regen_ring: icon(15, 10),
  speed_boots: icon(10, 10),
};
tieredTool(5, 6, ICON_RECIPES, 'sword');
tieredTool(6, 6, ICON_RECIPES, 'axe');
tieredTool(3, 12, ICON_RECIPES, 'pickaxe');
tieredTool(2, 12, ICON_RECIPES, 'shovel');

// --- compose atlases --------------------------------------------------------
function writeAtlas(recipes, outPng, outJson) {
  const names = Object.keys(recipes);
  const cols = 16, rows = Math.ceil(names.length / cols);
  const atlas = new PNG({ width: cols * 16, height: rows * 16 });
  const index = {};
  names.forEach((name, i) => {
    let tile;
    try { tile = recipes[name](); } catch (e) {
      console.error(`recipe ${name} failed:`, e.message);
      return;
    }
    const ax = (i % cols) * 16, ay = Math.floor(i / cols) * 16;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const s = (y * 16 + x) * 4, d = ((ay + y) * atlas.width + ax + x) * 4;
        atlas.data[d] = tile[s]; atlas.data[d + 1] = tile[s + 1];
        atlas.data[d + 2] = tile[s + 2]; atlas.data[d + 3] = tile[s + 3];
      }
    }
    index[name] = i;
  });
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  fs.writeFileSync(outPng, PNG.sync.write(atlas));
  fs.writeFileSync(outJson, JSON.stringify(index));
  console.log(`${outPng}: ${names.length} entries (${cols}x${rows})`);
}

writeAtlas(TILE_RECIPES, 'public/textures/tiles.png', 'public/textures/tiles.json');
writeAtlas(ICON_RECIPES, 'public/textures/icons.png', 'public/textures/icons.json');

// ---------------------------------------------------------------------------
// Mob sprites: cut RPG-Maker-style walk sheets (3 frames x 4 directions) into
// per-mob sheets for the billboard renderer. Multi-character sheets hold 8
// characters (4 across x 2 down); `char: [cx, cy]` picks one. Frames are
// auto-trimmed to their union bounding box (symmetric about the horizontal
// center, bottom-anchored) so sprites fill their billboards without jitter.
// ---------------------------------------------------------------------------
const MOBS_DIR = `${TF}/Characters/TimeFantasy_Monsters/1x`;
const CHARS_DIR = `${TF}/Characters/timefantasy_characters/sheets`;

const MOB_SHEETS = {
  pig: { file: `${MOBS_DIR}/monster_boar.png`, single: true },          // wild boar
  // no cow exists anywhere in the library; the elk is the closest stand-in
  cow: { file: `${MOBS_DIR}/monster_elk.png`, single: true },           // elk
  chicken: { file: `${MOBS_DIR}/monster_bird3.png`, single: true },     // turkey-ish ground bird
  zombie: { file: `${MOBS_DIR}/monster4.png`, char: [2, 0] },           // shambling husk
  skeleton: { file: `${MOBS_DIR}/monster4.png`, char: [3, 0] },         // armored skeleton
  spider: { file: `${MOBS_DIR}/monster1.png`, char: [2, 0] },
  slime: { file: `${MOBS_DIR}/monster1.png`, char: [0, 0] },
  wraith: { file: `${MOBS_DIR}/monster4.png`, char: [0, 0] },           // white ghost
  dark_mage: { file: `${MOBS_DIR}/monster_lich.png`, single: true },    // the lich
  orc: { file: `${MOBS_DIR}/orc1.png`, char: [0, 0] },
  orc_brute: { file: `${MOBS_DIR}/orc1.png`, char: [3, 1] },            // armored chief
  villager: { file: `${CHARS_DIR}/npc1.png`, char: [3, 1] },            // straw-hat farmer
  // wizard.png only has walk grids in its TOP half (4 variants); the bottom
  // half is single-column casting poses that do NOT fit the 12x8 grid.
  wizard: { file: `${MOBS_DIR}/wizard.png`, char: [0, 0] },             // blue wizard
  // -- civilization update --
  villager_woman: { file: `${CHARS_DIR}/npc2.png`, char: [0, 0] },      // red-dress woman
  merchant: { file: `${MOBS_DIR}/npc5.png`, char: [2, 0] },             // wide-hat traveling trader
  blacksmith: { file: `${CHARS_DIR}/npc3.png`, char: [1, 1] },          // red-haired smith
  priest: { file: `${MOBS_DIR}/chara7.png`, char: [2, 1] },             // white-hat cleric
  noble: { file: `${MOBS_DIR}/chara8.png`, char: [2, 0] },              // red-robed king
  guard: { file: `${CHARS_DIR}/military1.png`, char: [2, 0] },          // plate knight
  bandit: { file: `${MOBS_DIR}/npc5.png`, char: [2, 1] },               // flat-cap burglar
  cultist: { file: `${MOBS_DIR}/npc5.png`, char: [3, 0] },              // purple hooded
  dark_knight: { file: `${MOBS_DIR}/monster_dknight1.png`, single: true },
  wolf: { file: `${MOBS_DIR}/monster_wolf1.png`, single: true },        // white wolf
  horse: { file: `${MOBS_DIR}/horse1.png`, char: [2, 0] },              // brown horse
  dog: { file: `${CHARS_DIR}/animals1.png`, char: [1, 0] },             // golden dog
  cat: { file: `${CHARS_DIR}/animals1.png`, char: [2, 1] },             // orange cat
};

fs.mkdirSync('public/textures/mobs', { recursive: true });
const mobManifest = {};
for (const [type, spec] of Object.entries(MOB_SHEETS)) {
  const png = PNG.sync.read(fs.readFileSync(spec.file));
  const frameW = Math.floor(png.width / (spec.single ? 3 : 12));
  const frameH = Math.floor(png.height / (spec.single ? 4 : 8));
  const bx = spec.single ? 0 : spec.char[0] * 3 * frameW;
  const by = spec.single ? 0 : spec.char[1] * 4 * frameH;

  // union bounding box of visible pixels across all 12 frames
  let minX = frameW, maxX = -1, minY = frameH, maxY = -1;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < frameH; y++) {
        for (let x = 0; x < frameW; x++) {
          const a = png.data[((by + r * frameH + y) * png.width + bx + c * frameW + x) * 4 + 3];
          if (a > 16) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }
  }
  if (maxX < 0) { console.error(`mob ${type}: empty sprite block!`); continue; }
  const center = frameW / 2;
  const half = Math.ceil(Math.max(center - minX, maxX + 1 - center));
  const fw = half * 2;
  const fh = maxY + 1 - minY;
  const x0 = Math.max(0, Math.floor(center - half));

  const out = new PNG({ width: fw * 3, height: fh * 4 });
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const sx = bx + c * frameW + x0 + x, sy = by + r * frameH + minY + y;
          if (sx >= png.width || sy >= png.height) continue;
          const s = (sy * png.width + sx) * 4;
          const d = ((r * fh + y) * out.width + c * fw + x) * 4;
          out.data[d] = png.data[s]; out.data[d + 1] = png.data[s + 1];
          out.data[d + 2] = png.data[s + 2]; out.data[d + 3] = png.data[s + 3];
        }
      }
    }
  }
  fs.writeFileSync(`public/textures/mobs/${type}.png`, PNG.sync.write(out));
  mobManifest[type] = { fw, fh };
  console.log(`mob ${type}: frame ${fw}x${fh} (from ${frameW}x${frameH})`);
}
fs.writeFileSync('public/textures/mobs.json', JSON.stringify(mobManifest));
console.log('done');
