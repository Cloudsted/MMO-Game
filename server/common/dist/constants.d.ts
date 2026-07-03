import { z } from "zod";
declare const ConstantsSchema: z.ZodObject<{
    movement: z.ZodObject<{
        walkSpeed: z.ZodNumber;
        gravity: z.ZodNumber;
        jumpVelocity: z.ZodNumber;
        playerRadius: z.ZodNumber;
        playerHeight: z.ZodNumber;
        eyeHeight: z.ZodNumber;
        swimSpeed: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        walkSpeed: number;
        gravity: number;
        jumpVelocity: number;
        playerRadius: number;
        playerHeight: number;
        eyeHeight: number;
        swimSpeed: number;
    }, {
        walkSpeed: number;
        gravity: number;
        jumpVelocity: number;
        playerRadius: number;
        playerHeight: number;
        eyeHeight: number;
        swimSpeed: number;
    }>;
    net: z.ZodObject<{
        protocolVersion: z.ZodNumber;
        simTickHz: z.ZodNumber;
        snapshotHz: z.ZodNumber;
        clientInputHz: z.ZodNumber;
        interestRadius: z.ZodNumber;
        keyframeEveryNSnapshots: z.ZodNumber;
        moveToleranceM: z.ZodNumber;
        ticketTtlMs: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        protocolVersion: number;
        simTickHz: number;
        snapshotHz: number;
        clientInputHz: number;
        interestRadius: number;
        keyframeEveryNSnapshots: number;
        moveToleranceM: number;
        ticketTtlMs: number;
    }, {
        protocolVersion: number;
        simTickHz: number;
        snapshotHz: number;
        clientInputHz: number;
        interestRadius: number;
        keyframeEveryNSnapshots: number;
        moveToleranceM: number;
        ticketTtlMs: number;
    }>;
    world: z.ZodObject<{
        cellSizeM: z.ZodNumber;
        chunkCells: z.ZodNumber;
        dayLengthSec: z.ZodNumber;
        maxStandableSlope: z.ZodNumber;
        terrainYToleranceM: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        cellSizeM: number;
        chunkCells: number;
        dayLengthSec: number;
        maxStandableSlope: number;
        terrainYToleranceM: number;
    }, {
        cellSizeM: number;
        chunkCells: number;
        dayLengthSec: number;
        maxStandableSlope: number;
        terrainYToleranceM: number;
    }>;
}, "strip", z.ZodTypeAny, {
    movement: {
        walkSpeed: number;
        gravity: number;
        jumpVelocity: number;
        playerRadius: number;
        playerHeight: number;
        eyeHeight: number;
        swimSpeed: number;
    };
    net: {
        protocolVersion: number;
        simTickHz: number;
        snapshotHz: number;
        clientInputHz: number;
        interestRadius: number;
        keyframeEveryNSnapshots: number;
        moveToleranceM: number;
        ticketTtlMs: number;
    };
    world: {
        cellSizeM: number;
        chunkCells: number;
        dayLengthSec: number;
        maxStandableSlope: number;
        terrainYToleranceM: number;
    };
}, {
    movement: {
        walkSpeed: number;
        gravity: number;
        jumpVelocity: number;
        playerRadius: number;
        playerHeight: number;
        eyeHeight: number;
        swimSpeed: number;
    };
    net: {
        protocolVersion: number;
        simTickHz: number;
        snapshotHz: number;
        clientInputHz: number;
        interestRadius: number;
        keyframeEveryNSnapshots: number;
        moveToleranceM: number;
        ticketTtlMs: number;
    };
    world: {
        cellSizeM: number;
        chunkCells: number;
        dayLengthSec: number;
        maxStandableSlope: number;
        terrainYToleranceM: number;
    };
}>;
export type GameConstants = z.infer<typeof ConstantsSchema>;
/** Loads shared/constants.json (validated). Cached after first load. */
export declare function gameConstants(): GameConstants;
export {};
//# sourceMappingURL=constants.d.ts.map