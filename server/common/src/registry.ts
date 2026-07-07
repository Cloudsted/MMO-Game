/**
 * RegistryService: all game data (items, abilities, mobs, loot tables) loads
 * through here — never imported as module constants — so `/reload registries`
 * can hot-reload tuning into live RoomHosts. Zod-validated on load; fails
 * fast on dangling id references.
 */
import { z } from "zod";
import { resolve } from "node:path";
import { readJsonFile } from "./json.js";
import { SHARED_DIR } from "./paths.js";
import { BLOCK } from "./blocks.js";

// ---------- schemas ----------

export const RaritySchema = z.object({
  mult: z.number(),
  color: z.string(),
  weight: z.number(),
});
export type RarityDef = z.infer<typeof RaritySchema>;

export const ItemDefSchema = z.object({
  name: z.string(),
  /** trophy: no use action — a trinket that exists to be sold */
  kind: z.enum(["weapon", "consumable", "building", "trophy", "misc"]),
  ability: z.string().optional(), // weapons: the ability this item grants
  damage: z.number().optional(), // weapons: base damage before rarity/level
  /** weapons: base uses before breaking (scaled per instance by rarity + roll) */
  durability: z.number().int().positive().optional(),
  /** building items: block name (shared/blocks.json) this item places */
  block: z.string().optional(),
  value: z.number().int(), // shop base price (gold); shops buy at a fraction
  stack: z.number().int().positive(),
  icon: z.tuple([z.number().int(), z.number().int()]), // (col,row) in tf_icon_16
  viewmodel: z.string().optional(), // first-person held sprite key
  effect: z
    .object({
      heal: z.number().optional(),
      mana: z.number().optional(),
      hotTotal: z.number().optional(),
      hotDurMs: z.number().optional(),
      /** clears any active damage-over-time debuff (antidote) */
      cureDot: z.boolean().optional(),
    })
    .optional(),
});
export type ItemDef = z.infer<typeof ItemDefSchema>;

export const AbilityDefSchema = z.object({
  kind: z.enum(["melee", "projectile", "self"]),
  // melee/bow path: windup -> active -> recover. spell path: cast -> recover.
  windupMs: z.number().int().optional(),
  activeMs: z.number().int().optional(),
  castTimeMs: z.number().int().optional(),
  recoverMs: z.number().int(),
  range: z.number().optional(), // melee reach (m)
  arcDeg: z.number().optional(), // melee cone width
  projSpeed: z.number().optional(),
  maxRange: z.number().optional(), // projectile lifetime range
  damage: z.number().optional(), // fallback when no item/mob damage applies
  heal: z.number().optional(),
  /** on-hit debuff: slowPct = frost-style move slow, dotTotal = poison-style
   *  damage over time (total hp dealt across durMs). Either or both. */
  debuff: z
    .object({
      slowPct: z.number().optional(),
      dotTotal: z.number().optional(),
      durMs: z.number().int(),
    })
    .optional(),
  /** self-kind abilities may summon minions on release (boss adds). The
   *  summoner's live-minion count is capped: at cap the option drops out
   *  of the attack kit, below it the count tops up to the cap. */
  summon: z
    .object({
      mob: z.string(),
      count: z.number().int().positive(),
      radius: z.number().positive().default(4),
      cap: z.number().int().positive().default(4),
      /** flavor line broadcast to nearby players when the wave rises */
      text: z.string().optional(),
    })
    .optional(),
  canMoveWhile: z.boolean(),
  interruptible: z.boolean(),
  cooldownMs: z.number().int(),
  manaCost: z.number(),
  fx: z.string(),
});
export type AbilityDef = z.infer<typeof AbilityDefSchema>;

/** One option in a mob's attack kit. The mob picks among options that are
 *  usable right now (range window, cooldown, melee vertical reach) with a
 *  weighted roll — see chooseAttack in the shard sim. */
export const MobAttackSchema = z.object({
  ability: z.string(),
  /** damage override for this attack (default: the mob's base damage) */
  damage: z.number().optional(),
  /** don't use inside this 2D distance (bows prefer melee point-blank) */
  minRange: z.number().optional(),
  /** weighted-random share when several options are usable at once */
  weight: z.number().positive().default(1),
});
export type MobAttackDef = z.infer<typeof MobAttackSchema>;

export const MobDefSchema = z.object({
  name: z.string(),
  sprite: z.string(),
  level: z.number().int(),
  hp: z.number(),
  damage: z.number(),
  moveSpeed: z.number(),
  /** legacy single-attack form; multi-attack mobs author `attacks` instead */
  ability: z.string().optional(),
  /** attack kit — bosses/bigger mobs carry 2+ options (melee + ranged...) */
  attacks: z.array(MobAttackSchema).min(1).optional(),
  aggroRadius: z.number(),
  attackRange: z.number(),
  leashRadius: z.number(),
  fleeAtHpPct: z.number(),
  xp: z.number(),
  loot: z.string(),
  /** client vocal sound groups in the audio manifest (all optional; omitted = silent category) */
  sounds: z
    .object({
      idle: z.string().optional(),
      attack: z.string().optional(),
      hurt: z.string().optional(),
      die: z.string().optional(),
    })
    .optional(),
});
export type MobDef = z.infer<typeof MobDefSchema>;

/** A mob's attack kit, normalized: multi-attack mobs author `attacks`;
 *  single-attack mobs keep the legacy `ability` field (kit of one). */
export function mobAttacks(def: MobDef): MobAttackDef[] {
  if (def.attacks && def.attacks.length > 0) return def.attacks;
  return def.ability ? [{ ability: def.ability, weight: 1 }] : [];
}

/** Weighted entry: exactly one of item / table / nothing (weight only). */
export const LootEntrySchema = z.object({
  weight: z.number().positive(),
  item: z.string().optional(),
  table: z.string().optional(),
  qty: z.tuple([z.number().int(), z.number().int()]).optional(),
  minRarity: z.string().optional(),
});

export const LootTableSchema = z.object({
  gold: z.tuple([z.number().int(), z.number().int()]),
  rolls: z.tuple([z.number().int(), z.number().int()]),
  entries: z.array(LootEntrySchema).min(1),
  /** boss-style guaranteed-drop slots: every entry always rolls once */
  guaranteed: z.array(LootEntrySchema).default([]),
});
export type LootTable = z.infer<typeof LootTableSchema>;

const ItemsFileSchema = z.object({
  rarities: z.record(z.string(), RaritySchema),
  items: z.record(z.string(), ItemDefSchema),
});

// ---------- service ----------

export class RegistryService {
  rarities!: Record<string, RarityDef>;
  items!: Record<string, ItemDef>;
  abilities!: Record<string, AbilityDef>;
  mobs!: Record<string, MobDef>;
  loot!: Record<string, LootTable>;

  constructor() {
    this.reload();
  }

  /** (Re)load everything from shared/. Throws (leaving old data intact-ish)
   *  on schema or cross-reference errors — callers catch and report. */
  reload(): void {
    const itemsFile = ItemsFileSchema.parse(readJsonFile(resolve(SHARED_DIR, "items.json")));
    const abilities = z.record(z.string(), AbilityDefSchema).parse(readJsonFile(resolve(SHARED_DIR, "abilities.json")));
    const mobs = z.record(z.string(), MobDefSchema).parse(readJsonFile(resolve(SHARED_DIR, "mobs.json")));
    const loot = z.record(z.string(), LootTableSchema).parse(readJsonFile(resolve(SHARED_DIR, "loot.json")));

    // cross-reference validation: fail fast on dangling ids
    for (const [id, item] of Object.entries(itemsFile.items)) {
      if (item.ability && !abilities[item.ability]) throw new Error(`item ${id}: unknown ability ${item.ability}`);
      if (item.block && !BLOCK[item.block]) throw new Error(`item ${id}: unknown block ${item.block}`);
    }
    for (const [id, mob] of Object.entries(mobs)) {
      const attacks = mobAttacks(mob);
      if (attacks.length === 0) throw new Error(`mob ${id}: needs an ability or an attacks kit`);
      for (const a of attacks) {
        if (!abilities[a.ability]) throw new Error(`mob ${id}: unknown ability ${a.ability}`);
      }
      if (!loot[mob.loot]) throw new Error(`mob ${id}: unknown loot table ${mob.loot}`);
    }
    for (const [id, ability] of Object.entries(abilities)) {
      if (ability.summon && !mobs[ability.summon.mob]) {
        throw new Error(`ability ${id}: unknown summon mob ${ability.summon.mob}`);
      }
    }
    for (const [id, table] of Object.entries(loot)) {
      for (const e of [...table.entries, ...table.guaranteed]) {
        if (e.item && e.table) throw new Error(`loot ${id}: entry has both item and table`);
        if (e.item && !itemsFile.items[e.item]) throw new Error(`loot ${id}: unknown item ${e.item}`);
        if (e.table && !loot[e.table]) throw new Error(`loot ${id}: unknown table ${e.table}`);
        if (e.minRarity && !itemsFile.rarities[e.minRarity]) throw new Error(`loot ${id}: unknown rarity ${e.minRarity}`);
      }
    }

    this.rarities = itemsFile.rarities;
    this.items = itemsFile.items;
    this.abilities = abilities;
    this.mobs = mobs;
    this.loot = loot;
  }

  item(id: string): ItemDef {
    const d = this.items[id];
    if (!d) throw new Error(`unknown item ${id}`);
    return d;
  }
  ability(id: string): AbilityDef {
    const d = this.abilities[id];
    if (!d) throw new Error(`unknown ability ${id}`);
    return d;
  }
  mob(id: string): MobDef {
    const d = this.mobs[id];
    if (!d) throw new Error(`unknown mob ${id}`);
    return d;
  }
  lootTable(id: string): LootTable {
    const d = this.loot[id];
    if (!d) throw new Error(`unknown loot table ${id}`);
    return d;
  }

  /** Rarity tiers ordered ascending by power (mult). */
  rarityOrder(): string[] {
    return Object.entries(this.rarities)
      .sort((a, b) => a[1].mult - b[1].mult)
      .map(([k]) => k);
  }
}
