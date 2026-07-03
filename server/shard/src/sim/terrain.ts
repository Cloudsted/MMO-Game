/**
 * Room terrain: deterministic seeded heightmap + ground-type map + prop
 * scatter, plus an optional authored map overlay (flattened areas, painted
 * ground, hand-placed props, walls) produced by tools/build-maps.mjs.
 * "Generate-once-then-persist" is currently satisfied by determinism (same
 * seed → identical terrain every boot); mutable room state persists via room
 * snapshots. The client receives this exact data over the wire — both sides
 * sample the SAME arrays, nothing is generated client-side.
 *
 * NEVER change the noise functions once rooms ship — they are the world.
 */
import { loadRoomMap, type RoomDef, type RoomMap } from "@fantasy-mmo/common";

export const GROUND_GRASS = 0;
export const GROUND_DIRT = 1;
export const GROUND_STONE = 2;
export const GROUND_SAND = 3;

const WALL_HALF_THICKNESS = 0.45;

export interface PropInstance {
  id: number;
  type: string; // registry key into the prop atlas ("tree1", "rock1", ...)
  x: number;
  z: number;
  /** collision cylinder radius in metres; 0 = walk-through */
  r: number;
  /** visual scale multiplier */
  s: number;
  /** facing in degrees (0 = front faces +Z); flat props only */
  rot: number;
}

export interface WallSegment {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  type: string;
}

// ---------- deterministic noise (no deps; NEVER change once rooms ship) ----------

function hash2(seed: number, x: number, y: number): number {
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

// ---------- terrain ----------

export class Terrain {
  /** cells */
  readonly w: number;
  readonly h: number;
  /** vertex grid, (w+1)*(h+1), row-major, metres */
  readonly heights: Float32Array;
  /** vertex grid ground types (GROUND_*) */
  readonly types: Uint8Array;
  readonly props: PropInstance[];
  readonly walls: WallSegment[];
  readonly waterLevel: number | null;

  constructor(def: RoomDef) {
    this.w = def.size.w;
    this.h = def.size.h;
    const vw = this.w + 1;
    const vh = this.h + 1;
    this.heights = new Float32Array(vw * vh);
    this.types = new Uint8Array(vw * vh);
    this.waterLevel = def.terrain.waterLevel ?? null;

    const t = def.terrain;
    const seed = t.seed ?? 1;
    const amp = t.amplitude ?? 0;
    const freq = t.frequency ?? 0.04;
    const flat = t.kind === "flat";

    for (let z = 0; z < vh; z++) {
      for (let x = 0; x < vw; x++) {
        let y = flat ? (t.height ?? 0) : (fbm(seed, x * freq, z * freq, 4) * 0.5 + 0.5) * amp * 2;
        if (!flat && t.plateauRadius) {
          // flatten around spawn with a smooth shoulder
          const dx = x - def.spawn.x;
          const dz = z - def.spawn.z;
          const d = Math.hypot(dx, dz);
          const r = t.plateauRadius;
          if (d < r * 1.6) {
            const plateauY = amp; // mid-band height so the shoulder blends both ways
            const k = d <= r ? 0 : smooth((d - r) / (r * 0.6));
            y = plateauY + (y - plateauY) * k;
          }
        }
        this.heights[z * vw + x] = y;
      }
    }

    const map = def.map ? loadRoomMap(def.map) : null;
    if (map) this.applyFlatten(map);

    // ground types from slope + noise patches (soft rules, vertex-resolution)
    for (let z = 0; z < vh; z++) {
      for (let x = 0; x < vw; x++) {
        const slope = this.slopeAtVertex(x, z);
        const patch = valueNoise(seed ^ 0x5f3c, x * 0.11, z * 0.11);
        let type = GROUND_GRASS;
        if (slope > 1.1) type = GROUND_STONE;
        else if (slope > 0.55) type = GROUND_DIRT;
        else if (patch > 0.83) type = GROUND_DIRT;
        // sandy shores just above the waterline
        if (this.waterLevel !== null) {
          const y = this.heights[z * vw + x]!;
          if (y < this.waterLevel + 0.45 && slope < 0.8) type = GROUND_SAND;
        }
        this.types[z * vw + x] = type;
      }
    }
    if (map) this.applyPaints(map);

    this.props = map && map.props.length > 0 ? this.authoredProps(map) : this.scatterProps(def);
    this.walls = map ? map.walls : [];

    // every portal gets a stone archway facing the room spawn
    for (const portal of def.portals) {
      const dx = def.spawn.x - portal.x;
      const dz = def.spawn.z - portal.z;
      this.props.push({
        id: this.props.length + 1,
        type: "arch",
        x: portal.x,
        z: portal.z,
        r: 0, // walk-through: the trigger volume is the portal itself
        s: 1,
        rot: Math.abs(dx) > Math.abs(dz) ? 90 : 0,
      });
    }
  }

  private applyFlatten(map: RoomMap): void {
    const vw = this.w + 1;
    for (const f of map.flatten) {
      const pad = 3; // smooth shoulder outside the rect
      for (let z = Math.max(0, Math.floor(f.z0 - pad)); z <= Math.min(this.h, Math.ceil(f.z1 + pad)); z++) {
        for (let x = Math.max(0, Math.floor(f.x0 - pad)); x <= Math.min(this.w, Math.ceil(f.x1 + pad)); x++) {
          const dx = Math.max(f.x0 - x, 0, x - f.x1);
          const dz = Math.max(f.z0 - z, 0, z - f.z1);
          const d = Math.hypot(dx, dz);
          const i = z * vw + x;
          if (d <= 0) this.heights[i] = f.height;
          else if (d < pad) {
            const k = smooth(d / pad);
            this.heights[i] = f.height + (this.heights[i]! - f.height) * k;
          }
        }
      }
    }
  }

  private applyPaints(map: RoomMap): void {
    const vw = this.w + 1;
    const paint = (x: number, z: number, type: number) => {
      if (x >= 0 && x <= this.w && z >= 0 && z <= this.h) this.types[z * vw + x] = type;
    };
    for (const p of map.paints) {
      if (p.shape === "rect") {
        for (let z = Math.floor(p.z0); z <= Math.ceil(p.z1); z++)
          for (let x = Math.floor(p.x0); x <= Math.ceil(p.x1); x++) paint(x, z, p.type);
      } else if (p.shape === "circle") {
        for (let z = Math.floor(p.z - p.r); z <= Math.ceil(p.z + p.r); z++)
          for (let x = Math.floor(p.x - p.r); x <= Math.ceil(p.x + p.r); x++)
            if (Math.hypot(x - p.x, z - p.z) <= p.r) paint(x, z, p.type);
      } else {
        // path: stamp circles along each segment
        for (let i = 0; i + 1 < p.points.length; i++) {
          const [ax, az] = p.points[i]!;
          const [bx, bz] = p.points[i + 1]!;
          const len = Math.hypot(bx - ax, bz - az);
          const steps = Math.max(1, Math.ceil(len * 2));
          for (let s = 0; s <= steps; s++) {
            const cx = ax + ((bx - ax) * s) / steps;
            const cz = az + ((bz - az) * s) / steps;
            const r = p.width / 2;
            for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
              for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
                if (Math.hypot(x - cx, z - cz) <= r) paint(x, z, p.type);
          }
        }
      }
    }
  }

  private authoredProps(map: RoomMap): PropInstance[] {
    return map.props.map((p, i) => ({ id: i + 1, type: p.type, x: p.x, z: p.z, r: p.r, s: p.s, rot: p.rot }));
  }

  private slopeAtVertex(x: number, z: number): number {
    const vw = this.w + 1;
    const x0 = Math.max(0, x - 1);
    const x1 = Math.min(this.w, x + 1);
    const z0 = Math.max(0, z - 1);
    const z1 = Math.min(this.h, z + 1);
    const dx = (this.heights[z * vw + x1]! - this.heights[z * vw + x0]!) / (x1 - x0);
    const dz = (this.heights[z1 * vw + x]! - this.heights[z0 * vw + x]!) / (z1 - z0);
    return Math.hypot(dx, dz);
  }

  /** Bilinear height sample; clamps to bounds. THE ground truth for movement. */
  heightAt(x: number, z: number): number {
    const vw = this.w + 1;
    const cx = Math.min(Math.max(x, 0), this.w - 1e-4);
    const cz = Math.min(Math.max(z, 0), this.h - 1e-4);
    const xi = Math.floor(cx);
    const zi = Math.floor(cz);
    const tx = cx - xi;
    const tz = cz - zi;
    const a = this.heights[zi * vw + xi]!;
    const b = this.heights[zi * vw + xi + 1]!;
    const c = this.heights[(zi + 1) * vw + xi]!;
    const d = this.heights[(zi + 1) * vw + xi + 1]!;
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  /** True when (x,z) is inside a solid prop cylinder or wall segment. */
  collides(x: number, z: number): boolean {
    for (const prop of this.props) {
      if (prop.r > 0 && Math.hypot(x - prop.x, z - prop.z) < prop.r) return true;
    }
    for (const w of this.walls) {
      if (distToSegment(x, z, w.x0, w.z0, w.x1, w.z1) < WALL_HALF_THICKNESS) return true;
    }
    return false;
  }

  private scatterProps(def: RoomDef): PropInstance[] {
    const props: PropInstance[] = [];
    const gen = def.propGen;
    if (!gen) return props;
    let id = 1;
    const place = (count: number, types: Array<{ type: string; r: number }>, salt: number) => {
      let attempts = 0;
      let placed = 0;
      while (placed < count && attempts < count * 30) {
        attempts++;
        const rx = hash2(gen.seed + salt, attempts, 17) * (this.w - 8) + 4;
        const rz = hash2(gen.seed + salt, attempts, 91) * (this.h - 8) + 4;
        if (Math.hypot(rx - def.spawn.x, rz - def.spawn.z) < gen.clearRadius) continue;
        if (def.portals.some((p) => Math.hypot(rx - p.x, rz - p.z) < p.r + 3)) continue;
        if (this.slopeAt(rx, rz) > 0.9) continue; // no trees on cliffs
        if (this.waterLevel !== null && this.heightAt(rx, rz) < this.waterLevel + 0.3) continue; // not in ponds
        if (props.some((p) => Math.hypot(p.x - rx, p.z - rz) < 3)) continue;
        const pick = types[Math.floor(hash2(gen.seed + salt, attempts, 3) * types.length)]!;
        props.push({
          id: id++,
          type: pick.type,
          x: Math.round(rx * 100) / 100,
          z: Math.round(rz * 100) / 100,
          r: pick.r,
          s: 0.9 + hash2(gen.seed + salt, attempts, 7) * 0.35,
          rot: 0,
        });
        placed++;
      }
    };
    place(gen.trees, [
      { type: "tree1", r: 0.55 },
      { type: "tree2", r: 0.5 },
      { type: "tree3", r: 0.5 },
      { type: "tree4", r: 0.5 },
    ], 1000);
    place(gen.rocks, [{ type: "rock1", r: 0.5 }, { type: "rock2", r: 0.45 }], 2000);
    return props;
  }

  private slopeAt(x: number, z: number): number {
    const e = 0.75;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  /** Wire form: heights as int16 centimetres LE, types as bytes, both base64. */
  encode(): { w: number; h: number; heightsB64: string; typesB64: string; waterLevel: number | null } {
    const int16 = new Int16Array(this.heights.length);
    for (let i = 0; i < this.heights.length; i++) {
      int16[i] = Math.max(-32000, Math.min(32000, Math.round(this.heights[i]! * 100)));
    }
    return {
      w: this.w,
      h: this.h,
      heightsB64: Buffer.from(int16.buffer).toString("base64"),
      typesB64: Buffer.from(this.types).toString("base64"),
      waterLevel: this.waterLevel,
    };
  }
}

/** Distance from point (px,pz) to segment (x0,z0)-(x1,z1). */
export function distToSegment(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq === 0 ? 0 : ((px - x0) * dx + (pz - z0) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + dx * t), pz - (z0 + dz * t));
}
