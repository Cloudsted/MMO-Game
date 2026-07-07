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

/** Pack sprites into one atlas (single row, 2px padding) + region metadata. */
function buildAtlas(sprites) {
  const pad = 2;
  const width = sprites.reduce((acc, s) => acc + s.png.width + pad, pad);
  const height = sprites.reduce((acc, s) => Math.max(acc, s.png.height), 0) + pad * 2;
  const atlas = new PNG({ width, height });
  const regions = {};
  let x = pad;
  for (const s of sprites) {
    PNG.bitblt(s.png, atlas, 0, 0, s.png.width, s.png.height, x, pad);
    regions[s.name] = { x, y: pad, w: s.png.width, h: s.png.height };
    x += s.png.width + pad;
  }
  return { atlas, regions };
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
  const SHEETS = {
    // the player sheet goes through the same trim as everyone else — the raw
    // 26x36 cell carries 7 px of empty headroom that made players render
    // ~20% shorter than their nominal height
    player: { file: resolve(SRC, "Characters", "Player.png"), single: true },
    slime: { file: resolve(MOBS, "monster1.png"), char: [0, 0] },
    wolf: { file: resolve(MOBS, "monster_wolf1.png"), single: true },
    bandit: { file: resolve(MOBS, "npc5.png"), char: [2, 1] }, // flat-cap burglar
    npc_smith: { file: resolve(CHARS, "npc3.png"), char: [1, 1] }, // red-haired smith
    npc_provisioner: { file: resolve(CHARS, "npc2.png"), char: [0, 0] }, // red-dress woman
    // wizard.png trap: walk grids ONLY in the top half; [0,0] is safe
    npc_arcanist: { file: resolve(MOBS, "wizard.png"), char: [0, 0] },
    npc_guard: { file: resolve(CHARS, "military1.png"), char: [2, 0] }, // plate knight
    villager1: { file: resolve(CHARS, "npc1.png"), char: [3, 1] }, // straw-hat farmer
    villager2: { file: resolve(CHARS, "npc2.png"), char: [1, 0] },
    villager3: { file: resolve(CHARS, "npc1.png"), char: [0, 0] },
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
  const icons16 = loadPng(resolve(SRC, "IconSet", "tf_icon_16.png"));
  // worldgen-overhaul sheets (blocks 26-50)
  const darkDim = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "dark dimension.png"));
  const insideSheet = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "inside.png"));
  const winter = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "Winter", "tf_winter_terrain.png"));

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
    torch: () => t16(icons16, 6 * 16, 12 * 16),
    tall_grass: () => chromaKey(t16(terrain, 96, 160), SAND_KEY),
    flower_red: () => chromaKey(t16(terrain, 176, 160), SAND_KEY),
    flower_yellow: () => chromaKey(t16(terrain, 144, 160), SAND_KEY),
    mushroom_red: () => tint(t16(icons16, 12 * 16, 15 * 16), [225, 70, 60], 0.55),
    mushroom_brown: () => tint(t16(icons16, 13 * 16, 15 * 16), [195, 145, 85], 0.5),
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
    glow_shroom: () => tint(t16(icons16, 12 * 16, 15 * 16), [70, 225, 195], 0.6),
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
    lantern: () => t16(icons16, 5 * 16, 12 * 16), // lit lantern icon
    banner: () => t16(castle, 224, 224), // small shield pennant
    // ---- Sundered City (blocks 51-55) ----
    cracked_bricks: () => crackedBricks,
    rubble: () => rubbleTile,
    red_carpet: () => redCarpet,
    gold_block: () => goldBlock,
    stained_glass: () => stainedGlass,
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
  const icons = loadPng(resolve(SRC, "IconSet", "tf_icon_16.png"));
  // append one extra row of icons for block items: their icon IS their tile.
  // items.json references these as (col, <original rows>) — currently row 21.
  // Order is LOAD-BEARING: col i = position i (block_dark_bricks..block_bookshelf
  // are cols 7-13). Append only.
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

  // 32px icon variants for world/viewmodel use (same grid, 32px cells)
  const icons32 = loadPng(resolve(SRC, "IconSet", "tf_icon_32.png"));
  // loot bag billboard: the brown sack at (13,12)
  savePng(trim(grab(icons32, 13 * 32, 12 * 32, 32, 32)), "sprites/loot_bag.png");
  // first-person held-item viewmodels: EVERY item gets one, extracted at the
  // same grid cell as its inventory icon — the hand always matches the bag
  // (weapons, potions, bread, building pieces alike)
  const itemsJson = JSON.parse(
    readFileSync(resolve(ROOT, "shared", "items.json"), "utf8").replace(/^﻿/, "")
  );
  for (const [id, def] of Object.entries(itemsJson.items)) {
    if (def.block) {
      // block items: the hand shows the block tile (2x nearest-neighbour)
      const tile = TILE_PNGS[def.block];
      if (!tile) throw new Error(`held sprite: no tile for block ${def.block}`);
      const big = new PNG({ width: 32, height: 32 });
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const s = ((y >> 1) * 16 + (x >> 1)) * 4;
          const d = (y * 32 + x) * 4;
          for (let k = 0; k < 4; k++) big.data[d + k] = tile.data[s + k];
        }
      }
      savePng(big, `ui/held_${id}.png`);
      continue;
    }
    const [c, r] = def.icon;
    savePng(trim(grab(icons32, c * 32, r * 32, 32, 32)), `ui/held_${id}.png`);
  }
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
  };
  const manifest = {};
  for (const [key, spec] of Object.entries(FX)) {
    const dir = resolve(FX_DIR, spec.dir);
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(spec.prefix + "_"))
      .sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));
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

// ---------- ground tiles (known-good coords from the PoC pipeline) ----------
{
  const terrain = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "terrain.png"));
  const dungeon = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "dungeon.png"));
  const water = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "water.png"));
  savePng(grab(terrain, 80, 16), "tiles/grass.png");
  savePng(grab(terrain, 32, 96), "tiles/dirt.png");
  savePng(grab(dungeon, 96, 16), "tiles/stone.png");
  savePng(grab(terrain, 32, 144), "tiles/sand.png");
  // autotile trap: (32,64) is the known fully-opaque water tile
  savePng(grab(water, 32, 64), "tiles/water.png");
}

// ---------- wall panels (tile horizontally along wall runs) ----------
{
  const castle = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "castle.png"));
  savePng(grab(castle, 160, 145, 90, 60), "props/wall.png");

  // wood building panel: tiled planks (player-built walls)
  const ff = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "farm and fort.png"));
  const plank = grab(ff, 528, 624, 16, 16);
  savePng(plank, "tiles/planks.png");
  const woodPanel = new PNG({ width: 64, height: 48 });
  for (let ty = 0; ty < 3; ty++)
    for (let tx = 0; tx < 4; tx++) PNG.bitblt(plank, woodPanel, 0, 0, 16, 16, tx * 16, ty * 16);
  savePng(woodPanel, "props/wood_wall.png");
}

// ---------- prop atlas (trees, rocks, buildings, market, arch) ----------
{
  const outside = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "outside.png"));
  const castle = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "castle.png"));
  const farmfort = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "farm and fort.png"));
  const desert = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "desert.png"));
  const icons16 = loadPng(resolve(SRC, "IconSet", "tf_icon_16.png"));
  const defs = [
    // standing torch (icon torch, proven in the PoC); flame + light are client-side
    { sheet: icons16, name: "torch", x: 6 * 16, y: 12 * 16, w: 16, h: 16 },
    // ---- phase 5: desert / dungeon / pvp dressing ----
    { sheet: desert, name: "dead_tree_big", seed: [60, 240] }, // big gray skeleton tree
    { sheet: desert, name: "dead_tree", seed: [28, 275] }, // small gray tree
    // cacti + bones sit on opaque sand tiles: rect + erase the sand band
    { sheet: desert, name: "cactus", x: 110, y: 196, w: 34, h: 28, eraseSand: true },
    { sheet: desert, name: "bone_pile", x: 110, y: 163, w: 36, h: 15 },
    { sheet: desert, name: "desert_rock", seed: [148, 73] }, // rock cluster
    { sheet: castle, name: "banner_purple", seed: [166, 235], flat: true },
    { sheet: castle, name: "banner_red", seed: [200, 235], flat: true },
    { sheet: outside, name: "tree1", x: 528, y: 12, w: 82, h: 100 }, // big landmark tree (sheet has a tile band at y123+)
    { sheet: outside, name: "tree2", x: 312, y: 114, w: 40, h: 66 }, // pine
    { sheet: outside, name: "tree3", x: 272, y: 114, w: 36, h: 66 }, // round green
    { sheet: outside, name: "tree4", x: 430, y: 114, w: 48, h: 66 }, // orange autumn
    { sheet: outside, name: "rock1", x: 124, y: 144, w: 20, h: 22 }, // brown rock
    { sheet: outside, name: "rock2", x: 124, y: 165, w: 20, h: 21 }, // gray rock (full body; blue crystals start ~y188)
    // buildings + market (farm and fort) — flat billboard fronts. The sheet
    // packs kit pieces tightly; erase rects (sprite-local) cut attached clutter.
    { sheet: farmfort, name: "hut", x: 352, y: 222, w: 101, h: 100, flat: true,
      erase: [[0, 0, 15, 42], [0, 42, 14, 58], [87, 42, 14, 58]] },
    { sheet: farmfort, name: "tent1", seed: [380, 430], flat: true },
    { sheet: farmfort, name: "tent2", seed: [465, 425], flat: true },
    { sheet: farmfort, name: "cart", x: 585, y: 208, w: 60, h: 31, flat: true, erase: [[33, 0, 27, 31]] },
    // stone portal archway (castle) — flat, placed at every portal
    { sheet: castle, name: "arch", seed: [456, 140], flat: true },
  ];
  const sprites = defs.map((d) => {
    let png;
    if (d.seed) {
      png = grabComponent(d.sheet, d.seed[0], d.seed[1]);
    } else {
      png = trim(grab(d.sheet, d.x, d.y, d.w, d.h));
      // a sprite filling its whole window usually means the window swallowed
      // neighbouring sheet content (this bit us with tree1)
      if (!d.erase && png.width === d.w && png.height === d.h) {
        console.warn(`WARN: ${d.name} fills its whole window — check for neighbour bleed`);
      }
    }
    if (d.erase) {
      for (const [ex, ey, ew, eh] of d.erase) {
        for (let y = ey; y < Math.min(ey + eh, png.height); y++) {
          for (let x = ex; x < Math.min(ex + ew, png.width); x++) {
            const i = (y * png.width + x) * 4;
            png.data[i] = png.data[i + 1] = png.data[i + 2] = png.data[i + 3] = 0;
          }
        }
      }
      png = trim(png); // retighten after erasing
    }
    if (d.eraseSand) {
      // sprites drawn over an opaque sand tile: key out sandy pixels
      for (let i = 0; i < png.data.length; i += 4) {
        const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
        if (r > 190 && g > 150 && b > 100 && r > b + 40 && g > b + 20) {
          png.data[i + 3] = 0;
        }
      }
      png = trim(png);
    }
    console.log(`  ${d.name}: ${png.width}x${png.height}`);
    return { name: d.name, png, flat: d.flat ?? false };
  });
  const { atlas, regions } = buildAtlas(sprites);
  savePng(atlas, "props/props.png");
  // worldHeight: metres tall in-world (width follows aspect)
  const worldHeights = {
    tree1: 5.2, tree2: 4.2, tree3: 3.6, tree4: 3.8, rock1: 0.85, rock2: 0.7,
    hut: 4.4, tent1: 3.2, tent2: 3.4, cart: 1.5, arch: 5.4,
    dead_tree_big: 5.0, dead_tree: 2.6, cactus: 1.3, bone_pile: 0.5,
    desert_rock: 0.9, banner_purple: 2.3, banner_red: 2.3, torch: 1.1,
  };
  saveJson(
    Object.fromEntries(
      sprites.map((s) => [s.name, { ...regions[s.name], worldHeight: worldHeights[s.name], flat: s.flat }])
    ),
    "props/props.json"
  );
}

console.log("asset build complete");
