/**
 * Mob AI: the decision layer (brain). A flat FSM per mob —
 * patrol/chase/flee/return — that communicates with the body (action FSM)
 * only through intents: "move toward X", "use ability at Y". That seam is
 * where behavior trees swap in later.
 */
import { isSolidBlock, type AbilityDef, type MobDef, type SpawnTable } from "@fantasy-mmo/common";
import type { Entity } from "./entities.js";
import type { VoxelWorld } from "./voxel.js";

const STICKINESS_BONUS = 8; // score bonus for the current target (anti ping-pong)
const THREAT_WEIGHT = 2; // score per point of damage dealt
const RETURN_HEAL_PCT_PER_SEC = 0.2;
const WANDER_SPEED_MULT = 0.45;

/** Min center-to-center distance between alive mobs (owner-tuned: 0.9 read
 *  as too spread out — packs may bunch, just not merge into one sprite). */
export const MOB_SEPARATION = 0.45;
/** How fast overlapping mobs push apart (m/s) — gentle, not a teleport. */
const SEPARATION_PUSH_SPEED = 2.0;
/** Mobs on ledges more than this far above/below don't crowd each other. */
const SEPARATION_Y_TOLERANCE = 1.5;
/** Purposeful movement (chase/flee/return) may drop this many blocks in a
 *  step — a mob that somehow ends up on a tree canopy or ledge can always
 *  get DOWN to its target. Wandering keeps the 1-block limit so idle mobs
 *  don't dive off cliffs. Tallest oak canopy top is ~7 above the floor. */
export const PURPOSEFUL_MAX_DROP = 8;
/** Default per-step drop for wander/separation (mirror of the 1-step-up). */
const DEFAULT_MAX_DROP = 1.05;
/** Drops up to this deep snap to the lower floor like walking down a step;
 *  anything deeper means the mob walks OFF the ledge and FALLS under
 *  gravity (applyGravity) instead of teleporting to the ground. */
const STEP_SNAP_DOWN = 1.05;
/** How fast a submerged mob floats up toward the swim surface (m/s). */
const BUOYANCY_RISE_SPEED = 3.0;
/** Liquid this deep or less is waded on the flooded floor; deeper columns
 *  are swum at the surface. (Mob height is 1.6 — 1.5 keeps the head out.) */
const WADE_DEPTH = 1.5;

export interface MoveIntent {
  x: number;
  z: number;
  speedMult: number;
  /** max blocks this move may step DOWN (default ~1; chase/flee/return
   *  pass PURPOSEFUL_MAX_DROP so treed/ledged mobs can drop to targets) */
  maxDrop?: number;
  /** purposeful moves may cross liquid: wade shallow runs on the flooded
   *  floor, swim deep water at the surface. Wander never wades — idle mobs
   *  don't stroll into ponds, and standing across a lava trench no longer
   *  cheeses melee mobs that want to reach you. */
  wade?: boolean;
}

export interface BrainDecision {
  move: MoveIntent | null;
  attack: Entity | null; // face + use ability on this target
  faceYaw: number | null;
}

/** One resolved entry of a mob's attack kit (registry data + ability def). */
export interface AttackOption {
  id: string; // ability id (also the cooldown key)
  ability: AbilityDef;
  damage: number;
  minRange: number;
  weight: number;
}

/** What a mob should do about a target it decided to attack. */
export type AttackChoice =
  | { kind: "use"; option: AttackOption } // start this ability
  | { kind: "wait" } // usable option exists but is cooling down: hold ground
  | { kind: "close" }; // nothing in the kit connects from here: move closer

/**
 * Pick from a mob's attack kit against a target: options must be inside
 * their range window (minRange..reach — melee reach is ability.range+grace
 * with the vertical gate, projectiles use the mob's attackRange and aim
 * with pitch) and off cooldown; several usable at once → weighted roll.
 * When everything in range is cooling down, mixed kits CLOSE toward melee
 * (a skeleton advances between bow shots) while pure-ranged mobs hold.
 */
export function chooseAttack(
  mob: Entity,
  target: Entity,
  options: AttackOption[],
  now: number,
  attackRange: number,
  meleeGrace: number,
  meleeReachY: number
): AttackChoice {
  const d = Math.hypot(target.pos.x - mob.pos.x, target.pos.z - mob.pos.z);
  const dy = Math.abs(target.pos.y - mob.pos.y);
  const usable: AttackOption[] = [];
  let inRange = false;
  let meleeInRange = false;
  let hasMelee = false;
  for (const o of options) {
    if (o.ability.kind === "melee") hasMelee = true;
    if (d < o.minRange) continue;
    if (o.ability.kind === "melee") {
      if (d > (o.ability.range ?? 2) + meleeGrace || dy > meleeReachY) continue;
      meleeInRange = true;
    } else if (o.ability.kind === "projectile" || o.ability.kind === "pillars") {
      if (d > attackRange) continue;
    }
    inRange = true;
    if ((mob.combat!.cooldowns.get(o.id) ?? 0) > now) continue;
    usable.push(o);
  }
  if (usable.length === 0) {
    if (!inRange) return { kind: "close" };
    return hasMelee && !meleeInRange ? { kind: "close" } : { kind: "wait" };
  }
  let total = 0;
  for (const o of usable) total += o.weight;
  let roll = Math.random() * total;
  for (const o of usable) {
    roll -= o.weight;
    if (roll <= 0) return { kind: "use", option: o };
  }
  return { kind: "use", option: usable[usable.length - 1]! };
}

/**
 * One brain tick. Pure decision — the caller applies movement (with terrain)
 * and routes attack intents into the shared action FSM. `attackReachY` is
 * the max |feet-Y delta| at which this mob's attack can land (melee vertical
 * reach; Infinity for projectile mobs, which aim with real pitch) — targets
 * 2D-close but vertically out of reach are CHASED (with drop-down moves),
 * never punched through canopies and floors.
 */
export function tickBrain(
  mob: Entity,
  def: MobDef,
  players: Entity[],
  now: number,
  attackReachY: number = Number.POSITIVE_INFINITY
): BrainDecision {
  const b = mob.brain!;
  const none: BrainDecision = { move: null, attack: null, faceYaw: null };
  const distTo = (x: number, z: number) => Math.hypot(mob.pos.x - x, mob.pos.z - z);
  const homeDistOf = (p: Entity) => Math.hypot(p.pos.x - b.home.x, p.pos.z - b.home.z);

  // body busy (mid-swing/stagger/dead): no new decisions
  const act = mob.combat!.act;
  if (act === "dead" || act === "windup" || act === "active" || act === "cast" || act === "stagger") return none;

  const alive = new Map(players.filter((p) => p.combat!.act !== "dead").map((p) => [p.id, p]));

  // returning home: heal, ignore attackers — UNLESS one keeps fighting from
  // inside the leash circle (they're reachable; no invincible-runback while
  // you stand at the camp shooting)
  if (b.state === "return") {
    let reengage: Entity | null = null;
    for (const [id, threat] of b.threat) {
      const p = alive.get(id);
      if (threat > 0 && p && homeDistOf(p) <= def.leashRadius) {
        reengage = p;
        break;
      }
    }
    if (!reengage) {
      if (distTo(b.home.x, b.home.z) < 1.5) {
        mob.health!.hp = mob.health!.maxHp;
        b.state = "patrol";
        b.wanderTarget = null;
        return none;
      }
      mob.health!.hp = Math.min(mob.health!.maxHp, mob.health!.hp + def.hp * RETURN_HEAL_PCT_PER_SEC * 0.1);
      return { move: { x: b.home.x, z: b.home.z, speedMult: 1, maxDrop: PURPOSEFUL_MAX_DROP, wade: true }, attack: null, faceYaw: null };
    }
    // target them BEFORE the leash check below — the mob may still stand
    // outside the circle, and a null targetId would re-leash it instantly
    b.state = "chase";
    b.targetId = reengage.id;
  }

  // leash: dragged too far from home → reset. A live target still inside
  // the leash circle keeps the mob engaged — ranged players fighting near
  // the camp no longer bounce mobs off an invisible wall; kiting away
  // still resets the moment BOTH stand outside.
  if (distTo(b.home.x, b.home.z) > def.leashRadius) {
    const tgt = b.targetId !== null ? alive.get(b.targetId) : undefined;
    if (!tgt || homeDistOf(tgt) > def.leashRadius) {
      b.state = "return";
      b.targetId = null;
      b.threat.clear();
      return { move: { x: b.home.x, z: b.home.z, speedMult: 1, maxDrop: PURPOSEFUL_MAX_DROP, wade: true }, attack: null, faceYaw: null };
    }
  }

  // target selection: threat-weighted with stickiness, plus proximity aggro
  for (const id of [...b.threat.keys()]) if (!alive.has(id)) b.threat.delete(id);

  let best: Entity | null = null;
  let bestScore = -Infinity;
  for (const p of alive.values()) {
    const d = distTo(p.pos.x, p.pos.z);
    const threat = b.threat.get(p.id) ?? 0;
    if (threat <= 0 && d > def.aggroRadius) continue; // not hostile yet, out of aggro range
    const score = threat * THREAT_WEIGHT - d + (p.id === b.targetId ? STICKINESS_BONUS : 0);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  b.targetId = best?.id ?? null;

  if (best) {
    // flee at low HP (per-mob registry threshold)
    if (def.fleeAtHpPct > 0 && mob.health!.hp / mob.health!.maxHp < def.fleeAtHpPct) {
      b.state = "flee";
      const away = Math.atan2(mob.pos.x - best.pos.x, mob.pos.z - best.pos.z);
      return {
        move: { x: mob.pos.x + Math.sin(away) * 6, z: mob.pos.z + Math.cos(away) * 6, speedMult: 1, maxDrop: PURPOSEFUL_MAX_DROP, wade: true },
        attack: null,
        faceYaw: null,
      };
    }
    const d = distTo(best.pos.x, best.pos.z);
    const dy = Math.abs(best.pos.y - mob.pos.y);
    if (d > def.attackRange || dy > attackReachY) {
      b.state = "chase";
      return { move: { x: best.pos.x, z: best.pos.z, speedMult: 1, maxDrop: PURPOSEFUL_MAX_DROP, wade: true }, attack: null, faceYaw: null };
    }
    b.state = "chase";
    const face = Math.atan2(best.pos.x - mob.pos.x, best.pos.z - mob.pos.z);
    return { move: null, attack: best, faceYaw: face };
  }

  // patrol: wander near home
  b.state = "patrol";
  if (b.wanderTarget && distTo(b.wanderTarget.x, b.wanderTarget.z) > 0.8) {
    return { move: { x: b.wanderTarget.x, z: b.wanderTarget.z, speedMult: WANDER_SPEED_MULT }, attack: null, faceYaw: null };
  }
  b.wanderTarget = null;
  if (now >= b.nextWanderAt) {
    b.nextWanderAt = now + 3000 + Math.random() * 5000;
    const ang = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 6;
    b.wanderTarget = { x: b.home.x + Math.sin(ang) * r, z: b.home.z + Math.cos(ang) * r };
  }
  return none;
}

/**
 * Would standing at (nx,nz) push e deeper into a neighbour's personal space?
 * Moves that keep or grow the distance stay legal, so already-overlapping
 * mobs can always walk their way out.
 */
function crowdsNeighbour(e: Entity, nx: number, nz: number, others: Entity[]): boolean {
  for (const o of others) {
    if (o === e || Math.abs(o.pos.y - e.pos.y) > SEPARATION_Y_TOLERANCE) continue;
    const d = Math.hypot(nx - o.pos.x, nz - o.pos.z);
    if (d >= MOB_SEPARATION) continue;
    const cur = Math.hypot(e.pos.x - o.pos.x, e.pos.z - o.pos.z);
    if (d < cur - 1e-6) return true;
  }
  return false;
}

/**
 * Apply a move intent with voxel rules: walk at speed, deflect around
 * blockers, step up/down at most one block, keep headroom. Liquid blocks
 * the way UNLESS the intent wades (purposeful moves): shallow runs are
 * crossed on the flooded floor, deep water is swum at the surface.
 * `others` are packmates whose personal space deflects the path too (mobs
 * fan out instead of stacking). Sets yaw + walk anim.
 * Returns whether the mob moved.
 */
export function applyMove(
  e: Entity,
  intent: MoveIntent,
  baseSpeed: number,
  dt: number,
  world: VoxelWorld,
  bounds: { w: number; h: number },
  _waterLevel: number | null,
  others: Entity[] = []
): boolean {
  const dx = intent.x - e.pos.x;
  const dz = intent.z - e.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return false;
  const step = Math.min(baseSpeed * intent.speedMult * dt, dist);
  const maxDrop = intent.maxDrop ?? DEFAULT_MAX_DROP;
  const baseAng = Math.atan2(dx, dz);
  for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
    const ang = baseAng + off;
    const nx = e.pos.x + Math.sin(ang) * step;
    const nz = e.pos.z + Math.cos(ang) * step;
    if (nx < 1 || nx > bounds.w - 1 || nz < 1 || nz > bounds.h - 1) continue;
    if (crowdsNeighbour(e, nx, nz, others)) continue; // don't walk into a packmate
    // ground under the new spot: at most a 1-block step UP, and down by the
    // intent's drop allowance (purposeful moves may hop off canopies/ledges)
    let ny = world.groundBelow(nx, e.pos.y + 1.05, nz, 0.25);
    if (world.liquidAt(nx, ny + 0.1, nz)) {
      if (!intent.wade) continue; // wander doesn't stroll into ponds
      // wade shallow liquid on the flooded floor; swim deep at the surface
      let surf = ny;
      while (surf - ny < 12 && world.liquidAt(nx, surf + 0.1, nz)) surf++;
      if (surf - ny > WADE_DEPTH) ny = surf - 1;
    }
    if (ny - e.pos.y > 1.05 || e.pos.y - ny > maxDrop) continue;
    // steps and shallow drops snap like stairs; deeper drops walk OFF the
    // ledge at the current height — applyGravity then pulls the mob down
    // over the following ticks (no more instant teleport-to-the-floor)
    const applyY = e.pos.y - ny > STEP_SNAP_DOWN ? e.pos.y : ny;
    if (world.collidesAABB(nx, applyY, nz, 0.3, 1.6)) continue; // headroom/blockers
    e.pos.x = nx;
    e.pos.z = nz;
    e.pos.y = applyY;
    e.pos.yaw = ang;
    return true;
  }
  return false;
}

/**
 * Per-tick vertical physics for mobs (players run their own client-predicted
 * physics). An entity above the ground under its feet accelerates downward
 * and lands when it reaches it — mobs walking off ledges/canopies FALL like
 * players do instead of snapping instantly. In liquid gravity is off and
 * buoyancy floats the mob up to the swim surface (feet in the top liquid
 * cell) so 1-block banks stay climbable after a plunge.
 * Returns true while airborne — callers skip walking (no air control).
 */
export function applyGravity(e: Entity, dt: number, world: VoxelWorld, gravity: number): boolean {
  if (world.liquidAt(e.pos.x, e.pos.y + 0.1, e.pos.z)) {
    e.vy = 0;
    let surf = Math.floor(e.pos.y);
    while (surf - e.pos.y < 12 && world.liquidAt(e.pos.x, surf + 0.1, e.pos.z)) surf++;
    const surface = surf - 1;
    if (e.pos.y < surface) e.pos.y = Math.min(surface, e.pos.y + BUOYANCY_RISE_SPEED * dt);
    return false;
  }
  const floor = world.groundBelow(e.pos.x, e.pos.y + 0.05, e.pos.z, 0.25);
  if (e.pos.y <= floor + 1e-4) {
    e.vy = 0;
    return false;
  }
  e.vy = (e.vy ?? 0) + gravity * dt;
  const ny = e.pos.y + e.vy * dt;
  if (ny <= floor) {
    e.pos.y = floor;
    e.vy = 0;
    return false; // landed this tick — walking resumes immediately
  }
  e.pos.y = ny;
  return true;
}

/**
 * Soft-separate overlapping mobs: every pair closer than MOB_SEPARATION
 * pushes apart at SEPARATION_PUSH_SPEED (handles spawn stacks and mobs
 * knocked together — applyMove's crowding check prevents the rest). Pushes
 * accumulate symmetrically first, then each result is validated with the
 * same voxel rules as walking so nobody gets shoved into a wall, off a
 * cliff, or into liquid. Yaw is untouched — mobs keep facing their target.
 */
export function separateEntities(
  list: Entity[],
  dt: number,
  world: VoxelWorld,
  bounds: { w: number; h: number }
): void {
  if (list.length < 2) return;
  const maxPush = SEPARATION_PUSH_SPEED * dt;
  const push = new Map<Entity, { x: number; z: number }>();
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      if (Math.abs(a.pos.y - b.pos.y) > SEPARATION_Y_TOLERANCE) continue;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= MOB_SEPARATION) continue;
      // direction a→b; perfectly stacked pairs split along a stable per-pair angle
      let ux: number;
      let uz: number;
      if (d < 1e-4) {
        const ang = (((a.id * 31 + b.id * 17) % 64) / 64) * Math.PI * 2;
        ux = Math.sin(ang);
        uz = Math.cos(ang);
      } else {
        ux = dx / d;
        uz = dz / d;
      }
      const strength = (MOB_SEPARATION - d) * 0.5;
      const pa = push.get(a) ?? { x: 0, z: 0 };
      pa.x -= ux * strength;
      pa.z -= uz * strength;
      push.set(a, pa);
      const pb = push.get(b) ?? { x: 0, z: 0 };
      pb.x += ux * strength;
      pb.z += uz * strength;
      push.set(b, pb);
    }
  }
  for (const [e, p] of push) {
    const mag = Math.hypot(p.x, p.z);
    if (mag < 1e-4) continue;
    const step = Math.min(mag, maxPush);
    const nx = e.pos.x + (p.x / mag) * step;
    const nz = e.pos.z + (p.z / mag) * step;
    if (nx < 1 || nx > bounds.w - 1 || nz < 1 || nz > bounds.h - 1) continue;
    const ny = world.groundBelow(nx, e.pos.y + 1.05, nz, 0.25);
    if (Math.abs(ny - e.pos.y) > 1.05) continue;
    if (world.collidesAABB(nx, ny, nz, 0.3, 1.6)) continue;
    if (world.liquidAt(nx, ny + 0.1, nz)) continue;
    e.pos.x = nx;
    e.pos.z = nz;
    e.pos.y = ny;
  }
}

// ---------- stuck recovery: bounded local pathfinding ----------

const PATH_RADIUS = 24; // cells the BFS may wander from the start
const PATH_NODE_CAP = 900;
/** ~this many ticks of zero progress trigger a path computation */
export const STUCK_TICKS_FOR_PATH = 4;

/**
 * Bounded BFS over the walkable floor grid (solid below, 2 of headroom,
 * step up ≤1, drop ≤2.5, liquid only when wading) from the mob toward a
 * goal column. Deflection steering handles the open field; this recovers
 * CONCAVE traps — the throne a boss spawns behind, building shells, wall
 * corners. Returns coarse waypoints (every 2nd cell, cell centers), routed
 * to the goal or, when the goal is unreachable, to the explored cell
 * closest to it. Null when even that is no better than standing still.
 */
export function pathfindWaypoints(
  world: VoxelWorld,
  from: { x: number; y: number; z: number },
  to: { x: number; z: number },
  wade: boolean
): Array<{ x: number; z: number }> | null {
  const sx = Math.floor(from.x);
  const sz = Math.floor(from.z);
  const tx = Math.floor(to.x);
  const tz = Math.floor(to.z);
  const key = (x: number, z: number) => x * 4096 + z;
  const feet = new Map<number, number>();
  const parent = new Map<number, number>();
  const startY = world.walkYNear(from.x, from.z, from.y);
  feet.set(key(sx, sz), startY);
  const queue: Array<[number, number, number]> = [[sx, sz, startY]];
  let bestKey = key(sx, sz);
  let bestD = Math.hypot(sx - tx, sz - tz);
  let found = false;
  for (let head = 0; head < queue.length && head < PATH_NODE_CAP; head++) {
    const [x, z, y] = queue[head]!;
    const dGoal = Math.hypot(x - tx, z - tz);
    if (dGoal < bestD) {
      bestD = dGoal;
      bestKey = key(x, z);
    }
    if (x === tx && z === tz) {
      found = true;
      bestKey = key(x, z);
      break;
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (Math.abs(nx - sx) > PATH_RADIUS || Math.abs(nz - sz) > PATH_RADIUS) continue;
      const k = key(nx, nz);
      if (feet.has(k)) continue;
      const ny = world.walkYNear(nx + 0.5, nz + 0.5, y);
      if (ny - y > 1.05 || y - ny > 2.5) continue; // step/drop limits
      // walkYNear falls back to standY on gapless columns — verify the gap
      if (isSolidBlock(world.get(nx, ny, nz)) || isSolidBlock(world.get(nx, ny + 1, nz))) continue;
      if (!isSolidBlock(world.get(nx, ny - 1, nz))) continue;
      if (!wade && world.liquidAt(nx + 0.5, ny + 0.1, nz + 0.5)) continue;
      feet.set(k, ny);
      parent.set(k, key(x, z));
      queue.push([nx, nz, ny]);
    }
  }
  // reconstruct from goal (or the closest explored cell)
  if (!found && bestD >= Math.hypot(sx - tx, sz - tz) - 1.5) return null; // no real improvement
  const cells: Array<{ x: number; z: number }> = [];
  let cur: number | undefined = bestKey;
  while (cur !== undefined && cur !== key(sx, sz)) {
    cells.push({ x: Math.floor(cur / 4096) + 0.5, z: (cur % 4096) + 0.5 });
    cur = parent.get(cur);
  }
  cells.reverse();
  if (cells.length === 0) return null;
  // coarse waypoints: every 2nd cell, always keeping the final one
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < cells.length; i++) {
    if (i % 2 === 1 || i === cells.length - 1) out.push(cells[i]!);
  }
  return out.length ? out : null;
}

/** Find a legal spawn point in a spawn region (dry, unobstructed, ON THE
 *  FLOOR — floorY lands under tree canopies/roofs, never on top of them). */
export function findSpawnPoint(
  table: SpawnTable,
  world: VoxelWorld,
  _waterLevel: number | null
): { x: number; z: number } | null {
  for (let i = 0; i < 24; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * table.region.r;
    const x = table.region.x + Math.sin(ang) * r;
    const z = table.region.z + Math.cos(ang) * r;
    const y = world.floorY(x, z);
    if (world.liquidAt(x, y + 0.1, z)) continue;
    if (world.collidesAABB(x, y, z, 0.3, 1.6)) continue;
    return { x, z };
  }
  return null;
}

/** Weighted mob pick from a spawn table. */
export function pickMob(table: SpawnTable): string {
  const total = table.mobs.reduce((s, m) => s + m.weight, 0);
  let roll = Math.random() * total;
  for (const m of table.mobs) {
    roll -= m.weight;
    if (roll <= 0) return m.mob;
  }
  return table.mobs[0]!.mob;
}
