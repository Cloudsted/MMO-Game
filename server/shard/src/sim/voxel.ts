/**
 * Room voxel world: a bounded block grid (w × WORLD_HEIGHT × h), generated
 * deterministically from the room def (seeded noise terrain + biome surface +
 * trees + decorations), then stamped with authored block structures
 * (voxelstructures.ts). Player block edits live in a sparse overlay that
 * persists via room snapshots and re-applies over generation on restore.
 *
 * Both runtimes sample the SAME data: the full grid ships to clients as
 * deflated 16×16×H chunks. NEVER change the noise functions once rooms ship.
 */
import { deflateRawSync } from "node:zlib";
import {
  BLOCK,
  BLOCKS,
  CHUNK,
  WORLD_HEIGHT,
  isSolidBlock,
  isLiquidBlock,
  type RoomDef,
} from "@fantasy-mmo/common";
import { stampStructures } from "./voxelstructures.js";
import type { ScatterResult } from "./prefabs.js";

// ---------- deterministic noise (shared style with the old heightmap gen) ----------

export function hash2(seed: number, x: number, y: number): number {
  let h = (seed | 0) ^ (x * 374761393) ^ (y * 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296; // [0,1)
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const a = hash2(seed, xi, yi);
  const b = hash2(seed, xi + 1, yi);
  const c = hash2(seed, xi, yi + 1);
  const d = hash2(seed, xi + 1, yi + 1);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty; // [0,1)
}

function fbm(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(seed + i * 1013, x * freq, y * freq) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm; // ~[-1,1]
}

// ---------- world ----------

const AIR = 0;

export interface BlockEdit {
  x: number;
  y: number;
  z: number;
  id: number;
  /** character id that placed it (breaking refunds only player blocks) */
  owner: string | null;
}

export class VoxelWorld {
  readonly w: number; // x extent in blocks
  readonly h: number; // z extent in blocks
  readonly data: Uint8Array;
  readonly waterLevel: number | null;
  /** player edits keyed "x,y,z" — the persistence overlay */
  readonly edits = new Map<string, BlockEdit>();
  /** prefab-scatter output: placements, loot caches, spawn bindings —
   *  deterministic per def, so RoomSim can consume it every boot */
  readonly features: ScatterResult;
  /** pristine post-generation snapshot — edits that restore it are dropped */
  private genData!: Uint8Array;

  constructor(def: RoomDef) {
    this.w = def.size.w;
    this.h = def.size.h;
    this.data = new Uint8Array(this.w * this.h * WORLD_HEIGHT);
    this.waterLevel = def.terrain.waterLevel ?? null;
    this.generate(def);
    this.features = stampStructures(this, def);
    this.genData = this.data.slice();
  }

  idx(x: number, y: number, z: number): number {
    return x + z * this.w + y * this.w * this.h;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.w && y >= 0 && y < WORLD_HEIGHT && z >= 0 && z < this.h;
  }

  /** Block id at integer coords; out-of-bounds reads as air. */
  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return AIR;
    return this.data[this.idx(x, y, z)]!;
  }

  set(x: number, y: number, z: number, id: number): void {
    if (!this.inBounds(x, y, z)) return;
    this.data[this.idx(x, y, z)] = id;
  }

  /** Set only if the cell is currently air (tree canopies, decorations). */
  setIfAir(x: number, y: number, z: number, id: number): void {
    if (!this.inBounds(x, y, z)) return;
    const i = this.idx(x, y, z);
    if (this.data[i] === AIR) this.data[i] = id;
  }

  solidAt(x: number, y: number, z: number): boolean {
    return isSolidBlock(this.get(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  liquidAt(x: number, y: number, z: number): boolean {
    return isLiquidBlock(this.get(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  /** Highest non-air block y at a column (-1 if the column is empty). */
  surfaceY(x: number, z: number): number {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (this.get(xi, y, zi) !== AIR) return y;
    }
    return -1;
  }

  /** Feet Y for standing on top of the column's highest SOLID block. */
  standY(x: number, z: number): number {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (isSolidBlock(this.get(xi, y, zi))) return y + 1;
    }
    return 1;
  }

  /**
   * Feet Y for the LOWEST walkable gap in a column: solid below, two
   * non-solid cells of headroom above. This is the FLOOR — the ground under
   * a tree canopy or a structure roof, where standY would return the top of
   * the canopy/roof itself. Falls back to standY when no gap exists.
   */
  floorY(x: number, z: number): number {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    for (let y = 1; y < WORLD_HEIGHT - 1; y++) {
      if (!isSolidBlock(this.get(xi, y - 1, zi))) continue;
      if (isSolidBlock(this.get(xi, y, zi)) || isSolidBlock(this.get(xi, y + 1, zi))) continue;
      return y;
    }
    return this.standY(x, z);
  }

  /**
   * The ground level under an entity at (x, feetY, z): top of the highest
   * solid block at or below feetY across the entity's footprint. Overhang-
   * safe (a roof above doesn't count). Feet exactly on a block top belong
   * to the block below.
   */
  groundBelow(x: number, feetY: number, z: number, radius: number): number {
    const x0 = Math.floor(x - radius);
    const x1 = Math.floor(x + radius);
    const z0 = Math.floor(z - radius);
    const z1 = Math.floor(z + radius);
    const yTop = Math.min(WORLD_HEIGHT - 1, Math.floor(feetY + 1e-6));
    let best = 0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (let y = yTop; y >= 0; y--) {
          if (isSolidBlock(this.get(cx, y, cz))) {
            const top = y + 1;
            if (top <= feetY + 1e-4 && top > best) best = top;
            break;
          }
        }
      }
    }
    return best;
  }

  /** True when a player-shaped AABB (feet at y) intersects any solid block. */
  collidesAABB(x: number, y: number, z: number, radius: number, height: number): boolean {
    const x0 = Math.floor(x - radius);
    const x1 = Math.floor(x + radius);
    const z0 = Math.floor(z - radius);
    const z1 = Math.floor(z + radius);
    const y0 = Math.floor(y + 1e-4);
    const y1 = Math.floor(y + height - 1e-4);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        for (let cz = z0; cz <= z1; cz++) {
          if (isSolidBlock(this.get(cx, cy, cz))) return true;
        }
      }
    }
    return false;
  }

  // ---------- player edits (persistence overlay) ----------

  editKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  /** Apply a player edit and remember it for room snapshots. An edit that
   *  restores the generated block (e.g. breaking a placed block over natural
   *  air) drops out of the overlay entirely. */
  applyEdit(x: number, y: number, z: number, id: number, owner: string | null): void {
    if (!this.inBounds(x, y, z)) return;
    const key = this.editKey(x, y, z);
    this.set(x, y, z, id);
    if (id === this.genData[this.idx(x, y, z)]) {
      this.edits.delete(key);
    } else {
      this.edits.set(key, { x, y, z, id, owner });
    }
  }

  /** The edit record at a cell, if a player placed the current block. */
  editAt(x: number, y: number, z: number): BlockEdit | null {
    return this.edits.get(this.editKey(x, y, z)) ?? null;
  }

  restoreEdits(edits: BlockEdit[]): void {
    for (const e of edits) {
      if (!this.inBounds(e.x, e.y, e.z) || !BLOCKS[e.id]) continue;
      this.set(e.x, e.y, e.z, e.id);
      this.edits.set(this.editKey(e.x, e.y, e.z), e);
    }
  }

  serializeEdits(): BlockEdit[] {
    return [...this.edits.values()];
  }

  /** Revert every player edit to the generated block. Returns reverted cells. */
  clearEdits(): Array<{ x: number; y: number; z: number; id: number }> {
    const out: Array<{ x: number; y: number; z: number; id: number }> = [];
    for (const e of this.edits.values()) {
      const gen = this.genData[this.idx(e.x, e.y, e.z)]!;
      this.set(e.x, e.y, e.z, gen);
      out.push({ x: e.x, y: e.y, z: e.z, id: gen });
    }
    this.edits.clear();
    return out;
  }

  // ---------- wire ----------

  /** Full grid as deflated per-chunk payloads (base64). Chunk data is
   *  x-fastest, then z, then y — matching idx() within the chunk. */
  encodeChunks(): Array<{ cx: number; cz: number; data: string }> {
    const out: Array<{ cx: number; cz: number; data: string }> = [];
    const cw = Math.ceil(this.w / CHUNK);
    const ch = Math.ceil(this.h / CHUNK);
    const buf = new Uint8Array(CHUNK * CHUNK * WORLD_HEIGHT);
    for (let cz = 0; cz < ch; cz++) {
      for (let cx = 0; cx < cw; cx++) {
        let i = 0;
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          for (let lz = 0; lz < CHUNK; lz++) {
            for (let lx = 0; lx < CHUNK; lx++) {
              buf[i++] = this.get(cx * CHUNK + lx, y, cz * CHUNK + lz);
            }
          }
        }
        out.push({ cx, cz, data: deflateRawSync(buf).toString("base64") });
      }
    }
    return out;
  }

  // ---------- generation ----------

  /** Terrain surface height (block y of the top solid terrain block). */
  terrainHeight(def: RoomDef, x: number, z: number): number {
    const t = def.terrain;
    let y = t.base + fbm(t.seed, x * t.frequency, z * t.frequency, 4) * t.amplitude;
    if (t.plateauRadius) {
      const d = Math.hypot(x - def.spawn.x, z - def.spawn.z);
      const r = t.plateauRadius;
      if (d < r * 1.6) {
        const k = d <= r ? 0 : smooth((d - r) / (r * 0.6));
        y = t.base + (y - t.base) * k;
      }
    }
    return Math.max(3, Math.min(WORLD_HEIGHT - 10, Math.round(y)));
  }

  /** Trunk height at a column (0 = no tree here). Deterministic per column.
   *  Grass grows oaks; swamp grows pale dead trees; volcanic grows charred
   *  snags (same column/height rolls — the branch only opens for NEW biomes,
   *  so existing grass rooms stay byte-identical). */
  private treeAt(def: RoomDef, x: number, z: number): number {
    if (def.biome !== "grass" && def.biome !== "swamp" && def.biome !== "volcanic") return 0;
    const density = (def.terrain.treeDensity ?? 1) * 0.012;
    if (hash2(def.terrain.seed ^ 0x7ee5, x, z) >= density) return 0;
    // keep clear of spawn, portals, and NPC posts (canopies reach 2 blocks
    // out, so 4 keeps trunks AND leaves off every NPC's standing column) —
    // per-column exclusions only; the noise functions stay untouched
    if (Math.hypot(x - def.spawn.x, z - def.spawn.z) < 8) return 0;
    for (const p of def.portals) if (Math.hypot(x - p.x, z - p.z) < 6) return 0;
    for (const n of def.npcs) if (Math.hypot(x - n.x, z - n.z) < 4) return 0;
    const h = this.terrainHeight(def, x, z);
    if (this.waterLevel !== null && h <= this.waterLevel + 1) return 0;
    return 4 + Math.floor(hash2(def.terrain.seed ^ 0x555, x, z) * 3);
  }

  private generate(def: RoomDef): void {
    const t = def.terrain;
    const GRASS = BLOCK.grass!.id;
    const DIRT = BLOCK.dirt!.id;
    const STONE = BLOCK.stone!.id;
    const SAND = BLOCK.sand!.id;
    const BEDROCK = BLOCK.bedrock!.id;
    const LOG = BLOCK.log!.id;
    const LEAVES = BLOCK.leaves!.id;
    const MOSSY = BLOCK.mossy_cobblestone!.id;
    const PATH = BLOCK.path!.id;
    const SANDSTONE = BLOCK.sandstone!.id;
    // terrain.liquid names the block that fills up to waterLevel (default water)
    const LIQUID = (BLOCK[t.liquid ?? "water"] ?? BLOCK.water!).id;
    // worldgen-overhaul biome palette (swamp / volcanic)
    const MUD = BLOCK.mud!.id;
    const DARK_STONE = BLOCK.dark_stone!.id;
    const OBSIDIAN = BLOCK.obsidian!.id;
    const ASH = BLOCK.ash!.id;
    const swamp = def.biome === "swamp";
    const volcanic = def.biome === "volcanic";

    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        const h = this.terrainHeight(def, x, z);
        const beach = this.waterLevel !== null && h <= this.waterLevel;
        const patch = valueNoise(t.seed ^ 0x5f3c, x * 0.11, z * 0.11);
        for (let y = 0; y <= h; y++) {
          let b: number;
          if (y === 0) b = BEDROCK;
          else if (y < h - 3) b = volcanic ? DARK_STONE : STONE;
          else if (y < h) {
            if (swamp) b = MUD;
            else if (volcanic) b = DARK_STONE;
            else b = def.biome === "desert" || beach ? SAND : DIRT;
          } else {
            // surface block
            if (def.biome === "desert") b = patch > 0.9 ? SANDSTONE : SAND;
            else if (def.biome === "dungeon") b = patch > 0.82 ? PATH : patch < 0.14 ? MOSSY : STONE;
            else if (swamp) b = beach ? MUD : patch > 0.62 ? GRASS : MUD;
            else if (volcanic) b = patch > 0.85 ? OBSIDIAN : patch < 0.2 ? ASH : DARK_STONE;
            else if (beach) b = SAND;
            else b = GRASS;
          }
          this.data[this.idx(x, y, z)] = b;
        }
        if (this.waterLevel !== null) {
          for (let y = h + 1; y <= this.waterLevel; y++) this.data[this.idx(x, y, z)] = LIQUID;
        }
      }
    }

    // trees: margin scan so canopies cross the whole room seamlessly
    const PALE_LOG = BLOCK.pale_log!.id;
    const DEAD_LEAVES = BLOCK.dead_leaves!.id;
    const CHARRED_LOG = BLOCK.charred_log!.id;
    const VINES = BLOCK.vines!.id;
    for (let z = -3; z < this.h + 3; z++) {
      for (let x = -3; x < this.w + 3; x++) {
        const th = this.treeAt(def, x, z);
        if (!th) continue;
        const h = this.terrainHeight(def, x, z);
        if (volcanic) {
          // charred snag: bare trunk, no canopy
          for (let dy = 1; dy <= th; dy++) this.set(x, h + dy, z, CHARRED_LOG);
          continue;
        }
        if (swamp) {
          // pale dead tree: thin dead-leaves cap + vines hanging off the trunk
          for (let dy = th; dy <= th + 1; dy++) {
            const rad = 1;
            for (let dx = -rad; dx <= rad; dx++) {
              for (let dz = -rad; dz <= rad; dz++) {
                if (Math.abs(dx) === rad && Math.abs(dz) === rad && hash2(t.seed ^ 0x3d1b, x + dx, z + dz + dy * 31) < 0.7)
                  continue;
                this.setIfAir(x + dx, h + 1 + dy, z + dz, DEAD_LEAVES);
              }
            }
          }
          for (let dy = 1; dy <= th; dy++) this.set(x, h + dy, z, PALE_LOG);
          const sides = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const;
          for (let dy = 1; dy < th; dy++) {
            for (let s = 0; s < 4; s++) {
              if (hash2(t.seed ^ 0x71e5, x * 4 + s, z + dy * 57) < 0.3) {
                this.setIfAir(x + sides[s]![0], h + dy, z + sides[s]![1], VINES);
              }
            }
          }
          continue;
        }
        for (let dy = th - 2; dy <= th + 1; dy++) {
          const rad = dy >= th ? 1 : 2;
          for (let dx = -rad; dx <= rad; dx++) {
            for (let dz = -rad; dz <= rad; dz++) {
              if (Math.abs(dx) === rad && Math.abs(dz) === rad && hash2(t.seed, x + dx, z + dz + dy * 31) < 0.5)
                continue;
              this.setIfAir(x + dx, h + 1 + dy, z + dz, LEAVES);
            }
          }
        }
        for (let dy = 1; dy <= th; dy++) this.set(x, h + dy, z, LOG);
      }
    }

    // surface decorations (only on intact grass / biome floor)
    const TGRASS = BLOCK.tall_grass!.id;
    const FLOWER_R = BLOCK.flower_red!.id;
    const FLOWER_Y = BLOCK.flower_yellow!.id;
    const MUSH_R = BLOCK.mushroom_red!.id;
    const MUSH_B = BLOCK.mushroom_brown!.id;
    const REEDS = BLOCK.reeds!.id;
    const GLOW_SHROOM = BLOCK.glow_shroom!.id;
    const EMBER_CRYSTAL = BLOCK.ember_crystal!.id;
    const BONE_BLOCK = BLOCK.bone_block!.id;
    // reeds hug the liquid: true when a column within 2 blocks is flooded
    const nearLiquid = (x: number, z: number): boolean => {
      if (this.waterLevel === null) return false;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dz === 0) continue;
          if (this.terrainHeight(def, x + dx, z + dz) < this.waterLevel) return true;
        }
      }
      return false;
    };
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        const h = this.terrainHeight(def, x, z);
        const surf = this.get(x, h, z);
        const r = hash2(t.seed ^ 0x999, x, z);
        if (swamp) {
          // new-biome branch (new hash salts; existing biomes untouched below)
          if (surf === MUD || surf === GRASS) {
            const r2 = hash2(t.seed ^ 0x51ee, x, z);
            if (r2 < 0.1 && nearLiquid(x, z)) this.setIfAir(x, h + 1, z, REEDS);
            else if (r2 < 0.008) this.setIfAir(x, h + 1, z, GLOW_SHROOM);
            else if (surf === GRASS && r2 > 0.9) this.setIfAir(x, h + 1, z, TGRASS);
          }
        } else if (volcanic) {
          if (surf === DARK_STONE || surf === ASH) {
            const r2 = hash2(t.seed ^ 0xa5f1, x, z);
            if (r2 < 0.004) this.setIfAir(x, h + 1, z, EMBER_CRYSTAL);
            else if (r2 < 0.01) {
              // bleached bone pairs mark the husk fields
              this.setIfAir(x, h + 1, z, BONE_BLOCK);
              this.setIfAir(x + 1, h + 1, z, BONE_BLOCK);
            }
          }
        } else if (surf === GRASS) {
          if (r < 0.07) this.setIfAir(x, h + 1, z, TGRASS);
          else if (r < 0.085) this.setIfAir(x, h + 1, z, hash2(t.seed, x, z + 7) < 0.5 ? FLOWER_R : FLOWER_Y);
        } else if (def.biome === "dungeon" && (surf === STONE || surf === MOSSY)) {
          if (r < 0.02) this.setIfAir(x, h + 1, z, r < 0.01 ? MUSH_B : MUSH_R);
        } else if (def.biome === "desert" && surf === SAND) {
          // scattered dead trees + sandstone boulders stand in for props
          if (r < 0.004) {
            const th = 2 + Math.floor(hash2(t.seed, x, z + 3) * 3);
            for (let dy = 1; dy <= th; dy++) this.setIfAir(x, h + dy, z, LOG);
          } else if (r < 0.007) {
            this.setIfAir(x, h + 1, z, SANDSTONE);
            if (r < 0.0055) this.setIfAir(x + 1, h + 1, z, SANDSTONE);
          }
        }
      }
    }
  }
}
