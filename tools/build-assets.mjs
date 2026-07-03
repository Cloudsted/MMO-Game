/**
 * Art pipeline: Time Fantasy source sheets -> client/assets/ textures + JSON
 * metadata. Phase 1 scope: the default player walk sheet and ground tiles.
 * Grows into full atlasing (terrain splats, props, mobs, icons, FX) in later
 * phases — keep every extraction here, never hand-copy art.
 *
 *   node tools/build-assets.mjs
 */
import { PNG } from "pngjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

// ---------- player walk sheet (single character, 3 cols x 4 rows) ----------
{
  const sheet = loadPng(resolve(SRC, "Characters", "Player.png"));
  savePng(sheet, "sprites/player.png");
  saveJson(
    {
      cols: 3,
      rows: 4,
      frameW: sheet.width / 3,
      frameH: sheet.height / 4,
      rowOrder: ["down", "left", "right", "up"],
      walkCycle: [0, 1, 2, 1],
    },
    "sprites/player.json"
  );
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

// ---------- wall panel (tiles horizontally along wall runs) ----------
{
  const castle = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "castle.png"));
  savePng(grab(castle, 160, 145, 90, 60), "props/wall.png");
}

// ---------- prop atlas (trees, rocks, buildings, market, arch) ----------
{
  const outside = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "outside.png"));
  const castle = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "castle.png"));
  const farmfort = loadPng(resolve(SRC, "Time Fantasy", "TILESETS", "farm and fort.png"));
  const defs = [
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
    console.log(`  ${d.name}: ${png.width}x${png.height}`);
    return { name: d.name, png, flat: d.flat ?? false };
  });
  const { atlas, regions } = buildAtlas(sprites);
  savePng(atlas, "props/props.png");
  // worldHeight: metres tall in-world (width follows aspect)
  const worldHeights = {
    tree1: 5.2, tree2: 4.2, tree3: 3.6, tree4: 3.8, rock1: 0.85, rock2: 0.7,
    hut: 4.4, tent1: 3.2, tent2: 3.4, cart: 1.5, arch: 5.4,
  };
  saveJson(
    Object.fromEntries(
      sprites.map((s) => [s.name, { ...regions[s.name], worldHeight: worldHeights[s.name], flat: s.flat }])
    ),
    "props/props.json"
  );
}

console.log("asset build complete");
