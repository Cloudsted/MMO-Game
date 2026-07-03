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
    kind: "player";
    pos: Position;
    renderable: Renderable;
}
export declare function allocEntityId(): number;
export declare function toFull(e: Entity): EntityFull;
/** Replicated mutable fields, used for per-viewer delta computation. */
export interface ReplicatedState {
    x: number;
    y: number;
    z: number;
    yaw: number;
    anim: string;
}
export declare function replicatedState(e: Entity): ReplicatedState;
/** Delta of changed fields vs. what a viewer last saw; null when unchanged. */
export declare function diffState(id: number, prev: ReplicatedState, curr: ReplicatedState): EntityDelta | null;
//# sourceMappingURL=entities.d.ts.map