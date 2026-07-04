/**
 * Debug renders of every room's voxel world -> tools/out/voxel-<room>.png
 * (top-down, height-shaded) — the fast way to iterate on terrain gen and
 * block structures without booting the stack.
 *
 *   npx tsx tools/render-voxel.mts
 */
import { PNG } from "pngjs";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoomDefs, BLOCKS } from "../server/common/src/index.js";
import { VoxelWorld } from "../server/shard/src/sim/voxel.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tilesJson = JSON.parse(readFileSync(resolve(ROOT, "client/assets/blocks/tiles.json"), "utf8"));

function colorFor(blockId: number): [number, number, number] {
  const def = BLOCKS[blockId];
  if (!def) return [255, 0, 255];
  const texName = def.tex?.top ?? def.tex?.all ?? def.name;
  const t = tilesJson.tiles[texName] ?? tilesJson.tiles[def.name];
  return t ? t.avgColor : [255, 0, 255];
}

const SCALE = 4;
mkdirSync(resolve(ROOT, "tools/out"), { recursive: true });
for (const [id, def] of loadRoomDefs()) {
  const t0 = Date.now();
  const world = new VoxelWorld(def);
  const genMs = Date.now() - t0;
  const png = new PNG({ width: def.size.w * SCALE, height: def.size.h * SCALE });
  for (let z = 0; z < def.size.h; z++) {
    for (let x = 0; x < def.size.w; x++) {
      const top = world.surfaceY(x, z);
      const [r, g, b] = colorFor(world.get(x, top, z));
      const k = 0.6 + 0.4 * (top / 24); // height-shade: higher = brighter
      for (let sy = 0; sy < SCALE; sy++)
        for (let sx = 0; sx < SCALE; sx++) {
          const i = ((z * SCALE + sy) * png.width + x * SCALE + sx) * 4;
          png.data[i] = Math.min(255, r * k);
          png.data[i + 1] = Math.min(255, g * k);
          png.data[i + 2] = Math.min(255, b * k);
          png.data[i + 3] = 255;
        }
    }
  }
  writeFileSync(resolve(ROOT, `tools/out/voxel-${id}.png`), PNG.sync.write(png));
  const chunks = world.encodeChunks();
  const bytes = chunks.reduce((a, c) => a + c.data.length, 0);
  console.log(
    `${id}: gen ${genMs}ms, ${chunks.length} chunks, wire ~${Math.round(bytes / 1024)}KB b64, spawn standY=${world.standY(def.spawn.x, def.spawn.z)}`
  );
}
