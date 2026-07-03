/**
 * Map authoring: generates authored room overlays (shared/rooms/maps/*.json)
 * programmatically — walls, painted ground, hand-placed props — plus a
 * top-down PNG render (tools/out/) so layouts can be eyeballed without
 * booting the stack. Re-run after editing; the layout lives in this file.
 *
 *   node tools/build-maps.mjs
 */
import { PNG } from "pngjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAPS = resolve(ROOT, "shared", "rooms", "maps");
const OUT = resolve(ROOT, "tools", "out");

const STONE = 2;
const DIRT = 1;

// ---------------- hub city ----------------
// 128x128, plateau height 1.6, spawn (64,58) at the plaza.
// Walled rectangle with a south gate; portal apron outside the gate.

function buildHub() {
  const H = 1.6;
  const map = { version: 1, flatten: [], paints: [], props: [], walls: [] };

  // level the city footprint and the portal apron
  map.flatten.push({ x0: 28, z0: 24, x1: 100, z1: 98, height: H });
  map.flatten.push({ x0: 54, z0: 96, x1: 74, z1: 108, height: H });

  // perimeter walls with a 6 m south gate (61..67)
  map.walls.push({ x0: 30, z0: 26, x1: 98, z1: 26, type: "wall" }); // north
  map.walls.push({ x0: 30, z0: 26, x1: 30, z1: 96, type: "wall" }); // west
  map.walls.push({ x0: 98, z0: 26, x1: 98, z1: 96, type: "wall" }); // east
  map.walls.push({ x0: 30, z0: 96, x1: 61, z1: 96, type: "wall" }); // south-left
  map.walls.push({ x0: 67, z0: 96, x1: 98, z1: 96, type: "wall" }); // south-right

  // plaza, roads, market ground, portal apron
  map.paints.push({ shape: "circle", type: STONE, x: 64, z: 58, r: 13 });
  map.paints.push({ shape: "path", type: STONE, points: [[64, 58], [64, 99]], width: 4 });
  map.paints.push({ shape: "path", type: STONE, points: [[32, 58], [96, 58]], width: 3 });
  map.paints.push({ shape: "rect", type: DIRT, x0: 38, z0: 46, x1: 54, z1: 70 }); // market ground
  map.paints.push({ shape: "rect", type: STONE, x0: 56, z0: 96, x1: 72, z1: 105 }); // portal apron

  // landmark tree on the plaza
  map.props.push({ type: "tree1", x: 64, z: 58, r: 0.9, s: 1.6, rot: 0 });

  // hut ring (face the plaza: rot by dominant axis toward it)
  const huts = [
    [44, 38], [58, 32], [76, 36], [90, 46],
    [90, 72], [78, 86], [48, 86], [36, 68],
  ];
  for (const [x, z] of huts) {
    const dx = 64 - x;
    const dz = 58 - z;
    map.props.push({ type: "hut", x, z, r: 1.7, s: 1.0, rot: Math.abs(dx) > Math.abs(dz) ? 90 : 0 });
  }

  // west market: tents, cart, clutter
  map.props.push({ type: "tent1", x: 46, z: 52, r: 1.3, s: 1.0, rot: 90 });
  map.props.push({ type: "tent2", x: 44, z: 62, r: 0.7, s: 1.0, rot: 90 });
  map.props.push({ type: "cart", x: 51, z: 66, r: 0.6, s: 1.0, rot: 0 });
  map.props.push({ type: "rock2", x: 49, z: 48, r: 0.4, s: 1.0, rot: 0 });

  // greenery inside the walls
  map.props.push({ type: "tree3", x: 76, z: 70, r: 0.5, s: 1.0, rot: 0 });
  map.props.push({ type: "tree3", x: 52, z: 42, r: 0.5, s: 0.9, rot: 0 });
  map.props.push({ type: "tree2", x: 88, z: 58, r: 0.5, s: 1.0, rot: 0 });
  map.props.push({ type: "tree4", x: 40, z: 78, r: 0.5, s: 1.0, rot: 0 });

  // a few trees outside the walls so the approach isn't bare
  for (const [x, z, t] of [[20, 40, "tree2"], [22, 82, "tree1"], [106, 36, "tree1"], [108, 78, "tree2"], [84, 110, "tree3"], [44, 110, "tree2"], [104, 104, "tree4"], [16, 60, "tree3"]]) {
    map.props.push({ type: t, x, z, r: 0.55, s: 1.05, rot: 0 });
  }

  return map;
}

// ---------------- render ----------------

function renderMap(map, size, portals, spawn, out) {
  const scale = 6;
  const png = new PNG({ width: size * scale, height: size * scale });
  const put = (x, z, r, g, b) => {
    for (let dz = 0; dz < scale; dz++)
      for (let dx = 0; dx < scale; dx++) {
        const i = ((z * scale + dz) * png.width + x * scale + dx) * 4;
        png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
      }
  };
  const typeColor = { 0: [70, 150, 70], 1: [150, 100, 60], 2: [185, 185, 180], 3: [222, 205, 150] };

  // ground: default grass, then paints (same rasterization rules as the server)
  const types = new Uint8Array((size + 1) * (size + 1));
  for (const p of map.paints) {
    const paint = (x, z, t) => {
      if (x >= 0 && x <= size && z >= 0 && z <= size) types[z * (size + 1) + x] = t;
    };
    if (p.shape === "rect") {
      for (let z = Math.floor(p.z0); z <= Math.ceil(p.z1); z++)
        for (let x = Math.floor(p.x0); x <= Math.ceil(p.x1); x++) paint(x, z, p.type);
    } else if (p.shape === "circle") {
      for (let z = Math.floor(p.z - p.r); z <= Math.ceil(p.z + p.r); z++)
        for (let x = Math.floor(p.x - p.r); x <= Math.ceil(p.x + p.r); x++)
          if (Math.hypot(x - p.x, z - p.z) <= p.r) paint(x, z, p.type);
    } else {
      for (let i = 0; i + 1 < p.points.length; i++) {
        const [ax, az] = p.points[i];
        const [bx, bz] = p.points[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.ceil(len * 2));
        for (let s = 0; s <= steps; s++) {
          const cx = ax + ((bx - ax) * s) / steps;
          const cz = az + ((bz - az) * s) / steps;
          for (let z = Math.floor(cz - p.width / 2); z <= Math.ceil(cz + p.width / 2); z++)
            for (let x = Math.floor(cx - p.width / 2); x <= Math.ceil(cx + p.width / 2); x++)
              if (Math.hypot(x - cx, z - cz) <= p.width / 2) paint(x, z, p.type);
        }
      }
    }
  }
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const c = typeColor[types[z * (size + 1) + x]];
      put(x, z, c[0], c[1], c[2]);
    }

  // walls in dark gray
  for (const w of map.walls) {
    const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
    for (let s = 0; s <= len * 2; s++) {
      const x = Math.round(w.x0 + ((w.x1 - w.x0) * s) / (len * 2));
      const z = Math.round(w.z0 + ((w.z1 - w.z0) * s) / (len * 2));
      put(x, z, 60, 60, 70);
    }
  }
  // props: trees dark green, huts brown, market tan, rocks gray
  for (const p of map.props) {
    const c = p.type.startsWith("tree") ? [10, 80, 10]
      : p.type === "hut" ? [120, 70, 30]
      : p.type.startsWith("tent") || p.type === "cart" ? [200, 170, 110]
      : [90, 90, 90];
    put(Math.round(p.x), Math.round(p.z), c[0], c[1], c[2]);
    put(Math.round(p.x) + (p.type === "hut" ? 1 : 0), Math.round(p.z), c[0], c[1], c[2]);
  }
  // portals magenta, spawn white
  for (const pt of portals) {
    put(Math.round(pt.x), Math.round(pt.z), 220, 40, 220);
  }
  put(Math.round(spawn.x), Math.round(spawn.z), 255, 255, 255);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, PNG.sync.write(png));
  console.log(`rendered ${out}`);
}

// ---------------- main ----------------

mkdirSync(MAPS, { recursive: true });
const hub = buildHub();
writeFileSync(resolve(MAPS, "hub.map.json"), JSON.stringify(hub, null, 2));
console.log(`wrote shared/rooms/maps/hub.map.json (${hub.props.length} props, ${hub.walls.length} walls)`);
renderMap(hub, 128, [{ x: 64, z: 99 }], { x: 64, z: 64 }, resolve(OUT, "hub-map.png"));
