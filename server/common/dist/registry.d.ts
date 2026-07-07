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
    weight: number;
    mult: number;
    color: string;
}, {
    weight: number;
    mult: number;
    color: string;
}>;
export type RarityDef = z.infer<typeof RaritySchema>;
export declare const ItemDefSchema: z.ZodObject<{
    name: z.ZodString;
    /** trophy: no use action — a trinket that exists to be sold */
    kind: z.ZodEnum<["weapon", "consumable", "building", "trophy", "misc"]>;
    ability: z.ZodOptional<z.ZodString>;
    damage: z.ZodOptional<z.ZodNumber>;
    /** weapons: base uses before breaking (scaled per instance by rarity + roll) */
    durability: z.ZodOptional<z.ZodNumber>;
    /** building items: block name (shared/blocks.json) this item places */
    block: z.ZodOptional<z.ZodString>;
    value: z.ZodNumber;
    stack: z.ZodNumber;
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
    kind: "building" | "weapon" | "consumable" | "trophy" | "misc";
    name: string;
    stack: number;
    icon: [number, number];
    ability?: string | undefined;
    damage?: number | undefined;
    durability?: number | undefined;
    block?: string | undefined;
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
    kind: "building" | "weapon" | "consumable" | "trophy" | "misc";
    name: string;
    stack: number;
    icon: [number, number];
    ability?: string | undefined;
    damage?: number | undefined;
    durability?: number | undefined;
    block?: string | undefined;
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
    kind: z.ZodEnum<["melee", "projectile", "self"]>;
    windupMs: z.ZodOptional<z.ZodNumber>;
    activeMs: z.ZodOptional<z.ZodNumber>;
    castTimeMs: z.ZodOptional<z.ZodNumber>;
    recoverMs: z.ZodNumber;
    range: z.ZodOptional<z.ZodNumber>;
    arcDeg: z.ZodOptional<z.ZodNumber>;
    projSpeed: z.ZodOptional<z.ZodNumber>;
    maxRange: z.ZodOptional<z.ZodNumber>;
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
    }, "strip", z.ZodTypeAny, {
        mob: string;
        count: number;
        radius: number;
        cap: number;
        text?: string | undefined;
    }, {
        mob: string;
        count: number;
        radius?: number | undefined;
        text?: string | undefined;
        cap?: number | undefined;
    }>>;
    canMoveWhile: z.ZodBoolean;
    interruptible: z.ZodBoolean;
    cooldownMs: z.ZodNumber;
    manaCost: z.ZodNumber;
    fx: z.ZodString;
}, "strip", z.ZodTypeAny, {
    kind: "melee" | "projectile" | "self";
    recoverMs: number;
    canMoveWhile: boolean;
    interruptible: boolean;
    cooldownMs: number;
    manaCost: number;
    fx: string;
    damage?: number | undefined;
    heal?: number | undefined;
    windupMs?: number | undefined;
    activeMs?: number | undefined;
    castTimeMs?: number | undefined;
    range?: number | undefined;
    arcDeg?: number | undefined;
    projSpeed?: number | undefined;
    maxRange?: number | undefined;
    debuff?: {
        durMs: number;
        slowPct?: number | undefined;
        dotTotal?: number | undefined;
    } | undefined;
    summon?: {
        mob: string;
        count: number;
        radius: number;
        cap: number;
        text?: string | undefined;
    } | undefined;
}, {
    kind: "melee" | "projectile" | "self";
    recoverMs: number;
    canMoveWhile: boolean;
    interruptible: boolean;
    cooldownMs: number;
    manaCost: number;
    fx: string;
    damage?: number | undefined;
    heal?: number | undefined;
    windupMs?: number | undefined;
    activeMs?: number | undefined;
    castTimeMs?: number | undefined;
    range?: number | undefined;
    arcDeg?: number | undefined;
    projSpeed?: number | undefined;
    maxRange?: number | undefined;
    debuff?: {
        durMs: number;
        slowPct?: number | undefined;
        dotTotal?: number | undefined;
    } | undefined;
    summon?: {
        mob: string;
        count: number;
        radius?: number | undefined;
        text?: string | undefined;
        cap?: number | undefined;
    } | undefined;
}>;
export type AbilityDef = z.infer<typeof AbilityDefSchema>;
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
    sprite: string;
    damage: number;
    level: number;
    hp: number;
    moveSpeed: number;
    aggroRadius: number;
    attackRange: number;
    leashRadius: number;
    fleeAtHpPct: number;
    xp: number;
    loot: string;
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
    sprite: string;
    damage: number;
    level: number;
    hp: number;
    moveSpeed: number;
    aggroRadius: number;
    attackRange: number;
    leashRadius: number;
    fleeAtHpPct: number;
    xp: number;
    loot: string;
    ability?: string | undefined;
    attacks?: {
        ability: string;
        weight?: number | undefined;
        damage?: number | undefined;
        minRange?: number | undefined;
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
    gold: [number, number];
    rolls: [number, number];
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
    gold: [number, number];
    rolls: [number, number];
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
    constructor();
    /** (Re)load everything from shared/. Throws (leaving old data intact-ish)
     *  on schema or cross-reference errors — callers catch and report. */
    reload(): void;
    item(id: string): ItemDef;
    ability(id: string): AbilityDef;
    mob(id: string): MobDef;
    lootTable(id: string): LootTable;
    /** Rarity tiers ordered ascending by power (mult). */
    rarityOrder(): string[];
}
//# sourceMappingURL=registry.d.ts.map