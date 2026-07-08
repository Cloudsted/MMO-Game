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
        /** melee hits (players AND mobs) need |feetY delta| within this — no
         *  more boars pounding you from a tree canopy 5 blocks overhead */
        meleeVerticalReach: z.ZodNumber;
        /** an attack click rejected only by a timing sliver (recover tail /
         *  cooldown drift) is buffered this long and retried from tick() */
        attackBufferMs: z.ZodNumber;
        hpRegenPerSec: z.ZodNumber;
        manaRegenPerSec: z.ZodNumber;
        regenDelayAfterDamageMs: z.ZodNumber;
        lootLockMobMs: z.ZodNumber;
        lootLockDeathMs: z.ZodNumber;
        mobLootExpireMs: z.ZodNumber;
        pickupRange: z.ZodNumber;
        talkRange: z.ZodNumber;
        sellFraction: z.ZodNumber;
        /** armor mitigation curve: reduction = A / (A + armorK) — diminishing,
         *  never reaches immunity. Applies to melee+ranged, never magic/DoT. */
        armorK: z.ZodNumber;
        /** death drops equipped armor/trinkets into the bag too (full-loot) */
        deathDropsEquipment: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        critChance: number;
        critMult: number;
        staggerMs: number;
        projectileHitRadius: number;
        meleeRangeGrace: number;
        meleeVerticalReach: number;
        attackBufferMs: number;
        hpRegenPerSec: number;
        manaRegenPerSec: number;
        regenDelayAfterDamageMs: number;
        lootLockMobMs: number;
        lootLockDeathMs: number;
        mobLootExpireMs: number;
        pickupRange: number;
        talkRange: number;
        sellFraction: number;
        armorK: number;
        deathDropsEquipment: boolean;
    }, {
        critChance: number;
        critMult: number;
        staggerMs: number;
        projectileHitRadius: number;
        meleeRangeGrace: number;
        meleeVerticalReach: number;
        attackBufferMs: number;
        hpRegenPerSec: number;
        manaRegenPerSec: number;
        regenDelayAfterDamageMs: number;
        lootLockMobMs: number;
        lootLockDeathMs: number;
        mobLootExpireMs: number;
        pickupRange: number;
        talkRange: number;
        sellFraction: number;
        armorK: number;
        deathDropsEquipment: boolean;
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
    /** per-instance item rolls: stat → rarity → ± spread around 1, and the
     *  durability scaling formula (see mintItem in items.ts) */
    items: z.ZodObject<{
        statSpread: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodNumber>>;
        durability: z.ZodObject<{
            rarityMult: z.ZodRecord<z.ZodString, z.ZodNumber>;
            spread: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            rarityMult: Record<string, number>;
            spread: number;
        }, {
            rarityMult: Record<string, number>;
            spread: number;
        }>;
        /** dynamic modifier (perk/curse) rolling at mint time — see mintItem */
        mods: z.ZodObject<{
            chanceByRarity: z.ZodRecord<z.ZodString, z.ZodNumber>;
            secondModChanceByRarity: z.ZodRecord<z.ZodString, z.ZodNumber>;
            curseChance: z.ZodNumber;
            /** per-stat cap on the AGGREGATED (equipped+held) sum; clamped
             *  symmetrically, so curses can't push past -cap either */
            caps: z.ZodRecord<z.ZodString, z.ZodNumber>;
            sellBonusPerPerk: z.ZodNumber;
            sellPenaltyPerCurse: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            chanceByRarity: Record<string, number>;
            secondModChanceByRarity: Record<string, number>;
            curseChance: number;
            caps: Record<string, number>;
            sellBonusPerPerk: number;
            sellPenaltyPerCurse: number;
        }, {
            chanceByRarity: Record<string, number>;
            secondModChanceByRarity: Record<string, number>;
            curseChance: number;
            caps: Record<string, number>;
            sellBonusPerPerk: number;
            sellPenaltyPerCurse: number;
        }>;
    }, "strip", z.ZodTypeAny, {
        statSpread: Record<string, Record<string, number>>;
        durability: {
            rarityMult: Record<string, number>;
            spread: number;
        };
        mods: {
            chanceByRarity: Record<string, number>;
            secondModChanceByRarity: Record<string, number>;
            curseChance: number;
            caps: Record<string, number>;
            sellBonusPerPerk: number;
            sellPenaltyPerCurse: number;
        };
    }, {
        statSpread: Record<string, Record<string, number>>;
        durability: {
            rarityMult: Record<string, number>;
            spread: number;
        };
        mods: {
            chanceByRarity: Record<string, number>;
            secondModChanceByRarity: Record<string, number>;
            curseChance: number;
            caps: Record<string, number>;
            sellBonusPerPerk: number;
            sellPenaltyPerCurse: number;
        };
    }>;
    enchanting: z.ZodObject<{
        priceBase: z.ZodNumber;
        priceValueMult: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        priceBase: number;
        priceValueMult: number;
    }, {
        priceBase: number;
        priceValueMult: number;
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
        meleeVerticalReach: number;
        attackBufferMs: number;
        hpRegenPerSec: number;
        manaRegenPerSec: number;
        regenDelayAfterDamageMs: number;
        lootLockMobMs: number;
        lootLockDeathMs: number;
        mobLootExpireMs: number;
        pickupRange: number;
        talkRange: number;
        sellFraction: number;
        armorK: number;
        deathDropsEquipment: boolean;
    };
    building: {
        placeRangeM: number;
        maxPlayerBlocksPerRoom: number;
    };
    items: {
        statSpread: Record<string, Record<string, number>>;
        durability: {
            rarityMult: Record<string, number>;
            spread: number;
        };
        mods: {
            chanceByRarity: Record<string, number>;
            secondModChanceByRarity: Record<string, number>;
            curseChance: number;
            caps: Record<string, number>;
            sellBonusPerPerk: number;
            sellPenaltyPerCurse: number;
        };
    };
    enchanting: {
        priceBase: number;
        priceValueMult: number;
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
        meleeVerticalReach: number;
        attackBufferMs: number;
        hpRegenPerSec: number;
        manaRegenPerSec: number;
        regenDelayAfterDamageMs: number;
        lootLockMobMs: number;
        lootLockDeathMs: number;
        mobLootExpireMs: number;
        pickupRange: number;
        talkRange: number;
        sellFraction: number;
        armorK: number;
        deathDropsEquipment: boolean;
    };
    building: {
        placeRangeM: number;
        maxPlayerBlocksPerRoom: number;
    };
    items: {
        statSpread: Record<string, Record<string, number>>;
        durability: {
            rarityMult: Record<string, number>;
            spread: number;
        };
        mods: {
            chanceByRarity: Record<string, number>;
            secondModChanceByRarity: Record<string, number>;
            curseChance: number;
            caps: Record<string, number>;
            sellBonusPerPerk: number;
            sellPenaltyPerCurse: number;
        };
    };
    enchanting: {
        priceBase: number;
        priceValueMult: number;
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