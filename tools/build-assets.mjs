/**
 * Art pipeline: Time Fantasy source sheets -> client/assets/ textures + JSON
 * metadata. Phase 1 scope: the default player walk sheet and ground tiles.
 * Grows into full atlasing (terrain splats, props, mobs, icons, FX) in later
 * phases — keep every extraction here, never hand-copy art.
 *
 *   node tools/build-assets.mjs
 */
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "assets", "time-fantasy");
const OUT = resolve(ROOT, "client", "assets");

// The one icon sheet: 16 cols x 64 rows of 16x16 cells. It replaced the old
// tf_icon_16 (same line art, revamped palette, ~3x the content). Every
// shared/items.json `icon: [col,row]` addresses THIS sheet, and the block-item
// icons are appended one row past its bottom (row 64). Coordinates below were
// each confirmed against a rendered contact sheet — see tools/contact-sheet.mjs
// and LESSONS.md ("never trust a coordinate you haven't seen").
const ICON_SHEET = "tficons_limited_16.png";

function loadPng(path) {
  return PNG.sync.read(readFileSync(path));
}

function savePng(png, relOut) {
  const path = resolve(OUT, relOut);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
  console.log(`wrote ${relOut} (${png.width}x${png.height})`);
}

function saveJson(obj, relOut) {
  const path = resolve(OUT, relOut);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
  console.log(`wrote ${relOut}`);
}

/** Extract a w×h region at (x,y). */
function grab(png, x, y, w = 16, h = 16) {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, x, y, w, h, 0, 0);
  return out;
}

/** Crop to the tight bounding box of non-transparent pixels. */
function trim(png) {
  let minX = png.width, minY = png.height, maxX = -1, maxY = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("trim: fully transparent sprite");
  return grab(png, minX, minY, maxX - minX + 1, maxY - minY + 1);
}

/**
 * Extract the connected opaque component containing (seedX, seedY): flood-fill
 * (8-way, alpha > 8), then copy every opaque pixel of the component's bbox that
 * belongs to it. Ideal for dense sheets where rectangles inevitably catch
 * neighbouring clutter (the farm-and-fort buildings).
 */
function grabComponent(png, seedX, seedY) {
  const w = png.width, h = png.height;
  const seen = new Uint8Array(w * h);
  const alphaAt = (x, y) => png.data[(y * w + x) * 4 + 3];
  if (alphaAt(seedX, seedY) <= 8) throw new Error(`grabComponent: transparent seed ${seedX},${seedY}`);
  const stack = [seedY * w + seedX];
  seen[stack[0]] = 1;
  let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY;
  const members = [];
  while (stack.length) {
    const i = stack.pop();
    members.push(i);
    const x = i % w, y = (i / w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!seen[ni] && alphaAt(nx, ny) > 8) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
  }
  const out = new PNG({ width: maxX - minX + 1, height: maxY - minY + 1 });
  for (const i of members) {
    const x = i % w, y = (i / w) | 0;
    const si = i * 4, di = ((y - minY) * out.width + (x - minX)) * 4;
    for (let k = 0; k < 4; k++) out.data[di + k] = png.data[si + k];
  }
  return out;
}


// ---------- character/mob/NPC walk sheets (RPG-Maker 3x4 layout) ----------
// Multi-character sheets hold 8 characters (4 across x 2 down); char: [cx,cy]
// picks one. Frames are trimmed to the union bbox across all 12 frames
// (symmetric about the horizontal center, bottom-anchored) so billboards
// don't jitter between frames. Mappings proven by the PoC — see
// reference/build-assets.mjs MOB_SHEETS.
{
  const MOBS = resolve(SRC, "Characters", "TimeFantasy_Monsters", "1x");
  const CHARS = resolve(SRC, "Characters", "timefantasy_characters", "sheets");
  const UNSORTED = resolve(SRC, "Unsorted");
  const SHEETS = {
    // the player sheet goes through the same trim as everyone else — the raw
    // 26x36 cell carries 7 px of empty headroom that made players render
    // ~20% shorter than their nominal height
    player: { file: resolve(SRC, "Characters", "Player.png"), single: true },
    slime: { file: resolve(MOBS, "monster1.png"), char: [0, 0] },
    wolf: { file: resolve(MOBS, "monster_wolf1.png"), single: true },
    // ---- bandits_1.png (2026-07-08 asset drop): 4 archetypes x 2 palettes.
    // Row 0 = brown/rust hat + pale face-scarf; row 1 = the same four recoloured
    // green with bare faces. Every cell below was read off
    // tools/out/sheets/bandits-chars.png and its per-char zooms. The old
    // npc5 [2,1] "flat-cap burglar" is retired — this sheet IS the bandits.
    bandit: { file: resolve(UNSORTED, "bandits_1.png"), char: [0, 0] }, // floppy hat, scarf over the nose, longcoat — the plain highwayman
    bandit_enforcer: { file: resolve(UNSORTED, "bandits_1.png"), char: [1, 0] }, // same, plus a grey steel brigandine + studded belt
    bandit_bombardier: { file: resolve(UNSORTED, "bandits_1.png"), char: [2, 0] }, // lit fuse at the hat brim, bandolier of orange flasks, blue flask at the hip
    bandit_mystic: { file: resolve(UNSORTED, "bandits_1.png"), char: [3, 0] }, // fully cloaked, hood drawn, NO face, bone-white clasps
    bandit_chief: { file: resolve(UNSORTED, "bandits_1.png"), char: [1, 1] }, // the green-palette enforcer — the camp's boss
    bandit_poacher: { file: resolve(UNSORTED, "bandits_1.png"), char: [0, 1] }, // green bandana, the only bandit who shows a face
    // camp livestock + dogs. animals1 row 0 is DOGS, row 1 is CATS (verified on the
    // contact sheet — the catalog's warning is right). animals2 [3,0] is the goat.
    camp_cur: { file: resolve(UNSORTED, "animals1.png"), char: [3, 0] }, // tan-and-rust lean dog
    stolen_goat: { file: resolve(UNSORTED, "animals2.png"), char: [3, 0] }, // white goat, black backswept horns
    npc_smith: { file: resolve(CHARS, "npc3.png"), char: [1, 1] }, // red-haired smith
    npc_provisioner: { file: resolve(CHARS, "npc2.png"), char: [0, 0] }, // red-dress woman
    // wizard.png trap: walk grids ONLY in the top half; [0,0] is safe
    npc_arcanist: { file: resolve(MOBS, "wizard.png"), char: [0, 0] },
    npc_guard: { file: resolve(CHARS, "military1.png"), char: [2, 0] }, // plate knight
    villager1: { file: resolve(CHARS, "npc1.png"), char: [3, 1] }, // straw-hat farmer
    villager2: { file: resolve(CHARS, "npc2.png"), char: [1, 0] },
    villager3: { file: resolve(CHARS, "npc1.png"), char: [0, 0] },
    // silver-haired woman in purple robes + white apron (cell verified 2026-07-07)
    npc_enchanter: { file: resolve(CHARS, "npc4.png"), char: [1, 1] },
    // phase 5: desert + dungeon roster
    skeleton: { file: resolve(MOBS, "monster4.png"), char: [3, 0] }, // armored skeleton
    cacto: { file: resolve(MOBS, "monster_cacto.png"), single: true },
    raptor: { file: resolve(MOBS, "monster_raptor1.png"), single: true },
    minotaur: { file: resolve(MOBS, "monster_minotaur.png"), single: true },
    // worldgen overhaul roster (every cell claim below was verified by eye
    // against a rendered contact grid before mapping — LESSONS.md rule)
    boar: { file: resolve(MOBS, "monster_boar.png"), single: true }, // golden tusked boar
    giant_spider: { file: resolve(MOBS, "monster1.png"), char: [2, 0] }, // gray spider, red eyes
    bog_serpent: { file: resolve(MOBS, "monster1.png"), char: [1, 1] }, // green serpent
    bone_bat: { file: resolve(MOBS, "monster1.png"), char: [3, 1] }, // gray bat, blue wings
    mantrap: { file: resolve(MOBS, "monster3.png"), char: [2, 0] }, // pink-bloom plant creature
    lizardman: { file: resolve(MOBS, "monster_lizardman1.png"), single: true }, // armored lizard warrior
    // elemental.png trap (like wizard.png): walk grids ONLY in the top half —
    // the bottom half is off-grid single orb frames. Top-half chars (cy 0)
    // extract clean with the standard 12x8 grid math (verified on the grid).
    marsh_wisp: { file: resolve(MOBS, "elemental.png"), char: [0, 0] }, // blue water elemental
    fire_elemental: { file: resolve(MOBS, "elemental.png"), char: [1, 0] }, // flame elemental
    ash_husk: { file: resolve(MOBS, "monster4.png"), char: [2, 0] }, // tan shirtless zombie
    wraith: { file: resolve(MOBS, "monster4.png"), char: [0, 0] }, // white bearded ghost
    cinder_golem: { file: resolve(MOBS, "monster_golem1.png"), single: true }, // stone golem
    lich: { file: resolve(MOBS, "monster_lich.png"), single: true }, // crowned skeletal king
    // Sundered City roster (cells eyeballed on the sheets 2026-07-07; the
    // dknight sheets are single-character like the lich)
    marauder: { file: resolve(MOBS, "orc1.png"), char: [3, 1] }, // red-armored orc warlord
    gravehound: { file: resolve(MOBS, "monster_wolf2.png"), single: true }, // horned gray dire beast
    fallen_soldier: { file: resolve(CHARS, "military1.png"), char: [3, 0] }, // faceless full-plate man-at-arms (military2 is all kepi officers — wrong era)
    oathbound_sentinel: { file: resolve(MOBS, "monster_dknight2.png"), single: true }, // blue horned knight
    sundered_king: { file: resolve(MOBS, "monster_dknight1.png"), single: true }, // crimson death knight
  };
  const manifest = {};
  for (const [key, spec] of Object.entries(SHEETS)) {
    const png = loadPng(spec.file);
    const frameW = Math.floor(png.width / (spec.single ? 3 : 12));
    const frameH = Math.floor(png.height / (spec.single ? 4 : 8));
    const bx = spec.single ? 0 : spec.char[0] * 3 * frameW;
    const by = spec.single ? 0 : spec.char[1] * 4 * frameH;
    // union bbox of visible pixels across all 12 frames
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
    if (maxX < 0) throw new Error(`sheet ${key}: empty character cell`);
    // symmetric about the horizontal center, bottom-anchored
    const half = Math.max(maxX - Math.floor(frameW / 2), Math.floor(frameW / 2) - minX, 1);
    const tx = Math.max(0, Math.floor(frameW / 2) - half);
    const tw = Math.min(frameW - tx, half * 2 + 1);
    const th = maxY - minY + 1;
    const out = new PNG({ width: tw * 3, height: th * 4 });
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        PNG.bitblt(png, out, bx + c * frameW + tx, by + r * frameH + minY, tw, th, c * tw, r * th);
      }
    }
    savePng(out, `sprites/${key}.png`);
    manifest[key] = { cols: 3, rows: 4, frameW: tw, frameH: th };
    console.log(`  ${key}: frame ${tw}x${th}`);
  }
  saveJson(
    { rowOrder: ["down", "left", "right", "up"], walkCycle: [0, 1, 2, 1], sheets: manifest },
    "sprites/sprites.json"
  );
}

// ---------- block tile atlas (voxel world faces; recipes proven in the PoC) ----------
// Every tile is 16x16. tiles.json maps name -> {index, avgColor}; the client
// mesher UVs into a 16-column grid atlas. avgColor drives the minimap.
const TILE_PNGS = {}; // name -> 16x16 PNG (also consumed by the icon section)
{
  const terrain = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "terrain.png"));
  const dungeonSheet = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "dungeon.png"));
  const castle = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "castle.png"));
  const desertSheet = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "desert.png"));
  const house = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "house.png"));
  const waterSheet = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "water.png"));
  const ff = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "farm and fort.png"));
  const outsideSheet = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "outside.png"));
  const icons16 = loadPng(resolve(SRC, "IconSet", ICON_SHEET));
  // worldgen-overhaul sheets (blocks 26-50)
  const darkDim = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "dark dimension.png"));
  const insideSheet = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "inside.png"));
  const winter = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "Winter", "tf_winter_terrain.png"));
  // ruin/dungeon set (blocks 56-77). AUTOTILE SHEET: only blob-CENTRE cells and
  // the discrete (non-autotile) plate/decoration rows are safe. Every cell used
  // below was eyeballed on tools/out/sheets/ruindungeons-r<band>-c<half>.png.
  const ruin = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "ruindungeons_sheet_full.png"));

  const t16 = (sheet, x, y) => grab(sheet, x, y, 16, 16);
  // remove background pixels close to a set of key colors (sand behind plants)
  const chromaKey = (png, keys, tol = 34) => {
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] === 0) continue;
      for (const [kr, kg, kb] of keys) {
        if (
          Math.abs(png.data[i] - kr) < tol &&
          Math.abs(png.data[i + 1] - kg) < tol &&
          Math.abs(png.data[i + 2] - kb) < tol
        ) {
          png.data[i + 3] = 0;
          break;
        }
      }
    }
    return png;
  };
  // luminance-driven recolor
  const tint = (png, [tr, tg, tb], strength = 1) => {
    const out = new PNG({ width: png.width, height: png.height });
    png.data.copy(out.data);
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] === 0) continue;
      const l = (out.data[i] * 0.35 + out.data[i + 1] * 0.5 + out.data[i + 2] * 0.15) / 255;
      out.data[i] = Math.min(255, Math.round(tr * l * 1.35 * strength + out.data[i] * (1 - strength)));
      out.data[i + 1] = Math.min(255, Math.round(tg * l * 1.35 * strength + out.data[i + 1] * (1 - strength)));
      out.data[i + 2] = Math.min(255, Math.round(tb * l * 1.35 * strength + out.data[i + 2] * (1 - strength)));
    }
    return out;
  };
  // lay the top rows of src over dst (grass lip on dirt for block sides)
  const topStrip = (dst, src, rows = 5) => {
    const out = new PNG({ width: 16, height: 16 });
    dst.data.copy(out.data);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < 16; x++) {
        if (y === rows - 1 && (x * 7 + 3) % 3 === 0) continue; // ragged edge
        const i = (y * 16 + x) * 4;
        out.data[i] = src.data[i];
        out.data[i + 1] = src.data[i + 1];
        out.data[i + 2] = src.data[i + 2];
        out.data[i + 3] = 255;
      }
    }
    return out;
  };
  const SAND_KEY = [
    [222, 206, 148], [231, 217, 166], [207, 190, 135], [237, 226, 182], [214, 198, 141],
  ];

  // ---- worldgen-overhaul helpers ----
  // lay src's opaque pixels over a copy of dst (bone scatter on sand, bale on straw)
  const overlay = (dst, src) => {
    const out = new PNG({ width: 16, height: 16 });
    dst.data.copy(out.data);
    for (let i = 0; i < out.data.length; i += 4) {
      if (src.data[i + 3] > 8) {
        out.data[i] = src.data[i];
        out.data[i + 1] = src.data[i + 1];
        out.data[i + 2] = src.data[i + 2];
        out.data[i + 3] = 255;
      }
    }
    return out;
  };
  // vertical flip (upward grass tufts become hanging vines)
  const flipV = (png) => {
    const out = new PNG({ width: png.width, height: png.height });
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const s = (y * png.width + x) * 4;
        const d = ((png.height - 1 - y) * png.width + x) * 4;
        for (let k = 0; k < 4; k++) out.data[d + k] = png.data[s + k];
      }
    }
    return out;
  };
  // nearest-neighbour resample any sprite to 16x16 (PoC grabSquashed precedent)
  const squash16 = (png) => {
    const out = new PNG({ width: 16, height: 16 });
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const sx = Math.min(png.width - 1, Math.floor((x * png.width) / 16));
        const sy = Math.min(png.height - 1, Math.floor((y * png.height) / 16));
        const s = (sy * png.width + sx) * 4;
        const d = (y * 16 + x) * 4;
        for (let k = 0; k < 4; k++) out.data[d + k] = png.data[s + k];
      }
    }
    return out;
  };
  // drop water-splash blues off a plant sprite (reeds stand in a painted pool)
  const stripBlue = (png) => {
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] === 0) continue;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (b > r + 40 && b > g + 25) png.data[i + 3] = 0;
    }
    return png;
  };

  const grassTop = t16(terrain, 80, 16);
  const dirt = t16(terrain, 32, 96);
  const logSide = t16(house, 176, 144);
  const planks = t16(ff, 528, 624);

  // painted glass: light frame + diagonal streaks over a transparent pane
  const glass = new PNG({ width: 16, height: 16 });
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const streak = (x + y === 18 || x + y === 19 || x + y === 8);
      if (edge) {
        glass.data[i] = 168; glass.data[i + 1] = 192; glass.data[i + 2] = 204; glass.data[i + 3] = 255;
      } else if (streak) {
        glass.data[i] = 225; glass.data[i + 1] = 242; glass.data[i + 2] = 250; glass.data[i + 3] = 90;
      }
    }
  }

  // log cross-section: warm-tinted planks core inside the bark ring
  const logTop = new PNG({ width: 16, height: 16 });
  logSide.data.copy(logTop.data);
  const rings = tint(planks, [205, 160, 100], 0.7);
  for (let y = 2; y < 14; y++) {
    for (let x = 2; x < 14; x++) {
      const i = (y * 16 + x) * 4;
      logTop.data[i] = rings.data[i];
      logTop.data[i + 1] = rings.data[i + 1];
      logTop.data[i + 2] = rings.data[i + 2];
      logTop.data[i + 3] = 255;
    }
  }

  // ---- worldgen-overhaul composites (blocks 26-50) ----
  // pale (swamp) log cross-section: silver bark ring + bleached rings core
  const paleLogSide = t16(outsideSheet, 760, 96); // big white dead tree trunk (probed: fully opaque)
  const paleLogTop = new PNG({ width: 16, height: 16 });
  paleLogSide.data.copy(paleLogTop.data);
  const paleRings = tint(planks, [190, 196, 188], 0.75);
  for (let y = 2; y < 14; y++) {
    for (let x = 2; x < 14; x++) {
      const i = (y * 16 + x) * 4;
      paleLogTop.data[i] = paleRings.data[i];
      paleLogTop.data[i + 1] = paleRings.data[i + 1];
      paleLogTop.data[i + 2] = paleRings.data[i + 2];
      paleLogTop.data[i + 3] = 255;
    }
  }

  // painted cobweb: radial spokes + two rings at ~40% alpha (painted-glass precedent)
  const web = new PNG({ width: 16, height: 16 });
  {
    const put = (x, y, a) => {
      if (x < 0 || y < 0 || x > 15 || y > 15) return;
      const i = (y * 16 + x) * 4;
      web.data[i] = 226; web.data[i + 1] = 232; web.data[i + 2] = 238;
      web.data[i + 3] = Math.max(web.data[i + 3], a);
    };
    for (let t = 0; t < 16; t++) {
      put(t, t, 120); put(t, 15 - t, 120); // diagonals
      put(t, 7, 130); put(t, 8, 90); put(7, t, 130); put(8, t, 90); // cross
    }
    // rings (square approximations of anchor threads)
    for (let t = 4; t <= 11; t++) {
      put(t, 4, 100); put(t, 11, 100); put(4, t, 100); put(11, t, 100);
    }
    for (let t = 1; t <= 14; t++) {
      if ((t + 1) % 3 === 0) continue; // ragged outer ring
      put(t, 1, 80); put(t, 14, 80); put(1, t, 80); put(14, t, 80);
    }
  }

  // bone block: stacked-bone bundle (desert graves row, probed at y48) over pale
  // sand, then bleached — TF bones are golden-tan; unbleached it read as firewood
  const boneBase = tint(t16(terrain, 32, 144), [214, 204, 178], 0.8);
  const boneBlock = tint(overlay(boneBase, t16(desertSheet, 176, 48)), [226, 218, 194], 0.55);

  // hay: the square strapped-bale face at (560,192) over thatch (corners fill in straw)
  const hayBlock = overlay(t16(ff, 400, 256), t16(ff, 560, 192));

  const crystalTile = t16(dungeonSheet, 496, 224);
  const snowTop = t16(winter, 256, 16);

  // ---- Sundered City composites (blocks 51-55; all painted/derived — no new
  // sheet probes needed, deterministic like the painted glass/web tiles) ----
  const stoneBricksTile = t16(castle, 272, 32);
  // war-cracked stone bricks: a zig-zag fissure + branch crack + spalled pits
  const crackedBricks = (() => {
    const out = new PNG({ width: 16, height: 16 });
    stoneBricksTile.data.copy(out.data);
    const darken = (x, y, f) => {
      if (x < 0 || y < 0 || x > 15 || y > 15) return;
      const i = (y * 16 + x) * 4;
      out.data[i] = Math.round(out.data[i] * f);
      out.data[i + 1] = Math.round(out.data[i + 1] * f);
      out.data[i + 2] = Math.round(out.data[i + 2] * f);
    };
    let cx = 5;
    for (let y = 0; y < 16; y++) {
      darken(cx, y, 0.45);
      darken(cx + 1, y, 0.7);
      cx += (y % 3 === 0 ? 1 : 0) - (y % 5 === 0 ? 2 : 0);
      cx = Math.max(1, Math.min(13, cx));
    }
    for (let x = 8; x < 15; x++) darken(x, 6 + ((x * 3) % 2), 0.55);
    for (const [px, py] of [[13, 13], [14, 13], [13, 14], [2, 2], [3, 2]]) darken(px, py, 0.5);
    return out;
  })();
  // rubble: grayed cobble knocked out of true — pit shadows + pale chips
  const rubbleTile = (() => {
    const out = tint(t16(castle, 144, 16), [152, 154, 150], 0.4);
    const px = (x, y, r, g, bl) => {
      const i = (y * 16 + x) * 4;
      out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = bl; out.data[i + 3] = 255;
    };
    for (const [x, y] of [[2, 4], [3, 4], [2, 5], [9, 2], [10, 2], [13, 8], [13, 9], [5, 12], [6, 12], [6, 13], [11, 13]])
      px(x, y, 58, 58, 56); // pits
    for (const [x, y] of [[7, 7], [8, 7], [12, 4], [3, 10], [14, 12], [1, 1]])
      px(x, y, 196, 198, 192); // displaced chips
    return out;
  })();
  // royal carpet: deep crimson weave (subtle row/diagonal thread variation)
  const redCarpet = (() => {
    const out = new PNG({ width: 16, height: 16 });
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        let r = 146, g = 24, b = 34;
        if ((x + y) % 4 === 0) { r = 128; g = 20; b = 30; } // weave shadow
        if (y % 8 === 3 && x % 5 === 2) { r = 168; g = 40; b = 46; } // thread glint
        out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255;
      }
    }
    return out;
  })();
  // gold block: beveled gilded face with darker seams + rivets
  const goldBlock = (() => {
    const out = new PNG({ width: 16, height: 16 });
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        let r = 222, g = 180, b = 66;
        if (x === 0 || y === 0) { r = 245; g = 216; b = 118; } // lit bevel
        if (x === 15 || y === 15) { r = 158; g = 118; b = 38; } // shaded bevel
        if ((x === 4 || x === 11) && y > 0 && y < 15) { r = 198; g = 156; b = 52; } // panel seams
        if ((x === 2 || x === 13) && (y === 2 || y === 13)) { r = 250; g = 232; b = 150; } // rivets
        out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255;
      }
    }
    return out;
  })();
  // stained glass: leaded four-pane window (ruby/sapphire/amber/emerald)
  const stainedGlass = (() => {
    const out = new PNG({ width: 16, height: 16 });
    const panes = [
      [196, 44, 60], // TL ruby
      [58, 88, 196], // TR sapphire
      [224, 164, 48], // BL amber
      [52, 160, 84], // BR emerald
    ];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        const lead = x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || x === 8 || y === 7 || y === 8;
        if (lead) {
          out.data[i] = 40; out.data[i + 1] = 38; out.data[i + 2] = 48; out.data[i + 3] = 255;
          continue;
        }
        const q = (x > 8 ? 1 : 0) + (y > 8 ? 2 : 0);
        const [r, g, b] = panes[q];
        const v = ((x * 7 + y * 13) % 5) * 6; // per-pixel pane variation
        out.data[i] = Math.max(0, r - v);
        out.data[i + 1] = Math.max(0, g - v);
        out.data[i + 2] = Math.max(0, b - v);
        out.data[i + 3] = 255;
      }
    }
    // one bright sparkle per pane
    for (const [sx, sy] of [[3, 3], [12, 4], [4, 12], [12, 12]]) {
      const i = (sy * 16 + sx) * 4;
      out.data[i] = Math.min(255, out.data[i] + 70);
      out.data[i + 1] = Math.min(255, out.data[i + 1] + 70);
      out.data[i + 2] = Math.min(255, out.data[i + 2] + 70);
    }
    return out;
  })();

  // ---- ruin/dungeon set (blocks 56-77) ----
  // helper: overlay src's opaque pixels onto a copy of dst at an offset, keeping
  // dst's transparent background transparent (skull heap). Pixels that fall off
  // the tile are dropped.
  const overlayAt = (dst, src, dx, dy) => {
    const out = new PNG({ width: 16, height: 16 });
    dst.data.copy(out.data);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const sx = x - dx, sy = y - dy;
        if (sx < 0 || sy < 0 || sx > 15 || sy > 15) continue;
        const s = (sy * 16 + sx) * 4, d = (y * 16 + x) * 4;
        if (src.data[s + 3] <= 8) continue;
        out.data[d] = src.data[s];
        out.data[d + 1] = src.data[s + 1];
        out.data[d + 2] = src.data[s + 2];
        out.data[d + 3] = 255;
      }
    }
    return out;
  };
  // helper (E7): repaint every opaque pixel matching a predicate on the ORIGINAL
  // pixel. The mask must be read before any darkening pass, or a global tint
  // shifts the whole tile into the predicate. `to` is an [r,g,b] or a
  // (r,g,b)->[r,g,b] map (keeping a ramp's shading instead of flattening it).
  const recolorIf = (png, pred, to) => {
    const out = new PNG({ width: png.width, height: png.height });
    png.data.copy(out.data);
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] === 0) continue;
      const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
      if (!pred(r, g, b)) continue;
      const [rr, rg, rb] = typeof to === "function" ? to(r, g, b) : to;
      out.data[i] = rr; out.data[i + 1] = rg; out.data[i + 2] = rb; out.data[i + 3] = 255;
    }
    return out;
  };

  // rune plate: engraved-ring floor plate. Its inlay is the only blue-grey in the
  // cell (149,168,170 — probed: b > r+20 selects exactly the 36 ring pixels).
  const runePlate = t16(ruin, 22 * 16, 4 * 16);
  const runeGlyph = (r, g, b) => b > r + 20;
  // burning ward: DARKEN THE STONE FIRST (glow:true full-brights the whole cube,
  // so a full-bright pale plate just washes out), then set only the glyph alight.
  const runePlateLit = (() => {
    const mask = [];
    for (let i = 0; i < runePlate.data.length; i += 4)
      mask.push(runeGlyph(runePlate.data[i], runePlate.data[i + 1], runePlate.data[i + 2]));
    const out = tint(runePlate, [38, 42, 58], 0.85);
    for (let i = 0, k = 0; i < out.data.length; i += 4, k++) {
      if (!mask[k]) continue;
      out.data[i] = 120; out.data[i + 1] = 240; out.data[i + 2] = 255; out.data[i + 3] = 255;
    }
    return out;
  })();

  // skull heap: (34,14) and (35,14) are each a single mossy skull that fills ~65%
  // of its cell, so a small offset just mushes them together. Pushed apart on the
  // diagonal (and clipped at the tile edge) they read as two skulls in a heap.
  const skullPile = overlayAt(
    overlayAt(new PNG({ width: 16, height: 16 }), t16(ruin, 35 * 16, 14 * 16), 3, -3),
    t16(ruin, 34 * 16, 14 * 16), -2, 3,
  );

  // PAINTED chain — there is NO chain tile anywhere on the ruindungeons sheet
  // (both column-half catalogs say so). Hand-authored like the glass/web tiles.
  // One period is 8 rows: an oval link on the 8s and an edge-on link threaded
  // through it on the 4s, so a stack of chain blocks is continuous across the
  // tile seam. Kept LIGHT — a dark outline on a dark cave wall reads as nothing.
  const chain = (() => {
    const out = new PNG({ width: 16, height: 16 });
    const STEEL = [150, 154, 162], DARK = [86, 90, 100], LIT = [206, 212, 220];
    const put = (x, y, [r, g, b]) => {
      const yy = ((y % 16) + 16) % 16;
      if (x < 0 || x > 15) return;
      const i = (yy * 16 + x) * 4;
      out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255;
    };
    for (const cy of [0, 8]) {
      // oval link: rows cy+0..cy+4, 6 px wide (x5..x10), hollow centre
      for (const x of [6, 7, 8, 9]) { put(x, cy + 0, STEEL); put(x, cy + 4, DARK); }
      for (let dy = 1; dy <= 3; dy++) { put(5, cy + dy, dy === 2 ? LIT : STEEL); put(10, cy + dy, DARK); }
      // edge-on link: rows cy+3..cy+8, threaded through the oval above and below
      for (let dy = 3; dy <= 8; dy++) { put(7, cy + dy, STEEL); put(8, cy + dy, DARK); }
      put(7, cy + 3, LIT);
    }
    return out;
  })();

  // sickly corpse-light candle: keep the torch's wooden handle, recolour ONLY the
  // three fire ramp colours (the handle's tan/brown also passes a naive r>b test)
  // and map the ramp instead of flattening it, so the flame keeps its shading.
  const torchTile = t16(icons16, 12 * 16, 24 * 16);
  const bogCandle = recolorIf(torchTile, (r) => r >= 240, (r, g) =>
    g > 200 ? [216, 255, 222] : g > 120 ? [118, 232, 152] : [46, 148, 96],
  );

  // rotting planks: darkened/greened lumber + deterministic rot speckle, so the
  // causeway can decay MATERIALLY next to the planks it abuts
  // Speckle SPARSELY: a dense noise pass erases the plank grain and the tile stops
  // reading as boards at all (it reads as mossy dirt). ~4% pits, ~4% bloom.
  const rottingPlanks = (() => {
    const out = tint(planks, [150, 132, 96], 0.55);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        const n = (x * 13 + y * 29 + x * y) % 23;
        if (n === 0) { // rot pit
          out.data[i] = Math.round(out.data[i] * 0.5);
          out.data[i + 1] = Math.round(out.data[i + 1] * 0.52);
          out.data[i + 2] = Math.round(out.data[i + 2] * 0.45);
        } else if (n === 7) { // green bloom
          out.data[i] = Math.round(out.data[i] * 0.72);
          out.data[i + 1] = Math.min(255, Math.round(out.data[i + 1] * 1.05));
          out.data[i + 2] = Math.round(out.data[i + 2] * 0.6);
        }
      }
    }
    return out;
  })();

  const recipes = {
    grass_top: () => grassTop,
    grass_side: () => topStrip(dirt, grassTop),
    dirt: () => dirt,
    stone: () => t16(dungeonSheet, 96, 16),
    sand: () => t16(terrain, 32, 144),
    // autotile trap: (32,64)/(528,64) are the known fully-opaque water/lava cells
    water: () => t16(waterSheet, 32, 64),
    lava: () => t16(waterSheet, 528, 64),
    log: () => logSide,
    log_top: () => logTop,
    leaves: () => t16(outsideSheet, 576, 48),
    planks: () => planks,
    cobblestone: () => t16(castle, 144, 16),
    mossy_cobblestone: () => t16(castle, 160, 32),
    stone_bricks: () => t16(castle, 272, 32),
    sandstone: () => t16(desertSheet, 128, 336),
    sandstone_top: () => t16(desertSheet, 128, 304),
    thatch: () => t16(ff, 400, 256),
    roof: () => t16(house, 475, 156),
    path: () => t16(terrain, 16, 128),
    bedrock: () => t16(dungeonSheet, 432, 224),
    torch: () => t16(icons16, 12 * 16, 24 * 16), // lit wooden torch
    tall_grass: () => chromaKey(t16(terrain, 96, 160), SAND_KEY),
    flower_red: () => chromaKey(t16(terrain, 176, 160), SAND_KEY),
    flower_yellow: () => chromaKey(t16(terrain, 144, 160), SAND_KEY),
    mushroom_red: () => tint(t16(icons16, 11 * 16, 55 * 16), [225, 70, 60], 0.55), // pale cap: takes the red tint cleanly
    mushroom_brown: () => tint(t16(icons16, 1 * 16, 21 * 16), [195, 145, 85], 0.5), // a second, distinct mushroom silhouette
    crystal: () => crystalTile,
    glass: () => glass,
    // ---- worldgen overhaul (blocks 26-50; every grab probed by alpha-scan/zoom) ----
    mud: () => t16(ff, 112, 64), // tilled-soil band (probed at y64, not the design's ~y160)
    // autotile trap: teal deep-water group x336-464; (400,64) is a fully-opaque center
    murk_water: () => t16(waterSheet, 400, 64),
    pale_log: () => paleLogSide,
    pale_log_top: () => paleLogTop,
    dead_leaves: () => t16(outsideSheet, 448, 128), // autumn-orange canopy interior
    reeds: () => stripBlue(t16(outsideSheet, 240, 224)), // cattail tuft, water splash keyed out
    vines: () => tint(flipV(chromaKey(t16(terrain, 96, 160), SAND_KEY)), [88, 150, 92], 0.45),
    glow_shroom: () => tint(t16(icons16, 11 * 16, 55 * 16), [70, 225, 195], 0.6),
    web: () => web,
    dark_stone: () => t16(dungeonSheet, 16, 176), // dark blue-gray pebbled rock band
    dark_bricks: () => t16(darkDim, 160, 80), // fortress masonry wall face
    obsidian: () => t16(darkDim, 112, 240), // near-black void cell (subtle speck, no bright star)
    ash: () => tint(t16(terrain, 32, 144), [126, 124, 122], 0.7),
    charred_log: () => tint(logSide, [58, 50, 46], 0.85),
    ember_crystal: () => tint(crystalTile, [255, 122, 45], 0.75),
    bone_block: () => boneBlock,
    snow: () => snowTop,
    snow_side: () => topStrip(dirt, snowTop),
    ice: () => t16(winter, 224, 304), // diagonal-streak slab interior (crust border starts ~x251)
    blue_crystal: () => tint(crystalTile, [92, 172, 255], 0.75),
    marble: () => t16(dungeonSheet, 32, 128), // pale polished grid floor
    bookshelf: () => squash16(grabComponent(insideSheet, 505, 420)),
    hay: () => hayBlock,
    palisade: () => t16(ff, 416, 192), // vertical sharpened-log wall body
    iron_bars: () => t16(ff, 608, 544), // cage grid (cutout: gaps stay transparent)
    lantern: () => t16(icons16, 11 * 16, 24 * 16), // the LIT lantern ([10,24] is the dark one)
    banner: () => t16(castle, 224, 224), // small shield pennant
    // ---- Sundered City (blocks 51-55) ----
    cracked_bricks: () => crackedBricks,
    rubble: () => rubbleTile,
    red_carpet: () => redCarpet,
    gold_block: () => goldBlock,
    stained_glass: () => stainedGlass,
    // ---- ruin/dungeon set (blocks 56-77). Cell coords are (col,row) on
    // ruindungeons_sheet_full.png (49x52 cells). Every one verified by eye on the
    // contact sheets; the autotile blobs' EDGE cells carry bevels/notches and are
    // avoided — see docs/asset-catalog/ruindungeons-c*.json autotileRegions.
    pale_ruin_stone: () => t16(ruin, 17 * 16, 2 * 16), // blob interior, pure primary (r2 c16-c22)
    pale_temple_brick: () => t16(ruin, 41 * 16, 15 * 16), // pale elevation's plain wall row (r16 = basecourse)
    crypt_slate: () => t16(ruin, 17 * 16, 3 * 16), // blob interior, pure secondary (r3 = blue slate)
    pale_fluted_column: () => t16(ruin, 40 * 16, 11 * 16), // pilaster; one dark edge seam by design
    rune_plate: () => runePlate, // discrete engraved plate (NOT an autotile: c20-c22 x r4-r6)
    rune_plate_lit: () => runePlateLit,
    moss_carpet: () => t16(ruin, 17 * 16, 37 * 16), // blob interior, pure secondary (r37 = moss)
    hanging_moss: () => t16(ruin, 34 * 16, 11 * 16), // full-height alpha strand, anchored at the top edge
    // full-strength tint: at 0.7 the source vine's green survives and roots read olive
    roots: () => tint(flipV(t16(ruin, 34 * 16, 12 * 16)), [214, 162, 104], 1),
    skull_pile: () => skullPile,
    chain: () => chain, // painted — no chain exists on the sheet
    brazier: () => t16(ruin, 38 * 16, 50 * 16), // the symmetric 16px window over the fire-bowl
    temple_boards: () => t16(ruin, 45 * 16, 12 * 16), // c44/c46 carry a trim post; only c45 is clean
    rotting_planks: () => rottingPlanks,
    sewer_brick: () => t16(ruin, 41 * 16, 49 * 16), // clay elevation's plain wall row (r50 = basecourse)
    dungeon_masonry: () => t16(ruin, 45 * 16, 32 * 16), // gold panel's masonry half, clean centre column
    sewer_sludge: () => tint(t16(waterSheet, 400, 64), [86, 116, 52], 0.75),
    bog_candle: () => bogCandle,
    sandstone_tomb_brick: () => t16(ruin, 41 * 16, 32 * 16), // r31 = pediment diagonal, r33 = basecourse
    hieroglyph_wall: () => grab(ruin, 160, 389, 16, 16), // OFF-GRID: the aligned [10,24] cell holds a cornice band
    sandstone_bricks: () => t16(ruin, 17 * 16, 17 * 16), // blob interior, pure primary (gold theme)
    sand_with_slab: () => t16(ruin, 20 * 16, 18 * 16), // discrete inlay-floor row, not the blob
  };

  const names = Object.keys(recipes);
  const cols = 16;
  const rows = 16; // square 16x16-tile atlas — the mesher's UV math needs it
  if (names.length > cols * rows) throw new Error("tile atlas full");
  const atlas = new PNG({ width: cols * 16, height: rows * 16 });
  const index = {};
  names.forEach((name, i) => {
    const tile = recipes[name]();
    TILE_PNGS[name] = tile;
    PNG.bitblt(tile, atlas, 0, 0, 16, 16, (i % cols) * 16, Math.floor(i / cols) * 16);
    // average opaque color for the minimap
    let r = 0, g = 0, b = 0, n = 0;
    for (let p = 0; p < tile.data.length; p += 4) {
      if (tile.data[p + 3] < 128) continue;
      r += tile.data[p]; g += tile.data[p + 1]; b += tile.data[p + 2]; n++;
    }
    index[name] = {
      index: i,
      avgColor: n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0],
    };
  });
  savePng(atlas, "blocks/tiles.png");
  saveJson({ tileSize: 16, atlasCols: cols, tiles: index }, "blocks/tiles.json");
}

// ---------- item icons (whole 16px IconSet; client addresses (col,row)) ----------
{
  const icons = loadPng(resolve(SRC, "IconSet", ICON_SHEET));
  // append one extra row of icons for block items: their icon IS their tile.
  // items.json references these as (col, <rows of the sheet>) — currently row 64.
  // Order is LOAD-BEARING: col i = position i (block_dark_bricks..block_bookshelf
  // are cols 7-13). Append only. tools/verify-icons.mjs enforces both.
  const BLOCK_ITEM_TILES = [
    "planks", "log", "cobblestone", "stone_bricks", "thatch", "glass", "torch",
    "dark_bricks", "marble", "lantern", "palisade", "hay", "iron_bars", "bookshelf",
  ];
  const baseRows = Math.floor(icons.height / 16);
  const extended = new PNG({ width: icons.width, height: (baseRows + 1) * 16 });
  PNG.bitblt(icons, extended, 0, 0, icons.width, icons.height, 0, 0);
  BLOCK_ITEM_TILES.forEach((tileName, i) => {
    const tile = TILE_PNGS[tileName];
    if (!tile) throw new Error(`block item icon: no tile ${tileName}`);
    PNG.bitblt(tile, extended, 0, 0, 16, 16, i * 16, baseRows * 16);
  });
  savePng(extended, "ui/icons.png");
  saveJson({ cell: 16, cols: Math.floor(extended.width / 16), rows: baseRows + 1 }, "ui/icons.json");

  // Dropped-loot billboard: the brown drawstring sack at [1,16]. There is no 32px
  // companion sheet any more, so it is doubled with nearest-neighbour — the same
  // trick the block held-items used, and correct for pixel art.
  const sack = grab(icons, 1 * 16, 16 * 16, 16, 16);
  const bag = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const s = ((y >> 1) * 16 + (x >> 1)) * 4;
      const d = (y * 32 + x) * 4;
      for (let k = 0; k < 4; k++) bag.data[d + k] = sack.data[s + k];
    }
  }
  savePng(trim(bag), "sprites/loot_bag.png");

  // NOTE: ui/held_<item>.png used to be generated here from a 32px icon sheet.
  // The 3D viewmodel (world/ItemMeshes.java) extrudes ui/icons.png directly, so
  // those overlays have been dead since the 3D item layer landed — and the 32px
  // sheet no longer ships. Both are gone.
}

// ---------- FX flipbooks (pixel animation pack, 64x64 frames -> strips) ----------
{
  const FX_DIR = resolve(SRC, "Time Fantasy", "pixel_animations_gfxpack", "individual_frames");
  const FX = {
    slash: { dir: "sword", prefix: "sword1", fps: 24 },
    firebolt: { dir: "fire", prefix: "fire1", fps: 20 },
    frost: { dir: "ice", prefix: "ice1", fps: 20 },
    heal: { dir: "heal", prefix: "heal1", fps: 18 },
    hit: { dir: "impact", prefix: "impact1", fps: 24 },
    arrow: { dir: "arrow", prefix: "arrow1", fps: 24 },
    // fire4_1..11 is the FIRE PILLAR (matches animationsheets/fire.png rows
    // 4-6): frames 1-4 grow, 5-7 full-column loop, 8-11 dissipate. Split into
    // three strips so the client can sequence start → loop×N → end.
    fire_pillar_start: { dir: "fire", prefix: "fire4", fps: 16, range: [1, 4] },
    fire_pillar_loop: { dir: "fire", prefix: "fire4", fps: 12, range: [5, 7] },
    fire_pillar_end: { dir: "fire", prefix: "fire4", fps: 16, range: [8, 11] },
    // explosion1_1..10: the complete burst arc (grow → peak → fade)
    explosion: { dir: "explosion", prefix: "explosion1", fps: 20 },
  };
  const manifest = {};
  for (const [key, spec] of Object.entries(FX)) {
    const dir = resolve(FX_DIR, spec.dir);
    let files = readdirSync(dir)
      .filter((f) => f.startsWith(spec.prefix + "_"))
      .sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));
    if (spec.range) {
      files = files.filter((f) => {
        const n = parseInt(f.split("_")[1]);
        return n >= spec.range[0] && n <= spec.range[1];
      });
    }
    if (files.length === 0) throw new Error(`fx ${key}: no frames for ${spec.prefix}`);
    const frames = files.map((f) => loadPng(resolve(dir, f)));
    const fw = frames[0].width, fh = frames[0].height;
    const strip = new PNG({ width: fw * frames.length, height: fh });
    frames.forEach((f, i) => PNG.bitblt(f, strip, 0, 0, fw, fh, i * fw, 0));
    savePng(strip, `fx/${key}.png`);
    manifest[key] = { frames: frames.length, frameW: fw, frameH: fh, fps: spec.fps };
    console.log(`  fx ${key}: ${frames.length} frames`);
  }
  saveJson(manifest, "fx/fx.json");
}

// The heightmap-era outputs (ground tiles, wall panels, the prop atlas) were
// removed with the block-world pivot's last consumers: nothing under client/src
// reads assets/tiles/, assets/props/ or wood_wall.png any more. Their extraction
// also pinned the old tf_icon_16 sheet, which no longer ships. Blocks are the
// world now (see the block tile atlas above).

console.log("asset build complete");
