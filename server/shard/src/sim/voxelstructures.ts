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
import { PREFABS, scatterPrefabs, stampPrefab, type LootCachePoint, type Rect, type ScatterResult } from "./prefabs.js";
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
    // the Run needs authored coordinates)
    out.push(FOREST_FORT_EXCLUSION);
  }
  if (def.id === "stranglers_march") {
    // the strangled farmstead + its drowned field grid, the snapped tithe-road
    // causeway, the Run's chute-mouth mound, and the bending road corridor
    out.push(MARCH_FARM_EXCLUSION);
    out.push(MARCH_STUB_EXCLUSION);
    out.push(MARCH_MOUND_EXCLUSION);
    out.push(...marchRoadExclusions());
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
  if (def.id === "emberfells") {
    // the Old Kiln's adit court, the pour-terraces, and the haul-road corridor
    out.push(EMBER_ADIT_EXCLUSION);
    out.push(EMBER_TERRACE_EXCLUSION);
    out.push(...emberRoadExclusions());
  }
  if (def.id === "sundering_fields") {
    // the war's authored ground: the arena + war-sledge, the mass barrow, the
    // mustering line, the toll arch, both besieger camps, the sledge-furrow,
    // both trench crescents, and the two road corridors
    out.push(FIELDS_ARENA_EXCLUSION);
    out.push(FIELDS_BARROW_EXCLUSION);
    out.push(FIELDS_MUSTER_EXCLUSION);
    out.push(FIELDS_TOLL_EXCLUSION);
    out.push(FIELDS_FURROW_EXCLUSION);
    out.push(...FIELDS_TRENCH_EXCLUSIONS);
    out.push(...FIELDS_CAMP_EXCLUSIONS);
    out.push(...fieldsRoadExclusions());
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
      break;
    case "stranglers_march":
      buildStranglersMarch(b, def, features);
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
    case "broken_court":
      buildBrokenCourt(b, def, features);
      break;
    case "maw":
      buildMaw(b, def);
      break;
    case "greenhood_run":
      buildGreenhoodRun(b, def, features);
      break;
    case "emberfells":
      buildEmberfells(b, def, features);
      break;
    case "ossuary_galleries":
      buildOssuaryGalleries(b, def, features);
      break;
    case "sundering_fields":
      buildSunderingFields(b, def, features);
      break;
    case "foundry":
      buildFoundry(b, def, features);
      break;
    case "white_waste":
      buildWhiteWaste(b, def, features);
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

  /** NATURAL portal arch (owner canon rule 1, deferred since day one and paid
   *  in the batch-9 story dress pass: the arches were never BUILT — weathered
   *  standing rock, crystal-seamed, not masonry; people built around them).
   *  The SOLID volume is cell-identical to the old masonry arch — pillars at
   *  ±2 (fl..fl+3), spanning slab at fl+4, capstone at fl+5 — so BFS/pairing/
   *  apron behavior is untouched. Only materials changed (stone weathered with
   *  dark_stone bites, deterministic via hash2), the pillar-top torches became
   *  blue-crystal glints (non-solid glow in the SAME cells), and one crystal
   *  shard grows at each pillar's foot (non-solid cross on the apron).
   *  Anchoring keeps the batch-2 rule: arches stamp AFTER the authored
   *  builders, so a portal on dug/raised ground (the Wellhead crater pan, the
   *  Maw basin) anchors to the BUILT surface via groundAt() — the natural g()
   *  would float it 8-16 blocks in the air; the >2 guard keeps portals on
   *  natural/flattened ground on the legacy anchor path.
   *  NOTE: this restyle moved EVERY room's golden grid hash — the one
   *  documented mass GOLDEN_UPDATE (goldenhash.test.ts, 2026-07-10). */
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
    // weathered rock: stone mottled with dark_stone, deterministic per cell
    const rock = (x: number, y: number, z: number) =>
      hash2(this.def.terrain.seed ^ 0x0a2c, x * 7 + y, z * 11 + y) < 0.35 ? "dark_stone" : "stone";
    // standing stones (the old pillar cells)
    for (let y = fl; y <= fl + 3; y++) {
      this.set(px - dx, y, pz - dz, rock(px - dx, y, pz - dz));
      this.set(px + dx, y, pz + dz, rock(px + dx, y, pz + dz));
    }
    // the spanning slab + capstone — rough rock in the old lintel cells
    for (let i = -2; i <= 2; i++) {
      const x = px + (alongX ? 0 : i);
      const z = pz + (alongX ? i : 0);
      this.set(x, fl + 4, z, rock(x, fl + 4, z));
    }
    this.set(px, fl + 5, pz, rock(px, fl + 5, pz));
    // the crystal seam the rock grew around: glints at the stone tops
    // (the exact cells the torches held — non-solid glow, cool not warm)
    this.set(px - dx, fl + 5, pz - dz, "blue_crystal");
    this.set(px + dx, fl + 5, pz + dz, "blue_crystal");
    // and a shard at each standing stone's foot, on the apron
    const ox = alongX ? 0 : 1;
    const oz = alongX ? 1 : 0;
    this.set(px - dx - ox, fl, pz - dz - oz, "blue_crystal");
    this.set(px + dx + ox, fl, pz + dz + oz, "blue_crystal");
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
//   arch. The Run's one-way climb-out surfaced at a forest trapdoor mound
//   until batch 4 re-pointed it into the Strangler's March (the mound
//   dressing moved with it — see buildStranglersMarch).
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

/** The Run's chute-mouth: a low dirt mound with a rotting-plank trapdoor set
 *  flush in its crown + the stump-lantern mark. Lived in the forest north
 *  through batch 3; batch 4 moved it into the Strangler's March west (the
 *  greenhood-out one-way landing — arrivals stand ON the crown and step
 *  down). Disguised as a badger sett: smugglers design for goods out. */
function buildChuteMound(b: Builder, x: number, z: number): void {
  const G = b.g(x, z);
  b.clearAbove(x - 4, z - 4, x + 5, z + 5, G, 12);
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
// THE STRANGLER'S MARCH (W3, world-redesign batch 4) — the L5-7 border land
// spliced between the Kingless Wood and the Gloomfen, killing the L1-4 →
// L8-10 cliff. Story (bible §6 W3): farmland the fen's flood is eating a
// finger-width a year; with the water comes the fen tyrant's garden.
//
//   PROC + AUTHORED: seed 90031's own noise delivers the gradient (north
//   22% flooded vs south 8%; the west lake and the central basin MERGE at
//   z≈100, so every crossing must bend — the owner's no-straight-lines rule
//   enforced by hydrology). The builder adds: the south afforestation ramp
//   (mud→grass repaint + oaks thickening toward the forest gate, thinning to
//   the gen's sparse pale snags by mid-room), the bending road (path/dirt on
//   dry ground, rotting-plank boardwalk over murk) that forks off the OLD
//   tithe-road line and detours east through the drowned field grid, the
//   snapped causeway stub (the old road, raised, progressively broken, dying
//   into the flood — physically explains why the march must be crossed), the
//   strangled farmstead (the Elder's arena: a roofless fieldstone shell the
//   rootstock wears — log root-limbs, vines, moss, a glow-shroom-lit heart),
//   the drowned drystone field walls (west paddocks dug shin-deep and
//   flooded: theft in slow motion), and the Run's chute-mouth mound in the
//   west (buildChuteMound — the greenhood-out one-way landing).
//
// DETERMINISM: layout constants fixed; every ragged edge is hash2(seed^salt).
// ---------------------------------------------------------------------------
const MARCH_ROAD: Array<[number, number]> = [
  [120, 228], // the forest gate apron
  [120, 198], // the fork: the old road line continues north as the stub
  [132, 176],
  [134, 136],
  [136, 110], // the east crossing, skirting the drowned fields' west edge
  [124, 84],
  [104, 64],
  [84, 40],
  [84, 26], // the fen gate apron
];
const MARCH_FARM = { x0: 146, z0: 98, x1: 160, z1: 112 }; // the strangled farmhouse shell
const MARCH_FIELDS = { x0: 138, z0: 88, x1: 178, z1: 128 }; // drowned drystone field grid
const MARCH_STUB = { x: 120, z0: 104, z1: 148 }; // the snapped tithe-road causeway
const MARCH_MOUND = { x: 28, z: 148 }; // chute-mouth (greenhood-out exitX/exitZ 28.5,148.5)
const MARCH_FARM_EXCLUSION: Rect = { x0: MARCH_FIELDS.x0 - 3, z0: MARCH_FIELDS.z0 - 3, x1: MARCH_FIELDS.x1 + 3, z1: MARCH_FIELDS.z1 + 3 };
const MARCH_STUB_EXCLUSION: Rect = { x0: 114, z0: 94, x1: 126, z1: 152 };
const MARCH_MOUND_EXCLUSION: Rect = { x0: 22, z0: 142, x1: 35, z1: 155 };

function marchRoadExclusions(): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < MARCH_ROAD.length - 1; i++) {
    const [ax, az] = MARCH_ROAD[i]!;
    const [bx, bz] = MARCH_ROAD[i + 1]!;
    out.push({ x0: Math.min(ax, bx) - 4, z0: Math.min(az, bz) - 4, x1: Math.max(ax, bx) + 4, z1: Math.max(az, bz) + 4 });
  }
  return out;
}

/** Distance from a column to the march road polyline (for tree/field passes). */
function marchRoadDist(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < MARCH_ROAD.length - 1; i++) {
    const [ax, az] = MARCH_ROAD[i]!;
    const [bx, bz] = MARCH_ROAD[i + 1]!;
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
  }
  return best;
}

function buildStranglersMarch(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const wl = def.terrain.waterLevel ?? 12;
  const w = b.world;
  const GRASS = id("grass");
  const MUD = id("mud");
  const MURK = id("murk_water");

  // rects the dressing passes must not touch (prefabs placed by the scatter
  // pass that ran before us, plus our own authored ground)
  const keepOut: Rect[] = [MARCH_FARM_EXCLUSION, MARCH_STUB_EXCLUSION, MARCH_MOUND_EXCLUSION];
  for (const p of features.placements) {
    const pd = PREFABS[p.prefab];
    if (!pd) continue;
    const rw = p.rot % 2 ? pd.footprint.d : pd.footprint.w;
    const rd = p.rot % 2 ? pd.footprint.w : pd.footprint.d;
    keepOut.push({ x0: p.ox - 2, z0: p.oz - 2, x1: p.ox + rw + 1, z1: p.oz + rd + 1 });
  }
  const inKeepOut = (x: number, z: number): boolean =>
    keepOut.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);

  // fenFactor: 0 at the forest gate (the wood holds) → 1 by z≈90 (fen rules)
  const fen = (z: number): number => Math.min(1, Math.max(0, (206 - z) / 116));

  // --- 1. the gradient repaint: the south verge is still the Kingless Wood ---
  for (let z = 0; z < def.size.h; z++) {
    const f = fen(z);
    if (f >= 1) continue;
    for (let x = 0; x < def.size.w; x++) {
      const g = b.g(x, z);
      if (g <= wl) continue; // banks stay mud
      if (w.get(x, g, z) !== MUD) continue; // only natural swamp floor
      if (hash2(seed ^ 0x3a11, x, z) >= f) w.set(x, g, z, GRASS);
    }
  }

  // --- 2. oaks thicken southward (gen's sparse pale snags carry the north) ---
  const plantOak = (x: number, z: number): void => {
    const g = b.g(x, z);
    const th = 4 + Math.floor(hash2(seed ^ 0x3a13, x, z) * 3);
    for (let dy = th - 2; dy <= th + 1; dy++) {
      const rad = dy >= th ? 1 : 2;
      for (let dx = -rad; dx <= rad; dx++) {
        for (let dz = -rad; dz <= rad; dz++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && hash2(seed ^ 0x3a1c, x + dx, z + dz + dy * 31) < 0.5) continue;
          w.setIfAir(x + dx, g + 1 + dy, z + dz, id("leaves"));
        }
      }
    }
    for (let dy = 1; dy <= th; dy++) w.set(x, g + dy, z, id("log"));
  };
  for (let z = 2; z < def.size.h - 2; z++) {
    const wood = 1 - fen(z);
    if (wood <= 0.05) continue;
    for (let x = 2; x < def.size.w - 2; x++) {
      if (hash2(seed ^ 0x3a12, x, z) >= 0.018 * wood * wood) continue;
      const g = b.g(x, z);
      if (g <= wl) continue; // never in the water (bank oaks are fine — willows)
      if (inKeepOut(x, z) || marchRoadDist(x, z) < 4) continue;
      if (Math.hypot(x - def.spawn.x, z - def.spawn.z) < 8) continue;
      if (def.portals.some((p) => Math.hypot(x - p.x, z - p.z) < 6)) continue;
      plantOak(x, z);
    }
  }

  // --- 3. the road: path/dirt on dry ground, rotting planks over the murk ---
  const roadCell = (x: number, z: number): void => {
    const g = b.g(x, z);
    if (g <= wl) {
      w.set(x, wl + 1, z, id("rotting_planks")); // planked wet stretches
    } else {
      b.clearAbove(x, z, x, z, g, 10);
      w.set(x, g, z, hash2(seed ^ 0x3a14, x, z) < 0.7 ? id("path") : id("dirt"));
    }
  };
  for (let i = 0; i < MARCH_ROAD.length - 1; i++) {
    const [ax, az] = MARCH_ROAD[i]!;
    const [bx, bz] = MARCH_ROAD[i + 1]!;
    const len = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
    for (let t = 0; t <= len; t++) {
      const cx = Math.round(ax + ((bx - ax) * t) / len);
      const cz = Math.round(az + ((bz - az) * t) / len);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) roadCell(cx + dx, cz + dz);
    }
  }

  // --- 4. the old tithe-road: overgrown ruts, then the snapped causeway ---
  // faint ruts where the old line survives on dry ground (south of the stub)
  for (let z = MARCH_STUB.z1 + 4; z <= 196; z++) {
    for (const x of [119, 121]) {
      const g = b.g(x, z);
      if (g > wl && hash2(seed ^ 0x3a15, x, z) < 0.35) w.set(x, g, z, id("path"));
    }
  }
  // the raised causeway, progressively broken northward
  for (let z = MARCH_STUB.z1; z >= MARCH_STUB.z0; z--) {
    const decay = (MARCH_STUB.z1 - z) / (MARCH_STUB.z1 - MARCH_STUB.z0); // 0 south → 1 at the break
    for (const x of [119, 120, 121]) {
      const g = b.g(x, z);
      b.clearAbove(x, z, x, z, Math.max(g, 15), 8);
      if (hash2(seed ^ 0x3a16, x, z) < decay * 0.55) continue; // bitten deck
      for (let y = g + 1; y <= 14; y++) w.set(x, y, z, id("cobblestone"));
      w.set(x, 15, z, hash2(seed ^ 0x3a17, x, z) < 0.3 ? id("cracked_bricks") : id("stone_bricks"));
    }
    // parapet stubs survive on the south half
    if (z % 6 === 0 && decay < 0.4) {
      w.setIfAir(118, 16, z, id("cracked_bricks"));
      w.setIfAir(122, 16, z, id("cracked_bricks"));
    }
  }
  // the snap: rubble tumbling into the flood past the break
  for (let z = MARCH_STUB.z0 - 1; z >= MARCH_STUB.z0 - 8; z--) {
    for (const x of [118, 119, 120, 121, 122]) {
      if (hash2(seed ^ 0x3a18, x, z) < 0.25) w.set(x, b.g(x, z) + 1, z, id("rubble"));
    }
  }

  // --- 5. the drowned fields: drystone grid, west paddocks under the murk ---
  const F = MARCH_FIELDS;
  for (let z = F.z0; z <= F.z1; z++) {
    for (let x = F.x0; x <= F.x1; x++) {
      const inFarm = x >= MARCH_FARM.x0 - 2 && x <= MARCH_FARM.x1 + 2 && z >= MARCH_FARM.z0 - 2 && z <= MARCH_FARM.z1 + 2;
      if (inFarm || marchRoadDist(x, z) < 3.5) continue;
      const g = b.g(x, z);
      const onWall = (x - F.x0) % 10 === 0 || (z - F.z0) % 10 === 0;
      if (onWall) {
        // field walls poke out of the sedge (1 high — jumpable; hash-bitten)
        if (g >= wl - 1 && hash2(seed ^ 0x3a19, x, z) < 0.72) {
          w.set(x, Math.max(g, wl) + 1, z, id("mossy_cobblestone"));
        }
      } else if (g <= wl + (x <= MARCH_FARM.x0 && hash2(seed ^ 0x3a1a, x, z) < 0.5 ? 1 : 0)) {
        // paddock interiors at the water line drown shin-deep — and the west
        // paddocks (toward the basin) lose dry ground too: theft in slow motion
        for (let y = wl; y <= g + 4; y++) w.set(x, y, z, 0);
        w.set(x, wl - 1, z, MUD);
        w.set(x, wl, z, MURK);
      }
    }
  }

  // --- 6. the strangled farmstead (the Elder's arena) ---
  const H = MARCH_FARM;
  const G = 13; // surveyed knoll level (seed 90031: farm circle 93% dry at 12-13)
  const FL = G + 1;
  b.clearAbove(H.x0 - 2, H.z0 - 2, H.x1 + 2, H.z1 + 2, G, 14);
  b.flatten(H.x0 - 1, H.z0 - 1, H.x1 + 1, H.z1 + 1, G, "mud"); // the trampled yard
  b.flatten(H.x0 + 1, H.z0 + 1, H.x1 - 1, H.z1 - 1, G, "dirt"); // the house floor
  // roofless fieldstone shell, breached and root-split
  const wallCell = (x: number, z: number, salt: number): void => {
    const bite = Math.floor(hash2(seed ^ salt, x, z) * 2.4); // 0-2 blocks bitten off the top
    for (let y = FL; y <= FL + 2 - bite; y++) {
      w.set(x, y, z, hash2(seed ^ 0x3a1b, x, z + y * 31) < 0.35 ? id("cracked_bricks") : id("stone_bricks"));
    }
  };
  for (let x = H.x0; x <= H.x1; x++) {
    wallCell(x, H.z0, 0x51);
    wallCell(x, H.z1, 0x52);
  }
  for (let z = H.z0 + 1; z <= H.z1 - 1; z++) {
    wallCell(H.x0, z, 0x53);
    wallCell(H.x1, z, 0x54);
  }
  // the south door (full height — a lintel reads as a wall to the BFS grid)
  b.fill(152, FL, H.z1, 154, FL + 3, H.z1, 0);
  // the west breach: the flood side gave first
  b.fill(H.x0, FL, 104, H.x0, FL + 3, 106, 0);
  // the rootstock wears the house: log root-limbs up the corners + vines
  for (const [cx, cz] of [
    [H.x0, H.z0],
    [H.x1, H.z0],
    [H.x0, H.z1],
    [H.x1, H.z1],
  ] as const) {
    b.fill(cx, FL, cz, cx, FL + 3, cz, "log");
    w.setIfAir(cx, FL + 4, cz, id("roots"));
  }
  for (let x = H.x0 - 1; x <= H.x1 + 1; x++) {
    for (const z of [H.z0 - 1, H.z1 + 1]) {
      if (hash2(seed ^ 0x3a1d, x, z) < 0.3) w.setIfAir(x, FL + 1, z, id("vines"));
    }
  }
  // interior: moss creep, roots, and the heart of the garden
  for (let z = H.z0 + 1; z <= H.z1 - 1; z++) {
    for (let x = H.x0 + 1; x <= H.x1 - 1; x++) {
      const r = hash2(seed ^ 0x3a1e, x, z);
      if (r < 0.18) w.set(x, G, z, id("moss_carpet"));
      else if (r > 0.94) w.setIfAir(x, FL, z, id("roots"));
    }
  }
  // the heartroot mound at the arena's heart (the Elder spawns beside it)
  b.fill(152, FL, 104, 154, FL, 106, "dirt");
  b.set(153, FL + 1, 105, "roots");
  for (const [gx, gz] of [
    [151, 103],
    [155, 103],
    [151, 107],
    [155, 107],
  ] as const) {
    w.set(gx, FL, gz, id("glow_shroom")); // the garden glows at night (authored — wins over the root scatter)
  }

  // --- 7. the Run's chute-mouth mound (moved here from the forest north) ---
  buildChuteMound(b, MARCH_MOUND.x, MARCH_MOUND.z);
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

  // THE FREEHOLD (story bible §6: "the first acre back") — light dressing only,
  // batch 9. A boundary fence with a gate on the portal approach (Jib's
  // "a door that locks from the inside", made of palisade), a notice-board
  // beside the gate (the Charter's claim, posted), and the claim-stone at the
  // room's center. 1-high fence: symbolic, jumpable, never traps a builder.
  const gx = def.spawn.x; // 48 — the portal approach line
  for (let x = gx - 8; x <= gx + 8; x++) {
    if (Math.abs(x - gx) <= 1) continue; // the gate gap (portal apron path)
    const g = b.g(x, 88);
    b.clearAbove(x, 88, x, 88, g, 8);
    b.set(x, g + 1, 88, "palisade");
  }
  // notice board: two log posts + a plank board at head height, facing the gate
  const bg = b.g(gx - 4, 87);
  b.clearAbove(gx - 5, 87, gx - 3, 87, bg, 6);
  b.set(gx - 5, bg + 1, 87, "log");
  b.set(gx - 3, bg + 1, 87, "log");
  b.fill(gx - 5, bg + 2, 87, gx - 3, bg + 2, 87, "planks");
  b.torch(gx - 4, bg + 3, 87); // a reading lamp on the board's top rail
  // the claim-stone: FREE GROUND — HELD BY THE CHARTER (stone, marble, banner)
  const cx = Math.floor(def.size.w / 2);
  const cz = Math.floor(def.size.h / 2);
  const cg = b.g(cx, cz);
  b.clearAbove(cx - 1, cz - 1, cx + 1, cz + 1, cg);
  b.paintCircle(cx, cz, 1.6, "path");
  b.set(cx, cg + 1, cz, "stone");
  b.set(cx, cg + 2, cz, "marble");
  b.set(cx, cg + 3, cz, "banner");
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

  // ---- the Foundry gate approach (batch 7): the tribute road's last leg,
  // BEHIND the Forge Ruin — you walk past the Furnace-King's arena to reach
  // it, and the gate stays sealed until he is dead. Minimal dressing: the
  // bone road's continuation + a dead lantern pair flanking the approach.
  for (let z = 17; z <= 23; z++) {
    for (const x of [143, 144, 145]) {
      const g = b.g(x, z);
      if (g <= wl) {
        b.set(x, wl + 1, z, "bone_block");
      } else {
        b.clearAbove(x, z, x, z, g, 8);
        b.set(x, g, z, hash2(seed ^ 0xf0d7, x, z) < 0.35 ? "bone_block" : "ash");
      }
    }
  }
  for (const [lx, lz] of [
    [139, 20],
    [149, 20],
  ] as const) {
    const g = b.g(lx, lz);
    if (g > wl) {
      b.fill(lx, g + 1, lz, lx, g + 2, lz, "dark_bricks");
      b.set(lx, g + 3, lz, "lantern");
    }
  }
}

// ---------------------------------------------------------------------------
// THE EMBERFELLS (E3, world-redesign batch 5; story bible §6 E3) — the
// volcanic foothills spliced between the Sunscour and the Cinderrift: where
// the sand starts to burn. The terraces aren't geology — they're POUR-LINES,
// generations of slag tipped downslope from the rift above. Seed 91101 was
// SURVEYED (batch-4 discipline): its central lava basin sits square between
// the two gates, so the direct gate→gate ray crosses ~67 lava columns and
// the haul-road MUST bend around the basin's east shoulder — the owner's
// no-straight-lines rule enforced by the terrain itself.
//   1. the Sunscour gradient — the south third repaints dark rock to sand on
//      a hash ramp (the desert bleeding in; it dies out by mid-room);
//   2. the HAUL-ROAD — the ore road up to the rift, bending east around the
//      basin then crossing west at z≈149 behind it; charred-log sleepers rut
//      the dry stretches, bleached bone bridges the lava runs (the
//      Cinderrift bone-road material, on purpose: same wound);
//   3. the POUR-TERRACES — stepped slag benches descending west into the
//      basin, oldest (mossiest) at the bottom; the slag-adit trolls den here;
//   4. the OLD KILN'S ADIT — a slag-vomit cone on the basin's north rim,
//      mouth breathing ember-light, trough court swept with ash and bone:
//      the boss arena is its feeding trough.
// DETERMINISM: layout constants fixed; every ragged edge is hash2(seed^salt).
// ---------------------------------------------------------------------------
const EMBER_ROAD: Array<[number, number]> = [
  [200, 262], // the Sunscour gate apron
  [204, 224],
  [214, 192], // climbing the basin's east shoulder
  [220, 152],
  [150, 149], // the long west crossing behind the basin
  [100, 148],
  [96, 110], // turning north past the Kiln's spur
  [80, 64],
  [72, 34],
  [72, 28], // the Cinderrift gate apron
];
const EMBER_SPUR: Array<[number, number]> = [
  [96, 104],
  [112, 97], // the ore spur to the Kiln's trough court
];
const EMBER_ADIT = { x: 118, z: 88 }; // slag-cone center; trough court south of it
const EMBER_TERRACES = { x0: 148, z0: 152, x1: 184, z1: 174 }; // pour-line benches
const EMBER_ADIT_EXCLUSION: Rect = { x0: 104, z0: 76, x1: 134, z1: 106 };
const EMBER_TERRACE_EXCLUSION: Rect = { x0: EMBER_TERRACES.x0 - 3, z0: EMBER_TERRACES.z0 - 3, x1: EMBER_TERRACES.x1 + 3, z1: EMBER_TERRACES.z1 + 3 };

function emberRoadExclusions(): Rect[] {
  const out: Rect[] = [];
  for (const seg of [EMBER_ROAD, EMBER_SPUR]) {
    for (let i = 0; i < seg.length - 1; i++) {
      const [ax, az] = seg[i]!;
      const [bx, bz] = seg[i + 1]!;
      out.push({ x0: Math.min(ax, bx) - 4, z0: Math.min(az, bz) - 4, x1: Math.max(ax, bx) + 4, z1: Math.max(az, bz) + 4 });
    }
  }
  return out;
}

function buildEmberfells(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const wl = def.terrain.waterLevel ?? 9;
  const w = b.world;
  const SAND = id("sand");
  const SANDSTONE = id("sandstone");
  const DARK = id("dark_stone");
  const ASH = id("ash");
  const OBSIDIAN = id("obsidian");

  // rects the dressing passes must not touch (prefab scatter ran before us)
  const keepOut: Rect[] = [EMBER_ADIT_EXCLUSION, EMBER_TERRACE_EXCLUSION];
  for (const p of features.placements) {
    const pd = PREFABS[p.prefab];
    if (!pd) continue;
    const rw = p.rot % 2 ? pd.footprint.d : pd.footprint.w;
    const rd = p.rot % 2 ? pd.footprint.w : pd.footprint.d;
    keepOut.push({ x0: p.ox - 2, z0: p.oz - 2, x1: p.ox + rw + 1, z1: p.oz + rd + 1 });
  }
  const inKeepOut = (x: number, z: number): boolean =>
    keepOut.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);

  // --- 1. the Sunscour gradient: the south third is still half a desert ---
  // sandF: 0 at z≤190 (the fells rule) → 1 by z≥262 (the desert gate)
  const sandF = (z: number): number => Math.min(1, Math.max(0, (z - 190) / 72));
  for (let z = 190; z < def.size.h; z++) {
    const f = sandF(z);
    if (f <= 0) continue;
    for (let x = 0; x < def.size.w; x++) {
      const g = b.g(x, z);
      if (g <= wl) continue; // lava banks stay dark
      if (inKeepOut(x, z)) continue;
      const s = w.get(x, g, z);
      if (s !== DARK && s !== ASH) continue; // only natural volcanic floor
      if (hash2(seed ^ 0x5c01, x, z) < f * 0.9) {
        w.set(x, g, z, hash2(seed ^ 0x5c02, x, z) < 0.06 ? SANDSTONE : SAND);
      }
    }
  }

  // --- 2. the haul-road: ash/path on dry ground, bleached bone over lava ---
  const roadCell = (x: number, z: number, sleeper: boolean): void => {
    const g = b.g(x, z);
    if (g <= wl) {
      w.set(x, wl + 1, z, id("bone_block")); // the bone bridges (rift material)
    } else {
      b.clearAbove(x, z, x, z, g, 10);
      if (sleeper) w.set(x, g, z, id("charred_log")); // haul-sleepers rut the road
      else w.set(x, g, z, hash2(seed ^ 0x5c03, x, z) < 0.55 ? id("path") : ASH);
    }
  };
  for (const seg of [EMBER_ROAD, EMBER_SPUR]) {
    for (let i = 0; i < seg.length - 1; i++) {
      const [ax, az] = seg[i]!;
      const [bx, bz] = seg[i + 1]!;
      const len = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
      for (let t = 0; t <= len; t++) {
        const cx = Math.round(ax + ((bx - ax) * t) / len);
        const cz = Math.round(az + ((bz - az) * t) / len);
        const sleeper = t % 9 === 4 && b.g(cx, cz) > wl;
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) roadCell(cx + dx, cz + dz, sleeper);
      }
    }
  }

  // --- 3. the pour-terraces: stepped slag benches, oldest at the bottom ---
  const T = EMBER_TERRACES;
  for (let z = T.z0; z <= T.z1; z++) {
    for (let x = T.x0; x <= T.x1; x++) {
      const bench = Math.floor((x - T.x0) / 6); // 0..6, ascending east
      const ty = 12 + bench;
      // ragged bench lips: some columns keep their natural height (clear
      // their snags per-column at their OWN g — the Greywatch clearAbove trap)
      if (hash2(seed ^ 0x5c04, x, z) < 0.05) {
        b.clearAbove(x, z, x, z, b.g(x, z), 12);
        continue;
      }
      for (let y = Math.max(1, ty + 1); y < WORLD_HEIGHT; y++) w.set(x, y, z, 0);
      for (let y = Math.max(1, ty - 4); y < ty; y++) {
        if (!w.solidAt(x, y, z)) w.set(x, y, z, DARK);
      }
      const r = hash2(seed ^ 0x5c05, x, z);
      if (bench <= 1) {
        // the oldest pours: dull, mossed over
        w.set(x, ty, z, r < 0.3 ? id("mossy_cobblestone") : DARK);
        if (r > 0.9) w.setIfAir(x, ty + 1, z, id("moss_carpet"));
      } else if (bench >= 5) {
        // the freshest lips still cooling
        w.set(x, ty, z, r < 0.5 ? ASH : DARK);
        if (r > 0.975) w.setIfAir(x, ty + 1, z, id("ember_crystal"));
      } else {
        w.set(x, ty, z, r < 0.25 ? ASH : r > 0.92 ? OBSIDIAN : DARK);
      }
    }
  }

  // --- 4. the Old Kiln's adit: slag-vomit cone, breathing mouth, trough ---
  const A = EMBER_ADIT;
  const G0 = b.g(A.x, A.z);
  // per-column snag/decoration clear at each column's OWN surface (a blanket
  // clearAbove at G0 would shave every higher column — the Greywatch trap)
  for (let z = A.z - 12; z <= A.z + 16; z++) {
    for (let x = A.x - 12; x <= A.x + 12; x++) {
      b.clearAbove(x, z, x, z, b.g(x, z), 14);
    }
  }
  // the cone (raises only — the basin's rim stays as generated below it)
  for (let dz = -9; dz <= 9; dz++) {
    for (let dx = -9; dx <= 9; dx++) {
      const d = Math.hypot(dx, dz);
      if (d > 9) continue;
      const jitter = hash2(seed ^ 0x5c06, A.x + dx, A.z + dz) * 0.8;
      const top = G0 + Math.max(0, Math.round((9 - d) * 0.85 - jitter));
      for (let y = Math.max(1, b.g(A.x + dx, A.z + dz)); y <= top; y++) {
        w.set(A.x + dx, y, A.z + dz, d > 7.5 && hash2(seed ^ 0x5c07, dx, dz) < 0.4 ? ASH : DARK);
      }
    }
  }
  // the trough court south of the mouth (the arena floor) — slag-bodied:
  // flatten() would underfill with DIRT, and the court's east lip drops 4
  // blocks to the lava lobe (a brown retaining wall read wrong on camera)
  for (let z = A.z + 4; z <= A.z + 14; z++) {
    for (let x = A.x - 8; x <= A.x + 8; x++) {
      for (let y = G0 + 1; y < WORLD_HEIGHT; y++) w.set(x, y, z, 0);
      for (let y = Math.max(1, G0 - 4); y < G0; y++) {
        if (!w.solidAt(x, y, z)) w.set(x, y, z, DARK);
      }
      w.set(x, G0, z, ASH);
    }
  }
  // the mouth: a 3-wide adit dug south-facing into the cone
  b.fill(A.x - 1, G0 + 1, A.z - 2, A.x + 1, G0 + 3, A.z + 4, 0);
  b.fill(A.x - 1, G0 + 1, A.z - 3, A.x + 1, G0 + 3, A.z - 3, "dark_bricks"); // the kiln face
  b.set(A.x, G0 + 1, A.z - 3, "iron_bars"); // the grate it feeds through
  b.set(A.x, G0 + 2, A.z - 3, "iron_bars");
  b.set(A.x - 1, G0 + 1, A.z - 2, "ember_crystal"); // the mouth breathes ember-light
  b.set(A.x + 1, G0 + 1, A.z - 2, "ember_crystal");
  // slag-vomit cones ringing the trough
  for (const [cx, cz, ch] of [
    [A.x - 6, A.z + 6, 3],
    [A.x + 7, A.z + 7, 2],
    [A.x - 3, A.z + 12, 2],
    [A.x + 4, A.z + 13, 3],
    [A.x + 9, A.z + 2, 2],
  ] as const) {
    for (let dy = 0; dy < ch; dy++) {
      const r = ch - 1 - dy === 0 ? 0 : 1;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > r) continue;
          w.set(cx + dx, G0 + 1 + dy, cz + dz, dy === ch - 1 ? OBSIDIAN : DARK);
        }
      }
    }
    w.setIfAir(cx, G0 + ch + 1, cz, id("ember_crystal"));
  }
  // what feeding leaves: bone in the ash
  for (const [bx, bz] of [
    [A.x - 5, A.z + 9],
    [A.x + 2, A.z + 8],
    [A.x + 6, A.z + 11],
  ] as const) {
    w.setIfAir(bx, G0 + 1, bz, id("bone_block"));
  }
  b.set(A.x - 7, G0 + 1, A.z + 13, "skull_pile");
}

// ---------------------------------------------------------------------------
// THE OSSUARY GALLERIES (N2, world-redesign batch 5; story bible §6 N2) —
// the sorting-house of the Pale Court, spliced between the Sunken Crypt's
// Gravelord gate and the Vaults of Morvane. Below the Gravelord's door the
// tribute is PROCESSED: stitchers grade the dead like cloth, wardens shelve
// them, harrowers cull the stock. 128² PRESET (buildCrypt technique, biome
// dungeon, fixedTime 0.93): the route between the two gates S-BENDS through
// every gallery — entrance court → ledger-niche spine → the grading-hall's
// staggered shelf rows → the stitchery → the cull-rows → the down-shaft
// platform where THE Bone Warden stands his post beside the Court gate.
// The dead-cart service lane east of the hall is collapsed mid-way (rubble):
// its south spur dead-ends at the hidden chapel — the one room in the
// galleries that isn't industrial (☆ the Pallid Mourner; one candle).
// Light = language: torches at the door, lanterns where artisans work,
// braziers at the Warden's post, bog-candles between, ONE candle in the
// chapel. Convention: G = 12 (flat dungeon slab), FL = G+1.
// ---------------------------------------------------------------------------
const OSS_COURT = { x0: 50, z0: 104, x1: 80, z1: 122 };
const OSS_HALL = { x0: 38, z0: 44, x1: 90, z1: 72 }; // the grading-hall
const OSS_STITCHERY = { x0: 24, z0: 16, x1: 52, z1: 36 };
const OSS_CULL = { x0: 70, z0: 18, x1: 96, z1: 40 }; // the cull-rows
const OSS_PLATFORM = { x0: 96, z0: 8, x1: 122, z1: 36 }; // down-shaft + the Warden's post
const OSS_SHAFT = { x0: 102, z0: 12, x1: 109, z1: 19 }; // the freight shaft (pit)
const OSS_CHAPEL = { x0: 100, z0: 78, x1: 118, z1: 96 }; // the mourner's chapel (hidden)
const OSS_LANE = { x: 94, z0: 78, z1: 104 }; // the dead-cart lane (x..x+4 wide)

function buildOssuaryGalleries(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const G = b.g(def.spawn.x, def.spawn.z);
  const FL = G + 1;
  const M = 2;
  const X1 = def.size.w - 1 - M;
  const Z1 = def.size.h - 1 - M;
  const w = b.world;

  // perimeter: dark-brick gallery walls, bitten with age
  b.wallRun(M, M, X1, M, FL, 5, "dark_bricks");
  b.wallRun(M, Z1, X1, Z1, FL, 5, "dark_bricks");
  b.wallRun(M, M, M, Z1, FL, 5, "dark_bricks");
  b.wallRun(X1, M, X1, Z1, FL, 5, "dark_bricks");
  for (let i = 0; i < 48; i++) {
    const t = hash2(seed ^ 0x0551, i, 0);
    const side = i % 4;
    const along = Math.floor(hash2(seed ^ 0x0552, i, 1) * (def.size.w - 2 * M - 2)) + M + 1;
    const [x, z] = side === 0 ? [along, M] : side === 1 ? [along, Z1] : side === 2 ? [M, along] : [X1, along];
    b.fill(x, FL + 3 + Math.floor(t * 2), z, x, FL + 5, z, 0);
  }

  /** Walled gallery: cleared, floored, dark-brick walls with hash-bitten tops. */
  const gallery = (x0: number, z0: number, x1: number, z1: number, floor: string, salt: number): void => {
    b.clearAbove(x0 - 1, z0 - 1, x1 + 1, z1 + 1, G, 10);
    b.flatten(x0, z0, x1, z1, G, floor);
    for (let x = x0; x <= x1; x++) {
      for (const z of [z0, z1]) {
        const h = 4 - (hash2(seed ^ salt, x, z) < 0.25 ? 1 : 0);
        b.fill(x, FL, z, x, FL + h - 1, z, "dark_bricks");
      }
    }
    for (let z = z0 + 1; z <= z1 - 1; z++) {
      for (const x of [x0, x1]) {
        const h = 4 - (hash2(seed ^ salt ^ 0x77, x, z) < 0.25 ? 1 : 0);
        b.fill(x, FL, z, x, FL + h - 1, z, "dark_bricks");
      }
    }
  };
  /** Full-height doorway (a lintel reads as a wall to the BFS/standing grid). */
  const door = (x0: number, z0: number, x1: number, z1: number): void => {
    b.fill(x0, FL, z0, x1, FL + 4, z1, 0);
  };

  // --- the entrance court: the dead-cart terminus (torch-lit, the warm end) ---
  b.clearAbove(OSS_COURT.x0 - 1, OSS_COURT.z0 - 1, OSS_COURT.x1 + 1, OSS_COURT.z1 + 1, G, 10);
  b.flatten(OSS_COURT.x0, OSS_COURT.z0, OSS_COURT.x1, OSS_COURT.z1, G, "path");
  for (const [tx, tz] of [
    [56, 118],
    [72, 118],
    [56, 106],
    [72, 106],
  ] as const) {
    b.set(tx, FL, tz, "dark_bricks");
    b.torch(tx, FL + 1, tz);
  }
  // the last dead-cart, abandoned at the terminus
  b.set(75, FL, 112, "planks");
  b.set(76, FL, 112, "planks");
  b.set(75, FL + 1, 112, "bone_block");
  b.set(77, FL, 112, "hay");

  // --- the spine: ledger-niches (tally marks, not names) up to the hall ---
  b.flatten(61, 74, 67, 104, G, "crypt_slate");
  for (let z = 78; z <= 100; z += 6) {
    for (const x of [60, 68]) {
      b.fill(x, FL, z, x, FL + 2, z, "dark_bricks");
      b.set(x, FL + 1, z, "bone_block"); // the shelved tribute
      if (z === 78 || z === 96) w.setIfAir(x, FL + 3, z, id("chain"));
    }
    // tally light: warm at the door, corpse-candles deeper
    if (z >= 96) b.torch(z % 12 === 0 ? 60 : 68, FL + 3, z);
    else b.set(z % 12 === 0 ? 60 : 68, FL + 3, z, "bog_candle");
  }
  // intake stacks flank the spine where the fresh tribute waits
  for (const [sx, sz] of [
    [56, 84],
    [57, 92],
    [71, 80],
    [72, 96],
  ] as const) {
    b.set(sx, FL, sz, "bone_block");
    if (hash2(seed ^ 0x0553, sx, sz) < 0.5) b.set(sx, FL + 1, sz, "skull_pile");
  }

  // --- the grading-hall: sorted bone by size and quality, shelf-stamped ---
  const H = OSS_HALL;
  gallery(H.x0, H.z0, H.x1, H.z1, "crypt_slate", 0x0554);
  door(62, H.z1, 66, H.z1); // south door off the spine
  door(42, H.z0, 46, H.z0); // north-west door to the stitchery
  // shelf rows (2 high — jump-proof), gaps staggered so the crossing zig-zags
  for (const [sz, gap] of [
    [50, 74],
    [55, 50],
    [60, 74],
    [65, 50],
  ] as const) {
    for (let x = H.x0 + 3; x <= H.x1 - 3; x++) {
      if (x >= gap && x <= gap + 3) continue; // the aisle gap
      b.fill(x, FL, sz, x, FL + 1, sz, "bone_block");
      const r = hash2(seed ^ 0x0555, x, sz);
      if (r < 0.12) b.set(x, FL + 2, sz, "skull_pile");
      else if (r > 0.985) w.setIfAir(x, FL + 2, sz, id("web"));
    }
    // a corpse-candle at each aisle gap — the graders' light
    b.set(gap - 1, FL + 2, sz, "bog_candle");
  }
  b.set(H.x0 + 2, FL, H.z0 + 2, "skull_pile");
  b.set(H.x1 - 2, FL, H.z1 - 2, "skull_pile");

  // --- the stitchery: work-tables, sinew spools, one half-finished courtier ---
  const S = OSS_STITCHERY;
  gallery(S.x0, S.z0, S.x1, S.z1, "stone", 0x0556);
  door(42, S.z1, 46, S.z1); // south door from the hall corridor
  door(S.x1, 20, S.x1, 24); // east door to the cull-rows corridor
  b.flatten(41, 36, 47, 44, G, "crypt_slate"); // the connecting corridor
  for (const [tx, tz] of [
    [30, 22],
    [30, 28],
    [40, 22],
    [40, 28],
  ] as const) {
    b.fill(tx, FL, tz, tx + 2, FL, tz, "planks"); // a work-table
    const r = hash2(seed ^ 0x0557, tx, tz);
    if (r < 0.5) b.set(tx + 1, FL + 1, tz, "bone_block"); // the work in progress
    else b.set(tx + 2, FL + 1, tz, "web"); // sinew spools
  }
  // THE TABLEAU: the half-finished courtier on the master table
  b.fill(35, FL, 32, 37, FL, 32, "marble");
  b.set(35, FL + 1, 32, "skull_pile");
  b.set(36, FL + 1, 32, "bone_block");
  b.set(37, FL + 1, 32, "banner"); // dressed before it is done
  // the artisans work by real light (lanterns, not candles)
  for (const [lx, lz] of [
    [27, 25],
    [43, 25],
    [36, 34],
  ] as const) {
    b.fill(lx, FL, lz, lx, FL + 2, lz, "log");
    b.set(lx, FL + 3, lz, "lantern");
  }

  // --- the cull-rows: the harrowers' floor — chains, hooks, culled stock ---
  const C = OSS_CULL;
  gallery(C.x0, C.z0, C.x1, C.z1, "crypt_slate", 0x0558);
  door(C.x0, 20, C.x0, 24); // west door from the stitchery corridor
  b.flatten(53, 20, 69, 24, G, "crypt_slate"); // the connecting corridor
  door(C.x1, 24, C.x1, 26); // east door onto the platform
  for (let x = C.x0 + 4; x <= C.x1 - 4; x += 5) {
    b.fill(x, FL + 3, C.z0 + 1, x, FL + 3, C.z1 - 1, "log"); // the hook-beams
    for (let z = C.z0 + 3; z <= C.z1 - 3; z += 4) {
      if (hash2(seed ^ 0x0559, x, z) < 0.55) w.setIfAir(x, FL + 2, z, id("chain"));
    }
  }
  for (const [px, pz] of [
    [75, 36],
    [86, 22],
    [91, 34],
  ] as const) {
    b.set(px, FL, pz, "bone_block");
    b.set(px, FL + 1, pz, "skull_pile"); // the culled stock, heaped
  }
  b.set(74, FL, 20, "dark_bricks");
  b.set(74, FL + 1, 20, "brazier"); // the harrowers' fire

  // --- the down-shaft platform: the freight shaft + the Warden's post ---
  const P = OSS_PLATFORM;
  b.clearAbove(P.x0 - 1, P.z0 - 1, P.x1 + 1, P.z1 + 1, G, 12);
  b.flatten(P.x0, P.z0, P.x1, P.z1, G, "crypt_slate");
  // the shaft: dug to bedrock-clamp depth — the tribute goes further down
  // than the players do (scale by implication; the rail is 2 high, jump-proof)
  const SH = OSS_SHAFT;
  const pit = b.digFloorY(G, 40);
  for (let z = SH.z0; z <= SH.z1; z++) {
    for (let x = SH.x0; x <= SH.x1; x++) {
      for (let y = pit + 1; y <= G; y++) w.set(x, y, z, 0);
      w.set(x, pit, z, id("dark_stone"));
    }
  }
  for (let x = SH.x0 - 1; x <= SH.x1 + 1; x++) {
    for (const z of [SH.z0 - 1, SH.z1 + 1]) b.fill(x, FL, z, x, FL + 1, z, "iron_bars");
  }
  for (let z = SH.z0; z <= SH.z1; z++) {
    for (const x of [SH.x0 - 1, SH.x1 + 1]) b.fill(x, FL, z, x, FL + 1, z, "iron_bars");
  }
  // the freight beam + chain, still rigged; a glint far below
  b.fill(SH.x0 - 1, FL + 4, 15, SH.x1 + 1, FL + 4, 15, "log");
  for (let y = FL + 3; y > pit + 2; y--) w.setIfAir(105, y, 15, id("chain"));
  w.setIfAir(106, pit + 1, 16, id("blue_crystal"));
  // the Warden's post: tally-desk, braziers, and the Court gate behind him
  b.set(110, FL, 30, "planks");
  b.set(111, FL, 30, "planks");
  b.set(110, FL + 1, 30, "bookshelf"); // the intake ledger
  for (const [bx, bz] of [
    [108, 27],
    [118, 27],
  ] as const) {
    b.set(bx, FL, bz, "dark_bricks");
    b.set(bx, FL + 1, bz, "brazier");
  }
  // the Warden's strongshelf: the sorted best of the tribute (cache 1)
  b.fill(117, FL, 11, 119, FL + 2, 11, "bookshelf");
  b.set(118, FL, 13, "bone_block");
  features.caches.push({ x: 118.5, y: FL, z: 14.5, table: "cache_ossuary_galleries", respawnSec: 900 });

  // --- the dead-cart lane: collapsed mid-way; its spur hides the chapel ---
  const L = OSS_LANE;
  b.clearAbove(L.x - 1, L.z0 - 3, L.x + 4, L.z1 + 1, G, 10);
  b.flatten(L.x, L.z0, L.x + 4, L.z1, G, "path");
  b.flatten(78, 104, L.x + 4, 106, G, "path"); // the connector off the court
  // the collapse: the whole east flank is buried north of the chapel — the
  // roof came down from the hall's east wall to the perimeter, so the only
  // way north is THROUGH the galleries (the route stays an S); the chapel
  // survived on the south side, which is why nobody sorted it
  for (let x = 91; x <= X1 - 1; x++) {
    b.fill(x, FL, 76, x, FL + 1 + (hash2(seed ^ 0x055a, x, 0) < 0.5 ? 1 : 0), 77, "rubble");
  }
  w.setIfAir(L.x + 1, FL, 80, id("rubble"));
  w.setIfAir(L.x + 3, FL, 92, id("moss_carpet"));

  // --- the mourner's chapel: unsorted, unswept, one candle (☆ hidden) ---
  const CH = OSS_CHAPEL;
  gallery(CH.x0, CH.z0, CH.x1, CH.z1, "stone", 0x055b);
  // the crack: a 1-wide slip in the west wall, screened by rubble
  b.fill(CH.x0, FL, 86, CH.x0, FL + 3, 87, 0);
  w.setIfAir(CH.x0 - 1, FL, 85, id("rubble"));
  w.setIfAir(CH.x0 - 1, FL, 88, id("rubble"));
  // benches, knelt out of true
  for (const bz of [83, 91]) {
    for (let x = 104; x <= 111; x++) {
      if (hash2(seed ^ 0x055c, x, bz) < 0.7) b.set(x, FL, bz, "planks");
    }
  }
  // the altar, and the one candle in the galleries that mourns
  b.fill(114, FL, 86, 115, FL, 88, "marble");
  b.set(114, FL + 1, 87, "bog_candle");
  // grief the Court can't process: moss, webs, roots through the ceiling line
  for (let z = CH.z0 + 1; z <= CH.z1 - 1; z++) {
    for (let x = CH.x0 + 1; x <= CH.x1 - 1; x++) {
      const r = hash2(seed ^ 0x055d, x, z);
      if (r < 0.1) w.setIfAir(x, G, z, id("moss_carpet"));
      else if (r > 0.985) w.setIfAir(x, FL + 2, z, id("web"));
    }
  }
  w.setIfAir(103, FL + 3, 80, id("hanging_moss"));
  w.setIfAir(112, FL + 3, 94, id("hanging_moss"));
  // the offering nobody collects (cache 2, behind the altar)
  features.caches.push({ x: 116.5, y: FL, z: 87.5, table: "cache_ossuary_galleries", respawnSec: 600 });

  // stray glow deep in the galleries: the shaft draws the eye north
  b.world.setIfAir(98, FL, 40, id("blue_crystal"));
  b.world.setIfAir(120, FL, 33, id("blue_crystal"));
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

  // ---- the FAR GATE (batch 7): the one-way escape arch east of the dais.
  // Torn, visibly unstable, and ROPED OFF by no one alive — the rope tableau
  // stays unexplained (mysteries register). The portal arch itself stamps
  // after the builders (portal depths-escape at 66,12); this is the wreckage
  // it stands in: leaning cracked masonry, a dropped lintel, and the chain
  // line strung across the approach.
  b.clearAbove(61, 7, 71, 17, G);
  for (let z = 8; z <= 16; z++) {
    for (let x = 62; x <= 70; x++) {
      const r = hash2(seed ^ 0xfa47, x, z);
      b.set(x, G, z, r < 0.4 ? "dark_bricks" : r < 0.55 ? "cracked_bricks" : "snow");
    }
  }
  // the torn frame it used to hang in — one jamb standing, one down.
  // Everything here sits OUTSIDE the portal arch's own 7×7 clear rect
  // (63..69 × 9..15 around 66,12) — the arch stamps after the builders and
  // sweeps that box clean.
  for (let y = FL; y <= FL + 4; y++) b.set(61, y, 12, hash2(seed ^ 0xfa48, 61, y) < 0.5 ? "cracked_bricks" : "dark_bricks");
  b.set(61, FL + 5, 12, "cracked_bricks"); // the sheared spring of the arch
  b.fill(70, FL, 10, 71, FL, 13, "cracked_bricks"); // the fallen jamb, flat in the snow
  b.set(71, FL + 1, 11, "rubble");
  // the rope line: posts + chain, hung across the approach by NOBODY
  for (const px of [62, 70] as const) {
    b.set(px, FL, 16, "dark_bricks");
  }
  for (let x = 63; x <= 69; x += 2) {
    b.set(x, FL, 16, "chain");
  }
  b.world.setIfAir(61, FL, 9, id("blue_crystal")); // the tear leaks the vault's light
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

  // ---- the KEEP: the COURT GATE (world-redesign batch 6) ----
  // The throne room moved out to the Broken Court (its own room); the keep
  // interior is now the castle gatehouse Ser Osmund holds — inner gate wall
  // with a murder-hole passage, a portcullis FORCED open at the center, and
  // the court portal standing where the dais was, under a war-torn roof
  // breach (paired arrivals ground-snap; a roofed portal chamber would put
  // them on the cap).
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
  // (the 4th breach hangs over the court gate — the wound the First Tyrant
  // left when it tore the way to the court open; arrivals land under it)
  for (const [hx, hz, hr] of [
    [112, 50, 2.6],
    [144, 62, 3.1],
    [128, 47, 2.2],
    [128, 43, 3.4],
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
  // the royal carpet: door → the court gate (the processional's last stretch)
  for (let z = 45; z <= KEEP.z1 - 1; z++) {
    for (let x = 127; x <= 129; x++) b.set(x, PG, z, "red_carpet");
  }
  // ---- the inner gate: a full-height marble crosswall with a murder-hole
  // passage, its portcullis FORCED open at the center — the door Ser Osmund
  // keeps. North of it, the gate chamber: the court portal stands where the
  // dais stood, under the torn roof.
  b.fill(KEEP.x0 + 1, PFL, 52, KEEP.x1 - 1, PFL + 11, 55, "marble");
  // the gate passage through it, on the avenue axis
  b.fill(126, PFL, 52, 130, PFL + 3, 55, 0);
  // murder holes over the passage (dark shafts in the passage ceiling)
  b.fill(127, PFL + 4, 53, 127, PFL + 6, 53, 0);
  b.fill(129, PFL + 4, 55, 129, PFL + 6, 55, 0);
  // the portcullis at the passage's north mouth: outer columns hang their
  // full drop, the center bars bent open (the way the Tyrant left it)
  for (let x = 126; x <= 130; x++) {
    const open = x >= 127 && x <= 129;
    for (let y = PFL; y <= PFL + 3; y++) {
      if (open && y <= PFL + 2) continue;
      b.set(x, y, 52, "iron_bars");
    }
  }
  // gate-chamber dressing: braziers still lit either side of Osmund's post,
  // lanterns + the king's banners flanking the way down to the court
  for (const bx of [122, 134] as const) {
    b.set(bx, PFL, 46, "dark_bricks");
    b.set(bx, PFL + 1, 46, "ember_crystal");
  }
  for (const lx of [120, 136] as const) b.set(lx, PFL + 3, 44, "lantern");
  for (const bx of [122, 134] as const) b.set(bx, PFL + 4, 38, "banner");
  // two more brazier pairs light the nave's length (south of the gate wall)
  for (const [bx, bz] of [
    [120, 60],
    [136, 60],
    [120, 68],
    [136, 68],
  ] as const) {
    b.set(bx, PFL, bz, "dark_bricks");
    b.set(bx, PFL + 1, bz, "ember_crystal");
  }

  // ---- the BREACH GLIMPSE (story bible W6 landmark 5): the mountain the
  // First Tyrant came down, rising behind the castle — a dark ridge over the
  // north wall with a torn V-notch on the avenue axis, dusted white and
  // glinting cold (the way to the Waste, advertised two rooms early; the
  // notch itself is unreachable dressing behind the curtain wall)
  for (let z = 0; z <= 23; z++) {
    for (let x = 88; x <= 168; x++) {
      const ridge = 26 + (23 - z) * 0.78 + hash2(seed ^ 0xb7ea, x, z) * 4 - Math.abs(x - 128) * 0.08;
      const notch = Math.abs(x - 128) <= 4 ? 11 - Math.abs(x - 128) * 1.5 : 0;
      const top = Math.min(44, Math.max(FL + 1, Math.round(ridge - notch)));
      b.fill(x, FL, z, x, top, z, "dark_stone");
      // the notch wears the Waste's colors
      if (notch > 0 && z <= 14) {
        b.set(x, top, z, hash2(seed ^ 0xb7eb, x, z) < 0.3 ? "ice" : "snow");
      }
    }
  }
  b.world.setIfAir(127, 34, 8, id("blue_crystal"));
  b.world.setIfAir(130, 37, 5, id("blue_crystal"));

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
  // avenue lantern posts: the city's last lights, half of them dead. The
  // dead posts wear the tribute-refusal proclamations, still nailed up and
  // weathered to lace (story bible W6 landmark 2 — the NO that started it)
  for (let z = 104; z <= 204; z += 10) {
    for (const lx of [123, 133] as const) {
      b.fill(lx, FL, z, lx, FL + 1, z, "dark_bricks");
      if (hash2(seed ^ 0xaa0e, lx, z) < 0.55) b.set(lx, FL + 2, z, "lantern");
      else if (hash2(seed ^ 0xaa0f, lx, z) < 0.5) b.set(lx, FL + 2, z, "banner");
    }
  }

  // ---- arrival ground outside the gate ----
  street(120, CITY.z1 + 5, 136, 232);
  rubbleMound(118, 224, 2, FL);
  snag(140, 228);
  // Maera's camp (story bible W6 landmark 4): the Chronicler's lean-to at
  // the approach — the only living fire in the city
  b.fill(137, FL, 218, 137, FL + 1, 218, "charred_log");
  b.fill(137, FL, 222, 137, FL + 1, 222, "charred_log");
  b.fill(135, FL + 2, 218, 137, FL + 2, 222, "planks");
  b.set(136, FL, 219, "hay");
  b.paintCircle(133, 222, 1.2, "ash");
  b.set(133, FL, 222, "charred_log");
  b.torch(133, FL + 1, 222);

  // ---- the collapsed postern (batch 7): where the Pale Court's escape gate
  // surfaces. A broken undercroft mouth in the graveyard quarter — a stair
  // up out of the city's own crypts, collapsed a few steps down, cold blue
  // light bleeding through the rubble. One-way arrivals from crypt_depths
  // land beside it at (210.5, 110.5); the mouth is the thing they came out of.
  b.clearAbove(203, 103, 213, 113, G);
  for (let z = 104; z <= 112; z++) {
    for (let x = 204; x <= 212; x++) {
      const r = hash2(seed ^ 0xe5c1, x, z);
      b.set(x, G, z, r < 0.35 ? "path" : r < 0.5 ? "mossy_cobblestone" : "stone_bricks");
    }
  }
  // the stair: descending northward into the ground, then CHOKED
  b.set(207, G, 109, 0);
  b.set(208, G, 109, 0);
  b.set(209, G, 109, 0);
  for (const sx of [207, 208, 209] as const) {
    b.set(sx, G - 1, 109, "dark_bricks"); // first step down
    b.set(sx, G, 108, 0);
    b.set(sx, G - 1, 108, 0);
    b.set(sx, G - 2, 108, "dark_bricks"); // second step
    b.set(sx, G, 107, 0);
    b.set(sx, G - 1, 107, 0);
    b.set(sx, G - 2, 107, "rubble"); // and the collapse — no way back down
    b.set(sx, G - 1, 106, "rubble");
    b.set(sx, G, 106, "rubble");
  }
  b.set(208, G - 1, 107, "blue_crystal"); // the Court's cold light, under the fall
  // the arch that used to frame it, torn and leaning
  for (const [ax, h] of [
    [206, 3],
    [210, 2],
  ] as const) {
    for (let y = FL; y <= FL + h; y++) {
      b.set(ax, y, 109, hash2(seed ^ 0xe5c2, ax, y) < 0.5 ? "cracked_bricks" : "dark_bricks");
    }
  }
  b.set(206, FL + 3, 110, "chain"); // what the arch dropped
  b.set(207, FL, 110, "rubble");
  b.set(211, FL, 108, "rubble");
  b.set(205, FL, 106, "skull_pile"); // the crypt gave some of itself back up
}

// ---------------------------------------------------------------------------
// THE BROKEN COURT (W7, world-redesign batch 6) — the throne room, and what
// sits on it. Valdrenn's throne complex split out of the city into its own
// 96² cycling finale stage: the proposal is explicit that this room IS the
// fight (straight-to-boss, an authored arena exception). The court is exactly
// as day ten left it — braziers lit, banners hung, the state dinner still on
// the table — nested into a notch of the mountain the First Tyrant came down.
// North (low z) = throne + THE BREACH (dressing only; its White Waste portal
// ships in batch 8); south = the forecourt with the return portal (open sky,
// so paired arrivals ground-snap to the floor, never a roof).
// ---------------------------------------------------------------------------
const COURT_HALL = { x0: 26, z0: 14, x1: 70, z1: 58 }; // marble hall shell
const COURT_THRONE = { x: 48, z: 19 }; // the Sundered King's seat
const COURT_BREACH = { x0: 30, x1: 40 }; // torn north-wall span → the mountain

function buildBrokenCourt(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const G = b.g(def.spawn.x, def.spawn.z); // 12 — flat everywhere (amplitude 0)
  const FL = G + 1;
  const H = COURT_HALL;

  // aged exterior masonry (the forecourt weathered; the hall itself stays
  // pristine marble — the First Tyrant tidied the room around its lesson)
  const aged = (x: number, y: number, z: number): void => {
    const r = hash2(seed ^ 0xc0a7, x * 7 + y * 131, z * 13 + y);
    b.set(x, y, z, r < 0.25 ? "cracked_bricks" : r < 0.34 ? "mossy_cobblestone" : "stone_bricks");
  };

  // ---- the MOUNTAIN: a dark massif walling the room's north, with
  // shoulders hugging the hall's flanks — the notch the court is built into
  for (let z = 0; z <= 13; z++) {
    for (let x = 0; x < def.size.w; x++) {
      const top = Math.min(44, Math.round(28 + (13 - z) * 1.1 + hash2(seed ^ 0x3a5f, x, z) * 4));
      b.fill(x, FL, z, x, top, z, "dark_stone");
    }
  }
  for (const side of [
    { x0: 0, x1: H.x0 - 1 },
    { x0: H.x1 + 1, x1: def.size.w - 1 },
  ]) {
    for (let z = 14; z <= 34; z++) {
      for (let x = side.x0; x <= side.x1; x++) {
        const taper = (34 - z) / 20; // 1 at z14 → 0 at z34
        const top = Math.round(FL + taper * (14 + hash2(seed ^ 0x3a60, x, z) * 4));
        if (top <= FL) continue;
        b.fill(x, FL, z, x, top, z, "dark_stone");
      }
    }
  }

  // ---- the HALL: marble shell, roofed, war-torn in exactly three places
  b.clearAbove(H.x0 - 1, H.z0 - 1, H.x1 + 1, H.z1 + 1, G, 20);
  for (let z = H.z0; z <= H.z1; z++) {
    for (let x = H.x0; x <= H.x1; x++) {
      b.set(x, G, z, "marble"); // floor
      const edge = x === H.x0 || x === H.x1 || z === H.z0 || z === H.z1;
      if (!edge) {
        b.fill(x, FL, z, x, FL + 11, z, 0);
        continue;
      }
      for (let y = FL; y <= FL + 11; y++) b.set(x, y, z, "marble");
    }
  }
  // roof + two sunset shafts (the dais keeps its cover — the window's glow
  // is the only warm light on the throne)
  b.fill(H.x0, FL + 12, H.z0, H.x1, FL + 12, H.z1, "stone_bricks");
  for (const [hx, hz, hr] of [
    [40, 36, 2.6],
    [58, 46, 2.9],
  ] as const) {
    for (let z = Math.floor(hz - hr - 1); z <= Math.ceil(hz + hr + 1); z++) {
      for (let x = Math.floor(hx - hr - 1); x <= Math.ceil(hx + hr + 1); x++) {
        const d = Math.hypot(x - hx, z - hz);
        if (d <= hr + (hash2(seed ^ 0xce21, x, z) - 0.5) * 1.2) b.set(x, FL + 12, z, 0);
        else if (d <= hr + 1.4 && hash2(seed ^ 0xce22, x, z) < 0.3) b.set(x, FL + 12, z, "cracked_bricks");
      }
    }
  }
  // corner towers
  for (const [tx, tz] of [
    [H.x0, H.z0],
    [H.x1, H.z0],
    [H.x0, H.z1],
    [H.x1, H.z1],
  ] as const) {
    b.fill(tx - 2, FL, tz - 2, tx + 2, FL + 14, tz + 2, "marble");
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++)
        if ((Math.abs(dx) === 2 || Math.abs(dz) === 2) && (dx + dz) % 2 === 0)
          b.set(tx + dx, FL + 15, tz + dz, "marble");
  }
  // grand doors: 3 wide × 4 tall, south wall, on the processional axis
  b.fill(47, FL, H.z1, 49, FL + 3, H.z1, 0);
  b.torch(46, FL + 4, H.z1 + 1);
  b.torch(50, FL + 4, H.z1 + 1);
  // rose window (north wall, behind the throne): the kingdom's last light
  for (let y = FL + 2; y <= FL + 10; y++) {
    for (let x = 41; x <= 55; x++) {
      if (Math.abs(x - 48) + Math.abs(y - (FL + 6)) <= 4) b.set(x, y, H.z0, "stained_glass");
    }
  }
  // lancet windows along both hall walls
  for (const z of [26, 36, 46] as const) {
    for (const wx of [H.x0, H.x1] as const) {
      b.fill(wx, FL + 3, z, wx, FL + 4, z + 1, "stained_glass");
    }
  }
  // colonnade: lantern + banner on every column (the lamplighters' last round)
  for (const cx of [36, 60] as const) {
    for (const cz of [20, 26, 32, 38, 44] as const) {
      b.fill(cx, FL, cz, cx, FL + 11, cz, "marble");
      const aisle = cx === 36 ? cx + 1 : cx - 1;
      b.set(aisle, FL + 3, cz, "lantern");
      b.set(aisle, FL + 5, cz, "banner");
    }
  }
  // wall sconces
  for (const sz of [22, 32, 42, 52] as const) {
    b.torch(H.x0 + 1, FL + 3, sz);
    b.torch(H.x1 - 1, FL + 3, sz);
  }
  // the royal carpet: door → dais
  for (let z = 20; z <= H.z1 - 1; z++) {
    for (let x = 47; x <= 49; x++) b.set(x, G, z, "red_carpet");
  }

  // ---- the throne: dais, gold, braziers — moved here block-for-block in
  // spirit from the city keep (the lesson, restaged at room scale)
  b.fill(40, FL, 16, 56, FL, 22, "marble");
  b.fill(43, FL + 1, 17, 53, FL + 1, 21, "marble");
  b.fill(45, FL + 2, 18, 51, FL + 2, 20, "marble");
  for (const [cy, cz] of [
    [FL, 22],
    [FL + 1, 21],
    [FL + 2, 20],
  ] as const) {
    for (let x = 47; x <= 49; x++) b.set(x, cy, cz, "red_carpet");
  }
  b.set(COURT_THRONE.x, FL + 3, COURT_THRONE.z, "gold_block"); // seat
  b.fill(COURT_THRONE.x, FL + 3, COURT_THRONE.z - 1, COURT_THRONE.x, FL + 6, COURT_THRONE.z - 1, "gold_block"); // back
  b.set(COURT_THRONE.x - 1, FL + 3, COURT_THRONE.z, "gold_block"); // arms
  b.set(COURT_THRONE.x + 1, FL + 3, COURT_THRONE.z, "gold_block");
  for (const bx of [44, 52] as const) {
    b.set(bx, FL + 2, 19, "dark_bricks");
    b.set(bx, FL + 3, 19, "ember_crystal");
  }
  for (const bx of [42, 54] as const) {
    b.set(bx, FL, 23, "dark_bricks");
    b.set(bx, FL + 1, 23, "ember_crystal");
  }
  // two more brazier pairs light the nave's length
  for (const [bx, bz] of [
    [40, 30],
    [56, 30],
    [40, 40],
    [56, 40],
  ] as const) {
    b.set(bx, FL, bz, "dark_bricks");
    b.set(bx, FL + 1, bz, "ember_crystal");
  }

  // ---- THE SET TABLE (story bible W7 landmark 1): a state dinner forty
  // years stale, untouched — two long boards flanking the carpet, candles
  // still burning. The First Tyrant's contempt, staged in blocks.
  for (const tx of [42, 54] as const) {
    b.fill(tx - 1, FL, 34, tx + 1, FL, 46, "marble");
    for (const cz of [36, 44] as const) b.set(tx, FL + 1, cz, "gold_block");
    b.set(tx, FL + 1, 40, "lantern");
  }
  for (const bx of [45, 51] as const) {
    for (const bz of [34, 37, 40, 43, 46] as const) b.set(bx, FL, bz, "planks");
  }

  // ---- the wings: treasury (SW) and the Oathbound barracks (SE), the last
  // muster's quarters — partitioned off the hall's south corners
  for (const wing of [
    { x0: H.x0 + 1, x1: 38, wall: 38, door: true },
    { x0: 58, x1: H.x1 - 1, wall: 58, door: true },
  ]) {
    for (let z = 47; z <= H.z1 - 1; z++) {
      for (let y = FL; y <= FL + 5; y++) {
        if (z === 51 || z === 52) continue; // forced doorway
        b.set(wing.wall, y, z, "marble");
      }
    }
    for (let x = wing.x0; x <= wing.x1; x++) {
      for (let y = FL; y <= FL + 5; y++) b.set(x, y, 46, "marble");
    }
  }
  // treasury: what the tribute never bought back
  for (const [gx, gz, h] of [
    [30, 50, 2],
    [31, 50, 1],
    [30, 51, 1],
    [34, 53, 1],
    [29, 56, 1],
    [33, 49, 1],
  ] as const) {
    for (let y = 0; y < h; y++) b.set(gx, FL + y, gz, "gold_block");
  }
  b.set(36, FL, 55, "rubble");
  b.set(30, FL + 3, 53, "lantern");
  features.caches.push({ x: 32.5, y: FL, z: 52.5, table: "cache_royal", respawnSec: 900 });
  // barracks: cots made, racks racked — nobody was ever dismissed
  for (const [px, pz] of [
    [61, 49],
    [64, 49],
    [67, 49],
  ] as const) {
    b.fill(px, FL, pz, px + 1, FL, pz, "planks");
  }
  b.set(68, FL, 55, "iron_bars");
  b.set(68, FL, 54, "iron_bars");
  b.set(60, FL, 55, "hay");
  b.set(63, FL + 3, 52, "lantern");

  // ---- THE BREACH (story bible W7 landmark 3): raw mountain rock torn open
  // bordering the throne wall. The First Tyrant left the way it came, and
  // left it open. Batch 8 OPENED it: the old dead-end collapse is gone — the
  // climb now ends in a torn-open chamber under a ragged sky shaft (the
  // "mountain is OPEN" made literal, and the open sky is the greenhood rule:
  // the portal's standY must be the chamber floor, not the massif top). The
  // `court-waste` portal in it boots SEALED and opens on the King's death.
  for (let x = COURT_BREACH.x0; x <= COURT_BREACH.x1; x++) {
    const ragged = Math.floor(hash2(seed ^ 0xb43c, x, 7) * 3);
    b.fill(x, FL, H.z0, x, FL + 8 - ragged, H.z0, 0);
  }
  // the climb gains 3 over the tunnel so the chamber floor sits >2 above the
  // natural slab — that puts the portal arch on its AUTHORED-site path
  // (groundAt), where the legacy path would raze the chamber floor
  const tunnelFloor = (z: number): number => FL + Math.floor((13 - z) / 2);
  for (let z = 13; z >= 8; z--) {
    const half = z >= 10 ? 3 : 2;
    const fy = tunnelFloor(z);
    for (let x = 35 - half; x <= 35 + half; x++) {
      b.fill(x, fy, z, x, fy + 3, z, 0);
      const r = hash2(seed ^ 0xb43d, x, z);
      b.set(x, fy - 1, z, r < 0.4 ? "rubble" : "ash");
    }
  }
  // the torn chamber: z1-7 at the climb's top step (feet FL+3 = 16
  // everywhere — the arch apron repaints the same level, so the z8→z7 step
  // stays legal), carved open to the SKY; ragged rim bites keep the tear
  // readable from inside the hall
  const CH = FL + 3; // chamber feet level
  for (let z = 1; z <= 7; z++) {
    for (let x = 31; x <= 39; x++) {
      const rim = x === 31 || x === 39 || z === 1 || z === 7;
      const bite = rim ? 6 + Math.floor(hash2(seed ^ 0xb43e, x, z) * 10) : WORLD_HEIGHT - 1 - CH;
      b.fill(x, CH, z, x, Math.min(WORLD_HEIGHT - 1, CH + bite), z, 0);
      const r = hash2(seed ^ 0xb43d, x, z);
      b.set(x, CH - 1, z, r < 0.2 ? "ice" : r < 0.65 ? "snow" : "ash");
    }
  }
  // what the tearing left: rubble at the chamber's flanks, cold light
  b.set(32, CH, 2, "rubble");
  b.set(38, CH, 3, "rubble");
  b.set(32, CH, 6, "rubble");
  b.world.setIfAir(38, CH, 6, id("blue_crystal"));
  b.world.setIfAir(32, CH + 1, 2, id("blue_crystal"));

  // ---- the FORECOURT: the outer court the processional crosses — weathered
  // where the hall is pristine (the Tyrant tidied the lesson, not the yard)
  for (let z = H.z1 + 1; z <= 90; z++) {
    for (let x = 30; x <= 66; x++) {
      const r = hash2(seed ^ 0xf0c7, x, z);
      b.set(x, G, z, r < 0.08 ? "rubble" : r < 0.2 ? "path" : r < 0.3 ? "mossy_cobblestone" : "cobblestone");
    }
  }
  // marble banner posts pace the approach; one pair still carries lanterns
  for (const pz of [64, 72, 80] as const) {
    for (const px of [44, 52] as const) {
      b.fill(px, FL, pz, px, FL + 1, pz, "marble");
      b.set(px, FL + 2, pz, pz === 72 ? "lantern" : "banner");
    }
  }
  // the ruined outer curtain, broken at the portal's back
  for (let x = 30; x <= 66; x++) {
    if (x >= 44 && x <= 52) continue;
    const bite = Math.floor(hash2(seed ^ 0xf0c8, x, 92) * 3);
    for (let y = FL; y <= FL + 2 - bite; y++) aged(x, y, 92);
  }
  // war scars on the yard's fringes
  rubbleMoundAt(b, seed, 36, 64, 2, FL);
  rubbleMoundAt(b, seed, 60, 76, 2, FL);
  for (const [sx, sz] of [
    [24, 68],
    [72, 60],
    [70, 86],
    [26, 88],
  ] as const) {
    b.paintCircle(sx, sz, 1.8, "ash");
    b.fill(sx, FL, sz, sx, FL + 1 + Math.floor(hash2(seed ^ 0xf0c9, sx, sz) * 2), sz, "charred_log");
  }
  // sparse ash + rubble over the open ground outside the yard
  for (let i = 0; i < 40; i++) {
    const rx = 4 + Math.floor(hash2(seed ^ 0xf0ca, i, 1) * 88);
    const rz = 36 + Math.floor(hash2(seed ^ 0xf0ca, i, 2) * 56);
    if (rx >= 30 && rx <= 66 && rz <= 92) continue; // keep the yard itself
    if (!b.world.solidAt(rx, G, rz)) continue;
    b.world.setIfAir(rx, FL, rz, id(hash2(seed ^ 0xf0cb, rx, rz) < 0.6 ? "rubble" : "ash"));
  }
}

/** rubbleMound, shared shape (the city builder keeps its own local copy). */
function rubbleMoundAt(b: Builder, seed: number, cx: number, cz: number, r: number, baseY: number): void {
  for (let z = cz - r; z <= cz + r; z++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > r + 0.4) continue;
      const h = Math.max(0, Math.round((1 - d / (r + 1)) * 2 + hash2(seed ^ 0x9b1e, x, z) * 0.9));
      for (let y = 0; y < h; y++) b.set(x, baseY + y, z, "rubble");
    }
  }
}

// ---------------------------------------------------------------------------
// THE WHITE WASTE (W8, world-redesign batch 8; story bible §6 W8) — the
// frozen high waste above Valdrenn, where the tribute goes; the debut of the
// snow/ice blocks and the game's finale. A 160² PRESET glacial trough valley
// running south (the breach shelf you climb out onto) → north (the far door
// that never opens). Everything placed has a reason:
//   · the ARRIVAL SHELF — a raised snow terrace under the south rim, the
//     first sight of the whole valley (the one-way landing from the Broken
//     Court's torn breach);
//   · the TRIBUTE-ROAD — the world's tithe-roads converge here, so the road
//     is PAVED (stone bricks, wind-scoured, snow-drifted) and it BENDS (the
//     no-straight-lines rule) past frozen tribute stations from every region:
//     fen crates, forge cargo, desert wares, bone paddocks, wagon wrecks —
//     the world economy drawn as one tableau;
//   · the RIME WARDENS' GATE — a full-height ice wall pinches the valley
//     shut; the ONLY way north is the wardens' walled arena, its two doors
//     offset so every crossing walks the guardians' floor (spatial gating —
//     no portal, no second way);
//   · the UNPAID PILE — one heap set apart, snowed under, Valdrenn's banners
//     on it: the tribute that was never sent (the Nine-Day War's cause,
//     present at the finale, no dialog);
//   · the TRIBUTE-COURT — a colossal ice amphitheater sunk into the valley
//     floor, terraced benches, a broken blue-lit colonnade, sorted payment
//     heaped in sectors around the floor, and the dais where THE FIRST
//     TYRANT holds court; cache_royal alcoves in the wings (the tribute IS
//     royal goods);
//   · the FAR DOOR — behind the dais the pass visibly continues north into a
//     cleft, climbs, and ends at a sheer ancient-ice slab lit faintly blue.
//     Shown, never opened (mysteries register §10.5).
// DETERMINISM: layout constants fixed; every ragged edge is hash2(seed^salt).
// ---------------------------------------------------------------------------
const WASTE = {
  shelf: { x0: 62, x1: 98, z0: 138, z1: 152, rise: 4 }, // arrival terrace
  ramp: { x0: 74, x1: 86, z0: 130, z1: 138 }, // shelf → valley floor
  gateZ: { z0: 84, z1: 90 }, // the wardens' wall band
  arena: { cx: 80, cz: 87, rx: 12, rz: 8 }, // the wardens' court
  court: { cx: 80, cz: 46, r: 24 }, // the tribute-court amphitheater
  dais: { x: 80, z: 30 }, // the First Tyrant's seat
  cleft: { x0: 76, x1: 84, z0: 8, z1: 24 }, // the far door's pass
  valley: { x0: 28, x1: 132 }, // rim feet east/west
};

/** The bending tribute-road, arrival ramp → wardens' south door → (arena) →
 *  north door → the court's processional gap. */
const WASTE_ROAD: Array<[number, number]> = [
  [80, 132],
  [70, 126],
  [64, 120],
  [58, 108],
  [66, 100],
  [74, 97],
  // (the arena crossing happens between these two)
  [86, 79],
  [82, 72],
  [80, 66],
];

function buildWhiteWaste(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const W = def.size.w;
  const H = def.size.h;
  const G = b.g(80, 80); // 10 — flat everywhere (amplitude 0)
  const FL = G + 1;
  const SNOW = id("snow");
  const ICE = id("ice");
  const DARK = id("dark_stone");
  const STONE = id("stone");

  // ---- the VALLEY SHELL: rims on every side; the court/cleft/shelf zones
  // carve their own shapes afterwards. Column-by-column target heights.
  const rimTop = (x: number, z: number, d: number): number => {
    // d = how deep into the rim band this column sits (0 at the valley edge)
    const t = Math.min(1, d / 14);
    return Math.round(G + 4 + t * 18 + hash2(seed ^ 0x77a1, x, z) * 4);
  };
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      let d = 0;
      if (x < WASTE.valley.x0) d = Math.max(d, WASTE.valley.x0 - x);
      if (x > WASTE.valley.x1) d = Math.max(d, x - WASTE.valley.x1);
      if (z > 152) d = Math.max(d, z - 152); // south rim (behind the shelf)
      if (z < 22) d = Math.max(d, 22 - z); // north rim (the far door's wall)
      if (d === 0) continue;
      // the cleft cuts the north rim; the shelf cuts the south rim
      if (z < 26 && x >= WASTE.cleft.x0 && x <= WASTE.cleft.x1) continue;
      if (z > 137 && z <= 152 && x >= WASTE.shelf.x0 && x <= WASTE.shelf.x1) continue;
      // behind the shelf the rim climbs from SHELF height, not valley height —
      // the breach mouth bores into this face
      const shelfBack = z > 152 && x >= WASTE.shelf.x0 && x <= WASTE.shelf.x1;
      const top = shelfBack
        ? Math.round(G + WASTE.shelf.rise + 2 + Math.min(1, (z - 152) / 6) * 14 + hash2(seed ^ 0x77a1, x, z) * 3)
        : rimTop(x, z, d);
      b.fill(x, FL, z, x, top, z, hash2(seed ^ 0x77a2, x, z) < 0.35 ? ICE : DARK);
      b.set(x, top + 1, z, SNOW);
    }
  }

  // ---- SNOW over everything at valley grade (the biome slab is dirt/stone;
  // the waste is white). Wind-scour: hash streaks of bare rock where the
  // wind stripped it; sparse drifts and boulders.
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (!b.world.solidAt(x, G, z) || b.world.solidAt(x, G + 1, z)) continue;
      const scour = hash2(seed ^ 0x77a3, Math.floor(x / 5), Math.floor(z / 3));
      if (scour < 0.07) b.set(x, G, z, hash2(seed ^ 0x77a4, x, z) < 0.5 ? STONE : DARK);
      else b.set(x, G, z, SNOW);
      const r = hash2(seed ^ 0x77a5, x, z);
      if (r < 0.012) b.set(x, FL, z, SNOW); // drift
      else if (r < 0.017) b.fill(x, FL, z, x, FL + (r < 0.014 ? 1 : 0), z, DARK); // boulder
    }
  }

  // ---- the ARRIVAL SHELF + RAMP + BREACH MOUTH (first sight of the waste).
  // Rock-bodied fills, never flatten() — the emberfells lesson: flatten's
  // dirt underlayer reads as a brown retaining wall on camera.
  const SH = G + WASTE.shelf.rise; // shelf surface y (feet 15)
  const raiseTo = (x: number, z: number, ty: number): void => {
    b.clearAbove(x, z, x, z, ty);
    if (ty > G) b.fill(x, FL, z, x, ty - 1, z, DARK);
    b.set(x, ty, z, SNOW);
  };
  for (let z = WASTE.shelf.z0; z <= WASTE.shelf.z1; z++) {
    for (let x = WASTE.shelf.x0; x <= WASTE.shelf.x1; x++) raiseTo(x, z, SH);
  }
  for (let z = WASTE.ramp.z0; z < WASTE.ramp.z1; z++) {
    const ty = Math.min(SH, G + Math.max(0, Math.floor((z - WASTE.ramp.z0) / 2) + 1));
    for (let x = WASTE.ramp.x0; x <= WASTE.ramp.x1; x++) raiseTo(x, z, ty);
  }
  // the mouth you climbed out of: a dark bore into the south rim, dead air
  // and rubble two steps in (the tunnel through the mountain, abstracted)
  for (let z = 153; z <= 157; z++) {
    for (let x = 77; x <= 83; x++) {
      b.fill(x, SH + 1, z, x, SH + 3, z, 0);
      b.set(x, SH, z, hash2(seed ^ 0x77a6, x, z) < 0.4 ? id("ash") : id("rubble"));
    }
  }
  for (let x = 78; x <= 82; x++) b.fill(x, SH + 1, 157, x, SH + 3, 157, "rubble");
  b.world.setIfAir(78, SH + 1, 155, id("blue_crystal"));
  // shelf-edge cairns flanking the ramp head — the tribute-road's first marker
  for (const cx of [72, 88] as const) {
    b.fill(cx, SH + 1, 139, cx, SH + 2, 139, DARK);
    b.set(cx, SH + 3, 139, "banner");
  }

  // ---- the TRIBUTE-ROAD: paved, wind-scoured, drifted — laid as 3-wide
  // stamps along the waypoint polyline (skips the arena band; the crossing
  // IS the wardens' floor)
  const paveAt = (x: number, z: number): void => {
    if (z >= WASTE.gateZ.z0 - 1 && z <= WASTE.gateZ.z1 + 1) return; // the gate band paves itself
    const g = b.groundAt(x, z);
    if (g > G + 1) return; // never pave up a rim/terrace
    const r = hash2(seed ^ 0x77a7, x, z);
    b.set(x, g, z, r < 0.14 ? "snow" : r < 0.3 ? "cracked_bricks" : "stone_bricks");
  };
  for (let i = 0; i < WASTE_ROAD.length - 1; i++) {
    const [x0, z0] = WASTE_ROAD[i]!;
    const [x1, z1] = WASTE_ROAD[i + 1]!;
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
    for (let s = 0; s <= steps; s++) {
      const cx = Math.round(x0 + ((x1 - x0) * s) / steps);
      const cz = Math.round(z0 + ((z1 - z0) * s) / steps);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) paveAt(cx + dx, cz + dz);
    }
  }
  // dead lantern posts pace the road — the lamplighters never came this far
  // north; exactly one still burns (the fen's light-language, one last time)
  for (const [px, pz, lit] of [
    [66, 126, false],
    [56, 112, false],
    [62, 101, true],
    [84, 75, false],
  ] as const) {
    b.fill(px, FL, pz, px, FL + 2, pz, DARK);
    b.set(px, FL + 3, pz, lit ? "lantern" : "chain");
  }

  // ---- FROZEN TRIBUTE STATIONS (the manifest of the world, by region)
  // fen goods: rotting crates, hay, reeds — Ysmere's tithe
  for (const [cx, cz, h] of [
    [66, 124, 2],
    [68, 122, 1],
    [65, 121, 1],
    [70, 125, 1],
  ] as const) {
    b.fill(cx, FL, cz, cx, FL + h - 1, cz, "rotting_planks");
    if (h > 1) b.set(cx, FL + h, cz, SNOW);
  }
  b.set(69, FL, 120, "hay");
  b.set(64, FL, 123, "hay");
  b.set(71, FL, 122, "reeds");
  b.set(63, FL, 125, "reeds");
  // forge cargo: dark-brick crates, iron strapping, one dead ember — Ashkaal's
  for (const [cx, cz, h] of [
    [52, 112, 2],
    [50, 110, 1],
    [54, 109, 1],
    [51, 115, 1],
  ] as const) {
    b.fill(cx, FL, cz, cx, FL + h - 1, cz, "dark_bricks");
    if (h > 1) b.set(cx, FL + h, cz, SNOW);
  }
  b.set(53, FL, 114, "iron_bars");
  b.set(49, FL, 112, "iron_bars");
  b.set(52, FL + 2, 112, "obsidian");
  b.world.setIfAir(55, FL, 111, id("ember_crystal"));
  // desert wares + bone paddocks: sandstone bales, pens of cattle bone
  for (const [cx, cz, h] of [
    [62, 102, 1],
    [60, 100, 2],
    [64, 99, 1],
  ] as const) {
    b.fill(cx, FL, cz, cx, FL + h - 1, cz, hash2(seed ^ 0x77a8, cx, cz) < 0.5 ? "sandstone_bricks" : "sandstone_tomb_brick");
    if (h > 1) b.set(cx, FL + h, cz, SNOW);
  }
  b.set(61, FL, 104, "hay");
  for (const [px0, pz0] of [
    [44, 122],
    [50, 126],
  ] as const) {
    for (let x = px0; x <= px0 + 4; x++) {
      b.set(x, FL, pz0, "bone_block");
      b.set(x, FL, pz0 + 3, "bone_block");
    }
    for (let z = pz0; z <= pz0 + 3; z++) {
      b.set(px0, FL, z, "bone_block");
      b.set(px0 + 4, FL, z, "bone_block");
    }
    b.set(px0 + 2, FL, pz0 + 1, "skull_pile");
  }
  // wagon wrecks beside the road — four biomes' cargo, one destination
  for (const [wx, wz, dx] of [
    [72, 128, 1],
    [60, 104, -1],
    [90, 120, 1],
  ] as const) {
    for (let i = 0; i < 4; i++) {
      b.set(wx + i * dx, FL, wz, "charred_log");
      if (i === 1 || i === 2) b.set(wx + i * dx, FL + 1, wz, "planks");
    }
    b.set(wx + dx, FL, wz + 1, "iron_bars");
    b.set(wx + 2 * dx, FL, wz - 1, "planks");
  }
  // the frozen tarn: the water the waste kept
  for (let z = 108; z <= 120; z++) {
    for (let x = 86; x <= 102; x++) {
      const d = Math.hypot((x - 94) / 8, (z - 114) / 5);
      if (d <= 1) b.set(x, G, z, ICE);
    }
  }

  // ---- the RIME WARDENS' GATE: the valley pinched shut; the arena is the
  // only way through (spatial gating — blocked terrain, no portal)
  const A = WASTE.arena;
  const inArena = (x: number, z: number): boolean => {
    const nx = (x - A.cx) / A.rx;
    const nz = (z - A.cz) / A.rz;
    return nx * nx + nz * nz <= 1;
  };
  for (let z = WASTE.gateZ.z0; z <= WASTE.gateZ.z1; z++) {
    for (let x = WASTE.valley.x0 - 14; x <= WASTE.valley.x1 + 14; x++) {
      if (inArena(x, z)) continue;
      const top = G + 12 + Math.floor(hash2(seed ^ 0x77a9, x, z) * 3);
      b.fill(x, FL, z, x, top, z, hash2(seed ^ 0x77aa, x, z) < 0.55 ? ICE : DARK);
      b.set(x, top + 1, z, SNOW);
    }
  }
  // the arena ring: an 8-high wall on the ellipse boundary, two offset doors
  for (let z = A.cz - A.rz - 2; z <= A.cz + A.rz + 2; z++) {
    for (let x = A.cx - A.rx - 2; x <= A.cx + A.rx + 2; x++) {
      if (inArena(x, z)) continue;
      const nx = (x - A.cx) / (A.rx + 2);
      const nz = (z - A.cz) / (A.rz + 2);
      if (nx * nx + nz * nz > 1) continue;
      b.fill(x, FL, z, x, G + 8, z, ICE);
      if ((x + z) % 2 === 0) b.set(x, G + 9, z, ICE);
    }
  }
  // south door at x74, north door at x86 — offset, so the crossing walks the
  // wardens' floor diagonally
  for (const [dx0, dx1, dz0, dz1] of [
    [73, 75, A.cz + A.rz - 3, A.cz + A.rz + 3],
    [85, 87, A.cz - A.rz - 3, A.cz - A.rz + 3],
  ] as const) {
    for (let z = dz0; z <= dz1; z++) {
      for (let x = dx0; x <= dx1; x++) {
        if (b.groundAt(x, z) > G) b.fill(x, FL, z, x, G + 12, z, 0);
        b.set(x, G, z, hash2(seed ^ 0x77ab, x, z) < 0.3 ? "cracked_bricks" : "stone_bricks");
      }
    }
  }
  // the arena floor: swept ice — the wardens keep their post clean
  for (let z = A.cz - A.rz; z <= A.cz + A.rz; z++) {
    for (let x = A.cx - A.rx; x <= A.cx + A.rx; x++) {
      if (!inArena(x, z)) continue;
      b.set(x, G, z, hash2(seed ^ 0x77ac, x, z) < 0.8 ? ICE : SNOW);
    }
  }
  // empty plinths flanking the north door — the wardens' posts (the statues
  // are the mobs; gargoyles animate)
  for (const [px, pz] of [
    [81, 83],
    [88, 84],
  ] as const) {
    b.set(px, FL, pz, "marble");
  }
  b.world.setIfAir(75, FL, A.cz + A.rz - 4, id("blue_crystal"));
  b.world.setIfAir(85, FL, A.cz - A.rz + 4, id("blue_crystal"));

  // ---- THE UNPAID PILE (set apart, snowed under, Valdrenn's crest on every
  // crate): marble and gold under drifts, two banner poles — the tribute
  // that was never sent
  for (const [cx, cz, h, block] of [
    [98, 68, 2, "marble"],
    [100, 70, 1, "marble"],
    [102, 68, 1, "marble"],
    [99, 72, 1, "marble"],
    [101, 66, 1, "gold_block"],
    [97, 70, 1, "gold_block"],
  ] as const) {
    b.fill(cx, FL, cz, cx, FL + h - 1, cz, block);
    b.set(cx, FL + h, cz, SNOW);
  }
  for (const [px, pz] of [
    [96, 66],
    [103, 72],
  ] as const) {
    b.fill(px, FL, pz, px, FL + 1, pz, "marble");
    b.set(px, FL + 2, pz, "banner");
  }

  // ---- the TRIBUTE-COURT: the amphitheater of ice. Terraced benches ring a
  // sunken floor; the whole ring reads as a 5-high wall from outside — the
  // south processional gap and the north cleft are the only ways in.
  const C = WASTE.court;
  const CF = G - 2; // court floor surface y (feet 9)
  const benchY = (r: number): number | null => {
    if (r < 14) return CF;
    if (r < 17) return G + 1;
    if (r < 20) return G + 3;
    if (r < 23) return G + 5;
    if (r <= C.r) return G + 4; // outer shoulder
    return null;
  };
  const inLane = (x: number, z: number): boolean => Math.abs(x - C.cx) <= 3 && z > C.cz && z <= 70;
  const inNorthGap = (x: number, z: number): boolean => Math.abs(x - C.cx) <= 4 && z < C.cz;
  for (let z = C.cz - C.r; z <= C.cz + C.r; z++) {
    for (let x = C.cx - C.r; x <= C.cx + C.r; x++) {
      const r = Math.hypot(x - C.cx, z - C.cz);
      if (r > C.r) continue;
      let ty = benchY(r);
      if (ty === null) continue;
      if (inNorthGap(x, z) && r >= 14) ty = CF; // the pass runs through, floor-level
      if (inLane(x, z)) {
        // the processional: 1-block steps down from the valley to the floor
        ty = Math.max(CF, Math.min(G, CF + Math.floor((z - (C.cz + 14)) / 3)));
      }
      ty = Math.max(MIN_DIG_FLOOR + 1, ty);
      // ICE-bodied benches (never flatten — the dirt-underlayer lesson);
      // the sunken floor digs, the benches build
      b.clearAbove(x, z, x, z, ty);
      for (let y = ty + 1; y <= G; y++) b.world.set(x, y, z, 0);
      if (ty > G) b.fill(x, FL, z, x, ty, z, ICE);
      b.set(x, ty, z, r < 14 || inLane(x, z) ? SNOW : ICE);
    }
  }
  // court floor dressing: swept ice rings around the dais axis
  for (let z = C.cz - 13; z <= C.cz + 13; z++) {
    for (let x = C.cx - 13; x <= C.cx + 13; x++) {
      const r = Math.hypot(x - C.cx, z - C.cz);
      if (r < 14 && Math.abs(r - 9) < 0.8 && hash2(seed ^ 0x77ad, x, z) < 0.7) b.set(x, CF, z, ICE);
    }
  }
  // the colonnade: ice pillars on the first bench, blue-lit — skip the south
  // lane and the north gap
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6 + 0.26;
    const px = Math.round(C.cx + Math.cos(a) * 15.5);
    const pz = Math.round(C.cz + Math.sin(a) * 15.5);
    if (inLane(px, pz) || inNorthGap(px, pz) || Math.abs(px - C.cx) <= 4) continue;
    const base = G + 2; // on the first bench
    b.fill(px, base, pz, px, base + 5, pz, ICE);
    const ax = px + (px < C.cx ? 1 : -1);
    b.world.setIfAir(ax, base + 2, pz, id("blue_crystal"));
  }
  // sorted payment heaped in sectors around the floor rim: grain west,
  // cattle-bone east, weapon-wagons northeast — what "tribute" means here
  for (const [gx, gz] of [
    [70, 42],
    [68, 47],
    [71, 51],
  ] as const) {
    b.set(gx, CF + 1, gz, "hay");
    b.set(gx, CF + 2, gz, SNOW);
    b.set(gx + 1, CF + 1, gz + 1, "hay");
  }
  for (let x = 89; x <= 93; x++) {
    b.set(x, CF + 1, 44, "bone_block");
    b.set(x, CF + 1, 49, "bone_block");
  }
  b.set(91, CF + 1, 46, "skull_pile");
  for (const [wx, wz] of [
    [88, 36],
    [91, 39],
  ] as const) {
    b.set(wx, CF + 1, wz, "planks");
    b.set(wx + 1, CF + 1, wz, "iron_bars");
    b.set(wx, CF + 2, wz, "iron_bars");
  }
  // ---- the DAIS: marble steps up out of the ice, and a seat of ancient ice
  // flanked in cold light — the counter-image of Valdrenn's gold throne
  b.fill(WASTE.dais.x - 4, CF + 1, WASTE.dais.z - 2, WASTE.dais.x + 4, CF + 1, WASTE.dais.z + 2, "marble");
  b.fill(WASTE.dais.x - 2, CF + 2, WASTE.dais.z - 2, WASTE.dais.x + 2, CF + 2, WASTE.dais.z - 1, "marble");
  for (let x = WASTE.dais.x - 1; x <= WASTE.dais.x + 1; x++) b.set(x, CF + 1, WASTE.dais.z + 3, "marble"); // step
  b.set(WASTE.dais.x, CF + 3, WASTE.dais.z - 1, ICE); // the seat
  b.fill(WASTE.dais.x, CF + 3, WASTE.dais.z - 2, WASTE.dais.x, CF + 5, WASTE.dais.z - 2, ICE); // its back
  b.set(WASTE.dais.x - 1, CF + 3, WASTE.dais.z - 2, ICE);
  b.set(WASTE.dais.x + 1, CF + 3, WASTE.dais.z - 2, ICE);
  b.world.setIfAir(WASTE.dais.x - 2, CF + 2, WASTE.dais.z - 1, id("blue_crystal"));
  b.world.setIfAir(WASTE.dais.x + 2, CF + 2, WASTE.dais.z - 1, id("blue_crystal"));

  // ---- the WINGS: treasury alcoves cut into the terraces at floor level,
  // east and west, each with a corridor through the benches so the floor
  // reaches them — cache_royal-tier by design: the tribute IS royal goods
  for (const wing of [
    { x0: 56, x1: 66, cx: 58 },
    { x0: 94, x1: 104, cx: 102 },
  ] as const) {
    for (let z = 44; z <= 48; z++) {
      for (let x = wing.x0; x <= wing.x1; x++) {
        b.clearAbove(x, z, x, z, CF);
        for (let y = CF + 1; y <= G; y++) b.world.set(x, y, z, 0);
        b.set(x, CF, z, SNOW);
      }
    }
    b.set(wing.cx - 1, CF + 1, 44, "gold_block");
    b.set(wing.cx + 1, CF + 1, 48, "marble");
    b.set(wing.cx, CF + 1, 44, "marble");
    b.world.setIfAir(wing.cx, CF + 2, 44, id("blue_crystal"));
  }
  features.caches.push({ x: 58.5, y: CF + 1, z: 46.5, table: "cache_royal", respawnSec: 900 });
  features.caches.push({ x: 102.5, y: CF + 1, z: 46.5, table: "cache_royal", respawnSec: 900 });

  // ---- THE FAR DOOR (mysteries register §10.5 — shown, never opened): the
  // pass continues north behind the dais, climbs in steps, and stops at a
  // sheer slab of ancient ice. Blue light leaks from under it. The notch
  // stays open above — there is visibly MORE WORLD, and no way to it.
  for (let z = WASTE.cleft.z0; z <= WASTE.cleft.z1 + 2; z++) {
    const ty = z > 22 ? CF : Math.min(G + 6, CF + Math.max(0, Math.floor((22 - z) / 2)) + 1);
    for (let x = WASTE.cleft.x0, e = WASTE.cleft.x1; x <= e; x++) {
      // rock-bodied steps up into the notch (never flatten — dirt underlayer)
      b.clearAbove(x, z, x, z, ty, 30);
      for (let y = ty + 1; y <= G; y++) b.world.set(x, y, z, 0);
      if (ty > G) b.fill(x, FL, z, x, ty, z, DARK);
      b.set(x, ty, z, SNOW);
    }
  }
  // the slab itself: full-height ancient ice across the cleft
  for (let z = 5; z <= 9; z++) {
    for (let x = WASTE.cleft.x0 - 1; x <= WASTE.cleft.x1 + 1; x++) {
      b.fill(x, FL, z, x, G + 30 + Math.floor(hash2(seed ^ 0x77ae, x, z) * 3), z, ICE);
    }
  }
  for (const [gx, gz] of [
    [78, 10],
    [80, 10],
    [82, 10],
  ] as const) {
    b.world.setIfAir(gx, b.groundAt(gx, gz) + 1, gz, id("blue_crystal"));
  }

  // ---- war-less scatter: strewn cargo the wind is still burying
  for (let i = 0; i < 26; i++) {
    const rx = 34 + Math.floor(hash2(seed ^ 0x77af, i, 1) * 92);
    const rz = 64 + Math.floor(hash2(seed ^ 0x77af, i, 2) * 70);
    if (rz >= WASTE.gateZ.z0 - 2 && rz <= WASTE.gateZ.z1 + 2) continue;
    if (Math.hypot(rx - C.cx, rz - C.cz) <= C.r + 2) continue;
    if (!b.world.solidAt(rx, G, rz) || b.world.solidAt(rx, FL, rz)) continue;
    const r = hash2(seed ^ 0x77b0, rx, rz);
    b.set(rx, FL, rz, r < 0.4 ? "rotting_planks" : r < 0.7 ? "bone_block" : "hay");
  }
}

// ---------------------------------------------------------------------------
// THE SUNDERING FIELDS (W5, world-redesign batch 7; story bible §6 W5) — the
// approach plain south of Valdrenn, where the king's army made its stand for
// nine days AFTER the gates broke: the trench crescents face NORTH, toward
// the capital the enemy already held, and the sledge-furrow runs south out of
// the city — Old Wallbreaker was driven THROUGH the army toward the people
// fleeing into the fen. The war froze where it stopped.
//
//   PROC + AUTHORED (seed 92001 SURVEYED, batch-4 discipline): the seed's own
//   hydrology puts a drowned mere squarely on the direct south-gate →
//   city-gate line (~60/201 ray columns flooded), and the two authored trench
//   crescents ditch the rest of it — every crossing must bend to a duckboard
//   gap or the beast's own breach. The builder adds: the fen-creep gradient
//   (the marsh eating the south fringe), the bending tribute road + the
//   Foundry haul-road, the trench crescents (firing steps south, berms and
//   stakes north — passable southward, blocking northward except at the
//   gaps), the sledge-furrow ending at the war-sledge arena, the mustering
//   stones, the toll arch with its chains still up, two besieger camps the
//   Ashpickers squat now, the mass barrow (the Alpha's den), shell craters,
//   and the corpse-candle trail to the hidden west road.
// DETERMINISM: layout constants fixed; every ragged edge is hash2(seed^salt).
// ---------------------------------------------------------------------------
const FIELDS_ROAD: Array<[number, number]> = [
  [144, 262], // the fen gate apron (Old North Road, south end)
  [138, 244],
  [122, 228], // bending west around the drowned mere
  [110, 210],
  [108, 196], // the west shore; the beast's arena looms west of the road
  [116, 172],
  [126, 148],
  [126, 128], // trench A crossing (the duckboard gap)
  [132, 108],
  [140, 92], // trench B crossing
  [144, 76], // the mustering verge
  [144, 40], // the toll arch
  [144, 26], // the city gate apron
];
const FIELDS_HAUL: Array<[number, number]> = [
  [262, 116], // the Foundry gate apron
  [238, 124],
  [214, 136],
  [190, 144],
  [166, 136],
  [148, 120],
  [132, 108], // joins the tribute road north of trench A
];
// trench crescents, concave north (geometry as testimony): z(x) polylines
const FIELDS_TRENCH_A: Array<[number, number]> = [
  [60, 138],
  [78, 130],
  [96, 126],
  [114, 124],
  [132, 125],
  [152, 132],
];
const FIELDS_TRENCH_B: Array<[number, number]> = [
  [84, 102],
  [102, 93],
  [120, 88],
  [138, 88],
  [156, 92],
  [172, 100],
];
const FIELDS_GAP_A = 126; // road crossing on line A (±2 columns undug)
const FIELDS_GAP_B = 140; // road crossing on line B
const FIELDS_FURROW = { x: 92, z0: 4, z1: 184 }; // the sledge-furrow (3 wide)
const FIELDS_ARENA = { x: 92, z: 190, r: 10 }; // the war-sledge stand
const FIELDS_BARROW = { x: 232, z: 206 }; // the mass barrow (the Alpha's den)
const FIELDS_MUSTER = { x0: 132, z: 70, x1: 168 }; // the standard line
const FIELDS_TOLL = { x: 144, z: 40 }; // the tribute-road toll arch
const FIELDS_CAMPS: Array<[number, number]> = [
  [120, 56],
  [172, 52],
];
const FIELDS_ARENA_EXCLUSION: Rect = { x0: 78, z0: 174, x1: 106, z1: 204 };
const FIELDS_BARROW_EXCLUSION: Rect = { x0: 218, z0: 192, x1: 248, z1: 220 };
const FIELDS_MUSTER_EXCLUSION: Rect = { x0: 126, z0: 58, x1: 174, z1: 82 };
const FIELDS_TOLL_EXCLUSION: Rect = { x0: 134, z0: 30, x1: 158, z1: 48 };
const FIELDS_FURROW_EXCLUSION: Rect = { x0: 86, z0: 2, x1: 98, z1: 206 };
const FIELDS_TRENCH_EXCLUSIONS: Rect[] = [
  { x0: 56, z0: 118, x1: 156, z1: 144 },
  { x0: 80, z0: 82, x1: 176, z1: 108 },
];
const FIELDS_CAMP_EXCLUSIONS: Rect[] = FIELDS_CAMPS.map(([cx, cz]) => ({ x0: cx - 10, z0: cz - 10, x1: cx + 10, z1: cz + 10 }));

function polylineDist(line: Array<[number, number]>, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]!;
    const [bx, bz] = line[i + 1]!;
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
  }
  return best;
}

function fieldsRoadExclusions(): Rect[] {
  const out: Rect[] = [];
  for (const seg of [FIELDS_ROAD, FIELDS_HAUL]) {
    for (let i = 0; i < seg.length - 1; i++) {
      const [ax, az] = seg[i]!;
      const [bx, bz] = seg[i + 1]!;
      out.push({ x0: Math.min(ax, bx) - 4, z0: Math.min(az, bz) - 4, x1: Math.max(ax, bx) + 4, z1: Math.max(az, bz) + 4 });
    }
  }
  return out;
}

function buildSunderingFields(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const wl = def.terrain.waterLevel ?? 12;
  const w = b.world;
  const GRASS = id("grass");
  const MUD = id("mud");

  // rects the loose dressing passes must not touch (prefab scatter ran first)
  const keepOut: Rect[] = [
    FIELDS_ARENA_EXCLUSION,
    FIELDS_BARROW_EXCLUSION,
    FIELDS_MUSTER_EXCLUSION,
    FIELDS_TOLL_EXCLUSION,
    ...FIELDS_CAMP_EXCLUSIONS,
  ];
  for (const p of features.placements) {
    const pd = PREFABS[p.prefab];
    if (!pd) continue;
    const rw = p.rot % 2 ? pd.footprint.d : pd.footprint.w;
    const rd = p.rot % 2 ? pd.footprint.w : pd.footprint.d;
    keepOut.push({ x0: p.ox - 2, z0: p.oz - 2, x1: p.ox + rw + 1, z1: p.oz + rd + 1 });
  }
  const inKeepOut = (x: number, z: number): boolean =>
    keepOut.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);

  // --- 1. the fen creep: the marsh is eating the south fringe -------------
  for (let z = 235; z < def.size.h; z++) {
    const f = Math.min(0.8, (z - 235) / 40);
    for (let x = 0; x < def.size.w; x++) {
      const g = b.g(x, z);
      if (g <= wl) continue;
      if (w.get(x, g, z) !== GRASS) continue;
      if (hash2(seed ^ 0x7b01, x, z) < f) {
        w.set(x, g, z, MUD);
        if (hash2(seed ^ 0x7b02, x, z) < 0.06) w.setIfAir(x, g + 1, z, id("reeds"));
      }
    }
  }
  // --- and the churned band between the trench lines: grass died here -----
  for (let z = 84; z <= 140; z++) {
    for (let x = 40; x <= 200; x++) {
      const g = b.g(x, z);
      if (g <= wl || w.get(x, g, z) !== GRASS) continue;
      const r = hash2(seed ^ 0x7b03, x, z);
      if (r < 0.1) w.set(x, g, z, id("dirt"));
      else if (r < 0.14) w.set(x, g, z, id("path"));
      else if (r > 0.997) w.setIfAir(x, g + 1, z, id("bone_block")); // the dead, unclaimed
    }
  }

  // --- 2. the roads: the tribute road + the Foundry haul-road -------------
  const roadCell = (x: number, z: number): void => {
    const g = b.g(x, z);
    if (g <= wl) {
      w.set(x, wl + 1, z, id("rotting_planks"));
    } else {
      b.clearAbove(x, z, x, z, g, 10);
      w.set(x, g, z, hash2(seed ^ 0x7b04, x, z) < 0.62 ? id("path") : hash2(seed ^ 0x7b05, x, z) < 0.5 ? id("dirt") : id("cobblestone"));
    }
  };
  for (const seg of [FIELDS_ROAD, FIELDS_HAUL]) {
    for (let i = 0; i < seg.length - 1; i++) {
      const [ax, az] = seg[i]!;
      const [bx, bz] = seg[i + 1]!;
      const len = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
      for (let t = 0; t <= len; t++) {
        const cx = Math.round(ax + ((bx - ax) * t) / len);
        const cz = Math.round(az + ((bz - az) * t) / len);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) roadCell(cx + dx, cz + dz);
      }
    }
  }

  // --- 3. the trench crescents: firing step south, berm + stakes north ----
  // Passable SOUTHWARD everywhere (step down 2, climb out via the firing
  // step); blocking northward except at the duckboard gaps and the breach.
  const digCol = (x: number, z: number, floorY: number, surface: string): void => {
    const g = b.g(x, z);
    b.clearAbove(x, z, x, z, g, 10);
    const fy = Math.max(10, floorY);
    for (let y = fy + 1; y <= g; y++) w.set(x, y, z, 0);
    w.set(x, fy, z, id(surface));
    for (let y = Math.max(1, fy - 2); y < fy; y++) {
      if (!w.solidAt(x, y, z)) w.set(x, y, z, id("dirt"));
    }
  };
  const digTrench = (line: Array<[number, number]>, gapX: number, salt: number): void => {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i]!;
      const [bx, bz] = line[i + 1]!;
      for (let x = ax; x <= bx; x++) {
        const t = (x - ax) / (bx - ax);
        const zc = Math.round(az + (bz - az) * t);
        // the beast's breach: the trench is simply GONE where the furrow ran
        if (x >= FIELDS_FURROW.x - 4 && x <= FIELDS_FURROW.x + 4) continue;
        if (Math.abs(x - gapX) <= 2) {
          // the crossing: original ground, duckboarded, berm and stakes gapped
          for (let dz = -1; dz <= 1; dz++) {
            const g = b.g(x, zc + dz);
            b.clearAbove(x, zc + dz, x, zc + dz, g, 10);
            w.set(x, g, zc + dz, id("rotting_planks"));
          }
          continue;
        }
        const g = b.g(x, zc);
        const duck = hash2(seed ^ salt, x, zc) < 0.3;
        digCol(x, zc + 1, g - 1, duck ? "rotting_planks" : "dirt"); // the firing step
        digCol(x, zc, g - 2, duck ? "rotting_planks" : hash2(seed ^ (salt + 1), x, zc) < 0.25 ? "mud" : "dirt");
        digCol(x, zc - 1, g - 2, "dirt");
        // the north berm: spoil thrown toward the enemy
        const bg = b.g(x, zc - 2);
        if (bg > wl && hash2(seed ^ (salt + 2), x, zc) < 0.8) {
          w.set(x, bg + 1, zc - 2, hash2(seed ^ (salt + 3), x, zc) < 0.3 ? id("rubble") : id("dirt"));
          if (hash2(seed ^ (salt + 4), x, zc) < 0.18) w.set(x, bg + 2, zc - 2, id("rubble"));
        }
        // stakes on the enemy-facing slope
        const sg = b.g(x, zc - 3);
        if (sg > wl && hash2(seed ^ (salt + 5), x, zc) < 0.22) {
          w.setIfAir(x, sg + 1, zc - 3, id("palisade"));
          if (hash2(seed ^ (salt + 6), x, zc) < 0.3) w.setIfAir(x, sg + 2, zc - 3, id("palisade"));
        }
      }
    }
  };
  digTrench(FIELDS_TRENCH_A, FIELDS_GAP_A, 0x7b10);
  digTrench(FIELDS_TRENCH_B, FIELDS_GAP_B, 0x7b20);

  // --- 4. the sledge-furrow: the beast's arrival, written in the ground ---
  const F = FIELDS_FURROW;
  for (let z = F.z0; z <= F.z1; z++) {
    const breach = z >= 118 && z <= 134; // where it went THROUGH trench A
    for (const x of [F.x - 1, F.x, F.x + 1]) {
      const g = b.g(x, z);
      const ramp = z % 22 === 10 && x === F.x - 1; // collapsed wall — a way out
      const r = hash2(seed ^ 0x7b30, x, z);
      digCol(x, z, ramp ? g - 1 : g - 2, r < 0.3 ? "mud" : r > 0.94 ? "rubble" : "dirt");
      if (r > 0.985) w.setIfAir(x, Math.max(10, g - 2) + 1, z, id("bone_block"));
    }
    // rubble berms thrown up both sides
    for (const x of [F.x - 2, F.x + 2]) {
      const g = b.g(x, z);
      if (g > wl && hash2(seed ^ 0x7b31, x, z) < (breach ? 0.7 : 0.35)) {
        w.setIfAir(x, g + 1, z, id("rubble"));
      }
    }
  }

  // --- 5. the arena: the war-sledge at the furrow's end -------------------
  const A = FIELDS_ARENA;
  const GA = b.g(A.x, A.z);
  b.clearAbove(A.x - A.r - 2, A.z - A.r - 2, A.x + A.r + 2, A.z + A.r + 2, GA, 14);
  for (let z = A.z - A.r; z <= A.z + A.r; z++) {
    for (let x = A.x - A.r; x <= A.x + A.r; x++) {
      if (Math.hypot(x - A.x, z - A.z) > A.r) continue;
      for (let y = GA + 1; y < WORLD_HEIGHT; y++) w.set(x, y, z, 0);
      for (let y = Math.max(1, GA - 3); y < GA; y++) {
        if (!w.solidAt(x, y, z)) w.set(x, y, z, id("dirt"));
      }
      const r = hash2(seed ^ 0x7b40, x, z);
      w.set(x, GA, z, r < 0.4 ? id("mud") : r < 0.55 ? id("path") : id("dirt")); // churned ground
      if (r > 0.975) w.set(x, GA + 1, z, id("bone_block"));
    }
  }
  // the sledge: two charred runners, a splintered deck, the empty yoke
  for (let z = A.z + 1; z <= A.z + 9; z++) {
    b.set(A.x - 3, GA + 1, z, "charred_log");
    b.set(A.x + 3, GA + 1, z, "charred_log");
  }
  for (let z = A.z + 3; z <= A.z + 8; z++) {
    for (let x = A.x - 2; x <= A.x + 2; x++) {
      if (hash2(seed ^ 0x7b41, x, z) < 0.55) b.set(x, GA + 2, z, "planks");
    }
  }
  b.fill(A.x - 3, GA + 1, A.z, A.x - 3, GA + 2, A.z, "log"); // the yoke posts
  b.fill(A.x + 3, GA + 1, A.z, A.x + 3, GA + 2, A.z, "log");
  b.fill(A.x - 3, GA + 3, A.z, A.x + 3, GA + 3, A.z, "charred_log"); // the beam
  b.set(A.x - 1, GA + 2, A.z, "chain"); // the harness it walked out of
  b.set(A.x + 1, GA + 2, A.z, "chain");
  b.set(A.x - 5, GA + 1, A.z + 6, "skull_pile");
  b.set(A.x + 6, GA + 1, A.z + 3, "skull_pile");

  // --- 6. the mustering stones: the standards still planted ---------------
  const M = FIELDS_MUSTER;
  for (let z = M.z - 6; z <= M.z + 6; z++) {
    for (let x = M.x0 - 4; x <= M.x1 + 4; x++) {
      const g = b.g(x, z);
      if (g <= wl) continue;
      b.clearAbove(x, z, x, z, g, 10);
      const r = hash2(seed ^ 0x7b50, x, z);
      if (r < 0.35) w.set(x, g, z, id("path"));
      else if (r < 0.45) w.set(x, g, z, id("dirt"));
    }
  }
  for (let x = M.x0; x <= M.x1; x += 6) {
    const g = b.g(x, M.z);
    b.set(x, g, M.z, "stone_bricks");
    b.fill(x, g + 1, M.z, x, g + 2, M.z, "log");
    if (hash2(seed ^ 0x7b51, x, M.z) < 0.75) b.set(x, g + 3, M.z, "banner");
  }

  // --- 7. the toll arch: even Valdrenn taxed its own road -----------------
  const T = FIELDS_TOLL;
  const GT = b.g(T.x, T.z);
  b.clearAbove(T.x - 6, T.z - 4, T.x + 10, T.z + 4, GT, 12);
  for (const px of [T.x - 3, T.x + 3]) {
    for (let y = GT + 1; y <= GT + 4; y++) {
      b.set(px, y, T.z, hash2(seed ^ 0x7b60, px, y) < 0.3 ? "cracked_bricks" : "stone_bricks");
    }
  }
  b.fill(T.x - 3, GT + 5, T.z, T.x + 3, GT + 5, T.z, "stone_bricks");
  b.set(T.x - 1, GT + 4, T.z, "chain"); // the toll-chains, still up
  b.set(T.x + 1, GT + 4, T.z, "chain");
  b.set(T.x, GT + 3, T.z, "chain");
  // the toll hut, roofless; its strongbox outlived its keeper
  for (let z = T.z - 4; z <= T.z - 1; z++) {
    for (let x = T.x + 6; x <= T.x + 10; x++) {
      const edge = x === T.x + 6 || x === T.x + 10 || z === T.z - 4 || z === T.z - 1;
      const g = b.g(x, z);
      w.set(x, g, z, id("path"));
      if (!edge) continue;
      const bite = Math.floor(hash2(seed ^ 0x7b61, x, z) * 2.4);
      for (let y = g + 1; y <= g + 2 - bite; y++) {
        w.set(x, y, z, hash2(seed ^ 0x7b62, x, z) < 0.35 ? id("cracked_bricks") : id("stone_bricks"));
      }
    }
  }
  b.fill(T.x + 8, GT + 1, T.z - 1, T.x + 8, GT + 2, T.z - 1, 0); // the door
  features.caches.push({ x: T.x + 7.5, y: GT + 1, z: T.z - 2.5, table: "cache_sundering_fields", respawnSec: 480 });

  // --- 8. the besieger camps: the army that waited, and what squats it now
  for (let i = 0; i < FIELDS_CAMPS.length; i++) {
    const [cx, cz] = FIELDS_CAMPS[i]!;
    const gc = b.g(cx, cz);
    b.clearAbove(cx - 8, cz - 8, cx + 8, cz + 8, gc, 12);
    b.paintCircle(cx, cz, 6.5, "ash");
    // the fire ring — one camp's fire is LIVE (the Ashpickers moved in)
    for (const [fx, fz] of [
      [cx - 1, cz - 1],
      [cx + 1, cz - 1],
      [cx - 1, cz + 1],
      [cx + 1, cz + 1],
    ] as const) {
      b.set(fx, gc + 1, fz, "charred_log");
    }
    if (i === 0) b.torch(cx, gc + 1, cz);
    else b.set(cx, gc + 1, cz, "skull_pile");
    // tent frames: palisade posts + ridge + hay bedding
    for (const [tx, tz, rot] of [
      [cx - 5, cz - 3, 0],
      [cx + 4, cz - 4, 1],
      [cx - 2, cz + 4, 0],
    ] as const) {
      const g2 = b.g(tx, tz);
      const dx = rot === 0 ? 2 : 0;
      const dz = rot === 0 ? 0 : 2;
      b.fill(tx, g2 + 1, tz, tx, g2 + 2, tz, "palisade");
      b.fill(tx + dx * 2, g2 + 1, tz + dz * 2, tx + dx * 2, g2 + 2, tz + dz * 2, "palisade");
      b.fill(tx, g2 + 3, tz, tx + dx * 2, g2 + 3, tz + dz * 2, "charred_log");
      b.set(tx + dx, g2 + 1, tz + dz, "hay");
    }
    // crates + the warband's mark
    b.fill(cx + 4, gc + 1, cz + 3, cx + 5, gc + 1, cz + 4, "planks");
    b.set(cx + 4, gc + 2, cz + 3, "planks");
    b.fill(cx - 5, gc + 1, cz + 1, cx - 5, gc + 2, cz + 1, "dark_bricks");
    b.set(cx - 5, gc + 3, cz + 1, "banner");
  }

  // --- 9. the mass barrow: the hounds ate well here and never left --------
  const BA = FIELDS_BARROW;
  const GB = b.g(BA.x, BA.z);
  b.clearAbove(BA.x - 11, BA.z - 8, BA.x + 11, BA.z + 8, GB, 14);
  for (let dz = -7; dz <= 7; dz++) {
    for (let dx = -10; dx <= 10; dx++) {
      const d = Math.hypot(dx * 0.7, dz);
      if (d > 7) continue;
      const jitter = hash2(seed ^ 0x7b70, BA.x + dx, BA.z + dz) * 0.8;
      const h = Math.max(0, Math.round(5.2 - d * 0.75 - jitter));
      if (h === 0) continue;
      for (let y = GB + 1; y <= GB + h; y++) w.set(BA.x + dx, y, BA.z + dz, id("dirt"));
      w.set(BA.x + dx, GB + h, BA.z + dz, hash2(seed ^ 0x7b71, dx, dz) < 0.55 ? id("moss_carpet") : id("dirt"));
    }
  }
  // the den: a stone-lined mouth on the west face, a hollow under the mound
  b.fill(BA.x - 10, GB + 1, BA.z - 1, BA.x - 2, GB + 2, BA.z + 1, 0); // the crawl
  b.fill(BA.x - 2, GB + 1, BA.z - 2, BA.x + 5, GB + 3, BA.z + 2, 0); // the chamber
  for (const [lx, lz] of [
    [BA.x - 10, BA.z - 2],
    [BA.x - 10, BA.z + 2],
  ] as const) {
    b.fill(lx, GB + 1, lz, lx, GB + 2, lz, "mossy_cobblestone");
  }
  b.fill(BA.x - 10, GB + 3, BA.z - 1, BA.x - 10, GB + 3, BA.z + 1, "stone_bricks"); // the lintel
  for (let z = BA.z - 2; z <= BA.z + 2; z++) {
    for (let x = BA.x - 2; x <= BA.x + 5; x++) {
      const r = hash2(seed ^ 0x7b72, x, z);
      if (r < 0.3) w.set(x, GB, z, id("bone_block")); // the floor IS the grave
    }
  }
  b.set(BA.x + 2, GB + 1, BA.z, "hay"); // the nest
  b.set(BA.x + 3, GB + 1, BA.z + 1, "hay");
  b.set(BA.x + 1, GB + 1, BA.z - 2, "skull_pile");
  b.set(BA.x + 4, GB + 1, BA.z + 2, "skull_pile");
  features.caches.push({ x: BA.x + 4.5, y: GB + 1, z: BA.z - 1.5, table: "cache_sundering_fields", respawnSec: 600 });
  // ring stones the barrow-diggers left
  for (const [sx, sz] of [
    [BA.x - 12, BA.z - 6],
    [BA.x - 6, BA.z + 9],
    [BA.x + 9, BA.z + 8],
    [BA.x + 12, BA.z - 5],
  ] as const) {
    const g2 = b.g(sx, sz);
    if (g2 > wl) b.fill(sx, g2 + 1, sz, sx, g2 + 1 + Math.floor(hash2(seed ^ 0x7b73, sx, sz) * 2), sz, "mossy_cobblestone");
  }

  // --- 10. shell craters: the bombardment, frozen ------------------------
  for (const [cx, cz, cr] of [
    [160, 160, 3],
    [178, 122, 2],
    [104, 154, 2],
    [70, 120, 3],
    [56, 96, 2],
    [190, 76, 3],
    [98, 66, 2],
    [206, 152, 2],
    [134, 180, 2],
  ] as const) {
    if (polylineDist(FIELDS_ROAD, cx, cz) < 6 || polylineDist(FIELDS_HAUL, cx, cz) < 6) continue;
    if (inKeepOut(cx, cz)) continue;
    const gc = b.g(cx, cz);
    if (gc <= wl + 1) continue;
    for (let z = cz - cr - 1; z <= cz + cr + 1; z++) {
      for (let x = cx - cr - 1; x <= cx + cr + 1; x++) {
        const d = Math.hypot(x - cx, z - cz);
        const g2 = b.g(x, z);
        b.clearAbove(x, z, x, z, g2, 10);
        if (d <= cr) {
          // per-column bowl (the ground rolls — a flat-G dig would float rims)
          w.set(x, g2, z, 0);
          w.set(x, g2 - 1, z, id("ash"));
        } else if (d <= cr + 1.2 && hash2(seed ^ 0x7b80, x, z) < 0.5) {
          w.set(x, g2 + 1, z, id("rubble"));
        }
      }
    }
    if (cr >= 3) {
      w.set(cx, gc - 2, cz, id("ash"));
      w.set(cx, gc - 1, cz, id("ember_crystal")); // the big wounds still smoulder
    }
  }

  // --- 11. the corpse-candle trail to the hidden west road ----------------
  const CANDLES: Array<[number, number]> = [
    [106, 220],
    [92, 224],
    [78, 228],
    [64, 231],
    [52, 234],
    [44, 235],
  ];
  for (let i = 0; i < CANDLES.length - 1; i++) {
    const [ax, az] = CANDLES[i]!;
    const [bx, bz] = CANDLES[i + 1]!;
    const len = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
    for (let t = 0; t <= len; t += 7) {
      const cx = Math.round(ax + ((bx - ax) * t) / len);
      const cz = Math.round(az + ((bz - az) * t) / len);
      const g = b.g(cx, cz);
      if (g > wl) w.setIfAir(cx, g + 1, cz, id("bog_candle"));
    }
  }
  // two dead lantern posts mark the west gate's forgotten apron
  for (const [px, pz] of [
    [36, 232],
    [44, 240],
  ] as const) {
    const g = b.g(px, pz);
    b.fill(px, g + 1, pz, px, g + 2, pz, "dark_bricks");
  }
}

// ---------------------------------------------------------------------------
// THE FOUNDRY (E5, world-redesign batch 7; story bible §6 E5) — the
// Emberwrights' works: the production floor the whole east branch climbs
// toward. Official story: the Furnace-King's weapon-tribute is made here.
// Actual story, told by the room: the assembly line runs small → large down
// the long hall and ends in a THRONE-SIZED frame, empty. 160² PRESET interior
// (buildCrypt/city technique, biome "ruin" — the builder owns every visible
// block): rift-gate court (south) → the works gate → the long hall S-bending
// through two offset crosswalls → the casting floor (west wing, live lava
// channels) and the tribute dock (east wing: Revenant-stamped crates iced
// shut beside an UNSTAMPED dock of better work held back) → the ward doors →
// the Unfinished King before the empty frame. Light = language: lanterns on
// the working line, ember/lava on the casting floor, braziers and lit
// rune-plates at the king's end. Convention: G = 12 (flat slab), FL = G+1.
// ---------------------------------------------------------------------------
const FDY_WALL = { x0: 30, z0: 22, x1: 130, z1: 132 }; // the works' curtain
const FDY_HALL = { x0: 62, z0: 22, x1: 98, z1: 120 }; // the long hall
const FDY_CAST = { x0: 34, z0: 52, x1: 60, z1: 100 }; // casting floor (west)
const FDY_DOCK = { x0: 100, z0: 56, x1: 126, z1: 104 }; // tribute dock (east)
const FDY_FRAME = { x: 80, z: 26 }; // the throne-sized frame (the line's end)

function buildFoundry(b: Builder, def: RoomDef, features: ScatterResult): void {
  const seed = def.terrain.seed;
  const G = b.g(def.spawn.x, def.spawn.z); // 12 — flat everywhere (amplitude 0)
  const FL = G + 1;
  const w = b.world;

  // slag-aged masonry: dark bricks pitted with cracks and bare rock
  const slagged = (x: number, y: number, z: number): void => {
    const r = hash2(seed ^ 0xfd01, x * 7 + y * 131, z * 13 + y);
    b.set(x, y, z, r < 0.18 ? "cracked_bricks" : r < 0.28 ? "dark_stone" : "dark_bricks");
  };

  // ---- ground: slag yards outside the walls, worked floors inside --------
  for (let z = 0; z < def.size.h; z++) {
    for (let x = 0; x < def.size.w; x++) {
      const inside = x >= FDY_WALL.x0 && x <= FDY_WALL.x1 && z >= FDY_WALL.z0 && z <= FDY_WALL.z1;
      const r = hash2(seed ^ 0xfd02, x, z);
      if (inside) b.set(x, G, z, r < 0.5 ? "ash" : r < 0.62 ? "path" : "dark_stone");
      else b.set(x, G, z, r < 0.42 ? "ash" : r < 0.52 ? "dirt" : "dark_stone");
    }
  }
  // slag heaps + charred posts in the outer yards
  for (let i = 0; i < 26; i++) {
    const hx = 4 + Math.floor(hash2(seed ^ 0xfd03, i, 1) * 152);
    const hz = 4 + Math.floor(hash2(seed ^ 0xfd03, i, 2) * 152);
    if (hx >= FDY_WALL.x0 - 3 && hx <= FDY_WALL.x1 + 3 && hz >= FDY_WALL.z0 - 3 && hz <= FDY_WALL.z1 + 3) continue;
    if (def.portals.some((p) => Math.hypot(hx - p.x, hz - p.z) < 8)) continue;
    if (hash2(seed ^ 0xfd04, hx, hz) < 0.6) {
      const hh = 1 + Math.floor(hash2(seed ^ 0xfd05, hx, hz) * 2);
      for (let dy = 0; dy < hh; dy++) {
        for (let dx = -(hh - 1 - dy); dx <= hh - 1 - dy; dx++) b.set(hx + dx, FL + dy, hz, "dark_stone");
      }
      if (hash2(seed ^ 0xfd06, hx, hz) < 0.3) w.setIfAir(hx, FL + hh, hz, id("ember_crystal"));
    } else {
      b.fill(hx, FL, hz, hx, FL + 1 + Math.floor(hash2(seed ^ 0xfd07, hx, hz) * 2), hz, "charred_log");
    }
  }

  // ---- the curtain wall: dark brick, h6, corner towers --------------------
  const WA = FDY_WALL;
  for (let x = WA.x0; x <= WA.x1; x++) {
    for (const z of [WA.z0, WA.z1]) for (let y = FL; y <= FL + 5; y++) slagged(x, y, z);
  }
  for (let z = WA.z0; z <= WA.z1; z++) {
    for (const x of [WA.x0, WA.x1]) for (let y = FL; y <= FL + 5; y++) slagged(x, y, z);
  }
  b.tower(WA.x0, WA.z0, FL, 2, 8, "dark_bricks");
  b.tower(WA.x1, WA.z0, FL, 2, 8, "dark_bricks");
  b.tower(WA.x0, WA.z1, FL, 2, 8, "dark_bricks");
  b.tower(WA.x1, WA.z1, FL, 2, 8, "dark_bricks");
  // three gates: south (the rift road), west (the war road), east (the city road)
  b.fill(76, FL, WA.z1, 84, FL + 4, WA.z1, 0);
  b.fill(WA.x0, FL, 76, WA.x0, FL + 4, 84, 0);
  b.fill(WA.x1, FL, 76, WA.x1, FL + 4, 84, 0);
  for (const [gx, gz] of [
    [75, WA.z1],
    [85, WA.z1],
  ] as const) {
    b.set(gx, FL + 5, gz, "lantern");
  }
  for (const gz of [75, 85] as const) {
    b.set(WA.x0, FL + 5, gz, "lantern");
    b.set(WA.x1, FL + 5, gz, "lantern");
  }
  // paved approaches: portal aprons → gates
  const lane = (x0: number, z0: number, x1: number, z1: number): void => {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        b.set(x, G, z, hash2(seed ^ 0xfd08, x, z) < 0.75 ? "path" : "ash");
      }
    }
  };
  lane(78, WA.z1 + 1, 82, 148); // south portal → south gate
  lane(16, 78, WA.x0 - 1, 82); // west portal → west gate
  lane(WA.x1 + 1, 78, 145, 82); // east portal → east gate

  // ---- the long hall: walls h7, beamed part-roof, two S crosswalls --------
  const H = FDY_HALL;
  for (let z = H.z0; z <= H.z1; z++) {
    for (const x of [H.x0, H.x1]) {
      for (let y = FL; y <= FL + 6; y++) slagged(x, y, z);
    }
  }
  for (let x = H.x0; x <= H.x1; x++) {
    for (const z of [H.z0, H.z1]) {
      for (let y = FL; y <= FL + 6; y++) slagged(x, y, z);
    }
  }
  // doorways CUT (lintels stay): the works door south, a wing door each side
  b.fill(78, FL, H.z1, 82, FL + 4, H.z1, 0);
  b.fill(H.x0, FL, 74, H.x0, FL + 3, 78, 0);
  b.fill(H.x1, FL, 86, H.x1, FL + 3, 90, 0);
  // beamed roof: charred joists + slag plates, torn open in patches
  for (let z = H.z0; z <= H.z1; z++) {
    for (let x = H.x0; x <= H.x1; x++) {
      if (x % 4 === 2) b.set(x, FL + 7, z, "charred_log");
      else if (hash2(seed ^ 0xfd09, x, z) < 0.5) b.set(x, FL + 7, z, "dark_stone");
    }
  }
  // hall floor: worked stone with the line lane down the middle
  for (let z = H.z0 + 1; z <= H.z1 - 1; z++) {
    for (let x = H.x0 + 1; x <= H.x1 - 1; x++) {
      const r = hash2(seed ^ 0xfd0a, x, z);
      b.set(x, G, z, r < 0.4 ? "stone" : r < 0.55 ? "path" : "dark_bricks");
    }
  }
  for (let z = 30; z <= 116; z += 6) {
    b.set(80, G, z, z <= 60 ? "rune_plate_lit" : "rune_plate"); // the line wakes toward the king
  }
  // the two crosswalls: offset doors force the S (east door, then west door)
  for (const [cz, doorX0] of [
    [96, 90],
    [64, 66],
  ] as const) {
    for (let x = H.x0 + 1; x <= H.x1 - 1; x++) {
      if (x >= doorX0 && x <= doorX0 + 2) continue;
      for (let y = FL; y <= FL + 4; y++) slagged(x, y, cz);
    }
    b.set(doorX0 - 1, FL + 3, cz, "lantern");
    b.set(doorX0 + 3, FL + 3, cz, "lantern");
  }
  // wall lanterns pace the working line
  for (let z = H.z0 + 6; z <= H.z1 - 4; z += 8) {
    b.set(H.x0 + 1, FL + 3, z, "lantern");
    b.set(H.x1 - 1, FL + 3, z, "lantern");
  }

  // ---- THE ASSEMBLY LINE: frames ascending small → large down the hall ----
  const frameAt = (fx: number, fz: number, tier: 0 | 1 | 2): void => {
    b.set(fx, FL, fz, "dark_bricks"); // the anvil-plinth
    if (tier === 0) {
      b.set(fx, FL + 1, fz, "iron_bars"); // a part, not yet a shape
      return;
    }
    if (tier === 1) {
      b.fill(fx, FL + 1, fz, fx, FL + 2, fz, "palisade"); // the armature
      b.set(fx, FL + 3, fz, "iron_bars"); // a torso rib
      return;
    }
    // tier 2: man-and-a-half, ribbed, chained to the beam above
    b.fill(fx - 1, FL + 1, fz, fx - 1, FL + 2, fz, "dark_bricks");
    b.fill(fx + 1, FL + 1, fz, fx + 1, FL + 2, fz, "dark_bricks");
    b.fill(fx - 1, FL + 3, fz, fx + 1, FL + 4, fz, "iron_bars");
    b.set(fx, FL + 5, fz, "chain");
    b.set(fx, FL + 6, fz, "chain");
  };
  for (let i = 0; i < 10; i++) {
    const fz = 112 - i * 8; // south → north up the line
    const fx = i % 2 === 0 ? 73 : 87; // alternating sides of the lane
    if (Math.abs(fz - 96) <= 1 || Math.abs(fz - 64) <= 1) continue; // crosswalls
    frameAt(fx, fz, fz > 92 ? 0 : fz > 60 ? 1 : 2);
    // each station gets its worklight
    b.set(fx + (fx < 80 ? 1 : -1), FL, fz + 1, "brazier");
  }

  // ---- the king's end: the throne-sized frame, empty ----------------------
  const K = FDY_FRAME;
  // the apse floor: swept ash before the frame
  for (let z = H.z0 + 1; z <= 40; z++) {
    for (let x = H.x0 + 1; x <= H.x1 - 1; x++) {
      const r = hash2(seed ^ 0xfd0b, x, z);
      b.set(x, G, z, r < 0.5 ? "ash" : "dark_stone");
    }
  }
  // the line's last plates run lit right up to the frame
  for (let z = 30; z <= 40; z += 6) b.set(80, G, z, "rune_plate_lit");
  b.fill(K.x - 2, FL, K.z, K.x + 2, FL, K.z, "marble"); // the master plinth
  b.fill(K.x - 2, FL + 1, K.z, K.x - 2, FL + 2, K.z, "dark_bricks"); // legs
  b.fill(K.x + 2, FL + 1, K.z, K.x + 2, FL + 2, K.z, "dark_bricks");
  b.fill(K.x - 2, FL + 3, K.z, K.x + 2, FL + 5, K.z, "iron_bars"); // the torso cage
  b.fill(K.x - 1, FL + 4, K.z, K.x + 1, FL + 4, K.z, 0); // hollow at the heart
  b.set(K.x, FL + 4, K.z, "gold_block"); // the heart-socket, filled and waiting
  b.fill(K.x - 3, FL + 6, K.z, K.x + 3, FL + 6, K.z, "charred_log"); // shoulder beam
  // NO head. That is the point.
  b.set(K.x - 3, FL + 5, K.z, "chain");
  b.set(K.x + 3, FL + 5, K.z, "chain");
  for (const bx of [K.x - 4, K.x + 4] as const) {
    b.set(bx, FL, K.z + 2, "dark_bricks");
    b.set(bx, FL + 1, K.z + 2, "brazier");
  }
  // behind it, on the anvils: the next one, half-built (the death-announce
  // tableau is authored, never explained — mysteries register discipline)
  for (const ax of [K.x - 6, K.x + 6] as const) {
    b.fill(ax, FL, K.z - 2, ax + 1, FL, K.z - 2, "dark_bricks");
    b.set(ax, FL + 1, K.z - 2, "iron_bars");
    b.set(ax + 1, FL + 2, K.z - 2, "chain");
    b.set(ax, FL + 4, K.z - 2, "lantern");
  }

  // ---- the casting floor (west wing): the works still run -----------------
  const C = FDY_CAST;
  for (let z = C.z0; z <= C.z1; z++) {
    for (let x = C.x0; x <= C.x1; x++) {
      const r = hash2(seed ^ 0xfd0c, x, z);
      b.set(x, G, z, r < 0.5 ? "dark_stone" : r < 0.65 ? "ash" : "stone");
    }
  }
  // two live lava channels (authored liquid — gen never fills digs)
  for (const cz of [64, 86] as const) {
    for (let x = C.x0 + 2; x <= C.x1 - 2; x++) {
      if ((x - C.x0) % 9 === 4) {
        b.set(x, G, cz, "obsidian"); // a cooled step: the crossing
        continue;
      }
      b.set(x, G, cz, "lava");
      if (hash2(seed ^ 0xfd0d, x, cz) < 0.3) b.set(x, G, cz - 1, "obsidian");
    }
  }
  // crucible stations along the channels
  for (const [ux, uz] of [
    [40, 60],
    [52, 60],
    [44, 90],
    [56, 90],
  ] as const) {
    b.fill(ux, FL, uz, ux + 1, FL + 1, uz, "dark_bricks");
    b.set(ux, FL + 2, uz, "ember_crystal");
  }
  // the tool locker, and what the shift left in it
  b.fill(C.x0 + 1, FL, C.z0 + 1, C.x0 + 3, FL + 1, C.z0 + 2, "planks");
  b.set(C.x0 + 2, FL + 2, C.z0 + 1, "iron_bars");
  features.caches.push({ x: C.x0 + 2.5, y: FL, z: C.z0 + 3.5, table: "cache_foundry", respawnSec: 600 });

  // ---- the tribute dock (east wing): two docks, one glance ----------------
  const D = FDY_DOCK;
  for (let z = D.z0; z <= D.z1; z++) {
    for (let x = D.x0; x <= D.x1; x++) {
      const r = hash2(seed ^ 0xfd0e, x, z);
      b.set(x, G, z, r < 0.55 ? "path" : r < 0.7 ? "planks" : "dark_stone");
    }
  }
  // the STAMPED dock (south rows): the Revenant's tribute, iced shut —
  // frost seals in a fire-works, and nobody here asks why
  for (let rz = 92; rz <= 100; rz += 4) {
    for (let rx = D.x0 + 3; rx <= D.x1 - 5; rx += 4) {
      b.fill(rx, FL, rz, rx + 1, FL, rz + 1, "planks");
      if (hash2(seed ^ 0xfd0f, rx, rz) < 0.6) b.set(rx, FL + 1, rz, "planks");
      b.set(rx + 1, FL + 1, rz + 1, "ice"); // the collector's rime-stamp
    }
  }
  b.set(D.x0 + 2, FL + 3, 96, "banner"); // the tally post
  b.fill(D.x0 + 2, FL, 96, D.x0 + 2, FL + 2, 96, "dark_bricks");
  // the UNSTAMPED dock (north rows): better work, held back
  for (let rz = 60; rz <= 68; rz += 4) {
    for (let rx = D.x0 + 3; rx <= D.x1 - 9; rx += 4) {
      b.fill(rx, FL, rz, rx + 1, FL, rz + 1, "planks");
      b.set(rx + 1, FL + 1, rz, "planks");
      if (hash2(seed ^ 0xfd10, rx, rz) < 0.5) b.set(rx, FL + 1, rz + 1, "gold_block"); // fittings too good for tribute
    }
  }
  // weapon racks beside the held-back crates
  for (let z = 60; z <= 68; z += 2) {
    b.set(D.x1 - 7, FL, z, "iron_bars");
  }
  // the strongroom: an iron cage nobody outside the works has a key to
  b.fill(D.x1 - 5, FL, 58, D.x1 - 1, FL + 3, 62, "iron_bars");
  b.fill(D.x1 - 4, FL, 59, D.x1 - 2, FL + 3, 61, 0);
  b.fill(D.x1 - 5, FL, 60, D.x1 - 5, FL + 1, 60, 0); // the bent-open door
  b.set(D.x1 - 5, FL + 4, 60, "lantern");
  features.caches.push({ x: D.x1 - 2.5, y: FL, z: 60.5, table: "cache_foundry", respawnSec: 900 });
  // dock lighting: lanterns down the loading lane
  for (const lz of [62, 78, 94] as const) {
    b.fill(D.x0 + 1, FL, lz, D.x0 + 1, FL + 1, lz, "dark_bricks");
    b.set(D.x0 + 1, FL + 2, lz, "lantern");
  }

  // ---- gate courts: what a traveller sees first ---------------------------
  // the south court: the shift-change yard (spawn side)
  for (const [px, pz] of [
    [72, 126],
    [88, 126],
  ] as const) {
    b.fill(px, FL, pz, px, FL + 1, pz, "dark_bricks");
    b.set(px, FL + 2, pz, "lantern");
  }
  // ore carts abandoned mid-haul on the south lane
  b.fill(77, FL, 138, 78, FL, 139, "planks");
  b.set(77, FL + 1, 138, "dark_stone");
  b.set(83, FL, 142, "charred_log");
  b.set(84, FL, 143, "charred_log");
}
