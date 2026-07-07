/**
 * Entity model: id + component bag. Systems iterate entities and read/write
 * components — no inheritance. Players, mobs, NPCs, and loot bags are all
 * the same shape with different bags.
 */
import type { EntityFull, EntityDelta, ItemStack, LootView } from "@fantasy-mmo/common";

export interface Position {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Renderable {
  sprite: string;
  anim: string;
  name?: string;
}

/** Action FSM states — the body, shared by players and mobs alike. */
export type ActState = "idle" | "move" | "windup" | "active" | "cast" | "recover" | "stagger" | "dead";

export interface Combat {
  act: ActState;
  actEndsAt: number; // ms epoch when the current state auto-advances (0 = never)
  /** ability id being executed (windup/active/cast/recover) */
  ability: string | null;
  /** damage the pending ability will deal (item/mob/level/rarity resolved at use time) */
  pendingDamage: number;
  aimYaw: number;
  aimPitch: number;
  /** held item's speed roll scaling the current ability's timings (1 = base) */
  speedMult: number;
  cooldowns: Map<string, number>; // abilityId → ready-at ms epoch
  lastDamagedAt: number;
  slowPct: number; // 0 = no slow
  slowUntil: number;
  /** heal-over-time from food: hpPerSec until hotUntil */
  hotPerSec: number;
  hotUntil: number;
  /** damage-over-time (poison): hp/sec until dotUntil, mirror of the food
   *  HoT. Fractions accumulate in dotAcc and land as whole-point bites
   *  through the room's damage path, attributed to dotSrcId (the applier). */
  dotPerSec: number;
  dotUntil: number;
  dotAcc: number;
  dotSrcId: number;
}

export function freshCombat(): Combat {
  return {
    act: "idle",
    actEndsAt: 0,
    ability: null,
    pendingDamage: 0,
    aimYaw: 0,
    aimPitch: 0,
    speedMult: 1,
    cooldowns: new Map(),
    lastDamagedAt: 0,
    slowPct: 0,
    slowUntil: 0,
    hotPerSec: 0,
    hotUntil: 0,
    dotPerSec: 0,
    dotUntil: 0,
    dotAcc: 0,
    dotSrcId: 0,
  };
}

export interface Health {
  hp: number;
  maxHp: number;
}

export interface ManaPool {
  mana: number;
  maxMana: number;
}

/** Mob-only decision layer (the brain). Talks to the body via intents only. */
export interface MobBrain {
  mobId: string; // registry key
  state: "patrol" | "chase" | "flee" | "return";
  home: { x: number; z: number };
  spawnerId: string;
  targetId: number | null;
  threat: Map<number, number>; // entity id → accumulated damage
  nextWanderAt: number;
  wanderTarget: { x: number; z: number } | null;
}

/** A dropped loot bag in the world. */
export interface LootBag {
  items: ItemStack[];
  gold: number;
  owner: string | null; // character id holding the lock
  unlockAt: number;
  expireAt: number | null;
}

export interface Entity {
  id: number;
  kind: "player" | "mob" | "npc" | "loot";
  pos: Position;
  /** vertical velocity while airborne (mob gravity — see applyGravity) */
  vy?: number;
  renderable: Renderable;
  level?: number;
  health?: Health;
  mana?: ManaPool;
  combat?: Combat;
  brain?: MobBrain;
  loot?: LootBag;
  /** replicated bag contents (rarest first, ≤3) — RoomSim keeps it in sync
   *  with loot.items so clients can render the actual dropped items */
  lootView?: LootView;
  /** npc registry id (dialog/shop lookup) */
  npcId?: string;
}

let nextId = 1;
export function allocEntityId(): number {
  return nextId++;
}

function actMs(e: Entity, now: number): number | undefined {
  if (!e.combat) return undefined;
  if (e.combat.actEndsAt === 0) return 0;
  return Math.max(0, Math.round(e.combat.actEndsAt - now));
}

export function toFull(e: Entity, now: number): EntityFull {
  return {
    id: e.id,
    kind: e.kind,
    name: e.renderable.name,
    sprite: e.renderable.sprite,
    x: e.pos.x,
    y: e.pos.y,
    z: e.pos.z,
    yaw: e.pos.yaw,
    anim: e.renderable.anim,
    hp: e.health ? Math.ceil(e.health.hp) : undefined,
    maxHp: e.health?.maxHp,
    level: e.level,
    act: e.combat?.act,
    actMs: actMs(e, now),
    loot: e.kind === "loot" ? (e.lootView ?? []) : undefined,
  };
}

/** Replicated mutable fields, used for per-viewer delta computation. */
export interface ReplicatedState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: string;
  hp: number | undefined;
  act: string | undefined;
  /** compact loot-contents signature so partial pickups delta out */
  lootSig: string | undefined;
}

export function replicatedState(e: Entity): ReplicatedState {
  return {
    x: e.pos.x,
    y: e.pos.y,
    z: e.pos.z,
    yaw: e.pos.yaw,
    anim: e.renderable.anim,
    hp: e.health ? Math.ceil(e.health.hp) : undefined,
    act: e.combat?.act,
    lootSig: e.lootView?.map((l) => `${l.item}:${l.rarity}`).join(","),
  };
}

/** Delta of changed fields vs. what a viewer last saw; null when unchanged.
 *  act changes carry actMs so clients can run the telegraph timer. */
export function diffState(e: Entity, prev: ReplicatedState, curr: ReplicatedState, now: number): EntityDelta | null {
  const d: EntityDelta = { id: e.id };
  let changed = false;
  if (curr.x !== prev.x) { d.x = curr.x; changed = true; }
  if (curr.y !== prev.y) { d.y = curr.y; changed = true; }
  if (curr.z !== prev.z) { d.z = curr.z; changed = true; }
  if (curr.yaw !== prev.yaw) { d.yaw = curr.yaw; changed = true; }
  if (curr.anim !== prev.anim) { d.anim = curr.anim; changed = true; }
  if (curr.hp !== prev.hp && curr.hp !== undefined) { d.hp = curr.hp; changed = true; }
  if (curr.act !== prev.act && curr.act !== undefined) {
    d.act = curr.act;
    d.actMs = actMs(e, now);
    changed = true;
  }
  if (curr.lootSig !== prev.lootSig && curr.lootSig !== undefined) {
    d.loot = e.lootView ?? [];
    changed = true;
  }
  return changed ? d : null;
}
