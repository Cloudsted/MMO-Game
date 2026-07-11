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
        /** keep-inventory mode (owner 2026-07-11: "no player drops items on
         *  death" — for now): when true, death drops NOTHING (items, equipment,
         *  gold all kept, PvP clearing included). The whole drop path stays
         *  intact behind this knob; deathDropsEquipment only matters when it's
         *  off again. */
        keepInventoryOnDeath: z.ZodBoolean;
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
        keepInventoryOnDeath: boolean;
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
        keepInventoryOnDeath: boolean;
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
        /** gear tier (1-5) → weaving capacity: how many enchant slots it holds and
         *  the max enchant strength tier it accepts. Keyed by tier as a string. */
        tierCapacity: z.ZodRecord<z.ZodString, z.ZodObject<{
            slots: z.ZodNumber;
            maxTier: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            slots: number;
            maxTier: number;
        }, {
            slots: number;
            maxTier: number;
        }>>;
        /** enchant strength tier (1-3) → price multiplier (keyed by tier string) */
        tierPriceMult: z.ZodRecord<z.ZodString, z.ZodNumber>;
        /** each additional woven enchant on the same item multiplies its price by
         *  this raised to the count of enchants already present */
        slotSurchargeMult: z.ZodNumber;
        /** removing a woven enchant: ceil(removeCostBase + value×rarity×removeCostValueMult) */
        removeCostBase: z.ZodNumber;
        removeCostValueMult: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        priceBase: number;
        priceValueMult: number;
        tierCapacity: Record<string, {
            slots: number;
            maxTier: number;
        }>;
        tierPriceMult: Record<string, number>;
        slotSurchargeMult: number;
        removeCostBase: number;
        removeCostValueMult: number;
    }, {
        priceBase: number;
        priceValueMult: number;
        tierCapacity: Record<string, {
            slots: number;
            maxTier: number;
        }>;
        tierPriceMult: Record<string, number>;
        slotSurchargeMult: number;
        removeCostBase: number;
        removeCostValueMult: number;
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
    /** How a world-gen mob grows when a spawn table reuses it above its base
     *  level (see registry.resolveMob). Compounding per level. These are THE
     *  difficulty knobs for reused mobs — tune here, not in mobs.json. */
    mobs: z.ZodObject<{
        /** a wounded mob that neither dealt nor took damage for this long AND has
         *  no live target gets the leash-reset treatment (walk home healing, full
         *  heal on arrival, threat cleared; spent bossHpBelowPct arcs stay spent —
         *  exactly the leash semantics). Never fires mid-kite: a live target
         *  blocks it, and any hit restarts the clock. */
        idleResetSec: z.ZodNumber;
        scaling: z.ZodObject<{
            hpPerLevel: z.ZodNumber;
            damagePerLevel: z.ZodNumber;
            xpPerLevel: z.ZodNumber;
            /** hard cap on (spawnLevel - defLevel); a typo can't mint a boss slime */
            maxLevelBonus: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            hpPerLevel: number;
            damagePerLevel: number;
            xpPerLevel: number;
            maxLevelBonus: number;
        }, {
            hpPerLevel: number;
            damagePerLevel: number;
            xpPerLevel: number;
            maxLevelBonus: number;
        }>;
    }, "strip", z.ZodTypeAny, {
        idleResetSec: number;
        scaling: {
            hpPerLevel: number;
            damagePerLevel: number;
            xpPerLevel: number;
            maxLevelBonus: number;
        };
    }, {
        idleResetSec: number;
        scaling: {
            hpPerLevel: number;
            damagePerLevel: number;
            xpPerLevel: number;
            maxLevelBonus: number;
        };
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
        keepInventoryOnDeath: boolean;
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
        tierCapacity: Record<string, {
            slots: number;
            maxTier: number;
        }>;
        tierPriceMult: Record<string, number>;
        slotSurchargeMult: number;
        removeCostBase: number;
        removeCostValueMult: number;
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
    mobs: {
        idleResetSec: number;
        scaling: {
            hpPerLevel: number;
            damagePerLevel: number;
            xpPerLevel: number;
            maxLevelBonus: number;
        };
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
        keepInventoryOnDeath: boolean;
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
        tierCapacity: Record<string, {
            slots: number;
            maxTier: number;
        }>;
        tierPriceMult: Record<string, number>;
        slotSurchargeMult: number;
        removeCostBase: number;
        removeCostValueMult: number;
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
    mobs: {
        idleResetSec: number;
        scaling: {
            hpPerLevel: number;
            damagePerLevel: number;
            xpPerLevel: number;
            maxLevelBonus: number;
        };
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