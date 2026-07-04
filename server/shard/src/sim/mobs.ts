/**
 * Mob AI: the decision layer (brain). A flat FSM per mob —
 * patrol/chase/flee/return — that communicates with the body (action FSM)
 * only through intents: "move toward X", "use ability at Y". That seam is
 * where behavior trees swap in later.
 */
import type { MobDef, SpawnTable } from "@fantasy-mmo/common";
import type { Entity } from "./entities.js";
import type { VoxelWorld } from "./voxel.js";

const STICKINESS_BONUS = 8; // score bonus for the current target (anti ping-pong)
const THREAT_WEIGHT = 2; // score per point of damage dealt
const RETURN_HEAL_PCT_PER_SEC = 0.2;
const WANDER_SPEED_MULT = 0.45;

export interface MoveIntent {
  x: number;
  z: number;
  speedMult: number;
}

export interface BrainDecision {
  move: MoveIntent | null;
  attack: Entity | null; // face + use ability on this target
  faceYaw: number | null;
}

/**
 * One brain tick. Pure decision — the caller applies movement (with terrain)
 * and routes attack intents into the shared action FSM.
 */
export function tickBrain(mob: Entity, def: MobDef, players: Entity[], now: number): BrainDecision {
  const b = mob.brain!;
  const none: BrainDecision = { move: null, attack: null, faceYaw: null };
  const distTo = (x: number, z: number) => Math.hypot(mob.pos.x - x, mob.pos.z - z);

  // body busy (mid-swing/stagger/dead): no new decisions
  const act = mob.combat!.act;
  if (act === "dead" || act === "windup" || act === "active" || act === "cast" || act === "stagger") return none;

  // returning home: heal-reset, ignore everything until arrival
  if (b.state === "return") {
    if (distTo(b.home.x, b.home.z) < 1.5) {
      mob.health!.hp = mob.health!.maxHp;
      b.state = "patrol";
      b.wanderTarget = null;
      return none;
    }
    mob.health!.hp = Math.min(mob.health!.maxHp, mob.health!.hp + def.hp * RETURN_HEAL_PCT_PER_SEC * 0.1);
    return { move: { x: b.home.x, z: b.home.z, speedMult: 1 }, attack: null, faceYaw: null };
  }

  // leash: dragged too far from home → reset
  if (distTo(b.home.x, b.home.z) > def.leashRadius) {
    b.state = "return";
    b.targetId = null;
    b.threat.clear();
    return { move: { x: b.home.x, z: b.home.z, speedMult: 1 }, attack: null, faceYaw: null };
  }

  // target selection: threat-weighted with stickiness, plus proximity aggro
  const alive = new Map(players.filter((p) => p.combat!.act !== "dead").map((p) => [p.id, p]));
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
        move: { x: mob.pos.x + Math.sin(away) * 6, z: mob.pos.z + Math.cos(away) * 6, speedMult: 1 },
        attack: null,
        faceYaw: null,
      };
    }
    const d = distTo(best.pos.x, best.pos.z);
    if (d > def.attackRange) {
      b.state = "chase";
      return { move: { x: best.pos.x, z: best.pos.z, speedMult: 1 }, attack: null, faceYaw: null };
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
 * Apply a move intent with voxel rules: walk at speed, deflect around
 * blockers, step up/down at most one block, never into water or lava,
 * keep headroom. Sets yaw + walk anim. Returns whether the mob moved.
 */
export function applyMove(
  e: Entity,
  intent: MoveIntent,
  baseSpeed: number,
  dt: number,
  world: VoxelWorld,
  bounds: { w: number; h: number },
  _waterLevel: number | null
): boolean {
  const dx = intent.x - e.pos.x;
  const dz = intent.z - e.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return false;
  const step = Math.min(baseSpeed * intent.speedMult * dt, dist);
  const baseAng = Math.atan2(dx, dz);
  for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
    const ang = baseAng + off;
    const nx = e.pos.x + Math.sin(ang) * step;
    const nz = e.pos.z + Math.cos(ang) * step;
    if (nx < 1 || nx > bounds.w - 1 || nz < 1 || nz > bounds.h - 1) continue;
    // ground under the new spot, allowing a 1-block step up from current feet
    const ny = world.groundBelow(nx, e.pos.y + 1.05, nz, 0.25);
    if (Math.abs(ny - e.pos.y) > 1.05) continue; // cliff or >1 step
    if (world.collidesAABB(nx, ny, nz, 0.3, 1.6)) continue; // headroom/blockers
    if (world.liquidAt(nx, ny + 0.1, nz)) continue; // don't wade in
    e.pos.x = nx;
    e.pos.z = nz;
    e.pos.y = ny;
    e.pos.yaw = ang;
    return true;
  }
  return false;
}

/** Find a legal spawn point in a spawn region (dry, unobstructed). */
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
    const y = world.standY(x, z);
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
