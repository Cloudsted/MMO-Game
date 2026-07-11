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
  combat: z.object({
    critChance: z.number(),
    critMult: z.number(),
    staggerMs: z.number().int(),
    projectileHitRadius: z.number(),
    meleeRangeGrace: z.number(),
    /** melee hits (players AND mobs) need |feetY delta| within this — no
     *  more boars pounding you from a tree canopy 5 blocks overhead */
    meleeVerticalReach: z.number(),
    /** an attack click rejected only by a timing sliver (recover tail /
     *  cooldown drift) is buffered this long and retried from tick() */
    attackBufferMs: z.number().int(),
    hpRegenPerSec: z.number(),
    manaRegenPerSec: z.number(),
    regenDelayAfterDamageMs: z.number().int(),
    lootLockMobMs: z.number().int(),
    lootLockDeathMs: z.number().int(),
    mobLootExpireMs: z.number().int(),
    pickupRange: z.number(),
    talkRange: z.number(),
    sellFraction: z.number(),
    /** armor mitigation curve: reduction = A / (A + armorK) — diminishing,
     *  never reaches immunity. Applies to melee+ranged, never magic/DoT. */
    armorK: z.number(),
    /** death drops equipped armor/trinkets into the bag too (full-loot) */
    deathDropsEquipment: z.boolean(),
    /** keep-inventory mode (owner 2026-07-11: "no player drops items on
     *  death" — for now): when true, death drops NOTHING (items, equipment,
     *  gold all kept, PvP clearing included). The whole drop path stays
     *  intact behind this knob; deathDropsEquipment only matters when it's
     *  off again. */
    keepInventoryOnDeath: z.boolean(),
  }),
  building: z.object({
    placeRangeM: z.number(),
    maxPlayerBlocksPerRoom: z.number().int(),
  }),
  /** per-instance item rolls: stat → rarity → ± spread around 1, and the
   *  durability scaling formula (see mintItem in items.ts) */
  items: z.object({
    statSpread: z.record(z.string(), z.record(z.string(), z.number())),
    durability: z.object({
      rarityMult: z.record(z.string(), z.number()),
      spread: z.number(),
    }),
    /** dynamic modifier (perk/curse) rolling at mint time — see mintItem */
    mods: z.object({
      chanceByRarity: z.record(z.string(), z.number()),
      secondModChanceByRarity: z.record(z.string(), z.number()),
      curseChance: z.number(),
      /** per-stat cap on the AGGREGATED (equipped+held) sum; clamped
       *  symmetrically, so curses can't push past -cap either */
      caps: z.record(z.string(), z.number()),
      sellBonusPerPerk: z.number(),
      sellPenaltyPerCurse: z.number(),
    }),
  }),
  enchanting: z.object({
    priceBase: z.number(),
    priceValueMult: z.number(),
    /** gear tier (1-5) → weaving capacity: how many enchant slots it holds and
     *  the max enchant strength tier it accepts. Keyed by tier as a string. */
    tierCapacity: z.record(z.string(), z.object({ slots: z.number().int(), maxTier: z.number().int() })),
    /** enchant strength tier (1-3) → price multiplier (keyed by tier string) */
    tierPriceMult: z.record(z.string(), z.number()),
    /** each additional woven enchant on the same item multiplies its price by
     *  this raised to the count of enchants already present */
    slotSurchargeMult: z.number(),
    /** removing a woven enchant: ceil(removeCostBase + value×rarity×removeCostValueMult) */
    removeCostBase: z.number(),
    removeCostValueMult: z.number(),
  }),
  progression: z.object({
    baseHp: z.number(),
    hpPerLevel: z.number(),
    baseMana: z.number(),
    manaPerLevel: z.number(),
    damagePerLevelPct: z.number(),
    xpBase: z.number(),
    xpExponent: z.number(),
    maxLevel: z.number().int(),
  }),
  /** How a world-gen mob grows when a spawn table reuses it above its base
   *  level (see registry.resolveMob). Compounding per level. These are THE
   *  difficulty knobs for reused mobs — tune here, not in mobs.json. */
  mobs: z.object({
    /** a wounded mob that neither dealt nor took damage for this long AND has
     *  no live target gets the leash-reset treatment (walk home healing, full
     *  heal on arrival, threat cleared; spent bossHpBelowPct arcs stay spent —
     *  exactly the leash semantics). Never fires mid-kite: a live target
     *  blocks it, and any hit restarts the clock. */
    idleResetSec: z.number(),
    scaling: z.object({
      hpPerLevel: z.number(),
      damagePerLevel: z.number(),
      xpPerLevel: z.number(),
      /** hard cap on (spawnLevel - defLevel); a typo can't mint a boss slime */
      maxLevelBonus: z.number().int(),
    }),
  }),
  world: z.object({
    worldHeight: z.number().int(),
    chunkBlocks: z.number().int(),
    dayLengthSec: z.number(),
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
