import { z } from "zod";
import { resolve } from "node:path";
import { readJsonFile } from "./json.js";
import { SHARED_DIR } from "./paths.js";

const ConstantsSchema = z.object({
  movement: z.object({
    walkSpeed: z.number(),
    gravity: z.number(),
    jumpVelocity: z.number(),
    playerRadius: z.number(),
    playerHeight: z.number(),
    eyeHeight: z.number(),
    swimSpeed: z.number(),
  }),
  net: z.object({
    protocolVersion: z.number().int(),
    simTickHz: z.number(),
    snapshotHz: z.number(),
    clientInputHz: z.number(),
    interestRadius: z.number(),
    keyframeEveryNSnapshots: z.number().int(),
    moveToleranceM: z.number(),
    ticketTtlMs: z.number().int(),
  }),
  world: z.object({
    cellSizeM: z.number(),
    chunkCells: z.number().int(),
    dayLengthSec: z.number(),
    maxStandableSlope: z.number(),
    terrainYToleranceM: z.number(),
  }),
});

export type GameConstants = z.infer<typeof ConstantsSchema>;

let cached: GameConstants | null = null;

/** Loads shared/constants.json (validated). Cached after first load. */
export function gameConstants(): GameConstants {
  if (!cached) {
    cached = ConstantsSchema.parse(readJsonFile(resolve(SHARED_DIR, "constants.json")));
  }
  return cached;
}
