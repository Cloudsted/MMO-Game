/**
 * Authored block structures, stamped over generated terrain — the block-built
 * replacement for the old prop/map system. Every portal gets a stone archway;
 * each room adds its own set pieces (hub city, forest arena, desert ruins +
 * oasis, the crypt, the grounds pavilion). All deterministic: layout comes
 * from constants + seeded hashes, never Math.random.
 *
 * Convention: G = terrain surface block y (terrainHeight), FL = G+1 = the y
 * a creature's feet occupy standing on the surface. Builders never touch y 0
 * (bedrock).
 */
import { BLOCK, WORLD_HEIGHT, type RoomDef } from "@fantasy-mmo/common";
import { hash2, type VoxelWorld } from "./voxel.js";
import { scatterPrefabs, type Rect, type ScatterResult } from "./prefabs.js";

const id = (name: string): number => {
  const def = BLOCK[name];
  if (!def) throw new Error(`voxelstructures: unknown block ${name}`);
  return def.id;
};

/** The block surface Builder (and prefabs) write through. VoxelWorld
 *  satisfies it structurally; /prefab's EditRecorder satisfies it too, so
 *  admin stamps route through the persistence overlay instead of gen. */
export interface BlockGrid {
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, id: number): void;
  setIfAir(x: number, y: number, z: number, id: number): void;
  solidAt(x: number, y: number, z: number): boolean;
  terrainHeight(def: RoomDef, x: number, z: number): number;
}

/** Rects claimed by authored builders — prefab scatter must not overlap them.
 *  Kept beside the builders so the constants can't drift apart. */
function authoredExclusions(def: RoomDef): Rect[] {
  const out: Rect[] = [];
  // flagged regions (the forest PvP arena) are always authored ground
  for (const r of def.regions) {
    out.push({ x0: r.x - r.r - 3, z0: r.z - r.r - 3, x1: r.x + r.r + 3, z1: r.z + r.r + 3 });
  }
  if (def.id === "desert") {
    // sunken ruins + the oasis (same constants as buildDesertRuins)
    out.push({ x0: DESERT_RUIN_W.cx - 9, z0: DESERT_RUIN_W.cz - 8, x1: DESERT_RUIN_W.cx + 9, z1: DESERT_RUIN_W.cz + 8 });
    out.push({ x0: DESERT_RUIN_E.cx - 8, z0: DESERT_RUIN_E.cz - 7, x1: DESERT_RUIN_E.cx + 8, z1: DESERT_RUIN_E.cz + 7 });
    out.push({ x0: DESERT_OASIS.x - 10, z0: DESERT_OASIS.z - 10, x1: DESERT_OASIS.x + 10, z1: DESERT_OASIS.z + 10 });
  }
  return out;
}

export function stampStructures(world: VoxelWorld, def: RoomDef): ScatterResult {
  const b = new Builder(world, def);
  // prefab scatter first: authored builders overwrite it where they must,
  // exclusion rects keep prefabs clear of authored ground entirely
  const features = scatterPrefabs(b, def, authoredExclusions(def));
  switch (def.id) {
    case "hub":
      buildHubCity(b, def);
      break;
    case "forest":
      buildForestArena(b, def);
      break;
    case "desert":
      buildDesertRuins(b, def);
      break;
    case "dungeon":
      buildCrypt(b, def);
      break;
    case "grounds":
      buildGroundsPavilion(b, def);
      break;
  }
  // every portal gets a stone archway + a path apron facing the room spawn —
  // stamped LAST so arches always win over scatter and authored ground
  for (const p of def.portals) {
    b.portalArch(Math.round(p.x), Math.round(p.z), Math.abs(def.spawn.x - p.x) > Math.abs(def.spawn.z - p.z));
  }
  return features;
}

export class Builder {
  constructor(
    readonly world: BlockGrid,
    readonly def: RoomDef
  ) {}

  g(x: number, z: number): number {
    return this.world.terrainHeight(this.def, x, z);
  }

  set(x: number, y: number, z: number, block: string | number): void {
    if (y < 1 || y >= WORLD_HEIGHT) return;
    this.world.set(x, y, z, typeof block === "number" ? block : id(block));
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, block: string | number): void {
    const bid = typeof block === "number" ? block : id(block);
    for (let y = Math.max(1, y0); y <= Math.min(WORLD_HEIGHT - 1, y1); y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.world.set(x, y, z, bid);
  }

  /** Remove everything above the ground plane (vegetation, tree canopies). */
  clearAbove(x0: number, z0: number, x1: number, z1: number, groundY: number, height = 14): void {
    this.fill(x0, groundY + 1, z0, x1, Math.min(WORLD_HEIGHT - 1, groundY + height), z1, 0);
  }

  /** Level a rect: terrain columns forced to groundY (dirt under, surface on top). */
  flatten(x0: number, z0: number, x1: number, z1: number, groundY: number, surface: string): void {
    const surfId = id(surface);
    const dirtId = id("dirt");
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        for (let y = Math.max(1, groundY + 1); y < WORLD_HEIGHT; y++) this.world.set(x, y, z, 0);
        for (let y = Math.max(1, groundY - 4); y < groundY; y++) {
          if (!this.world.solidAt(x, y, z)) this.world.set(x, y, z, dirtId);
        }
        this.world.set(x, groundY, z, surfId);
      }
    }
  }

  /** Paint the surface block of existing terrain (roads, plazas). */
  paint(x0: number, z0: number, x1: number, z1: number, surface: string): void {
    const surfId = id(surface);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) this.world.set(x, this.g(x, z), z, surfId);
  }

  paintCircle(cx: number, cz: number, r: number, surface: string): void {
    const surfId = id(surface);
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (Math.hypot(x - cx, z - cz) <= r) this.world.set(x, this.g(x, z), z, surfId);
  }

  torch(x: number, y: number, z: number): void {
    this.set(x, y, z, "torch");
  }

  /** Crenellated wall run along x or z at a fixed ground level. */
  wallRun(x0: number, z0: number, x1: number, z1: number, baseY: number, height: number, block = "stone_bricks"): void {
    this.fill(x0, baseY, z0, x1, baseY + height - 1, z1, block);
    // merlons every other block on top
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        if ((x + z) % 2 === 0) this.set(x, baseY + height, z, block);
  }

  tower(cx: number, cz: number, baseY: number, half: number, height: number, block = "stone_bricks"): void {
    this.fill(cx - half, baseY, cz - half, cx + half, baseY + height - 1, cz + half, block);
    for (let z = cz - half; z <= cz + half; z++)
      for (let x = cx - half; x <= cx + half; x++) {
        const edge = Math.abs(x - cx) === half || Math.abs(z - cz) === half;
        if (edge && (x + z) % 2 === 0) this.set(x, baseY + height, z, block);
      }
    // hollow the top so it reads as a platform
    this.fill(cx - half + 1, baseY + height - 1, cz - half + 1, cx + half - 1, baseY + height - 1, cz + half - 1, block);
  }

  /** Stone portal archway: two pillars + lintel, plus a path apron. */
  portalArch(px: number, pz: number, alongX: boolean): void {
    const g = this.g(px, pz);
    const fl = g + 1;
    this.clearAbove(px - 3, pz - 3, px + 3, pz + 3, g);
    this.paintCircle(px, pz, 3.2, "path");
    const dx = alongX ? 0 : 2;
    const dz = alongX ? 2 : 0;
    // pillars
    this.fill(px - dx, fl, pz - dz, px - dx, fl + 3, pz - dz, "stone_bricks");
    this.fill(px + dx, fl, pz + dz, px + dx, fl + 3, pz + dz, "stone_bricks");
    // lintel spanning the pillars
    this.fill(px - dx, fl + 4, pz - dz, px + dx, fl + 4, pz + dz, "stone_bricks");
    this.set(px, fl + 5, pz, "stone_bricks");
    this.torch(px - dx, fl + 4 + 1, pz - dz);
    this.torch(px + dx, fl + 4 + 1, pz + dz);
  }

  /** Thatch-roofed plank house with log posts, windows, a torch inside. */
  house(x0: number, z0: number, w: number, d: number, groundY: number, doorSide: "n" | "s" | "e" | "w"): void {
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const fl = groundY + 1;
    const wallTop = fl + 2;
    this.clearAbove(x0 - 1, z0 - 1, x1 + 1, z1 + 1, groundY);
    this.flatten(x0, z0, x1, z1, groundY, "planks");
    // walls
    this.fill(x0, fl, z0, x1, wallTop, z0, "planks");
    this.fill(x0, fl, z1, x1, wallTop, z1, "planks");
    this.fill(x0, fl, z0, x0, wallTop, z1, "planks");
    this.fill(x1, fl, z0, x1, wallTop, z1, "planks");
    // log corner posts
    for (const [cx, cz] of [
      [x0, z0],
      [x1, z0],
      [x0, z1],
      [x1, z1],
    ] as const) {
      this.fill(cx, fl, cz, cx, wallTop, cz, "log");
    }
    // door: 1 wide, 2 tall, centered on the chosen side
    const mx = Math.floor((x0 + x1) / 2);
    const mz = Math.floor((z0 + z1) / 2);
    const door: [number, number] =
      doorSide === "n" ? [mx, z0] : doorSide === "s" ? [mx, z1] : doorSide === "w" ? [x0, mz] : [x1, mz];
    this.fill(door[0], fl, door[1], door[0], fl + 1, door[1], 0);
    // windows: glass at eye level on the two sides without the door
    if (doorSide === "n" || doorSide === "s") {
      this.set(x0, fl + 1, mz, "glass");
      this.set(x1, fl + 1, mz, "glass");
    } else {
      this.set(mx, fl + 1, z0, "glass");
      this.set(mx, fl + 1, z1, "glass");
    }
    // hip roof: thatch layers shrinking inward
    let rx0 = x0 - 1,
      rz0 = z0 - 1,
      rx1 = x1 + 1,
      rz1 = z1 + 1,
      ry = wallTop + 1;
    while (rx0 <= rx1 && rz0 <= rz1 && ry < WORLD_HEIGHT - 1) {
      for (let z = rz0; z <= rz1; z++)
        for (let x = rx0; x <= rx1; x++) {
          const edge = x === rx0 || x === rx1 || z === rz0 || z === rz1;
          if (edge || rx1 - rx0 <= 1 || rz1 - rz0 <= 1) this.set(x, ry, z, "thatch");
        }
      rx0++;
      rz0++;
      rx1--;
      rz1--;
      ry++;
    }
    // interior torch opposite the door + one outside beside the door
    const tin: [number, number] =
      doorSide === "n" ? [mx, z1 - 1] : doorSide === "s" ? [mx, z0 + 1] : doorSide === "w" ? [x1 - 1, mz] : [x0 + 1, mz];
    this.torch(tin[0], fl + 1, tin[1]);
    const tout: [number, number] =
      doorSide === "n" ? [door[0] + 1, z0 - 1] : doorSide === "s" ? [door[0] + 1, z1 + 1] : doorSide === "w" ? [x0 - 1, mz + 1] : [x1 + 1, mz + 1];
    this.torch(tout[0], fl + 1, tout[1]);
  }

  /** Open market stall: log posts + flat thatch roof. */
  stall(x0: number, z0: number, w: number, d: number, groundY: number): void {
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const fl = groundY + 1;
    this.clearAbove(x0, z0, x1, z1, groundY);
    this.paint(x0, z0, x1, z1, "path");
    for (const [cx, cz] of [
      [x0, z0],
      [x1, z0],
      [x0, z1],
      [x1, z1],
    ] as const) {
      this.fill(cx, fl, cz, cx, fl + 2, cz, "log");
    }
    this.fill(x0, fl + 3, z0, x1, fl + 3, z1, "thatch");
    // counter along the front
    this.fill(x0 + 1, fl, z1, x1 - 1, fl, z1, "planks");
  }

  /** Big landmark tree: thick trunk + layered canopy. */
  giantTree(cx: number, cz: number, groundY: number, trunkH = 10): void {
    const fl = groundY + 1;
    this.clearAbove(cx - 6, cz - 6, cx + 6, cz + 6, groundY);
    this.fill(cx, fl, cz, cx + 1, fl + trunkH - 1, cz + 1, "log");
    const top = fl + trunkH;
    for (let dy = -2; dy <= 2; dy++) {
      const rad = dy <= 0 ? 5 - Math.abs(dy) : 4 - dy;
      for (let dx = -rad; dx <= rad; dx++)
        for (let dz = -rad; dz <= rad; dz++) {
          if (Math.hypot(dx, dz) > rad + 0.3) continue;
          if (Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
          this.world.setIfAir(cx + dx, top + dy, cz + dz, id("leaves"));
        }
    }
  }

  /** Palm-ish oasis tree: tall bare trunk, small drooping canopy. */
  palm(x: number, z: number): void {
    const g = this.g(x, z);
    const h = 5 + Math.floor(hash2(this.def.terrain.seed, x, z) * 2);
    for (let dy = 1; dy <= h; dy++) this.set(x, g + dy, z, "log");
    const top = g + h + 1;
    this.set(x, top, z, "leaves");
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      this.world.setIfAir(x + dx, top, z + dz, id("leaves"));
      this.world.setIfAir(x + dx * 2, top - 1, z + dz * 2, id("leaves"));
    }
  }
}

// ---------------------------------------------------------------------------
// Hub City — walled, gated, torch-lit; same footprint the old authored map
// used so NPC posts, portals, and bot waypoints stay valid.
// ---------------------------------------------------------------------------
function buildHubCity(b: Builder, def: RoomDef): void {
  const G = b.g(def.spawn.x, def.spawn.z); // plateau ground (base=12)
  const FL = G + 1;

  // --- city wall rectangle with a south gate ---
  const W0 = 24,
    Z0 = 24,
    W1 = 104,
    Z1 = 94;
  const GATE_X0 = 60,
    GATE_X1 = 68;
  b.clearAbove(W0 - 1, Z0 - 1, W1 + 1, Z0 + 1, G);
  b.clearAbove(W0 - 1, Z1 - 1, W1 + 1, Z1 + 1, G);
  b.clearAbove(W0 - 1, Z0 - 1, W0 + 1, Z1 + 1, G);
  b.clearAbove(W1 - 1, Z0 - 1, W1 + 1, Z1 + 1, G);
  b.wallRun(W0, Z0, W1, Z0, FL, 4); // north
  b.wallRun(W0, Z0, W0, Z1, FL, 4); // west
  b.wallRun(W1, Z0, W1, Z1, FL, 4); // east
  b.wallRun(W0, Z1, GATE_X0 - 1, Z1, FL, 4); // south, west of gate
  b.wallRun(GATE_X1 + 1, Z1, W1, Z1, FL, 4); // south, east of gate
  // corner + gate towers
  b.tower(W0, Z0, FL, 2, 7);
  b.tower(W1, Z0, FL, 2, 7);
  b.tower(W0, Z1, FL, 2, 7);
  b.tower(W1, Z1, FL, 2, 7);
  b.tower(GATE_X0 - 2, Z1, FL, 1, 6);
  b.tower(GATE_X1 + 2, Z1, FL, 1, 6);
  b.torch(GATE_X0 - 2, FL + 6 + 1, Z1);
  b.torch(GATE_X1 + 2, FL + 6 + 1, Z1);
  // gate floor
  b.paint(GATE_X0, Z1 - 1, GATE_X1, Z1 + 1, "path");

  // --- plaza + fountain (offset off the spawn point AND the roads) ---
  for (let z = 54; z <= 74; z++)
    for (let x = 54; x <= 74; x++)
      if (Math.hypot(x - 64, z - 64) <= 9.5) b.clearAbove(x, z, x, z, G);
  b.paintCircle(64, 64, 9.5, "cobblestone");
  b.fill(68, FL, 66, 72, FL, 70, "stone_bricks"); // fountain rim
  b.fill(69, FL, 67, 71, FL, 69, "water"); // basin
  b.fill(70, FL, 68, 70, FL + 1, 68, "stone_bricks"); // spout pillar
  b.torch(70, FL + 2, 68);
  // plaza torch ring
  for (const [tx, tz] of [
    [56, 56],
    [72, 56],
    [56, 72],
    [72, 72],
  ] as const) {
    b.fill(tx, FL, tz, tx, FL + 1, tz, "log");
    b.torch(tx, FL + 2, tz);
  }

  // --- roads (vegetation cleared, then painted onto the surface) ---
  const road = (x0: number, z0: number, x1: number, z1: number) => {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) b.clearAbove(x, z, x, z, b.g(x, z), 8);
    b.paint(x0, z0, x1, z1, "path");
  };
  road(63, 73, 65, Z1 + 1); // plaza -> south gate
  road(63, 34, 65, 55); // plaza -> north
  road(36, 63, 55, 65); // plaza -> west market
  road(73, 63, 96, 65); // plaza -> east
  road(62, Z1 + 2, 66, 102); // beyond the gate to the portal row

  // --- houses ringing the plaza (kept clear of NPC posts) ---
  b.house(34, 38, 7, 6, G, "s");
  b.house(50, 32, 7, 6, G, "s");
  b.house(78, 34, 7, 6, G, "s");
  b.house(90, 48, 6, 7, G, "w");
  b.house(90, 72, 6, 7, G, "w");
  b.house(34, 76, 7, 6, G, "e");

  // --- west market: stalls near Mara + Jib ---
  b.stall(42, 56, 4, 3, G);
  b.stall(48, 68, 4, 3, G);
  b.stall(42, 70, 4, 3, G);

  // --- landmark tree on the NE green ---
  b.giantTree(84, 42, b.g(84, 42), 11);

  // --- torches along the roads ---
  for (const [tx, tz] of [
    [62, 80],
    [66, 88],
    [62, 96],
    [66, 99],
    [46, 63],
    [80, 63],
    [63, 44],
  ] as const) {
    b.torch(tx, b.g(tx, tz) + 1, tz);
  }
}

// ---------------------------------------------------------------------------
// Forest — the PvP clearing becomes a proper block arena.
// ---------------------------------------------------------------------------
function buildForestArena(b: Builder, def: RoomDef): void {
  const region = def.regions.find((r) => r.pvp);
  if (!region) return;
  const { x: cx, z: cz, r } = region;
  const G = b.g(cx, cz);
  b.clearAbove(Math.floor(cx - r - 2), Math.floor(cz - r - 2), Math.ceil(cx + r + 2), Math.ceil(cz + r + 2), G, 16);
  // level the bowl and floor it with dirt
  for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++)
      if (Math.hypot(x - cx, z - cz) <= r + 1.5) b.flatten(x, z, x, z, G, "dirt");
  // cobble ring at the rim + four torch pylons
  for (let a = 0; a < 64; a++) {
    const x = Math.round(cx + Math.cos((a / 64) * Math.PI * 2) * r);
    const z = Math.round(cz + Math.sin((a / 64) * Math.PI * 2) * r);
    b.set(x, G + 1, z, "cobblestone");
  }
  for (const [dx, dz] of [
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ] as const) {
    const px = Math.round(cx + dx);
    const pz = Math.round(cz + dz);
    b.fill(px, G + 1, pz, px, G + 3, pz, "cobblestone");
    b.torch(px, G + 4, pz);
  }
  // a center marker: mossy cross inlay
  b.paintCircle(cx, cz, 1.6, "mossy_cobblestone");
}

// ---------------------------------------------------------------------------
// Desert — sunken sandstone ruins at the skeleton camps, palms at the oasis.
// Constants shared with authoredExclusions so scatter stays clear of them.
// (480² retune: the old 160² coords ×3.)
// ---------------------------------------------------------------------------
const DESERT_RUIN_W = { cx: 114, cz: 186, w: 14, d: 11 };
const DESERT_RUIN_E = { cx: 354, cz: 210, w: 12, d: 10 };
const DESERT_OASIS = { x: 324, z: 354 };

function buildDesertRuins(b: Builder, def: RoomDef): void {
  const seed = def.terrain.seed;
  const ruin = (cx: number, cz: number, w: number, d: number) => {
    const x0 = cx - Math.floor(w / 2);
    const z0 = cz - Math.floor(d / 2);
    const G = b.g(cx, cz);
    b.clearAbove(x0 - 1, z0 - 1, x0 + w + 1, z0 + d + 1, G, 12);
    b.flatten(x0, z0, x0 + w - 1, z0 + d - 1, G, "sand");
    // broken perimeter walls: height varies 0..3 per column
    for (let x = x0; x < x0 + w; x++) {
      for (const z of [z0, z0 + d - 1]) {
        const h = Math.floor(hash2(seed ^ 0xa11, x, z) * 4);
        if (h > 0) b.fill(x, G + 1, z, x, G + h, z, "sandstone");
      }
    }
    for (let z = z0 + 1; z < z0 + d - 1; z++) {
      for (const x of [x0, x0 + w - 1]) {
        const h = Math.floor(hash2(seed ^ 0xa12, x, z) * 4);
        if (h > 0) b.fill(x, G + 1, z, x, G + h, z, "sandstone");
      }
    }
    // interior pillars, one intact with a crystal
    b.fill(x0 + 2, G + 1, z0 + 2, x0 + 2, G + 4, z0 + 2, "sandstone");
    b.fill(x0 + w - 3, G + 1, z0 + d - 3, x0 + w - 3, G + 2, z0 + d - 3, "sandstone");
    b.set(x0 + 2, G + 5, z0 + 2, "crystal");
    // half-buried mossy floor scraps
    for (let i = 0; i < 8; i++) {
      const x = x0 + 1 + Math.floor(hash2(seed ^ 0xa13, i, cx) * (w - 2));
      const z = z0 + 1 + Math.floor(hash2(seed ^ 0xa14, i, cz) * (d - 2));
      b.set(x, b.g(x, z), z, "sandstone");
    }
  };
  ruin(DESERT_RUIN_W.cx, DESERT_RUIN_W.cz, DESERT_RUIN_W.w, DESERT_RUIN_W.d);
  ruin(DESERT_RUIN_E.cx, DESERT_RUIN_E.cz, DESERT_RUIN_E.w, DESERT_RUIN_E.d);

  // oasis: carve a pond bowl and ring it with palms
  const OX = DESERT_OASIS.x,
    OZ = DESERT_OASIS.z;
  const wl = def.terrain.waterLevel ?? 10;
  for (let z = OZ - 6; z <= OZ + 6; z++)
    for (let x = OX - 6; x <= OX + 6; x++) {
      const d = Math.hypot(x - OX, z - OZ);
      if (d > 6) continue;
      const depth = d < 3 ? 2 : 1;
      const floor = wl - depth;
      for (let y = floor + 1; y < WORLD_HEIGHT; y++) b.world.set(x, y, z, 0);
      b.world.set(x, floor, z, id("sand"));
      for (let y = floor + 1; y <= wl; y++) b.world.set(x, y, z, id("water"));
    }
  // palms keep their old offsets around the (moved) oasis center
  for (const [dx, dz] of [
    [-7, -2],
    [-4, 6],
    [4, -7],
    [7, 4],
    [0, -8],
  ] as const) {
    b.palm(OX + dx, OZ + dz);
  }
}

// ---------------------------------------------------------------------------
// Sunken Crypt — a walled night ruin: courtyard, processional road, ruined
// chambers, graveyard, and a raised boss hall lit by lava and crystals.
// ---------------------------------------------------------------------------
function buildCrypt(b: Builder, def: RoomDef): void {
  const seed = def.terrain.seed;
  const G = b.g(32, 32);
  const FL = G + 1;

  // perimeter wall (ruined: some merlons missing)
  const M = 2;
  const X1 = def.size.w - 1 - M;
  const Z1 = def.size.h - 1 - M;
  b.wallRun(M, M, X1, M, FL, 4);
  b.wallRun(M, Z1, X1, Z1, FL, 4);
  b.wallRun(M, M, M, Z1, FL, 4);
  b.wallRun(X1, M, X1, Z1, FL, 4);
  for (let i = 0; i < 40; i++) {
    // bites out of the wall top so it reads as a ruin
    const t = hash2(seed ^ 0xc1, i, 0);
    const side = i % 4;
    const along = Math.floor(hash2(seed ^ 0xc2, i, 1) * (def.size.w - 2 * M - 2)) + M + 1;
    const [x, z] = side === 0 ? [along, M] : side === 1 ? [along, Z1] : side === 2 ? [M, along] : [X1, along];
    b.fill(x, FL + 2 + Math.floor(t * 2), z, x, FL + 4, z, 0);
  }
  // wall torches every 8 blocks on the inside
  for (let x = M + 4; x < X1; x += 8) {
    b.torch(x, FL + 2, M + 1);
    b.torch(x, FL + 2, Z1 - 1);
  }

  // spawn courtyard + processional road north
  b.paint(26, 50, 38, 60, "path");
  b.paint(31, 22, 33, 50, "path");
  b.paint(33, 20, 44, 24, "path"); // east spur toward the boss hall

  // ruined chambers over the mob spawn regions
  const chamber = (cx: number, cz: number, w: number, d: number, saltA: number, saltB: number) => {
    const x0 = cx - Math.floor(w / 2);
    const z0 = cz - Math.floor(d / 2);
    b.flatten(x0, z0, x0 + w - 1, z0 + d - 1, G, "mossy_cobblestone");
    for (let x = x0; x < x0 + w; x++)
      for (const z of [z0, z0 + d - 1]) {
        const h = Math.floor(hash2(seed ^ saltA, x, z) * 4);
        if (h > 0) b.fill(x, FL, z, x, FL + h - 1, z, "stone_bricks");
      }
    for (let z = z0 + 1; z < z0 + d - 1; z++)
      for (const x of [x0, x0 + w - 1]) {
        const h = Math.floor(hash2(seed ^ saltB, x, z) * 4);
        if (h > 0) b.fill(x, FL, z, x, FL + h - 1, z, "stone_bricks");
      }
    b.set(x0 + 1, FL, z0 + 1, "crystal");
    b.set(x0 + w - 2, FL, z0 + d - 2, "crystal");
  };
  chamber(22, 40, 12, 10, 0xd1, 0xd2);
  chamber(44, 36, 12, 9, 0xd3, 0xd4);
  chamber(26, 20, 10, 9, 0xd5, 0xd6);

  // graveyard rows east of the courtyard
  for (let gx = 44; gx <= 56; gx += 3) {
    for (let gz = 46; gz <= 56; gz += 4) {
      b.set(gx, FL, gz, "stone");
      b.set(gx, FL + 1, gz, "stone_bricks");
    }
  }

  // boss hall: raised platform, pillars, lava trenches, crystal crown
  const BX = 46,
    BZ = 12;
  b.flatten(BX - 6, BZ - 6, BX + 6, BZ + 5, G, "stone_bricks");
  b.fill(BX - 6, FL, BZ - 6, BX + 6, FL, BZ - 6, "stone_bricks"); // back rim
  for (const [px, pz] of [
    [BX - 5, BZ - 5],
    [BX + 5, BZ - 5],
    [BX - 5, BZ + 4],
    [BX + 5, BZ + 4],
  ] as const) {
    b.fill(px, FL, pz, px, FL + 4, pz, "stone_bricks");
    b.set(px, FL + 5, pz, "crystal");
  }
  // lava trenches flanking the approach
  b.fill(BX - 4, G, BZ + 5, BX - 2, G, BZ + 5, "lava");
  b.fill(BX + 2, G, BZ + 5, BX + 4, G, BZ + 5, "lava");
  // throne dais
  b.fill(BX - 1, FL, BZ - 4, BX + 1, FL, BZ - 3, "stone_bricks");
  b.set(BX, FL + 1, BZ - 4, "stone_bricks");
  b.set(BX, FL + 2, BZ - 4, "crystal");

  // scattered loose crystals for the night glow
  for (let i = 0; i < 14; i++) {
    const x = 4 + Math.floor(hash2(seed ^ 0xe1, i, 0) * (def.size.w - 8));
    const z = 4 + Math.floor(hash2(seed ^ 0xe2, i, 1) * (def.size.h - 8));
    b.world.setIfAir(x, b.g(x, z) + 1, z, id("crystal"));
  }
}

// ---------------------------------------------------------------------------
// Building Grounds — a staging pavilion by the spawn; the rest is canvas.
// ---------------------------------------------------------------------------
function buildGroundsPavilion(b: Builder, def: RoomDef): void {
  const G = b.g(def.spawn.x, def.spawn.z);
  const FL = G + 1;
  const x0 = def.spawn.x - 10;
  const z0 = def.spawn.z - 6;
  b.clearAbove(x0 - 1, z0 - 1, x0 + 8, z0 + 6, G);
  b.flatten(x0, z0, x0 + 7, z0 + 5, G, "planks");
  for (const [px, pz] of [
    [x0, z0],
    [x0 + 7, z0],
    [x0, z0 + 5],
    [x0 + 7, z0 + 5],
  ] as const) {
    b.fill(px, FL, pz, px, FL + 2, pz, "log");
    b.torch(px, FL + 3, pz);
  }
  b.fill(x0, FL + 3, z0, x0 + 7, FL + 3, z0 + 5, "thatch");
}
