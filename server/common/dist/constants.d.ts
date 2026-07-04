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
    combat: z.ZodObject<{
        critChance: z.ZodNumber;
        critMult: z.ZodNumber;
        staggerMs: z.ZodNumber;
        projectileHitRadius: z.ZodNumber;
        meleeRangeGrace: z.ZodNumber;
        hpRegenPerSec: z.ZodNumber;
        manaRegenPerSec: z.ZodNumber;
        regenDelayAfterDamageMs: z.ZodNumber;
        lootLockMobMs: z.ZodNumber;
        lootLockDeathMs: z.ZodNumber;
        mobLootExpireMs: z.ZodNumber;
        pickupRange: z.ZodNumber;
        talkRange: z.ZodNumber;
        sellFraction: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        critChance: number;
        critMult: number;
        staggerMs: number;
        projectileHitRadius: number;
        meleeRangeGrace: number;
        hpRegenPerSec: number;
        manaRegenPerSec: number;
        regenDelayAfterDamageMs: number;
        lootLockMobMs: number;
        lootLockDeathMs: number;
        mobLootExpireMs: number;
        pickupRange: number;
        talkRange: number;
        sellFraction: number;
    }, {
        critChance: number;
        critMult: number;
        staggerMs: number;
        projectileHitRadius: number;
        meleeRangeGrace: number;
        hpRegenPerSec: number;
        manaRegenPerSec: number;
        regenDelayAfterDamageMs: number;
        lootLockMobMs: number;
        lootLockDeathMs: number;
        mobLootExpireMs: number;
        pickupRange: number;
        talkRange: number;
        sellFraction: number;
    }>;
    building: z.ZodObject<{
        placeRangeM: z.ZodNumber;
        maxPlayerBlocksPerRoom: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        placeRangeM: number;
        maxPlayerBlocksPerRoom: number;
    }, {
        placeRangeM: number;
        maxPlayerBlocksPerRoom: number;
    }>;
    progression: z.ZodObject<{
        baseHp: z.ZodNumber;
        hpPerLevel: z.ZodNumber;
        baseMana: z.ZodNumber;
        manaPerLevel: z.ZodNumber;
        damagePerLevelPct: z.ZodNumber;
        xpBase: z.ZodNumber;
        xpExponent: z.ZodNumber;
        maxLevel: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        baseHp: number;
        hpPerLevel: number;
        baseMana: number;
        manaPerLevel: number;
        damagePerLevelPct: number;
        xpBase: number;
        xpExponent: number;
        maxLevel: number;
    }, {
        baseHp: number;
        hpPerLevel: number;
        baseMana: number;
        manaPerLevel: number;
        damagePerLevelPct: number;
        xpBase: number;
        xpExponent: number;
        maxLevel: number;
    }>;
    world: z.ZodObject<{
        worldHeight: z.ZodNumber;
        chunkBlocks: z.ZodNumber;
        dayLengthSec: z.ZodNumber;
        terrainYToleranceM: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        worldHeight: number;
        chunkBlocks: number;
        dayLengthSec: number;
        terrainYToleranceM: number;
    }, {
        worldHeight: number;
        chunkBlocks: number;
        dayLengthSec: number;
        terrainYToleranceM: number;
    }>;
}, "strip", z.ZodTypeAny, {
    building: {
        placeRangeM: number;
        maxPlayerBlocksPerRoom: number;
    };
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
    combat: {
        critChance: number;
        critMult: number;
        staggerMs: number;
        projectileHitRadius: number;
        meleeRangeGrace: number;
        hpRegenPerSec: number;
        manaRegenPerSec: number;
        regenDelayAfterDamageMs: number;
        lootLockMobMs: number;
        lootLockDeathMs: number;
        mobLootExpireMs: number;
        pickupRange: number;
        talkRange: number;
        sellFraction: number;
    };
    progression: {
        baseHp: number;
        hpPerLevel: number;
        baseMana: number;
        manaPerLevel: number;
        damagePerLevelPct: number;
        xpBase: number;
        xpExponent: number;
        maxLevel: number;
    };
    world: {
        worldHeight: number;
        chunkBlocks: number;
        dayLengthSec: number;
        terrainYToleranceM: number;
    };
}, {
    building: {
        placeRangeM: number;
        maxPlayerBlocksPerRoom: number;
    };
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
    combat: {
        critChance: number;
        critMult: number;
        staggerMs: number;
        projectileHitRadius: number;
        meleeRangeGrace: number;
        hpRegenPerSec: number;
        manaRegenPerSec: number;
        regenDelayAfterDamageMs: number;
        lootLockMobMs: number;
        lootLockDeathMs: number;
        mobLootExpireMs: number;
        pickupRange: number;
        talkRange: number;
        sellFraction: number;
    };
    progression: {
        baseHp: number;
        hpPerLevel: number;
        baseMana: number;
        manaPerLevel: number;
        damagePerLevelPct: number;
        xpBase: number;
        xpExponent: number;
        maxLevel: number;
    };
    world: {
        worldHeight: number;
        chunkBlocks: number;
        dayLengthSec: number;
        terrainYToleranceM: number;
    };
}>;
export type GameConstants = z.infer<typeof ConstantsSchema>;
/** Loads shared/constants.json (validated). Cached after first load. */
export declare function gameConstants(): GameConstants;
export {};
//# sourceMappingURL=constants.d.ts.map