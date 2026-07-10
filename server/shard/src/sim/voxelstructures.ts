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
import { hash2, MIN_DIG_FLOOR, type VoxelWorld } from "./voxel.js";
import { scatterPrefabs, stampPrefab, type LootCachePoint, type Rect, type ScatterResult } from "./prefabs.js";
import {
  buildDrownbell,
  buildLamplightersRoad,
  buildTidewardenTemple,
  DROWNBELL_EXCLUSION,
  GLOOMFEN_SETPIECE_CACHES,
  GLOOMFEN_SETPIECE_SPAWNS,
  LAMPLIGHTERS_ROAD_EXCLUSIONS,
  TEMPLE_EXCLUSION,
  TEMPLE_GUARD_RECENTER,
} from "./setpieces_gloomfen.js";
import { buildAqueductSpine, buildColossusOfSekhat, buildTheThroat } from "./setpieces_desert.js";

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
  if (def.id === "forest") {
    // the Greenhood fort + its portal yard (fixed anchor — the gated door to
    // the Run needs authored coordinates) and the Run's climb-out mound
    out.push(FOREST_FORT_EXCLUSION);
    out.push(FOREST_CLIMBOUT_EXCLUSION);
  }
  if (def.id === "desert") {
    // sunken ruins + the oasis (same constants as buildDesertRuins)
    out.push({ x0: DESERT_RUIN_W.cx - 9, z0: DESERT_RUIN_W.cz - 8, x1: DESERT_RUIN_W.cx + 9, z1: DESERT_RUIN_W.cz + 8 });
    out.push({ x0: DESERT_RUIN_E.cx - 8, z0: DESERT_RUIN_E.cz - 7, x1: DESERT_RUIN_E.cx + 8, z1: DESERT_RUIN_E.cz + 7 });
    out.push({ x0: DESERT_OASIS.x - 10, z0: DESERT_OASIS.z - 10, x1: DESERT_OASIS.x + 10, z1: DESERT_OASIS.z + 10 });
    // the Colossus, the aqueduct spine, and the Throat (S4/S5)
    out.push(...DESERT_SETPIECE_EXCLUSIONS);
    // the Wellhead Crater (E2 front door) — bowl + rim + the eastern stair lane
    out.push(WELLHEAD_RECT);
  }
  if (def.id === "gloomfen") {
    // three authored setpieces (S1/S2/S3) — the Drownbell, the Temple, and the
    // Lamplighters' Road (+ its spur, ward and beached barge). Rects handed back
    // by the setpiece module so the constants can't drift from the geometry.
    out.push(DROWNBELL_EXCLUSION);
    out.push(TEMPLE_EXCLUSION);
    out.push(...LAMPLIGHTERS_ROAD_EXCLUSIONS);
    out.push(GLOOMFEN_GAOL_EXCLUSION);
  }
  if (def.id === "cinderrift") {
    // forge ruin arena + the bone road (same constants as buildCinderrift)
    out.push({
      x0: CINDER_FORGE.ox - 2,
      z0: CINDER_FORGE.oz - 2,
      x1: CINDER_FORGE.ox + CINDER_FORGE.w + 1,
      z1: CINDER_FORGE.oz + CINDER_FORGE.d + 1,
    });
    out.push({ x0: CINDER_ROAD.x - 3, z0: CINDER_ROAD.z0 - 2, x1: CINDER_ROAD.x + 3, z1: CINDER_ROAD.z1 + 2 });
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
      buildGreywatch(b, def);
      break;
    case "forest":
      buildForestArena(b, def);
      buildGreenhoodFort(b, def, features);
      buildClimbOutTell(b, def);
      break;
    case "desert":
      buildDesertRuins(b, def, features);
      break;
    case "dungeon":
      buildCrypt(b, def);
      break;
    case "grounds":
      buildGroundsPavilion(b, def);
      break;
    case "gloomfen":
      buildGloomfen(b, def, features);
      break;
    case "cinderrift":
      buildCinderrift(b, def, features);
      break;
    case "crypt_depths":
      buildCryptDepths(b, def, features);
      break;
    case "sundered_city":
      buildSunderedCity(b, def, features);
      break;
    case "maw":
      buildMaw(b, def);
      break;
    case "greenhood_run":
      buildGreenhoodRun(b, def, features);
      break;
  }
  // every portal gets a stone archway + a path apron facing the room spawn —
  // stamped LAST so arches always win over scatter and authored ground
  for (const p of def.portals) {
    b.portalArch(Math.round(p.x), Math.round(p.z), Math.abs(def.spawn.x - p.x) > Math.abs(def.spawn.z - p.z));
  }
  return features;
}

/** Fixed-anchor a prefab and fold its hooks into the ScatterResult — the
 *  pattern the authored builders use for prefabs too large or too important to
 *  leave to the scatter placer (setpiece lamps, deathwatch posts, the giant
 *  dug structures). Same cache/extraTable wiring the scatter loop does. */
function stampFixedPrefab(b: Builder, features: ScatterResult, id: string, ox: number, oz: number, rot: 0 | 1 | 2 | 3, ruin: 0 | 1 | 2): void {
  const hooks = stampPrefab(b, id, ox, oz, rot, ruin);
  if (hooks.lootCache) features.caches.push(hooks.lootCache);
  if (hooks.spawnRegion?.table) {
    features.extraTables.push({
      id: `${id}-${ox}-${oz}`,
      region: { kind: "circle", x: hooks.spawnRegion.x, z: hooks.spawnRegion.z, r: hooks.spawnRegion.r },
      mobs: hooks.spawnRegion.table.mobs,
      maxAlive: hooks.spawnRegion.table.maxAlive,
      packSize: hooks.spawnRegion.table.packSize,
      respawnSec: hooks.spawnRegion.table.respawnSec,
    });
  }
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

  /**
   * Floor level for a chamber dug `depth` below the surface, clamped off the
   * bottom of the world. y0 is bedrock and `set` refuses y<1, so a floor never
   * sits below MIN_DIG_FLOOR — a shaft cut into low desert ground gets
   * SHALLOWER rather than punching a hole through the underside of the map.
   * (The cut `tomb_of_the_dune_king` prefab dug to a fixed -6 with no clamp in
   * a room whose groundY runs 7..19. This is that bug, made unwritable.)
   */
  digFloorY(groundY: number, depth: number): number {
    return Math.max(MIN_DIG_FLOOR, groundY - depth);
  }

  /**
   * Stamp a 2-D character grid of blocks, so a structure's source reads like
   * the thing it builds. `rows[0]` is always the TOP row as written:
   *
   *   axis "x" — a wall in the x/y plane at constant z. Columns run +x from
   *              `x`; rows run DOWN from `y`.
   *   axis "z" — a wall in the z/y plane at constant x. Columns run +z from
   *              `z`; rows run DOWN from `y`.
   *   axis "y" — a floor plan at constant y. Columns run +x from `x`; rows run
   *              +z from `z` (so the literal is a map you read north-up).
   *
   * A space in `rows` means "leave whatever is there"; '.' means air. Every
   * other character must appear in `legend`.
   */
  plate(x: number, y: number, z: number, axis: "x" | "y" | "z", rows: string[], legend: Record<string, string | number>): void {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      for (let c = 0; c < row.length; c++) {
        const ch = row[c]!;
        if (ch === " ") continue;
        let block: string | number;
        if (ch === ".") block = 0;
        else {
          const named = legend[ch];
          if (named === undefined) throw new Error(`Builder.plate: '${ch}' is not in the legend`);
          block = named;
        }
        if (axis === "x") this.set(x + c, y - r, z, block);
        else if (axis === "z") this.set(x, y - r, z + c, block);
        else this.set(x + c, y, z + r, block);
      }
    }
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

  /** Actual BUILT surface at a column (highest solid block y) — authored
   *  ground included, where g() only knows the natural noise. */
  groundAt(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 1; y--) {
      if (this.world.solidAt(x, y, z)) return y;
    }
    return this.g(x, z);
  }

  /** Stone portal archway: two pillars + lintel, plus a path apron.
   *  Arches stamp AFTER the authored builders, so a portal standing on dug or
   *  raised ground (the Wellhead crater pan, the Maw basin) must anchor to the
   *  BUILT surface — the natural g() would float it 8-16 blocks in the air.
   *  The >2 guard keeps every portal on natural/flattened ground on the
   *  byte-identical legacy path (golden-hash-verified). */
  portalArch(px: number, pz: number, alongX: boolean): void {
    const natural = this.g(px, pz);
    const actual = this.groundAt(px, pz);
    const authoredSite = Math.abs(actual - natural) > 2;
    const g = authoredSite ? actual : natural;
    const fl = g + 1;
    this.clearAbove(px - 3, pz - 3, px + 3, pz + 3, g);
    if (authoredSite) {
      // flat authored ground: paint the apron at ITS level, not the noise's
      for (let z = Math.floor(pz - 3.2); z <= Math.ceil(pz + 3.2); z++)
        for (let x = Math.floor(px - 3.2); x <= Math.ceil(px + 3.2); x++)
          if (Math.hypot(x - px, z - pz) <= 3.2) this.world.set(x, g, z, id("path"));
    } else {
      this.paintCircle(px, pz, 3.2, "path");
    }
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
// GREYWATCH, THE LAST FREE CITY — full authored rebuild (world-redesign 1b,
// story bible §4). Five districts, each placed for a reason:
//   1. Portal-Stone Plaza (center-south): the four natural arches stand in a
//      rough ring around the portal-stone; the south wall BOWS OUTWARD around
//      the cluster — the city built itself around something older. Respawn
//      arrivals wake at the stone (room spawn sits beside it).
//   2. The Charter Hall + bounty board (plaza's east side): the old
//      tithe-counting house — six trophy hooks, all empty; ledger shelves;
//      the board on the plaza rim where every hunter walks past it.
//   3. Market Row (northwest): Gorren's forge, Mara's provisions (chalk-beam
//      tally over her door), Zella's stall under the old survey-tower,
//      Selvara's weaving-shop, Jib's timber yard. Shops face the row.
//   4. The Hunters' Gate (south, at the bow's mouth): formerly the Tithe
//      Gate — both signs still up (rotting tithe board west, fresh Charter
//      board east; the Council's sign-painter never came).
//   5. The Tally Yard (northeast): tribute warehouses on the dead-cart lane
//      past the crypt arch, and the Wall of the Unreturned (quiet corner,
//      one lantern, fresh chisel-dust under the newest name).
// The city is NOT a ruin — warm, busy, defensible. Streets bend, districts
// connect, light sits where people would put it. The shared portal-arch
// builder is deliberately untouched (natural-formation restyle is a flagged
// separate pass).
// ---------------------------------------------------------------------------
const GW_WALL = { x0: 26, z0: 26, x1: 102, z1: 94 }; // main curtain rect
const GW_BULGE = { x0: 46, x1: 82, z1: 104 }; // the south bow around the arch cluster
const GW_GATE = { x0: 60, x1: 68 }; // the Hunters' Gate opening (z = GW_BULGE.z1)
const GW_STONE = { x: 64, z: 75 }; // the portal-stone (2x2 pad; spawn wakes beside it)
const GW_PLAZA = { x: 64, z: 76, r: 14 };

function buildGreywatch(b: Builder, def: RoomDef): void {
  const seed = def.terrain.seed;
  const G = b.g(def.spawn.x, def.spawn.z); // plateau ground (base=12)
  const FL = G + 1;

  // -- dressing helpers --
  const lampPost = (x: number, z: number, light: "torch" | "lantern" = "torch"): void => {
    const g = b.g(x, z); // local ground: ramp-zone posts must not float
    b.clearAbove(x, z, x, z, g, 6);
    b.fill(x, g + 1, z, x, g + 2, z, "log");
    b.set(x, g + 3, z, light);
  };
  const brazier = (x: number, z: number): void => {
    b.set(x, FL, z, "dark_bricks");
    b.set(x, FL + 1, z, "brazier");
  };
  // road: clear vegetation, then path with worn cobble accents
  const road = (x0: number, z0: number, x1: number, z1: number): void => {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        b.clearAbove(x, z, x, z, b.g(x, z), 8);
        b.set(x, b.g(x, z), z, hash2(seed ^ 0x67e1, x, z) < 0.16 ? "cobblestone" : "path");
      }
  };
  // per-column vegetation clear at LOCAL ground — the wall corners leave the
  // plateau, and a clear based on the spawn G would delete the real surface
  // block wherever the ramp ground sits a block higher (exposed-dirt scar)
  const clearLocal = (x0: number, z0: number, x1: number, z1: number): void => {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) b.clearAbove(x, z, x, z, b.g(x, z));
  };
  // wall segment with a flattened footing (corners leave the plateau)
  const wallSeg = (x0: number, z0: number, x1: number, z1: number): void => {
    clearLocal(x0 - 1, z0 - 1, x1 + 1, z1 + 1);
    b.flatten(x0, z0, x1, z1, G, "stone");
    b.wallRun(x0, z0, x1, z1, FL, 4);
  };
  const towerAt = (cx: number, cz: number, half: number, height: number): void => {
    b.flatten(cx - half, cz - half, cx + half, cz + half, G, "stone");
    b.tower(cx, cz, FL, half, height);
  };

  // --- 1. the curtain wall: main rect + the south bow around the arches ---
  wallSeg(GW_WALL.x0, GW_WALL.z0, GW_WALL.x1, GW_WALL.z0); // north
  wallSeg(GW_WALL.x0, GW_WALL.z0, GW_WALL.x0, GW_WALL.z1); // west
  wallSeg(GW_WALL.x1, GW_WALL.z0, GW_WALL.x1, GW_WALL.z1); // east
  wallSeg(GW_WALL.x0, GW_WALL.z1, GW_BULGE.x0, GW_WALL.z1); // south, west of the bow
  wallSeg(GW_BULGE.x1, GW_WALL.z1, GW_WALL.x1, GW_WALL.z1); // south, east of the bow
  wallSeg(GW_BULGE.x0, GW_WALL.z1, GW_BULGE.x0, GW_BULGE.z1); // bow west flank
  wallSeg(GW_BULGE.x1, GW_WALL.z1, GW_BULGE.x1, GW_BULGE.z1); // bow east flank
  wallSeg(GW_BULGE.x0, GW_BULGE.z1, GW_GATE.x0 - 1, GW_BULGE.z1); // bow front, west of the gate
  wallSeg(GW_GATE.x1 + 1, GW_BULGE.z1, GW_BULGE.x1, GW_BULGE.z1); // bow front, east of the gate
  towerAt(GW_WALL.x0, GW_WALL.z0, 2, 7);
  towerAt(GW_WALL.x1, GW_WALL.z0, 2, 7);
  towerAt(GW_WALL.x0, GW_WALL.z1, 2, 7);
  towerAt(GW_WALL.x1, GW_WALL.z1, 2, 7);
  towerAt(GW_BULGE.x0, GW_WALL.z1, 1, 6); // bow shoulders
  towerAt(GW_BULGE.x1, GW_WALL.z1, 1, 6);
  towerAt(GW_BULGE.x0, GW_BULGE.z1, 1, 6); // bow front corners
  towerAt(GW_BULGE.x1, GW_BULGE.z1, 1, 6);

  // --- 4. the Hunters' Gate (formerly the Tithe Gate) ---
  towerAt(GW_GATE.x0 - 3, GW_BULGE.z1, 2, 6);
  towerAt(GW_GATE.x1 + 3, GW_BULGE.z1, 2, 6);
  b.torch(GW_GATE.x0 - 3, FL + 7, GW_BULGE.z1);
  b.torch(GW_GATE.x1 + 3, FL + 7, GW_BULGE.z1);
  // lintel bridging the opening, Charter banners flying on top
  b.fill(GW_GATE.x0 - 1, FL + 4, GW_BULGE.z1, GW_GATE.x1 + 1, FL + 5, GW_BULGE.z1, "stone_bricks");
  for (const bx of [61, 64, 67] as const) b.set(bx, FL + 6, GW_BULGE.z1, "banner");
  // lanterns hung in the gate arch (3 blocks of headroom below)
  b.set(GW_GATE.x0, FL + 3, GW_BULGE.z1, "lantern");
  b.set(GW_GATE.x1, FL + 3, GW_BULGE.z1, "lantern");
  b.paint(GW_GATE.x0, GW_BULGE.z1 - 1, GW_GATE.x1, GW_BULGE.z1 + 1, "path");
  // both gate signs still up: the rotting tithe board west, the fresh
  // Charter board east (a tableau, not a bug — bible §4)
  b.fill(58, FL, 107, 58, FL + 1, 107, "pale_log");
  b.fill(57, FL + 2, 107, 59, FL + 2, 107, "rotting_planks");
  b.fill(70, FL, 107, 70, FL + 1, 107, "log");
  b.fill(69, FL + 2, 107, 71, FL + 2, 107, "planks");
  b.set(70, FL + 3, 107, "banner");

  // --- 2. Portal-Stone Plaza: paved AROUND the stone the city never moved ---
  for (let z = Math.floor(GW_PLAZA.z - GW_PLAZA.r) - 2; z <= Math.ceil(GW_PLAZA.z + GW_PLAZA.r) + 2; z++)
    for (let x = Math.floor(GW_PLAZA.x - GW_PLAZA.r) - 2; x <= Math.ceil(GW_PLAZA.x + GW_PLAZA.r) + 2; x++) {
      const d = Math.hypot(x - GW_PLAZA.x, z - GW_PLAZA.z);
      if (d > GW_PLAZA.r) continue;
      b.clearAbove(x, z, x, z, b.g(x, z));
      const r = hash2(seed ^ 0x67e2, x, z);
      b.set(x, b.g(x, z), z, r < 0.12 ? "path" : r < 0.22 ? "mossy_cobblestone" : "cobblestone");
    }
  // the worn stone ring the plaza was paved around (older than the paving)
  for (let a = 0; a < 48; a++) {
    const ang = (a / 48) * Math.PI * 2;
    const rx = Math.round(GW_STONE.x + Math.cos(ang) * 5);
    const rz = Math.round(GW_STONE.z + Math.sin(ang) * 5);
    b.set(rx, b.g(rx, rz), rz, hash2(seed ^ 0x67e3, rx, rz) < 0.3 ? "mossy_cobblestone" : "stone");
  }
  // the portal-stone itself: low, plain, scorch-free — never decorated
  b.fill(GW_STONE.x - 1, FL, GW_STONE.z - 1, GW_STONE.x, FL, GW_STONE.z, "stone");
  // offerings left at its base (the coins are always gone by morning)
  b.set(GW_STONE.x - 2, FL, GW_STONE.z, "flower_yellow");
  b.set(GW_STONE.x + 1, FL, GW_STONE.z - 1, "flower_red");
  b.set(GW_STONE.x - 1, FL, GW_STONE.z + 2, "flower_yellow");
  lampPost(60, 79, "lantern"); // Ivo's lamp, by the spawn-side of the stone
  brazier(56, 70); // plaza warmth on the diagonals
  brazier(72, 70);
  brazier(56, 84);
  brazier(72, 84);

  // --- streets (they bend: L-runs, not spokes) ---
  road(63, 88, 65, 116); // plaza -> the Hunters' Gate -> the road out
  road(63, 38, 65, 64); // plaza -> north quarter
  road(46, 36, 82, 38); // the back lane along the north wall
  road(46, 62, 57, 64); // plaza -> market (west leg)
  road(44, 38, 46, 66); // Market Row itself (north-south)
  road(72, 52, 74, 66); // plaza -> tally yard (the dead-cart lane, past the crypt arch)
  road(74, 50, 86, 52); // dead-cart lane east leg
  road(80, 34, 82, 52); // tally yard lane (memorial to warehouses)
  road(77, 74, 83, 77); // plaza -> Charter Hall porch

  // --- 3. the Charter Hall (the old tithe-counting house) ---
  const CH = { x0: 84, z0: 69, x1: 96, z1: 83 };
  b.clearAbove(CH.x0 - 5, CH.z0 - 1, CH.x1 + 1, CH.z1 + 1, G);
  b.flatten(CH.x0, CH.z0, CH.x1, CH.z1, G, "planks");
  for (let x = CH.x0; x <= CH.x1; x++) {
    b.fill(x, FL, CH.z0, x, FL + 3, CH.z0, "stone_bricks");
    b.fill(x, FL, CH.z1, x, FL + 3, CH.z1, "stone_bricks");
  }
  for (let z = CH.z0; z <= CH.z1; z++) {
    b.fill(CH.x0, FL, z, CH.x0, FL + 3, z, "stone_bricks");
    b.fill(CH.x1, FL, z, CH.x1, FL + 3, z, "stone_bricks");
  }
  for (const [cx, cz] of [
    [CH.x0, CH.z0],
    [CH.x1, CH.z0],
    [CH.x0, CH.z1],
    [CH.x1, CH.z1],
  ] as const) {
    b.fill(cx, FL, cz, cx, FL + 3, cz, "marble");
  }
  // windows on the south + east faces
  for (const wx of [87, 90, 93] as const) b.set(wx, FL + 1, CH.z1, "glass");
  for (const wz of [73, 79] as const) b.set(CH.x1, FL + 1, wz, "glass");
  // double door, west face, onto the porch
  b.fill(CH.x0, FL, 75, CH.x0, FL + 1, 76, 0);
  // hip roof in red tile — the one civic roof in a thatch town
  {
    let rx0 = CH.x0 - 1,
      rz0 = CH.z0 - 1,
      rx1 = CH.x1 + 1,
      rz1 = CH.z1 + 1,
      ry = FL + 4;
    while (rx0 <= rx1 && rz0 <= rz1 && ry < WORLD_HEIGHT - 1) {
      for (let z = rz0; z <= rz1; z++)
        for (let x = rx0; x <= rx1; x++) {
          const edge = x === rx0 || x === rx1 || z === rz0 || z === rz1;
          if (edge || rx1 - rx0 <= 1 || rz1 - rz0 <= 1) b.set(x, ry, z, "roof");
        }
      rx0++;
      rz0++;
      rx1--;
      rz1--;
      ry++;
    }
  }
  // the trophy wall: marble backing, six hooks — one per tyrant, all empty,
  // hung anyway (the game's promise made furniture)
  b.fill(CH.x0 + 1, FL, CH.z0 + 1, CH.x1 - 1, FL + 2, CH.z0 + 1, "marble");
  for (const hx of [85, 87, 89, 91, 93, 95] as const) b.set(hx, FL + 2, CH.z0 + 2, "iron_bars");
  b.set(90, FL + 3, CH.z0 + 1, "lantern");
  // ledger desks (tithe-counting, repurposed) + the Charter's shelves
  b.fill(86, FL, 74, 88, FL, 74, "planks");
  b.fill(86, FL, 78, 88, FL, 78, "planks");
  b.fill(CH.x1 - 1, FL, 72, CH.x1 - 1, FL + 1, 74, "bookshelf");
  b.fill(CH.x1 - 1, FL, 78, CH.x1 - 1, FL + 1, 80, "bookshelf");
  brazier(86, 81);
  brazier(94, 81);
  // porch on the plaza side
  b.fill(81, FL, 71, 81, FL + 2, 71, "log");
  b.fill(81, FL, 80, 81, FL + 2, 80, "log");
  b.paint(81, 71, 83, 80, "planks");
  b.fill(81, FL + 3, 71, 83, FL + 3, 80, "planks");
  b.set(82, FL + 2, 79, "lantern"); // hung under the porch roof
  b.set(81, FL + 4, 73, "banner");
  b.set(81, FL + 4, 78, "banner");
  // THE BOUNTY BOARD, on the plaza rim where everyone walks past it:
  // Wood L1 · Sands L4 · Crypt L6 (the staggered doors — Bren reads it aloud)
  b.fill(80, FL, 73, 80, FL + 2, 73, "log");
  b.fill(80, FL, 77, 80, FL + 2, 77, "log");
  b.fill(80, FL + 1, 74, 80, FL + 2, 76, "planks");
  b.set(80, FL + 3, 75, "banner");
  b.torch(80, FL + 3, 73);
  b.torch(80, FL + 3, 77);
  brazier(80, 71);
  brazier(80, 79);

  // --- 3. Market Row (northwest; shops face the row) ---
  // Mara's provisions: house + the chalk-beam tally over her front
  b.house(34, 38, 8, 8, G, "e");
  b.fill(42, FL, 40, 42, FL + 2, 40, "log");
  b.fill(42, FL, 44, 42, FL + 2, 44, "log");
  b.fill(42, FL + 3, 40, 42, FL + 3, 44, "planks"); // the beam: parties out, chalked; home, crossed
  b.set(42, FL, 43, "hay"); // flour sacks by the door
  // Gorren's forge: open-fronted smithy shed
  const FG = { x0: 34, z0: 50, x1: 41, z1: 57 };
  b.clearAbove(FG.x0 - 1, FG.z0 - 1, FG.x1 + 1, FG.z1 + 1, G);
  b.flatten(FG.x0, FG.z0, FG.x1, FG.z1, G, "path");
  for (let z = FG.z0; z <= FG.z1; z++) b.fill(FG.x0, FL, z, FG.x0, FL + 2, z, "stone_bricks");
  for (let x = FG.x0; x <= FG.x1 - 1; x++) {
    b.fill(x, FL, FG.z0, x, FL + 2, FG.z0, "stone_bricks");
    b.fill(x, FL, FG.z1, x, FL + 2, FG.z1, "stone_bricks");
  }
  b.fill(FG.x1, FL, FG.z0, FG.x1, FL + 2, FG.z0, "log"); // open east front on log posts
  b.fill(FG.x1, FL, FG.z1, FG.x1, FL + 2, FG.z1, "log");
  b.fill(FG.x0, FL + 3, FG.z0, FG.x1, FL + 3, FG.z1, "planks");
  b.fill(35, FL, 52, 36, FL, 53, "dark_bricks"); // the forge
  b.set(36, FL + 1, 53, "ember_crystal"); // holding its heat
  b.fill(35, FL + 1, 52, 35, FL + 6, 52, "dark_bricks"); // chimney through the roof
  b.set(38, FL, 54, "iron_bars"); // the anvil
  b.set(35, FL, 56, "iron_bars"); // rack of blade blanks
  b.torch(40, FL + 2, 51);
  // Zella's stall under the old survey-tower (older than the Charter)
  b.flatten(50, 40, 54, 44, G, "stone");
  b.tower(52, 42, FL, 2, 10);
  for (let y = FL; y <= FL + 8; y++) {
    for (let z = 40; z <= 44; z++)
      for (let x = 50; x <= 54; x++) {
        if (x !== 50 && x !== 54 && z !== 40 && z !== 44) continue;
        if (hash2(seed ^ 0x67e4, x * 7 + y, z * 11 + y) < 0.12) b.set(x, y, z, "mossy_cobblestone");
      }
  }
  b.set(52, FL + 10, 42, "lantern"); // the survey lamp, still lit
  b.stall(49, 46, 4, 3, G);
  // Selvara's weaving-shop
  b.house(50, 52, 8, 7, G, "w");
  b.set(50, FL + 2, 55, "banner"); // her mark over the door
  b.fill(56, FL, 53, 56, FL + 1, 53, "bookshelf");
  b.fill(56, FL, 57, 56, FL + 1, 57, "bookshelf");
  b.set(56, FL, 55, "marble"); // the weaving lattice
  b.set(56, FL + 1, 55, "blue_crystal");
  // Jib's timber yard (the Freehold's supply line)
  const TY = { x0: 32, z0: 60, x1: 42, z1: 70 };
  b.clearAbove(TY.x0 - 1, TY.z0 - 1, TY.x1 + 1, TY.z1 + 1, G);
  b.flatten(TY.x0, TY.z0, TY.x1, TY.z1, G, "dirt");
  for (let x = TY.x0; x <= TY.x1; x++) {
    b.set(x, FL, TY.z0, "palisade");
    b.set(x, FL, TY.z1, "palisade");
  }
  for (let z = TY.z0; z <= TY.z1; z++) {
    b.set(TY.x0, FL, z, "palisade");
    if (z < 64 || z > 66) b.set(TY.x1, FL, z, "palisade"); // east gate gap
  }
  for (const [cx, cz] of [
    [TY.x0, TY.z0],
    [TY.x1, TY.z0],
    [TY.x0, TY.z1],
    [TY.x1, TY.z1],
  ] as const) {
    b.fill(cx, FL, cz, cx, FL + 1, cz, "palisade");
    b.torch(cx, FL + 2, cz);
  }
  b.fill(34, FL, 62, 38, FL + 1, 63, "log"); // seasoned stock
  b.fill(34, FL, 67, 37, FL, 68, "log");
  b.fill(40, FL, 67, 41, FL + 1, 68, "planks");
  b.set(38, FL, 65, "planks"); // the saw bench
  b.paint(43, 64, 43, 66, "path"); // gate apron onto the row
  // the row well
  b.fill(46, FL, 58, 48, FL, 60, "stone_bricks");
  b.set(47, FL, 59, "water");
  lampPost(47, 41, "lantern");
  lampPost(47, 50, "lantern");

  // --- 5. the Tally Yard (northeast): tribute warehouses, half Charter now ---
  const barn = (x0: number, z0: number, w: number, d: number, doorSide: "w" | "e"): void => {
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    b.clearAbove(x0 - 1, z0 - 1, x1 + 1, z1 + 1, G);
    b.flatten(x0, z0, x1, z1, G, "path");
    for (let x = x0; x <= x1; x++) {
      b.fill(x, FL, z0, x, FL + 2, z0, "planks");
      b.fill(x, FL, z1, x, FL + 2, z1, "planks");
    }
    for (let z = z0; z <= z1; z++) {
      b.fill(x0, FL, z, x0, FL + 2, z, "planks");
      b.fill(x1, FL, z, x1, FL + 2, z, "planks");
    }
    for (const [cx, cz] of [
      [x0, z0],
      [x1, z0],
      [x0, z1],
      [x1, z1],
    ] as const) {
      b.fill(cx, FL, cz, cx, FL + 2, cz, "log");
    }
    const mz = Math.floor((z0 + z1) / 2);
    const dx = doorSide === "w" ? x0 : x1;
    b.fill(dx, FL, mz, dx, FL + 2, mz + 1, 0); // cart door, full height
    b.fill(x0, FL + 3, z0, x1, FL + 3, z1, "thatch");
    b.torch(dx === x0 ? x0 + 2 : x1 - 2, FL + 2, mz - 1);
  };
  barn(83, 38, 10, 8, "w"); // east warehouse, door onto the yard lane
  barn(70, 40, 9, 7, "e"); // west warehouse
  b.fill(85, FL, 40, 87, FL, 41, "hay"); // tribute grain, still warehoused
  b.fill(90, FL, 39, 90, FL + 1, 40, "planks"); // Charter crates
  b.fill(72, FL, 42, 73, FL, 43, "hay");
  b.set(76, FL, 45, "planks");
  b.set(79, FL, 47, "hay"); // a load dropped by the lane
  // the tithe-pen: the herd the Council drives south every new moon —
  // "the arrangement" staged in blocks (Mara's dialog points at it)
  const PEN = { x0: 55, z0: 42, x1: 61, z1: 48 };
  b.clearAbove(PEN.x0, PEN.z0, PEN.x1, PEN.z1, G);
  for (let x = PEN.x0; x <= PEN.x1; x++) {
    b.set(x, FL, PEN.z0, "palisade");
    b.set(x, FL, PEN.z1, "palisade");
  }
  for (let z = PEN.z0; z <= PEN.z1; z++) {
    b.set(PEN.x0, FL, z, "palisade");
    if (z < 44 || z > 45) b.set(PEN.x1, FL, z, "palisade"); // drover's gate on the road side
  }
  b.paint(PEN.x0 + 1, PEN.z0 + 1, PEN.x1 - 1, PEN.z1 - 1, "dirt"); // trampled bare
  b.set(57, FL, 44, "hay");
  b.set(59, FL, 46, "hay");
  b.set(56, FL, 47, "hay");
  b.fill(58, FL, 42, 59, FL, 42, "stone_bricks"); // the trough on the fence line
  b.set(58, FL, 43, "water");
  // the WALL OF THE UNRETURNED (quiet corner: one lantern, no torch ring).
  // Marble panels carry the chiseled names; the newest cut is at the east
  // end, fresh chisel-dust under it. States the respawn mystery wordlessly.
  clearLocal(83, 30, 97, 33);
  b.flatten(84, 31, 96, 31, G, "stone");
  b.fill(84, FL, 31, 96, FL + 3, 31, "stone_bricks");
  for (let px = 85; px <= 95; px += 2) b.set(px, FL + 1, 31, "marble");
  b.set(95, b.g(95, 32), 32, "sand"); // fresh chisel-dust under the newest name
  b.set(87, FL, 32, "flower_yellow"); // left by the families
  b.set(93, FL, 32, "flower_red");
  lampPost(96, 33, "lantern");
  lampPost(79, 52, "torch"); // dead-cart lane junction

  // --- residential: the town the districts serve ---
  b.house(34, 74, 7, 6, G, "e"); // southwest quarter
  b.house(33, 84, 8, 6, G, "e");
  b.house(42, 86, 7, 6, G, "n");
  b.house(86, 86, 7, 6, G, "n"); // southeast quarter
  b.house(94, 87, 6, 7, G, "w");
  b.house(54, 30, 7, 6, G, "s"); // north quarter, doors on the back lane
  b.house(68, 30, 7, 6, G, "s");
  // the green: one old tree inside the bow, west of the gate road
  b.giantTree(56, 90, b.g(56, 90), 10);
  // the Charter muster corner in the bow yard (banners + fodder)
  b.fill(74, FL, 96, 74, FL + 1, 96, "palisade");
  b.set(74, FL + 2, 96, "banner");
  b.set(76, FL, 97, "hay");
  b.set(75, FL, 95, "hay");

  // --- lamplight along the streets ---
  lampPost(61, 92);
  lampPost(67, 98);
  lampPost(61, 108); // the road out
  lampPost(67, 114);
  lampPost(62, 44); // north road
  lampPost(66, 58);
  lampPost(75, 60); // dead-cart lane
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
// THE GREENHOOD FORT + THE GREENHOOD RUN — owner seed #1 (world-redesign
// batch 3, story bible §6 W1 landmark 1 / §6 W2). The poacher company's
// palisade fort squats on the old hunting road; INSIDE it, behind a second
// palisade yard, stands the gate to their smuggling tunnel east. The gate is
// event-sealed while Thrace the Redcap lives (bossDeath → openPortal;
// reseals when he respawns — his 900 s respawnSec is the door-ajar window).
//
//   Forest side: the shared bandit_fort prefab, FIXED-ANCHORED at a surveyed
//   flat dry shelf east of the hub→fen road (natural g uniformly 13; the old
//   scatter placement near (255,90) sat in pond country). A walled portal
//   yard annexes the fort's north wall — you fight THROUGH the camp (south
//   gate → around the fire ring → the inner gap, offset east) to reach the
//   arch. The Run's one-way climb-out surfaces at a trapdoor mound further
//   north (no portal there — computePortalArrival's one-way landing).
//
//   The Run: a 96² preset warren dug through the slab UNDER the wood —
//   shored galleries bending east (frames, lanterns: the Run is LIT, the
//   company lives here), the kennel row (iron-bar pens), the bunkroom, a
//   buried pre-Dividing cellar the company broke into (pale stone, wine
//   racks, a chiseled-off crest), a crawl to a bolt-hole stash, and Grole's
//   tally-vault — shelved floor-to-ceiling, crate rows addressed to
//   creatures, the strongroom cache behind iron bars. Both portal chambers
//   are open-to-sky shafts (standY = the shaft floor, so paired arrivals
//   land INSIDE; daylight pours down the entrance the way a cellar door
//   would). No straight line exists from any portal to Grole.
//
// DETERMINISM: layout constants fixed; every ragged edge is hash2(seed^salt).
// ---------------------------------------------------------------------------
const FOREST_FORT = { ox: 308, oz: 148 }; // bandit_fort min corner (15x12, rot 0) — interior center (315,154)
const FORT_YARD = { x0: 308, z0: 138, x1: 322, z1: 148 }; // portal yard sharing the fort's north wall (z1)
const FOREST_GREENHOOD_PORTAL = { x: 313, z: 143 }; // must match forest.json forest-greenhood
const FOREST_FORT_EXCLUSION: Rect = { x0: 305, z0: 135, x1: 325, z1: 162 };
const FOREST_CLIMBOUT = { x: 168, z: 118 }; // the Run's one-way surface tell (greenhood-out exitX/exitZ)
const FOREST_CLIMBOUT_EXCLUSION: Rect = { x0: 162, z0: 112, x1: 175, z1: 125 };

function buildGreenhoodFort(b: Builder, def: RoomDef, features: ScatterResult): void {
  // the fort itself: the shared prefab, fixed-anchored. Its hooks ride in via
  // stampFixedPrefab (loot cache "auto" → cache_forest at the crate corner).
  stampFixedPrefab(b, features, "bandit_fort", FOREST_FORT.ox, FOREST_FORT.oz, 0, 0);
  const G = b.g(FOREST_FORT.ox + 7, FOREST_FORT.oz + 6); // the stamp's flatten datum (surveyed 13)
  const FL = G + 1;
  const { x0, z0, x1, z1 } = FORT_YARD;
  // the portal yard: cleared, flattened to the fort's level (portal cell
  // natural g === G, surveyed — the arch apron paints at yard level)
  b.clearAbove(x0 - 1, z0 - 1, x1 + 1, z1 - 1, G, 14);
  b.flatten(x0, z0, x1, z1 - 1, G, "dirt");
  // palisade ring (north + west + east; south IS the fort's own north wall)
  for (let x = x0; x <= x1; x++) b.fill(x, FL, z0, x, FL + 2, z0, "palisade");
  for (let z = z0 + 1; z < z1; z++) {
    b.fill(x0, FL, z, x0, FL + 2, z, "palisade");
    b.fill(x1, FL, z, x1, FL + 2, z, "palisade");
  }
  // the inner gate: a 2-wide gap knocked through the shared wall, OFFSET EAST
  // of the fort's south gate (x314-316) and clear of the lean-to at x318-320 —
  // the walk to the portal doubles back west inside the yard
  b.fill(316, FL, z1, 317, FL + 2, z1, 0);
  b.fill(315, FL, z1, 315, FL + 3, z1, "log");
  b.fill(318, FL, z1, 318, FL + 3, z1, "log");
  b.set(315, FL + 4, z1, "banner");
  // the yard is lit — goods move through this door nightly
  b.fill(310, FL, 140, 310, FL + 2, 140, "log");
  b.set(310, FL + 3, 140, "lantern");
  b.fill(318, FL, 145, 318, FL + 2, 145, "log");
  b.set(318, FL + 3, 145, "lantern");
  // crates staged by the door (interrupted action: the next shipment)
  b.set(320, FL, 139, "planks");
  b.set(321, FL, 139, "planks");
  b.set(321, FL, 140, "hay");
}

function buildClimbOutTell(b: Builder, def: RoomDef): void {
  const { x, z } = FOREST_CLIMBOUT;
  const G = b.g(x, z);
  b.clearAbove(x - 4, z - 4, x + 5, z + 5, G, 12);
  // a low dirt mound with a rotting-plank trapdoor set flush in its crown —
  // the Run's one-way door, read from the surface. Arrivals land ON it
  // (exitX/exitZ 168.5,118.5 → standY = the mound top) and step down.
  for (let dz = -3; dz <= 4; dz++) {
    for (let dx = -3; dx <= 4; dx++) {
      const d = Math.hypot(dx - 0.5, dz - 0.5);
      if (d > 3.6) continue;
      const h = d < 1.7 ? 2 : 1;
      b.fill(x + dx, G + 1, z + dz, x + dx, G + h, z + dz, "dirt");
    }
  }
  // the trapdoor: 2x2 rotting planks flush in the crown
  for (const [dx, dz] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    b.set(x + dx, G + 2, z + dz, "rotting_planks");
  }
  // the hollow stump beside it, wearing a smuggler's lantern — the only mark
  b.fill(x - 4, G + 1, z - 2, x - 4, G + 2, z - 2, "log");
  b.set(x - 3, G + 1, z - 2, "log");
  b.set(x - 4, G + 3, z - 2, "lantern");
}

// ---------------------------------------------------------------------------
// The Greenhood Run itself (room `greenhood_run`, biome "ruin": a flat
// 24-high slab the builder digs the warren through). See the banner above.
// Convention: RUN_FLOOR is the floor SURFACE block y (feet stand at +1).
// ---------------------------------------------------------------------------
const RUN_FLOOR = 11;
const RUN_E = { x: 18, z: 78 }; // entrance shaft (open sky; portal greenhood-fort at its center)
const RUN_X = { x: 80, z: 12 }; // the East Door climb-out shaft (open sky; portal greenhood-out)
const RUN_VAULT = { x0: 60, z0: 20, x1: 78, z1: 32 }; // the tally-vault (Grole's arena)

/** Loot caches the Run keeps stocked — the room REWARDS the players who
 *  earned entry (respawn timers carry the replay value; persistence is
 *  stateful so lastLootedAt survives restarts). */
const RUN_CACHES: LootCachePoint[] = [
  { x: 47.5, y: RUN_FLOOR + 1, z: 38.5, table: "cache_greenhood_run", respawnSec: 480 }, // the buried cellar
  { x: 65.5, y: RUN_FLOOR + 1, z: 48.5, table: "cache_greenhood_run", respawnSec: 480 }, // the bolt-hole stash
  { x: 76.5, y: RUN_FLOOR + 1, z: 21.5, table: "cache_greenhood_run", respawnSec: 900 }, // the strongroom (the best stash sits near Grole)
];

function buildGreenhoodRun(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const F = RUN_FLOOR;
  const w = b.world;
  const DIRT = id("dirt");
  const MUD = id("mud");
  const ROT = id("rotting_planks");

  /** Dig a rect gallery: air F+1..F+h, floor dressed dirt/mud/planks. */
  const carve = (x0: number, z0: number, x1: number, z1: number, h: number, floor?: string): void => {
    const floorId = floor ? id(floor) : -1;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        for (let y = F + 1; y <= F + h; y++) w.set(x, y, z, 0);
        if (floorId >= 0) w.set(x, F, z, floorId);
        else {
          const r = hash2(seed ^ 0x6e11, x, z);
          w.set(x, F, z, r < 0.14 ? MUD : r < 0.24 ? ROT : DIRT);
        }
      }
    }
  };
  /** Open-to-sky shaft chamber (standY = its floor: paired arrivals land in). */
  const shaft = (cx: number, cz: number, r: number): void => {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (Math.hypot(x - cx, z - cz) > r) continue;
        for (let y = F + 1; y < WORLD_HEIGHT; y++) w.set(x, y, z, 0);
        w.set(x, F, z, DIRT);
        // vine strands down the shaft wall — how the company climbs it
        if (hash2(seed ^ 0x6e12, x, z) < 0.2) {
          const g = b.g(x, z);
          for (let y = g; y > g - 4; y--) w.setIfAir(x, y, z, id("vines"));
        }
      }
    }
  };

  // --- the dig (galleries bend; no straight line reaches the vault) ---
  shaft(RUN_E.x, RUN_E.z, 5.5); // entrance shaft (portal + spawn)
  shaft(RUN_X.x, RUN_X.z, 4.5); // the East Door
  carve(16, 77, 35, 79, 3); // c1: the gullet, east from the entrance
  carve(33, 54, 35, 79, 3); // c2: north leg past the kennels
  carve(29, 64, 39, 72, 4); // K: the kennel row
  carve(33, 53, 59, 55, 3); // c4: east leg to the bunkroom
  carve(44, 50, 56, 58, 4); // B: the bunkroom
  carve(43, 45, 45, 52, 3); // s1: cellar stair spur
  carve(40, 37, 48, 45, 4, "pale_temple_brick"); // C: the buried cellar (pre-Dividing)
  carve(57, 37, 59, 55, 3); // c5: north leg
  carve(58, 47, 64, 48, 2); // s2: the crawl (low — goods, not people)
  carve(63, 46, 66, 50, 3); // P: the bolt-hole stash pocket
  carve(57, 37, 81, 39, 3); // c6: the long east gallery
  carve(65, 32, 67, 39, 3); // c7: the vault approach (south door)
  carve(RUN_VAULT.x0, RUN_VAULT.z0, RUN_VAULT.x1, RUN_VAULT.z1, 6, "planks"); // V: the tally-vault
  carve(78, 27, 81, 28, 3); // the vault's east door onto the bypass
  carve(79, 13, 81, 39, 3); // c8: the bypass north to the East Door

  // --- shoring frames + lanterns along the galleries (the Run is LIT) ---
  const frames: Array<[number, number, number, number, "x" | "z"]> = [
    [16, 77, 35, 79, "x"], // c1
    [33, 54, 35, 79, "z"], // c2
    [33, 53, 59, 55, "x"], // c4
    [57, 37, 59, 55, "z"], // c5
    [57, 37, 81, 39, "x"], // c6
    [79, 13, 81, 39, "z"], // c8
  ];
  for (const [x0, z0, x1, z1, axis] of frames) {
    const len = axis === "x" ? x1 - x0 : z1 - z0;
    for (let i = 2; i < len - 1; i += 6) {
      const fx = axis === "x" ? x0 + i : x0;
      const fz = axis === "x" ? z0 : z0 + i;
      // never frame inside the shaft chambers: the portal arch anchors to
      // groundAt, and a frame lintel over the portal column would hoist the
      // whole arch (and its apron) 3 blocks into the air
      if (Math.hypot(fx - RUN_E.x, fz - RUN_E.z) < 7) continue;
      if (Math.hypot(fx - RUN_X.x, fz - RUN_X.z) < 6) continue;
      const [ax, az, bx, bz] = axis === "x" ? [fx, z0, fx, z1] : [x0, fz, x1, fz];
      b.fill(ax, F + 1, az, ax, F + 2, az, "palisade");
      b.fill(bx, F + 1, bz, bx, F + 2, bz, "palisade");
      for (let j = 0; j <= 2; j++) {
        b.set(axis === "x" ? fx : x0 + j, F + 3, axis === "x" ? z0 + j : fz, "log");
      }
      // every other frame hangs a lantern on the alternating post
      if (Math.floor(i / 6) % 2 === 0) b.set(ax, F + 3, az, "lantern");
      else b.set(bx, F + 3, bz, "lantern");
    }
  }
  // roots + moss work through the gallery ceilings; webs take the corners
  for (let z = 8; z < 84; z++) {
    for (let x = 12; x < 86; x++) {
      if (w.solidAt(x, F + 1, z) || !w.solidAt(x, F - 1, z)) continue; // carved columns only
      const r = hash2(seed ^ 0x6e13, x, z);
      if (r < 0.05) w.setIfAir(x, F + 3, z, id("roots"));
      else if (r < 0.09) w.setIfAir(x, F + 3, z, id("hanging_moss"));
      else if (r > 0.985) w.setIfAir(x, F + 1, z, id("web"));
    }
  }

  // --- the kennel row: iron-bar pens, hay, what the curs gnaw ---
  for (const pz of [65, 68, 71]) {
    b.fill(31, F + 1, pz - 1, 31, F + 2, pz + 1, "iron_bars");
    b.set(31, F + 1, pz, 0); // pen door stands open — the curs are OUT
    b.set(30, F, pz, id("hay"));
    b.set(29, F + 1, pz, "hay");
  }
  b.set(30, F + 1, 66, "bone_block");
  b.set(38, F + 1, 71, "skull_pile");
  b.fill(38, F + 1, 65, 38, F + 2, 65, "log");
  b.set(38, F + 3, 65, "lantern");

  // --- the bunkroom: bedrolls, the fire ring, the company at rest ---
  for (const [hx, hz] of [
    [45, 51],
    [45, 53],
    [45, 56],
    [55, 51],
    [55, 53],
    [55, 57],
  ] as const) {
    b.set(hx, F + 1, hz, "hay");
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      b.set(50 + dx, F, 54 + dz, "cobblestone");
    }
  }
  b.set(50, F + 1, 54, "torch");
  b.set(47, F + 1, 57, "planks");
  b.set(48, F + 1, 57, "planks");
  b.set(48, F + 2, 57, "hay");

  // --- the buried cellar: the world before, glimpsed underground ---
  // pale stone lining on the walls the company's lamps actually reach
  for (let x = 40; x <= 48; x++) {
    b.fill(x, F + 1, 36, x, F + 4, 36, "pale_ruin_stone");
    b.fill(x, F + 1, 46, x, F + 4, 46, "pale_ruin_stone");
  }
  for (let z = 37; z <= 45; z++) {
    b.fill(39, F + 1, z, 39, F + 4, z, "pale_ruin_stone");
    b.fill(49, F + 1, z, 49, F + 4, z, "pale_ruin_stone");
  }
  // the cellar door: re-open the lining where the stair spur breaks in
  b.fill(44, F + 1, 46, 45, F + 2, 46, 0);
  // wine racks along the north wall; one rack toppled
  for (const rx of [41, 43, 45]) {
    b.fill(rx, F + 1, 38, rx, F + 2, 38, "bookshelf");
  }
  b.set(47, F + 1, 42, "bookshelf");
  // the family crest, chiseled off (marble arms, cracked center)
  b.fill(40, F + 1, 40, 40, F + 3, 42, "marble");
  b.set(40, F + 2, 41, "cracked_bricks");
  // the cache plinth + the one light the company left burning
  b.set(47, F + 1, 39, "marble");
  b.fill(42, F + 1, 44, 42, F + 2, 44, "log");
  b.set(42, F + 3, 44, "lantern");

  // --- the bolt-hole stash: crates and webs (nobody's been in a while) ---
  b.set(63, F + 1, 46, "planks");
  b.set(64, F + 1, 46, "planks");
  b.set(64, F + 2, 46, "planks");
  b.set(66, F + 1, 50, "web");

  // --- the tally-vault: Grole's arena — the fight is an audit ---
  const V = RUN_VAULT;
  // shelved floor-to-ceiling (bookshelf runs, ragged where stock moved)
  for (let x = V.x0 + 1; x <= V.x1 - 1; x++) {
    if (hash2(seed ^ 0x6e14, x, V.z0) < 0.75) b.fill(x, F + 1, V.z0 + 1, x, F + 4, V.z0 + 1, "bookshelf");
  }
  for (let z = V.z0 + 3; z <= V.z1 - 1; z++) {
    if (z >= 26 && z <= 29) continue; // the east-door row stays clear
    if (hash2(seed ^ 0x6e15, V.x0, z) < 0.6) b.fill(V.x0 + 1, F + 1, z, V.x0 + 1, F + 3, z, "bookshelf");
  }
  // crate rows flank the floor (aisles clear — Grole needs his arena)
  for (const cz of [29, 30]) {
    for (let x = 62; x <= 66; x++) {
      if (hash2(seed ^ 0x6e16, x, cz) < 0.7) b.set(x, F + 1, cz, "planks");
    }
    b.set(63, F + 2, cz, "hay");
  }
  for (let z = 22; z <= 25; z++) {
    if (hash2(seed ^ 0x6e17, 62, z) < 0.7) b.set(62, F + 1, z, "planks");
  }
  // Grole's desk: the LEDGER, and the lamp he reads it by
  b.set(68, F + 1, 22, "planks");
  b.set(69, F + 1, 22, "planks");
  b.set(68, F + 2, 22, "bookshelf");
  b.set(69, F + 2, 22, "lantern");
  // company banners over the south door
  b.set(64, F + 4, V.z1, "banner");
  b.set(68, F + 4, V.z1, "banner");
  // corner lamp posts — the vault is the best-lit room in the wood
  for (const [lx, lz] of [
    [V.x0 + 2, V.z1 - 2],
    [V.x1 - 2, V.z1 - 2],
    [V.x1 - 6, V.z0 + 2],
  ] as const) {
    b.fill(lx, F + 1, lz, lx, F + 3, lz, "log");
    b.set(lx, F + 4, lz, "lantern");
  }
  // the strongroom: iron bars, one gap, the best stash in the Run
  b.fill(74, F + 1, 21, 74, F + 3, 21, "iron_bars");
  b.fill(74, F + 1, 23, 74, F + 3, 23, "iron_bars");
  b.fill(74, F + 1, 24, 77, F + 3, 24, "iron_bars");
  b.set(74, F + 1, 22, 0); // the gap — Grole never locks what he can watch
  b.set(74, F + 2, 22, 0);
  b.set(75, F + 1, 23, "planks");
  b.set(77, F + 1, 21, "planks");

  // --- the East Door chamber: goods out, not people back ---
  b.set(82, F + 1, 10, "planks");
  b.set(82, F + 1, 11, "planks");
  b.set(82, F + 2, 10, "hay");
  b.fill(77, F + 1, 15, 77, F + 2, 15, "log");
  b.set(77, F + 3, 15, "lantern");

  // the stocked stashes (respawn timers = the room's replay value)
  for (const c of RUN_CACHES) features.caches.push({ ...c });
}

// ---------------------------------------------------------------------------
// Desert — sunken sandstone ruins at the skeleton camps, palms at the oasis.
// Constants shared with authoredExclusions so scatter stays clear of them.
// (480² retune: the old 160² coords ×3.)
// ---------------------------------------------------------------------------
const DESERT_RUIN_W = { cx: 114, cz: 186, w: 14, d: 11 };
const DESERT_RUIN_E = { cx: 354, cz: 210, w: 12, d: 10 };
const DESERT_OASIS = { x: 324, z: 354 };

// Sunscour setpiece footprints (S4 Colossus + tomb, S5 Aqueduct + Throat) —
// authored in setpieces_desert.ts, mirrored here as constants so
// authoredExclusions() can keep prefab scatter off them before the build runs.
// TIGHT rects (the aqueduct is a thin line): a per-leg strip, not a bounding
// box, or half the room would be sterilised from scatter.
const DESERT_SETPIECE_EXCLUSIONS: Rect[] = [
  { x0: 214, z0: 226, x1: 262, z1: 266 }, // Colossus of Sekhat + the tomb beneath
  { x0: 244, z0: 118, x1: 248, z1: 240 }, // aqueduct leg C
  { x0: 182, z0: 116, x1: 248, z1: 120 }, // aqueduct leg D
  { x0: 242, z0: 252, x1: 250, z1: 352 }, // aqueduct leg B + the processional
  { x0: 296, z0: 348, x1: 316, z1: 352 }, // aqueduct leg A (broken oasis terminus)
  { x0: 126, z0: 76, x1: 174, z1: 124 }, // the Throat (sinkhole)
  { x0: 143, z0: 34, x1: 151, z1: 76 }, // the bone road to the Cinderrift portal
  { x0: 288, z0: 288, x1: 313, z1: 313 }, // dry_cistern (fixed anchor — 25x25 won't scatter)
  { x0: 30, z0: 242, x1: 51, z1: 259 }, // sunscour_caravanserai (fixed anchor — 21x17 won't scatter)
];

// THE WELLHEAD CRATER (world-redesign batch 2; story bible §6 E1 landmark 3 /
// E2's front door). A terraced sink in the far-southwest dunes, deliberately
// OFF every road and setpiece sightline — finding it is the reward. The pit
// drank the desert's sea; the crater bottom is the salt pan the drinking left,
// and the portal to the Maw stands at its center. The portal is authored
// always-open on this side: the LOCK is the Maw's downtime countdown (the
// feeding schedule, diegetically). Surveyed site: natural ground 11-13, no
// water columns inside the carve, nearest table/setpiece >100 m.
const WELLHEAD = { cx: 96, cz: 384 };
const WELLHEAD_RECT: Rect = { x0: 66, z0: 354, x1: 128, z1: 414 };

// Two prefabs too large to scatter reliably in the constrained desert (25x25
// and 21x17 vs ~10 exclusion rects) — fixed-anchored at surveyed flat spots.
const DESERT_FIXED_PREFABS: Array<[string, number, number, 0 | 1 | 2 | 3, 0 | 1 | 2]> = [
  ["dry_cistern", 288, 288, 0, 1],
  ["sunscour_caravanserai", 30, 242, 0, 1],
];

// Sekhat's tomb cache + the aqueduct-break caches + the Throat fissure cache.
// (The desert setpieces have no `features` handle; buildDesertRuins pushes these.)
const DESERT_SETPIECE_CACHES: LootCachePoint[] = [
  { x: 238.5, y: 9, z: 241.5, table: "cache_desert", respawnSec: 900 }, // the Vessel Chamber sarcophagus
  { x: 276.5, y: 26, z: 350.5, table: "cache_desert", respawnSec: 480 }, // aqueduct break 1 (far side)
  { x: 246.5, y: 26, z: 296.5, table: "cache_desert", respawnSec: 480 }, // aqueduct break 2
  { x: 246.5, y: 26, z: 166.5, table: "cache_desert", respawnSec: 480 }, // aqueduct break 3
  { x: 152.5, y: 2, z: 100.5, table: "cache_cinderrift", respawnSec: 600 }, // the Throat fissure lip — the most dangerous 3 blocks in the room
];

// The deathwatch line: five soldiers who were told to hold the aqueduct and
// never told to stop. Fixed-anchored at pier bases on open sand (min corners +
// rot + ruinLevel), verified clear of every spawn table.
const DESERT_DEATHWATCH: Array<[number, number, 0 | 1 | 2 | 3, 0 | 1 | 2]> = [
  [250, 324, 0, 0],
  [238, 334, 0, 1],
  [250, 180, 0, 1],
  [238, 130, 0, 2],
  [286, 342, 0, 1],
];

function buildDesertRuins(b: Builder, def: RoomDef, features: ScatterResult): void {
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

  // --- the Sunscour setpieces (S4/S5): Ashkaal dug for water and found fire ---
  // The Colossus stares south down the walk from the hub gate; the aqueduct is
  // a raised road connecting oasis -> Colossus -> the Throat in the order the
  // story happened; the Throat is where the diggers broke through. sekhat spawns
  // in the tomb's Vessel Chamber (the sekhat-tomb table sits at its centre).
  buildColossusOfSekhat(b, def);
  buildAqueductSpine(b, def);
  buildTheThroat(b, def);
  // the Wellhead Crater — the hidden way down to the Maw (batch 2)
  buildWellheadCrater(b, def);
  // the five deathwatch soldiers who still hold the aqueduct line
  for (const [ox, oz, rot, ruin] of DESERT_DEATHWATCH) stampFixedPrefab(b, features, "deathwatch_post", ox, oz, rot, ruin);
  // the two dug structures too large to scatter (the cistern, the caravanserai)
  for (const [id, ox, oz, rot, ruin] of DESERT_FIXED_PREFABS) stampFixedPrefab(b, features, id, ox, oz, rot, ruin);
  // setpiece caches (Vessel sarcophagus, the three aqueduct breaks, the Throat)
  for (const c of DESERT_SETPIECE_CACHES) features.caches.push({ ...c });
}

// ---------------------------------------------------------------------------
// THE WELLHEAD CRATER + THE MAW — owner seed #2 (world-redesign batch 2,
// story bible §6 E2). One story told twice at two scales:
//
//   Desert side: a terraced crater sunk into the far-SW dunes, raised rim
//   hiding the descent (☆ — you find it or you don't). Strand-lines ring the
//   terrace risers top to bottom (the sea's obituary), the bottom is a salt
//   pan with a dead keel, and the portal to the Maw stands at the center.
//   A single 1-block stair lane climbs out east through a notch in the rim.
//
//   The Maw: a 96² preset arena — the dried sea's basin, 16 blocks below the
//   surrounding cap rock. Everything placed has a reason: strand-lines on the
//   pit walls (readable on the way down), shipwreck keels forty years from
//   any water, the bone-meal feeding-floor swept in arcs around the wellmouth
//   Sarquun surfaces from, and pale tentacle-breaches frozen mid-heave at the
//   floor's rim ("colossal" is staged, not scaled — the arena is dressed as
//   the crest of the thing; they double as cover from the gout).
//
// DETERMINISM: layout constants fixed; every ragged edge is hash2(seed^salt).
// ---------------------------------------------------------------------------

/** A dead ship's keel, forty years from any water: a half-buried rotting
 *  spine that lifts toward the stern, with rib frames athwart it. `gy` is the
 *  CARVED ground (b.g() only knows natural terrain). dx/dz should be a unit
 *  or diagonal step. */
function deadKeel(b: Builder, seed: number, x0: number, z0: number, dx: number, dz: number, len: number, gy: number): void {
  const px = dz === 0 ? 0 : 1; // perpendicular (good enough for axis/diagonal)
  const pz = dx === 0 ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const x = Math.round(x0 + dx * i);
    const z = Math.round(z0 + dz * i);
    // the spine: buried at the bow, two blocks proud at the stern
    const lift = i < len / 3 ? 0 : i < (2 * len) / 3 ? 1 : 2;
    b.fill(x, gy + 1, z, x, gy + 1 + lift, z, "rotting_planks");
    // rib frames every other segment once the hull stands proud of the sand
    if (i % 2 === 1 && lift > 0 && hash2(seed ^ 0x4ee1, x, z) < 0.85) {
      const ribH = lift + 1;
      b.fill(x + px, gy + 1, z - pz, x + px, gy + ribH, z - pz, "rotting_planks");
      b.fill(x - px, gy + 1, z + pz, x - px, gy + ribH, z + pz, "rotting_planks");
    }
  }
}

function buildWellheadCrater(b: Builder, def: RoomDef): void {
  const seed = def.terrain.seed;
  const { cx, cz } = WELLHEAD;
  const G0 = b.g(cx, cz); // the one datum every depth hangs off (surveyed: 12)
  const PAN = Math.max(MIN_DIG_FLOOR + 1, G0 - 8); // salt-pan surface y
  const SAND = id("sand");
  const SANDSTONE = id("sandstone");
  const SNOW = id("snow"); // reads as salt crust in a desert palette
  const BONE = id("bone_block");

  // terraced bowl: pan → four 2-block terraces → natural ring → raised rim
  const targetG = (r: number, x: number, z: number): number | null => {
    if (r >= 27.5) return null; // untouched dunes
    if (r >= 23) return G0 + 2 + (hash2(seed ^ 0x37e1, x, z) < 0.45 ? 1 : 0); // the wind-worn lip
    if (r >= 19) return G0;
    if (r >= 15) return G0 - 2;
    if (r >= 11) return G0 - 4;
    if (r >= 7) return G0 - 6;
    return PAN;
  };

  const shapeColumn = (x: number, z: number, ty: number, surf: number): void => {
    // clear everything above the target (dune tops, dead trees, any gen water)
    for (let y = ty + 1; y <= Math.min(WORLD_HEIGHT - 1, G0 + 18); y++) b.world.set(x, y, z, 0);
    // solid up to the target (the rim rises over lower dune columns)
    for (let y = Math.max(1, ty - 8); y < ty; y++) {
      if (!b.world.solidAt(x, y, z)) b.world.set(x, y, z, SANDSTONE);
    }
    b.world.set(x, ty, z, surf);
  };

  for (let z = cz - 28; z <= cz + 28; z++) {
    for (let x = cx - 28; x <= cx + 28; x++) {
      const r = Math.hypot(x - cx, z - cz);
      const ty = targetG(r, x, z);
      if (ty === null) continue;
      let surf: number;
      if (r < 7) {
        // the salt pan: crust patches over sand, bone-meal flecks
        const salt = hash2(seed ^ 0x5a17, Math.floor(x / 6), Math.floor(z / 6)) * 0.7 + hash2(seed ^ 0x5a18, x, z) * 0.3;
        surf = salt > 0.45 ? SNOW : hash2(seed ^ 0x5a19, x, z) < 0.08 ? BONE : SAND;
      } else if (r >= 23) {
        surf = hash2(seed ^ 0x37e2, x, z) < 0.7 ? SANDSTONE : SAND;
      } else {
        surf = hash2(seed ^ 0x37e3, x, z) < 0.1 ? SANDSTONE : SAND;
      }
      shapeColumn(x, z, Math.max(MIN_DIG_FLOOR + 1, ty), surf);
      // strand-lines on the terrace risers — the sea's obituary, one line per
      // old waterline, ragged where the crust fell away
      if (r >= 7 && r < 23) {
        const lines: Array<[number, number]> = [
          [G0 - 7, BONE],
          [G0 - 5, SNOW],
          [G0 - 3, BONE],
          [G0 - 1, SNOW],
        ];
        for (const [ly, lb] of lines) {
          if (ly <= ty && ly >= 1 && hash2(seed ^ 0x57a4, x, z + ly * 61) < 0.78) b.world.set(x, ly, z, lb);
        }
      }
    }
  }

  // the stair lane: 1-block steps east out of the pan, through a notch cut in
  // the rim — invisible until you stand on the lip (the ☆ is the point)
  for (const lz of [cz - 1, cz]) {
    for (let x = cx + 7; x <= cx + 28; x++) {
      const ty = Math.min(PAN + (x - (cx + 6)), G0);
      shapeColumn(x, lz, ty, hash2(seed ^ 0x57a5, x, lz) < 0.2 ? SANDSTONE : SAND);
    }
  }

  // pan dressing: a dead keel and the bones of what the drinking stranded
  deadKeel(b, seed, cx - 7, cz - 5, 1, -1, 6, PAN);
  b.set(cx + 4, PAN + 1, cz + 5, "skull_pile");
  b.set(cx - 5, PAN + 1, cz + 3, "bone_block");
  b.set(cx - 4, PAN + 1, cz + 3, "bone_block");
  b.set(cx + 3, PAN + 1, cz - 6, "bone_block");
}

// ---------------------------------------------------------------------------
// The Maw — the arena itself (room `maw`, biome "ruin": flat 24-high slab the
// builder owns entirely). See the banner comment above buildWellheadCrater.
// ---------------------------------------------------------------------------
const MAW = { cx: 48, cz: 48 };

function buildMaw(b: Builder, def: RoomDef): void {
  const seed = def.terrain.seed;
  const { cx, cz } = MAW;
  const FLOOR = 8; // basin surface y (feet at 9); cap rock slab stays at 24
  const SAND = id("sand");
  const SANDSTONE = id("sandstone");
  const DARK = id("dark_stone");
  const SNOW = id("snow"); // salt crust
  const BONE = id("bone_block");
  const PALE = id("pale_ruin_stone");
  const OBSIDIAN = id("obsidian");
  const PATHB = id("path"); // ground bone-meal

  // ring profile: basin floor → four 4-block wall terraces → the cap rock
  const targetG = (r: number): number => {
    if (r >= 46) return 24; // untouched slab (repaint only)
    if (r >= 42) return 24;
    if (r >= 38) return 20;
    if (r >= 34) return 16;
    if (r >= 30) return 12;
    return FLOOR;
  };

  for (let z = 0; z < def.size.h; z++) {
    for (let x = 0; x < def.size.w; x++) {
      const r = Math.hypot(x - cx, z - cz);
      const ty = targetG(r);
      const natural = b.g(x, z); // 24 everywhere (amplitude 0)
      // carve down to the target (the slab is solid; digging is all we do)
      for (let y = ty + 1; y <= natural; y++) b.world.set(x, y, z, 0);
      // surface material by ring
      let surf: number;
      if (r < 30) {
        // the feeding-floor: salt-crust patches, bone-meal arcs swept around
        // the wellmouth, ground bone flecks
        const band = Math.floor(r);
        const inArc = (band >= 8 && band <= 9) || (band >= 12 && band <= 13) || (band >= 16 && band <= 17) || (band >= 20 && band <= 21);
        const salt = hash2(seed ^ 0x5a17, Math.floor(x / 6), Math.floor(z / 6)) * 0.7 + hash2(seed ^ 0x5a18, x, z) * 0.3;
        if (inArc && hash2(seed ^ 0xfe3d, x, z) < 0.5) surf = BONE;
        else if (salt > 0.55) surf = SNOW;
        else if (hash2(seed ^ 0xfe3e, x, z) < 0.06) surf = PATHB;
        else surf = SAND;
      } else if (r < 34) {
        surf = DARK; // the deep rock the pit ground through
      } else if (r < 42) {
        surf = SANDSTONE;
      } else {
        surf = SAND; // the cap above the walls
      }
      b.world.set(x, ty, z, surf);
      // strand-lines ringing the pit walls, top to bottom — readable on the
      // way down: the highest is the oldest sea
      if (r >= 30 && r < 46) {
        const lines: Array<[number, number]> = [
          [10, BONE],
          [14, SNOW],
          [18, SNOW],
          [22, PALE],
        ];
        for (const [ly, lb] of lines) {
          if (ly <= ty && hash2(seed ^ 0x57a4, x, z + ly * 61) < 0.8) b.world.set(x, ly, z, lb);
        }
      }
    }
  }

  // the wellmouth — the throat it surfaces from: an obsidian dish sunk into
  // the floor's center, ringed in dark rock, lit by the last of the water
  for (let z = cz - 6; z <= cz + 6; z++) {
    for (let x = cx - 6; x <= cx + 6; x++) {
      const r = Math.hypot(x - cx, z - cz);
      if (r >= 6) continue;
      const ty = r < 2.5 ? FLOOR - 2 : r < 4.5 ? FLOOR - 1 : FLOOR;
      for (let y = ty + 1; y <= FLOOR; y++) b.world.set(x, y, z, 0);
      b.world.set(x, ty, z, r < 4.5 ? OBSIDIAN : DARK);
    }
  }
  for (const [dx, dz] of [
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
  ] as const) {
    b.world.setIfAir(cx + dx, FLOOR, cz + dz, id("blue_crystal"));
  }

  // tentacle-breaches frozen mid-heave around the floor's rim: pale humps
  // rising and diving back into the sand (cover from the gout, and the
  // "you are standing on its lip" line made literal). Bearings keep the
  // portal/spawn corridor (due south, +z) clear.
  const PROFILE = [1, 3, 5, 6, 4, 2, 1];
  for (const a of [0.4, 2.6, 3.5, 4.4, 5.3, 6.1]) {
    const bx = cx + Math.cos(a) * 24;
    const bz = cz + Math.sin(a) * 24;
    const tx = -Math.sin(a); // tangent — the hump runs along the rim
    const tz = Math.cos(a);
    for (let i = -3; i <= 3; i++) {
      const x = Math.round(bx + tx * i);
      const z = Math.round(bz + tz * i);
      const jitter = hash2(seed ^ 0x7e47, x, z) < 0.5 ? 0 : -1;
      const h = Math.max(1, PROFILE[i + 3]! + jitter);
      b.fill(x, FLOOR + 1, z, x, FLOOR + h, z, PALE);
    }
  }

  // shipwrecks in the sand — keels forty years from any water
  deadKeel(b, seed, 30, 60, 1, 1, 11, FLOOR);
  deadKeel(b, seed, 64, 31, -1, 1, 9, FLOOR);

  // what feeding leaves: skulls near the mouth
  b.set(54, FLOOR + 1, 50, "skull_pile");
  b.set(43, FLOOR + 1, 53, "skull_pile");
  b.set(50, FLOOR + 1, 42, "skull_pile");

  // the last of the water's light: blue crystals at the wall base
  for (let k = 0; k < 8; k++) {
    const a = k * 0.785 + 0.35;
    const x = Math.round(cx + Math.cos(a) * 28.5);
    const z = Math.round(cz + Math.sin(a) * 28.5);
    if (hash2(seed ^ 0xb1e5, x, z) < 0.8) b.world.setIfAir(x, FLOOR + 1, z, id("blue_crystal"));
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

// ---------------------------------------------------------------------------
// Gloomfen Marsh — the drowned kingdom's causeway runs from the Fen Gate
// north through the shallows to the Sunken Temple. Intact near the gate,
// collapsing deeper in (decay gradient); every ~7th plank is gone.
// Constants shared with authoredExclusions so scatter stays off the line.
// sunken_gaol is 13x17 and won't scatter in the flooded fen — fixed-anchored
// at a surveyed spot in the eastern marsh.
const GLOOMFEN_GAOL = { ox: 184, oz: 172, rot: 0 as const, ruin: 1 as const };
const GLOOMFEN_GAOL_EXCLUSION: Rect = { x0: 184, z0: 172, x1: 197, z1: 189 };

// ---------------------------------------------------------------------------
// Gloomfen setpieces (S1/S2/S3) live in setpieces_gloomfen.ts; buildGloomfen is
// now their integrator. The old missing-plank causeway loop and the stamped
// sunken_temple prefab are GONE — the Lamplighters' Road replaces the first and
// the authored Temple of the Tidewardens replaces the second (the sunken_temple
// prefab stays in the catalog for reuse elsewhere; the fen's own temple
// graduated, the way the Sundered City's keep did).
function buildGloomfen(b: Builder, def: RoomDef, features: ScatterResult): void {
  // S1 the Drownbell (independent, in open water east of the causeway) and
  // S2 the Temple (z ≤ 64, north end). S3 the road (z ≥ 65) ties them together;
  // it fixed-stamps the lamps/tollhouses/spur furniture through stampPrefab, and
  // those prefabs carry their own hooks (lamplighter spawn anchors, the ward's
  // guard table + cache) which we push into features exactly as the old code did.
  buildDrownbell(b, def);
  buildTidewardenTemple(b, def);
  buildLamplightersRoad(b, def, (id, ox, oz, rot, ruin) => {
    const hooks = stampPrefab(b, id, ox, oz, rot, ruin);
    if (hooks.lootCache) features.caches.push(hooks.lootCache);
    if (hooks.spawnRegion?.table) {
      features.extraTables.push({
        id: `${id}-${ox}-${oz}`,
        region: { kind: "circle", x: hooks.spawnRegion.x, z: hooks.spawnRegion.z, r: hooks.spawnRegion.r },
        mobs: hooks.spawnRegion.table.mobs,
        maxAlive: hooks.spawnRegion.table.maxAlive,
        packSize: hooks.spawnRegion.table.packSize,
        respawnSec: hooks.spawnRegion.table.respawnSec,
      });
    }
  });

  // caches + spawn anchors the setpiece functions can't push themselves
  for (const c of GLOOMFEN_SETPIECE_CACHES) {
    features.caches.push({ x: c.x, y: c.y, z: c.z, table: c.table, respawnSec: c.respawnSec });
  }
  for (const s of GLOOMFEN_SETPIECE_SPAWNS) {
    features.extraTables.push({
      id: `setpiece-${s.x}-${s.z}`,
      region: { kind: "circle", x: s.x, z: s.z, r: s.r },
      mobs: s.mobs,
      maxAlive: s.maxAlive,
      packSize: s.packSize,
      respawnSec: s.respawnSec,
    });
  }
  // the lizardmen are the fen's river-folk and the Temple is their church, not
  // an invasion: re-centre the existing temple-guard table onto the nave.
  features.bindings.push({ tableId: TEMPLE_GUARD_RECENTER.tableId, x: TEMPLE_GUARD_RECENTER.x, z: TEMPLE_GUARD_RECENTER.z });
  // the flooded gaol (13x17, too large to scatter in the marsh) — fixed-anchored
  stampFixedPrefab(b, features, "sunken_gaol", GLOOMFEN_GAOL.ox, GLOOMFEN_GAOL.oz, GLOOMFEN_GAOL.rot, GLOOMFEN_GAOL.ruin);
}

// ---------------------------------------------------------------------------
// The Cinderrift — a bone road climbs from the Rift Gate to the Forge Ruin
// where the Furnace Golem waits. The road bridges lava runs on bleached
// blocks; the forge prefab brings its own banner gate and lava trenches.
// ---------------------------------------------------------------------------
const CINDER_FORGE = { ox: 133, oz: 25, w: 22, d: 18 }; // center (144,34) = furnace-arena table
const CINDER_ROAD = { x: 144, z0: 44, z1: 274 }; // forge gate apron → portal apron

function buildCinderrift(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const wl = def.terrain.waterLevel ?? 9;
  for (let z = CINDER_ROAD.z0; z <= CINDER_ROAD.z1; z++) {
    for (const x of [CINDER_ROAD.x - 1, CINDER_ROAD.x, CINDER_ROAD.x + 1]) {
      const g = b.g(x, z);
      if (g <= wl) {
        // the road bridges the lava runs on bleached vertebrae
        b.set(x, wl + 1, z, "bone_block");
      } else {
        b.clearAbove(x, z, x, z, g, 8);
        b.set(x, g, z, hash2(seed ^ 0xb0e5, x, z) < 0.35 ? "bone_block" : "ash");
      }
    }
  }
  // Forge Ruin at (144,34): the golem arena. The prefab already raises the
  // banner pair over its gate; the spawnRegion hook locks the boss table on.
  const hooks = stampPrefab(b, "forge_ruin", CINDER_FORGE.ox, CINDER_FORGE.oz, 0, 1);
  if (hooks.spawnRegion) {
    features.bindings.push({ tableId: "furnace-arena", x: hooks.spawnRegion.x, z: hooks.spawnRegion.z });
  }
}

// ---------------------------------------------------------------------------
// Vaults of Morvane (crypt_depths) — the sealed floor UNDER the Sunken
// Crypt. A dark-brick spine runs from the entrance south to the Frozen
// Vault in the back third: bat cloisters flank it, a prison block holds
// wraith-guarded caches behind iron bars, an ossuary lines the east, and
// Morvane waits on an ice dais. Light = language: torches near the
// entrance only; deeper it's crystal; the vault glows blue.
// Everything walkable: 2-wide minimum corridors, 1-block steps.
// ---------------------------------------------------------------------------
function buildCryptDepths(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const G = b.g(def.spawn.x, def.spawn.z);
  const FL = G + 1;
  const M = 2;
  const X1 = def.size.w - 1 - M;
  const Z1 = def.size.h - 1 - M;

  // perimeter: dark-brick vault walls, bitten with age
  b.wallRun(M, M, X1, M, FL, 5, "dark_bricks");
  b.wallRun(M, Z1, X1, Z1, FL, 5, "dark_bricks");
  b.wallRun(M, M, M, Z1, FL, 5, "dark_bricks");
  b.wallRun(X1, M, X1, Z1, FL, 5, "dark_bricks");
  for (let i = 0; i < 44; i++) {
    const t = hash2(seed ^ 0xdd1, i, 0);
    const side = i % 4;
    const along = Math.floor(hash2(seed ^ 0xdd2, i, 1) * (def.size.w - 2 * M - 2)) + M + 1;
    const [x, z] = side === 0 ? [along, M] : side === 1 ? [along, Z1] : side === 2 ? [M, along] : [X1, along];
    b.fill(x, FL + 3 + Math.floor(t * 2), z, x, FL + 5, z, 0);
  }

  // entrance court + the central spine (portal → vault gate), dead level
  b.flatten(42, 80, 54, 88, G, "path");
  b.flatten(46, 31, 50, 84, G, "path");
  // light = language: torches only near the entrance...
  for (const [tx, tz] of [
    [44, 79],
    [52, 79],
    [45, 68],
    [51, 68],
  ] as const) {
    b.set(tx, FL, tz, "dark_bricks");
    b.torch(tx, FL + 1, tz);
  }
  // ...crystal pedestals from mid-spine down
  for (const [cx, cz] of [
    [45, 52],
    [51, 46],
    [45, 41],
  ] as const) {
    b.set(cx, FL, cz, "dark_bricks");
    b.set(cx, FL + 1, cz, "crystal");
  }

  // bat cloisters: ruined halls west and east of the spine
  const hall = (x0: number, z0: number, x1: number, z1: number, salt: number) => {
    b.clearAbove(x0 - 1, z0 - 1, x1 + 1, z1 + 1, G, 10);
    b.flatten(x0, z0, x1, z1, G, "mossy_cobblestone");
    for (let x = x0; x <= x1; x++) {
      for (const z of [z0, z1]) {
        const h = Math.max(2, 4 - Math.floor(hash2(seed ^ salt, x, z) * 3));
        b.fill(x, FL, z, x, FL + h - 1, z, "dark_bricks");
      }
    }
    for (let z = z0 + 1; z <= z1 - 1; z++) {
      for (const x of [x0, x1]) {
        const h = Math.max(2, 4 - Math.floor(hash2(seed ^ salt ^ 0x55, x, z) * 3));
        b.fill(x, FL, z, x, FL + h - 1, z, "dark_bricks");
      }
    }
    b.set(x0 + 1, FL, z0 + 1, "crystal");
    b.set(x1 - 1, FL, z1 - 1, "crystal");
  };
  // doorways carve the FULL wall height (a lintel would read as a wall to
  // the standing-height grid — the same rule bots path by)
  hall(17, 57, 34, 70, 0xa1); // bat-cloister-w, center ~(26,64)
  b.fill(34, FL, 63, 34, FL + 3, 64, 0); // east doorway onto the spine
  b.flatten(35, 63, 45, 64, G, "path");
  hall(61, 52, 78, 63, 0xa2); // bat-cloister-e, center ~(70,58)
  b.fill(61, FL, 57, 61, FL + 3, 58, 0); // west doorway
  b.flatten(51, 57, 60, 58, G, "path");

  // prison block: solid shell, three iron-barred cells, wraith-guarded
  // caches inside. Each cell's bar-front hangs AJAR: a 1-block doorway gap
  // (bottom two blocks open) so every cache is reachable.
  b.clearAbove(13, 31, 31, 45, G, 10);
  b.flatten(14, 32, 30, 44, G, "stone");
  for (let x = 14; x <= 30; x++) {
    for (const z of [32, 44]) b.fill(x, FL, z, x, FL + 3, z, "dark_bricks");
  }
  for (let z = 33; z <= 43; z++) {
    for (const x of [14, 30]) b.fill(x, FL, z, x, FL + 3, z, "dark_bricks");
  }
  b.fill(30, FL, 37, 30, FL + 3, 38, 0); // entrance breach onto the spine corridor
  b.flatten(31, 37, 45, 38, G, "path");
  for (const dz of [36, 40]) b.fill(15, FL, dz, 20, FL + 2, dz, "dark_bricks"); // cell dividers
  for (const [cz0, cz1, gapZ] of [
    [33, 35, 34],
    [37, 39, 38],
    [41, 43, 42],
  ] as const) {
    for (let z: number = cz0; z <= cz1; z++) {
      // the gate hangs ajar: a full-height 1-block slot at gapZ (iron_bars
      // are solid — anything overhead would read as a 3-block step)
      if (z !== gapZ) b.fill(20, FL, z, 20, FL + 2, z, "iron_bars");
    }
    features.caches.push({ x: 17.5, y: FL, z: gapZ + 0.5, table: "cache_crypt", respawnSec: 600 });
  }

  // ossuary: bone-ribbed gallery east of the spine
  b.clearAbove(65, 30, 83, 44, G, 10);
  b.flatten(66, 31, 82, 43, G, "stone");
  for (let x = 66; x <= 82; x++) {
    for (const z of [31, 43]) b.fill(x, FL, z, x, FL + 3, z, "dark_bricks");
  }
  for (let z = 32; z <= 42; z++) {
    for (const x of [66, 82]) b.fill(x, FL, z, x, FL + 3, z, "dark_bricks");
  }
  b.fill(66, FL, 36, 66, FL + 3, 37, 0); // west doorway onto the spine
  b.flatten(51, 36, 65, 37, G, "path");
  for (let x = 68; x <= 80; x += 2) {
    b.fill(x, FL, 32, x, FL + 1, 32, "bone_block"); // niche ribs, north wall
    b.fill(x, FL, 42, x, FL + 1, 42, "bone_block"); // niche ribs, south wall
  }
  b.set(74, FL, 37, "crystal");

  // graveyard court by the entrance — the sanitized face of what's below
  stampPrefab(b, "graveyard", 56, 73, 0, 1);

  // --- the Frozen Vault: the sealed back third ---
  b.clearAbove(3, 3, X1 - 1, 29, G, 12);
  b.flatten(3, 3, X1 - 1, 29, G, "snow");
  b.flatten(3, 30, X1 - 1, 30, G, "stone"); // level the gate-wall line
  b.wallRun(3, 30, 45, 30, FL, 5, "dark_bricks");
  b.wallRun(51, 30, X1 - 1, 30, FL, 5, "dark_bricks");
  b.flatten(46, 30, 50, 30, G, "path"); // the 3-wide vault mouth
  b.fill(46, FL, 30, 46, FL + 3, 30, "dark_bricks");
  b.fill(50, FL, 30, 50, FL + 3, 30, "dark_bricks");
  b.set(46, FL + 4, 30, "blue_crystal");
  b.set(50, FL + 4, 30, "blue_crystal");
  // frozen colonnade (kept off the approach and the dais court)
  for (let i = 0; i < 14; i++) {
    const px = 6 + Math.floor(hash2(seed ^ 0xf1ce, i, 0) * (X1 - 12));
    const pz = 5 + Math.floor(hash2(seed ^ 0xf1ce, i, 1) * 22);
    if (px >= 42 && px <= 54) continue;
    if (Math.hypot(px - 48, pz - 16) < 7) continue;
    const h = 3 + Math.floor(hash2(seed ^ 0xf1ce, i, 2) * 3);
    b.fill(px, FL, pz, px, FL + h - 1, pz, "ice");
  }
  // blue crystal clusters carry the vault's light
  for (let i = 0; i < 20; i++) {
    const cx = 5 + Math.floor(hash2(seed ^ 0xb1ff, i, 0) * (X1 - 10));
    const cz = 4 + Math.floor(hash2(seed ^ 0xb1ff, i, 1) * 24);
    b.world.setIfAir(cx, FL, cz, id("blue_crystal"));
  }
  // Morvane's dais: three one-block ice steps to the throne (48,16)
  b.fill(45, FL, 13, 51, FL, 19, "ice");
  b.fill(46, FL + 1, 14, 50, FL + 1, 18, "ice");
  b.fill(47, FL + 2, 15, 49, FL + 2, 17, "ice");
  for (const [cx, cz] of [
    [45, 13],
    [51, 13],
    [45, 19],
    [51, 19],
  ] as const) {
    b.set(cx, FL + 1, cz, "blue_crystal");
  }
  b.set(48, FL + 3, 15, "blue_crystal"); // the throne-back shard
}

// ---------------------------------------------------------------------------
// Sundered City — Valdrenn: PRESET war-ruined city + castle finale (owner:
// no random gen — biome "ruin" is a flat slab; every visible block below is
// authored; decay uses seeded hash bites, identical every boot).
//
// Research-derived castle rules baked in (docs/worldgen-design.md §7): inner
// walls taller than the city wall, towers at corners + wall midpoints
// dominating adjacent battlements, gatehouses that extend out with a
// killing-ground corridor + murder holes, portcullis ≥4 tall hidden in a
// 1-block frame, keep ~15-30 m a side with a tall great hall, crenellations
// on outer edges with torches every other merlon, stone throughout.
//
// North (low z) = the castle "at the very back"; south (high z) = the city
// gate, spawn, and the paired Gloomfen portal.
// ---------------------------------------------------------------------------
const CITY = { x0: 24, z0: 24, x1: 232, z1: 208 }; // curtain wall rect
const CITY_GATE = { x0: 125, x1: 131, z: 208 }; // south gate opening
const PLINTH = { x0: 60, z0: 28, x1: 196, z1: 92, y: 16 }; // castle terrace (top y)
const CASTLE = { x0: 64, z0: 32, x1: 192, z1: 88 }; // castle curtain on the plinth
const KEEP = { x0: 96, z0: 36, x1: 160, z1: 72 }; // marble keep shell
const THRONE = { x: 128, z: 40 }; // the Sundered King's seat (dais center)
const EAST_BREACH = { z0: 124, z1: 132 }; // city wall breach at x = CITY.x1
const WEST_BREACH = { x0: 60, x1: 66 }; // city wall breach at z = CITY.z1

function buildSunderedCity(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const G = b.g(def.spawn.x, def.spawn.z); // 12 — flat everywhere (amplitude 0)
  const FL = G + 1;
  const PG = PLINTH.y; // plinth ground top (16)
  const PFL = PG + 1; // feet level on the plinth

  // aged masonry: stone_bricks with hash-driven cracked/mossy substitutions
  const aged = (x: number, y: number, z: number, block = "stone_bricks"): void => {
    const r = hash2(seed ^ 0xc17e, x * 7 + y * 131, z * 13 + y);
    b.set(x, y, z, r < 0.22 ? "cracked_bricks" : r < 0.3 ? "mossy_cobblestone" : block);
  };
  // wall run whose top is bitten by war (columns lose 0-2 courses)
  const agedWall = (x0: number, z0: number, x1: number, z1: number, baseY: number, height: number): void => {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const bite = Math.floor(hash2(seed ^ 0xa6ed, x, z) * 3); // 0..2
        const top = baseY + height - 1 - bite;
        for (let y = baseY; y <= top; y++) aged(x, y, z);
        // crenellations only where the wall kept its full height
        if (bite === 0 && (x + z) % 2 === 0) aged(x, baseY + height, z);
        // torch every other surviving merlon pair, thinned by ruin
        if (bite === 0 && (x + z) % 8 === 0 && hash2(seed ^ 0x70c4, x, z) < 0.4)
          b.torch(x, baseY + height + 1, z);
      }
    }
  };
  const rubbleMound = (cx: number, cz: number, r: number, baseY: number): void => {
    for (let z = cz - r; z <= cz + r; z++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d > r + 0.4) continue;
        const h = Math.max(0, Math.round((1 - d / (r + 1)) * 2 + hash2(seed ^ 0x9b1e, x, z) * 0.9));
        for (let y = 0; y < h; y++) b.set(x, baseY + y, z, "rubble");
      }
    }
  };
  // shallow siege crater: 1-deep ash bowl + rubble lip + ember scar
  const crater = (cx: number, cz: number, r: number): void => {
    for (let z = cz - r - 1; z <= cz + r + 1; z++) {
      for (let x = cx - r - 1; x <= cx + r + 1; x++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d <= r) {
          b.set(x, G, z, 0);
          b.set(x, G - 1, z, "ash");
          b.set(x, FL, z, 0); // no floaters over the bowl
        } else if (d <= r + 1.2 && hash2(seed ^ 0xc4a7, x, z) < 0.55) {
          b.set(x, FL, z, "rubble");
        }
      }
    }
    b.set(cx, G - 1, cz, 0);
    b.set(cx, G - 2, cz, "ash");
    b.set(cx, G - 1, cz, "ember_crystal"); // the wound still smoulders
  };
  // burned snag: charred trunk stub on an ash scar
  const snag = (x: number, z: number): void => {
    const h = 2 + Math.floor(hash2(seed ^ 0x51a6, x, z) * 2);
    b.paintCircle(x, z, 1.8, "ash");
    b.fill(x, FL, z, x, FL + h - 1, z, "charred_log");
  };
  // war-gutted house: aged shell (some two-story), windows, one collapsed
  // corner spilling rubble, charred beams / partial roofs, debris floors.
  // v2 after owner feedback — the h3 fully-bitten shells read as "simple
  // pillars"; these keep enough wall to read as BUILDINGS that died.
  const ruinedHouse = (x0: number, z0: number, w: number, d: number, doorSide: "n" | "s" | "e" | "w"): void => {
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const tall = hash2(seed ^ 0xf600, x0, z0) < 0.4; // two-story shell
    const wallH = tall ? 7 : 4;
    b.clearAbove(x0 - 1, z0 - 1, x1 + 1, z1 + 1, G);
    // floor: scorched boards and ash
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const r = hash2(seed ^ 0xf100, x, z);
        b.set(x, G, z, r < 0.35 ? "ash" : r < 0.5 ? "path" : "planks");
      }
    }
    // walls: over half the columns keep FULL height; the rest lose 1-3
    const wallCol = (x: number, z: number): void => {
      const r = hash2(seed ^ 0xf200, x, z);
      const bite = r < 0.55 ? 0 : 1 + Math.floor((r - 0.55) * (tall ? 6 : 4.4));
      for (let y = FL; y <= FL + wallH - 1 - bite; y++) aged(x, y, z);
      // window holes at eye level on surviving walls
      if (bite === 0 && (x + z) % 3 === 0) b.set(x, FL + 1, z, 0);
      if (tall && bite === 0 && (x + z) % 3 === 1) b.set(x, FL + 4, z, 0);
    };
    for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) wallCol(x, z);
    for (let z = z0 + 1; z <= z1 - 1; z++) for (const x of [x0, x1]) wallCol(x, z);
    // two-story shells keep a broken upper floor (plank slab with a hole)
    if (tall) {
      for (let z = z0 + 1; z <= z1 - 1; z++) {
        for (let x = x0 + 1; x <= x1 - 1; x++) {
          if (hash2(seed ^ 0xf700, x, z) < 0.55) b.set(x, FL + 3, z, "planks");
        }
      }
    }
    // door: full-height gap (the standing-height rule bots path by)
    const mx = Math.floor((x0 + x1) / 2);
    const mz = Math.floor((z0 + z1) / 2);
    const door: [number, number] =
      doorSide === "n" ? [mx, z0] : doorSide === "s" ? [mx, z1] : doorSide === "w" ? [x0, mz] : [x1, mz];
    b.fill(door[0], FL, door[1], door[0], FL + wallH, door[1], 0);
    // one corner collapsed outright
    const corner = Math.floor(hash2(seed ^ 0xf300, x0, z0) * 4);
    const [cx, cz] = corner === 0 ? [x0, z0] : corner === 1 ? [x1, z0] : corner === 2 ? [x0, z1] : [x1, z1];
    b.fill(cx - 1, FL, cz - 1, cx + 1, FL + wallH, cz + 1, 0);
    rubbleMound(cx, cz, 1, FL);
    // roof: squat houses keep a charred half-roof, tall shells bare beams
    for (let x = x0 + 1; x < x1; x += 2) {
      if (hash2(seed ^ 0xf400, x, z0) < 0.55) b.fill(x, FL + wallH, z0 + 1, x, FL + wallH, z1 - 1, "charred_log");
    }
    if (!tall && hash2(seed ^ 0xf401, x0, z0) < 0.45) {
      for (let z = z0; z <= mz; z++) {
        for (let x = x0; x <= x1; x++) {
          if (hash2(seed ^ 0xf402, x, z) < 0.75) b.set(x, FL + wallH, z, "thatch");
        }
      }
    }
    // interior wreckage
    if (hash2(seed ^ 0xf500, x0, z1) < 0.6) b.set(mx - 1, FL, mz, "rubble");
    if (hash2(seed ^ 0xf501, x0, z1) < 0.35) b.set(mx + 1, FL, mz + 1, "hay");
  };

  // grand civic ruin: a big stone shell with arched window rows, interior
  // colonnade, collapsed corner, and charred rafters — the buildings that
  // made Valdrenn a CITY (guild hall, garrison hall, granary)
  const grandRuin = (x0: number, z0: number, w: number, d: number): void => {
    const x1 = x0 + w - 1;
    const z1 = z0 + d - 1;
    const wallH = 7;
    b.clearAbove(x0 - 1, z0 - 1, x1 + 1, z1 + 1, G, 16);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const r = hash2(seed ^ 0xf7f1, x, z);
        b.set(x, G, z, r < 0.3 ? "path" : "stone_bricks");
      }
    }
    const wallCol = (x: number, z: number): void => {
      const r = hash2(seed ^ 0xf800, x, z);
      const bite = r < 0.6 ? 0 : 1 + Math.floor((r - 0.6) * 10);
      for (let y = FL; y <= FL + wallH - 1 - bite; y++) aged(x, y, z);
      // tall arched window slots on surviving runs
      if (bite === 0 && (x + z) % 4 === 0) {
        b.set(x, FL + 2, z, 0);
        b.set(x, FL + 3, z, 0);
      }
    };
    for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) wallCol(x, z);
    for (let z = z0 + 1; z <= z1 - 1; z++) for (const x of [x0, x1]) wallCol(x, z);
    // grand doorway (3 wide) on the south face
    const mx = Math.floor((x0 + x1) / 2);
    b.fill(mx - 1, FL, z1, mx + 1, FL + 3, z1, 0);
    // interior colonnade, some columns toppled
    for (let cx = x0 + 3; cx <= x1 - 3; cx += 4) {
      for (const cz of [z0 + 3, z1 - 3]) {
        const h = hash2(seed ^ 0xf900, cx, cz) < 0.6 ? wallH - 1 : 2;
        b.fill(cx, FL, cz, cx, FL + h - 1, cz, "stone_bricks");
        if (h === 2) rubbleMound(cx + 1, cz, 1, FL);
      }
    }
    // collapsed NE corner + charred rafters
    b.fill(x1 - 2, FL, z0, x1, FL + wallH, z0 + 2, 0);
    rubbleMound(x1 - 1, z0 + 1, 2, FL);
    for (let x = x0 + 2; x < x1 - 2; x += 3) {
      if (hash2(seed ^ 0xfa00, x, z0) < 0.6) b.fill(x, FL + wallH - 1, z0 + 1, x, FL + wallH - 1, z1 - 1, "charred_log");
    }
    b.set(mx, FL + 3, z0 + 1, "banner");
    b.set(x0 + 1, FL + 3, Math.floor((z0 + z1) / 2), "lantern");
  };

  // ---- ground: districts get their own war-worn paving ----
  // avenue (7 wide, gate → castle stair): cobble broken by rubble and dirt
  for (let z = 96; z <= 212; z++) {
    for (let x = 125; x <= 131; x++) {
      const r = hash2(seed ^ 0xaa01, x, z);
      b.set(x, G, z, r < 0.12 ? "rubble" : r < 0.28 ? "path" : "cobblestone");
    }
  }
  // cross streets + side lanes: gravel, rubble-pocked
  const street = (x0: number, z0: number, x1: number, z1: number): void => {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const r = hash2(seed ^ 0xaa02, x, z);
        b.set(x, G, z, r < 0.1 ? "rubble" : "path");
      }
    }
  };
  street(30, 148, 226, 151); // south cross road
  street(40, 108, 216, 111); // north cross road
  street(68, 100, 70, 204); // west lane
  street(186, 100, 188, 204); // east lane
  street(140, 176, 226, 177); // residential alley

  // ---- city curtain wall (h5, aged) + towers ----
  agedWall(CITY.x0, CITY.z0, CITY.x1, CITY.z0, FL, 5); // north
  agedWall(CITY.x0, CITY.z0, CITY.x0, CITY.z1, FL, 5); // west
  agedWall(CITY.x1, CITY.z0, CITY.x1, EAST_BREACH.z0 - 1, FL, 5); // east, north of breach
  agedWall(CITY.x1, EAST_BREACH.z1 + 1, CITY.x1, CITY.z1, FL, 5); // east, south of breach
  agedWall(CITY.x0, CITY.z1, WEST_BREACH.x0 - 1, CITY.z1, FL, 5); // south, west of west breach
  agedWall(WEST_BREACH.x1 + 1, CITY.z1, CITY_GATE.x0 - 5, CITY.z1, FL, 5); // south, up to gatehouse
  agedWall(CITY_GATE.x1 + 5, CITY.z1, CITY.x1, CITY.z1, FL, 5); // south, east of gatehouse
  b.tower(CITY.x0, CITY.z0, FL, 2, 8);
  b.tower(CITY.x0, CITY.z1, FL, 2, 8);
  b.tower(CITY.x1, CITY.z1, FL, 2, 8);
  b.tower(128, CITY.z0, FL, 2, 8); // north mid
  b.tower(CITY.x0, 116, FL, 2, 8); // west mid
  b.tower(CITY.x1, 116, FL, 2, 8); // east mid (north of the breach)
  rubbleMound(CITY.x1, CITY.z0, 3, FL); // NE corner tower fell in the siege

  // breaches: the wall torn open, rubble fans spilling both ways
  for (let z = EAST_BREACH.z0; z <= EAST_BREACH.z1; z++) b.fill(CITY.x1, FL, z, CITY.x1, FL + 6, z, 0);
  rubbleMound(CITY.x1, 128, 3, FL);
  b.fill(CITY.x1 - 4, FL + 1, 127, CITY.x1 + 4, FL + 3, 129, 0); // climbable track through the fan
  street(CITY.x1 - 6, 127, CITY.x1 + 6, 129); // breach track to the east lane
  for (let x = WEST_BREACH.x0; x <= WEST_BREACH.x1; x++) b.fill(x, FL, CITY.z1, x, FL + 6, CITY.z1, 0);
  rubbleMound(63, CITY.z1, 2, FL);
  b.fill(62, FL + 1, CITY.z1 - 2, 64, FL + 3, CITY.z1 + 2, 0);

  // ---- south gatehouse: twin towers, killing corridor, murder holes,
  // half-raised portcullis ----
  b.clearAbove(CITY_GATE.x0 - 5, CITY.z1 - 7, CITY_GATE.x1 + 5, CITY.z1 + 5, G);
  for (let z = CITY.z1 - 6; z <= CITY.z1 + 4; z++) {
    for (let x = CITY_GATE.x0; x <= CITY_GATE.x1; x++) b.set(x, G, z, "path");
    // corridor side walls
    for (const wx of [CITY_GATE.x0 - 1, CITY_GATE.x1 + 1]) {
      for (let y = FL; y <= FL + 5; y++) aged(wx, y, z);
    }
  }
  // murder-hole ceiling over the corridor (holes stay open)
  for (let z = CITY.z1 - 5; z <= CITY.z1 + 3; z++) {
    for (let x = CITY_GATE.x0 - 1; x <= CITY_GATE.x1 + 1; x++) {
      if ((x === 127 || x === 129) && (z === CITY.z1 - 3 || z === CITY.z1 + 1)) continue;
      aged(x, FL + 6, z);
    }
  }
  b.tower(CITY_GATE.x0 - 3, CITY.z1, FL, 2, 9);
  b.tower(CITY_GATE.x1 + 3, CITY.z1, FL, 2, 9);
  b.torch(CITY_GATE.x0 - 3, FL + 10, CITY.z1);
  b.torch(CITY_GATE.x1 + 3, FL + 10, CITY.z1);
  // portcullis at the outer mouth, jammed half-raised: outer columns hang
  // full drop, the center rusted open (3 wide × 3 of headroom)
  for (let x = CITY_GATE.x0; x <= CITY_GATE.x1; x++) {
    const open = x >= 127 && x <= 129;
    for (let y = FL; y <= FL + 4; y++) {
      if (open && y <= FL + 2) continue;
      b.set(x, y, CITY.z1 + 1, "iron_bars");
    }
  }

  // ---- castle plinth: terraced +4, stone-faced, monumental stair ----
  for (let z = PLINTH.z0; z <= PLINTH.z1; z++) {
    for (let x = PLINTH.x0; x <= PLINTH.x1; x++) {
      b.flatten(x, z, x, z, PG, "path");
    }
  }
  // retaining face (the plinth reads as built ground, not a dirt bump)
  for (let x = PLINTH.x0; x <= PLINTH.x1; x++) {
    for (let y = FL; y <= PG; y++) {
      aged(x, y, PLINTH.z1); // south face
      aged(x, y, PLINTH.z0); // north face
    }
  }
  for (let z = PLINTH.z0; z <= PLINTH.z1; z++) {
    for (let y = FL; y <= PG; y++) {
      aged(PLINTH.x0, y, z);
      aged(PLINTH.x1, y, z);
    }
  }
  // monumental stair (feet 17 → 13): three 1-block steps down the south face
  for (let x = 120; x <= 136; x++) {
    for (let s = 0; s < 3; s++) {
      const z = PLINTH.z1 + 1 + s; // 93,94,95
      const top = PG - 1 - s; // 15,14,13
      b.fill(x, FL, z, x, top, z, "stone_bricks");
      b.fill(x, top + 1, z, x, PG + 8, z, 0);
    }
  }

  // ---- castle curtain (taller than the city wall — defensive layering) ----
  agedWall(CASTLE.x0, CASTLE.z0, CASTLE.x1, CASTLE.z0, PFL, 6);
  agedWall(CASTLE.x0, CASTLE.z0, CASTLE.x0, CASTLE.z1, PFL, 6);
  agedWall(CASTLE.x1, CASTLE.z0, CASTLE.x1, CASTLE.z1, PFL, 6);
  agedWall(CASTLE.x0, CASTLE.z1, CITY_GATE.x0 - 5, CASTLE.z1, PFL, 6);
  agedWall(CITY_GATE.x1 + 5, CASTLE.z1, CASTLE.x1, CASTLE.z1, PFL, 6);
  for (const [tx, tz] of [
    [CASTLE.x0, CASTLE.z0],
    [CASTLE.x1, CASTLE.z0],
    [CASTLE.x0, CASTLE.z1],
    [CASTLE.x1, CASTLE.z1],
    [CASTLE.x0, 60],
    [CASTLE.x1, 60],
  ] as const) {
    b.tower(tx, tz, PFL, 2, 10);
    b.torch(tx, PFL + 11, tz);
  }
  // castle gatehouse: corridor through the curtain onto the stair axis
  for (let z = CASTLE.z1 - 4; z <= PLINTH.z1; z++) {
    for (let x = CITY_GATE.x0; x <= CITY_GATE.x1; x++) {
      b.set(x, PG, z, "path");
      b.fill(x, PFL, z, x, PFL + 8, z, 0);
    }
    for (const wx of [CITY_GATE.x0 - 1, CITY_GATE.x1 + 1]) {
      for (let y = PFL; y <= PFL + 6; y++) aged(wx, y, z);
    }
  }
  for (let z = CASTLE.z1 - 3; z <= PLINTH.z1 - 1; z++) {
    for (let x = CITY_GATE.x0 - 1; x <= CITY_GATE.x1 + 1; x++) {
      if ((x === 126 || x === 130) && (z === CASTLE.z1 - 1 || z === CASTLE.z1 + 2)) continue; // murder holes
      aged(x, PFL + 7, z);
    }
  }
  b.tower(CITY_GATE.x0 - 3, CASTLE.z1, PFL, 2, 10);
  b.tower(CITY_GATE.x1 + 3, CASTLE.z1, PFL, 2, 10);
  b.torch(CITY_GATE.x0 - 3, PFL + 11, CASTLE.z1);
  b.torch(CITY_GATE.x1 + 3, PFL + 11, CASTLE.z1);
  // castle portcullis: intact but FORCED — the bars bent open at the center
  for (let x = CITY_GATE.x0; x <= CITY_GATE.x1; x++) {
    const open = x >= 127 && x <= 129;
    for (let y = PFL; y <= PFL + 4; y++) {
      if (open && y <= PFL + 2) continue;
      b.set(x, y, CASTLE.z1, "iron_bars");
    }
  }

  // ---- courtyard: well, burned lean-tos, the war's leftovers ----
  // (explicit PG ys — paintCircle would paint the NOISE ground, 4 below the plinth)
  b.fill(109, PG, 77, 115, PG, 83, "cobblestone");
  b.fill(111, PFL, 79, 113, PFL, 81, "stone_bricks");
  b.set(112, PFL, 80, "water");
  // barracks lean-to (east): charred posts, collapsed
  for (const [px, pz] of [
    [166, 78],
    [172, 78],
    [178, 78],
    [166, 84],
    [172, 84],
    [178, 84],
  ] as const) {
    b.fill(px, PFL, pz, px, PFL + 2, pz, "charred_log");
  }
  rubbleMound(172, 81, 2, PFL);
  b.set(168, PFL, 81, "hay");
  b.set(175, PFL, 80, "hay");
  // armory shell (west)
  for (let x = 72; x <= 86; x++) {
    for (const z of [76, 84]) {
      const bite = Math.floor(hash2(seed ^ 0xa310, x, z) * 4);
      for (let y = PFL; y <= PFL + 3 - bite; y++) aged(x, y, z);
    }
  }
  for (let z = 77; z <= 83; z++) {
    for (const x of [72, 86]) {
      const bite = Math.floor(hash2(seed ^ 0xa311, x, z) * 4);
      for (let y = PFL; y <= PFL + 3 - bite; y++) aged(x, y, z);
    }
  }
  b.fill(79, PFL, 84, 80, PFL + 3, 84, 0); // south doorway
  b.set(75, PFL, 79, "iron_bars"); // toppled weapon racks
  b.set(82, PFL, 80, "iron_bars");
  rubbleMound(84, 78, 1, PFL);

  // ---- the KEEP: marble great hall + throne room ----
  // shell
  for (let z = KEEP.z0; z <= KEEP.z1; z++) {
    for (let x = KEEP.x0; x <= KEEP.x1; x++) {
      const edge = x === KEEP.x0 || x === KEEP.x1 || z === KEEP.z0 || z === KEEP.z1;
      if (!edge) continue;
      for (let y = PFL; y <= PFL + 11; y++) b.set(x, y, z, "marble");
    }
  }
  // floor + interior clear
  for (let z = KEEP.z0 + 1; z <= KEEP.z1 - 1; z++) {
    for (let x = KEEP.x0 + 1; x <= KEEP.x1 - 1; x++) {
      b.set(x, PG, z, "marble");
      b.fill(x, PFL, z, x, PFL + 11, z, 0);
    }
  }
  // ceiling (stone — a keep never wears a wooden roof) + corner towers
  b.fill(KEEP.x0, PFL + 12, KEEP.z0, KEEP.x1, PFL + 12, KEEP.z1, "stone_bricks");
  // war-torn ceiling BREACHES: the siege tore the roof open in three places —
  // perpetual-sunset skylight pours into the hall in shafts (the owner's
  // "insanely dark" fix that also tells the story)
  for (const [hx, hz, hr] of [
    [112, 50, 2.6],
    [144, 62, 3.1],
    [128, 47, 2.2],
  ] as const) {
    for (let z = Math.floor(hz - hr - 1); z <= Math.ceil(hz + hr + 1); z++) {
      for (let x = Math.floor(hx - hr - 1); x <= Math.ceil(hx + hr + 1); x++) {
        const d = Math.hypot(x - hx, z - hz);
        if (d <= hr + (hash2(seed ^ 0xce11, x, z) - 0.5) * 1.2) b.set(x, PFL + 12, z, 0);
        else if (d <= hr + 1.4 && hash2(seed ^ 0xce12, x, z) < 0.3) b.set(x, PFL + 12, z, "cracked_bricks");
      }
    }
  }
  for (const [tx, tz] of [
    [KEEP.x0, KEEP.z0],
    [KEEP.x1, KEEP.z0],
    [KEEP.x0, KEEP.z1],
    [KEEP.x1, KEEP.z1],
  ] as const) {
    b.fill(tx - 2, PFL, tz - 2, tx + 2, PFL + 14, tz + 2, "marble");
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++)
        if ((Math.abs(dx) === 2 || Math.abs(dz) === 2) && (dx + dz) % 2 === 0)
          b.set(tx + dx, PFL + 15, tz + dz, "marble");
  }
  // grand doors: 3 wide × 4 tall, south wall, on the avenue axis
  b.fill(127, PFL, KEEP.z1, 129, PFL + 3, KEEP.z1, 0);
  b.torch(126, PFL + 4, KEEP.z1 + 1);
  b.torch(130, PFL + 4, KEEP.z1 + 1);
  // rose window (north wall, behind the throne): a leaded diamond that
  // burns with the kingdom's last light (stained_glass glows)
  for (let y = PFL + 2; y <= PFL + 10; y++) {
    for (let x = 121; x <= 135; x++) {
      if (Math.abs(x - 128) + Math.abs(y - (PFL + 6)) <= 4) b.set(x, y, KEEP.z0, "stained_glass");
    }
  }
  // lancet windows along the hall walls
  for (const z of [46, 54, 62] as const) {
    for (const wx of [KEEP.x0, KEEP.x1] as const) {
      b.fill(wx, PFL + 3, z, wx, PFL + 4, z + 1, "stained_glass");
    }
  }
  // colonnade: marble columns — every column carries a lantern (the court's
  // lamplighters never stopped) with banners above on the hall side
  for (const cx of [112, 144] as const) {
    for (const cz of [44, 50, 56, 62, 68] as const) {
      b.fill(cx, PFL, cz, cx, PFL + 11, cz, "marble");
      const aisle = cx === 112 ? cx + 1 : cx - 1;
      b.set(aisle, PFL + 3, cz, "lantern");
      b.set(aisle, PFL + 5, cz, "banner");
    }
  }
  // wall sconces: torch pools along both hall walls
  for (const sz of [42, 50, 58, 66] as const) {
    b.torch(KEEP.x0 + 1, PFL + 3, sz);
    b.torch(KEEP.x1 - 1, PFL + 3, sz);
  }
  // the royal carpet: door → dais
  for (let z = 46; z <= KEEP.z1 - 1; z++) {
    for (let x = 127; x <= 129; x++) b.set(x, PG, z, "red_carpet");
  }
  // dais: three marble steps, carpet up the middle
  b.fill(120, PFL, 38, 136, PFL, 44, "marble");
  b.fill(123, PFL + 1, 39, 133, PFL + 1, 43, "marble");
  b.fill(125, PFL + 2, 40, 131, PFL + 2, 42, "marble");
  for (const [cy, cz] of [
    [PFL, 44],
    [PFL + 1, 43],
    [PFL + 2, 42],
  ] as const) {
    for (let x = 127; x <= 129; x++) b.set(x, cy, cz, "red_carpet");
  }
  // the throne: gold, tall-backed, flanked by braziers on the dais
  b.set(THRONE.x, PFL + 3, THRONE.z, "gold_block"); // seat
  b.fill(THRONE.x, PFL + 3, THRONE.z - 1, THRONE.x, PFL + 6, THRONE.z - 1, "gold_block"); // back
  b.set(THRONE.x - 1, PFL + 3, THRONE.z, "gold_block"); // arms
  b.set(THRONE.x + 1, PFL + 3, THRONE.z, "gold_block");
  for (const bx of [124, 132] as const) {
    b.set(bx, PFL + 2, 41, "dark_bricks");
    b.set(bx, PFL + 3, 41, "ember_crystal");
  }
  for (const bx of [122, 134] as const) {
    b.set(bx, PFL, 46, "dark_bricks");
    b.set(bx, PFL + 1, 46, "ember_crystal");
  }
  // two more brazier pairs light the nave's length
  for (const [bx, bz] of [
    [120, 56],
    [136, 56],
    [120, 66],
    [136, 66],
  ] as const) {
    b.set(bx, PFL, bz, "dark_bricks");
    b.set(bx, PFL + 1, bz, "ember_crystal");
  }
  // treasury (west wing): gold heaped behind a forced partition
  for (let z = KEEP.z0 + 1; z <= 50; z++) {
    for (let y = PFL; y <= PFL + 5; y++) {
      if (z === 44 || z === 45) continue; // forced doorway
      b.set(110, y, z, "marble");
    }
  }
  for (let x = KEEP.x0 + 1; x <= 109; x++) {
    for (let y = PFL; y <= PFL + 5; y++) b.set(x, y, 50, "marble");
  }
  for (const [gx, gz, h] of [
    [100, 40, 2],
    [101, 40, 1],
    [100, 41, 1],
    [104, 43, 1],
    [99, 46, 1],
    [103, 39, 1],
  ] as const) {
    for (let y = 0; y < h; y++) b.set(gx, PFL + y, gz, "gold_block");
  }
  b.set(106, PFL, 47, "rubble"); // the looters got this far and no further
  b.set(100, PFL + 3, 44, "lantern");
  features.caches.push({ x: 102.5, y: PFL, z: 41.5, table: "cache_royal", respawnSec: 900 });
  // barracks (east wing): the Oathbound's last muster
  for (let z = KEEP.z0 + 1; z <= 50; z++) {
    for (let y = PFL; y <= PFL + 5; y++) {
      if (z === 44 || z === 45) continue;
      b.set(146, y, z, "marble");
    }
  }
  for (let x = 147; x <= KEEP.x1 - 1; x++) {
    for (let y = PFL; y <= PFL + 5; y++) b.set(x, y, 50, "marble");
  }
  for (const [px, pz] of [
    [150, 39],
    [153, 39],
    [156, 39],
  ] as const) {
    b.fill(px, PFL, pz, px + 1, PFL, pz, "planks"); // cots
  }
  b.set(157, PFL, 48, "iron_bars"); // arms racks
  b.set(157, PFL, 47, "iron_bars");
  b.set(149, PFL, 48, "hay");
  b.set(156, PFL + 3, 44, "lantern");

  // ---- west market quarter: burned stalls, the marauders squatting it ----
  for (let z = 168; z <= 190; z++) {
    for (let x = 54; x <= 86; x++) {
      const r = hash2(seed ^ 0xaa03, x, z);
      b.set(x, G, z, r < 0.12 ? "rubble" : r < 0.24 ? "path" : "cobblestone");
    }
  }
  for (const [sx, sz] of [
    [56, 170],
    [64, 186],
    [80, 168],
    [82, 186],
  ] as const) {
    // burned stall: charred posts, no canopy left
    for (const [dx, dz] of [
      [0, 0],
      [3, 0],
      [0, 2],
      [3, 2],
    ] as const) {
      b.fill(sx + dx, FL, sz + dz, sx + dx, FL + 1 + Math.floor(hash2(seed ^ 0xaa04, sx + dx, sz + dz) * 2), sz + dz, "charred_log");
    }
    b.paintCircle(sx + 1.5, sz + 1, 2.4, "ash");
  }
  // the marauder camp: broken palisade ring, war banners, cookfire
  const camp = { x: 70, z: 178 };
  for (let a = 0; a < 40; a++) {
    const ang = (a / 40) * Math.PI * 2;
    const px = Math.round(camp.x + Math.cos(ang) * 9);
    const pz = Math.round(camp.z + Math.sin(ang) * 9);
    if (hash2(seed ^ 0xaa05, px, pz) < 0.62) b.fill(px, FL, pz, px, FL + 1, pz, "palisade");
  }
  for (const [bx, bz] of [
    [79, 178],
    [61, 178],
    [70, 187],
    [70, 169],
  ] as const) {
    b.fill(bx, FL, bz, bx, FL + 2, bz, "palisade");
    b.set(bx, FL + 3, bz, "banner");
  }
  b.paintCircle(camp.x, camp.z, 1.4, "ash");
  b.set(camp.x, FL, camp.z, "charred_log");
  b.torch(camp.x, FL + 1, camp.z);
  for (const [hx, hz] of [
    [66, 174],
    [74, 181],
    [67, 182],
  ] as const) {
    b.set(hx, FL, hz, "hay");
  }
  // warehouse shells west of the market
  ruinedHouse(36, 160, 9, 8, "e");
  ruinedHouse(36, 186, 9, 8, "e");
  ruinedHouse(44, 172, 8, 7, "n");

  // ---- residential rows (east) + scattered west-side homes ----
  ruinedHouse(140, 156, 7, 6, "n");
  ruinedHouse(152, 156, 7, 6, "n");
  ruinedHouse(164, 156, 7, 6, "n");
  ruinedHouse(196, 156, 7, 6, "n");
  ruinedHouse(208, 156, 7, 6, "n");
  ruinedHouse(140, 182, 7, 6, "n");
  ruinedHouse(154, 182, 7, 6, "n");
  ruinedHouse(196, 182, 8, 7, "n");
  ruinedHouse(210, 184, 7, 6, "w");
  ruinedHouse(146, 196, 7, 6, "n");
  ruinedHouse(206, 196, 7, 6, "n");
  // NW quarter: homes that faced the first assault, and the old smithy
  ruinedHouse(46, 116, 7, 6, "s");
  ruinedHouse(58, 116, 7, 6, "s");
  ruinedHouse(90, 116, 7, 6, "s");
  ruinedHouse(46, 130, 8, 7, "e");
  ruinedHouse(78, 132, 7, 6, "n");
  ruinedHouse(96, 130, 7, 6, "w");
  // smithy: dark-brick forge still holding its heat
  for (let x = 74; x <= 80; x++) {
    for (const z of [118, 124]) {
      const bite = Math.floor(hash2(seed ^ 0xaa06, x, z) * 3);
      for (let y = FL; y <= FL + 2 - bite; y++) b.set(x, y, z, "dark_bricks");
    }
  }
  for (let z = 119; z <= 123; z++) {
    for (const x of [74, 80]) {
      const bite = Math.floor(hash2(seed ^ 0xaa07, x, z) * 3);
      for (let y = FL; y <= FL + 2 - bite; y++) b.set(x, y, z, "dark_bricks");
    }
  }
  b.fill(77, FL, 118, 77, FL + 2, 118, 0); // north doorway
  b.fill(75, FL, 122, 76, FL, 122, "dark_bricks"); // the forge
  b.set(75, FL + 1, 122, "ember_crystal");
  b.set(79, FL, 120, "iron_bars"); // anvil stand-in
  // SE quarter: homes inside the gate
  ruinedHouse(96, 160, 7, 6, "e");
  ruinedHouse(96, 172, 7, 6, "e");
  ruinedHouse(108, 190, 7, 6, "n");

  // ---- avenue frontage: the processional was a STREET, not a field —
  // house rows face it on both sides so the approach reads as a city canyon
  for (const fz of [102, 116, 130, 156, 170, 184, 198] as const) {
    ruinedHouse(114, fz, 7, 6, "e"); // west side, doors onto the avenue
  }
  for (const fz of [102, 116, 130, 168, 198] as const) {
    ruinedHouse(135, fz, 7, 6, "w"); // east side (gaps where the old rows sit)
  }
  // guard houses flanking the castle stair
  ruinedHouse(106, 98, 7, 6, "e");
  ruinedHouse(143, 98, 7, 6, "w");
  // grand civic ruins — the city's landmarks, dead
  grandRuin(96, 136, 13, 11); // the Guild Hall, west of the avenue
  grandRuin(150, 118, 14, 10); // the Garrison Hall, east
  grandRuin(54, 154, 12, 10); // the Granary above the market

  // ---- the broken approach: barricades bend the processional into an
  // S-curve (rubble-and-stake walls with offset gaps — no straight sprint
  // from the gate to the King)
  const barricade = (bx0: number, bx1: number, bz: number): void => {
    for (let x = bx0; x <= bx1; x++) {
      for (let z = bz; z <= bz + 1; z++) {
        const h = 2 + (hash2(seed ^ 0xbb01, x, z) < 0.4 ? 1 : 0);
        b.fill(x, FL, z, x, FL + h - 1, z, hash2(seed ^ 0xbb02, x, z) < 0.6 ? "rubble" : "palisade");
      }
    }
  };
  barricade(124, 128, 140); // gap on the EAST side (x129-132)
  barricade(129, 133, 118); // gap on the WEST side (x121-128)
  // a house collapsed INTO the road mid-avenue: squeeze past the fan
  rubbleMound(133, 189, 2, FL);
  b.fill(131, FL + 1, 188, 135, FL + 3, 190, 0); // keep it step-height on the road edge

  // ---- chapel + graveyard quarter (NE): where the city buried its dead ----
  const CH = { x0: 168, z0: 104, x1: 190, z1: 126 };
  b.clearAbove(CH.x0 - 1, CH.z0 - 1, CH.x1 + 1, CH.z1 + 1, G);
  for (let z = CH.z0; z <= CH.z1; z++) {
    for (let x = CH.x0; x <= CH.x1; x++) {
      const edge = x === CH.x0 || x === CH.x1 || z === CH.z0 || z === CH.z1;
      b.set(x, G, z, "marble");
      if (!edge) continue;
      const bite = Math.floor(hash2(seed ^ 0xaa08, x, z) * 4);
      for (let y = FL; y <= FL + 5 - bite; y++) b.set(x, y, z, "marble");
    }
  }
  b.fill(178, FL, CH.z1, 180, FL + 3, CH.z1, 0); // south doors
  // shattered rose window over the altar (half the panes blown out)
  for (let y = FL + 1; y <= FL + 5; y++) {
    for (let x = 175; x <= 183; x++) {
      if (Math.abs(x - 179) + Math.abs(y - (FL + 3)) <= 2 && hash2(seed ^ 0xaa09, x, y) < 0.55)
        b.set(x, y, CH.z0, "stained_glass");
    }
  }
  for (const cx of [173, 185] as const) {
    for (const cz of [110, 116, 122] as const) {
      const bite = Math.floor(hash2(seed ^ 0xaa0a, cx, cz) * 4);
      b.fill(cx, FL, cz, cx, FL + 4 - bite, cz, "marble");
    }
  }
  b.fill(176, FL, 106, 182, FL, 108, "marble"); // altar dais
  b.fill(178, FL + 1, 106, 180, FL + 1, 107, "marble");
  b.set(177, FL + 1, 107, "gold_block"); // candlesticks
  b.set(181, FL + 1, 107, "gold_block");
  for (const pz of [112, 115, 118, 121] as const) {
    for (let x = 175; x <= 183; x++) {
      if (x === 179) continue; // the aisle
      if (hash2(seed ^ 0xaa0b, x, pz) < 0.6) b.set(x, FL, pz, "planks"); // surviving pews
    }
  }
  rubbleMound(186, 120, 1, FL);
  features.caches.push({ x: 179.5, y: FL, z: 109.5, table: "cache_royal", respawnSec: 900 });
  // graveyards outside the chapel — freshly overfilled
  stampPrefab(b, "graveyard", 196, 130, 0, 1);
  stampPrefab(b, "graveyard", 210, 136, 0, 2);

  // ---- war scars everywhere: craters, snags, strewn rubble ----
  crater(128, 161, 3); // the avenue took a direct hit
  crater(100, 140, 3);
  crater(170, 168, 4);
  crater(86, 196, 3);
  crater(204, 118, 3);
  for (const [sx, sz] of [
    [50, 156],
    [92, 104],
    [118, 136],
    [163, 140],
    [200, 168],
    [60, 200],
    [110, 122],
    [174, 200],
  ] as const) {
    snag(sx, sz);
  }
  // strewn rubble pockets (kept off the plinth; streets stay passable —
  // single blocks are step-height)
  for (let i = 0; i < 90; i++) {
    const rx = 28 + Math.floor(hash2(seed ^ 0xaa0c, i, 1) * 200);
    const rz = 98 + Math.floor(hash2(seed ^ 0xaa0c, i, 2) * 106);
    if (rx >= 125 && rx <= 131) continue; // keep the avenue itself clear
    if (!b.world.solidAt(rx, G, rz)) continue; // never float over crater bowls
    if (hash2(seed ^ 0xaa0d, rx, rz) < 0.7) b.world.setIfAir(rx, FL, rz, id("rubble"));
    else b.world.setIfAir(rx, FL, rz, id("ash"));
  }
  // avenue lantern posts: the city's last lights, half of them dead
  for (let z = 104; z <= 204; z += 10) {
    for (const lx of [123, 133] as const) {
      b.fill(lx, FL, z, lx, FL + 1, z, "dark_bricks");
      if (hash2(seed ^ 0xaa0e, lx, z) < 0.55) b.set(lx, FL + 2, z, "lantern");
    }
  }

  // ---- arrival ground outside the gate ----
  street(120, CITY.z1 + 5, 136, 232);
  rubbleMound(118, 224, 2, FL);
  snag(140, 228);
}
