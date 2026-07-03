/**
 * Entity model: id + component bag. Phase 1 carries only what replication
 * needs; combat/AI/inventory components arrive in later phases. Systems
 * iterate entities and read/write components — no inheritance.
 */
import type { EntityFull, EntityDelta } from "@fantasy-mmo/common";

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

export interface Entity {
  id: number;
  kind: "player"; // "mob" | "npc" | "item" | ... in later phases
  pos: Position;
  renderable: Renderable;
}

let nextId = 1;
export function allocEntityId(): number {
  return nextId++;
}

export function toFull(e: Entity): EntityFull {
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
  };
}

/** Replicated mutable fields, used for per-viewer delta computation. */
export interface ReplicatedState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: string;
}

export function replicatedState(e: Entity): ReplicatedState {
  return { x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.pos.yaw, anim: e.renderable.anim };
}

/** Delta of changed fields vs. what a viewer last saw; null when unchanged. */
export function diffState(id: number, prev: ReplicatedState, curr: ReplicatedState): EntityDelta | null {
  const d: EntityDelta = { id };
  let changed = false;
  if (curr.x !== prev.x) { d.x = curr.x; changed = true; }
  if (curr.y !== prev.y) { d.y = curr.y; changed = true; }
  if (curr.z !== prev.z) { d.z = curr.z; changed = true; }
  if (curr.yaw !== prev.yaw) { d.yaw = curr.yaw; changed = true; }
  if (curr.anim !== prev.anim) { d.anim = curr.anim; changed = true; }
  return changed ? d : null;
}
