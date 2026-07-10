/**
 * RegistryService: all game data (items, abilities, mobs, loot tables) loads
 * through here — never imported as module constants — so `/reload registries`
 * can hot-reload tuning into live RoomHosts. Zod-validated on load; fails
 * fast on dangling id references.
 */
import { z } from "zod";
export declare const RaritySchema: z.ZodObject<{
    mult: z.ZodNumber;
    color: z.ZodString;
    weight: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    mult: number;
    color: string;
    weight: number;
}, {
    mult: number;
    color: string;
    weight: number;
}>;
export type RarityDef = z.infer<typeof RaritySchema>;
/** The five equipment slots, fixed order (wire/DB equipment arrays index by it). */
export declare const EQUIP_SLOTS: readonly ["head", "chest", "legs", "feet", "offhand"];
export type EquipSlot = (typeof EQUIP_SLOTS)[number];
/** Kinds a player can wear/hold for modifier effects (and that roll mods). */
export declare const EQUIPPABLE_KINDS: readonly ["weapon", "armor", "trinket"];
export declare function isEquippable(kind: string): boolean;
export declare const ItemDefSchema: z.ZodObject<{
    name: z.ZodString;
    /** trophy: no use action — sell-fodder. armor: wearable (slot+armor value).
     *  trinket: offhand-only passive modifier carrier (no armor, no durability). */
    kind: z.ZodEnum<["weapon", "consumable", "building", "trophy", "misc", "armor", "trinket"]>;
    ability: z.ZodOptional<z.ZodString>;
    damage: z.ZodOptional<z.ZodNumber>;
    /** armor: which equipment slot it occupies (shields = "offhand") */
    slot: z.ZodOptional<z.ZodEnum<["head", "chest", "legs", "feet", "offhand"]>>;
    /** armor: base armor value before rarity/roll — total equipped armor A
     *  reduces melee/ranged damage by A/(A+armorK) */
    armor: z.ZodOptional<z.ZodNumber>;
    /** weapons/armor: base uses before breaking (scaled per instance by rarity + roll) */
    durability: z.ZodOptional<z.ZodNumber>;
    /** building items: block name (shared/blocks.json) this item places */
    block: z.ZodOptional<z.ZodString>;
    value: z.ZodNumber;
    stack: z.ZodNumber;
    /** equippables: authored quality tier (1-5). Drives WEAVING capacity via
     *  constants.enchanting.tierCapacity — how many enchant slots it holds and
     *  the max enchant strength tier it accepts. Absent = 1. Non-equippables
     *  ignore it. NOTE: distinct from per-instance rarity (which is a drop roll). */
    tier: z.ZodOptional<z.ZodNumber>;
    icon: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
    viewmodel: z.ZodOptional<z.ZodString>;
    effect: z.ZodOptional<z.ZodObject<{
        heal: z.ZodOptional<z.ZodNumber>;
        mana: z.ZodOptional<z.ZodNumber>;
        hotTotal: z.ZodOptional<z.ZodNumber>;
        hotDurMs: z.ZodOptional<z.ZodNumber>;
        /** clears any active damage-over-time debuff (antidote) */
        cureDot: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        heal?: number | undefined;
        mana?: number | undefined;
        hotTotal?: number | undefined;
        hotDurMs?: number | undefined;
        cureDot?: boolean | undefined;
    }, {
        heal?: number | undefined;
        mana?: number | undefined;
        hotTotal?: number | undefined;
        hotDurMs?: number | undefined;
        cureDot?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    value: number;
    name: string;
    kind: "weapon" | "armor" | "trinket" | "consumable" | "building" | "trophy" | "misc";
    stack: number;
    icon: [number, number];
    armor?: number | undefined;
    ability?: string | undefined;
    damage?: number | undefined;
    slot?: "head" | "chest" | "legs" | "feet" | "offhand" | undefined;
    durability?: number | undefined;
    block?: string | undefined;
    tier?: number | undefined;
    viewmodel?: string | undefined;
    effect?: {
        heal?: number | undefined;
        mana?: number | undefined;
        hotTotal?: number | undefined;
        hotDurMs?: number | undefined;
        cureDot?: boolean | undefined;
    } | undefined;
}, {
    value: number;
    name: string;
    kind: "weapon" | "armor" | "trinket" | "consumable" | "building" | "trophy" | "misc";
    stack: number;
    icon: [number, number];
    armor?: number | undefined;
    ability?: string | undefined;
    damage?: number | undefined;
    slot?: "head" | "chest" | "legs" | "feet" | "offhand" | undefined;
    durability?: number | undefined;
    block?: string | undefined;
    tier?: number | undefined;
    viewmodel?: string | undefined;
    effect?: {
        heal?: number | undefined;
        mana?: number | undefined;
        hotTotal?: number | undefined;
        hotDurMs?: number | undefined;
        cureDot?: boolean | undefined;
    } | undefined;
}>;
export type ItemDef = z.infer<typeof ItemDefSchema>;
export declare const AbilityDefSchema: z.ZodObject<{
    kind: z.ZodEnum<["melee", "projectile", "self", "pillars"]>;
    /** damage class for taken-modifiers + armor mitigation. Defaults derive
     *  from kind (melee→melee, projectile/pillars→magic); bows author
     *  "ranged" explicitly. Armor mitigates melee+ranged, never magic. */
    dmgClass: z.ZodOptional<z.ZodEnum<["melee", "ranged", "magic"]>>;
    windupMs: z.ZodOptional<z.ZodNumber>;
    activeMs: z.ZodOptional<z.ZodNumber>;
    castTimeMs: z.ZodOptional<z.ZodNumber>;
    recoverMs: z.ZodNumber;
    range: z.ZodOptional<z.ZodNumber>;
    arcDeg: z.ZodOptional<z.ZodNumber>;
    projSpeed: z.ZodOptional<z.ZodNumber>;
    maxRange: z.ZodOptional<z.ZodNumber>;
    /** projectile leads the target's tracked velocity (boss anti-kite) */
    predictive: z.ZodOptional<z.ZodBoolean>;
    /** projectile splash: targets within this radius of the impact take 70%
     *  damage (the direct hit takes full) */
    aoeRadius: z.ZodOptional<z.ZodNumber>;
    /** flipbook played at the impact point (e.g. "explosion") — the client
     *  also keys its impact sound off this */
    impactFx: z.ZodOptional<z.ZodString>;
    /** render size multiplier for the projectile decal (big boss fireball) */
    projScale: z.ZodOptional<z.ZodNumber>;
    /** kind:"pillars" — a staggered line of fire pillars marches from the
     *  caster THROUGH the target's predicted position; each pillar telegraphs
     *  (delayMs on the wire), ignites, and burns anyone inside its radius
     *  during a short damage window. The classic anti-kite ground hazard. */
    pillars: z.ZodOptional<z.ZodObject<{
        count: z.ZodNumber;
        spacing: z.ZodNumber;
        radius: z.ZodNumber;
        staggerMs: z.ZodDefault<z.ZodNumber>;
        burnMs: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        count: number;
        spacing: number;
        radius: number;
        staggerMs: number;
        burnMs: number;
    }, {
        count: number;
        spacing: number;
        radius: number;
        staggerMs?: number | undefined;
        burnMs?: number | undefined;
    }>>;
    damage: z.ZodOptional<z.ZodNumber>;
    heal: z.ZodOptional<z.ZodNumber>;
    /** on-hit debuff: slowPct = frost-style move slow, dotTotal = poison-style
     *  damage over time (total hp dealt across durMs). Either or both. */
    debuff: z.ZodOptional<z.ZodObject<{
        slowPct: z.ZodOptional<z.ZodNumber>;
        dotTotal: z.ZodOptional<z.ZodNumber>;
        durMs: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        durMs: number;
        slowPct?: number | undefined;
        dotTotal?: number | undefined;
    }, {
        durMs: number;
        slowPct?: number | undefined;
        dotTotal?: number | undefined;
    }>>;
    /** self-kind abilities may summon minions on release (boss adds). The
     *  summoner's live-minion count is capped: at cap the option drops out
     *  of the attack kit, below it the count tops up to the cap. */
    summon: z.ZodOptional<z.ZodObject<{
        mob: z.ZodString;
        count: z.ZodNumber;
        radius: z.ZodDefault<z.ZodNumber>;
        cap: z.ZodDefault<z.ZodNumber>;
        /** flavor line broadcast to nearby players when the wave rises */
        text: z.ZodOptional<z.ZodString>;
        /** Boss adds grant xp/loot by design (an intentional risk/reward). A
         *  SPLITTER must not: a mob whose halves each pay full xp and loot is a
         *  vending machine. Set false on anything a player can farm by waiting. */
        grantsXp: z.ZodDefault<z.ZodBoolean>;
        grantsLoot: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        count: number;
        radius: number;
        mob: string;
        cap: number;
        grantsXp: boolean;
        grantsLoot: boolean;
        text?: string | undefined;
    }, {
        count: number;
        mob: string;
        radius?: number | undefined;
        cap?: number | undefined;
        text?: string | undefined;
        grantsXp?: boolean | undefined;
        grantsLoot?: boolean | undefined;
    }>>;
    /** self-kind support: on release, heal every living mob within `radius`
     *  (the caster too, unless includeSelf is false). The option only enters
     *  the attack kit while some eligible ally sits below `castIfAllyBelowPct`
     *  of max hp — otherwise a healer would spam it at full health. This is
     *  what turns a caster mob into a pack HEALER. */
    allyHeal: z.ZodOptional<z.ZodObject<{
        amount: z.ZodNumber;
        radius: z.ZodDefault<z.ZodNumber>;
        castIfAllyBelowPct: z.ZodDefault<z.ZodNumber>;
        includeSelf: z.ZodDefault<z.ZodBoolean>;
        /** flavor line broadcast to nearby players when it lands */
        text: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        radius: number;
        amount: number;
        castIfAllyBelowPct: number;
        includeSelf: boolean;
        text?: string | undefined;
    }, {
        amount: number;
        radius?: number | undefined;
        text?: string | undefined;
        castIfAllyBelowPct?: number | undefined;
        includeSelf?: boolean | undefined;
    }>>;
    canMoveWhile: z.ZodBoolean;
    interruptible: z.ZodBoolean;
    cooldownMs: z.ZodNumber;
    manaCost: z.ZodNumber;
    fx: z.ZodString;
}, "strip", z.ZodTypeAny, {
    kind: "melee" | "projectile" | "self" | "pillars";
    recoverMs: number;
    canMoveWhile: boolean;
    interruptible: boolean;
    cooldownMs: number;
    manaCost: number;
    fx: string;
    damage?: number | undefined;
    heal?: number | undefined;
    pillars?: {
        count: number;
        spacing: number;
        radius: number;
        staggerMs: number;
        burnMs: number;
    } | undefined;
    dmgClass?: "melee" | "ranged" | "magic" | undefined;
    windupMs?: number | undefined;
    activeMs?: number | undefined;
    castTimeMs?: number | undefined;
    range?: number | undefined;
    arcDeg?: number | undefined;
    projSpeed?: number | undefined;
    maxRange?: number | undefined;
    predictive?: boolean | undefined;
    aoeRadius?: number | undefined;
    impactFx?: string | undefined;
    projScale?: number | undefined;
    debuff?: {
        durMs: number;
        slowPct?: number | undefined;
        dotTotal?: number | undefined;
    } | undefined;
    summon?: {
        count: number;
        radius: number;
        mob: string;
        cap: number;
        grantsXp: boolean;
        grantsLoot: boolean;
        text?: string | undefined;
    } | undefined;
    allyHeal?: {
        radius: number;
        amount: number;
        castIfAllyBelowPct: number;
        includeSelf: boolean;
        text?: string | undefined;
    } | undefined;
}, {
    kind: "melee" | "projectile" | "self" | "pillars";
    recoverMs: number;
    canMoveWhile: boolean;
    interruptible: boolean;
    cooldownMs: number;
    manaCost: number;
    fx: string;
    damage?: number | undefined;
    heal?: number | undefined;
    pillars?: {
        count: number;
        spacing: number;
        radius: number;
        staggerMs?: number | undefined;
        burnMs?: number | undefined;
    } | undefined;
    dmgClass?: "melee" | "ranged" | "magic" | undefined;
    windupMs?: number | undefined;
    activeMs?: number | undefined;
    castTimeMs?: number | undefined;
    range?: number | undefined;
    arcDeg?: number | undefined;
    projSpeed?: number | undefined;
    maxRange?: number | undefined;
    predictive?: boolean | undefined;
    aoeRadius?: number | undefined;
    impactFx?: string | undefined;
    projScale?: number | undefined;
    debuff?: {
        durMs: number;
        slowPct?: number | undefined;
        dotTotal?: number | undefined;
    } | undefined;
    summon?: {
        count: number;
        mob: string;
        radius?: number | undefined;
        cap?: number | undefined;
        text?: string | undefined;
        grantsXp?: boolean | undefined;
        grantsLoot?: boolean | undefined;
    } | undefined;
    allyHeal?: {
        amount: number;
        radius?: number | undefined;
        text?: string | undefined;
        castIfAllyBelowPct?: number | undefined;
        includeSelf?: boolean | undefined;
    } | undefined;
}>;
export type AbilityDef = z.infer<typeof AbilityDefSchema>;
/** Resolve an ability's damage class (see AbilityDefSchema.dmgClass).
 *  null = the ability deals no direct damage (self heals/summons). */
export declare function abilityDmgClass(a: AbilityDef): "melee" | "ranged" | "magic" | null;
/** A dynamic item modifier (perk or curse) rollable onto equippables at mint
 *  time and purchasable (tier-1 only) from the enchanter. Magnitudes live ON
 *  the item instance (`ItemStack.mods[id]`), in this def's units; curses roll
 *  negative. Aggregation sums per `stat` across held+equipped items, clamped
 *  to `items.mods.caps` (constants.json). */
export declare const ModifierDefSchema: z.ZodObject<{
    name: z.ZodString;
    /** aggregation stat key this modifier feeds (several mods may share one,
     *  e.g. slowness = negative moveSpeedPct) */
    stat: z.ZodString;
    /** tooltip/status-bar unit label, e.g. "hp/s", "% move speed" */
    units: z.ZodString;
    icon: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
    appliesTo: z.ZodArray<z.ZodEnum<["weapon", "armor", "trinket"]>, "many">;
    curse: z.ZodBoolean;
    /** whole-number magnitudes (maxHp, thorns) */
    integer: z.ZodOptional<z.ZodBoolean>;
    /** rarity → [min,max] magnitude roll range (negative for curses) */
    rolls: z.ZodRecord<z.ZodString, z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
    /** present = the enchanter can weave this. `tiers` = the strength ladder
     *  [I, II, III] (magnitudes in this def's units; must be perk-positive).
     *  The strength woven is min(item tier's maxTier, NPC's maxTier); price =
     *  value × rarity × priceMult × tierPriceMult[tier] × ... (see enchantPrice). */
    enchant: z.ZodOptional<z.ZodObject<{
        tiers: z.ZodArray<z.ZodNumber, "many">;
        priceMult: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        tiers: number[];
        priceMult: number;
    }, {
        tiers: number[];
        priceMult: number;
    }>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    icon: [number, number];
    stat: string;
    units: string;
    appliesTo: ("weapon" | "armor" | "trinket")[];
    curse: boolean;
    rolls: Record<string, [number, number]>;
    integer?: boolean | undefined;
    enchant?: {
        tiers: number[];
        priceMult: number;
    } | undefined;
}, {
    name: string;
    icon: [number, number];
    stat: string;
    units: string;
    appliesTo: ("weapon" | "armor" | "trinket")[];
    curse: boolean;
    rolls: Record<string, [number, number]>;
    integer?: boolean | undefined;
    enchant?: {
        tiers: number[];
        priceMult: number;
    } | undefined;
}>;
export type ModifierDef = z.infer<typeof ModifierDefSchema>;
/** One option in a mob's attack kit. The mob picks among options that are
 *  usable right now (range window, cooldown, melee vertical reach) with a
 *  weighted roll — see chooseAttack in the shard sim. */
export declare const MobAttackSchema: z.ZodObject<{
    ability: z.ZodString;
    /** damage override for this attack (default: the mob's base damage) */
    damage: z.ZodOptional<z.ZodNumber>;
    /** don't use inside this 2D distance (bows prefer melee point-blank) */
    minRange: z.ZodOptional<z.ZodNumber>;
    /** weighted-random share when several options are usable at once */
    weight: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    weight: number;
    ability: string;
    damage?: number | undefined;
    minRange?: number | undefined;
}, {
    ability: string;
    weight?: number | undefined;
    damage?: number | undefined;
    minRange?: number | undefined;
}>;
export type MobAttackDef = z.infer<typeof MobAttackSchema>;
/**
 * A level gate on a mob's kit. World-gen mobs are REUSED across rooms at
 * different levels (a forest bandit at L5 just swings; the same bandit at L13
 * in the Gloomfen has learned to throw a knife and hex you). Every rank whose
 * `atLevel` <= the spawned level applies, in order: `remove` strips ability ids
 * from the kit, `add` appends new options, and the mult knobs re-tune the mob
 * on top of the global per-level scaling. Levels come from the spawn table.
 */
export declare const MobRankSchema: z.ZodObject<{
    atLevel: z.ZodNumber;
    /** attack options unlocked at this level */
    add: z.ZodDefault<z.ZodArray<z.ZodObject<{
        ability: z.ZodString;
        /** damage override for this attack (default: the mob's base damage) */
        damage: z.ZodOptional<z.ZodNumber>;
        /** don't use inside this 2D distance (bows prefer melee point-blank) */
        minRange: z.ZodOptional<z.ZodNumber>;
        /** weighted-random share when several options are usable at once */
        weight: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        weight: number;
        ability: string;
        damage?: number | undefined;
        minRange?: number | undefined;
    }, {
        ability: string;
        weight?: number | undefined;
        damage?: number | undefined;
        minRange?: number | undefined;
    }>, "many">>;
    /** ability ids to drop from the kit (a veteran stops using the weak swing) */
    remove: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    /** extra multipliers ON TOP of constants.mobs.scaling (1 = no change) */
    hpMult: z.ZodDefault<z.ZodNumber>;
    damageMult: z.ZodDefault<z.ZodNumber>;
    moveSpeedMult: z.ZodDefault<z.ZodNumber>;
    /** A rank that turns a harmless critter into a monster must also change what
     *  it is WORTH. Level alone scales xp by xpPerLevel, which is nowhere near
     *  enough when the rank multiplies hp by 2.5 and damage by 12. */
    xpMult: z.ZodDefault<z.ZodNumber>;
    /**
     * DISPOSITION overrides — a rank may change the mob's NERVE, not just its
     * numbers and its buttons. This is what lets the harmless thing stop running,
     * the grazer start charging, and the sentry refuse to let you walk away.
     * Absolute values, not multipliers; the last applicable rank wins.
     */
    aggroRadius: z.ZodOptional<z.ZodNumber>;
    fleeAtHpPct: z.ZodOptional<z.ZodNumber>;
    attackRange: z.ZodOptional<z.ZodNumber>;
    leashRadius: z.ZodOptional<z.ZodNumber>;
    /** display suffix: "Bandit" -> "Bandit Veteran" */
    titleSuffix: z.ZodOptional<z.ZodString>;
    /** full display-name override (wins over titleSuffix): the boss bump that
     *  turns "Forge Prototype" into "The Unfinished King" without forking the
     *  def. Last applicable rank wins. */
    name: z.ZodOptional<z.ZodString>;
    /** loot-table override: a def elevated to a room boss by a rank must not
     *  hand its guaranteed boss table to every lower-level spawn of the same
     *  def (the Bone Warden kept wraith_drops for exactly this reason before
     *  ranks could carry loot). Last applicable rank wins. */
    loot: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    atLevel: number;
    add: {
        weight: number;
        ability: string;
        damage?: number | undefined;
        minRange?: number | undefined;
    }[];
    remove: string[];
    hpMult: number;
    damageMult: number;
    moveSpeedMult: number;
    xpMult: number;
    name?: string | undefined;
    aggroRadius?: number | undefined;
    fleeAtHpPct?: number | undefined;
    attackRange?: number | undefined;
    leashRadius?: number | undefined;
    titleSuffix?: string | undefined;
    loot?: string | undefined;
}, {
    atLevel: number;
    name?: string | undefined;
    add?: {
        ability: string;
        weight?: number | undefined;
        damage?: number | undefined;
        minRange?: number | undefined;
    }[] | undefined;
    remove?: string[] | undefined;
    hpMult?: number | undefined;
    damageMult?: number | undefined;
    moveSpeedMult?: number | undefined;
    xpMult?: number | undefined;
    aggroRadius?: number | undefined;
    fleeAtHpPct?: number | undefined;
    attackRange?: number | undefined;
    leashRadius?: number | undefined;
    titleSuffix?: string | undefined;
    loot?: string | undefined;
}>;
export type MobRankDef = z.infer<typeof MobRankSchema>;
export declare const MobDefSchema: z.ZodObject<{
    name: z.ZodString;
    sprite: z.ZodString;
    level: z.ZodNumber;
    hp: z.ZodNumber;
    damage: z.ZodNumber;
    moveSpeed: z.ZodNumber;
    /** legacy single-attack form; multi-attack mobs author `attacks` instead */
    ability: z.ZodOptional<z.ZodString>;
    /** attack kit — bosses/bigger mobs carry 2+ options (melee + ranged...) */
    attacks: z.ZodOptional<z.ZodArray<z.ZodObject<{
        ability: z.ZodString;
        /** damage override for this attack (default: the mob's base damage) */
        damage: z.ZodOptional<z.ZodNumber>;
        /** don't use inside this 2D distance (bows prefer melee point-blank) */
        minRange: z.ZodOptional<z.ZodNumber>;
        /** weighted-random share when several options are usable at once */
        weight: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        weight: number;
        ability: string;
        damage?: number | undefined;
        minRange?: number | undefined;
    }, {
        ability: string;
        weight?: number | undefined;
        damage?: number | undefined;
        minRange?: number | undefined;
    }>, "many">>;
    /** level-gated kit growth; see MobRankSchema. Sorted by atLevel at resolve. */
    ranks: z.ZodDefault<z.ZodArray<z.ZodObject<{
        atLevel: z.ZodNumber;
        /** attack options unlocked at this level */
        add: z.ZodDefault<z.ZodArray<z.ZodObject<{
            ability: z.ZodString;
            /** damage override for this attack (default: the mob's base damage) */
            damage: z.ZodOptional<z.ZodNumber>;
            /** don't use inside this 2D distance (bows prefer melee point-blank) */
            minRange: z.ZodOptional<z.ZodNumber>;
            /** weighted-random share when several options are usable at once */
            weight: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            weight: number;
            ability: string;
            damage?: number | undefined;
            minRange?: number | undefined;
        }, {
            ability: string;
            weight?: number | undefined;
            damage?: number | undefined;
            minRange?: number | undefined;
        }>, "many">>;
        /** ability ids to drop from the kit (a veteran stops using the weak swing) */
        remove: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** extra multipliers ON TOP of constants.mobs.scaling (1 = no change) */
        hpMult: z.ZodDefault<z.ZodNumber>;
        damageMult: z.ZodDefault<z.ZodNumber>;
        moveSpeedMult: z.ZodDefault<z.ZodNumber>;
        /** A rank that turns a harmless critter into a monster must also change what
         *  it is WORTH. Level alone scales xp by xpPerLevel, which is nowhere near
         *  enough when the rank multiplies hp by 2.5 and damage by 12. */
        xpMult: z.ZodDefault<z.ZodNumber>;
        /**
         * DISPOSITION overrides — a rank may change the mob's NERVE, not just its
         * numbers and its buttons. This is what lets the harmless thing stop running,
         * the grazer start charging, and the sentry refuse to let you walk away.
         * Absolute values, not multipliers; the last applicable rank wins.
         */
        aggroRadius: z.ZodOptional<z.ZodNumber>;
        fleeAtHpPct: z.ZodOptional<z.ZodNumber>;
        attackRange: z.ZodOptional<z.ZodNumber>;
        leashRadius: z.ZodOptional<z.ZodNumber>;
        /** display suffix: "Bandit" -> "Bandit Veteran" */
        titleSuffix: z.ZodOptional<z.ZodString>;
        /** full display-name override (wins over titleSuffix): the boss bump that
         *  turns "Forge Prototype" into "The Unfinished King" without forking the
         *  def. Last applicable rank wins. */
        name: z.ZodOptional<z.ZodString>;
        /** loot-table override: a def elevated to a room boss by a rank must not
         *  hand its guaranteed boss table to every lower-level spawn of the same
         *  def (the Bone Warden kept wraith_drops for exactly this reason before
         *  ranks could carry loot). Last applicable rank wins. */
        loot: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        atLevel: number;
        add: {
            weight: number;
            ability: string;
            damage?: number | undefined;
            minRange?: number | undefined;
        }[];
        remove: string[];
        hpMult: number;
        damageMult: number;
        moveSpeedMult: number;
        xpMult: number;
        name?: string | undefined;
        aggroRadius?: number | undefined;
        fleeAtHpPct?: number | undefined;
        attackRange?: number | undefined;
        leashRadius?: number | undefined;
        titleSuffix?: string | undefined;
        loot?: string | undefined;
    }, {
        atLevel: number;
        name?: string | undefined;
        add?: {
            ability: string;
            weight?: number | undefined;
            damage?: number | undefined;
            minRange?: number | undefined;
        }[] | undefined;
        remove?: string[] | undefined;
        hpMult?: number | undefined;
        damageMult?: number | undefined;
        moveSpeedMult?: number | undefined;
        xpMult?: number | undefined;
        aggroRadius?: number | undefined;
        fleeAtHpPct?: number | undefined;
        attackRange?: number | undefined;
        leashRadius?: number | undefined;
        titleSuffix?: string | undefined;
        loot?: string | undefined;
    }>, "many">>;
    aggroRadius: z.ZodNumber;
    attackRange: z.ZodNumber;
    leashRadius: z.ZodNumber;
    fleeAtHpPct: z.ZodNumber;
    xp: z.ZodNumber;
    loot: z.ZodString;
    /** client vocal sound groups in the audio manifest (all optional; omitted = silent category) */
    sounds: z.ZodOptional<z.ZodObject<{
        idle: z.ZodOptional<z.ZodString>;
        attack: z.ZodOptional<z.ZodString>;
        hurt: z.ZodOptional<z.ZodString>;
        die: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        idle?: string | undefined;
        attack?: string | undefined;
        hurt?: string | undefined;
        die?: string | undefined;
    }, {
        idle?: string | undefined;
        attack?: string | undefined;
        hurt?: string | undefined;
        die?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    damage: number;
    aggroRadius: number;
    fleeAtHpPct: number;
    attackRange: number;
    leashRadius: number;
    loot: string;
    sprite: string;
    level: number;
    hp: number;
    moveSpeed: number;
    ranks: {
        atLevel: number;
        add: {
            weight: number;
            ability: string;
            damage?: number | undefined;
            minRange?: number | undefined;
        }[];
        remove: string[];
        hpMult: number;
        damageMult: number;
        moveSpeedMult: number;
        xpMult: number;
        name?: string | undefined;
        aggroRadius?: number | undefined;
        fleeAtHpPct?: number | undefined;
        attackRange?: number | undefined;
        leashRadius?: number | undefined;
        titleSuffix?: string | undefined;
        loot?: string | undefined;
    }[];
    xp: number;
    ability?: string | undefined;
    attacks?: {
        weight: number;
        ability: string;
        damage?: number | undefined;
        minRange?: number | undefined;
    }[] | undefined;
    sounds?: {
        idle?: string | undefined;
        attack?: string | undefined;
        hurt?: string | undefined;
        die?: string | undefined;
    } | undefined;
}, {
    name: string;
    damage: number;
    aggroRadius: number;
    fleeAtHpPct: number;
    attackRange: number;
    leashRadius: number;
    loot: string;
    sprite: string;
    level: number;
    hp: number;
    moveSpeed: number;
    xp: number;
    ability?: string | undefined;
    attacks?: {
        ability: string;
        weight?: number | undefined;
        damage?: number | undefined;
        minRange?: number | undefined;
    }[] | undefined;
    ranks?: {
        atLevel: number;
        name?: string | undefined;
        add?: {
            ability: string;
            weight?: number | undefined;
            damage?: number | undefined;
            minRange?: number | undefined;
        }[] | undefined;
        remove?: string[] | undefined;
        hpMult?: number | undefined;
        damageMult?: number | undefined;
        moveSpeedMult?: number | undefined;
        xpMult?: number | undefined;
        aggroRadius?: number | undefined;
        fleeAtHpPct?: number | undefined;
        attackRange?: number | undefined;
        leashRadius?: number | undefined;
        titleSuffix?: string | undefined;
        loot?: string | undefined;
    }[] | undefined;
    sounds?: {
        idle?: string | undefined;
        attack?: string | undefined;
        hurt?: string | undefined;
        die?: string | undefined;
    } | undefined;
}>;
export type MobDef = z.infer<typeof MobDefSchema>;
/** A mob's attack kit, normalized: multi-attack mobs author `attacks`;
 *  single-attack mobs keep the legacy `ability` field (kit of one). */
export declare function mobAttacks(def: MobDef): MobAttackDef[];
/** Per-level growth curve for reused world-gen mobs (constants.mobs.scaling). */
export interface MobScaling {
    hpPerLevel: number;
    damagePerLevel: number;
    xpPerLevel: number;
    maxLevelBonus: number;
}
/** A mob def evaluated at a concrete spawn level. The brain reads THIS, never
 *  the raw def — otherwise a rank could never change a mob's disposition. */
export interface ResolvedMob {
    level: number;
    name: string;
    hp: number;
    damage: number;
    moveSpeed: number;
    xp: number;
    attacks: MobAttackDef[];
    aggroRadius: number;
    attackRange: number;
    leashRadius: number;
    fleeAtHpPct: number;
    /** loot table at this level (rank `loot` override, else the def's) */
    loot: string;
}
/**
 * Evaluate `def` at `level`. Stats compound per level above the def's base
 * level — `base * (1 + perLevel) ** delta` — so each extra level is the same
 * RELATIVE step whether the mob is being reused at L6 or L16 (a linear ramp
 * would make high-level reuse feel flat). Levels BELOW the def's base level
 * never scale anything down: `delta` floors at 0, so a def is always at least
 * as strong as it was authored. `maxLevelBonus` caps the delta so a typo in a
 * spawn table cannot mint a 10,000 hp slime.
 *
 * Ranks then apply in ascending atLevel order: `remove` before `add`, so a rank
 * can swap an ability out for a better one at the same level.
 */
export declare function resolveMob(def: MobDef, level: number | undefined, scaling: MobScaling): ResolvedMob;
/** Every ability id a def can ever use (base kit + every rank's additions) —
 *  what the registry cross-check must validate, since a rank's ability only
 *  surfaces once something spawns at that level. */
export declare function mobAllAbilityIds(def: MobDef): string[];
/** Weighted entry: exactly one of item / table / nothing (weight only). */
export declare const LootEntrySchema: z.ZodObject<{
    weight: z.ZodNumber;
    item: z.ZodOptional<z.ZodString>;
    table: z.ZodOptional<z.ZodString>;
    qty: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
    minRarity: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    weight: number;
    item?: string | undefined;
    table?: string | undefined;
    qty?: [number, number] | undefined;
    minRarity?: string | undefined;
}, {
    weight: number;
    item?: string | undefined;
    table?: string | undefined;
    qty?: [number, number] | undefined;
    minRarity?: string | undefined;
}>;
export declare const LootTableSchema: z.ZodObject<{
    gold: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
    rolls: z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>;
    entries: z.ZodArray<z.ZodObject<{
        weight: z.ZodNumber;
        item: z.ZodOptional<z.ZodString>;
        table: z.ZodOptional<z.ZodString>;
        qty: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
        minRarity: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        weight: number;
        item?: string | undefined;
        table?: string | undefined;
        qty?: [number, number] | undefined;
        minRarity?: string | undefined;
    }, {
        weight: number;
        item?: string | undefined;
        table?: string | undefined;
        qty?: [number, number] | undefined;
        minRarity?: string | undefined;
    }>, "many">;
    /** boss-style guaranteed-drop slots: every entry always rolls once */
    guaranteed: z.ZodDefault<z.ZodArray<z.ZodObject<{
        weight: z.ZodNumber;
        item: z.ZodOptional<z.ZodString>;
        table: z.ZodOptional<z.ZodString>;
        qty: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
        minRarity: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        weight: number;
        item?: string | undefined;
        table?: string | undefined;
        qty?: [number, number] | undefined;
        minRarity?: string | undefined;
    }, {
        weight: number;
        item?: string | undefined;
        table?: string | undefined;
        qty?: [number, number] | undefined;
        minRarity?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    entries: {
        weight: number;
        item?: string | undefined;
        table?: string | undefined;
        qty?: [number, number] | undefined;
        minRarity?: string | undefined;
    }[];
    rolls: [number, number];
    gold: [number, number];
    guaranteed: {
        weight: number;
        item?: string | undefined;
        table?: string | undefined;
        qty?: [number, number] | undefined;
        minRarity?: string | undefined;
    }[];
}, {
    entries: {
        weight: number;
        item?: string | undefined;
        table?: string | undefined;
        qty?: [number, number] | undefined;
        minRarity?: string | undefined;
    }[];
    rolls: [number, number];
    gold: [number, number];
    guaranteed?: {
        weight: number;
        item?: string | undefined;
        table?: string | undefined;
        qty?: [number, number] | undefined;
        minRarity?: string | undefined;
    }[] | undefined;
}>;
export type LootTable = z.infer<typeof LootTableSchema>;
export declare class RegistryService {
    rarities: Record<string, RarityDef>;
    items: Record<string, ItemDef>;
    abilities: Record<string, AbilityDef>;
    mobs: Record<string, MobDef>;
    loot: Record<string, LootTable>;
    modifiers: Record<string, ModifierDef>;
    constructor();
    /** (Re)load everything from shared/. Throws (leaving old data intact-ish)
     *  on schema or cross-reference errors — callers catch and report. */
    reload(): void;
    /** Modifier ids rollable on an item kind (optionally curses/perks only). */
    modifiersFor(kind: string, curse?: boolean): string[];
    item(id: string): ItemDef;
    ability(id: string): AbilityDef;
    mob(id: string): MobDef;
    lootTable(id: string): LootTable;
    /** Rarity tiers ordered ascending by power (mult). */
    rarityOrder(): string[];
}
//# sourceMappingURL=registry.d.ts.map