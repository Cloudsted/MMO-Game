// Inspection tool: crop a region from a PNG, upscale (nearest neighbor),
// draw 16px grid lines, save for viewing.
// usage: node scripts/crop.mjs <src.png> <x> <y> <w> <h> [scale=4] [out=scratch/crop.png]
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const [src, xs, ys, ws, hs, ss, out] = process.argv.slice(2);
const x0 = +xs || 0, y0 = +ys || 0;
const scale = +ss || 4;
const png = PNG.sync.read(fs.readFileSync(src));
const w = Math.min(+ws || png.width, png.width - x0);
const h = Math.min(+hs || png.height, png.height - y0);
console.log(`source ${src}: ${png.width}x${png.height}, crop ${x0},${y0} ${w}x${h} @${scale}x`);

const outPng = new PNG({ width: w * scale, height: h * scale });
for (let y = 0; y < h * scale; y++) {
  for (let x = 0; x < w * scale; x++) {
    const sx = x0 + Math.floor(x / scale), sy = y0 + Math.floor(y / scale);
    const si = (sy * png.width + sx) * 4, di = (y * outPng.width + x) * 4;
    let [r, g, b, a] = [png.data[si], png.data[si + 1], png.data[si + 2], png.data[si + 3]];
    if (a < 255) { // checkerboard for transparency
      const c = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) ? 90 : 60;
      r = Math.round(r * a / 255 + c * (1 - a / 255));
      g = Math.round(g * a / 255 + c * (1 - a / 255));
      b = Math.round(b * a / 255 + (c + 30) * (1 - a / 255));
      a = 255;
    }
    // grid: cyan every 16px, red every 64px (relative to source origin 0,0)
    const gx = (x0 * scale + x) % (16 * scale) === 0, gy = (y0 * scale + y) % (16 * scale) === 0;
    const rx = (x0 * scale + x) % (64 * scale) === 0, ry = (y0 * scale + y) % (64 * scale) === 0;
    if (rx || ry) { r = 255; g = 60; b = 60; a = 255; }
    else if (gx || gy) { r = 60; g = 200; b = 220; a = 255; }
    outPng.data[di] = r; outPng.data[di + 1] = g; outPng.data[di + 2] = b; outPng.data[di + 3] = a;
  }
}
const outFile = out || 'scratch-crop.png';
fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, PNG.sync.write(outPng));
console.log('wrote', outFile);
