/**
 * Action FSM mechanics + combat math. Pure-ish helpers: state legality,
 * timing advance, melee cones, projectile stepping. Damage application,
 * death, XP, and broadcasting stay in RoomSim (they touch sessions/loot).
 *
 * The FSM (idle/move/windup/active/cast/recover/stagger/dead) is shared by
 * players and mobs — input and AI are just two intent producers.
 */
import { abilityDmgClass, type AbilityDef } from "@fantasy-mmo/common";
import type { Combat, Entity } from "./entities.js";

/** States from which a new ability may be started. */
export function canAct(c: Combat): boolean {
  return c.act === "idle" || c.act === "move";
}

/** Movement multiplier from an active slow (1 = none). Shared by player
 *  move validation and the mob tick so the two paths can never drift. */
export function slowMult(c: Combat, now: number): number {
  return c.slowUntil > now && c.slowPct > 0 ? 1 - c.slowPct : 1;
}

/** True while the entity may not move (per-ability canMoveWhile flag). */
export function isMovementLocked(c: Combat, ability: AbilityDef | null): boolean {
  if (c.act === "dead" || c.act === "stagger") return true;
  if ((c.act === "windup" || c.act === "active" || c.act === "cast") && ability && !ability.canMoveWhile) return true;
  return false;
}

/**
 * Begin an ability: melee/bow enter windup, spells enter cast. Returns false
 * when the FSM state, cooldown, or mana forbids it. Mana/cooldown are charged
 * up front (interrupts refund mana — see interrupt()).
 */
export function startAbility(
  e: Entity,
  abilityId: string,
  ability: AbilityDef,
  damage: number,
  aimYaw: number,
  aimPitch: number,
  now: number,
  speedMult = 1
): boolean {
  const c = e.combat!;
  if (!canAct(c)) return false;
  if ((c.cooldowns.get(abilityId) ?? 0) > now) return false;
  if (ability.manaCost > 0) {
    if (!e.mana || e.mana.mana < ability.manaCost) return false;
    e.mana.mana -= ability.manaCost;
  }
  c.ability = abilityId;
  c.pendingDamage = damage;
  c.aimYaw = aimYaw;
  c.aimPitch = aimPitch;
  c.speedMult = speedMult;
  if (ability.castTimeMs !== undefined) {
    c.act = "cast";
    c.actEndsAt = now + Math.round(ability.castTimeMs / speedMult);
  } else {
    c.act = "windup";
    c.actEndsAt = now + Math.round((ability.windupMs ?? 0) / speedMult);
  }
  if (ability.cooldownMs > 0) c.cooldowns.set(abilityId, now + Math.round(ability.cooldownMs / speedMult));
  return true;
}

/** What advancing the FSM produced this step. */
export type FsmFire = "melee-hit" | "release" | null;

/**
 * Advance the FSM when the current state's timer elapses.
 * windup → active (melee hit window opens / bow releases), active → recover,
 * cast → release → recover, recover/stagger → idle.
 *
 * Each next stage is timed from the PREVIOUS stage's end (not from `now`):
 * ticks run at 10 Hz, and restarting every stage's timer at the tick that
 * noticed it stretched a 3-stage ability by up to ~300 ms over what clients
 * predict — the drift behind "the swing animated but nothing happened".
 */
export function advanceFsm(e: Entity, ability: AbilityDef | null, now: number): FsmFire {
  const c = e.combat!;
  if (c.actEndsAt === 0 || now < c.actEndsAt || c.act === "dead") return null;
  switch (c.act) {
    case "windup": {
      c.act = "active";
      c.actEndsAt += Math.round((ability?.activeMs ?? 100) / c.speedMult);
      return ability?.kind === "melee" ? "melee-hit" : "release";
    }
    case "cast": {
      c.act = "recover";
      c.actEndsAt += Math.round((ability?.recoverMs ?? 200) / c.speedMult);
      return "release";
    }
    case "active": {
      c.act = "recover";
      c.actEndsAt += Math.round((ability?.recoverMs ?? 200) / c.speedMult);
      return null;
    }
    case "recover":
    case "stagger": {
      c.act = "idle";
      c.actEndsAt = 0;
      c.ability = null;
      return null;
    }
    default:
      return null;
  }
}

/**
 * Damage taken during an interruptible windup/cast breaks the ability into
 * stagger. Mana is refunded (the spell never released). Returns true when
 * an interrupt happened.
 */
export function interruptIfCasting(e: Entity, ability: AbilityDef | null, staggerMs: number, now: number): boolean {
  const c = e.combat!;
  if ((c.act !== "cast" && c.act !== "windup") || !ability || !ability.interruptible) return false;
  if (ability.manaCost > 0 && e.mana) e.mana.mana = Math.min(e.mana.maxMana, e.mana.mana + ability.manaCost);
  if (c.ability && ability.cooldownMs > 0) c.cooldowns.delete(c.ability);
  c.act = "stagger";
  c.actEndsAt = now + staggerMs;
  c.ability = null;
  return true;
}

/** Is target inside attacker's melee cone (range + half-arc around aimYaw)?
 *  maxDy gates the VERTICAL reach — feet more than that apart can't trade
 *  melee blows (no more canopy boars goring players 5 blocks below). */
export function inMeleeCone(attacker: Entity, target: Entity, range: number, arcDeg: number, rangeGrace: number, maxDy: number): boolean {
  if (Math.abs(target.pos.y - attacker.pos.y) > maxDy) return false;
  const dx = target.pos.x - attacker.pos.x;
  const dz = target.pos.z - attacker.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > range + rangeGrace) return false;
  if (dist < 0.05) return true; // standing inside each other
  // yaw convention: yaw = atan2(dx, dz), 0 faces +Z
  const toTarget = Math.atan2(dx, dz);
  let rel = toTarget - attacker.combat!.aimYaw;
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel < -Math.PI) rel += 2 * Math.PI;
  return Math.abs(rel) <= (arcDeg * Math.PI) / 180 / 2;
}

// ---------- projectiles ----------

export interface Projectile {
  id: number;
  fx: string;
  ownerId: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  debuff: { slowPct?: number; dotTotal?: number; durMs: number } | null;
  startX: number;
  startZ: number;
  maxRangeSq: number;
  dieAt: number;
  /** splash radius at the impact point (0 = direct hit only) */
  aoeRadius: number;
  /** impact flipbook for the wire (explosion) */
  impactFx: string | null;
  /** render scale for the wire (big boss fireball) */
  scale: number;
  /** damage class at impact (arrows=ranged, spells=magic) — taken-modifier
   *  and armor-mitigation routing in applyDamage */
  dmgClass: "melee" | "ranged" | "magic";
}

let nextProjId = 1;
export function allocProjId(): number {
  return nextProjId++;
}

export function makeProjectile(
  owner: Entity,
  ability: AbilityDef,
  damage: number,
  now: number
): Projectile {
  const c = owner.combat!;
  const speed = ability.projSpeed ?? 20;
  const maxRange = ability.maxRange ?? 40;
  const cosP = Math.cos(c.aimPitch);
  // muzzle at eye height, slightly forward so it can't instantly hit self
  const dirX = Math.sin(c.aimYaw) * cosP;
  const dirY = Math.sin(c.aimPitch);
  const dirZ = Math.cos(c.aimYaw) * cosP;
  const x = owner.pos.x + dirX * 0.6;
  const y = owner.pos.y + 1.45 + dirY * 0.6;
  const z = owner.pos.z + dirZ * 0.6;
  return {
    id: allocProjId(),
    fx: ability.fx,
    ownerId: owner.id,
    x, y, z,
    vx: dirX * speed,
    vy: dirY * speed,
    vz: dirZ * speed,
    damage,
    debuff: ability.debuff ?? null,
    startX: x,
    startZ: z,
    maxRangeSq: maxRange * maxRange,
    dieAt: now + (maxRange / speed) * 1000 + 250,
    aoeRadius: ability.aoeRadius ?? 0,
    impactFx: ability.impactFx ?? null,
    scale: ability.projScale ?? 1,
    dmgClass: abilityDmgClass(ability) ?? "magic",
  };
}

/** Cylinder hit test at the projectile's current position. */
export function projectileHits(p: Projectile, e: Entity, hitRadius: number): boolean {
  const dx = e.pos.x - p.x;
  const dz = e.pos.z - p.z;
  if (dx * dx + dz * dz > hitRadius * hitRadius) return false;
  return p.y >= e.pos.y - 0.1 && p.y <= e.pos.y + 1.9;
}
